import type { PlanetActionResult, PlanetCatalog, PlanetColonyState, PlanetLocalResource, PlanetState } from './planetTypes'
import { planetBuildingOutputMul, planetAdjacencyOf } from './planetGrid'
import { planetEnvironmentOf, planetRulesSupported } from './planetRules'

export const PLANET_TICK_MS = 10_000
export const PLANET_WAKE_RESERVE_HOURS = 24
export const PLANET_WEAR_PER_HOUR = 0.005
export const PLANET_POPULATION_USE = { food: 1, water: 1, medicine: 0.1 } as const
const RESOURCES: readonly PlanetLocalResource[] = ['food', 'water', 'medicine', 'metal', 'parts', 'research', 'rare']

export function createPlanetColony(): PlanetColonyState {
  return { runtimeVersion: 1, items: {}, credits: 0, supplies: {}, awake: 0, sleeping: 0,
    jobs: [], jobSeq: 0, clockMs: 0, tickRemainderMs: 0, crisis: 'none',
    eventSeq: 0, nextEventMs: 0, eventRngCount: 0 }
}

/** 分配只改变临时供电读数；不会自动替玩家开启停用建筑。 */
export function allocatePlanetPower(planet: PlanetState, catalog: PlanetCatalog): void {
  if (!planet.colony || !planetRulesSupported(planet, catalog)) return
  const ready = planet.cells.filter(c => c.building?.status === 'ready' && c.building.enabled !== false
    && (c.building.condition ?? 1) > 0 && !c.obstacle
    && (catalog.buildings.get(c.building.id)?.worker === 'automatic' || c.building.staffed)
    && (!catalog.buildings.get(c.building.id)?.requiredResource || c.deposit?.resource === catalog.buildings.get(c.building.id)?.requiredResource))
  for (const c of planet.cells) if (c.building) c.building.powered = false
  let available = 0
  for (const c of ready) {
    const op = catalog.operations?.get(c.building!.id)
    if (op && op.power < 0) { available += -op.power * (c.building!.condition ?? 1); c.building!.powered = true }
  }
  const consumers = ready.filter(c => (catalog.operations?.get(c.building!.id)?.power ?? Infinity) >= 0)
    .sort((a, b) => (catalog.operations?.get(a.building!.id)?.priority ?? 99) - (catalog.operations?.get(b.building!.id)?.priority ?? 99) || a.index - b.index)
  for (const c of consumers) {
    const need = catalog.operations?.get(c.building!.id)?.power
    if (need !== undefined && need <= available + 1e-9) { available -= need; c.building!.powered = true }
  }
}

export function planetColonyView(planet: PlanetState, catalog: PlanetCatalog) {
  const production: Partial<Record<PlanetLocalResource, number>> = {}
  const consumption: Partial<Record<PlanetLocalResource, number>> = {}
  let powerProduced = 0, powerUsed = 0, housing = 0, cryoCapacity = 0
  let lifeSupport = false
  if (!planetRulesSupported(planet, catalog)) return { powerProduced, powerUsed, housing, cryoCapacity, production, consumption, ready: false, stage: 'unsupported' }
  for (const cell of planet.cells) {
    const b = cell.building
    const op = b ? catalog.operations?.get(b.id) : undefined
    if (!b || !op || b.status !== 'ready' || b.enabled === false || !b.powered || (b.condition ?? 1) <= 0) continue
    if (op.power < 0) powerProduced += -op.power * (b.condition ?? 1)
    else powerUsed += op.power
    housing += op.housing ?? 0
    cryoCapacity += op.cryoCapacity ?? 0
    lifeSupport ||= op.lifeSupport === true
    const hasInputs = Object.entries(op.inputs ?? {}).every(([resource, need]) => need === 0 || (planet.colony?.supplies[resource as PlanetLocalResource] ?? 0) > 0)
    const mul = hasInputs ? planetBuildingOutputMul(planet, cell.index, catalog) * (b.condition ?? 1) : 0
    for (const resource of RESOURCES) {
      production[resource] = (production[resource] ?? 0) + (op.output?.[resource] ?? 0) * mul
      consumption[resource] = (consumption[resource] ?? 0) + (op.inputs?.[resource] ?? 0) * mul
    }
  }
  const awake = planet.colony?.awake ?? 0
  const factor = planetEnvironmentOf(planet, catalog)?.consumptionMul ?? 2
  for (const resource of ['food', 'water', 'medicine'] as const) consumption[resource] = (consumption[resource] ?? 0) + awake * PLANET_POPULATION_USE[resource] * factor
  const ready = lifeSupport && cryoCapacity >= awake + (planet.colony?.sleeping ?? 0) && housing >= awake && powerProduced >= powerUsed
  const stage = !planet.colony ? 'candidate' : awake === 0 ? 'base' : awake >= 4 && (planet.projectHistory?.length ?? 0) > 0 && ready ? 'home' : 'settlement'
  return { powerProduced, powerUsed, housing, cryoCapacity, production, consumption, ready, stage }
}

