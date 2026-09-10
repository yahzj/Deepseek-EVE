/**
 * 悬赏奖金"展示 = 到账"口径回归（2026-09-10 船长按玩家反馈拍板）：
 * 玩家反馈"卡片赏金与实际到账不一样"——根因两处：
 * ① 结算带 ±15% 浮动（`balance.rewardJitter`），而卡片展示的是不含浮动的名义值；
 * ② 赏金任务（窝点）卡片漏乘"赏金猎手学"技能系数。
 * 现口径：**取消浮动**（唯一随机奖励 = 情报彩蛋 +10%，且会在日志里说明），
 * 卡片展示公式 = 结算公式 = `基础奖金 × 赏金猎手学系数`。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, addShipToFleet } from '../src/index'
import { bountyRewardFactor, DSI_FACTION_ID, resolveBattleOutcome, startExpedition } from '../src/expedition'
import { lairBaseRewardIsk } from '../src/lairs'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()

/** 造局：满声望、全星系已探索、舰船就位；返回出征后的状态 */
function world(cardId: string, c: SimContext = ctx, lairTier?: 1 | 2 | 3): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  const uid = addShipToFleet(state, 'sh-mako')
  state.shipId = uid
  state.standings[DSI_FACTION_ID] = 30
  for (const g of c.galaxies.keys()) if (!state.exploredGalaxies.includes(g)) state.exploredGalaxies.push(g)
  const r = startExpedition(state, cardId, c, lairTier ? { lairTier } : undefined)
  expect(r.ok, r.error ?? '').toBe(true)
  return state
}

/** 打赢并结算；返回钱包净增（战利品/声望不进钱包，故净增 = 奖金） */
function fightAndSettle(state: GameState, c: SimContext = ctx): number {
  const before = state.wallet.isk
  state.expedition.battle!.ended = 'me'
  resolveBattleOutcome(state, c)
  return state.wallet.isk - before
}

describe('悬赏奖金口径：展示 = 到账（2026-09-10 船长）', () => {
  it('奖金浮动已取消：rewardJitter = 0（展示值即到账值）', () => {
    expect(ctx.balance.rewardJitter).toBe(0)
  })

  it('常驻悬赏胜利：到账 = 卡片口径（rewardIsk × 赏金猎手学系数），允许 ×1.1 情报彩蛋', () => {
    const state = world('ano-pirate-post')
    state.skills.trained['bounty-hunting'] = 5 // 满级 → 系数 1.4
    const factor = bountyRewardFactor(state)
    expect(factor).toBeCloseTo(1.4, 6)
    const anomaly = ctx.anomalies.get('ano-pirate-post')!
    const shown = Math.round(anomaly.rewardIsk * factor) // 卡片展示公式
    const delta = fightAndSettle(state)
    const egg = Math.round(shown * 0.1) // 情报彩蛋：+10%
    expect([shown, shown + egg]).toContain(delta)
  })

  it('赏金任务（窝点）胜利：到账基准 = 窝点基础奖金 × 技能系数（卡片同口径）', () => {
    const state = world('ano-pirate-post', ctx, 1)
    state.skills.trained['bounty-hunting'] = 5
    const factor = bountyRewardFactor(state)
    const anomaly = ctx.anomalies.get('ano-pirate-post')!
    const shown = Math.round(lairBaseRewardIsk(anomaly, 1) * factor)
    const delta = fightAndSettle(state)
    const egg = Math.round(shown * 0.1)
    // 另有赏金任务酬金入账（板上任务存在时），故到账 ≥ 窝点奖金（允许彩蛋）
    expect(delta).toBeGreaterThanOrEqual(shown)
    expect(delta).toBeGreaterThanOrEqual(shown + egg)
  })

  it('无技能时系数 = 1：到账严格等于卡面基础奖金（或 +10% 彩蛋）', () => {
    const state = world('ano-pirate-post')
    expect(bountyRewardFactor(state)).toBe(1)
    const anomaly = ctx.anomalies.get('ano-pirate-post')!
    const shown = anomaly.rewardIsk
    const delta = fightAndSettle(state)
    expect([shown, shown + Math.round(shown * 0.1)]).toContain(delta)
  })
})
