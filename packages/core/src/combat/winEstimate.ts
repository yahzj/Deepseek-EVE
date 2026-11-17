import type { FittedModules, GameState } from '../state'
import { createInitialState } from '../state'
import type { AnomalyDef, SimContext } from '../types'
import { addShipToFleet } from '../shipyard'
import type { UnitSpec } from './model'
import { advanceBattleFor } from './advance'
import { createPlayerSpec } from './player/create'
import { desiredRangeFor, mainWeaponOf } from './foes/tactics'
import { startBattleFor } from './startSingle'
import { waveGapTotalMs } from './combatMath'
import { combatRosterOf } from './command/roster'
import { startFleetBattleFor } from './startFleet'

export const BOUNTY_MC_RUNS = 10

const AMMO_ITEM_IDS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l'] as const

export interface BountyWinMC {
  winRate: number
  worstWinRate: number
  armorLoss: number
  hullLoss: number
  runs: number
  points: readonly { desireM: number; winRate: number; runs: number }[]
  recorded: boolean
}

function seedOf(parts: readonly (string | number)[]): number {
  let h = 2166136261
  for (const p of parts) {
    const s = String(p)
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x9e3779b9
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function buildEvalState(state: GameState, shipId: string): { ev: GameState; uid: string } | null {
  const real = state.fleet[shipId]
  const defId = real?.defId
  if (!real || !defId) return null
  const ev = createInitialState({ nowWallMs: 0, seed: 1 })
  ev.fleet = {}
  ev.resupplyFromWarehouse = state.resupplyFromWarehouse !== false
  const uid = addShipToFleet(ev, defId)
  const f = ev.fleet[uid]!
  f.fitted = JSON.parse(JSON.stringify(real.fitted ?? {})) as FittedModules
  if (real.droneLoad !== undefined) f.droneLoad = { ...real.droneLoad }
  f.armorPct = real.armorPct ?? 1
  f.durability = real.durability ?? 1
  f.customName = real.customName
  if (real.plugs) f.plugs = [...real.plugs]
  if (real.damagePlugs) f.damagePlugs = [...real.damagePlugs]
  const squad = [uid]
  for (const id of combatRosterOf(state, shipId).filter(id => id !== shipId)) {
    const member = state.fleet[id]
    if (!member?.defId) continue
    const copyId = addShipToFleet(ev, member.defId)
    ev.fleet[copyId] = structuredClone(member)
    squad.push(copyId)
    provisionEvalSupplies(ev, ev.fleet[copyId])
  }
  if (squad.length > 1) ev.preparationSquads = { combat: squad }
  if (real.ammoPref !== undefined) f.ammoPref = { ...real.ammoPref }
  f.cargo = {}
  ev.resupplyFromWarehouse = state.resupplyFromWarehouse !== false
  provisionEvalSupplies(ev, f)
  ev.skills.trained = { ...state.skills.trained }
  ev.skills.queue = []
  if (state.battleRangeByCard) ev.battleRangeByCard = structuredClone(state.battleRangeByCard)
  const fb = state.importantTasks['first-bounty']
  if (fb !== undefined) ev.importantTasks['first-bounty'] = { ...fb }
  ev.expedition.lairTier = state.expedition.lairTier
  ev.expedition.factionActive = state.expedition.factionActive
  ev.shipId = uid
  return { ev, uid }
}

function provisionEvalSupplies(ev: GameState, f: { cargo?: Record<string, number>; ammoPref?: Partial<Record<string, string>> } | undefined): void {
  const ids = [...AMMO_ITEM_IDS, ...Object.values(f?.ammoPref ?? {}).filter((id): id is string => typeof id === 'string'), 'repairkit-civ', 'repairkit-mil']
  if (ev.resupplyFromWarehouse !== false) {
    for (const id of ids) ev.warehouse.items[id] = 1_000_000
    return
  }
  if (!f) return
  f.cargo = f.cargo ?? {}
  for (const id of ids) f.cargo[id] = 1_000_000
}

function shipFingerprintOf(ev: GameState, uid: string): string {
  const f = ev.fleet[uid]
  const tr = ev.skills.trained
  const sk = Object.keys(tr)
    .sort()
    .map((k) => `${k}:${tr[k]}`)
    .join(',')
  return `${f?.defId ?? ''}|${JSON.stringify(combatRosterOf(ev).map(id => ev.fleet[id]))}|${sk}`
}

export function evalDistancePoints(me: UnitSpec, ctx: SimContext): { max: number; min: number; mid: number } {
  const bal = ctx.balance.battle
  const main = mainWeaponOf(me)
  return {
    max: Math.max(bal.minDistanceM, Math.round(main?.maxRangeM ?? 0)),
    min: Math.max(bal.minDistanceM, Math.round(main?.minRangeM ?? 0)),
    mid: desiredRangeFor(me, 'mid', bal),
  }
}

export function estimateBountyWinOn(
  ev: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  uid: string,
  runs: number = BOUNTY_MC_RUNS,
  seedBase = 0,
): BountyWinMC {
  void seedBase
  const bal = ctx.balance.battle
  const anomalyId = anomaly.id
  const specProbe = createPlayerSpec(ev, ctx, uid)
  const pts = specProbe ? evalDistancePoints(specProbe, ctx) : null
  const record = ev.winRecord?.[anomalyId]
  const recorded = record !== undefined && record.desireM > 0
  const recD = ((): number => {
    if (!record) return 0
    if (!pts) return record.desireM
    return Math.min(pts.max, Math.max(pts.min, record.desireM))
  })()

  const plan: { desireM: number; runs: number; tag: string }[] = recorded
    ? [{ desireM: recD, runs: runs * 3, tag: 'record' }]
    : pts
      ? [
          { desireM: pts.max, runs, tag: 'max' },
          { desireM: pts.min, runs, tag: 'min' },
          { desireM: pts.mid, runs, tag: 'mid' },
        ]
      : [{ desireM: 0, runs: runs * 3, tag: 'default' }]

  let wins = 0
  let total = 0
  let armorLeftSum = 0
  let hullLeftSum = 0
  const points: { desireM: number; winRate: number; runs: number }[] = []
  const fingerprint = shipFingerprintOf(ev, uid)
  for (const p of plan) {
    let pWins = 0
    for (let i = 0; i < p.runs; i += 1) {
      ev.rng = { seed: seedOf([anomalyId, fingerprint, p.tag, p.desireM, i]), count: 0 }
      const f = ev.fleet[uid]
      if (f) {
        const ap = f.armorPct ?? 1
        f.armorPct = Math.min(1, Math.max(0, ap))
        provisionEvalSupplies(ev, f)
      }
      ev.gameMs = 0
      for (const id of combatRosterOf(ev)) provisionEvalSupplies(ev, ev.fleet[id])
      const roster = combatRosterOf(ev)
      const battle = roster.length > 1 ? startFleetBattleFor(ev, ctx, roster, anomalyId, 0, p.desireM > 0 ? p.desireM : undefined)
        : startBattleFor(ev, ctx, uid, anomalyId, 0, p.desireM > 0 ? p.desireM : undefined)
      if (!battle) continue
      const pl0 = battle.units['player']
      if (!pl0) continue
      const a0 = pl0.hp.a
      const h0 = pl0.hp.h
      ev.gameMs = bal.maxBattleMs + 5_000 + waveGapTotalMs(anomaly, bal)
      advanceBattleFor(ev, ctx, battle, uid, anomalyId)
      const pl = battle.units['player']
      if (!pl) continue
      total += 1
      if (battle.ended === 'me') {
        wins += 1
        pWins += 1
      }
      armorLeftSum += a0 > 0 ? Math.min(1, Math.max(0, pl.hp.a / a0)) : 0
      hullLeftSum += h0 > 0 ? Math.min(1, Math.max(0, pl.hp.h / h0)) : 0
    }
    points.push({ desireM: p.desireM, winRate: p.runs > 0 ? pWins / p.runs : 0, runs: p.runs })
  }
  const done = Math.max(1, total)
  const winRate = wins / done
  const worstWinRate = points.length > 0 ? Math.min(...points.map((x) => x.winRate)) : winRate
  return {
    winRate,
    worstWinRate,
    armorLoss: 1 - armorLeftSum / done,
    hullLoss: 1 - hullLeftSum / done,
    runs: done,
    points,
    recorded,
  }
}

export function estimateBountyWinMC(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
  runs: number = BOUNTY_MC_RUNS,
): BountyWinMC | null {
  const snap = buildEvalState(state, shipId)
  if (!snap) return null
  return estimateBountyWinOn(snap.ev, ctx, anomaly, snap.uid, runs)
}