export function planetWakeCheck(planet: PlanetState, catalog: PlanetCatalog, count: number): PlanetActionResult {
  const colony = planet.colony
  if (!colony || !planetRulesSupported(planet, catalog) || planet.survey < 2) return { ok: false, reason: 'not-ready' }
  if (!Number.isSafeInteger(count) || count < 1 || count > colony.sleeping) return { ok: false, reason: 'population' }
  if (colony.awake === 0 && count !== 1) return { ok: false, reason: 'population' }
  if (colony.crisis !== 'none') return { ok: false, reason: 'crisis' }
  const view = planetColonyView(planet, catalog)
  if (!view.ready || view.housing < colony.awake + count) return { ok: false, reason: 'housing' }
  const factor = planetEnvironmentOf(planet, catalog)!.consumptionMul
  for (const resource of ['food', 'water', 'medicine'] as const) {
    const totalUse = (view.consumption[resource] ?? 0) + count * PLANET_POPULATION_USE[resource] * factor
    const netDeficit = Math.max(0, totalUse - (view.production[resource] ?? 0))
    const emergency = (colony.awake + count) * (resource === 'medicine' ? 1 : 2)
    if ((colony.supplies[resource] ?? 0) < netDeficit * PLANET_WAKE_RESERVE_HOURS + emergency) return { ok: false, reason: 'reserves' }
  }
  return { ok: true }
}

export function wakePlanetPopulation(planet: PlanetState, catalog: PlanetCatalog, count: number): PlanetActionResult {
  const check = planetWakeCheck(planet, catalog, count)
  if (!check.ok) return check
  planet.colony!.sleeping -= count
  planet.colony!.awake += count
  return { ok: true }
}

export function sleepPlanetPopulation(planet: PlanetState, catalog: PlanetCatalog, count: number): PlanetActionResult {
  const c = planet.colony
  if (!c || !Number.isSafeInteger(count) || count < 1 || count > c.awake) return { ok: false, reason: 'population' }
  const view = planetColonyView(planet, catalog)
  if (view.cryoCapacity < c.awake + c.sleeping || (c.supplies.medicine ?? 0) < count) return { ok: false, reason: 'reserves' }
  c.supplies.medicine = (c.supplies.medicine ?? 0) - count
  c.awake -= count; c.sleeping += count
  let keep = c.awake
  for (const cell of planet.cells) if (cell.building?.staffed && catalog.buildings.get(cell.building.id)?.worker === 'human') {
    if (keep-- <= 0) cell.building.staffed = false
  }
  c.crisis = 'sheltered'
  return { ok: true }
}

export function assignPlanetWorker(planet: PlanetState, catalog: PlanetCatalog, index: number, staffed: boolean): PlanetActionResult {
  const c = planet.colony, b = planet.cells[index]?.building
  if (!c || !Number.isSafeInteger(index) || !b || b.status !== 'ready' || catalog.buildings.get(b.id)?.worker !== 'human') return { ok: false, reason: 'not-ready' }
  const workers = planet.cells.filter(cell => cell.building?.staffed && catalog.buildings.get(cell.building.id)?.worker === 'human').length
  if (staffed && !b.staffed && workers >= c.awake) return { ok: false, reason: 'population' }
  b.staffed = staffed
  allocatePlanetPower(planet, catalog)
  return { ok: true }
}

export function repairPlanetBuilding(planet: PlanetState, catalog: PlanetCatalog, index: number): PlanetActionResult {
  const c = planet.colony, b = planet.cells[index]?.building
  if (!c || !b || b.status !== 'ready' || !planetRulesSupported(planet, catalog)) return { ok: false, reason: 'not-ready' }
  const wear = 1 - (b.condition ?? 1)
  const need = Math.ceil(wear * 20 * planetEnvironmentOf(planet, catalog)!.repairMul)
  if (!need) return { ok: false, reason: 'not-needed' }
  if ((c.supplies.parts ?? 0) < need) return { ok: false, reason: 'materials' }
  c.supplies.parts = (c.supplies.parts ?? 0) - need
  b.condition = 1
  allocatePlanetPower(planet, catalog)
  return { ok: true }
}

