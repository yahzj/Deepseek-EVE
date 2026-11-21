import { weekendWreckPoolsOf, wreckGroupOfCard } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'

export type WreckCardKind = 'ship-wrecks' | 'invasion' | 'all'

export function wreckCardSequenceOf(input: {
  shipWreckCount: number
  invasionWreckM3: number
  invasionRareCount?: number
}): WreckCardKind[] {
  const out: WreckCardKind[] = []
  if (input.shipWreckCount > 0) out.push('ship-wrecks')
  if (input.invasionWreckM3 > 0 || (input.invasionRareCount ?? 0) > 0) out.push('invasion')
  out.push('all')
  return out
}

export function wreckAiHostOf(sequence: readonly WreckCardKind[]): WreckCardKind | undefined {
  return sequence[0]
}

export function invasionWreckRowsOf(state: GameState, ctx: SimContext, galaxyId: string) {
  return weekendWreckPoolsOf(state, galaxyId).map((pool) => {
    const card = pool.family === null ? undefined : [...ctx.anomalies.values()]
      .find((a) => a.hidden === true && a.region === 'inv' && a.foeFamily === pool.family)
    const group = card ? wreckGroupOfCard(card.id, ctx) : null
    return { ...pool, name: group ? ctx.items.get(`wreck-${group.key}`)?.name ?? null : null }
  })
}
