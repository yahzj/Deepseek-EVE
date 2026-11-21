import type { PlayerStationBill } from './types'
import type { PlayerStationPopulation, PopulationAction, PopulationHost, PopulationReason, PopulationTrip } from './populationTypes'

export const POPULATION_SOURCE_COUNT = 6
export const POPULATION_UNIT_M3 = 100
export const POPULATION_REVIVAL_MS = 10 * 60_000
export const POPULATION_RECEIVE_MS = 2 * 60_000
export const POPULATION_LOCAL_TRAVEL_MS = 2 * 60_000
export const POPULATION_REVIVAL_BILL: PlayerStationBill = { 'repairkit-civ': 4, 'part-coolant': 20, 'part-circuit': 10 }

export function createStationPopulation(): PlayerStationPopulation {
  return { version: 1, people: Array.from({ length: POPULATION_SOURCE_COUNT }, () => ({ status: 'dormant', receiveMs: 0 })), sourceMaterials: {} }
}

function counts(state: PlayerStationPopulation) {
  const residents = state.people.filter(p => p.status === 'resident').length
  const reserved = state.people.filter(p => p.status !== 'dormant' && p.status !== 'resident').length
  return { residents, reserved, dormant: POPULATION_SOURCE_COUNT - residents - reserved,
    protected: state.people.filter(p => p.status === 'protected').length }
}
function ready(state: PlayerStationPopulation, host: PopulationHost) {
  const reception = host.reception(), population = counts(state)
  return reception.ready && reception.capacity >= population.residents + population.reserved
}
function phase(trip: PopulationTrip, next: PopulationTrip['phase']) {
  trip.phase = next
  trip.progressMs = 0
}
function finish(state: PlayerStationPopulation, host: PopulationHost, location: 'home' | 'source') {
  const trip = state.trip!
  if (Object.keys(trip.cargo).length > 0) host.give(trip.cargo)
  host.releaseShip(trip.shipId, location)
  delete state.trip
  if (state.plan?.stopped || state.plan?.remaining === 0) delete state.plan
}
function protect(state: PlayerStationPopulation, host: PopulationHost) {
  for (const index of state.trip!.people) state.people[index].status = 'protected'
  finish(state, host, 'source')
}

function departure(state: PlayerStationPopulation, host: PopulationHost): PopulationReason | undefined {
  const plan = state.plan!
  if (!host.sourceKnown()) return 'source'
  if (!ready(state, host)) return 'facilities'
  const ship = host.ship(plan.shipId)
  if (!ship?.available || !ship.auxiliary || ship.location === 'elsewhere' || !Number.isFinite(ship.freeM3) || ship.freeM3 < POPULATION_UNIT_M3) return 'ship'
  const population = counts(state)
  const capacity = Math.max(0, host.reception().capacity - population.residents - population.reserved)
  const protectedPeople = state.people.flatMap((person, index) => person.status === 'protected' ? [index] : [])
  const limit = population.residents === 0 ? 1 : POPULATION_SOURCE_COUNT
  const slots = Math.min(plan.remaining, Math.floor(ship.freeM3 / POPULATION_UNIT_M3), limit, protectedPeople.length + Math.min(population.dormant, capacity))
  if (slots < 1) return 'capacity'
  const queue = protectedPeople.slice(0, slots)
  const newUnits = slots - queue.length
  const bill: Record<string, number> = {}
  for (const [id, n] of Object.entries(POPULATION_REVIVAL_BILL)) {
    const needed = Math.max(0, n * newUnits - (state.sourceMaterials[id] ?? 0))
    if (needed > 0) bill[id] = needed
  }
  // 来源站停靠船只不能隔空装载共仓物资；先由空船真实返回玩家站。
  const reposition = ship.location === 'source' && Object.keys(bill).length > 0
  if (!reposition && Object.entries(bill).some(([id, n]) => host.available(id) < n)) return 'materials'
  if (!host.claimShip(plan.shipId)) return 'ship'
  if (!reposition && !host.take(bill)) { host.releaseShip(plan.shipId, ship.location as 'home' | 'source'); return 'materials' }
  state.trip = { shipId: plan.shipId, phase: reposition ? 'empty-home' : ship.location === 'home' ? 'loading' : 'processing',
    progressMs: 0, positionMs: ship.location === 'home' ? 0 : POPULATION_LOCAL_TRAVEL_MS, slots,
    people: [], protectedQueue: queue, cargo: reposition ? {} : bill, safety: false }
  return undefined
}

