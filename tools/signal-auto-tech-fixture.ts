import type { GameState } from '../packages/core/src/state'
import { buildSimContext } from '../packages/data/src/index'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'

/** 全新合成的T3自动探索验收门槛，不读取个人档。v0.1.0 / v31 / 2026-10-22。 */
export function injectSignalAutoTechFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  state.modeChosen = true
  state.onboarding.step = 99
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const card of ctx.anomalies.values()) if (!card.hidden && card.standingGain > 0) state.completedBounties.push(card.id)
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.wallet.isk = 100_000_000
  state.warehouse.items['mat-wh-essence'] = 100
  state.research!.levels['mt-explore-signal-radius-t1'] = 1
  state.wormholeStock = Array.from({ length: 3 }, (_, i) => ({ id: `signal-tech-${i}`, seed: 19 + i, depth: 1,
    family: 'A' as const, archetype: 'balanced' as const, foundAtGameMs: 0 }))
  for (let i = 0; i < 4; i++) {
    const id = addShipToFleet(state, 'sh-thresher')
    state.fleet[id]!.fitted = { high: ['mod-miner-1', 'mod-salvager-1'], mid: [], low: [] }
  }
  return ['T3自动探索科技未研究，T1前置已满足；AI技能0级。',
    '库存3处信号空间、4艘作业副船、100谜质和1亿信用点；可依次研究60%/70%/80%。',
    '先点击灰色自动探索验证提示，再到谜质科技探索线T3研究。']
}
