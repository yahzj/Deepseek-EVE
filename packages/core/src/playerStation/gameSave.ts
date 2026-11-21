import type { PlayerStationGame } from './gameTypes'
import type { PlayerFacilityKind } from './types'
import { createPlayerStation } from './runtime'
import { cleanPlayerStation } from './save'
import { createStationPopulation, POPULATION_REVIVAL_BILL, POPULATION_SOURCE_COUNT, POPULATION_LOCAL_TRAVEL_MS } from './population'
import { cleanStationPopulation } from './populationSave'
import { cleanStationTraining, createStationTraining } from './training'
import { cleanStationRefining, createStationRefining } from './refining'
import { cleanStationMining, createStationMining } from './mining'
import { cleanStationResearch, createStationResearch, researchCompleted, STATION_RESEARCH_CATALOG } from './research'
import { cleanStationDevelopment, createStationDevelopment } from './development'
import { cleanStationAcademy, createStationAcademy } from './academy'
import { cleanStationManufacturing, createStationManufacturing } from './manufacturing'
import { cleanStationCrew, createStationCrew } from './crew'
import { cleanStationSecurity, createStationSecurity, STATION_SECURITY_JOB_MS } from './security'
import { cleanStationCampaign, createStationCampaign } from './campaign'
import { PLAYER_STATION_BODY_BILL } from './rules'

const invalid = (reason: string): never => { throw new Error(`Invalid player station game snapshot: ${reason}`) }
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
const identity = (id: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9_.:#-]{0,127}$/.test(id) && !['constructor', 'prototype'].includes(id)
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid('object')
  return value as Record<string, unknown>
}
function fields(value: unknown, allowed: string): Record<string, unknown> {
  const raw = record(value)
  if (Object.keys(raw).some(key => !allowed.split(' ').includes(key))) return invalid('unexpected field')
  return raw
}
// 子模块清洗器是字段单源；正式复合档不静默丢弃额外预览账或稀疏数组。
function knownFields(value: unknown, cleaned: unknown): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    if (!Array.isArray(cleaned) || value.length !== cleaned.length || Object.keys(value).length !== value.length) return invalid('array shape')
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) return invalid('sparse array')
      knownFields(value[index], cleaned[index])
    }
    return
  }
  const raw = record(value), target = record(cleaned)
  for (const [key, entry] of Object.entries(raw)) {
    if (!Object.hasOwn(target, key)) {
      if (entry === undefined) continue
      return invalid('unexpected nested field')
    }
    knownFields(entry, target[key])
  }
}

/** 只初始化未发现、未建成的运行账，不创建舰船、库存或已复苏人口。 */
export function createPlayerStationGame(): PlayerStationGame {
  return { version: 1, discovered: false, active: false, station: createPlayerStation(), population: createStationPopulation(),
    training: createStationTraining(), refining: createStationRefining(), mining: createStationMining(), research: createStationResearch(),
    development: createStationDevelopment(), academy: createStationAcademy(), manufacturing: createStationManufacturing(),
    crew: createStationCrew(), security: createStationSecurity(), campaign: createStationCampaign(), shipLocks: {},
    rewardedReportId: 0, guardServiceMs: 0,
    history: { refiningPeak: 0, manufacturingPeak: 0, crewGrowthPeak: 0, escortsReturned: 0, defensesWon: 0 } }
}

/** 无内容上下文的真实舰队交叉检查；不创建替身船，也不修剪冲突任务。 */
export function validatePlayerStationFleet(game: PlayerStationGame, fleet: Readonly<Record<string, unknown>>, mainId: string, foreignBusyIds: ReadonlySet<string>): void {
  const ids = new Set([...Object.keys(game.shipLocks), ...game.crew.teams.flatMap(team => team.shipId ? [team.shipId] : []), ...game.mining.runs.map(run => run.shipId),
    ...(game.population.plan ? [game.population.plan.shipId] : []), ...(game.population.trip ? [game.population.trip.shipId] : []),
    ...(game.delivery ? [game.delivery.shipId] : []), ...(game.security.guard?.shipIds ?? []), ...(game.security.mission?.shipIds ?? [])])
  for (const id of ids) {
    if (!identity(id) || !Object.hasOwn(fleet, id)) return invalid('fleet reference')
    record(fleet[id])
    if (game.shipLocks[id] && (id === mainId || foreignBusyIds.has(id))) return invalid('foreign ship conflict')
  }
}

