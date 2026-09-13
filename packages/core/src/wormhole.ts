/**
 * **终局玩法「虫洞」（搜打撤底层）· 数值与入场口径单点**（2026-09-12 设计稿 · 2026-09-13 开工）。
 *
 * 设计稿：`docs/design/wormhole-extraction-endgame-20260912.md`（§4 质量压塌与回合预算 · §5 背包与战利品）。
 *
 * ⚠ **施工期铁律（船长 2026-09-13）**：
 * 1. **虫洞完成前对玩家不可见** —— 入口沿用现有调试开关（`ui/DebugPanel.tsx` 的 `debugEnabled()`）；
 *    相关数据走 `MarketGoodDef.unreleased` 闸门；**玩家可见文案（手册/图鉴/公告/教程）不得提及虫洞**；
 * 2. **完成后由船长拍板**才开入口/删闸门/写公告。
 *
 * 本模块**只放纯逻辑**（数值换算与校验），不持状态、不碰存档；副本状态机在 C 批另开。
 */
import type { GameState, BattleState } from './state'
import { addLog } from './state'
import type { AnomalyDef, ShipDef, SimContext } from './types'
import { uidDefId } from './labels'
import { cargoCapacityM3Of } from './inventory'
import { shipDisplayName } from './instances'
import {
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeCardIdFor,
} from './wormholeFoes'
import type { WormholeFoeKind } from './wormholeFoes'
import {
  WORMHOLE_TURN_PER_ACTIVATE,
  WORMHOLE_TURN_PER_MOVE,
  WORMHOLE_TURN_PER_PICK,
  WORMHOLE_TURN_PER_SCAN,
  wormholeRng,
  wormholeStream,
  gridCellAt,
  gridScanTargets,
  isExitCell,
  signalOfPlace,
  wormholeMakeGrid,
} from './wormholeGrid'
import type { HexCell, WormholeGridCell, WormholeGridState, WormholePlace, WormholeSignal } from './wormholeGrid'

/* ═══════════ 一、质量压塌（船长 2026-09-12 定） ═══════════ */

/** 舰种档 → 折算质量（**按级别，不用真实质量**；船长定的表） */
export const WORMHOLE_MASS_BY_TIER: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 500, // 护卫舰
  2: 1_500, // 驱逐舰
  3: 3_500, // 巡洋舰
  4: 7_000, // 战列舰
  5: 0, // 旗舰：严禁入场（见入场上限）
}

/** **入场上限档 = 战列舰（T4）**：旗舰（T5）进不去（"压塌虫洞入口"） */
export const WORMHOLE_MAX_TIER = 4

/** **编队总质量上限**（船长 2026-09-12 定）：超过无法跃入 */
export const WORMHOLE_TOTAL_MASS_CAP = 16_000

/** 编队可选舰船数上限（船长：「玩家需要准备 4 艘船」） */
export const WORMHOLE_MAX_SHIPS = 4

/** 一艘船能否编入虫洞队（档位不超 T4） */
export function wormholeShipAllowed(ship: ShipDef): boolean {
  return ship.tier <= WORMHOLE_MAX_TIER
}

/** 该船的折算质量（T5 = 0，但**禁止入场**由 `wormholeShipAllowed` 单独把关） */
export function wormholeShipMass(ship: ShipDef): number {
  return WORMHOLE_MASS_BY_TIER[ship.tier as 1 | 2 | 3 | 4 | 5] ?? 0
}

/* ═══════════ 二、回合预算（船长 2026-09-12 定：基础 55 · 系数 0.53） ═══════════ */

/** 回合公式常数（船长定值）：`floor(基础 × (1 − 总质量 ÷ 上限 × 系数))` */
export const WORMHOLE_TURN_BASE = 55
export const WORMHOLE_TURN_MASS_COEF = 0.53

/**
 * **总质量 → 可探索回合数**（越重、时间越短）：
 * `floor(55 × (1 − 总质量 ÷ 16,000 × 0.53))`。
 * 设计稿 §4.3 的实测表逐格复现（4×T1 = 51 … 2×T4+1×T2 = 26）。
 */
export function wormholeTurnBudget(totalMass: number): number {
  const ratio = Math.max(0, Math.min(1, totalMass / WORMHOLE_TOTAL_MASS_CAP))
  return Math.floor(WORMHOLE_TURN_BASE * (1 - ratio * WORMHOLE_TURN_MASS_COEF))
}

/** 回合消耗口径（船长 2026-09-12 定）——每节点 1、每多打一波 +1、每捡一堆 +1 */
export const WORMHOLE_TURN_PER_NODE = 1
export const WORMHOLE_TURN_PER_EXTRA_WAVE = 1
export const WORMHOLE_TURN_PER_PICKUP = 1

/** 一次节点推进的回合开销（`waves` = 该节点打了 1 + 额外波数；`pickups` = 该节点捡了几堆） */
export function wormholeStepCost(waves: number, pickups: number): number {
  const extraWaves = Math.max(0, Math.floor(waves) - 1)
  return (
    WORMHOLE_TURN_PER_NODE +
    extraWaves * WORMHOLE_TURN_PER_EXTRA_WAVE +
    Math.max(0, Math.floor(pickups)) * WORMHOLE_TURN_PER_PICKUP
  )
}

/* ═══════════ 三、入场校验（质量 / 档位 / 艘数） ═══════════ */

/** 入场校验失败的原因码（界面文案由 E 批按此渲染） */
export type WormholeAdmissionCode =
  | 'ok'
  | 'too-many-ships'
  | 'tier-too-high'
  | 'no-ship'
  | 'mass-over-cap'
  | 'unknown-ship'

export interface WormholeAdmission {
  ok: boolean
  code: WormholeAdmissionCode
  /** 折合总质量（只看能入场的船） */
  totalMass: number
  /** 质量占比（0~1） */
  massRatio: number
  /** 可探索回合预算 */
  turnBudget: number
}

/** 旗舰 / 超重编成的拒因文案（施工期仅调试面板可见） */
export const WORMHOLE_ADMISSION_TEXT: Record<WormholeAdmissionCode, string> = {
  ok: '',
  'too-many-ships': `最多只能带 ${WORMHOLE_MAX_SHIPS} 艘船`,
  'tier-too-high': `旗舰过重，会压塌虫洞入口（最多带到 T${WORMHOLE_MAX_TIER} 战列舰）`,
  'no-ship': '至少要带一艘船',
  'mass-over-cap': `编队总质量超过 ${WORMHOLE_TOTAL_MASS_CAP.toLocaleString('zh-CN')}，无法跃入`,
  'unknown-ship': '编队里有无法识别的船型',
}

/**
 * **入场校验**（纯函数）：给定船型 id 列表 ⇒ 能否入场 + 总质量 + 回合预算。
 * 口径顺序：艘数 → 船型可识别 → **档位（T5 禁入）** → 总质量上限。
 * 注意：**T5 的折算质量按 0 计**，但它在"档位"这一步就被拦下（不会因为"质量为 0"而漏过）。
 *
 * ⚠ **id 口径（2026-09-13 D 批修正）**：入参是**舰队实例 uid**（`state.fleet` 的键）——
 * 首艘同型实例的 uid 就等于船型 id，但第 2 艘起是 `船型id#2` ⇒ 直接 `ctx.ships.get(id)`
 * 会在"带两艘同型船"时误判 `unknown-ship`。故按 `uidDefId` 剥掉 `#N` 再查表。
 */
