import { describe, expect, it } from 'vitest'
import { bountyTaskStandingGain, rollBountyBoard } from '../src/expedition/bountyBoard'
import { lairLevelOf, type LairTier } from '../src/lairs'
import { advanceSideTasks, settleBountyTaskVictory } from '../src/sideTasks'
import { createInitialState, type SideTask } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { noteStandingEarned, standingOf, spendableStandingOf } from '../src/standing'
import { resolveBattleOutcome, startExpedition, retreatBattle } from '../src/expedition'
import { anomaly, galaxy, makeTestCtx } from './helpers'

const NOW = new Date(2026, 9, 30, 12).getTime()
function world(levels: number[], midCount = 2, seed = 1) {
  const galaxies = levels.map((_, i) => galaxy(i === 0 ? 'galaxy-hub' : `g-${i}`, `测试${i}`, { security: i < midCount ? 0.2 : -0.5 }))
  const cards = galaxies.map((g, i) => anomaly(`a-${i}`, g.id, {
    lairCore: '测试', foeFamily: 'A', lairLevel: levels[i] as LairTier, reward: 1000,
  }))
  const ctx = makeTestCtx({ quietEvents: true, galaxies, anomalies: cards })
  const state = createInitialState({ nowWallMs: 0, seed })
  state.exploredGalaxies = galaxies.map(g => g.id)
  return { state, ctx, cards }
}
function task(tier: LairTier): SideTask {
  return { id: 1, kind: 'bounty', goodKey: '', refId: '', need: 0, rewardIsk: 100,
    anomalyId: 'a-0', galaxyId: 'galaxy-hub', lairTier: tier, lairName: '测试窝点' }
}

describe('每日赏金三档保底', () => {
  it('穷举地图等级组合，与独立三席可行性判定一致', () => {
    for (let code = 0; code < 729; code++) {
      let cursor = code
      const levels = Array.from({ length: 6 }, () => { const level = cursor % 3 + 1; cursor = Math.floor(cursor / 3); return level })
      const { state, ctx } = world(levels, 3, code + 1)
      let feasible = false
      for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
        if (a === b || a === c || b === c || levels[b]! < 2 || levels[c]! < 3) continue
        if ([a, b, c].filter(i => i < 3).length <= 2) feasible = true
      }
      const picks = rollBountyBoard(state, ctx, null)
      expect(new Set(picks.map(p => p.tier)).size === 3, `地图${levels}`).toBe(feasible)
    }
  })
  it('跨种子保底三档，分区不超额、星系不重复、档位合法', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { state, ctx } = world([1, 3, 1, 1, 2, 3, 1], 3, seed)
      const picks = rollBountyBoard(state, ctx, null)
      expect(picks).toHaveLength(5)
      expect(new Set(picks.map(p => p.tier))).toEqual(new Set([1, 2, 3]))
      expect(new Set(picks.map(p => p.card.galaxyId)).size).toBe(5)
      expect(picks.filter(p => ctx.galaxies.get(p.card.galaxyId)!.security! > 0)).toHaveLength(2)
      for (const p of picks) expect(p.tier).toBeLessThanOrEqual(lairLevelOf(p.card))
    }
  })
  it('仅一张三级图且同星系还有一级卡：保底不能被代表卡抽签丢掉', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { state, ctx, cards } = world([3, 2, 1, 1, 1], 2, seed)
      const low = { ...cards[0]!, id: 'same-low', lairLevel: 1 as const }
      const changed = { ...ctx, anomalies: new Map([...ctx.anomalies, [low.id, low]]) }
      const picks = rollBountyBoard(state, changed, null)
      expect(picks.find(p => p.tier === 3)?.card.id).toBe('a-0')
    }
  })
  it('候选不足只发实际席位，优先覆盖低档，不跨区补位或越地图上限', () => {
    const two = world([3, 3], 2)
    expect(rollBountyBoard(two.state, two.ctx, null).map(p => p.tier).sort()).toEqual([1, 2])
    const low = world([1, 1, 1, 1, 1, 1], 6)
    const picks = rollBountyBoard(low.state, low.ctx, null)
    expect(picks).toHaveLength(2)
    expect(picks.every(p => p.tier === 1)).toBe(true)
  })
  it('不从未探索/高安/B族/派系活跃星系强补保底', () => {
    const { state, ctx } = world([1, 1, 3, 3, 3, 3], 2)
    state.exploredGalaxies = state.exploredGalaxies.filter(id => id !== 'g-2')
    const changed = { ...ctx,
      galaxies: new Map([...ctx.galaxies].map(([id, g]) => [id, id === 'g-3' ? { ...g, security: 0.9 } : g])),
      anomalies: new Map([...ctx.anomalies].map(([id, a]) => [id, id === 'a-4' ? { ...a, foeFamily: 'B' as const } : a])),
    }
    const picks = rollBountyBoard(state, changed, 'g-5')
    expect(picks).toHaveLength(2)
    expect(picks.every(p => p.tier === 1)).toBe(true)
  })
  it('同一状态确定性相同，当天旧板不重刷，跨日新板保底', () => {
    const a = world([3, 3, 3, 3, 3, 3, 3])
    const b = world([3, 3, 3, 3, 3, 3, 3])
    expect(rollBountyBoard(a.state, a.ctx, null)).toEqual(rollBountyBoard(b.state, b.ctx, null))
    expect(a.state.rng).toEqual(b.state.rng)
    a.state.sideTasks.bounty = [task(1)]
    a.state.sideTasks.bountyWindow = new Date(2026, 9, 30).getTime()
    advanceSideTasks(a.state, a.ctx, NOW)
    expect(a.state.sideTasks.bounty).toEqual([task(1)])
    advanceSideTasks(a.state, a.ctx, NOW + 86400000)
    expect(new Set(a.state.sideTasks.bounty.map(t => t.lairTier))).toEqual(new Set([1, 2, 3]))
  })
})

