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
import { WEEKEND_MIN_STANDING, weekendStandingGainOf } from '../packages/core/src/weekendEvent'
import { PLUG_BLUEPRINT_COST, UNIVERSAL_BLACKBOX_COST } from '../packages/core/src/plugs'

const ctx = buildSimContext()
const now = new Date(2026, 9, 30, 12).getTime()
const galaxyLevels = new Map<string, number>()
let fullMapDailyMean = 0
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
  const mean = gains.reduce((sum, value) => sum + value, 0) / gains.length
  if (maxLevel === 3) fullMapDailyMean = mean
  console.log(JSON.stringify({ exploredThroughLevel: maxLevel, exploredGalaxies: explored.length, boards: gains.length,
    allTiersBoards: completeBoards, tierCounts: tiers,
    dailyStanding: { min: Math.min(...gains), mean, max: Math.max(...gains) },
    assumption: '当板全部完成，仅每日任务声望，不含首胜/入侵，不估算战斗耗时',
  }))
}
const firstWins = [...ctx.anomalies.values()].filter(card => !card.hidden && card.rewardIsk > 0)
const firstWinStanding = firstWins.reduce((sum, card) => sum + card.standingGain, 0)
const gap = Math.max(0, WEEKEND_MIN_STANDING - firstWinStanding)
const weekly = 7 * fullMapDailyMean + weekendStandingGainOf({}, 1)
console.log(JSON.stringify({ firstWinCards: firstWins.length, firstWinStanding,
  invasionCumulativeThreshold: WEEKEND_MIN_STANDING, remainingAfterAllFirstWins: gap,
  fullMapDailyMean, dailyFullClearsForGap: gap / fullMapDailyMean,
  weeklyStandingWithOneFullContributionInvasion: weekly,
  blueprintDaysAtThatRate: PLUG_BLUEPRINT_COST / weekly * 7,
  universalBlackboxDaysAtThatRate: UNIVERSAL_BLACKBOX_COST / weekly * 7,
  beaconStanding: weekendStandingGainOf({ beaconLit: true }, 0),
  assumption: '从零声望起；全部常驻首胜后每日任务全清；兑换周期额外假设每周一场满贡献自然入侵；不代表实际解锁时间、胜率或可完成场数',
}))
