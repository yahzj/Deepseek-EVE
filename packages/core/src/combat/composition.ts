import type { DamageType, AnomalyDef, DefProfile } from '../types'
import type { Hp3 } from '../combatMath'


export function compositionOfMix(
  mix: Partial<Record<DamageType, number>> | undefined,
): Array<{ type: DamageType; share: number }> {
  const rows = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ type: t, w: mix?.[t] ?? 0 }))
    .filter((r) => r.w > 0)
  if (rows.length <= 1) return [{ type: rows[0]?.type ?? 'kinetic', share: 1 }]
  const total = rows.reduce((s, r) => s + r.w, 0)
  return rows
    .map((r) => ({ type: r.type, share: r.w / total }))
    .sort((a, b) => b.share - a.share || a.type.localeCompare(b.type))
}

export function foeDamageComposition(anomaly: AnomalyDef): Array<{ type: DamageType; share: number }> {
  return compositionOfMix(anomaly.dmgMix)
}

export function pickTopType(mix: Partial<Record<DamageType, number>> | undefined): DamageType {
  let best: DamageType = 'kinetic'
  let bestW = 0
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const w = mix?.[t] ?? 0
    if (w > bestW) {
      bestW = w
      best = t
    }
  }
  return best
}

export function foeMainDamageType(anomaly: AnomalyDef): DamageType {
  return pickTopType(anomaly.dmgMix)
}

export function splitShotByComposition(
  shotDmg: number,
  comp: ReadonlyArray<{ type: DamageType; share: number }>,
): Array<{ type: DamageType; dmg: number }> {
  if (shotDmg <= 0) return []
  if (comp.length <= 1) return [{ type: comp[0]?.type ?? 'kinetic', dmg: shotDmg }]
  const out: Array<{ type: DamageType; dmg: number }> = []
  let left = shotDmg
  comp.forEach((c, i) => {
    const dmg = i === comp.length - 1 ? left : Math.max(1, Math.round(shotDmg * c.share))
    const take = Math.min(left, dmg)
    out.push({ type: c.type, dmg: take })
    left -= take
  })
  return out.filter((r) => r.dmg > 0)
}

export const PROFILE_SPLIT: Record<string, Hp3> = {
  shield: { s: 0.5, a: 0.25, h: 0.25 },
  armor: { s: 0.2, a: 0.55, h: 0.25 },
  balanced: { s: 0.34, a: 0.33, h: 0.33 },
}

export function foeLayerSplit(profile: DefProfile | undefined): { s: number; a: number; h: number } {
  return PROFILE_SPLIT[profile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
}
