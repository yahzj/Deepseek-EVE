import type { ShipDef, SimContext } from '../../types'
import { ceilFinalQuantity } from '../../quantity'
import { uidDefId } from '../../labels'
import { combatShipLimit } from '../../combat/command/rules'

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
export const WORMHOLE_MAX_SHIPS = combatShipLimit(true)

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
export const WORMHOLE_TURN_BASE = 80
export const WORMHOLE_TURN_MASS_COEF = 0.53

/**
 * **总质量 → 可探索回合数**（越重、时间越短）：
 * `ceil(80 × (1 − 总质量 ÷ 16,000 × 0.53)) + 科技加成`（基础沿革 55 → 60（2026-09-14）→ 100（2026-09-15）
 * → **80**（2026-09-19 船长「谜质科技树」批：「**加入科技后，初始回合数削减到80回合**」））。
 * 2026-10-18：最终回合预算向上取整；质量比与科技倍率仍保留精度。
 *
 * @param techTurnBonus **谜质科技**给的「**最大回合数**」永久加成（`mt-explore-turn` 每级 +10；
 *   船长：「探索回合增加是增加**最大回合数**（不是本趟回合）」）——与**本趟**的装置
 *   「时序核心 +10/台」**分开相加**（后者由 `wormholeSyncMatterTurns` 在趟内同步）。
 */
export function wormholeTurnBudget(totalMass: number, techTurnBonus = 0): number {
  const ratio = Math.max(0, Math.min(1, totalMass / WORMHOLE_TOTAL_MASS_CAP))
  return ceilFinalQuantity(WORMHOLE_TURN_BASE * (1 - ratio * WORMHOLE_TURN_MASS_COEF) + Math.max(0, techTurnBonus))
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
  // ⟪文案调整 2026-10-04⟫ T5分类改名，入场判据不变。
  'tier-too-high': `泰坦过重，会压塌虫洞入口（最多带到 T${WORMHOLE_MAX_TIER} 战列舰）`,
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
export function wormholeAdmission(
  ctx: SimContext,
  shipIds: readonly string[],
  /** **谜质科技**的「最大回合数」永久加成（`matterTechWhBuffs(state, ctx).turnBonus`；缺省 0 = 零变化） */
  techTurnBonus = 0,
): WormholeAdmission {
  const none = (code: WormholeAdmissionCode, totalMass = 0): WormholeAdmission => ({
    ok: false,
    code,
    totalMass,
    massRatio: totalMass / WORMHOLE_TOTAL_MASS_CAP,
    turnBudget: wormholeTurnBudget(totalMass, techTurnBonus),
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
    turnBudget: wormholeTurnBudget(totalMass, techTurnBonus),
  }
}
