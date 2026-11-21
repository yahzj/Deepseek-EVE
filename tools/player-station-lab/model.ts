import {
  PLAYER_FACILITIES, PLAYER_STATION_BODY_BILL, advancePlayerStation, createPlayerStation,
  loadPlayerStation, playerStationCommand, playerStationView, receivePlayerStationMaterials, reconcilePlayerStation,
  serializePlayerStation, takePlayerStationRecovery,
  advanceStationPopulation, cleanStationPopulation, createStationPopulation, playerStationNextEventMs,
  POPULATION_REVIVAL_BILL, reconcileStationPopulation, stationPopulationCommand, stationPopulationNextEventMs, stationPopulationView,
  advanceStationTraining, cleanStationTraining, createStationTraining, reconcileStationTraining,
  stationTrainingCommand, stationTrainingNextEventMs, stationTrainingView,
  advanceStationRefining, cleanStationRefining, createStationRefining, stationRefiningCommand, stationRefiningNextEventMs, stationRefiningView,
  advanceStationMining, cleanStationMining, createStationMining, stationMiningCommand, stationMiningNextEventMs, stationMiningView,
  advanceStationResearch, cleanStationResearch, createStationResearch, stationResearchCommand, stationResearchNextEventMs, stationResearchView,
  createStationDevelopment, developmentBill, developmentSpec, developmentPower, stationDevelopmentCommand, advanceStationDevelopment, stationDevelopmentNextEventMs, cleanStationDevelopment,
  createStationAcademy, stationAcademyCommand, stationAcademyBlock, stationAcademyNextEventMs, advanceStationAcademy, cleanStationAcademy,
  createStationManufacturing, stationManufacturingCommand, stationManufacturingView, stationManufacturingNextEventMs, advanceStationManufacturing, cleanStationManufacturing,
} from '../../packages/core/src/playerStation/index'
import type { PopulationAction, PopulationHost, StationTrainingAction, StationTrainingHost, StationRefiningAction, StationRefiningHost, StationMiningAction, StationMiningHost, StationResearchAction, StationResearchHost } from '../../packages/core/src/playerStation/index'
import items from '../../packages/data/src/static/items.json'
import { REFINING_ITEM_IDS, refiningItemName, refiningOutput, refiningRecipe } from './refining-baseline'
import { MINER_ID, miningCargoM3, miningCargoValid, miningCycle, miningParams, miningReturnMs } from './mining-baseline'
import type { StationDevelopmentHost, DevelopmentAction, StationAcademyHost, StationAcademyAction, StationManufacturingHost, StationManufacturingAction } from '../../packages/core/src/playerStation/index'
import { researchCompleted } from '../../packages/core/src/playerStation/research'
import { MANUFACTURING_ITEM_IDS, manufacturingRecipe } from './manufacturing-baseline'

type Station = ReturnType<typeof createPlayerStation>
type Host = Parameters<typeof playerStationCommand>[1]
type Action = Parameters<typeof playerStationCommand>[2]
type Bill = Readonly<Record<string, number>>

// 预览宿主的固定名称；价格与体积只读静态源，不复制工程学或料单公式。
const NAMES: Readonly<Record<string, string>> = {
  'min-tritanium': '钛钢合金',
  'part-frame': '结构框架',
  'part-armor-plate': '装甲板',
  'part-cable': '超导电缆',
  'part-circuit': '电路基板',
  'part-coolant': '冷却导管',
  'part-gyro': '陀螺稳定器座',
  'part-lens': '光学透镜组',
  'repairkit-civ': '民用修理组件',
}
const STATIC_ITEMS = new Map(Object.values(items.groups).flat().map((item) => [item.id, item]))
export const MATERIAL_IDS = [...new Set([
  ...Object.keys(PLAYER_STATION_BODY_BILL),
  ...Object.values(PLAYER_FACILITIES).flatMap((facility) => Object.keys(facility.bill)),
  ...Object.keys(POPULATION_REVIVAL_BILL),
  ...REFINING_ITEM_IDS,
  ...MANUFACTURING_ITEM_IDS,
  'ammo-kinetic-l',
  'repairkit-mil',
])]
export const SNAPSHOT_FORMAT = 'whale-player-station-preview-session'
export const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

export function materialInfo(itemId: string) {
  const item = STATIC_ITEMS.get(itemId)
  if (!item) throw new Error(`静态物品缺失：${itemId}`)
  return { itemId, name: NAMES[itemId] ?? refiningItemName(itemId), unitM3: item.unitM3, price: item.baseSellPriceIsk }
}

function quantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function entriesOf(bill: Bill): [string, number][] {
  const entries = Object.entries(bill)
  if (entries.some(([id, amount]) => !MATERIAL_IDS.includes(id) || !quantity(amount))) {
    throw new Error('预览物料必须为已定义物品与非负安全整数')
  }
  return entries
}

