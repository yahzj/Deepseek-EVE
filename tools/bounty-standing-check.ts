/** 每日赏金声望读数：真实地图、确定种子、只在内存生成任务板，假设当板全部完成。
 * npx tsx tools/bounty-standing-check.ts；不推进战斗，不把满清收入当成实战可达性结论。
 */
import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { advanceSideTasks, settleBountyTaskVictory } from '../packages/core/src/sideTasks'
import { bountyTaskStandingGain } from '../packages/core/src/bountyBoard'
import { isLairCandidate, lairLevelOf } from '../packages/core/src/lairs'
import { standingOf } from '../packages/core/src/standing'

const ctx = buildSimContext()
const now = new Date(2026, 9, 30, 12).getTime()
const galaxyLevels = new Map<string, number>()
for (const card of ctx.anomalies.values()) {
  if (isLairCandidate(card)) galaxyLevels.set(card.galaxyId, Math.max(galaxyLevels.get(card.galaxyId) ?? 0, lairLevelOf(card)))
}
for (const maxLevel of [1, 2, 3] as const) {
  const explored = [...galaxyLevels].filter(([, level]) => level <= maxLevel).map(([id]) => id)
  const gains: number[] = []
  let completeBoards = 0
  const tiers = [0, 0, 0]
  for (let seed = 1; seed <= 200; seed++) {
    const state = createInitialState({ nowWallMs: 0, seed })
    state.exploredGalaxies = explored
    advanceSideTasks(state, ctx, now)
    const board = [...state.sideTasks.bounty]
    if (new Set(board.map(task => task.lairTier)).size === 3) completeBoards++
    const expected = board.reduce((sum, task) => sum + bountyTaskStandingGain(task.lairTier ?? 1), 0)
    for (const task of board) {
      tiers[(task.lairTier ?? 1) - 1]!++
      settleBountyTaskVictory(state, ctx, task.anomalyId!, 0, task.lairTier)
    }
    assert.equal(standingOf(state, 'dsi'), expected)
    gains.push(expected)
  }
  console.log(JSON.stringify({ exploredThroughLevel: maxLevel, exploredGalaxies: explored.length, boards: gains.length,
    allTiersBoards: completeBoards, tierCounts: tiers,
    dailyStanding: { min: Math.min(...gains), mean: gains.reduce((sum, value) => sum + value, 0) / gains.length, max: Math.max(...gains) },
    assumption: '当板全部完成，仅每日任务声望，不含首胜/入侵，不估算战斗耗时',
  }))
}
