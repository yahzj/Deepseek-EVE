import type { GameState } from '../../state'
import type { ShipDef, SimContext } from '../../types'
import { standingOf, DSI_FACTION_ID } from '../../standing'
import { fleetDefOf } from '../../instances'
import config from './config.json'

export const COMMAND_SKILLS = config.skills
export const COMBAT_MAX_SHIPS = config.maxShips
export const LEGACY_SPECIAL_MAX_SHIPS = config.legacyMaxShips
export const COMMAND_STANDING_REQUIRED = config.standingRequired
export function legacySpecialSquads(): boolean { return !config.enabled || config.legacySpecialFourShips }
export function combatShipLimit(special = false): number { return special && legacySpecialSquads() ? LEGACY_SPECIAL_MAX_SHIPS : COMBAT_MAX_SHIPS }
export function commandCapacityOf(state: GameState): number {
  return config.baseCapacity + COMMAND_SKILLS.reduce((sum, skill) => {
    const raw = state.skills.trained[skill.id]
    const level = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.floor(raw))) : 0
    return sum + skill.perLevel * level
  }, 0)
}
export function shipCommandCostOf(def: ShipDef | undefined): number {
  const value = def?.commandCost
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  return (config.fallbackCostByTier as Readonly<Record<number, number>>)[def?.tier ?? 0] ?? config.fallbackCostByTier[5]
}
export interface CommandBudgetView {
  ok: boolean
  cost: number
  capacity: number
  maxShips: number
  standing: number
  error?: string
  errorId?: string
  errorParams?: Record<string, number | string>
}
/** 无资源写入；各玩法预检和界面共用，同型实例逐艘计费。 */
export function commandBudgetOf(state: GameState, ctx: SimContext, shipIds: readonly string[], special = false): CommandBudgetView {
  const result: CommandBudgetView = { ok: false, cost: shipIds.reduce((sum, id) => sum + shipCommandCostOf(fleetDefOf(state, ctx, id)), 0),
    capacity: commandCapacityOf(state), maxShips: combatShipLimit(special), standing: standingOf(state, DSI_FACTION_ID) }
  const reject = (error: string, errorId: string, errorParams?: Record<string, number | string>) => ({ ...result, error, errorId, errorParams })
  if (!shipIds.length) return reject('至少选择一艘舰船。', 'core.command.001')
  if (new Set(shipIds).size !== shipIds.length || shipIds.some(id => !state.fleet[id] || !fleetDefOf(state, ctx, id))) return reject('编队包含重复或不存在的舰船。', 'core.command.002')
  if (shipIds.length > result.maxShips) return reject(`编队最多${result.maxShips}艘。`, 'core.command.003', { p1: result.maxShips })
  if (!config.enabled || special && legacySpecialSquads() || shipIds.length === 1) return { ...result, ok: true }
  if (result.standing < COMMAND_STANDING_REQUIRED) return reject(`累计协会声望达到${COMMAND_STANDING_REQUIRED}后可指挥多舰。`, 'core.command.004', { p1: COMMAND_STANDING_REQUIRED })
  if (result.cost > result.capacity) return reject(`指挥成本${result.cost}超过容量${result.capacity}。`, 'core.command.005', { p1: result.cost, p2: result.capacity })
  return { ...result, ok: true }
}
