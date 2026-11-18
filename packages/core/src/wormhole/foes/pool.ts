import type { WormholeFamily } from '../../state'
import type { WormholeFoeKind } from './curves'

export const WORMHOLE_FOE_CARD_IDS: readonly string[] = [
  'wh-pirate-scout',
  'wh-alien-swarm',
  'wh-grave-watch',
  'wh-exile-blockade',
  'wh-titan-echo',
  'wh-pirate-hunt',
  'wh-pirate-warband',
  'wh-alien-brood',
  'wh-alien-hive',
  'wh-grave-sentry',
  'wh-grave-throne',
  'wh-titan-missile',
  'wh-titan-hulk',
  'wh-exile-swarm',
  'wh-exile-line',
]

export type WormholeCardTier = 'shallow' | 'mid' | 'deep'

export const WORMHOLE_CARD_TIERS: readonly WormholeCardTier[] = ['shallow', 'mid', 'deep']

export const WORMHOLE_TIER_LABEL: Readonly<Record<WormholeCardTier, string>> = {
  shallow: '浅层',
  mid: '中层',
  deep: '深层',
}

export const WORMHOLE_TIER_UNLOCK_DEPTH: Readonly<Record<WormholeCardTier, number>> = {
  shallow: 1,
  mid: 2,
  deep: 4,
}

export const WORMHOLE_TIER_THREAT_MUL: Readonly<Record<WormholeCardTier, number>> = {
  shallow: 1,
  mid: 1.05,
  deep: 1.1,
}

export function wormholeTierWeightsAt(depth: number): Readonly<Record<WormholeCardTier, number>> {
  const d = Math.max(1, Math.floor(depth))
  if (d <= 1) return { shallow: 1, mid: 0, deep: 0 }
  if (d <= 3) return { shallow: 1, mid: 2, deep: 0 }
  return { shallow: 1, mid: 1, deep: 2 }
}

export function wormholeCardPoolAt(
  family: WormholeFamily,
  depth: number,
): Array<{ id: string; tier: WormholeCardTier; weight: number }> {
  const w = wormholeTierWeightsAt(depth)
  const out: Array<{ id: string; tier: WormholeCardTier; weight: number }> = []
  for (const t of WORMHOLE_CARD_TIERS) {
    const id = WORMHOLE_FAMILY_CARDS[family][t]
    if (id !== null && w[t] > 0) out.push({ id, tier: t, weight: w[t] })
  }
  if (out.length > 0) return out
  const deepest = [...WORMHOLE_CARD_TIERS].reverse().find((t) => WORMHOLE_FAMILY_CARDS[family][t] !== null)
  const id = deepest ? WORMHOLE_FAMILY_CARDS[family][deepest]! : WORMHOLE_FAMILY_CARD[family]
  return [{ id, tier: deepest ?? 'shallow', weight: 1 }]
}

export function wormholeGuardCardOf(family: WormholeFamily, depth: number): string {
  const d = Math.max(1, Math.floor(depth))
  for (const t of [...WORMHOLE_CARD_TIERS].reverse()) {
    if (WORMHOLE_TIER_UNLOCK_DEPTH[t] <= d && WORMHOLE_FAMILY_CARDS[family][t] !== null) {
      return WORMHOLE_FAMILY_CARDS[family][t]!
    }
  }
  return WORMHOLE_FAMILY_CARD[family]
}

export function wormholeCardIdForRun(spec: {
  family?: WormholeFamily
  seed?: number
  depth: number
  kind: WormholeFoeKind
  nodeIndex?: number
}): string {
  const family = spec.family ?? wormholeFamilyOfSeed(spec.seed ?? 1)
  if (spec.kind === 'boss') return wormholeGuardCardOf(family, spec.depth)
  const pool = wormholeCardPoolAt(family, spec.depth)
  const total = pool.reduce((n, e) => n + e.weight, 0)
  if (total <= 0) return WORMHOLE_FAMILY_CARD[family]
  const seed = Math.abs(Math.floor(spec.seed ?? 1)) % 1_000_000_007
  const d = Math.max(1, Math.floor(spec.depth))
  const i = Math.max(0, Math.floor(spec.nodeIndex ?? 0))
  const h = Math.abs((seed * 1103515245 + (d * 97 + i) * 12345) % 2147483647)
  let r = h % total
  for (const e of pool) {
    if (r < e.weight) return e.id
    r -= e.weight
  }
  return pool[pool.length - 1]!.id
}

