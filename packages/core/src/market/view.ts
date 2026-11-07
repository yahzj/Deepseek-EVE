import type { GameState } from '../state'
import type { SimContext } from '../types'
import { ensureMarket } from './initialize'

/**
 * **读路径兜底复用（2026-11-07 性能修复）**：`marketQuote()` 是纯读函数，原先每读一行都调
 * `ensureMarket()`；后者每次都会遍历全部商品目录（当前约 600 条）做兜底初始化。市场页一帧要读
 * 上百行（`stockedFirst` 排序一次 ＋ 每个 `GoodRow` 一次）⇒ 单次渲染被放大到 30ms 以上。
 *
 * 这里只缓存**同一同步任务内**的兜底结果：一帧里的第一次报价做完整 `ensureMarket`，同帧其余报价
 * 直接读簿面；微任务结束时失效，下一次渲染/下一次点击仍会重新兜底。
 *
 * ⚠ **不能缓存 `ensureMarket` 本身**：它的契约是"每次调用都修复缺失/损坏的簿面与限额库存"
 * （`market-limited-supply-20261006` 用例直接破坏 `npcSell` 后要求 `ensureMarket` 当场修好）。
 * 读路径不承担写修复职责，兜底仍走原函数、原语义。
 */
let readEnsured: { state: GameState; ctx: SimContext } | null = null

function ensureMarketForRead(state: GameState, ctx: SimContext): void {
  if (readEnsured?.state === state && readEnsured.ctx === ctx) return
  ensureMarket(state, ctx)
  readEnsured = { state, ctx }
  // 只作用于当前同步任务（React 的一次渲染/一次点击处理），不与下一拍/下一次交互共用。
  queueMicrotask(() => {
    if (readEnsured?.state === state && readEnsured.ctx === ctx) readEnsured = null
  })
}

/** 簿面报价：收购价 = npcBuy 最高价；供应价 = npcSell 最低价 */
export function marketQuote(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
): { buy?: number; sell?: number; buyDepth: number; sellDepth: number; buyQty: number; sellQty: number } {
  ensureMarketForRead(state, ctx)
  const buyOrders = state.market.npcBuy[goodKey] ?? []
  const sellOrders = state.market.npcSell[goodKey] ?? []
  let bestBuy: number | undefined
  let buyQty = 0
  for (const o of buyOrders) {
    buyQty += o.qty
    if (bestBuy === undefined || o.price > bestBuy) bestBuy = o.price
  }
  let bestSell: number | undefined
  let sellQty = 0
  for (const o of sellOrders) {
    sellQty += o.qty
    if (bestSell === undefined || o.price < bestSell) bestSell = o.price
  }
  return { buy: bestBuy, sell: bestSell, buyDepth: buyOrders.length, sellDepth: sellOrders.length, buyQty, sellQty }
}

/** 价格小史（**每 30 分钟一点，上限 48 点 ≈ 24 小时**；2026-09-08 船长：保留窗 24 → 48，趋势展示用） */
export function marketHistory(state: GameState, goodKey: string): readonly number[] {
  return state.market.priceHistory[goodKey] ?? []
}

/**
 * 价格趋势：1 涨 / -1 跌 / 0 平（2026-09-08 船长：保留点加倍后仍锚定「**最近 24 点**」对比）。
 * ⚠ 采样点 = 30 分钟 ⇒ 这里的"24 点"= **最近 12 小时**（2026-09-16 改采样节奏后同步写清）。
 */
export function marketTrend(state: GameState, goodKey: string): number {
  const hist = state.market.priceHistory[goodKey]
  if (!hist || hist.length < 4) return 0
  const base = hist.length > 24 ? hist[hist.length - 24]! : hist[0]!
  const last = hist[hist.length - 1]!
  if (last > base * 1.01) return 1
  if (last < base * 0.99) return -1
  return 0
}
