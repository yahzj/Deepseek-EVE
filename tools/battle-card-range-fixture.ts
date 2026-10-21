import type { GameState } from '../packages/core/src/state'
import { buildSimContext } from '../packages/data/src/index'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { setBattleDesire, startExpedition } from '../packages/core/src/expedition'
import { noteStandingEarned } from '../packages/core/src/standing'

/** 独立合成：已记录短射程，换装后停在开战前，不读取个人档。 */
export function injectBattleCardRangeFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  state.modeChosen = true
  state.onboarding.step = 99
  state.debugQuick = false
  state.wallet.isk = 100000000
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const card of ctx.anomalies.values()) {
    if (card.hidden || card.standingGain <= 0) continue
    state.completedBounties.push(card.id)
    noteStandingEarned(state, 'dsi', card.standingGain)
  }
  for (const task of Object.values(state.importantTasks)) if (task) task.done = true
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-laser-1'], mid: [], low: [] }
  state.warehouse.items['ammo-plasma-l'] = 100000
  const first = startExpedition(state, 'ink-harass', ctx)
  if (!first.ok) throw new Error(`合成入场失败：${JSON.stringify(first)}`)
  if (!setBattleDesire(state, 2500, ctx).ok) throw new Error('合成距离记录失败')
  state.expedition.active = false
  state.expedition.battle = null
  state.expedition.anomalyId = null
  state.expedition.phase = 'out'
  state.bountyCooldowns = {}
  state.fleet[uid]!.fitted.high = ['mod-laser-2']
  const next = startExpedition(state, 'ink-harass', ctx)
  if (!next.rangeConfirmation || !state.pendingBattleRange) throw new Error('未生成战前射程确认')
  return ['独立合成档：短射程记录已建立，换装后等待射程确认。', '取消不进入战斗；重新导入后修改期望距离并确认迎战，检查装配与距离记录。']
}
