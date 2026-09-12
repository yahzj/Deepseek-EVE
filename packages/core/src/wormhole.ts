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
