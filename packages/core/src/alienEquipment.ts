import type { UnitSpec } from './combat'
import type { BattleState } from './state'
import type { ModuleDef } from './types'
import { RESIST_FLOOR } from './combatMath'
import { weightedSum } from './equipment'

type AcidState = Pick<BattleState, 'foeAcidLayers'> & { units: Record<string, { hp: { s: number; a: number; h: number } }>; lastTickGameMs?: number; ended?: BattleState['ended'] }

export function foeAcidRowsOf(battle: BattleState): Array<{ tag: string; name: string; count: number; nextSeconds: number }> {
  if (battle.ended) return []
  return Object.entries(battle.foeAcidLayers ?? {}).flatMap(([tag, layers]) => {
    const unit = battle.units[tag]
    const live = layers.filter(layer => layer.untilMs > battle.lastTickGameMs)
    return unit && unit.hp.s + unit.hp.a + unit.hp.h > 0 && live.length
      ? [{ tag, name: unit.name, count: live.length, nextSeconds: Math.ceil((Math.min(...live.map(layer => layer.untilMs)) - battle.lastTickGameMs) / 1000) }] : []
  })
}

/** 只保存逐层期限；有效抗性从基线重算，触底后到期不会加回过量。 */
export function acidResistsOf(battle: Pick<AcidState, 'foeAcidLayers' | 'lastTickGameMs'>, tag: string, base: UnitSpec['resists'], nowMs = battle.lastTickGameMs ?? 0): UnitSpec['resists'] {
  const layers = battle.foeAcidLayers?.[tag]?.filter(layer => layer.untilMs > nowMs) ?? []
  const cut = layers.reduce((sum, layer) => sum + layer.cutPct, 0)
  if (cut <= 0) return base
  const resists = { ...base }
  for (const layer of ['armor', 'hull'] as const) {
    resists[layer] = { ...base[layer] }
    for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
      resists[layer]![type] = Math.max(RESIST_FLOOR, (base[layer]?.[type] ?? 0) - cut)
    }
  }
  return resists
}

export function addFoeAcidLayer(battle: AcidState, tag: string, effect: NonNullable<ModuleDef['acidOnHit']>, nowMs: number): void {
  const hp = battle.units[tag]?.hp
  if (!hp || hp.s + hp.a + hp.h <= 0 || battle.ended) return
  const book = battle.foeAcidLayers ?? (battle.foeAcidLayers = {})
  const layers = book[tag] ?? (book[tag] = [])
  layers.push({ cutPct: effect.cutPct, untilMs: nowMs + effect.durationMs })
}

export function expireFoeAcidLayers(battle: AcidState, nowMs = battle.lastTickGameMs ?? 0): void {
  if (!battle.foeAcidLayers) return
  for (const [tag, layers] of Object.entries(battle.foeAcidLayers)) {
    const hp = battle.units[tag]?.hp
    const live = !battle.ended && hp && hp.s + hp.a + hp.h > 0 ? layers.filter(layer => layer.untilMs > nowMs) : []
    if (live.length) battle.foeAcidLayers[tag] = live
    else delete battle.foeAcidLayers[tag]
  }
  if (!Object.keys(battle.foeAcidLayers).length) delete battle.foeAcidLayers
}

/** 同舰所有速度收益按当前强度排序，仍由既有推进器窗口决定是否点火。 */
export function battleSpeedBonusOf(spec: Pick<UnitSpec, 'speedBonusModules' | 'thrusterBoost'>, battle: Pick<BattleState, 'startedAtGameMs' | 'lastTickGameMs'>): number {
  if (!spec.speedBonusModules) return spec.thrusterBoost ?? 0
  const elapsed = Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs)
  return weightedSum(spec.speedBonusModules.map(mod => {
    const ramp = mod.speedRamp
    const base = mod.speedBonusPct ?? 0
    return ramp ? base + (ramp.maxBonusPct - base) * Math.min(1, elapsed / ramp.rampMs) : base
  }))
}
