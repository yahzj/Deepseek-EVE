/** 战斗域：repairFoes，从原引擎按职责迁移，保持结算顺序。 */
import type { UnitSpec } from './model'
import { ceilFinalQuantity } from '../quantity'
import { isAlive, healArmorHp } from './combatMath'
import { REPAIR_PULSE_MS } from './combatRepair'

/**
 * **敌舰开火单发的两把折减尺**（按下面的顺序逐层相乘；两层都不挂 ⇒ **原值返回，零行为变化**）：
 *
 * ① **后勤舰打折**（船长 2026-09-16：「**敌人后勤舰则是将 50% 的自身DPS转换为修理值**」）——
 *    把该单位打出去的单发按 `×(1 − repairPct)` 折掉，被折掉的那半**按秒转成修理量**
 *    （见 `pulseFoeRepair`）。⚠ **只折炮台（`src` 非 `drone`）**：后勤舰本就不挂机群（我方新舰如此设计），
 *    且"自身 DPS"的修理口径也只算炮台 ⇒ 两边同一把尺。
 *
 * ② **叠光装置的伤害折减**（**船长 2026-10-01 令**：「伤害给予一个0.3的倍率。」；追问裁定
 *    「**甲：该舰全部伤害 ×0.3**」）——`FoeOverlayDrive.dmgMul` 乘在该舰**打出去的每一发**上
 *    （光束与实弹**都走本收口**）。它是「装填间隔越缩越短」的对价：间隔缩到 500ms（8.4 倍射速）时
 *    单发只剩 0.3 ⇒ 峰值 DPS 仍被压在预算内。⚠ 卡面 `threat` 与账面 DPS **不动**（预算锚点不变）。
 */
export function foeRepairDiscountedShot(f: UnitSpec, dmg: number): number {
  const pct = f.repairPct ?? 0
  const afterRepair = pct > 0 ? Math.max(1, ceilFinalQuantity(dmg * (1 - pct))) : dmg
  const ov = f.foeOverlayDrive?.dmgMul
  return ov !== undefined && ov >= 0 ? Math.max(1, ceilFinalQuantity(afterRepair * ov)) : afterRepair
}

/**
 * **敌方后勤舰的名义 DPS**（用于每跳修理量）：该单位**战斗中炮台面板**的
 * `Σ 单发 × 门数 × 1000 ÷ 装填`——**不含命中与距离衰减**（固定、可预测）。
 * ⚠ 排除机群条目（`src === 'drone'`）与**备用机**条目（`reserve`）：两者都不是常驻齐射的一份。
 */