export function wormholeAdmission(ctx: SimContext, shipIds: readonly string[]): WormholeAdmission {
  const none = (code: WormholeAdmissionCode, totalMass = 0): WormholeAdmission => ({
    ok: false,
    code,
    totalMass,
    massRatio: totalMass / WORMHOLE_TOTAL_MASS_CAP,
    turnBudget: wormholeTurnBudget(totalMass),
  })
  if (shipIds.length === 0) return none('no-ship')
  if (shipIds.length > WORMHOLE_MAX_SHIPS) return none('too-many-ships')
  const ships: ShipDef[] = []
  for (const id of shipIds) {
    const ship = ctx.ships.get(uidDefId(id))
    if (!ship) return none('unknown-ship')
    ships.push(ship)
  }
  if (ships.some((s) => !wormholeShipAllowed(s))) return none('tier-too-high')
  const totalMass = ships.reduce((sum, s) => sum + wormholeShipMass(s), 0)
  if (totalMass > WORMHOLE_TOTAL_MASS_CAP) return none('mass-over-cap', totalMass)
  return {
    ok: true,
    code: 'ok',
    totalMass,
    massRatio: totalMass / WORMHOLE_TOTAL_MASS_CAP,
    turnBudget: wormholeTurnBudget(totalMass),
  }
}

/* ═══════════ 四、背包格模型（船长 2026-09-12 定：每格 500 m³） ═══════════ */

/** 一格体积（m³）——船长原提案值 */
export const WORMHOLE_SLOT_M3 = 500

/**
 * **背包格数 = floor(货仓合计 ÷ 500)**；货仓口径走 `cargoCapacityM3Of`（**含技能与货舱件加成**，船长已确认）。
 * `cargoTotalM3` 由调用方按编队逐船求和（施工期由 B 批的舰队入口算，C 批接副本状态）。
 */
export function wormholeBagSlots(cargoTotalM3: number): number {
  return Math.max(0, Math.floor(cargoTotalM3 / WORMHOLE_SLOT_M3))
}

/** 某种物品**每格最多能装多少单位**（格上限 ÷ 单位体积；体积非正 ⇒ 0，防除零） */
export function wormholeUnitsPerSlot(unitM3: number): number {
  if (!(unitM3 > 0)) return 0
  return Math.floor(WORMHOLE_SLOT_M3 / unitM3)
}

/**
 * **该物品要吃掉几格**（每格只装一种物品）：
 * `ceil(单位数 ÷ 每格上限)` —— 虚空母矿 500 个/格、虚空晶 50,000 个/格（同理可算）。
 * 返回 `Infinity` 表示"该物品无法入包"（单位体积非法）。
 */
export function wormholeSlotsUsed(unitM3: number, units: number): number {
  const per = wormholeUnitsPerSlot(unitM3)
  if (per <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil(Math.max(0, units) / per)
}

/** 背包一格的内容（每格只装一种物品 ⇒ 一个 `BagSlot` 就是一条同物品的记录） */
export interface WormholeBagSlot {
  itemId: string
  units: number
}

/**
 * **超格时丢弃货物**（船长 2026-09-13 裁定：「**扣背包格，不足时丢弃货物**」）。
 *
 * 场景 = 有船被打沉 ⇒ 编队合计货仓变小 ⇒ 背包格上限跟着变小（格数由"剩余编队货仓 ÷ 500"现算）
 * ⇒ 手上这包货可能装不下了。口径两条：
 * - **整格丢**（一格 = 一条同物品记录；留半格不释放格位）；无法识别的物品视为最贵（最后才丢）；
 * - **每格价值从低到高丢**（价值 = 单位数 × 基础卖价）⇒ 保住贵的（与既有"优先回收高价值"同一取舍方向）。
 *
 * 返回丢掉的那些格（调用方写日志用），原数组不改（返回新数组）。
 */
export function wormholeTrimBag(
  ctx: SimContext,
  bag: readonly WormholeBagSlot[],
  capacity: number,
  /**
   * **价值解析器**（可选）：返回 `{ tier, iskPerSlot }`——`tier` 小的先丢，同档再比每格价值。
   * 缺省 = 基础卖价（老行为）。**洞内实战必须传**（`wormholeBattle` 传
   * `wormholeSalvage.wormholeLootTierOf + wormholeLootValueIsk`）：残骸 `baseSellPriceIsk = 1`，
   * 只看基础价会把**稀有残骸第一个丢掉**（2026-09-13 F3c 抓到的真问题）。
   * ⚠ 为什么用参数而不是在这里 import 打捞模块：`wormhole.ts` 被 `state.ts` 顶层引用，
   * 而打捞模块经 `salvaging` 回头吃 `state` ⇒ 直接 import 会成环（D/F 批两次踩过的坑）。
   */
  valueOf?: (slot: WormholeBagSlot) => { tier: number; iskPerSlot: number },
): { bag: WormholeBagSlot[]; dropped: WormholeBagSlot[] } {
  const slots = bag.map((s) => ({ ...s }))
  const perOf = (itemId: string): number => wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0)
  /** 每格价值（判"先丢谁"用的就是它；认不出的物品 = 无穷大 ⇒ 最后丢） */
  const valuePerSlot = (s: WormholeBagSlot): { tier: number; isk: number } => {
    const def = ctx.items.get(s.itemId)
    const per = perOf(s.itemId)
    if (!def || per <= 0) return { tier: Number.POSITIVE_INFINITY, isk: Number.POSITIVE_INFINITY }
    if (valueOf) return { tier: valueOf(s).tier, isk: valueOf(s).iskPerSlot }
    return { tier: 1, isk: per * Math.max(0, def.baseSellPriceIsk ?? 0) }
  }
  const dropped: WormholeBagSlot[] = []
  while (wormholeBagUsage(ctx, slots, capacity).used > capacity && slots.length > 0) {
    let pick = 0
    for (let i = 1; i < slots.length; i++) {
      const a = valuePerSlot(slots[i]!)
      const b = valuePerSlot(slots[pick]!)
      const worse =
        a.tier < b.tier ||
        (a.tier === b.tier && (a.isk < b.isk || (a.isk === b.isk && slots[i]!.itemId < slots[pick]!.itemId)))
      if (worse) pick = i
    }
    const slot = slots[pick]!
    const per = perOf(slot.itemId)
    // **一次丢一格**（不是整条记录连锅端）：满格记录按"每格单位数"扣，零头记录整条丢
    const cut = per > 0 ? Math.min(slot.units, per) : slot.units
    slot.units -= cut
    const same = dropped.find((d) => d.itemId === slot.itemId)
    if (same) same.units += cut
    else dropped.push({ itemId: slot.itemId, units: cut })
    if (slot.units <= 0) slots.splice(pick, 1)
  }
  return { bag: slots, dropped }
}

/** 背包占格汇总：`N / M` 与是否溢出（溢出不入包——拾取前由界面/引擎拦） */
export function wormholeBagUsage(
  ctx: SimContext,
  slots: readonly WormholeBagSlot[],
  capacity: number,
): { used: number; capacity: number; overflow: boolean } {
  let used = 0
  for (const s of slots) {
    const def = ctx.items.get(s.itemId)
    const per = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
    used += per > 0 ? Math.ceil(s.units / per) : capacity + 1 // 无法识别的物品 ⇒ 视为溢出（不静默吞）
  }
  return { used, capacity, overflow: used > capacity }
}

