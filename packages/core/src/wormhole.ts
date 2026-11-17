import { ceilFinalQuantity } from './quantity'
import { beginDeparture, departureOrigin } from './departure'
import { bumpFirst, peakFirst } from './firstTasks'
import { type BusyLabel } from './busyLabels'
import type { GameState, BattleState, WormholeArchetype, WormholeFamily } from './state'
import type { CommandResult, CoreBlockReason } from './engine'
import { addLog, haltActivityForSwitch, haulingHalt, miningHalt, salvageHalt, wormholeScanHalt } from './state'
import {
  gateMainActivityHandoff,
  KIND_LABEL,
  ACTIVITY_LABEL_ID,
  logAutoHalt,
  mainActivityOf,
  type MainActivityKind,
} from './activityGate'
import type { SimContext } from './types'
import { uidDefId } from './labels'
import { cargoCapacityM3Of } from './inventory'
import { WORMHOLE_SLOT_M3 } from './wormholeHold'
import { wormholeGroundPending } from './wormholeGround'
import { shipDisplayName } from './instances'
import {
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeFamilyOfSeed,
} from './wormholeFoes'
import { WORMHOLE_SPAWN_MIN_DEPTH, wormholeArchetypeOf } from './wormholeGrid'
import {
  WORMHOLE_NEBULA_MIN_DEPTH,
  WORMHOLE_TURN_PER_MOVE,
  WORMHOLE_TURN_PER_SCAN,
  WORMHOLE_SCAN_RADIUS_BASE,
  disperseNebulae,
  gridCellAt,
  hasLiveFoe,
  gridNebulaDisperseTargets,
  gridScanTargets,
  hexKey,
  isExitCell,
  isNebulaFogged,
  markExitKnown,
  revealNearestMatterCell,
  signalOfCell,
  wormholeMakeGrid,
  wormholePathInterceptAt,
} from './wormholeGrid'
import type { HexCell, WormholeGridCell, WormholeGridState, WormholePlace, WormholeSignal } from './wormholeGrid'
import { wormholeMatterBuffs } from './wormholeMatter'
import { wormholeSpawnAfterTurns } from './wormholeSpawn'
import { matterTechWhBuffs } from './matterTech'
import { wormholePatrolAfterAction, wormholePatrolLayerReset } from './wormholePatrol'
import { commandBudgetOf } from './combat/command/rules'

import { wormholeStepCost, WORMHOLE_ADMISSION_TEXT, wormholeAdmission } from './wormhole/fleet/admission'
export { WORMHOLE_MASS_BY_TIER, WORMHOLE_MAX_TIER, WORMHOLE_TOTAL_MASS_CAP, WORMHOLE_MAX_SHIPS, wormholeShipAllowed, wormholeShipMass, WORMHOLE_TURN_BASE, WORMHOLE_TURN_MASS_COEF, wormholeTurnBudget, WORMHOLE_TURN_PER_NODE, WORMHOLE_TURN_PER_EXTRA_WAVE, WORMHOLE_TURN_PER_PICKUP, wormholeStepCost, WORMHOLE_ADMISSION_TEXT, wormholeAdmission } from './wormhole/fleet/admission'
export type { WormholeAdmission, WormholeAdmissionCode } from './wormhole/fleet/admission'


export { WORMHOLE_SLOT_M3 } from './wormholeHold'

export function wormholeBagSlots(cargoTotalM3: number): number {
  return Math.max(0, Math.floor(cargoTotalM3 / WORMHOLE_SLOT_M3))
}

export function wormholeUnitsPerSlot(unitM3: number): number {
  if (!(unitM3 > 0)) return 0
  return Math.floor(WORMHOLE_SLOT_M3 / unitM3)
}

export function wormholeSlotsUsed(unitM3: number, units: number): number {
  const per = wormholeUnitsPerSlot(unitM3)
  if (per <= 0) return Number.POSITIVE_INFINITY
  return Math.ceil(Math.max(0, units) / per)
}

export interface WormholeBagSlot {
  itemId: string
  units: number
}

export function wormholeTrimBag(
  ctx: SimContext,
  bag: readonly WormholeBagSlot[],
  capacity: number,
  valueOf?: (slot: WormholeBagSlot) => { tier: number; iskPerSlot: number },
): { bag: WormholeBagSlot[]; dropped: WormholeBagSlot[] } {
  const slots = bag.map((s) => ({ ...s }))
  const perOf = (itemId: string): number => wormholeUnitsPerSlot(ctx.items.get(itemId)?.unitM3 ?? 0)
  const valuePerSlot = (s: WormholeBagSlot): { tier: number; isk: number } => {
    const def = ctx.items.get(s.itemId)
    const per = perOf(s.itemId)
    if (!def || per <= 0) return { tier: Number.POSITIVE_INFINITY, isk: Number.POSITIVE_INFINITY }
    if (valueOf) return { tier: valueOf(s).tier, isk: valueOf(s).iskPerSlot }
    return { tier: 1, isk: per * Math.max(0, def.baseSellPriceIsk ?? 0) }
  }
  const dropped: WormholeBagSlot[] = []
  while (wormholeBagUsage(ctx, slots, capacity).used > capacity && slots.length > 0) {
    let pick = 0
    for (let i = 1; i < slots.length; i++) {
      const a = valuePerSlot(slots[i]!)
      const b = valuePerSlot(slots[pick]!)
      const worse =
        a.tier < b.tier ||
        (a.tier === b.tier && (a.isk < b.isk || (a.isk === b.isk && slots[i]!.itemId < slots[pick]!.itemId)))
      if (worse) pick = i
    }
    const slot = slots[pick]!
    const per = perOf(slot.itemId)
    const cut = per > 0 ? Math.min(slot.units, per) : slot.units
    slot.units -= cut
    const same = dropped.find((d) => d.itemId === slot.itemId)
    if (same) same.units += cut
    else dropped.push({ itemId: slot.itemId, units: cut })
    if (slot.units <= 0) slots.splice(pick, 1)
  }
  return { bag: slots, dropped }
}

