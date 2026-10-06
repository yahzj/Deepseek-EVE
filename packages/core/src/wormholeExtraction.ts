import type { GameState } from './state'
import type { SimContext } from './types'
import { wormholeExtract, wormholePendingBattleReason } from './wormhole'
import { advanceWormhole } from './wormholeBattle'
import { holdCompact, placementInBounds } from './wormholeHold'
import { gridCellAt, hasLiveFoe } from './wormholeGrid'
import { wormholeMatterBuffs } from './wormholeMatter'
import { matterTechWhBuffs } from './matterTech'
import {
  wormholeHoldCapacityOf, wormholeHoldSyncCargo, wormholeHoldUsage,
  wormholeLeaveHoldPiece, wormholeLeaveSupply, wormholeTempStowPiece, wormholeSyncMatterTurns,
} from './wormholeSalvage'

export interface WormholeExtractionRequest {
  leavePieces: readonly string[]
  leaveSupplies: Readonly<Record<string, number>>
  takeGround: readonly string[]
}

export interface WormholeExtractionPlan {
  request: WormholeExtractionRequest
  fingerprint: string
  ok: boolean
  code?: 'unavailable' | 'battle-required' | 'invalid-selection' | 'capacity'
  capacity: number
  used: number
  supplies: Record<string, number>
  loot: Record<string, number>
  left: Record<string, number>
  matterDevices: number
}

function extractionFingerprint(state: GameState, request: WormholeExtractionRequest): string {
  const run = state.wormhole.run
  return JSON.stringify({ run, ships: run?.fleet.map((id) => [id, state.fleet[id]]), skills: state.skills.trained, research: state.research, request })
}

function extractionBlocked(state: GameState): WormholeExtractionPlan['code'] {
  const run = state.wormhole.run
  if (run?.supplyVersion !== 1 || run.phase !== 'inside' || !run.attending || !run.supplies || run.fleet.length === 0 || run.fleet.some((id) => !state.fleet[id])) return 'unavailable'
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return 'unavailable'
  const here = run.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  if (run.battle || wormholePendingBattleReason(state) || (here && hasLiveFoe(here))) return 'battle-required'
  return undefined
}

function applySelection(state: GameState, ctx: SimContext, request: WormholeExtractionRequest): boolean {
  if (new Set(request.leavePieces).size !== request.leavePieces.length || new Set(request.takeGround).size !== request.takeGround.length) return false
  for (const id of request.leavePieces) if (!wormholeLeaveHoldPiece(state, ctx, id).ok) return false
  for (const [id, n] of Object.entries(request.leaveSupplies)) if (!wormholeLeaveSupply(state, ctx, id, n).ok) return false
  const run = state.wormhole.run!
  if (run.hold) holdCompact(run.hold, wormholeHoldCapacityOf(state, ctx))
  for (const id of request.takeGround) if (!wormholeTempStowPiece(state, ctx, id).ok) return false
  wormholeSyncMatterTurns(state, ctx)
  wormholeHoldSyncCargo(state, ctx)
  if (run.hold) holdCompact(run.hold, wormholeHoldCapacityOf(state, ctx))
  return true
}

/** 所有取舍都在副本上预演；关闭确认窗无需退款或恢复货物。 */
export function wormholeExtractionPlan(state: GameState, ctx: SimContext, request: WormholeExtractionRequest): WormholeExtractionPlan {
  const code = extractionBlocked(state)
  const staged = structuredClone(state)
  const valid = code === undefined && applySelection(staged, ctx, request)
  const run = staged.wormhole.run
  const usage = wormholeHoldUsage(staged, ctx)
  const geometryFull = run?.hold?.placements.some((p) => !placementInBounds(p.x, p.y, p, wormholeHoldCapacityOf(staged, ctx), run.hold!.cols, p.fill)) ?? false
  const left: Record<string, number> = {}
  const loot: Record<string, number> = {}
  const add = (to: Record<string, number>, id: string, n: number): void => { to[id] = (to[id] ?? 0) + n }
  if (run) {
    for (const slot of run.bag) add(loot, slot.itemId, slot.units)
    for (const piece of run.hold?.placements ?? []) if (piece.kind === 'box') add(loot, piece.itemId, 1)
    for (const board of Object.values(run.groundCargo ?? {})) {
      for (const piece of board.placements) add(left, piece.itemId, piece.kind === 'box' ? 1 : piece.units ?? 0)
    }
    for (const cell of run.grid?.cells ?? []) {
      if (!run.grid!.visited.includes(cell.key)) continue
      for (const pile of cell.piles ?? []) add(left, pile.itemId, pile.units)
    }
  }
  const devices = run ? wormholeMatterBuffs(run.hold, matterTechWhBuffs(staged, ctx)).devices : 0
  return {
    request: { leavePieces: [...request.leavePieces], leaveSupplies: { ...request.leaveSupplies }, takeGround: [...request.takeGround] },
    fingerprint: extractionFingerprint(state, request),
    ok: valid && !usage.overload && !geometryFull,
    ...(code ? { code } : !valid ? { code: 'invalid-selection' as const } : usage.overload || geometryFull ? { code: 'capacity' as const } : {}),
    capacity: usage.capacity, used: usage.used, supplies: { ...(run?.supplies?.items ?? {}) }, loot, left, matterDevices: devices,
  }
}

/** 确认时重验并一次结算，任何拒绝均不落半截放弃清单。 */
export function wormholeConfirmExtraction(state: GameState, ctx: SimContext, plan: WormholeExtractionPlan): { ok: boolean; code?: 'stale' | 'unavailable' | 'battle-required' | 'invalid-selection' | 'capacity' } {
  if (extractionFingerprint(state, plan.request) !== plan.fingerprint) return { ok: false, code: 'stale' }
  const current = wormholeExtractionPlan(state, ctx, plan.request)
  if (!current.ok) return { ok: false, code: current.code }
  const staged = structuredClone(state)
  if (!applySelection(staged, ctx, plan.request)) return { ok: false, code: 'invalid-selection' }
  if (!wormholeExtract(staged.wormhole.run!, { confirmLeaveCargo: true }).ok) return { ok: false, code: 'battle-required' }
  advanceWormhole(staged, ctx)
  if (staged.wormhole.run) return { ok: false, code: 'unavailable' }
  Object.assign(state, staged)
  return { ok: true }
}
