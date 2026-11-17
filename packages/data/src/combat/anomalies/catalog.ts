import type { AnomalyDef, FoeShipSlot } from '@whale/core'
import { ANOMALY_ENTRY_0, ANOMALY_ENTRY_1 } from './specialPools'
import { ANOMALY_ENTRY_2 } from './training'
import { ANOMALY_ENTRY_3, ANOMALY_ENTRY_5, ANOMALY_ENTRY_20, ANOMALY_ENTRY_21, ANOMALY_ENTRY_22, ANOMALY_ENTRY_23 } from './familyA'
import { ANOMALY_ENTRY_4, ANOMALY_ENTRY_19 } from './familyB'
import { ANOMALY_ENTRY_6, ANOMALY_ENTRY_7, ANOMALY_ENTRY_17, ANOMALY_ENTRY_18 } from './familyD'
import { ANOMALY_ENTRY_8, ANOMALY_ENTRY_12, ANOMALY_ENTRY_16, ANOMALY_ENTRY_24 } from './familyC'
import { ANOMALY_ENTRY_9, ANOMALY_ENTRY_10, ANOMALY_ENTRY_11 } from './familyE'
import { ANOMALY_ENTRY_13, ANOMALY_ENTRY_14, ANOMALY_ENTRY_15 } from './familyG'
import { ANOMALY_ENTRY_25, ANOMALY_ENTRY_26, ANOMALY_ENTRY_27, ANOMALY_ENTRY_28 } from './encounterTemplates'

export const ANOMALIES_BASE: readonly AnomalyDef[] = [...ANOMALY_ENTRY_0, ...ANOMALY_ENTRY_1, ANOMALY_ENTRY_2, ANOMALY_ENTRY_3, ANOMALY_ENTRY_4, ANOMALY_ENTRY_5, ANOMALY_ENTRY_6, ANOMALY_ENTRY_7, ANOMALY_ENTRY_8, ANOMALY_ENTRY_9, ANOMALY_ENTRY_10, ANOMALY_ENTRY_11, ANOMALY_ENTRY_12, ANOMALY_ENTRY_13, ANOMALY_ENTRY_14, ANOMALY_ENTRY_15, ANOMALY_ENTRY_16, ANOMALY_ENTRY_17, ANOMALY_ENTRY_18, ANOMALY_ENTRY_19, ANOMALY_ENTRY_20, ANOMALY_ENTRY_21, ANOMALY_ENTRY_22, ANOMALY_ENTRY_23, ANOMALY_ENTRY_24, ANOMALY_ENTRY_25, ANOMALY_ENTRY_26, ANOMALY_ENTRY_27, ANOMALY_ENTRY_28]

export const RERATE_20260925: Readonly<Record<string, number>> = {
  'ano-training': 0.735,
  'ano-harbor-escort': 0.3427,
  'ano-redring-raiders': 1.3095,
  'ano-shard-bandits': 1.5882,
  'ano-mirage-hijackers': 4.5755,
  'ano-cinder-siege': 1.8349,
  'ano-titan-wreck': 1.6582,
  'ano-nadir-static': 2.1562,
  'ano-starcore-boss': 1.3171,
  'ano-chasm-aberrations': 2.0883,
  'ano-abyss-guard': 3.1283,
  'ano-maw-hunt': 1.444,
}

export function reratedCard(a: AnomalyDef): AnomalyDef {
  const k = RERATE_20260925[a.id]
  if (k === undefined || !a.ships || a.ships.length === 0) return a
  const units = a.ships.reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0)
  const comp = (2 * units) / (units + 1)
  const ships: readonly FoeShipSlot[] = a.ships.map((s) => {
    const hpMul = (s.hpMul ?? 1) * k
    const dmgMul = (s.dmgMul ?? 1) * k
    if (s.firepowerAnchor === undefined) return { ...s, hpMul, dmgMul }
    const count = Math.max(1, Math.floor(s.count ?? 1))
    const gunPerUnit = Math.max(1, Math.round(s.ship.shotDmg * dmgMul * comp))
    const dronePerUnit = (s.ship.drones ?? []).reduce(
      (n, ds) => n + Math.max(0, Math.round(ds.count)) * Math.max(1, Math.round(ds.drone.dmg * dmgMul)),
      0,
    )
    const natural = Math.max(1, Math.round((gunPerUnit + dronePerUnit) * count))
    const scaled = Math.max(1, Math.round(s.firepowerAnchor * k))
    return { ...s, hpMul, dmgMul, firepowerAnchor: Math.abs(scaled - natural) <= 1 ? natural : scaled }
  })
  return { ...a, ships }
}

export const ANOMALIES: readonly AnomalyDef[] = ANOMALIES_BASE.map(reratedCard)

export function buildAnomalyCatalog(): ReadonlyMap<string, AnomalyDef> {
  return new Map(ANOMALIES.map((a) => [a.id, a]))
}

export const ANOMALIES_FLAVORED: readonly AnomalyDef[] = ANOMALIES
