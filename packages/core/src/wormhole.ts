/**
 * **终局玩法「虫洞」（搜打撤底层）· 数值与入场口径单点**（2026-09-12 设计稿 · 2026-09-13 开工）。
 *
 * 设计稿：`docs/design/wormhole-extraction-endgame-20260912.md`（§4 质量压塌与回合预算 · §5 背包与战利品）。
 *
 * ✅ **可见性（船长 2026-09-14 解除不可见）**：虫洞**已对玩家开放** —— 玩家入口 = 星图「扫描虫洞」选项卡
 * （常显 · 协会声望 40 解锁）；数据侧的 `unreleased` 闸门与施工期的调试入口同批撤除。
 * 施工期铁律「完成前对玩家不可见」（2026-09-13）**作废留档**，原文见
 * `docs/design/wormhole-extraction-endgame-20260912.md` §「可见性与拍板」。
 *
 * 本模块**只放纯逻辑**（数值换算与校验），不持状态、不碰存档；副本状态机在 C 批另开。
 */
import type { GameState, BattleState, WormholeArchetype, WormholeFamily } from './state'
import { addLog, haulingHalt, miningHalt, salvageHalt, wormholeScanHalt } from './state'
import type { AnomalyDef, ShipDef, SimContext } from './types'
import { uidDefId } from './labels'
import { cargoCapacityM3Of } from './inventory'
import { shipDisplayName } from './instances'
import {
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeFamilyOfSeed,
} from './wormholeFoes'
import type { WormholeFoeKind } from './wormholeFoes'
import { wormholeArchetypeOf } from './wormholeGrid'
import {
  WORMHOLE_NEBULA_MIN_DEPTH,
  WORMHOLE_TURN_PER_ACTIVATE,
  WORMHOLE_TURN_PER_MOVE,
  WORMHOLE_TURN_PER_SCAN,
  wormholeRng,
  wormholeStream,
  disperseNebulae,
  gridCellAt,
  gridNebulaDisperseTargets,
  gridScanTargets,
  hexKey,
  isExitCell,
  isNebulaFogged,
  signalOfPlace,
  wormholeMakeGrid,
} from './wormholeGrid'
import type { HexCell, WormholeGridCell, WormholeGridState, WormholePlace, WormholeSignal } from './wormholeGrid'
// F3c 谜质：装置效果一律从货仓**现算**（扫描半径 / 额外驱散星云走这里；回合类走 `wormholeSyncMatterTurns`）
import { wormholeMatterBuffs } from './wormholeMatter'

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

/* ═══════════ 二、回合预算（船长 2026-09-12 定：基础 55 · 系数 0.53；2026-09-14 基础 → 60；2026-09-15 基础 → 100） ═══════════ */

/**
 * 回合公式常数（船长定值）：`floor(基础 × (1 − 总质量 ÷ 上限 × 系数))`。
 *
 * 沿革（两次都是改基础、系数 0.53 一律不动）：
 * - 2026-09-12 定：基础 **55** · 系数 0.53；
 * - ⚠ **2026-09-14 船长：「虫洞基础回合数提高到60回合」** ⇒ 基础 **55 → 60**；
 * - ⚠ **2026-09-15 船长：「虫洞基础回合数提高到100」** ⇒ 基础 **60 → 100**（现行）。
 *
 * 现行连带读数（同表逐格复算，见设计稿 §4.3）：4×T1 **56→93** · 3×T1+1×T2 **54→90** ·
 * 4×T2 **48→80** · 2×T3+2×T2 **40→66** · 3×T3+1×T1 **38→63** · **4×T3 32→53** ·
 * 2×T4 32→**53** · 2×T4+1×T2 **29→48**；空载 60→**100** · 满载 28→**47**。
 * **轻编队多 37 回合、最重可行编成多 19 回合**（越重吃到的绝对增量越小，因为增量 = 40 × 剩余系数）；
 * 轻重差幅 1.93 倍 → **1.94 倍** ⇒「越重时间越短」的强度不变。
 * 谜质「时序核心」仍 **+10 回合/台**（其相对价值由 4×T3 的 31.3% 降到 18.9%，属已登记的连带）。
 */
export const WORMHOLE_TURN_BASE = 100
export const WORMHOLE_TURN_MASS_COEF = 0.53

