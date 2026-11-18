
import {
  CURRENT_STATE_VERSION,
  DEFAULT_LOG_CAP,
  DEFAULT_PILOT_NAME,
  DEFAULT_START_ISK,
  DEFAULT_START_SHIP_ID,
  HOME_GALAXY_ID,
  MAX_SKILL_LEVEL,
} from './state'
import { cleanBattleRangeRecords, cleanPendingBattleRange } from './battleRangeMemory'
import { cleanDeparture, reconcileDeparture } from './departure'
import type { BattleState, GameState,     LogEntry, LogKind, MarksState, SideTask, WormholeArchetype, WormholeFamily } from './state'
import type { AchievementEarned, WorkReturnProgress } from './state'
import type { CommsInstanceEntry, CommsJumpPage, CommsKind, CommsRewardLine, FittedModules, RackSlot } from './types'
import type { ShipFitPreset } from './state'
import type { WormholeGridState } from './wormholeGrid'
import { WORMHOLE_HOLD_COLS, cleanHoldPlacement } from './wormholeHold'
import { WORMHOLE_SCAN_BASE_MS, WORMHOLE_STOCK_MAX_HARD } from './wormholeScan'
import { WRECK_LOG_MAX } from './shipWrecks'
import { cleanShipDamage } from './shipDamage'
import { WORMHOLE_AUTO_MAX_SHIPS, WORMHOLE_AUTO_REPORT_MAX } from './wormholeAuto'
import { WORMHOLE_ARCHETYPES, WORMHOLE_GRID_SAVE_MAX_R, isWormholeEventKey, wormholeArchetypeOf } from './wormholeGrid'
import { cleanWormholeEventInstance, cleanWormholeExpeditionRun } from './wormholeExpeditionSave'
import { cleanWormholePreparationTemplates } from './wormholePreparationTemplates'
import { cleanPreparationSquads } from './preparationSquads'
import { cleanFleetPresets } from './fleetPresets'
import { cleanFleetRangeSettings } from './fleetRange'
import { cleanCommandExpedition, cleanWeekendSquad } from './combat/command/save'
import { cleanCombatSortie } from './combat/command/roster'
import { WORMHOLE_FAMILY_ORDER, wormholeFamilyOfSeed } from './wormholeFoes'
import type { WormholeHoldState } from './wormholeHold'
import { emptyFitted, uidDefId } from './labels'
import { normalizeBlackMarket } from './blackMarket'
import { maxScanWindowMs } from './explore'
import { pruneMarks } from './marks'
import { FIT_PRESET_MAX, FIT_PRESET_NAME_MAX } from './fitPresets'
import type { AiCoreType } from './types'
import { weekendFlagshipWindowMs } from './weekendEvent'
import { isBlackboxItem } from './blackbox'
import { normalizeWeekendWreckRecord } from './weekendWreckLedger'
import { cleanPlanetaryState } from './planetSave'
import { normalizeTrainingProgress } from './training'
import { cleanPendingStationActivity } from './stationActivityPending'
import { PRICE_HISTORY_LIMIT } from './market/constants'
import { cleanHaulFleetLeg } from './hauling/types'
import { cleanPirateEncounter } from './encounters/save'
import { cleanSignalAutoEstimate, cleanSignalAutoReportDetails } from './signalAuto/save'
import { cleanMarketRelayState } from './market/relaySave'
import { applyLegacyCommandCompensation } from './combat/command/compensation'

export const SAVE_FORMAT = 'whale-idle-save'
const FALLBACK_RNG_SEED = 0x5eed

export class SaveError extends Error {
  readonly code: 'PARSE' | 'FORMAT' | 'VERSION'
  constructor(code: 'PARSE' | 'FORMAT' | 'VERSION', message: string) {
    super(message)
    this.name = 'SaveError'
    this.code = code
  }
}

const LOG_KINDS: ReadonlySet<string> = new Set(['system', 'info', 'queue', 'levelup', 'warn', 'trade', 'event', 'combat', 'industry', 'fleet', 'salvage'])

export type RawState = Record<string, unknown>

export const MIN_SUPPORTED_SAVE_VERSION = CURRENT_STATE_VERSION

import { asRaw, cleanAmmoIdMap, cleanBattle, cleanPlugIds, RACK_MAX } from './saveBattleClean'
export { BATTLE_PERSIST_KEYS } from './saveBattleClean'

function cleanRack(v: unknown): Array<string | null> {
  if (!Array.isArray(v)) return []
  const out: Array<string | null> = []
  for (const x of v.slice(0, RACK_MAX)) out.push(typeof x === 'string' && x.length > 0 ? x : null)
  while (out.length > 0 && out[out.length - 1] === null) out.pop()
  return out
}

