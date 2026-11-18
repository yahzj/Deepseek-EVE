import type { DamageResists, SimContext, DamageType } from '../../types'
import { clamp, RESIST_FLOOR } from '../combatMath'
import type { GameState } from '../../state'
import { familyModules } from '../../equipment'

export const WEB_BREAK_DIST_M = 4_500

export const MY_WEB_RANGE_M = 3_800

export function applyAdds(out: DamageResists, add: DamageResists | undefined): void {
  if (!add) return
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const a = add[t] ?? 0
    if (a <= 0) continue
    const cur = out[t] ?? 0
    out[t] = clamp(RESIST_FLOOR, 0.9, 1 - (1 - cur) * (1 - a))
  }
}

export function mergeResist(base: DamageResists | undefined, add: DamageResists | undefined): DamageResists {
  const out: DamageResists = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    out[t] = clamp(RESIST_FLOOR, 0.9, 1 - (1 - (base?.[t] ?? 0)) * (1 - (add?.[t] ?? 0)))
  }
  return out
}

export function damageUpgradeMult(state: GameState): number {
  return 1 + 0.015 * Math.min(5, state.skills.trained['advanced-gunnery'] ?? 0)
}

export function familyUpgradeSkillIdOf(famKey: 'turret' | 'missile' | 'laser'): string {
  return famKey === 'turret' ? 'kinetic-ballistics' : famKey === 'missile' ? 'missile-guidance' : 'beam-focusing'
}

export function familyUpgradeMult(state: GameState, famKey: 'turret' | 'missile' | 'laser' | null): number {
  if (famKey === null) return 1
  return 1 + 0.015 * Math.min(5, state.skills.trained[familyUpgradeSkillIdOf(famKey)] ?? 0)
}

export function hitUpgradeMult(state: GameState): number {
  return 1 + 0.01 * Math.min(5, state.skills.trained['fire-control-integration'] ?? 0)
}

export function reloadUpgradeMult(state: GameState): number {
  return 1 - 0.015 * Math.min(5, state.skills.trained['rapid-reload'] ?? 0)
}

export function droneReloadUpgradeMult(state: GameState): number {
  return 1 - 0.015 * Math.min(5, state.skills.trained['drone-servicing-integration'] ?? 0)
}

export function playerAmmoType(state: GameState, ctx: SimContext, shipId: string): DamageType {
  const weapons = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  return (weapons[0]?.damageType as DamageType | undefined) ?? 'kinetic'
}

export const AMMO_IDS: Record<DamageType, string> = {
  kinetic: 'ammo-kinetic-l',
  explosive: 'ammo-explosive-l',
  plasma: 'ammo-plasma-l',
}

export function ammoIdFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  battleIds?: Partial<Record<DamageType, string>> | null,
): string {
  const override = battleIds?.[type]
  if (override && ctx.items.has(override)) return override
  const pref = state.fleet[shipId]?.ammoPref?.[type]
  if (pref && ctx.items.has(pref)) return pref
  return AMMO_IDS[type]
}

export const DRONE_SKILL = {
  warfarePerLevel: 0.05,
  strikePerLevel: 0.04,
  durabilityPerLevel: 0.04,
  reinforcePerLevel: 0.06,
  evasionPerLevel: 0.02,
  recoveryBase: 0.2,
  recoveryPerLevel: 0.06,
  recoveryMax: 0.5,
} as const

export function droneSkillLv(state: GameState, id: string): number {
  return Math.min(5, state.skills.trained[id] ?? 0)
}
