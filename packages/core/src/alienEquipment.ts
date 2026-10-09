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
  // 2026-10-09 船长确认：玩家酸蚀只削减目标装甲抗性。
  resists.armor = { ...base.armor }
  for (const type of ['kinetic', 'explosive', 'plasma'] as const) {
    resists.armor[type] = Math.max(RESIST_FLOOR, (base.armor?.[type] ?? 0) - cut)
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

/** 常驻渐增件与当前有效周期件同池折权；冷却只移除周期收益。 */
export function battleSpeedBonusOf(spec: Pick<UnitSpec, 'speedBonusModules' | 'thrusterBoost'>, battle: Pick<BattleState, 'startedAtGameMs' | 'lastTickGameMs'>, boosting = true): number {
  if (!spec.speedBonusModules) return boosting ? spec.thrusterBoost ?? 0 : 0
  const elapsed = Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs)
  return weightedSum(spec.speedBonusModules.filter(mod => boosting || mod.speedRamp).map(mod => {
    const ramp = mod.speedRamp
    const base = mod.speedBonusPct ?? 0
    return ramp ? base + (ramp.maxBonusPct - base) * Math.min(1, elapsed / ramp.rampMs) : base
  }))
}