export function wormholeBagUsage(
  ctx: SimContext,
  slots: readonly WormholeBagSlot[],
  capacity: number,
): { used: number; capacity: number; overflow: boolean } {
  let used = 0
  for (const s of slots) {
    const def = ctx.items.get(s.itemId)
    const per = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
    used += per > 0 ? Math.ceil(s.units / per) : capacity + 1
  }
  return { used, capacity, overflow: used > capacity }
}


export type WormholePhase = 'idle' | 'inside' | 'extracting'

export type WormholeNodeKind = 'combat' | 'pickup' | 'event'

export interface WormholeNode {
  kind: WormholeNodeKind
  waves: number
  pickups: number
  eventKey?: string
  cost: number
  piles?: WormholePile[]
}

export interface WormholeRunState {
  supplyVersion?: 1
  expeditionRules?: number
  supplies?: import('./wormholeSupplies').WormholeSupplyLedger
  groundCargo?: Record<string, import('./wormholeHold').WormholeHoldState>
  haulerFittingVersion?: 1
  phase: WormholePhase
  depth: number
  family?: WormholeFamily
  archetype?: WormholeArchetype
  nodeIndex: number
  turnsLeft: number
  turnsTotal: number
  turnsBase?: number
  turnsTechBonus?: number
  turnsSpent?: number
  pendingRuinsBattle?: boolean
  pendingNodeBattle?: boolean
  pendingEvent?: { key: import('./wormholeGrid').WormholeEventKey; cellKey: string }
  alertLevel?: number
  patrolsSpawned?: number
  patrolsCleared?: number
  patrolActionSeq?: number
  patrols?: import('./wormholePatrol').WormholePatrolState[]
  expeditionSupplyPackage?: Record<string, number>
  supplyPackagesTaken?: number
  guardSupportDisabled?: boolean
  nextBattleRangeMul?: number
  expeditionGoal?: 'deep' | 'ruins' | 'survey'
  expeditionProgress?: { peakDepth: number; guards: number; ruins: number; events: number; revealed: number; clues: number; elites: number }
  fleet: readonly string[]
  totalMass: number
  bag: WormholeBagSlot[]
  pendingNode: WormholeNode | null
  nodesPerLayer: number
  battle?: BattleState | null
  bossCleared?: number
  attending?: boolean
  leftAtGameMs?: number
  desireM?: number
  automaticBattleRanges?: true
  grid?: import('./wormholeGrid').WormholeGridState
  seed?: number
  relics?: string[]
  hold?: import('./wormholeHold').WormholeHoldState
  temp?: WormholeTempSlot[]
  tempGrid?: import('./wormholeHold').WormholeHoldState
}

export interface WormholeTempSlot {
  itemId: string
  units: number
}

export const WORMHOLE_TEMP_COLS = 4
export const WORMHOLE_TEMP_ROWS = 8
export const WORMHOLE_TEMP_CELLS = WORMHOLE_TEMP_COLS * WORMHOLE_TEMP_ROWS

export interface WormholeSettleRecord {
  suppliesFound?: Record<string, number>
  expeditionGoal?: WormholeRunState['expeditionGoal']
  expeditionProgress?: WormholeRunState['expeditionProgress']
  suppliesReturned?: Record<string, number>
  suppliesUsed?: Record<string, number>
  kind: 'extract' | 'lost'
  depth: number
  oreUnits: number
  oreIsk: number
  wreckIsk: number
  boxes: string[]
  relics: string[]
  cores?: Partial<Record<'gamma' | 'beta' | 'alpha', number>>
  coresIsk?: number
  essences?: number
  essenceIsk?: number
  shipsLost: string[]
  lostIsk: number
  skippedExtractBattle?: boolean
}

export interface WormholeState {
  run: WormholeRunState | null
  lastFleetLost: number
  lastSettle?: WormholeSettleRecord
  nebulaHintShown?: boolean
  siegeHintShown?: boolean
  noCommonWreckSalvage?: boolean
}


export {
  WORMHOLE_THREAT_BASE,
  WORMHOLE_THREAT_GROWTH,
  WORMHOLE_REWARD_GROWTH,
  WORMHOLE_THREAT_PER_LAYER,
  WORMHOLE_BOSS_THREAT_MUL,
  WORMHOLE_EXTRACT_THREAT_MUL,
  WORMHOLE_BOSS_TARGETING_CHANCE,
  WORMHOLE_EXTRACT_THREAT_BASE,
  WORMHOLE_EXTRACT_THREAT_PER_LAYER,
  WORMHOLE_FOE_CARD_IDS,
  wormholeLayerThreat,
  wormholeLayerRewardMul,
  wormholeNodesPerLayer,
  wormholeFoeThreat,
  wormholeExtractThreat,
  wormholeCardIdOfFamily,
  wormholeFamilyOfSeed,
  WORMHOLE_FAMILY_ORDER,
  WORMHOLE_FAMILY_CARD,
  WORMHOLE_FAMILY_GLYPH,
  wormholeAnomalyOf,
  wormholeNaturalHp,
  wormholeCardThreatMul,
  wormholeCardThreatOf,
  wormholeBranchNaturalHp,
  wormholeSkippedBranch,
  wormholeCardIdForRun,
  wormholeCardOfTier,
  wormholeTierOfCard,
  wormholeAllCardIds,
  wormholeCardPoolAt,
  wormholeGuardCardOf,
  wormholeTierWeightsAt,
  WORMHOLE_FAMILY_CARDS,
  WORMHOLE_CARD_TIERS,
  WORMHOLE_TIER_LABEL,
  WORMHOLE_TIER_UNLOCK_DEPTH,
  WORMHOLE_TIER_THREAT_MUL,
  WORMHOLE_FAMILY_TARGETING,
  WORMHOLE_FAMILY_TARGETING_CHANCE,
  WORMHOLE_DISPLAY_THREAT_MUL,
  wormholeDisplayThreat,
  WORMHOLE_FAMILY_ETHNIC,
  WORMHOLE_TIER_LABELS,
  DAMAGE_TYPE_LABELS,
  WORMHOLE_FAMILY_ETHNIC_IDS,
  DAMAGE_TYPE_LABEL_IDS,
  wormholeFamilyIntel,
} from './wormholeFoes'
export type { WormholeCardTier, WormholeFoeKind, WormholeFamilyIntel } from './wormholeFoes'

export interface WormholeStartResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  run?: WormholeRunState
}

