import type { GeneratedStellarSystem, StellarPlanetKind, StellarSystemKind } from './stellarTypes'
import type { PlanetCatalog, PlanetTraitDef, PlanetTraitKind } from './planetTypes'
import { hashSeed, nextInt, pickWeighted } from './rng'
import type { PlanetDef, PlanetState } from './planetTypes'

export const STELLAR_GENERATION_VERSION = 1
export function stellarSystemId(seed: number): string { return `system-v1-${seed}` }
export function parseStellarSeed(raw: string): number | undefined {
  if (typeof raw !== 'string' || !/^\d{1,10}$/.test(raw.trim())) return undefined
  const n = Number(raw.trim())
  return Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff ? n : undefined
}

// v1的生成参数冻结，不跟随当前内容表新增项或运行数值漂移。
const V1_TRAITS: readonly PlanetTraitDef[] = [
  { id: 'temperate', kind: 'environment', weight: 3, exclusiveGroup: 'temperature', hazard: -10, habitability: 20 },
  { id: 'cold', kind: 'environment', weight: 2, exclusiveGroup: 'temperature', hazard: 10, habitability: -15, obstacle: 'ice' },
  { id: 'hot', kind: 'environment', weight: 2, exclusiveGroup: 'temperature', hazard: 15, habitability: -15 },
  { id: 'low-gravity', kind: 'environment', weight: 2, exclusiveGroup: 'gravity', hazard: 5, habitability: -5 },
  { id: 'high-gravity', kind: 'environment', weight: 2, exclusiveGroup: 'gravity', hazard: 15, habitability: -10, obstacle: 'rough' },
  { id: 'corrosive', kind: 'environment', weight: 2, exclusiveGroup: 'atmosphere', hazard: 20, habitability: -15, obstacle: 'corrosion' },
  { id: 'radiation', kind: 'environment', weight: 2, hazard: 15, habitability: -20 },
  { id: 'active-geology', kind: 'environment', weight: 2, hazard: 20, habitability: -5, obstacle: 'rough' },
  { id: 'metal-veins', kind: 'resource', weight: 3, deposit: { resource: 'metal', minCells: 1, maxCells: 2, bonus: .2 } },
  { id: 'ice-deposits', kind: 'resource', weight: 2, deposit: { resource: 'water', minCells: 1, maxCells: 2, bonus: .2 } },
  { id: 'fertile-soil', kind: 'resource', weight: 2, deposit: { resource: 'food', minCells: 1, maxCells: 2, bonus: .2 } },
  { id: 'rare-crystals', kind: 'resource', weight: 1, deposit: { resource: 'rare', minCells: 1, maxCells: 1, bonus: .2 } },
  { id: 'underground-ruins', kind: 'special', weight: 1, obstacle: 'rubble', deposit: { resource: 'research', minCells: 1, maxCells: 1, bonus: .2 } },
  { id: 'geothermal', kind: 'special', weight: 2, deposit: { resource: 'energy', minCells: 1, maxCells: 1, bonus: .2 } },
  { id: 'old-dome', kind: 'special', weight: 1 },
]
const KINDS: readonly { kind: StellarSystemKind; weight: number; min: number; max: number }[] = [
  { kind: 'single', weight: 60, min: 3, max: 7 }, { kind: 'binary', weight: 15, min: 3, max: 8 },
  { kind: 'white-dwarf', weight: 10, min: 2, max: 5 }, { kind: 'neutron', weight: 7, min: 2, max: 5 },
  { kind: 'black-hole', weight: 5, min: 2, max: 4 }, { kind: 'rogue', weight: 3, min: 2, max: 4 },
]

