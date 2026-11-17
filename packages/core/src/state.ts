import type { BattleState } from './combat/state/battle'
import type { MarketRelayState } from './market/relayTypes'
import { commandShipDeployed } from './combat/command/locks'
import type { DroneLossReport, BattleReportRecord } from './combat/state/report'

import type { AiCoreType, CommsInstanceEntry, DamageType, FittedModules, StationSiteDef } from './types'
import type { WeekendEventState, WeekendResultSnapshot } from './weekendEvent'
import { emptyFitted } from './labels'
import type { WormholeState } from './wormhole'
import type { PlanetaryState } from './planetTypes'
import { signalSpaceTextId } from './explorationText'
/**
 * 🔴 **这里绝不能 import `mining` / `salvaging`**（**2026-10-02 实测踩到**）：
 * 我曾为了"切活动自动停作业时建返航账本"在本文件 import 那两个模块 —— 立即形成
 * `state → salvaging → expedition → hauling → state` 的环，入口模块的**顶层常量**会在
 * `state.ts` 求值完成**之前**被读到，游戏一进去就炸：
 * `hauling.ts:149 Uncaught ReferenceError: Cannot access 'HOME_GALAXY_ID' before initialization`。
 *
 * 正解（**两段式**）：本文件用**纯数据**先建一份**占位返航账本**（`legMs` 按相位粗估，够撑到下一拍），
 * 并记下 `pendingActivityReturn`；**引擎下一拍**（`engine.advanceGame` 在环外，可安全 import 作业模块）
 * 调 `retireXxxShip(preserveExisting: true)` 用**真值腿长**覆盖占位，并补写带船名与真实秒数的日志。
 */

export const INITIAL_STANDING = 0

export type { FittedModules } from './types'

export const CURRENT_STATE_VERSION = 31
export const HOME_GALAXY_ID = 'galaxy-hub'
export const MAX_SKILL_LEVEL = 5
export const DEFAULT_LOG_CAP = 300
export const DEFAULT_PILOT_NAME = '深空学徒'
export const DEFAULT_START_ISK = 10_000
export const DEFAULT_START_SHIP_ID = 'sandcat'
export const MAX_AI_CORE_LEVEL = 5

export type LogKind =
  | 'system'
  | 'info'
  | 'levelup'
  | 'queue'
  | 'warn'
  | 'trade'
  | 'event'
  | 'combat'
  | 'industry'
  | 'fleet'
  | 'salvage'

export interface CmdText {
  readonly id: string
  readonly params?: Readonly<Record<string, string | number>>
}

export type LogParams = Readonly<Record<string, string | number>>

export interface LogEntry {
  id: number
  atGameMs: number
  kind: LogKind
  text: string
  textId?: string
  textParams?: LogParams
}

export interface RngState {
  seed: number
  count: number
  box?: number
}

export interface TrainingItem {
  skillId: string
  targetLevel: number
  progressMs: number
}

export interface SkillsState {
  commandCompensationVersion?: 1
  progressVersion?: 1
  trained: Record<string, number>
  queue: TrainingItem[]
  savedProgress: Record<string, number>
  /**
   * **已购训练许可的技能编号**（2026-09-27 船长令「我想让学习技能有成本」）——
   * 键 = 技能编号，值恒 `true`（用 Record 而非 Set：与 `trained` 同为可直接 JSON 落盘的普通对象）。
   *
   * 收费档 = rank4/5/6（价目见 `SKILL_LICENSE_PRICES`，rank6 为预留档）；rank1~3 免许可、
   * 老档「已练到 Lv≥1」视同已购 ⇒ 判据看 `skillLicenseMissing`，**不写迁移键**。
   */
  licenses: Record<string, true>
}

export interface CharacterState {
  name: string
  startedAtWallMs: number
}

export interface WalletState {
  isk: number
}

export interface WarehouseState {
  items: Record<string, number>
}


export interface FleetShipState {
  defId?: string
  customName?: string | null
  durability: number
  armorPct?: number
  cargo: Record<string, number>
  fitted: FittedModules
  plugs?: string[]
  damagePlugs?: import('./shipDamage').ShipDamageKind[]
  droneLoad?: Record<string, number>
  ammoPref?: Partial<Record<DamageType, string>>
}

export interface MiningState {
  active: boolean
  beltId: string | null
  phase: 'mining' | 'returning' | 'outbound'
  cycleAccMs: number
  phaseAccMs: number
  tripUnits: number
  autoCycle: boolean
  stopAfterTrip: boolean
  originGalaxy: string | null
  rvLeft?: number
  shipProgress?: Record<string, { cycleAccMs: number; rvLeft: number }>
  fuelMul?: number
}

export interface ShipReturnState {
  beltId: string | null
  legMs: number
  phaseAccMs: number
  reason?: 'mining' | 'expedition' | 'salvage' | 'salvageStop' | 'miningStop'
}

export interface WorkReturnProgress {
  phase: 'mining' | 'salvaging' | 'outbound' | 'returning'
  phaseAccMs: number
  fuelMul?: number
  originGalaxy?: string | null
}

export interface ShipTransitState {
  active: boolean
  fromGalaxy: string | null
  toGalaxy: string | null
  finishAtGameMs: number
  legMs: number
  delivery: {
    siteId: string
    phase: 'to-site' | 'to-station'
    loaded?: Record<string, number>
  } | null
}

export interface WormholeScanState {
  active: boolean
  progressMs: number
  welcomed?: boolean
}

export type WormholeArchetype = 'balanced' | 'wreck' | 'ruins' | 'vein' | 'combat'

export type WormholeFamily = 'A' | 'C' | 'D' | 'E' | 'G'

