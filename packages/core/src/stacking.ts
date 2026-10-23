import type { DamageType, ModuleDef } from './types'

/** 多件惩罚曲线沿用既有公式，n 从 1 起。 */
export function stackWeight(n: number): number {
  const k = Math.max(0, n - 1) / 2.67
  return Math.exp(-(k * k))
}

export type SupportEffect = `damage:${DamageType}` | `range:${DamageType}` | 'reload'

/** 每个效果独立按强度排位；同型号与跨型号都进入同一个效果池。 */
export function supportEffectPartsOf(modules: readonly ModuleDef[], effect: SupportEffect) {
  const parts = modules.map((mod, index) => {
    const value = mod.slot !== 'support' ? 0 : effect === 'reload' ? (mod.speedBonusPct === undefined ? mod.reloadCutPct ?? 0 : 0)
      : effect.startsWith('damage:') ? mod.damageTypeBonusPct?.[effect.slice(7) as DamageType] ?? 0
        : mod.rangeTypeBonusPct?.[effect.slice(6) as DamageType] ?? 0
    return { mod, index, value, weight: 1 }
  })
  const sorted = parts.filter(p => p.value > 0).sort((a, b) => b.value - a.value || a.index - b.index)
  sorted.forEach((part, rank) => { part.weight = stackWeight(rank + 1) })
  return parts
}
