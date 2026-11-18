import { ceilFinalQuantity } from './quantity'
import type { CoreBlockReason } from './engine'
import { AI_CORE_IDS } from './aiCores'
import { tuningMul } from './tuning'
import type { GameState, WormholeArchetype, WormholeAutoReport, WormholeAutoRun, WormholeFamily, WormholeStockItem } from './state'
import { addLog, createInitialState, shipLockedInWormhole, wormholeAutoRunsOf } from './state'
export { wormholeAutoRunsOf } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import {
  WORMHOLE_ORE_ITEM_ID,
  WORMHOLE_ADMISSION_TEXT,
  blankShareFactorOf,
  wormholeAdmission,
  wormholeBagSlotsOfFleet,
  wormholeScanBonusOf,
} from './wormhole'
import { matterTechLevel, matterTechNodes, matterTechWhBuffs, matterTechWorkEffBonus, matterTechSignalAutoYield } from './matterTech'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOf, wreckGroupOfCard, wreckItemIdOf } from './salvage'
import { wormholeRollRelicBoxKind, WORMHOLE_CORE_WEIGHTS, WORMHOLE_ESSENCE_ITEM_ID, wormholeMinersInFleet, wormholeSalvagersInFleet } from './wormholeSalvage'
import { wormholeCardIdOfFamily, wormholeFamilyOfSeed, wormholeLayerThreat } from './wormholeFoes'
import { WORMHOLE_ARCHETYPE_IDS, WORMHOLE_ARCHETYPE_LABELS, wormholeArchetypeOf } from './wormholeGrid'
import { wormholeStockOf, wormholeStockTake } from './wormholeScan'
import { aiCoreCap, aiCoreIndustryUsed, aiCoreName, aiCoreShipUsed, gainAiCore, industryAiBonus } from './ai'
import { logParams } from './logParts'
import { changeShip, changeShipBlockReason, loseShip } from './shipyard'
import { wormholePreparationPlan, wormholeEnterPrepared } from './wormholePreparation'
import type { WormholePreparationPlan } from './wormholePreparation'
import { wormholeExtractionPlan, wormholeConfirmExtraction } from './wormholeExtraction'
import { wormholeRunExpeditionPolicy } from './wormholeExpeditionPolicy'
import { shipBusyLabel } from './activity'
import { WORMHOLE_AUTO_SIM_YIELD_MUL, wormholeAutoDescend, type WormholeAutoPower } from './wormholeAutoSim'
import { LEGACY_HAULER_STATS, moduleAllowedOnShip } from './shipFitting'
import { fleetDefOf } from './instances'
import { repairCivilianFittings } from './equipment'
import { combatShipLimit, commandBudgetOf } from './combat/command/rules'
import { signalAutoEstimateOf } from './signalAuto/estimate'
import { cleanSignalAutoEstimate } from './signalAuto/save'
import { signalAutoInputKey } from './signalAuto/input'
import type { SignalAutoEstimate } from './signalAuto/types'

export const WORMHOLE_AUTO_HOLD_M3_PER_CELL = 50

