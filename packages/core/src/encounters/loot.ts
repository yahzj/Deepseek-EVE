import type { GameState } from '../state'
import type { SimContext } from '../types'
import { weekendInvolvedAt, foeOf } from './presence'
import { ceilFinalQuantity } from '../quantity'
import { injectWeekendWreck, weekendWreckInjectionOf, WRECK_ENCOUNTER_INJECT_FRAC, asFoeFamily, wreckInjectThreatOf, strongestBountyInjection, WRECK_INJECT_PER_THREAT, injectWreckDensity } from '../salvage'
import { firepowerHitHp, type HullHit, pctOf as pct } from '../hullDamage'

export function lootOf(state: GameState, ctx: SimContext, seizeF: number): number {
  if (weekendInvolvedAt(state, ctx)) return 0
  const foe = foeOf(state, ctx)
  const base = foe ? Math.max(0, foe.rewardIsk) : Math.max(1, Math.round(state.encounter.threat))
  return Math.max(1, ceilFinalQuantity(base * ctx.balance.encounter.lootFracOfBounty * seizeF))
}

export function dropWrecks(state: GameState, ctx: SimContext): void {
  const enc = state.encounter
  if (!enc.galaxyId) return
  const foe = foeOf(state, ctx)
  if (weekendInvolvedAt(state, ctx)) {
    const own = enc.anomalyId !== null ? ctx.anomalies.get(enc.anomalyId) : undefined
    const card = own ?? foe
    if (card) {
      injectWeekendWreck(
    state,
    enc.galaxyId,
    weekendWreckInjectionOf(card, WRECK_ENCOUNTER_INJECT_FRAC),
    asFoeFamily(card.foeFamily) ?? asFoeFamily(state.weekendEvent?.family),
  )
    }
    return
  }
  const threat = foe ? Math.max(1, wreckInjectThreatOf(foe)) : Math.max(1, enc.threat)
  const strongest = strongestBountyInjection(enc.galaxyId, ctx)
  const amount = strongest !== null ? strongest * WRECK_ENCOUNTER_INJECT_FRAC : threat * WRECK_INJECT_PER_THREAT
  injectWreckDensity(state, ctx, enc.galaxyId, amount)
}

export function ambushHitHp(ctx: SimContext, threat: number): number {
  return firepowerHitHp(ctx, threat, ctx.balance.encounter.hitFirepowerSec)
}

export function hitLogText(shipName: string, galaxyName: string, foeName: string, suffix: string, hit: HullHit): string {
  const hullPart = hit.hullLost > 0 ? `、结构 -${pct(hit.hullLost)}%` : ''
  return `⚔ 遭遇（${galaxyName}·${foeName}）：${shipName} 寡不敌众被咬下一块装甲${suffix}——装甲 -${pct(hit.armorLost)}%${hullPart}（现 装甲 ${pct(hit.armorTo)}% / 结构 ${pct(hit.hullTo)}%）。`
}