export function foeNominalDpsOf(f: UnitSpec): number {
  let dps = 0
  for (const w of f.weapons) {
    if (w.src === 'drone' || w.reserve === true) continue
    const per = w.shotDmg ?? 0
    if (per <= 0) continue
    dps += (per * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
  }
  return dps
}

/**
 * **一记敌方后勤脉冲**（每 `REPAIR_PULSE_MS` = 5 秒一跳，与玩家维修装置同节拍）：
 *
 * - 修理量 = `Σ 在场后勤舰(名义 DPS × repairPct) × (5 秒)`（各舰按自己的名义 DPS 出力）；
 * - 目标 = **非后勤**敌舰里**三层剩余比例最低**者（船长 2026-09-16 补充裁定：
 *   「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）**」）⇒ 候选**排除一切 `repairPct > 0` 的单位，
 *   也排除"甲+结构 都满"的单位（修不动 ⇒ 换下一个；全不可修 ⇒ 空转）；
 * - **只修装甲/结构**（与玩家维修装置同一套层位语义），**不超过目标满血**、**不耗组件**；
 * - 返回实际修好的点数（累加进 `ledger.healed`，供战报/读数）。
 */
export function pulseFoeRepair(
  b: import('../state').BattleState,
  foeSpecs: ReadonlyArray<UnitSpec>,
  ledger: { nextPulseAtMs?: number; pulses: number; healed: number },
): void {
  /**
   * ⚠ **2026-09-19 报障修复**（船长转述玩家：「**生物损管腔之类的修理会让已经损毁的船复活**」）：
   * 供血方必须**还活着**（`isAlive`）——尸体不再产生修理值。判据与被动护盾回充同源，
   * 理由是同一把尺：尸体在 `battle.units` 里**永不摘除**（多波/战报/「在场过 = 存在」都靠它）⇒
   * 只查字段存在、不查存活，就会让"阵亡的后勤舰照旧供血"。
   */
  const donors = foeSpecs.filter((s) => (s.repairPct ?? 0) > 0 && isAlive(b, s.tag))
  if (donors.length === 0) return
  const perSecond = donors.reduce((sum, s) => sum + foeNominalDpsOf(s) * (s.repairPct ?? 0), 0)
  const amount = ceilFinalQuantity((perSecond * REPAIR_PULSE_MS) / 1000)
  ledger.pulses += 1
  if (amount <= 0) return
  // 选靶：非后勤 + 甲/结构未满 + 三层比例最低（并列取 spec 顺序靠前）
  let target: UnitSpec | undefined
  let bestRatio = Number.POSITIVE_INFINITY
  for (const s of foeSpecs) {
    if ((s.repairPct ?? 0) > 0) continue // 永不以任何后勤舰为目标（含自己）
    if (s.foeShipId === 'foe-alien-broodmother' && b.foeOverride?.bossShipId === s.foeShipId) continue
    const rt = b.units[s.tag]
    if (!rt) continue
    // 阵亡敌舰不修（2026-09-19 报障修复）：三层全 0 ⇒ 修活 = 玩家的"已沉没"敌舰复活
    if (!isAlive(b, s.tag)) continue
    const capA = Math.max(0, s.hp.a)
    const capH = Math.max(0, s.hp.h)
    if (rt.hp.a >= capA && rt.hp.h >= capH) continue
    const capAll = capA + capH + Math.max(0, s.hp.s)
    const ratio = capAll > 0 ? (rt.hp.s + rt.hp.a + rt.hp.h) / capAll : 1
    if (ratio < bestRatio) {
      bestRatio = ratio
      target = s
    }
  }
  if (!target) return
  const rt = b.units[target.tag]
  if (!rt) return
  const capA = Math.max(0, target.hp.a)
  const capH = Math.max(0, target.hp.h)
  let left = amount
  const healA = Math.min(left, Math.max(0, capA - rt.hp.a))
  healArmorHp(rt.hp, healA)
  left -= healA
  const healH = Math.min(left, Math.max(0, capH - rt.hp.h))
  rt.hp.h += healH
  ledger.healed += healA + healH
}

/**
 * **一记「船体修理装置」脉冲**（每 `UnitSpec.foeRepairPulse.everyMs` = 5 秒一跳，与维修装置同节拍）：
 * **只修挂件的那艘自己**（不选靶、不外溢），装甲与结构各 `round(基数 × k)`、各层夹自己的满值。
 *
 * ⚠ 与 `pulseFoeRepair`（敌方后勤舰）**不是一套**，两条独立并存：
 * - 后勤舰 = **把自己的 DPS 折成修理值去修队友**（有选靶、有"永不修后勤舰"约束、按账本一跳一选）；
 * - 本装置 = **自修**、不折火力、逐单位各按各的计时（`battle.foeRepairPulses[tag]`）。
 *
 * 返回实际修好的点数（累加进该单位的账本，供战报/读数用）。
 * 阵亡单位不修（与 2026-09-19「尸体不复活」同一把尺：尸体在 `battle.units` 里永不摘除）。
 */
export function pulseFoeMountRepair(
  b: import('../state').BattleState,
  spec: UnitSpec,
  ledger: { nextPulseAtMs?: number; pulses: number; healed: number },
): void {
  const rp = spec.foeRepairPulse
  if (rp === undefined) return
  ledger.pulses += 1
  if (!isAlive(b, spec.tag)) return
  const rt = b.units[spec.tag]
  if (!rt) return
  const capA = Math.max(0, spec.hp.a)
  const capH = Math.max(0, spec.hp.h)
  const healA = Math.min(Math.max(0, ceilFinalQuantity(rp.armor * rp.k)), Math.max(0, capA - rt.hp.a))
  const healH = Math.min(Math.max(0, ceilFinalQuantity(rp.hull * rp.k)), Math.max(0, capH - rt.hp.h))
  if (healA <= 0 && healH <= 0) return
  healArmorHp(rt.hp, healA)
  rt.hp.h += healH
  ledger.healed += healA + healH
}