function fleetPowerOf(state: GameState, ctx: SimContext, shipIds: readonly string[]): WormholeAutoPower {
  let guns = 0
  let ehp = 0
  for (const id of shipIds) {
    const ship = state.fleet[id]
    if (!ship) continue
    const def = fleetDefOf(state, ctx, id)
    const tier = def?.tier ?? 1
    let own = 0
    for (const modId of ship.fitted?.high ?? []) {
      if (!modId) continue
      const mod = ctx.modules.get(modId)
      if (!mod || !moduleAllowedOnShip(def, mod)) continue
      const slot = mod.slot
      if (slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac') own += 1
    }
    guns += own
    ehp += tier * 10 * Math.max(0.1, ship.durability ?? 1)
  }
  return { dps: Math.max(1, guns * 8), ehp: Math.max(1, ehp) }
}

function guardPowerOf(ctx: SimContext, family: WormholeFamily, depth: number): WormholeAutoPower {
  void ctx
  void family
  const threat = wormholeLayerThreat(depth)
  return { dps: threat, ehp: threat * 6 }
}

export const WORMHOLE_AUTO_DURATION_MS = 5 * 60_000

export const WORMHOLE_AUTO_MAX_SHIPS = combatShipLimit(true)

export const WORMHOLE_AUTO_MANUAL = {
  commons: 8.5,
  rares: 1.25,
  orePiles: 2,
  boxChance: 0.23,
  cores: 0.1,
} as const

export const WORMHOLE_AUTO_HULL_FLOOR = 0.1


export const WORMHOLE_AUTO_ARCHETYPE_WEIGHTS: Readonly<Record<WormholeArchetype, number>> = {
  balanced: 40,
  wreck: 20,
  ruins: 15,
  vein: 15,
  combat: 10,
}

const ARCHETYPE_RAW: Readonly<Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>> = {
  balanced: { commons: 1, rares: 1, ore: 1, box: 1 },
  wreck: { commons: 1.6, rares: 1.1, ore: 0.8, box: 1 },
  ruins: { commons: 0.9, rares: 1.6, ore: 0.8, box: 2 },
  vein: { commons: 0.7, rares: 0.9, ore: 2.2, box: 0.8 },
  combat: { commons: 1.5, rares: 1.3, ore: 0.7, box: 0.9 },
}

const ARCHETYPE_MUL: Readonly<Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>> = (() => {
  const keys: WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']
  const totalP = keys.reduce((s, k) => s + WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[k], 0)
  const mean = { commons: 0, rares: 0, ore: 0, box: 0 }
  for (const k of keys) {
    const p = WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[k] / totalP
    const m = ARCHETYPE_RAW[k]
    mean.commons += p * m.commons
    mean.rares += p * m.rares
    mean.ore += p * m.ore
    mean.box += p * m.box
  }
  const out = {} as Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>
  for (const k of keys) {
    const m = ARCHETYPE_RAW[k]
    out[k] = {
      commons: m.commons / mean.commons,
      rares: m.rares / mean.rares,
      ore: m.ore / mean.ore,
      box: m.box / mean.box,
    }
  }
  return out
})()

export function wormholeAutoArchetypeMul(archetype: WormholeArchetype): {
  commons: number
  rares: number
  ore: number
  box: number
} {
  return ARCHETYPE_MUL[archetype]
}

export const WORMHOLE_AUTO_DAMAGE_MIN = 0.4
export const WORMHOLE_AUTO_DAMAGE_MAX = 0.8

export const WORMHOLE_AUTO_REPORT_MAX = 10

export interface WormholeAutoTechFactors {
  total: number
  wreck: number
  ore: number
  damage: number
  turnMul: number
  holdMul: number
  salvageEff: number
  collectEff: number
  battleProgress: number
  baseTurns: number
  baseHold: number
}

export function wormholeAutoTechFactors(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): WormholeAutoTechFactors {
  const tech = matterTechWhBuffs(state, ctx)
  const adm = wormholeAdmission(ctx, shipIds)
  const baseHold0 = adm.ok ? wormholeBagSlotsOfFleet(state, ctx, shipIds) : 0
  const neutral: WormholeAutoTechFactors = {
    total: 1,
    wreck: 1,
    ore: 1,
    damage: 1,
    turnMul: 1,
    holdMul: 1,
    salvageEff: 0,
    collectEff: 0,
    battleProgress: 0,
    baseTurns: Math.max(1, adm.turnBudget),
    baseHold: Math.max(1, baseHold0),
  }
  if (!adm.ok) return neutral
  const baseTurns = Math.max(1, adm.turnBudget)
  const baseHold = Math.max(1, baseHold0)
  const turnMul = 1 + tech.turnBonus / baseTurns
  const holdMul = 1 + tech.holdCells / baseHold
  const total = turnMul * holdMul
  const salvageEff = matterTechWorkEffBonus(state, ctx, 'salvage')
  const collectEff = matterTechWorkEffBonus(state, ctx, 'collect')
  let got = 0
  let max = 0
  for (const node of matterTechNodes(ctx)) {
    if (node.branch !== 'battle') continue
    max += node.maxLevel
    got += Math.min(node.maxLevel, matterTechLevel(state, node.id))
  }
  const battleProgress = max > 0 ? got / max : 0
  return {
    total,
    wreck: 1 + salvageEff,
    ore: 1 + collectEff,
    damage: 1 - 0.5 * battleProgress,
    turnMul,
    holdMul,
    salvageEff,
    collectEff,
    battleProgress,
    baseTurns,
    baseHold,
  }
}

export function wormholeAutoTechIsNeutral(f: WormholeAutoTechFactors): boolean {
  return f.wreck === 1 && f.ore === 1 && f.damage === 1
}

export function wormholeAutoHoldM3Of(f: WormholeAutoTechFactors): number {
  return Math.max(1, Math.round(f.baseHold * f.holdMul)) * WORMHOLE_AUTO_HOLD_M3_PER_CELL
}

export function wormholeAutoReportsOf(state: GameState): WormholeAutoReport[] {
  return state.wormholeAutoReports ?? []
}

export function wormholeAutoUnconfirmedCount(state: GameState): number {
  return wormholeAutoReportsOf(state).filter((r) => !r.confirmed).length
}

export function shipInWormholeAuto(state: GameState, shipId: string): boolean {
  return wormholeAutoRunsOf(state).some((r) => r.shipIds.includes(shipId))
}

export function wormholeAutoRunOfStock(state: GameState, stockId: string): WormholeAutoRun | undefined {
  return wormholeAutoRunsOf(state).find((r) => r.stockId === stockId)
}


import { wormholeAutoShipBlockReason, wormholeAutoScore, wormholeAutoDefaultShips, shipNameOf } from './wormhole/auto/fleet'
export { wormholeAutoShipBlockReason, wormholeAutoCandidates, wormholeAutoDefaultShips, shipNameOf } from './wormhole/auto/fleet'
export type { WormholeAutoCandidate } from './wormhole/auto/fleet'

export function wormholeAutoFreeCores(state: GameState, ctx: SimContext): number {
  const cap = aiCoreCap(state, ctx)
  const indOnShared = Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx))
  return Math.max(0, cap - aiCoreShipUsed(state) - indOnShared)
}