/** 缺字段保留旧档语义；字段存在时任一坏账拒绝整档，不清空已投入资产。 */
export function cleanPlayerStationGame(value: unknown): PlayerStationGame | undefined {
  if (value === undefined) return undefined
  const raw = fields(value, 'version discovered active station population training refining mining research development academy manufacturing crew security campaign shipLocks sourceShips delivery rewardedReportId guardServiceMs history')
  if (raw.version !== 1 || typeof raw.discovered !== 'boolean' || typeof raw.active !== 'boolean' || raw.active && !raw.discovered) return invalid('version/discovery')
  const developmentRaw = fields(raw.development, 'version expanded levels damaged projects')
  const station = cleanPlayerStation(raw.station, developmentRaw.expanded === true ? 16 : 9)
  const population = cleanStationPopulation(raw.population)
  const residents = population.people.flatMap((person, index) => person.status === 'resident' ? [index] : [])
  const training = cleanStationTraining(raw.training, residents)
  const research = cleanStationResearch(raw.research)
  const facility = (index: number) => station.cells.find(cell => cell.cellIndex === index)?.kind
  const engineers = residents.filter(index => training.qualifications[index] === 'engineer')
  const development = cleanStationDevelopment(developmentRaw, {
    built: () => station.built, facility, engineers: () => engineers, technology: id => researchCompleted(research, id),
    ready: () => false, availablePower: () => 0, engineeringLevel: () => 0, available: () => 0, take: () => false, give: () => {},
  })
  // 这里只提供结构绑定，真实船体准入、地点和课程标签由 gameRuntime 的 ctx 再校验。
  const crew = cleanStationCrew(raw.crew, {
    residents: () => residents, personAvailable: index => training.qualifications[index] === null,
    ship: id => identity(id) ? { tier: 1, available: false, home: true, trainingTags: ['fire-control', 'damage-control', 'drones'] } : undefined,
    claimShip: () => false, releaseShip: () => {}, ready: () => false, trainingReady: () => false, teamAvailable: () => false,
  })
  const security = cleanStationSecurity(raw.security, { team: id => {
    const team = crew.teams.find(team => team.id === id)
    return team?.shipId ? { shipId: team.shipId, available: false } : undefined
  } })
  const history = fields(raw.history, 'refiningPeak manufacturingPeak crewGrowthPeak escortsReturned defensesWon')
  const historyKeys = ['refiningPeak', 'manufacturingPeak', 'crewGrowthPeak', 'escortsReturned', 'defensesWon'] as const
  if (!historyKeys.every(key => integer(history[key])) || !integer(raw.rewardedReportId) || raw.rewardedReportId !== security.sequence
    || !integer(raw.guardServiceMs, security.clockMs) || crew.clockMs !== security.clockMs || crew.clockMs > station.clockMs) return invalid('time/report ledger')
  const state: PlayerStationGame = { version: 1, discovered: raw.discovered, active: raw.active, station, population, training, research, development,
    refining: cleanStationRefining(raw.refining), mining: cleanStationMining(raw.mining), academy: cleanStationAcademy(raw.academy),
    manufacturing: cleanStationManufacturing(raw.manufacturing), crew, security, campaign: cleanStationCampaign(raw.campaign), shipLocks: {},
    rewardedReportId: raw.rewardedReportId, guardServiceMs: raw.guardServiceMs,
    history: Object.fromEntries(historyKeys.map(key => [key, history[key]])) as PlayerStationGame['history'] }

  if (raw.delivery !== undefined) {
    const delivery = fields(raw.delivery, 'shipId target cargo progressMs durationMs')
    if (typeof delivery.shipId !== 'string' || !identity(delivery.shipId) || !['body', 'source', 'recovery', 'return'].includes(String(delivery.target))
      || !integer(delivery.durationMs, 8 * 24 * 60 * 60_000) || delivery.durationMs < 1
      || !integer(delivery.progressMs, delivery.durationMs - 1) || delivery.progressMs > station.clockMs) return invalid('delivery time/target')
    const maxima = delivery.target === 'source' ? POPULATION_REVIVAL_BILL : PLAYER_STATION_BODY_BILL
    const cargo: Record<string, number> = {}
    for (const [id, n] of Object.entries(record(delivery.cargo))) {
      const maximum = delivery.target === 'recovery' ? Number.MAX_SAFE_INTEGER : maxima[id] * (delivery.target === 'source' ? POPULATION_SOURCE_COUNT : 1)
      if (!Object.hasOwn(maxima, id) || !integer(n, maximum) || n < 1) return invalid('delivery cargo')
      cargo[id] = n
    }
    if ((Object.keys(cargo).length === 0) !== (delivery.target === 'return') || !state.discovered || !state.active
      || (delivery.target === 'source' || delivery.target === 'return') && !station.built
      || delivery.target === 'return' && delivery.durationMs !== POPULATION_LOCAL_TRAVEL_MS) return invalid('delivery discovery/cargo')
    state.delivery = { shipId: delivery.shipId, target: delivery.target as NonNullable<PlayerStationGame['delivery']>['target'], cargo, progressMs: delivery.progressMs, durationMs: delivery.durationMs }
  }

  const people = new Set<number>()
  function person(index: number | undefined, qualification?: 'engineer' | 'researcher' | null): void {
    if (index === undefined) return
    if (!residents.includes(index) || people.has(index) || qualification !== undefined && training.qualifications[index] !== qualification) return invalid('person/qualification conflict')
    people.add(index)
  }
  function cell(index: number, kind: PlayerFacilityKind): void {
    if (facility(index) !== kind) return invalid('facility assignment')
  }
  person(training.active?.personIndex, null)
  for (const project of station.projects) person(project.engineerIndex, 'engineer')
  for (const project of development.projects) for (const index of project.engineerIndices) person(index, 'engineer')
  for (const run of state.refining.runs) { cell(run.cellIndex, 'refinery'); person(run.personIndex) }
  for (const run of state.manufacturing.runs) { cell(run.cellIndex, 'manufacturing'); person(run.personIndex) }
  for (const run of state.mining.runs) person(run.personIndex)
  if (research.assignment) { cell(research.assignment.cellIndex, 'research'); person(research.assignment.personIndex, 'researcher') }
  if (state.academy.active) { cell(state.academy.active.cellIndex, 'training'); person(state.academy.active.personIndex, null) }
  for (const team of crew.teams) for (const index of team.members) person(index, null)
  const crewSeat = crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying')
  if (crewSeat && state.academy.active || crew.teams.some(team => team.activity === 'training') && !station.cells.some(cell => cell.kind === 'training')
    || training.qualifications.filter(Boolean).length + training.queue.length + (training.active ? 1 : 0) + (state.academy.active ? 1 : 0) > population.people.length) return invalid('training seat')

  for (const entry of [...station.cells, ...station.projects]) {
    if (['manufacturing', 'training', 'warning'].includes(entry.kind) && !researchCompleted(research, `station-${entry.kind}`)) return invalid('facility technology')
  }
  if (development.expanded && !researchCompleted(research, 'station-expansion-1')
    || Object.keys(development.levels).some(index => !researchCompleted(research, facility(Number(index)) === 'power' ? 'station-power-2' : 'station-life-2'))) return invalid('development technology')
  if (!station.built && (population.plan || population.people.some(person => person.status !== 'dormant') || Object.keys(population.sourceMaterials).length
    || development.expanded || Object.keys(development.levels).length || development.damaged.length || development.projects.length
    || STATION_RESEARCH_CATALOG.some(project => researchCompleted(research, project.id)) || research.progressMs > 0
    || Object.values(research.archives).some(progress => progress.progressMs > 0))) return invalid('unbuilt station progress')
  if (!state.discovered && (station.built || station.bodyApproved || station.project || station.clockMs > 0
    || Object.keys(station.recoveryMaterials).length || population.plan || Object.keys(population.sourceMaterials).length)) return invalid('undiscovered station progress')

  const expected = new Map<string, PlayerStationGame['shipLocks'][string]>()
  function claim(id: string, kind: PlayerStationGame['shipLocks'][string]): void {
    if (!identity(id) || expected.has(id)) return invalid('ship conflict')
    expected.set(id, kind)
  }
  if (raw.sourceShips !== undefined) {
    if (!Array.isArray(raw.sourceShips) || raw.sourceShips.length < 1 || raw.sourceShips.length > 64
      || !state.active || !station.built || new Set(raw.sourceShips).size !== raw.sourceShips.length) return invalid('source ships')
    state.sourceShips = raw.sourceShips.map(id => {
      if (!identity(id)) return invalid('source ship identity')
      claim(id, 'population'); return id
    })
  }
  if (population.trip) claim(population.trip.shipId, 'population')
  if (state.delivery) claim(state.delivery.shipId, 'population')
  for (const run of state.mining.runs) claim(run.shipId, 'mining')
  for (const team of crew.teams) {
    const duty = security.guard?.teamIds.includes(team.id) ? 'guard' : security.mission?.teamIds.includes(team.id) ? 'mission' : undefined
    if (duty ? team.activity !== duty : team.activity === 'guard' || team.activity === 'mission') return invalid('crew/security duty')
    if (team.activity === 'training' || duty) {
      if (!team.shipId) return invalid('unbound active crew')
      claim(team.shipId, duty ? 'security' : 'training')
    }
  }
  const locks = record(raw.shipLocks)
  if (Object.keys(locks).length !== expected.size || [...expected].some(([id, kind]) => !Object.hasOwn(locks, id) || locks[id] !== kind)) return invalid('ship lock ledger')
  for (const [id, kind] of expected) state.shipLocks[id] = kind

  const h = state.history
  if (h.crewGrowthPeak > 72 || h.crewGrowthPeak > 0 && crew.sequence === 0
    || h.escortsReturned > Math.floor(security.exposure / STATION_SECURITY_JOB_MS) || h.defensesWon > security.sequence
    || crew.teams.some(team => team.growth > h.crewGrowthPeak) || state.refining.runs.some(run => run.batchesDone > h.refiningPeak)
    || state.manufacturing.runs.some(run => run.batchesDone > h.manufacturingPeak)) return invalid('history ledger')
  if (state.campaign.achieved.some(goal => {
    switch (goal) {
      case 'settlement': return residents.length < 3
      case 'industry': return h.refiningPeak === 0 || h.manufacturingPeak === 0
      case 'research': return !STATION_RESEARCH_CATALOG.every(project => researchCompleted(research, project.id))
      case 'expansion': return !development.expanded || !station.cells.some(cell => cell.kind === 'power' && development.levels[String(cell.cellIndex)] === 2)
        || !station.cells.some(cell => cell.kind === 'life-support' && development.levels[String(cell.cellIndex)] === 2)
      case 'crew': return h.crewGrowthPeak === 0
      case 'logistics': return h.escortsReturned === 0
      case 'security': return !security.sources.every(source => source.cleared)
      case 'defense': return state.guardServiceMs < STATION_SECURITY_JOB_MS && h.defensesWon === 0
    }
  })) return invalid('campaign proof')
  knownFields(raw, state)
  return state
}
