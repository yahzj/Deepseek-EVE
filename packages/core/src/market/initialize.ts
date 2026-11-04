import type { GameState } from '../state'
import type { SimContext } from '../types'
import { ensureLimitedSupply, hasLimitedSupply } from '../marketLimitedSupply'
import { RARE_DRAW_PERIOD_MS } from './constants'
import { seedCommonBook, refreshLimitedSupplyBook } from './supply'
import { priceLevel } from './pricing'

/* ═══════════ 初始化 ═══════════ */

/** 按目录惰性初始化市场（迁移/新档首次推进时调用）。
 * opts.openAtGameMs：市场"开盘时刻"（首次开市时订单寿命与 lastTick 的基准）。
 * 离线结算时由 advanceMarket 传"离线起点"，使整段离线也按窗口推进（订单过期/补单/撮合）。 */
export function ensureMarket(state: GameState, ctx: SimContext, opts?: { openAtGameMs?: number }): void {
  const mk = state.market
  const freshInit = mk.lastTickGameMs === 0 && mk.orderSeq === 0 && Object.keys(mk.pools).length === 0
  const openAt = opts?.openAtGameMs !== undefined ? Math.max(0, Math.floor(opts.openAtGameMs)) : state.gameMs
  // P2 抽取节拍基准（零迁移容错）：旧档无 slowDrawLastGameMs 时补"开盘前一周期"→ 首个窗口即触发抽取
  if (mk.slowDrawLastGameMs === undefined) mk.slowDrawLastGameMs = Math.max(0, openAt - RARE_DRAW_PERIOD_MS)
  const addedKeys: string[] = []
  // 五个子结构（池/双簿/消化队列/价格小史）逐目录兜底：
  // 存档容错只保留"非零/非空"条目，零值 digest 条目可能在读档时被丢弃，
  // 若不补回，窗口推进会在 dig.qty 处崩溃——必须与池同生命周期。
  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    if (!(key in mk.pools)) {
      mk.pools[key] = { q: def.poolTarget ?? 0, shock: 0, netVol: 0, lastHistoryGameMs: 0, noise: 0 }
      addedKeys.push(key)
    }
    // 旧档（无 noise 字段）规范化：补 0，避免窗口推进读到 undefined
    mk.pools[key]!.noise = mk.pools[key]!.noise ?? 0
    mk.npcBuy[key] ??= []
    mk.npcSell[key] ??= []
    // 目录停售后撤下旧档NPC供应，收购簿与玩家订单不动。
    if (def.playerBuyable === false && mk.npcSell[key]!.length > 0) mk.npcSell[key] = []
    mk.digest[key] ??= { qty: 0, price: 0, perWindow: 0 }
    mk.priceHistory[key] ??= []
  }
  // 首次开市（新档/迁移档）：全部常驻商品铺开盘簿（寿命从开盘时刻起算）
  if (freshInit) {
    for (const def of ctx.marketGoods.values()) {
      if (def.rarity === 'common' && (mk.npcBuy[def.key]?.length ?? 0) === 0) {
        seedCommonBook(state, ctx, def, openAt)
      }
    }
    /**
     * **开盘先落一个采样点**（2026-09-16 随采样节奏改为 30 分钟/点一起补）：
     * 否则新档/迁移档的折线图在**前 30 分钟是空的**（原来逐窗采样时一分钟内就有点）。
     * 只给"历史还是空"的商品补，重复开市不会叠加。
     */
    for (const def of ctx.marketGoods.values()) {
      const hist = mk.priceHistory[def.key]
      if (hist && hist.length === 0) hist.push(priceLevel(state, ctx, def, mk.pools[def.key]?.q ?? 0))
    }
    mk.lastTickGameMs = openAt
  }
  // 目录中途扩增（数据更新）：只给新增商品开盘，不打扰已有簿面
  for (const key of addedKeys) {
    const def = ctx.marketGoods.get(key)
    if (def && def.rarity === 'common' && (mk.npcBuy[key]?.length ?? 0) === 0) {
      seedCommonBook(state, ctx, def, state.gameMs)
    }
  }
  // 新启用的限额商品只发一次库存；旧账保持余额，损坏/缺失簿面只重铺该余额。
  for (const def of ctx.marketGoods.values()) {
    if (!hasLimitedSupply(def)) continue
    const pool = mk.pools[def.key]!
    const fresh = ensureLimitedSupply(pool, def, openAt)
    const qty = mk.npcSell[def.key]!.reduce((sum, order) => sum + order.qty, 0)
    if (fresh || qty !== pool.limitedSupply!.remaining) refreshLimitedSupplyBook(state, ctx, def, openAt)
  }
}
