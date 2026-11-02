import type { GameState, WormholeFamily } from '../state'
import type { DamageType, SimContext } from '../types'
import type { UnitSpec, WeaponSpec } from '../combat/model'
import { createPlayerSpec } from '../combat/player/create'
import { applyFleetDamageAura, applyMatterPlayerBuffs, fleetDamageAuraOf } from '../combat/fleetSpecs'
import { applyFleetLockAura } from '../combat/lockAura'
import { activeFoeSpecsOf } from '../combat/foes/catalog'
import { wormholeDerivedAnomaly } from '../combat/cards'
import { hitChance, playerBlindDamageMul, playerWeaponInRange, typeLayerMult } from '../combat/combatMath'
import { beamPowerFactor } from '../combat/beam'
import { playerRangeEwOf, foeRangeEwOf, rangeEwContestOf } from '../combat/rangeEw'
import { repairStatsFor, shieldChargeStreamsOf, shieldFieldStreamsOf, SHIELD_FIELD_COST_PCT, SHIELD_FIELD_MAX_TARGETS } from '../combat/combatRepair'
import { matterTechWhBuffs } from '../matterTech'
import { wormholeMatterBuffs, wormholeMatterThreatMul } from '../wormholeMatter'
import { foeMainDamageType, wormholeGuardCardOf, wormholeSkippedBranch } from '../wormholeFoes'

/** 只作有限参考交战的解析估计，不运行战斗状态机。 */
export const SIGNAL_AUTO_COMBAT = { referenceSeconds: 60, supportCap: .5, incomingFloor: .25,
  distances: [500, 1500, 3000, 6000], guardRatio: 1.15, minimumDpsRatio: .1 } as const
const types: DamageType[] = ['kinetic', 'explosive', 'plasma']

function shots(w: WeaponSpec): Array<{ type: DamageType; value: number }> {
  const main = w.shotsByType ? Object.entries(w.shotsByType).map(([type, value]) => ({ type: type as DamageType, value: value ?? 0 }))
    : [{ type: w.fixedType ?? 'kinetic', value: w.shotDmg ?? 0 }]
  // 玩家合并武器的单发已经含门数，不再乘count。
  if (w.secondaryDamagePct) main.push({ type: w.secondaryDamageType ?? 'kinetic', value: main.reduce((n, row) => n + row.value, 0) * w.secondaryDamagePct })
  return main
}

function rate(w: WeaponSpec): number {
  const reload = w.overlayDrive ? (w.reloadMs + Math.max(w.overlayDrive.floorMs, w.reloadMs - w.overlayDrive.stepMs * 5)) / 2 : w.reloadMs
  const burst = w.burst?.shots ?? 1
  return 1000 * burst / Math.max(50, reload + (burst - 1) * (w.burst?.gapMs ?? 0))
}

function outgoing(unit: UnitSpec, targets: UnitSpec[], distance: number, ctx: SimContext, rangeMul = 1): Record<DamageType, number> {
  const out = { kinetic: 0, explosive: 0, plasma: 0 }
  for (const w0 of unit.weapons) {
    if (w0.disabled || w0.reserve || w0.repairDrone) continue
    const w = { ...w0, maxRangeM: w0.maxRangeM * rangeMul }
    if (!playerWeaponInRange(distance, w)) continue
    const chance = w.kind === 'beam' ? beamPowerFactor(distance, w)
      : targets.reduce((n, target) => n + hitChance(w, unit, target, distance, ctx.balance.battle), 0) / Math.max(1, targets.length)
    const lockChance = Math.max(unit.lockTargetChance ?? 0, 1 / Math.max(1, targets.length))
    const lock = 1 + (unit.lockedDmgBonus ?? 0) * lockChance
    const area = w.allFoes ? Math.min(3, targets.length) : 1
    for (const shot of shots(w)) out[shot.type] += shot.value * rate(w) * chance * playerBlindDamageMul(distance, w) * lock * area
  }
  return out
}

function effectiveHp(unit: UnitSpec, mix: Record<DamageType, number>, fractions = { a: 1, h: 1 }): number {
  const sum = types.reduce((n, type) => n + mix[type], 0)
  return (['s', 'a', 'h'] as const).reduce((total, layer) => {
    const resist = unit.resists[layer === 's' ? 'shield' : layer === 'a' ? 'armor' : 'hull']
    const received = types.reduce((n, type) => n + (sum > 0 ? mix[type] / sum : 1 / 3) * typeLayerMult(type, layer === 's' ? 'shield' : layer === 'a' ? 'armor' : 'hull') * (1 - (resist?.[type] ?? 0)), 0)
    return total + unit.hp[layer] * (layer === 's' ? 1 : fractions[layer]) / Math.max(.1, received)
  }, 0)
}