/**
 * **总质量 → 可探索回合数**（越重、时间越短）：
 * `floor(100 × (1 − 总质量 ÷ 16,000 × 0.53))`（基础沿革 55 → 60（2026-09-14）→ **100**（2026-09-15））。
 * 设计稿 §4.3 的实测表逐格复现（4×T1 = 93 … 2×T4+1×T2 = 48）。
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
 * 副本相位：`idle` 未在洞里（含未出发与已结算）· `inside` 洞里（节点推进中）·
 * `extracting` **已发起撤离、下一拍结算**（⚠ 2026-09-15 起**不再有撤离战**，见 `wormholeExtract`；
 * 相位值本身保留——存档里存过它，老档要能读，且撤离战已判负的老档还要走收口）。
 *
 * ⚠ 两条硬约束（船长裁定）：
 * 1. **战斗没结束不能撤** ⇒ `wormholeExtract` 在 `run.battle` 非空时被拒；
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
  /**
   * **本趟锁定的敌族**（船长 2026-09-14 定案 · 丁）：进洞时从库存项带进来；老档/调试入口没有
   * ⇒ 按 `run.seed` 现算（`wormholeFamilyOfSeed`）⇒ **零迁移**。整趟所有格都用该族的敌卡。
   */
  family?: WormholeFamily
  /** 本趟的内容原型（丙 · 界面读数与结算用；同样可选 ⇒ 按 `run.seed` 现算） */
  archetype?: WormholeArchetype
  /** 本层已推进到第几个节点（0 起） */
  nodeIndex: number
  /** 剩余回合 */
  turnsLeft: number
  /** 出发时锁定的回合预算（读数用）。**谜质「时序核心」的加成不写在这里**（它现算，见 `turnsBase`） */
  turnsTotal: number
  /**
   * **入场时的回合预算**（F3c · 船长 2026-09-13 裁定「实时派生 + 夹紧」）：
   * 本趟上限 = `turnsBase + 10 × 货仓里的时序核心台数`，由 `wormholeSyncMatterTurns` **幂等**同步；
   * 老档没有这个字段 ⇒ 首次同步按"现有台数"反推（老档本来没有装置 ⇒ 等于 `turnsTotal`），**零迁移**。
   */
  turnsBase?: number
  /**
   * **遗迹守备已被惊动、等玩家确认迎战**（F3c 界面批 · 船长 2026-09-13：战斗不该毫无提示地突然发生，
   * 要先提示玩家惊扰了守卫、玩家确认后再跳转）。为真时**别的动作一律被拦**（见 gridActionBlocked），
   * 直到玩家点「迎战」（wormholeStartBattle('ruins') 成功即清）。可选字段 ⇒ 老档零迁移。
   */
  pendingRuinsBattle?: boolean
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
   * ⚠ **F4 起被「遗迹安全货柜」取代**（船长 2026-09-13：装备与图纸走中间件、占 4 格货仓）——
   * 本字段保留为旧档兼容读入口，新趟不再写入。
   */
  relics?: string[]
  /**
   * **货仓格状态**（F4 · 船长 2026-09-13：货仓直接代表背包大小 + 类似背包英雄的格管理）。
   * 只装**占形状的件**（遗迹安全货柜 2×2 = 4 格）；可叠加散货仍走 `bag`。
   * 可用格数**不在这里**（= ⌊编队合计货仓 ÷ 500⌋ 现算 ⇒ 沉船后自动变小 ⇒ 超载）。
   * 可选字段（老档没有 ⇒ 该趟只有散货，零迁移）。
   */
  hold?: import('./wormholeHold').WormholeHoldState
  /**
   * **临时空间（待整理区 · 老档只读字段）**（船长 2026-09-13：「**打捞出了大件货时应该放进一个临时空间
   * 或者临时背包，让玩家进行协调**」）。
   *
   * ⚠ **2026-09-14 起被 `tempGrid` 取代**（船长：「背包格宽度是 8 格，那么可以在背包格右边添加一个用于丢弃和
   * 调整位置的『小背包』…正式名：临时空间」）：临时空间从"**一种物品一条的列表**"改成
   * **4 列 × 8 行 = 32 格的格子区**（挂在货仓 8 列右侧），因此账本从本字段迁到 `tempGrid`。
   * 本字段**保留为老档读入口**：读档后由 `wormholeNormalizeLegacyTemp` 一次性换算进 `tempGrid`，新档不再写入。
   */
  temp?: WormholeTempSlot[]
  /**
   * **临时空间的格子账本**（船长 2026-09-14 定案）。
   *
   * 口径：
   * - **4 列 × 8 行 = 32 格**（`WORMHOLE_TEMP_COLS` / `WORMHOLE_TEMP_ROWS`），与 `hold` **同一个类型**
   *   （`WormholeHoldState`）⇒ 格几何 / 拖拽落位 / 整理 / 不重叠判据**全部复用 `wormholeHold`**；
   * - **不占货仓容量、不算超载**（与旧口径一致）：它是缓冲不是仓位；超载时也能用它腾位置；
   * - **能放形状件**（安全货柜 / 谜质储存器 2×2）**与散货件**（1×1）；
   * - **离开背包页前必须清空**（船长 2026-09-14：「强制二选一：丢掉 或 放回」，撤离前同样必须先清空）；
   * - **谜质储存器放进来即失效**（船长 2026-09-14：「谜质储存器拖进小背包会失效」）——增益仍只从
   *   `run.hold` 现算（`wormholeMatterBuffs(run.hold)`），本账本不参与派生；
   * - 可选字段 ⇒ **零迁移**（老档没有 = 临时空间是空的）。
   */
  tempGrid?: import('./wormholeHold').WormholeHoldState
}

/** 临时空间里的一条（**老档只读**：`tempGrid` 之前的口径 = 一种物品一条） */
export interface WormholeTempSlot {
  itemId: string
  units: number
}

/** **临时空间的列数**（船长 2026-09-14：4 列） */
export const WORMHOLE_TEMP_COLS = 4
/** **临时空间的行数**（船长 2026-09-14：8 行 ⇒ 与货仓 8 列并排等高） */
export const WORMHOLE_TEMP_ROWS = 8
/** **临时空间的格数上限** = 4 × 8 = **32 格**（船长 2026-09-14 裁定；旧口径是 8 格列表） */
export const WORMHOLE_TEMP_CELLS = WORMHOLE_TEMP_COLS * WORMHOLE_TEMP_ROWS

