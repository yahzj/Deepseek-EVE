import type { AnomalyDef, FoeSupportBranch } from '../../types'
import { resolveFoeMounts } from '../../foeMounts'

export const WORMHOLE_THREAT_BASE = 45

export const WORMHOLE_DISPLAY_THREAT_MUL = 2

export function wormholeDisplayThreat(threat: number): number {
  return Math.round(threat * WORMHOLE_DISPLAY_THREAT_MUL)
}

export const WORMHOLE_THREAT_GROWTH = 0.12

export const WORMHOLE_REWARD_GROWTH = 0.08

export const WORMHOLE_THREAT_PER_LAYER = Math.round(WORMHOLE_THREAT_BASE * WORMHOLE_THREAT_GROWTH)

export function wormholeLayerThreat(depth: number): number {
  const d = Math.max(1, Math.floor(depth))
  return Math.round(WORMHOLE_THREAT_BASE * Math.pow(1 + WORMHOLE_THREAT_GROWTH, d - 1))
}

export function wormholeLayerRewardMul(depth: number, expeditionRules?: number): number {
  const d = Math.max(1, Math.floor(depth))
  if (expeditionRules === 2) return 1 + 0.08 * (d - 1)
  return Math.pow(1 + WORMHOLE_REWARD_GROWTH, d - 1)
}

export function signalSpaceResourcePileBonus(depth: number, expeditionRules?: number): number {
  return expeditionRules === undefined ? Math.max(0, Math.floor(depth) - 1) : 0
}

export function wormholeNodesPerLayer(depth: number): number {
  return Math.max(1, Math.floor(depth)) <= 2 ? 2 : 3
}

export type WormholeFoeKind = 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'

export const WORMHOLE_BOSS_THREAT_MUL = 1.2

export const WORMHOLE_EXTRACT_THREAT_MUL = 0.8

export const WORMHOLE_EXTRACT_THREAT_BASE = Math.round(
  WORMHOLE_THREAT_BASE * (1 + WORMHOLE_THREAT_GROWTH) * WORMHOLE_EXTRACT_THREAT_MUL,
)

export const WORMHOLE_EXTRACT_THREAT_PER_LAYER = WORMHOLE_THREAT_PER_LAYER

export function wormholeExtractThreat(depth: number): number {
  const d = Math.max(2, Math.floor(depth))
  return WORMHOLE_EXTRACT_THREAT_BASE + WORMHOLE_EXTRACT_THREAT_PER_LAYER * (d - 2)
}

export const WORMHOLE_RUINS_THREAT_MUL = 1.3

export const FOE_DESIGN_STRENGTH_MUL = { solo: 3, squad: 10 } as const

export const WORMHOLE_FOE_BASE_STRENGTH_MUL = FOE_DESIGN_STRENGTH_MUL.squad

export const WORMHOLE_THREAT_REF_RATIO = 25

export function wormholeNaturalHp(base: AnomalyDef): number {
  const skip = wormholeSkippedBranch(base)
  return (base.ships ?? [])
    .filter((s) => skip === null || s.enterBranch === undefined || s.enterBranch !== skip)
    .reduce(
      (n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
      0,
    )
}

export function wormholeBranchNaturalHp(base: AnomalyDef, branch: FoeSupportBranch): number {
  return (base.ships ?? [])
    .filter((s) => s.enterBranch === branch)
    .reduce(
      (n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
      0,
    )
}

export function wormholeSkippedBranch(base: AnomalyDef): FoeSupportBranch | null {
  const ships = base.ships ?? []
  const hasIn = ships.some((s) => s.enterBranch === 'inside')
  const hasOut = ships.some((s) => s.enterBranch === 'outside')
  if (!hasIn || !hasOut) return null
  return wormholeBranchNaturalHp(base, 'inside') >= wormholeBranchNaturalHp(base, 'outside')
    ? 'outside'
    : 'inside'
}

export function wormholeFoeThreat(depth: number, kind: WormholeFoeKind): number {
  const base = wormholeLayerThreat(depth)
  if (kind === 'boss') return Math.round(base * WORMHOLE_BOSS_THREAT_MUL)
  if (kind === 'extract') return wormholeExtractThreat(depth)
  if (kind === 'ruins') return Math.round(base * WORMHOLE_RUINS_THREAT_MUL)
  return base
}

export function wormholeCardThreatMul(base: AnomalyDef): number {
  let mul = 1
  for (const s of base.ships ?? []) {
    const sc = resolveFoeMounts(s.mounts ?? s.ship.mounts).foeSupportCall
    if (sc !== undefined && sc.threatMul > mul) mul = sc.threatMul
  }
  return mul
}

export function wormholeCardThreatOf(
  base: AnomalyDef,
  depth: number,
  kind: WormholeFoeKind,
): number {
  return Math.round(wormholeFoeThreat(depth, kind) * wormholeCardThreatMul(base))
}
