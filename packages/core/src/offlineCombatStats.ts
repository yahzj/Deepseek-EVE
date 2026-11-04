import type { BattleState, GameState } from './state'

export type TransportStopReason = 'arrival' | 'interrupted' | 'capacity' | 'defeat' | 'damage' | 'loss'
export interface OfflineCombatStats {
  encounters: number
  wins: number
  defeats: number
  escapes: number
  shipsLost: number
  ammoUsed: number
  kitsUsed: number
  deliveries: number
  deliveredM3: number
  transportIncome: number
  stopReason?: TransportStopReason
}

interface Collector { stats: OfflineCombatStats; seen: WeakMap<BattleState, { ammo: number; kits: number }>; outcomes: WeakSet<BattleState>; encounters: WeakSet<BattleState> }
const collectors = new WeakMap<GameState, Collector>()

/** 只在本次离线结算内启用，不修改存档，不保存逐场战斗。 */
export function beginOfflineCombatStats(state: GameState, stats: OfflineCombatStats): () => void {
  const previous = collectors.get(state)
  collectors.set(state, { stats, seen: new WeakMap(), outcomes: new WeakSet(), encounters: new WeakSet() })
  if (state.encounter.battle) noteOfflineEncounter(state, state.encounter.battle)
  for (const battle of [state.encounter.battle, state.expedition.battle, state.wormhole.run?.battle]) {
    // 离线前已经消耗的补给不再次计入本次简报。
    if (battle) observeOfflineBattle(state, battle, true)
  }
  return () => { if (previous) collectors.set(state, previous); else collectors.delete(state) }
}

export function newOfflineCombatStats(): OfflineCombatStats {
  return { encounters: 0, wins: 0, defeats: 0, escapes: 0, shipsLost: 0, ammoUsed: 0, kitsUsed: 0, deliveries: 0, deliveredM3: 0, transportIncome: 0 }
}

export function noteOfflineEncounter(state: GameState, battle: BattleState): void {
  const collector = collectors.get(state)
  if (!collector || collector.encounters.has(battle)) return
  collector.encounters.add(battle)
  collector.stats.encounters++
}

export function observeOfflineBattle(state: GameState, battle: BattleState, baseline = false): void {
  const collector = collectors.get(state)
  if (!collector) return
  const ammo = (['kin', 'exp', 'pla'] as const).reduce((sum, key) => sum + Math.max(0, (battle.ammoLoaded?.[key] ?? battle.ammo[key]) - battle.ammo[key]), 0)
  const repairs = battle.repairBy ? Object.values(battle.repairBy) : battle.repair ? [battle.repair] : []
  const kits = repairs.reduce((sum, ledger) => sum + ledger.kitsUsed, 0)
    + Object.values(battle.repairDroneBy ?? {}).reduce((sum, ledger) => sum + ledger.kitsUsed, 0)
    + (battle.dcKitsUsed ?? 0)
  const before = collector.seen.get(battle) ?? { ammo: 0, kits: 0 }
  if (!baseline) {
    collector.stats.ammoUsed += Math.max(0, ammo - before.ammo)
    collector.stats.kitsUsed += Math.max(0, kits - before.kits)
  }
  collector.seen.set(battle, { ammo, kits })
}

export function noteOfflineEncounterOutcome(state: GameState, battle: BattleState, outcome: 'win' | 'lose' | 'break', lost: number): void {
  const collector = collectors.get(state)
  if (!collector || collector.outcomes.has(battle)) return
  noteOfflineEncounter(state, battle)
  observeOfflineBattle(state, battle)
  collector.outcomes.add(battle)
  if (outcome === 'win') collector.stats.wins++
  else if (outcome === 'break') collector.stats.escapes++
  else collector.stats.defeats++
  collector.stats.shipsLost += Math.max(0, lost)
}

export function noteOfflineDelivery(state: GameState, volume: number, income: number): void {
  const collector = collectors.get(state)
  if (!collector) return
  collector.stats.deliveries++
  collector.stats.deliveredM3 += volume
  collector.stats.transportIncome += income
}

export function noteOfflineTransportStop(state: GameState, reason: TransportStopReason): void {
  const collector = collectors.get(state)
  if (collector) collector.stats.stopReason = reason
}

export function noteOfflineRepairKits(state: GameState, count: number): void {
  const collector = collectors.get(state)
  if (collector) collector.stats.kitsUsed += Math.max(0, count)
}
