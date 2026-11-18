
import type { GameState, BattleState } from '../state'
import type { DamageType, ModuleDef, SimContext } from '../types'
import type { UnitSpec, WeaponSpec } from './model'
import { createPlayerSpec } from './player/create'
import { allFittedModules, stackingOf, stackWeight, WEIGHTED_GAP_FLEET_CAP, weightedGap, fittedPenaltyPartsOf } from '../equipment'
import { distFactor } from './combatMath'
import { coronaFleetRangeBonusOf } from './coronaFocus'
import { moduleAllowedOnShip } from '../shipFitting'
import { fleetDefOf } from '../instances'
import { pushBattleNotice } from './combatFx'
import { foeCapacitorRangeBonusOf } from './gravekeeperCombat'
import { supportEffectPartsOf } from '../stacking'
import { plugEffectPartsOf } from '../plugEffects'

export function foeRangeEwSpecsOf(battle: BattleState, foes: readonly UnitSpec[]): UnitSpec[] {
  const cut = battle.rangeEwVersion === 1 ? battle.rangeEw?.foeCut ?? 0 : battle.meFoeRangeDebuff ?? 0
  return foes.filter(foe => battle.units[foe.tag] && !foeUnitDeadOf(battle, foe.tag)).map(foe => ({ ...foe, weapons: foe.weapons.map(weapon => ({ ...weapon,
    maxRangeM: weapon.src === 'drone' ? foeDroneRangeOf(battle, weapon, foe) : foeGunMaxRangeOf(battle, foe, weapon),
  })),
    foeRangeBand: foe.foeRangeBand ? { ...foe.foeRangeBand,
      max: foeRangeWithDebuff(foe.foeRangeBand.max, 1, cut) } : foe.foeRangeBand,
    ...(foe.foeDesireRangeM !== undefined ? { foeDesireRangeM: rangeEwDesireRange(foe, cut) } : {}),
  }))
}

export function rangeEwDesireRange(foe: UnitSpec, cut: number): number {
  if (!(cut > 0)) return foe.foeDesireRangeM ?? 0
  const band = foe.foeRangeBand
  if (!band) return foe.foeDesireRangeM ?? 0
  const effectiveMax = foeRangeWithDebuff(band.max, 1, cut)
  return foe.foeDesireRangeM !== undefined && band.max > 0
    ? Math.round(foe.foeDesireRangeM * effectiveMax / band.max) : effectiveMax
}

export function foeDroneRangeOf(
  b: import('../state').BattleState,
  w: WeaponSpec,
  unit?: Pick<UnitSpec, 'tag' | 'foeShieldCapacitor'>,
): number {
  const buffMul = (b.foeDroneRangeBuff && b.foeDroneRangeBuff > 1 ? b.foeDroneRangeBuff : 1) + (w.foeDroneRangeBonusPct ?? 0) + coronaFleetRangeBonusOf(b) + (unit ? foeCapacitorRangeBonusOf(b, unit.tag, unit.foeShieldCapacitor) : 0)
  return effectiveFoeRangeM(b, w.maxRangeM, buffMul)
}

export const FOE_RANGE_DEBUFF_FLOOR_M = 3000