export function wormholeStartRun(
  ctx: SimContext,
  shipIds: readonly string[],
  rngSeed: number,
  blankShareFactor = 1,
  techTurnBonus = 0,
  expeditionRules?: number,
): WormholeStartResult {
  const adm = wormholeAdmission(ctx, shipIds, techTurnBonus)
  if (!adm.ok) return { ok: false, error: WORMHOLE_ADMISSION_TEXT[adm.code] }
  const depth = 1
  return {
    ok: true,
    run: {
      haulerFittingVersion: 1,
      phase: 'inside',
      depth,
      nodeIndex: 0,
      turnsLeft: adm.turnBudget,
      turnsTotal: adm.turnBudget,
      turnsBase: adm.turnBudget - techTurnBonus,
      turnsTechBonus: techTurnBonus,
      fleet: [...shipIds],
      totalMass: adm.totalMass,
      bag: [],
      pendingNode: null,
      nodesPerLayer: wormholeNodesPerLayer(depth),
      grid: wormholeMakeGrid(rngSeed, depth, wormholeScanBonusOf(ctx, shipIds), blankShareFactor, expeditionRules),
      ...(expeditionRules !== undefined ? { expeditionRules } : {}),
      seed: rngSeed,
    },
  }
}

export function wormholeMakeNode(seed: number, depth: number, index: number): WormholeNode {
  const h = Math.abs((seed * 1103515245 + (depth * 97 + index) * 12345) % 2147483647)
  const roll = h % 100
  const waves = Math.min(3, 1 + Math.floor(Math.max(0, depth - 1) / 2) + (roll % 2))
  if (index === 0) {
    return { kind: 'combat', waves, pickups: 0, cost: wormholeStepCost(waves, 0) }
  }
  if (roll < 45) {
    const pickups = 2
    return {
      kind: 'pickup',
      waves: 0,
      pickups,
      cost: wormholeStepCost(1, pickups),
      piles: wormholeNodePiles(seed, depth, index, pickups),
    }
  }
  if (roll < 80) return { kind: 'combat', waves, pickups: 0, cost: wormholeStepCost(waves, 0) }
  return {
    kind: 'event',
    waves: 0,
    pickups: 0,
    eventKey: `wh-event-${roll % 3}`,
    cost: wormholeStepCost(1, 0),
  }
}

export interface WormholeAdvanceResult {
  ok: boolean
  code?: 'cargo-pending' | 'unsupported-rules'
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  spent?: number
  atLayerEnd?: boolean
  mustExtract?: boolean
}

export function wormholeAdvanceNode(
  ctx: SimContext,
  run: WormholeRunState,
  rngSeed: number,
): WormholeAdvanceResult {
  void ctx
  const node = run.pendingNode
  if (!node) return { ok: false, error: '本层已清空：请选择「继续深入」或「撤离」。', errorId: 'core.wormhole.001' }
  if (run.turnsLeft < node.cost) {
    return { ok: false, error: '回合不足：只能撤离。', errorId: 'core.wormhole.002', mustExtract: true }
  }
  const spent = node.cost
  run.turnsLeft -= spent
  run.nodeIndex += 1
  if (run.nodeIndex >= run.nodesPerLayer) {
    run.pendingNode = null
    return { ok: true, spent, atLayerEnd: true, mustExtract: run.turnsLeft <= 0 }
  }
  run.pendingNode = wormholeMakeNode(rngSeed, run.depth, run.nodeIndex)
  return { ok: true, spent, atLayerEnd: false, mustExtract: run.turnsLeft <= 0 }
}

export function wormholeDescend(
  state: GameState,
  rngSeed: number,
  scanBonus = 0,
  opts?: { confirmLeaveCargo?: boolean },
): WormholeAdvanceResult {
  if (state.departure?.kind === 'wormhole') return { ok: false, errorId: 'core.departure.001' }
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '当前不在虫洞里。', errorId: 'core.wormhole.003' }
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  if (run.battle) return { ok: false, error: '战斗中：战斗没结束不能深入。', errorId: 'core.wormhole.004' }
  if (run.supplyVersion === 1) {
    const pending = wormholePendingBattleReasonOf(run)
    if (pending) return { ok: false, errorId: pending.errorId }
    const here = run.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
    if (here && hasLiveFoe(here)) return { ok: false, errorId: 'core.wormhole.035' }
  }
  if (run.pendingNode) return { ok: false, error: '本层战斗未结束：不能撤离、也不能深入。', errorId: 'core.wormhole.005' }
  if ((run.bossCleared ?? 0) < run.depth) {
    return { ok: false, error: '层末守卫还堵在出口：先迎击本层守卫。', errorId: 'core.wormhole.006' }
  }
  if (run.turnsLeft <= 0) return { ok: false, error: '回合已耗尽：只能撤离。', errorId: 'core.wormhole.007', mustExtract: true }
  if (run.grid && !isExitCell(run.grid, run.grid.pos)) {
    return { ok: false, error: '没站在下一层入口：先走到入口（下潜点）再深入。', errorId: 'core.wormhole.008' }
  }
  if (run.supplyVersion === 1) {
    if (Object.values(run.groundCargo ?? {}).some((board) => board.placements.length > 0) && opts?.confirmLeaveCargo !== true) {
      return { ok: false, code: 'cargo-pending' }
    }
    delete run.groundCargo
  }
  run.depth += 1
  peakFirst(state, 'whMaxDepth', run.depth)
  run.nodeIndex = 0
  run.nodesPerLayer = wormholeNodesPerLayer(run.depth)
  run.grid = wormholeMakeGrid(rngSeed, run.depth, scanBonus, blankShareFactorOf(state), run.expeditionRules)
  if (run.expeditionRules === 2) {
    delete run.pendingEvent
    delete run.guardSupportDisabled
    delete run.nextBattleRangeMul
    wormholePatrolLayerReset(run)
    if (run.expeditionProgress) run.expeditionProgress.peakDepth = Math.max(run.expeditionProgress.peakDepth, run.depth)
  }
  maybeHintNebula(state, run.depth)
  maybeHintSiege(state, run.depth)
  return { ok: true, spent: 0, atLayerEnd: false }
}

const nebulaHintedRuns = new WeakSet<object>()

