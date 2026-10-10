import type { PlanetSize, StellarBody } from '@whale/core'

type Body = Pick<StellarBody, 'planetId' | 'kind' | 'x' | 'y'>
type Point = { x: number; y: number }

/** 2026-10-10船长确认：半径∝√地表总格数；固态统一压缩，不读资源/开发占用。 */
export function stellarMapBodyRadii(bodies: readonly Body[], stars: readonly Point[], unit: number,
  sizes: Readonly<Record<string, PlanetSize | undefined>> = {}): Readonly<Record<string, number>> {
  const readableUnit = Number.isFinite(unit) && unit > 0 ? unit : 1
  const requested: Record<string, number> = {}, limits: Record<string, number> = {}
  let solidScale = 1
  for (const body of bodies) {
    const size = sizes[body.planetId]
    const factor = size === 4 || size === 5 || size === 6 ? Math.sqrt(size ** 2 / 25) : 1
    const radius = body.kind === 'gas' ? Math.max(22, 18 * readableUnit) : Math.max(18, 14 * readableUnit) * factor
    const nearest = Math.min(...bodies.filter(other => other.planetId !== body.planetId)
      .map(other => Math.hypot(other.x - body.x, other.y - body.y)),
    ...stars.map(star => Math.hypot(star.x - body.x, star.y - body.y)))
    requested[body.planetId] = radius
    limits[body.planetId] = nearest * .38
    if (body.kind !== 'gas') solidScale = Math.min(solidScale, nearest * .38 / radius)
  }
  return Object.fromEntries(bodies.map(body => [body.planetId, body.kind === 'gas'
    ? Math.min(requested[body.planetId]!, limits[body.planetId]!) : requested[body.planetId]! * solidScale]))
}
