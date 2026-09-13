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
import {
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeCardIdFor,
} from './wormholeFoes'
import type { WormholeFoeKind } from './wormholeFoes'

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
): { bag: WormholeBagSlot[]; dropped: WormholeBagSlot[] } {
  const slots = bag.map((s) => ({ ...s }))
  const perOf = (itemId: string): number => wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0)
  /** 每格价值（判"先丢谁"用的就是它；认不出的物品 = 无穷大 ⇒ 最后丢） */
  const valuePerSlot = (s: WormholeBagSlot): number => {
    const def = ctx.items.get(s.itemId)
    const per = perOf(s.itemId)
    if (!def || per <= 0) return Number.POSITIVE_INFINITY
    return per * Math.max(0, def.baseSellPriceIsk ?? 0)
  }
  const dropped: WormholeBagSlot[] = []
  while (wormholeBagUsage(ctx, slots, capacity).used > capacity && slots.length > 0) {
    let pick = 0
    for (let i = 1; i < slots.length; i++) {
      const a = valuePerSlot(slots[i]!)
      const b = valuePerSlot(slots[pick]!)
      if (a < b || (a === b && slots[i]!.itemId < slots[pick]!.itemId)) pick = i
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
      pendingNode: wormholeMakeNode(rngSeed, depth, 0),
      nodesPerLayer: wormholeNodesPerLayer(depth),
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
export function wormholeDescend(run: WormholeRunState, rngSeed: number): WormholeAdvanceResult {
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
  run.pendingNode = wormholeMakeNode(rngSeed, run.depth, 0)
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
 * 撤离（**只在层末可用、且本层守卫已清**）——**唯一例外是"回合走不动了"的逃生门**：
 * 回合耗尽/付不起当前节点时，哪怕节点没结算、层末守卫没清，也放行撤离（见 `wormholeOutOfTurns`）。
 * 战斗中（`run.battle` 非空）一律不许撤——船长裁定「战斗没结束不能撤」优先于逃生门。
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
/* ═══════════ 六、E 批：入洞 / 拾取 / 背包（界面接线所需的引擎动作） ═══════════ */

/**
 * 每堆原矿的**基准单位数**。
 *
 * ⚠ **待 F 批收益校准**：本批（E）只落"堆 = 一堆原矿、能拾、能进包、超格会被拦"这套**机制**；
 * 具体数量与层收益曲线的乘子以 F 批 `tools/` 校准读数为准再定稿。当前口径 = 基准 × 层收益系数，
 * 故"越深越值钱"的方向与 §4/§5 一致，只是绝对值未定。
 */
export const WORMHOLE_PILE_UNITS_BASE = 200

/** 拾取点里的一堆战利品（虫洞内**只掉原矿**——船长 2026-09-12 定，见设计稿 §5.4/Q14） */
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
  const r = wormholeStartRun(ctx, shipIds, seed)
  if (!r.ok || !r.run) return r
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
 * ⚠ 回合口径：节点 `cost` 已按"每堆 +1 回合"计入（C 批 `wormholeStepCost`），故**拾取本身不再扣回合**，
 * 回合在"结算本节点"时一次性扣（E 批不重复计费；F 批若改逐步扣费再说）。
 */
export function wormholeTakePile(
  state: GameState,
  ctx: SimContext,
  pileIndex: number,
): { ok: boolean; error?: string; taken?: WormholePile; used?: number; capacity?: number } {
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。' }
  const piles = run.pendingNode?.piles
  if (!piles || pileIndex < 0 || pileIndex >= piles.length) {
    return { ok: false, error: '这里没有可拾取的东西。' }
  }
  const pile = piles[pileIndex]!
  const capacity = wormholeBagSlotsOfFleet(state, ctx, run.fleet)
  const merged = mergeIntoBag(run.bag, pile)
  const usage = wormholeBagUsage(ctx, merged, capacity)
  if (usage.overflow) {
    return { ok: false, error: `背包放不下：已占 ${usage.used} / 共 ${capacity} 格。` }
  }
  run.bag = merged
  piles.splice(pileIndex, 1)
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