function maybeHintNebula(state: GameState, depth: number): void {
  if (depth < WORMHOLE_NEBULA_MIN_DEPTH) return
  const run = state.wormhole.run
  if (run && nebulaHintedRuns.has(run)) return
  if (run) nebulaHintedRuns.add(run)
  if (state.wormhole.nebulaHintShown === true) return
  state.wormhole.nebulaHintShown = true
  state.nebulaHintNotice =
    '这一带的星云会遮蔽地点的信号：第一次扫描只能看到"有星云"，' +
    '在同一个位置再扫描一次就能把星云驱散、读出信号。'
  addLog(
    state,
    'fleet',
    '🕳 前方出现星云带：星云会遮蔽地点的信号——第一次扫描只看到云，' +
      '再扫描一次（同一圈内）即可驱散并读出信号。',
  )
}

function maybeHintSiege(state: GameState, depth: number): void {
  if (state.wormhole.run?.expeditionRules === 2) return
  if (depth < WORMHOLE_SPAWN_MIN_DEPTH) return
  if (state.wormhole.siegeHintShown === true) return
  state.wormhole.siegeHintShown = true
}

export function wormholeOutOfTurns(run: WormholeRunState): boolean {
  if (run.turnsLeft <= 0) return true
  return run.pendingNode !== null && run.turnsLeft < run.pendingNode.cost
}

export function wormholeExtract(run: WormholeRunState, opts?: { confirmLeaveCargo?: boolean }): WormholeAdvanceResult {
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  if (run.battle) return { ok: false, error: '战斗中：战斗没结束不能撤退。', errorId: 'core.wormhole.009' }
  if (run.supplyVersion === 1) {
    const pending = wormholePendingBattleReasonOf(run)
    if (pending) return { ok: false, errorId: pending.errorId }
    const here = run.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
    if (here && hasLiveFoe(here)) return { ok: false, errorId: 'core.wormhole.035' }
    if (Object.values(run.groundCargo ?? {}).some((board) => board.placements.length > 0) && !opts?.confirmLeaveCargo) {
      return { ok: false, code: 'cargo-pending' }
    }
  }
  run.phase = 'extracting'
  return { ok: true }
}


export type WormholeActivateEffect =
  | { kind: 'exit'; key: string }
  | { kind: 'battle'; key: string }
  | { kind: 'salvage'; key: string; place: 'graveyard' | 'ruins' }
  | { kind: 'excavate'; key: string }
  | { kind: 'matter'; key: string }
  | { kind: 'ruinsBattle'; key: string }

export interface WormholeGridActionResult {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  code?: 'unknown-target' | 'path-blocked' | 'cargo-pending' | 'unsupported-rules'
  spent?: number
  revealed?: { key: string; signal: WormholeSignal | null }[]
  arrived?: {
    key: string
    place: WormholePlace
    signal: WormholeSignal | null
    atExit: boolean
    autoBattle?: boolean
    ambush?: true
    beacon?: boolean
    intercepted?: { target: string; known: boolean }
    eventKey?: import('./wormholeGrid').WormholeEventKey
  }
  effect?: WormholeActivateEffect
  dispersed?: string[]
  newlyFogged?: number
  exitScanned?: boolean
  mustExtract?: boolean
}

function gridRun(state: GameState): { run: WormholeRunState; grid: WormholeGridState } | null {
  const run = state.wormhole.run
  if (!run?.grid) return null
  return { run, grid: run.grid }
}

export function wormholePendingBattleReasonOf(run: WormholeRunState | undefined | null): CoreBlockReason | null {
  if (!run) return null
  if (run.pendingRuinsBattle === true) {
    return { error: '遗迹深处的守备已经惊动：先点「迎战」打完这一场。', errorId: 'core.wormhole.033' }
  }
  if (run.pendingNodeBattle === true) {
    return { error: '对方已经发现我们：先点「开战」打完这一场。', errorId: 'core.wormhole.034' }
  }
  return null
}

export function wormholePendingBattleReason(state: GameState): CoreBlockReason | null {
  return wormholePendingBattleReasonOf(state.wormhole.run)
}

function gridActionBlocked(state: GameState): CoreBlockReason | null {
  if (state.departure?.kind === 'wormhole') return { error: '正在离港', errorId: 'core.departure.001' }
  const run = state.wormhole.run!
  if (run.battle) return { error: '战斗中：先打完这一场。', errorId: 'core.wormhole.035' }
  const here = run.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  if (run.expeditionRules === 2 && here && hasLiveFoe(here)) return { error: '对方已经发现我们：先点「开战」打完这一场。', errorId: 'core.wormhole.034' }
  const pendingBattle = wormholePendingBattleReasonOf(run)
  if (pendingBattle) return pendingBattle
  const pending = run.tempGrid?.placements.length ?? 0
  if (run.supplyVersion !== 1 && pending > 0) {
    return {
      error: `临时空间里有 ${pending} 件没处理：先到「货仓」页放回货仓或丢弃，再继续。`,
      errorId: 'core.wormhole.036',
      errorParams: { p1: pending },
    }
  }
  return null
}

