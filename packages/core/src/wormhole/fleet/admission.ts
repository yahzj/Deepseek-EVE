import type { ShipDef, SimContext } from '../../types'
import { ceilFinalQuantity } from '../../quantity'
import { uidDefId } from '../../labels'
import { combatShipLimit } from '../../combat/command/rules'


export const WORMHOLE_MASS_BY_TIER: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 500,
  2: 1_500,
  3: 3_500,
  4: 7_000,
  5: 0,
}

export const WORMHOLE_MAX_TIER = 4

export const WORMHOLE_TOTAL_MASS_CAP = 16_000

export const WORMHOLE_MAX_SHIPS = combatShipLimit(true)

export function wormholeShipAllowed(ship: ShipDef): boolean {
  return ship.tier <= WORMHOLE_MAX_TIER
}

export function wormholeShipMass(ship: ShipDef): number {
  return WORMHOLE_MASS_BY_TIER[ship.tier as 1 | 2 | 3 | 4 | 5] ?? 0
}


export const WORMHOLE_TURN_BASE = 80
export const WORMHOLE_TURN_MASS_COEF = 0.53

export function wormholeTurnBudget(totalMass: number, techTurnBonus = 0): number {
  const ratio = Math.max(0, Math.min(1, totalMass / WORMHOLE_TOTAL_MASS_CAP))
  return ceilFinalQuantity(WORMHOLE_TURN_BASE * (1 - ratio * WORMHOLE_TURN_MASS_COEF) + Math.max(0, techTurnBonus))
}

export const WORMHOLE_TURN_PER_NODE = 1
export const WORMHOLE_TURN_PER_EXTRA_WAVE = 1
export const WORMHOLE_TURN_PER_PICKUP = 1

export function wormholeStepCost(waves: number, pickups: number): number {
  const extraWaves = Math.max(0, Math.floor(waves) - 1)
  return (
    WORMHOLE_TURN_PER_NODE +
    extraWaves * WORMHOLE_TURN_PER_EXTRA_WAVE +
    Math.max(0, Math.floor(pickups)) * WORMHOLE_TURN_PER_PICKUP
  )
}


export type WormholeAdmissionCode =
  | 'ok'
  | 'too-many-ships'
  | 'tier-too-high'
  | 'no-ship'
  | 'mass-over-cap'
  | 'unknown-ship'

export interface WormholeAdmission {
  ok: boolean
  code: WormholeAdmissionCode
  totalMass: number
  massRatio: number
  turnBudget: number
}

export const WORMHOLE_ADMISSION_TEXT: Record<WormholeAdmissionCode, string> = {
  ok: '',
  'too-many-ships': `最多只能带 ${WORMHOLE_MAX_SHIPS} 艘船`,
  'tier-too-high': `泰坦过重，会压塌虫洞入口（最多带到 T${WORMHOLE_MAX_TIER} 战列舰）`,
  'no-ship': '至少要带一艘船',
  'mass-over-cap': `编队总质量超过 ${WORMHOLE_TOTAL_MASS_CAP.toLocaleString('zh-CN')}，无法跃入`,
  'unknown-ship': '编队里有无法识别的船型',
}

export function wormholeAdmission(
  ctx: SimContext,
  shipIds: readonly string[],
  techTurnBonus = 0,
): WormholeAdmission {
  const none = (code: WormholeAdmissionCode, totalMass = 0): WormholeAdmission => ({
    ok: false,
    code,
    totalMass,
    massRatio: totalMass / WORMHOLE_TOTAL_MASS_CAP,
    turnBudget: wormholeTurnBudget(totalMass, techTurnBonus),
  })
  if (shipIds.length === 0) return none('no-ship')
  if (shipIds.length > WORMHOLE_MAX_SHIPS) return none('too-many-ships')
  const ships: ShipDef[] = []
  for (const id of shipIds) {
    const ship = ctx.ships.get(uidDefId(id))
    if (!ship) return none('unknown-ship')
    ships.push(ship)
  }
  if (ships.some((s) => !wormholeShipAllowed(s))) return none('tier-too-high')
  const totalMass = ships.reduce((sum, s) => sum + wormholeShipMass(s), 0)
  if (totalMass > WORMHOLE_TOTAL_MASS_CAP) return none('mass-over-cap', totalMass)
  return {
    ok: true,
    code: 'ok',
    totalMass,
    massRatio: totalMass / WORMHOLE_TOTAL_MASS_CAP,
    turnBudget: wormholeTurnBudget(totalMass, techTurnBonus),
  }
}