/** 固定量子保留余数，在线小步与离线推进共享同一套产消及保护。 */
export function tickPlanetColony(planet: PlanetState, catalog: PlanetCatalog, deltaMs: number): void {
  const c = planet.colony
  if (!c || !planetRulesSupported(planet, catalog)) return
  allocatePlanetPower(planet, catalog)
  const hours = deltaMs / 3_600_000
  const environment = planetEnvironmentOf(planet, catalog)!
  for (const cell of planet.cells) {
    const b = cell.building, op = b ? catalog.operations?.get(b.id) : undefined
    if (!b || !op || b.status !== 'ready' || !b.powered || b.enabled === false) continue
    const mul = planetBuildingOutputMul(planet, cell.index, catalog) * (b.condition ?? 1)
    let inputFactor = 1
    for (const resource of RESOURCES) {
      const need = (op.inputs?.[resource] ?? 0) * mul * hours
      if (need > 0) inputFactor = Math.min(inputFactor, (c.supplies[resource] ?? 0) / need)
    }
    for (const resource of RESOURCES) {
      const delta = ((op.output?.[resource] ?? 0) - (op.inputs?.[resource] ?? 0)) * mul * hours * inputFactor
      if (delta !== 0) c.supplies[resource] = Math.max(0, (c.supplies[resource] ?? 0) + delta)
    }
    const cut = planetAdjacencyOf(planet, cell.index, catalog).wearCut
    b.condition = Math.max(0, (b.condition ?? 1) - PLANET_WEAR_PER_HOUR * environment.wearMul * (1 - cut) * hours)
    if (b.id === 'maintenance' && (c.supplies.parts ?? 0) > 0) {
      const target = planet.cells.filter(other => other.building?.status === 'ready' && (other.building.condition ?? 1) < .99)
        .sort((a, b) => (a.building!.condition ?? 1) - (b.building!.condition ?? 1) || a.index - b.index)[0]
      if (target) {
        const heal = Math.min(.02 * hours, 1 - (target.building!.condition ?? 1), (c.supplies.parts ?? 0) / (20 * environment.repairMul))
        target.building!.condition = (target.building!.condition ?? 1) + heal
        c.supplies.parts = (c.supplies.parts ?? 0) - heal * 20 * environment.repairMul
      }
    }
  }
  if (c.awake > 0) {
    const view = planetColonyView(planet, catalog)
    const shortage = !view.ready || (['food', 'water', 'medicine'] as const).some(r => (c.supplies[r] ?? 0) < c.awake * PLANET_POPULATION_USE[r] * environment.consumptionMul * hours)
    if (shortage) {
      const result = sleepPlanetPopulation(planet, catalog, c.awake)
      if (!result.ok) c.crisis = 'rescue'
    }
    if (c.crisis !== 'rescue') for (const r of ['food', 'water', 'medicine'] as const) c.supplies[r] = Math.max(0, (c.supplies[r] ?? 0) - c.awake * PLANET_POPULATION_USE[r] * environment.consumptionMul * hours)
  }
  if (c.crisis === 'rescue') for (const cell of planet.cells) if (cell.building && catalog.buildings.get(cell.building.id)?.worker === 'human') cell.building.staffed = false
  if (c.crisis === 'rescue' && c.awake > 0) {
    const v = planetColonyView(planet, catalog)
    if (v.ready && (c.supplies.food ?? 0) >= c.awake * 2 && (c.supplies.water ?? 0) >= c.awake * 2 && (c.supplies.medicine ?? 0) >= c.awake) c.crisis = 'none'
  }
  if (c.crisis === 'sheltered' && planetColonyView(planet, catalog).ready
    && (c.supplies.food ?? 0) >= Math.max(4, c.awake * 2) && (c.supplies.water ?? 0) >= Math.max(4, c.awake * 2)
    && (c.supplies.medicine ?? 0) >= Math.max(2, c.awake)) c.crisis = 'none'
  allocatePlanetPower(planet, catalog)
}