export function wormholeGridScan(state: GameState, ctx?: SimContext): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法扫描。', errorId: 'core.wormhole.010' }
  const { run, grid } = hit
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const blocked = gridActionBlocked(state)
  if (blocked) return { ok: false, error: blocked.error, errorId: blocked.errorId, errorParams: blocked.errorParams }
  if (ctx) grid.scanRadius = WORMHOLE_SCAN_RADIUS_BASE + wormholeScanBonusOf(ctx, run.fleet)
  const buffs = wormholeMatterBuffs(run.hold, ctx ? matterTechWhBuffs(state, ctx) : undefined)
  const targets = gridScanTargets(grid, buffs.scanRadius)
  const nebulaTargets = gridNebulaDisperseTargets(grid, buffs.scanRadius, buffs.nebulaDisperse)
  if (targets.length === 0 && nebulaTargets.length === 0) {
    return { ok: false, error: '周围都扫过了、也没有星云可驱散：换个地点再扫。', errorId: 'core.wormhole.011' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_SCAN) {
    return { ok: false, error: '回合不足：只能撤离。', errorId: 'core.wormhole.002', mustExtract: true }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_SCAN
  wormholeSpawnAfterTurns(state, WORMHOLE_TURN_PER_SCAN)
  const revealed: { key: string; signal: WormholeSignal | null }[] = []
  const exitKey = hexKey(grid.exit.q, grid.exit.r)
  let exitScanned = false
  for (const c of targets) {
    const cell = gridCellAt(grid, c)
    if (!cell) continue
    if (!grid.scanned.includes(cell.key)) grid.scanned.push(cell.key)
    if (cell.key === exitKey) exitScanned = true
    revealed.push({ key: cell.key, signal: signalOfCell(cell) })
  }
  if (run.expeditionRules === 2) {
    const beacon = grid.cells.find(c => c.place === 'beacon')
    if (beacon && !grid.scanned.includes(beacon.key)) {
      grid.scanned.push(beacon.key)
      revealed.push({ key: beacon.key, signal: 'beacon' })
    }
    if (beacon) disperseNebulae(grid, [beacon])
    exitScanned = false
    if (run.expeditionProgress) run.expeditionProgress.revealed += revealed.length
  } else if (exitScanned) markExitKnown(grid)
  const dispersed = disperseNebulae(grid, nebulaTargets)
  wormholePatrolAfterAction(state)
  const empty = revealed.filter((r) => r.signal === null).length
  const newlyFogged = grid.cells.filter(
    (c) => revealed.some((r) => r.key === c.key) && isNebulaFogged(grid, c),
  ).length
  addLog(
    state,
    'fleet',
    `🕳 扫描（半径 ${grid.scanRadius + buffs.scanRadius}）：揭开 ${revealed.length} 格` +
      (empty > 0 ? `（其中 ${empty} 格没有信号）` : '') +
      (exitScanned ? ` · 扫到下一层入口（Q${grid.exit.q} · R${grid.exit.r}，已标在地图上）` : '') +
      (newlyFogged > 0 ? ` · ${newlyFogged} 格被星云遮住（再扫描一次可驱散）` : '') +
      (dispersed.length > 0 ? ` · 驱散星云 ${dispersed.length} 格` : '') +
      ` · 剩 ${run.turnsLeft} 回合。`,
  )
  return {
    ok: true,
    spent: WORMHOLE_TURN_PER_SCAN,
    revealed,
    dispersed,
    newlyFogged,
    exitScanned,
    mustExtract: run.turnsLeft <= 0,
  }
}

export function wormholeGridTravel(
  state: GameState,
  target: HexCell,
  opts?: { confirmUnknown?: boolean; confirmIntercept?: boolean; confirmLeaveCargo?: boolean },
): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法前往。', errorId: 'core.wormhole.012' }
  const { run, grid } = hit
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const blocked = gridActionBlocked(state)
  if (blocked) return { ok: false, error: blocked.error, errorId: blocked.errorId, errorParams: blocked.errorParams }
  const cell = gridCellAt(grid, target)
  if (!cell) return { ok: false, error: '那一格不在本层网格里。', errorId: 'core.wormhole.013' }
  if (cell.key === gridCellAt(grid, grid.pos)?.key) return { ok: false, error: '已经在这个地点了。', errorId: 'core.wormhole.014' }
  if (wormholeGroundPending(run) && opts?.confirmLeaveCargo !== true) return { ok: false, code: 'cargo-pending' }
  const scanned = grid.scanned.includes(cell.key) || grid.visited.includes(cell.key)
  if (!scanned && !opts?.confirmUnknown) {
    return { ok: false, error: '这个地点还没扫描过：前往未知地点？', errorId: 'core.wormhole.015', code: 'unknown-target' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_MOVE) {
    return { ok: false, error: '回合不足：只能撤离。', errorId: 'core.wormhole.002', mustExtract: true }
  }
  const intercept = wormholePathInterceptAt(grid, { q: cell.q, r: cell.r })
  if (intercept && opts?.confirmIntercept !== true) {
    return {
      ok: false,
      error: '路径上有敌人阻拦：前往将在中途被拦截并开战。', errorId: 'core.wormhole.016',
      code: 'path-blocked',
    }
  }
  const dest = intercept ?? cell
  const interceptKnown = intercept
    ? grid.scanned.includes(intercept.key) || grid.visited.includes(intercept.key)
    : false
  run.turnsLeft -= WORMHOLE_TURN_PER_MOVE
  wormholeSpawnAfterTurns(state, WORMHOLE_TURN_PER_MOVE)
  grid.pos = { q: dest.q, r: dest.r }
  delete run.pendingEvent
  if (!grid.visited.includes(dest.key)) grid.visited.push(dest.key)
  if (!grid.scanned.includes(dest.key)) grid.scanned.push(dest.key)
  const signal = signalOfCell(dest)
  const atExit = isExitCell(grid, dest)
  if (atExit) markExitKnown(grid)
  const first = !grid.activated.includes(dest.key)
  const coveringFoe = hasLiveFoe(dest)
  const autoBattle = (first && dest.place === 'ship' && !dest.combatCleared) || coveringFoe
  const beacon = first && dest.place === 'beacon' && (run.expeditionRules === 2 || !coveringFoe)
  const event = run.expeditionRules === 2 && dest.eventKey !== undefined && dest.eventResolved !== true ? dest.eventKey : undefined
  const cellByKey = new Map(grid.cells.map((c) => [c.key, c] as const))
  const beaconNo = beacon
    ? grid.activated.filter((k) => cellByKey.get(k)?.place === 'beacon').length + 1
    : 0
  const ambush = autoBattle && !scanned && !intercept
  if ((autoBattle && (run.expeditionRules === 2 || !coveringFoe)) || beacon) {
    if (!grid.activated.includes(dest.key)) grid.activated.push(dest.key)
  }
  if (event) run.pendingEvent = { key: event, cellKey: dest.key }
  let beaconReveal: { cell: WormholeGridCell; nebulaDispersed: boolean } | null = null
  if (beacon) {
    if (beaconNo <= 1) {
      markExitKnown(grid)
      if (run.expeditionRules === 2) {
        const clue = grid.cells.find(c => c.eventKey && c.eventResolved !== true)
        if (clue && !grid.scanned.includes(clue.key)) grid.scanned.push(clue.key)
        if (clue) {
          disperseNebulae(grid, [clue])
          if (run.expeditionProgress) run.expeditionProgress.clues += 1
        }
      }
    } else {
      beaconReveal = revealNearestMatterCell(grid, { q: dest.q, r: dest.r })
    }
  }
  let arrivalText: string
  let arrivalId: string | undefined
  let arrivalParams: Record<string, string | number> | undefined
  if (autoBattle) {
    arrivalText = intercept
      ? `🕳 途中被拦下（${dest.q},${dest.r}）：对方的舰船信号挡住去路——交火开始 · 剩 ${run.turnsLeft} 回合。`
      : ambush
        ? `🕳 踩中埋伏（${dest.q},${dest.r}）：这个地点出发前没扫描过——里面是敌人，准备交火 · 剩 ${run.turnsLeft} 回合。`
        : `🕳 抵达舰船信号（${dest.q},${dest.r}）：对方已经发现我们——交火开始 · 剩 ${run.turnsLeft} 回合。`
  } else if (beacon) {
    if (beaconNo <= 1) {
      arrivalText = `🕳 抵达漂浮信标（${dest.q},${dest.r}）：信标把下一层入口标在了地图上（Q${grid.exit.q} · R${grid.exit.r}）· 剩 ${run.turnsLeft} 回合。`
      arrivalId = 'core.wormhole.029'
      arrivalParams = { p1: dest.q, p2: dest.r, p3: grid.exit.q, p4: grid.exit.r, p5: run.turnsLeft }
    } else if (beaconReveal) {
      const neb = beaconReveal.nebulaDispersed
      arrivalText = neb
        ? `🕳 抵达漂浮信标（${dest.q},${dest.r}）：信标标出一处谜质信号（Q${beaconReveal.cell.q} · R${beaconReveal.cell.r}）——顺带驱散了那里的星云 · 剩 ${run.turnsLeft} 回合。`
        : `🕳 抵达漂浮信标（${dest.q},${dest.r}）：信标标出一处谜质信号（Q${beaconReveal.cell.q} · R${beaconReveal.cell.r}）· 剩 ${run.turnsLeft} 回合。`
      arrivalId = neb ? 'core.wormhole.031' : 'core.wormhole.030'
      arrivalParams = { p1: dest.q, p2: dest.r, p3: beaconReveal.cell.q, p4: beaconReveal.cell.r, p5: run.turnsLeft }
    } else {
      arrivalText = `🕳 抵达漂浮信标（${dest.q},${dest.r}）：这块信标没有新的谜质可标 · 剩 ${run.turnsLeft} 回合。`
      arrivalId = 'core.wormhole.032'
      arrivalParams = { p1: dest.q, p2: dest.r, p3: run.turnsLeft }
    }
  } else if (atExit) {
    arrivalText = `🕳 抵达下一层入口（${dest.q},${dest.r}）：激活此处将迎战第 ${run.depth} 层守卫 · 剩 ${run.turnsLeft} 回合。`
  } else if (intercept) {
    arrivalText = `🕳 途中被拦下（${dest.q},${dest.r}）：这里是${WORMHOLE_PLACE_TEXT[dest.place]}，先处理完再继续 · 剩 ${run.turnsLeft} 回合。`
  } else {
    arrivalText = `🕳 抵达新地点（${dest.q},${dest.r}）：${WORMHOLE_PLACE_TEXT[dest.place]} · 剩 ${run.turnsLeft} 回合。`
  }
  addLog(state, 'fleet', arrivalText, arrivalId, arrivalParams)
  wormholePatrolAfterAction(state, { deferMovement: autoBattle })
  return {
    ok: true,
    spent: WORMHOLE_TURN_PER_MOVE,
    arrived: {
      key: dest.key,
      place: dest.place,
      signal,
      atExit,
      ...(autoBattle ? { autoBattle: true } : {}),
      ...(ambush ? { ambush: true as const } : {}),
      ...(beacon ? { beacon: true } : {}),
      ...(event ? { eventKey: event } : {}),
      ...(intercept ? { intercepted: { target: cell.key, known: interceptKnown } } : {}),
    },
    mustExtract: run.turnsLeft <= 0,
  }
}

export function wormholeGridActivate(state: GameState): WormholeGridActionResult {
  const hit = gridRun(state)
  if (!hit) return { ok: false, error: '本层没有网格：无法激活。', errorId: 'core.wormhole.017' }
  const { run, grid } = hit
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const blocked = gridActionBlocked(state)
  if (blocked) return { ok: false, error: blocked.error, errorId: blocked.errorId, errorParams: blocked.errorParams }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。', errorId: 'core.wormhole.018' }
  if (grid.activated.includes(cell.key)) {
    return { ok: false, error: cell.place === 'beacon' ? '信标已经读过了。' : '这个地点已经处理过了。' }
  }
  const atExit = isExitCell(grid, cell)
  if (!atExit && (cell.place === 'empty' || cell.place === 'beacon')) {
    return { ok: false, error: '这里什么都没有：没有可执行的作业。', errorId: 'core.wormhole.021' }
  }
  if (!atExit && (cell.place === 'vein' || cell.place === 'graveyard' || cell.place === 'ruins' || cell.place === 'research')) {
    return { ok: false, error: '这个地点不用激活：直接采集/打捞就行。', errorId: 'core.wormhole.022' }
  }
  if (atExit && (run.bossCleared ?? 0) >= run.depth) {
    return { ok: false, error: '本层守卫已经清掉了：可以「继续深入」或「撤离」。', errorId: 'core.wormhole.023' }
  }
  grid.activated.push(cell.key)
  const effect: WormholeActivateEffect = atExit
    ? { kind: 'exit', key: cell.key }
    : cell.place === 'ship'
      ? { kind: 'battle', key: cell.key }
      : { kind: 'matter', key: cell.key }
  addLog(
    state,
    'fleet',
    `🕳 激活地点（${cell.q},${cell.r} · ${atExit ? '下一层入口' : WORMHOLE_PLACE_TEXT[cell.place]}）· 不消耗回合 · 剩 ${run.turnsLeft} 回合。`,
  )
  return { ok: true, spent: 0, effect, mustExtract: run.turnsLeft <= 0 }
}

export const WORMHOLE_PLACE_TEXT: Readonly<Record<WormholePlace, string>> = {
  empty: '空信息地点',
  graveyard: '舰船墓场',
  ruins: '遗迹',
  research: '生产研究所',
  ship: '舰船信号',
  vein: '矿脉',
  matter: '虫洞谜质',
  beacon: '漂浮信标',
}

export const WORMHOLE_PILE_UNITS_BASE = 200

export interface WormholePile {
  itemId: string
  units: number
}

export function wormholeNodePiles(seed: number, depth: number, index: number, count: number, expeditionRules?: number): WormholePile[] {
  const n = Math.max(0, Math.floor(count))
  if (n <= 0) return []
  const mul = wormholeLayerRewardMul(depth, expeditionRules)
  const out: WormholePile[] = []
  for (let k = 0; k < n; k++) {
    const h = Math.abs((seed * 1103515245 + (depth * 137 + index * 31 + k * 7) * 7919) % 2147483647)
    const jitter = 0.8 + (h % 41) / 100
    out.push({
      itemId: WORMHOLE_ORE_ITEM_ID,
      units: Math.max(1, ceilFinalQuantity(WORMHOLE_PILE_UNITS_BASE * mul * jitter)),
    })
  }
  return out
}

export const WORMHOLE_ORE_ITEM_ID = 'ore-voidmother'

export function wormholeFleetCargoM3(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  let total = 0
  for (const id of shipIds) total += cargoCapacityM3Of(state, ctx, id)
  return total
}

export function wormholeBagSlotsOfFleet(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  return wormholeBagSlots(wormholeFleetCargoM3(state, ctx, shipIds))
}

export function mergeIntoBag(bag: readonly WormholeBagSlot[], pile: WormholePile): WormholeBagSlot[] {
  const out = bag.map((s) => ({ ...s }))
  const hit = out.find((s) => s.itemId === pile.itemId)
  if (hit) hit.units += pile.units
  else out.push({ itemId: pile.itemId, units: pile.units })
  return out
}

import { shipBusyForWormhole, shipActivityBusy } from './wormhole/fleet/busy'
export { shipBusyForWormhole, shipActivityBusy } from './wormhole/fleet/busy'

export function wormholeLeave(state: GameState): void {
  const run = state.wormhole.run
  if (!run) return
  run.attending = false
  run.leftAtGameMs = state.gameMs
}

export function noCommonWreckSalvageOn(state: GameState): boolean {
  return state.wormhole.noCommonWreckSalvage === true
}

export function setNoCommonWreckSalvage(state: GameState, on: boolean): CommandResult {
  if (on) state.wormhole.noCommonWreckSalvage = true
  else delete state.wormhole.noCommonWreckSalvage
  return { ok: true }
}

function shiftBattleClock(battle: BattleState | null | undefined, deltaMs: number): void {
  if (!battle) return
  if (!(deltaMs > 0)) return
  battle.startedAtGameMs += deltaMs
  battle.lastTickGameMs += deltaMs
  if (battle.waveClearAt !== undefined) battle.waveClearAt += deltaMs
  const nextPulseAtMs = battle.repair?.nextPulseAtMs
  if (nextPulseAtMs !== undefined) battle.repair!.nextPulseAtMs = nextPulseAtMs + deltaMs
}

export function wormholeResume(state: GameState, ctx: SimContext): WormholeStartResult {
  void ctx
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '现在没有进行中的虫洞探索。', errorId: 'core.wormhole.024' }
  const busy = shipActivityBusy(state, state.shipId)
  if (busy) {
      return {
        ok: false,
        error: `主控正在${busy.error}：先把手上的活收工，才能回到虫洞。`,
        errorId: 'core.wormhole.037',
        errorParams: { p1Id: busy.errorId },
      }
    }
  shiftBattleClock(run.battle, state.gameMs - (run.leftAtGameMs ?? state.gameMs))
  run.leftAtGameMs = undefined
  run.attending = true
  return { ok: true, run }
}

