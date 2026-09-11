/**
 * 舰种表（质量分级·**敌我共用**）——2026-09-11 船长定案。
 *
 * 船长原话要点：舰种**收敛为 5 档**（原口径里的 7 档作废）；「重型巡洋」归入巡洋舰档、
 * 「战列巡洋」归入战列舰档——它们是**称号**不是独立档；舰种基准速度按档给定（见下表）。
 *
 * ## 口径一：档位来源 = 等效质量落档（沿用仓库 2026-09-09 既有规则）
 * - 等效质量 = `massKg × (role === 'armored' ? 0.65 : 1)`（甲壳重装族的厚甲折抵质量）；
 * - 落档区间（校验用，**本表不重切、数值不改**）：
 *   T1 `0.4~2.4M` / T2 `2.4~5.8M` / T3 `5.8~13M` / T4 `13~29M` / T5 `≥29M`；
 * - 档位本身取自既有的 `ShipDef.tier`（1~5），本表**只做命名与基准速度的单一出处**，
 *   不改任何船的 tier、不动任何船数值。
 *
 * ## 口径二：敌我共用
 * 这一套舰种**不是**只给玩家的船用——玩家的船与敌人的舰级**都归入同一套舰种**，
 * 参考**同一个基准速度**。实际速度 = **基准 × 倍率**（倍率按舰/按族各自给，
 * **倍率本批暂未落地**）；本表只钉基准，不钉倍率。
 *
 * ## 基准速度的来由（**船长给定值，非从现有船舰回推**）
 * 五档基准速度由**船长 2026-09-11 定案给定**：**巡洋 258 / 战列 205 / 旗舰 155 为船长直接给定**
 * （在原提案 268/245/225 上下调）；**护卫 340 / 驱逐 295 为二号提案、经船长认可**。
 * ⚠ 它是一组**设计给定的基准值**——**不对应任何具体船舰的现值**，也不是从现有武装舰实速统计出来的
 * （本表不对既有 25 艘船的任何速度做取证或反推）；个别船/舰级的实速一律由**倍率**表达。
 * 轻档快、重档慢的单调阶梯只描述设计意图，不代表对某艘船的引用。
 * 本批**零行为变化**：表只建在数据层，暂不接线到任何引擎读取点。
 */

/** 五档舰种：`1 = 护卫舰 / 2 = 驱逐舰 / 3 = 巡洋舰 / 4 = 战列舰 / 5 = 旗舰` */
export type HullClassTier = 1 | 2 | 3 | 4 | 5

/** 舰种名（tier → 名；「重型巡洋」「战列巡洋」是称号不是独立档，分别归巡洋舰/战列舰档） */
export const HULL_CLASS_NAME: Record<HullClassTier, string> = {
  1: '护卫舰',
  2: '驱逐舰',
  3: '巡洋舰',
  4: '战列舰',
  5: '旗舰',
}

/**
 * 舰种基准速度（m/s，**敌我共用**；2026-09-11 船长本轮给定值）。
 * = 该档"武装舰基线"：实际速度 = **基准 × 倍率**（倍率暂未落地）。
 */
export const HULL_CLASS_BASE_SPEED: Record<HullClassTier, number> = {
  1: 340,
  2: 295,
  3: 258,
  4: 205,
  5: 155,
}

/**
 * 舰种等效质量区间（kg，闭开区间：`[下界, 上界)`，最高档上界 = `Infinity`）。
 * 口径 = 仓库 2026-09-09 既有区间，**本批不重切**；仅作归类校验与查询用。
 */
export const HULL_CLASS_MASS_RANGE: Record<HullClassTier, readonly [number, number]> = {
  1: [400_000, 2_400_000],
  2: [2_400_000, 5_800_000],
  3: [5_800_000, 13_000_000],
  4: [13_000_000, 29_000_000],
  5: [29_000_000, Infinity],
}

/** 甲壳重装族的等效质量折抵系数（厚甲折抵质量，2026-09-09 定） */
const ARMORED_MASS_FACTOR = 0.65

/**
 * 等效质量 = `massKg × (role === 'armored' ? 0.65 : 1)`；缺 `massKg` 按 0 计（调用方自校验）。
 */
export function equivalentMassOf(ship: { massKg?: number; role?: string }): number {
  const mass = typeof ship.massKg === 'number' && Number.isFinite(ship.massKg) ? ship.massKg : 0
  return mass * (ship.role === 'armored' ? ARMORED_MASS_FACTOR : 1)
}

/**
 * 把任意 tier 收进合法档位 `1~5`：**越界一律兜底到最近的合法档**
 * （`tier ≤ 1` → 1、`tier ≥ 5` → 5；非有限数按 1 处理），不让越界值在表里查到 `undefined`。
 */
export function hullClassTierOfTier(tier: number): HullClassTier {
  if (!Number.isFinite(tier)) return 1
  const rounded = Math.round(tier)
  if (rounded <= 1) return 1
  if (rounded >= 5) return 5
  return rounded as HullClassTier
}

/** 舰船的舰种名（按 `ShipDef.tier` 取名；tier 越界走 `hullClassTierOfTier` 兜底） */
export function hullClassOf(ship: { tier?: number }): string {
  return HULL_CLASS_NAME[hullClassTierOfTier(ship.tier ?? 1)]
}
