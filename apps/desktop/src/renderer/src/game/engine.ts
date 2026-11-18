import { combatRosterOf, encounterCombatRosterOf } from '@whale/core'
import { saveFleetPreset, renameFleetPreset, deleteFleetPreset, applyFleetPreset, fleetRangeOf, setFleetRange, saveBattleFleetRange } from '@whale/core'
import { blackMarketBuy, ensureBlackMarket } from '@whale/core'
import { battleAmmoPreloadPlan } from '@whale/core'
import {
  MAX_SKILL_LEVEL,
  preparationSquadOf,
  notePreparationSquad,
  SaveError,
  addLog,
  advanceAutoLoopBounty,
  advanceGame,
  advanceWormhole,
  wormholePreparationPlan,
  wormholeTemplateFillPlan,
  wormholeSavePreparationTemplate,
  wormholeRenamePreparationTemplate,
  wormholeDeletePreparationTemplate,
  wormholeEventPreview,
  wormholeEventActions,
  wormholeEventView,
  wormholeAlertView,
  wormholeEncounterView,
  wormholeChangeExpeditionGoal,
  wormholeFreezeEvents,
  wormholeResolveEvent,
  wormholeEnterPrepared,
  wormholeExtractionPlan,
  wormholeConfirmExtraction,
  wormholeLeaveHoldPiece,
  wormholeLeaveSupply,
  wormholeGroundBoard,
  fightEncounter,
  fleeEncounter,
  itemReleased,
  assignAiExpedition,
  assignAiMining,
  assignAiSalvage,
  buyAtMarket,
  buyBasicAiCore,
  cancelAiTask,
  cancelManufacturing,
  cancelOrder,
  claimFirstTask,
  cancelStandby,
  changeShip,
  noteLabOpened as markLabOpened,
  createInitialState,
  buySkillLicense,
  enqueueSkill,
  fitModule,
  adjustDroneLoad,
  setAmmoTier,
  goStandbyAt,
  goodLockedReason,
  bmGateReason,
  learnBlueprint,
  exchangePlugBlueprint,
  exchangeUniversalBlackBox,
  redeemFragments,
  fragmentRedeemRowsOf,
  listSellHolding,
  loadSaveFile,
  loadWarehouseToCargoFit,
  shipOperationBlockReason,
  cancelPendingStationActivity,
  lockShip,
  marketQuote,
  goodName,
  prepareMarketRelayRequest,
  marketRelayPendingRequest,
  applyMarketRelayResponse,
  marketSellHolding,
  marketSellPreview,
  newSettleStats,
  offlineSplit,
  placeBuyOrder,
  buyOrderBlockedReason,
  recallExpedition,
  refineRunViews,
  labUnlocked as labUnlockedCore,
  labRunViews,
  startLabRun,
  stopLabRun,
  setLabLoop,
  labLoopOf,
  type LabLoopView,
  jumpFuelStockOf,
  jumpFuelEnabledOf,
  jumpFuelSupplyOf,
  repairHoldForbiddenCargo,
  moveQueueItem,
  removeQueueAt,
  renameShip,
  migrateDeprecatedAmmo,
  repairDeprecatedModules,
  repairShip,
  fleetRepairPlan as fleetRepairPlanCore,
  repairFleet,
  useOneRepairKit,
  useSynapticAccelerant,
  synapticAccelerantRemainMs,
  boostAutoRenewOn,
  setBoostAutoRenew,
  noCommonWreckSalvageOn,
  setNoCommonWreckSalvage,
  useInvasionBeacon,
  retreatBattle,
  retreatEncounterBattle,
  sellCargoItem,
  sellCargoItemQty,
  sellStoredShipAtMarket,
  sellWareItem,
  discardWareQty,
  sellWareItemQty,
  serializeSaveFile,
  shipDisplayName,
  storeShip,
  unstoreShip,
  setBattleDesire,
  pendingBattleRangeView,
  confirmBattleRange,
  cancelBattleRange,
  setMiningAutoCycle,
  setMiningStopAfterTrip,
  simulateOffline,
  setManufacturingLoop,
  startExpedition,
  startExpeditionFromMining,
  startManufacturing,
  startMining,
  startMiningFromExpedition,
  startRefineRun,
  startRecycleRun,
  startUnboxRun,
  startSalvageOp,
  setSalvageAutoCycle,
  setSalvageStopAfterTrip,
  wreckLogRowsOf,
  wreckGroupStocksOf,
  wreckTargetsOf,
  startScan,
  startTransitHome,
  startSiteDeliverTrip,
  cancelSiteDeliverTrip,
  stopRefineRun,
  deliverStationResources,
  playDialogue,
  commsInbox,
  commsUnreadCount,
  commsPopupQueue,
  dismissCommsPopup,
  markCommsRead,
  markAllCommsRead,
  completeSideTask,
  sideTaskBoard,
  sideTasksMarkBountySeen,
  firstTaskNotice,
  firstTasksMarkSeen,
  startCourierDelivery,
  ACTIVITY_CONFIRM_ID,
  haltCurrentActivity,
  acceptCourierTask,
  abandonAcceptedCourierTask,
  stopMining,
  stopSalvageOp,
  stopScan,
  setAutoLoopBounty,
  autoLoopInvasionGalaxy,
  setAutoLoopInvasion,
  advanceAutoLoopInvasion,
  unfitAt,
  cpuOverloadText,
  swapModuleAt,
  applyFitPreset,
  deleteFitPreset,
  renameFitPreset,
  saveFitPreset,
  saveWreckFitPreset,
  overwriteFitPreset,
  unfitAllModules,
  unloadCargoToWarehouse,
  unloadShipCargo,
  claimChainReward as claimChainRewardCore,
  beginAfterAwaken,
  skipPrologue,
  ONB_AWAKEN,
  startHauling,
  stopHauling,
  cargoCapacityM3,
  warpSpeedAus,
  toggleMark,
  bumpIronmanSeq,
  weekendTick,
  weekendClockOf,
  weekendBountyCardsOf,
  weekendBoardRowsOf,
  weekendLaunchGalaxyOf,
  weekendAssaultDrawOf,
  weekendNoteAssaultDispatch,
  weekendZoneLiveAt,
  weekendFlagshipSpecOf,
  weekendStartFlagshipBattle,
  weekendFlagshipPrepView,
  weekendFlagshipBattleActive,
  weekendSettleAndGrant,
  weekendSyncComms,
  ironmanLoadVerdict,
  ironmanOn,
  ironmanSeq,
  IRONMAN_RESCUE_MIN_AGE_MS,
  closeIronman,
  enterIronman,
  ironmanClosed,
  ironmanEver,
  ironmanModeChosen,
  markModeChosenAsStandard,
  wormholeEnter,
  wormholeTakePileAt,
  wormholeHoldUsage,
  wormholeDiscardToFit,
  wormholeHoldDiscard,
  wormholeDiscardCargo,
  wormholeActionBlockReason,
  wormholePendingBattleReason,
  wormholeHoldCapacityOf,
  wormholeTempUsage,
  wormholeTempStowPiece,
  wormholeTempStowAll,
  wormholeTempDiscardAll,
  wormholeTempPending,
  wormholeTempBoard,
  wormholeNormalizeLegacyTemp,
  repairMisplacedWarehouseModules,
  wormholeScanStart,
  wormholeScanStop,
  wormholeScanWindowMs,
  wormholeScanBlockReason,
  wormholeEntryBlockReason,
  wormholeEntryAutoStops,
  wormholeShipEntryBusy,
  wormholeScanStanding,
  wormholeScanUnlocked,
  wormholeAutoRunsOf,
  wormholeAutoReportsOf,
  wormholeAutoUnconfirmedCount,
  wormholeAutoCandidates,
  wormholeAutoBlockReason,
  wormholeAutoMainHandover,
  wormholeAutoFreeCores,
  aiCoreCap,
  wormholeAutoStart,
  wormholeAutoStop,
  wormholeAutoConfirmReport,
  wormholeAutoConfirmAll,
  wormholeStockOf,
  wormholeStockTake,
  wormholeFamilyOfSeed,
  wormholeArchetypeOf,
  wormholeStockDiscard,
  wormholeStockMeta,
  WORMHOLE_FAMILY_CARD,
  wormholeFamilyIntel,
  holdTransferTo,
  makeHoldState,
  wormholeSyncMatterTurns,
  WORMHOLE_TEMP_CELLS,
  holdCompact,
  holdDropWithGrab,
  holdSwap,
  wormholeGridScan,
  wormholeScanBonusOf,
  wormholeTravelTo,
  wormholeDescend,
  wormholeExtract,
  wormholeLeave,
  wormholeResume,
  wormholeActivateAt,
  wormholeStartBattle,
  wormholeDebugReset,
  acknowledgeScanView,
  researchMatterTech,
  matterTechBattleSpeedTiers,
  matterTechScanCut,
  offlineCapMsOf,
  planPrereqChain,
  skillCancelImpact,
  weekendFlagshipSharesOf,
  weekendFlagshipOutcomeOf,
} from '@whale/core'
import type {
  AiCoreType,
  BountyWinMC,
  CommandResult,
  BusyLabel,
  CoreBlockReason,
  FitPresetApplyResult,
  UnfitAllResult,
  DamageType,
  GameState,
  MarketRelayRequest,
  MarketRelayResponse,
  LairTier,
  MarkKind,
  RackSlot,
  RefineRunView,
  UnboxResultRow,
  LabRunView,
  JumpFuelActivity,
  JumpFuelSupply,
  FragmentRedeemRow,
  SellResult,
  SettleStats,
  SideTask,
  SimContext,
  WormholeArchetype,
  WormholeFamily,
  WormholeFamilyIntel,
  WormholeAutoCandidate,
  WormholeAutoHandover,
  WormholeAutoReport,
  WormholeAutoRun,
  WormholeHoldPlacement,
  WormholePreparationRequest,
  WormholePreparationPlan,
  WormholePreparedResult,
  WormholeExtractionRequest,
  WormholeExtractionPlan,
  TrainingItem,
} from '@whale/core'
import { BELTS, BLUEPRINTS, GALAXIES, GALAXY_EDGES, ANOMALIES_FLAVORED, ITEMS, MODULES, SHIP_BLUEPRINTS, SHIPS, SKILL_GROUPS, SKILLS, DIALOGUES, EN_SHIPS, buildSimContext, overlayList, EN_MODULES, EN_ITEMS_ALL, EN_SKILLS, EN_ANOMALIES, EN_BLUEPRINTS, EN_SHIP_BLUEPRINTS, EN_FOE_SHIPS, EN_GALAXIES, EN_BELTS, overlayCardFoesList, type L10nLocale } from '@whale/data'
import { saveBridge } from './storage'
import { canWriteSave } from './saveWriter'
import { reconnectProgress, sameReconnectProgress } from './saveReconnect'
import type { ReconnectChoice } from './saveReconnect'
import { noteSaveWriteFailed, requestPersistentStorage, saveStorageProbe } from './saveGuard'
import { debugEnabled, futureWormholeEnabled, planetaryEnabled } from './debugFlag'
import { runPlanetaryCommand } from './planetaryCommands'
import { DEEP_SPACE_SKILL_IDS, probeManufacturingUnlocked } from '@whale/core'
import { perfHub } from './perf'
import type { PerfBucket } from './perf'
import { BountyWinCache } from './bountyWinCache'
import { computeSignalAuto } from './signalAutoWorker'
import type { SignalAutoWorker } from './signalAutoWorker'
import { signalAutoInputKey } from '../../../../../../packages/core/src/signalAuto/input'
import { UnboxSessionLedger } from './unboxLedger'
import type { UnboxBatchRecord } from './unboxLedger'
import type { BountyWinWorker } from './bountyWinProtocol'
import { tr, cmdText, paramText, logText } from '../i18n/locale'
import { aiCoreText } from '../ui/labelsText'
import { fmtDuration } from '../i18n/fmt'

type Listener = () => void


interface OfflineSnapshot {
  haulingActive: boolean
  gameMs: number
  isk: number
  trained: Record<string, number>
  warehouse: Record<string, number>
  cargo: Record<string, number>
  moduleBay: Record<string, number>
  shipStore: Record<string, number>
  fleetKeys: string[]
  learned: string[]
  logCount: number
}

export interface OfflineReport {
  combatLines?: string[]
  wallAwayMs: number
  settledMs: number
  overflowMs: number
  iskDelta: number
  items: Array<{ name: string; delta: number }>
  modules: Array<{ name: string; delta: number }>
  shipsIn: string[]
  shipsStored: Array<{ name: string; delta: number }>
  skillsUp: string[]
  learnedIn: string[]
  logCount: number
  highlights: Array<{ kind: string; text: string }>
  coreJobs: string[]
}

function snapshotBasics(state: GameState): OfflineSnapshot {
  const cur = state.fleet[state.shipId]
  return {
    haulingActive: state.hauling.active,
    gameMs: state.gameMs,
    isk: state.wallet.isk,
    trained: { ...state.skills.trained },
    warehouse: { ...state.warehouse.items },
    cargo: { ...(cur?.cargo ?? {}) },
    moduleBay: { ...state.moduleBay },
    shipStore: { ...(state.shipStore ?? {}) },
    fleetKeys: Object.keys(state.fleet),
    learned: [...state.learnedRecipes],
    logCount: state.logs.length,
  }
}

function positiveDeltas(before: Record<string, number>, after: Record<string, number>): Array<{ id: string; delta: number }> {
  const out: Array<{ id: string; delta: number }> = []
  const ids = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const id of ids) {
    const delta = (after[id] ?? 0) - (before[id] ?? 0)
    if (delta > 0) out.push({ id, delta })
  }
  return out.sort((a, b) => b.delta - a.delta)
}

