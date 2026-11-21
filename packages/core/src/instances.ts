import type { GameState } from './state'
import type { ShipDef, SimContext } from './types'
import { uidDefId, uidSeqNum } from './labels'
import { LEGACY_HAULER_STATS } from './shipFitting'

export function fleetDefOf(state: GameState, ctx: SimContext, uid: string): ShipDef | undefined {
  const entry = state.fleet[uid]
  if (!entry) return undefined
  const defId = entry.defId ?? uidDefId(uid)
  const def = ctx.ships.get(defId)
  const legacy = LEGACY_HAULER_STATS[defId]
  if (!def || !legacy) return def
  const run = state.wormhole?.run
  const legacyAuto = (state.wormholeAuto ?? []).some((r) => r.haulerFittingVersion !== 1 && r.shipIds.includes(uid))
  if (def && legacy && ((run && run.haulerFittingVersion !== 1 && run.fleet.includes(uid)) || legacyAuto)) {
    return { ...def, ...legacy, civilianFittingOnly: false }
  }
  return def
}

export function shipDisplayName(state: GameState, ctx: SimContext, uid: string): string {
  const entry = state.fleet[uid]
  if (!entry) return uid
  if (entry.customName) return entry.customName
  const defId = entry.defId ?? uidDefId(uid)
  const defName = ctx.ships.get(defId)?.name ?? defId
  const n = uidSeqNum(uid)
  return n > 1 ? `${defName} #${n}` : defName
}