export interface WormholeStockItem {
  id: string
  expeditionRules?: number
  seed: number
  depth: number
  archetype?: WormholeArchetype
  family?: WormholeFamily
  foundAtGameMs: number
}

export interface WormholeAutoRun {
  estimateRules?: number
  estimate?: import('./signalAuto/types').SignalAutoEstimate
  yieldMul?: number
  expeditionRules?: number
  expeditionSnapshot?: string
  haulerFittingVersion?: 1
  id: string
  stockId: string
  seed: number
  depth: number
  family?: WormholeFamily
  archetype?: WormholeArchetype
  shipIds: string[]
  startedAtGameMs: number
  finishAtGameMs: number
}

export interface WormholeAutoReport {
  expeditionRules?: number
  shipsLost?: string[]
  suppliesReturned?: Record<string, number>
  simulationMs?: number
  expeditionGoal?: import('./wormhole').WormholeRunState['expeditionGoal']
  expeditionProgress?: import('./wormhole').WormholeRunState['expeditionProgress']
  suppliesFound?: Record<string, number>
  id: string
  stockId: string
  depth: number
  finishedAtGameMs: number
  shipIds: string[]
  coresReleased: number
  gains: Array<{ itemId: string; units: number }>
  signalAuto?: import('./signalAuto/types').SignalAutoReportDetails
  cores?: Array<{ type: 'gamma' | 'beta' | 'alpha'; n: number }>
  damage: Array<{
    shipId: string
    name: string
    durabilityLossPct: number
    armorLossPct: number
    durabilityPct: number
    armorPct: number
  }>
  confirmed: boolean
}
export interface StandbyState {
  active: boolean
  galaxyId: string | null
  finishAtGameMs: number
  legMs: number
}

export interface ManufacturingRunState {
  active: boolean
  id: number
  blueprintId: string | null
  worker?: 'pilot' | AiCoreType
  finishAtGameMs: number
  durationMs: number
  bookSpent?: boolean
  spentMaterials?: { itemId: string; count: number }[]
  autoRepeat?: boolean
  repeatGoal?: number
  produced?: number
}

export interface ManufacturingLoopState {
  on: boolean
  goal?: number
  produced?: number
  stopWhy?: string
}

export interface RefineRunState {
  active: boolean
  id: number
  worker: 'pilot' | AiCoreType
  recipe: 'refine' | 'recycle' | 'unbox'
  itemId: string | null
  batchUnits: number
  cycleMs: number
  finishAtGameMs: number
  batchesDone: number
  lockUnits?: number
  claimedUnits?: number
  rareBoxEligible?: boolean
  rareUnits?: number
  rareUnitsAtStart?: number
  rareBurnedSinceStart?: number
  rareBurnBefore?: number
  rareBoxBefore?: number
  recAcc?: {
    min: Record<string, number>
    mod: Record<string, number>
    frag: Record<string, number>
    drone?: Record<string, number>
    blueprint?: Record<string, number>
  }
}

export interface LabRunState {
  active: boolean
  id: number
  worker: 'pilot' | AiCoreType
  recipeId: string
  batchUnits: number
  cycleMs: number
  finishAtGameMs: number
  deliveryBlocked?: boolean
  spentMaterials?: { itemId: string; count: number }[]
}

export interface LabLoopState {
  on: boolean
  goal?: number
  produced: number
  stopWhy?: string
}

export const EMPTY_REFINE_RUN: RefineRunState = {  active: false,
  id: -1,
  worker: 'pilot',
  recipe: 'refine',
  itemId: null,
  batchUnits: 0,
  cycleMs: 0,
  finishAtGameMs: 0,
  batchesDone: 0,
}

export interface SalvageOpState {
  active: boolean
  galaxyId: string | null
  phase: 'outbound' | 'salvaging' | 'returning'
  phaseAccMs: number
  cycleAccMs: number
  tripM3: number
  deviceAccMs: Record<string, number>
  deviceClockVersion?: 2
  autoCycle: boolean
  targetGroup?: string
  stopAfterTrip: boolean
  fuelMul?: number
}

export const EMPTY_SALVAGE_OP: SalvageOpState = {
  active: false,
  galaxyId: null,
  phase: 'salvaging',
  phaseAccMs: 0,
  cycleAccMs: 0,
  tripM3: 0,
  deviceAccMs: {},
  autoCycle: true,
  stopAfterTrip: false,
}

import type { ExpeditionState } from './expedition/types'
export type { ExpeditionState } from './expedition/types'

export interface BlinkSeg {
  queuedMs: number
  vanishMs: number
  moveAtMs: number
  appearMs: number
  from: number
  to: number
  moved?: true
}
























export interface MarketPoolState {
  q: number
  shock: number
  noise: number
  netVol: number
  lastHistoryGameMs: number
  limitedSupply?: { remaining: number; refillProgressMs: number; lastRefillGameMs?: number }
}

export interface NpcMarketOrder {
  price: number
  qty: number
  expiresAtGameMs: number
  bm?: boolean
  relay?: { quoteId: string }
}

export interface MarketDigestEntry {
  qty: number
  price: number
  perWindow: number
}

export interface MarketState {
  relay?: MarketRelayState
  pools: Record<string, MarketPoolState>
  npcBuy: Record<string, NpcMarketOrder[]>
  npcSell: Record<string, NpcMarketOrder[]>
  digest: Record<string, MarketDigestEntry>
  lastTickGameMs: number
  slowDrawLastGameMs?: number
  orderSeq: number
  priceHistory: Record<string, number[]>
}

export interface PlayerOrder {
  relayId?: string
  remoteApplied?: number
  id: number
  side: 'sell' | 'buy'
  good: string
  price: number
  qty: number
  filled: number
  placedAtGameMs: number
  absorbCredit?: number
  windowFilled?: number
  escrowIsk?: number
}