export function fittedEffectParamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  mod: ModuleDef,
  ordinal = 1,
): Array<{ key: string; raw: number; eff: number }> {
  const out: Array<{ key: string; raw: number; eff: number }> = []
  if (mod.slot === 'plug') {
    const part = plugEffectPartsOf(state.fleet[shipId]?.plugs ?? [], ctx)
      .filter(p => p.mod.id === mod.id)[Math.max(0, ordinal - 1)]
    if (!part || part.kind === null) return out
    for (const key of ['shieldHpAdd', 'armorHpAdd', 'hullHpAdd', 'damageBonusPct', 'hitBonusPct',
      'plugRangeBonusPct', 'speedAddMps', 'cargoCapacityBonusPct', 'droneBayBonusM3', 'cpuPenalty', 'speedPenaltyMps'] as const) {
      const raw = mod[key]
      if (raw !== undefined && raw !== 0) out.push({ key, raw, eff: part.effective[key] ?? raw })
    }
    return out
  }
  const group = stackingOf(mod).group
  const parts = fittedPenaltyPartsOf(state, ctx, shipId)
  const part = parts.find(p => p.mod.id === mod.id && p.ordinal === ordinal)
  if (mod.slot === 'support' && part) {
    const defs = parts.map(p => p.mod)
    for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
      for (const family of ['damage', 'range'] as const) {
        const effect = `${family}:${type}` as const
        const entry = supportEffectPartsOf(defs, effect)[part.index]!
        if (entry.value > 0) out.push({ key: effect, raw: entry.value, eff: entry.value * entry.weight })
      }
    }
    const reload = supportEffectPartsOf(defs, 'reload')[part.index]!
    if (reload.value > 0) out.push({ key: 'reload', raw: reload.value, eff: reload.value * reload.weight })
  }
  const sortedBenefit = group === 'curve' || ['speed', 'drone-relay', 'drone-launch', 'laser-calibration'].includes(stackingOf(mod).kind)
  const w = sortedBenefit && part ? part.weight : group === 'flat' || group === 'max' ? 1 : stackWeight(Math.max(1, ordinal))
  const folded = (key: string, raw: number | undefined): void => {
    if (raw === undefined || raw === 0) return
    out.push({ key, raw, eff: raw * w })
  }
  folded('speed', mod.speedBonusPct)
  folded('droneRange', mod.droneRangeBonusPct)
  folded('droneLaunch', mod.droneLaunchCutPct)
  folded('laserFalloff', mod.laserFalloffBonus)
  folded('shieldPulse', mod.shieldPulsePct)
  folded('shieldField', mod.shieldFieldPct)
  folded('hit', mod.hitBonusPct)
  folded('lock', mod.lockDmgBonus)
  folded('warp', mod.warpSpeedBonusPct)
  if (mod.rangeEwStrength !== undefined) out.push({ key: 'rangeEwStrength', raw: mod.rangeEwStrength,
    eff: mod.rangeEwStrength * (1 + (fleetDefOf(state, ctx, shipId)?.rangeEwEquipmentBonusPct ?? 0)) })
  else folded('ecmRangeCut', mod.foeRangeDebuffPct)
  for (const [key, raw] of [['reloadPenalty', mod.reloadPenaltyPct], ['speedPenalty', mod.speedPenaltyPct],
    ['rangePenalty', mod.rangeCutPct], ['hitPenalty', mod.hitPenalty], ['resistPenalty', mod.allResistPenaltyPct]] as const) {
    if (raw !== undefined && raw > 0) out.push({ key, raw, eff: raw * (part?.weight ?? w) })
  }
  if (group === 'gap') {
    const spec = createPlayerSpec(state, ctx, shipId)
    if (spec) {
      for (const [type, v] of Object.entries(mod.shieldResistAdd ?? {})) {
        out.push({
          key: `resistShield:${type}`,
          raw: v ?? 0,
          eff: spec.resists.shield?.[type as DamageType] ?? 0,
        })
      }
      for (const [type, v] of Object.entries(mod.armorResistAdd ?? {})) {
        out.push({
          key: `resistArmor:${type}`,
          raw: v ?? 0,
          eff: spec.resists.armor?.[type as DamageType] ?? 0,
        })
      }
      if (mod.evasionGapPct !== undefined) out.push({ key: 'evasion', raw: mod.evasionGapPct, eff: spec.evasion })
    }
  }
  return out
}