export function initialInventory(): Record<string, number> {
  return Object.fromEntries(MATERIAL_IDS.map((id) => [id,
    (PLAYER_STATION_BODY_BILL[id] ?? 0) * 2
      + Object.values(PLAYER_FACILITIES).reduce((sum, facility) => sum + (facility.bill[id] ?? 0) * 9, 0)
      + (POPULATION_REVIVAL_BILL[id] ?? 0) * 6,
  ]))
}

export class LabModel {
  station: Station
  population = createStationPopulation()
  training = createStationTraining()
  refining = createStationRefining()
  mining = createStationMining()
  research = createStationResearch()
  development = createStationDevelopment()
  academy = createStationAcademy()
  manufacturing = createStationManufacturing()
  miningLevel = 0
  refiningLevel = 0
  sourceKnown = false
  ships: { id: string; name: string; freeM3: number; available: boolean; auxiliary: boolean; location: 'home' | 'source' | 'elsewhere' }[] = [
    { id: 'lab-shuttle', name: '合成转运副船', freeM3: 600, available: true, auxiliary: true, location: 'home' },
    { id: MINER_ID, name: '合成磷虾矿船', freeM3: miningParams(MINER_ID, 'belt-gas-phosphor', 0)!.capacityM3, available: true, auxiliary: true, location: 'home' },
  ]
  shipCargo: Record<string, Record<string, number>> = { [MINER_ID]: {} }
  engineering = 0
  private inventory: Record<string, number>
  readonly host: Host
  readonly populationHost: PopulationHost
  readonly trainingHost: StationTrainingHost
  readonly refiningHost: StationRefiningHost
  readonly miningHost: StationMiningHost
  readonly researchHost: StationResearchHost
  readonly developmentHost: StationDevelopmentHost
  readonly academyHost: StationAcademyHost
  readonly manufacturingHost: StationManufacturingHost
  private segmentWorking?: number[]
  private segmentMiningReady?: boolean
  private segmentDevelopmentPower?: number
  /** 第二阶段组合宿主的显式事件入口，仍由本时间轴统一推进/回滚。 */
  stageTwo?: {
    personBusy(index: number): boolean
    workingCells(): readonly number[]
    trainingBusy?(cellIndex: number): boolean
    nextEventMs(): number
    advance(ms: number): void
    afterSegment?(): void
    snapshot(): unknown
    restore(value: unknown): void
  }

