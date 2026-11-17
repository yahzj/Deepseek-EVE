import type { BattleFx, DamageType } from '@whale/core'

export const FLY_MS = 420

export const BOLT_LOOK: Record<DamageType, { fly: number; dash: number | null }> = {
  kinetic: { fly: 420, dash: null },
  explosive: { fly: 760, dash: 14 },
  plasma: { fly: 130, dash: null },
}

export const DRONE_FLY_MUL = 0.55
export const DRONE_SENTRY_FLY_MUL = 1.6

export function droneFlyMul(artId: string | undefined): number {
  if (artId === undefined) return DRONE_FLY_MUL
  return artId.endsWith('-sentry') ? DRONE_SENTRY_FLY_MUL : DRONE_FLY_MUL
}

export function boltFlightMs(
  type: DamageType,
  src?: BattleFx['src'],
  artId?: string,
): number {
  const look = BOLT_LOOK[type] ?? BOLT_LOOK.kinetic
  if (src === 'drone') return Math.max(60, Math.round(look.fly * droneFlyMul(artId)))
  return look.fly
}

export function explosionDelayMs(killerType: DamageType | undefined): number {
  return killerType === undefined ? FLY_MS : (BOLT_LOOK[killerType]?.fly ?? FLY_MS)
}
