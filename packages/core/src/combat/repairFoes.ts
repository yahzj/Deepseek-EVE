import type { UnitSpec } from './model'
import { ceilFinalQuantity } from '../quantity'
import { isAlive, healArmorHp } from './combatMath'
import { REPAIR_PULSE_MS } from './combatRepair'

export function foeRepairDiscountedShot(f: UnitSpec, dmg: number): number {
  const pct = f.repairPct ?? 0
  const afterRepair = pct > 0 ? Math.max(1, ceilFinalQuantity(dmg * (1 - pct))) : dmg
  const ov = f.foeOverlayDrive?.dmgMul
  return ov !== undefined && ov >= 0 ? Math.max(1, ceilFinalQuantity(afterRepair * ov)) : afterRepair
}

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

export function pulseFoeRepair(
  b: import('../state').BattleState,
  foeSpecs: ReadonlyArray<UnitSpec>,
  ledger: { nextPulseAtMs?: number; pulses: number; healed: number },
): void {
  const donors = foeSpecs.filter((s) => (s.repairPct ?? 0) > 0 && isAlive(b, s.tag))
  if (donors.length === 0) return
  const perSecond = donors.reduce((sum, s) => sum + foeNominalDpsOf(s) * (s.repairPct ?? 0), 0)
  const amount = ceilFinalQuantity((perSecond * REPAIR_PULSE_MS) / 1000)
  ledger.pulses += 1
  if (amount <= 0) return
  let target: UnitSpec | undefined
  let bestRatio = Number.POSITIVE_INFINITY
  for (const s of foeSpecs) {
    if ((s.repairPct ?? 0) > 0) continue
    if (s.foeShipId === 'foe-alien-broodmother' && b.foeOverride?.bossShipId === s.foeShipId) continue
    const rt = b.units[s.tag]
    if (!rt) continue
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