  constructor(station = createPlayerStation(), inventory = initialInventory(), engineering = 0) {
    entriesOf(inventory)
    if (!quantity(engineering) || engineering > 5) throw new Error('工程学必须为 0–5')
    this.station = station
    this.inventory = { ...inventory }
    this.engineering = engineering
    this.host = {
      cellCount: () => this.development.expanded ? 16 : 9,
      unlocked: kind => !['manufacturing', 'training', 'warning'].includes(kind) || researchCompleted(this.research, `station-${kind}`),
      facilityState: index => ({ level: this.development.levels[String(index)] ?? 1, damaged: this.development.damaged.includes(index) }),
      externalConstructionPower: () => this.segmentDevelopmentPower ?? developmentPower(this.development, this.developmentHost).demand,
      engineeringLevel: () => this.engineering,
      available: (id) => this.inventory[id] ?? 0,
      take: (bill) => {
        const entries = entriesOf(bill)
        // 先检查整单，再同步扣除；不足时不能扣掉其中任何一项。
        if (entries.some(([id, amount]) => (this.inventory[id] ?? 0) < amount)) return false
        for (const [id, amount] of entries) this.inventory[id] = (this.inventory[id] ?? 0) - amount
        return true
      },
      give: (bill) => {
        const entries = entriesOf(bill)
        if (entries.some(([id, amount]) => !quantity((this.inventory[id] ?? 0) + amount))) {
          throw new Error('预览库存溢出')
        }
        for (const [id, amount] of entries) this.inventory[id] = (this.inventory[id] ?? 0) + amount
      },
      itemName: (id) => NAMES[id] ?? refiningItemName(id),
      engineers: () => this.population.people.flatMap((person, index) => person.status === 'resident'
        && this.training.qualifications[index] === 'engineer' && this.training.active?.personIndex !== index
        && this.research.assignment?.personIndex !== index
        && !this.extraOccupied(index)
        && !this.refining.runs.some(run => run.personIndex === index) && !this.mining.runs.some(run => run.personIndex === index) ? [index] : []),
      workingCells: () => this.segmentWorking ?? this.workingRequests(),
    }
    this.populationHost = {
      sourceKnown: () => this.sourceKnown,
      reception: () => { const view = this.view(); return { ready: view.receptionReady, capacity: view.power.populationCapacity } },
      ship: id => {
        const ship = this.ships.find(entry => entry.id === id)
        return ship ? { ...ship, freeM3: Math.max(0, ship.freeM3 - miningCargoM3(this.shipCargo[id] ?? {}, this.miningLevel)) } : undefined
      },
      claimShip: id => {
        const ship = this.ships.find(ship => ship.id === id)
        if (!ship?.available) return false
        ship.available = false
        return true
      },
      releaseShip: (id, location) => {
        const ship = this.ships.find(ship => ship.id === id)
        if (!ship) throw new Error('预览副船缺失')
        ship.available = true
        ship.location = location
      },
      available: this.host.available, take: this.host.take, give: this.host.give, itemName: this.host.itemName,
    }
    this.trainingHost = {
      residents: () => this.population.people.flatMap((person, index) => person.status === 'resident' ? [index] : []),
      available: index => !this.station.projects.some(project => project.engineerIndex === index)
        && !this.extraOccupied(index)
        && this.research.assignment?.personIndex !== index
        && !this.refining.runs.some(run => run.personIndex === index) && !this.mining.runs.some(run => run.personIndex === index),
      ready: () => this.populationView().receptionReady,
    }
    this.refiningHost = {
      residents: this.trainingHost.residents,
      personAvailable: index => this.training.active?.personIndex !== index && !this.station.projects.some(project => project.engineerIndex === index)
        && !this.extraOccupied(index)
        && this.research.assignment?.personIndex !== index
        && !this.mining.runs.some(run => run.personIndex === index),
      facilityAvailable: index => this.station.cells.some(cell => cell.kind === 'refinery' && cell.cellIndex === index),
      powered: index => {
        const view = this.view()
        return view.receptionReady && view.power.populationCapacity >= this.populationView().residents + this.populationView().reserved
          && view.cells.some(cell => cell.cellIndex === index && cell.operational)
      },
      recipe: id => refiningRecipe(id, this.refiningLevel),
      output: (id, batchUnits) => refiningOutput(id, batchUnits, this.refiningLevel),
      available: this.host.available,
      settle: (input, output) => {
        const needs = entriesOf(input), gives = entriesOf(output)
        if (needs.some(([id, n]) => this.host.available(id) < n)) return false
        const next = this.inventoryView()
        for (const [id, n] of needs) next[id] = (next[id] ?? 0) - n
        for (const [id, n] of gives) {
          const amount = (next[id] ?? 0) + n
          if (!quantity(amount)) throw new Error('精炼产物超出库存安全整数上限')
          next[id] = amount
        }
        this.inventory = next
        return true
      },
    }
    this.miningHost = {
      residents: this.trainingHost.residents,
      personAvailable: index => this.training.active?.personIndex !== index && !this.station.projects.some(project => project.engineerIndex === index)
        && !this.extraOccupied(index)
        && this.research.assignment?.personIndex !== index
        && !this.refining.runs.some(run => run.personIndex === index),
      ready: () => this.segmentMiningReady ?? this.populationView().receptionReady,
      ship: id => { const ship = this.ships.find(entry => entry.id === id); return ship ? { available: ship.available, auxiliary: ship.auxiliary, home: ship.location === 'home' } : undefined },
      params: (shipId, beltId) => miningParams(shipId, beltId, this.miningLevel),
      claimShip: id => {
        const ship = this.ships.find(entry => entry.id === id)
        if (!ship?.available || ship.location !== 'home') return undefined
        const cargo = { ...(this.shipCargo[id] ?? {}) }
        ship.available = false; ship.location = 'elsewhere'; this.shipCargo[id] = {}
        return cargo
      },
      releaseShip: (id, cargo) => {
        const ship = this.ships.find(entry => entry.id === id)!
        this.shipCargo[id] = { ...cargo }; ship.available = true; ship.location = 'home'
      },
      cycle: run => miningCycle(run, this.miningLevel), returnMs: run => miningReturnMs(run, this.miningLevel),
      unload: cargo => this.host.give(cargo),
    }
    this.researchHost = {
      researchers: () => this.trainingHost.residents().filter(index => this.training.qualifications[index] === 'researcher'),
      personAvailable: index => this.training.active?.personIndex !== index && !this.station.projects.some(project => project.engineerIndex === index)
        && !this.extraOccupied(index)
        && !this.refining.runs.some(run => run.personIndex === index) && !this.mining.runs.some(run => run.personIndex === index),
      facilityAvailable: index => this.station.cells.some(cell => cell.kind === 'research' && cell.cellIndex === index),
      powered: index => {
        const view = this.view(), population = this.populationView()
        return view.receptionReady && view.power.populationCapacity >= population.residents + population.reserved
          && view.cells.some(cell => cell.cellIndex === index && cell.operational)
      },
    }
    this.developmentHost = {
      built: () => this.station.built,
      facility: index => this.station.cells.find(cell => cell.cellIndex === index)?.kind,
      engineers: () => this.trainingHost.residents().filter(index => this.training.qualifications[index] === 'engineer'
        && !this.stageTwo?.personBusy(index)
        && this.training.active?.personIndex !== index && this.academy.active?.personIndex !== index
        && !this.station.projects.some(project => project.engineerIndex === index)
        && this.research.assignment?.personIndex !== index
        && !this.manufacturing.runs.some(run => run.personIndex === index)
        && !this.refining.runs.some(run => run.personIndex === index) && !this.mining.runs.some(run => run.personIndex === index)),
      technology: id => researchCompleted(this.research, id),
      ready: () => playerStationView(this.station, { ...this.host, externalConstructionPower: undefined }).receptionReady,
      availablePower: () => {
        const view = playerStationView(this.station, { ...this.host, externalConstructionPower: undefined })
        return Math.max(0, view.power.supply - view.power.demand)
      },
      engineeringLevel: this.host.engineeringLevel, available: this.host.available, take: this.host.take, give: this.host.give,
    }
    this.academyHost = {
      candidate: index => this.trainingHost.residents().includes(index) && this.training.qualifications[index] === null
        && !this.stageTwo?.personBusy(index)
        && this.training.active?.personIndex !== index && this.research.assignment?.personIndex !== index
        && !this.station.projects.some(project => project.engineerIndex === index)
        && !this.development.projects.some(project => project.engineerIndices.includes(index))
        && !this.manufacturing.runs.some(run => run.personIndex === index)
        && !this.refining.runs.some(run => run.personIndex === index) && !this.mining.runs.some(run => run.personIndex === index),
      facility: index => this.station.cells.some(cell => cell.kind === 'training' && cell.cellIndex === index),
      powered: index => this.populationView().receptionReady && this.view().cells.some(cell => cell.cellIndex === index && cell.operational),
      qualify: (index, course) => { this.training.qualifications[index] = course },
    }
    this.manufacturingHost = {
      residents: this.trainingHost.residents,
      personAvailable: index => this.training.active?.personIndex !== index && this.academy.active?.personIndex !== index
        && !this.stageTwo?.personBusy(index)
        && this.research.assignment?.personIndex !== index && !this.development.projects.some(project => project.engineerIndices.includes(index))
        && !this.station.projects.some(project => project.engineerIndex === index)
        && !this.refining.runs.some(run => run.personIndex === index) && !this.mining.runs.some(run => run.personIndex === index),
      facilityAvailable: index => this.station.cells.some(cell => cell.kind === 'manufacturing' && cell.cellIndex === index),
      powered: index => this.populationView().receptionReady && this.view().cells.some(cell => cell.cellIndex === index && cell.operational),
      recipe: id => manufacturingRecipe(id, 0), available: this.host.available, settle: this.refiningHost.settle,
    }
  }