function buildOfflineReport(
  before: OfflineSnapshot,
  state: GameState,
  ctx: SimContext,
  wallAwayMs: number,
  overflowMs: number,
  stats?: SettleStats,
): OfflineReport | null {
  const settledMs = state.gameMs - before.gameMs
  if (settledMs < 60_000) return null
  const combatLines: string[] = []
  const combat = stats?.combat
  if (combat) {
    const fighting = state.encounter.active && !!state.encounter.battle ? 1 : 0
    if (combat.encounters || fighting) combatLines.push(tr('ui.offlineCombat.001', {
      p1: combat.encounters, p2: combat.wins, p3: combat.defeats, p4: combat.escapes, p5: fighting,
    }))
    if (combat.encounters || combat.ammoUsed || combat.kitsUsed || combat.shipsLost) combatLines.push(tr('ui.offlineCombat.002', {
      p1: combat.ammoUsed, p2: combat.kitsUsed, p3: combat.shipsLost,
    }))
    if (before.haulingActive || state.hauling.active || combat.deliveries || combat.stopReason) {
      combatLines.push(tr('ui.offlineCombat.003', { p1: combat.deliveries, p2: combat.deliveredM3.toLocaleString('zh-CN'), p3: combat.transportIncome.toLocaleString('zh-CN') }))
      const reasonIds = { arrival: 'ui.offlineCombat.007', interrupted: 'ui.offlineCombat.008', capacity: 'ui.offlineCombat.009', defeat: 'ui.offlineCombat.010', damage: 'ui.offlineCombat.011', loss: 'ui.offlineCombat.012' } as const
      const statusId = state.hauling.active
        ? state.encounter.active ? 'ui.offlineCombat.014' : state.hauling.fleetLeg?.returning ? 'ui.offlineCombat.006' : 'ui.offlineCombat.005'
        : combat.stopReason ? reasonIds[combat.stopReason] : 'ui.offlineCombat.013'
      combatLines.push(tr('ui.offlineCombat.004', { p1: tr(statusId) }))
    }
  }

  const itemDeltas = positiveDeltas(before.warehouse, state.warehouse.items)
  const cur = state.fleet[state.shipId]
  const cargoNow = cur?.cargo ?? {}
  for (const d of positiveDeltas(before.cargo, cargoNow)) {
    const hit = itemDeltas.find((x) => x.id === d.id)
    if (hit) hit.delta += d.delta
    else itemDeltas.push(d)
  }
  itemDeltas.sort((a, b) => b.delta - a.delta)
  const items = itemDeltas.slice(0, 8).map((d) => ({ name: ctx.items.get(d.id)?.name ?? d.id, delta: d.delta }))

  const modules = positiveDeltas(before.moduleBay, state.moduleBay)
    .slice(0, 5)
    .map((d) => ({ name: ctx.modules.get(d.id)?.name ?? d.id, delta: d.delta }))

  const newShips: string[] = []
  const beforeShips = new Set(before.fleetKeys)
  for (const id of Object.keys(state.fleet)) {
    if (!beforeShips.has(id)) newShips.push(shipDisplayName(state, ctx, id))
  }

  const shipsStored = positiveDeltas(before.shipStore, state.shipStore ?? {}).map((d) => ({
    name: ctx.ships.get(d.id)?.name ?? d.id,
    delta: d.delta,
  }))

  const skillsUp: string[] = []
  for (const [id, lv] of Object.entries(state.skills.trained)) {
    if (lv > (before.trained[id] ?? 0)) {
      skillsUp.push(`${ctx.skills.get(id)?.name ?? id} Lv${lv}`)
    }
  }

  const learnedIn: string[] = []
  for (const id of state.learnedRecipes) {
    if (!before.learned.includes(id)) {
      learnedIn.push(ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
    }
  }

  const newLogs = state.logs.slice(before.logCount)
  const highlights: Array<{ kind: string; text: string }> = []
  for (let i = newLogs.length - 1; i >= 0 && highlights.length < 3; i--) {
    const l = newLogs[i]!
    if (l.kind === 'warn' || l.kind === 'trade') highlights.push({ kind: l.kind, text: l.text })
  }
  highlights.reverse()

  const coreJobs: string[] = []
  if (stats) {
    const order: AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']
    for (const t of order) {
      const s = stats[t]
      if (!s) continue
      const acts: string[] = []
      if (s.miningTrips > 0) acts.push(tr("ui.engine.001", { p1: s.miningTrips }))
      if (s.salvageDone > 0) acts.push(tr("ui.engine.002", { p1: s.salvageDone }))
      if (s.refineBatches > 0) acts.push(tr("ui.engine.003", { p1: s.refineBatches }))
      if (s.recycleBatches > 0) acts.push(tr("ui.engine.004", { p1: s.recycleBatches }))
      if (s.makeDone > 0) acts.push(tr("ui.engine.005", { p1: s.makeDone }))
      if (s.labBatches > 0) acts.push(tr("ui.engine.052", { p1: s.labBatches }))
      if (s.shipsDone > 0) acts.push(tr("ui.engine.006", { p1: s.shipsDone }))
      if (acts.length === 0) continue
      coreJobs.push(
        tr("ui.engine.048", { p1: aiCoreText(t), p2: acts.join(' · '), p3: s.income > 0 ? tr("ui.engine.007", { p1: s.income.toLocaleString('zh-CN') }) : '' }),
      )
    }
  }

  return {
    wallAwayMs,
    combatLines,
    settledMs,
    overflowMs,
    iskDelta: state.wallet.isk - before.isk,
    items,
    modules,
    shipsIn: newShips,
    shipsStored,
    skillsUp,
    learnedIn,
    logCount: newLogs.length,
    highlights,
    coreJobs,
  }
}

function offlineReportLogText(r: OfflineReport): string {
  const parts: string[] = [tr("ui.engine.008", { p1: fmtDuration(r.wallAwayMs), p2: fmtDuration(r.settledMs) })]
  if (r.overflowMs > 0) parts.push(tr("ui.engine.009", { p1: fmtDuration(r.overflowMs) }))
  parts.push(tr("ui.engine.010", { p1: r.iskDelta >= 0 ? '+' : '−', p2: Math.abs(r.iskDelta).toLocaleString('zh-CN') }))
  if (r.items.length > 0) parts.push(tr("ui.engine.011", { p1: r.items.map((i) => `${i.name}×${i.delta.toLocaleString('zh-CN')}`).join(tr("ui.MatterTechTab.017")) }))
  if (r.modules.length > 0) parts.push(tr("ui.engine.012", { p1: r.modules.map((m) => `${m.name}×${m.delta}`).join(tr("ui.MatterTechTab.017")) }))
  if (r.shipsIn.length > 0) parts.push(tr("ui.engine.013", { p1: r.shipsIn.join(tr("ui.MatterTechTab.017")) }))
  if (r.shipsStored.length > 0)
    parts.push(tr("ui.engine.014", { p1: r.shipsStored.map((s) => `${s.name}×${s.delta}`).join(tr("ui.MatterTechTab.017")) }))
  if (r.skillsUp.length > 0) parts.push(tr("ui.engine.015", { p1: r.skillsUp.join(tr("ui.MatterTechTab.017")) }))
  if (r.learnedIn.length > 0) parts.push(tr("ui.engine.016", { p1: r.learnedIn.join(tr("ui.MatterTechTab.017")) }))
  if (r.coreJobs.length > 0) parts.push(tr("ui.engine.017", { p1: r.coreJobs.join('；') }))
  parts.push(...(r.combatLines ?? []))
  return tr("ui.engine.018", { p1: parts.join('；') })
}

const SAVE_INTERVAL_MS = 60_000

const SWITCH_ASK_MS = 6000

const WH_SPEED_KEY = 'whale-idle:wh-speed'

function loadWormholeSpeedPick(): number {
  try {
    const v = Number(localStorage.getItem(WH_SPEED_KEY))
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 0
  } catch {
    return 0
  }
}

function saveWormholeSpeedPick(x: number): void {
  try {
    localStorage.setItem(WH_SPEED_KEY, String(x))
  } catch {
  }
}

export class GameEngine {
  getCtx(): SimContext { return this.ctx }
  planetaryCommand(action: string, args: unknown[]): import('@whale/core').PlanetActionResult {
    const result = runPlanetaryCommand(this.state, this.ctx, action, args)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }
  private installPlanetaryTestApi(): void {
    if (!planetaryEnabled()) return
    const target = window as Window & { __whalePlanetaryTest?: unknown }
    target.__whalePlanetaryTest = {
      snapshot: () => planetaryEnabled() ? structuredClone(this.state) : undefined,
      command: async (action: string, args: unknown[]) => { const result = this.planetaryCommand(action, args); await this.persist(); return result },
      step: async (duration: number) => {
        if (!planetaryEnabled() || !Number.isSafeInteger(duration) || duration < 0 || duration > 8 * 3600000 || !this.ctx.planetary) return false
        advanceGame(this.state, duration, this.ctx, { offline: true, onUnboxResult: this.onUnboxResult, onStationActivityStarted: this.onStationActivityStarted })
        this.notify(); await this.persist(); return true
      },
      persist: () => this.persist(),
    }
  }
  ctx: SimContext = buildSimContext()
  private locale: L10nLocale = 'zh'
  private skillEntries: readonly import('@whale/core').SkillDef[] = SKILLS
  get skills() { return this.skillEntries.filter(s => probeManufacturingUnlocked(this.state) || !DEEP_SPACE_SKILL_IDS.includes(s.id)) }
  readonly groups = SKILL_GROUPS
  ships = SHIPS.filter((d) => itemReleased(d))
  belts = BELTS
  items = ITEMS
  modules = MODULES.filter((d) => itemReleased(d))
  blueprints = BLUEPRINTS.filter((d) => itemReleased(d))
  shipBlueprints = SHIP_BLUEPRINTS.filter((d) => itemReleased(d))
  galaxies = GALAXIES
  readonly galaxyEdges = GALAXY_EDGES
  anomalies = ANOMALIES_FLAVORED.filter((a) => !a.hidden)

  private refreshAnomaliesView(): void {
    const base = this.localizedAnomalies.filter((a) => !a.hidden)
    const ev = this.state.weekendEvent
    if (!ev || ev.endedAtWallMs !== undefined) {
      this.anomalies = base
      return
    }
    const now = Date.now()
    const byGalaxy = new Map<string, (typeof base)[number][]>()
    for (const a of base) {
      const list = byGalaxy.get(a.galaxyId)
      if (list) list.push(a)
      else byGalaxy.set(a.galaxyId, [a])
    }
    const replaced = new Map<string, readonly (typeof base)[number][]>()
    for (const [gid, list] of byGalaxy) {
      replaced.set(gid, weekendBountyCardsOf(this.state, this.ctx, list, gid, now))
    }
    const cursor = new Map<string, number>()
    const out: (typeof base)[number][] = []
    for (const a of base) {
      const list = replaced.get(a.galaxyId)!
      const i = cursor.get(a.galaxyId) ?? 0
      cursor.set(a.galaxyId, i + 1)
      out.push(list[i] ?? a)
    }
    this.anomalies = weekendBoardRowsOf(out, (gid) => weekendZoneLiveAt(this.state, gid, now))
    return
  }
  allAnomalies = ANOMALIES_FLAVORED
  allShips = SHIPS
  allModules = MODULES
  allBlueprints = BLUEPRINTS
  allShipBlueprints = SHIP_BLUEPRINTS
  readonly dialogues = DIALOGUES

  state: GameState = createInitialState({ prologue: true })

  offlineReport: OfflineReport | null = null

  onSystemNotice: ((msg: string) => void) | null = null

  private listeners = new Set<Listener>()
  private unboxLedger = new UnboxSessionLedger()
  private lastRealMs = 0
  private intervalId: number | null = null
  private saveIntervalId: number | null = null
  private saveUnavailable = false
  private savePaused = false
  private reconnectChoice: ReconnectChoice | null = null
  private reconnectResolving = false
  private loadResolving = false
  private pendingMs = 0
  private pumpMs = 100
  private autoSortie = false
  private wormholeSpeedPick = loadWormholeSpeedPick()

  private stopped = false
  private signalAutoComputing = false
  private signalAutoController: AbortController | null = null
  private createSignalAutoWorker = (): SignalAutoWorker => new Worker(new URL('./signalAuto.worker.ts', import.meta.url), { type: 'module' }) as unknown as SignalAutoWorker
  private winCache = new BountyWinCache({
    createWorker: () => new Worker(new URL('./bountyWin.worker.ts', import.meta.url), { type: 'module' }) as unknown as BountyWinWorker,
    source: () => ({ state: this.state, ctx: this.ctx, fingerprint: this.winFingerprint(), locale: this.locale,
      ids: this.anomalies.filter(a => this.ctx.anomalies.has(a.id)).map(a => a.id) }),
    paused: () => this.stopped || this.inLiveBattle() || this.saveWriteState() !== 'ok',
    changed: () => this.notify(),
    diagnostic: event => perfHub.recordWinPreheat(event),
    error: message => console.warn('Bounty worker:', message),
    now: () => performance.now(),
  })

  private switchAsk: { key: string; at: number } | null = null
  private ammoAsk: { state: GameState; signature: string; at: number } | null = null

  private withBattleAmmoWarning(key: string, ships: readonly string[], run: () => CommandResult, supplies?: Readonly<Record<string, number>>, preflight?: (snapshot: GameState) => CommandResult, inWormhole = false): CommandResult {
    const finish = () => {
      const result = run()
      if (this.state.pendingBattleRange) { this.notify(); void this.persist() }
      return result
    }
    const plan = battleAmmoPreloadPlan(this.state, this.ctx, ships, supplies, inWormhole)
    const short = plan.rows.filter(row => row.missing > 0)
    if (!short.length) { this.ammoAsk = null; return finish() }
    if (preflight) {
      const checked = preflight(structuredClone(this.state))
      if (!checked.ok && checked.errorId !== ACTIVITY_CONFIRM_ID) { this.ammoAsk = null; return finish() }
    }
    const ammoStock = (stock: Readonly<Record<string, number>>) => Object.entries(stock)
      .filter(([id]) => this.ctx.items.get(id)?.kind === 'ammo').sort(([a], [b]) => a.localeCompare(b))
    const supplySignature = supplies ? ammoStock(supplies) : this.state.resupplyFromWarehouse !== false
      ? ammoStock(this.state.warehouse.items) : ships.map(id => ammoStock(this.state.fleet[id]?.cargo ?? {}))
    const signature = JSON.stringify([key, ships, plan, supplySignature, ships.map(id => {
      const ship = this.state.fleet[id]
      if (!ship) return null
      return { defId: ship.defId, fitted: ship.fitted, ammoPref: ship.ammoPref, droneLoad: ship.droneLoad, plugs: ship.plugs }
    }), this.state.skills.trained, inWormhole ? this.state.wormhole.run?.hold : null])
    const now = Date.now()
    if (this.ammoAsk?.state === this.state && this.ammoAsk.signature === signature && now >= this.ammoAsk.at && now - this.ammoAsk.at <= 30_000) {
      const result = finish()
      if (result.errorId !== ACTIVITY_CONFIRM_ID) this.ammoAsk = null
      return result
    }
    this.ammoAsk = { state: this.state, signature, at: now }
    const source = tr(plan.source === 'warehouse' ? 'ui.battleAmmo.003' : plan.source === 'cargo' ? 'ui.battleAmmo.004' : 'ui.battleAmmo.005')
    const details = short.map(row => tr('ui.battleAmmo.002', { ship: shipDisplayName(this.state, this.ctx, row.shipId),
      ammo: this.ctx.items.get(row.itemId)?.name ?? row.itemId, can: row.can, need: row.need, missing: row.missing })).join('\n')
    const errorParams = { source, details }
    return { ok: false, error: tr('ui.battleAmmo.001', errorParams), errorId: 'ui.battleAmmo.001', errorParams }
  }

  private withActivitySwitch(key: string, run: (confirmed?: boolean) => CommandResult): CommandResult {
    const first = run()
    if (first.ok || first.errorId !== ACTIVITY_CONFIRM_ID) return first
    const now = Date.now()
    const armed = this.switchAsk !== null && this.switchAsk.key === key && now - this.switchAsk.at <= SWITCH_ASK_MS
    if (!armed) {
      this.switchAsk = { key, at: now }
      return first
    }
    this.switchAsk = null
    if (key === 'expedition') return run(true)
    if (haltCurrentActivity(this.state) !== null) {
      void this.persist()
      this.notify()
    }
    return run()
  }

  private winFingerprint(): string {
    const st = this.state
    const uid = st.shipId
    const f = st.fleet[uid]
    const tr = st.skills.trained
    let sk = ''
    for (const k of Object.keys(tr).sort()) sk += `${k}:${tr[k]};`
    return `${uid}|${f?.defId}|${JSON.stringify(combatRosterOf(st).map(id => [id, st.fleet[id]]))}|${st.resupplyFromWarehouse !== false ? 1 : 0}|${JSON.stringify(fleetRangeOf(st) ?? null)}|${st.expedition.lairTier ?? 0}|${st.expedition.factionActive === true ? 1 : 0}|${sk}`
  }

  private pumpWinCache(): void { this.winCache.pump() }

  winEstimateOf(anomalyId: string): BountyWinMC | null {
    return this.winCache.get(anomalyId) ?? null
  }

  autoSortieNow(): boolean {
    return this.autoSortie
  }

  private wantsFastPump(): boolean {
    const exp = this.state.expedition
    if (this.inLiveBattle()) return true
    if (exp.active && exp.phase === 'out') return true
    return false
  }

  private ensurePump(): void {
    if (this.stopped) return
    const want = this.wantsFastPump() ? 100 : 250
    if (want === this.pumpMs) return
    this.pumpMs = want
    if (this.intervalId !== null) window.clearInterval(this.intervalId)
    this.intervalId = window.setInterval(() => this.tick(), this.pumpMs)
    this.lastRealMs = Date.now()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  unboxLedgerOf(boxItemId: string): UnboxBatchRecord | undefined {
    return this.unboxLedger.get(this.state, boxItemId)
  }

  private onUnboxResult = (result: UnboxResultRow): void => {
    this.unboxLedger.record(this.state, result)
  }

  private onStationActivityStarted = (action: import('@whale/core').StationAction): void => {
    if (action.kind === 'unbox') this.unboxLedger.begin(this.state, action.itemId)
  }

  setLocale(locale: L10nLocale): void {
    if (locale === this.locale) return
    this.locale = locale
    this.ctx = buildSimContext(locale)
    this.ships = overlayList(SHIPS, EN_SHIPS, locale).filter((d) => itemReleased(d))
    this.allShips = [...overlayList(SHIPS, EN_SHIPS, locale)]
    this.modules = overlayList(MODULES, EN_MODULES, locale).filter((d) => itemReleased(d))
    this.allModules = overlayList(MODULES, EN_MODULES, locale)
    this.items = overlayList(ITEMS, EN_ITEMS_ALL, locale)
    this.skillEntries = overlayList(SKILLS, EN_SKILLS, locale)
    this.blueprints = overlayList(BLUEPRINTS, EN_BLUEPRINTS, locale).filter((d) => itemReleased(d))
    this.shipBlueprints = overlayList(SHIP_BLUEPRINTS, EN_SHIP_BLUEPRINTS, locale).filter((d) => itemReleased(d))
    this.allBlueprints = overlayList(BLUEPRINTS, EN_BLUEPRINTS, locale)
    this.allShipBlueprints = overlayList(SHIP_BLUEPRINTS, EN_SHIP_BLUEPRINTS, locale)
    const locCards = overlayCardFoesList(overlayList(ANOMALIES_FLAVORED, EN_ANOMALIES, locale), EN_FOE_SHIPS, locale)
    this.anomalies = locCards.filter((a) => !a.hidden)
    this.allAnomalies = locCards
    this.galaxies = overlayList(GALAXIES, EN_GALAXIES, locale)
    this.belts = overlayList(BELTS, EN_BELTS, locale)
    this.localizedAnomalies = locCards
    this.notify()
  }

  private localizedAnomalies: readonly (typeof ANOMALIES_FLAVORED)[number][] = ANOMALIES_FLAVORED

  private inLiveBattle(): boolean {
    const s = this.state
    return (
      (s.expedition.phase === 'battle' && !!s.expedition.battle) ||
      !!s.wormhole.run?.battle ||
      weekendFlagshipBattleActive(s)
    )
  }

  private currentBucket(): PerfBucket {
    return this.inLiveBattle() ? 'battle' : 'idle'
  }

  private advanceSlice(ms: number): void {
    const rec = perfHub.recording
    const t0 = rec ? performance.now() : 0
    const bucket = this.currentBucket()
    advanceGame(this.state, ms, this.ctx, {
      nowWallMs: this.wallNowOf(),
      battleSpeedX: this.requestedWormholeSpeed(),
      onUnboxResult: this.onUnboxResult,
      onStationActivityStarted: this.onStationActivityStarted,
    })
    this.drainSystemNotice()
    if (rec) perfHub.recordAdvance(bucket, performance.now() - t0)
  }


  wormholeSpeedOptions(): number[] {
    return matterTechBattleSpeedTiers(this.state, this.ctx)
  }


  wormholeSpeedActive(): number {
    const opts = this.wormholeSpeedOptions()
    const max = opts[opts.length - 1] ?? 1
    return opts.includes(this.wormholeSpeedPick) ? this.wormholeSpeedPick : max
  }

  setWormholeSpeed(x: number): void {
    const opts = this.wormholeSpeedOptions()
    this.wormholeSpeedPick = opts.includes(x) ? x : 0
    saveWormholeSpeedPick(this.wormholeSpeedPick)
    this.notify()
  }

  researchMatterTech(id: string): { ok: boolean; error?: string } {
    const r = researchMatterTech(this.state, this.ctx, id)
    this.notify()
    return r
  }

  private requestedWormholeSpeed(): number {
    return this.wormholeSpeedActive()
  }

  private drainSystemNotice(): void {
    const n = this.state.deliveryNotice
    if (n) {
      this.state.deliveryNotice = null
      if (this.onSystemNotice) this.onSystemNotice(n)
    }
    const loopStop = this.state.autoLoopStopNotice
    if (loopStop) {
      this.state.autoLoopStopNotice = null
      const noticeLog = [...this.state.logs].reverse().find(log => log.text === loopStop && log.textId?.startsWith('core.invasionLoop.'))
      if (this.onSystemNotice) this.onSystemNotice(noticeLog ? logText(noticeLog) : loopStop)
    }
    const droneLoss = this.state.droneLossNotice
    if (droneLoss) {
      this.state.droneLossNotice = null
      if (this.onSystemNotice) this.onSystemNotice(droneLoss)
    }
    const nebula = this.state.nebulaHintNotice
    if (nebula) {
      this.state.nebulaHintNotice = null
      if (this.onSystemNotice) this.onSystemNotice(nebula)
    }
  }

  private notify(): void {
    this.winCache.sync()
    this.ensurePump()
    const rec = perfHub.recording
    const t0 = rec ? performance.now() : 0
    const bucket = this.currentBucket()
    for (const fn of this.listeners) fn()
    if (rec) perfHub.recordNotify(bucket, performance.now() - t0)
  }

  async start(): Promise<void> {
    this.stopped = false
    this.winCache.reset()
    let lastSavedWall: number | null = null
    let rescued = false
    const guard = saveStorageProbe()
    this.saveUnavailable = guard !== null && !guard.ok
    try {
      const raw = await saveBridge.load()
      if (raw !== null) {
        const parsed = loadSaveFile(raw)
        const gate = await this.ironmanLoadCheck(raw, parsed.savedAtWallMs, false)
        if (!gate.ok) {
          this.savePaused = true
          addLog(this.state, 'warn', gate.error)
        } else {
          if (ironmanOn(parsed.state)) await this.syncIronmanHead(parsed.state)
          this.state = parsed.state
          migrateDeprecatedAmmo(this.state)
          wormholeNormalizeLegacyTemp(this.state, this.ctx)
          lastSavedWall = parsed.savedAtWallMs
          rescued = gate.rescue
        }
      }
    } catch (err) {
      console.error(tr("ui.engine.019"), err)
      this.state = createInitialState({ prologue: true })
      const why =
        err instanceof SaveError
          ? err.code === 'PARSE'
            ? tr("ui.engine.020")
            : err.code === 'FORMAT'
              ? tr("ui.engine.021")
              : tr("ui.engine.022")
          : tr("ui.engine.023")
      addLog(this.state, 'warn', tr("ui.engine.024", { why: why }))
      if (!this.saveUnavailable) this.savePaused = true
    }

    repairDeprecatedModules(this.state, this.ctx)
    repairMisplacedWarehouseModules(this.state, this.ctx)
    repairHoldForbiddenCargo(this.state, this.ctx)
    const now = Date.now()
    if (lastSavedWall !== null && !this.wormholeTestEnabled()) {
      const before = snapshotBasics(this.state)
      const stats = newSettleStats()
      const { overflowMs } = offlineSplit(now - lastSavedWall, offlineCapMsOf(this.state))
      simulateOffline(this.state, lastSavedWall, now, this.ctx, undefined, { stats, onUnboxResult: this.onUnboxResult, onStationActivityStarted: this.onStationActivityStarted })
      this.drainSystemNotice()
      this.offlineReport = buildOfflineReport(before, this.state, this.ctx, now - lastSavedWall, overflowMs, stats)
      if (this.offlineReport !== null) {
        addLog(this.state, 'system', offlineReportLogText(this.offlineReport))
      }
    }

    this.lastRealMs = Date.now()
    this.pumpMs = 0
    this.ensurePump()
    if (this.saveWriteState() === 'ok') this.ensureSaveInterval()

    const saved = await this.persist()
    if (saved && rescued) await saveBridge.ironmanNoteRescue().catch(() => {})
    this.notify()
    this.installWormholeTestApi()
    this.installPlanetaryTestApi()
    window.addEventListener('pagehide', this.onPageHide)
  }

  private onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted) this.winCache.pause()
    else this.stop()
  }

  stop = (): void => {
    this.stopped = true
    this.signalAutoController?.abort()
    this.winCache.reset()
    if (this.intervalId !== null) window.clearInterval(this.intervalId)
    if (this.saveIntervalId !== null) window.clearInterval(this.saveIntervalId)
    this.intervalId = null
    this.saveIntervalId = null
    this.pumpMs = 0
    window.removeEventListener('pagehide', this.onPageHide)
  }

  private wormholeTestEnabled(): boolean {
    try {
      return debugEnabled() && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname) && localStorage.getItem('whale-idle:wh-expedition-test') === '1'
    } catch { return false }
  }

  private installWormholeTestApi(): void {
    if (!this.wormholeTestEnabled()) return
    const target = window as typeof window & { __whExpeditionTest?: object }
    target.__whExpeditionTest = {
      snapshot: () => this.wormholeTestEnabled() ? structuredClone(this.state) : null,
      command: async (name: string, args: unknown[] = []) => {
        if (!this.wormholeTestEnabled()) return { ok: false }
        let result: unknown
        switch (name) {
          case 'scan': result = this.wormholeScan(); break
          case 'travel': result = this.wormholeTravel(Number(args[0]), Number(args[1]), args[2] === true, args[3] === true, args[4] === true); break
          case 'activate': result = this.wormholeActivate(); break
          case 'battle': result = this.wormholeFight(args[0] === 'ruins' ? 'ruins' : 'node'); break
          case 'event': result = this.wormholeResolveEvent(args[0] as import('@whale/core').WormholeEventAction); break
          case 'eventView': return this.wormholeEventView()
          case 'descend': result = this.wormholeDescend(args[0] === true); break
          case 'extractPreview': return this.wormholeExtractionPreview({ leavePieces: [], leaveSupplies: {}, takeGround: [] })
          case 'extract': result = this.wormholeExtractConfirmed(args[0] as WormholeExtractionPlan); break
          case 'load': result = this.wormholeTempStow(String(args[0])); break
          case 'leave': result = this.wormholeLeave(); break
          case 'resume': result = this.wormholeResume(); break
          case 'step': {
            const duration = Number(args[0])
            if (!Number.isSafeInteger(duration) || duration < 0 || duration > 900_000) return { ok: false }
            for (let left = duration; left > 0;) {
              const dt = Math.min(100, left)
              this.state.gameMs += dt
              advanceWormhole(this.state, this.ctx)
              left -= dt
            }
            result = { ok: true }
            this.notify()
            break
          }
          case 'persist': result = { ok: await this.persist() }; break
          default: return { ok: false }
        }
        await this.persist()
        return result
      },
    }
  }

  private ensureSaveInterval(): void {
    if (this.saveIntervalId !== null) return
    this.saveIntervalId = window.setInterval(() => {
      void this.persist()
    }, SAVE_INTERVAL_MS)
  }

  saveWriteState(): 'ok' | 'paused' | 'unavailable' {
    if (!canWriteSave() || this.reconnectResolving || this.loadResolving) return 'paused'
    if (this.saveUnavailable) return 'unavailable'
    if (this.savePaused) return 'paused'
    return 'ok'
  }

  async allowSaveAfterLoadError(): Promise<boolean> {
    this.savePaused = false
    this.ensureSaveInterval()
    return await this.persist()
  }

  private wallNowOf(): number {
    return weekendClockOf(this.state)
  }

  private pumpWeekendAt(wallNow: number, lastSeenWallMs: number): void {
    this.settleWeekendPrize(wallNow)
    const weekend = weekendTick(this.state, this.ctx, wallNow, lastSeenWallMs, weekendFlagshipBattleActive(this.state))
    const endedEvent = weekend.ended ? this.state.weekendEvent : undefined
    this.settleWeekendPrize(wallNow)
    this.refreshAnomaliesView()
    if (weekend.started) {
      addLog(this.state, 'system', tr('ui.weekend.001'), 'ui.weekend.001')
      this.invasionAlarmPending = 'start'
      void this.persist()
    }
    if (weekend.flagshipAnchored) {
      addLog(this.state, 'system', tr('ui.weekend.002'), 'ui.weekend.002')
      this.flagshipPopupPending = true
      this.invasionAlarmPending = 'flagship'
      void this.persist()
    }
    if (weekend.ended) {
      const ev = endedEvent
      const outcome = weekendFlagshipOutcomeOf(ev)
      const hasFlagship = ev?.flagshipHpMax !== undefined
      const sharePct = Math.round(weekendFlagshipSharesOf(ev).player * 100)
      const id =
        outcome === 'player'
          ? 'ui.weekend.115'
          : outcome === 'octopus'
            ? 'ui.weekend.003'
            : hasFlagship
              ? 'ui.weekend.117'
              : 'ui.weekend.004'
      addLog(this.state, 'system', tr(id, { p1: sharePct }), id, { p1: sharePct })
      void this.persist()
    }
    this.settleWeekendPrize(wallNow)
    weekendSyncComms(this.state, this.ctx, wallNow)
  }

  private tick(): void {
    if (this.stopped) return
    if (this.wormholeTestEnabled()) { this.winCache.pause(); this.lastRealMs = Date.now(); return }
    if (!canWriteSave() || this.reconnectResolving || this.loadResolving) { this.winCache.pause(); this.lastRealMs = Date.now(); return }
    const now = Date.now()
    const dt = Math.max(1, now - this.lastRealMs)
    this.lastRealMs = now
    if (this.state.onboarding.step === ONB_AWAKEN) {
      this.pendingMs = 0
      return
    }
    this.pumpWeekendAt(this.wallNowOf(), this.wallNowOf() - dt)
    const exp = this.state.expedition
    const inBattle = this.inLiveBattle()
    if (inBattle) {
      this.pendingMs += dt
      const step = Math.min(this.pendingMs, 100)
      if (step > 0) {
        this.advanceSlice(step)
        this.pendingMs -= step
      }
      this.notify()
      return
    }
    const pumpDt = dt
    this.pendingMs += pumpDt
    if (exp.phase === 'out' && exp.active) {
      const toArrival = Math.max(0, exp.finishAtGameMs - this.state.gameMs)
      if (this.pendingMs >= toArrival) {
        const slice = Math.min(this.pendingMs, toArrival + 1)
        if (slice > 0) {
          this.advanceSlice(slice)
          this.pendingMs -= slice
        }
        this.notify()
        return
      }
    }
    if (this.pendingMs >= this.pumpMs) {
      this.advanceSlice(this.pendingMs)
      this.pendingMs = 0
      this.notify()
    }
    if (this.state.autoLoopAnomalyId !== null) {
      const wasActive = this.state.expedition.active
      const reason = advanceAutoLoopBounty(this.state, this.ctx)
      if (!wasActive && this.state.expedition.active) this.autoSortie = true
      if (reason !== null || (!wasActive && this.state.expedition.active) || this.state.pendingBattleRange) this.notify()
    }
    if (autoLoopInvasionGalaxy(this.state) !== null) {
      const wasActive = this.state.expedition.active
      const reason = advanceAutoLoopInvasion(this.state, this.ctx, this.wallNowOf())
      if (!wasActive && this.state.expedition.active) this.autoSortie = true
      if (reason !== null || (!wasActive && this.state.expedition.active) || this.state.pendingBattleRange) this.notify()
    }
    if (this.autoSortie && !this.state.expedition.active) this.autoSortie = false
    this.pumpWinCache()
  }

  async persist(): Promise<boolean> {
    return (await this.persistSnapshot()) !== null
  }

  marketRelayReady(state: GameState): boolean {
    return this.state === state && this.saveWriteState() === 'ok'
  }

  marketRelayPending(state: GameState, scope: string): MarketRelayRequest | null {
    return this.marketRelayReady(state) ? marketRelayPendingRequest(state, scope) : null
  }

  async persistMarketRelay(state: GameState): Promise<boolean> {
    if (!this.marketRelayReady(state)) return false
    const saved = await this.persist()
    return saved && this.state === state && this.saveWriteState() === 'ok'
  }

  prepareMarketRelay(state: GameState, scope: string, ids: { saveId: string; requestId: string; orderId: () => string }): MarketRelayRequest | null {
    return this.marketRelayReady(state) ? prepareMarketRelayRequest(state, this.ctx, scope, ids) : null
  }

  applyMarketRelay(state: GameState, scope: string, requestId: string, response: MarketRelayResponse): boolean {
    if (!this.marketRelayReady(state)) return false
    const applied = applyMarketRelayResponse(state, this.ctx, scope, requestId, response)
    if (applied) this.notify()
    return applied
  }

  private saveSequence = 0

  private createSaveSnapshot(state: GameState = this.state): { state: GameState; text: string; seq: number } {
    const out = { ...state, logs: [], ...(state.ironman ? { ironman: { ...state.ironman } } : {}) }
    if (out.ironman?.on) {
      out.ironman.seq = Math.max(this.saveSequence ?? 0, out.ironman.seq)
      this.saveSequence = bumpIronmanSeq(out)
    }
    return { state, text: serializeSaveFile(out), seq: out.ironman?.seq ?? 0 }
  }

  private async persistSnapshot(snapshot?: { state: GameState; text: string; seq: number }, loading = false): Promise<string | null> {
    if (loading ? !canWriteSave() || this.saveUnavailable || this.savePaused : this.saveWriteState() !== 'ok') return null
    try {
      const prepared = snapshot ?? this.createSaveSnapshot()
      const { text, state, seq } = prepared
      const ok = await saveBridge.save(text)
      if (ok) {
        if (state.ironman?.on) state.ironman.seq = Math.max(state.ironman.seq, seq)
        void requestPersistentStorage()
      }
      else noteSaveWriteFailed()
      return ok ? text : null
    } catch (err) {
      console.error(tr("ui.engine.025"), err)
      noteSaveWriteFailed()
      return null
    }
  }

  private async commitLoadedSave(candidate: GameState, report: OfflineReport | null, rescue: boolean): Promise<boolean> {
    if (!canWriteSave() || this.saveUnavailable || this.savePaused || this.reconnectResolving) return false
    this.reconnectResolving = true
    try {
      if (await this.persistSnapshot(this.createSaveSnapshot(candidate), true) === null) return false
      this.state = candidate
      this.offlineReport = report
      this.lastRealMs = Date.now()
      this.pendingMs = 0
      if (rescue) await saveBridge.ironmanNoteRescue().catch(() => {})
      this.notify()
      return true
    } finally { this.reconnectResolving = false }
  }


  async backupNow(): Promise<{ ok: boolean; name?: string; error?: string }> {
    try {
      const snapshot = await this.persistSnapshot()
      if (snapshot === null) return { ok: false, error: tr('ui.engine.027') }
      return await saveBridge.backup(snapshot)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async listSaveBackups(): Promise<SaveBackupInfo[]> {
    try {
      const r = await saveBridge.listBackups()
      return r.ok ? r.backups : []
    } catch {
      return []
    }
  }

  async ironmanStatus(): Promise<{
    on: boolean
    seq: number
    ever: boolean
    closed: boolean
    sinceWallMs?: number
    ledgerSeq: number
    rescueMinAgeMs: number
    modeChosen: boolean
  }> {
    let ledgerSeq = 0
    try {
      const ledger = await saveBridge.ironmanLedger()
      if (ledger.ok) ledgerSeq = ledger.seq
    } catch {
      ledgerSeq = 0
    }
    return {
      on: ironmanOn(this.state),
      seq: ironmanSeq(this.state),
      ever: ironmanEver(this.state),
      closed: ironmanClosed(this.state),
      sinceWallMs: this.state.ironman?.sinceWallMs,
      ledgerSeq,
      rescueMinAgeMs: IRONMAN_RESCUE_MIN_AGE_MS,
      modeChosen: ironmanModeChosen(this.state),
    }
  }

  modeChoiceNeeded(): boolean {
    return !ironmanModeChosen(this.state)
  }

  async chooseStandardMode(): Promise<CommandResult> {
    if (ironmanModeChosen(this.state)) return { ok: true }
    markModeChosenAsStandard(this.state)
    await this.persist()
    this.notify()
    return { ok: true }
  }

  async enterIronmanNow(): Promise<CommandResult> {
    if (ironmanOn(this.state)) return { ok: false, error: tr('ui.Ironman.016') }
    if (ironmanClosed(this.state)) return { ok: false, error: tr('ui.Ironman.018') }
    let ledgerSeq = 0
    try {
      const ledger = await saveBridge.ironmanLedger()
      if (ledger.ok) ledgerSeq = ledger.seq
    } catch {
      ledgerSeq = 0
    }
    if (!enterIronman(this.state, Date.now(), ledgerSeq)) return { ok: false, error: tr('ui.Ironman.018') }
    await this.persist()
    this.notify()
    return { ok: true }
  }

  async closeIronmanNow(): Promise<CommandResult> {
    if (!ironmanOn(this.state)) return { ok: false, error: tr('ui.Ironman.017') }
    closeIronman(this.state, Date.now())
    await this.persist()
    this.notify()
    return { ok: true }
  }

  private async ironmanLoadCheck(
    text: string,
    incomingSavedAtWallMs: number,
    recordRescue = true,
  ): Promise<{ ok: true; rescue: boolean } | { ok: false; error: string }> {
    if (debugEnabled()) {
      console.warn('[debug] 铁人装载闸门已放行（本机调试模式）；来档保存时刻 =', incomingSavedAtWallMs)
      return { ok: true, rescue: false }
    }
    let ledgerSeq = 0
    try {
      const ledger = await saveBridge.ironmanLedger()
      if (ledger.ok) ledgerSeq = ledger.seq
    } catch (err) {
      console.warn('ironman ledger unavailable, gate degrades to in-save generations', err)
    }
    try {
      const incoming = loadSaveFile(text).state
      const now = Date.now()
      const verdict = ironmanLoadVerdict({
        ironman: ironmanOn(incoming),
        incomingSeq: ironmanSeq(incoming),
        currentSeq: ironmanSeq(this.state),
        ledgerSeq,
        incomingSavedAtWallMs,
        nowWallMs: now,
        bypass: debugEnabled(),
      })
      if (!verdict.ok) {
        return { ok: false, error: tr('ui.engine.051', { p1: String(verdict.threshold) }) }
      }
      if (verdict.rescue && recordRescue) void saveBridge.ironmanNoteRescue()
      return { ok: true, rescue: verdict.rescue }
    } catch (err) {
      console.warn('ironman gate skipped (incoming save unreadable)', err)
      return { ok: true, rescue: false }
    }
  }

  private async syncIronmanHead(s: GameState): Promise<void> {
    try {
      const ledger = await saveBridge.ironmanLedger()
      const head = Math.max(ironmanSeq(s), ironmanSeq(this.state), ledger.ok ? ledger.seq : 0)
      s.ironman = { ...(s.ironman ?? { on: false, seq: 0 }), seq: head }
    } catch (err) {
      console.warn('ironman ledger unavailable, sync degraded', err)
      const head = Math.max(ironmanSeq(s), ironmanSeq(this.state))
      s.ironman = { ...(s.ironman ?? { on: false, seq: 0 }), seq: head }
    }
  }
  weekendFlagshipPrep(): ReturnType<typeof weekendFlagshipPrepView> {
    return weekendFlagshipPrepView(this.state, this.ctx, Date.now())
  }

  get flagshipPopupPending(): boolean {
    return this.flagshipPopup
  }
  private set flagshipPopupPending(v: boolean) {
    this.flagshipPopup = v
  }
  private flagshipPopup = false
  dismissFlagshipPopup(): void {
    if (!this.flagshipPopup) return
    this.flagshipPopup = false
    this.notify()
  }
  takeInvasionAlarm(): 'start' | 'flagship' | null {
    const v = this.invasionAlarm
    if (v === null) return null
    this.invasionAlarm = null
    return v
  }
  private get invasionAlarmPending(): 'start' | 'flagship' | null {
    return this.invasionAlarm
  }
  private set invasionAlarmPending(v: 'start' | 'flagship' | null) {
    this.invasionAlarm = v
  }
  private invasionAlarm: 'start' | 'flagship' | null = null
  challengeWeekendFlagship(squad?: readonly string[]): CommandResult {
    const ships = squad !== undefined ? [...squad] : combatRosterOf(this.state)
    const now = Date.now()
    return this.withBattleAmmoWarning(`flagship:${ships.join(',')}`, ships, () => this.challengeWeekendFlagshipReady(ships), undefined,
      snapshot => ({ ok: !!weekendStartFlagshipBattle(snapshot, this.ctx, now, ships) }))
  }

  private challengeWeekendFlagshipReady(squad?: readonly string[]): CommandResult {
    const now = Date.now()
    const spec = weekendFlagshipSpecOf(this.state, this.ctx, now)
    if (!spec) return { ok: false, error: tr('ui.weekend.015') }
    const battle = weekendStartFlagshipBattle(this.state, this.ctx, now, squad)
    if (!battle) return { ok: false, error: tr('ui.weekend.015') }
    const ev = this.state.weekendEvent!
    this.state.encounter = {
      active: true,
      shipId: battle.myFleet?.[0]?.shipId ?? this.state.shipId,
      galaxyId: ev.coreId,
      name: spec.name,
      threat: spec.threat,
      anomalyId: spec.cardId,
      origin: tr('ui.weekend.016'),
      invitedAtGameMs: this.state.gameMs,
      deadlineGameMs: this.state.gameMs + this.ctx.balance.encounter.inviteWaitMs,
      battle,
    }
    this.notify()
    void this.persist()
    return { ok: true }
  }

  private settleWeekendPrize(now: number): void {
    const r = weekendSettleAndGrant(this.state, this.ctx, now)
    if (!r) return
    const pct = (r.share * 100).toFixed(1)
    if (r.isk > 0) {
      const params = { p1: pct, p2: r.wreck, p3: r.isk.toLocaleString('zh-CN') }
      addLog(this.state, 'system', tr('ui.weekend.022', params), 'ui.weekend.022', params)
    } else if (r.wreck > 0) {
      const params = { p1: pct, p2: r.wreck }
      addLog(this.state, 'system', tr('ui.weekend.023', params), 'ui.weekend.023', params)
    } else {
      addLog(this.state, 'system', tr('ui.weekend.024'), 'ui.weekend.024')
    }
    this.notify()
    void this.persist()
  }

  async restoreBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    if (this.loadResolving || this.reconnectResolving) return { ok: false, error: tr('ui.engine.027') }
    this.loadResolving = true
    try {
      const read = await saveBridge.readBackup(name)
      if (!read.ok || read.text === undefined) return { ok: false, error: read.error ?? tr('ui.engine.049') }
      let parsed: ReturnType<typeof loadSaveFile>
      try {
        parsed = loadSaveFile(read.text)
      } catch (err) {
        return { ok: false, error: tr("ui.engine.026", { p1: err instanceof Error ? err.message : String(err) }) }
      }
      const gate = await this.ironmanLoadCheck(read.text, parsed.savedAtWallMs, false)
      if (!gate.ok) return { ok: false, error: gate.error }
      await this.syncIronmanHead(parsed.state)
      const report = this.prepareImportedState(parsed.state, parsed.savedAtWallMs)
      return await this.commitLoadedSave(parsed.state, report, gate.rescue)
        ? { ok: true } : { ok: false, error: tr('ui.engine.027') }
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally { this.loadResolving = false }
  }


  private currentSaveText(): string {
    const out: GameState = this.state.logs.length > 0 ? { ...this.state, logs: [] } : this.state
    return serializeSaveFile(out)
  }

  /** 用户手势内先申请文件权限，授权本身不允许写入；不同内容一律交给玩家选择。 */
  async reconnectLocalSave(): Promise<{ ok: boolean; choice?: ReconnectChoice; error?: string }> {
    const api = saveBridge.saveFile
    if (!api || this.reconnectResolving || this.loadResolving) return { ok: false }
    this.loadResolving = true
    try {
      const file = await api.reconnect()
      if (!file.ok || file.text === undefined || file.token === undefined) return { ok: false, error: file.error }
      const parsed = loadSaveFile(file.text)
      const browser = await saveBridge.load()
      const current = this.currentSaveText()
      if (sameReconnectProgress(current, file.text) && browser !== null && sameReconnectProgress(browser, file.text)) {
        const resumed = await api.resume(file.token, file.text)
        if (resumed.ok) { this.reconnectChoice = null; return { ok: true } }
        if (!resumed.changed || resumed.text === undefined) return { ok: false, error: resumed.error }
        return this.reconnectChanged(resumed)
      }
      const choice: ReconnectChoice = { token: file.token, text: file.text, fileName: file.name ?? '',
        current: reconnectProgress(this.state, Date.now()), file: reconnectProgress(parsed.state, parsed.savedAtWallMs) }
      this.reconnectChoice = choice
      return { ok: true, choice }
    } catch (err) { return { ok: false, error: tr('ui.engine.028', { p1: String(err) }) } }
    finally { this.loadResolving = false }
  }

  private reconnectChanged(file: SaveFileReconnectResult): { ok: boolean; choice?: ReconnectChoice; error?: string } {
    try {
      if (file.text === undefined || file.token === undefined) return { ok: false }
      const parsed = loadSaveFile(file.text)
      const choice: ReconnectChoice = { token: file.token, text: file.text, fileName: file.name ?? '',
        current: reconnectProgress(this.state, Date.now()), file: reconnectProgress(parsed.state, parsed.savedAtWallMs) }
      this.reconnectChoice = choice
      return { ok: false, choice, error: tr('ui.saveReconnect.009') }
    } catch (err) { return { ok: false, error: tr('ui.engine.028', { p1: String(err) }) } }
  }

  cancelReconnectLocalSave(): void { this.reconnectChoice = null }

  async resolveReconnectLocalSave(choice: 'file' | 'current'): Promise<{
    ok: boolean; choice?: ReconnectChoice; error?: string; loaded?: boolean; filePaused?: boolean
  }> {
    const api = saveBridge.saveFile
    const selected = this.reconnectChoice
    if (!api || !selected || this.reconnectResolving || this.loadResolving || !canWriteSave()) return { ok: false }
    this.loadResolving = true
    this.reconnectResolving = true
    try {
      let candidate: GameState
      let report: OfflineReport | null = null
      let rescue = false
      if (choice === 'file') {
        const parsed = loadSaveFile(selected.text)
        const gate = await this.ironmanLoadCheck(selected.text, parsed.savedAtWallMs, false)
        if (!gate.ok) return { ok: false, error: gate.error }
        rescue = gate.rescue
        candidate = parsed.state
        await this.syncIronmanHead(candidate)
        report = this.prepareImportedState(candidate, parsed.savedAtWallMs)
      } else {
        candidate = structuredClone(this.state)
      }
      bumpIronmanSeq(candidate)
      const text = serializeSaveFile({ ...candidate, logs: [] })
      const result = await api.resolve(selected.token, selected.text, text, choice)
      if (choice === 'file' && result.browserSaved) {
        this.state = candidate
        this.offlineReport = report
        this.lastRealMs = Date.now()
        this.pendingMs = 0
        this.savePaused = false
        this.ensureSaveInterval()
        if (rescue) await saveBridge.ironmanNoteRescue().catch(() => {})
        this.notify()
      } else if (choice === 'current' && result.fileSaved) {
        this.state.ironman = candidate.ironman
      }
      if (result.changed) {
        const changed = this.reconnectChanged(result)
        if (choice === 'file' && result.browserSaved) changed.error = `${tr('ui.SaveManager.032')} ${changed.error ?? ''}`
        return changed
      }
      if (!result.ok) {
        if (choice === 'file' && result.browserSaved) {
          this.reconnectChoice = null
          return { ok: true, loaded: true, filePaused: true }
        }
        return { ok: false, error: result.fileSaved
          ? `${tr('ui.App.054')} ${result.error ?? tr('ui.engine.027')}`
          : result.error ?? tr('ui.engine.027') }
      }
      this.reconnectChoice = null
      return { ok: true, loaded: choice === 'file' }
    } catch (err) { return { ok: false, error: String(err) } }
    finally { this.reconnectResolving = false; this.loadResolving = false }
  }

  private prepareImportedState(imported: GameState, wallFrom: number): OfflineReport | null {
    repairDeprecatedModules(imported, this.ctx)
    migrateDeprecatedAmmo(imported)
    wormholeNormalizeLegacyTemp(imported, this.ctx)
    repairMisplacedWarehouseModules(imported, this.ctx)
    repairHoldForbiddenCargo(imported, this.ctx)
    imported.logs = []
    const now = Date.now()
    if (wallFrom <= 0 || now <= wallFrom) return null
    const before = snapshotBasics(imported)
    const stats = newSettleStats()
    const { overflowMs } = offlineSplit(now - wallFrom, offlineCapMsOf(imported))
    simulateOffline(imported, wallFrom, now, this.ctx, undefined, { stats })
    const report = buildOfflineReport(before, imported, this.ctx, now - wallFrom, overflowMs, stats)
    if (report !== null) addLog(imported, 'system', offlineReportLogText(report))
    return report
  }

  async exportSaveToFile(): Promise<{ ok: boolean; path?: string; shared?: boolean; canceled?: boolean; error?: string }> {
    try {
      if (this.saveWriteState() !== 'ok') return await saveBridge.exportSaveToFile(this.currentSaveText())
      const snapshot = this.createSaveSnapshot()
      const exported = saveBridge.exportSaveToFile(snapshot.text)
      const [r] = await Promise.all([exported, this.persistSnapshot(snapshot)])
      return r
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async exportCloudSave(): Promise<{ ok: boolean; text?: string; error?: string }> {
    try {
      const text = await this.persistSnapshot()
      return text === null ? { ok: false, error: tr('ui.engine.027') } : { ok: true, text }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async exportBackupToFile(name: string): Promise<{ ok: boolean; path?: string; shared?: boolean; canceled?: boolean; error?: string }> {
    try {
      const read = await saveBridge.readBackup(name)
      if (!read.ok || read.text === undefined) return { ok: false, error: read.error ?? tr('ui.engine.049') }
      return await saveBridge.exportSaveToFile(read.text)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }

  async importSaveFromFile(): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
    if (this.loadResolving || this.reconnectResolving) return { ok: false, error: tr('ui.engine.027') }
    this.loadResolving = true
    try {
      const picked = await saveBridge.pickImportSave()
      if (!picked.ok) return { ok: false, canceled: picked.canceled === true, error: picked.error }
      return await this.importSaveText(picked.text ?? '')
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally { this.loadResolving = false }
  }

  async importCloudSave(text: string): Promise<{ ok: boolean; error?: string }> {
    if (this.loadResolving || this.reconnectResolving) return { ok: false, error: tr('ui.engine.027') }
    this.loadResolving = true
    try {
      return await this.importSaveText(text)
    } catch (err) {
      return { ok: false, error: String(err) }
    } finally { this.loadResolving = false }
  }

  private async importSaveText(text: string): Promise<{ ok: boolean; error?: string }> {
    let parsed: ReturnType<typeof loadSaveFile>
    try {
      parsed = loadSaveFile(text)
    } catch (err) {
      return { ok: false, error: tr('ui.engine.028', { p1: err instanceof Error ? err.message : String(err) }) }
    }
    const gate = await this.ironmanLoadCheck(text, parsed.savedAtWallMs, false)
    if (!gate.ok) return { ok: false, error: gate.error }
    const imported = parsed.state
    await this.syncIronmanHead(imported)
    const report = this.prepareImportedState(imported, parsed.savedAtWallMs)
    return await this.commitLoadedSave(imported, report, gate.rescue)
      ? { ok: true } : { ok: false, error: tr('ui.engine.027') }
  }

  async deleteSaveBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    try {
      return await saveBridge.deleteBackup(name)
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }


  trainNextLevel(skillId: string): CommandResult {
    const current = this.state.skills.trained[skillId] ?? 0
    if (current >= MAX_SKILL_LEVEL) return { ok: false, error: tr("ui.engine.029") }
    const queued = this.state.skills.queue.filter((q) => q.skillId === skillId).length
    const target = current + 1 + queued
    if (target > MAX_SKILL_LEVEL) return { ok: false, error: tr("ui.engine.030") }
    const result = enqueueSkill(this.state, skillId, target, this.ctx.skills)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  /**
   * **购买技能训练许可**（**2026-09-27 船长令**：「我想让学习技能有成本」）——
   * 收费档（rank4/5/6，rank6 为**预留档**）先买许可才能排训练；rank1~3 免许可。
   * 判定（免费档 / 已购 / 老档已练 / 余额）与扣款全在 core 的 `buySkillLicense`，这里只落盘 + 通知。
   */
  purchaseSkillLicense(skillId: string): CommandResult & { price?: number } {
    const r = buySkillLicense(this.state, this.ctx.skills, skillId)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  dequeueAt(index: number): boolean {
    const ok = removeQueueAt(this.state, index, this.ctx.skills)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  skillCancelImpactAt(index: number): { target: TrainingItem; also: TrainingItem[] } | null {
    return skillCancelImpact(this.state, this.ctx.skills, index)
  }

  enqueuePrereqChain(skillId: string): { ok: boolean; added: number; error?: string } {
    const def = this.ctx.skills.get(skillId)
    if (!def) return { ok: false, added: 0, error: tr('core.engine.005', { p1: skillId }) }
    const steps = planPrereqChain(this.state, def, this.ctx.skills, { includeTarget: true })
    let added = 0
    for (const step of steps) {
      const r = enqueueSkill(this.state, step.skillId, step.targetLevel, this.ctx.skills)
      if (!r.ok) return { ok: false, added, error: cmdText(r) }
      added += 1
    }
    if (added > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, added }
  }

  moveQueueAt(fromIndex: number, toIndex: number): boolean {
    const ok = moveQueueItem(this.state, fromIndex, toIndex, this.ctx.skills)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }


  noteLabOpened(): void {
    if (!markLabOpened(this.state)) return
    void this.persist()
    this.notify()
  }

  startMiningAt(beltId: string): CommandResult {
    return this.withActivitySwitch('mining', () => {
      const result = startMining(this.state, beltId, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  startMiningFromExpeditionAt(beltId: string): CommandResult {
    const result = startMiningFromExpedition(this.state, beltId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  stopMiningNow(): boolean {
    const ok = stopMining(this.state, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  salvageTargetsAt(
    galaxyId: string,
    readOnly = false,
  ): Array<{ groupKey: string; stockM3: number }> {
    return readOnly ? wreckGroupStocksOf(this.state, this.ctx, galaxyId, true) : wreckTargetsOf(this.state, this.ctx, galaxyId)
  }


  startSalvageOpAt(galaxyId: string, targetGroup?: string): CommandResult {
    return this.withActivitySwitch('salvaging', () => {
      const result = startSalvageOp(this.state, galaxyId, this.ctx, targetGroup)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  stopSalvageOpNow(): boolean {
    const ok = stopSalvageOp(this.state, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  startRefineRunAt(itemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('refine', () => {
      const result = startRefineRun(this.state, itemId, worker, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  stopRefineRunAt(runId: number | string): CommandResult {
    const result = stopRefineRun(this.state, this.ctx, Number(runId))
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  startUnboxRunAt(boxItemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('refine', () => {
      const result = startUnboxRun(this.state, this.ctx, boxItemId, worker)
      if (result.ok) {
        if (!result.queued) this.unboxLedger.begin(this.state, boxItemId)
        void this.persist()
        this.notify()
      }
      return result
    })
  }
  startRecycleRunAt(wreckItemId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('refine', () => {
      const result = startRecycleRun(this.state, wreckItemId, worker, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  refineRunViews(): RefineRunView[] {
    return refineRunViews(this.state, this.ctx)
  }


  labUnlocked(): boolean {
    return labUnlockedCore(this.state, this.ctx)
  }

  startLabRunAt(recipeId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('lab', () => {
      const result = startLabRun(this.state, this.ctx, recipeId, worker)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  stopLabRunAt(runId: number | string): CommandResult {
    const result = stopLabRun(this.state, this.ctx, Number(runId))
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  labRunViews(): LabRunView[] {
    return labRunViews(this.state, this.ctx)
  }

  setLabLoopAt(recipeId: string, on: boolean, goal?: number | null): CommandResult {
    const result = setLabLoop(this.state, recipeId, on, goal ?? null)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  labLoopOf(recipeId: string | null): LabLoopView {
    return labLoopOf(this.state, recipeId)
  }

  jumpFuelStock(): number {
    return jumpFuelStockOf(this.state)
  }

  jumpFuelSupply(): JumpFuelSupply {
    return jumpFuelSupplyOf(this.state, this.ctx)
  }

  jumpFuelEnabled(activity: JumpFuelActivity): boolean {
    return jumpFuelEnabledOf(this.state, activity)
  }

  setJumpFuel(activity: JumpFuelActivity, on: boolean): CommandResult {
    if (!this.labUnlocked()) {
      return { ok: false, error: '跃迁燃料需在首座空间站建成后使用。', errorId: 'core.jumpFuel.002' }
    }
    const cur = (this.state.jumpFuel ??= {})
    if (on) cur[activity] = true
    else delete cur[activity]
    void this.persist()
    this.notify()
    return { ok: true }
  }

  redeemFragmentsAt(moduleId: string): CommandResult {
    const result = redeemFragments(this.state, this.ctx, moduleId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  fragmentRedeemRows(): FragmentRedeemRow[] {
    return fragmentRedeemRowsOf(this.state, this.ctx)
  }

  sellItem(itemId: string): SellResult {
    return this.sellCargo(itemId)
  }


  learnBlueprintAt(blueprintId: string): CommandResult {
    const result = learnBlueprint(this.state, this.ctx, blueprintId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  exchangePlugBlueprintAt(moduleId: string): CommandResult {

    const r = exchangePlugBlueprint(this.state, this.ctx, moduleId)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error, errorId: r.errorId, errorParams: r.errorParams }
  }
  exchangeUniversalBlackBoxAt(count = 1): CommandResult {
    const r = exchangeUniversalBlackBox(this.state, count)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error, errorId: r.errorId, errorParams: r.errorParams }
  }

  openBlackMarketAt(): void {
    if (ensureBlackMarket(this.state, this.ctx, Date.now())) {
      void this.persist()
      this.notify()
    }
  }

  buyBlackMarketAt(goodKey: string, dayWallMs: number, price: number, quantity?: number): CommandResult {
    const result = blackMarketBuy(this.state, this.ctx, goodKey, dayWallMs, price, Date.now(), quantity)
    void this.persist()
    this.notify()
    return result
  }

  exchangeWalletDelta(delta: number): boolean {
    if (!Number.isFinite(delta) || delta === 0) return false
    const next = this.state.wallet.isk + delta
    if (next < 0) return false
    this.state.wallet.isk = next
    void this.persist()
    this.notify()
    return true
  }

  buyGoodAt(goodKey: string, qty = 1): CommandResult {
    const res = buyAtMarket(this.state, this.ctx, goodKey, qty)
    if (res.bought > 0) {
      void this.persist()
      this.notify()
    }
    if (res.bought >= qty) return { ok: true }
    const def = this.ctx.marketGoods.get(goodKey)
    const name = def ? goodName(this.ctx, goodKey) : goodKey
    if (res.bought > 0) {
      return {
        ok: false,
        error: tr("ui.engine.031", { p1: res.bought.toLocaleString('zh-CN'), name: name, p3: res.bought.toLocaleString('zh-CN') }),
      }
    }
    switch (res.blocked) {
      case 'insufficient-isk': {
        const quote = marketQuote(this.state, this.ctx, goodKey)
        const unit = quote.sell ?? 0
        return {
          ok: false,
          error: tr("ui.engine.032", { p1: unit.toLocaleString('zh-CN'), p2: Math.floor(this.state.wallet.isk).toLocaleString('zh-CN') }),
        }
      }
      case 'standing':
        return {
          ok: false,
          error: tr('ui.engine.033', {
            p1: def
              ? (bmGateReason(this.state, def) ?? goodLockedReason(this.state, def) ?? tr('ui.engine.034'))
              : tr('ui.engine.034'),
          }),
        }
      case 'not-buyable':
        return { ok: false, error: tr("ui.engine.035", { name: name }) }
      default:
        return {
          ok: false,
          error: tr("ui.engine.036", { name: name }),
        }
    }
  }

  placeBuyOrderAt(
    goodKey: string,
    price: number,
    qty: number,
  ): { orderId: number; want: number; placed: number; filled: number; resting: number; escrow: number } | null {
    const order = placeBuyOrder(this.state, this.ctx, goodKey, price, qty)
    if (!order) return null
    void this.persist()
    this.notify()
    return {
      orderId: order.id,
      want: qty,
      placed: order.filled + order.qty,
      filled: order.filled,
      resting: order.qty,
      escrow: order.escrowIsk ?? 0,
    }
  }

  buyOrderBlocked(goodKey: string, price: number, qty: number): CoreBlockReason | null {
    return buyOrderBlockedReason(this.state, this.ctx, goodKey, price, qty)
  }

  placeSellOrderAt(
    goodKey: string,
    price: number,
    qty: number,
  ): { ok: boolean; error?: string; orderId?: number; price?: number; filled?: number; resting?: number } {
    const res = listSellHolding(this.state, this.ctx, goodKey, price, qty)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  claimFirstTaskAt(id: string): { ok: boolean; error?: string } {
    const res = claimFirstTask(this.state, this.ctx, id)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  cancelOrderAt(orderId: number): boolean {
    const ok = cancelOrder(this.state, this.ctx, orderId)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  sellHoldingAt(
    goodKey: string,
    qty?: number,
  ): { ok: boolean; error?: string; sold?: number; total?: number; remaining?: number } {
    const res = marketSellHolding(this.state, this.ctx, goodKey, qty)
    if (res.ok && res.sold > 0) {
      void this.persist()
      this.notify()
    }
    if (res.ok) return { ok: true, sold: res.sold, total: res.total, remaining: res.remaining }
    return { ok: false, error: res.error ?? tr('core.market.007') }
  }

  sellPreviewAt(goodKey: string, qty?: number): ReturnType<typeof marketSellPreview> {
    return marketSellPreview(this.state, this.ctx, goodKey, qty)
  }


  storeShipAt(uid: string, clearName = false): CommandResult {
    const res = storeShip(this.state, uid, this.ctx, { clearName })
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  unstoreShipAt(defId: string): CommandResult {
    const res = unstoreShip(this.state, defId, this.ctx)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res
  }

  sellStoredShipAt(defId: string): CommandResult {
    const res = sellStoredShipAtMarket(this.state, this.ctx, defId)
    if (res.ok) {
      void this.persist()
      this.notify()
    }
    return res.ok
      ? { ok: true }
      : { ok: false, error: res.reason ?? tr('core.market.007'), errorId: res.reasonId, errorParams: res.reasonParams }
  }

  startManufacturingAt(blueprintId: string, worker: AiCoreType | 'pilot'): CommandResult {
    return this.withActivitySwitch('manufacturing', () => {
      const result = startManufacturing(this.state, blueprintId, worker, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }



  fitModuleTo(moduleId: string, rack: RackSlot, index: number, shipId?: string): CommandResult {
    const result = fitModule(this.state, moduleId, this.ctx, { rack, index, shipId })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  unfitAtAt(rack: RackSlot, index: number, shipId?: string): CommandResult {
    const uid = shipId ?? this.state.shipId
    const blocked = shipOperationBlockReason(this.state, this.ctx, uid, 'configure')
    if (blocked) return { ok: false, ...blocked }
    const why = cpuOverloadText(this.state, this.ctx, uid, { remove: { rack, index } })
    if (why !== null) return { ok: false, error: why.error, errorId: why.errorId, errorParams: why.errorParams }
    const ok = unfitAt(this.state, rack, index, shipId, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
      return { ok: true }
    }
    return { ok: false, error: tr("ui.engine.037") }
  }

  swapModuleTo(moduleId: string, rack: RackSlot, index: number, shipId?: string): CommandResult {
    const result = swapModuleAt(this.state, moduleId, this.ctx, { rack, index, shipId })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }


  saveFitPresetFor(shipId: string, name?: string): CommandResult {
    const result = saveFitPreset(this.state, this.ctx, shipId, name)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  saveWreckFitPresetAt(seq: number, name?: string, expectedOverwrite?: import('@whale/core').ShipFitPreset): ReturnType<typeof saveWreckFitPreset> {
    const result = saveWreckFitPreset(this.state, this.ctx, seq, name, expectedOverwrite)
    if (result.ok) { void this.persist(); this.notify() }
    return result
  }

  overwriteFitPresetAt(shipId: string, index: number): CommandResult {
    const result = overwriteFitPreset(this.state, this.ctx, shipId, index)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  applyFitPresetAt(shipId: string, index: number): FitPresetApplyResult {
    const result = applyFitPreset(this.state, this.ctx, shipId, index)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  renameFitPresetAt(defId: string, index: number, name: string): CommandResult {
    const result = renameFitPreset(this.state, defId, index, name)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  deleteFitPresetAt(defId: string, index: number): CommandResult {
    const result = deleteFitPreset(this.state, defId, index)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  unfitAllFor(shipId: string): UnfitAllResult {
    const result = unfitAllModules(this.state, this.ctx, shipId)
    if (result.ok && result.removed > 0) {
      void this.persist()
      this.notify()
    }
    return result
  }

  adjustDroneLoadAt(droneId: string, delta: number, shipId?: string): CommandResult {
    const result = adjustDroneLoad(this.state, this.ctx, droneId, delta, shipId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  setAmmoTierAt(type: DamageType, itemId: string | null, shipId?: string): CommandResult {
    const result = setAmmoTier(this.state, this.ctx, type, itemId, shipId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  private foeGalaxyOf(anomalyId: string, hintGalaxyId?: string): string | undefined {
    const cardGalaxyId = this.anomalies.find((a) => a.id === anomalyId)?.galaxyId
    return weekendLaunchGalaxyOf(this.state, hintGalaxyId, cardGalaxyId, Date.now())
  }

  private weekendDispatchOf(anomalyId: string, hintGalaxyId?: string): { cardId: string; rewardIskOverride?: number } {
    const galaxyId = this.foeGalaxyOf(anomalyId, hintGalaxyId)
    if (galaxyId === undefined) return { cardId: anomalyId }
    const drawn = weekendAssaultDrawOf(this.state, this.ctx, galaxyId, Date.now())
    if (drawn === null) return { cardId: anomalyId }
    return { cardId: drawn.cardId, rewardIskOverride: drawn.rewardIsk }
  }

  startExpeditionAt(anomalyId: string, foeGalaxyId?: string): CommandResult {
    return this.withBattleAmmoWarning(`expedition:${anomalyId}:${foeGalaxyId ?? ''}`, combatRosterOf(this.state), () => this.startExpeditionReady(anomalyId, foeGalaxyId), undefined,
      snapshot => startExpedition(snapshot, this.weekendDispatchOf(anomalyId, foeGalaxyId).cardId, this.ctx, { foeGalaxyId: this.foeGalaxyOf(anomalyId, foeGalaxyId) }))
  }

  private startExpeditionReady(anomalyId: string, foeGalaxyId?: string): CommandResult {
    return this.withActivitySwitch('expedition', confirmed => {
      const galaxyId = this.foeGalaxyOf(anomalyId, foeGalaxyId)
      const dispatch = this.weekendDispatchOf(anomalyId, foeGalaxyId)
      const result = startExpedition(this.state, dispatch.cardId, this.ctx, {
        ...(galaxyId !== undefined ? { foeGalaxyId: galaxyId } : {}),
        ...(dispatch.rewardIskOverride !== undefined ? { rewardIskOverride: dispatch.rewardIskOverride } : {}),
        ...(confirmed ? { confirmActivitySwitch: true } : {}),
      })
      if (result.ok) {
        if (dispatch.cardId !== anomalyId) weekendNoteAssaultDispatch(this.state)
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  startExpeditionFromMiningAt(anomalyId: string, foeGalaxyId?: string): CommandResult {
    return this.withBattleAmmoWarning(`mining-expedition:${anomalyId}:${foeGalaxyId ?? ''}`, combatRosterOf(this.state), () => this.startExpeditionFromMiningReady(anomalyId, foeGalaxyId), undefined,
      snapshot => startExpeditionFromMining(snapshot, anomalyId, this.ctx, { foeGalaxyId: this.foeGalaxyOf(anomalyId, foeGalaxyId) }))
  }

  private startExpeditionFromMiningReady(anomalyId: string, foeGalaxyId?: string): CommandResult {
    const result = startExpeditionFromMining(this.state, anomalyId, this.ctx, {
      foeGalaxyId: this.foeGalaxyOf(anomalyId, foeGalaxyId),
    })
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  startLairExpeditionAt(anomalyId: string, lairTier: LairTier, fromMining = false): CommandResult {
    return this.withBattleAmmoWarning(`lair:${anomalyId}:${lairTier}:${fromMining}`, combatRosterOf(this.state), () => this.startLairExpeditionReady(anomalyId, lairTier, fromMining), undefined,
      snapshot => (fromMining ? startExpeditionFromMining : startExpedition)(snapshot, anomalyId, this.ctx, { lairTier, foeGalaxyId: this.foeGalaxyOf(anomalyId) }))
  }

  private startLairExpeditionReady(anomalyId: string, lairTier: LairTier, fromMining = false): CommandResult {
    return this.withActivitySwitch('expedition', confirmed => {
      const result = fromMining
        ? startExpeditionFromMining(this.state, anomalyId, this.ctx, { lairTier, foeGalaxyId: this.foeGalaxyOf(anomalyId) })
        : startExpedition(this.state, anomalyId, this.ctx, { lairTier, foeGalaxyId: this.foeGalaxyOf(anomalyId), ...(confirmed ? { confirmActivitySwitch: true } : {}) })
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  startScanAt(galaxyId: string): CommandResult {
    const result = startScan(this.state, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  stopScanNow(): CommandResult {
    const result = stopScan(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  ackScanView(): void {
    if (acknowledgeScanView(this.state)) {
      void this.persist()
      this.notify()
    }
  }

  wormholeScanStart(): CommandResult {
    return this.withActivitySwitch('wormholeScan', () => {
      const r = wormholeScanStart(this.state, this.ctx)
      if (r.ok) {
        void this.persist()
        this.notify()
      }
      return r
    })
  }

  wormholeScanStop(): CommandResult {
    const r = wormholeScanStop(this.state)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  cancelManufacturingAt(runId: number | string): CommandResult {
    const result = cancelManufacturing(this.state, this.ctx, Number(runId))
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  setManufacturingLoopAt(blueprintId: string, on: boolean, goal?: number | null): CommandResult {
    const result = setManufacturingLoop(this.state, blueprintId, on, goal ?? null)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  recallExpeditionNow(): CommandResult {
    const result = recallExpedition(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }


  private freshLayerSeed(): number {
    const s = (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0
    return s === 0 ? 1 : s
  }

  wormholeEnter(shipIds: readonly string[]): CommandResult {
    const r = wormholeEnter(this.state, this.ctx, shipIds, this.freshLayerSeed())
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  wormholeEnterFromStock(stockId: string, shipIds: readonly string[]): CommandResult {
    const item = wormholeStockOf(this.state).find((x) => x.id === stockId)
    if (!item) return { ok: false, error: tr("ui.engine.038") }
    if (item.expeditionRules !== undefined) return { ok: false, code: 'unsupported-rules' }
    const r = wormholeEnter(this.state, this.ctx, shipIds, this.freshLayerSeed(), {
      depth: item.depth,
      archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
      family: item.family ?? wormholeFamilyOfSeed(item.seed),
    })
    if (!r.ok) return { ok: false, error: r.error }
    const run = this.state.wormhole.run
    if (run) run.depth = Math.max(1, Math.min(9, item.depth))
    wormholeStockTake(this.state, stockId)
    void this.persist()
    this.notify()
    return { ok: true }
  }

  wormholePrepare(shipIds: readonly string[], request: WormholePreparationRequest, automatic = false): WormholePreparationPlan {
    return wormholePreparationPlan(this.state, this.ctx, shipIds, request, { automatic })
  }

  preparationSquad(kind: import('@whale/core').PreparationSquadKind, fallback: readonly string[] = []): string[] {
    return preparationSquadOf(this.state, kind, fallback)
  }

  rememberPreparationSquad(kind: import('@whale/core').PreparationSquadKind, squad: readonly string[]): void {
    if (notePreparationSquad(this.state, kind, squad, this.ctx)) { this.notify(); void this.persist() }
  }

  fleetPresetSave(name: string, replaceId?: string): CommandResult {
    const result = saveFleetPreset(this.state, this.ctx, name, replaceId)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }

  fleetPresetRename(id: string, name: string): CommandResult {
    const result = renameFleetPreset(this.state, id, name)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }

  fleetPresetDelete(id: string): CommandResult {
    const result = deleteFleetPreset(this.state, id)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }

  fleetPresetApply(id: string): CommandResult {
    const result = applyFleetPreset(this.state, this.ctx, id)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }

  fleetRangeSet(desireM: number | null, presetId?: string): CommandResult {
    const result = setFleetRange(this.state, this.ctx, desireM, presetId)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }

  battleFleetRangeSave(battle: import('@whale/core').BattleState | null | undefined): CommandResult {
    // 只接受界面正在显示且仍挂在有效宿主上的原对象，不按当前主控或宿主优先级另选一场。
    const validHost = !!battle && !battle.ended && (battle === this.state.wormhole.run?.battle
      || this.state.encounter.active && battle === this.state.encounter.battle
      || this.state.expedition.active && battle === this.state.expedition.battle)
    if (!validHost) return { ok: false, errorId: 'core.fleetRange.002' }
    const result = saveBattleFleetRange(this.state, this.ctx, battle)
    if (result.ok) { this.notify(); void this.persist() }
    return result
  }

  wormholePrepareFromTemplate(shipIds: readonly string[], request: WormholePreparationRequest, id: string) {
    const template = this.state.wormholePreparationTemplates?.find(t => t.id === id)
    return template ? wormholeTemplateFillPlan(this.state, this.ctx, shipIds, request, template) : null
  }

  async wormholeSaveTemplate(name: string, targets: Record<string, number>, replaceId?: string) {
    const result = wormholeSavePreparationTemplate(this.state, name, targets, replaceId)
    if (!result.ok) return result
    this.notify()
    return { ...result, saved: await this.persist() }
  }

  async wormholeRenameTemplate(id: string, name: string) {
    const result = wormholeRenamePreparationTemplate(this.state, id, name)
    if (!result.ok) return result
    this.notify()
    return { ...result, saved: await this.persist() }
  }

  async wormholeDeleteTemplate(id: string) {
    const result = wormholeDeletePreparationTemplate(this.state, id)
    if (!result.ok) return result
    this.notify()
    return { ...result, saved: await this.persist() }
  }

  wormholeEventPreview(action: import('@whale/core').WormholeEventAction): import('@whale/core').WormholeEventPreview {
    return wormholeEventPreview(this.state, this.ctx, action)
  }

  wormholeEventActions(): readonly import('@whale/core').WormholeEventAction[] {
    return wormholeEventActions(this.state)
  }

  wormholeEventView() { return wormholeEventView(this.state, this.ctx) }
  wormholeAlertView() { return wormholeAlertView(this.state) }
  wormholeEncounterView(cellKey?: string, role?: 'ordinary' | 'guard') { return wormholeEncounterView(this.state, this.ctx, cellKey, role) }
  wormholeChangeGoal(goal: import('@whale/core').WormholeExpeditionGoal): boolean {
    const ok = wormholeChangeExpeditionGoal(this.state, goal)
    if (ok) { void this.persist(); this.notify() }
    return ok
  }

  wormholeResolveEvent(action: import('@whale/core').WormholeEventAction, expected?: import('@whale/core').WormholeEventPreview): import('@whale/core').WormholeEventPreview {
    const result = wormholeResolveEvent(this.state, this.ctx, action, expected)
    if (this.state.pendingBattleRange) { this.notify(); void this.persist() }
    if (result.ok) { void this.persist(); this.notify() }
    return result
  }

  wormholeEnterPreparedFromStock(stockId: string, shipIds: readonly string[], plan: WormholePreparationPlan, goal: import('@whale/core').WormholeExpeditionGoal = 'deep'): WormholePreparedResult {
    if (!futureWormholeEnabled()) return { ok: false, code: 'entry-blocked' }
    if (this.wormholeStock().find(s => s.id === stockId)?.expeditionRules !== 2) return { ok: false, code: 'entry-blocked' }
    const seed = this.wormholeTestEnabled() ? this.wormholeStock().find(s => s.id === stockId)?.seed ?? this.freshLayerSeed() : this.freshLayerSeed()
    const r = wormholeEnterPrepared(this.state, this.ctx, shipIds, seed, plan, stockId, { expeditionRules: 2, goal })
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  wormholeExtractionPreview(request: WormholeExtractionRequest): WormholeExtractionPlan {
    return wormholeExtractionPlan(this.state, this.ctx, request)
  }

  wormholeExtractConfirmed(plan: WormholeExtractionPlan): ReturnType<typeof wormholeConfirmExtraction> {
    const r = wormholeConfirmExtraction(this.state, this.ctx, plan)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  wormholeLeaveCargoPiece(id: string): { ok: boolean } {
    const r = wormholeLeaveHoldPiece(this.state, this.ctx, id)
    if (r.ok) { void this.persist(); this.notify() }
    return r
  }

  wormholeLeaveSupplyUnits(id: string, units: number): { ok: boolean } {
    const r = wormholeLeaveSupply(this.state, this.ctx, id, units)
    if (r.ok) { void this.persist(); this.notify() }
    return r
  }

  wormholeGroundDrop(id: string, x: number, y: number, grab: { dx: number; dy: number }): CommandResult {
    const run = this.state.wormhole.run
    const board = run ? wormholeGroundBoard(run) : undefined
    if (!board || run?.battle || wormholePendingBattleReason(this.state)) return { ok: false }
    const capacity = board.cols * (Math.max(8, ...board.placements.map((p) => p.y + p.h)) + 2)
    const r = holdDropWithGrab(board, id, x, y, capacity, grab)
    if (r.ok) { void this.persist(); this.notify() }
    return r
  }

  wormholeGroundSwap(a: string, b: string): CommandResult {
    const run = this.state.wormhole.run
    const board = run ? wormholeGroundBoard(run) : undefined
    if (!board || run?.battle || wormholePendingBattleReason(this.state)) return { ok: false }
    const r = holdSwap(board, a, b, board.cols * (Math.max(8, ...board.placements.map((p) => p.y + p.h)) + 2))
    if (r.ok) { void this.persist(); this.notify() }
    return r
  }

  wormholeStock(): Array<{
    id: string
    expeditionRules?: number
    seed: number
    depth: number
    archetype: WormholeArchetype
    family: WormholeFamily
    foundAtGameMs: number
  }> {
    return wormholeStockOf(this.state).map((x) => ({ ...x, ...wormholeStockMeta(x) }))
  }

  wormholeStockDiscard(id: string): CommandResult {
    const r = wormholeStockDiscard(this.state, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  wormholeFamilyName(family: WormholeFamily): string {
    const cardId = WORMHOLE_FAMILY_CARD[family]
    return this.ctx.anomalies.get(cardId)?.name ?? this.anomalies.find((a) => a.id === cardId)?.name ?? cardId
  }

  wormholeFamilyIntel(family: WormholeFamily): WormholeFamilyIntel {
    return wormholeFamilyIntel(family, this.ctx)
  }

  wormholeScanWindow(): number {
    return wormholeScanWindowMs(this.state, matterTechScanCut(this.state, this.ctx))
  }

  wormholeEntryGate(shipIds: readonly string[]): string | null {
    return wormholeEntryBlockReason(this.state, this.ctx, shipIds)
  }

  wormholeEntryAutoStopText(): string | null {
    return wormholeEntryAutoStops(this.state).map((a) => paramText(a.nameId)).join(tr("ui.MatterTechTab.017")) || null
  }

  wormholeEntryAutoStopList(): Array<{ kind: string; name: string; warn: boolean }> {
    return wormholeEntryAutoStops(this.state).map((a) => ({ kind: a.kind, name: paramText(a.nameId), warn: a.warn }))
  }

  wormholeShipEntryBusy(shipId: string): BusyLabel | null {
    return wormholeShipEntryBusy(this.state, shipId)
  }

  wormholeScanBlockReason(): CoreBlockReason | null {
    return wormholeScanBlockReason(this.state)
  }

  wormholeScanUnlocked(): boolean {
    return wormholeScanUnlocked(this.state)
  }

  wormholeScanStanding(): number {
    return wormholeScanStanding(this.state)
  }


  wormholeAutoRuns(): WormholeAutoRun[] {
    return wormholeAutoRunsOf(this.state)
  }

  wormholeAutoReports(): WormholeAutoReport[] {
    return wormholeAutoReportsOf(this.state)
  }

  wormholeAutoPending(): number {
    return wormholeAutoUnconfirmedCount(this.state)
  }

  wormholeAutoCandidates(exclude?: readonly string[]): WormholeAutoCandidate[] {
    return wormholeAutoCandidates(this.state, this.ctx, exclude)
  }

  wormholeAutoBlockReason(stockId: string, shipIds?: readonly string[], mainMayJoin = false): CoreBlockReason | null {
    return wormholeAutoBlockReason(this.state, this.ctx, stockId, shipIds, { mainMayJoin })
  }

  wormholeAutoMainHandover(shipIds: readonly string[]): WormholeAutoHandover {
    return wormholeAutoMainHandover(this.state, this.ctx, shipIds)
  }

  wormholeAutoCores(): { free: number; cap: number } {
    return { free: wormholeAutoFreeCores(this.state, this.ctx), cap: aiCoreCap(this.state, this.ctx) }
  }

  async wormholeAutoStart(stockId: string, shipIds: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    if (this.wormholeStock().find(s => s.id === stockId)?.expeditionRules !== undefined) return { ok: false, code: 'unsupported-rules', errorId: 'core.signalDispatch.005' }
    if (this.signalAutoComputing) return { ok: false, errorId: 'core.signalDispatch.006' }
    if (signal?.aborted) return { ok: false, errorId: 'core.signalDispatch.001' }
    if (this.stopped) return { ok: false, errorId: 'core.signalDispatch.007' }
    const handover = this.wormholeAutoMainHandover(shipIds)
    if (handover.reason) return { ok: false, errorId: handover.reasonId, error: handover.reason, errorParams: handover.reasonParams }
    const blocked = this.wormholeAutoBlockReason(stockId, shipIds, handover.needed)
    if (blocked) return { ok: false, ...blocked }
    const stock = this.wormholeStock().find(row => row.id === stockId)!
    const sourceState = this.state, sourceCtx = this.ctx, leader = this.state.shipId
    const inputKey = signalAutoInputKey(sourceState, sourceCtx, shipIds, stock)
    const controller = new AbortController()
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    this.signalAutoController = controller
    this.signalAutoComputing = true
    try {
      const computed = await computeSignalAuto(sourceState, stockId, shipIds, controller.signal,
        () => this.createSignalAutoWorker())
      if (controller.signal.aborted) return { ok: false, errorId: 'core.signalDispatch.001' }
      if (this.stopped) return { ok: false, errorId: 'core.signalDispatch.007' }
      if (this.state !== sourceState || this.ctx !== sourceCtx || this.state.shipId !== leader)
        return { ok: false, errorId: 'core.signalDispatch.008' }
      if ('failure' in computed) return computed.failure
      const currentHandover = this.wormholeAutoMainHandover(shipIds)
      if (currentHandover.reason) return { ok: false, error: currentHandover.reason, errorId: currentHandover.reasonId, errorParams: currentHandover.reasonParams }
      if (currentHandover.toId !== handover.toId) return { ok: false, errorId: 'core.signalDispatch.009' }
      const result = wormholeAutoStart(this.state, this.ctx, stockId, shipIds, undefined, { inputKey, estimate: computed.estimate })
      if (result.ok) { void this.persist(); this.notify() }
      return result
    } finally {
      signal?.removeEventListener('abort', cancel)
      this.signalAutoController = null
      this.signalAutoComputing = false
    }
  }

  wormholeAutoStartPrepared(stockId: string, shipIds: readonly string[], plan: WormholePreparationPlan, goal: import('@whale/core').WormholeExpeditionGoal = 'deep'): CommandResult {
    if (!futureWormholeEnabled()) return { ok: false }
    if (this.wormholeStock().find(s => s.id === stockId)?.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
    const result = wormholeAutoStart(this.state, this.ctx, stockId, shipIds, { prepared: plan, confirmLossRisk: true, goal })
    if (result.ok) { void this.persist(); this.notify() }
    return result
  }

  wormholeAutoStop(runId: string): CommandResult {
    const r = wormholeAutoStop(this.state, runId, this.ctx)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  wormholeAutoConfirm(reportId: string): CommandResult {
    const r = wormholeAutoConfirmReport(this.state, reportId)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  wormholeAutoConfirmAll(): number {
    const n = wormholeAutoConfirmAll(this.state)
    if (n > 0) {
      void this.persist()
      this.notify()
    }
    return n
  }

  wormholeLeave(): void {    wormholeLeave(this.state)
    void this.persist()
    this.notify()
  }

  wormholeResume(): CommandResult {
    const r = wormholeResume(this.state, this.ctx)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }
  wormholeAckSettle(): void {
    if (this.state.wormhole.lastSettle === undefined) return
    delete this.state.wormhole.lastSettle
    void this.persist()
    this.notify()
  }

  wormholeTakePile(pileIndex: number): CommandResult {
    const r = wormholeTakePileAt(this.state, this.ctx, pileIndex)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  private wormholeTickNow(): void {
    if (!this.state.wormhole.run) return
    advanceWormhole(this.state, this.ctx)
  }
  wormholeScan(): CommandResult {
    const r = wormholeGridScan(this.state, this.ctx)
    if (r.ok) {
      this.wormholeTickNow()
      void this.persist()
      this.notify()
    }
    return {
      ok: r.ok,
      error: r.error,
      code: r.code,
      dispersed: r.dispersed?.length ?? 0,
      newlyFogged: r.newlyFogged ?? 0,
      exitScanned: r.exitScanned === true,
    }
  }

  wormholeTravel(q: number, r: number, confirmUnknown = false, confirmIntercept = false, confirmLeaveCargo = false): CommandResult {
    const snapshot = structuredClone(this.state)
    const preview = wormholeTravelTo(snapshot, this.ctx, { q, r }, { confirmUnknown, confirmIntercept, deferAmbush: true, confirmLeaveCargo })
    if (preview.ok && snapshot.wormhole.run?.battle && !this.state.wormhole.run?.battle) {
      return this.withWormholeAmmoWarning(`travel:${q}:${r}:${confirmUnknown}:${confirmIntercept}:${confirmLeaveCargo}`, () => this.wormholeTravelReady(q, r, confirmUnknown, confirmIntercept, confirmLeaveCargo))
    }
    return this.wormholeTravelReady(q, r, confirmUnknown, confirmIntercept, confirmLeaveCargo)
  }

  private wormholeTravelReady(q: number, r: number, confirmUnknown: boolean, confirmIntercept: boolean, confirmLeaveCargo: boolean): CommandResult {
    const res = wormholeTravelTo(
      this.state,
      this.ctx,
      { q, r },
      { confirmUnknown, confirmIntercept, deferAmbush: true, confirmLeaveCargo },
    )
    if (this.state.pendingBattleRange) { this.notify(); void this.persist() }
    if (res.ok) {
      this.wormholeTickNow()
      void this.persist()
      this.notify()
    }
    return {
      ok: res.ok,
      error: res.error,
      code: res.code,
      ...(res.autoBattle ? { autoBattle: true } : {}),
      ...(res.beacon ? { beacon: true } : {}),
      ...(res.intercepted ? { intercepted: res.intercepted } : {}),
      ...(res.ambush ? { ambush: true } : {}),
      ...(res.pendingBattle ? { pendingBattle: res.pendingBattle } : {}),
    }
  }

  wormholeActivate(): CommandResult {
    const snapshot = structuredClone(this.state)
    const preview = wormholeActivateAt(snapshot, this.ctx, undefined, { deferRuinsBattle: true })
    if (preview.ok && snapshot.wormhole.run?.battle && !this.state.wormhole.run?.battle) {
      return this.withWormholeAmmoWarning('activate', () => this.wormholeActivateReady())
    }
    return this.wormholeActivateReady()
  }

  private wormholeActivateReady(): CommandResult {
    const r = wormholeActivateAt(this.state, this.ctx, undefined, { deferRuinsBattle: true })
    if (this.state.pendingBattleRange) { this.notify(); void this.persist() }
    if (r.ok) {
      this.wormholeTickNow()
      void this.persist()
      this.notify()
    }
    return {
      ok: r.ok,
      error: r.error,
      ...(r.taken !== undefined ? { taken: r.taken } : {}),
      ...(r.pendingBattle ? { pendingBattle: r.pendingBattle } : {}),
    }
  }

  wormholeHoldCompact(): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdCompact(run.hold, wormholeHoldCapacityOf(this.state, this.ctx))
    if (r.moved > 0 || r.unplaced.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, error: r.unplaced.length > 0 ? tr("ui.engine.040", { p1: r.unplaced.length }) : undefined }
  }


  wormholeHoldDropAt(id: string, x: number, y: number, grab: { dx: number; dy: number }): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdDropWithGrab(run.hold, id, x, y, wormholeHoldCapacityOf(this.state, this.ctx), grab)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }
  wormholeHoldSwap(idA: string, idB: string): CommandResult {
    const run = this.state.wormhole.run
    if (!run?.hold) return { ok: false, error: tr("ui.engine.039") }
    const r = holdSwap(run.hold, idA, idB, wormholeHoldCapacityOf(this.state, this.ctx))
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }
  wormholeDiscardHold(placementId: string, units?: number): CommandResult {
    const r = wormholeHoldDiscard(this.state, this.ctx, placementId, units)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  wormholeDiscardCargo(itemId: string, units?: number): CommandResult {
    const r = wormholeDiscardCargo(this.state, this.ctx, itemId, units)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  wormholeDiscardToFit(): CommandResult {
    const r = wormholeDiscardToFit(this.state, this.ctx)
    if (r.dropped.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: r.dropped.length > 0, error: r.dropped.length > 0 ? undefined : tr("ui.engine.041") }
  }

  wormholeHoldInfo(): {
    used: number
    capacity: number
    cargoCells: number
    shapeCells: number
    unplacedCells: number
    overload: boolean
  } {
    return wormholeHoldUsage(this.state, this.ctx)
  }

  wormholeActionBlocked(): string | null {
    return wormholeActionBlockReason(this.state, this.ctx)
  }

  wormholeLayerBlocked(): CoreBlockReason | null {
    return wormholePendingBattleReason(this.state)
  }

  wormholeTempInfo(): { cells: number; capacity: number; placements: WormholeHoldPlacement[]; full: boolean } {
    return wormholeTempUsage(this.state, this.ctx)
  }

  wormholeTempPending(): { count: number; cells: number; placements: WormholeHoldPlacement[] } {
    return wormholeTempPending(this.state, this.ctx)
  }

  wormholeTempStow(id: string): CommandResult {
    const r = wormholeTempStowPiece(this.state, this.ctx, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }


  wormholeTempStowAll(): { ok: boolean; moved: number; stuck: string[] } {
    const r = wormholeTempStowAll(this.state, this.ctx)
    if (r.moved > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: r.stuck.length === 0, moved: r.moved, stuck: r.stuck }
  }

  wormholeTempDiscardAll(): { ok: boolean; moved: number } {
    const r = wormholeTempDiscardAll(this.state, this.ctx)
    if (r.moved > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, moved: r.moved }
  }

  wormholeBoardTransfer(
    from: 'hold' | 'temp',
    to: 'hold' | 'temp',
    id: string,
    x?: number,
    y?: number,
    grab?: { dx: number; dy: number },
  ): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: tr("ui.engine.042") }
    if (run.supplyVersion === 1) {
      if (from === to) return { ok: false }
      const r = from === 'hold' ? wormholeLeaveHoldPiece(this.state, this.ctx, id, x, y, grab) : wormholeTempStowPiece(this.state, this.ctx, id, x, y, grab)
      if (r.ok) { void this.persist(); this.notify() }
      return r
    }
    run.hold = run.hold ?? makeHoldState()
    const holdCap = wormholeHoldCapacityOf(this.state, this.ctx)
    const src = from === 'hold' ? run.hold : wormholeTempBoard(run)
    const dst = to === 'hold' ? run.hold : wormholeTempBoard(run)
    if (src === dst) return { ok: false, error: tr("ui.engine.043") }
    const r = holdTransferTo(src, dst, id, to === 'hold' ? holdCap : WORMHOLE_TEMP_CELLS, x, y, grab)
    if (r.ok) {
      wormholeSyncMatterTurns(this.state, this.ctx)
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  wormholeTempCompact(): CommandResult {
    const run = this.state.wormhole.run
    if (run?.supplyVersion === 1) {
      const board = wormholeGroundBoard(run)
      if (!board) return { ok: false }
      holdCompact(board, Math.max(WORMHOLE_TEMP_CELLS, board.cols * (board.placements.length * 2 + 2)))
      void this.persist()
      this.notify()
      return { ok: true }
    }
    if (!run?.tempGrid) return { ok: false, error: tr("ui.engine.044") }
    const r = holdCompact(run.tempGrid, WORMHOLE_TEMP_CELLS)
    if (r.moved > 0 || r.unplaced.length > 0) {
      void this.persist()
      this.notify()
    }
    return { ok: true, error: r.unplaced.length > 0 ? tr("ui.engine.045", { p1: r.unplaced.length }) : undefined }
  }
  wormholeDescend(confirmLeaveCargo = false): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: tr("ui.engine.042") }
    const blocked = wormholeActionBlockReason(this.state, this.ctx)
    if (blocked) return { ok: false, error: blocked }
    const seed = this.wormholeTestEnabled() ? ((run.seed ?? 1) * 1664525 + run.depth * 1013904223) >>> 0 : this.freshLayerSeed()
    const r = wormholeDescend(this.state, seed, wormholeScanBonusOf(this.ctx, run.fleet), { confirmLeaveCargo })
    if (r.ok) wormholeFreezeEvents(this.state, this.ctx)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error, code: r.code }
  }

  wormholeExtract(): CommandResult {
    const run = this.state.wormhole.run
    if (!run) return { ok: false, error: tr("ui.engine.042") }
    if (run.supplyVersion === 1) return { ok: false, code: 'cargo-pending' }
    const blocked = wormholeActionBlockReason(this.state, this.ctx)
    if (blocked) return { ok: false, error: blocked }
    const pending = wormholeTempPending(this.state, this.ctx)
    if (pending.count > 0) {
      return {
        ok: false,
        error: tr("ui.engine.046", { p1: pending.count }),
      }
    }
    const r = wormholeExtract(run)
    if (r.ok) {
      advanceWormhole(this.state, this.ctx)
      void this.persist()
      this.notify()
    }
    return { ok: r.ok, error: r.error }
  }

  wormholeFight(kind: 'node' | 'boss' | 'ruins'): CommandResult {
    return this.withWormholeAmmoWarning(`fight:${kind}`, () => this.wormholeFightReady(kind), snapshot => wormholeStartBattle(snapshot, this.ctx, kind))
  }

  private withWormholeAmmoWarning(key: string, action: () => CommandResult, preflight?: (snapshot: GameState) => CommandResult): CommandResult {
    const run = this.state.wormhole.run
    const supplies = run?.supplyVersion === 1 ? run.supplies?.items ?? {} : undefined
    return this.withBattleAmmoWarning(`wormhole:${run?.seed ?? ''}:${run?.depth ?? 0}:${JSON.stringify(run?.grid?.pos)}:${key}`, run?.fleet ?? [], action, supplies, preflight, true)
  }

  private wormholeFightReady(kind: 'node' | 'boss' | 'ruins'): CommandResult {
    const r = wormholeStartBattle(this.state, this.ctx, kind)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  wormholeDebugReset(): void {
    wormholeDebugReset(this.state)
    void this.persist()
    this.notify()
  }


  setDebugQuick(on: boolean): void {
    this.state.debugQuick = on
    void this.persist()
    this.notify()
  }

  debugFastForward(awayMs: number): void {
    const ms = Math.floor(awayMs)
    if (!Number.isFinite(ms) || ms <= 0) return
    const wallBase = this.state.savedAtWallMs > 0 ? this.state.savedAtWallMs : Date.now()
    const before = snapshotBasics(this.state)
    const { overflowMs } = offlineSplit(ms, offlineCapMsOf(this.state))
    const stats = newSettleStats()
    simulateOffline(this.state, wallBase, wallBase + ms, this.ctx, undefined, { freezeBattle: true, stats, onUnboxResult: this.onUnboxResult, onStationActivityStarted: this.onStationActivityStarted })
    this.state.savedAtWallMs = wallBase + ms
    const stepMs = 3_600_000
    const endAt = wallBase + ms
    for (let at = Math.min(wallBase + stepMs, endAt); ; at = Math.min(at + stepMs, endAt)) {
      this.pumpWeekendAt(at, at - stepMs)
      if (at >= endAt) break
    }
    this.offlineReport = buildOfflineReport(before, this.state, this.ctx, ms, overflowMs, stats)
    void this.persist()
    this.notify()
  }

  battleSetDesireAt(desireM: number, persist = false): CommandResult {
    const result = setBattleDesire(this.state, desireM, this.ctx)
    if (result.ok) {
      if (persist) void this.persist()
      this.notify()
    }
    return result
  }

  battleRangePending() { return pendingBattleRangeView(this.state, this.ctx) }
  confirmBattleRange(desireM: number): CommandResult {
    const intent = this.state.pendingBattleRange?.intent
    const result = confirmBattleRange(this.state, this.ctx, desireM, this.wallNowOf())
    if (result.ok && intent?.kind === 'expedition') this.autoSortie = intent.autoRepair === true
    this.notify()
    void this.persist()
    return result
  }
  cancelBattleRange(): void {
    cancelBattleRange(this.state)
    this.notify()
    void this.persist()
  }

  changeShipAt(shipId: string): CommandResult {
    const result = changeShip(this.state, shipId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  startHaulingAt(aSiteId: string | null, bSiteId: string | null, requestedM3?: number): CommandResult {
    const result = startHauling(this.state, aSiteId, bSiteId, this.ctx, requestedM3)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  stopHaulingNow(): CommandResult {
    const result = stopHauling(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  stopHaulingAtArrival(): void {
    if (this.state.hauling.fleetLeg) {
      this.state.hauling.fleetLeg.stopAtArrival = true
      void this.persist()
      this.notify()
    }
  }

  cancelPendingStationActivityNow(): boolean {
    const result = cancelPendingStationActivity(this.state)
    if (result) { void this.persist(); this.notify() }
    return result
  }

  lockShipAt(shipId: string, locked: boolean): CommandResult {
    const result = lockShip(this.state, shipId, locked, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  toggleMarkAt(kind: MarkKind, id: string): CommandResult {
    const result = toggleMark(this.state, this.ctx, kind, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  renameShipAt(shipId: string, name: string | null): CommandResult {
    const result = renameShip(this.state, shipId, name)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  flyHomeNow(): CommandResult {
    const result = startTransitHome(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }



  goStandbyAt(galaxyId: string): CommandResult {
    return this.withActivitySwitch('standby', () => {
      const result = goStandbyAt(this.state, galaxyId, this.ctx)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  recallStandbyNow(): CommandResult {
    const result = cancelStandby(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  fightEncounterNow(): CommandResult {
    return this.withBattleAmmoWarning(`encounter:${this.state.encounter.invitedAtGameMs}`, encounterCombatRosterOf(this.state), () => this.fightEncounterReady(), undefined,
      snapshot => fightEncounter(snapshot, this.ctx))
  }

  private fightEncounterReady(): CommandResult {
    const result = fightEncounter(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  fleeEncounterNow(): CommandResult {
    const result = fleeEncounter(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
  retreatNow(): CommandResult {
    const result = weekendFlagshipBattleActive(this.state)
      ? retreatEncounterBattle(this.state, this.ctx)
      : retreatBattle(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  bountyLoopAt(anomalyId: string | null): CommandResult {
    if (anomalyId === null) return this.bountyLoopReady(null)
    return this.withBattleAmmoWarning(`bounty-loop:${anomalyId}`, combatRosterOf(this.state), () => this.bountyLoopReady(anomalyId), undefined,
      snapshot => setAutoLoopBounty(snapshot, this.ctx, anomalyId))
  }

  private bountyLoopReady(anomalyId: string | null): CommandResult {
    const result = setAutoLoopBounty(this.state, this.ctx, anomalyId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  invasionLoopAt(galaxyId: string | null): CommandResult {
    if (galaxyId === null) return this.invasionLoopReady(null)
    return this.withBattleAmmoWarning(`invasion-loop:${galaxyId}`, combatRosterOf(this.state), () => this.invasionLoopReady(galaxyId), undefined,
      snapshot => setAutoLoopInvasion(snapshot, this.ctx, galaxyId, this.wallNowOf()))
  }

  private invasionLoopReady(galaxyId: string | null): CommandResult {
    const result = setAutoLoopInvasion(this.state, this.ctx, galaxyId, this.wallNowOf())
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  deliverSiteAt(siteId: string, itemId: string, units: number): CommandResult {
    const result = deliverStationResources(this.state, this.ctx, siteId, itemId, units)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  deliverTripAt(siteId: string): CommandResult {
    const result = startSiteDeliverTrip(this.state, this.ctx, siteId)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  cancelDeliverTripNow(): CommandResult {
    const result = cancelSiteDeliverTrip(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  openDialogue(scriptId: string): CommandResult {
    const script = DIALOGUES.find((d) => d.id === scriptId)
    if (!script) return { ok: false, error: tr("ui.engine.047", { scriptId: scriptId }) }
    playDialogue(this.state, scriptId, this.ctx, script.lines)
    void this.persist()
    this.notify()
    return { ok: true }
  }


  commsInboxView(): ReturnType<typeof commsInbox> {
    return commsInbox(this.state, this.ctx)
  }

  wreckLogView(): ReturnType<typeof wreckLogRowsOf> {
    return wreckLogRowsOf(this.state, this.ctx)
  }


  commsPopups(): string[] {
    return commsPopupQueue(this.state)
  }

  dismissCommsPopup(id: string): void {
    if (!dismissCommsPopup(this.state, id)) return
    void this.persist()
    this.notify()
  }

  commsUnread(): number {
    return commsUnreadCount(this.state, this.ctx)
  }

  markCommsReadAt(id: string): CommandResult {
    const r = markCommsRead(this.state, id)
    if (r.ok) {
      void this.persist()
      this.notify()
    }
    return r
  }

  markAllCommsReadNow(): number {
    const n = markAllCommsRead(this.state, this.ctx)
    if (n > 0) {
      void this.persist()
      this.notify()
    }
    return n
  }


  sideTasksView(): ReturnType<typeof sideTaskBoard> {
    return sideTaskBoard(this.state, this.ctx, Date.now())
  }

  bountyNewCount(): number {
    return sideTaskBoard(this.state, this.ctx, Date.now()).bountyNewCount
  }

  markBountyBoardSeen(): void {
    sideTasksMarkBountySeen(this.state)
  }

  firstTaskNotice(): { taskId: string; title: string; ready: boolean } | null {
    return firstTaskNotice(this.state)
  }

  markFirstTaskSeen(): void {
    firstTasksMarkSeen(this.state)
  }


  claimChainRewardAt(chainId: string): number {
    const isk = claimChainRewardCore(this.state, chainId)
    if (isk > 0) {
      void this.persist()
      this.notify()
    }
    return isk
  }

  completeSideTaskAt(kind: SideTask['kind'], id: number): CommandResult {
    const result = completeSideTask(this.state, this.ctx, kind, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  startCourierDeliveryAt(id: number): CommandResult {
    return this.withActivitySwitch('deliver', () => {
      const result = startCourierDelivery(this.state, this.ctx, id)
      if (result.ok) {
        void this.persist()
        this.notify()
      }
      return result
    })
  }

  cargoCapacityM3(): number {
    return cargoCapacityM3(this.state, this.ctx)
  }

  warpSpeedOfCurrent(): number {
    return warpSpeedAus(this.state, this.ctx, this.state.shipId)
  }

  acceptCourierAt(id: number): CommandResult {    const result = acceptCourierTask(this.state, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  abandonAcceptedCourierAt(id: number): CommandResult {
    const result = abandonAcceptedCourierTask(this.state, id)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }




  setAutoCycleAt(autoCycle: boolean): void {
    setMiningAutoCycle(this.state, autoCycle)
    void this.persist()
    this.notify()
  }

  setStopAfterTripAt(stop: boolean): void {
    setMiningStopAfterTrip(this.state, stop)
    void this.persist()
    this.notify()
  }

  setSalvageAutoCycleAt(autoCycle: boolean): void {
    setSalvageAutoCycle(this.state, autoCycle)
    void this.persist()
    this.notify()
  }

  setSalvageStopAfterTripAt(stop: boolean): void {
    setSalvageStopAfterTrip(this.state, stop)
    void this.persist()
    this.notify()
  }

  unloadAllToWarehouse(): number {
    const moved = unloadCargoToWarehouse(this.state, this.ctx)
    if (moved > 0) {
      void this.persist()
      this.notify()
    }
    return moved
  }

  unloadShipAllToWarehouse(shipId: string): number {
    if (!this.state.fleet[shipId]) return -1
    if (shipOperationBlockReason(this.state, this.ctx, shipId, 'cargo')) return -2
    if (shipId in this.state.aiAssignments) return -2
    if (shipId in this.state.shipReturns) return -3
    const moved = unloadShipCargo(this.state, this.ctx, shipId)
    if (moved > 0) {
      void this.persist()
      this.notify()
    }
    return moved
  }

  unloadCargoItem(itemId: string): number {
    const moved = unloadCargoToWarehouse(this.state, this.ctx, itemId)
    if (moved > 0) {
      void this.persist()
      this.notify()
    }
    return moved
  }

  loadWareToCargoFit(itemId: string): number {
    const loaded = loadWarehouseToCargoFit(this.state, itemId, this.ctx)
    if (loaded > 0) {
      void this.persist()
      this.notify()
    }
    return loaded
  }

  sellCargo(itemId: string, qty?: number): SellResult {
    const result =
      qty === undefined ? sellCargoItem(this.state, itemId, this.ctx) : sellCargoItemQty(this.state, itemId, qty, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  sellWare(itemId: string, qty?: number): SellResult {
    const result =
      qty === undefined ? sellWareItem(this.state, itemId, this.ctx) : sellWareItemQty(this.state, itemId, qty, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  discardWare(itemId: string, qty: number): { ok: boolean; dropped: number; error?: string } {
    const result = discardWareQty(this.state, itemId, qty, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  repairShipAt(shipId: string): CommandResult {
    const result = repairShip(this.state, shipId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  fleetRepairPlan(): ReturnType<typeof fleetRepairPlanCore> {
    return fleetRepairPlanCore(this.state, this.ctx)
  }

  repairFleetAt(): ReturnType<typeof repairFleet> {
    const result = repairFleet(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  useRepairKitNow(): CommandResult {
    const result = useOneRepairKit(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  useSynapticAccelerantNow(): CommandResult {
    const result = useSynapticAccelerant(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  synapticAccelerantRemainMs(): number {
    return synapticAccelerantRemainMs(this.state)
  }

  boostAutoRenewOn(): boolean {
    return boostAutoRenewOn(this.state)
  }

  setBoostAutoRenewNow(on: boolean): CommandResult {
    const result = setBoostAutoRenew(this.state, on)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  noCommonWreckSalvageOn(): boolean {
    return noCommonWreckSalvageOn(this.state)
  }

  setNoCommonWreckSalvageNow(on: boolean): CommandResult {
    const result = setNoCommonWreckSalvage(this.state, on)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  useInvasionBeaconNow(opts: { familyId?: string; galaxyId?: string; itemId?: string } = {}): CommandResult {
    const result = useInvasionBeacon(this.state, this.ctx, opts)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }


  buyBasicCoreAt(): CommandResult {
    const result = buyBasicAiCore(this.state, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  assignAiMiningAt(shipId: string, coreType: AiCoreType, beltId: string): CommandResult {
    const result = assignAiMining(this.state, shipId, coreType, beltId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  assignAiExpeditionAt(shipId: string, coreType: AiCoreType, anomalyId: string): CommandResult {
    return this.withBattleAmmoWarning(`ai-expedition:${shipId}:${coreType}:${anomalyId}`, [shipId], () => this.assignAiExpeditionReady(shipId, coreType, anomalyId), undefined,
      snapshot => assignAiExpedition(snapshot, shipId, coreType, anomalyId, this.ctx))
  }

  private assignAiExpeditionReady(shipId: string, coreType: AiCoreType, anomalyId: string): CommandResult {
    const result = assignAiExpedition(this.state, shipId, coreType, anomalyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  assignAiSalvageAt(shipId: string, coreType: AiCoreType, galaxyId: string): CommandResult {
    const result = assignAiSalvage(this.state, shipId, coreType, galaxyId, this.ctx)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  cancelAiTaskAt(shipId: string): boolean {
    const ok = cancelAiTask(this.state, shipId, this.ctx)
    if (ok) {
      void this.persist()
      this.notify()
    }
    return ok
  }

  async resetGame(ironman = false): Promise<void> {
    this.state = createInitialState({ prologue: true })
    if (ironman) {
      let ledgerSeq = 0
      try {
        const ledger = await saveBridge.ironmanLedger()
        if (ledger.ok) ledgerSeq = ledger.seq
      } catch {
        ledgerSeq = 0
      }
      enterIronman(this.state, Date.now(), ledgerSeq)
    }
    this.offlineReport = null
    void this.persist()
    this.notify()
  }

  prologueAwaken(name: string): CommandResult {
    const n = (name ?? '').trim()
    this.state.character.name = n.length > 0 ? n.slice(0, 12) : 'PRTS'
    const result = beginAfterAwaken(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }

  prologueSkip(): CommandResult {
    const result = skipPrologue(this.state)
    if (result.ok) {
      void this.persist()
      this.notify()
    }
    return result
  }
}
