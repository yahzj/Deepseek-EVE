import type { GameState } from '../state'
import type { SimContext } from '../types'

export const ANCIENT_STATION_GALAXY_ID = 'galaxy-vault'
export const ANCIENT_STATION_ID = 'ancient-hibernation-station'

export function ancientStationDiscovered(state: GameState, ctx: SimContext): boolean {
  if (state.playerStation?.discovered) return true
  if (ctx.galaxies.size === 0) return false
  const explored = new Set(state.exploredGalaxies)
  for (const galaxyId of ctx.galaxies.keys()) {
    if (!explored.has(galaxyId)) return false
  }
  return true
}

export function reconcileAncientStationDiscovery(state: GameState, ctx: SimContext): void {
  if (state.playerStation && ancientStationDiscovered(state, ctx)) {
    state.playerStation.discovered = true
  }
}
