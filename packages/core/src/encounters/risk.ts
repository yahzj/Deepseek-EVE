import type { GameState } from '../state'
import type { SimContext } from '../types'
import { fleetDefOf } from '../instances'
import { cargoUsedM3Of } from '../inventory'
import type { IndustrialFleetSnapshot, IndustrialFrequencyConfig, IndustrialThreatProfile, IndustrialThreatView } from './riskTypes'

function finite(value: number, name: string, minimum = 0, exclusive = false): number {
  if (!Number.isFinite(value) || (exclusive ? value <= minimum : value < minimum)) throw new Error(`industrial-risk-invalid:${name}`)
  return value
}

/** 预览和正式生成共用纯函数，显式0权重有效，不消费随机数。 */
export function industrialThreatOf(base: number, massKg: number, cargoM3: number, p: IndustrialThreatProfile): IndustrialThreatView {
  finite(base, 'baseThreat', 0, true)
  finite(massKg, 'industrialMassKg')
  finite(cargoM3, 'cargoM3')
  for (const key of ['baseThreatScale', 'industrialFreeMassKg', 'industrialThreatWeight', 'cargoThreatWeight'] as const) finite(p[key], key)
  finite(p.industrialMassScaleKg, 'industrialMassScaleKg', 0, true)
  finite(p.cargoVolumeScaleM3, 'cargoVolumeScaleM3', 0, true)
  finite(p.minimumThreat, 'minimumThreat', 0, true)
  if (!Number.isSafeInteger(p.minimumThreat) || !Number.isFinite(p.baseThreatOffset)) throw new Error('industrial-risk-invalid:threatBounds')
  const x = Math.max(0, (massKg - p.industrialFreeMassKg) / p.industrialMassScaleKg)
  const baseThreat = base * p.baseThreatScale + p.baseThreatOffset
  const industrialThreat = Math.round(p.industrialThreatWeight * Math.log2(1 + x))
  const cargoThreat = Math.round(p.cargoThreatWeight * Math.log2(1 + cargoM3 / p.cargoVolumeScaleM3))
  const targetThreat = Math.max(p.minimumThreat, Math.round(baseThreat + industrialThreat + cargoThreat))
  if (!Number.isSafeInteger(targetThreat)) throw new Error('industrial-risk-invalid:targetThreat')
  return { targetThreat, baseThreat, industrialThreat, cargoThreat }
}

/** 概率修正与强度参数独立，调货量威胁不会暗改频率。 */
export function industrialFrequencyOf(massKg: number, combatKg: number, p: IndustrialFrequencyConfig): { industrialMul: number; escortMul: number; multiplier: number } {
  finite(massKg, 'industrialMassKg')
  finite(combatKg, 'combatMassKg')
  finite(p.industrialFreeMassKg, 'frequencyFreeMass')
  finite(p.industrialMassScaleKg, 'frequencyMassScale', 0, true)
  finite(p.industrialChanceHalfPoint, 'industrialChanceHalfPoint', 0, true)
  finite(p.escortMassHalfPointKg, 'escortMassHalfPointKg', 0, true)
  finite(p.industrialChanceMaxBonus, 'industrialChanceMaxBonus')
  finite(p.escortChanceMaxReduction, 'escortChanceMaxReduction')
  finite(p.maximumChance, 'maximumChance')
  if (p.escortChanceMaxReduction >= 1 || p.maximumChance > 1) throw new Error('industrial-risk-invalid:probabilityBounds')
  const x = Math.max(0, (massKg - p.industrialFreeMassKg) / p.industrialMassScaleKg)
  const industrialMul = 1 + p.industrialChanceMaxBonus * x / (x + p.industrialChanceHalfPoint)
  const escortMul = 1 - p.escortChanceMaxReduction * combatKg / (combatKg + p.escortMassHalfPointKg)
  return { industrialMul, escortMul, multiplier: industrialMul * escortMul }
}

/** 调用者必须传正式出勤名单；不从准备队、港内或独立AI补船。 */
export function industrialFleetSnapshotOf(state: GameState, ctx: SimContext, ids: readonly string[], virtualCargoM3 = 0): IndustrialFleetSnapshot {
  finite(virtualCargoM3, 'virtualCargoM3')
  const result: IndustrialFleetSnapshot = { shipIds: [...new Set(ids)], industrialMassKg: 0, combatMassKg: 0, cargoM3: virtualCargoM3 }
  for (const id of result.shipIds) {
    const ship = state.fleet[id]
    const def = fleetDefOf(state, ctx, id)
    if (!ship || !def) throw new Error(`industrial-risk-missing-ship:${id}`)
    if (ship.durability <= 0) continue
    const mass = finite(def.massKg ?? NaN, `massKg:${def.id}`, 0, true)
    if (def.role === 'industrial' || def.role === 'hauler') result.industrialMassKg += mass
    else result.combatMassKg += mass
    result.cargoM3 += cargoUsedM3Of(state, ctx, id)
  }
  return result
}

/** 正常常驻目标给地区定标，不把临时窝点、隐藏模板或入侵覆盖当基准。 */
export function industrialBaseThreatOf(ctx: SimContext, galaxyId: string): number | null {
  const values = [...ctx.anomalies.values()].filter(card => card.galaxyId === galaxyId && !card.hidden && card.region !== 'inv' && !card.id.startsWith('weekend-') && !card.id.startsWith('lair-'))
    .map(card => card.threat).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (!values.length) return null
  const mid = Math.floor(values.length / 2)
  return values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2
}