function normalizeState(raw: unknown): GameState {
  const src = asRaw(raw)

  const logCap =
    typeof src.logCap === 'number' && Number.isFinite(src.logCap) && src.logCap > 0
      ? Math.floor(src.logCap)
      : DEFAULT_LOG_CAP

  const charRaw = asRaw(src.character)
  const character = {
    name: typeof charRaw.name === 'string' && charRaw.name.length > 0 ? charRaw.name : DEFAULT_PILOT_NAME,
    startedAtWallMs:
      typeof charRaw.startedAtWallMs === 'number' && Number.isFinite(charRaw.startedAtWallMs)
        ? charRaw.startedAtWallMs
        : 0,
  }

  const skillsRaw = asRaw(src.skills)
  const trained: Record<string, number> = {}
  const trainedRaw = asRaw(skillsRaw.trained)
  for (const [key, value] of Object.entries(trainedRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      trained[key] = Math.min(MAX_SKILL_LEVEL, Math.floor(value))
    }
  }
  const queue: Array<{ skillId: string; targetLevel: number; progressMs: number }> = []
  const queueRaw = skillsRaw.queue
  if (Array.isArray(queueRaw)) {
    for (const q of queueRaw) {
      if (typeof q !== 'object' || q === null) continue
      const item = q as RawState
      const skillId = typeof item.skillId === 'string' ? item.skillId : ''
      if (skillId.length === 0) continue
      const targetLevel =
        typeof item.targetLevel === 'number' && Number.isFinite(item.targetLevel)
          ? Math.min(MAX_SKILL_LEVEL, Math.max(1, Math.floor(item.targetLevel)))
          : 1
      const progressMs =
        typeof item.progressMs === 'number' && Number.isFinite(item.progressMs)
          ? Math.max(0, skillsRaw.progressVersion === 1 ? item.progressMs : Math.floor(item.progressMs))
          : 0
      queue.push({ skillId, targetLevel, progressMs })
    }
  }
  const savedProgress: Record<string, number> = {}
  const savedProgressRaw = asRaw(skillsRaw.savedProgress)
  for (const [key, value] of Object.entries(savedProgressRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      savedProgress[key] = skillsRaw.progressVersion === 1
        ? Math.min(Number.MAX_SAFE_INTEGER, value)
        : Math.min(24 * 60 * 60 * 1000, Math.floor(value))
    }
  }

  /**
 * **技能训练许可**（2026-09-27 船长令「我想让学习技能有成本」）——
 * 只收「值恒 `true`」的键（严格比较：写坏了的值一律丢弃 ⇒ 不会凭空给出一本许可）。
 * ⚠ **老档零迁移**：改动前的档没有这个键 ⇒ 清洗出空表即可；"已经练到 Lv≥1 视同已购"
 * 那条豁免走判据（`hasSkillLicense`），**不落任何迁移键**。
 */
const licenses: Record<string, true> = {}
const licensesRaw = asRaw(skillsRaw.licenses)
for (const [key, value] of Object.entries(licensesRaw)) {
  if (key.length === 0) continue
  if (value === true) licenses[key] = true
}

  const walletRaw = asRaw(src.wallet)
  const wallet = {
    isk:
      typeof walletRaw.isk === 'number' && Number.isFinite(walletRaw.isk)
        ? Math.max(0, Math.floor(walletRaw.isk))
        : DEFAULT_START_ISK,
  }

  const shipId = typeof src.shipId === 'string' && src.shipId.length > 0 ? src.shipId : DEFAULT_START_SHIP_ID

  const slotId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  const cleanCustomName = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    const chars = [...t]
    if (chars.length === 0) return null
    return chars.slice(0, 10).join('').trimEnd()
  }
  const freshShip = (
    defId: string,
  ): {
    defId: string
    customName: string | null
    durability: number
    armorPct?: number
    cargo: Record<string, number>
    fitted: FittedModules
    droneLoad?: Record<string, number>
    plugs?: string[]
    damagePlugs?: import('./shipDamage').ShipDamageKind[]
    ammoPref?: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>>
  } => ({
    defId,
    customName: null,
    durability: 1,
    armorPct: 1,
    cargo: {},
    fitted: emptyFitted(),
  })
  const fleet: Record<string, ReturnType<typeof freshShip>> = {}
  const fleetRaw = asRaw(src.fleet)
  const hasFleet = typeof src.fleet === 'object' && src.fleet !== null
  for (const [id, shipRawValue] of Object.entries(fleetRaw)) {
    if (id.length === 0) continue
    const shipRaw = asRaw(shipRawValue)
    const cargoMap: Record<string, number> = {}
    const cargoRaw = asRaw(shipRaw.cargo)
    for (const [key, value] of Object.entries(cargoRaw)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        cargoMap[key] = Math.floor(value)
      }
    }
    const fRaw = asRaw(shipRaw.fitted)
    const durabilityRaw = shipRaw.durability
    const durability =
      typeof durabilityRaw === 'number' && Number.isFinite(durabilityRaw)
        ? Math.min(1, Math.max(0, Math.round(durabilityRaw * 1000) / 1000))
        : 1
    const armorRaw = shipRaw.armorPct
    const armorPct =
      typeof armorRaw === 'number' && Number.isFinite(armorRaw)
        ? Math.min(1, Math.max(0, Math.round(armorRaw * 1000) / 1000))
        : undefined
    const defId = typeof shipRaw.defId === 'string' && shipRaw.defId.length > 0 ? shipRaw.defId : uidDefId(id)
    const fitted: FittedModules = emptyFitted()
    if (Array.isArray(fRaw.high) || Array.isArray(fRaw.mid) || Array.isArray(fRaw.low)) {
      const rackOfRaw = (rack: RackSlot): Array<string | null> =>
        Array.isArray(fRaw[rack]) ? (fRaw[rack] as unknown[]).map((v) => slotId(v)) : []
      fitted.high = rackOfRaw('high')
      fitted.mid = rackOfRaw('mid')
      fitted.low = rackOfRaw('low')
    } else {
      const pick = (fam: string): string | null => (typeof fRaw[fam] === 'string' ? slotId(fRaw[fam]) : null)
      fitted.high = [pick('turret'), pick('miner')]
      fitted.mid = [pick('shield'), pick('propulsion')]
      fitted.low = [pick('armor'), pick('cargo')]
    }
    const dlRaw = asRaw(shipRaw.droneLoad)
    let droneLoad: Record<string, number> | undefined
    for (const [k, v] of Object.entries(dlRaw)) {
      if (k.length === 0) continue
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
      if (n > 0) {
        if (!droneLoad) droneLoad = {}
        droneLoad[k] = n
      }
    }
    fleet[id] = {
      defId,
      customName: cleanCustomName(shipRaw.customName),
      durability,
      armorPct,
      cargo: cargoMap,
      fitted,
      droneLoad,
      plugs: cleanPlugIds(shipRaw.plugs),
      ...(cleanShipDamage(shipRaw.damagePlugs) ? { damagePlugs: cleanShipDamage(shipRaw.damagePlugs) } : {}),
      ammoPref: cleanAmmoIdMap(shipRaw.ammoPref),
    }
  }
  if (Object.keys(fleet).length === 0) {
    const ship = freshShip(DEFAULT_START_SHIP_ID)
    if (!hasFleet) {
      const legacyInv = asRaw(asRaw(src.inventory).items)
      for (const [key, value] of Object.entries(legacyInv)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) ship.cargo[key] = Math.floor(value)
      }
    }
    fleet[DEFAULT_START_SHIP_ID] = ship
  }
  if (!(shipId in fleet)) {
    fleet[shipId] = freshShip(uidDefId(shipId))
  }

  const shipLocks: Record<string, boolean> = {}
  const shipLocksRaw = asRaw(src.shipLocks)
  for (const [shipKey, value] of Object.entries(shipLocksRaw)) {
    if (value === true && shipKey in fleet) shipLocks[shipKey] = true
  }

  const marks: MarksState = { goods: [], recipes: [], blueprints: [], ships: [], labRecipes: [] }
  const marksRaw = asRaw(src.marks)
  for (const kind of ['goods', 'recipes', 'blueprints', 'ships', 'labRecipes'] as const) {
    for (const id of Object.values(asRaw(marksRaw[kind]))) {
      if (typeof id === 'string' && id.length > 0) marks[kind].push(id)
    }
  }

  const warehouseItems: Record<string, number> = {}
  const wareRaw = asRaw(asRaw(src.warehouse).items)
  for (const [key, value] of Object.entries(wareRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      warehouseItems[key] = Math.floor(value)
    }
  }

  const aiCores: Record<string, number> = { basic: 0, gamma: 0, beta: 0, alpha: 0 }
  const aiCoresRaw = asRaw(src.aiCores)
  for (const [key, value] of Object.entries(aiCoresRaw)) {
    if (key in aiCores && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      aiCores[key] = Math.floor(value)
    }
  }

  const aiAssignmentsRaw = asRaw(src.aiAssignments)
  const aiAssignments: Record<string, unknown> = {}
  const fuelMulOf = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 1 ? Math.floor(v) : undefined
  const validCoreType = (v: unknown): v is string =>
    typeof v === 'string' && (v === 'basic' || v === 'gamma' || v === 'beta' || v === 'alpha')
  for (const [shipKey, assignRaw] of Object.entries(aiAssignmentsRaw)) {
    const a = asRaw(assignRaw)
    if (!validCoreType(a.coreType)) continue
    const startedAt =
      typeof a.startedAtGameMs === 'number' && Number.isFinite(a.startedAtGameMs)
        ? Math.max(0, Math.floor(a.startedAtGameMs))
        : 0
    const taskRaw = asRaw(a.task)
    if (taskRaw.kind === 'mining') {
      const beltId = typeof taskRaw.beltId === 'string' ? taskRaw.beltId : ''
      const phaseRaw = taskRaw.phase
      if (!beltId) continue
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'mining',
          beltId,
          phase: phaseRaw === 'returning' || phaseRaw === 'outbound' ? phaseRaw : 'mining',
          cycleAccMs:
            typeof taskRaw.cycleAccMs === 'number' && Number.isFinite(taskRaw.cycleAccMs)
              ? Math.max(0, Math.floor(taskRaw.cycleAccMs))
              : 0,
          phaseAccMs:
            typeof taskRaw.phaseAccMs === 'number' && Number.isFinite(taskRaw.phaseAccMs)
              ? Math.max(0, Math.floor(taskRaw.phaseAccMs))
              : 0,
          tripUnits:
            typeof taskRaw.tripUnits === 'number' && Number.isFinite(taskRaw.tripUnits)
              ? Math.max(0, Math.floor(taskRaw.tripUnits))
              : 0,
          rvLeft: taskRaw.rvLeft === 1 ? 1 : 0,
          ...(fuelMulOf(taskRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(taskRaw.fuelMul)! } : {}),
        },
      }
    } else if (taskRaw.kind === 'standby') {
      aiCores[a.coreType] += 1
      continue
    } else if (taskRaw.kind === 'expedition') {
      const anomalyId = typeof taskRaw.anomalyId === 'string' ? taskRaw.anomalyId : ''
      if (!anomalyId) continue
      const phaseRaw = taskRaw.phase
      const phase: 'out' | 'battle' | 'back' =
        phaseRaw === 'battle' || phaseRaw === 'back' ? phaseRaw : 'out'
      let battle: BattleState | null = null
      if (phase === 'battle') {
        battle = cleanBattle(taskRaw.battle)
      }
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'expedition',
          anomalyId,
          finishAtGameMs:
            typeof taskRaw.finishAtGameMs === 'number' && Number.isFinite(taskRaw.finishAtGameMs)
              ? Math.max(0, Math.floor(taskRaw.finishAtGameMs))
              : 0,
          outMs:
            typeof taskRaw.outMs === 'number' && Number.isFinite(taskRaw.outMs)
              ? Math.max(0, Math.floor(taskRaw.outMs))
              : 0,
          power:
            typeof taskRaw.power === 'number' && Number.isFinite(taskRaw.power)
              ? Math.max(0, Math.floor(taskRaw.power))
              : 0,
          phase: phase === 'battle' && battle === null ? 'out' : phase,
          battle,
          ...(fuelMulOf(taskRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(taskRaw.fuelMul)! } : {}),
        },
      }
    } else if (taskRaw.kind === 'salvage') {
      const galaxyId = typeof taskRaw.galaxyId === 'string' ? taskRaw.galaxyId : ''
      if (!galaxyId) continue
      const phaseRaw = taskRaw.phase
      const phase: 'outbound' | 'salvaging' | 'returning' =
        phaseRaw === 'outbound' || phaseRaw === 'returning' ? phaseRaw : 'salvaging'
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'salvage',
          galaxyId,
          phase,
          phaseAccMs:
            typeof taskRaw.phaseAccMs === 'number' && Number.isFinite(taskRaw.phaseAccMs)
              ? Math.max(0, Math.floor(taskRaw.phaseAccMs))
              : 0,
          cycleAccMs:
            typeof taskRaw.cycleAccMs === 'number' && Number.isFinite(taskRaw.cycleAccMs)
              ? Math.max(0, Math.floor(taskRaw.cycleAccMs))
              : 0,
          deviceAccMs: {},
          tripM3:
            typeof taskRaw.tripM3 === 'number' && Number.isFinite(taskRaw.tripM3) ? Math.max(0, taskRaw.tripM3) : 0,
          ...(fuelMulOf(taskRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(taskRaw.fuelMul)! } : {}),
        },
      }
    }
  }

  const shipReturns: Record<string, { beltId: string | null; legMs: number; phaseAccMs: number; reason?: 'mining' | 'expedition' | 'salvage' | 'salvageStop' | 'miningStop' }> = {}
  const shipReturnsRaw = asRaw(src.shipReturns)
  for (const [shipKey, retRaw] of Object.entries(shipReturnsRaw)) {
    if (shipKey.length === 0) continue
    if (typeof retRaw !== 'object' || retRaw === null) continue
    const r = asRaw(retRaw)
    const beltId = typeof r.beltId === 'string' && r.beltId.length > 0 ? r.beltId : null
    const legMs =
      typeof r.legMs === 'number' && Number.isFinite(r.legMs) ? Math.max(1, Math.floor(r.legMs)) : 1
    const phaseAccMs =
      typeof r.phaseAccMs === 'number' && Number.isFinite(r.phaseAccMs)
        ? Math.min(legMs, Math.max(0, Math.floor(r.phaseAccMs)))
        : 0
    const reason =
      r.reason === 'expedition'
        ? ('expedition' as const)
        : r.reason === 'mining'
          ? ('mining' as const)
          : r.reason === 'salvage'
            ? ('salvage' as const)
            : r.reason === 'salvageStop'
              ? ('salvageStop' as const)
              : r.reason === 'miningStop'
                ? ('miningStop' as const)
                : undefined
    shipReturns[shipKey] = reason ? { beltId, legMs, phaseAccMs, reason } : { beltId, legMs, phaseAccMs }
  }

  const miningRaw = asRaw(src.mining)
  const phase: 'mining' | 'returning' | 'outbound' =
    miningRaw.phase === 'returning' || miningRaw.phase === 'outbound' ? miningRaw.phase : 'mining'
  const miningShipProgress: NonNullable<GameState['mining']['shipProgress']> = {}
  for (const [id, raw] of Object.entries(asRaw(miningRaw.shipProgress))) {
    const row = asRaw(raw)
    if (!fleet[id] || typeof row.cycleAccMs !== 'number' || !Number.isSafeInteger(row.cycleAccMs) || row.cycleAccMs < 0) continue
    miningShipProgress[id] = { cycleAccMs: Math.floor(row.cycleAccMs as number), rvLeft: row.rvLeft === 1 ? 1 : 0 }
  }
  const mining = {
    active: miningRaw.active === true,
    beltId: typeof miningRaw.beltId === 'string' && miningRaw.beltId.length > 0 ? miningRaw.beltId : null,
    phase,
    cycleAccMs:
      typeof miningRaw.cycleAccMs === 'number' && Number.isFinite(miningRaw.cycleAccMs)
        ? Math.max(0, Math.floor(miningRaw.cycleAccMs))
        : 0,
    phaseAccMs:
      typeof miningRaw.phaseAccMs === 'number' && Number.isFinite(miningRaw.phaseAccMs)
        ? Math.max(0, Math.floor(miningRaw.phaseAccMs))
        : 0,
    tripUnits:
      typeof miningRaw.tripUnits === 'number' && Number.isFinite(miningRaw.tripUnits)
        ? Math.max(0, Math.floor(miningRaw.tripUnits))
        : 0,
    autoCycle: miningRaw.autoCycle !== false,
    stopAfterTrip: miningRaw.stopAfterTrip === true,
    originGalaxy:
      typeof miningRaw.originGalaxy === 'string' && miningRaw.originGalaxy.length > 0
        ? miningRaw.originGalaxy
        : null,
    rvLeft: miningRaw.rvLeft === 1 ? 1 : 0,
    ...(Object.keys(miningShipProgress).length ? { shipProgress: miningShipProgress } : {}),
    ...(fuelMulOf(miningRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(miningRaw.fuelMul)! } : {}),
  }

  const moduleBay: Record<string, number> = {}
  const moduleBayRaw = asRaw(src.moduleBay)
  for (const [key, value] of Object.entries(moduleBayRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      moduleBay[key] = Math.floor(value)
    }
  }

  const learnedRecipes: string[] = []
  const learnedRaw = src.learnedRecipes
  if (Array.isArray(learnedRaw)) {
    for (const bp of learnedRaw) {
      if (typeof bp === 'string' && bp.length > 0 && !learnedRecipes.includes(bp)) learnedRecipes.push(bp)
    }
  }
  const blueprintStock: Record<string, number> = {}
  const bpStockRaw = asRaw(src.blueprintStock)
  for (const [key, value] of Object.entries(bpStockRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      blueprintStock[key] = Math.floor(value)
    }
  }
  if (Array.isArray(src.blueprints)) {
    for (const bp of src.blueprints) {
      if (typeof bp === 'string' && bp.length > 0 && !learnedRecipes.includes(bp)) learnedRecipes.push(bp)
    }
  }
  const shipStore: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.shipStore))) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      shipStore[key] = Math.floor(value)
    }
  }
  const fitPresets: Record<string, ShipFitPreset[]> = {}
  const wormholePreparationTemplates = cleanWormholePreparationTemplates(src.wormholePreparationTemplates)
  const preparationSquads = cleanPreparationSquads(src.preparationSquads)
  const fleetPresets = cleanFleetPresets(src.fleetPresets)
  for (const [defId, listRaw] of Object.entries(asRaw(src.fitPresets))) {
    if (defId.length === 0 || !Array.isArray(listRaw)) continue
    const list: ShipFitPreset[] = []
    for (const itemRaw of listRaw) {
      const item = asRaw(itemRaw)
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, FIT_PRESET_NAME_MAX) : ''
      if (name.length === 0) continue
      const fitRaw = asRaw(item.fitted)
      const fitted = { high: cleanRack(fitRaw.high), mid: cleanRack(fitRaw.mid), low: cleanRack(fitRaw.low) }
      const plugs = cleanPlugIds(item.plugs)
      const droneLoad: Record<string, number> = {}
      for (const [id, n] of Object.entries(asRaw(item.droneLoad))) {
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) droneLoad[id] = Math.floor(n)
      }
      const empty =
        fitted.high.length + fitted.mid.length + fitted.low.length === 0 && Object.keys(droneLoad).length === 0 && !plugs?.length
      if (empty) continue
      list.push({ name, fitted, ...(Object.keys(droneLoad).length > 0 ? { droneLoad } : {}), ...(plugs ? { plugs } : {}) })
      if (list.length >= FIT_PRESET_MAX) break
    }
    if (list.length > 0) fitPresets[defId] = list
  }
  const spentOneTimeRecipes: string[] = []
  if (Array.isArray(src.spentOneTimeRecipes)) {
    for (const bp of src.spentOneTimeRecipes) {
      if (typeof bp === 'string' && bp.length > 0 && !spentOneTimeRecipes.includes(bp)) spentOneTimeRecipes.push(bp)
    }
  }
  const recycleCarry: Record<string, number> = {}
  for (const [id, v] of Object.entries(asRaw(src.recycleCarry))) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    recycleCarry[id] = v % 1
  }

  const marketRaw = asRaw(src.market)
  const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const orderList = (rawList: unknown): Array<{ price: number; qty: number; expiresAtGameMs: number; bm?: number | boolean | null; relay?: { quoteId: string } }> => {
    const out: Array<{ price: number; qty: number; expiresAtGameMs: number; bm?: number | boolean | null; relay?: { quoteId: string } }> = []
    if (!Array.isArray(rawList)) return out
    for (const item of rawList) {
      const o = asRaw(item)
      const qty = Math.floor(num(o.qty))
      const price = Math.floor(num(o.price))
      if (qty <= 0 || price <= 0) continue
      const hasBm = Object.prototype.hasOwnProperty.call(o, 'bm')
      const bmRaw = o.bm
      const bmVal = typeof bmRaw === 'boolean' ? bmRaw : typeof bmRaw === 'number' && Number.isFinite(bmRaw) ? Math.max(0, Math.floor(bmRaw)) : null
      const relayRaw = asRaw(o.relay)
      const relayQuoteId = typeof relayRaw.quoteId === 'string' && relayRaw.quoteId.length > 0 && relayRaw.quoteId.length <= 512 ? relayRaw.quoteId : undefined
      out.push({
        price,
        qty,
        expiresAtGameMs: Math.max(0, Math.floor(num(o.expiresAtGameMs))),
        ...(hasBm ? { bm: bmVal } : {}),
        ...(relayQuoteId ? { relay: { quoteId: relayQuoteId } } : {}),
      })
    }
    return out
  }
  const pools: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.pools))) {
    const p = asRaw(value)
    pools[key] = {
      q: Math.max(0, Math.floor(num(p.q))),
      shock: num(p.shock, 0),
      netVol: num(p.netVol, 0),
      lastHistoryGameMs: Math.max(0, Math.floor(num(p.lastHistoryGameMs))),
      noise: num(p.noise, 0),
      ...(p.limitedSupply !== undefined ? {
        limitedSupply: {
          remaining: Math.max(0, Math.floor(num(asRaw(p.limitedSupply).remaining))),
          refillProgressMs: Math.max(0, Math.floor(num(asRaw(p.limitedSupply).refillProgressMs))),
          ...(asRaw(p.limitedSupply).lastRefillGameMs !== undefined ? {
            lastRefillGameMs: Math.max(0, Math.floor(num(asRaw(p.limitedSupply).lastRefillGameMs))),
          } : {}),
        },
      } : {}),
    }
  }
  const buyBooks: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.npcBuy))) buyBooks[key] = orderList(value)
  const sellBooks: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.npcSell))) sellBooks[key] = orderList(value)
  const digests: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.digest))) {
    const d = asRaw(value)
    const qty = Math.max(0, Math.floor(num(d.qty)))
    if (qty > 0) {
      digests[key] = {
        qty,
        price: Math.max(0, Math.floor(num(d.price))),
        perWindow: Math.max(0, Math.floor(num(d.perWindow))),
      }
    }
  }
  for (const key of Object.keys(pools)) {
    if (!(key in digests)) digests[key] = { qty: 0, price: 0, perWindow: 0 }
  }
  const histories: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.priceHistory))) {
    if (!Array.isArray(value)) continue
    const cleaned: number[] = []
    for (const v of value) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) cleaned.push(Math.round(v))
    }
    if (cleaned.length > 0) histories[key] = cleaned.slice(-PRICE_HISTORY_LIMIT)
  }
  let maxOrderId = 0
  if (Array.isArray(src.orders)) {
    for (const entry of src.orders) {
      if (typeof entry !== 'object' || entry === null) continue
      const o = entry as RawState
      const id = Math.floor(num(o.id))
      if (Number.isFinite(id) && id > maxOrderId) maxOrderId = id
    }
  }
  const relayState = cleanMarketRelayState(marketRaw.relay, Math.max(0, Math.floor(num(src.gameMs))), Math.max(0, num(src.savedAtWallMs)))
  const market = {
    pools: pools as GameState['market']['pools'],
    npcBuy: buyBooks as GameState['market']['npcBuy'],
    npcSell: sellBooks as GameState['market']['npcSell'],
    digest: digests as GameState['market']['digest'],
    lastTickGameMs: Math.max(0, Math.floor(num(marketRaw.lastTickGameMs))),
    orderSeq: Math.max(Math.max(0, Math.floor(num(marketRaw.orderSeq))), maxOrderId),
    priceHistory: histories as GameState['market']['priceHistory'],
    slowDrawLastGameMs:
      typeof marketRaw.slowDrawLastGameMs === 'number' && Number.isFinite(marketRaw.slowDrawLastGameMs)
        ? Math.max(0, Math.floor(marketRaw.slowDrawLastGameMs))
        : undefined,
    ...(relayState ? { relay: relayState } : {}),
  }

  const orders: GameState['orders'] = []
  if (Array.isArray(src.orders)) {
    let fallbackId = 0
    for (const entry of src.orders) {
      if (typeof entry !== 'object' || entry === null) continue
      const o = entry as RawState
      const side = o.side
      if (side !== 'sell' && side !== 'buy') continue
      const qty = Math.floor(num(o.qty))
      if (qty <= 0) continue
      const id = Math.floor(num(o.id, fallbackId))
      fallbackId = Math.max(fallbackId, id)
      orders.push({
        id,
        side,
        good: typeof o.good === 'string' && o.good.length > 0 ? o.good : '',
        price: Math.max(1, Math.floor(num(o.price))),
        qty,
        filled: Math.max(0, Math.floor(num(o.filled))),
        placedAtGameMs: Math.max(0, Math.floor(num(o.placedAtGameMs))),
        absorbCredit: Math.max(0, num(o.absorbCredit)),
        escrowIsk: Math.max(0, Math.floor(num(o.escrowIsk))),
        ...(typeof o.relayId === 'string' && o.relayId.length > 0 && o.relayId.length <= 512 ? { relayId: o.relayId } : {}),
        ...(typeof o.remoteApplied === 'number' && Number.isSafeInteger(o.remoteApplied) && o.remoteApplied > 0 ? { remoteApplied: o.remoteApplied } : {}),
      })
    }
  }

  const escrowItems: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.escrowItems))) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) escrowItems[key] = Math.floor(value)
  }
  const escrowShips: Record<
    number,
    { shipId: string; defId: string; durability: number; customName: string | null; from?: 'fleet' | 'store' }
  > = {}
  for (const [key, value] of Object.entries(asRaw(src.escrowShips))) {
    const id = Number(key)
    const s = asRaw(value)
    const shipId = typeof s.shipId === 'string' && s.shipId.length > 0 ? s.shipId : ''
    if (!Number.isInteger(id) || id <= 0 || !shipId) continue
    escrowShips[id] = {
      shipId,
      defId: typeof s.defId === 'string' && s.defId.length > 0 ? s.defId : uidDefId(shipId),
      durability: Math.min(1, Math.max(0, num(s.durability, 1))),
      customName: cleanCustomName(s.customName),
      ...(s.from === 'store' ? { from: 'store' as const } : {}),
    }
  }

  const manufacturingRuns: GameState['manufacturingRuns'] = []
  let manufacturingSeq = 1
  const legacyLoops: Record<string, { produced: number; goalSum: number; openEnded: boolean }> = {}
  const sanitizeMfRun = (rawRun: unknown): GameState['manufacturingRuns'][number] | null => {
    const r = asRaw(rawRun)
    const bp = typeof r.blueprintId === 'string' && r.blueprintId.length > 0 ? r.blueprintId : null
    if (r.active !== true || bp === null) return null
    const worker =
      r.worker === 'pilot' || r.worker === 'basic' || r.worker === 'gamma' || r.worker === 'beta' || r.worker === 'alpha'
        ? r.worker
        : undefined
    return {
      active: true,
      id: -1,
      blueprintId: bp,
      worker,
      finishAtGameMs: Math.max(0, Math.floor(num(r.finishAtGameMs))),
      durationMs: Math.max(0, Math.floor(num(r.durationMs))),
      ...(r.bookSpent === true ? { bookSpent: true } : {}),
      ...(Array.isArray(r.spentMaterials)
        ? {
            spentMaterials: (r.spentMaterials as unknown[])
              .map((x) => ({ itemId: String(asRaw(x).itemId ?? ''), count: Math.max(0, Math.floor(num(asRaw(x).count))) }))
              .filter((x) => x.itemId.length > 0 && x.count > 0),
          }
        : {}),
    }
  }
  let pilotSeen = false
  const pushMf = (rawRun: unknown): void => {
    const raw = asRaw(rawRun)
    const run = sanitizeMfRun(rawRun)
    if (!run) {
      const w = raw.worker
      if (w === 'basic' || w === 'gamma' || w === 'beta' || w === 'alpha') aiCores[w] = (aiCores[w] ?? 0) + 1
      return
    }
    if (run.worker === 'pilot') {
      if (pilotSeen) return
      pilotSeen = true
    }
    run.id = manufacturingSeq
    manufacturingSeq += 1
    manufacturingRuns.push(run)
    if (raw.autoRepeat === true && run.blueprintId) {
      const cur = (legacyLoops[run.blueprintId] ??= { produced: 0, goalSum: 0, openEnded: false })
      cur.produced += Math.max(0, Math.floor(num(raw.produced)))
      const g = Math.floor(num(raw.repeatGoal))
      if (g > 0) cur.goalSum += g
      else cur.openEnded = true
    }
  }
  if (Array.isArray(src.manufacturingRuns)) { for (const rawRun of src.manufacturingRuns) pushMf(rawRun) }
  if (manufacturingRuns.length === 0 && src.manufacturing !== undefined) { pushMf(src.manufacturing) }
  if (typeof src.manufacturingSeq === 'number' && Number.isFinite(src.manufacturingSeq)) { manufacturingSeq = Math.max(manufacturingSeq, Math.floor(src.manufacturingSeq)) }
  const manufacturingLoops: GameState['manufacturingLoops'] = {}
  for (const [bp, rawLoop] of Object.entries(asRaw(src.manufacturingLoops))) {
    if (typeof bp !== 'string' || bp.length === 0) continue
    const l = asRaw(rawLoop)
    const on = l.on === true
    const goal = Math.floor(num(l.goal))
    const produced = Math.max(0, Math.floor(num(l.produced)))
    const stopWhy = typeof l.stopWhy === 'string' && l.stopWhy.length > 0 ? l.stopWhy : ''
    if (!on && goal <= 0 && produced <= 0 && stopWhy.length === 0) continue
    manufacturingLoops[bp] = {
      on,
      ...(goal > 0 ? { goal } : {}),
      ...(produced > 0 ? { produced } : {}),
      ...(stopWhy.length > 0 ? { stopWhy } : {}),
    }
  }
  for (const [bp, leg] of Object.entries(legacyLoops)) {
    if (manufacturingLoops[bp] !== undefined) continue
    const goal = leg.openEnded ? 0 : leg.goalSum
    manufacturingLoops[bp] = {
      on: true,
      ...(goal > 0 ? { goal } : {}),
      ...(leg.produced > 0 ? { produced: leg.produced } : {}),
    }
  }
  const standings: Record<string, number> = {}
  const standingsRaw = asRaw(src.standings)
  for (const [key, value] of Object.entries(standingsRaw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      standings[key] = Math.round(value)
    }
  }
  const standingsEarned: Record<string, number> = {}
  const earnedRaw = asRaw(src.standingsEarned)
  for (const [key, value] of Object.entries(earnedRaw)) {
    if (typeof value === 'number' && Number.isFinite(value)) standingsEarned[key] = Math.round(value)
  }
  if (Object.keys(earnedRaw).length === 0) {
    for (const [factionId, value] of Object.entries(standings)) standingsEarned[factionId] = value
  }
  const blackboxSeen = src.blackboxSeen === true ? true : src.blackboxSeen === false ? false : undefined
  const expedition = cleanCommandExpedition(src.expedition)

  const logs: LogEntry[] = []
  const logsRaw = src.logs
  if (Array.isArray(logsRaw)) {
    let fallbackId = 0
    for (const entry of logsRaw) {
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as RawState
      const kind = typeof e.kind === 'string' && LOG_KINDS.has(e.kind) ? (e.kind as LogKind) : 'info'
      const textId = typeof e.textId === 'string' && e.textId !== '' ? e.textId : undefined
      const paramsRaw = asRaw(e.textParams)
      const textParams: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(paramsRaw)) {
        if (typeof v === 'string' || typeof v === 'number') textParams[k] = v
      }
      logs.push({
        id: typeof e.id === 'number' && Number.isFinite(e.id) ? Math.floor(e.id) : ++fallbackId,
        atGameMs:
          typeof e.atGameMs === 'number' && Number.isFinite(e.atGameMs) ? Math.floor(e.atGameMs) : 0,
        kind,
        text: typeof e.text === 'string' ? e.text : '',
        ...(textId !== undefined ? { textId } : {}),
        ...(textId !== undefined && Object.keys(textParams).length > 0 ? { textParams } : {}),
      })
    }
  }
  if (logs.length > logCap) logs.splice(0, logs.length - logCap)

  const rngRaw = asRaw(src.rng)
  const rng = {
    seed:
      typeof rngRaw.seed === 'number' && Number.isFinite(rngRaw.seed) ? Math.floor(rngRaw.seed) : FALLBACK_RNG_SEED,
    count:
      typeof rngRaw.count === 'number' && Number.isFinite(rngRaw.count)
        ? Math.max(0, Math.floor(rngRaw.count))
        : 0,
    ...(typeof rngRaw.box === 'number' && Number.isFinite(rngRaw.box)
      ? { box: Math.max(0, Math.floor(rngRaw.box)) }
      : {}),
  }

  const eventsRaw = asRaw(src.events)
  const events = {
    nextAtGameMs:
      typeof eventsRaw.nextAtGameMs === 'number' && Number.isFinite(eventsRaw.nextAtGameMs)
        ? Math.max(0, Math.floor(eventsRaw.nextAtGameMs))
        : 0,
  }

  const exploredSet = new Set<string>([HOME_GALAXY_ID])
  const exploredRaw = src.exploredGalaxies
  if (Array.isArray(exploredRaw)) {
    for (const id of exploredRaw) {
      if (typeof id === 'string' && id.length > 0) exploredSet.add(id)
    }
  }
  const exploredGalaxies = [...exploredSet]

  const scanRaw = asRaw(src.scanning)
  const scanGalaxyId = typeof scanRaw.galaxyId === 'string' && scanRaw.galaxyId.length > 0 ? scanRaw.galaxyId : null
  const legacyScanReturning = scanRaw.returning === true
  const scanActive = scanRaw.active === true && scanGalaxyId !== null && !legacyScanReturning
  const lastGalaxyId =
    typeof scanRaw.lastGalaxyId === 'string' && scanRaw.lastGalaxyId.length > 0 ? scanRaw.lastGalaxyId : null
  const scanning = {
    active: scanActive,
    galaxyId: scanActive ? scanGalaxyId : null,
    finishAtGameMs: scanActive
      ? typeof scanRaw.finishAtGameMs === 'number' && Number.isFinite(scanRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(scanRaw.finishAtGameMs))
        : 0
      : 0,
    startedAtGameMs: scanActive
      ? typeof scanRaw.startedAtGameMs === 'number' && Number.isFinite(scanRaw.startedAtGameMs)
        ? Math.max(0, Math.floor(scanRaw.startedAtGameMs))
        : 0
      : 0,
    originGalaxy:
      typeof scanRaw.originGalaxy === 'string' && scanRaw.originGalaxy.length > 0 ? scanRaw.originGalaxy : null,
    returning: false,
    awaitingView: scanRaw.awaitingView === true || legacyScanReturning,
    lastGalaxyId: lastGalaxyId ?? (legacyScanReturning ? scanGalaxyId : null),
  }

  const awayGalaxy =
    typeof src.awayGalaxy === 'string' && src.awayGalaxy.length > 0 ? src.awayGalaxy : null
  const transitRaw = asRaw(src.transit)
  const transitFrom =
    typeof transitRaw.fromGalaxy === 'string' && transitRaw.fromGalaxy.length > 0 ? transitRaw.fromGalaxy : null
  const transitTo =
    typeof transitRaw.toGalaxy === 'string' && transitRaw.toGalaxy.length > 0 ? transitRaw.toGalaxy : null
  const transit = {
    active: transitRaw.active === true && transitTo !== null,
    fromGalaxy: transitFrom,
    toGalaxy: transitTo,
    finishAtGameMs:
      typeof transitRaw.finishAtGameMs === 'number' && Number.isFinite(transitRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(transitRaw.finishAtGameMs))
        : 0,
    legMs:
      typeof transitRaw.legMs === 'number' && Number.isFinite(transitRaw.legMs)
        ? Math.max(0, Math.floor(transitRaw.legMs))
        : 0,
    delivery: (() => {
      const deliveryRaw = asRaw(transitRaw.active === true ? transitRaw.delivery : undefined)
      if (
        !(
          transitRaw.active === true &&
          typeof deliveryRaw.siteId === 'string' &&
          deliveryRaw.siteId.length > 0 &&
          (deliveryRaw.phase === 'to-site' || deliveryRaw.phase === 'to-station')
        )
      ) {
        return null
      }
      let loaded: Record<string, number> | undefined
      const loadedRaw = asRaw(deliveryRaw.loaded)
      const loadedEntries = Object.entries(loadedRaw)
      if (loadedEntries.length > 0) {
        const out: Record<string, number> = {}
        for (const [k, v] of loadedEntries) {
          if (k.length === 0) continue
          const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
          if (n > 0) out[k] = n
        }
        if (Object.keys(out).length > 0) loaded = out
      }
      return {
        siteId: deliveryRaw.siteId,
        phase: deliveryRaw.phase as 'to-site' | 'to-station',
        ...(loaded !== undefined ? { loaded } : {}),
      }
    })(),
  }
  const stbRaw = asRaw(src.standby)
  const stbGalaxy = typeof stbRaw.galaxyId === 'string' && stbRaw.galaxyId.length > 0 ? stbRaw.galaxyId : null
  const standby = {
    active: stbRaw.active === true && stbGalaxy !== null,
    galaxyId: stbGalaxy,
    finishAtGameMs: Math.max(0, Math.floor(num(stbRaw.finishAtGameMs))),
    legMs: Math.max(0, Math.floor(num(stbRaw.legMs))),
  }
  const haulRaw = asRaw(src.hauling)
  const fleetLeg = cleanHaulFleetLeg(haulRaw.fleetLeg)
  const haulTo = typeof haulRaw.toSiteId === 'string' || haulRaw.toSiteId === null ? haulRaw.toSiteId : null
  const haulFrom = typeof haulRaw.fromSiteId === 'string' || haulRaw.fromSiteId === null ? haulRaw.fromSiteId : null
  const haulA = typeof haulRaw.routeA === 'string' || haulRaw.routeA === null ? haulRaw.routeA : null
  const haulB = typeof haulRaw.routeB === 'string' || haulRaw.routeB === null ? haulRaw.routeB : null
  const hauling = {
    ...(fleetLeg ? { fleetLeg } : {}),
    active: haulRaw.active === true && haulTo !== undefined && (haulRaw.fleetLeg === undefined || fleetLeg !== undefined),
    routeA: haulA ?? null,
    routeB: haulB ?? null,
    fromSiteId: haulFrom ?? null,
    toSiteId: haulTo ?? null,
    legMinutes: Math.max(0, Math.floor(num(haulRaw.legMinutes))),
    legMs: Math.max(0, Math.floor(num(haulRaw.legMs))),
    phaseAccMs: Math.max(0, Math.floor(num(haulRaw.phaseAccMs))),
    tripMul: Math.max(0, num(haulRaw.tripMul)),
    tripLegsLeft: Math.max(0, Math.floor(num(haulRaw.tripLegsLeft))),
  }
  const sanitizeRefineRun = (rawRun: unknown): GameState['refineRuns'][number] | null => {
    const r = asRaw(rawRun)
    const item = typeof r.itemId === 'string' && r.itemId.length > 0 ? r.itemId : null
    if (r.active !== true || item === null) return null
    const worker: GameState['refineRuns'][number]['worker'] =
      r.worker === 'basic' || r.worker === 'gamma' || r.worker === 'beta' || r.worker === 'alpha'
        ? r.worker
        : 'pilot'
    const recRaw = asRaw(r.recAcc)
    const numMap = (m: unknown): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(asRaw(m))) {
        if (k.length === 0) continue
        const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
        if (n > 0) out[k] = n
      }
      return out
    }
    const recAcc =
      r.recipe === 'recycle' &&
      (Object.keys(recRaw).length > 0 ||
        Object.keys(numMap(recRaw.min)).length > 0 ||
        Object.keys(numMap(recRaw.mod)).length > 0 ||
        Object.keys(numMap(recRaw.frag)).length > 0 ||
        Object.keys(numMap(recRaw.drone)).length > 0 ||
        Object.keys(numMap(recRaw.blueprint)).length > 0)
        ? {
            min: numMap(recRaw.min),
            mod: numMap(recRaw.mod),
            frag: numMap(recRaw.frag),
            drone: numMap(recRaw.drone),
            blueprint: numMap(recRaw.blueprint),
          }
        : undefined
    const runOut: GameState['refineRuns'][number] = {
      active: true,
      id: -1,
      worker,
    recipe: r.recipe === 'recycle' ? 'recycle' : r.recipe === 'unbox' ? 'unbox' : 'refine',
      itemId: item,
      batchUnits: Math.max(1, Math.floor(num(r.batchUnits, 10))),
      cycleMs: Math.max(1, Math.floor(num(r.cycleMs, 6_000))),
      finishAtGameMs: Math.max(0, Math.floor(num(r.finishAtGameMs))),
      batchesDone: Math.max(0, Math.floor(num(r.batchesDone))),
    }
    if (recAcc) runOut.recAcc = recAcc
    const lockRaw = num(r.lockUnits, NaN)
    if (Number.isFinite(lockRaw) && lockRaw >= 0) runOut.lockUnits = Math.floor(lockRaw)
    const claimRaw = num(r.claimedUnits, NaN)
    if (Number.isFinite(claimRaw) && claimRaw >= 0) runOut.claimedUnits = Math.floor(claimRaw)
    if (r.rareBoxEligible === true || r.rareBoxEligible === false) runOut.rareBoxEligible = r.rareBoxEligible
    return runOut
  }
  const refineRuns: GameState['refineRuns'] = []
  let refineSeq = 1
  const pushSanitized = (rawRun: unknown): void => {
    const run = sanitizeRefineRun(rawRun)
    if (!run) return
    if (run.worker === 'pilot' && refineRuns.some((x) => x.worker === 'pilot')) return
    run.id = refineSeq
    refineSeq += 1
    refineRuns.push(run)
  }
  if (Array.isArray(src.refineRuns)) {
    for (const rawRun of src.refineRuns) pushSanitized(rawRun)
  }
  if (refineRuns.length === 0 && src.refineRun !== undefined) {
    pushSanitized(src.refineRun)
  }
  if (typeof src.refineSeq === 'number' && Number.isFinite(src.refineSeq)) {
    refineSeq = Math.max(refineSeq, Math.floor(src.refineSeq))
  }
  const bountyCooldowns: Record<string, number> = {}
  const bcRaw = asRaw(src.bountyCooldowns)
  for (const [key, value] of Object.entries(bcRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      bountyCooldowns[key] = Math.floor(value)
    }
  }
  const autoLoopAnomalyId =
    typeof src.autoLoopAnomalyId === 'string' && src.autoLoopAnomalyId.length > 0
      ? src.autoLoopAnomalyId
      : null
  const pendingReturnRaw = asRaw(src.pendingActivityReturn)
  const progressRaw = asRaw(pendingReturnRaw.progress)
  const progressPhase = progressRaw.phase
  const progressFuel = fuelMulOf(progressRaw.fuelMul)
  const progress: WorkReturnProgress | undefined =
    progressPhase === 'mining' || progressPhase === 'salvaging' || progressPhase === 'outbound' || progressPhase === 'returning'
      ? {
          phase: progressPhase,
          phaseAccMs: typeof progressRaw.phaseAccMs === 'number' && Number.isFinite(progressRaw.phaseAccMs)
            ? Math.max(0, Math.floor(progressRaw.phaseAccMs)) : 0,
          ...(progressFuel !== undefined ? { fuelMul: progressFuel } : {}),
          ...(progressRaw.originGalaxy === null || typeof progressRaw.originGalaxy === 'string' && progressRaw.originGalaxy.length > 0
            ? { originGalaxy: progressRaw.originGalaxy as string | null } : {}),
        } : undefined
  const pendingActivityReturn: GameState['pendingActivityReturn'] =
    (pendingReturnRaw.kind === 'mining' || pendingReturnRaw.kind === 'salvaging') &&
    typeof pendingReturnRaw.id === 'string' && pendingReturnRaw.id.length > 0
      ? {
          kind: pendingReturnRaw.kind,
          id: pendingReturnRaw.id,
          ...(progress !== undefined ? { progress } : {}),
        }
      : null
  const haltedBySwitch: { kind: 'mining' | 'salvaging' } | null =
    asRaw(src.haltedBySwitch).kind === 'mining'
      ? { kind: 'mining' }
      : asRaw(src.haltedBySwitch).kind === 'salvaging'
        ? { kind: 'salvaging' }
        : null
  const autoLoopDroneFloor =
    typeof src.autoLoopDroneFloor === 'number' &&
    Number.isFinite(src.autoLoopDroneFloor) &&
    src.autoLoopDroneFloor >= 0
      ? Math.floor(src.autoLoopDroneFloor)
      : null

  const slvRaw = asRaw(src.salvaging)
  const slvGalaxy = typeof slvRaw.galaxyId === 'string' && slvRaw.galaxyId.length > 0 ? slvRaw.galaxyId : null
  const salvageDeviceAccMs: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(slvRaw.deviceAccMs))) {
    if (key.length > 0 && key.length <= 512 && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      salvageDeviceAccMs[key] = Math.floor(value)
  }
  const salvaging: GameState['salvaging'] =
    slvRaw.active === true && slvGalaxy !== null
      ? {
          active: true,
          galaxyId: slvGalaxy,
          phase: slvRaw.phase === 'outbound' || slvRaw.phase === 'returning' ? slvRaw.phase : 'salvaging',
          phaseAccMs: Math.max(0, Math.floor(num(slvRaw.phaseAccMs))),
          cycleAccMs: Math.max(0, Math.floor(num(slvRaw.cycleAccMs))),
          tripM3: Math.max(0, num(slvRaw.tripM3) || 0),
          deviceAccMs: salvageDeviceAccMs,
          ...(slvRaw.deviceClockVersion === 2 ? { deviceClockVersion: 2 as const } : {}),
          autoCycle: slvRaw.autoCycle !== false,
          stopAfterTrip: slvRaw.stopAfterTrip === true,
          ...(typeof slvRaw.targetGroup === 'string' && slvRaw.targetGroup.length > 0
            ? { targetGroup: slvRaw.targetGroup }
            : {}),
          ...(fuelMulOf(slvRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(slvRaw.fuelMul)! } : {}),
        }
      : {
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

  const galaxyWrecks: NonNullable<GameState['galaxyWrecks']> = {}
  const gwRaw = asRaw(src.galaxyWrecks)
  for (const [galaxyId, gw] of Object.entries(gwRaw)) {
    if (galaxyId.length === 0 || typeof gw !== 'object' || gw === null) continue
    const g = asRaw(gw)
    const density = g.density
    const rare = g.rare
    if (typeof density !== 'number' || !Number.isFinite(density) || density < 0) continue
    const rareByRaw = asRaw(g.rareBy)
    const rareBy: Record<string, number> = {}
    for (const [anomalyId, n] of Object.entries(rareByRaw)) {
      if (anomalyId.length === 0) continue
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      rareBy[anomalyId] = Math.floor(n)
    }
    const byGroupRaw = asRaw(g.byGroup)
    const byGroup: Record<string, number> = {}
    for (const [groupKey, v] of Object.entries(byGroupRaw)) {
      if (groupKey.length === 0) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
      byGroup[groupKey] = v
    }
    galaxyWrecks[galaxyId] = {
      density,
      rare: typeof rare === 'number' && Number.isFinite(rare) ? Math.max(0, Math.floor(rare)) : 0,
      ...(Object.keys(rareBy).length > 0 ? { rareBy } : {}),
      ...(Object.keys(byGroup).length > 0 ? { byGroup } : {}),
    }
  }

  const weekendWrecks: NonNullable<GameState['weekendWrecks']> = {}
  for (const [galaxyId, w] of Object.entries(asRaw(src.weekendWrecks))) {
    if (galaxyId.length === 0) continue
    const record = normalizeWeekendWreckRecord(w)
    if (Object.keys(record.byFamily).length > 0) weekendWrecks[galaxyId] = record
  }

  const shipWrecks: NonNullable<GameState['shipWrecks']> = {}
  for (const [shipId, wRaw] of Object.entries(asRaw(src.shipWrecks))) {
    if (shipId.length === 0) continue
    const r = asRaw(wRaw)
    const galaxyId = typeof r.galaxyId === 'string' ? r.galaxyId : ''
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 120) : ''
    const density = num(r.density)
    const accRaw = r.decayAccMs
    if (galaxyId.length === 0 || name.length === 0) continue
    if (typeof accRaw !== 'number' || !Number.isFinite(accRaw) || accRaw < 0) continue
    if (!Number.isFinite(density) || density <= 0) continue
    const fitRaw = asRaw(r.fitted)
    const fitted: FittedModules = {
      high: cleanRack(fitRaw.high),
      mid: cleanRack(fitRaw.mid),
      low: cleanRack(fitRaw.low),
    }
    const droneLoad: Record<string, number> = {}
    for (const [droneId, n] of Object.entries(asRaw(r.droneLoad))) {
      if (droneId.length === 0) continue
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      droneLoad[droneId] = Math.floor(n)
    }
    const defId = typeof r.defId === 'string' && r.defId.length > 0 ? r.defId : undefined
    const durability = typeof r.durability === 'number' && Number.isFinite(r.durability) ? r.durability : undefined
    const armorPct = typeof r.armorPct === 'number' && Number.isFinite(r.armorPct) ? r.armorPct : undefined
    const reinforceChance =
      typeof r.reinforceChance === 'number' && Number.isFinite(r.reinforceChance) && r.reinforceChance > 0
        ? r.reinforceChance
        : undefined
    const wreckPlugs = cleanPlugIds(r.plugs)
    shipWrecks[shipId] = {
      seq: num(r.seq),
      galaxyId,
      shipId,
      name,
      ...(r.recoveryRules === 2 ? { recoveryRules: 2 as const } : {}),
      ...(r.equipmentRolled === true ? { equipmentRolled: true } : {}),
      ...(r.customName !== undefined ? { customName: cleanCustomName(r.customName) } : {}),
      ...(cleanShipDamage(r.damagePlugs) ? { damagePlugs: cleanShipDamage(r.damagePlugs) } : {}),
      ...(defId !== undefined ? { defId } : {}),
      fitted,
      ...(Object.keys(droneLoad).length > 0 ? { droneLoad } : {}),
      ...(wreckPlugs !== undefined ? { plugs: wreckPlugs } : {}),
      ...(durability !== undefined ? { durability } : {}),
      ...(armorPct !== undefined ? { armorPct } : {}),
      ...(reinforceChance !== undefined ? { reinforceChance } : {}),
      ...(r.hullRolled === true ? { hullRolled: true } : {}),
      ...(r.pityUsed === true ? { pityUsed: true } : {}),
      density,
      decayAccMs: accRaw,
      createdAtWallMs: num(r.createdAtWallMs),
    }
  }

  const rareOpenedUnits: Record<string, number> = {}
  for (const [itemId, n] of Object.entries(asRaw(src.rareOpenedUnits))) {
    if (itemId.length === 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    rareOpenedUnits[itemId] = Math.floor(n)
  }
  const rareBoxesOpened: Record<string, number> = {}
  for (const [itemId, n] of Object.entries(asRaw(src.rareBoxesOpened))) {
    if (itemId.length === 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    rareBoxesOpened[itemId] = Math.floor(n)
  }
  const rareBurnUnits: Record<string, number> = {}
  for (const [itemId, n] of Object.entries(asRaw(src.rareBurnUnits))) {
    if (itemId.length === 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    rareBurnUnits[itemId] = Math.floor(n)
  }

  const encRaw = asRaw(src.encounter)
  const encShipId = typeof encRaw.shipId === 'string' && encRaw.shipId.length > 0 ? encRaw.shipId : null
  const encGalaxy = typeof encRaw.galaxyId === 'string' && encRaw.galaxyId.length > 0 ? encRaw.galaxyId : null
  const pirateSnapshot = cleanPirateEncounter(encRaw.pirate)
  const encounterBattle = cleanBattle(encRaw.battle)
  if (pirateSnapshot && encounterBattle) encounterBattle.foeOverride = { generatedCard: pirateSnapshot.card }
  const encounter: GameState['encounter'] =
    encRaw.active === true && encShipId !== null && encGalaxy !== null && (encRaw.pirate === undefined || !!pirateSnapshot && !!encounterBattle?.foeOverride?.generatedCard)
      ? {
          active: true,
          shipId: encShipId,
          ...(encRaw.automatic === true ? { automatic: true as const } : {}),
          ...(pirateSnapshot ? { pirate: pirateSnapshot } : {}),
          ...(typeof encRaw.foeStrengthMul === 'number' && Number.isFinite(encRaw.foeStrengthMul) && encRaw.foeStrengthMul > 0 ? { foeStrengthMul: encRaw.foeStrengthMul } : {}),
          galaxyId: encGalaxy,
          name: typeof encRaw.name === 'string' && encRaw.name.length > 0 ? encRaw.name : '巡逻队',
          threat: Math.max(1, Math.floor(num(encRaw.threat, 10))),
          anomalyId: typeof encRaw.anomalyId === 'string' && encRaw.anomalyId.length > 0 ? encRaw.anomalyId : null,
          origin: typeof encRaw.origin === 'string' ? encRaw.origin : '',
          invitedAtGameMs: Math.max(0, Math.floor(num(encRaw.invitedAtGameMs))),
          deadlineGameMs: Math.max(0, Math.floor(num(encRaw.deadlineGameMs))),
          battle: encounterBattle,
        }
      : {
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
        }
  const lowSecNotified = src.lowSecNotified === true
  const lowSecPresence: Record<string, number> = {}
  const encounterZoneCooldown: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.encounterZoneCooldown))) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      encounterZoneCooldown[key] = Math.floor(value)
    }
  }

  const stationSites: Record<string, { stage: number; delivered: Record<string, number> }> = {}
  const sitesRaw = asRaw(src.stationSites)
  for (const [siteId, siteRaw] of Object.entries(sitesRaw)) {
    if (siteId.length === 0 || typeof siteRaw !== 'object' || siteRaw === null) continue
    const s = asRaw(siteRaw)
    const stageRaw = s.stage
    const stage = typeof stageRaw === 'number' && Number.isFinite(stageRaw) ? Math.min(3, Math.max(0, Math.floor(stageRaw))) : 0
    const delivered: Record<string, number> = {}
    const delRaw = asRaw(s.delivered)
    for (const [itemId, value] of Object.entries(delRaw)) {
      if (itemId.length === 0) continue
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) delivered[itemId] = Math.floor(value)
    }
    stationSites[siteId] = { stage, delivered }
  }
  const dockedSite =
    typeof src.dockedSite === 'string' && src.dockedSite.length > 0 ? src.dockedSite : null
  const dialogueSeen: Record<string, boolean> = {}
  const seenRaw = asRaw(src.dialogueSeen)
  for (const [key, value] of Object.entries(seenRaw)) {
    if (value === true) dialogueSeen[key] = true
  }
  const pendingDialogue =
    typeof src.pendingDialogue === 'string' && src.pendingDialogue.length > 0 ? src.pendingDialogue : null
  const commsDelivered: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.commsDelivered))) {
    if (key.length === 0) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    commsDelivered[key] = Math.floor(value)
  }
  const commsRead: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(asRaw(src.commsRead))) {
    if (key.length === 0) continue
    if (value === true) commsRead[key] = true
  }
  const wreckLog: NonNullable<GameState['wreckLog']> = []
  for (const raw of Array.isArray(src.wreckLog) ? src.wreckLog : []) {
    if (wreckLog.length >= WRECK_LOG_MAX) break
    const r = asRaw(raw)
    const shipId = typeof r.shipId === 'string' ? r.shipId : ''
    const shipName = typeof r.shipName === 'string' ? r.shipName.trim().slice(0, 120) : ''
    const cause = r.cause
    if (shipId.length === 0 || shipName.length === 0) continue
    if (
      cause !== 'expedition-lost' &&
      cause !== 'ai-lost' &&
      cause !== 'wormhole-sunk' &&
      cause !== 'wormhole-lost' &&
      cause !== 'encounter-lost'
    ) {
      continue
    }
    const atGameMs = num(r.atGameMs)
    if (!Number.isFinite(atGameMs) || atGameMs < 0) continue
    const fitRaw = asRaw(r.fitted)
    const fitted: FittedModules = {
      high: cleanRack(fitRaw.high),
      mid: cleanRack(fitRaw.mid),
      low: cleanRack(fitRaw.low),
    }
    const droneLoad: Record<string, number> = {}
    for (const [droneId, n] of Object.entries(asRaw(r.droneLoad))) {
      if (droneId.length === 0) continue
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      droneLoad[droneId] = Math.floor(n)
    }
    const defId = typeof r.defId === 'string' && r.defId.length > 0 ? r.defId : undefined
    const galaxyId = typeof r.galaxyId === 'string' && r.galaxyId.length > 0 ? r.galaxyId : undefined
    const depthRaw = r.wormholeDepth
    const wormholeDepth =
      typeof depthRaw === 'number' && Number.isFinite(depthRaw) && depthRaw >= 1 ? Math.floor(depthRaw) : undefined
    const wreckGalaxyId = typeof r.wreckGalaxyId === 'string' && r.wreckGalaxyId.length > 0 ? r.wreckGalaxyId : undefined
    const logPlugs = cleanPlugIds(r.plugs)
    wreckLog.push({
      seq: num(r.seq),
      shipId,
      shipName,
      ...(defId !== undefined ? { defId } : {}),
      cause,
      ...(galaxyId !== undefined ? { galaxyId } : {}),
      ...(wormholeDepth !== undefined ? { wormholeDepth } : {}),
      atGameMs,
      fitted,
      ...(logPlugs !== undefined ? { plugs: logPlugs } : {}),
      ...(cleanShipDamage(r.damagePlugs) ? { damagePlugs: cleanShipDamage(r.damagePlugs) } : {}),
      ...(Object.keys(droneLoad).length > 0 ? { droneLoad } : {}),
      ...(wreckGalaxyId !== undefined ? { wreckGalaxyId } : {}),
      ...(r.recovered === true ? { recovered: true } : {}),
    })
  }
  const commsInstance: Record<string, CommsInstanceEntry> = {}
  for (const [key, value] of Object.entries(asRaw(src.commsInstance))) {
    if (key.length === 0) continue
    const e = asRaw(value)
    const subjectId = typeof e.subjectId === 'string' ? e.subjectId : ''
    const bodyIds = (Array.isArray(e.bodyIds) ? e.bodyIds : []).filter((x): x is string => typeof x === 'string' && x.length > 0)
    const paragraphs = (Array.isArray(e.paragraphs) ? e.paragraphs : []).filter(
      (x): x is string => typeof x === 'string',
    )
    if (subjectId.length === 0 || bodyIds.length === 0 || paragraphs.length === 0) continue
    const paramsRaw = asRaw(e.params)
    const params: Record<string, string | number> = {}
    for (const [pk, pv] of Object.entries(paramsRaw)) {
      if (typeof pv === 'string' || (typeof pv === 'number' && Number.isFinite(pv))) params[pk] = pv
    }
    const rewards: CommsRewardLine[] = []
    for (const item of Array.isArray(e.rewards) ? e.rewards : []) {
      const r = asRaw(item)
      if (typeof r.isk === 'number' && Number.isFinite(r.isk) && r.isk >= 0) {
        rewards.push({ isk: Math.floor(r.isk) })
        continue
      }
      if (typeof r.itemId !== 'string' || r.itemId.length === 0) continue
      const qty = typeof r.qty === 'number' && Number.isFinite(r.qty) ? Math.max(1, Math.floor(r.qty)) : 1
      rewards.push({ itemId: r.itemId, qty })
    }
    const hintRaw = asRaw(e.hint)
    const hintText = typeof hintRaw.text === 'string' && hintRaw.text.length > 0 ? hintRaw.text : ''
    const hintAction = typeof hintRaw.action === 'string' && hintRaw.action.length > 0 ? hintRaw.action : undefined
    const hintPage = typeof hintRaw.page === 'string' && hintRaw.page.length > 0 ? (hintRaw.page as CommsJumpPage) : undefined
    commsInstance[key] = {
      id: key,
      factionId: typeof e.factionId === 'string' ? e.factionId : '',
      ...(typeof e.deptId === 'string' && e.deptId.length > 0 ? { deptId: e.deptId } : {}),
      ...(typeof e.kind === 'string' && e.kind.length > 0 ? { kind: e.kind as CommsKind } : {}),
      atGameMs: typeof e.atGameMs === 'number' && Number.isFinite(e.atGameMs) ? Math.max(0, Math.floor(e.atGameMs)) : 0,
      subject: typeof e.subject === 'string' ? e.subject : '',
      subjectId,
      paragraphs,
      bodyIds,
      ...(Object.keys(params).length > 0 ? { params } : {}),
      ...(hintText.length > 0
        ? { hint: { text: hintText, ...(hintAction !== undefined ? { action: hintAction } : {}), ...(hintPage !== undefined ? { page: hintPage } : {}) } }
        : {}),
      ...(rewards.length > 0 ? { rewards } : {}),
    }
  }

  const scanLimit = maxScanWindowMs()
  const scanProgressRaw = asRaw(src.scanProgress)
  const scanProgress: Record<string, number> = {}
  for (const [key, value] of Object.entries(scanProgressRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      scanProgress[key] = Math.min(scanLimit, Math.floor(value))
    }
  }

  const debugQuick = src.debugQuick === true

  const whScanRaw = asRaw(src.wormholeScan)
  const whScanProgressRaw = num(whScanRaw.progressMs)
  const wormholeScan = {
    active: whScanRaw.active === true,
    progressMs:
      Number.isFinite(whScanProgressRaw) && whScanProgressRaw > 0
        ? Math.min(WORMHOLE_SCAN_BASE_MS, Math.floor(whScanProgressRaw))
        : 0,
    ...(whScanRaw.welcomed === true ? { welcomed: true } : {}),
  }
  const wormholeStock: Array<{
    id: string
    expeditionRules?: number
    seed: number
    depth: number
    archetype: WormholeArchetype
    family: WormholeFamily
    foundAtGameMs: number
  }> = []
  const whStockRaw = Array.isArray(src.wormholeStock) ? src.wormholeStock : []
  for (const item of whStockRaw) {
    if (wormholeStock.length >= WORMHOLE_STOCK_MAX_HARD) break
    const o = asRaw(item)
    const id = typeof o.id === 'string' ? o.id : ''
    const seed = Math.floor(num(o.seed))
    if (id.length === 0 || !Number.isFinite(seed) || seed <= 0) continue
    wormholeStock.push({
      id,
      ...(o.expeditionRules === undefined ? {} : { expeditionRules: Number.isSafeInteger(o.expeditionRules) && num(o.expeditionRules) > 0 ? num(o.expeditionRules) : 999 }),
      seed,
      depth: 1,
      archetype: WORMHOLE_ARCHETYPES.includes(o.archetype as WormholeArchetype)
        ? (o.archetype as WormholeArchetype)
        : wormholeArchetypeOf(seed),
      family: WORMHOLE_FAMILY_ORDER.includes(o.family as WormholeFamily)
        ? (o.family as WormholeFamily)
        : wormholeFamilyOfSeed(seed),
      foundAtGameMs: Number.isFinite(num(o.foundAtGameMs)) ? Math.max(0, Math.floor(num(o.foundAtGameMs))) : 0,
    })
  }

  const wormholeAuto: NonNullable<GameState['wormholeAuto']> = []
  for (const item of Array.isArray(src.wormholeAuto) ? src.wormholeAuto : []) {
    const o = asRaw(item)
    const id = typeof o.id === 'string' ? o.id : ''
    const stockId = typeof o.stockId === 'string' ? o.stockId : ''
    if (id.length === 0 || stockId.length === 0) continue
    const seed = Math.floor(num(o.seed))
    const depth = Math.floor(num(o.depth))
    const pool: string[] = []
    for (const sid of Array.isArray(o.shipIds) ? o.shipIds : []) {
      if (typeof sid === 'string' && sid.length > 0 && !pool.includes(sid)) pool.push(sid)
    }
    const live = pool.filter((sid) => fleet[sid] !== undefined)
    if (live.length === 0) continue
    const started = Math.floor(num(o.startedAtGameMs))
    const finish = Math.floor(num(o.finishAtGameMs))
    const expeditionSnapshot = (() => {
      if (o.expeditionRules !== 2 || typeof o.expeditionSnapshot !== 'string') return undefined
      try {
        const snapshot = asRaw(JSON.parse(o.expeditionSnapshot))
        const wh = asRaw(asRaw(snapshot.wormhole).run)
        if (wh.expeditionRules !== 2 || wh.supplyVersion !== 1) return undefined
        snapshot.wormholeAuto = []
        const normalized = normalizeState(snapshot)
        if (!normalized.wormhole.run || normalized.wormhole.run.fleet.some(uid => !live.includes(uid))) return undefined
        return JSON.stringify(normalized)
      } catch { return undefined }
    })()
    const estimate = o.estimateRules === 1 ? cleanSignalAutoEstimate(o.estimate) : undefined
    wormholeAuto.push({
      ...(o.estimateRules !== undefined ? { estimateRules: typeof o.estimateRules === 'number' && Number.isSafeInteger(o.estimateRules) ? o.estimateRules : -1 } : {}),
      ...(estimate ? { estimate } : {}),
      ...(typeof o.yieldMul === 'number' && [0.6, 0.7, 0.8].includes(o.yieldMul) ? { yieldMul: o.yieldMul } : {}),
      ...(o.haulerFittingVersion === 1 ? { haulerFittingVersion: 1 as const } : {}),
      id,
      stockId,
      seed: Number.isFinite(seed) && seed > 0 ? seed : 1,
      depth: Number.isFinite(depth) ? Math.min(9, Math.max(1, depth)) : 1,
      shipIds: live.slice(0, WORMHOLE_AUTO_MAX_SHIPS),
      startedAtGameMs: Number.isFinite(started) ? Math.max(0, started) : 0,
      finishAtGameMs: Number.isFinite(finish) ? Math.max(0, finish) : 0,
      ...(o.expeditionRules !== undefined ? { expeditionRules: typeof o.expeditionRules === 'number' && Number.isSafeInteger(o.expeditionRules) ? o.expeditionRules : -1 } : {}),
      ...(expeditionSnapshot !== undefined ? { expeditionSnapshot } : {}),
      ...(WORMHOLE_FAMILY_ORDER.includes(o.family as WormholeFamily) ? { family: o.family as WormholeFamily } : {}),
      ...(WORMHOLE_ARCHETYPES.includes(o.archetype as WormholeArchetype) ? { archetype: o.archetype as WormholeArchetype } : {}),
    })
  }
  const wormholeAutoReports: NonNullable<GameState['wormholeAutoReports']> = []
  for (const item of Array.isArray(src.wormholeAutoReports) ? src.wormholeAutoReports : []) {
    if (wormholeAutoReports.length >= WORMHOLE_AUTO_REPORT_MAX) break
    const o = asRaw(item)
    const id = typeof o.id === 'string' ? o.id : ''
    if (id.length === 0) continue
    const gains: Array<{ itemId: string; units: number }> = []
    for (const g of Array.isArray(o.gains) ? o.gains : []) {
      const go = asRaw(g)
      const itemId = typeof go.itemId === 'string' ? go.itemId : ''
      const units = Math.floor(num(go.units))
      if (itemId.length === 0 || !Number.isFinite(units) || units <= 0) continue
      gains.push({ itemId, units })
    }
    const damage: typeof wormholeAutoReports[number]['damage'] = []
    for (const d of Array.isArray(o.damage) ? o.damage : []) {
      const dobj = asRaw(d)
      const shipId = typeof dobj.shipId === 'string' ? dobj.shipId : ''
      if (shipId.length === 0) continue
      const clampPct = (v: unknown): number => {
        const n = Math.floor(num(v))
        return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
      }
      damage.push({
        shipId,
        name: typeof dobj.name === 'string' && dobj.name.length > 0 ? dobj.name : shipId,
        durabilityLossPct: clampPct(dobj.durabilityLossPct),
        armorLossPct: clampPct(dobj.armorLossPct),
        durabilityPct: clampPct(dobj.durabilityPct),
        armorPct: clampPct(dobj.armorPct),
      })
    }
    const shipIds: string[] = []
    for (const sid of Array.isArray(o.shipIds) ? o.shipIds : []) {
      if (typeof sid === 'string' && sid.length > 0 && !shipIds.includes(sid)) shipIds.push(sid)
    }
    const depth = Math.floor(num(o.depth))
    const signalAuto = o.expeditionRules === undefined && o.signalAuto !== undefined
      ? cleanSignalAutoReportDetails(o.signalAuto)
      : undefined
    const reportTotals = new Map<string, number>()
    for (const layer of signalAuto?.layers ?? []) for (const gain of layer.gains)
      reportTotals.set(gain.itemId, (reportTotals.get(gain.itemId) ?? 0) + gain.units)
    const signalAutoMatchesGains = signalAuto !== undefined && reportTotals.size === gains.length
      && gains.every(gain => reportTotals.get(gain.itemId) === gain.units)
    wormholeAutoReports.push({
      id,
      stockId: typeof o.stockId === 'string' ? o.stockId : '',
      depth: Number.isFinite(depth) ? o.expeditionRules === 2 ? Math.max(1, depth) : Math.min(9, Math.max(1, depth)) : 1,
      finishedAtGameMs: Number.isFinite(num(o.finishedAtGameMs)) ? Math.max(0, Math.floor(num(o.finishedAtGameMs))) : 0,
      shipIds,
      coresReleased: o.expeditionRules === undefined ? 0 : 1,
      gains,
      ...(signalAutoMatchesGains ? { signalAuto } : {}),
      ...(Array.isArray(o.cores) ? { cores: o.cores.flatMap<{ type: 'gamma' | 'beta' | 'alpha'; n: number }>(value => {
        const core = asRaw(value)
        return (core.type === 'gamma' || core.type === 'beta' || core.type === 'alpha')
          && typeof core.n === 'number' && Number.isSafeInteger(core.n) && core.n > 0
          ? [{ type: core.type, n: core.n }] : []
      }).slice(0, 3) } : {}),
      damage,
      confirmed: o.confirmed === true,
      ...(o.expeditionRules === 2 ? {
        expeditionRules: 2,
        shipsLost: Array.isArray(o.shipsLost) ? o.shipsLost.filter((id): id is string => typeof id === 'string') : [],
        simulationMs: Math.max(0, num(o.simulationMs)),
        suppliesReturned: Object.fromEntries(Object.entries(asRaw(o.suppliesReturned)).filter(([, n]) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0)) as Record<string, number>,
        suppliesFound: Object.fromEntries(Object.entries(asRaw(o.suppliesFound)).filter(([, n]) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0)) as Record<string, number>,
        expeditionGoal: cleanWormholeExpeditionRun({ expeditionRules: 2, expeditionGoal: o.expeditionGoal }).expeditionGoal,
        expeditionProgress: cleanWormholeExpeditionRun({ expeditionRules: 2, expeditionProgress: o.expeditionProgress }).expeditionProgress,
      } : {}),
    })
  }

  const commsPopups: string[] = []
  for (const id of Array.isArray(src.commsPopups) ? src.commsPopups : []) {
    if (typeof id === 'string' && id.length > 0 && !commsPopups.includes(id)) commsPopups.push(id)
  }

  const ambushRetreatSeen =
    src.ambushRetreatSeen === true ? true : src.ambushRetreatSeen === false ? false : undefined

  const firstShipBuilt =
    src.firstShipBuilt === true ? true : src.firstShipBuilt === false ? false : undefined
  const labOpened = src.labOpened === true ? true : src.labOpened === false ? false : undefined
  const resupplyFromWarehouse =
    src.resupplyFromWarehouse === true ? true : src.resupplyFromWarehouse === false ? false : undefined
  const modeChosen = src.modeChosen === true ? true : undefined
  const jumpFuel: NonNullable<GameState['jumpFuel']> = {}
  for (const key of ['mine', 'salvage', 'expedition', 'ai'] as const) {
    if (asRaw(src.jumpFuel)[key] === true) jumpFuel[key] = true
  }
  const labRuns: NonNullable<GameState['labRuns']> = []
  for (const raw of Array.isArray(src.labRuns) ? src.labRuns : []) {
    const r = asRaw(raw)
    const recipeId = typeof r.recipeId === 'string' ? r.recipeId : ''
    const worker = validCoreType(r.worker) || r.worker === 'pilot' ? (r.worker as 'pilot' | AiCoreType) : null
    if (recipeId.length === 0 || worker === null) continue
    labRuns.push({
      active: r.active !== false,
      id: Math.max(0, Math.floor(num(r.id) || 0)),
      worker,
      recipeId,
      batchUnits: Math.max(1, Math.floor(num(r.batchUnits) || 0)),
      ...(r.deliveryBlocked === true ? { deliveryBlocked: true } : {}),
      cycleMs: Math.max(1, Math.floor(num(r.cycleMs) || 0)),
      finishAtGameMs: Math.max(0, Math.floor(num(r.finishAtGameMs) || 0)),
      ...(Array.isArray(r.spentMaterials)
        ? {
            spentMaterials: (r.spentMaterials as unknown[])
              .map((x) => {
                const o = asRaw(x)
                const itemId = typeof o.itemId === 'string' ? o.itemId : ''
                return { itemId, count: Math.max(0, Math.floor(num(o.count) || 0)) }
              })
              .filter((x) => x.itemId.length > 0 && x.count > 0),
          }
        : {}),
    })
  }
  const labSeq = Math.max(1, Math.floor(num(src.labSeq) || 1))
  const labLoops: NonNullable<GameState['labLoops']> = {}
  for (const [rc, rawLoop] of Object.entries(asRaw(src.labLoops))) {
    const o = asRaw(rawLoop)
    const goal = Math.max(0, Math.floor(num(o.goal) || 0))
    labLoops[rc] = {
      on: o.on === true,
      ...(goal > 0 ? { goal } : {}),
      produced: Math.max(0, Math.floor(num(o.produced) || 0)),
      ...(typeof o.stopWhy === 'string' && o.stopWhy.length > 0 ? { stopWhy: o.stopWhy } : {}),
    }
  }
  const skillBoostUntilMs = Math.max(0, Math.floor(num(src.skillBoostUntilMs) || 0))
  const boostAutoRenew = src.boostAutoRenew === true
  const winRecord: Record<string, { desireM: number; remainPct: number }> = {}
  for (const [anomalyId, rec] of Object.entries(asRaw(src.winRecord))) {
    if (anomalyId.length === 0 || typeof rec !== 'object' || rec === null) continue
    const r = asRaw(rec)
    const desireM = r.desireM
    const remainPct = r.remainPct
    if (typeof desireM !== 'number' || !Number.isFinite(desireM) || desireM <= 0) continue
    if (typeof remainPct !== 'number' || !Number.isFinite(remainPct)) continue
    winRecord[anomalyId] = { desireM, remainPct: Math.min(1, Math.max(0, remainPct)) }
  }
  const foeShipSeen: Record<string, true> = {}
  for (const [k, v] of Object.entries(asRaw(src.foeShipSeen))) if (v === true) foeShipSeen[k] = true

  const completedBounties: string[] = []
  const cbRaw = src.completedBounties
  if (Array.isArray(cbRaw)) {
    for (const id of cbRaw) {
      if (typeof id === 'string' && id.length > 0 && !completedBounties.includes(id)) completedBounties.push(id)
    }
  }

  const onboardingRaw = asRaw(src.onboarding)
  const stepRaw = onboardingRaw.step
  const onboardingStep = stepRaw === 0 ? 0 : 99
  const onboarding = { step: onboardingStep }
  const importantTasks: GameState['importantTasks'] = {}
  const itRaw = asRaw(src.importantTasks)
  for (const [key, value] of Object.entries(itRaw)) {
    if (key.length === 0) continue
    const r = asRaw(value)
    importantTasks[key] = {
      done: r.done === true,
      delivered: typeof r.delivered === 'number' && Number.isFinite(r.delivered) ? Math.max(0, Math.floor(r.delivered)) : undefined,
      ...(r.allExplored === true ? { allExplored: true } : {}),
      ...(r.started === true ? { started: true } : {}),
    }
  }

  const firstStats: NonNullable<GameState['firstStats']> = {}
  const fsRaw = asRaw(src.firstStats)
  for (const [key, value] of Object.entries(fsRaw)) {
    if (key.length === 0) continue
    const n = num(value)
    if (!Number.isFinite(n) || n <= 0) continue
    firstStats[key] = Math.floor(n)
  }

  const firstTaskSeenIdRaw = src.firstTaskSeenId
  const firstTaskSeenId = typeof firstTaskSeenIdRaw === 'string' && firstTaskSeenIdRaw.length > 0 ? firstTaskSeenIdRaw : undefined
  const firstTaskReadyIdRaw = src.firstTaskReadyId
  const firstTaskReadyId = typeof firstTaskReadyIdRaw === 'string' && firstTaskReadyIdRaw.length > 0 ? firstTaskReadyIdRaw : undefined
  const ironmanRaw = asRaw(src.ironman)
  const ironmanSeqRaw = num(ironmanRaw.seq)
  const ironman: GameState['ironman'] = {
    on: ironmanRaw.on === true,
    seq: Number.isFinite(ironmanSeqRaw) && ironmanSeqRaw > 0 ? Math.floor(ironmanSeqRaw) : 0,
    ...(Number.isFinite(num(ironmanRaw.sinceWallMs)) && num(ironmanRaw.sinceWallMs) > 0
      ? { sinceWallMs: Math.floor(num(ironmanRaw.sinceWallMs)) }
      : {}),
    ...(Number.isFinite(num(ironmanRaw.closedWallMs)) && num(ironmanRaw.closedWallMs) > 0
      ? { closedWallMs: Math.floor(num(ironmanRaw.closedWallMs)) }
      : {}),
  }

  const weekendRaw = asRaw(src.weekendEvent)
  const weekendStr = (v: unknown): string => (typeof v === 'string' && v.length > 0 ? v : '')
  const weekendNum = (v: unknown): number => (Number.isFinite(num(v)) && num(v) > 0 ? Math.floor(num(v)) : 0)
  const weekendKeep = (v: unknown): number | undefined => {
    const n = num(v)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
  }
  const reclaimPaid: string[] = []
  if (Array.isArray(weekendRaw.reclaimPaid)) {
    for (const x of weekendRaw.reclaimPaid) {
      if (typeof x === 'string' && x.length > 0 && !reclaimPaid.includes(x)) reclaimPaid.push(x)
    }
  }
  const reclaimPendingRaw = asRaw(weekendRaw.reclaimPending)
  const reclaimPending = {
    isk: Math.max(0, Math.floor(num(reclaimPendingRaw.isk) || 0)),
    wreck: Math.max(0, Math.floor(num(reclaimPendingRaw.wreck) || 0)),
  }
  const rewardLedger = ((): NonNullable<GameState['weekendEvent']>['rewardLedger'] => {
    const raw = asRaw(weekendRaw.rewardLedger)
    if (Object.keys(raw).length === 0) return undefined
    const byGalaxy: Record<string, { isk: number; wreck: number }> = {}
    for (const [gid, v] of Object.entries(asRaw(raw.byGalaxy))) {
      if (gid.length === 0) continue
      const g = asRaw(v)
      byGalaxy[gid] = {
        isk: Math.max(0, Math.floor(num(g.isk) || 0)),
        wreck: Math.max(0, Math.floor(num(g.wreck) || 0)),
      }
    }
    return {
      isk: weekendKeep(raw.isk) ?? 0,
      wreck: weekendKeep(raw.wreck) ?? 0,
      blackBox: weekendKeep(raw.blackBox) ?? 0,
      byGalaxy,
    }
  })()
  const weekendCoreId = weekendStr(weekendRaw.coreId)
  const weekendStartedAt = weekendNum(weekendRaw.startedAtWallMs)
  const contributedRaw = asRaw(weekendRaw.contributed)
  const contributed: Record<string, number> = {}
  for (const [k, v] of Object.entries(contributedRaw)) {
    const n = num(v)
    if (k.length > 0 && Number.isFinite(n) && n > 0) contributed[k] = Math.min(1, n)
  }
  const weekendEvent: GameState['weekendEvent'] =
    weekendCoreId && weekendStartedAt > 0
      ? (() => {
          const hpMax = weekendNum(weekendRaw.flagshipHpMax)
          const continuousHp = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
          const hpDone = continuousHp(weekendRaw.flagshipHpDone)
          const hpRecovered = continuousHp(weekendRaw.flagshipHpRecovered)
          const settledRuns = Array.isArray(weekendRaw.flagshipSettledRuns)
            ? [...new Set(weekendRaw.flagshipSettledRuns.filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0))] : undefined
          const strictKeep = (v: unknown): number | undefined =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined
          const drainedLegacy = strictKeep(weekendRaw.octopusDrainedMs)
          const octopusHp =
            continuousHp(weekendRaw.octopusHpDone) ??
            (drainedLegacy !== undefined && drainedLegacy > 0 && hpMax > 0
              ? Math.floor((hpMax * drainedLegacy) / weekendFlagshipWindowMs({ debugQuick }))
              : undefined)
          const runId = strictKeep(weekendRaw.flagshipRunId)
          const bossTick = strictKeep(weekendRaw.bossTickWallMs)
          const octopusHold = strictKeep(weekendRaw.octopusHoldUntilWallMs)
          const windowEndHold = strictKeep(weekendRaw.windowEndHoldUntilWallMs)
          const prizePaid = strictKeep(weekendRaw.prizePaidAtWallMs)
          const assaultDraws = weekendKeep(weekendRaw.assaultDraws)
          const autoLoopGalaxyId = weekendStr(weekendRaw.autoLoopGalaxyId)
          const playerKill = ((): NonNullable<GameState['weekendEvent']>['flagshipPlayerKill'] => {
            const raw = asRaw(weekendRaw.flagshipPlayerKill)
            if (raw === null || typeof raw !== 'object') return undefined
            const at = strictKeep(raw.atWallMs)
            const rid = strictKeep(raw.runId)
            const down = strictKeep(raw.downAtGameMs)
            if (at === undefined || at <= 0 || rid === undefined || down === undefined || down <= 0) return undefined
            const wi = strictKeep(raw.waveIdx)
            return { atWallMs: at, runId: rid, ...(wi !== undefined && wi >= 0 ? { waveIdx: wi } : {}), downAtGameMs: down }
          })()
          return {
            seq: Math.max(1, weekendNum(weekendRaw.seq) || 1),
            startedAtWallMs: weekendStartedAt,
            coreId: weekendCoreId,
            peripheryIds: (Array.isArray(weekendRaw.peripheryIds) ? weekendRaw.peripheryIds : [])
              .map((x) => weekendStr(x))
              .filter((x) => x.length > 0),
            family: weekendStr(weekendRaw.family) || 'A',
            contributed,
            ...(weekendRaw.beaconHighSec === true ? { beaconHighSec: true } : {}),
            ...(weekendRaw.beaconLit === true ? { beaconLit: true } : {}),
            ...(weekendNum(weekendRaw.endedAtWallMs) > 0 ? { endedAtWallMs: weekendNum(weekendRaw.endedAtWallMs) } : {}),
            ...(weekendNum(weekendRaw.flagshipAtWallMs) > 0 ? { flagshipAtWallMs: weekendNum(weekendRaw.flagshipAtWallMs) } : {}),
            ...(weekendRaw.flagshipDown === 'player' || weekendRaw.flagshipDown === 'octopus'
              ? { flagshipDown: weekendRaw.flagshipDown as 'player' | 'octopus' }
              : {}),
            ...(typeof weekendRaw.flagshipBlackBox === 'boolean'
              ? { flagshipBlackBox: weekendRaw.flagshipBlackBox }
              : {}),
            ...(hpMax > 0 ? { flagshipHpMax: hpMax } : {}),
            ...(hpDone !== undefined ? { flagshipHpDone: hpDone } : {}),
            ...(hpRecovered !== undefined ? { flagshipHpRecovered: hpRecovered } : {}),
            ...(settledRuns?.length ? { flagshipSettledRuns: settledRuns } : {}),
            ...(octopusHp !== undefined ? { octopusHpDone: octopusHp } : {}),
            ...(runId !== undefined ? { flagshipRunId: runId } : {}),
            ...(bossTick !== undefined ? { bossTickWallMs: bossTick } : {}),
            ...(octopusHold !== undefined ? { octopusHoldUntilWallMs: octopusHold } : {}),
            ...(windowEndHold !== undefined ? { windowEndHoldUntilWallMs: windowEndHold } : {}),
            ...(prizePaid !== undefined ? { prizePaidAtWallMs: prizePaid } : {}),
            ...(assaultDraws !== undefined ? { assaultDraws } : {}),
            ...(autoLoopGalaxyId.length > 0 ? { autoLoopGalaxyId } : {}),
            ...(playerKill !== undefined ? { flagshipPlayerKill: playerKill } : {}),
            ...(reclaimPaid.length > 0 ? { reclaimPaid } : {}),
            ...(reclaimPending.isk > 0 || reclaimPending.wreck > 0 ? { reclaimPending } : {}),
            ...(rewardLedger !== undefined ? { rewardLedger } : {}),
          }
        })()
      : undefined

  const weekendPrepSquad = cleanWeekendSquad(src.weekendPrepSquad)

  const weekendLastResult: GameState['weekendLastResult'] = (() => {
    const w = asRaw(src.weekendLastResult)
    const seq = weekendKeep(w.seq)
    const family = typeof w.family === 'string' && w.family.length > 0 ? w.family : ''
    const coreId = typeof w.coreId === 'string' && w.coreId.length > 0 ? w.coreId : ''
    const endedAt = weekendKeep(w.endedAtWallMs)
    if (seq === undefined || family === '' || coreId === '' || endedAt === undefined) return undefined
    const clamp01 = (v: unknown): number => {
      const n = num(v)
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
    }
    const count = (v: unknown): number => {
      const n = num(v)
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
    }
    const galaxies = (Array.isArray(w.galaxies) ? w.galaxies : []).flatMap((g0) => {
      const g = asRaw(g0)
      const galaxyId = typeof g.galaxyId === 'string' && g.galaxyId.length > 0 ? g.galaxyId : ''
      if (galaxyId === '') return []
      return [
        {
          galaxyId,
          put: clamp01(g.put),
          progress: clamp01(g.progress),
          reclaimed: g.reclaimed === true,
          isk: count(g.isk),
          wreck: count(g.wreck),
        },
      ]
    })
    const fRaw = asRaw(w.flagship)
    const hpMax = weekendKeep(fRaw.hpMax)
    const fracOf = (v: unknown): number | undefined => {
      const n = num(v)
      return Number.isFinite(n) ? clamp01(n) : undefined
    }
    const playerFrac = fracOf(fRaw.playerFrac)
    const octopusFrac = fracOf(fRaw.octopusFrac)
    const flagship =
      hpMax !== undefined && hpMax > 0
        ? {
            hpMax,
            hpDone: count(fRaw.hpDone),
            defeated: fRaw.defeated === true,
            ...(playerFrac !== undefined ? { playerFrac } : {}),
            ...(octopusFrac !== undefined ? { octopusFrac } : {}),
          }
        : undefined
    const killRaw = asRaw(w.flagshipPlayerKill)
    const killAt = weekendKeep(killRaw.atWallMs)
    const killWave = weekendKeep(killRaw.waveIdx)
    const flagshipPlayerKill =
      killAt !== undefined && killAt > 0
        ? { atWallMs: killAt, ...(killWave !== undefined && killWave >= 0 ? { waveIdx: killWave } : {}) }
        : undefined
    const outcome =
      w.flagshipOutcome === 'player' || w.flagshipOutcome === 'octopus' ? w.flagshipOutcome : 'window'
    const tierRaw = w.tier
    const tier: 'A' | 'B' | 'C' | 'D' | 'none' =
      tierRaw === 'A' || tierRaw === 'B' || tierRaw === 'C' || tierRaw === 'D' ? tierRaw : 'none'
    const wreckItemId = typeof w.wreckItemId === 'string' && w.wreckItemId.length > 0 ? w.wreckItemId : undefined
    const blackBoxItemId =
      typeof w.blackBoxItemId === 'string' && isBlackboxItem(w.blackBoxItemId) ? w.blackBoxItemId : undefined
    const progressPct = num(w.progressPct)
    const progressIsk = count(w.progressIsk)
    const standingGain = count(w.standing)
    return {
      seq,
      family,
      coreId,
      endedAtWallMs: endedAt,
      flagshipOutcome: outcome,
      share: clamp01(w.share),
      tier,
      galaxies,
      ...(flagship !== undefined ? { flagship } : {}),
      ...(flagshipPlayerKill !== undefined ? { flagshipPlayerKill } : {}),
      ...(Number.isFinite(progressPct) ? { progressPct: Math.max(0, progressPct) } : {}),
      ...(progressIsk > 0 ? { progressIsk } : {}),
      ...(standingGain > 0 ? { standing: standingGain } : {}),
      isk: count(w.isk),
      wreck: count(w.wreck),
      blackBox: count(w.blackBox),
      ...(wreckItemId !== undefined ? { wreckItemId } : {}),
      ...(blackBoxItemId !== undefined ? { blackBoxItemId } : {}),
    }
  })()
  const cleanSideTaskList = (
    rawList: unknown,
    listKind: 'resource' | 'courier' | 'bounty' | 'faction',
  ): GameState['sideTasks']['resource'] => {
    const out: GameState['sideTasks']['resource'] = []
    if (!Array.isArray(rawList)) return out
    for (const item of rawList) {
      if (typeof item !== 'object' || item === null) continue
      const r = asRaw(item)
      const kind: SideTask['kind'] =
        r.kind === 'courier'
          ? 'courier'
          : r.kind === 'bounty'
            ? 'bounty'
            : r.kind === 'faction'
              ? 'faction'
              : 'resource'
      if (kind !== listKind) continue
      const id = Math.floor(num(r.id))
      const need = Math.floor(num(r.need))
      const rewardIsk = Math.floor(num(r.rewardIsk))
      const goodKey = typeof r.goodKey === 'string' ? r.goodKey : ''
      const refId = typeof r.refId === 'string' ? r.refId : ''
      if (!Number.isFinite(id) || id <= 0) continue
      if (kind === 'bounty') {
        const anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        const tier = Math.floor(num(r.lairTier))
        if (anomalyId.length === 0 || tier < 1 || tier > 3) continue
      } else if (kind === 'faction') {
        const anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        const galaxyId = typeof r.galaxyId === 'string' ? r.galaxyId : ''
        if (anomalyId.length === 0 || galaxyId.length === 0) continue
      } else {
        const volume = Math.floor(num(r.volumeM3))
        const virtualCourier = kind === 'courier' && Number.isFinite(volume) && volume > 0
        if (virtualCourier) {
        } else {
          if (goodKey.length === 0 || refId.length === 0) continue
          if (!Number.isFinite(need) || need <= 0) continue
        }
      }
      const task: GameState['sideTasks']['resource'][number] = {
        id,
        kind,
        goodKey,
        refId,
        need,
        rewardIsk: Number.isFinite(rewardIsk) ? Math.max(0, rewardIsk) : 0,
      }
      const lvRaw = Math.floor(num(r.level))
      if (Number.isFinite(lvRaw) && lvRaw >= 1 && lvRaw <= 5) task.level = lvRaw as 1 | 2 | 3 | 4 | 5
      const volumeM3 = Math.floor(num(r.volumeM3))
      if (Number.isFinite(volumeM3) && volumeM3 > 0) task.volumeM3 = volumeM3
      if (r.timed === true) {
        task.timed = true
        const req = num(r.warpReqAus)
        if (Number.isFinite(req) && req > 0) task.warpReqAus = req
        const limit = Math.floor(num(r.timeLimitMs))
        if (Number.isFinite(limit) && limit > 0) task.timeLimitMs = limit
      }
      const stationId = typeof r.stationId === 'string' && r.stationId.length > 0 ? r.stationId : ''
      const galaxyId = typeof r.galaxyId === 'string' && r.galaxyId.length > 0 ? r.galaxyId : ''
      if (stationId.length > 0) task.stationId = stationId
      if (galaxyId.length > 0) task.galaxyId = galaxyId
      if (kind === 'bounty') {
        task.anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        task.lairTier = Math.floor(num(r.lairTier)) as 1 | 2 | 3
        if (typeof r.lairName === 'string' && r.lairName.length > 0) task.lairName = r.lairName
      }
      if (kind === 'faction') {
        task.anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        if (typeof r.factionAnomalyName === 'string' && r.factionAnomalyName.length > 0) {
          task.factionAnomalyName = r.factionAnomalyName
        }
      }
      out.push(task)
    }
    return out
  }
  const cleanCourierDeliver = (rawDeliver: unknown): GameState['sideTasks']['deliver'] => {
    if (rawDeliver === null || typeof rawDeliver !== 'object') return null
    const d = asRaw(rawDeliver)
    const taskId = Math.floor(num(d.taskId))
    const need = Math.floor(num(d.need))
    const arriveAt = Math.floor(num(d.arriveAtGameMs))
    const departAt = Math.floor(num(d.departAtGameMs))
    const rewardIsk = Math.floor(num(d.rewardIsk))
    const goodKey = typeof d.goodKey === 'string' ? d.goodKey : ''
    const refId = typeof d.refId === 'string' ? d.refId : ''
    const stationId = typeof d.stationId === 'string' ? d.stationId : ''
    const galaxyId = typeof d.galaxyId === 'string' ? d.galaxyId : ''
    const volumeM3 = Math.floor(num(d.volumeM3))
    const virtual = Number.isFinite(volumeM3) && volumeM3 > 0
    if (
      !Number.isFinite(taskId) || taskId <= 0 ||
      !Number.isFinite(arriveAt) || arriveAt < 0 ||
      stationId.length === 0 || galaxyId.length === 0 ||
      (virtual ? false : !(Number.isFinite(need) && need > 0 && goodKey.length > 0 && refId.length > 0))
    ) return null
    const out: NonNullable<GameState['sideTasks']['deliver']> = {
      taskId,
      goodKey,
      refId,
      need: Number.isFinite(need) && need > 0 ? need : 0,
      stationId,
      galaxyId,
      departAtGameMs: Number.isFinite(departAt) && departAt >= 0 ? departAt : 0,
      arriveAtGameMs: arriveAt,
      ...(typeof d.flightDurationMs === 'number' && Number.isFinite(d.flightDurationMs) && d.flightDurationMs > 0 ? { flightDurationMs: d.flightDurationMs } : {}),
      rewardIsk: Number.isFinite(rewardIsk) ? Math.max(0, rewardIsk) : 0,
    }
    if (virtual) out.volumeM3 = volumeM3
    const lvRaw = Math.floor(num(d.level))
    if (Number.isFinite(lvRaw) && lvRaw >= 1 && lvRaw <= 5) out.level = lvRaw as 1 | 2 | 3 | 4 | 5
    if (d.timed === true) {
      out.timed = true
      const dl = Math.floor(num(d.deadlineAtGameMs))
      if (Number.isFinite(dl) && dl >= 0) out.deadlineAtGameMs = dl
    }
    return out
  }
  const stRaw = asRaw(src.sideTasks)
  const sideTaskResource = cleanSideTaskList(stRaw.resource, 'resource')
  const sideTaskCourier = cleanSideTaskList(stRaw.courier, 'courier')
  const sideTaskBounty = cleanSideTaskList(stRaw.bounty, 'bounty')
  const sideTaskFaction = cleanSideTaskList(stRaw.faction === null || stRaw.faction === undefined ? [] : [stRaw.faction], 'faction')[0] ?? null
  const sideTaskAccepted = cleanSideTaskList(stRaw.accepted, 'courier')
  const stSeqRaw = Math.floor(num(stRaw.seq))
  let sideTaskSeq = Number.isFinite(stSeqRaw) ? Math.max(1, stSeqRaw) : 1
  for (const t of [...sideTaskResource, ...sideTaskCourier, ...sideTaskBounty]) sideTaskSeq = Math.max(sideTaskSeq, t.id)
  const sideTaskWindow = Math.max(0, Math.floor(num(stRaw.window)))
  const courierWindowRaw = Math.floor(num(stRaw.courierWindow))
  const courierWindow = Number.isFinite(courierWindowRaw) && courierWindowRaw > 0 && courierWindowRaw <= Math.max(0, num(src.gameMs))
    ? courierWindowRaw : undefined
  const bountyWindowRaw = Math.floor(num(stRaw.bountyWindow))
  const sideTaskBountyWindow = Number.isFinite(bountyWindowRaw) && bountyWindowRaw > 0 ? bountyWindowRaw : 0
  const factionWindowRaw = Math.floor(num(stRaw.factionWindow))
  const sideTaskFactionWindow = Number.isFinite(factionWindowRaw) && factionWindowRaw > 0 ? factionWindowRaw : 0
  const bountySeenRaw = Math.floor(num(stRaw.bountySeenWindow))
  const sideTaskBountySeen = Number.isFinite(bountySeenRaw) && bountySeenRaw > 0 ? bountySeenRaw : 0
  const sideTasks = {
    seq: sideTaskSeq,
    window: sideTaskWindow,
    resource: sideTaskResource,
    courier: sideTaskCourier,
    ...(courierWindow === undefined ? {} : { courierWindow }),
    bounty: sideTaskBounty,
    faction: sideTaskFaction,
    bountyWindow: sideTaskBountyWindow,
    ...(sideTaskFactionWindow > 0 ? { factionWindow: sideTaskFactionWindow } : {}),
    ...(sideTaskBountySeen > 0 ? { bountySeenWindow: sideTaskBountySeen } : {}),
    ...(sideTaskAccepted.length > 0 ? { accepted: sideTaskAccepted } : {}),
    deliver: cleanCourierDeliver(stRaw.deliver),
  }

  const cleanWormholePiles = (raw: unknown): { piles?: Array<{ itemId: string; units: number }> } => {
    if (!Array.isArray(raw)) return {}
    const out: Array<{ itemId: string; units: number }> = []
    for (const it of raw) {
      const row = asRaw(it)
      const itemId = typeof row.itemId === 'string' ? row.itemId : ''
      const units = Math.floor(num(row.units))
      if (itemId.length > 0 && units > 0) out.push({ itemId, units })
    }
    return out.length > 0 ? { piles: out } : {}
  }

  const cleanWormholeFoe = (raw: unknown): { card: string; seq: number; cleared?: true; patrolId?: number } | undefined => {
    const row = asRaw(raw)
    const card = typeof row.card === 'string' ? row.card : ''
    const seq = Math.floor(num(row.seq))
    if (card.length === 0 || !Number.isFinite(seq) || seq < 0) return undefined
    return { card, seq, ...(row.cleared === true ? { cleared: true as const } : {}), ...(row.patrolId === 0 || row.patrolId === 1 ? { patrolId: row.patrolId } : {}) }
  }

  const cleanWormholeHold = (raw: unknown): WormholeHoldState | undefined => {
    const h = asRaw(raw)
    if (raw === undefined || raw === null) return undefined
    const cols = Math.floor(num(h.cols))
    const list = Array.isArray(h.placements) ? h.placements : []
    const out: WormholeHoldState['placements'] = []
    const taken = new Set<string>()
    for (const it of list) {
      const p = cleanHoldPlacement(it)
      if (!p) continue
      if (p.x + p.w > (cols >= 1 && cols <= 32 ? cols : WORMHOLE_HOLD_COLS)) continue
      const cells: string[] = []
      let clash = false
      for (let dy = 0; dy < p.h && !clash; dy++) {
        for (let dx = 0; dx < p.w; dx++) {
          const key = `${p.x + dx},${p.y + dy}`
          if (taken.has(key)) {
            clash = true
            break
          }
          cells.push(key)
        }
      }
      if (clash) continue
      for (const c of cells) taken.add(c)
      out.push(p)
    }
    return {
      cols: cols >= 1 && cols <= 32 ? cols : WORMHOLE_HOLD_COLS,
      placements: out,
    }
  }
  const cleanWormholeGrid = (raw: unknown): WormholeGridState | undefined => {
    const g = asRaw(raw)
    const radius = Math.floor(num(g.radius))
    if (!(radius >= 1 && radius <= WORMHOLE_GRID_SAVE_MAX_R)) return undefined
    const cellsRaw = Array.isArray(g.cells) ? g.cells : []
    const cells: WormholeGridState['cells'] = []
    for (const it of cellsRaw) {
      const row = asRaw(it)
      const key = typeof row.key === 'string' ? row.key : ''
      const place = typeof row.place === 'string' ? row.place : ''
      if (key.length === 0 || place.length === 0) continue
      const placeOk = place === 'ruins' && row.researchLab === true ? 'research' :
        place === 'empty' || place === 'graveyard' || place === 'ruins' || place === 'ship' || place === 'vein' || place === 'matter' || place === 'beacon' || place === 'research'
        ? (place as WormholeGridState['cells'][number]['place'])
        : undefined
      if (!placeOk) continue
      const cellPiles = ((): { itemId: string; units: number }[] | undefined => {
        const pileRaw = Array.isArray(row.piles) ? row.piles : []
        const out: { itemId: string; units: number }[] = []
        for (const p of pileRaw) {
          const o = asRaw(p)
          const itemId = typeof o.itemId === 'string' ? o.itemId : ''
          const units = Math.floor(num(o.units))
          if (itemId.length > 0 && units > 0) out.push({ itemId, units })
        }
        return out.length > 0 ? out : undefined
      })()
      cells.push({
        key,
        q: Math.floor(num(row.q)),
        r: Math.floor(num(row.r)),
        place: placeOk,
        ...(isWormholeEventKey(row.eventKey) ? { eventKey: row.eventKey } : {}),
        ...(row.eventResolved === true ? { eventResolved: true } : {}),
        ...(cleanWormholeEventInstance(row.event) ? { event: cleanWormholeEventInstance(row.event) } : {}),
        ...(row.elite === true ? { elite: true } : {}),
        ...(row.combatCleared === true ? { combatCleared: true } : {}),
        ...(row.alarmDisabled === true ? { alarmDisabled: true } : {}),
        ...(cellPiles ? { piles: cellPiles } : {}),
        ...(row.resourcePilesGenerated === true ? { resourcePilesGenerated: true as const } : {}),
        ...(row.nebula === true ? { nebula: true } : {}),
        ...(cleanWormholeFoe(row.foe) !== undefined ? { foe: cleanWormholeFoe(row.foe)! } : {}),
      })
    }
    if (cells.length === 0) return undefined
    const cell = (v: unknown): { q: number; r: number } | undefined => {
      const o = asRaw(v)
      return typeof o.q === 'number' || typeof o.r === 'number' ? { q: Math.floor(num(o.q)), r: Math.floor(num(o.r)) } : undefined
    }
    const start = cell(g.start)
    const exit = cell(g.exit)
    const pos = cell(g.pos)
    if (!start || !exit || !pos) return undefined
    const keys = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    return {
      radius,
      start,
      exit,
      pos,
      scanRadius: Math.max(0, Math.floor(num(g.scanRadius)) || 1),
      scanned: keys(g.scanned),
      visited: keys(g.visited),
      activated: [...new Set([...keys(g.activated), ...cells.filter(c => c.place === 'research' && keys(g.ruinsRolled).includes(c.key)).map(c => c.key)])],
      ...(keys(g.ruinsRolled).length > 0 ? { ruinsRolled: keys(g.ruinsRolled) } : {}),
      ...(keys(g.dispersed).length > 0 ? { dispersed: keys(g.dispersed) } : {}),
      ...(g.exitKnown === true ? { exitKnown: true } : {}),
      ...(Math.floor(num(g.spawnSeq)) > 0 ? { spawnSeq: Math.floor(num(g.spawnSeq)) } : {}),
      cells,
    }
  }
  const cleanWormhole = (): GameState['wormhole'] => {
    const wRaw = asRaw(src.wormhole)
    const rRaw = asRaw(wRaw.run)
    const battleInFlight = cleanBattle(rRaw.battle)
    const hasBattleInFlight = battleInFlight !== null
    const phaseRaw = rRaw.phase
    const phase: 'inside' | 'extracting' | null =
      phaseRaw === 'inside' || phaseRaw === 'extracting' ? phaseRaw : null
    const depth = Math.floor(num(rRaw.depth))
    const turnsLeft = Math.floor(num(rRaw.turnsLeft))
    const turnsTotal = Math.floor(num(rRaw.turnsTotal))
    const fleet = Array.isArray(rRaw.fleet) ? rRaw.fleet.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const bagRaw = Array.isArray(rRaw.bag) ? rRaw.bag : []
    const bag: Array<{ itemId: string; units: number }> = []
    for (const it of bagRaw) {
      const row = asRaw(it)
      const itemId = typeof row.itemId === 'string' ? row.itemId : ''
      const units = Math.floor(num(row.units))
      if (itemId.length > 0 && units > 0) bag.push({ itemId, units })
    }
    const pn = asRaw(rRaw.pendingNode)
    const kindRaw = pn.kind
    const nodeKind: 'combat' | 'pickup' | 'event' | null =
      kindRaw === 'combat' || kindRaw === 'pickup' || kindRaw === 'event' ? kindRaw : null
    const run =
      phase !== null
        ? {
            phase,
            depth: depth > 0 ? depth : 1,
            nodeIndex: Math.max(0, Math.floor(num(rRaw.nodeIndex))),
            turnsLeft: Math.max(0, turnsLeft),
            turnsTotal: Math.max(0, turnsTotal),
            ...(rRaw.haulerFittingVersion === 1 ? { haulerFittingVersion: 1 as const } : {}),
            ...(rRaw.supplyVersion !== undefined || rRaw.expeditionRules !== undefined ? {
              supplyVersion: 1 as const,
              supplies: (() => {
                const raw = asRaw(rRaw.supplies)
                const counts = (value: unknown): Record<string, number> => Object.fromEntries(
                  Object.entries(asRaw(value)).filter(([id, n]) => id.length > 0 && typeof n === 'number' && Number.isSafeInteger(n) && n > 0),
                ) as Record<string, number>
                return { items: counts(raw.items), carried: counts(raw.carried), consumed: counts(raw.consumed), deployed: counts(raw.deployed), recovered: counts(raw.recovered), leftBehind: counts(raw.leftBehind), found: counts(raw.found) }
              })(),
            } : {}),
            fleet,
            totalMass: Math.max(0, num(rRaw.totalMass)),
            bag,
            pendingNode:
              nodeKind === null
                ? null
                : {
                    kind: nodeKind,
                    waves: Math.max(0, Math.floor(num(pn.waves))),
                    pickups: Math.max(0, Math.floor(num(pn.pickups))),
                    ...(typeof pn.eventKey === 'string' && pn.eventKey.length > 0 ? { eventKey: pn.eventKey } : {}),
                    cost: Math.max(1, Math.floor(num(pn.cost))),
                    ...cleanWormholePiles(pn.piles),
                  },
            nodesPerLayer: Math.max(1, Math.floor(num(rRaw.nodesPerLayer)) || 2),
            attending: rRaw.attending === true || hasBattleInFlight,
            ...(cleanWormholeGrid(rRaw.grid) !== undefined ? { grid: cleanWormholeGrid(rRaw.grid) } : {}),
            ...cleanWormholeExpeditionRun(rRaw),
            ...(Math.floor(num(rRaw.leftAtGameMs)) > 0 ? { leftAtGameMs: Math.floor(num(rRaw.leftAtGameMs)) } : {}),
            ...(num(rRaw.desireM) > 0 ? { desireM: Math.round(num(rRaw.desireM)) } : {}),
            ...(rRaw.automaticBattleRanges === true ? { automaticBattleRanges: true as const } : {}),
            ...(Math.floor(num(rRaw.seed)) !== 0 ? { seed: Math.floor(num(rRaw.seed)) } : {}),
            ...(WORMHOLE_FAMILY_ORDER.includes(rRaw.family as WormholeFamily)
              ? { family: rRaw.family as WormholeFamily }
              : {}),
            ...(WORMHOLE_ARCHETYPES.includes(rRaw.archetype as WormholeArchetype)
              ? { archetype: rRaw.archetype as WormholeArchetype }
              : {}),
            ...(Array.isArray(rRaw.relics)
              ? (() => {
                  const list = rRaw.relics.filter((x): x is string => typeof x === 'string' && x.length > 0)
                  return list.length > 0 ? { relics: list } : {}
                })()
              : {}),
            ...(battleInFlight !== null ? { battle: battleInFlight } : {}),
            ...(cleanWormholeHold(rRaw.hold) !== undefined ? { hold: cleanWormholeHold(rRaw.hold) } : {}),
            ...(rRaw.supplyVersion !== undefined && rRaw.groundCargo !== undefined ? {
              groundCargo: Object.fromEntries(Object.entries(asRaw(rRaw.groundCargo)).flatMap(([key, board]) => {
                if (!/^-?\d+,-?\d+$/.test(key)) return []
                const cleaned = cleanWormholeHold(board)
                return cleaned ? [[key, cleaned]] : []
              })),
            } : {}),
            ...(Array.isArray(rRaw.temp)
              ? (() => {
                  const list = rRaw.temp
                    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
                    .map((x) => ({ itemId: typeof x.itemId === 'string' ? x.itemId : '', units: Math.floor(num(x.units)) }))
                    .filter((x) => x.itemId.length > 0 && x.units > 0)
                  return list.length > 0 ? { temp: list } : {}
                })()
              : {}),
            ...(cleanWormholeHold(rRaw.tempGrid) !== undefined ? { tempGrid: cleanWormholeHold(rRaw.tempGrid) } : {}),
            ...(Math.floor(num(rRaw.bossCleared)) > 0
              ? { bossCleared: Math.floor(num(rRaw.bossCleared)) }
              : {}),
            ...(typeof rRaw.turnsBase === 'number' && Number.isFinite(rRaw.turnsBase)
              ? { turnsBase: Math.max(0, Math.round(rRaw.turnsBase)) }
              : {}),
            ...(typeof rRaw.turnsTechBonus === 'number' && Number.isFinite(rRaw.turnsTechBonus)
              ? { turnsTechBonus: Math.max(0, Math.round(rRaw.turnsTechBonus)) }
              : {}),
            ...(typeof rRaw.turnsSpent === 'number' && Number.isFinite(rRaw.turnsSpent)
              ? { turnsSpent: Math.max(0, Math.round(rRaw.turnsSpent)) }
              : {}),
          }
        : null
    const settleRaw = asRaw(wRaw.lastSettle)
    const strList = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const supplyCounts = (v: unknown): Record<string, number> => Object.fromEntries(
      Object.entries(asRaw(v)).filter(([id, n]) => id.length > 0 && typeof n === 'number' && Number.isSafeInteger(n) && n > 0),
    ) as Record<string, number>
    const lastSettle =
      settleRaw !== null &&
      typeof settleRaw === 'object' &&
      (settleRaw.kind === 'extract' || settleRaw.kind === 'lost')
        ? {
            kind: settleRaw.kind as 'extract' | 'lost',
            depth: Math.max(1, Math.floor(num(settleRaw.depth))),
            oreUnits: Math.max(0, Math.floor(num(settleRaw.oreUnits))),
            oreIsk: Math.max(0, num(settleRaw.oreIsk)),
            wreckIsk: Math.max(0, num(settleRaw.wreckIsk)),
            boxes: strList(settleRaw.boxes),
            relics: strList(settleRaw.relics),
            shipsLost: strList(settleRaw.shipsLost),
            lostIsk: Math.max(0, num(settleRaw.lostIsk)),
            ...(settleRaw.suppliesReturned !== undefined ? { suppliesReturned: supplyCounts(settleRaw.suppliesReturned) } : {}),
            ...(settleRaw.suppliesUsed !== undefined ? { suppliesUsed: supplyCounts(settleRaw.suppliesUsed) } : {}),
            ...(settleRaw.suppliesFound !== undefined ? { suppliesFound: supplyCounts(settleRaw.suppliesFound) } : {}),
            ...(settleRaw.expeditionGoal === 'deep' || settleRaw.expeditionGoal === 'ruins' || settleRaw.expeditionGoal === 'survey' ? { expeditionGoal: settleRaw.expeditionGoal as 'deep' | 'ruins' | 'survey' } : {}),
            ...(() => {
              const cleaned = cleanWormholeExpeditionRun({ expeditionRules: 2, expeditionProgress: settleRaw.expeditionProgress })
              return cleaned.expeditionProgress ? { expeditionProgress: cleaned.expeditionProgress } : {}
            })(),
            ...(settleRaw.skippedExtractBattle === true ? { skippedExtractBattle: true } : {}),
          }
        : undefined
    return {
      run,
      lastFleetLost: Math.max(0, Math.floor(num(wRaw.lastFleetLost))),
      ...(lastSettle !== undefined ? { lastSettle } : {}),
      ...(wRaw.nebulaHintShown === true ? { nebulaHintShown: true } : {}),
      ...(wRaw.siegeHintShown === true ? { siegeHintShown: true } : {}),
      ...(wRaw.noCommonWreckSalvage === true ? { noCommonWreckSalvage: true } : {}),
    }
  }
  const wormhole = cleanWormhole()

  const researchRaw = asRaw(src.research)
  const techLevelsRaw = asRaw(researchRaw.levels)
  const techLevels: Record<string, number> = {}
  for (const [key, value] of Object.entries(techLevelsRaw)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    techLevels[key] = Math.floor(value)
  }
  const research: GameState['research'] = { levels: techLevels }

  const achRaw = asRaw(src.achievements)
  const achEarnedRaw = asRaw(achRaw.earned)
  const achEarned: Record<string, AchievementEarned> = {}
  const atOf = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  for (const [key, value] of Object.entries(achEarnedRaw)) {
    if (typeof value === 'number') {
      achEarned[key] = { atGameMs: atOf(value), atWallMs: 0 }
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    const rec = value as Record<string, unknown>
    achEarned[key] = { atGameMs: atOf(rec.atGameMs), atWallMs: atOf(rec.atWallMs) }
  }
  const achievements: GameState['achievements'] = { earned: achEarned }

  const blackMarket = normalizeBlackMarket(src.blackMarket)
  const planetary = (() => {
    try { return cleanPlanetaryState(src.planetary) }
    catch { throw new SaveError('VERSION', '存档中的星球运行规则高于当前支持范围，请升级游戏。') }
  })()
  const pendingStationActivity = cleanPendingStationActivity(src.pendingStationActivity)
  const departure = cleanDeparture(src.departure)
  const battleRangeByCard = cleanBattleRangeRecords(src.battleRangeByCard)
  const pendingBattleRange = cleanPendingBattleRange(src.pendingBattleRange)
  const fleetRange = cleanFleetRangeSettings(src.fleetRange)
  const normalized: GameState = {
    ...(fleetRange ? { fleetRange } : {}),
    ...(departure && departure.shipId === shipId && fleet[departure.shipId] ? { departure } : {}),
    ...(battleRangeByCard ? { battleRangeByCard } : {}),
    ...(pendingBattleRange ? { pendingBattleRange } : {}),
    ...(pendingStationActivity && fleet[pendingStationActivity.shipId] ? { pendingStationActivity } : {}),
    ...(planetary ? { planetary } : {}),
    version: CURRENT_STATE_VERSION,
    gameMs:
      typeof src.gameMs === 'number' && Number.isFinite(src.gameMs) ? Math.max(0, Math.floor(src.gameMs)) : 0,
    savedAtWallMs:
      typeof src.savedAtWallMs === 'number' && Number.isFinite(src.savedAtWallMs) ? src.savedAtWallMs : 0,
    logCap,
    character,
    rng,
    skills: { trained, queue, savedProgress, licenses,
      ...(skillsRaw.commandCompensationVersion === 1 ? { commandCompensationVersion: 1 as const } : {}),
      ...(skillsRaw.progressVersion === 1 ? { progressVersion: 1 as const } : {}) },
    wallet,
    shipId,
    fleet,
    warehouse: { items: warehouseItems },
    aiCores,
    aiAssignments: aiAssignments as GameState['aiAssignments'],
    shipReturns: shipReturns as GameState['shipReturns'],
    shipLocks: shipLocks as GameState['shipLocks'],
    marks,
    mining,
    moduleBay,
    learnedRecipes,
    spentOneTimeRecipes,
    recycleCarry,
    shipStore,
    ...(Object.keys(fitPresets).length > 0 ? { fitPresets } : {}),
    ...(wormholePreparationTemplates.length > 0 ? { wormholePreparationTemplates } : {}),
    ...(preparationSquads !== undefined ? { preparationSquads } : {}),
    ...(fleetPresets.length ? { fleetPresets } : {}),
    ...(cleanCombatSortie(src.combatEscort) ? { combatEscort: cleanCombatSortie(src.combatEscort) } : {}),
    blueprintStock,
    market,
    ...(blackMarket ? { blackMarket } : {}),
    orders,
    escrowItems,
    escrowShips,
    manufacturingRuns,
    manufacturingSeq,
    manufacturingLoops,
    labLoops,
    standings,
    standingsEarned,
    ...(blackboxSeen !== undefined ? { blackboxSeen } : {}),
    expedition,
    events,
    exploredGalaxies,
    scanning,
    scanProgress,
    wormholeScan,
    wormholeStock,
    wormholeAuto,
    wormholeAutoReports,
    debugQuick,
    completedBounties,
    awayGalaxy,
    transit,
    standby,
    hauling,
    refineRuns,
    refineSeq,
    salvaging,
    bountyCooldowns,
    autoLoopAnomalyId,
    autoLoopDroneFloor,
    haltedBySwitch,
    pendingActivityReturn,
    rareWreckDryStreak: Math.max(0, Math.floor(num(src.rareWreckDryStreak))),
    encounter,
    ...(src.industrialFleetRiskSeen === true ? { industrialFleetRiskSeen: true as const } : {}),
    ...(src.industrialProtection && typeof src.industrialProtection === 'object' ? { industrialProtection: {
      version: 1 as const,
      entryRemainingMs: Math.max(0, num(asRaw(src.industrialProtection).entryRemainingMs)),
      dockedMs: Math.max(0, num(asRaw(src.industrialProtection).dockedMs)),
      postBattleUntilMs: Math.max(0, num(asRaw(src.industrialProtection).postBattleUntilMs)),
    } } : {}),
    lowSecNotified,
    encounterZoneCooldown,
    lowSecPresence,
    stationSites,
    dockedSite,
    dialogueSeen,
    pendingDialogue,
    commsDelivered,
    commsPopups,
    commsRead,
    ...(Object.keys(commsInstance).length > 0 ? { commsInstance } : {}),
    ...(weekendPrepSquad.length > 0 ? { weekendPrepSquad } : {}),
    ...(weekendLastResult !== undefined ? { weekendLastResult } : {}),
    ...(ambushRetreatSeen !== undefined ? { ambushRetreatSeen } : {}),
    ...(firstShipBuilt !== undefined ? { firstShipBuilt } : {}),
    ...(labOpened !== undefined ? { labOpened } : {}),
    ...(resupplyFromWarehouse !== undefined ? { resupplyFromWarehouse } : {}),
    ...(Object.keys(jumpFuel).length > 0 ? { jumpFuel } : {}),
    ...(labRuns.length > 0 ? { labRuns, labSeq } : {}),
    ...(Object.keys(labLoops).length > 0 ? { labLoops } : {}),
    ...(skillBoostUntilMs > 0 ? { skillBoostUntilMs } : {}),
    ...(boostAutoRenew ? { boostAutoRenew: true } : {}),
    ...(modeChosen !== undefined ? { modeChosen } : {}),
    ...(Object.keys(winRecord).length > 0 ? { winRecord } : {}),
    foeShipSeen,
    galaxyWrecks: galaxyWrecks as GameState['galaxyWrecks'],
    ...(Object.keys(weekendWrecks).length > 0 ? { weekendWrecks } : {}),
    ...(Object.keys(shipWrecks).length > 0 ? { shipWrecks, shipWreckSeq: num(src.shipWreckSeq) } : {}),
    ...(wreckLog.length > 0 ? { wreckLog, wreckLogSeq: num(src.wreckLogSeq) } : {}),
    rareOpenedUnits,
    rareBoxesOpened,
    rareBurnUnits,
    onboarding,
    importantTasks,
    ...(Object.keys(firstStats).length > 0 ? { firstStats } : {}),
    ...(firstTaskSeenId !== undefined ? { firstTaskSeenId } : {}),
    ...(firstTaskReadyId !== undefined ? { firstTaskReadyId } : {}),
    ironman,
    ...(weekendEvent !== undefined ? { weekendEvent } : {}),
    sideTasks,
    wormhole,
    research,
    achievements,
    logs,
  }
  pruneMarks(normalized)
  reconcileDeparture(normalized)
  normalizeTrainingProgress(normalized)
  applyLegacyCommandCompensation(normalized)
  return normalized
}