  private extraOccupied(index: number) {
    return !!this.stageTwo?.personBusy(index) || this.academy.active?.personIndex === index || this.development.projects.some(project => project.engineerIndices.includes(index))
      || this.manufacturing.runs.some(run => run.personIndex === index)
  }
  private workingRequests() {
    const assignment = this.research.assignment
    const research = assignment && !assignment.paused && this.researchHost.researchers().includes(assignment.personIndex)
      && this.researchHost.personAvailable(assignment.personIndex) && this.researchHost.facilityAvailable(assignment.cellIndex)
      ? [assignment.cellIndex] : []
    const academy = this.academy.active
    const manufacturing = this.manufacturing.runs.filter(run => run.personIndex !== undefined && !run.paused
      && this.manufacturingHost.personAvailable(run.personIndex)
      && Object.entries(run.input).every(([id, n]) => this.host.available(id) >= n)).map(run => run.cellIndex)
    return [...this.refiningRequests(), ...research, ...manufacturing, ...(academy && !academy.paused && this.academyHost.candidate(academy.personIndex) ? [academy.cellIndex] : []), ...(this.stageTwo?.workingCells() ?? [])]
  }
  private refiningRequests() {
    return this.refining.runs.filter(run => run.personIndex !== undefined && !run.paused
      && this.population.people[run.personIndex].status === 'resident' && this.training.active?.personIndex !== run.personIndex
      && !this.station.projects.some(project => project.engineerIndex === run.personIndex)
      && !this.extraOccupied(run.personIndex)
      && this.host.available(run.itemId) >= run.batchUnits).map(run => run.cellIndex)
  }