/**
 * **一趟的结算单**（2026-09-13 船长：「玩家撤离后弹出一个结算界面，表示玩家的收益和损失」）。
 *
 * 由 `wormholeBattle` 在收口那一刻写进 `state.wormhole.lastSettle`；界面读它弹结算层，
 * 玩家点「确认」后由 `wormholeAckSettle`（引擎侧）清掉 ⇒ **不会重复弹**。
 * ⚠ 可选字段 ⇒ **零迁移**（老档没有 = 没弹过结算）。
 */
export interface WormholeSettleRecord {
  /** 结束方式：撤离成功 / 全损 */
  kind: 'extract' | 'lost'
  /** 撤离（或全损）时所在的层 */
  depth: number
  /** 到手：母矿单位数 / 母矿基础价 ISK / 残骸拆解估值 ISK */
  oreUnits: number
  oreIsk: number
  wreckIsk: number
  /** 到手的货柜（内容物待拆解；只报件数与名称） */
  boxes: string[]
  /** 到手的随行战利品（装备 / 一次性图纸 / 无人机，显示名） */
  relics: string[]
  /**
   * **本趟带回的 AI 核心**（2026-09-14 船长定：结算单另加一格「AI 核心 N 枚」）。
   * 形如 `{ gamma: 1, beta: 2 }`（键 = 核心账本的 `gamma/beta/alpha`）；缺省 = 没捞到。
   * ⚠ 与 `boxes`/`relics` 不同：核心**不进仓库**，撤离成功那一刻直接入 `state.aiCores`。
   */
  cores?: Partial<Record<'gamma' | 'beta' | 'alpha', number>>
  /**
   * 本趟带回核心的**行价参考估值**（信用点；= Σ 枚数 × 市场卡行价，唯一出处 `marketCatalog.ts`）。
   * 只作参考、**不计入结算单的「到手合计」**——核心是账本资源（不拆解），并进去会让"合计"口径变浑。
   */
  coresIsk?: number
  /**
   * **本趟析出的虫洞谜质**（枚；2026-09-15 船长定：「谜质在虫洞结束时不再删除，而是转化成
   * 虫洞谜质存入仓库」）。撤离成功时按 **1 台谜质装置 = 1 枚**折算、直接进仓库；全损 = 没这回事。
   * 只收不卖 ⇒ **不计入「到手合计」**（与 `cores` 同理，单独给行价参考）。
   */
  essences?: number
  /** 析出谜质的**行价参考估值**（信用点；= 枚数 × 市场卡行价，唯一出处 `marketCatalog.ts`） */
  essenceIsk?: number
  /** 损失：本趟沉掉的船（显示名） */
  shipsLost: string[]
  /** **没带回来的收集额**（按基础价 + 拆解估值算；撤离成功 = 0） */
  lostIsk: number
  /**
   * ⚠ **退役字段（2026-09-15 撤离战取消）**：旧口径里「第 1 层免撤离战」时为 true，界面据此少写一句
   * "打了一场"。如今**撤离一律不触发战斗** ⇒ 新结算单**不再写**它；字段保留只为读得懂老档的结算单。
   */
  skippedExtractBattle?: boolean
}

export interface WormholeState {
  /** 进行中的一趟（null = 不在洞里） */
  run: WormholeRunState | null
  /** 本趟累计：损失船数（结算读数用） */
  lastFleetLost: number
  /** **最近一趟的结算单**（界面弹层用；玩家确认后清掉） */
  lastSettle?: WormholeSettleRecord
  /**
   * **星云机制的一次性提示是否已经给过**（船长 2026-09-13：「这个机制在玩家第一次下到四层时提示玩家」）。
   *
   * 为什么随档：**"第一次"是跨趟的**——玩家第一趟下到层 4 看过提示后，第二趟不该再被念一遍。
   * 可选字段（老档没有 = 还没提示过；若他此刻正停在层 4+，下一次深入会补上一次性事件，不影响存档）。
   */
  nebulaHintShown?: boolean
}