export interface GameStateV9 extends Omit<GameStateV8, 'version' | 'blueprints'> {
  version: 9
  market: MarketState
  orders: PlayerOrder[]
  escrowItems: Record<string, number>
  escrowShips: Record<
    number,
    { shipId: string; defId: string; durability: number; customName: string | null; from?: 'fleet' | 'store' }
  >
  learnedRecipes: string[]
  spentOneTimeRecipes?: string[]
  recycleCarry?: Record<string, number>
  blueprintStock: Record<string, number>
  shipStore?: Record<string, number>
  fitPresets?: Record<string, ShipFitPreset[]>
  wormholePreparationTemplates?: import('./wormholePreparationTemplates').WormholePreparationTemplate[]
  preparationSquads?: import('./preparationSquads').PreparationSquads
  fleetPresets?: import('./fleetPresets').FleetPreset[]
  combatEscort?: import('./combat/command/types').CombatSortie
}

export interface ShipFitPreset {
  name: string
  fitted: { high: Array<string | null>; mid: Array<string | null>; low: Array<string | null> }
  droneLoad?: Record<string, number>
  plugs?: string[]
}

export interface AiMiningTask {
  kind: 'mining'
  beltId: string
  phase: 'mining' | 'returning' | 'outbound'
  cycleAccMs: number
  phaseAccMs: number
  tripUnits: number
  rvLeft?: number
  fuelMul?: number
}

export interface AiSalvageTask {
  kind: 'salvage'
  galaxyId: string
  phase: 'outbound' | 'salvaging' | 'returning'
  phaseAccMs: number
  cycleAccMs: number
  deviceAccMs: Record<string, number>
  tripM3: number
  fuelMul?: number
}

export interface AiExpeditionTask {
  kind: 'expedition'
  anomalyId: string
  finishAtGameMs: number
  outMs: number
  power: number
  phase: 'out' | 'battle' | 'back'
  battle: BattleState | null
  fuelMul?: number
}

export interface AiStandbyTask {
  kind: 'standby'
  galaxyId: string
  finishAtGameMs: number
  outMs: number
  phase: 'out' | 'stand'
}

export type AiTask = AiMiningTask | AiSalvageTask | AiExpeditionTask | AiStandbyTask

export interface AiAssignment {
  coreType: AiCoreType
  startedAtGameMs: number
  task: AiTask
}

export interface GameStateV7 {
  version: 7
  gameMs: number
  savedAtWallMs: number
  logCap: number
  character: CharacterState
  rng: RngState
  skills: SkillsState
  wallet: WalletState
  shipId: string
  fleet: Record<string, FleetShipState>
  warehouse: WarehouseState
  moduleBay: Record<string, number>
  blueprints: string[]
  /** AI 核心等级 0~5：自动周转许可与效率（未来多船自动执行的前置） */
  aiCoreLevel: number
  mining: MiningState
  manufacturing: ManufacturingRunState
  standings: Record<string, number>
  standingsEarned?: Record<string, number>
  blackboxSeen?: boolean
  expedition: ExpeditionState
  wormhole: WormholeState
  logs: LogEntry[]
}

export interface GameStateV1 {
  version: 1
  gameMs: number
  savedAtWallMs: number
  logCap: number
  character: CharacterState
  rng: RngState
  skills: SkillsState
  logs: LogEntry[]
}

export type GameStateV2 = GameStateV1 & {
  version: 2
  wallet: WalletState
  shipId: string
  inventory: { items: Record<string, number> }
  mining: { active: boolean; beltId: string | null; cycleAccMs: number; tripUnits: number }
}

export type GameStateV3 = GameStateV2 & {
  version: 3
  moduleBay: Record<string, number>
  fitted: FittedModules
  blueprints: string[]
  manufacturing: { active: boolean; blueprintId: string | null; finishAtGameMs: number; durationMs: number }
}

export type GameStateV4 = GameStateV3 & {
  version: 4
  standings: Record<string, number>
  expedition: {
    active: boolean
    anomalyId: string | null
    finishAtGameMs: number
    durationMs: number
    outMs: number
    combatMs: number
    power: number
  }
}

export type GameStateV5 = GameStateV4 & { version: 5 }

export type GameStateV6 = GameStateV5 & {
  shipBay: string[]
}

export interface GameStateV8 extends Omit<GameStateV7, 'version' | 'aiCoreLevel'> {
  version: 8
  aiCores: Record<string, number>
  aiAssignments: Record<string, AiAssignment>
}

export type GameStateV10 = Omit<GameStateV9, 'version'> & { version: 10 }

export interface EventsState {
  nextAtGameMs: number
}

export type GameStateV11 = Omit<GameStateV10, 'version'> & {
  version: 11
  events: EventsState
}

export interface ScanningState {
  active: boolean
  galaxyId: string | null
  finishAtGameMs: number
  startedAtGameMs: number
  originGalaxy: string | null
  returning?: boolean
  awaitingView?: boolean
  lastGalaxyId?: string | null
}

export type GameStateV12 = Omit<GameStateV11, 'version'> & { version: 12 }

export type GameStateV13 = Omit<GameStateV12, 'version'> & {
  version: 13
  exploredGalaxies: string[]
  scanning: ScanningState
}

export type GameStateV14 = Omit<GameStateV13, 'version'> & {
  version: 14
  scanProgress: Record<string, number>
}

export type GameStateV15 = Omit<GameStateV14, 'version'> & {
  version: 15
  debugQuick: boolean
  completedBounties: string[]
}