  view() { return playerStationView(this.station, this.host) }
  populationView() { return stationPopulationView(this.population, this.populationHost) }
  trainingView() { return stationTrainingView(this.training, this.trainingHost) }
  trainingCommand(action: StationTrainingAction) {
    if (action.kind === 'enqueue' && this.training.qualifications.filter(Boolean).length + this.training.queue.length
      + (this.training.active ? 1 : 0) + (this.academy.active ? 1 : 0) >= 6) return { ok: false as const, reason: 'queue-full' as const }
    return stationTrainingCommand(this.training, this.trainingHost, action)
  }
  refiningView() { return stationRefiningView(this.refining, this.refiningHost) }
  refiningCommand(action: StationRefiningAction) {
    const result = stationRefiningCommand(this.refining, this.refiningHost, action)
    reconcileStationPopulation(this.population, this.populationHost)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  miningView() { return stationMiningView(this.mining, this.miningHost) }
  researchView() { return stationResearchView(this.research, this.researchHost) }
  researchCommand(action: StationResearchAction) {
    const result = stationResearchCommand(this.research, this.researchHost, action)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  developmentView() {
    return { ...structuredClone(this.development), availableEngineers: this.developmentHost.engineers().filter(index => !this.development.projects.some(project => project.engineerIndices.includes(index))),
      running: [...developmentPower(this.development, this.developmentHost).running],
      options: [
        { kind: 'expand' as const, cellIndex: undefined },
        ...this.station.cells.flatMap(cell => cell.kind === 'power' || cell.kind === 'life-support'
          ? [{ kind: cell.kind === 'power' ? 'power-upgrade' as const : 'life-upgrade' as const, cellIndex: cell.cellIndex }] : []),
        ...this.development.damaged.map(cellIndex => ({ kind: 'repair' as const, cellIndex })),
      ].filter(option => option.kind === 'expand' ? !this.development.expanded : option.kind === 'repair' || !this.development.levels[String(option.cellIndex)])
        .map(option => ({ ...option, spec: developmentSpec(option.kind, option.cellIndex, this.developmentHost), bill: developmentBill(option.kind, option.cellIndex, this.developmentHost) })),
    }
  }
  developmentCommand(action: DevelopmentAction) {
    const result = stationDevelopmentCommand(this.development, this.developmentHost, action)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  academyView() { return { ...structuredClone(this.academy), blocked: stationAcademyBlock(this.academy, this.academyHost) } }
  academyCommand(action: StationAcademyAction) {
    if (action.kind === 'assign' && this.stageTwo?.trainingBusy?.(action.cellIndex)) return { ok: false, reason: 'busy' }
    if (action.kind === 'assign' && this.training.qualifications.filter(Boolean).length + this.training.queue.length
      + (this.training.active ? 1 : 0) + (this.academy.active ? 1 : 0) >= 6) return { ok: false, reason: 'person' }
    const result = stationAcademyCommand(this.academy, this.academyHost, action)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  damageFacility(index: number) {
    const kind = this.developmentHost.facility(index)
    if (!kind || !['power', 'life-support', 'service'].includes(kind) || this.development.projects.some(project => project.cellIndex === index)) throw new Error('仅能对空闲保障设施模拟故障')
    if (!this.development.damaged.includes(index)) this.development.damaged.push(index)
    reconcileStationPopulation(this.population, this.populationHost)
  }
  warningView() {
    const online = this.view().cells.some(cell => cell.kind === 'warning' && cell.operational)
    const trip = this.population.trip
    const arrivals = online ? [
      ...(trip?.phase === 'inbound' ? [{ shipId: trip.shipId, remainingMs: trip.positionMs }] : []),
      ...this.mining.runs.filter(run => run.phase === 'returning').map(run => ({ shipId: run.shipId, remainingMs: run.durationMs - run.progressMs })),
    ] : []
    return { online, arrivals }
  }
  manufacturingView() { return stationManufacturingView(this.manufacturing, this.manufacturingHost) }
  manufacturingCommand(action: StationManufacturingAction) {
    const result = stationManufacturingCommand(this.manufacturing, this.manufacturingHost, action)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  miningCommand(action: StationMiningAction) {
    const result = stationMiningCommand(this.mining, this.miningHost, action)
    reconcileStationPopulation(this.population, this.populationHost)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  setMiningLevel(level: number) {
    if (!quantity(level) || level > 5 || this.mining.runs.length > 0 || this.ships.some(ship => !ship.available)) throw new Error('采矿测试技能仅可在全部副船空闲时调整')
    this.miningLevel = level
    this.ships.find(ship => ship.id === MINER_ID)!.freeM3 = miningParams(MINER_ID, 'belt-gas-phosphor', level)!.capacityM3
  }
  setRefiningLevel(level: number) {
    if (!quantity(level) || level > 5) throw new Error('精炼测试技能等级无效')
    this.refiningLevel = level
  }
  populationCommand(action: PopulationAction) {
    const result = stationPopulationCommand(this.population, this.populationHost, action)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  command(action: Action) {
    const result = playerStationCommand(this.station, this.host, action)
    reconcileStationPopulation(this.population, this.populationHost)
    reconcileStationTraining(this.training, this.trainingHost)
    return result
  }
  advance(minutes: number) {
    let left = minutes * 60_000
    if (!Number.isSafeInteger(left) || left < 0) throw new Error('预览推进时间无效')
    const before = structuredClone({ station: this.station, population: this.population, training: this.training,
      refining: this.refining, mining: this.mining, research: this.research, development: this.development, academy: this.academy, manufacturing: this.manufacturing, shipCargo: this.shipCargo, ships: this.ships, inventory: this.inventory })
    const stageBefore = this.stageTwo?.snapshot()
    try {
      reconcilePlayerStation(this.station, this.host)
      reconcileStationPopulation(this.population, this.populationHost)
      reconcileStationTraining(this.training, this.trainingHost)
      // 固定本段负荷/保障，按六模块最近事件切段；科研先取旧条件，矿船最后卸货。
      while (left > 0) {
        const step = Math.min(left, playerStationNextEventMs(this.station, this.host), stationPopulationNextEventMs(this.population), stationTrainingNextEventMs(this.training, this.trainingHost), stationRefiningNextEventMs(this.refining, this.refiningHost), stationMiningNextEventMs(this.mining, this.miningHost), stationResearchNextEventMs(this.research, this.researchHost), stationDevelopmentNextEventMs(this.development, this.developmentHost), stationAcademyNextEventMs(this.academy, this.academyHost), stationManufacturingNextEventMs(this.manufacturing, this.manufacturingHost), this.stageTwo?.nextEventMs() ?? Infinity)
        this.segmentWorking = this.workingRequests()
        const developmentRunning = developmentPower(this.development, this.developmentHost).running
        this.segmentDevelopmentPower = developmentPower(this.development, this.developmentHost).demand
        this.segmentMiningReady = this.populationView().receptionReady
        try {
          this.stageTwo?.advance(step)
          advanceStationResearch(this.research, this.researchHost, step)
          advanceStationAcademy(this.academy, this.academyHost, step)
          advanceStationTraining(this.training, this.trainingHost, step, true)
          advanceStationPopulation(this.population, this.populationHost, step, true)
          advanceStationManufacturing(this.manufacturing, this.manufacturingHost, step)
          advanceStationRefining(this.refining, this.refiningHost, step)
          advancePlayerStation(this.station, this.host, step)
          advanceStationMining(this.mining, this.miningHost, step)
          advanceStationDevelopment(this.development, this.developmentHost, step, developmentRunning)
        } finally { this.segmentWorking = undefined; this.segmentMiningReady = undefined; this.segmentDevelopmentPower = undefined }
        reconcileStationPopulation(this.population, this.populationHost)
        reconcileStationTraining(this.training, this.trainingHost)
        this.stageTwo?.afterSegment?.()
        left -= step
      }
    } catch (error) {
      this.station = before.station
      this.population = before.population
      this.training = before.training
      this.refining = before.refining
      this.mining = before.mining
      this.research = before.research
      this.development = before.development
      this.academy = before.academy
      this.manufacturing = before.manufacturing
      this.shipCargo = before.shipCargo
      this.ships = before.ships
      this.inventory = before.inventory
      if (stageBefore !== undefined) this.stageTwo?.restore(stageBefore)
      throw error
    }
  }
  inventoryView(): Record<string, number> { return { ...this.inventory } }

  setInventory(id: string, amount: number): void {
    entriesOf({ [id]: amount })
    this.inventory[id] = amount
    reconcileStationPopulation(this.population, this.populationHost)
  }

  setEngineering(level: number): void {
    if (!quantity(level) || level > 5) throw new Error('工程学必须为 0–5')
    this.engineering = level
    reconcilePlayerStation(this.station, this.host)
  }

  deliver(materials: Bill) {
    const shipment = Object.fromEntries(entriesOf(materials).filter(([, amount]) => amount > 0))
    if (Object.keys(shipment).length === 0) return { ok: true as const, accepted: {}, rejected: {} }
    // 扣料前验证模块快照；交接意外失败时连同模块状态一起回滚，不能只补库存。
    const stationBefore = loadPlayerStation(serializePlayerStation(this.station, this.host.cellCount!()), this.host.cellCount!())
    const inventoryBefore = this.inventoryView()
    try {
      if (!this.host.take(shipment)) return { ok: false as const, accepted: {}, rejected: {} }
      const result = receivePlayerStationMaterials(this.station, this.host, shipment)
      // 拒收原物回到本次预留来源；没有航程、正式运输队列或生产模拟。
      this.host.give(result.rejected)
      return { ok: true as const, ...result }
    } catch (error) {
      this.station = stationBefore
      this.inventory = inventoryBefore
      throw error
    }
  }

  recover(): Record<string, number> {
    const limits = Object.fromEntries(MATERIAL_IDS.map((id) => [id, Number.MAX_SAFE_INTEGER - this.host.available(id)]))
    const recovered = takePlayerStationRecovery(this.station, limits)
    this.host.give(recovered)
    return recovered
  }

  snapshot(): string {
    return JSON.stringify({
      format: SNAPSHOT_FORMAT, version: 8, engineering: this.engineering,
      inventory: this.inventoryView(), station: serializePlayerStation(this.station, this.host.cellCount!()),
      population: cleanStationPopulation(this.population), sourceKnown: this.sourceKnown,
      ships: this.ships.map(ship => ({ ...ship })),
      training: cleanStationTraining(this.training, this.trainingHost.residents()),
      refining: cleanStationRefining(this.refining), refiningLevel: this.refiningLevel,
      mining: cleanStationMining(this.mining), miningLevel: this.miningLevel, shipCargo: structuredClone(this.shipCargo),
      research: cleanStationResearch(this.research),
      development: structuredClone(this.development), academy: cleanStationAcademy(this.academy),
      manufacturing: cleanStationManufacturing(this.manufacturing),
    }, null, 2)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('独立预览快照结构无效')
  return value as Record<string, unknown>
}

export function importSnapshot(text: string): LabModel {
  if (new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) throw new Error('快照超过 2 MiB')
  const file = record(JSON.parse(text))
  if (file.format !== SNAPSHOT_FORMAT || ![1, 2, 3, 4, 5, 6, 7, 8].some(version => version === file.version) || typeof file.station !== 'string') {
    throw new Error('仅接受本工具导出的独立快照，不接受正式游戏存档')
  }
  if (!quantity(file.engineering) || file.engineering > 5) throw new Error('工程学必须为 0–5')
  const inventory = record(file.inventory)
  for (const [id, amount] of Object.entries(inventory)) {
    if (!MATERIAL_IDS.includes(id) || !quantity(amount)) throw new Error('快照库存包含无效物品或数量')
  }
  const expanded = file.version === 8 && record(file.development).expanded === true
  const station = loadPlayerStation(file.station, expanded ? 16 : 9)
  const version = Number(file.version)
  if (version < 7 && file.research !== undefined) throw new Error('旧快照不应包含科研账')
  if (version < 8 && (file.development !== undefined || file.academy !== undefined || file.manufacturing !== undefined)) throw new Error('旧快照不应包含发展账')
  if (version < 6 && (file.mining !== undefined || file.miningLevel !== undefined || file.shipCargo !== undefined)) throw new Error('旧快照不应包含采矿账')
  if (version < 5 && (file.refining !== undefined || file.refiningLevel !== undefined)) throw new Error('旧快照不应包含精炼账')
  if (version < 8 && [...station.cells, ...station.projects].some(entry => ['manufacturing', 'training', 'warning'].includes(entry.kind))) throw new Error('旧快照不应包含新经营设施')
  if (version < 4 && (station.projects.some(project => project.engineerIndex !== undefined)
    || [...station.cells, ...station.projects].some(entry => entry.kind === 'refinery' || entry.kind === 'research'))) throw new Error('旧版预览不应包含新设施工程')
  const model = new LabModel(station, inventory as Record<string, number>, file.engineering)
  if (version === 8) {
    const development = record(file.development)
    model.development.expanded = development.expanded === true
    model.academy = cleanStationAcademy(file.academy)
    model.manufacturing = cleanStationManufacturing(file.manufacturing)
  }
  // 老预览没有人口与副船账；仅初始化未发现、零居民，不发物资或人口奖励。
  if (file.version === 1) {
    if (file.population !== undefined || file.ships !== undefined || file.sourceKnown !== undefined || file.training !== undefined) throw new Error('旧版快照不应包含新版人口账')
    return model
  }
  if (typeof file.sourceKnown !== 'boolean' || !Array.isArray(file.ships) || file.ships.length !== (version >= 6 ? 2 : 1)) throw new Error('预览人口与副船快照不完整')
  model.population = cleanStationPopulation(file.population)
  model.sourceKnown = file.sourceKnown
  const defaults = model.ships
  model.ships = file.ships.map((entry, index) => {
    const ship = record(entry)
    if (ship.id !== defaults[index].id || ship.name !== defaults[index].name || !quantity(ship.freeM3) || ship.freeM3 > 1_000_000
      || typeof ship.available !== 'boolean' || typeof ship.auxiliary !== 'boolean' || !['home', 'source', 'elsewhere'].includes(String(ship.location))) throw new Error('预览副船账无效')
    return { id: ship.id, name: ship.name, freeM3: ship.freeM3, available: ship.available, auxiliary: ship.auxiliary,
      location: ship.location as 'home' | 'source' | 'elsewhere' }
  })
  if (version < 6) model.ships.push(defaults[1])
  if (version >= 6) {
    if (!quantity(file.miningLevel) || file.miningLevel > 5) throw new Error('采矿测试技能无效')
    model.miningLevel = file.miningLevel
    model.mining = cleanStationMining(file.mining)
    const cargo = record(file.shipCargo)
    if (Object.keys(cargo).some(id => id !== MINER_ID) || cargo[MINER_ID] === undefined) throw new Error('矿船原货物账无效')
    model.shipCargo = { [MINER_ID]: record(cargo[MINER_ID]) as Record<string, number> }
    if (!miningCargoValid(model.shipCargo[MINER_ID])) throw new Error('矿船原货物无效')
    if (model.ships[1].freeM3 !== miningParams(MINER_ID, 'belt-gas-phosphor', model.miningLevel)!.capacityM3) throw new Error('矿船余舱参数无效')
  }
  const trip = model.population.trip, ship = trip ? model.ships.find(entry => entry.id === trip.shipId) : undefined
  if (trip && (!ship || ship.available || model.populationHost.ship(ship.id)!.freeM3 < trip.slots * 100 || !ship.auxiliary)
    || !model.sourceKnown && (model.population.plan || Object.keys(model.population.sourceMaterials).length > 0
      || model.population.people.some(person => person.status !== 'dormant'))
    || !station.built && model.population.people.some(person => person.status !== 'dormant')) throw new Error('人口任务与副船占用不一致')
  if (version >= 3) model.training = cleanStationTraining(file.training, model.trainingHost.residents())
  else if (file.training !== undefined) throw new Error('旧版快照不应包含新版课程账')
  if (station.projects.some(project => project.engineerIndex !== undefined && (model.population.people[project.engineerIndex].status !== 'resident'
    || model.training.qualifications[project.engineerIndex] !== 'engineer' || model.training.active?.personIndex === project.engineerIndex))) throw new Error('工程与人员资格/占用不一致')
  if (version >= 7) model.research = cleanStationResearch(file.research)
  if (version === 8) model.development = cleanStationDevelopment(file.development, model.developmentHost)
  const assignment = model.research.assignment
  if (assignment && (!model.researchHost.researchers().includes(assignment.personIndex)
    || !model.researchHost.personAvailable(assignment.personIndex) || !model.researchHost.facilityAvailable(assignment.cellIndex))
    || !station.built && model.researchView().catalog.some(project => project.progressMs > 0 || project.completed)) throw new Error('科研人员/资格/设施快照不一致')
  if (version >= 5) {
    if (!quantity(file.refiningLevel) || file.refiningLevel > 5) throw new Error('精炼测试技能等级无效')
    model.refiningLevel = file.refiningLevel
    model.refining = cleanStationRefining(file.refining)
    for (const run of model.refining.runs) {
      const validRecipe = [0, 1, 2, 3, 4, 5].some(level => {
        const recipe = refiningRecipe(run.itemId, level)
        return recipe?.batchUnits === run.batchUnits && recipe.cycleMs === run.cycleMs
      })
      if (!model.refiningHost.facilityAvailable(run.cellIndex) || !validRecipe
        || run.personIndex !== undefined && (!model.trainingHost.residents().includes(run.personIndex) || !model.refiningHost.personAvailable(run.personIndex))) throw new Error('精炼设备/人员/批次快照不一致')
    }
  } else if (file.refining !== undefined || file.refiningLevel !== undefined) throw new Error('旧快照不应包含精炼账')
  for (const run of model.mining.runs) {
    const ship = model.ships.find(entry => entry.id === run.shipId)
    const params = model.miningHost.params(run.shipId, run.beltId)
    const duration = run.phase === 'returning' ? miningReturnMs(run, model.miningLevel)
      : run.phase === 'departure' ? params?.departureMs : params?.cycleMs
    if (!params || !ship || ship.available || ship.location !== 'elsewhere' || !ship.auxiliary
      || duration !== run.durationMs || !miningCargoValid(run.cargo) || Object.keys(model.shipCargo[run.shipId] ?? {}).length > 0
      || !model.trainingHost.residents().includes(run.personIndex) || !model.miningHost.personAvailable(run.personIndex)
      || trip?.shipId === run.shipId) throw new Error('采矿人口/船只/货物/航程不一致')
  }
  for (const ship of model.ships) {
    const used = trip?.shipId === ship.id || model.mining.runs.some(run => run.shipId === ship.id)
    if (ship.available === used) throw new Error('副船占用与任务不一致')
  }
  if (station.cells.some(cell => !model.host.unlocked!(cell.kind)) || station.projects.some(project => project.kind !== 'body' && !model.host.unlocked!(project.kind))) throw new Error('设施缺少科研资格')
  if (!station.built && (model.development.expanded || Object.keys(model.development.levels).length > 0 || model.development.projects.length > 0)) throw new Error('未建站不可拥有发展工程')
  if (model.development.expanded && !researchCompleted(model.research, 'station-expansion-1')
    || Object.keys(model.development.levels).some(index => !researchCompleted(model.research, model.developmentHost.facility(Number(index)) === 'power' ? 'station-power-2' : 'station-life-2'))) throw new Error('发展成果缺少对应技术')
  const academy = model.academy.active
  if (academy && (!model.academyHost.facility(academy.cellIndex) || !model.academyHost.candidate(academy.personIndex))) throw new Error('培训中心人员/设备无效')
  if (model.training.qualifications.filter(Boolean).length + model.training.queue.length + (model.training.active ? 1 : 0) + (academy ? 1 : 0) > 6) throw new Error('课程计划超过可培养人口')
  for (const run of model.manufacturing.runs) {
    const recipe = manufacturingRecipe(run.blueprintId, 0)
    if (!recipe || !model.manufacturingHost.facilityAvailable(run.cellIndex) || recipe.cycleMs !== run.cycleMs
      || JSON.stringify(recipe.input) !== JSON.stringify(run.input) || JSON.stringify(recipe.output) !== JSON.stringify(run.output)
      || run.personIndex !== undefined && (!model.trainingHost.residents().includes(run.personIndex) || !model.manufacturingHost.personAvailable(run.personIndex))) throw new Error('制造任务/人员/配方无效')
  }
  return model
}
