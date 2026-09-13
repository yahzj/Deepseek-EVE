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
import type { ShipDef, SimContext } from './types'

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
    const ship = ctx.ships.get(id)
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
}

export interface WormholeState {
  /** 进行中的一趟（null = 不在洞里） */
  run: WormholeRunState | null
  /** 本趟累计：损失船数（结算读数用） */
  lastFleetLost: number
}

export const EMPTY_WORMHOLE_STATE: WormholeState = { run: null, lastFleetLost: 0 }

/* ── 层曲线（船长 2026-09-13：「深层收益应该比难度曲线要更高」） ── */

/** 第 1 层基准威胁 */
export const WORMHOLE_THREAT_BASE = 45
/** 每层**威胁**增幅（等比 ×1.16 ⇒ 层 1~3 = 45/52/61，与设计稿"≈45~60"同量级） */
export const WORMHOLE_THREAT_GROWTH = 0.16
/** 每层**收益**增幅（+20%）。**必须大于威胁增幅** —— 船长 2026-09-13：
 *  「深层收益应该比难度曲线要更高」⇒ 用等比而非加法，才能让"单位威胁收益"**逐层严格上升**
 *  （若威胁用 +9 加法，层 1→2 的威胁增幅恰好 20%、与收益打平，头两层看不出"更赚"）。 */
export const WORMHOLE_REWARD_GROWTH = 0.2
/** 兼容取整：每层威胁的**名义**增量（= 45×0.16 ≈ 7，落在设计稿"+8~10"附近，供文档/读数引用） */
export const WORMHOLE_THREAT_PER_LAYER = Math.round(WORMHOLE_THREAT_BASE * WORMHOLE_THREAT_GROWTH)

/** 第 `depth` 层的威胁（层 1 = 45，每层 ×1.16，取整） */
export function wormholeLayerThreat(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.round(WORMHOLE_THREAT_BASE * Math.pow(1 + WORMHOLE_THREAT_GROWTH, d - 1))
}

/** 第 `depth` 层的收益系数（层 1 = 1.0，每层 ×1.2）——**涨得比威胁快** */
export function wormholeLayerRewardMul(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.pow(1 + WORMHOLE_REWARD_GROWTH, d - 1)
}

/** 每层节点数（船长定：2~3 个；层 1~2 取 2、层 3 起取 3——越深越长，与收益曲线同向） */
export function wormholeNodesPerLayer(depth: number): number {
  return Math.max(1, Math.floor(depth)) <= 2 ? 2 : 3
}

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
 */
export function wormholeMakeNode(seed: number, depth: number, index: number): WormholeNode {
  const h = Math.abs((seed * 1103515245 + (depth * 97 + index) * 12345) % 2147483647)
  const roll = h % 100
  const waves = Math.min(3, 1 + Math.floor(Math.max(0, depth - 1) / 2) + (roll % 2))
  if (index === 0) {
    return { kind: 'combat', waves, pickups: 0, cost: wormholeStepCost(waves, 0) }
  }
  if (roll < 45) return { kind: 'pickup', waves: 0, pickups: 2, cost: wormholeStepCost(1, 2) }
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
  if (run.pendingNode) return { ok: false, error: '本层战斗未结束：不能撤离、也不能深入。' }
  if (run.turnsLeft <= 0) return { ok: false, error: '回合已耗尽：只能撤离。', mustExtract: true }
  run.depth += 1
  run.nodeIndex = 0
  run.nodesPerLayer = wormholeNodesPerLayer(run.depth)
  run.pendingNode = wormholeMakeNode(rngSeed, run.depth, 0)
  return { ok: true, spent: 0, atLayerEnd: false }
}

/** 撤离（**只在层末可用**）：进入撤离战相位；撤离战本体在 F 批实现 */
export function wormholeExtract(run: WormholeRunState): WormholeAdvanceResult {
  if (run.pendingNode) return { ok: false, error: '战斗没结束不能撤退：先打完本节点。' }
  run.phase = 'extracting'
  return { ok: true }
}