export function generateStellarSystem(seed: number): GeneratedStellarSystem {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('invalid-stellar-seed')
  const id = stellarSystemId(seed)
  const rng = { seed: hashSeed(`stellar:1:${seed}`), count: 0 }
  const configuration = pickWeighted(rng, KINDS, c => c.weight)!
  const count = configuration.min + nextInt(rng, configuration.max - configuration.min + 1)
  const starClass = configuration.kind === 'single' || configuration.kind === 'binary'
    ? (['yellow', 'orange', 'red', 'blue'] as const)[nextInt(rng, 4)]!
    : configuration.kind === 'white-dwarf' ? 'white' : configuration.kind === 'neutron' ? 'neutron' : configuration.kind === 'black-hole' ? 'black-hole' : 'none'
  const stars = configuration.kind === 'rogue' ? [] : configuration.kind === 'binary'
    ? [{ x: 475, y: 350, radius: 15 }, { x: 525, y: 350, radius: 12 }] : [{ x: 500, y: 350, radius: starClass === 'neutron' ? 9 : 20 }]
  const system: GeneratedStellarSystem['system'] = { id, generationVersion: 1, seed, kind: configuration.kind, starClass,
    stars, bodies: [], routeMinutes: 20 + nextInt(rng, 101) }
  const planets: GeneratedStellarSystem['planets'] = []
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const local = { seed: hashSeed(`${id}:body:${ordinal}`), count: 0 }
    const radius = 65 + ordinal * (245 / count)
    const angle = nextInt(local, 360) * Math.PI / 180
    const dark = ['white-dwarf', 'black-hole', 'rogue'].includes(configuration.kind)
    const gas = ordinal !== 1 && nextInt(local, 5) === 0
    const zone = ordinal / count
    const choices: readonly StellarPlanetKind[] = dark || zone > .75 ? ['rocky', 'ice', 'ice'] : zone < .35 ? ['desert', 'lava', 'rocky'] : ['temperate', 'ocean', 'rocky']
    const kind: StellarPlanetKind = gas ? 'gas' : choices[nextInt(local, choices.length)]!
    const size = (4 + nextInt(local, 3)) as 4 | 5 | 6
    const bodyId = `${id}-p${ordinal}`
    system.bodies.push({ planetId: bodyId, ordinal, kind, orbit: radius,
      x: Math.round(500 + Math.cos(angle) * radius), y: Math.round(350 + Math.sin(angle) * radius) })
    const wantedTemperature = dark || kind === 'ice' ? 'cold' : kind === 'lava' || kind === 'desert' ? 'hot' : kind === 'temperate' || kind === 'ocean' ? 'temperate' : undefined
    const catalog: PlanetCatalog = { planets: new Map(), buildings: new Map(), traits: new Map(V1_TRAITS.map(trait => [trait.id, {
      ...trait,
      weight: trait.kind === 'environment' && trait.exclusiveGroup === 'temperature' ? (trait.id === wantedTemperature ? 12 : 0)
        : kind === 'lava' && ['cold', 'fertile-soil', 'ice-deposits'].includes(trait.id) ? 0
        : kind === 'ice' && ['hot', 'fertile-soil'].includes(trait.id) ? 0
        : configuration.kind === 'neutron' && trait.id === 'radiation' ? 12 : trait.weight,
    }])) }
    const required = [wantedTemperature, configuration.kind === 'neutron' ? 'radiation' : undefined].filter((id): id is string => !!id)
    const p = generateSurfaceV1({ id: bodyId, galaxyId: id, size }, hashSeed(`${id}:surface:${ordinal}`), catalog, required)
    p.systemId = id
    p.surfaceAllowed = !gas
    planets.push(p)
  }
  return { system, planets }
}

/** v1地表算法与选择表一起冻结，新增运行时内容不会改变旧坐标。 */
function generateSurfaceV1(def: PlanetDef, seed: number, catalog: PlanetCatalog, required: readonly string[]): PlanetState {
  const rng = { seed, count: 0 }
  const traits = [...catalog.traits.values()].sort((a, b) => a.id < b.id ? -1 : 1)
  const selected: PlanetTraitDef[] = required.map(id => catalog.traits.get(id)!)
  const choose = (kind: PlanetTraitKind, count: number): void => {
    for (let i = 0; i < count; i++) {
      const t = pickWeighted(rng, traits.filter(t => t.kind === kind && t.weight > 0
        && selected.every(other => other.id !== t.id && !(t.exclusiveGroup && t.exclusiveGroup === other.exclusiveGroup)
          && !t.conflicts?.includes(other.id) && !other.conflicts?.includes(t.id))), t => t.weight)
      if (!t) break
      selected.push(t)
    }
  }
  choose('environment', 2 + nextInt(rng, 3) - selected.length); choose('resource', 1 + nextInt(rng, 3)); choose('special', nextInt(rng, 3))
  const cells: PlanetState['cells'] = Array.from({ length: def.size ** 2 }, (_, index) => ({ index }))
  const shuffle = (): number[] => {
    const ids = cells.map(c => c.index)
    for (let i = ids.length - 1; i > 0; i--) { const j = nextInt(rng, i + 1); [ids[i], ids[j]] = [ids[j]!, ids[i]!] }
    return ids
  }
  const positions = shuffle()
  let cursor = 0
  for (const trait of selected) if (trait.deposit) {
    const d = trait.deposit, count = d.minCells + nextInt(rng, d.maxCells - d.minCells + 1)
    for (let i = 0; i < count; i++) cells[positions[cursor++]!]!.deposit = { resource: d.resource, sourceTraitId: trait.id, bonus: d.bonus }
  }
  const minimum = Math.ceil(cells.length * .2), maximum = Math.floor(cells.length * .35)
  const types = selected.flatMap(t => t.obstacle ? [t.obstacle] : [])
  if (!types.length) types.push('rough')
  for (const index of shuffle().slice(0, minimum + nextInt(rng, maximum - minimum + 1))) cells[index]!.obstacle = types[nextInt(rng, types.length)]!
  return { ...def, generationVersion: 1, seed, traitIds: selected.map(t => t.id), hiddenTraitId: selected[nextInt(rng, selected.length)]!.id, survey: 1, cells }
}

/** 当前表只解释运行参数，v1随机选择和地表生成不读取它。 */
export function stellarPlanetCatalog(catalog: PlanetCatalog, planets: readonly import('./planetTypes').PlanetState[]): PlanetCatalog {
  return { ...catalog, planets: new Map([...catalog.planets, ...planets.map(p => [p.id, { id: p.id, galaxyId: p.galaxyId, size: p.size }] as const)]) }
}
