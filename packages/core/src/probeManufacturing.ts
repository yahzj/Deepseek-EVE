import type { GameState } from './state'

export const DEEP_SPACE_PROBE_BLUEPRINT_ID = 'bp-deep-space-probe'
export const DEEP_SPACE_SKILL_IDS: readonly string[] = [
  'deep-space-probing',
  'advanced-deep-space-probing',
  'stellar-archive',
  'probe-assembly',
]

export const PROBE_MATERIAL_PER_LEVEL = 0.04

export function probeMaterialFactor(state: GameState): number {
  const raw = state.skills.trained['probe-assembly'] ?? 0
  const level = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.floor(raw))) : 0
  return 1 - PROBE_MATERIAL_PER_LEVEL * level
}

export function probeManufacturingUnlocked(state: GameState): boolean {
  return state.planetary?.runtimeVersion === 1
}
