import { shipLockedReason, type GameState } from '../state'
import type { SimContext, ShipDef } from '../types'
import { fleetDefOf } from '../instances'
import { shipActuallyDocked, shipOperationBlockReason } from '../shipActionPolicy'
import { allFittedModules, takeDroneUnit } from '../equipment'
import { moduleAllowedOnShip } from '../shipFitting'
import { startFleetBattleFor } from '../combat/startFleet'
import { advanceBattleFor } from '../combat/advance'
import { refundBattleAmmo } from '../combat/combatAmmo'
import { refundRepairKitsAll } from '../combat/combatRepair'
import { waveGapTotalMs } from '../combat/combatMath'
import { STATION_SECURITY_SOURCES, STATION_SECURITY_JOB_MS, STATION_SECURITY_TRAVEL_MS,
  type StationSecurityResult } from './security'
import { CREW_BONUS_CAP, type StationCrewShip } from './crew'

export interface StationSecurityBonus { damagePct: number; defensePct: number }

export function stationShipAvailable(state: GameState, ctx: SimContext, uid: string, ignoreStationLock = false): boolean {
  const ship = state.fleet[uid]
  if (!ship || uid === state.shipId || !(ship.durability > 0) || !fleetDefOf(state, ctx, uid)) return false
  const station = state.playerStation
  if (!ignoreStationLock && station?.shipLocks[uid]) return false
  // 原门禁可能接入玩家站锁；去掉本站账再查实体忙碌，避免互相递归。
  const physical = { ...state, playerStation: undefined }
  return !shipOperationBlockReason(physical, ctx, uid, 'configure') && !shipLockedReason(physical, uid)
    && shipActuallyDocked(physical, ctx, uid)
}