/* ═══════════ 五、副本状态机（C 批：层 / 节点 / 回合 / 撤离） ═══════════ */

/**
 * 副本相位：`idle` 未在洞里（含未出发与已结算）· `inside` 洞里（节点推进中）· `extracting` 撤离战。
 *
 * ⚠ 两条硬约束（船长裁定）：
 * 1. **战斗没结束不能撤** ⇒ `wormholeExtract` **只在层末**（`pendingNode === null`）可用；
 * 2. **回合耗尽只能撤离** ⇒ `turnsLeft` 不够走完当前节点时，推进被拒（`mustExtract`）。
 */
export type WormholePhase = 'idle' | 'inside' | 'extracting'

/** 层内节点类型（B 批最小集：战斗 / 拾取 / 事件；BOSS 门与撤离战在 D/F 批细化） */
export type WormholeNodeKind = 'combat' | 'pickup' | 'event'

export interface WormholeNode {
  kind: WormholeNodeKind
  /** 战斗：本节点波数（≥1；每多一波 +1 回合） */
  waves: number
  /** 拾取：本节点可捡几堆（每堆 +1 回合） */
  pickups: number
  /** 事件：事件池键（内容由后续批次接 `travelEvents` 风格的表） */
  eventKey?: string
  /** 本节点打完/点完要花几回合（= `wormholeStepCost`） */
  cost: number
  /** 拾取点里**还没捡走**的堆（E 批：捡一堆就从这里删一条；非拾取节点不写该字段） */
  piles?: WormholePile[]
}

export interface WormholeRunState {
  phase: WormholePhase
  /** 当前层（1 起） */
  depth: number
  /** 本层已推进到第几个节点（0 起） */
  nodeIndex: number
  /** 剩余回合 */
  turnsLeft: number
  /** 出发时锁定的回合预算（读数用） */
  turnsTotal: number
  /** 编队（船型 id；进场时锁定） */
  fleet: readonly string[]
  /** 折合总质量（进场时锁定） */
  totalMass: number
  /** 背包（每格只装一种物品 ⇒ 一条记录 = 一格的内容） */
  bag: WormholeBagSlot[]
  /** 当前待处理节点（`null` = 本层已清空，处于"层末抉择"） */
  pendingNode: WormholeNode | null
  /** 本层节点数（2~3，船长定） */
  nodesPerLayer: number
  /**
   * **进行中的洞内战斗**（F 批 · 2026-09-13；`null`/缺省 = 不在战斗中）。
   * 非空即"战斗没结束" ⇒ **不能撤离、不能推进/深入**（设计稿冲突 2 / 船长第 8 条）。
   * 宿主放在副本状态里（而非复用 `expedition.battle`）：洞内战斗**不走远征结算**
   * （不发赏金、不返航），收口由 `advanceWormhole` 自己做。
   */
  battle?: BattleState | null
  /**
   * **已打通层末 BOSS 的层号**（= 本层 BOSS 已清）。
   * 设计稿 §3：「层末 BOSS 打完才出现『继续深入 / 撤离』的抉择」⇒
   * `wormholeDescend` / `wormholeExtract` 都要求 `bossCleared === depth`。
   */
  bossCleared?: number
  /**
   * **玩家此刻是否"人在洞里"**（船长 2026-09-13 批准实行 · 议案 A）。
   *
   * 口径（**活动位开关**，与"这趟存不存在"是两件事）：
   * - `true` = **进虫洞这个活动正在进行** ⇒ 占着主控（采矿/打捞/扫描/巡逻/远征/运输/亲自开炉一律被拒），
   *   洞内照常推进（战斗实时打）；
   * - `false` = 玩家**临时离开**（关掉虫洞界面）⇒ **活动停止、主控立刻释放**（可以去做别的），
   *   **洞内一切冻结**（战斗不推进、不掉血、回合不扣），**进度原样保存**；
   * - 回来（`wormholeResume`）要求**主控空闲**。
   *
   * 存档：`save.ts` 的 `cleanWormhole` 同步清洗（旧档/坏值 ⇒ `false`＝不占主控，安全侧）。
   */
  attending?: boolean
  /**
   * **临时离开的时刻**（state.gameMs；仅 ttending === false 时有意义）。
   * 回来时按 state.gameMs - leftAtGameMs 把**进行中的战斗时钟整体前移**——
   * 否则 dvanceBattleFor 的步进基准（while (state.gameMs > battle.lastTickGameMs)）
   * 会把"离开的这段时间"一次性当作战时间补算：实测 2×T1 离开 6 秒回来**当场团灭**，
   * 冻结就白做了。随档保存（离线离开同样适用）。
   */
  leftAtGameMs?: number
  /**
   * **本趟的期望交距偏好**（玩家在洞内战里拖距离条选的；setBattleDesire 写入）。
   * 用途：本趟**后续每一场**洞内战斗开战都沿用它（否则每个节点都要重拖一次）。
   * 注意：**不写星系偏好**——虫洞不属于任何星系（远征那条路才写星系）。
   */
  desireM?: number
  /**
   * **本层的网格探索状态**（F3a · 2026-09-13 船长确认「探索采用网格地图的形式，整体网格地图呈现圆型」）。
   * 可选字段：老档没有 = 该层走旧口径（零迁移）；新开层由 wormholeMakeGrid(seed, depth) 生成。
   * 真相（place）随档保存，**遮蔽靠"未扫描不展示"**（evealOf）——不是靠不存。
   */
  grid?: import('./wormholeGrid').WormholeGridState
  /**
   * **本趟的确定性种子**（F3b · 2026-09-13）：层内产出的**生成**（残骸堆、遗迹专属判定、战果）
   * 都按 `(本趟种子, 层, 格坐标)` 散列 ⇒ 同一趟里反复进出同一格结果不变、随档可复现。
   * ⚠ 不能借用 `state.rng.seed`：那是全局随机流的活种子，会随游戏进行漂移（同格会生成两次不同结果）。
   * 可选字段（老档没有 ⇒ 退到全局种子，只影响老档的复现性，零迁移）。
   */
  seed?: number
  /**
   * **随行战利品**（F3b · 2026-09-13）：图纸 / 装备本体这类**不进背包格子**的东西（遗迹专属掉落）。
   * **撤离成功才入库**（`wormholeSalvage.wormholeDeliverRelics`）——半路全损就一起丢，
   * 与背包同一条风险线。可选字段（零迁移）。
   */
  relics?: string[]
}

export interface WormholeState {
  /** 进行中的一趟（null = 不在洞里） */
  run: WormholeRunState | null
  /** 本趟累计：损失船数（结算读数用） */
  lastFleetLost: number
}

export const EMPTY_WORMHOLE_STATE: WormholeState = { run: null, lastFleetLost: 0 }

/* ── 层曲线（船长 2026-09-13：「深层收益应该比难度曲线要更高」） ──
 * ⚠ 实现已挪到 `wormholeFoes.ts`（引擎侧 `combat.ts` 也要用它做按层派生，不能反向依赖本文件）；
 * 这里**原样再导出**，保持既有的 `from './wormhole'` 引用与用例不变。 */
export {
  WORMHOLE_THREAT_BASE,
  WORMHOLE_THREAT_GROWTH,
  WORMHOLE_REWARD_GROWTH,
  WORMHOLE_THREAT_PER_LAYER,
  WORMHOLE_BOSS_THREAT_MUL,
  WORMHOLE_EXTRACT_THREAT_MUL,
  WORMHOLE_FOE_CARD_IDS,
  wormholeLayerThreat,
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeFoeThreat,
  wormholeCardIdFor,
  wormholeAnomalyOf,
  wormholeNaturalHp,
} from './wormholeFoes'
export type { WormholeFoeKind } from './wormholeFoes'

