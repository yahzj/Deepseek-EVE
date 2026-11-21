import type { WormholeFamily } from '../../state'
import type { FoeTargetingMode, AnomalyDef, FoeShipSlot } from '../../types'
import { type WormholeFoeKind, wormholeCardThreatOf, wormholeNaturalHp, WORMHOLE_THREAT_REF_RATIO } from './curves'
import { ceilFinalQuantity } from '../../quantity'

export const WORMHOLE_BOSS_TARGETING_CHANCE = 0.1

export const WORMHOLE_FAMILY_TARGETING: Readonly<Record<WormholeFamily, FoeTargetingMode>> = {
  A: 'noncombat',
  C: 'smallest',
  D: 'top-output',
  E: 'random',
  G: 'random',
}

export const WORMHOLE_FAMILY_TARGETING_CHANCE = 0.1

export function wormholeAnomalyOf(
  base: AnomalyDef,
  depth: number,
  kind: WormholeFoeKind,
  waves: number,
  opts?: { hpBudget?: number; strengthMul?: number; tierThreatMul?: number; naturalDps?: number },
): AnomalyDef {
  const fam = base.foeFamily
  const familyTargeting: FoeTargetingMode =
    fam !== undefined && fam in WORMHOLE_FAMILY_TARGETING
      ? WORMHOLE_FAMILY_TARGETING[fam as WormholeFamily]
      : (base.foeTargeting ?? 'random')
  const target = wormholeCardThreatOf(base, depth, kind)
  const natural = Math.max(1, wormholeNaturalHp(base))
  const budget = (opts?.hpBudget ?? natural) * (opts?.strengthMul ?? 1)
  const ratio = opts?.naturalDps !== undefined && opts.naturalDps > 0 ? natural / opts.naturalDps : WORMHOLE_THREAT_REF_RATIO
  const threatBudget = ((budget * budget) / WORMHOLE_THREAT_REF_RATIO) * (opts?.tierThreatMul ?? 1)
  const hpTarget = Math.sqrt(threatBudget * ratio)
  const dpsTarget = Math.sqrt(threatBudget / ratio)
  const scaleHp = hpTarget / natural
  const scaleDmg = opts?.naturalDps !== undefined && opts.naturalDps > 0 ? dpsTarget / opts.naturalDps : scaleHp
  const nWaves = Math.max(1, Math.floor(waves))
  const per = 1 / nWaves
  const slots = base.ships ?? []
  const ships: readonly FoeShipSlot[] | undefined =
    slots.length === 0
      ? base.ships
      : slots.flatMap((slot) =>
          Array.from({ length: nWaves }, (_, i) => ({
            ...slot,
            wave: i,
            hpMul: (slot.hpMul ?? 1) * scaleHp * per,
            dmgMul: (slot.dmgMul ?? 1) * scaleDmg * per,
            ...(slot.firepowerAnchor !== undefined
              ? { firepowerAnchor: Math.max(1, ceilFinalQuantity(slot.firepowerAnchor * scaleDmg * per)) }
              : {}),
          })),
        )
  const perWaveUnits = (ships ?? []).length
    ? Array.from({ length: nWaves }, (_, i) =>
        (ships ?? [])
          .filter((s) => (s.wave ?? 0) === i)
          .reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0),
      )
    : []
  return {
    ...base,
    name:
      kind === 'boss'
        ? `${base.name} · 第 ${depth} 层守卫`
        : kind === 'extract'
          ?
            `${base.name} · 撤离`
          : `${base.name} · 第 ${depth} 层`,
    threat: target,
    ...(perWaveUnits.length > 0
      ? {
          ships,
          waves: perWaveUnits.map((units) => ({ units: Math.max(1, units), hpShare: 1 })),
        }
      : {}),
    foeTargeting: kind === 'boss' ? 'largest' : familyTargeting,
    foeTargetingChance:
      kind === 'boss'
        ? WORMHOLE_BOSS_TARGETING_CHANCE
        : familyTargeting === 'random'
          ? 1
          : WORMHOLE_FAMILY_TARGETING_CHANCE,
  }
}