export type GameStateV16 = Omit<GameStateV15, 'version'> & {
  version: 16
  shipReturns: Record<string, ShipReturnState>
  shipLocks: Record<string, boolean>
  awayGalaxy: string | null
  transit: ShipTransitState
  bountyCooldowns: Record<string, number>
  autoLoopAnomalyId: string | null
  haltedBySwitch?: { kind: 'mining' | 'salvaging' } | null
  pendingActivityReturn?: { kind: 'mining' | 'salvaging'; id: string; progress?: WorkReturnProgress } | null
  stationSites: Record<string, StationSiteProgress>
  dockedSite: string | null
  hauling: HaulingState
  dialogueSeen: Record<string, boolean>
  pendingDialogue: string | null
  commsDelivered?: Record<string, number>
  commsInstance?: Record<string, CommsInstanceEntry>
  weekendLastResult?: WeekendResultSnapshot
  weekendPrepSquad?: string[]
  commsPopups?: string[]
  ambushRetreatSeen?: boolean
  foeShipSeen?: Record<string, true>
  firstShipBuilt?: boolean
  labOpened?: boolean
  commsRead?: Record<string, boolean>
  deliveryNotice?: string | null
  autoLoopStopNotice?: string | null
  autoLoopDroneFloor?: number | null
  droneLossNotice?: string | null
  droneLossReport?: DroneLossReport | null
  battleReport?: BattleReportRecord | null
  nebulaHintNotice?: string | null
  marks: MarksState
  rareWreckDryStreak?: number
}

export interface MarksState {
  goods: string[]
  recipes: string[]
  blueprints: string[]
  ships: string[]
  labRecipes: string[]
}

export function emptyMarks(): MarksState {
  return { goods: [], recipes: [], blueprints: [], ships: [], labRecipes: [] }
}

export interface HaulingState {
  fleetLeg?: import('./hauling/types').HaulFleetLeg
  active: boolean
  routeA: string | null
  routeB: string | null
  fromSiteId: string | null
  toSiteId: string | null
  legMinutes: number
  legMs: number
  phaseAccMs: number
  tripMul: number
  tripLegsLeft: number
}

export const EMPTY_HAULING: HaulingState = {
  active: false,
  routeA: null,
  routeB: null,
  fromSiteId: null,
  toSiteId: null,
  legMinutes: 0,
  legMs: 0,
  phaseAccMs: 0,
  tripMul: 0,
  tripLegsLeft: 0,
}

export interface StationSiteProgress {
  stage: number
  delivered: Record<string, number>
}

export interface EncounterState {
  automatic?: true
  pirate?: import('./encounters/riskTypes').PirateEncounterSnapshot
  active: boolean
  shipId: string | null
  galaxyId: string | null
  name: string
  threat: number
  anomalyId: string | null
  origin: string
  invitedAtGameMs: number
  deadlineGameMs: number
  battle: BattleState | null
  foeStrengthMul?: number
}
export interface WreckGalaxyRecord {
  density: number
  rare: number
  byGroup?: Record<string, number>
  rareBy?: Record<string, number>
}

export interface WeekendWreckBucket {
  density: number
  decayAccMs: number
  rare?: number
  rareBy?: Record<string, number>
}

export interface WeekendWreckRecord {
  byFamily: Record<string, WeekendWreckBucket>
}

export type WreckLogCause =
  | 'expedition-lost'
  | 'ai-lost'
  | 'wormhole-sunk'
  | 'wormhole-lost'
  | 'encounter-lost'

export interface WreckLogEntry {
  seq: number
  shipId: string
  shipName: string
  defId?: string
  cause: WreckLogCause
  galaxyId?: string
  wormholeDepth?: number
  atGameMs: number
  fitted?: FittedModules
  plugs?: string[]
  damagePlugs?: import('./shipDamage').ShipDamageKind[]
  droneLoad?: Record<string, number>
  wreckGalaxyId?: string
  recovered?: boolean
}

export interface ShipWreckRecord {
  seq: number
  galaxyId: string
  shipId: string
  name: string
  defId?: string
  customName?: string | null
  recoveryRules?: 2
  equipmentRolled?: boolean
  damagePlugs?: import('./shipDamage').ShipDamageKind[]
  fitted?: FittedModules
  droneLoad?: Record<string, number>
  plugs?: string[]
  durability?: number
  armorPct?: number
  reinforceChance?: number
  hullRolled?: boolean
  pityUsed?: boolean
  density: number
  decayAccMs: number
  createdAtWallMs: number
}

export type GameStateV18 = Omit<GameStateV16, 'version'> & {
  version: 18
  encounter: EncounterState
  industrialProtection?: { version: 1; entryRemainingMs: number; dockedMs: number; postBattleUntilMs: number }
  industrialFleetRiskSeen?: true
  lowSecNotified: boolean
  encounterZoneCooldown: Record<string, number>
  lowSecPresence: Record<string, number>
  standby: StandbyState
  wormholeScan?: WormholeScanState
  wormholeStock?: WormholeStockItem[]
  wormholeAuto?: WormholeAutoRun[]
  wormholeAutoReports?: WormholeAutoReport[]
  refineRun: RefineRunState
  salvaging: SalvageOpState
  galaxyWrecks: Record<string, WreckGalaxyRecord>
  weekendWrecks?: Record<string, WeekendWreckRecord>
  shipWrecks?: Record<string, ShipWreckRecord>
  wreckLog?: WreckLogEntry[]
  wreckLogSeq?: number
  shipWreckSeq?: number
  rareOpenedUnits: Record<string, number>
  rareBoxesOpened: Record<string, number>
  rareBurnUnits: Record<string, number>
}

