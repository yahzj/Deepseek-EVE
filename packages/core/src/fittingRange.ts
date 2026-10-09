import type { GameState, BattleState } from './state'
import type { AnomalyDef, FoeShipDef, SimContext } from './types'
import { createInitialState } from './state'
import { advanceBattleFor, startBattleFor } from './combat'
import { fleetDefOf } from './instances'

export const RANGE_CARD_ID = 'fitting-range-target'
export const RANGE_DURATION_MS = 60000
export const RANGE_MAX_DISTANCE_M = 50000
export type RangeLayer = 's' | 'a' | 'h'
export interface RangeWeaponResult { index: number; moduleId?: string; artId?: string; label: string; src?: string; shots: number; hits: number; damage: number }
export interface FittingRange {
  state: GameState
  ctx: SimContext
  uid: string
  battle: BattleState
  distanceM: number
  layer: RangeLayer
  paused: boolean
  results: Record<number, RangeWeaponResult>
}

/** 只复制当前目标，不复制真实活动；所有库存写入都发生在模拟副本。 */
export function createFittingRange(source: GameState, ctx: SimContext, uid: string, name: string, distanceM = 5000, layer: RangeLayer = 's'): FittingRange | null {
  const ship = source.fleet[uid]
  const def = fleetDefOf(source, ctx, uid)
  if (!ship || !def) return null
  const state = createInitialState({ nowWallMs: 0, seed: 20261009 })
  state.fleet = { [uid]: structuredClone(ship) }
  state.fleet[uid]!.defId = def.id
  state.shipId = uid
  state.skills = structuredClone(source.skills)
  state.research = structuredClone(source.research)
  state.importantTasks = { ...state.importantTasks, 'first-bounty': { done: true } }
  state.debugQuick = false
  state.resupplyFromWarehouse = true
  state.gameMs = 0
  for (const item of ctx.items.values()) {
    if (item.kind === 'ammo' || item.kind === 'kit') state.warehouse.items[item.id] = 1e9
  }
  const target: FoeShipDef = {
    id: 'foe-pirate-skiff', name, family: 'A', hullClassTier: 1, speedRatio: 0, hp: 30000,
    split: { s: 1 / 3, a: 1 / 3, h: 1 / 3 }, evasion: 0, shotDmg: 0, hitRate: 0,
    rangeMinM: 0, rangeMaxM: RANGE_MAX_DISTANCE_M, falloff: 1, reloadMs: 1e9,
    dmgMix: { kinetic: 1 }, tactic: 'orbit', desireRangeM: distanceM,
  }
  const card: AnomalyDef = { id: RANGE_CARD_ID, name, description: '', galaxyId: 'galaxy-hub', threat: 1, standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 60, ships: [{ ship: target }] }
  const local = { ...ctx, anomalies: new Map([[card.id, card]]), balance: { ...ctx.balance, battle: { ...ctx.balance.battle, maxBattleMs: 1e9, cannotEngageMs: 0, shieldRegenPerSec: 0 } } }
  const battle = startBattleFor(state, local, uid, card.id, 0, distanceM)
  if (!battle) return null
  battle.distanceM = Math.max(0, Math.min(RANGE_MAX_DISTANCE_M, distanceM))
  delete battle.hullEscapeFrac
  for (const rt of Object.values(battle.units)) if (rt.side === 'foe') {
    rt.weapons = rt.weapons.map(() => 1e9)
    rt.hp = { s: layer === 's' ? 10000 : 0, a: layer === 'a' ? 10000 : 0, h: layer === 'h' ? 10000 : 0 }
  }
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card.id, battle, finishAtGameMs: 1e9 }
  return { state, ctx: local, uid, battle, distanceM: battle.distanceM, layer, paused: false, results: {} }
}

export function advanceFittingRange(range: FittingRange, dtMs: number): void {
  if (range.paused || !Number.isFinite(dtMs) || dtMs <= 0) return
  const remaining = RANGE_DURATION_MS - range.battle.lastTickGameMs
  if (remaining <= 0) { range.paused = true; return }
  const distanceM = Math.max(0, Math.min(RANGE_MAX_DISTANCE_M, Number.isFinite(range.distanceM) ? range.distanceM : 5000))
  range.distanceM = distanceM
  range.state.gameMs += Math.min(remaining, dtMs)
  range.battle.ammo = { kin: 1e9, exp: 1e9, pla: 1e9 }
  advanceBattleFor(range.state, range.ctx, range.battle, range.uid, RANGE_CARD_ID, null, undefined, undefined, {
    simulation: { distanceM, layer: range.layer, onShot: ({ index, weapon, hit, damage }) => {
      const row = range.results[index] ?? (range.results[index] = { index, label: weapon.label, moduleId: weapon.moduleId, artId: weapon.artId, src: weapon.src, shots: 0, hits: 0, damage: 0 })
      row.shots++
      row.hits += Number(hit)
      row.damage += damage
    } },
  })
  if (range.battle.lastTickGameMs >= RANGE_DURATION_MS) range.paused = true
}

export function fittingRangeStats(range: FittingRange) {
  const elapsedMs = Math.max(0, range.battle.lastTickGameMs - range.battle.startedAtGameMs)
  const groups = new Map<string, RangeWeaponResult>()
  for (const row of Object.values(range.results)) {
    const key = JSON.stringify([row.src, row.moduleId, row.artId])
    const group = groups.get(key)
    if (group) { group.shots += row.shots; group.hits += row.hits; group.damage += row.damage }
    else groups.set(key, { ...row })
  }
  return { elapsedMs, damage: range.battle.stats.meDmg, dps: elapsedMs > 0 ? range.battle.stats.meDmg * 1000 / elapsedMs : 0,
    shots: range.battle.stats.meShots, hits: range.battle.stats.meHits, weapons: [...groups.values()] }
}
