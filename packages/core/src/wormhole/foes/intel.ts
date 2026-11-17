import type { DamageType, SimContext } from '../../types'
import type { WormholeFamily } from '../../state'
import { type WormholeCardTier, WORMHOLE_CARD_TIERS, WORMHOLE_FAMILY_CARDS, WORMHOLE_CARD_FALLBACK, WORMHOLE_FAMILY_ETHNIC, WORMHOLE_FAMILY_CARD, wormholeFamilyOfSeed } from './pool'
import { foeDamageComposition } from '../../combat/composition'

export const DAMAGE_TYPE_LABELS: Readonly<Record<DamageType, string>> = {
  kinetic: '动能',
  explosive: '高爆',
  plasma: '能量',
}

export interface WormholeFamilyIntel {
  family: WormholeFamily
  ethnic: string
  firstCardId: string
  firstCardName: string
  primaryText: string
  primaryKind: 'pure' | 'main' | 'mixed'
  primaryTypeA: DamageType
  primaryTypeB?: DamageType
  tiers: ReadonlyArray<{
    tier: WormholeCardTier
    cardId: string
    cardName: string
    parts: ReadonlyArray<{ type: DamageType; share: number }>
  }>
}

export const WORMHOLE_TIER_LABELS: Readonly<Record<WormholeCardTier, string>> = {
  shallow: '浅层',
  mid: '中层',
  deep: '深层',
}

export const DAMAGE_TYPE_LABEL_IDS: Readonly<Record<DamageType, string>> = {
  kinetic: 'core.wormholeFoes.004',
  explosive: 'core.wormholeFoes.005',
  plasma: 'core.wormholeFoes.006',
}

export const WORMHOLE_FAMILY_ETHNIC_IDS: Readonly<Record<WormholeFamily, string>> = {
  A: 'core.wormholeFoes.007',
  C: 'core.wormholeFoes.008',
  D: 'core.wormholeFoes.009',
  E: 'core.wormholeFoes.010',
  G: 'core.wormholeFoes.011',
}

export function wormholeFamilyIntel(family: WormholeFamily, ctx: SimContext): WormholeFamilyIntel {
  const nameOf = (id: string): string => ctx.anomalies.get(id)?.name ?? id
  const tiers = WORMHOLE_CARD_TIERS.map((tier) => {
    const cardId = WORMHOLE_FAMILY_CARDS[family][tier] ?? WORMHOLE_CARD_FALLBACK
    const card = ctx.anomalies.get(cardId)
    return {
      tier,
      cardId,
      cardName: nameOf(cardId),
      parts: card ? foeDamageComposition(card) : [{ type: 'kinetic' as DamageType, share: 1 }],
    }
  })
  const shallow = tiers[0]!
  const parts = shallow.parts
  const typeA: DamageType = parts[0]?.type ?? 'kinetic'
  const primaryKind: 'pure' | 'main' | 'mixed' = parts.length <= 1 ? 'pure' : parts[0]!.share >= 0.75 ? 'main' : 'mixed'
  const primaryText =
    primaryKind === 'pure'
      ? `纯${DAMAGE_TYPE_LABELS[typeA]}`
      : primaryKind === 'main'
        ? `${DAMAGE_TYPE_LABELS[typeA]}为主`
        : `${DAMAGE_TYPE_LABELS[typeA]} / ${DAMAGE_TYPE_LABELS[parts[1]!.type]}并重`
  return {
    family,
    ethnic: WORMHOLE_FAMILY_ETHNIC[family],
    firstCardId: shallow.cardId,
    firstCardName: shallow.cardName,
    primaryText,
    primaryKind,
    primaryTypeA: typeA,
    ...(primaryKind === 'mixed' ? { primaryTypeB: parts[1]!.type } : {}),
    tiers,
  }
}

export function wormholeCardIdOfFamily(family: WormholeFamily | undefined, seed: number | undefined): string {
  return WORMHOLE_FAMILY_CARD[family ?? wormholeFamilyOfSeed(seed ?? 1)]
}