export type GameStateV25 = Omit<GameStateV24, 'version'> & {
  version: 25
  wormhole: WormholeState
  wallMs?: number
  firstStats?: FirstStats
  firstTaskSeenId?: string
  modeChosen?: boolean
}
export type GameStateV26 = Omit<GameStateV25, 'version'> & {
  version: 26
}
export type GameStateV27 = Omit<GameStateV26, 'version'> & {
  version: 27
}
export type GameStateV28 = Omit<GameStateV27, 'version'> & {
  version: 28
}
export type GameStateV29 = Omit<GameStateV28, 'version'> & {
  version: 29
  research?: MatterTechState
}
export type GameStateV30 = Omit<GameStateV29, 'version'> & {
  version: 30
  achievements?: AchievementState
}
export type GameStateV31 = Omit<GameStateV30, 'version'> & {
  version: 31
  firstTaskReadyId?: string
  ironman?: IronmanState
  weekendEvent?: WeekendEventState
}
export interface BlackMarketOffer {
  goodKey: string
  quantity?: number
  basePrice: number
  multiplier: number
  price: number
  sold: boolean
}
export interface BlackMarketState {
  dayWallMs: number
  offers: BlackMarketOffer[]
}

export type GameState = GameStateV31 & {
  battleRangeByCard?: Record<string, import('./battleRangeMemory').BattleRangeRecord>
  pendingBattleRange?: import('./battleRangeMemory').PendingBattleRange
  pendingStationActivity?: import('./stationActivityPending').PendingStationActivity
  departure?: import('./departure').DepartureState
  planetary?: PlanetaryState
  blackMarket?: BlackMarketState
  resupplyFromWarehouse?: boolean
  jumpFuel?: Partial<Record<'mine' | 'salvage' | 'expedition' | 'ai', boolean>>
  labRuns?: LabRunState[]
  labSeq?: number
  skillBoostUntilMs?: number
  boostAutoRenew?: boolean
  winRecord?: Record<string, { desireM: number; remainPct: number }>
}

export interface IronmanState {
  on: boolean
  seq: number
  sinceWallMs?: number
  closedWallMs?: number
}

export interface AchievementState {
  earned: Record<string, AchievementEarned>
}

export interface AchievementEarned {
  atGameMs: number
  atWallMs: number
}

export interface MatterTechState {
  levels: Record<string, number>
  oreDrip?: number
}

export type GameStateV19 = Omit<GameStateV18, 'version' | 'refineRun'> & {
  version: 19
  refineRuns: RefineRunState[]
}

export type GameStateV20 = Omit<GameStateV19, 'version'> & {
  version: 20
  refineRuns: RefineRunState[]
  refineSeq: number
}

export type GameStateV21 = Omit<GameStateV20, 'version' | 'manufacturing'> & {
  version: 21
  manufacturingRuns: ManufacturingRunState[]
  manufacturingSeq: number
}

export type GameStateV22 = Omit<GameStateV21, 'version'> & {
  version: 22
}

export interface OnboardingState {
  step: number
}

export interface ImportantTaskState {
  done: boolean
  delivered?: number
  allExplored?: boolean
  started?: boolean
}

export type FirstStats = Partial<Record<string, number>>

export type GameStateV23 = Omit<GameStateV22, 'version'> & {
  version: 23
  onboarding: OnboardingState
  importantTasks: Record<string, ImportantTaskState>
}

export interface SideTask {
  id: number
  kind: 'resource' | 'courier' | 'bounty' | 'faction'
  goodKey: string
  refId: string
  need: number
  rewardIsk: number
  level?: 1 | 2 | 3 | 4 | 5
  volumeM3?: number
  timed?: boolean
  warpReqAus?: number
  timeLimitMs?: number
  stationId?: string
  galaxyId?: string
  anomalyId?: string
  lairTier?: 1 | 2 | 3
  lairName?: string
  factionAnomalyName?: string
}

export interface CourierDeliveryState {
  flightDurationMs?: number
  taskId: number
  goodKey: string
  refId: string
  need: number
  stationId: string
  galaxyId: string
  departAtGameMs: number
  arriveAtGameMs: number
  rewardIsk: number
  volumeM3?: number
  level?: 1 | 2 | 3 | 4 | 5
  timed?: boolean
  deadlineAtGameMs?: number
}

export interface SideTasksState {
  seq: number
  window: number
  resource: SideTask[]
  courier: SideTask[]
  courierWindow?: number
  accepted?: SideTask[]
  bounty: SideTask[]
  faction: SideTask | null
  bountyWindow: number
  factionWindow?: number
  bountySeenWindow?: number
  deliver: CourierDeliveryState | null
}

export type GameStateV24 = Omit<GameStateV23, 'version'> & {
  version: 24
  sideTasks: SideTasksState
  manufacturingLoops: Record<string, ManufacturingLoopState>
  labLoops?: Record<string, LabLoopState>
}

export function shipLockedReason(state: GameState, shipId: string, what = '操作这艘船'): string | null {
  if (commandShipDeployed(state, shipId)) return `该舰正在随编队出勤，返港后才能${what}。`
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return '该舰正在运送星球物资，抵达前不能改装或转派。'
  if (shipLockedInWormhole(state, shipId)) {
    return `该舰在虫洞里（已锁定）：${what}要等它出洞——先撤离或结算本趟。`
  }
  const run = (state.wormholeAuto ?? []).find((r) => r.shipIds.includes(shipId))
  if (run) {
    return `该舰正在自动探索中（已锁定）：${what}要等它返航——「扫描虫洞」页可以看到进度与报告。`
  }
  return null
}
export function shipLockedInWormhole(state: GameState, shipId: string): boolean {
  return (state.wormhole.run?.fleet ?? []).includes(shipId)
}

export function wormholeAutoRunsOf(state: GameState): WormholeAutoRun[] {
  return state.wormholeAuto ?? []
}