export function meFoeRangeDebuffOf(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  let remain = 1
  for (const sid of shipIds) {
    const entry = state.fleet[sid]
    const own: number[] = []
    const defId = entry?.defId
    const hull = defId ? (ctx.ships.get(defId)?.foeRangeDebuffPct ?? 0) : 0
    if (hull > 0 && hull < 1) own.push(hull)
    if (entry?.fitted) {
      for (const m of allFittedModules(entry.fitted, ctx)) {
        if (!moduleAllowedOnShip(fleetDefOf(state, ctx, sid), m)) continue
        const v = Math.max(0, m.foeRangeDebuffPct ?? 0)
        if (v > 0) own.push(v)
      }
    }
    const rShip = own.length === 0 ? 0 : weightedGap(own)
    if (rShip > 0) remain *= 1 - rShip
  }
  const total = 1 - remain
  return total <= 0 ? 0 : Math.min(WEIGHTED_GAP_FLEET_CAP, total)
}

export function applyFoeRangeDebuff(
  state: GameState,
  ctx: SimContext,
  battle: import('../state').BattleState,
  shipIds: readonly string[],
): void {
  if (battle.rangeEwVersion === 1) return
  const r = meFoeRangeDebuffOf(state, ctx, shipIds)
  if (r > 0) battle.meFoeRangeDebuff = r
  else delete battle.meFoeRangeDebuff
}

function effectiveFoeRangeM(
  b: import('../state').BattleState,
  baseRangeM: number,
  buffMul: number,
): number {
  const cut = b.rangeEwVersion === 1 ? b.rangeEw?.foeCut ?? 0 : b.meFoeRangeDebuff ?? 0
  return foeRangeWithDebuff(baseRangeM, buffMul, cut)
}

export function foeRangeWithDebuff(baseRangeM: number, buffMul: number, r: number): number {
  if (r <= 0) return buffMul > 1 ? Math.round(baseRangeM * buffMul) : baseRangeM
  if (baseRangeM < FOE_RANGE_DEBUFF_FLOOR_M) return buffMul > 1 ? Math.round(baseRangeM * buffMul) : baseRangeM
  const net = Math.max(0, buffMul - r)
  return Math.round(Math.max(FOE_RANGE_DEBUFF_FLOOR_M, baseRangeM * net))
}


export function foeJammerCountOf(foes: readonly UnitSpec[]): number {
  return foes.reduce((n, f) => n + ((f.foeRangeDebuffPct ?? 0) > 0 ? 1 : 0), 0)
}

export function foeUnitDeadOf(b: import('../state').BattleState, tag: string): boolean {
  const u = b.units[tag]
  return u !== undefined && (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0
    || u.enteredAtMs !== undefined && u.enteredAtMs > b.lastTickGameMs)
}

export function foeRangeDebuffOf(foes: readonly UnitSpec[]): number {
  let remain = 1
  let r = 0
  for (const f of foes) {
    const v = f.foeRangeDebuffPct ?? 0
    if (v > 0 && v < 1) {
      remain *= 1 - v
      r = 1 - remain
    }
  }
  return r
}

export function meJammerNetOf(battle: import('../state').BattleState, foes: readonly UnitSpec[]): number {
  if (battle.rangeEwVersion === 1) return battle.rangeEw?.meCut ?? 0
  const enemy = foeRangeDebuffOf(foes.filter((f) => !foeUnitDeadOf(battle, f.tag)))
  if (enemy <= 0) return 0
  return Math.max(0, enemy - Math.max(0, battle.meFoeRangeDebuff ?? 0))
}

export function meRangeMulOf(
  battle: import('../state').BattleState,
  foes: readonly UnitSpec[],
  bonus = 0,
): number {
  const net = meJammerNetOf(battle, foes)
  if (net <= 0) return 1
  return meRangeMulForBonus(bonus, net)
}

export function meRangeMulForBonus(bonus: number, net: number): number {
  const bonusMul = Math.max(0, 1 + bonus)
  return Math.max(0.1, (bonusMul - net) / bonusMul)
}

