import { ceilFinalQuantity } from './quantity'
import type { GameState } from './state'
import type { SimContext } from './types'
import { hullLayerCaps } from './shipyard'

export const HULL_FLOOR_FRAC = 0.05

export function foeFirepowerDps(ctx: SimContext, threat: number): number {
  return Math.max(1, threat) * ctx.balance.battle.foeDpsPerThreat
}

export function firepowerHitHp(ctx: SimContext, threat: number, seconds: number): number {
  return Math.max(1, ceilFinalQuantity(foeFirepowerDps(ctx, threat) * seconds))
}

export interface HullHit {
  armorTo: number
  hullTo: number
  armorLost: number
  hullLost: number
  floored: boolean
}

export function applyArmorFirstDamage(state: GameState, ctx: SimContext, shipId: string, hp: number): HullHit | null {
  const ship = state.fleet[shipId]
  if (!ship) return null
  const caps = hullLayerCaps(state, ctx, shipId)
  const capA = caps && caps.capA > 0 ? caps.capA : 0
  const capH = caps && caps.capH > 0 ? caps.capH : 1
  const round = (v: number): number => Math.round(v * 1000) / 1000
  const armorHp = Math.max(0, ship.armorPct ?? 1) * capA
  const hullHp = Math.max(0, ship.durability) * capH
  const eatA = Math.min(armorHp, hp)
  const rest = Math.max(0, hp - eatA)
  const armorAfter = armorHp - eatA
  const floorHp = capH * HULL_FLOOR_FRAC
  const hullAfter = Math.max(floorHp, hullHp - rest)
  const hit: HullHit = {
    armorTo: capA > 0 ? round(armorAfter / capA) : 0,
    hullTo: round(hullAfter / capH),
    armorLost: capA > 0 ? round((armorHp - armorAfter) / capA) : 0,
    hullLost: round((hullHp - hullAfter) / capH),
    floored: rest > 0 && hullAfter <= floorHp + 1e-9,
  }
  ship.armorPct = hit.armorTo
  ship.durability = hit.hullTo
  return hit
}

export function pctOf(v: number): number {
  return Math.round(v * 100)
}

export function hitDamageText(hit: HullHit): string {
  const hullPart = hit.hullLost > 0 ? `、结构 -${pctOf(hit.hullLost)}%` : ''
  return `装甲 -${pctOf(hit.armorLost)}%${hullPart}（现 装甲 ${pctOf(hit.armorTo)}% / 结构 ${pctOf(hit.hullTo)}%）`
}