export function wormholePilotHoldReason(state: GameState): string | null {
  if (state.wormholeScan?.active === true) {
    return '主控正在扫描虫洞：先停扫（进度保留、回来可续扫）再安排别的活动。'
  }
  if (state.wormhole.run == null) return null
  return '人在虫洞里（进虫洞这个活动还在进行）：先撤离或结算本趟；临时离开的话，关掉虫洞界面就能释放主控。'
}

export function wormholeScanHalt(state: GameState): number | null {
  const scan = state.wormholeScan
  if (!scan || scan.active !== true) return null
  scan.active = false
  return Math.max(0, Math.floor(scan.progressMs / 60_000))
}

export function miningHalt(state: GameState): (WorkReturnProgress & { tripUnits: number; beltId: string | null }) | null {
  const m = state.mining
  if (m.active !== true) return null
  const info = { tripUnits: m.tripUnits, beltId: m.beltId, phase: m.phase, phaseAccMs: m.phaseAccMs,
    ...(m.fuelMul !== undefined ? { fuelMul: m.fuelMul } : {}), originGalaxy: m.originGalaxy }
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0
  delete m.shipProgress
  delete m.fuelMul
  return info
}

export function salvageHalt(
  state: GameState,
): (WorkReturnProgress & { tripM3: number; galaxyId: string | null }) | null {
  const s = state.salvaging
  if (s.active !== true) return null
  const info = { tripM3: s.tripM3, galaxyId: s.galaxyId, phase: s.phase, phaseAccMs: s.phaseAccMs,
    ...(s.fuelMul !== undefined ? { fuelMul: s.fuelMul } : {}) }
  s.active = false
  s.galaxyId = null
  s.phase = 'salvaging'
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  delete s.deviceClockVersion
  delete s.fuelMul
  return info
}

export function haulingHalt(state: GameState): { fromSiteId: string | null } | null {
  const h = state.hauling
  if (h.active !== true) return null
  const fromSiteId = h.fromSiteId
  const abortAfterBattle = h.fleetLeg?.abortAfterBattle === true
  h.active = false
  h.routeA = null
  h.routeB = null
  h.fromSiteId = null
  h.toSiteId = null
  h.legMinutes = 0
  h.legMs = 0
  h.phaseAccMs = 0
  delete h.fleetLeg
  if (state.departure?.kind === 'hauling') delete state.departure
  delete state.combatEscort
  if (abortAfterBattle && state.transit.active && !state.transit.delivery) {
    state.transit.active = false
    state.transit.fromGalaxy = null
    state.transit.toGalaxy = null
    state.transit.finishAtGameMs = 0
    state.transit.legMs = 0
  }
  state.awayGalaxy = null
  state.dockedSite = fromSiteId
  return { fromSiteId }
}
export function refundMaterialsToWarehouse(
  state: GameState,
  spent: readonly { itemId: string; count: number }[],
): void {
  for (const m of spent) {
    const n = Math.floor(m.count)
    if (!Number.isFinite(n) || n <= 0) continue
    state.warehouse.items[m.itemId] = (state.warehouse.items[m.itemId] ?? 0) + n
  }
}

export function refundOneTimeBookOf(state: GameState, blueprintId: string): boolean {
  const spent = state.spentOneTimeRecipes ?? []
  if (!spent.includes(blueprintId)) return false
  state.blueprintStock[blueprintId] = (state.blueprintStock[blueprintId] ?? 0) + 1
  const stillRunning = state.manufacturingRuns.some((r) => r.active && r.blueprintId === blueprintId)
  if (!stillRunning) state.spentOneTimeRecipes = spent.filter((id) => id !== blueprintId)
  return true
}

function haltPilotLabRunsInline(state: GameState): void {
  const runs = state.labRuns
  if (!runs) return
  for (let i = runs.length - 1; i >= 0; i--) {
    const r = runs[i]!
    if (!r.active || r.worker !== 'pilot') continue
    refundMaterialsToWarehouse(state, r.spentMaterials ?? [])
    runs.splice(i, 1)
  }
}

