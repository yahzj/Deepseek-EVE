import type { ModuleDef, DamageResists, SimContext, FittedModules, DamageType, ModuleSlot } from '../../types'
import { plugStackingKindOf } from '../../plugEffects'
import type { GameState } from '../../state'
import { fleetDefOf } from '../../instances'
import { allFittedModules } from '../../fitted'
import { moduleAllowedOnShip } from '../../shipFitting'
import { stackWeight } from '../../stacking'
import { allFittedIds, MODULE_SLOTS } from '../../labels'

export type StackGroup = 'gap' | 'curve' | 'weighted' | 'max' | 'fleetDecay' | 'flat'

export function stackingOf(def: ModuleDef): { group: StackGroup; kind: string } {
  if (def.rangeEwStrength !== undefined) return { group: 'flat', kind: 'range-ew' }
  if (def.slot === 'plug') {
    const kind = plugStackingKindOf(def)
    return { group: kind === null ? 'flat' : 'weighted', kind: kind ?? 'plug' }
  }
  if (def.slot === 'support') {
    if (def.reloadCutPct !== undefined && def.speedBonusPct === undefined) return { group: 'weighted', kind: 'reload' }
    if (Object.keys(def.damageTypeBonusPct ?? {}).length) return { group: 'weighted', kind: 'support-damage' }
  }
  if (def.crisisOverload) return { group: 'curve', kind: 'crisis-overload' }
  if (def.droneLaunchCutPct !== undefined) return { group: 'fleetDecay', kind: 'drone-launch' }
  if (def.laserFalloffBonus !== undefined) return { group: 'weighted', kind: 'laser-calibration' }
  const resistKey = (add: DamageResists | undefined): string | null => {
    for (const [t, v] of Object.entries(add ?? {})) if ((v ?? 0) > 0) return t
    return null
  }
  if (def.evasionGapPct !== undefined) return { group: 'gap', kind: 'evasion' }
  if (def.droneHitGapPct !== undefined) return { group: 'gap', kind: 'drone-hit' }
  if (def.hitBonusPct !== undefined) return { group: 'curve', kind: 'hit' }
  if (def.speedBonusPct !== undefined) return { group: 'weighted', kind: 'speed' }
  if (def.warpSpeedBonusPct !== undefined) return { group: 'curve', kind: 'warp' }
  if (def.lockDmgBonus !== undefined) return { group: 'curve', kind: 'lock' }
  if (def.blink !== undefined) return { group: 'max', kind: 'blink' }
  if (def.stealthMs !== undefined) return { group: 'max', kind: 'stealth' }
  if (def.droneRangeBonusPct !== undefined) return { group: 'weighted', kind: 'drone-relay' }
  if (def.droneShieldHpBonusPct !== undefined) return { group: 'flat', kind: 'drone-shield' }
  const sk = resistKey(def.shieldResistAdd)
  if (sk) return { group: 'gap', kind: `shield-${sk}` }
  const ak = resistKey(def.armorResistAdd)
  if (ak) return { group: 'gap', kind: `armor-${ak}` }
  const hk = resistKey(def.hullResistAdd)
  if (hk) return { group: 'gap', kind: `hull-${hk}` }
  if (def.shieldFieldPct !== undefined) return { group: 'weighted', kind: 'shield-field' }
  if (def.shieldPulsePct !== undefined) return { group: 'weighted', kind: 'shield-charge' }
  if (def.repairArmorHp !== undefined || def.repairHullHp !== undefined) {
    return { group: 'weighted', kind: 'repair' }
  }
  if (def.foeRangeDebuffPct !== undefined) return { group: 'fleetDecay', kind: 'ecm' }
  if (def.captureWebCycleMs !== undefined) return { group: 'max', kind: 'capture-web' }
  return { group: 'flat', kind: def.slot }
}

export function pulseStreamOf(def: ModuleDef): { kind: string; modelId: string } | null {
  if (def.shieldFieldPct !== undefined) return { kind: 'shield-field', modelId: def.id }
  if (def.shieldPulsePct !== undefined) return { kind: 'shield-charge', modelId: def.id }
  if (def.repairArmorHp !== undefined || def.repairHullHp !== undefined) return { kind: 'repair', modelId: def.id }
  return null
}

