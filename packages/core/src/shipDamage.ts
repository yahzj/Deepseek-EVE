import type { GameState } from './state'
import type { ModuleDef } from './types'
import { nextInt, nextRandom } from './rng'

export type ShipDamageKind = 'shield' | 'armor' | 'hull' | 'speed' | 'cargo' | 'range'
export const SHIP_DAMAGE_CHANCE = 0.5
export const SHIP_DAMAGE_PENALTY = 0.05
export const SHIP_DAMAGE_DEFS: readonly { id: ShipDamageKind; nameId: string; descriptionId: string }[] = [
  { id: 'shield', nameId: 'ui.shipDamage.001', descriptionId: 'ui.shipDamage.007' },
  { id: 'armor', nameId: 'ui.shipDamage.002', descriptionId: 'ui.shipDamage.008' },
  { id: 'hull', nameId: 'ui.shipDamage.003', descriptionId: 'ui.shipDamage.009' },
  { id: 'speed', nameId: 'ui.shipDamage.004', descriptionId: 'ui.shipDamage.010' },
  { id: 'cargo', nameId: 'ui.shipDamage.005', descriptionId: 'ui.shipDamage.011' },
  { id: 'range', nameId: 'ui.shipDamage.006', descriptionId: 'ui.shipDamage.012' },
]

export function cleanShipDamage(raw: unknown): ShipDamageKind[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ShipDamageKind[] = []
  for (const value of raw) {
    const def = SHIP_DAMAGE_DEFS.find(row => row.id === value)
    if (!def) continue
    out.push(def.id)
  }
  return out.length ? out : undefined
}

/** 战损作用于加成后的最终属性；同种逐件乘算，无玩法上限，不进入普通插件叠加池。 */
export function shipDamageEffects(
  ids: readonly ShipDamageKind[] | undefined,
  management?: ModuleDef['damageManagement'],
): Record<ShipDamageKind, number> {
  const effects = Object.fromEntries(SHIP_DAMAGE_DEFS.map(def => [def.id, 1])) as Record<ShipDamageKind, number>
  const penalty = SHIP_DAMAGE_PENALTY * (1 - Math.max(0, Math.min(1, management?.penaltyReductionPct ?? 0)))
  for (const id of cleanShipDamage(ids) ?? []) effects[id] *= 1 - penalty
  return effects
}

/** 结构抗性按战损插件数量计数；原数组与每件战损的属性惩罚均保留。 */
export function shipDamageHullResistOf(ids: readonly ShipDamageKind[] | undefined, management?: ModuleDef['damageManagement']): number {
  if (!management) return 0
  const count = Math.min((cleanShipDamage(ids) ?? []).length, Math.max(0, Math.floor(management.maxKinds)))
  return count * management.hullResistPerKind
}

export function rollShipDamage(state: GameState, previous?: readonly ShipDamageKind[]): ShipDamageKind[] {
  const ids = cleanShipDamage(previous) ?? []
  if (nextRandom(state.rng) >= SHIP_DAMAGE_CHANCE) return ids
  return [...ids, SHIP_DAMAGE_DEFS[nextInt(state.rng, SHIP_DAMAGE_DEFS.length)]!.id]
}