function startUnit(state: PlayerStationPopulation, host: PopulationHost): boolean {
  const trip = state.trip!, plan = state.plan!
  if (plan.stopped || trip.safety || !ready(state, host) || trip.people.length >= trip.slots) return false
  let index = trip.protectedQueue.shift()
  if (index === undefined) {
    const population = counts(state)
    if (population.residents + population.reserved >= host.reception().capacity) return false
    index = state.people.findIndex(p => p.status === 'dormant')
    if (index < 0 || Object.entries(POPULATION_REVIVAL_BILL).some(([id, n]) => (state.sourceMaterials[id] ?? 0) < n)) return false
    for (const [id, n] of Object.entries(POPULATION_REVIVAL_BILL)) {
      state.sourceMaterials[id] -= n
      if (state.sourceMaterials[id] === 0) delete state.sourceMaterials[id]
    }
  }
  state.people[index].status = 'processing'
  trip.active = index
  trip.people.push(index)
  trip.progressMs = 0
  return true
}

/** 只协调当前时点，不把等待算作施工或人口处理工时。 */
export function reconcileStationPopulation(state: PlayerStationPopulation, host: PopulationHost): void {
  if (!state.plan) return
  if (!state.trip) {
    if (state.plan.stopped || state.plan.remaining === 0) { delete state.plan; return }
    departure(state, host)
  }
  const trip = state.trip
  if (!trip) return
  if (!ready(state, host)) {
    if (trip.people.length > 0) trip.safety = true
    if (trip.phase === 'loading') { finish(state, host, 'home'); return }
    if (trip.phase === 'outbound') phase(trip, 'empty-home')
    if (trip.phase === 'inbound' || trip.phase === 'receiving') {
      for (const index of trip.people) state.people[index].status = 'aboard'
      delete trip.active
      phase(trip, 'safety-return')
    }
    if (trip.phase === 'boarding') { protect(state, host); return }
  }
  if (state.plan?.stopped && trip.people.length === 0) {
    if (trip.positionMs === 0) { finish(state, host, 'home'); return }
    phase(trip, 'empty-home')
  }
  if (trip.phase === 'empty-home' && trip.positionMs === 0) { finish(state, host, 'home'); return }
  if (trip.phase === 'safety-return' && trip.positionMs === POPULATION_LOCAL_TRAVEL_MS) { protect(state, host); return }
  if (trip.phase === 'processing' && trip.active === undefined && !startUnit(state, host)) {
    if (trip.safety) { protect(state, host); return }
    phase(trip, trip.people.length > 0 ? 'boarding' : 'empty-home')
  }
  if (trip.phase === 'receiving' && trip.active === undefined) {
    const index = trip.people[0]
    if (index === undefined) finish(state, host, 'home')
    else { trip.active = index; trip.progressMs = state.people[index].receiveMs; state.people[index].status = 'receiving' }
  }
}

function remaining(trip: PopulationTrip) {
  if (trip.phase === 'outbound' || trip.phase === 'safety-return') return POPULATION_LOCAL_TRAVEL_MS - trip.positionMs
  if (trip.phase === 'inbound' || trip.phase === 'empty-home') return trip.positionMs
  return (trip.phase === 'processing' ? POPULATION_REVIVAL_MS : trip.phase === 'receiving' ? POPULATION_RECEIVE_MS : 60_000) - trip.progressMs
}

export function stationPopulationNextEventMs(state: PlayerStationPopulation): number {
  return state.trip ? remaining(state.trip) : Infinity
}

