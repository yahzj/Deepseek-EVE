import type { GameState, WormholeFamily } from '../state'
import type { SimContext } from '../types'
import type { SignalAutoGuardBattle } from './types'
import { startFleetBattleFor } from '../combat/startFleet'
import { advanceBattleFor } from '../combat/advance'
import { stampFoeArrivalFx } from '../combat/combatFx'
import { resolvedBattleAnomaly } from '../combat/cards'
import { waveGapTotalMs } from '../combat/combatMath'
import { wormholeGuardCardOf } from '../wormholeFoes'
import { hashSeed } from '../rng'

/** 只在隔离副本运行正式守卫战；各层独立，不提交战损、补给或其他游戏状态。 */
export function signalAutoGuardBattleOf(state: GameState, ctx: SimContext, ids: readonly string[],
  family: WormholeFamily, depth: number, seed: number): SignalAutoGuardBattle {
  const cardId = wormholeGuardCardOf(family, depth)
  const unavailable: SignalAutoGuardBattle = { cardId, outcome: 'unavailable', durationMs: 0 }
  if (!ids.length || !ctx.anomalies.has(cardId)) return unavailable
  const sim = structuredClone(state)
  sim.shipId = ids[0]!
  sim.gameMs = 0
  sim.rng = { seed: hashSeed(`signal-auto-guard-2/${seed}/${family}/${depth}`), count: 0 }
  sim.wormhole = { ...sim.wormhole, run: null }
  const battle = startFleetBattleFor(sim, ctx, ids, cardId, 0, null, { depth, kind: 'boss', waves: 1 })
  if (!battle) return unavailable
  stampFoeArrivalFx(battle)
  const card = resolvedBattleAnomaly(ctx, battle, cardId)
  const limit = ctx.balance.battle.maxBattleMs + waveGapTotalMs(card, ctx.balance.battle) + 60_000
  // 外层按秒推进，交战内部仍使用正式10毫秒步长及入场/切波时钟。
  while (!battle.ended && sim.gameMs < limit) {
    sim.gameMs = Math.min(limit, sim.gameMs + 1000)
    advanceBattleFor(sim, ctx, battle, sim.shipId, cardId)
  }
  const outcome = battle.ended === 'me' ? 'victory'
    : battle.escapeReason === 'timeout' || !battle.ended ? 'timeout' : 'defeat'
  return { cardId, outcome, durationMs: Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs) }
}
