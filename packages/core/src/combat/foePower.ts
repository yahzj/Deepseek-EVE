import type { AnomalyDef, BattleBalance, FoeFamily, FoeTactic } from '../types'
import { SHIP_HP_UPLIFT_MUL } from './combatMath'

export function foeFamilyHpMulOf(family: FoeFamily | undefined): number {
  return family === 'C' ? 1.3 : 1
}

export function foeShipHpMulOf(family: FoeFamily | undefined): number {
  return SHIP_HP_UPLIFT_MUL * foeFamilyHpMulOf(family)
}

export const TACTIC_RANGE: Record<FoeTactic, { max: number; min: number }> = {
  brawl: { max: 2200, min: 0 },
  orbit: { max: 4600, min: 350 },
  kite: { max: 9200, min: 1200 },
}

export function foeRefSpeedMps(threat: number, bal: BattleBalance): number {
  const table = bal.foeRefSpeedTable
  for (let i = 0; i < table.length; i++) {
    if (threat <= table[i]!.upToThreat) return table[i]!.maxSpeedMps
  }
  const last = table[table.length - 1]
  return last ? last.maxSpeedMps : 200
}

export function foeSpeedBase(threat: number, bal: BattleBalance): number {
  const lo = bal.foeSpeedAtThreat10 ?? 0.8
  const hi = bal.foeSpeedAtThreat100 ?? 0.95
  const t = Math.min(1, Math.max(0, (threat - 10) / 90))
  return Math.min(1.15, Math.max(0.7, lo + (hi - lo) * t))
}

export function foeHpOfThreat(threat: number, bal: BattleBalance): number {
  const floor = bal.foeHpCurveFloorThreat ?? 6
  const span = bal.foeHpCurveSpanThreat ?? 90
  const t = Math.max(0, (threat - floor) / span)
  const d = (bal.foeHpCurveDMin ?? 5) + (bal.foeHpCurveDSpan ?? 85) * Math.pow(t, bal.foeHpCurveExp ?? 1.6)
  const table = bal.foeRefFire
  let f = table[0]?.dps ?? 5
  for (let i = 0; i < table.length; i++) {
    if (threat <= table[i]!.upToThreat) {
      f = table[i]!.dps
      break
    }
    f = table[i]!.dps
  }
  return Math.max(1, Math.round(f * d))
}

export function foeThreatRatingOf(x: number, designMul: number, bal: BattleBalance): number {
  const need = (5 * Math.max(0, x)) / (Math.max(1e-6, designMul) * Math.sqrt(SHIP_HP_UPLIFT_MUL))
  return foeThreatAtHpBudgetOf(need, bal)
}

export function foeThreatAtHpBudgetOf(needHp: number, bal: BattleBalance): number {
  const need = Math.max(0, needHp)
  let lo = 1
  let hi = 1024
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (foeHpOfThreat(mid, bal) >= need) hi = mid
    else lo = mid + 1
  }
  return lo
}

export function hasFixedFoeFormation(anomaly: AnomalyDef): boolean {
  const layout = anomaly.foeFormation?.layout
  return !!layout && anomaly.ships?.length === layout.length && anomaly.ships.every((slot, i) =>
    slot.ship === layout[i]!.ship && slot.count === 1 && slot.wave === layout[i]!.wave && slot.escort === layout[i]!.escort)
}

export function foeMultiShipCompMul(anomaly: AnomalyDef): number {
  if (hasFixedFoeFormation(anomaly)) return 1
  const n = (anomaly.ships ?? []).reduce((s, x) => s + Math.max(1, Math.floor(x.count ?? 1)), 0)
  return n <= 1 ? 1 : (2 * n) / (n + 1)
}

export function foeJudgedThreatOf(a: { threat: number; threatJudged?: number }): number {
  return a.threatJudged ?? a.threat
}