export interface WormholeEntryAutoStop {
  kind: 'whscan' | 'mining' | 'salvage' | 'hauling' | 'standby' | 'refine' | 'manufacture' | 'siteDeliver' | 'lab'
  mainKind: MainActivityKind
  label: string
  name: string
  nameId: string
  warn: boolean
}

const ENTRY_STOP_META: Partial<
  Record<MainActivityKind, { kind: WormholeEntryAutoStop['kind']; label: string; warn: boolean }>
> = {
  wormholeScan: { kind: 'whscan', label: '扫描虫洞中', warn: false },
  mining: { kind: 'mining', label: '采矿中', warn: false },
  salvaging: { kind: 'salvage', label: '打捞中', warn: false },
  hauling: { kind: 'hauling', label: '长途运输中', warn: true },
  standby: { kind: 'standby', label: '掩护巡逻中', warn: false },
  refine: { kind: 'refine', label: '亲自开炉中', warn: false },
  manufacturing: { kind: 'manufacture', label: '亲自开线中', warn: false },
  siteDeliver: { kind: 'siteDeliver', label: '建站交付中', warn: false },
  lab: { kind: 'lab', label: '亲自运转实验室中', warn: false },
}

export function wormholeEntryAutoStops(state: GameState): WormholeEntryAutoStop[] {
  const v = gateMainActivityHandoff(state, true)
  if (v.action !== 'halt' || v.current === undefined) return []
  const meta = ENTRY_STOP_META[v.current]
  if (meta === undefined) return []
  return [{ ...meta, mainKind: v.current, name: KIND_LABEL[v.current], nameId: ACTIVITY_LABEL_ID[v.current] }]
}