export function wormholeAutoCoreBlock(state: GameState, ctx: SimContext, need: number): CoreBlockReason | null {
  const cap = aiCoreCap(state, ctx)
  if (cap <= 0) {
    return {
      error: 'AI 核心上限为 0：先训练提升 AI 核心上限的技能（如「AI 核心操作学」）——自动探索每次占用 1 枚核心。',
      errorId: 'core.wormholeAuto.009',
    }
  }
  const indOnShared = Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx))
  const shipUsed = aiCoreShipUsed(state)
  const free = cap - shipUsed - indOnShared
  if (free < need) {
    return {
      error: `AI 核心不够：自动探索每次占用 ${need} 枚，当前只剩 ${Math.max(0, free)} 枚可派（上限 ${cap}：副船与自动探索 ${shipUsed} 枚 + 站内工业超出扩容 ${indOnShared} 枚）。先撤回一些副船任务、自动探索或站内炉线。`,
      errorId: 'core.wormholeAuto.010',
      errorParams: { p1: need, p2: Math.max(0, free), p3: cap, p4: shipUsed, p5: indOnShared },
    }
  }
  return null
}

export function signalAutoResearchBlock(state: GameState, ctx: SimContext): CoreBlockReason | null {
  return matterTechSignalAutoYield(state, ctx) > 0 ? null : {
    error: '请前往「谜质科技」，研究T3「信号空间探索」后解锁自动探索。', errorId: 'core.signalAuto.001',
  }
}


export function wormholeAutoBlockReason(
  state: GameState,
  ctx: SimContext,
  stockId: string,
  shipIds?: readonly string[],
  opts?: { mainMayJoin?: boolean; prepared?: boolean },
): CoreBlockReason | null {
  if (wormholeAutoRunOfStock(state, stockId)) return { error: '这一处已经在自动探索中。', errorId: 'core.wormholeAuto.011' }
  const item = wormholeStockOf(state).find((x) => x.id === stockId)
  if (!item) return { error: '这处虫洞不在了（可能已经探索过）。', errorId: 'core.wormholeAuto.012' }
  const signal = item.expeditionRules === undefined && opts?.prepared !== true
  if (signal) {
    const researchBlock = signalAutoResearchBlock(state, ctx)
    if (researchBlock) return researchBlock
  }
  const pool = shipIds ?? wormholeAutoDefaultShips(state, ctx)
  const budgetCheck = commandBudgetOf(state, ctx, pool, true)
  if (!budgetCheck.ok) return { error: budgetCheck.error!, errorId: budgetCheck.errorId, errorParams: budgetCheck.errorParams }
  if (pool.length === 0)
    return { error: '没有可派出的副船：自动探索不派主控船，先备至少 1 条空闲副船。', errorId: 'core.wormholeAuto.013' }
  if (pool.length > WORMHOLE_AUTO_MAX_SHIPS)
    return { error: `参与舰最多 ${WORMHOLE_AUTO_MAX_SHIPS} 条。`, errorId: 'core.wormholeAuto.014', errorParams: { p1: WORMHOLE_AUTO_MAX_SHIPS } }
  for (const shipId of pool) {
    const blocked = wormholeAutoShipBlockReason(state, shipId, opts)
    if (blocked) {
      const shipName = shipNameOf(state, ctx, shipId)
      return {
        error: `${shipName}：${blocked.error}`,
        errorId: 'core.wormholeAuto.015',
        errorParams: {
          p1: shipName,
          p2: blocked.error,
          ...(blocked.errorId !== undefined ? { p2Id: blocked.errorId } : {}),
          ...(blocked.errorParams !== undefined
            ? Object.fromEntries(Object.entries(blocked.errorParams).map(([k, v]) => [`p2${k}`, v]))
            : {}),
        },
      }
    }
  }
  const admission = wormholeAdmission(ctx, pool)
  if (!admission.ok) return { error: WORMHOLE_ADMISSION_TEXT[admission.code] }
  return signal ? null : wormholeAutoCoreBlock(state, ctx, 1)
}

export interface WormholeAutoHandover {
  needed: boolean
  toId?: string
  toName?: string
  reason?: string
  reasonId?: string
  reasonParams?: Record<string, string | number>
}

export function wormholeAutoMainHandover(
  state: GameState,
  ctx: SimContext,
  teamShipIds: readonly string[],
): WormholeAutoHandover {
  const team = new Set(teamShipIds)
  if (!team.has(state.shipId)) return { needed: false }
  const busy = shipBusyLabel(state, ctx, state.shipId)
  if (busy) {
    return {
      needed: true,
      reason: `主控正在${busy.error}：先把手上的活收工，才能把它编进自动探索队。`,
      reasonId: 'core.wormholeAuto.016',
      reasonParams: {
        p1: busy.error,
        p1Id: busy.errorId,
        ...(busy.errorParams !== undefined
          ? Object.fromEntries(Object.entries(busy.errorParams).map(([k, v]) => [`p1${k}`, v]))
          : {}),
      },
    }
  }
  if (shipLockedInWormhole(state, state.shipId))
    return { needed: true, reason: '主控正在虫洞里：先出洞。', reasonId: 'core.wormholeAuto.017' }
  const pool = Object.keys(state.fleet)
    .filter((id) => id !== state.shipId && !team.has(id))
    .filter((id) => shipBusyLabel(state, ctx, id) === null)
    .filter((id) => wormholeAutoShipBlockReason(state, id) === null)
    .sort((a, b) => wormholeAutoScore(state, ctx, b) - wormholeAutoScore(state, ctx, a) || a.localeCompare(b))
  const toId = pool[0]
  if (!toId)
    return {
      needed: true,
      reason: '舰队里没有别的空闲船可以接任主控：先收工或添一条船，再把它编进来。',
      reasonId: 'core.wormholeAuto.018',
    }
  const changeBlock = changeShipBlockReason(state, toId, ctx)
  if (changeBlock) return {
    needed: true, reason: changeBlock.error, reasonId: changeBlock.errorId,
    reasonParams: changeBlock.errorParams ? { ...changeBlock.errorParams } : undefined,
  }
  return { needed: true, toId, toName: shipNameOf(state, ctx, toId) }
}

