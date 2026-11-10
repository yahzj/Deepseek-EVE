import type { GameState } from '../../state'
import type { CoreBlockReason } from '../../engine'
import { busyLabel } from '../../busyLabels'

/** 只认出发时的实体名单；旧档没有快照时不从基地临时召来僚舰。 */
export function deployedCombatEscorts(state: GameState): readonly string[] {
  const sortie = state.combatEscort
  if (!sortie) return []
  const traveling = !!state.shipReturns[sortie.leaderShipId]
  const withPilot = sortie.leaderShipId === state.shipId && (state.awayGalaxy !== null || state.mining.active || state.salvaging.active || state.hauling.active || state.transit.active || state.standby.active || state.sideTasks.deliver !== null)
  return traveling || withPilot ? sortie.shipIds : []
}

/** 遭遇预警与开战读取同一份实际随行名单。 */
export function encounterCombatRosterOf(state: GameState): string[] {
  const leader = state.encounter.shipId ?? state.shipId
  const escorts = deployedCombatEscorts(state)
  return leader === state.shipId && escorts.includes(leader) ? [...escorts] : [leader]
}

/** 只读快照，状态与实体操作门禁共用，不依赖战斗执行模块。 */
export function commandShipDeployed(state: GameState, shipId: string): boolean {
  if (state.shipReturns[shipId]?.reason === 'expedition') return true
  if ((state.expedition.active || !!state.shipReturns[state.expedition.sortie?.leaderShipId ?? '']) && state.expedition.sortie?.shipIds.includes(shipId)) return true
  if (state.encounter.active && state.encounter.battle?.myFleet?.some(row => row.shipId === shipId)) return true
  return shipId !== state.shipId && deployedCombatEscorts(state).includes(shipId)
}

/** 随行舰必须在出发前已空闲；活动切换可以沿用原随行舰，但不能征用其他出勤。 */
export function combatEscortBlock(state: GameState, shipIds: readonly string[]): CoreBlockReason | null {
  for (const id of shipIds) {
    if (id === state.shipId) continue
    if (!state.fleet[id]) return { error: '编队包含重复或不存在的舰船。', errorId: 'core.command.002' }
    if (state.aiAssignments[id]) return busyLabel('aiExpedition')
    if (state.shipReturns[id]) return busyLabel('unload')
    if (deployedCombatEscorts(state).includes(id) && state.combatEscort?.leaderShipId !== state.shipId) return busyLabel('unload')
    if ((state.wormhole.run?.fleet ?? []).includes(id) || (state.wormholeAuto ?? []).some(run => run.shipIds.includes(id))) return busyLabel('wormhole')
    if ((state.planetary?.deliveries ?? []).some(row => row.shipUid === id)) return busyLabel('planetDelivery')
    if ((state.expedition.active || !!state.shipReturns[state.expedition.sortie?.leaderShipId ?? '']) && state.expedition.sortie?.shipIds.includes(id)) return busyLabel('expedition')
    if (state.encounter.active && state.encounter.battle?.myFleet?.some(row => row.shipId === id)) return busyLabel('expCombat')
  }
  return null
}
