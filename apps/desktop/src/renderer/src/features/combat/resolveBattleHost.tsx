
import { battleArcsFor, expeditionStatus, weekendFlagshipBattleViewOf, wormholeBattleViewOf } from '@whale/core'

import type { GameEngine } from '../../game/engine'

export function resolveBattleHost({ state, engine, tr }: {
state: import('@whale/core').GameState
engine: Pick<GameEngine, "state" | "ctx" | "wormholeSpeedActive" | "wormholeSpeedOptions" | "setWormholeSpeed" | "battleSetDesireAt" | "retreatNow">
tr: (id: string, params?: Record<string, string | number>) => string
}) {
  const whView = wormholeBattleViewOf(state, engine.ctx)
  const wkView = weekendFlagshipBattleViewOf(state, engine.ctx)
  const host = whView ?? wkView
  const view = expeditionStatus(state, engine.ctx)
  const combatView = view.combat ?? host?.combat ?? null
  const whBattle = state.wormhole.run?.battle
  const sceneName = whBattle?.wormhole ? tr(state.wormhole.run?.expeditionRules === 2 ? 'ui.explorationName.015' : 'ui.explorationName.014', { p1: tr(whBattle.wormhole.kind === 'boss' ? 'ui.explorationName.016' : whBattle.wormhole.kind === 'ruins' ? 'ui.explorationName.017' : 'ui.explorationName.005', { p1: whBattle.wormhole.depth }) }) : view.combat ? view.anomalyName : (host?.name ?? '')
  const inWormhole = !!whView && !!combatView
  const speedOptions = inWormhole ? engine.wormholeSpeedOptions() : []
  const speedActive = engine.wormholeSpeedActive()
  const arcs = battleArcsFor(
    state,
    engine.ctx,
    host ? { battle: host.battle, anomaly: host.anomaly, leaderShipId: host.leaderShipId } : null,
  )
  const battle = whView ? whView.battle : wkView ? wkView.battle : state.expedition.battle
return { combatView, inWormhole, arcs, battle, sceneName, speedOptions, speedActive }
}
