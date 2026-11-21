import type { GameState } from '../state'
import type { SimContext } from '../types'
import { shipDisplayName } from '../instances'
import { cargoCapacityM3Of, cargoUsedM3Of } from '../inventory'
import { shortestTravelMinutes, travelLegMs } from '../travel'
import { createPlayerStationGame, validatePlayerStationFleet } from './gameSave'
import { ancientStationDiscovered } from './discovery'
import type { PlayerStationGame } from './gameTypes'
import type { PlayerStationHost, PlayerStationAction, PlayerStationBill } from './types'
import { PLAYER_STATION_GALAXY_ID } from './rules'
import { playerStationCommand, playerStationView, playerStationNextEventMs, advancePlayerStation, receivePlayerStationMaterials, reconcilePlayerStation, takePlayerStationRecovery } from './runtime'
import { stationPopulationCommand, stationPopulationView, stationPopulationNextEventMs, advanceStationPopulation, reconcileStationPopulation, POPULATION_REVIVAL_BILL, POPULATION_LOCAL_TRAVEL_MS } from './population'
import type { PopulationHost, PopulationAction } from './populationTypes'
import { stationTrainingCommand, stationTrainingView, stationTrainingNextEventMs, advanceStationTraining, reconcileStationTraining } from './training'
import type { StationTrainingHost, StationTrainingAction } from './training'
import { stationRefiningCommand, stationRefiningView, stationRefiningNextEventMs, advanceStationRefining } from './refining'
import type { StationRefiningHost, StationRefiningAction } from './refining'
import { stationMiningCommand, stationMiningView, stationMiningNextEventMs, advanceStationMining } from './mining'
import type { StationMiningHost, StationMiningAction } from './mining'
import { stationResearchCommand, stationResearchView, stationResearchNextEventMs, advanceStationResearch, researchCompleted } from './research'
import type { StationResearchHost, StationResearchAction } from './research'
import { stationDevelopmentCommand, stationDevelopmentNextEventMs, advanceStationDevelopment, developmentPower, developmentSpec, developmentBill } from './development'
import type { StationDevelopmentHost, DevelopmentAction } from './development'
import { stationAcademyCommand, stationAcademyBlock, stationAcademyNextEventMs, advanceStationAcademy } from './academy'
import type { StationAcademyHost, StationAcademyAction } from './academy'
import { stationManufacturingCommand, stationManufacturingView, stationManufacturingNextEventMs, advanceStationManufacturing } from './manufacturing'
import type { StationManufacturingHost, StationManufacturingAction } from './manufacturing'
import { stationCrewCommand, stationCrewView, stationCrewNextEventMs, advanceStationCrew, crewBusyPeople, crewTeamBonuses, markCrewDuty, awardCrewExperience } from './crew'
import type { StationCrewHost, StationCrewAction } from './crew'
import { stationSecurityCommand, stationSecurityView, stationSecurityNextEventMs, advanceStationSecurity } from './security'
import type { StationSecurityHost, StationSecurityAction } from './security'
import { reconcileStationCampaign, declareStationIndependence } from './campaign'
import type { StationCampaignHost } from './campaign'
import { refiningRecipe, refiningOutput, manufacturingRecipe, miningParams, miningCycle, miningReturnMs } from './gameRecipes'
import { stationShipAvailable, stationCrewShip, stationSecurityResolve } from './gameShips'

type Result = { ok: boolean; reason?: string }
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0

/** 正式资源宿主；不拥有第二套库存/船表，不从开发预览引入任何状态。 */
export class PlayerStationGameRuntime {
  readonly g: PlayerStationGame
  readonly host: PlayerStationHost
  readonly populationHost: PopulationHost
  readonly trainingHost: StationTrainingHost
  readonly refiningHost: StationRefiningHost
  readonly miningHost: StationMiningHost
  readonly researchHost: StationResearchHost
  readonly developmentHost: StationDevelopmentHost
  readonly academyHost: StationAcademyHost
  readonly manufacturingHost: StationManufacturingHost
  readonly crewHost: StationCrewHost
  readonly securityHost: StationSecurityHost
  readonly campaignHost: StationCampaignHost
  private segmentWorking?: number[]
  private segmentDevelopment?: number
  private segmentReady?: boolean

