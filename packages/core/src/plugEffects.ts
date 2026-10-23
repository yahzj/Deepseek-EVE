import type { ModuleDef, SimContext } from './types'
import { stackWeight } from './stacking'

/** 插件与普通装备的惩罚池分离；空间压缩整件共用同一份权重。 */
export function plugStackingKindOf(mod: ModuleDef): string | null {
  if (mod.slot !== 'plug' || mod.plugNonStacking || mod.targetWeightMul !== undefined ||
    mod.cpuBonus !== undefined || mod.midSlotsAdd !== undefined || mod.lowSlotsAdd !== undefined) return null
  if (mod.shieldHpAdd !== undefined) return 'plug-shield'
  if (mod.armorHpAdd !== undefined) return 'plug-armor'
  if (mod.hullHpAdd !== undefined) return 'plug-hull'
  if (mod.damageBonusPct !== undefined) return 'plug-damage'
  if (mod.hitBonusPct !== undefined) return 'plug-hit'
  if (mod.plugRangeBonusPct !== undefined) return 'plug-range'
  if (mod.speedAddMps !== undefined) return 'plug-speed'
  if (mod.cargoCapacityBonusPct !== undefined || mod.droneBayBonusM3 !== undefined) return 'plug-capacity'
  return null
}

type ScaledField = 'shieldHpAdd' | 'armorHpAdd' | 'hullHpAdd' | 'damageBonusPct' | 'hitBonusPct' |
  'plugRangeBonusPct' | 'speedAddMps' | 'cargoCapacityBonusPct' | 'droneBayBonusM3' | 'cpuPenalty' | 'speedPenaltyMps'

const SCALED_FIELDS: readonly ScaledField[] = ['shieldHpAdd', 'armorHpAdd', 'hullHpAdd', 'damageBonusPct', 'hitBonusPct',
  'plugRangeBonusPct', 'speedAddMps', 'cargoCapacityBonusPct', 'droneBayBonusM3', 'cpuPenalty', 'speedPenaltyMps']

function strengthOf(mod: ModuleDef, kind: string): number {
  if (kind === 'plug-shield') return mod.shieldHpAdd ?? 0
  if (kind === 'plug-armor') return mod.armorHpAdd ?? 0
  if (kind === 'plug-hull') return mod.hullHpAdd ?? 0
  if (kind === 'plug-damage') return mod.damageBonusPct ?? 0
  if (kind === 'plug-hit') return mod.hitBonusPct ?? 0
  if (kind === 'plug-range') return mod.plugRangeBonusPct ?? 0
  if (kind === 'plug-speed') return mod.speedAddMps ?? 0
  return mod.cargoCapacityBonusPct ?? mod.droneBayBonusM3 ?? 0
}

/** 只生成计算用副本，不改变已安装列表、槽数、库存与回收数量。 */
export function plugEffectPartsOf(ids: readonly string[], ctx: Pick<SimContext, 'modules'>) {
  const seen = new Set<string>()
  const parts = ids.flatMap((id, index) => {
    const mod = ctx.modules.get(id)
    if (!mod || mod.slot !== 'plug' || mod.plugNonStacking && seen.has(id)) return []
    seen.add(id)
    return [{ mod, index, kind: plugStackingKindOf(mod), weight: 1 }]
  })
  const pools = new Map<string, typeof parts>()
  for (const part of parts) {
    if (part.kind === null) continue
    const pool = pools.get(part.kind) ?? []
    pool.push(part)
    pools.set(part.kind, pool)
  }
  for (const [kind, pool] of pools) {
    pool.sort((a, b) => strengthOf(b.mod, kind) - strengthOf(a.mod, kind) || a.index - b.index)
    pool.forEach((part, rank) => { part.weight = stackWeight(rank + 1) })
  }
  return parts.map(part => {
    const effective = { ...part.mod }
    if (part.kind !== null) for (const field of SCALED_FIELDS) {
      const value = effective[field]
      if (value !== undefined) effective[field] = value * part.weight
    }
    return { ...part, effective }
  })
}