export function wormholeAutoStart(state: GameState, ctx: SimContext, stockId: string, shipIds?: readonly string[], opts?: { prepared: WormholePreparationPlan; confirmLossRisk: true; goal?: import('./wormhole').WormholeRunState['expeditionGoal'] }, computed?: { inputKey: string; estimate: SignalAutoEstimate }): CommandResult {
  if (opts) return startPreparedAuto(state, ctx, stockId, shipIds ?? [], opts)
  const pool = shipIds ?? wormholeAutoDefaultShips(state, ctx)
  const handover = wormholeAutoMainHandover(state, ctx, pool)
  if (handover.needed && handover.reason)
    return { ok: false, error: handover.reason, errorId: handover.reasonId, errorParams: handover.reasonParams }
  const blocked = wormholeAutoBlockReason(state, ctx, stockId, shipIds, { mainMayJoin: handover.needed })
  if (blocked) return { ok: false, error: blocked.error, errorId: blocked.errorId, errorParams: blocked.errorParams }
  const item = wormholeStockOf(state).find((x) => x.id === stockId)!
  const picked = [...pool]
  const tech = wormholeAutoTechFactors(state, ctx, picked)
  const yieldMul = matterTechSignalAutoYield(state, ctx)
  if (computed && computed.inputKey !== signalAutoInputKey(state, ctx, picked, item)) return { ok: false, errorId: 'core.signalDispatch.010' }
  if (computed && (computed.estimate.version !== 2 || !cleanSignalAutoEstimate(computed.estimate))) return { ok: false, errorId: 'core.signalDispatch.004' }
  const estimate = computed?.estimate ?? signalAutoEstimateOf(state, ctx, picked, { seed: item.seed, depth: Math.max(1, Math.min(9, item.depth)),
    ...wormholeRunMeta(item) }, yieldMul, tech, wormholeAutoHoldM3Of(tech))
  if (handover.needed && handover.toId) {
    const sw = changeShip(state, handover.toId, ctx)
    if (!sw.ok) return sw
  }
  wormholeStockTake(state, stockId)
  const run: WormholeAutoRun = {
    estimateRules: 1,
    estimate,
    haulerFittingVersion: 1,
    yieldMul,
    id: `wha-${state.gameMs.toString(36)}-${wormholeAutoRunsOf(state).length.toString(36)}`,
    stockId,
    seed: item.seed,
    depth: Math.max(1, Math.min(9, item.depth)),
    archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
    family: item.family ?? wormholeFamilyOfSeed(item.seed),
    shipIds: picked,
    startedAtGameMs: state.gameMs,
    finishAtGameMs: state.gameMs + WORMHOLE_AUTO_DURATION_MS,
  }
  state.wormholeAuto = [...wormholeAutoRunsOf(state), run]
  const arch = wormholeRunMeta(run).archetype
  const roster = picked.map((id) => shipNameOf(state, ctx, id))
  addLog(
    state,
    'fleet',
    `🛰 自动探索队出发：${WORMHOLE_ARCHETYPE_LABELS[arch]} · ${picked.length} 条舰（${roster.join('、')}）` +
      `——约 ${Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} 分钟后返航。`,
    'core.signalAuto.002',
    logParams({
      p1: WORMHOLE_ARCHETYPE_LABELS[arch],
      p1Id: WORMHOLE_ARCHETYPE_IDS[arch],
      p2: picked.length,
      p3: roster.join('、'),
      p3List: roster,
      p4: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000),
    }),
  )
  return { ok: true }
}

