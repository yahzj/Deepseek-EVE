import type { RngState } from './state'
import type { PlanetCatalog, PlanetDef, PlanetState, PlanetTraitDef, PlanetTraitKind } from './planetTypes'
import { hashSeed, nextInt, pickWeighted } from './rng'
import { PLANET_GENERATION_VERSION, PLANET_RULES, planetTraitsCompatible } from './planetRules'
import { planetCatalogIssues } from './planetCatalog'

function shuffled<T>(items: readonly T[], rng: RngState): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function generatePlanet(def: PlanetDef, saveSeed: number, catalog: PlanetCatalog): PlanetState {
  if (![4, 5, 6].includes(def.size) || !/^[a-z][a-z0-9-]{0,127}$/.test(def.id)
    || ['constructor', 'prototype'].includes(def.id)
    || !/^[a-z][a-z0-9-]{0,127}$/.test(def.galaxyId) || !Number.isSafeInteger(saveSeed)) throw new Error('invalid-planet-definition')
  const issues = planetCatalogIssues(catalog)
  if (issues.length) throw new Error(`invalid-planet-catalog:${issues.join(',')}`)
  const seed = hashSeed(`planet:${PLANET_GENERATION_VERSION}:${saveSeed >>> 0}:${def.id}`)
  const rng: RngState = { seed, count: 0 }
  const selected: PlanetTraitDef[] = []
  // 按稳定编号排序，目录插入顺序不改变已确定的抽签。
  const traits = [...catalog.traits.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const choose = (kind: PlanetTraitKind, count: number): void => {
    for (let i = 0; i < count; i++) {
      const pool = traits.filter(t => t.kind === kind && t.weight > 0 && planetTraitsCompatible(t, selected))
      const trait = pickWeighted(rng, pool, t => t.weight)
      if (!trait) throw new Error(`insufficient-planet-traits:${kind}`)
      selected.push(trait)
    }
  }
  choose('environment', 2 + nextInt(rng, 3))
  choose('resource', 1 + nextInt(rng, 3))
  choose('special', nextInt(rng, 3))
  const hiddenTraitId = selected[nextInt(rng, selected.length)]!.id
  const cells: PlanetState['cells'] = Array.from({ length: def.size ** 2 }, (_, index) => ({ index }))
  const positions = shuffled(cells.map(c => c.index), rng)
  let cursor = 0
  for (const trait of selected) {
    const deposit = trait.deposit
    if (!deposit) continue
    const count = deposit.minCells + nextInt(rng, deposit.maxCells - deposit.minCells + 1)
    if (cursor + count > positions.length) throw new Error('planet-resource-overflow')
    for (let i = 0; i < count; i++) cells[positions[cursor++]!]!.deposit = {
      resource: deposit.resource, sourceTraitId: trait.id, bonus: deposit.bonus,
    }
  }
  const min = Math.ceil(cells.length * PLANET_RULES.obstacleMinShare)
  const max = Math.min(Math.floor(cells.length * PLANET_RULES.obstacleMaxShare), cells.length - PLANET_RULES.minFreeCells)
  const obstacleCount = min + nextInt(rng, max - min + 1)
  const obstacleTypes = selected.flatMap(t => t.obstacle ? [t.obstacle] : [])
  if (obstacleTypes.length === 0) obstacleTypes.push('rough')
  for (const index of shuffled(cells.map(c => c.index), rng).slice(0, obstacleCount)) cells[index]!.obstacle = obstacleTypes[nextInt(rng, obstacleTypes.length)]!
  return {
    id: def.id, galaxyId: def.galaxyId, size: def.size,
    generationVersion: PLANET_GENERATION_VERSION, seed,
    traitIds: selected.map(t => t.id), hiddenTraitId, survey: 1, cells,
  }
}
