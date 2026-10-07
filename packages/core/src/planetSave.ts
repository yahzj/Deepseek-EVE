import type { PlanetGridCell, PlanetObstacle, PlanetResource, PlanetaryState, PlanetState } from './planetTypes'
import { PLANET_RULES } from './planetRules'

function record(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
}
function id(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(raw)
}
function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter(id))].slice(0, 9) : []
}
const RESOURCES: readonly PlanetResource[] = ['metal', 'water', 'food', 'research', 'rare', 'energy']
const OBSTACLES: readonly PlanetObstacle[] = ['rough', 'ice', 'corrosion', 'rubble']

export function cleanPlanetaryState(raw: unknown): PlanetaryState | undefined {
  const source = record(record(raw).planets)
  const planets: Record<string, PlanetState> = {}
  for (const [key, value] of Object.entries(source).slice(0, PLANET_RULES.maxPlanets)) {
    const p = record(value)
    if (!id(key) || p.id !== key || !id(p.galaxyId) || (p.size !== 4 && p.size !== 5 && p.size !== 6)) continue
    if (!Number.isSafeInteger(p.seed) || (p.seed as number) < 0 || (p.seed as number) > 0xffffffff) continue
    if (!Number.isSafeInteger(p.generationVersion) || (p.generationVersion as number) < 1) continue
    const traitIds = strings(p.traitIds)
    if (!traitIds.length || !id(p.hiddenTraitId) || !traitIds.includes(p.hiddenTraitId)) continue
    const cells: PlanetGridCell[] = []
    const rawCells = Array.isArray(p.cells) ? p.cells : []
    if (rawCells.length !== p.size ** 2) continue
    let invalid = false
    for (let index = 0; index < rawCells.length; index++) {
      const c = record(rawCells[index])
      // 不补空地或重生成，避免损坏地图被清洗成可免费建设的地图。
      if (c.index !== index || (c.obstacle !== undefined && !OBSTACLES.includes(c.obstacle as PlanetObstacle))) { invalid = true; break }
      const cell: PlanetGridCell = { index }
      if (c.obstacle !== undefined) cell.obstacle = c.obstacle as PlanetObstacle
      if (c.deposit !== undefined) {
        const d = record(c.deposit)
        if (!RESOURCES.includes(d.resource as PlanetResource) || !id(d.sourceTraitId) || !traitIds.includes(d.sourceTraitId)
          || typeof d.bonus !== 'number' || !Number.isFinite(d.bonus) || d.bonus < 0 || d.bonus > 1) { invalid = true; break }
        cell.deposit = { resource: d.resource as PlanetResource, sourceTraitId: d.sourceTraitId, bonus: d.bonus }
      }
      if (c.building !== undefined) {
        const b = record(c.building)
        if (!id(b.id) || (b.status !== 'construction' && b.status !== 'ready' && b.status !== 'stopped') || cell.obstacle) { invalid = true; break }
        cell.building = { id: b.id, status: b.status, powered: b.powered === true, staffed: b.staffed === true }
      }
      cells.push(cell)
    }
    if (invalid) continue
    planets[key] = {
      id: key, galaxyId: p.galaxyId, size: p.size, seed: p.seed as number,
      generationVersion: p.generationVersion as number, traitIds, hiddenTraitId: p.hiddenTraitId,
      survey: p.survey === 2 || p.survey === 3 ? p.survey : 1, cells,
    }
  }
  return Object.keys(planets).length ? { planets } : undefined
}
