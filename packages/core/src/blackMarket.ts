import type { CommandResult } from './engine'
import type { BlackMarketState, GameState } from './state'
import type { MarketGoodDef, SimContext } from './types'
import { DSI_FACTION_ID, standingOf } from './standing'
import { BLACK_MARKET_STANDING_REQ } from './events'
import { hashSeed, nextInt } from './rng'
import { isAtHomeLike } from './location'
import { mainActivityOf } from './activityGate'
import { depositGood, goodName, marketLockNote } from './market'
import { addLog } from './state'

export const BLACK_MARKET_OFFER_COUNT = 9
export const BLACK_MARKET_EXCLUSIVE_COUNT = 3
export const BLACK_MARKET_MIN_MULTIPLIER = 30
export const BLACK_MARKET_MAX_MULTIPLIER = 100

export function blackMarketUnlocked(state: GameState): boolean {
  return standingOf(state, DSI_FACTION_ID) >= BLACK_MARKET_STANDING_REQ
}

function resolvable(ctx: SimContext, good: MarketGoodDef): boolean {
  switch (good.kind) {
    case 'item': return ctx.items.has(good.refId)
    case 'module': return ctx.modules.has(good.refId)
    case 'ship': return ctx.ships.has(good.refId)
    case 'blueprint': return ctx.blueprints.has(good.refId) || ctx.shipBlueprints.has(good.refId)
    case 'aicore': return ['basic', 'gamma', 'beta', 'alpha'].includes(good.refId)
  }
}

export function blackMarketCandidateGoods(ctx: SimContext): MarketGoodDef[] {
  return [...ctx.marketGoods.values()].filter((g) => !g.unreleased && (g.rarityTier ?? 1) >= 4 &&
    Number.isSafeInteger(g.basePrice) && g.basePrice > 0 && Number.isSafeInteger(g.basePrice * 100) &&
    (g.playerBuyable !== false || g.blackMarketBuyable === true) && resolvable(ctx, g))
    .sort((a, b) => a.key.localeCompare(b.key, 'en'))
}

