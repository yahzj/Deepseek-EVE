import type { GameState } from '../state'
import type { SimContext } from '../types'
import { industrialBaseThreatOf, industrialFleetSnapshotOf, industrialFrequencyOf, industrialThreatOf } from '../encounters/risk'
import { haulFleetPathOf } from './fleet'

export function haulRiskPreviewOf(state: GameState, ctx: SimContext, ids: readonly string[], cargoM3: number, from: string, to: string) {
  const path = haulFleetPathOf(state, ctx, ids, from, to)
  const config = ctx.balance.encounter.industrial
  const fleet = industrialFleetSnapshotOf(state, ctx, ids, cargoM3)
  const frequency = industrialFrequencyOf(fleet.industrialMassKg, fleet.combatMassKg, config.frequency)
  const ratios: number[] = []
  let unknown = false
  const threats = path.flatMap(row => {
    if ((ctx.galaxies.get(row.galaxyId)?.security ?? 1) > ctx.balance.encounter.lowSecMax) return []
    const base = industrialBaseThreatOf(ctx, row.galaxyId)
    if (base === null) { unknown = true; return [] }
    const threat = industrialThreatOf(base, fleet.industrialMassKg, fleet.cargoM3, config.threat.profiles.hauling).targetThreat
    ratios.push(threat / base)
    return [threat]
  })
  // 沿途最强相对威胁只展示整数宽档，不泄露精确威胁或把降频当成减伤。
  const coefficient = !unknown && ratios.length ? Math.floor(Math.max(...ratios)) : null
  return { exposed: path.some(row => (ctx.galaxies.get(row.galaxyId)?.security ?? 1) <= ctx.balance.encounter.lowSecMax),
    threatMin: threats.length ? Math.min(...threats) : null, threatMax: threats.length ? Math.max(...threats) : null,
    frequencyMul: frequency.multiplier, escortReduction: 1 - frequency.escortMul,
    coefficientMin: coefficient, coefficientMax: coefficient === null ? null : coefficient + 1 }
}
