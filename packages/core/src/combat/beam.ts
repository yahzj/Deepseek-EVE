/** 战斗域：beam，从原引擎按职责迁移，保持结算顺序。 */
import { distFactor } from './combatMath'

/**
 * **激光威力系数**（**2026-09-11 船长定：合并旧修正、不再与命中衰减挂钩**）——
 * 旧口径 = `1 − 进度 ×(1−falloff) ×0.8`（"幅度 = 命中衰减的 0.8 倍"，falloff 0.3 时远端 ×0.44）；
 * 新口径 = **近端 ×1 → 最远端 = 该武器 `falloff`（激光件现统一 0.1）**，线性内插、无任何换算系数：
 *   系数 = 1 − 进度 × (1 − falloff)   （falloff 0.1 → 最远端威力 ×0.10）
 * ⇒ "远端衰减"对能量武器就是**最远端威力倍率本身**，与动能/爆炸的"远端命中倍率"语义对齐、一眼可读。
 *
 * ⚠ **2026-09-12 审计 B1：本函数与 `distFactor` 已合并为同一实现**——两者原本是两份**逐字相同**的代码，
 * 本函数唯一多出的是 `Math.max(0, …)`，而那一层在 **`falloff ∈ [0,1]`** 时**恒不生效**
 * （`t` 已 clamp 到 `[0,1]` ⇒ `1 − t(1−falloff) ≥ 1 − (1−falloff) = falloff ≥ 0`）。
 * 该前提由 `content:check`「**远端衰减取值域契约**」守住（越界即报错）。
 * **保留本名字与语义标签**（**威力**衰减，与动能/爆炸的**命中**衰减并列），实现一律走 `distFactor`。
 */
export function beamPowerFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  return distFactor(dist, w)
}

/**
 * **光束件的"对目标"威力系数**（我方开火路径专用）—— **打机群恒 1**、打舰照旧 {@link beamPowerFactor}。
 *
 * 🔴 **船长 2026-10-02 令**（原话）：「**甲，并且对无人机无衰减**」——起因是一号当天的检查：
 * `mod-lair-pd-r`（PD激光）是全仓**唯一一件"带防空属性的光束件"**（`antiDrone: 2` + `slot: 'laser'`），
 * 而 beam 分支算 `dmg` 时**不看目标类型**、一律乘 `beamPowerFactor(两舰间距)` ⇒ 它打机群也被距离砍
 * （3,000m 外锁 `falloff` = ×0.5），与本仓既有的三条口径**不一致**：
 * · 2026-09-11 甲案「**打机群不看两舰间距**」（**选靶**：出击型不受射程限制、哨戒机才要进射程）；
 * · 2026-09-12「**按丁修复**」（**命中**：`droneHitChance` 的 df 固定为 1）；
 * · 三档**动能**近防炮打机群的单发是**定值**（`dmg = shotDmg`，本就不吃距离）。
 * ⇒ 船长裁「甲」＝承认这条口径，并明确**打机群无衰减** ⇒ 本函数把"打机群那一支"的距离系数钉成 1。
 *
 * **只作用于打机群**：打舰（含我方无人机、僚舰的武器打舰）**一字未动**，仍走 `beamPowerFactor`；
 * 非光束件（动能/爆炸/能量掷命中）本就不走威力衰减、也不经过本函数。
 * ⚠ 抽成函数只为**单一取数口 + 可测**（用例直接断言两支；`beamPowerFactor` 本体与 `v18b2` 那批公式断言不变）。
 */
export function beamPowerVsTargetOf(
  dist: number,
  w: { minRangeM: number; maxRangeM: number; falloff: number },
  vsDrone: boolean,
): number {
  return vsDrone ? 1 : beamPowerFactor(dist, w)
}