function startPreparedAuto(
  state: GameState, ctx: SimContext, stockId: string, ships: readonly string[],
  opts: { prepared: WormholePreparationPlan; confirmLossRisk: true; goal?: import('./wormhole').WormholeRunState['expeditionGoal'] },
): CommandResult {
  if (opts.confirmLossRisk !== true || new Set(ships).size !== ships.length) return { ok: false }
  const handover = wormholeAutoMainHandover(state, ctx, ships)
  if (handover.reason) return { ok: false, errorId: handover.reasonId }
  const blocked = wormholeAutoBlockReason(state, ctx, stockId, ships, { mainMayJoin: handover.needed, prepared: true })
  if (blocked) return { ok: false, ...blocked }
  const current = wormholePreparationPlan(state, ctx, ships, opts.prepared.request, { automatic: opts.prepared.automatic })
  if (!current.ok || current.fingerprint !== opts.prepared.fingerprint) return { ok: false }
  const staged = structuredClone(state)
  if (handover.needed && handover.toId) {
    const changed = changeShip(staged, handover.toId, ctx)
    if (!changed.ok) return changed
  }
  const stock = wormholeStockOf(staged).find(s => s.id === stockId)!
  const sim = structuredClone(staged)
  const idle = createInitialState({ nowWallMs: 0, seed: stock.seed })
  sim.shipId = ships[0]!
  sim.wormhole = { run: null, lastFleetLost: 0 }
  sim.wormholeAuto = []
  sim.fleet = Object.fromEntries(ships.map(id => [id, structuredClone(staged.fleet[id]!)]))
  sim.aiAssignments = {}
  sim.mining = idle.mining; sim.salvaging = idle.salvaging; sim.hauling = idle.hauling
  sim.expedition = idle.expedition; sim.encounter = idle.encounter; sim.transit = idle.transit
  sim.scanning = idle.scanning; sim.standby = idle.standby; sim.wormholeScan = idle.wormholeScan
  sim.awayGalaxy = null; sim.dockedSite = null
  delete sim.departure
  const beforeWare = { ...sim.warehouse.items }
  const beforeModules = { ...sim.moduleBay }
  const simPlan = wormholePreparationPlan(sim, ctx, ships, current.request)
  const entered = wormholeEnterPrepared(sim, ctx, ships, stock.seed, simPlan, stockId, { expeditionRules: 2, goal: opts.goal ?? 'deep', automatic: true })
  if (!entered.ok) return { ok: false, errorId: entered.errorId }
  for (const id of new Set([...Object.keys(beforeWare), ...Object.keys(sim.warehouse.items)])) {
    const delta = (sim.warehouse.items[id] ?? 0) - (beforeWare[id] ?? 0)
    if (delta !== 0) staged.warehouse.items[id] = (staged.warehouse.items[id] ?? 0) + delta
    if (staged.warehouse.items[id] === 0) delete staged.warehouse.items[id]
  }
  for (const id of Object.keys(sim.moduleBay)) {
    const delta = (sim.moduleBay[id] ?? 0) - (beforeModules[id] ?? 0)
    if (delta > 0) staged.moduleBay[id] = (staged.moduleBay[id] ?? 0) + delta
  }
  for (const uid of ships) staged.fleet[uid]!.cargo = structuredClone(sim.fleet[uid]!.cargo)
  sim.warehouse.items = {}
  sim.moduleBay = {}
  sim.aiCores = { gamma: 0, beta: 0, alpha: 0 }
  sim.logs = []
  sim.wreckLog = []
  sim.wormholeStock = []
  wormholeStockTake(staged, stockId)
  const run: WormholeAutoRun = {
    id: `wha-${state.gameMs.toString(36)}-${wormholeAutoRunsOf(state).length.toString(36)}`,
    stockId, seed: stock.seed, depth: sim.wormhole.run!.depth,
    family: sim.wormhole.run!.family, archetype: sim.wormhole.run!.archetype,
    shipIds: [...ships], haulerFittingVersion: 1, expeditionRules: 2,
    expeditionSnapshot: JSON.stringify(sim),
    startedAtGameMs: state.gameMs, finishAtGameMs: state.gameMs + WORMHOLE_AUTO_DURATION_MS,
  }
  staged.wormholeAuto = [...wormholeAutoRunsOf(staged), run]
  Object.assign(state, staged)
  return { ok: true }
}

function finishPreparedAuto(state: GameState, ctx: SimContext, run: WormholeAutoRun, before: GameState, sim: GameState): void {
  const lost: string[] = []
  const damage: WormholeAutoReport['damage'] = []
  for (const uid of run.shipIds) {
    const result = sim.fleet[uid]
    const original = before.fleet[uid]
    if (!result) {
      lost.push(uid)
      if (state.fleet[uid]) loseShip(state, uid, ctx, '', undefined, { cause: 'wormhole-lost', wormholeDepth: sim.wormhole.lastSettle?.depth ?? run.depth })
    } else if (state.fleet[uid]) {
      state.fleet[uid] = structuredClone(result)
      damage.push({ shipId: uid, name: shipNameOf(state, ctx, uid), durabilityLossPct: Math.round(((original?.durability ?? 1) - result.durability) * 100), armorLossPct: Math.round(((original?.armorPct ?? 1) - (result.armorPct ?? 1)) * 100), durabilityPct: Math.round(result.durability * 100), armorPct: Math.round((result.armorPct ?? 1) * 100) })
    }
  }
  const gains: WormholeAutoReport['gains'] = []
  for (const [itemId, n] of Object.entries(sim.warehouse.items)) {
    const delta = n - (before.warehouse.items[itemId] ?? 0)
    if (delta > 0) {
      state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + delta
      const loot = delta - (sim.wormhole.lastSettle?.suppliesReturned?.[itemId] ?? 0)
      if (loot > 0) gains.push({ itemId, units: loot })
    }
  }
  for (const [id, n] of Object.entries(sim.moduleBay)) {
    const delta = n - (before.moduleBay[id] ?? 0)
    if (delta > 0) state.moduleBay[id] = (state.moduleBay[id] ?? 0) + delta
  }
  for (const type of ['gamma', 'beta', 'alpha'] as const) {
    const delta = sim.aiCores[type] - before.aiCores[type]
    if (delta > 0) gainAiCore(state, type, delta)
  }
  state.wormholeAutoReports = [{
    id: `${run.id}-report`, stockId: run.stockId, depth: sim.wormhole.lastSettle?.depth ?? run.depth,
    finishedAtGameMs: state.gameMs, shipIds: [...run.shipIds], coresReleased: 1, gains, damage,
    confirmed: false, expeditionRules: 2, shipsLost: lost,
    suppliesReturned: sim.wormhole.lastSettle?.suppliesReturned ?? {}, simulationMs: sim.gameMs - before.gameMs,
    suppliesFound: sim.wormhole.lastSettle?.suppliesFound ?? {},
    expeditionGoal: sim.wormhole.lastSettle?.expeditionGoal, expeditionProgress: sim.wormhole.lastSettle?.expeditionProgress,
  }, ...(state.wormholeAutoReports ?? [])].slice(0, WORMHOLE_AUTO_REPORT_MAX)
}