export function wormholeShipEntryBusy(state: GameState, shipId: string): BusyLabel | null {
  const busy = shipBusyForWormhole(state, shipId)
  if (busy === null) return null
  if (shipId === state.shipId && mainActivityOf(state) !== null && gateMainActivityHandoff(state, true).action === 'halt') {
    return null
  }
  return busy
}

export function wormholeEntryBlockReason(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): string | null {
  void ctx
  const verdict = gateMainActivityHandoff(state, true)
  if (verdict.action === 'reject' && verdict.message !== undefined) return verdict.message
  const pilotBusy = wormholeShipEntryBusy(state, state.shipId)
  if (pilotBusy) return `主控正在${pilotBusy.error}：先把手上的活收工，才能指挥虫洞探索。`
  for (const uid of shipIds) {
    const busy = wormholeShipEntryBusy(state, uid)
    if (busy) return `${shipDisplayName(state, ctx, uid)}正在${busy.error}：先取消它的作业/派工，才能编入虫洞。`
  }
  return null
}

export function wormholeScanBonusOf(ctx: SimContext, shipIds: readonly string[]): number {
  let scout = 0
  let electronic = 0
  for (const id of shipIds) {
    const def = ctx.ships.get(uidDefId(id))
    const v = def?.wormholeScanRadiusBonus
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const bonus = Math.max(0, Math.floor(v))
    if (def?.subClass === '侦察舰') scout = Math.max(scout, bonus)
    else if (def?.subClass === '电子舰') electronic = Math.max(electronic, bonus)
  }
  return scout + electronic
}