/** ⚠ **已删除（2026-09-15）**：`WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH = 2`——撤离战整条退役，不再有"第几层起要打"。 */

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
  // 层末守卫的选靶倾向概率（船长 2026-09-14「挨个定为 60%」）
  WORMHOLE_BOSS_TARGETING_CHANCE,
  WORMHOLE_EXTRACT_THREAT_BASE,
  WORMHOLE_EXTRACT_THREAT_PER_LAYER,
  WORMHOLE_FOE_CARD_IDS,
  wormholeLayerThreat,
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeFoeThreat,
  wormholeExtractThreat,
  // 族锁定（丁 · 船长 2026-09-14 定案：一处虫洞一族、整趟同族）
  wormholeCardIdOfFamily,
  wormholeFamilyOfSeed,
  WORMHOLE_FAMILY_ORDER,
  WORMHOLE_FAMILY_CARD,
  WORMHOLE_FAMILY_GLYPH,
  wormholeAnomalyOf,
  wormholeNaturalHp,
  // 一族三档 + 出场池 + 分层血量修正（船长 2026-09-15）
  wormholeCardIdForRun,
  wormholeCardOfTier,
  wormholeTierOfCard,
  wormholeAllCardIds,
  wormholeCardPoolAt,
  wormholeGuardCardOf,
  wormholeTierWeightsAt,
  WORMHOLE_FAMILY_CARDS,
  WORMHOLE_CARD_TIERS,
  WORMHOLE_TIER_LABEL,
  WORMHOLE_TIER_UNLOCK_DEPTH,
  WORMHOLE_TIER_HP_MUL,
  // 族定选靶（船长 2026-09-15「选靶按照族限定」）
  WORMHOLE_FAMILY_TARGETING,
  WORMHOLE_FAMILY_TARGETING_CHANCE,
  // 玩家可见威胁的显示倍率（船长 2026-09-15「面板威胁乘以2」；只影响界面读数）
  WORMHOLE_DISPLAY_THREAT_MUL,
  wormholeDisplayThreat,
} from './wormholeFoes'
export type { WormholeCardTier, WormholeFoeKind } from './wormholeFoes'

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
  /**
   * **空地点占比系数**（事件玄学：满级 0.8 ⇒ 相对 −20%）。缺省 1 = 旧行为
   * ——本函数拿不到 `state`（测试与工具直接用它建盘），故由调用方（`wormholeEnter`）传 `blankShareFactorOf(state)`。
   */
  blankShareFactor = 1,
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
      turnsBase: adm.turnBudget,
      fleet: [...shipIds],
      totalMass: adm.totalMass,
      bag: [],
      // F3a-2：层内内容**全部**由网格承载（`grid`）；`pendingNode` 是旧线性节点口径的遗留字段，
      // 新开趟一律为 `null`（老档里已有的 pendingNode 仍能被 `wormholeAdvanceNode` 走完，见该函数注释）。
      pendingNode: null,
      nodesPerLayer: wormholeNodesPerLayer(depth),
      grid: wormholeMakeGrid(rngSeed, depth, wormholeScanBonusOf(ctx, shipIds), blankShareFactor),
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

/**
 * 深入下一层（**只在层末可用**；回合耗尽时拒绝——只能撤离）。
 *
 * ⚠ **入参从 `run` 改成 `state`**（2026-09-13 星云批）：星云机制要求"**第一次下到层 4 时提示玩家**"，
 * 而那条提示要写进 `state`（一次性事件 + `wormhole.nebulaHintShown`）⇒ 只收 `run` 是写不了的。
 * 调用方（引擎 / 校准工具）本来就手里有 `state`，改动是把 `state.wormhole.run` 传进去即可。
 */
export function wormholeDescend(
  state: GameState,
  rngSeed: number,
  scanBonus = 0,
): WormholeAdvanceResult {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '当前不在虫洞里。' }
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
  run.grid = wormholeMakeGrid(rngSeed, run.depth, scanBonus, blankShareFactorOf(state))
  maybeHintNebula(state, run.depth)
  return { ok: true, spent: 0, atLayerEnd: false }
}

/**
 * 本趟是否已经给过星云提示（**只防同一次会话内重复**；跨会话/跨趟靠 `nebulaHintShown` 随档）。
 * 用 `WeakSet` 挂在 run 对象上：不落档、不新增字段、不改存档结构。
 */
const nebulaHintedRuns = new WeakSet<object>()

/**
 * **星云机制的一次性提示**（船长 2026-09-13：「这个机制在玩家第一次下到四层时提示玩家」
 * ＋「⑤除了一次性事件，**通讯内也发一条相关的讯息给玩家**」）。
 *
 * 三条一起落：
 * - `state.nebulaHintNotice`：**不落档**的一次性事件 ⇒ 渲染层读取即清并提示（与机群战损同款通道）；
 * - **通讯一条讯息** `wormhole-nebula`：由 `data/comms.ts` 的常驻剧本按 `nebulaHintShown` 送达；
 * - `state.wormhole.nebulaHintShown = true`：**随档**，保证跨趟只提示一次。
 */