export function advanceStationPopulation(state: PlayerStationPopulation, host: PopulationHost, deltaMs: number, deferBoundary = false): void {
  if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) throw new Error('Invalid population elapsed time')
  let left = deltaMs
  reconcileStationPopulation(state, host)
  while (state.trip && left > 0) {
    const trip = state.trip
    const step = Math.min(left, remaining(trip))
    trip.progressMs += step
    if (trip.phase === 'outbound' || trip.phase === 'safety-return') trip.positionMs += step
    if (trip.phase === 'inbound' || trip.phase === 'empty-home') trip.positionMs -= step
    if (trip.phase === 'receiving' && trip.active !== undefined) state.people[trip.active].receiveMs = trip.progressMs
    left -= step
    if (remaining(trip) > 0) break
    if (trip.phase === 'loading') phase(trip, 'outbound')
    else if (trip.phase === 'outbound') {
      for (const [id, n] of Object.entries(trip.cargo)) state.sourceMaterials[id] = (state.sourceMaterials[id] ?? 0) + n
      trip.cargo = {}
      phase(trip, 'processing')
    } else if (trip.phase === 'processing') {
      if (trip.active !== undefined) state.people[trip.active].status = 'waiting'
      delete trip.active
      if (trip.safety) protect(state, host)
      else phase(trip, 'processing')
    } else if (trip.phase === 'boarding') {
      for (const index of trip.people) state.people[index].status = 'aboard'
      phase(trip, 'inbound')
    } else if (trip.phase === 'inbound') phase(trip, 'receiving')
    else if (trip.phase === 'receiving') {
      const index = trip.active!
      state.people[index].status = 'resident'
      trip.people = trip.people.filter(person => person !== index)
      state.plan!.remaining--
      delete trip.active
      trip.progressMs = 0
      if (trip.people.length === 0) finish(state, host, 'home')
    } else if (trip.phase === 'safety-return') protect(state, host)
    else finish(state, host, 'home')
    // 宿主可先结算同一时刻的设施变化，再协调下一单位，避免借用已经失效的接收条件。
    if (left > 0 || !deferBoundary) reconcileStationPopulation(state, host)
  }
}

export function stationPopulationCommand(state: PlayerStationPopulation, host: PopulationHost, action: PopulationAction): { ok: true } | { ok: false; reason: PopulationReason } {
  if (action.kind === 'stop') {
    if (!state.plan) return { ok: false, reason: 'no-plan' }
    state.plan.stopped = true
    reconcileStationPopulation(state, host)
    return { ok: true }
  }
  if (state.plan || state.trip) return { ok: false, reason: 'busy' }
  if (!host.sourceKnown()) return { ok: false, reason: 'source' }
  if (!Number.isSafeInteger(action.count) || action.count < 1 || action.count > counts(state).dormant + counts(state).protected
    || typeof action.shipId !== 'string' || !action.shipId) return { ok: false, reason: 'invalid-count' }
  state.plan = { shipId: action.shipId, remaining: action.count, stopped: false }
  reconcileStationPopulation(state, host)
  return { ok: true }
}

export function stationPopulationView(state: PlayerStationPopulation, host: PopulationHost) {
  const population = counts(state)
  const wait = state.plan && !state.trip ? departureReason(state, host) : undefined
  return { ...population, sourceKnown: host.sourceKnown(), capacity: host.reception().capacity, receptionReady: ready(state, host),
    revivalBill: Object.entries(POPULATION_REVIVAL_BILL).map(([itemId, need]) => ({ itemId, need,
      itemName: host.itemName?.(itemId) ?? itemId, available: host.available(itemId), sourceAvailable: state.sourceMaterials[itemId] ?? 0 })),
    sourceMaterials: { ...state.sourceMaterials }, plan: state.plan ? { ...state.plan } : undefined,
    trip: state.trip ? { ...state.trip, people: [...state.trip.people], protectedQueue: [...state.trip.protectedQueue], cargo: { ...state.trip.cargo }, remainingMs: remaining(state.trip) } : undefined,
    people: state.people.map(person => ({ ...person })), wait }
}

function departureReason(state: PlayerStationPopulation, host: PopulationHost): PopulationReason | undefined {
  if (!host.sourceKnown()) return 'source'
  if (!ready(state, host)) return 'facilities'
  const ship = host.ship(state.plan!.shipId)
  if (!ship?.available || !ship.auxiliary || ship.location === 'elsewhere' || ship.freeM3 < 100) return 'ship'
  const population = counts(state)
  if (population.protected === 0 && population.residents + population.reserved >= host.reception().capacity) return 'capacity'
  return 'materials'
}
