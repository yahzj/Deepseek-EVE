import type { GameState } from '../state'
import type { MarketGoodDef, MarketGoodKind, SimContext } from '../types'
import { DSI_FACTION_ID, standingOf } from '../standing'

/** 普通市场与订单事件只列可买或可卖的货，双禁令商品只保留黑市报价用途。 */
export function marketTradingGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter(g => g.playerBuyable !== false || g.playerSellable !== false)
}

/* ═══════════ 查询 ═══════════ */

/** 按品类/引用 id 找市场商品（如：物品 ore-veldspar → good 'ore-veldspar'；舰船 whale → good 'ship-whale'） */
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

/**
 * 商品购买门槛（V10）：不满足时返回原因文案（null = 可买）。卖出不受限。
 *
 * ⚠ **2026-09-26 船长令**：「**修改原先的所有声望门槛，改为根据玩家的累计声望**」⇒ 门槛读
 * **累计获得**那一本；与 `mining.ts`（矿带 `standingReq` 的**命令侧**闸）改前就在读的同一本账对齐
 * ——改前界面按可支配判、命令按累计判，换过图纸后会出现"星图说锁着、点下去却能开工"的错位。
 */
export function goodLockedReason(state: GameState, def: MarketGoodDef): string | null {
  return marketLockNote(state, def)?.text ?? null
}

/**
 * **声望门槛那枚锁的"结构化"版本**（`{ text, textId, params }`）——**2026-09-30 加**（英文残留批 5）。
 *
 * 为什么要有它：`goodLockedReason` 返回的是一句**拼好的中文**，而它在界面上有 5 处渲染点
 * （市场两处 / 舰船 / 工业 / 引擎提示）⇒ 英文界面下那枚「需「深空工业协会」声望 12（累计 9）」永远是中文。
 * core 不能直接翻译（不认识渲染层的语言）⇒ 按本仓既定的**id 侧面通道**给出
 * `textId` + `params`（口径同 §十一之三：调用点写 `tr(textId, params)`），
 * 中文原串照旧返回（老调用点与"只判空"的路径零变化）。
 */
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

/** 按商品 key 查询购买门槛（界面展示锁标用） */
export function marketLockedReason(state: GameState, ctx: SimContext, goodKey: string): string | null {
  const def = ctx.marketGoods.get(goodKey)
  return def ? goodLockedReason(state, def) : null
}

/** P2 暗市闸（2026-09-06 船长定：常驻硬拦 + 暗市单 ×4 可绕过）：声望低于 bmStanding 即处于闸内。
 *  ⚠ 2026-09-26 船长令「所有声望门槛改读累计声望」⇒ 读 `standingOf`（累计获得那本）。 */
export function bmGateLocked(state: GameState, def: MarketGoodDef): boolean {
  return !!def.bmStanding && def.bmStanding > 0 && standingOf(state, DSI_FACTION_ID) < def.bmStanding
}

/** 暗市闸展示文案（2026-09-06 船长定：暗市对玩家隐身——仅声望锁指引，与 standingReq 锁同观感；
 * 闸内偶发 ×4 到货在外观与文案上与普通稀有单无异） */
export function bmGateReason(state: GameState, def: MarketGoodDef): string | null {
  return bmGateNote(state, def)?.text ?? null
}

/** 暗市闸那枚锁的"结构化"版本（口径与 `marketLockNote` 同款；同一句文案 ⇒ 同一个 id） */
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