export function wormholeRunMeta(run: { seed: number; archetype?: WormholeArchetype; family?: import('./state').WormholeFamily }): {
  archetype: WormholeArchetype
  family: WormholeFamily
} {
  return {
    archetype: run.archetype ?? wormholeArchetypeOf(run.seed),
    family: run.family ?? wormholeFamilyOfSeed(run.seed),
  }
}

export function wormholeAutoStop(state: GameState, runId: string, ctx?: SimContext): CommandResult {
  const runs = wormholeAutoRunsOf(state)
  const run = runs.find((r) => r.id === runId)
  if (!run) return { ok: false, error: '这一趟自动探索已经结束了。', errorId: 'core.wormholeAuto.001' }
  if (run.expeditionRules !== undefined) {
    if (run.expeditionRules !== 2 || !ctx || !run.expeditionSnapshot) return { ok: false, code: 'unsupported-rules' }
    let sim: GameState
    try { sim = JSON.parse(run.expeditionSnapshot) as GameState } catch { return { ok: false, code: 'unsupported-rules' } }
    if (sim.wormhole?.run?.expeditionRules !== 2 || sim.wormhole.run.supplyVersion !== 1) return { ok: false, code: 'unsupported-rules' }
    const before = structuredClone(sim)
    const plan = wormholeExtractionPlan(sim, ctx, { leavePieces: [], leaveSupplies: {}, takeGround: [] })
    if (!wormholeConfirmExtraction(sim, ctx, plan).ok) return { ok: false, errorId: 'core.wormholeBattle.002' }
    finishPreparedAuto(state, ctx, run, before, sim)
    state.wormholeAuto = runs.filter(r => r.id !== runId)
    return { ok: true }
  }
  state.wormholeAuto = runs.filter((r) => r.id !== runId)
  if (ctx) repairCivilianFittings(state, ctx)
  addLog(state, 'fleet', '🛰 自动探索队已召回：没有收益、也没有损伤；那条通道就此关闭。', 'core.wormholeAuto.019')
  return { ok: true }
}

export function wormholeAutoStopByShip(state: GameState, shipId: string, ctx?: SimContext): CommandResult {
  const run = wormholeAutoRunsOf(state).find((r) => r.shipIds.includes(shipId))
  if (!run) return { ok: false, error: '这一趟自动探索已经结束了。', errorId: 'core.wormholeAuto.001' }
  return wormholeAutoStop(state, run.id, ctx)
}