/** 起一趟：校验编队（复用 B 批的 `wormholeAdmission`）并锁定质量 / 回合预算 / 背包 */
export interface WormholeStartResult {
  ok: boolean
  error?: string
  run?: WormholeRunState
}

export function wormholeStartRun(
  ctx: SimContext,
  shipIds: readonly string[],
  rngSeed: number,
): WormholeStartResult {
  const adm = wormholeAdmission(ctx, shipIds)
  if (!adm.ok) return { ok: false, error: WORMHOLE_ADMISSION_TEXT[adm.code] }
  const depth = 1
  return {
    ok: true,
    run: {
      phase: 'inside',
      depth,
      nodeIndex: 0,
      turnsLeft: adm.turnBudget,
      turnsTotal: adm.turnBudget,
      fleet: [...shipIds],
      totalMass: adm.totalMass,
      bag: [],
      // F3a-2：层内内容**全部**由网格承载（`grid`）；`pendingNode` 是旧线性节点口径的遗留字段，
      // 新开趟一律为 `null`（老档里已有的 pendingNode 仍能被 `wormholeAdvanceNode` 走完，见该函数注释）。
      pendingNode: null,
      nodesPerLayer: wormholeNodesPerLayer(depth),
      grid: wormholeMakeGrid(rngSeed, depth, wormholeScanBonusOf(ctx, shipIds)),
      seed: rngSeed,
    },
  }
}

/**
 * 造一个层内节点（**确定性**：同 `(seed, depth, index)` ⇒ 同结果，便于复现与用例）。
 * 口径：每层**首节点固定战斗**（"进层先打一场"）、其余按 roll 分战斗/拾取/事件；
 * 波数随深度 +1（层 3 起可到 3 波；每多一波 +1 回合）。
 * 拾取节点的**堆**在造节点时一并生成（`piles`）——捡走即从数组里删，随档保存。
 */
export function wormholeMakeNode(seed: number, depth: number, index: number): WormholeNode {
  const h = Math.abs((seed * 1103515245 + (depth * 97 + index) * 12345) % 2147483647)
  const roll = h % 100
  const waves = Math.min(3, 1 + Math.floor(Math.max(0, depth - 1) / 2) + (roll % 2))
  if (index === 0) {
    return { kind: 'combat', waves, pickups: 0, cost: wormholeStepCost(waves, 0) }
  }
  if (roll < 45) {
    const pickups = 2
    return {
      kind: 'pickup',
      waves: 0,
      pickups,
      cost: wormholeStepCost(1, pickups),
      piles: wormholeNodePiles(seed, depth, index, pickups),
    }
  }
  if (roll < 80) return { kind: 'combat', waves, pickups: 0, cost: wormholeStepCost(waves, 0) }
  return {
    kind: 'event',
    waves: 0,
    pickups: 0,
    eventKey: `wh-event-${roll % 3}`,
    cost: wormholeStepCost(1, 0),
  }
}

/** 推进结果（读数为准；界面到 E 批接） */
export interface WormholeAdvanceResult {
  ok: boolean
  error?: string
  /** 本步花掉几回合 */
  spent?: number
  /** 是否进入"层末抉择"（`pendingNode === null`） */
  atLayerEnd?: boolean
  /** 是否因回合耗尽而**只能撤离** */
  mustExtract?: boolean
}

/**
 * **结算当前节点**并推进到下一个（或进入层末抉择）。
 * - 回合不足 ⇒ **拒绝推进**（只能撤离）——"回合耗尽只能撤离"的落点；
 * - 层内节点走完 ⇒ `pendingNode = null`（层末：可"继续深入"或"撤离"）；
 * - **不自动跨层**：跨层由 `wormholeDescend`（层末抉择）处理。
 */
export function wormholeAdvanceNode(
  ctx: SimContext,
  run: WormholeRunState,
  rngSeed: number,
): WormholeAdvanceResult {
  void ctx
  const node = run.pendingNode
  if (!node) return { ok: false, error: '本层已清空：请选择「继续深入」或「撤离」。' }
  if (run.turnsLeft < node.cost) {
    return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  }
  const spent = node.cost
  run.turnsLeft -= spent
  run.nodeIndex += 1
  if (run.nodeIndex >= run.nodesPerLayer) {
    run.pendingNode = null
    return { ok: true, spent, atLayerEnd: true, mustExtract: run.turnsLeft <= 0 }
  }
  run.pendingNode = wormholeMakeNode(rngSeed, run.depth, run.nodeIndex)
  return { ok: true, spent, atLayerEnd: false, mustExtract: run.turnsLeft <= 0 }
}

/** 深入下一层（**只在层末可用**；回合耗尽时拒绝——只能撤离） */
export function wormholeDescend(run: WormholeRunState, rngSeed: number, scanBonus = 0): WormholeAdvanceResult {
  if (run.battle) return { ok: false, error: '战斗中：战斗没结束不能深入。' }
  if (run.pendingNode) return { ok: false, error: '本层战斗未结束：不能撤离、也不能深入。' }
  // 层末 BOSS 是门（设计稿 §3）：没打通本层 BOSS 不许往下走
  if ((run.bossCleared ?? 0) < run.depth) {
    return { ok: false, error: '层末守卫还堵在出口：先迎击本层守卫。' }
  }
  if (run.turnsLeft <= 0) return { ok: false, error: '回合已耗尽：只能撤离。', mustExtract: true }
  run.depth += 1
  run.nodeIndex = 0
  run.nodesPerLayer = wormholeNodesPerLayer(run.depth)
  // 新层 = 新盘（同 seed + 新 depth ⇒ 确定性新盘；入口格重新随机、扫描范围重置）
  run.grid = wormholeMakeGrid(rngSeed, run.depth, scanBonus)
  return { ok: true, spent: 0, atLayerEnd: false }
}

/**
 * **回合是否已经"走不动了"**（逃生门判据 · 2026-09-13 补）。
 *
 * 口径 = 设计稿 §六「**回合耗尽 ⇒ 只能撤离**」：
 * - `turnsLeft <= 0`：连深入都被拒（`wormholeDescend`）⇒ 只能走；
 * - `turnsLeft < 当前节点 cost`：这个节点**付不起**了 ⇒ 也只能走。
 *
 * ⚠ 为什么单独抽出来（**真死局**，2026-09-13 审计抓到）：首版 `wormholeExtract` 硬要求
 * `pendingNode === null && bossCleared >= depth` ⇒ 当"节点付不起"且节点是**拾取/事件**（没有「迎战」
 * 这条路）时，玩家**打不动节点、也撤不走**，面板上只剩施工期的「放弃本趟（调试）」——
 * 上线后就是无路可走。故把判据抽成单点，**撤离与界面按钮共用同一把尺**。
 */
export function wormholeOutOfTurns(run: WormholeRunState): boolean {
  if (run.turnsLeft <= 0) return true
  return run.pendingNode !== null && run.turnsLeft < run.pendingNode.cost
}

