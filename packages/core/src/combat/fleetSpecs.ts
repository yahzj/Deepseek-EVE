import type { UnitSpec } from './model'
import { type WormholeMatterBuffs, wormholeMatterBuffs, wormholeMatterThreatMul } from '../wormholeMatter'
import type { DamageType, SimContext, AnomalyDef } from '../types'
import type { GameState } from '../state'
import { matterTechWhBuffs } from '../matterTech'
import { foeMainDamageType } from '../wormholeFoes'
import { createPlayerSpec } from './player/create'
import { battleAmmoIdsFor } from './combatAmmo'
import { applyMeWebDebuff } from './captureWebs'
import { applyMeJammerDebuff, meJammerNetOf } from './foeRange'
import { isFirstBountyBattle, applyFirstBountyBuff } from '../firstTasks'
import { applyAlienCorrosion } from './alienCombat'
import { applyFleetLockAura } from './lockAura'
import { applyDroneCommandAura } from './droneCommand'
export { applyFleetLockAura } from './lockAura'







export function applyMatterPlayerBuffs(spec: UnitSpec, b: WormholeMatterBuffs, foeMain: DamageType): void {
  spec.hitBonus += b.hitBonus
  if (b.evasion > 0) spec.evasion = spec.evasion + b.evasion
  const applyResist = (layer: 'shield' | 'armor' | 'hull', add: number): void => {
    if (add <= 0) return
    const cur = spec.resists[layer]
    const base = cur?.[foeMain] ?? 0
    const v = Math.min(0.9, 1 - (1 - base) * (1 - add))
    spec.resists[layer] = { ...(cur ?? {}), [foeMain]: v }
  }
  applyResist('shield', b.resistShield)
  applyResist('armor', b.resistArmor)
  applyResist('hull', b.resistHull)
  const rangeMul = 1 + b.weaponRangePct
  const dmgMul = 1 + b.damagePct
  const reloadMul = Math.max(0.1, 1 - b.reloadPct)
  for (const w of spec.weapons) {
    if (rangeMul !== 1) w.maxRangeM = Math.round(w.maxRangeM * rangeMul)
    if (dmgMul !== 1) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * dmgMul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * dmgMul
        }
      }
    }
    if (reloadMul !== 1) w.reloadMs = Math.max(50, Math.round(w.reloadMs * reloadMul))
  }
}

export function wormholeMatterBattleModsOf(
  state: GameState,
  ctx: SimContext,
  baseCard: AnomalyDef,
  kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn',
): { threatMul: number; foeMainType: DamageType; foeHitDown: number; blindReduce: number; volleyOverflow: boolean } | null {
  const buffs = wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx))
  const bucket: 'node' | 'boss' | 'extract' = kind === 'boss' ? 'boss' : kind === 'extract' ? 'extract' : 'node'
  const threatMul = wormholeMatterThreatMul(buffs, bucket)
  const any =
    threatMul < 1 ||
    buffs.enemyHitDown > 0 ||
    buffs.blindReduce > 0 ||
    buffs.resistShield > 0 ||
    buffs.resistArmor > 0 ||
    buffs.resistHull > 0 ||
    buffs.hitBonus > 0 ||
    buffs.evasion > 0 ||
    buffs.weaponRangePct > 0 ||
    buffs.damagePct > 0 ||
    buffs.reloadPct > 0 ||
    buffs.volleyOverflow
  if (!any) return null
  return {
    threatMul,
    foeMainType: foeMainDamageType(baseCard),
    foeHitDown: buffs.enemyHitDown,
    blindReduce: buffs.blindReduce,
    volleyOverflow: buffs.volleyOverflow,
  }
}

export function buildMyUnitSpecs(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  shipId: string,
  anomalyId: string | null,
  foes?: readonly UnitSpec[],
): UnitSpec[] {
  const fleet = battle.myFleet
  const wh = battle.wormhole
  const matterBuffs = wh ? wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx)) : null
  const matterFoeMain: DamageType = wh?.foeMainType ?? 'kinetic'
  const jammerRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }>, legacyWeaponCount: battle.units.player?.weapons.length }
  if (!fleet || fleet.length === 0) {
    const me = createPlayerSpec(state, ctx, shipId, battleAmmoIdsFor(battle, 'player'), jammerRefs)
    if (!me) return []
    if (battle.units.player?.hp.coating) me.hp.s = 0
    if (matterBuffs) applyMatterPlayerBuffs(me, matterBuffs, matterFoeMain)
    const web0 = battle.meWebDebuffs?.[me.tag]
    if (web0) applyMeWebDebuff(me, web0)
    applyMeJammerDebuff(me, meJammerNetOf(battle, foes ?? []), jammerRefs.weaponRanges)
    if (isFirstBountyBattle(state, anomalyId, shipId)) applyFirstBountyBuff(me)
    applyFleetDamageAura([me], 1 + fleetDamageAuraOf(state, ctx, [shipId]))
    applyAlienCorrosion(me, battle.alienCorrosion ?? 0)
    return applyDroneCommandAura(applyFleetLockAura([me], battle), battle, ctx)
  }
  const out: UnitSpec[] = []
  for (const entry of fleet) {
    const shipRefs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }>, legacyWeaponCount: battle.units[entry.tag]?.weapons.length }
    const spec = createPlayerSpec(state, ctx, entry.shipId, battleAmmoIdsFor(battle, entry.tag), shipRefs)
    if (!spec) continue
    if (battle.units[entry.tag]?.hp.coating) spec.hp.s = 0
    if (matterBuffs) applyMatterPlayerBuffs(spec, matterBuffs, matterFoeMain)
    spec.tag = entry.tag
    if (entry.tag === 'player' && isFirstBountyBattle(state, anomalyId, entry.shipId)) {
      applyFirstBountyBuff(spec)
    }
    const web = battle.meWebDebuffs?.[entry.tag]
    if (web) applyMeWebDebuff(spec, web)
    applyMeJammerDebuff(spec, meJammerNetOf(battle, foes ?? []), shipRefs.weaponRanges)
    out.push(spec)
  }
  applyFleetDamageAura(out, 1 + fleetDamageAuraOf(state, ctx, fleet.map((e) => e.shipId)))
  for (const spec of out) applyAlienCorrosion(spec, battle.alienCorrosion ?? 0)
  return applyDroneCommandAura(applyFleetLockAura(out, battle), battle, ctx)
}


export function fleetDamageAuraOf(state: GameState, ctx: SimContext, shipIds: readonly string[]): number {
  return Math.max(
    0,
    ...shipIds.map((sid) => {
      const defId = state.fleet[sid]?.defId
      return (defId ? ctx.ships.get(defId)?.fleetDamageBonusPct : 0) ?? 0
    }),
  )
}

export function applyFleetDamageAura(specs: readonly UnitSpec[], mul: number): void {
  if (mul <= 1) return
  for (const spec of specs) {
    for (const w of spec.weapons) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * mul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * mul
        }
      }
    }
  }
}