function maybeHintNebula(state: GameState, depth: number): void {
  if (depth < WORMHOLE_NEBULA_MIN_DEPTH) return
  const run = state.wormhole.run
  if (run && nebulaHintedRuns.has(run)) return
  if (run) nebulaHintedRuns.add(run)
  if (state.wormhole.nebulaHintShown === true) return
  state.wormhole.nebulaHintShown = true
  state.nebulaHintNotice =
    '这一带的星云会遮蔽地点的信号：第一次扫描只能看到"有星云"，' +
    '在同一个位置再扫描一次就能把星云驱散、读出信号。'
  addLog(
    state,
    'info',
    '🕳 前方出现星云带：星云会遮蔽地点的信号——第一次扫描只看到云，' +
      '再扫描一次（同一圈内）即可驱散并读出信号。',
  )
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
 * 撤离 —— **无条件可以开始，且不再有撤离战**（2026-09-15 船长：「**虫洞的撤离战取消吧**」）。
 *
 * 现行口径：
 * - **零战斗零风险**：进入 `extracting` 相位后，`advanceWormhole` **下一拍直接结算入港**
 *   （散货 + 随行战利品 + 货柜 + 临时空间全数带回），不再开任何战斗；
 * - **任意层、任意时候**都能撤（第 1 层与深层同待遇）；**不消耗回合**；
 * - 唯一保留的门：**进行中的战斗不能撤**（船长裁定「战斗没结束不能撤」，2026-09-15 复核后**维持不动**）。
 *
 * ⚠ 被本裁定取代的旧条款（2026-09-13「玩家可以无条件开始撤离，但是**依旧需要打撤离战**」＋
 * 「撤离战只从第二层开始生效」＋「撤离战打不赢 = 全损」）**已作废**：`WORMHOLE_EXTRACT_BATTLE_MIN_DEPTH`
 * 已删除、撤离威胁曲线（层 2 = 42、每层 +7）与谜质「撤离掩护器」一并退役；设计稿/词典同日条目标注沿革。
 *
 * ⚠ 老档兼容：存档里**正在打的撤离战**照打完（`advanceWormhole` 的 `run.battle` 分支在前，天然满足），
 * 打完按新口径结算（赢了入港、输了全损），此后不再有下一场。
 */
export function wormholeExtract(run: WormholeRunState): WormholeAdvanceResult {
  if (run.battle) return { ok: false, error: '战斗中：战斗没结束不能撤退。' }
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
  /** **本次驱散掉的星云格键**（扫描；船长 2026-09-13 星云机制） */
  dispersed?: string[]
  /** **本次新揭开、但被星云遮住的格数**（扫描；界面据此提示"再扫一次可驱散"） */
  newlyFogged?: number
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
  if (run.battle) return '战斗中：先打完这一场。'
  // **遗迹守备已惊动**：先迎战（船长 2026-09-13：不要让战斗毫无提示地突然发生）
  if (run.pendingRuinsBattle === true) return '遗迹深处的守备已经惊动：先点「迎战」打完这一场。'
  /**
   * **临时空间里还有东西**（船长 2026-09-14：「临时空间内有物品就不允许进行其他操作，
   * 和之前的超载类似」）：扫描也一并拦下 —— 玩家得先去背包页把它**放回货仓**或**丢弃**。
   * ⚠ 这里只读 `tempGrid`（不需要 ctx）；超载那一条由 `wormholeSalvage.wormholeActionBlockReason`
   * 在打捞/采集/开战/拾取/撤离/深入各口把守（`wormhole.ts` 不能反向依赖它，模块方向见文件头）。
   */
  const pending = run.tempGrid?.placements.length ?? 0
  if (pending > 0) {
    return `临时空间里有 ${pending} 件没处理：先到「货仓」页放回货仓或丢弃，再继续。`
  }
  return null
}

/**
 * **扫描**（1 回合）：揭开"当前格 + 扫描半径内"还没扫过的格，**并把圈里已扫描的星云驱散**。
 *
 * 拒绝口径（都不扣回合）：**既没有新格可揭、也没有星云可驱散** ⇒ 「换个地点再扫」。
 *
 * ⚠ **星云为什么要"再扫一次"**（船长 2026-09-13）：「玩家第一次扫描出一个地点时，有星云的地点，
 * 星云会遮挡该地点的信号。需要玩家再扫描一次才能驱散星云」⇒
 * 第一次扫描**只发现"这儿有星云"**（`revealOf` 给 `{ kind: 'nebula' }`），
 * 第二次扫描（同圈内）才驱散、信号才可读。这就是这条机制的**回合税**：深层每层多花 N 个回合。
 */
export function wormholeGridScan(state: GameState): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法扫描。' }
  const { run, grid } = hit
  const blocked = gridActionBlocked(run)
  if (blocked) return { ok: false, error: blocked }
  /**
   * **谜质增益**（F3c · 船长 2026-09-13）：扫描半径 +圈、每次额外驱散若干格星云。
   * 一律**现算**（装置躺在货仓里就生效，不必再同步状态）。
   */
  const buffs = wormholeMatterBuffs(run.hold)
  const targets = gridScanTargets(grid, buffs.scanRadius)
  // 圈里"已扫描但还被星云罩着"的格 ⇒ 这一扫把它们驱散；装置再额外补几格圈外的云
  const nebulaTargets = gridNebulaDisperseTargets(grid, buffs.scanRadius, buffs.nebulaDisperse)
  if (targets.length === 0 && nebulaTargets.length === 0) {
    return { ok: false, error: '周围都扫过了、也没有星云可驱散：换个地点再扫。' }
  }
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
  const dispersed = disperseNebulae(grid, nebulaTargets)
  const empty = revealed.filter((r) => r.signal === null).length
  /**
   * 新揭开的格里**有几格被星云遮住**（= 刚扫出来、但信号还看不到的那些）——
   * 单独报出来，玩家才知道"这次扫到的东西被云挡着"，而不是以为扫描失灵。
   */
  const newlyFogged = grid.cells.filter(
    (c) => revealed.some((r) => r.key === c.key) && isNebulaFogged(grid, c),
  ).length
  addLog(
    state,
    'info',
    `🕳 扫描（半径 ${grid.scanRadius + buffs.scanRadius}）：揭开 ${revealed.length} 格` +
      (empty > 0 ? `（其中 ${empty} 格没有信号）` : '') +
      (newlyFogged > 0 ? ` · ${newlyFogged} 格被星云遮住（再扫描一次可驱散）` : '') +
      (dispersed.length > 0 ? ` · 驱散星云 ${dispersed.length} 格` : '') +
      ` · 剩 ${run.turnsLeft} 回合。`,
  )
  return {
    ok: true,
    spent: WORMHOLE_TURN_PER_SCAN,
    revealed,
    dispersed,
    newlyFogged,
    mustExtract: run.turnsLeft <= 0,
  }
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
  if (beacon) {
    grid.exitKnown = true
    /**
     * **信标标出终点 ⇒ 终点格一并记为"已知"**（船长 2026-09-13：出口格"未扫描"那条按推荐修）。
     *
     * 为什么：出口格不参与信号分配 ⇒ 它永远不在 `scanned` 里；原先玩家从信标得知终点位置后，
     * 点它前往仍会撞上「这个地点还没扫描过：前往未知地点？」的确认框 —— 那句话在此时是**误导**
     * （它不是未知地点，它是终点）。这里把出口格并入 `scanned`，前往它就走正常路径。
     * ⚠ 只在**读到信标之后**才并：在那之前玩家不该"凭空知道"出口格是安全可去的。
     */
    const exitKey = hexKey(grid.exit.q, grid.exit.r)
    if (!grid.scanned.includes(exitKey)) grid.scanned.push(exitKey)
  }
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
  /**
   * **资源点与墓场/遗迹不用激活**（船长 2026-09-13：「资源点和墓场遗迹改为不用激活」）：
   * 走到那一格就铺好产出（`wormholeEnsureArrivalPiles`），玩家直接**采集/打捞**——
   * 故这三个地点在"激活"这条路上**直接拒绝**，免得白扣一回合。
   */
  if (!atExit && (cell.place === 'vein' || cell.place === 'graveyard' || cell.place === 'ruins')) {
    return { ok: false, error: '这个地点不用激活：直接采集/打捞就行。' }
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
      : { kind: 'matter', key: cell.key }
  // ⚠ 产出的铺放已全部改到**到达那一刻**（`wormholeSalvage.wormholeEnsureArrivalPiles`，船长 F5：资源点/墓场遗迹不用激活）
  addLog(
    state,
    'info',
    `🕳 激活地点（${cell.q},${cell.r} · ${atExit ? '下一层入口' : WORMHOLE_PLACE_TEXT[cell.place]}）· 剩 ${run.turnsLeft} 回合。`,
  )
  return { ok: true, spent: WORMHOLE_TURN_PER_ACTIVATE, effect, mustExtract: run.turnsLeft <= 0 }
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
/**
 * **把一堆并进背包**（同类并格、否则新增一条；**纯函数**，不判容量、不扣回合、不写日志）。
 *
 * ⚠ 这是全仓**唯一**的"合并"实现：虫洞侧所有"把东西搬上船"的路径（打捞 / 采集 / 舰船战果 /
 * 老档线性层的逐堆拾取）都走它，只是各自的**容量判据与回合口径**由调用方负责
 * （`wormholeSalvage.tryMergeIntoBag` = F5 网格判据 + 放不下整条回滚）。
 */
export function mergeIntoBag(bag: readonly WormholeBagSlot[], pile: WormholePile): WormholeBagSlot[] {
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
 *
 * ⚠ **2026-09-14 补齐五档**（船长报障：「进入虫洞时必须无活动。好像失效了？」）：原实现只认
 * 采矿 / 快递 / 巡逻 / 扫描星系 / 远征，**漏了后来上线的四个活动** —— **打捞**（`state.salvaging`）、
 * **长途运输**（`state.hauling`）、**扫描虫洞**（`state.wormholeScan`）与**亲自主持的炉线**
 * （`refineRuns` / `manufacturingRuns` 里 `worker === 'pilot'` 且 `active`）⇒ 那些活动在跑时主控照样能进洞。
 * 由 `tests/wormhole-activity-lock.test.ts` 逐档钉住（含与 `shipBusyLabel` 的一致性）。
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
  if (state.salvaging.active) return '打捞中'
  if (state.hauling.active) return '长途运输中'
  if (state.sideTasks.deliver !== null) return '快递投送中'
  if (state.standby.active) return '掩护巡逻中'
  if (state.wormholeScan?.active === true) return '扫描虫洞中'
  if (state.expedition.active) return '远征中'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开炉精炼中'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开线制造中'
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
 *
 * ⚠ **形参允许空**（2026-09-14 线上事故：`run.battle` 在"洞外/没有战斗"时是 `null`，
 * 调用点当时写了 `run.battle as BattleState` 把类型断言骗过去 ⇒ 玩家「临时离开 →（时间前进）→ 返回虫洞」
 * 时这里抛 `TypeError: Cannot read properties of undefined (reading 'startedAtGameMs')`，
 * 面板整块不渲染 = 玩家看到的"返回虫洞黑屏"）。**没有战斗就直接返回**，别再用 `as` 断言蒙类型系统。
 */
function shiftBattleClock(battle: BattleState | null | undefined, deltaMs: number): void {
  if (!battle) return
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
  shiftBattleClock(run.battle, state.gameMs - (run.leftAtGameMs ?? state.gameMs))
  run.leftAtGameMs = undefined
  run.attending = true
  return { ok: true, run }
}

/**
 * **进洞时会"自动停掉"的活动**（船长 2026-09-14：「**进洞自动停止**」＋「『进洞会自动停掉的那一项活动』
 * **同样落实到采矿/打捞**」＋「**长途运输发出警告**」）。
 *
 * 四项都是"主控亲自在跑"的作业：停法与玩家手点活动栏里的「停止」**完全同一条路径**（状态改动走 `state.ts`
 * 的单点 `wormholeScanHalt` / `miningHalt` / `salvageHalt` / `haulingHalt`），日志照写 ⇒ **不新增损失**
 * （扫描进度保留；开采/打捞未返航的货留在船上；长途运输"终止即瞬时返港停靠出发站、无惩罚"）。
 *
 * `warn: true` = 停它**有可见后果**（长途运输会中止本段航程、船被挪回出发站）⇒ 准备页要**发警告**，
 * 不能只当"顺手停一下"。
 *
 * **远征不在名单里**（船长 2026-09-14：「**远征无法自动停**」）：它是多阶段活动（出航/交火/返航 + 战斗锚点），
 * 没有"无损停掉"的路径 ⇒ **照旧拦住进洞**（人在洞里时也照旧开不了）。其余活动（扫描星系 / 掩护巡逻 /
 * 快递投送 / 亲自开炉开线）同理照旧拦住。
 */
export interface WormholeEntryAutoStop {
  /** 判据键（界面/日志用；与 `shipActivityBusy` 的忙态文案一一对应） */
  kind: 'whscan' | 'mining' | 'salvage' | 'hauling'
  /** 忙态文案（`shipActivityBusy` 报的就是它） */
  label: string
  /** 日志/界面里用的短名（「扫描虫洞」「开采」「打捞」「长途运输」） */
  name: string
  /** 停它有没有可见后果（true ⇒ 准备页发**警告**，而不是轻描淡写地"预告"） */
  warn: boolean
}

/** 当前**会被进洞自动停掉**的活动（可能不止一项：作业之间本应互斥，这里按顺序全收，坏档也不会漏停） */
export function wormholeEntryAutoStops(state: GameState): WormholeEntryAutoStop[] {
  const out: WormholeEntryAutoStop[] = []
  if (state.wormholeScan?.active === true) out.push({ kind: 'whscan', label: '扫描虫洞中', name: '扫描虫洞', warn: false })
  if (state.mining.active === true) out.push({ kind: 'mining', label: '采矿中', name: '开采', warn: false })
  if (state.salvaging.active === true) out.push({ kind: 'salvage', label: '打捞中', name: '打捞', warn: false })
  /** 长途运输：船会被挪回出发站（有可见后果）⇒ `warn`（船长 2026-09-14：「长途运输发出警告」） */
  if (state.hauling.active === true) out.push({ kind: 'hauling', label: '长途运输中', name: '长途运输', warn: true })
  return out
}

/** 进洞会自动停掉的忙态文案集合（门槛/舰船卡据此放行；空集 = 没有） */
function wormholeEntryAutoStopLabels(state: GameState): Set<string> {
  return new Set(wormholeEntryAutoStops(state).map((a) => a.label))
}

/**
 * **进洞门槛的"逐船忙态"**（门槛与界面的舰船卡共用这一把尺）：
 * 除了**主控那一档会自动停掉的活动**（见 `wormholeEntryAutoStops`）之外，其余一律照 `shipBusyForWormhole` 报忙。
 */
export function wormholeShipEntryBusy(state: GameState, shipId: string): string | null {
  const busy = shipBusyForWormhole(state, shipId)
  if (busy && shipId === state.shipId && wormholeEntryAutoStopLabels(state).has(busy)) return null
  return busy
}

/**
 * **进洞门槛**（船长 2026-09-13：「进洞要求洞外主控处于闲置状态」）：主控必须闲置
 * （采矿/打捞/交付/扫描/掩护巡逻/远征在飞都不行），编队里每艘船也必须先空闲
 *（正在 AI 派工/已在洞里的船编不进来——否则同一艘船会被两处同时占用）。
 *
 * ⚠ **2026-09-14 例外**：扫描虫洞 / 开采 / 打捞三项不再算拦（进洞那一步会**自动停掉**，见 `wormholeEntryAutoStops`）。
 * 返回拒因文案；`null` = 可以进洞。
 */
export function wormholeEntryBlockReason(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): string | null {
  void ctx
  const pilotBusy = wormholeShipEntryBusy(state, state.shipId)
  if (pilotBusy) return `主控正在${pilotBusy}：先把手上的活收工，才能指挥虫洞探索。`
  for (const uid of shipIds) {
    const busy = wormholeShipEntryBusy(state, uid)
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
 * **事件玄学（`event-dividend`）· 虫洞空白地点占比的每级系数**（船长 2026-09-14：
 * 「效果添加：降低虫洞内出现空白地点的几率，满级为20%」；四问四答定口径「**相对削减**」）。
 * 线性每级 −4%（rank 5 ⇒ 满级恰 −20%）。本常量与 `packages/data/src/skills.ts` 的技能说明**同源**，
 * 改这里必须同步说明（`content:check` 技能说明契约会按内联表现场复核这个 0.04）。
 */
export const EVENTS_BLANK_SHARE_PER_LEVEL = 0.04

/** 事件玄学等级 → 空地点占比系数（0 级 = 1 ⇒ 一字不变；满级 5 ⇒ 0.8）。入洞与深入下一层两处建盘都喂它。 */
export function blankShareFactorOf(state: GameState): number {
  const lv = Math.max(0, Math.min(5, Math.floor(state.skills.trained['event-dividend'] ?? 0)))
  return 1 - EVENTS_BLANK_SHARE_PER_LEVEL * lv
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
  /**
   * **本处的"出生信息"**（可选）：从库存项进洞时把 起始层 / 内容原型 / 敌族 一并带进来
   * （丙 + 丁 · 船长 2026-09-14）。不传（调试入口/老路径）⇒ 层按老口径、族与原型按 `seed` 现算。
   */
  origin?: { depth?: number; archetype?: WormholeArchetype; family?: WormholeFamily },
): WormholeStartResult {
  if (state.wormhole.run) return { ok: false, error: '已经在虫洞里了：先撤离或结算本趟。' }
  const blocked = wormholeEntryBlockReason(state, ctx, shipIds)
  if (blocked) return { ok: false, error: blocked }
  /**
   * **进洞自动停止**（船长 2026-09-14：「**进洞自动停止**」＋「『进洞会自动停掉的那一项活动』
   * **同样落实到采矿/打捞**」＋「**长途运输发出警告**」）：扫描虫洞 / 开采 / 打捞 / 长途运输这四项
   * 一律**在进洞那一刻停掉**——与玩家手点活动栏「停止」**同一条路径**（状态改动各走 `state.ts` 的单点），
   * 未返航的货留在船上、长途运输瞬时返港停靠出发站（无惩罚）⇒ 不新增任何损失；
   * 其余主控活动（含**无法自动停的远征**）仍在门槛那一步拦住（见 `wormholeEntryBlockReason`）。
   */
  const halted = wormholeEntryAutoStops(state)
  for (const a of halted) {
    if (a.kind === 'whscan') {
      const mins = wormholeScanHalt(state)
      if (mins !== null) addLog(state, 'info', `🛰 进洞前自动停掉「扫描虫洞」（进度保留：已扫 ${mins} 分钟）——回来可以接着扫。`)
    } else if (a.kind === 'mining') {
      const info = miningHalt(state)
      if (info !== null) {
        const belt = info.beltId ? ctx.belts.get(info.beltId) : undefined
        const oreName = belt ? (ctx.items.get(belt.oreId)?.name ?? '') : ''
        addLog(
          state,
          'info',
          `⛏ 进洞前自动停掉「开采」（${belt?.name ?? '矿带'} · 本趟 ${info.tripUnits} 单位${oreName}，货物留在船上）。`,
        )
      }
    } else if (a.kind === 'salvage') {
      const info = salvageHalt(state)
      if (info !== null) {
        const gName = info.galaxyId ? (ctx.galaxies.get(info.galaxyId)?.name ?? '') : ''
        addLog(
          state,
          'info',
          `♻ 进洞前自动停掉「打捞」（${gName} · 本趟约 ${Math.round(info.tripM3 * 100) / 100} m³ 当量，货物留在船上）。`,
        )
      }
    } else {
      const info = haulingHalt(state)
      if (info !== null) {
        const originName = info.fromSiteId ? (ctx.stations.get(info.fromSiteId)?.name ?? info.fromSiteId) : '母港'
        addLog(state, 'info', `🚚 进洞前自动停掉「长途运输」（舰船已即时返港停靠「${originName}」，无惩罚）。`)
      }
    }
  }
  const r = wormholeStartRun(ctx, shipIds, seed, blankShareFactorOf(state))
  if (!r.ok || !r.run) return r
  r.run.attending = true // 进洞即人在洞里：占着主控，直到临时离开或本趟收场
  // 出生信息（丙/丁）：层夹 1~9；原型与族缺省 ⇒ 按种子现算（与库存列表显示的同源）
  if (origin?.depth !== undefined) r.run.depth = Math.max(1, Math.min(9, Math.floor(origin.depth)))
  r.run.archetype = origin?.archetype ?? wormholeArchetypeOf(seed)
  r.run.family = origin?.family ?? wormholeFamilyOfSeed(seed)
  state.wormhole.run = r.run
  addLog(
    state,
    'info',
    `🕳 虫洞跃入：编队 ${shipIds.length} 艘 · 折算总质量 ${r.run.totalMass.toLocaleString('zh-CN')} · 可探索 ${r.run.turnsTotal} 回合。`,
  )
  return r
}

/**
 * ⚠ **施工期调试用**：放弃本趟探索（背包内容一并作废、`run` 清空）。
 * 正式路径（撤离成功结算 / 全损 / 回合耗尽）在 **F 批**实现；本函数只为"施工期不被卡在洞里"而存在，
 * 拍板前不应出现在玩家可及路径上（入口本身在调试开关后面）。
 */
export function wormholeDebugReset(state: GameState): void {
  state.wormhole.run = null
}

