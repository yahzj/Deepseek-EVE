import type { PlayerStationPopulation, PopulationPhase, PopulationStatus, PopulationTrip } from './populationTypes'
import { POPULATION_LOCAL_TRAVEL_MS, POPULATION_RECEIVE_MS, POPULATION_REVIVAL_BILL, POPULATION_REVIVAL_MS, POPULATION_SOURCE_COUNT } from './population'

const invalid = (): never => { throw new Error('Invalid station population snapshot') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return invalid()
  return value
}
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid() }
function shipId(value: unknown): string { return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : invalid() }
function bill(value: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [id, amount] of Object.entries(record(value))) {
    if (!Object.hasOwn(POPULATION_REVIVAL_BILL, id)) return invalid()
    const n = integer(amount, POPULATION_REVIVAL_BILL[id] * POPULATION_SOURCE_COUNT)
    if (n > 0) result[id] = n
  }
  return result
}
const STATUSES: readonly PopulationStatus[] = ['dormant', 'processing', 'waiting', 'aboard', 'receiving', 'protected', 'resident']
const PHASES: readonly PopulationPhase[] = ['loading', 'outbound', 'processing', 'boarding', 'inbound', 'receiving', 'safety-return', 'empty-home']

/** 人口身份、预留与船只阶段成对校验，不把无效账清空成可重复领取的人口。 */
export function cleanStationPopulation(value: unknown): PlayerStationPopulation {
  const raw = record(value)
  if (raw.version !== 1 || !Array.isArray(raw.people) || raw.people.length !== POPULATION_SOURCE_COUNT) return invalid()
  const people = raw.people.map(entry => {
    const person = record(entry)
    if (!STATUSES.includes(person.status as PopulationStatus)) return invalid()
    const status = person.status as PopulationStatus
    const receiveMs = integer(person.receiveMs, POPULATION_RECEIVE_MS)
    if ((status === 'dormant' && receiveMs !== 0) || (status === 'resident' ? receiveMs !== POPULATION_RECEIVE_MS : receiveMs >= POPULATION_RECEIVE_MS)) return invalid()
    return { status, receiveMs }
  })
  const state: PlayerStationPopulation = { version: 1, people, sourceMaterials: bill(raw.sourceMaterials) }
  if (raw.plan !== undefined) {
    const p = record(raw.plan)
    const remaining = integer(p.remaining, POPULATION_SOURCE_COUNT)
    if (remaining < 1 || remaining > people.filter(person => person.status !== 'resident').length) return invalid()
    state.plan = { shipId: shipId(p.shipId), remaining, stopped: boolean(p.stopped) }
  }
  if (raw.trip !== undefined) {
    const p = record(raw.trip)
    if (!state.plan || !PHASES.includes(p.phase as PopulationPhase) || p.shipId !== state.plan.shipId) return invalid()
    const indices = (value: unknown): number[] => {
      if (!Array.isArray(value)) return invalid()
      const result = value.map(index => integer(index, POPULATION_SOURCE_COUNT - 1))
      if (new Set(result).size !== result.length) return invalid()
      return result
    }
    const trip: PopulationTrip = { shipId: shipId(p.shipId), phase: p.phase as PopulationPhase,
      progressMs: integer(p.progressMs), positionMs: integer(p.positionMs, POPULATION_LOCAL_TRAVEL_MS),
      slots: integer(p.slots, POPULATION_SOURCE_COUNT), people: indices(p.people), protectedQueue: indices(p.protectedQueue), cargo: bill(p.cargo), safety: boolean(p.safety) }
    if (trip.slots < 1 || trip.people.length + trip.protectedQueue.length > trip.slots || trip.people.length > state.plan.remaining
      || trip.protectedQueue.some(index => trip.people.includes(index) || people[index].status !== 'protected')) return invalid()
    if (p.active !== undefined) { trip.active = integer(p.active, POPULATION_SOURCE_COUNT - 1); if (!trip.people.includes(trip.active)) return invalid() }
    const moving = ['outbound', 'inbound', 'safety-return', 'empty-home'].includes(trip.phase)
    const duration = trip.phase === 'processing' ? POPULATION_REVIVAL_MS : trip.phase === 'receiving' ? POPULATION_RECEIVE_MS : 60_000
    if (!moving && trip.progressMs >= duration || moving && trip.progressMs > POPULATION_LOCAL_TRAVEL_MS) return invalid()
    if ((trip.phase === 'loading' || trip.phase === 'receiving') && trip.positionMs !== 0
      || (trip.phase === 'processing' || trip.phase === 'boarding') && trip.positionMs !== POPULATION_LOCAL_TRAVEL_MS) return invalid()
    if (trip.active !== undefined && trip.phase !== 'processing' && trip.phase !== 'receiving') return invalid()
    if ((trip.phase === 'processing' || trip.phase === 'receiving') && trip.active === undefined
      || trip.phase === 'receiving' && trip.people[0] !== trip.active
      || ['boarding', 'inbound', 'receiving', 'safety-return'].includes(trip.phase) && trip.people.length === 0
      || trip.phase === 'safety-return' && !trip.safety) return invalid()
    if (trip.phase === 'loading' || trip.phase === 'outbound' || trip.phase === 'empty-home') {
      if (trip.people.length > 0) return invalid()
    }
    for (const index of trip.people) {
      const expected = trip.phase === 'processing' ? index === trip.active ? 'processing' : 'waiting'
        : trip.phase === 'boarding' ? 'waiting' : trip.phase === 'receiving' && index === trip.active ? 'receiving' : 'aboard'
      if (people[index].status !== expected) return invalid()
    }
    if (trip.phase === 'receiving' && trip.active !== undefined && people[trip.active].receiveMs !== trip.progressMs) return invalid()
    if (Object.keys(trip.cargo).length > 0 && trip.phase !== 'loading' && trip.phase !== 'outbound' && trip.phase !== 'empty-home') return invalid()
    state.trip = trip
  }
  if (people.some((person, index) => ['processing', 'waiting', 'aboard', 'receiving'].includes(person.status) && !state.trip?.people.includes(index))) return invalid()
  for (const id of Object.keys(POPULATION_REVIVAL_BILL)) {
    if ((state.sourceMaterials[id] ?? 0) + (state.trip?.cargo[id] ?? 0) > POPULATION_REVIVAL_BILL[id] * people.filter(person => person.status === 'dormant').length) return invalid()
  }
  return state
}
