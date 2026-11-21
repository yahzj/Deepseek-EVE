import { type GameState, addLog } from '../state'
import type { SimContext, DamageType } from '../types'
import type { FoeOverride, UnitSpec } from './model'
import { battleAnomalyOf, noteFoeShipsSeen, applyFoeOverride, wormholeDerivedAnomaly } from './cards'
import { wormholeMatterBattleModsOf, applyFleetDamageAura, fleetDamageAuraOf, applyFleetLockAura, applyMatterPlayerBuffs } from './fleetSpecs'
import { createPlayerSpec } from './player/create'
import { DRONE_SKILL, droneSkillLv } from './player/factors'
import { wormholeAmmoIdsForSpec, loadWormholeBattleAmmo, ammoLoadTotals, ammoKeyOf, loadAmmoTier, ammoTierFallbackLog } from './combatAmmo'
import { ceilFinalQuantity } from '../quantity'
import { wormholeMatterBuffs } from '../wormholeMatter'
import { matterTechWhBuffs } from '../matterTech'
import { createFoeSpecs } from './foes/catalog'
import { battleOpenM, desiredRangeFor, rFamilyDesireOf, foeDesiredRange, battleMaxDistanceM } from './foes/tactics'
import { createBattleState, announceStealthStart, announceSupportCallStart, initFoeDronePools, initFoeRepairPulses } from './foes/state'
import { confirmedBattleDesire, battleRangeSnapshot } from './battleRangeMemory'
import { fleetRangeOf, type FleetRangeSettings } from '../fleetRange'
import { applyFoeRangeDebuff, applyMeJammerDebuff, foeRangeEwSpecsOf } from './foeRange'
import { buildDronePoolsFor } from './combatDrones'
import { initDroneLaunch } from './droneLaunch'
import { initDroneReviveStock, initDroneRevive } from '../droneRevive'
import { pdEnabledFor } from './droneWindow'
import { foeJudgedThreatOf } from './foePower'
import { preloadRepairFor, REPAIR_PULSE_MS, preloadShieldChargeFor, preloadShieldFieldFor } from './combatRepair'
import { equipmentCycleMsOf } from '../equipment'
import { COMBAT_MAX_SHIPS } from './command/rules'
import { stationShipTaskBlock } from './command/locks'
import { isFirstBountyBattle, applyFirstBountyBuff } from '../firstTasks'
import { syncRangeEw } from './rangeEw'
import { applyDroneCommandAura, droneCommandVolumeM3Of } from './droneCommand'