export const EVENTS_BLANK_SHARE_PER_LEVEL = 0.04

export function blankShareFactorOf(state: GameState): number {
  const lv = Math.max(0, Math.min(5, Math.floor(state.skills.trained['event-dividend'] ?? 0)))
  return 1 - EVENTS_BLANK_SHARE_PER_LEVEL * lv
}

function haltEntryActivityOf(
  state: GameState,
  ctx: SimContext,
  kind: MainActivityKind,
): CoreBlockReason | undefined {
  if (kind === 'wormholeScan') {
    const mins = wormholeScanHalt(state)
    return mins !== null
      ? {
          error: `已扫 ${mins} 分钟，回来可续扫`,
          errorId: 'core.wormhole.038',
          errorParams: { p1: mins },
        }
      : undefined
  }
  if (kind === 'mining') {
    const info = miningHalt(state)
    if (info === null) return undefined
    const belt = info.beltId ? ctx.belts.get(info.beltId) : undefined
    const ore = belt ? ctx.items.get(belt.oreId) : undefined
    const oreName = ore ? ore.name : ''
    const beltName = belt?.name ?? '矿带'
    return {
      error: `「${beltName}」 · 本趟 ${info.tripUnits} 单位${oreName}，货物留在船上`,
      errorId: 'core.wormhole.039',
      errorParams: {
        p1: beltName,
        p2: info.tripUnits,
        p3: oreName,
        ...(belt !== undefined ? {} : { p1Id: 'core.wormhole.043' }),
      },
    }
  }
  if (kind === 'salvaging') {
    const info = salvageHalt(state)
    if (info === null) return undefined
    const gName = info.galaxyId ? (ctx.galaxies.get(info.galaxyId)?.name ?? '') : ''
    return {
      error: `${gName} · 本趟约 ${Math.round(info.tripM3 * 100) / 100} m³ 当量，货物留在船上`,
      errorId: 'core.wormhole.040',
      errorParams: { p1: gName, p2: Math.round(info.tripM3 * 100) / 100 },
    }
  }
  if (kind === 'hauling') {
    const info = haulingHalt(state)
    if (info === null) return undefined
    const originName = info.fromSiteId ? (ctx.stations.get(info.fromSiteId)?.name ?? info.fromSiteId) : '母港'
    return {
      error: `已即时返港停靠「${originName}」`,
      errorId: 'core.wormhole.041',
      errorParams: {
        p1: originName,
        ...(info.fromSiteId ? {} : { p1Id: 'core.wormhole.042' }),
      },
    }
  }
  haltActivityForSwitch(state, kind)
  return undefined
}

export function wormholeEnter(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
  seed: number,
  origin?: { depth?: number; archetype?: WormholeArchetype; family?: WormholeFamily; expeditionRules?: number; automatic?: true },
): WormholeStartResult {
  const departureFrom = departureOrigin(state, ctx)
  if (state.wormhole.run) return { ok: false, error: '已经在虫洞里了：先撤离或结算本趟。', errorId: 'core.wormhole.026' }
  const budget = commandBudgetOf(state, ctx, shipIds, true)
  if (!budget.ok) return budget
  const blocked = wormholeEntryBlockReason(state, ctx, shipIds)
    if (blocked) return { ok: false, error: blocked }
  for (const a of wormholeEntryAutoStops(state)) {
    logAutoHalt(state, a.mainKind, haltEntryActivityOf(state, ctx, a.mainKind))
  }
  const tech = matterTechWhBuffs(state, ctx)
  const r = wormholeStartRun(ctx, shipIds, seed, blankShareFactorOf(state), tech.turnBonus, origin?.expeditionRules)
  if (!r.ok || !r.run) return r
  r.run.haulerFittingVersion = 1
  r.run.attending = true
  if (origin?.depth !== undefined) r.run.depth = Math.max(1, Math.min(9, Math.floor(origin.depth)))
  if (origin?.expeditionRules === 2 && r.run.depth !== 1) r.run.grid = wormholeMakeGrid(seed, r.run.depth, wormholeScanBonusOf(ctx, shipIds), blankShareFactorOf(state), 2)
  r.run.archetype = origin?.archetype ?? wormholeArchetypeOf(seed)
  r.run.family = origin?.family ?? wormholeFamilyOfSeed(seed)
  if (origin?.expeditionRules !== undefined) r.run.expeditionRules = origin.expeditionRules
  state.wormhole.run = r.run
  if (!origin?.automatic) beginDeparture(state, ctx, 'wormhole', departureFrom.galaxy, departureFrom)
  delete state.wormhole.lastSettle
  maybeHintSiege(state, r.run.depth)
  bumpFirst(state, 'wormholeRuns')
  addLog(
    state,
    'fleet',
    `🕳 虫洞跃入：编队 ${shipIds.length} 艘 · 折算总质量 ${r.run.totalMass.toLocaleString('zh-CN')} · 可探索 ${r.run.turnsTotal} 回合。`,
    r.run.expeditionRules === 2 ? 'core.explorationStatus.005' : 'core.explorationStatus.004',
    { p1: shipIds.length, p2: r.run.totalMass, p3: r.run.turnsTotal },
  )
  return r
}

export function wormholeDebugReset(state: GameState): void {
  state.wormhole.run = null
}