export function wormholeTierOfCard(cardId: string | null | undefined): WormholeCardTier | null {
  if (!cardId) return null
  for (const f of WORMHOLE_FAMILY_ORDER) {
    for (const t of WORMHOLE_CARD_TIERS) {
      if (WORMHOLE_FAMILY_CARDS[f][t] === cardId) return t
    }
  }
  return null
}

export function wormholeCardOfTier(family: WormholeFamily, tier: WormholeCardTier): string | null {
  return WORMHOLE_FAMILY_CARDS[family][tier]
}

export function wormholeAllCardIds(): string[] {
  return WORMHOLE_FAMILY_ORDER.flatMap((f) =>
    WORMHOLE_CARD_TIERS.map((t) => WORMHOLE_FAMILY_CARDS[f][t]).filter((x): x is string => x !== null),
  )
}

export const WORMHOLE_FAMILY_ORDER: readonly WormholeFamily[] = ['A', 'C', 'D', 'E', 'G']

export const WORMHOLE_FAMILY_CARDS: Readonly<
  Record<WormholeFamily, Readonly<Record<WormholeCardTier, string | null>>>
> = {
  A: { shallow: 'wh-pirate-scout', mid: 'wh-pirate-hunt', deep: 'wh-pirate-warband' },
  C: { shallow: 'wh-alien-swarm', mid: 'wh-alien-brood', deep: 'wh-alien-hive' },
  D: { shallow: 'wh-grave-watch', mid: 'wh-grave-sentry', deep: 'wh-grave-throne' },
  E: { shallow: 'wh-titan-echo', mid: 'wh-titan-missile', deep: 'wh-titan-hulk' },
  G: { shallow: 'wh-exile-blockade', mid: 'wh-exile-swarm', deep: 'wh-exile-line' },
}

export const WORMHOLE_CARD_FALLBACK = 'wh-pirate-scout'

export const WORMHOLE_FAMILY_GLYPH: Readonly<Record<WormholeFamily, string>> = {
  A: 'fam-a',
  C: 'fam-c',
  D: 'fam-d',
  E: 'fam-e',
  G: 'fam-g',
}

export const WORMHOLE_FAMILY_CARD: Readonly<Record<WormholeFamily, string>> = {
  A: WORMHOLE_FAMILY_CARDS.A.shallow ?? WORMHOLE_CARD_FALLBACK,
  C: WORMHOLE_FAMILY_CARDS.C.shallow ?? WORMHOLE_CARD_FALLBACK,
  D: WORMHOLE_FAMILY_CARDS.D.shallow ?? WORMHOLE_CARD_FALLBACK,
  E: WORMHOLE_FAMILY_CARDS.E.shallow ?? WORMHOLE_CARD_FALLBACK,
  G: WORMHOLE_FAMILY_CARDS.G.shallow ?? WORMHOLE_CARD_FALLBACK,
}

export function mix32(x: number): number {
  let v = x >>> 0
  v = Math.imul(v ^ (v >>> 16), 2246822507)
  v = Math.imul(v ^ (v >>> 13), 3266489909)
  v ^= v >>> 16
  return v >>> 0
}

export function wormholeFamilyOfSeed(seed: number): WormholeFamily {
  const s = Math.abs(Math.floor(seed)) % 1_000_000_007
  const h = mix32(s) % WORMHOLE_FAMILY_ORDER.length
  return WORMHOLE_FAMILY_ORDER[h]!
}

export const WORMHOLE_FAMILY_ETHNIC: Readonly<Record<WormholeFamily, string>> = {
  A: '海盗',
  C: '异形',
  D: '守墓',
  E: '巨构',
  G: '亡军',
}