function supportHp(state: GameState, ctx: SimContext, units: UnitSpec[]): number {
  const seconds = SIGNAL_AUTO_COMBAT.referenceSeconds
  const kits = new Map<string, number>()
  const take = (id: string, wanted: number, uid: string) => {
    const key = state.resupplyFromWarehouse !== false ? id : `${uid}/${id}`
    const stock = state.resupplyFromWarehouse !== false ? state.warehouse.items : state.fleet[uid]?.cargo ?? {}
    const left = kits.get(key) ?? stock[id] ?? 0, used = Math.min(left, Math.max(0, wanted))
    kits.set(key, left - used)
    return used
  }
  let total = 0
  for (const unit of units) {
    const uid = unit.shipId!, output = 1 + (unit.repairOutputBonusPct ?? 0)
    // 回盾按半盾参考状态估计；破盾停充与实际缺损由全队支援上限约束。
    total += unit.hp.s * ctx.balance.battle.shieldRegenPerSec * .5 * seconds * (1 + (unit.shieldPassiveBonusPct ?? 0)) * output
    for (const stream of shieldChargeStreamsOf(state, ctx, uid)) total += Math.min(unit.hp.s, unit.hp.s * stream.pct * output * seconds * 1000 / stream.ms)
    const repairs = repairStatsFor(state, ctx, uid)
    for (const repair of repairs?.units ?? []) {
      const def = ctx.modules.get(repair.moduleId)
      const pulses = Math.floor(seconds * 1000 / repairs!.intervalMs)
      const count = repair.free ? pulses : take(def?.repairKit ?? 'repairkit-civ', pulses, uid)
      total += Math.min(unit.hp.a + unit.hp.h, (repair.armorPerPulse + repair.hullPerPulse) * count)
    }
    const others = units.filter(other => other.tag !== unit.tag)
    if (!others.length) continue
    for (const w of unit.weapons.filter(w => w.repairDrone && !w.reserve)) {
      const repair = w.repairDrone!, pulses = take(repair.kitId, Math.floor(seconds * 1000 / w.reloadMs), uid)
      total += Math.min(Math.max(...others.map(other => other.hp.a + other.hp.h)), (repair.armor + repair.hull) * pulses)
    }
    for (const stream of shieldFieldStreamsOf(state, ctx, uid)) {
      const targets = others.filter(other => other.hp.s > 0).sort((a, b) => b.hp.s - a.hp.s).slice(0, SHIELD_FIELD_MAX_TARGETS)
      const healing = targets.reduce((n, target) => n + Math.min(unit.hp.s * stream.pct * output, target.hp.s * .5), 0)
      const cost = unit.hp.s * SHIELD_FIELD_COST_PCT
      const pulses = Math.min(Math.floor(seconds * 1000 / stream.ms), Math.floor(unit.hp.s / Math.max(1, cost)))
      total += Math.max(0, healing - cost) * pulses
    }
  }
  return total
}

export function signalAutoCombatRatio(state: GameState, ctx: SimContext, ids: readonly string[], family: WormholeFamily, depth: number): number {
  const base = ctx.anomalies.get(wormholeGuardCardOf(family, depth))
  if (!base) return 0
  const buffs = wormholeMatterBuffs(undefined, matterTechWhBuffs(state, ctx))
  const card = wormholeDerivedAnomaly(ctx, base, { depth, kind: 'boss', waves: 1,
    threatMul: wormholeMatterThreatMul(buffs, 'boss'), foeHitDown: buffs.enemyHitDown, blindReduce: buffs.blindReduce })
  const skip = wormholeSkippedBranch(base)
  const waves = (card.waves?.length ? card.waves : [{ units: 1, hpShare: 1 }]).map((_, i) =>
    activeFoeSpecsOf(card, ctx.balance.battle, i).filter(unit => skip === null || unit.foeReinforceBranch !== skip))
  const foes = waves.flat()
  if (!foes.length) return 0
  const units = ids.flatMap((id, i) => {
    const spec = createPlayerSpec(state, ctx, id)
    if (!spec) return []
    spec.tag = `auto-${i}`
    applyMatterPlayerBuffs(spec, buffs, foeMainDamageType(base))
    return [spec]
  })
  if (!units.length) return 0
  applyFleetDamageAura(units, 1 + fleetDamageAuraOf(state, ctx, ids))
  applyFleetLockAura(units)
  const ew = rangeEwContestOf(playerRangeEwOf(state, ctx, ids), (waves[0] ?? []).map(foeRangeEwOf))
  const support = supportHp(state, ctx, units)
  let best = 0
  for (const distance of SIGNAL_AUTO_COMBAT.distances) {
    const mine = { kinetic: 0, explosive: 0, plasma: 0 }, theirs = { ...mine }
    for (const unit of units) {
      const out = outgoing(unit, foes, distance, ctx, 1 - ew.meCut)
      for (const type of types) mine[type] += out[type]
    }
    for (const wave of waves) {
      const damage = { kinetic: 0, explosive: 0, plasma: 0 }
      for (const unit of wave) {
        const out = outgoing(unit, units, distance, ctx, 1 - ew.foeCut)
        const nominal = { kinetic: 0, explosive: 0, plasma: 0 }
        for (const w of unit.weapons.filter(w => !w.disabled && !w.reserve && !w.repairDrone)) for (const shot of shots(w)) {
          nominal[shot.type] += shot.value * rate(w)
        }
        for (const type of types) {
          // 避免把站在射程外当成可以永久无伤；突进、闪现等动态能力只作有界保守修正。
          damage[type] += Math.max(out[type], nominal[type] * SIGNAL_AUTO_COMBAT.incomingFloor)
        }
      }
      for (const type of types) theirs[type] = Math.max(theirs[type], damage[type])
    }
    const dps = types.reduce((n, type) => n + mine[type], 0), enemyDps = types.reduce((n, type) => n + theirs[type], 0)
    if (dps < enemyDps * SIGNAL_AUTO_COMBAT.minimumDpsRatio) continue
    const hp = units.reduce((n, unit) => {
      const ship = state.fleet[unit.shipId!]!
      return n + effectiveHp(unit, theirs, { a: ship.armorPct ?? 1, h: ship.durability })
    }, 0)
    const enemyHp = foes.reduce((n, unit) => n + effectiveHp(unit, mine) * (unit.foeRepairPulse || unit.repairPct || unit.foeReviveEscort || unit.foeSummonEscort ? 1.25 : 1), 0)
    best = Math.max(best, Math.sqrt(dps * (hp + Math.min(support, hp * SIGNAL_AUTO_COMBAT.supportCap)) / Math.max(1, enemyDps * enemyHp)))
  }
  return best
}