export function haltActivityForSwitch(state: GameState, kind: string): void {
  switch (kind) {
    case 'mining':
      if (state.mining.active && state.mining.beltId && !(state.shipId in state.shipReturns)) {
        state.shipReturns[state.shipId] = {
          beltId: state.mining.beltId,
          legMs: Math.max(30_000, Math.round(state.mining.phaseAccMs * 2) + 30_000),
          phaseAccMs: 0,
          reason: 'miningStop',
        }
        const m = state.mining
        state.pendingActivityReturn = { kind: 'mining', id: m.beltId!, progress: {
          phase: m.phase, phaseAccMs: m.phaseAccMs, originGalaxy: m.originGalaxy,
          ...(m.phase === 'returning' && (m.fuelMul ?? 1) > 1 ? { fuelMul: m.fuelMul } : {}),
        } }
        state.haltedBySwitch = { kind: 'mining' }
      }
      miningHalt(state)
      return
    case 'salvaging':
      if (state.salvaging.active && state.salvaging.galaxyId && !(state.shipId in state.shipReturns)) {
        state.shipReturns[state.shipId] = {
          beltId: null,
          legMs: Math.max(30_000, Math.round(state.salvaging.phaseAccMs * 2) + 30_000),
          phaseAccMs: 0,
          reason: 'salvageStop',
        }
        const s = state.salvaging
        state.pendingActivityReturn = { kind: 'salvaging', id: s.galaxyId!, progress: {
          phase: s.phase, phaseAccMs: s.phaseAccMs,
          ...(s.phase === 'returning' && (s.fuelMul ?? 1) > 1 ? { fuelMul: s.fuelMul } : {}),
        } }
        state.haltedBySwitch = { kind: 'salvaging' }
      }
      salvageHalt(state)
      return
    case 'wormholeScan':
      wormholeScanHalt(state)
      return
    case 'hauling':
      haulingHalt(state)
      return
    case 'standby': {
      const s = state.standby
      s.active = false
      s.galaxyId = null
      s.finishAtGameMs = 0
      s.legMs = 0
      state.awayGalaxy = null
      return
    }
    case 'refine': {
      for (const r of state.refineRuns) {
        if (!r.active || r.worker !== 'pilot') continue
        if ((r.claimedUnits ?? 0) > 0 && r.itemId) {
          refundMaterialsToWarehouse(state, [{ itemId: r.itemId, count: r.claimedUnits! }])
          r.claimedUnits = 0
        }
        r.active = false
      }
      haltPilotLabRunsInline(state)
      return
    }
    case 'lab': {
      haltPilotLabRunsInline(state)
      return
    }
    case 'manufacturing': {
      const halted = state.manufacturingRuns.filter((r) => r.active && r.worker === 'pilot')
      for (const r of halted) r.active = false
      for (const r of halted) {
        if (r.spentMaterials) refundMaterialsToWarehouse(state, r.spentMaterials)
        if (r.blueprintId !== null) refundOneTimeBookOf(state, r.blueprintId)
      }
      if (halted.length > 0) {
        state.manufacturingRuns = state.manufacturingRuns.filter((r) => !halted.includes(r))
      }
      return
    }
    case 'siteDeliver': {
      const t = state.transit
      t.active = false
      t.fromGalaxy = null
      t.toGalaxy = null
      t.finishAtGameMs = 0
      t.legMs = 0
      t.delivery = null
      state.awayGalaxy = null
      state.dockedSite = null
      return
    }
    default:
      return
  }
}

export function addLog(
  state: GameState,
  kind: LogKind,
  text: string,
  textId?: string,
  textParams?: LogParams,
): void {
  const rules = textId?.startsWith('core.wormholeScan.') ? undefined : state.wormhole.run?.expeditionRules
  const runtimeTextId = textId === undefined ? undefined : signalSpaceTextId(textId, rules)
  const runtimeParams = rules === 2 || !textParams ? textParams : Object.fromEntries(Object.entries(textParams).map(([key, value]) => [key, key.endsWith('Id') && typeof value === 'string' ? signalSpaceTextId(value) : key === 'parts' && Array.isArray(value) ? value.map(id => typeof id === 'string' ? signalSpaceTextId(id) : id) : value])) as LogParams
  const lastId = state.logs.length > 0 ? state.logs[state.logs.length - 1]!.id : 0
  state.logs.push({
    id: lastId + 1,
    atGameMs: state.gameMs,
    kind,
    text,
    ...(runtimeTextId !== undefined ? { textId: runtimeTextId } : {}),
    ...(runtimeParams !== undefined ? { textParams: runtimeParams } : {}),
  })
  const cap = state.logCap > 0 ? state.logCap : DEFAULT_LOG_CAP
  if (state.logs.length > cap) {
    state.logs.splice(0, state.logs.length - cap)
  }
}

