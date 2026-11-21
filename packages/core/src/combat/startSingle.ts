import { type GameState, addLog } from '../state'
import type { SimContext, DamageType } from '../types'
import type { FoeOverride } from './model'
import { applyFoeOverride, battleAnomalyOf, noteFoeShipsSeen } from './cards'
import { createPlayerSpec } from './player/create'
import { DRONE_SKILL, droneSkillLv } from './player/factors'
import { ceilFinalQuantity } from '../quantity'
import { isFirstBountyBattle, applyFirstBountyBuff } from '../firstTasks'
import { createFoeSpecs } from './foes/catalog'
import { battleOpenM, desiredRangeFor, rFamilyDesireOf, battleMaxDistanceM } from './foes/tactics'
import { createBattleState, announceStealthStart, announceSupportCallStart, initFoeDronePools, initFoeRepairPulses } from './foes/state'
import { confirmedBattleDesire, battleRangeSnapshot } from './battleRangeMemory'
import { fleetRangeOf, type FleetRangeSettings } from '../fleetRange'
import { applyFoeRangeDebuff, applyMeJammerDebuff, foeRangeEwSpecsOf } from './foeRange'
import { ammoLoadTotals, ammoKeyOf, loadAmmoTier, ammoTierFallbackLog } from './combatAmmo'
import { buildDronePoolsFor } from './combatDrones'
import { initDroneLaunch } from './droneLaunch'
import { initDroneReviveStock, initDroneRevive } from '../droneRevive'
import { pdEnabledFor } from './droneWindow'
import { foeJudgedThreatOf } from './foePower'
import { preloadRepairFor, REPAIR_PULSE_MS, preloadShieldChargeFor, preloadShieldFieldFor } from './combatRepair'
import { equipmentCycleMsOf } from '../equipment'
import { syncRangeEw } from './rangeEw'
import { applyDroneCommandAura, droneCommandVolumeM3Of } from './droneCommand'

export function startBattleFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number | null,
  foeOverride?: FoeOverride,
  preserveDesire = false,
  departureRange?: FleetRangeSettings,
): import('../state').BattleState | null {
  if (!anomalyId) return null
  const anomaly = applyFoeOverride(battleAnomalyOf(ctx, anomalyId, state.expedition.lairTier, state.expedition.factionActive), foeOverride)
  if (anomaly) noteFoeShipsSeen(state, anomaly)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const refs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
  let me = createPlayerSpec(state, ctx, shipId, undefined, refs)
  if (!me) return null
  const meFullHp = { ...me.hp }
  const fleetShip = state.fleet[shipId]
  if (fleetShip) {
    const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
    const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
    me.hp.a = Math.max(0, ceilFinalQuantity(me.hp.a * armorMul))
    me.hp.h = Math.max(0, ceilFinalQuantity(me.hp.h * hullMul))
  }
  if (isFirstBountyBattle(state, anomalyId, shipId)) applyFirstBountyBuff(me)
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const rangeTemplate = createBattleState(me, foes, atGameMs, 0)
  rangeTemplate.rangeEwVersion = 1
  syncRangeEw(state, ctx, rangeTemplate, foes, shipId)
  applyMeJammerDebuff(me, rangeTemplate.rangeEw!.meCut, refs.weaponRanges)
  const openM = battleOpenM(me, foeRangeEwSpecsOf(rangeTemplate, foes), bal)
  const fleetRange = departureRange ?? fleetRangeOf(state, [shipId])
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal)
      : (confirmedBattleDesire(state, anomalyId)
        ?? (desireM !== undefined && desireM > 0 ? Math.round(desireM) : undefined)
        ?? fleetRange?.desireM ?? desiredRangeFor(me, 'mid', bal))
  const desire = Math.max(bal.minDistanceM, preserveDesire ? rawDesire : Math.min(openM, rawDesire))
  const rDesire = rFamilyDesireOf(me, foes, bal, rangeTemplate)
  const battle = createBattleState(me, foes, atGameMs, desire)
  battle.enemyFormationVersion = 1
  battle.rangeEwVersion = 1
  const load = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
  battle.droneLoadAtStart = load
  battle.droneLoadAtStartBy = { [me.tag]: load }
  droneCommandVolumeM3Of(battle, ctx)
  me = applyDroneCommandAura([me], battle, ctx)[0]!
  battle.rangeEw = rangeTemplate.rangeEw
  if (rangeTemplate.meFoeRangeDebuff !== undefined) battle.meFoeRangeDebuff = rangeTemplate.meFoeRangeDebuff
  syncRangeEw(state, ctx, battle, foes, shipId)
  if (foeOverride !== undefined) battle.foeOverride = foeOverride
  const meRt0 = battle.units['player']
  if (meRt0) meRt0.hpMax = meFullHp
  applyFoeRangeDebuff(state, ctx, battle, [shipId])
  announceStealthStart(battle)
  announceSupportCallStart(battle, foes)
  battle.distanceM = openM
  if (rDesire !== null) {
    for (const f of foes) if (f.family === 'R') f.foeDesireRangeM = rDesire
  }
  const totals = ammoLoadTotals(me, bal, state)
  const ammoIds: Partial<Record<DamageType, string>> = {}
  for (const [t, n] of Object.entries(totals)) {
    const type = t as DamageType
    const key = ammoKeyOf(type)
    const res = loadAmmoTier(state, ctx, shipId, type, n ?? 0)
    battle.ammo[key] += res.loaded
    if (res.loaded > 0) ammoIds[type] = res.id
    if (res.fellBack && res.loaded > 0) {
      addLog(state, 'warn', ammoTierFallbackLog(state, ctx, shipId, type, res.id, res.loaded))
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  battle.ammoLoaded = { ...battle.ammo }
  const pools: Record<string, import('../state').DronePoolEntry> = {}
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  buildDronePoolsFor(ctx, me, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    initDroneLaunch(battle, [me])
    battle.droneLost = {}
    battle.droneLostBy = {}
    initDroneReviveStock(state, ctx, battle, [shipId])
    initDroneRevive(state, ctx, battle, shipId, me.tag ?? 'player')
  }
  initFoeDronePools(battle, foes);
  initFoeRepairPulses(battle, foes);
  if (pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  const repair = preloadRepairFor(state, ctx, shipId, bal.maxBattleMs)
  if (repair) {
    const ready = repair.units.filter((u) => !u.stopped)
    for (const u of repair.units) {
      if (u.stopped) continue
      u.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS)
    }
    if (ready.length > 0) repair.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS)
    battle.repair = repair
  }
  const shieldCharge = preloadShieldChargeFor(state, ctx, shipId)
  if (shieldCharge) {
    for (const s of shieldCharge.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
    battle.shieldCharge = shieldCharge
  }
  const shieldField = preloadShieldFieldFor(state, ctx, shipId)
  if (shieldField) {
    for (const s of shieldField.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
    battle.shieldFieldBy = { [me.tag ?? 'player']: shieldField }
  }
  if (desireM !== null) battle.rangeMemory = { ...battleRangeSnapshot(anomalyId, [me], Math.max(bal.minDistanceM, rawDesire), battleMaxDistanceM(battle, me, foes, bal), bal.minDistanceM),
    sourceVersion: 1, ...(fleetRange?.presetId ? { fleetPresetId: fleetRange.presetId } : {}) }
  return battle
}
