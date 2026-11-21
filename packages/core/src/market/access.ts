import type { GameState } from '../state'
import type { MarketGoodDef, MarketGoodKind, SimContext } from '../types'
import { DSI_FACTION_ID, standingOf } from '../standing'

export function marketTradingGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter(g => playerTradingGood(ctx, g))
}

export function playerTradingGood(ctx: SimContext, def: MarketGoodDef): boolean {
  if (def.unreleased) return false
  const ref = def.kind === 'item' ? ctx.items.get(def.refId)
    : def.kind === 'module' ? ctx.modules.get(def.refId)
      : def.kind === 'ship' ? ctx.ships.get(def.refId)
        : def.kind === 'blueprint' ? ctx.blueprints.get(def.refId) ?? ctx.shipBlueprints.get(def.refId)
          : undefined
  if (def.kind === 'aicore') return ['basic', 'alpha', 'beta', 'gamma'].includes(def.refId)
  if (!ref) return def.kind === 'item'
  return !('unreleased' in ref && ref.unreleased) && !('hidden' in ref && ref.hidden)
}


export function marketGoodOf(
  ctx: SimContext,
  kind: MarketGoodKind,
  refId: string,
): MarketGoodDef | undefined {
  for (const def of ctx.marketGoods.values()) {
    if (def.kind === kind && def.refId === refId) return def
  }
  return undefined
}

export function goodLockedReason(state: GameState, def: MarketGoodDef): string | null {
  return marketLockNote(state, def)?.text ?? null
}

export function marketLockNote(
  state: GameState,
  def: MarketGoodDef,
): { text: string; textId: string; params: Record<string, string | number> } | null {
  const need = def.standingReq
  if (!need || need <= 0) return null
  const have = standingOf(state, DSI_FACTION_ID)
  if (have >= need) return null
  return {
    text: `需「深空工业协会」声望 ${need}（累计 ${have}）`,
    textId: 'core.market.039',
    params: { p1: need, p2: have },
  }
}

export function marketLockedReason(state: GameState, ctx: SimContext, goodKey: string): string | null {
  const def = ctx.marketGoods.get(goodKey)
  return def ? goodLockedReason(state, def) : null
}

export function bmGateLocked(state: GameState, def: MarketGoodDef): boolean {
  return !!def.bmStanding && def.bmStanding > 0 && standingOf(state, DSI_FACTION_ID) < def.bmStanding
}

export function bmGateReason(state: GameState, def: MarketGoodDef): string | null {
  return bmGateNote(state, def)?.text ?? null
}

export function bmGateNote(
  state: GameState,
  def: MarketGoodDef,
): { text: string; textId: string; params: Record<string, string | number> } | null {
  if (!def.bmStanding || def.bmStanding <= 0) return null
  const have = standingOf(state, DSI_FACTION_ID)
  if (have >= def.bmStanding) return null
  return {
    text: `需「深空工业协会」声望 ${def.bmStanding}（累计 ${have}）`,
    textId: 'core.market.039',
    params: { p1: def.bmStanding, p2: have },
  }
}