/**
 * 撤离（**层末守卫清掉之后**才放行）——**唯一例外是"回合走不动了"的逃生门**：
 * 回合耗尽时，哪怕本层守卫没清，也放行撤离（见 `wormholeOutOfTurns`）。
 * 战斗中（`run.battle` 非空）一律不许撤——船长裁定「战斗没结束不能撤」优先于逃生门。
 *
 * ⚠ F3a-2 口径变更：网格世界里"层内还有事没做完"不再是一道门——每个地点都是**自愿**去处理的，
 * 故旧口径的 `pendingNode !== null ⇒ 不许撤` 只对老档（线性节点）生效；网格层的门只剩**层末守卫**
 * 与**进行中的战斗**两条（都与设计稿 §3 一致）。
 */
export function wormholeExtract(run: WormholeRunState): WormholeAdvanceResult {
  if (run.battle) return { ok: false, error: '战斗中：战斗没结束不能撤退。' }
  const outOfTurns = wormholeOutOfTurns(run)
  if (run.pendingNode && !outOfTurns) return { ok: false, error: '战斗没结束不能撤退：先打完本节点。' }
  if ((run.bossCleared ?? 0) < run.depth && !outOfTurns) {
    return { ok: false, error: '层末守卫还堵在出口：先迎击本层守卫。' }
  }
  run.phase = 'extracting'
  return { ok: true }
}

/* ═══════════ 五之二、层内网格探索（F3a-2 · 船长 2026-09-13 口径） ═══════════
 *
 * 船长原话：「探索采用网格地图的形式。整体网格地图呈现圆型。玩家初始随机出现在一个网格地点入口。
 * 前往下一层的入口位于随机位置。玩家需要依靠扫描来获取周围网格地点的信息……玩家扫描需要消耗一回合。
 * 前往其他地点消耗一回合，激活该地点效果也需要一回合……玩家只有到达目标地点后才能知道目标地点的
 * 确切信息并更新地点，否则只会显示一个信号。」
 * 另：「**玩家可以到达任意位置，包括未扫描，但是前往未扫描的地方需要警告玩家即将前往未知地点**」
 * （⇒ 前往**不限邻格、不限距离**，一律 1 回合；未扫描的格要先警告再确认）。
 *
 * 三个动作 = 这一层的全部操作面：**扫描 / 前往 / 激活**，各花 1 回合（`wormholeGrid.ts` 的常量）。
 */

/** 激活一个地点会触发什么（**只回报效果，不在这里开战**——开战是 `wormholeBattle.wormholeActivateAt`） */
export type WormholeActivateEffect =
  /** 站在"下一层入口"上：触发层末守卫战（`WORMHOLE_EXIT_KIND`） */
  | { kind: 'exit'; key: string }
  /** 舰船信号：直接一场战斗（船长：「'舰船信号'地点直接就是一场战斗」） */
  | { kind: 'battle'; key: string }
  /** 舰船墓场 / 遗迹：打捞（F3b 落收益与"遗迹大概率触发恶战"） */
  | { kind: 'salvage'; key: string; place: 'graveyard' | 'ruins' }
  /** 矿脉：挖掘虚空母矿（F3b） */
  | { kind: 'excavate'; key: string }
  /** 虫洞谜质：取回后本趟内为我方提供增强（效果待船长裁定，F3c） */
  | { kind: 'matter'; key: string }
  /** **遗迹打捞结束的收尾战**（船长：「打捞结束时，大概率会触发一场高难度战斗」⇒ 70% / 本层威胁 ×1.3） */
  | { kind: 'ruinsBattle'; key: string }

/**
 * 网格动作的统一结果（`wormholeGridScan` / `wormholeGridTravel` / `wormholeGridActivate` 共用）。
 *
 * ⚠ **被拒时绝不扣回合**（`spent` 只在 `ok === true` 时有值）：回合是这一层唯一的硬通货，
 * "点了但白扣"是这个玩法最不能忍的失误。
 */
export interface WormholeGridActionResult {
  ok: boolean
  error?: string
  /** 拒绝码：`unknown-target` = 目标格没扫过（界面据此先弹「前往未知地点」的确认） */
  code?: 'unknown-target'
  /** 本次花掉几回合 */
  spent?: number
  /** 本次新揭开的格（扫描；`signal === null` = 空信息地点） */
  revealed?: { key: string; signal: WormholeSignal | null }[]
  /** 到达后该格的真相（前往） */
  arrived?: {
    key: string
    place: WormholePlace
    signal: WormholeSignal | null
    atExit: boolean
    /** 到达即开打（舰船信号）——调用方（`wormholeTravelTo`）据此立刻开战 */
    autoBattle?: boolean
    /** 到达即标出下一层入口（漂浮信标） */
    beacon?: boolean
  }
  /** 激活产生的效果（激活；有它就该接着开战/结算，见 `wormholeActivateAt`） */
  effect?: WormholeActivateEffect
  /** 回合耗尽 ⇒ 只能撤离（与 `wormholeAdvanceNode` 的 `mustExtract` 同口径） */
  mustExtract?: boolean
}

/** 本层网格 + 副本状态（不在洞里 / 老档没有网格 ⇒ null） */
function gridRun(state: GameState): { run: WormholeRunState; grid: WormholeGridState } | null {
  const run = state.wormhole.run
  if (!run?.grid) return null
  return { run, grid: run.grid }
}

/** 战斗中不许做任何层内动作（与"战斗没结束不能撤/不能深入"同一把尺） */
function gridActionBlocked(run: WormholeRunState): string | null {
  return run.battle ? '战斗中：先打完这一场。' : null
}

/**
 * **扫描**（1 回合）：揭开"当前格 + 扫描半径内"还没扫过的格。
 * 周围都扫过了 ⇒ **拒绝且不扣回合**（不让玩家把回合浪费在重复扫描上）。
 */
export function wormholeGridScan(state: GameState): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法扫描。' }
  const { run, grid } = hit
  const blocked = gridActionBlocked(run)
  if (blocked) return { ok: false, error: blocked }
  const targets = gridScanTargets(grid)
  if (targets.length === 0) return { ok: false, error: '周围都扫过了：换个地点再扫。' }
  if (run.turnsLeft < WORMHOLE_TURN_PER_SCAN) {
    return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_SCAN
  const revealed: { key: string; signal: WormholeSignal | null }[] = []
  for (const c of targets) {
    const cell = gridCellAt(grid, c)
    if (!cell) continue
    if (!grid.scanned.includes(cell.key)) grid.scanned.push(cell.key)
    revealed.push({ key: cell.key, signal: signalOfPlace(cell.place) })
  }
  const empty = revealed.filter((r) => r.signal === null).length
  addLog(
    state,
    'info',
    `🕳 扫描（半径 ${grid.scanRadius}）：揭开 ${revealed.length} 格` +
      (empty > 0 ? `（其中 ${empty} 格没有信号）` : '') +
      ` · 剩 ${run.turnsLeft} 回合。`,
  )
  return { ok: true, spent: WORMHOLE_TURN_PER_SCAN, revealed, mustExtract: run.turnsLeft <= 0 }
}