export function fittedPenaltyPartsOf(state: GameState, ctx: SimContext, shipId: string, fittedOverride?: FittedModules) {
  const hull = fleetDefOf(state, ctx, shipId)
  const fitted = fittedOverride ?? state.fleet[shipId]?.fitted
  const defs = fitted ? allFittedModules(fitted, ctx).filter(d => moduleAllowedOnShip(hull, d)) : []
  const pools = new Map<string, Array<{ mod: ModuleDef; index: number; ordinal: number; value: number }>>()
  const strength = (d: ModuleDef, kind: string): number => {
    if (kind === 'evasion') return d.evasionGapPct ?? 0
    if (kind === 'hit') return d.hitBonusPct ?? 0
    if (kind === 'speed') return d.speedBonusPct ?? 0
    if (kind === 'warp') return d.warpSpeedBonusPct ?? 0
    if (kind === 'lock') return d.lockDmgBonus ?? 0
    if (kind === 'drone-relay') return d.droneRangeBonusPct ?? 0
    if (kind === 'drone-launch') return d.droneLaunchCutPct ?? 0
    if (kind === 'crisis-overload') return d.crisisOverload?.damageBonusPct ?? 0
    if (kind === 'laser-calibration') return d.laserFalloffBonus ?? 0
    if (kind === 'drone-hit') return d.droneHitGapPct ?? 0
    if (kind === 'ecm') return d.foeRangeDebuffPct ?? 0
    if (kind === 'shield-field') return d.shieldFieldPct ?? 0
    if (kind === 'shield-charge') return d.shieldPulsePct ?? 0
    if (kind === 'repair') return (d.repairArmorHp ?? 0) + (d.repairHullHp ?? 0)
    if (kind === 'reload') return d.reloadCutPct ?? 0
    for (const [prefix, values] of [['shield-', d.shieldResistAdd], ['armor-', d.armorResistAdd], ['hull-', d.hullResistAdd]] as const) {
      if (kind.startsWith(prefix)) return values?.[kind.slice(prefix.length) as DamageType] ?? 0
    }
    return 0
  }
  const out = defs.map((mod, index) => {
    const st = stackingOf(mod)
    const pool = pools.get(st.kind) ?? []
    const part = { mod, index, ordinal: pool.length + 1, value: strength(mod, st.kind), weight: 1 }
    pool.push(part)
    pools.set(st.kind, pool)
    return part
  })
  for (const pool of pools.values()) {
    const sorted = [...pool].sort((a, b) => b.value - a.value || a.index - b.index)
    let remain = 1, rank = 0
    for (const part of sorted) {
      const group = stackingOf(part.mod).group
      if (part.value <= 0 || group === 'flat' || group === 'max') continue
      out[part.index]!.weight = group === 'gap' ? remain : stackWeight(++rank)
      if (group === 'gap') remain *= 1 - Math.min(.9, Math.max(0, part.value))
    }
  }
  return out
}

export function equipmentPenaltiesOf(state: GameState, ctx: SimContext, shipId: string, fittedOverride?: FittedModules) {
  const result = { reload: 1, speed: 1, range: 1, hit: 1, resist: 0 }
  for (const { mod, weight } of fittedPenaltyPartsOf(state, ctx, shipId, fittedOverride)) {
    result.reload *= 1 + Math.max(0, mod.reloadPenaltyPct ?? 0) * weight
    result.speed *= 1 - Math.min(.9, Math.max(0, mod.speedPenaltyPct ?? 0)) * weight
    result.range *= 1 - Math.min(.9, Math.max(0, mod.rangeCutPct ?? 0)) * weight
    result.hit *= 1 - Math.min(.9, Math.max(0, mod.hitPenalty ?? 0)) * weight
    result.resist += Math.max(0, mod.allResistPenaltyPct ?? 0) * weight
  }
  return result
}

export function equipmentCycleMsOf(state: GameState, ctx: SimContext, shipId: string, baseMs: number): number {
  return Math.max(1, Math.round(baseMs * equipmentPenaltiesOf(state, ctx, shipId).reload))
}

export function curveMult(bonuses: number[]): number {
  const sorted = [...bonuses].filter((p) => p > 0).sort((a, b) => b - a)
  let mult = 1
  for (let i = 0; i < sorted.length; i++) mult *= 1 + sorted[i]! * stackWeight(i + 1)
  return mult
}

export function weightedSum(bonuses: number[]): number {
  const sorted = [...bonuses].filter((p) => p > 0).sort((a, b) => b - a)
  let sum = 0
  for (let i = 0; i < sorted.length; i++) sum += sorted[i]! * stackWeight(i + 1)
  return sum
}

export function laserFalloffOf(base: number, modules: readonly ModuleDef[]): number {
  return Math.min(1, Math.max(0, base + weightedSum(modules.map(m => m.laserFalloffBonus ?? 0))))
}

export function gapCombine(gaps: number[], base = 0): number {
  const cut = (x: number): number => Math.min(0.9, Math.max(0, x))
  let remain = 1 - cut(base)
  for (const x of gaps) remain *= 1 - cut(x)
  return 1 - remain
}

export function weightedGap(bonuses: number[]): number {
  const sorted = [...bonuses].map((p) => Math.min(0.9, Math.max(0, p))).filter((p) => p > 0).sort((a, b) => b - a)
  let remain = 1
  for (let i = 0; i < sorted.length; i++) remain *= 1 - sorted[i]! * stackWeight(i + 1)
  return 1 - remain
}

export const WEIGHTED_GAP_FLEET_CAP = 0.6

export function sameKindCount(fitted: FittedModules, ctx: SimContext, def: ModuleDef): number {
  const kind = stackingOf(def).kind
  let n = 0
  for (const id of allFittedIds(fitted)) {
    const d = ctx.modules.get(id)
    if (d && stackingOf(d).kind === kind) n++
  }
  return n
}

export function fittedBonuses(
  state: GameState,
  ctx: SimContext,
  shipId: string = state.shipId,
): Record<ModuleSlot, number> {
  const result = {} as Record<ModuleSlot, number>
  for (const slot of MODULE_SLOTS) result[slot] = 0
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return result
  for (const def of allFittedModules(fitted, ctx)) {
    if (def.bonus !== undefined && def.slot !== 'turret') result[def.slot] += def.bonus ?? 0
  }
  return result
}