export function blackMarketDayStart(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function blackMarketNextRefresh(state: GameState): number {
  const date = new Date(state.blackMarket?.dayWallMs ?? 0)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** 独立随机源仅由档初始种子与日界派生；不消耗战斗/事件随机流。 */
export function ensureBlackMarket(state: GameState, ctx: SimContext, now: number): boolean {
  if (!blackMarketUnlocked(state) || !Number.isFinite(now) || now <= 0) return false
  const day = blackMarketDayStart(now)
  if (!Number.isSafeInteger(day) || day <= 0) return false
  if (state.blackMarket && state.blackMarket.dayWallMs >= day) return false
  const rng = { seed: hashSeed(`black-market:${state.rng.seed}:${state.character.startedAtWallMs}:${day}`), count: 0 }
  const pool = blackMarketCandidateGoods(ctx)
  const exclusive = pool.filter((g) => g.playerBuyable === false)
  const chosen: MarketGoodDef[] = []
  const draw = (rows: MarketGoodDef[], count: number) => {
    for (let i = 0; i < count && rows.length; i++) chosen.push(rows.splice(nextInt(rng, rows.length), 1)[0]!)
  }
  draw(exclusive, BLACK_MARKET_EXCLUSIVE_COUNT)
  draw(pool.filter((g) => !chosen.includes(g)), BLACK_MARKET_OFFER_COUNT - chosen.length)
  state.blackMarket = {
    dayWallMs: day,
    offers: chosen.map((good) => {
      const multiplier = BLACK_MARKET_MIN_MULTIPLIER + nextInt(rng, BLACK_MARKET_MAX_MULTIPLIER - BLACK_MARKET_MIN_MULTIPLIER + 1)
      return { goodKey: good.key, basePrice: good.basePrice, multiplier, price: good.basePrice * multiplier, sold: false }
    }),
  }
  return true
}

/** 严格规范化：损坏条目丢弃但保留日界，不能通过损坏/空库存触发同日重抽。 */
export function normalizeBlackMarket(raw: unknown): BlackMarketState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  if (typeof obj.dayWallMs !== 'number' || !Number.isSafeInteger(obj.dayWallMs) || obj.dayWallMs <= 0 || !Number.isFinite(new Date(obj.dayWallMs).getTime())) return undefined
  const offers: BlackMarketState['offers'] = []
  const keys = new Set<string>()
  for (const value of Array.isArray(obj.offers) ? obj.offers : []) {
    if (offers.length >= BLACK_MARKET_OFFER_COUNT || !value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    if (typeof row.goodKey !== 'string' || !row.goodKey || keys.has(row.goodKey) || typeof row.sold !== 'boolean' ||
      typeof row.basePrice !== 'number' || !Number.isSafeInteger(row.basePrice) || row.basePrice <= 0 ||
      typeof row.multiplier !== 'number' || !Number.isInteger(row.multiplier) || row.multiplier < 30 || row.multiplier > 100 ||
      typeof row.price !== 'number' || !Number.isSafeInteger(row.price) || row.price !== row.basePrice * row.multiplier) continue
    keys.add(row.goodKey)
    offers.push({ goodKey: row.goodKey, basePrice: row.basePrice, multiplier: row.multiplier, price: row.price, sold: row.sold })
  }
  return { dayWallMs: obj.dayWallMs, offers }
}

export function blackMarketBuy(state: GameState, ctx: SimContext, goodKey: string, expectedDay: number, expectedPrice: number, now: number): CommandResult {
  const fail = (errorId: string, error: string): CommandResult => ({ ok: false, errorId, error })
  if (!blackMarketUnlocked(state)) return fail('core.blackMarket.001', '黑市需要协会累计声望达到 100。')
  if (!Number.isFinite(now) || now <= 0) return fail('core.blackMarket.002', '货架或报价已更新，请重新选货。')
  ensureBlackMarket(state, ctx, now)
  const board = state.blackMarket
  const offer = board?.offers.find((o) => o.goodKey === goodKey)
  if (!board || board.dayWallMs !== expectedDay || !offer || offer.price !== expectedPrice) return fail('core.blackMarket.002', '货架或报价已更新，请重新选货。')
  if (offer.sold) return fail('core.blackMarket.003', '这件商品今天已经售罄。')
  const good = blackMarketCandidateGoods(ctx).find((g) => g.key === goodKey)
  if (!good || !normalizeBlackMarket({ dayWallMs: board.dayWallMs, offers: [offer] })?.offers.length) return fail('core.blackMarket.004', '这件商品当前无法出售。')
  const activity = mainActivityOf(state)
  if (!isAtHomeLike(state, ctx) || state.transit.active || state.wormhole.run != null ||
    (activity !== null && !['refine', 'manufacturing', 'lab', 'wormholeScan'].includes(activity))) return fail('core.blackMarket.005', '购买黑市商品需要停靠母港或已建成的副空间站。')
  const lock = marketLockNote(state, good)
  if (lock) return { ok: false, error: lock.text, errorId: lock.textId, errorParams: lock.params }
  if (!Number.isFinite(state.wallet.isk) || state.wallet.isk < offer.price) return fail('core.blackMarket.006', '信用点不足，未扣款。')
  // 扣款、入库、售罄在同一次同步命令内完成，重复点击必被sold拒绝。
  state.wallet.isk -= offer.price
  depositGood(state, ctx, goodKey, 1)
  offer.sold = true
  addLog(state, 'trade', `黑市购入 ${goodName(ctx, goodKey)}×1（${offer.price.toLocaleString('zh-CN')} 信用点）。`,
    'core.blackMarket.007', { p1: goodName(ctx, goodKey), p2: offer.price.toLocaleString('zh-CN') })
  return { ok: true }
}
