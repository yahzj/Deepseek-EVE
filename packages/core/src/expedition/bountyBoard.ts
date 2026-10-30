import type { GameState } from '../state'
import type { AnomalyDef, SimContext } from '../types'
import { isLairCandidate, lairLevelOf, type LairTier } from '../lairs'
import { nextInt } from '../rng'
import { securityZoneOf, type SecurityZone } from '../securityZone'

export const BOUNTY_ZONE_PLAN: ReadonlyArray<{ zone: SecurityZone; count: number }> = [
  { zone: '中安', count: 2 },
  { zone: '低安', count: 3 },
]
export const BOUNTY_TASKS_PER_ROUND = BOUNTY_ZONE_PLAN.reduce((sum, plan) => sum + plan.count, 0)

const BOUNTY_STANDING: Readonly<Record<LairTier, number>> = { 1: 0, 2: 1, 3: 2 }

/** 每日任务的额外声望，独立于目标卡首胜奖励。 */
export function bountyTaskStandingGain(tier: LairTier): number {
  return BOUNTY_STANDING[tier]
}

interface BountyPlace {
  zone: SecurityZone
  cards: AnomalyDef[]
}
export interface BountyBoardPick {
  card: AnomalyDef
  tier: LairTier
}

/** 合法地点优先匹配三档保底，余席随机；不越地图上限、不跨安全分区补位。 */
export function rollBountyBoard(state: GameState, ctx: SimContext, excludedGalaxyId: string | null): BountyBoardPick[] {
  const places = new Map<string, BountyPlace>()
  for (const card of ctx.anomalies.values()) {
    if (!isLairCandidate(card) || !state.exploredGalaxies.includes(card.galaxyId) || card.galaxyId === excludedGalaxyId) continue
    const zone = securityZoneOf(ctx, card.galaxyId)
    if (!BOUNTY_ZONE_PLAN.some(plan => plan.zone === zone)) continue
    const place = places.get(card.galaxyId) ?? { zone, cards: [] }
    place.cards.push(card)
    places.set(card.galaxyId, place)
  }
  const pool = [...places.values()]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = nextInt(state.rng, i + 1)
    const temp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = temp
  }
  const remaining = new Map(BOUNTY_ZONE_PLAN.map(plan => [plan.zone, plan.count]))
  const assigned = new Map<BountyPlace, LairTier>()
  // 只有三档，有限回溯同时满足不同地点和分区配额；同覆盖数优先保留低档。
  const plans: readonly (readonly LairTier[])[] = [[3, 2, 1], [2, 1], [3, 1], [3, 2], [1], [2], [3], []]
  const match = (tiers: readonly LairTier[], at = 0): boolean => {
    if (at === tiers.length) return true
    const tier = tiers[at]!
    for (const place of pool) {
      const slots = remaining.get(place.zone) ?? 0
      if (slots <= 0 || assigned.has(place) || !place.cards.some(card => lairLevelOf(card) >= tier)) continue
      assigned.set(place, tier)
      remaining.set(place.zone, slots - 1)
      if (match(tiers, at + 1)) return true
      assigned.delete(place)
      remaining.set(place.zone, slots)
    }
    return false
  }
  for (const plan of plans) if (match(plan)) break
  const picks: BountyBoardPick[] = []
  for (const place of pool) {
    const forced = assigned.get(place)
    const slots = remaining.get(place.zone) ?? 0
    if (forced === undefined && slots <= 0) continue
    const cards = forced === undefined ? place.cards : place.cards.filter(card => lairLevelOf(card) >= forced)
    const card = cards[nextInt(state.rng, cards.length)]!
    const tier = forced ?? ((1 + nextInt(state.rng, lairLevelOf(card))) as LairTier)
    if (forced === undefined) remaining.set(place.zone, slots - 1)
    picks.push({ card, tier })
  }
  return picks
}