export function startFleetBattleFor(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number | null,
  wormhole?: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    desireRangeMul?: number
    strengthMul?: number
    threatMul?: number
    foeMainType?: DamageType
    foeHitDown?: number
    blindReduce?: number
  },
  foeOverride?: FoeOverride,
  preserveDesire = false,
  formationVersion: 0 | 1 = 1,
  departureRange?: FleetRangeSettings,
): import('../state').BattleState | null {
  if (!anomalyId || shipIds.length === 0 || shipIds.length > COMBAT_MAX_SHIPS || new Set(shipIds).size !== shipIds.length || shipIds.some(id => !state.fleet[id])) return null
  if (shipIds.some(id => stationShipTaskBlock(state, id))) return null
  const baseCard = foeOverride?.generatedCard ?? battleAnomalyOf(ctx, anomalyId, wormhole ? undefined : state.expedition.lairTier, wormhole ? undefined : state.expedition.factionActive, formationVersion)
  if (baseCard) noteFoeShipsSeen(state, baseCard)
  if (!baseCard) return null
  const matterMods = wormhole ? wormholeMatterBattleModsOf(state, ctx, baseCard, wormhole.kind) : null
  const anomaly = applyFoeOverride(
    wormhole
      ? wormholeDerivedAnomaly(ctx, baseCard, {
        ...wormhole,
        ...(matterMods
          ? {
              ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
              ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
              ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            }
          : {}),
      }, formationVersion)
    : baseCard,
    foeOverride,
  )
  const bal = ctx.balance.battle
  const ordered = [...shipIds]
  const leaderIdx = ordered.indexOf(state.shipId)
  if (leaderIdx > 0) {
    ordered.splice(leaderIdx, 1)
    ordered.unshift(state.shipId)
  }
  let specs: UnitSpec[] = []
  const fleet: NonNullable<import('../state').BattleState['myFleet']> = []
  const specOf = new Map<string, UnitSpec>()
  const fullHpOf = new Map<string, { s: number; a: number; h: number }>()
  const rangeRefs = new Map<string, { weaponRanges: Array<{ baseM: number; bonusMul: number }> }>()
  for (let i = 0; i < ordered.length; i++) {
    const sid = ordered[i]!
    const refs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
    let spec = createPlayerSpec(state, ctx, sid, undefined, refs)
    if (!spec) {
      if (i === 0) return null
      continue
    }
    if (wormhole && state.wormhole.run?.supplyVersion === 1) {
      const ids = wormholeAmmoIdsForSpec(state, ctx, sid, spec, state.wormhole.run.supplies?.items ?? {})
      refs.weaponRanges = []
      spec = createPlayerSpec(state, ctx, sid, ids, refs)!
    }
    spec.tag = i === 0 ? 'player' : `ally-${i}`
    fullHpOf.set(spec.tag, { ...spec.hp })
    const fleetShip = state.fleet[sid]
    if (fleetShip) {
      const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
      const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
      spec.hp.a = Math.max(0, ceilFinalQuantity(spec.hp.a * armorMul))
      spec.hp.h = Math.max(0, ceilFinalQuantity(spec.hp.h * hullMul))
    }
    if (i === 0 && isFirstBountyBattle(state, anomalyId, sid)) applyFirstBountyBuff(spec)
    specs.push(spec)
    rangeRefs.set(spec.tag, refs)
    specOf.set(sid, spec)
    fleet.push({ tag: spec.tag, shipId: sid })
  }
  if (specs.length === 0) return null
  applyFleetDamageAura(specs, 1 + fleetDamageAuraOf(state, ctx, ordered))
  applyFleetLockAura(specs)
  if (matterMods) {
    const buffs = wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx))
    for (const spec of specs) applyMatterPlayerBuffs(spec, buffs, matterMods.foeMainType)
  }
  const me = specs[0]!
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const ewTemplate = createBattleState(me, foes, atGameMs, 0, specs.slice(1))
  ewTemplate.rangeEwVersion = 1
  ewTemplate.myFleet = fleet
  syncRangeEw(state, ctx, ewTemplate, foes, ordered[0]!)
  for (const spec of specs) applyMeJammerDebuff(spec, ewTemplate.rangeEw!.meCut, rangeRefs.get(spec.tag)?.weaponRanges)
  const openM = battleOpenM(me, foeRangeEwSpecsOf(ewTemplate, foes), bal)
  const fleetRange = departureRange ?? fleetRangeOf(state, ordered)
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal)
      : (confirmedBattleDesire(state, anomalyId)
        ?? (desireM !== undefined && desireM > 0 ? Math.round(desireM) : undefined)
        ?? fleetRange?.desireM ?? desiredRangeFor(me, 'mid', bal))
  const desire = Math.max(bal.minDistanceM, preserveDesire ? rawDesire : Math.min(openM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire, specs.slice(1))
  if (formationVersion === 1) battle.enemyFormationVersion = 1
  battle.rangeEwVersion = 1
  battle.myFleet = fleet
  battle.droneLoadAtStartBy = Object.fromEntries(fleet.map(entry => [entry.tag, { ...(state.fleet[entry.shipId]?.droneLoad ?? {}) }]))
  battle.droneLoadAtStart = { ...battle.droneLoadAtStartBy.player }
  droneCommandVolumeM3Of(battle, ctx)
  specs = applyDroneCommandAura(specs, battle, ctx)
  battle.rangeEw = ewTemplate.rangeEw
  if (ewTemplate.meFoeRangeDebuff !== undefined) battle.meFoeRangeDebuff = ewTemplate.meFoeRangeDebuff
  syncRangeEw(state, ctx, battle, foes, ordered[0]!)
  if (foeOverride !== undefined) battle.foeOverride = foeOverride
  for (const [tag, full] of fullHpOf) {
    const rt = battle.units[tag]
    if (rt) rt.hpMax = full
  }
  applyFoeRangeDebuff(state, ctx, battle, ordered)
  announceStealthStart(battle)
  announceSupportCallStart(battle, foes)
  const rDesire = rFamilyDesireOf(me, foes, bal, battle)
  if (wormhole) {
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    const want = anyBrawl
      ? desiredRangeFor(me, 'mid', bal, bal.wormholeBrawlOpenBand)
      :
        foeDesiredRange(me, foes, bal, battle.meFoeRangeDebuff ?? 0, battle)
    battle.distanceM = Math.max(bal.minDistanceM, Math.min(openM, Math.round(want)))
  } else {
    battle.distanceM = openM
  }
  if (rDesire !== null) {
    for (const f of foes) if (f.family === 'R') f.foeDesireRangeM = rDesire
  }
  battle.myFleet = fleet
  if (wormhole) battle.wormhole = { cardId: anomalyId, ...wormhole }
  if (wormhole?.desireRangeMul) battle.myDesireM = Math.min(battle.myDesireM, openM * wormhole.desireRangeMul)
  const ammoIds: Partial<Record<DamageType, string>> = {}
  const ammoLedger: NonNullable<import('../state').BattleState['expeditionAmmo']> = { stock: {}, loaded: {}, idsByTag: {} }
  if (!loadWormholeBattleAmmo(state, ctx, battle, specOf)) for (const entry of fleet) {
    const spec = specOf.get(entry.shipId)!
    const ids: Partial<Record<DamageType, string>> = {}
    const totals = ammoLoadTotals(spec, bal, state)
    for (const [t, n] of Object.entries(totals)) {
      const type = t as DamageType
      const key = ammoKeyOf(type)
      const res = loadAmmoTier(state, ctx, entry.shipId, type, n ?? 0)
      battle.ammo[key] += res.loaded
      ids[type] = res.id
      if (res.loaded > 0) ammoLedger.stock[res.id] = (ammoLedger.stock[res.id] ?? 0) + res.loaded
      if (res.loaded > 0 && ammoIds[type] === undefined) ammoIds[type] = res.id
      if (res.fellBack && res.loaded > 0) {
        addLog(state, 'warn', ammoTierFallbackLog(state, ctx, entry.shipId, type, res.id, res.loaded))
      }
    }
    ammoLedger.idsByTag[entry.tag] = ids
  }
  if (!battle.expeditionAmmo) battle.expeditionAmmo = { ...ammoLedger, loaded: { ...ammoLedger.stock } }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  battle.ammoLoaded = { ...battle.ammo }
  const pools: Record<string, import('../state').DronePoolEntry> = {}
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  for (const spec of specs) buildDronePoolsFor(ctx, spec, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    initDroneLaunch(battle, specs)
    battle.droneLost = {}
    battle.droneLostBy = {}
    initDroneReviveStock(state, ctx, battle, fleet.map((e) => e.shipId))
    for (const e of fleet) initDroneRevive(state, ctx, battle, e.shipId, e.tag)
  }
  initFoeDronePools(battle, foes);
  initFoeRepairPulses(battle, foes);
  if (pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  const repairBy: Record<string, import('../state').BattleRepairLedger> = {}
  const shieldChargeBy: Record<string, import('../state').BattleShieldChargeLedger> = {}
  const shieldFieldBy: Record<string, import('../state').BattleShieldFieldLedger> = {}
  for (const e of fleet) {
    const r = preloadRepairFor(state, ctx, e.shipId, bal.maxBattleMs)
    if (r) {
      const ready = r.units.filter((u) => !u.stopped)
      for (const u of r.units) {
        if (u.stopped) continue
        u.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, e.shipId, REPAIR_PULSE_MS)
      }
      if (ready.length > 0) r.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, e.shipId, REPAIR_PULSE_MS)
      repairBy[e.tag] = r
    }
    const sc = preloadShieldChargeFor(state, ctx, e.shipId)
    if (sc) {
      for (const s of sc.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
      shieldChargeBy[e.tag] = sc
    }
    const sf = preloadShieldFieldFor(state, ctx, e.shipId)
    if (sf) {
      for (const s of sf.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
      shieldFieldBy[e.tag] = sf
    }
  }
  if (Object.keys(repairBy).length > 0) {
    battle.repairBy = repairBy
    battle.repair = repairBy['player'] ?? Object.values(repairBy)[0]!
  }
  if (Object.keys(shieldChargeBy).length > 0) {
    battle.shieldChargeBy = shieldChargeBy
    battle.shieldCharge = shieldChargeBy['player'] ?? Object.values(shieldChargeBy)[0]!
  }
  if (Object.keys(shieldFieldBy).length > 0) battle.shieldFieldBy = shieldFieldBy
  if (foes.some((f) => (f.repairPct ?? 0) > 0)) {
    battle.foeRepair = { nextPulseAtMs: battle.startedAtGameMs + REPAIR_PULSE_MS, pulses: 0, healed: 0 }
  }
  if (wormhole) {
    battle.wormhole = {
      cardId: anomalyId,
      ...wormhole,
      ...(matterMods
        ? {
            ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
            ...(matterMods.foeMainType ? { foeMainType: matterMods.foeMainType } : {}),
            ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
            ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            ...(matterMods.volleyOverflow ? { volleyOverflow: true } : {}),
          }
        : {}),
    }
  }
  if (desireM !== null) battle.rangeMemory = { ...battleRangeSnapshot(anomalyId, specs, Math.max(bal.minDistanceM, rawDesire), battleMaxDistanceM(battle, me, foes, bal, specs) * (wormhole?.desireRangeMul ?? 1), bal.minDistanceM),
    sourceVersion: 1, ...(fleetRange?.presetId ? { fleetPresetId: fleetRange.presetId } : {}) }
  return battle
}