export function serializeSaveFile(state: GameState, nowWallMs: number = Date.now()): string {
  const ledger = Number.isFinite(state.savedAtWallMs) ? state.savedAtWallMs : 0
  const stamp = Math.max(nowWallMs, ledger > 0 ? ledger : 0)
  return JSON.stringify({
    format: SAVE_FORMAT,
    version: state.version,
    savedAtWallMs: stamp,
    state,
  })
}

export function loadSaveFile(text: string): { state: GameState; savedAtWallMs: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new SaveError('PARSE', `存档文件不是合法 JSON：${(e as Error).message}`)
  }
  const file = asRaw(parsed)
  if (file.format !== SAVE_FORMAT) {
    throw new SaveError('FORMAT', `不是本游戏的存档（格式标识不符：${String(file.format)}）。`)
  }
  const fileVersion =
    typeof file.version === 'number' && Number.isFinite(file.version) ? file.version : 0
  const savedAtWallMs =
    typeof file.savedAtWallMs === 'number' && Number.isFinite(file.savedAtWallMs) ? file.savedAtWallMs : 0

  if (fileVersion < MIN_SUPPORTED_SAVE_VERSION) {
    throw new SaveError('VERSION', `存档版本 v${fileVersion} 早于可读取下限 v${MIN_SUPPORTED_SAVE_VERSION}：不再提供旧档迁移，请新开存档。`)
  }
  if (fileVersion > CURRENT_STATE_VERSION) {
    throw new SaveError('VERSION', `存档版本 v${fileVersion} 高于当前支持的 v${CURRENT_STATE_VERSION}，请升级游戏。`)
  }
  const state = normalizeState(file.state)
  state.savedAtWallMs = savedAtWallMs
  return { state, savedAtWallMs }
}