export function stationCrewShip(state: GameState, ctx: SimContext, uid: string): StationCrewShip | undefined {
  const def = fleetDefOf(state, ctx, uid), ship = state.fleet[uid]
  if (!def || !ship) return undefined
  const modules = allFittedModules(ship.fitted, ctx).filter(mod => moduleAllowedOnShip(def, mod))
  const physical = { ...state, playerStation: undefined }
  const trainingTags: string[] = []
  if (modules.some(mod => ['turret', 'missile', 'laser'].includes(mod.slot)
    && (mod.maxRangeM ?? 0) > 0 && (mod.reloadMs ?? 0) > 0)) trainingTags.push('fire-control')
  if (modules.some(mod => (mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0)) trainingTags.push('damage-control')
  if (def.civilianFittingOnly !== true && Object.entries(ship.droneLoad ?? {})
    .some(([id, n]) => n > 0 && ctx.items.get(id)?.kind === 'drone')) trainingTags.push('drones')
  // 正式舰种以 tier 表示：T1护卫/T2驱逐/T3巡洋/T4战列/T5泰坦。
  return { tier: def.tier >= 4 ? 3 : def.tier >= 3 ? 2 : 1, trainingTags,
    available: stationShipAvailable(state, ctx, uid),
    home: uid !== state.shipId && shipActuallyDocked(physical, ctx, uid) }
}

function boostedDef(base: ShipDef, bonus: StationSecurityBonus): ShipDef {
  return { ...base, powerBonus: (1 + (base.powerBonus ?? 0)) * (1 + bonus.damagePct) - 1,
    droneDmgBonus: (1 + (base.droneDmgBonus ?? 0)) * (1 + bonus.damagePct) - 1,
    shieldHp: Math.ceil((base.shieldHp ?? 0) * (1 + bonus.defensePct)),
    armorHp: Math.ceil((base.armorHp ?? 0) * (1 + bonus.defensePct)),
    hullHp: Math.ceil((base.hullHp ?? 0) * (1 + bonus.defensePct)) }
}

/** 只计算一次战斗；真实扣款与奖励由 StationSecurityHost 原子处理，不提交模拟战损。 */
export function stationSecurityResolve(state: GameState, ctx: SimContext, shipIds: readonly string[], sourceId: string,
  bonuses: Readonly<Record<string, StationSecurityBonus>> = {}): StationSecurityResult {
  if (shipIds.length < 1 || shipIds.length > 4 || new Set(shipIds).size !== shipIds.length
    || shipIds.some(id => !stationShipAvailable(state, ctx, id, true))
    || !STATION_SECURITY_SOURCES.some(source => source.id === sourceId) || !ctx.anomalies.has(sourceId)) {
    throw new Error('Invalid station security deployment')
  }
  if (Object.keys(bonuses).some(id => !shipIds.includes(id)) || Object.values(bonuses).some(bonus =>
    ![bonus.damagePct, bonus.defensePct].every(n => Number.isFinite(n) && n >= 0 && n <= CREW_BONUS_CAP))) {
    throw new Error('Invalid station security bonus')
  }
  const ships = new Map(ctx.ships)
  const fleet: GameState['fleet'] = {}
  const supplyIds = new Set<string>()
  for (const def of [...ctx.modules.values(), ...ctx.items.values()]) {
    if (def.repairKit) supplyIds.add(def.repairKit)
    if ('hullSaveKit' in def && def.hullSaveKit) supplyIds.add(def.hullSaveKit)
  }
  for (const uid of shipIds) {
    const ship = state.fleet[uid]!
    // 船货不进入本站补给预算；保留非战斗货物，原船货一件也不移动或退款。
    const cargo = Object.fromEntries(Object.entries(ship.cargo).filter(([id]) =>
      !['ammo', 'kit', 'drone'].includes(ctx.items.get(id)?.kind ?? '') && !supplyIds.has(id)))
    fleet[uid] = { ...ship, cargo, fitted: { high: [...ship.fitted.high], mid: [...ship.fitted.mid], low: [...ship.fitted.low] },
      droneLoad: { ...ship.droneLoad }, ammoPref: { ...ship.ammoPref }, plugs: [...(ship.plugs ?? [])], damagePlugs: [...(ship.damagePlugs ?? [])] }
    const bonus = bonuses[uid]
    if (!bonus || bonus.damagePct === 0 && bonus.defensePct === 0) continue
    const id = `station-security:${uid}`
    ships.set(id, boostedDef(fleetDefOf(state, ctx, uid)!, bonus))
    fleet[uid]!.defId = id
  }
  const context = { ...ctx, ships }
  const sim: GameState = { ...state, shipId: shipIds[0]!, fleet, gameMs: 0, rng: { ...state.rng },
    warehouse: { ...state.warehouse, items: { ...state.warehouse.items } }, logs: [],
    expedition: { ...state.expedition, lairTier: undefined, factionActive: undefined },
    wormhole: { ...state.wormhole, run: null }, playerStation: undefined, planetary: undefined,
    departure: undefined, resupplyFromWarehouse: true }
  const battle = startFleetBattleFor(sim, context, shipIds, sourceId, 0)
  if (!battle) throw new Error('Station security battle could not start')
  // 有限推进，保持原引擎逐拍建规格、命中、弹型回落、维修与多波时序。
  const limit = Math.min(STATION_SECURITY_JOB_MS - 2 * STATION_SECURITY_TRAVEL_MS,
    ctx.balance.battle.maxBattleMs + waveGapTotalMs(ctx.anomalies.get(sourceId), ctx.balance.battle) + 60_000)
  while (!battle.ended && sim.gameMs < limit) {
    sim.gameMs = Math.min(limit, sim.gameMs + 1000)
    advanceBattleFor(sim, context, battle, sim.shipId, sourceId)
  }
  refundBattleAmmo(sim, battle)
  refundRepairKitsAll(sim, battle)
  for (const entry of battle.myFleet ?? []) {
    const ledger = battle.droneRevive?.[entry.tag]
    if (!ledger || ledger.printing) continue
    for (const [id, count] of Object.entries(ledger.v)) {
      for (let i = 0; i < count; i++) {
        if (takeDroneUnit(sim, entry.shipId, id) !== 'ware') throw new Error('Invalid station security drone budget')
      }
    }
  }
  const ammoUsed: Record<string, number> = {}
  for (const id of new Set([...Object.keys(state.warehouse.items), ...Object.keys(sim.warehouse.items)])) {
    const before = state.warehouse.items[id] ?? 0
    const used = before - (sim.warehouse.items[id] ?? 0)
    if (!Number.isSafeInteger(used) || used < 0 || used > before) throw new Error('Invalid station security supply budget')
    if (used > 0) ammoUsed[id] = used
  }
  const victory = battle.ended === 'me'
  return { outcome: victory ? 'victory' : 'defeat',
    durationMs: Math.max(1, Math.min(limit, battle.lastTickGameMs - battle.startedAtGameMs)), ammoUsed,
    reward: victory && ctx.items.has('part-circuit') ? { 'part-circuit': 20 } : {} }
}