function autoRng(seed: number, salt: number): () => number {
  let count = 0
  return () => {
    count += 1
    let x = (seed + (salt + count) * 2654435761) >>> 0
    x ^= x << 13
    x >>>= 0
    x ^= x >> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

let reportSeq = 0

export function advanceWormholeAuto(state: GameState, ctx: SimContext): void {
  const runs = wormholeAutoRunsOf(state)
  if (runs.length === 0) return
  const due = runs.filter((r) => state.gameMs >= r.finishAtGameMs
    && (r.expeditionRules === undefined || (r.expeditionRules === 2 && r.expeditionSnapshot !== undefined))
    && (r.estimateRules === undefined || r.expeditionRules === undefined && r.estimateRules === 1 && cleanSignalAutoEstimate(r.estimate) !== undefined))
  if (due.length === 0) return
  for (const run of due.filter(r => r.expeditionRules === 2)) {
    try {
      const sim = JSON.parse(run.expeditionSnapshot!) as GameState
      if (sim.wormhole?.run?.expeditionRules !== 2 || sim.wormhole.run.supplyVersion !== 1) continue
      const before = structuredClone(sim)
      const result = wormholeRunExpeditionPolicy(sim, ctx)
      if (result.state.wormhole.run) {
        const plan = wormholeExtractionPlan(result.state, ctx, { leavePieces: [], leaveSupplies: {}, takeGround: [] })
        if (!wormholeConfirmExtraction(result.state, ctx, plan).ok) continue
      }
      const staged = structuredClone(state)
      finishPreparedAuto(staged, ctx, run, before, result.state)
      staged.wormholeAuto = wormholeAutoRunsOf(staged).filter(r => r.id !== run.id)
      Object.assign(state, staged)
    } catch { }
  }
  const legacyDue = due.filter(r => r.expeditionRules === undefined)
  const dueIds = new Set(legacyDue.map((r) => r.id))
  state.wormholeAuto = wormholeAutoRunsOf(state).filter((r) => !dueIds.has(r.id))
  for (const run of legacyDue) {
    let runCtx = ctx
    if (run.haulerFittingVersion !== 1) {
      const ships = new Map(ctx.ships)
      for (const uid of run.shipIds) {
        const defId = state.fleet[uid]?.defId ?? uid
        const def = ships.get(defId)
        const legacy = LEGACY_HAULER_STATS[defId]
        if (def && legacy) ships.set(defId, { ...def, ...legacy, civilianFittingOnly: false })
      }
      runCtx = { ...ctx, ships }
    }
    settleRun(state, runCtx, run)
  }
  repairCivilianFittings(state, ctx)
}

function settleRun(state: GameState, ctx: SimContext, run: WormholeAutoRun): void {
  const rng = autoRng(run.seed, run.depth * 977)
  const damageRng = autoRng(run.seed, run.depth * 31 + 7)
  const meta = wormholeRunMeta(run)
  const cardId = wormholeCardIdOfFamily(meta.family, run.seed)
  const family = String(ctx.anomalies.get(cardId)?.foeFamily ?? meta.family)
  const tf = run.estimateRules === 1 ? run.estimate!.tech : wormholeAutoTechFactors(state, ctx, run.shipIds)
  const gains: Array<{ itemId: string; units: number }> = []
  let coresGained: { type: 'gamma' | 'beta' | 'alpha'; n: number } | null = null

  if (run.estimateRules === 1 && run.estimate) {
    gains.push(...run.estimate.gains.map(gain => ({ ...gain })))
    for (const core of run.estimate.cores) gainAiCore(state, core.type, core.n)
    coresGained = run.estimate.cores[0] ? { ...run.estimate.cores[0] } : null
  } else {

  const adm = wormholeAdmission(ctx, run.shipIds)
  const descend = wormholeAutoDescend({
    yieldMul: run.yieldMul ?? WORMHOLE_AUTO_SIM_YIELD_MUL,
    seed: run.seed,
    startDepth: Math.max(1, Math.min(9, run.depth)),
    totalMass: adm.totalMass,
    holdM3: wormholeAutoHoldM3Of(tf),
    oreUnitM3: ctx.items.get(WORMHOLE_ORE_ITEM_ID)?.unitM3 ?? 1,
    miners: wormholeMinersInFleet(state, ctx, run.shipIds),
    salvagers: wormholeSalvagersInFleet(state, ctx, run.shipIds),
    power: fleetPowerOf(state, ctx, run.shipIds),
    scanRadius: 1 + wormholeScanBonusOf(ctx, run.shipIds) + matterTechWhBuffs(state, ctx).scanRadius,
    blankShareFactor: blankShareFactorOf(state),
    guardPowerOf: (d) => guardPowerOf(ctx, meta.family, d),
    techTurnBonus: Math.max(0, Math.round(tf.baseTurns * tf.turnMul) - tf.baseTurns),
    tech: { wreck: tf.wreck, ore: tf.ore },
  })

  const group = wreckGroupOfCard(cardId, ctx)
  const wreckKey = group?.key ?? cardId
  if (descend.wreckM3 > 0) gains.push({ itemId: wreckItemIdOf(wreckKey), units: descend.wreckM3 })

  const rareBase = Math.floor(descend.rareItems)
  const rareN = rareBase + (rng() < descend.rareItems - rareBase ? 1 : 0)
  if (rareN > 0) {
    gains.push({ itemId: rareWreckItemIdOf(wreckKey), units: rareN * RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume') })
  }

  if (descend.oreUnits > 0) gains.push({ itemId: WORMHOLE_ORE_ITEM_ID, units: descend.oreUnits })

  const boxBase = Math.floor(descend.relicBoxes)
  const boxN = boxBase + (rng() < descend.relicBoxes - boxBase ? 1 : 0)
  for (let i = 0; i < boxN; i++) {
    const boxId = wormholeRollRelicBoxKind(rng, ctx, descend.depthReached, family)
    if (boxId !== undefined) gains.push({ itemId: boxId, units: 1 })
  }

  const coreChance = Math.min(0.95, WORMHOLE_AUTO_MANUAL.cores * (1 + 0.15 * Math.max(0, descend.depthReached - 1)) * tf.wreck)
  if (rng() < coreChance) {
    const total = WORMHOLE_CORE_WEIGHTS.gamma + WORMHOLE_CORE_WEIGHTS.beta + WORMHOLE_CORE_WEIGHTS.alpha
    let pick = rng() * total
    let got: 'gamma' | 'beta' | 'alpha' = 'gamma'
    for (const t of ['gamma', 'beta', 'alpha'] as const) {
      pick -= WORMHOLE_CORE_WEIGHTS[t]
      if (pick < 0) {
        got = t
        break
      }
    }
    gainAiCore(state, got)
    coresGained = { type: got, n: 1 }
  }

  const essenceBase = Math.floor(descend.matterDevices)
  const essenceN = essenceBase + (rng() < descend.matterDevices - essenceBase ? 1 : 0)
  if (essenceN > 0) gains.push({ itemId: WORMHOLE_ESSENCE_ITEM_ID, units: essenceN })
  }

  for (const g of gains) {
    g.units = ceilFinalQuantity(g.units)
    state.warehouse.items[g.itemId] = (state.warehouse.items[g.itemId] ?? 0) + g.units
  }

  const damage = run.shipIds.map((shipId) => {
    const ship = state.fleet[shipId]
    const dura = ship?.durability ?? 1
    const armor = ship?.armorPct ?? 1
    const dLoss = (WORMHOLE_AUTO_DAMAGE_MIN + damageRng() * (WORMHOLE_AUTO_DAMAGE_MAX - WORMHOLE_AUTO_DAMAGE_MIN)) * tf.damage
    const aLoss = (WORMHOLE_AUTO_DAMAGE_MIN + damageRng() * (WORMHOLE_AUTO_DAMAGE_MAX - WORMHOLE_AUTO_DAMAGE_MIN)) * tf.damage
    const nextDura = Math.max(WORMHOLE_AUTO_HULL_FLOOR, dura * (1 - dLoss))
    const nextArmor = Math.max(0, armor * (1 - aLoss))
    if (ship) {
      ship.durability = nextDura
      ship.armorPct = nextArmor
    }
    return {
      shipId,
      name: shipNameOf(state, ctx, shipId),
      durabilityLossPct: Math.round((1 - nextDura / (dura || 1)) * 100),
      armorLossPct: Math.round((1 - nextArmor / (armor || 1)) * 100),
      durabilityPct: Math.round(nextDura * 100),
      armorPct: Math.round(nextArmor * 100),
    }
  })

  reportSeq += 1
  const report: WormholeAutoReport = {
    id: `whar-${state.gameMs.toString(36)}-${reportSeq.toString(36)}`,
    stockId: run.stockId,
    depth: run.estimateRules === 1 ? run.estimate!.depthReached : run.depth,
    finishedAtGameMs: state.gameMs,
    shipIds: [...run.shipIds],
    coresReleased: 0,
    gains,
    ...(run.estimateRules === 1 && run.estimate?.report ? { signalAuto: run.estimate.report } : {}),
    ...(coresGained !== null ? { cores: [coresGained] } : {}),
    damage,
    confirmed: false,
  }
  state.wormholeAutoReports = [report, ...wormholeAutoReportsOf(state)].slice(0, WORMHOLE_AUTO_REPORT_MAX)

  const gainText = gains.length > 0 ? gains.map((g) => `${itemNameOf(ctx, g.itemId)} ×${g.units}`).join('、') : '空手而归'
  const coreText = coresGained ? `，并带回 ${aiCoreName(coresGained.type)} ×${coresGained.n}（已直接接入核心库）` : ''
  const dmgText = damage.map((d) => `${d.name}（结构 −${d.durabilityLossPct}% / 装甲 −${d.armorLossPct}%）`).join('、')
  const techText = wormholeAutoTechIsNeutral(tf)
    ? ''
    : `谜质科技：残骸线 ×${tf.wreck.toFixed(2)} · 母矿线 ×${tf.ore.toFixed(2)} · 损伤 ×${tf.damage.toFixed(2)}。`
  addLog(
    state,
    'fleet',
    `🛰 自动探索队返航：带回 ${gainText}（已入仓库）${coreText}；损伤：${dmgText}。${techText}` +
      `${run.shipIds.length} 条舰全部安全返航——报告在「扫描信号空间」页等你确认。`,
    'core.signalAuto.003',
    logParams({
      p1: gainText,
      p5: run.shipIds.length,
      ...(gains.length > 0
        ? {
            p1List: gains.map((g) => itemNameOf(ctx, g.itemId)),
            p1ItemId: 'core.wormholeAuto.022',
            p1ItemParams: gains.map((g) => ({ p2: g.units })),
          }
        : { p1Id: 'core.wormholeAuto.023' }),
      ...(coresGained
        ? {
            p2: coreText,
            p2Id: 'core.wormholeAuto.024',
            p2p1: aiCoreName(coresGained.type),
            p2p1Id: AI_CORE_IDS[coresGained.type],
            p2p2: coresGained.n,
          }
        : { p2: '' }),
      p3: dmgText,
      ...(damage.length > 0
        ? {
            p3List: damage.map((d) => d.name),
            p3ItemId: 'core.wormholeAuto.025',
            p3ItemParams: damage.map((d) => ({ p2: d.durabilityLossPct, p3: d.armorLossPct })),
          }
        : {}),
      p4: techText,
      ...(techText !== ''
        ? {
            p4Id: 'core.wormholeAuto.026',
            p4p1: tf.wreck.toFixed(2),
            p4p2: tf.ore.toFixed(2),
            p4p3: tf.damage.toFixed(2),
          }
        : {}),
    }),
  )
}

export function wormholeAutoConfirmReport(state: GameState, reportId: string): CommandResult {
  const list = wormholeAutoReportsOf(state)
  const report = list.find((r) => r.id === reportId)
  if (!report) return { ok: false, error: '这份报告不在了。', errorId: 'core.wormholeAuto.003' }
  if (report.confirmed) return { ok: true }
  report.confirmed = true
  state.wormholeAutoReports = [...list]
  return { ok: true }
}

export function wormholeAutoConfirmAll(state: GameState): number {
  const list = wormholeAutoReportsOf(state)
  let n = 0
  for (const r of list) {
    if (!r.confirmed) {
      r.confirmed = true
      n += 1
    }
  }
  if (n > 0) state.wormholeAutoReports = [...list]
  return n
}

export function itemNameOf(ctx: SimContext, itemId: string): string {
  return ctx.items.get(itemId)?.name ?? itemId
}

export function wormholeAutoStockOf(state: GameState): WormholeStockItem[] {
  return wormholeStockOf(state)
}