/**
 * **前往**（1 回合，不限距离 —— 船长裁定"可以到达任意位置"）。
 * 未扫描的格：**默认拒绝**并回 `code='unknown-target'`，界面拿它弹「即将前往未知地点」的确认，
 * 玩家确认后带 `confirmUnknown: true` 再来一次（这才是"警告"该有的样子：不会点一下就冲进去）。
 *
 * **到达时立刻发生的事**（船长 2026-09-13 追加两条裁定，都**不需要再点"激活"**）：
 * - **舰船信号 ⇒ 到达即开打**（「战斗节点到达即开打」）⇒ 该格记 `activated`，效果由
 *   `wormholeBattle.wormholeTravelTo` 接着开战（本函数只回报 `arrived.autoBattle`，不能自己开战：
 *   `wormhole.ts` 不许 import `wormholeBattle`（会成环），依赖方向固定为 wormholeBattle → wormhole）；
 * - **漂浮信标 ⇒ 到达即标出下一层入口**（「到达后有一个漂浮信标，会告诉玩家终点位置」）⇒
 *   `grid.exitKnown = true`（地图此后一直标着入口），该格同样记 `activated`。
 */
export function wormholeGridTravel(
  state: GameState,
  target: HexCell,
  opts?: { confirmUnknown?: boolean },
): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法前往。' }
  const { run, grid } = hit
  const blocked = gridActionBlocked(run)
  if (blocked) return { ok: false, error: blocked }
  const cell = gridCellAt(grid, target)
  if (!cell) return { ok: false, error: '那一格不在本层网格里。' }
  if (cell.key === gridCellAt(grid, grid.pos)?.key) return { ok: false, error: '已经在这个地点了。' }
  const scanned = grid.scanned.includes(cell.key) || grid.visited.includes(cell.key)
  if (!scanned && !opts?.confirmUnknown) {
    return { ok: false, error: '这个地点还没扫描过：前往未知地点？', code: 'unknown-target' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_MOVE) {
    return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_MOVE
  grid.pos = { q: cell.q, r: cell.r }
  // 到达 ⇒ 真相揭开（`revealOf` 里 visited 优先于 scanned）；同时并入 scanned，避免后续扫描重复"揭开"它
  if (!grid.visited.includes(cell.key)) grid.visited.push(cell.key)
  if (!grid.scanned.includes(cell.key)) grid.scanned.push(cell.key)
  const signal = signalOfPlace(cell.place)
  const atExit = isExitCell(grid, cell)
  // ── 到达即触发：舰船信号（开打）/ 漂浮信标（标出入口） ──
  const first = !grid.activated.includes(cell.key)
  const autoBattle = first && cell.place === 'ship'
  const beacon = first && cell.place === 'beacon'
  if (autoBattle || beacon) grid.activated.push(cell.key)
  if (beacon) grid.exitKnown = true
  addLog(
    state,
    'info',
    autoBattle
      ? `🕳 抵达舰船信号（${cell.q},${cell.r}）：对方已经发现我们——交火开始 · 剩 ${run.turnsLeft} 回合。`
      : beacon
        ? `🕳 抵达漂浮信标（${cell.q},${cell.r}）：信标把下一层入口标在了地图上（Q${grid.exit.q} · R${grid.exit.r}）· 剩 ${run.turnsLeft} 回合。`
        : atExit
          ? `🕳 抵达下一层入口（${cell.q},${cell.r}）：激活此处将迎战第 ${run.depth} 层守卫 · 剩 ${run.turnsLeft} 回合。`
          : `🕳 抵达新地点（${cell.q},${cell.r}）：${WORMHOLE_PLACE_TEXT[cell.place]} · 剩 ${run.turnsLeft} 回合。`,
  )
  return {
    ok: true,
    spent: WORMHOLE_TURN_PER_MOVE,
    arrived: {
      key: cell.key,
      place: cell.place,
      signal,
      atExit,
      ...(autoBattle ? { autoBattle: true } : {}),
      ...(beacon ? { beacon: true } : {}),
    },
    mustExtract: run.turnsLeft <= 0,
  }
}

/**
 * **激活当前地点**（1 回合，每个地点只算一次）。
 * - 空信息地点 / 已读过的漂浮信标 ⇒ **拒绝且不扣回合**（"什么都没有"，没有可执行的作业）；
 * - 站在下一层入口 ⇒ 层末守卫战（优先于地点自身类型：入口的意义就是"下一层"）；
 * - 舰船信号：新口径下**到达即已开打**（船长 2026-09-13），故这里只在"老档/异常态"下兜底开战；
 * - 其余按地点类型给效果，开战/结算由 `wormholeActivateAt` 接着做。
 */
export function wormholeGridActivate(state: GameState): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法激活。' }
  const { run, grid } = hit
  const blocked = gridActionBlocked(run)
  if (blocked) return { ok: false, error: blocked }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。' }
  if (grid.activated.includes(cell.key)) {
    return { ok: false, error: cell.place === 'beacon' ? '信标已经读过了。' : '这个地点已经处理过了。' }
  }
  const atExit = isExitCell(grid, cell)
  if (!atExit && (cell.place === 'empty' || cell.place === 'beacon')) {
    return { ok: false, error: '这里什么都没有：没有可执行的作业。' }
  }
  if (atExit && (run.bossCleared ?? 0) >= run.depth) {
    return { ok: false, error: '本层守卫已经清掉了：可以「继续深入」或「撤离」。' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_ACTIVATE) {
    return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_ACTIVATE
  grid.activated.push(cell.key)
  const effect: WormholeActivateEffect = atExit
    ? { kind: 'exit', key: cell.key }
    : cell.place === 'ship'
      ? { kind: 'battle', key: cell.key }
      : cell.place === 'graveyard' || cell.place === 'ruins'
        ? { kind: 'salvage', key: cell.key, place: cell.place }
        : cell.place === 'vein'
          ? { kind: 'excavate', key: cell.key }
          : { kind: 'matter', key: cell.key }
  // 矿脉：激活即**铺出原矿堆**（1~3 堆，确定性）；拾取走 `wormholeTakePile`（网格层每堆 1 回合）。
  // ⚠ 残骸打捞（墓场/遗迹）**不在这里铺**：那套要打捞器台数与背包容量（需要 ctx），在 `wormholeSalvage` 里。
  if (effect.kind === 'excavate') wormholeFillVeinPiles(run, grid, cell)
  addLog(
    state,
    'info',
    `🕳 激活地点（${cell.q},${cell.r} · ${atExit ? '下一层入口' : WORMHOLE_PLACE_TEXT[cell.place]}）· 剩 ${run.turnsLeft} 回合。`,
  )
  return { ok: true, spent: WORMHOLE_TURN_PER_ACTIVATE, effect, mustExtract: run.turnsLeft <= 0 }
}

/**
 * **给矿脉格铺原矿堆**（1~3 堆；只铺一次，确定性 = `(本趟种子, 层, 格坐标)`）。
 * 堆本身沿用 `wormholeNodePiles`（虚空母矿、数量随层收益系数），拾取走 `wormholeTakePile`。
 * 为什么放在 `wormhole.ts` 而不是打捞模块：**它不需要 ctx**（原矿堆不认族、不查打捞器），
 * 而 `wormhole.ts` 不许 import 打捞模块（会成环）。
 */
function wormholeFillVeinPiles(run: WormholeRunState, grid: WormholeGridState, cell: WormholeGridCell): void {
  if ((cell.piles ?? []).length > 0) return
  const seed = run.seed ?? run.depth
  const rng = wormholeStream(seed * 97 + run.depth * 577 + (cell.q * 89 + cell.r * 71) * 19)
  const count = 1 + Math.floor(rng() * 3) // 1~3 堆（与打捞模块的 WORMHOLE_VEIN_PILES_* 同值）
  const index = Math.abs(cell.q * 13 + cell.r * 29) % 97
  cell.piles = wormholeNodePiles(seed, run.depth, index, count)
}

/** 地点名（界面与日志共用；**网格地形**用语，与信号名分开） */export const WORMHOLE_PLACE_TEXT: Readonly<Record<WormholePlace, string>> = {
  empty: '空信息地点',
  graveyard: '舰船墓场',
  ruins: '遗迹',
  ship: '舰船信号',
  vein: '矿脉',
  matter: '虫洞谜质',
  beacon: '漂浮信标',
}
/* ═══════════ 六、E 批：入洞 / 拾取 / 背包（界面接线所需的引擎动作） ═══════════ */

/**
 * 每堆原矿的**基准单位数**。
 *
 * ⚠ **待 F 批收益校准**：本批（E）只落"堆 = 一堆原矿、能拾、能进包、超格会被拦"这套**机制**；
 * 具体数量与层收益曲线的乘子以 F 批 `tools/` 校准读数为准再定稿。当前口径 = 基准 × 层收益系数，
 * 故"越深越值钱"的方向与 §4/§5 一致，只是绝对值未定。
 */
export const WORMHOLE_PILE_UNITS_BASE = 200

/**
 * 拾取点里的一堆战利品。
 * ⚠ 口径变更（2026-09-13 船长：「**「虫洞内只掉原矿」删除。残骸能进背包。**」）：
 * 原来这里写的是"虫洞内**只掉原矿**"（2026-09-12 定）；现行 = **原矿 + 残骸**——
 * 墓场/遗迹打捞给残骸（`wreck-wh-*`）与稀有残骸（`wreck-rare-wh-*`），矿脉给虚空母矿；
 * 仍**不掉**制成品、不掉永久图纸、不给 ISK/声望（见设计稿 §11.5）。
 */
export interface WormholePile {
  itemId: string
  units: number
}

/**
 * 生成第 `depth` 层第 `index` 个节点的拾取堆（**确定性**：同 `(seed, depth, index)` ⇒ 同结果）。
 * 数量 = `基准 × 层收益系数 × (0.8~1.2)`（随机项同样来自确定性散列，便于复现与用例）。
 * ⚠ 绝对值待 F 批校准（见 `WORMHOLE_PILE_UNITS_BASE` 注释）。
 */
export function wormholeNodePiles(seed: number, depth: number, index: number, count: number): WormholePile[] {
  const n = Math.max(0, Math.floor(count))
  if (n <= 0) return []
  const mul = wormholeLayerRewardMul(depth)
  const out: WormholePile[] = []
  for (let k = 0; k < n; k++) {
    const h = Math.abs((seed * 1103515245 + (depth * 137 + index * 31 + k * 7) * 7919) % 2147483647)
    const jitter = 0.8 + (h % 41) / 100 // 0.80 ~ 1.20
    out.push({
      itemId: WORMHOLE_ORE_ITEM_ID,
      units: Math.max(1, Math.round(WORMHOLE_PILE_UNITS_BASE * mul * jitter)),
    })
  }
  return out
}

/** 虫洞内唯一的原矿（虚空母矿；`packages/data/src/items.ts`）——由它精炼出虚空晶 */
export const WORMHOLE_ORE_ITEM_ID = 'ore-voidmother'

/** 编队合计货仓（含技能与货舱件加成；与货仓页数字同源 —— 船长 Q6 口径） */
export function wormholeFleetCargoM3(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  let total = 0
  for (const id of shipIds) total += cargoCapacityM3Of(state, ctx, id)
  return total
}

/** 编队的背包格数（`floor(合计货仓 ÷ 500)`）——**现算**（技能/装配一变就跟着变，与货仓页一致） */
export function wormholeBagSlotsOfFleet(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  return wormholeBagSlots(wormholeFleetCargoM3(state, ctx, shipIds))
}

/** 把一堆东西并进背包（同物品并格——一格只装一种物品，故同一 `itemId` 只留一条记录） */
function mergeIntoBag(bag: readonly WormholeBagSlot[], pile: WormholePile): WormholeBagSlot[] {
  const out = bag.map((s) => ({ ...s }))
  const hit = out.find((s) => s.itemId === pile.itemId)
  if (hit) hit.units += pile.units
  else out.push({ itemId: pile.itemId, units: pile.units })
  return out
}

/**
 * **某艘船此刻的忙态**（进洞门槛用；`null` = 空闲）。
 *
 * ⚠ **为什么在 `wormhole.ts` 里重写一份、而不是 import `activity.shipBusyLabel`**（2026-09-13 实测）：
 * `wormhole.ts` 被 `state.ts` 顶层引用，一旦它 import `activity`，就形成
 * `state → wormhole → activity → expedition → state` 的环 —— 而 `expedition.ts` 顶层读
 * `HOME_GALAXY_ID`，首跑即 `Cannot access 'HOME_GALAXY_ID' before initialization`
 * （与 D 批 `wormhole → shipyard → hauling` 同款；两回都真踩到了）。
 * 故这里只读 `state` 上的普通字段，**不 import 任何重模块**。
 *
 * 口径与 `activity.shipBusyLabel` **一致**（那边是"给玩家看的忙态徽标"，判据同一批字段）；
 * 两边的**一致性由用例 `wormhole-entry-gate.test.ts` 钉住**（同一现场两边必须同时"忙/闲"）。
 * 已知差异（有意）：这里**不覆盖** `shipInReturn`（换船善后返航，需 import `mining`）——
 * 那一档由界面侧的 `shipBusyLabel` 拦（准备页按它置灰），core 这层只保底。
 */
export function shipBusyForWormhole(state: GameState, shipId: string): string | null {
  if ((state.wormhole.run?.fleet ?? []).includes(shipId)) return '虫洞探索中'
  return shipActivityBusy(state, shipId)
}

/**
 * **该船此刻手上有别的"活动"吗**（**不含虫洞本身**）——"进洞门槛"与"返回虫洞"共用这一把尺。
 * 口径同 `activity.shipBusyLabel`，差别只在：这里**不**把"在洞里"当忙（返回虫洞时要排除自己）。
 */
export function shipActivityBusy(state: GameState, shipId: string): string | null {
  if (shipId !== state.shipId) {
    const task = state.aiAssignments[shipId]?.task
    if (!task) return null
    // 用词与 `shipBusyLabel` 对齐（玩家在提示里看到的是这一串）
    if (task.kind === 'mining') return 'AI 采矿中'
    if (task.kind === 'standby') return 'AI 掩护巡逻中'
    return 'AI 远征中'
  }
  if (state.mining.active) return '采矿中'
  if (state.sideTasks.deliver !== null) return '快递投送中'
  if (state.standby.active) return '掩护巡逻中'
  if (state.scanning.active) return '扫描探索中'
  if (state.expedition.active) return '远征中'
  return null
}

/**
 * **临时离开虫洞**（关掉虫洞界面；船长 2026-09-13 批准实行）：`attending = false` ⇒
 * **活动停止、主控立刻释放**（可以去做别的），**本趟进度原样保存**
 * （层 / 回合 / 背包 / 待处理节点 / 进行中的战斗都在），且**洞内一切冻结**（见 `advanceWormhole`）。
 */
export function wormholeLeave(state: GameState): void {
  const run = state.wormhole.run
  if (!run) return
  run.attending = false
  run.leftAtGameMs = state.gameMs // 记下离开时刻：回来时按这段时长前移战斗时钟（不然会"补算"成战时间）
}

/**
 * **把一场洞内战斗的时钟整体前移 `deltaMs`**（临时离开期间游戏时间照走，但洞内冻结）：
 * 只动"绝对时刻"字段——`startedAtGameMs` / `lastTickGameMs` / `waveClearAt` / `repair.nextPulseAtMs`；
 * 装填与近防炮冷却是**倒计时**（`weapons: number[]` / `pdCd`），无需处理。
 */
function shiftBattleClock(battle: BattleState, deltaMs: number): void {
  if (!(deltaMs > 0)) return
  battle.startedAtGameMs += deltaMs
  battle.lastTickGameMs += deltaMs
  if (battle.waveClearAt !== undefined) battle.waveClearAt += deltaMs
  const nextPulseAtMs = battle.repair?.nextPulseAtMs
  if (nextPulseAtMs !== undefined) battle.repair!.nextPulseAtMs = nextPulseAtMs + deltaMs
}

/**
 * **返回虫洞**（重新打开虫洞界面）：要求**主控空闲**（船长第四条口径）。
 * 判据只查"别的活动"（`shipActivityBusy`）——**不**把"在洞里"算忙（否则永远回不去）。
 */
export function wormholeResume(state: GameState, ctx: SimContext): WormholeStartResult {
  void ctx
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '现在没有进行中的虫洞探索。' }
  const busy = shipActivityBusy(state, state.shipId)
  if (busy) return { ok: false, error: `主控正在${busy}：先把手上的活收工，才能回到虫洞。` }
  shiftBattleClock(run.battle as BattleState, state.gameMs - (run.leftAtGameMs ?? state.gameMs))
  run.leftAtGameMs = undefined
  run.attending = true
  return { ok: true, run }
}

/**
 * **进洞门槛**（船长 2026-09-13：「进洞要求洞外主控处于闲置状态」）：主控必须闲置
 * （采矿/打捞/交付/扫描/掩护巡逻/远征在飞都不行），编队里每艘船也必须先空闲
 *（正在 AI 派工/已在洞里的船编不进来——否则同一艘船会被两处同时占用）。
 * 返回拒因文案；`null` = 可以进洞。
 */
export function wormholeEntryBlockReason(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): string | null {
  void ctx
  const pilotBusy = shipBusyForWormhole(state, state.shipId)
  if (pilotBusy) return `主控正在${pilotBusy}：先把手上的活收工，才能指挥虫洞探索。`
  for (const uid of shipIds) {
    const busy = shipBusyForWormhole(state, uid)
    if (busy) return `${shipDisplayName(state, ctx, uid)}正在${busy}：先取消它的作业/派工，才能编入虫洞。`
  }
  return null
}

/**
 * **编队的虫洞扫描半径加成（圈）**（2026-09-13 船长：侦察舰/电子舰「让虫洞扫码范围 +1 圈」——
 * 「**编入队伍就有效。且可以叠加**」）⇒ 对编队内每艘船的 `wormholeScanRadiusBonus` **求和**。
 * 用途：① `wormholeEnter` 建档时喂给 `wormholeMakeGrid`；② 界面在**深入下一层**时把它传给
 * `wormholeDescend(run, seed, scanBonus)`（该入参默认 0 ⇒ 不传 = 维持旧行为）。
 */
export function wormholeScanBonusOf(ctx: SimContext, shipIds: readonly string[]): number {
  let sum = 0
  for (const id of shipIds) {
    const def = ctx.ships.get(uidDefId(id))
    const v = def?.wormholeScanRadiusBonus
    if (typeof v === 'number' && Number.isFinite(v)) sum += Math.max(0, Math.floor(v))
  }
  return sum
}

/**
 * **入洞**（界面「进入虫洞」的引擎落点）：校验编队 → 建副本 → 写进存档。
 * `seed` 由调用方给（引擎传 `state.rng.seed`），保证节点/拾取堆可复现。
 */
export function wormholeEnter(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
  seed: number,
): WormholeStartResult {
  if (state.wormhole.run) return { ok: false, error: '已经在虫洞里了：先撤离或结算本趟。' }
  const blocked = wormholeEntryBlockReason(state, ctx, shipIds)
  if (blocked) return { ok: false, error: blocked }
  const r = wormholeStartRun(ctx, shipIds, seed)
  if (!r.ok || !r.run) return r
  r.run.attending = true // 进洞即人在洞里：占着主控，直到临时离开或本趟收场
  state.wormhole.run = r.run
  addLog(
    state,
    'info',
    `🕳 虫洞跃入：编队 ${shipIds.length} 艘 · 折算总质量 ${r.run.totalMass.toLocaleString('zh-CN')} · 可探索 ${r.run.turnsTotal} 回合。`,
  )
  return r
}

/**
 * **拾取一堆**（每堆 = 一堆原矿；进包前先做容量预检，**放不下就不给捡**——不静默丢弃）。
 * ⚠ 回合口径：F3a-2 起"打捞/挖掘"的回合花在**激活地点**那一步（各 1 回合）⇒ **拾取本身不再扣回合**
 * （旧线性节点口径是把"每堆 +1 回合"算进节点 `cost`，在"结算本节点"时一次扣掉；两代口径都不重复计费）。
 * 堆的宿主：网格层 = **当前所在格**（`grid.cells[].piles`）；老档线性层 = `pendingNode.piles`。
 */
export function wormholeTakePile(
  state: GameState,
  ctx: SimContext,
  pileIndex: number,
): { ok: boolean; error?: string; taken?: WormholePile; used?: number; capacity?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  const grid = run.grid
  const holder: { piles?: WormholePile[] } | undefined = grid
    ? gridCellAt(grid, grid.pos)
    : (run.pendingNode ?? undefined)
  const piles = holder?.piles
  if (!piles || pileIndex < 0 || pileIndex >= piles.length) {
    return { ok: false, error: '这里没有可拾取的东西。' }
  }
  const pile = piles[pileIndex]!
  // **网格层：手拾一堆 = 1 回合**（船长口径第 13 条「每捡一堆 +1」；老档线性层的回合已算在节点 cost 里，
  // 不重复扣）。回合不够 ⇒ 当场拒绝、**不扣**（与其它层内动作同一把尺）。
  if (grid) {
    if (run.turnsLeft < WORMHOLE_TURN_PER_PICK) return { ok: false, error: '回合不足：只能撤离。' }
  }
  const capacity = wormholeBagSlotsOfFleet(state, ctx, run.fleet)
  const merged = mergeIntoBag(run.bag, pile)
  const usage = wormholeBagUsage(ctx, merged, capacity)
  if (usage.overflow) {
    return { ok: false, error: `背包放不下：已占 ${usage.used} / 共 ${capacity} 格。` }
  }
  run.bag = merged
  piles.splice(pileIndex, 1)
  if (grid) run.turnsLeft -= WORMHOLE_TURN_PER_PICK
  const name = ctx.items.get(pile.itemId)?.name ?? pile.itemId
  addLog(state, 'info', `🕳 拾取：${name} ×${pile.units}（背包 ${usage.used}/${capacity} 格）。`)
  return { ok: true, taken: pile, used: usage.used, capacity }
}

/**
 * ⚠ **施工期调试用**：放弃本趟探索（背包内容一并作废、`run` 清空）。
 * 正式路径（撤离成功结算 / 全损 / 回合耗尽）在 **F 批**实现；本函数只为"施工期不被卡在洞里"而存在，
 * 拍板前不应出现在玩家可及路径上（入口本身在调试开关后面）。
 */
export function wormholeDebugReset(state: GameState): void {
  state.wormhole.run = null
}