  constructor(readonly state: GameState, readonly ctx: SimContext) {
    this.g = state.playerStation ?? createPlayerStationGame()
    if (!state.playerStation && ancientStationDiscovered(state, ctx)) this.g.discovered = true
    const g = this.g
    this.host = {
      engineeringLevel: () => Math.min(5, Math.max(0, state.skills.trained['station-engineering'] ?? 0)),
      available: id => state.warehouse.items[id] ?? 0,
      take: bill => {
        const entries = this.bill(bill)
        if (entries.some(([id, n]) => (state.warehouse.items[id] ?? 0) < n)) return false
        for (const [id, n] of entries) state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) - n
        return true
      },
      give: bill => {
        const entries = this.bill(bill)
        if (entries.some(([id, n]) => !safe((state.warehouse.items[id] ?? 0) + n))) throw new Error('Station inventory overflow')
        for (const [id, n] of entries) state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + n
      },
      itemName: id => ctx.items.get(id)?.name ?? id,
      cellCount: () => g.development.expanded ? 16 : 9,
      unlocked: kind => !['manufacturing', 'training', 'warning'].includes(kind) || researchCompleted(g.research, `station-${kind}`),
      facilityState: index => ({ level: g.development.levels[String(index)] ?? 1, damaged: g.development.damaged.includes(index) }),
      workingCells: () => this.segmentWorking ?? this.workingRequests(),
      externalConstructionPower: () => this.segmentDevelopment ?? developmentPower(g.development, this.developmentHost).demand,
      engineers: () => this.residents().filter(index => g.training.qualifications[index] === 'engineer' && this.personFree(index, 'construction')),
    }
    this.populationHost = {
      sourceKnown: () => g.discovered,
      reception: () => ({ ready: this.ready(), capacity: this.view().power.populationCapacity }),
      ship: id => {
        if (!state.fleet[id]) return undefined
        const source = g.sourceShips?.includes(id) === true
        const location = source ? 'source' as const : g.population.trip?.shipId === id ? 'elsewhere' as const : 'home' as const
        return { available: source || this.shipFree(id), auxiliary: id !== state.shipId, location,
          freeM3: Math.max(0, cargoCapacityM3Of(state, ctx, id) - cargoUsedM3Of(state, ctx, id)) }
      },
      claimShip: id => {
        if (g.sourceShips?.includes(id)) { this.leaveSource(id); return true }
        return this.claimShip(id, 'population')
      },
      releaseShip: (id, location) => {
        if (location === 'source') {
          g.sourceShips = [...new Set([...(g.sourceShips ?? []), id])]
          g.shipLocks[id] = 'population'
        } else delete g.shipLocks[id]
      },
      available: this.host.available, take: this.host.take, give: this.host.give, itemName: this.host.itemName,
    }
    this.trainingHost = { residents: () => this.residents(), available: index => this.personFree(index, 'training'), ready: () => this.ready() }
    this.refiningHost = {
      residents: () => this.residents(), personAvailable: index => this.personFree(index, 'refining'),
      facilityAvailable: index => this.facility(index, 'refinery'), powered: index => this.ready() && this.operational(index),
      recipe: id => refiningRecipe(state, ctx, id), output: (id, n) => refiningOutput(state, ctx, id, n),
      available: this.host.available, settle: (input, output) => this.settle(input, output),
    }
    this.miningHost = {
      residents: () => this.residents(), personAvailable: index => this.personFree(index, 'mining'), ready: () => this.ready(),
      ship: id => state.fleet[id] ? { available: this.shipFree(id), auxiliary: id !== state.shipId, home: stationShipAvailable(state, ctx, id, true) } : undefined,
      params: (id, belt) => miningParams(state, ctx, id, belt),
      claimShip: id => {
        if (!this.claimShip(id, 'mining')) return undefined
        const cargo = { ...state.fleet[id].cargo }; state.fleet[id].cargo = {}; return cargo
      },
      releaseShip: (id, cargo) => { state.fleet[id].cargo = { ...cargo }; delete g.shipLocks[id] },
      cycle: run => miningCycle(state, ctx, run), returnMs: run => miningReturnMs(state, ctx, run), unload: this.host.give,
    }
    this.researchHost = {
      researchers: () => this.residents().filter(index => g.training.qualifications[index] === 'researcher'),
      personAvailable: index => this.personFree(index, 'research'), facilityAvailable: index => this.facility(index, 'research'),
      powered: index => this.ready() && this.operational(index),
    }
    this.developmentHost = {
      built: () => g.station.built, facility: index => g.station.cells.find(cell => cell.cellIndex === index)?.kind,
      engineers: () => this.residents().filter(index => g.training.qualifications[index] === 'engineer' && this.personFree(index, 'development')),
      technology: id => researchCompleted(g.research, id),
      ready: () => playerStationView(g.station, { ...this.host, externalConstructionPower: undefined }).receptionReady,
      availablePower: () => { const view = playerStationView(g.station, { ...this.host, externalConstructionPower: undefined }); return Math.max(0, view.power.supply - view.power.demand) },
      engineeringLevel: this.host.engineeringLevel, available: this.host.available, take: this.host.take, give: this.host.give,
    }
    this.academyHost = {
      candidate: index => g.training.qualifications[index] === null && this.personFree(index, 'academy'),
      facility: index => this.facility(index, 'training'), powered: index => this.ready() && this.operational(index),
      qualify: (index, course) => { g.training.qualifications[index] = course },
    }
    this.manufacturingHost = {
      residents: () => this.residents(), personAvailable: index => this.personFree(index, 'manufacturing'),
      facilityAvailable: index => this.facility(index, 'manufacturing'), powered: index => this.ready() && this.operational(index),
      recipe: id => manufacturingRecipe(state, ctx, id), available: this.host.available, settle: (input, output) => this.settle(input, output),
    }
    this.crewHost = {
      residents: () => this.residents(), personAvailable: index => g.training.qualifications[index] === null && this.personFree(index, 'crew'),
      ship: id => { const ship = stationCrewShip(state, ctx, id); return ship ? { ...ship, available: this.shipFree(id) } : undefined },
      claimShip: id => this.claimShip(id, 'training'), releaseShip: id => { delete g.shipLocks[id] }, ready: () => this.ready(),
      trainingReady: () => !g.academy.active && this.trainingCell() !== undefined && this.operational(this.trainingCell()!),
      teamAvailable: id => !g.security.guard?.teamIds.includes(id) && !g.security.mission?.teamIds.includes(id),
    }
    this.securityHost = {
      ready: () => this.ready(), warningOnline: () => this.warningView().online,
      team: id => { const team = g.crew.teams.find(team => team.id === id); return team?.shipId ? { shipId: team.shipId, available: team.activity === 'idle' && this.shipFree(team.shipId) } : undefined },
      claimTeams: ids => {
        const teams = ids.map(id => g.crew.teams.find(team => team.id === id))
        if (teams.some(team => !team?.shipId || team.activity !== 'idle' || !this.shipFree(team.shipId)) || new Set(teams.map(team => team!.shipId)).size !== ids.length) return false
        for (const team of teams) g.shipLocks[team!.shipId!] = 'security'
        return true
      },
      releaseTeams: ids => {
        if (g.security.mission?.kind === 'escort' && g.security.mission.completed && g.security.mission.teamIds.every(id => ids.includes(id))) g.history.escortsReturned++
        for (const id of ids) { const team = g.crew.teams.find(team => team.id === id)!; if (team.shipId) delete g.shipLocks[team.shipId]; markCrewDuty(g.crew, id, 'idle') }
      },
      available: this.host.available, take: this.host.take, settle: result => this.host.give(result.reward),
      resolve: (ids, source) => {
        const teams = ids.map(id => g.crew.teams.find(team => team.id === id)!)
        if (teams.some(team => !team.shipId)) throw new Error('Unbound station security crew')
        return stationSecurityResolve(state, ctx, teams.map(team => team.shipId!), source, Object.fromEntries(teams.map(team => [team.shipId!, crewTeamBonuses(team)])))
      },
    }
    this.campaignHost = { fulfilled: goal => {
      switch (goal) {
        case 'settlement': return this.residents().length >= 3 && this.ready()
        case 'industry': return g.history.refiningPeak > 0 && g.history.manufacturingPeak > 0
        case 'research': return this.researchView().catalog.every(project => project.completed)
        case 'expansion': return g.development.expanded && g.station.cells.some(cell => cell.kind === 'power' && g.development.levels[String(cell.cellIndex)] === 2)
          && g.station.cells.some(cell => cell.kind === 'life-support' && g.development.levels[String(cell.cellIndex)] === 2)
        case 'crew': return g.history.crewGrowthPeak > 0
        case 'logistics': return g.history.escortsReturned > 0
        case 'security': return g.security.sources.every(source => source.cleared)
        case 'defense': return g.guardServiceMs >= 30 * 60_000 || g.history.defensesWon > 0
      }
    } }
  }
  private bill(value: PlayerStationBill) {
    const entries = Object.entries(value)
    if (entries.some(([id, n]) => !this.ctx.items.has(id) || !safe(n))) throw new Error('Invalid station resource bill')
    return entries
  }
  private settle(input: PlayerStationBill, output: PlayerStationBill) {
    const needs = this.bill(input), gives = this.bill(output)
    const next = { ...this.state.warehouse.items }
    if (needs.some(([id, n]) => (next[id] ?? 0) < n)) return false
    for (const [id, n] of needs) next[id] = (next[id] ?? 0) - n
    for (const [id, n] of gives) { if (!safe((next[id] ?? 0) + n)) throw new Error('Station inventory overflow'); next[id] = (next[id] ?? 0) + n }
    this.state.warehouse.items = next; return true
  }
  private residents() { return this.g.population.people.flatMap((person, index) => person.status === 'resident' ? [index] : []) }
  private facility(index: number, kind: string) { return this.g.station.cells.some(cell => cell.cellIndex === index && cell.kind === kind) }
  private operational(index: number) { return this.view().cells.some(cell => cell.cellIndex === index && cell.operational) }
  private trainingCell() { return this.g.station.cells.find(cell => cell.kind === 'training')?.cellIndex }
  private ready(): boolean {
    if (this.segmentReady !== undefined) return this.segmentReady
    const view = this.view(), count = this.g.population.people.filter(person => person.status !== 'dormant').length
    return view.receptionReady && view.power.populationCapacity >= count
  }
  private shipFree(id: string) { return !this.g.shipLocks[id] && stationShipAvailable(this.state, this.ctx, id, true) }
  private claimShip(id: string, kind: PlayerStationGame['shipLocks'][string]) {
    if (!this.shipFree(id)) return false
    this.g.shipLocks[id] = kind; return true
  }
  private leaveSource(id: string) {
    const remaining = this.g.sourceShips?.filter(shipId => shipId !== id) ?? []
    if (remaining.length) this.g.sourceShips = remaining
    else delete this.g.sourceShips
  }
  private personFree(index: number, domain: string) {
    const g = this.g
    return this.residents().includes(index)
      && (domain === 'construction' || !g.station.projects.some(project => project.engineerIndex === index))
      && (domain === 'development' || !g.development.projects.some(project => project.engineerIndices.includes(index)))
      && (domain === 'training' || g.training.active?.personIndex !== index)
      && (domain === 'academy' || g.academy.active?.personIndex !== index)
      && (domain === 'refining' || !g.refining.runs.some(run => run.personIndex === index))
      && (domain === 'manufacturing' || !g.manufacturing.runs.some(run => run.personIndex === index))
      && (domain === 'mining' || !g.mining.runs.some(run => run.personIndex === index))
      && (domain === 'research' || g.research.assignment?.personIndex !== index)
      && (domain === 'crew' || !crewBusyPeople(g.crew).includes(index))
  }
  private workingRequests() {
    const g = this.g, cells: number[] = []
    for (const run of g.refining.runs) if (run.personIndex !== undefined && !run.paused && this.personFree(run.personIndex, 'refining') && this.host.available(run.itemId) >= run.batchUnits) cells.push(run.cellIndex)
    for (const run of g.manufacturing.runs) if (run.personIndex !== undefined && !run.paused && this.personFree(run.personIndex, 'manufacturing') && Object.entries(run.input).every(([id, n]) => this.host.available(id) >= n)) cells.push(run.cellIndex)
    if (g.research.assignment && !g.research.assignment.paused) cells.push(g.research.assignment.cellIndex)
    if (g.academy.active && !g.academy.active.paused) cells.push(g.academy.active.cellIndex)
    if (!g.academy.active && g.crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying' && !team.paused) && this.trainingCell() !== undefined) cells.push(this.trainingCell()!)
    return cells
  }
  view() { return playerStationView(this.g.station, this.host) }
  populationView() { return stationPopulationView(this.g.population, this.populationHost) }
  trainingView() { return stationTrainingView(this.g.training, this.trainingHost) }
  refiningView() { return stationRefiningView(this.g.refining, this.refiningHost) }
  miningView() { return stationMiningView(this.g.mining, this.miningHost) }
  researchView() { return stationResearchView(this.g.research, this.researchHost) }
  academyView() { return { ...structuredClone(this.g.academy), blocked: stationAcademyBlock(this.g.academy, this.academyHost) } }
  manufacturingView() { return stationManufacturingView(this.g.manufacturing, this.manufacturingHost) }
  crewView() {
    const view = stationCrewView(this.g.crew, this.crewHost)
    return { ...view, teams: view.teams.map(team => ({ ...team, shipAvailable: !!team.shipId && this.shipFree(team.shipId),
      blocked: (team.activity === 'idle' || team.activity === 'qualifying') && (!team.shipId || !this.shipFree(team.shipId))
        ? 'ship' : team.blocked })) }
  }
  securityView() { return stationSecurityView(this.g.security, this.securityHost) }
  developmentView() {
    const g = this.g
    return { ...structuredClone(g.development), running: [...developmentPower(g.development, this.developmentHost).running],
      availableEngineers: this.developmentHost.engineers().filter(index => !g.development.projects.some(project => project.engineerIndices.includes(index))),
      options: [{ kind: 'expand' as const, cellIndex: undefined },
        ...g.station.cells.flatMap(cell => cell.kind === 'power' || cell.kind === 'life-support' ? [{ kind: cell.kind === 'power' ? 'power-upgrade' as const : 'life-upgrade' as const, cellIndex: cell.cellIndex }] : []),
        ...g.development.damaged.map(cellIndex => ({ kind: 'repair' as const, cellIndex }))]
        .filter(option => option.kind === 'expand' ? !g.development.expanded : option.kind === 'repair' || !g.development.levels[String(option.cellIndex)])
        .map(option => ({ ...option, spec: developmentSpec(option.kind, option.cellIndex, this.developmentHost), bill: developmentBill(option.kind, option.cellIndex, this.developmentHost) })),
    }
  }
  warningView() { return { online: this.view().cells.some(cell => cell.kind === 'warning' && cell.operational) } }
  shipsView() {
    return Object.keys(this.state.fleet).filter(id => id !== this.state.shipId || this.g.crew.teams.some(team => team.shipId === id)
      || this.g.population.plan?.shipId === id).map(id => {
      const ship = stationCrewShip(this.state, this.ctx, id)
      return { id, name: shipDisplayName(this.state, this.ctx, id), available: this.g.sourceShips?.includes(id) || this.shipFree(id), auxiliary: id !== this.state.shipId,
        freeM3: Math.max(0, cargoCapacityM3Of(this.state, this.ctx, id) - cargoUsedM3Of(this.state, this.ctx, id)),
        location: this.g.sourceShips?.includes(id) ? 'source' as const : this.g.shipLocks[id] || !ship?.home ? 'elsewhere' as const : 'home' as const,
        tier: ship?.tier ?? 1, trainingTags: ship?.trainingTags ?? [] }
    })
  }
  refiningItems() { return [...this.ctx.items.values()].flatMap(item => { const recipe = this.refiningHost.recipe(item.id); return recipe ? [{ id: item.id, name: item.name, ...recipe }] : [] }) }
  manufacturingItems() { return [...this.ctx.blueprints.values()].flatMap(bp => bp.itemId && bp.learnless && bp.partTier === 'basic' && this.manufacturingHost.recipe(bp.id) ? [{ blueprintId: bp.id, itemId: bp.itemId, name: this.host.itemName(bp.itemId) }] : []) }
  belts() { return [...this.ctx.belts.values()].filter(belt => belt.galaxyId === PLAYER_STATION_GALAXY_ID).map(belt => ({ id: belt.id, name: belt.name })) }

  command(domain: string, value: unknown): Result {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'invalid-action' }
    const action = value as Record<string, unknown>
    if (domain === 'activate') {
      if (!ancientStationDiscovered(this.state, this.ctx)) return { ok: false, reason: 'undiscovered' }
      this.state.playerStation = this.g; this.g.discovered = true; this.g.active = true
      return { ok: true }
    }
    if (!this.state.playerStation || !this.g.active) return { ok: false, reason: 'inactive' }
    const before = structuredClone({ g: this.g, inventory: this.state.warehouse.items, fleet: this.state.fleet })
    let result: Result
    try {
      this.validateContext()
      switch (domain) {
        case 'station': result = playerStationCommand(this.g.station, this.host, value as PlayerStationAction); break
        case 'population': result = stationPopulationCommand(this.g.population, this.populationHost, value as PopulationAction); break
        case 'training': result = action.kind === 'enqueue' && this.coursePlansFull() ? { ok: false, reason: 'queue-full' }
          : stationTrainingCommand(this.g.training, this.trainingHost, value as StationTrainingAction); break
        case 'refining': result = stationRefiningCommand(this.g.refining, this.refiningHost, value as StationRefiningAction); break
        case 'mining': result = stationMiningCommand(this.g.mining, this.miningHost, value as StationMiningAction); break
        case 'research': result = stationResearchCommand(this.g.research, this.researchHost, value as StationResearchAction); break
        case 'development': result = stationDevelopmentCommand(this.g.development, this.developmentHost, value as DevelopmentAction); break
        case 'academy': result = action.kind === 'assign' && (this.crewSeatBusy() || this.coursePlansFull()) ? { ok: false, reason: 'busy' }
          : stationAcademyCommand(this.g.academy, this.academyHost, value as StationAcademyAction); break
        case 'manufacturing': result = stationManufacturingCommand(this.g.manufacturing, this.manufacturingHost, value as StationManufacturingAction); break
        case 'crew': result = action.kind === 'plan' && this.g.academy.active ? { ok: false, reason: 'busy' }
          : stationCrewCommand(this.g.crew, this.crewHost, value as StationCrewAction); break
        case 'security': result = stationSecurityCommand(this.g.security, this.securityHost, value as StationSecurityAction); this.syncDuty(); this.applyReports(); break
        case 'declare': result = declareStationIndependence(this.g.campaign, this.campaignHost); break
        case 'recover': result = this.deliver({ ...action, target: 'recovery' }); break
        case 'delivery': result = this.deliver(action); break
        case 'population-return': {
          const id = action.shipId
          if (typeof id !== 'string' || !this.g.sourceShips?.includes(id) || this.g.delivery) result = { ok: false, reason: 'ship' }
          else {
            if (this.g.population.plan?.shipId === id) delete this.g.population.plan
            this.leaveSource(id)
            this.g.delivery = { shipId: id, target: 'return', cargo: {}, progressMs: 0, durationMs: POPULATION_LOCAL_TRAVEL_MS }
            result = { ok: true }
          }
          break
        }
        default: result = { ok: false, reason: 'invalid-action' }
      }
      this.reconcile()
      return result
    } catch (error) {
      for (const key of Object.keys(this.g)) delete (this.g as unknown as Record<string, unknown>)[key]
      Object.assign(this.g, before.g); this.state.warehouse.items = before.inventory; this.state.fleet = before.fleet
      throw error
    }
  }
  private crewSeatBusy() { return this.g.crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying') }
  private coursePlansFull() {
    const g = this.g
    return g.training.qualifications.filter(Boolean).length + g.training.queue.length + (g.training.active ? 1 : 0) + (g.academy.active ? 1 : 0) + crewBusyPeople(g.crew).length >= g.population.people.length
  }
  /** 内容级校验在ctx可用后执行；读档清洗层只验证结构与资源归属。 */
  validateContext() {
    const g = this.g
    validatePlayerStationFleet(g, this.state.fleet, this.state.shipId, new Set())
    for (const id of Object.keys(g.shipLocks)) if (!this.state.fleet[id] || id === this.state.shipId || !stationShipAvailable(this.state, this.ctx, id, true)) throw new Error('Invalid station ship assignment')
    for (const run of g.mining.runs) {
      if (!this.ctx.belts.has(run.beltId) || this.ctx.belts.get(run.beltId)?.galaxyId !== PLAYER_STATION_GALAXY_ID || !this.state.fleet[run.shipId]) throw new Error('Invalid station mining content')
      this.bill(run.cargo)
    }
    for (const run of g.refining.runs) if (!this.ctx.items.get(run.itemId)?.refine?.length) throw new Error('Invalid station refining content')
    for (const run of g.manufacturing.runs) {
      const bp = this.ctx.blueprints.get(run.blueprintId)
      if (!bp?.learnless || bp.partTier !== 'basic') throw new Error('Invalid station manufacturing content')
      this.bill(run.input); this.bill(run.output)
    }
    for (const team of g.crew.teams) {
      if (!team.shipId && (team.activity === 'idle' || team.activity === 'qualifying')) continue
      if (!team.shipId) throw new Error('Unbound active station crew')
      const ship = stationCrewShip(this.state, this.ctx, team.shipId)
      if (!ship || ship.tier > team.tier || team.activity === 'training' && !ship.trainingTags.includes(team.course)) throw new Error('Invalid station crew content')
    }
  }
  private deliver(action: Record<string, unknown>): Result {
    const shipId = action.shipId
    if (typeof shipId !== 'string' || !this.shipFree(shipId) || this.g.delivery || this.g.population.trip?.shipId === shipId) return { ok: false, reason: 'ship' }
    if (action.target !== 'body' && action.target !== 'source' && action.target !== 'recovery') return { ok: false, reason: 'invalid-action' }
    if (action.target === 'body' && (this.g.station.built || !this.g.station.bodyApproved || this.g.station.project)
      || action.target === 'source' && !this.g.station.built) return { ok: false, reason: 'invalid-action' }
    let free = cargoCapacityM3Of(this.state, this.ctx, shipId) - cargoUsedM3Of(this.state, this.ctx, shipId)
    const cargo: Record<string, number> = {}
    const rows = action.target === 'recovery' ? Object.entries(this.g.station.recoveryMaterials).map(([itemId, remaining]) => ({ itemId, remaining }))
      : action.target === 'body' ? this.view().bill : Object.entries(POPULATION_REVIVAL_BILL).map(([itemId, n]) => ({ itemId,
      remaining: Math.max(0, n * this.g.population.people.filter(person => person.status === 'dormant').length - (this.g.population.sourceMaterials[itemId] ?? 0)) }))
    for (const row of rows) {
      const volume = this.ctx.items.get(row.itemId)?.unitM3 ?? 1
      const count = Math.min(row.remaining, action.target === 'recovery' ? Number.MAX_SAFE_INTEGER - this.host.available(row.itemId) : this.host.available(row.itemId), Math.floor(free / Math.max(0.001, volume)))
      if (count > 0) { cargo[row.itemId] = count; free -= count * volume }
    }
    if (Object.keys(cargo).length === 0) return { ok: false, reason: 'materials' }
    const minutes = shortestTravelMinutes(this.ctx, 'galaxy-hub', PLAYER_STATION_GALAXY_ID)
    if (!Number.isFinite(minutes)) return { ok: false, reason: 'ship' }
    if (action.target === 'recovery') takePlayerStationRecovery(this.g.station, cargo)
    else if (!this.host.take(cargo)) return { ok: false, reason: 'materials' }
    this.g.shipLocks[shipId] = 'population'
    this.g.delivery = { shipId, target: action.target, cargo, progressMs: 0, durationMs: Math.max(1, travelLegMs(this.state, this.ctx, minutes * 2, shipId)) }
    return { ok: true }
  }
  private applyReports() {
    for (const report of this.g.security.reports) if (report.id > this.g.rewardedReportId && report.experience > 0) {
      if (report.kind === 'raid' && report.outcome === 'victory') this.g.history.defensesWon++
      for (const id of report.teamIds) awardCrewExperience(this.g.crew, id, report.experience, report.kind === 'raid' ? 'guard' : 'mission')
    }
    this.g.rewardedReportId = this.g.security.sequence
  }
  private syncDuty() {
    for (const team of this.g.crew.teams) {
      if (team.activity === 'idle') {
        if (this.g.security.guard?.teamIds.includes(team.id)) markCrewDuty(this.g.crew, team.id, 'guard')
        else if (this.g.security.mission?.teamIds.includes(team.id)) markCrewDuty(this.g.crew, team.id, 'mission')
      }
    }
  }
  private reconcile() {
    const g = this.g
    reconcilePlayerStation(g.station, this.host); reconcileStationPopulation(g.population, this.populationHost); reconcileStationTraining(g.training, this.trainingHost)
    g.history.refiningPeak = Math.max(g.history.refiningPeak, ...g.refining.runs.map(run => run.batchesDone))
    g.history.manufacturingPeak = Math.max(g.history.manufacturingPeak, ...g.manufacturing.runs.map(run => run.batchesDone))
    g.history.crewGrowthPeak = Math.max(g.history.crewGrowthPeak, ...g.crew.teams.map(team => team.growth))
    reconcileStationCampaign(g.campaign, this.campaignHost)
  }
  nextEventMs() {
    const g = this.g
    if (!g.active) return Infinity
    return Math.min(playerStationNextEventMs(g.station, this.host), stationPopulationNextEventMs(g.population), stationTrainingNextEventMs(g.training, this.trainingHost),
      stationRefiningNextEventMs(g.refining, this.refiningHost), stationMiningNextEventMs(g.mining, this.miningHost), stationResearchNextEventMs(g.research, this.researchHost),
      stationDevelopmentNextEventMs(g.development, this.developmentHost), stationAcademyNextEventMs(g.academy, this.academyHost), stationManufacturingNextEventMs(g.manufacturing, this.manufacturingHost),
      stationCrewNextEventMs(g.crew, this.crewHost), stationSecurityNextEventMs(g.security, this.securityHost), g.delivery ? g.delivery.durationMs - g.delivery.progressMs : Infinity)
  }
  advance(deltaMs: number) {
    if (!this.g.active) return
    if (!safe(deltaMs)) throw new Error('Invalid station elapsed time')
    const before = structuredClone({ g: this.g, inventory: this.state.warehouse.items, fleet: this.state.fleet })
    try {
      this.validateContext()
      this.reconcile()
      let left = deltaMs, zeroSteps = 0
      do {
        const step = Math.min(left, this.nextEventMs())
        if (step === 0 && ++zeroSteps > 20) throw new Error('Station event did not settle')
        const g = this.g, running = developmentPower(g.development, this.developmentHost).running
        this.segmentWorking = this.workingRequests(); this.segmentDevelopment = developmentPower(g.development, this.developmentHost).demand
        this.segmentReady = this.ready()
        try {
          if (this.segmentReady && g.security.guard && !g.security.guard.paused) g.guardServiceMs += step
          advanceStationCrew(g.crew, this.crewHost, step, true); advanceStationSecurity(g.security, this.securityHost, step); this.applyReports()
          advanceStationResearch(g.research, this.researchHost, step); advanceStationAcademy(g.academy, this.academyHost, step)
          advanceStationTraining(g.training, this.trainingHost, step, true); advanceStationPopulation(g.population, this.populationHost, step, true)
          advanceStationManufacturing(g.manufacturing, this.manufacturingHost, step); advanceStationRefining(g.refining, this.refiningHost, step)
          advancePlayerStation(g.station, this.host, step); advanceStationMining(g.mining, this.miningHost, step)
          advanceStationDevelopment(g.development, this.developmentHost, step, running)
          if (g.delivery) {
            g.delivery.progressMs += step
            if (g.delivery.progressMs >= g.delivery.durationMs) {
              const delivery = g.delivery
              if (delivery.target === 'body') this.host.give(receivePlayerStationMaterials(g.station, this.host, delivery.cargo).rejected)
              else if (delivery.target === 'recovery') this.host.give(delivery.cargo)
              else for (const [id, n] of Object.entries(delivery.cargo)) g.population.sourceMaterials[id] = (g.population.sourceMaterials[id] ?? 0) + n
              delete g.shipLocks[delivery.shipId]; delete g.delivery
            }
          }
        } finally { this.segmentWorking = undefined; this.segmentDevelopment = undefined; this.segmentReady = undefined }
        this.reconcile(); left -= step
      } while (left > 0 || this.nextEventMs() === 0)
    } catch (error) {
      for (const key of Object.keys(this.g)) delete (this.g as unknown as Record<string, unknown>)[key]
      Object.assign(this.g, before.g); this.state.warehouse.items = before.inventory; this.state.fleet = before.fleet
      throw error
    }
  }
}

export function advancePlayerStationGame(state: GameState, ctx: SimContext, deltaMs: number) {
  if (!state.playerStation) {
    if (!ancientStationDiscovered(state, ctx)) return
    state.playerStation = createPlayerStationGame(); state.playerStation.discovered = true
  }
  if (ancientStationDiscovered(state, ctx)) state.playerStation.discovered = true
  if (state.playerStation.active) new PlayerStationGameRuntime(state, ctx).advance(deltaMs)
}
