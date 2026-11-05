import type { GameState } from './state'

/** 只依赖状态形状，供门禁、读档和引擎清理失效出发记录，避免引入航路依赖环。 */
export function reconcileDeparture(state: GameState): void {
  const leg = state.departure
  if (!leg) return
  const active = { mining: state.mining.active, salvaging: state.salvaging.active,
    expedition: state.expedition.active && state.expedition.phase === 'out', hauling: state.hauling.active,
    deliver: state.sideTasks.deliver !== null, siteDeliver: state.transit.active && state.transit.delivery?.phase === 'to-site',
    wormhole: !!state.wormhole.run, flagship: state.encounter.active && !!state.encounter.battle }[leg.kind]
  if (leg.shipId !== state.shipId || !state.fleet[leg.shipId] || !active) delete state.departure
}