describe('每日赏金声望', () => {
  it.each([1, 2, 3] as const)('%i档奖励同时进入双账，重复结算和读档不重发', tier => {
    const { state, ctx } = world([3])
    noteStandingEarned(state, 'dsi', 10)
    state.standings.dsi = 4
    state.sideTasks.bounty = [task(tier)]
    expect(bountyTaskStandingGain(tier)).toBe(tier - 1)
    settleBountyTaskVictory(state, ctx, 'a-0', tier)
    const back = loadSaveFile(serializeSaveFile(state, NOW)).state
    settleBountyTaskVictory(back, ctx, 'a-0', tier)
    expect(standingOf(back, 'dsi')).toBe(10 + tier - 1)
    expect(spendableStandingOf(back, 'dsi')).toBe(4 + tier - 1)
    expect(back.sideTasks.bounty).toHaveLength(0)
  })
  it('首胜声望与每日任务奖励叠加，已首胜仍可领取新日任务奖励', () => {
    for (const first of [true, false]) {
      const { state, ctx, cards } = world([3])
      state.sideTasks.bounty = [task(3)]
      if (!first) state.completedBounties.push('a-0')
      const before = standingOf(state, 'dsi')
      expect(startExpedition(state, 'a-0', ctx, { lairTier: 3 }).ok).toBe(true)
      state.expedition.battle!.ended = 'me'
      resolveBattleOutcome(state, ctx)
      expect(standingOf(state, 'dsi') - before).toBe(2 + (first ? cards[0]!.standingGain : 0))
      expect(state.logs.some(row => row.text.includes(`协会声望 +${2 + (first ? cards[0]!.standingGain : 0)}`))).toBe(true)
    }
  })
  it('战败不发，任务过期或普通悬赏不发每日奖励', () => {
    const { state, ctx } = world([3])
    state.sideTasks.bounty = [task(3)]
    expect(startExpedition(state, 'a-0', ctx, { lairTier: 3 }).ok).toBe(true)
    const before = standingOf(state, 'dsi')
    state.expedition.battle!.ended = 'foe'
    resolveBattleOutcome(state, ctx)
    expect(standingOf(state, 'dsi')).toBe(before)
    expect(state.sideTasks.bounty).toHaveLength(1)
    state.sideTasks.bounty = []
    settleBountyTaskVictory(state, ctx, 'a-0', 3)
    expect(standingOf(state, 'dsi')).toBe(before)
  })
  it('完成低档窝点不能领取当前同目标高档任务的声望或酬金', () => {
    const { state, ctx } = world([3])
    state.sideTasks.bounty = [task(3)]
    const before = state.wallet.isk
    settleBountyTaskVictory(state, ctx, 'a-0', 1, 1)
    expect(state.wallet.isk).toBe(before)
    expect(standingOf(state, 'dsi')).toBe(0)
    expect(state.sideTasks.bounty).toHaveLength(1)
  })
  it('主动撤退保留任务，声望不变', () => {
    const { state, ctx } = world([3])
    state.sideTasks.bounty = [task(3)]
    expect(startExpedition(state, 'a-0', ctx, { lairTier: 3 }).ok).toBe(true)
    expect(retreatBattle(state, ctx).ok).toBe(true)
    expect(standingOf(state, 'dsi')).toBe(0)
    expect(state.sideTasks.bounty).toHaveLength(1)
  })
})