export function applyMeJammerDebuff<T extends UnitSpec>(
  spec: T,
  net: number,
  ranges?: readonly { baseM: number; bonusMul: number }[],
): T {
  if (!(net > 0) || !Number.isFinite(net)) return spec
  spec.weapons = spec.weapons.map((w, i) => {
    const bonus = Math.max(0, (ranges?.[i]?.bonusMul ?? 1) - 1)
    const mul = meRangeMulForBonus(bonus, net)
    if (mul >= 1) return w
    return { ...w, maxRangeM: Math.max(2, Math.round(w.maxRangeM * mul)) }
  })
  return spec
}

export function markFoeDroneRangeBuff(
  rt: UnitSpec,
  b: import('../state').BattleState,
): boolean {
  const mul = rt.foeDroneRangeMulOnHit
  if (mul === undefined || mul <= 1) return false
  if (!rt.foeDrones || rt.foeDrones.length === 0) return false
  const cur = b.foeDroneRangeBuff
  if (cur !== undefined && cur >= mul) return false
  b.foeDroneRangeBuff = mul
  return true
}


export function foeGunRangeMulOf(
  b: import('../state').BattleState,
  unit: { foeGunRangeMulOnHit?: number },
): number {
  const mul = unit.foeGunRangeMulOnHit
  if (mul === undefined || mul <= 1) return 1
  const buff = b.foeGunRangeBuff
  return buff !== undefined && buff > 1 ? buff : 1
}

export function foeGunMaxRangeOf(
  b: import('../state').BattleState,
  unit: Pick<UnitSpec, 'foeGunRangeMulOnHit' | 'foeFocusArray'> & Partial<Pick<UnitSpec, 'tag' | 'foeShieldCapacitor'>>,
  w: { maxRangeM: number },
): number {
  const bonus = coronaFleetRangeBonusOf(b, unit.foeFocusArray)
  const capacitor = unit.tag ? foeCapacitorRangeBonusOf(b, unit.tag, unit.foeShieldCapacitor) : 0
  return effectiveFoeRangeM(b, w.maxRangeM, foeGunRangeMulOf(b, unit) + bonus + capacitor)
}

export function foeGunPowerFactorOf(
  b: import('../state').BattleState,
  unit: Pick<UnitSpec, 'foeGunRangeMulOnHit' | 'foeFocusArray'> & Partial<Pick<UnitSpec, 'tag' | 'foeShieldCapacitor'>>,
  w: { minRangeM: number; maxRangeM: number; falloff: number },
  dist: number,
): number {
  if (b.rangeEwVersion === 1 && (b.rangeEw?.foeCut ?? 0) > 0 || unit.foeFocusArray !== undefined || coronaFleetRangeBonusOf(b) > 0 || unit.tag && foeCapacitorRangeBonusOf(b, unit.tag, unit.foeShieldCapacitor) > 0) {
    return distFactor(dist, { ...w, maxRangeM: foeGunMaxRangeOf(b, unit, w) })
  }
  const base = distFactor(dist, w)
  if (foeGunRangeMulOf(b, unit) <= 1 || dist <= w.maxRangeM) return base
  const span = Math.max(1, w.maxRangeM - w.minRangeM)
  const slope = (1 - w.falloff) / span
  return Math.max(0, base - slope * (dist - w.maxRangeM))
}

export function markFoeGunRangeBuff(rt: UnitSpec, b: import('../state').BattleState): boolean {
  const mul = rt.foeGunRangeMulOnHit
  if (mul === undefined || mul <= 1) return false
  const reach = rt.weapons.reduce((m, w) => Math.max(m, foeGunMaxRangeOf(b, rt, w)), 0)
  if (!(b.distanceM > reach)) return false
  const cur = b.foeGunRangeBuff
  if (cur !== undefined && cur >= mul) return false
  b.foeGunRangeBuff = mul
  return true
}

export function announceFoeGunRangeBuff(unit: UnitSpec, b: import('../state').BattleState): void {
  if (!markFoeGunRangeBuff(unit, b)) return
  pushBattleNotice(b, '', unit.foeGunRangeNoticeId ?? 'core.combat.013', {
    p1: Math.round((unit.foeGunRangeMulOnHit! - 1) * 100),
  })
}
