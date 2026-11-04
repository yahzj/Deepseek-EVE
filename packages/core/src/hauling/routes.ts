/** 运输航线和费率单点，不依赖运输推进模块。 */
import { ceilFinalQuantity } from '../quantity'
import { HOME_GALAXY_ID, siteProgress } from '../state'
import type { GameState } from '../state'
import type { SimContext } from '../types'
import { shortestTravelPath } from '../travel'
import { securityZoneOf } from '../securityZone'

export const HAUL_RATE_PER_M3_MIN = 0.6
export const HAUL_LEG_TIME_MUL = 15
export const HAUL_TRIP_MUL_MIN = 5
export const HAUL_TRIP_MUL_MAX = 10

export function haulLegMinutesOf(nominalMinutes: number): number {
  return Math.max(1, Math.round(nominalMinutes * HAUL_LEG_TIME_MUL))
}

export function haulSecurityMulOf(ctx: SimContext, galaxyId: string): number {
  return ctx.balance.haul.securityMul[securityZoneOf(ctx, galaxyId)]
}

export function haulExposureAt(ctx: SimContext, galaxyId: string): boolean {
  return securityZoneOf(ctx, galaxyId) === '低安'
}

/** 逐跳危险档加权距离，收益指数与既有锚定费率不变。 */
export function haulEffectiveMinutes(ctx: SimContext, fromGalaxyId: string, toGalaxyId: string): number {
  const path = shortestTravelPath(ctx, fromGalaxyId, toGalaxyId)
  let sum = 0
  for (let i = 0; i + 1 < path.galaxies.length; i++) {
    sum += path.hopMinutes[i]! * Math.max(haulSecurityMulOf(ctx, path.galaxies[i]!), haulSecurityMulOf(ctx, path.galaxies[i + 1]!))
  }
  return sum
}

export function haulBaseReward(ctx: SimContext, capacityM3: number, effectiveMinutes: number): number {
  const bal = ctx.balance.haul
  if (!(effectiveMinutes > 0) || !(bal.anchorEffectiveMinutes > 0)) return 0
  const shape = Math.pow(effectiveMinutes / bal.anchorEffectiveMinutes, bal.distExp)
  return ceilFinalQuantity(capacityM3 * HAUL_RATE_PER_M3_MIN * bal.anchorNominalMinutes * shape)
}

/** 单位费率保留小数，不将1m³当成独立订单逐次向上取整。 */
export function haulUnitRewardRange(ctx: SimContext, effectiveMinutes: number): { min: number; max: number } {
  const bal = ctx.balance.haul
  if (!(effectiveMinutes > 0) || !(bal.anchorEffectiveMinutes > 0)) return { min: 0, max: 0 }
  const base = HAUL_RATE_PER_M3_MIN * bal.anchorNominalMinutes * Math.pow(effectiveMinutes / bal.anchorEffectiveMinutes, bal.distExp)
  return { min: base * HAUL_TRIP_MUL_MIN, max: base * HAUL_TRIP_MUL_MAX }
}

export function haulLegReward(ctx: SimContext, capacityM3: number, effectiveMinutes: number, tripMul: number): number {
  return ceilFinalQuantity(haulBaseReward(ctx, capacityM3, effectiveMinutes) * tripMul)
}

export function haulRewardRange(ctx: SimContext, capacityM3: number, effectiveMinutes: number): { min: number; max: number } {
  const base = haulBaseReward(ctx, capacityM3, effectiveMinutes)
  return { min: ceilFinalQuantity(base * HAUL_TRIP_MUL_MIN), max: ceilFinalQuantity(base * HAUL_TRIP_MUL_MAX) }
}

export interface HaulEndpoint { siteId: string | null; name: string; galaxyId: string }

export function haulEndpoints(state: GameState, ctx: SimContext): HaulEndpoint[] {
  const out: HaulEndpoint[] = [{ siteId: null, name: '母港', galaxyId: HOME_GALAXY_ID }]
  for (const site of ctx.stations.values()) {
    const progress = siteProgress(state, site.id)
    if (progress && progress.stage >= site.tiers.length) out.push({ siteId: site.id, name: site.name, galaxyId: site.galaxyId })
  }
  return out
}

export function haulEndpointName(ctx: SimContext, siteId: string | null): string {
  return siteId === null ? '母港' : ctx.stations.get(siteId)?.name ?? '空间站'
}

export function dockedHaulEndpoint(state: GameState): string | null {
  return state.awayGalaxy === null ? state.dockedSite : null
}