export function createInitialState(opts?: {
  name?: string
  seed?: number
  nowWallMs?: number
  prologue?: boolean
}): GameState {
  const prologue = opts?.prologue === true
  const nowWall = opts?.nowWallMs ?? Date.now()
  const state: GameStateV31 = {
    version: CURRENT_STATE_VERSION,
    gameMs: 0,
    savedAtWallMs: nowWall,
    logCap: DEFAULT_LOG_CAP,
    character: {
      name: opts?.name ?? DEFAULT_PILOT_NAME,
      startedAtWallMs: nowWall,
    },
    rng: {
      seed: opts?.seed ?? (((nowWall >>> 0) ^ 0x51ab3e7d) >>> 0),
      count: 0,
    },
    skills: {
      commandCompensationVersion: 1,
      progressVersion: 1,
      trained: {},
      queue: [],
      savedProgress: {},
      licenses: {},
    },
    wallet: { isk: prologue ? 0 : DEFAULT_START_ISK },
    shipId: prologue ? 'sh-falconet' : DEFAULT_START_SHIP_ID,
    fleet: prologue
      ? {
          'sh-falconet': {
            defId: 'sh-falconet',
            customName: null,
            durability: 0.8,
            armorPct: 0.8,
            cargo: {},
            fitted: emptyFitted(),
          },
          sandcat: {
            defId: 'sandcat',
            customName: null,
            durability: 1,
            armorPct: 1,
            cargo: {},
            fitted: emptyFitted(),
          },
        }
      : {
          [DEFAULT_START_SHIP_ID]: {
            defId: DEFAULT_START_SHIP_ID,
            customName: null,
            durability: 1,
            armorPct: 1,
            cargo: {},
            fitted: emptyFitted(),
          },
          'sh-falconet': {
            defId: 'sh-falconet',
            customName: null,
            durability: 1,
            armorPct: 1,
            cargo: {},
            fitted: emptyFitted(),
          },
        },
    warehouse: {
      items: prologue
        ? {
          }
        : {
            'ammo-kinetic-l': 60,
            'ammo-explosive-l': 60,
            'ammo-plasma-l': 60,
          },
    },
    moduleBay: prologue
      ? {
        }
      : {
          'mod-turret-kin-1': 1,
        },
    aiCores: { basic: 0, gamma: 0, beta: 0, alpha: 0 },
    aiAssignments: {},
    shipReturns: {},
    shipLocks: {},
    marks: emptyMarks(),
    rareWreckDryStreak: 0,
    market: {
      pools: {},
      npcBuy: {},
      npcSell: {},
      digest: {},
      lastTickGameMs: 0,
      orderSeq: 0,
      priceHistory: {},
    },
    orders: [],
    escrowItems: {},
    escrowShips: {},
    learnedRecipes: [],
    spentOneTimeRecipes: [],
    recycleCarry: {},
    blueprintStock: {},
    shipStore: {},
    events: { nextAtGameMs: 0 },
    mining: {
      active: false,
      beltId: null,
      phase: 'mining',
      cycleAccMs: 0,
      phaseAccMs: 0,
      tripUnits: 0,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
      rvLeft: 0,
    },
    manufacturingRuns: [],
    manufacturingSeq: 1,
    manufacturingLoops: {},
    labLoops: {},
    standings: {},
    standingsEarned: {},
    blackboxSeen: false,
    expedition: {
      active: false,
      anomalyId: null,
      finishAtGameMs: 0,
      durationMs: 0,
      outMs: 0,
      combatMs: 0,
      power: 0,
      eventId: null,
      eventFired: false,
      phase: 'out',
      battle: null,
    },
    exploredGalaxies: prologue ? [] : [HOME_GALAXY_ID],
    scanning: {
      active: false,
      galaxyId: null,
      finishAtGameMs: 0,
      startedAtGameMs: 0,
      originGalaxy: null,
      returning: false,
      awaitingView: false,
      lastGalaxyId: null,
    },
    wormholeScan: { active: false, progressMs: 0 },
    wormholeStock: [],
    wormholeAuto: [],
    wormholeAutoReports: [],
    scanProgress: {},
    awayGalaxy: null,
    transit: { active: false, fromGalaxy: null, toGalaxy: null, finishAtGameMs: 0, legMs: 0, delivery: null },
    bountyCooldowns: {},
    autoLoopAnomalyId: null,
    haltedBySwitch: null,
    pendingActivityReturn: null,
    autoLoopDroneFloor: null,
    stationSites: {},
    dockedSite: null,
    hauling: { ...EMPTY_HAULING },
    dialogueSeen: {},
    pendingDialogue: null,
    commsDelivered: {},
    ambushRetreatSeen: false,
    firstShipBuilt: false,
    labOpened: false,
    foeShipSeen: {},
    commsPopups: [],
    commsRead: {},
    debugQuick: false,
    ironman: { on: false, seq: 0 },
    completedBounties: [],
    encounter: {
      active: false,
      shipId: null,
      galaxyId: null,
      name: '',
      threat: 0,
      anomalyId: null,
      origin: '',
      invitedAtGameMs: 0,
      deadlineGameMs: 0,
      battle: null,
    },
    lowSecNotified: false,
    encounterZoneCooldown: {},
    lowSecPresence: {},
    standby: { active: false, galaxyId: null, finishAtGameMs: 0, legMs: 0 },
    refineRuns: [],
    refineSeq: 1,
    salvaging: { ...EMPTY_SALVAGE_OP },
    galaxyWrecks: {},
    rareOpenedUnits: {},
    rareBoxesOpened: {},
    rareBurnUnits: {},
    onboarding: { step: prologue ? 0 : 99 },
    importantTasks: {},
    sideTasks: { seq: 1, window: 0, resource: [], courier: [], bounty: [], faction: null, bountyWindow: 0, deliver: null },
    wormhole: { ...EMPTY_WORMHOLE_STATE },
    research: { levels: {} },
    achievements: { earned: {} },
    logs: [],
  }
  if (prologue) {
    addLog(state, 'system', '舰载系统苏醒：隐秘泊位·母港。', 'core.state.025')
    addLog(state, 'warn', '自检异常：船体装甲/结构受损（80%），乘员生命信号——无。记忆档案损坏。', 'core.state.026')
    addLog(
      state,
      'system',
      '初始资金 0 信用点：一切从采集第一舱原矿开始。鲣鱼级护卫舰（待修）与磷虾级采矿艇同在机库；装备库与弹药库为空——首门炮台与弹药将在完成协会试炼后解锁。',
      'core.state.027',
    )
  } else {
    addLog(state, 'system', '欢迎加入「深空工业协会」。', 'core.state.028')
    addLog(
      state,
      'system',
      `初始资金 ${DEFAULT_START_ISK} 信用点已到账；磷虾级采矿艇已停靠机库，另有鲣鱼级护卫舰待命（装备库含轻型炮台 MK1，仓库配三型通用弹各 60 发，可直接体验远征战斗）。`,
      'core.state.029',
      { p1: DEFAULT_START_ISK },
    )
  }
  addLog(
    state,
    'system',
    '星图迷雾已开启：母港已探明，周边星系等待扫描探索——去悬赏列表接任务，或对星图上的「未知信号」执行扫描。',
    'core.state.030',
  )
  return state
}


export function siteProgress(state: GameState, siteId: string): StationSiteProgress {
  const p = state.stationSites[siteId]
  if (p) return p
  return { stage: 0, delivered: {} }
}

export function isSiteBuilt(state: GameState, site: StationSiteDef): boolean {
  return siteProgress(state, site.id).stage >= site.tiers.length
}

export const EMPTY_WORMHOLE_STATE: WormholeState = { run: null, lastFleetLost: 0 }

export { type BattleState } from './combat/state/battle'
export { type BattleUnitRt, type BattleWebDebuff, type BattleFoeWebDebuff, type BattleFx, type DronePoolEntry, type BattleRepairUnit, type BattleRepairLedger, type BattleShieldChargeLedger, type BattleShieldFieldStream, type BattleShieldFieldLedger } from './combat/state/units'
export { type DroneLossReport, type BattleReportSource, type BattleBreakReason, type BattleReportRecord } from './combat/state/report'
