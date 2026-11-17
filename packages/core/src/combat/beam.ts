import { distFactor } from './combatMath'

export function beamPowerFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  return distFactor(dist, w)
}

export function beamPowerVsTargetOf(
  dist: number,
  w: { minRangeM: number; maxRangeM: number; falloff: number },
  vsDrone: boolean,
): number {
  return vsDrone ? 1 : beamPowerFactor(dist, w)
}
