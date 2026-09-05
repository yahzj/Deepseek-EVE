/**
 * 市场引擎（V9）：NPC 订单簿 + 库存池 + 冲击动量 + 内部消化 + 玩家限价/市价单。
 *
 * 规则（中文说明，设计文档 V4/V5 已确认）：
 * - 两栏目录：常驻供应（common：矿石/矿物池模型 + 单件平价品）与稀有订单
 *   （rare 溢价品 / exotic 限定奇货；后者寿命极短、概率极低、天价）；
 * - 价格模型：L = 均衡价 × 库存压力 × (1 + 冲击动量)（单件品压力恒 1）。
 *   常驻池商品买卖价差小（收购 ≈0.97L / 供应 ≈1.03L）；
 *   单件商品按目录显式倍数（供应 = supplyMultiplier×L、收购 = demandMultiplier×L）；
 * - 库存池：玩家卖给收购单 → 池增加；玩家买走供应单 → 池减少；池以 30 分钟半程
 *   向 poolTarget 回归（站内产业吸收/补给）。池接近干涸 → 供应单停发（短缺）；
 *   池淤积 → 收购压价 → 倾销会砸价（池压 + 冲击双压价，冲击叠加无上限——用户确认）；
 * - 冲击动量（隐藏）：窗口净成交量 > 参考量×2 触发一次 ±0.05 偏移，半程 6 分钟衰减；
 *   冲击过后陈旧簿与新高价订单冲突 → 进内部消化队列，按窗口比例随时间消化（不瞬消）；
 * - 卖出预扣（escrow）：卖出先锁定货；市价单吃簿后剩余自动转限价单；
 *   撤单按类别退回（物品→物品仓库；装备→装备库；蓝图→蓝图书；船→舰队并保留耐久）；
 * - 买单成交直接入对应库存；舰船须满足可售条件（非驾驶、无 AI 任务、货仓空、无装配）；
 * - 贸易税（已确认 2026-09-03）：仅玩家卖出成交按 5% 征税（会计学/贸易谈判学各 -8%/级，
 *   双满合计减免 80% → 1%）；挂单/自动转挂单/买入一律免费——税是唯一的市场费用
 *   （参考 EVE 的销售税；取消经纪人费/挂单费）。
 */
import { addLog } from './state'
import type { GameState, NpcMarketOrder, PlayerOrder } from './state'
import type { MarketGoodDef, MarketGoodKind, SimContext } from './types'
import { nextRandom } from './rng'
import { addWare, countWare, removeWare } from './inventory'
import { addModule, countModule, removeModule } from './equipment'
import { addShipToFleet, fleetDefOf, isShipLocked, shipDisplayName } from './shipyard'
import { emptyFitted, uidDefId, allFittedIds } from './labels'
import { countAiCore, gainAiCore, spendAiCores } from './ai'
import { shipInReturn } from './mining'
import { DSI_FACTION_ID } from './expedition'

/** 协会声望卖出加成：物品类（矿石/矿物）成交价 ×(1 + 声望×1%)，上限 +15%（v4 规则延续） */
function sellStandingMult(state: GameState, def: MarketGoodDef | undefined): number {
  if (!def || def.kind !== 'item') return 1
  return 1 + Math.min(0.15, (state.standings[DSI_FACTION_ID] ?? 0) * 0.01)
}

/**
 * 当前贸易税率（销售税）：基础 5% × (1 − 8%×(会计学级 + 贸易谈判学级))；
 * 双技能满级合计减免 80% → 1%。税率只针对"玩家卖出成交"（买入/挂单不收）。
 */
export function salesTaxRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.market
  const lvA = state.skills.trained[bal.taxSkillAId] ?? 0
  const lvB = state.skills.trained[bal.taxSkillBId] ?? 0
  const cut = Math.min(1, bal.taxCutPerLevel * (lvA + lvB))
  return Math.max(0, bal.salesTaxRate * (1 - cut))
}

/** 毛额（声望加成后）→ 税后净入账 */
function netAfterTax(state: GameState, ctx: SimContext, gross: number): number {
  return gross - Math.round(gross * salesTaxRate(state, ctx))
}

/* ═══════════ 初始化 ═══════════ */

/** 按目录惰性初始化市场（迁移/新档首次推进时调用）。
 * opts.openAtGameMs：市场"开盘时刻"（首次开市时订单寿命与 lastTick 的基准）。
 * 离线结算时由 advanceMarket 传"离线起点"，使整段离线也按窗口推进（订单过期/补单/撮合）。 */
export function ensureMarket(state: GameState, ctx: SimContext, opts?: { openAtGameMs?: number }): void {
  const mk = state.market
  const freshInit = mk.lastTickGameMs === 0 && mk.orderSeq === 0 && Object.keys(mk.pools).length === 0
  const openAt = opts?.openAtGameMs !== undefined ? Math.max(0, Math.floor(opts.openAtGameMs)) : state.gameMs
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
    mk.lastTickGameMs = openAt
  }
  // 目录中途扩增（数据更新）：只给新增商品开盘，不打扰已有簿面
  for (const key of addedKeys) {
    const def = ctx.marketGoods.get(key)
    if (def && def.rarity === 'common' && (mk.npcBuy[key]?.length ?? 0) === 0) {
      seedCommonBook(state, ctx, def, state.gameMs)
    }
  }
}

/** 常驻商品开局簿（openAtMs = 开盘时刻：订单寿命与簿面基准） */
function seedCommonBook(state: GameState, ctx: SimContext, def: MarketGoodDef, openAtMs: number): void {
  const mk = state.market
  const life = ctx.balance.market.orderLifeMs.common
  const now = openAtMs
  const L = priceLevel(state, ctx, def, def.poolTarget ?? 0)
  const sellable = def.playerSellable !== false
  if (def.poolTarget && def.poolTarget > 0) {
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))
    if (sellable) {
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L), qty: Math.max(1, Math.round(flow)), expiresAtGameMs: now + life })
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L, -0.01), qty: Math.max(1, Math.round(flow * 1.25)), expiresAtGameMs: now + life })
    }
    mk.npcSell[def.key]!.push({ price: sellPrice(def, L), qty: Math.max(1, Math.round(flow * 0.8)), expiresAtGameMs: now + life })
    mk.pools[def.key]!.q = def.poolTarget
  } else {
    // 单件平价品（装备/蓝图/船/基础核心）：1 收购 + 2 供应
    if (sellable) {
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L), qty: 1, expiresAtGameMs: now + life })
    }
    mk.npcSell[def.key]!.push({ price: sellPrice(def, L), qty: 1, expiresAtGameMs: now + life })
    mk.npcSell[def.key]!.push({ price: sellPrice(def, L, 0.02), qty: 1, expiresAtGameMs: now + life })
  }
}

/* ═══════════ 价格 ═══════════ */

/** 均衡价 L：池商品 = base×库存压力×(1+冲击)·(1+慢速噪声)；单件 = base×(1+冲击)·(1+噪声)。输出按比例钳制防失控 */
function priceLevel(state: GameState, ctx: SimContext, def: MarketGoodDef, poolQ: number): number {
  const bal = ctx.balance.market
  const pool = state.market.pools[def.key]!
  let pressure = 1
  if (def.poolTarget && def.poolTarget > 0) {
    pressure = 1 - 0.5 * ((poolQ - def.poolTarget) / def.poolTarget)
    pressure = Math.max(0.4, Math.min(1.6, pressure))
  }
  // 慢速均值回归噪声：独立于压力/冲击，让常驻行情即使无人交易也温和起伏（2026-09-05 船长感知"太稳定"）
  const noise = Math.max(-0.4, Math.min(0.4, pool.noise ?? 0))
  const level = def.basePrice * pressure * (1 + pool.shock) * (1 + noise)
  return Math.round(Math.min(def.basePrice * bal.maxPriceRatio, Math.max(def.basePrice * bal.minPriceRatio, level)))
}

/** 收购单价（NPC 收玩家的价）：池商品在均衡价时收购 = L（平价收购，压价靠池淤积/冲击）；
 * 单件 = demandMultiplier×L；delta = 档位差 */
function buyPrice(def: MarketGoodDef, L: number, delta = 0): number {
  const base = def.poolTarget && def.poolTarget > 0 ? L : L * (def.demandMultiplier ?? 0.5)
  return Math.round(base * (1 + delta))
}

/** 供应单价（NPC 卖给玩家的价）：池商品微溢（+6%，至少 +1 ISK，防整数取整后与收购价同价）；
 * 单件 = supplyMultiplier×L（默认 1 = 平价） */
function sellPrice(def: MarketGoodDef, L: number, delta = 0): number {
  const base = def.poolTarget && def.poolTarget > 0 ? Math.max(Math.round(L * 1.06), L + 1) : L * (def.supplyMultiplier ?? 1)
  return Math.round(base * (1 + delta))
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

/** 商品购买门槛（V10）：不满足时返回原因文案（null = 可买）。卖出不受限，声望只会增长不回落 */
export function goodLockedReason(state: GameState, def: MarketGoodDef): string | null {
  const need = def.standingReq
  if (!need || need <= 0) return null
  const have = state.standings[DSI_FACTION_ID] ?? 0
  return have >= need ? null : `需「深空工业协会」声望 ${need}（当前 ${have}）`
}

/** 按商品 key 查询购买门槛（界面展示锁标用） */
export function marketLockedReason(state: GameState, ctx: SimContext, goodKey: string): string | null {
  const def = ctx.marketGoods.get(goodKey)
  return def ? goodLockedReason(state, def) : null
}

/** 当前均衡价 L（展示/估价用；不含单边价差与 jitter） */
export function levelOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const q = state.market.pools[goodKey]?.q ?? def.poolTarget ?? 0
  return priceLevel(state, ctx, def, q)
}

/** 簿面报价：收购价 = npcBuy 最高价；供应价 = npcSell 最低价 */
export function marketQuote(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
): { buy?: number; sell?: number; buyDepth: number; sellDepth: number; buyQty: number; sellQty: number } {
  ensureMarket(state, ctx)
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

/** 价格小史（最近 24 个窗口采样，趋势展示用） */
export function marketHistory(state: GameState, goodKey: string): readonly number[] {
  return state.market.priceHistory[goodKey] ?? []
}

/** 价格趋势：1 涨 / -1 跌 / 0 平 */
export function marketTrend(state: GameState, goodKey: string): number {
  const hist = state.market.priceHistory[goodKey]
  if (!hist || hist.length < 4) return 0
  const first = hist[0]!
  const last = hist[hist.length - 1]!
  if (last > first * 1.01) return 1
  if (last < first * 0.99) return -1
  return 0
}

/** 商品显示名 */
export function goodName(ctx: SimContext, goodKey: string): string {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return goodKey
  switch (def.kind) {
    case 'item':
      return ctx.items.get(def.refId)?.name ?? goodKey
    case 'module':
      return ctx.modules.get(def.refId)?.name ?? goodKey
    case 'ship':
      return ctx.ships.get(def.refId)?.name ?? goodKey
    case 'blueprint':
      return ctx.blueprints.get(def.refId)?.name ?? ctx.shipBlueprints.get(def.refId)?.name ?? goodKey
    case 'aicore':
      return (
        def.refId === 'basic'
          ? '基础 AI 核心'
          : def.refId === 'gamma'
            ? '伽马 AI 核心'
            : def.refId === 'beta'
              ? '贝塔 AI 核心'
              : def.refId === 'alpha'
                ? '阿尔法 AI 核心'
                : def.refId
      )
  }
}

/* ═══════════ 内部消化与刷单（窗口推进） ═══════════ */

/**
 * 推进市场窗口（引擎在 gameMs 已前移后调用本函数：窗口直到当前 gameMs 为止）。
 * 离线大推进同样适用（订单过期/池回归/内部消化/补单/挂单撮合都会处理）。
 */
export function advanceMarket(state: GameState, deltaMs: number, ctx: SimContext): void {
  if (deltaMs <= 0) return
  // 尚未开市的档（迁移档/新档）在"本次推进的起点"开盘，而不是终点：
  // 这样离线结算的整段离线时间都按窗口推进（订单过期/池回归/补单/我的挂单撮合）。
  ensureMarket(state, ctx, { openAtGameMs: state.gameMs - deltaMs })
  let guard = 0
  const mk = state.market
  const tick = ctx.balance.market.tickMs
  // 注意：state.gameMs 由调用方（advanceGame）先行增加，这里只补到当前时刻的窗口
  while (mk.lastTickGameMs + tick <= state.gameMs && guard < 20000) {
    guard++
    processWindow(state, ctx)
  }
}

/** 单个窗口：过期清理 → 池回归/冲击衰减 → 内部消化 → 刷单 → 撮合 → 小史/冲击结算 */
function processWindow(state: GameState, ctx: SimContext): void {
  const mk = state.market
  const bal = ctx.balance.market
  const dt = bal.tickMs
  const nextNow = mk.lastTickGameMs + dt
  const regenK = 1 - Math.pow(0.5, dt / bal.poolRegenHalfMs)
  const decayK = 1 - Math.pow(0.5, dt / bal.shockDecayHalfMs)
  const noiseK = 1 - Math.pow(0.5, dt / bal.noiseHalfLifeMs)

  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    const pool = mk.pools[key]!
    const buyList = mk.npcBuy[key]!
    const sellList = mk.npcSell[key]!

    // 过期清理
    for (let i = buyList.length - 1; i >= 0; i--) if (buyList[i]!.expiresAtGameMs <= nextNow) buyList.splice(i, 1)
    for (let i = sellList.length - 1; i >= 0; i--) if (sellList[i]!.expiresAtGameMs <= nextNow) sellList.splice(i, 1)

    // 池向目标回归（站内吸收/补给）+ 冲击衰减
    if (def.poolTarget && def.poolTarget > 0) pool.q += (def.poolTarget - pool.q) * regenK
    pool.shock *= 1 - decayK
    // 慢速均值回归噪声：随机游走 + 向 0 回报，钳制 ±0.4（船长 2026-09-05：常驻行情"太稳定"，加真实起伏）
    pool.noise = Math.max(-0.4, Math.min(0.4, pool.noise * (1 - noiseK) + (nextRandom(state.rng) - 0.5) * bal.noiseStep))

    // 内部消化（冲突大单随时间推进消化）
    const dig = mk.digest[key]!
    if (dig.qty > 0) dig.qty = Math.max(0, dig.qty - dig.perWindow)

    // 刷单
    refreshGoodOrders(state, ctx, def, pool.q, nextNow)
  }

  // 撮合我的限价单（含已成交挂单的清理）
  matchPlayerOrders(state, ctx)

  // 价格小史 + 冲击结算
  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    const pool = mk.pools[key]!
    // 记当前均衡价 L（含慢速噪声/压力/冲击）。不用 bestBuy：其是"20 窗移动最大值"，
    // 旧高单会在下行时压制，掩盖噪声波动（尤其便宜货整数取整后钉死）——L 每窗重算，更能即时反映行情趋势。
    const hist = mk.priceHistory[key]!
    hist.push(priceLevel(state, ctx, def, pool.q))
    if (hist.length > 24) hist.shift()
    const ref = referenceVol(def, bal.referenceVolRatio)
    if (ref > 0 && Math.abs(pool.netVol) > ref * bal.shockTriggerRatio) {
      pool.shock += Math.sign(pool.netVol) * bal.shockPerTrigger // 无叠加上限（用户确认）
    }
    pool.netVol = 0
  }

  mk.lastTickGameMs = nextNow
  // ── 市场事件预留钩子：未来"囤积/短缺/协会收购周"在此检查并生效 ──
}

function bestBuy(list: NpcMarketOrder[]): number | undefined {
  let best: number | undefined
  for (const o of list) if (best === undefined || o.price > best) best = o.price
  return best
}

function bestSell(list: NpcMarketOrder[]): number | undefined {
  let best: number | undefined
  for (const o of list) if (best === undefined || o.price < best) best = o.price
  return best
}

/** 参考成交量（冲击归一）：池商品 = 稳态窗口流量的一半（持续按流量买卖不触发冲击，
 * 单窗口爆量（>流量）才触发）；单件 = 1（单件爆买立刻触发） */
function referenceVol(def: MarketGoodDef, ratio: number): number {
  if (def.poolTarget && def.poolTarget > 0) {
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget * ratio))
    return Math.max(1, Math.round(flow / 2))
  }
  return 1
}

/** 按稀有度刷单 */
function refreshGoodOrders(state: GameState, ctx: SimContext, def: MarketGoodDef, poolQ: number, now: number): void {
  const mk = state.market
  const bal = ctx.balance.market
  const key = def.key
  const pool = mk.pools[key]!
  const buyList = mk.npcBuy[key]!
  const sellList = mk.npcSell[key]!
  const jitter = (): number => 1 + (nextRandom(state.rng) - 0.5) * 0.04 // ±2%
  const sellable = def.playerSellable !== false
  const L = priceLevel(state, ctx, def, poolQ)

  const pushBuy = (price: number, qty: number): void => {
    if (qty <= 0 || !sellable) return
    const lowest = bestSell(sellList)
    if (lowest !== undefined && price > lowest) {
      digestAdd(state, ctx, key, qty, price, lowest) // 与簿上供应单冲突 → 内部消化
      return
    }
    buyList.push({ price, qty, expiresAtGameMs: now + bal.orderLifeMs[def.rarity] })
    if (buyList.length > 10) buyList.splice(0, 1)
  }
  const pushSell = (price: number, qty: number): void => {
    if (qty <= 0) return
    // 池商品：池快干涸时站里没货可卖（短缺断供；冲击可短期透支库存）
    if (def.poolTarget && def.poolTarget > 0 && poolQ < def.poolTarget * 0.05 && pool.shock <= 0) return
    const highest = bestBuy(buyList)
    if (highest !== undefined && price < highest) {
      digestAdd(state, ctx, key, qty, highest, price)
      return
    }
    sellList.push({ price, qty, expiresAtGameMs: now + bal.orderLifeMs[def.rarity] })
    if (sellList.length > 10) sellList.splice(0, 1)
  }

  if (def.rarity === 'common') {
    if (def.poolTarget && def.poolTarget > 0) {
      // 池商品：按价格档铺阶梯（船长 2026-09-05：不要全部挤在一个价——不同档位不同价/量，低价品取整后也差 ≥1 ISK）
      const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))
      const p = 1 - 0.5 * ((poolQ - def.poolTarget) / def.poolTarget)
      const pClamped = Math.max(0.4, Math.min(1.6, p))
      const avail = Math.max(0.05, Math.min(1.5, poolQ / def.poolTarget))
      const buyBase = buyPrice(def, L) // 最佳收购价 = L
      const sellBase = sellPrice(def, L) // 最低供应价 ≈ L×1.06
      const buyStep = Math.max(1, Math.round(buyBase * 0.04))
      const sellStep = Math.max(1, Math.round(sellBase * 0.04))
      // 收购阶梯：最佳档在 L，越深越便宜、量越大（墙）；每窗始终铺满 3 档（盘口稳定成阶梯，避免挤单一价）
      for (let i = 0; i < 3; i += 1) {
        const price = Math.max(1, buyBase - i * buyStep)
        const qty = Math.max(1, Math.round(flow * pClamped * (0.5 + 0.35 * i)))
        pushBuy(price, qty)
      }
      // 供应阶梯：最低档在 L×1.06，越深越贵、量越大
      for (let i = 0; i < 3; i += 1) {
        const price = Math.max(1, sellBase + i * sellStep)
        const qty = Math.max(1, Math.round(flow * avail * (0.5 + 0.35 * i)))
        pushSell(price, qty)
      }
    } else {
      // 单件平价品：维持供应线与低价收购线
      if (nextRandom(state.rng) < 0.85) pushBuy(Math.round(buyPrice(def, L) * jitter()), 1)
      if (sellList.length < 2 || nextRandom(state.rng) < 0.85) {
        pushSell(Math.round(sellPrice(def, L) * jitter()), 1)
      }
    }
  } else if (def.rarity === 'rare') {
    // 稀有订单：低频供应（船 1 艘/次，其余 1~3 件）；现货抢购学 ×1.25/级
    const sweepF = 1 + 0.25 * Math.min(5, state.skills.trained['source-sweeping'] ?? 0)
    if (nextRandom(state.rng) < bal.rareWindowChance * sweepF) {
      const qty = def.kind === 'ship' ? 1 : 1 + Math.floor(nextRandom(state.rng) * 3)
      pushSell(Math.round(sellPrice(def, L) * jitter()), qty)
    }
    // 玩家卖方向（二手/多余）：低频出现
    if (sellable && nextRandom(state.rng) < 0.03) pushBuy(Math.round(buyPrice(def, L)), 1)
  } else {
    // exotic 限定奇货：一闪而过（4 分钟寿命 + 极低刷新概率 = 天价奇货）
    const sweepF = 1 + 0.25 * Math.min(5, state.skills.trained['source-sweeping'] ?? 0)
    if (nextRandom(state.rng) < bal.exoticWindowChance * sweepF) pushSell(Math.round(sellPrice(def, L) * jitter()), 1)
    if (sellable && nextRandom(state.rng) < 0.01) pushBuy(Math.round(buyPrice(def, L)), 1)
  }
}

/** 冲突订单入内部消化队列（不瞬消：按 perWindow/窗口 随时间消化） */
function digestAdd(state: GameState, ctx: SimContext, key: string, qty: number, hiPrice: number, loPrice: number): void {
  const dig = state.market.digest[key]!
  dig.qty += qty
  dig.price = Math.round((hiPrice + loPrice) / 2)
  dig.perWindow = Math.max(1, Math.ceil(dig.qty * ctx.balance.market.digestPerWindow))
}

/* ═══════════ 我的限价单撮合（窗口内） ═══════════ */

function matchPlayerOrders(state: GameState, ctx: SimContext): void {
  const mk = state.market
  for (const order of [...state.orders]) {
    if (order.qty <= 0) continue
    if (order.side === 'sell') {
      const buyList = mk.npcBuy[order.good] ?? []
      const sorted = [...buyList].sort((a, b) => b.price - a.price)
      for (const npc of sorted) {
        if (order.qty <= 0) break
        if (npc.price < order.price) continue
        const idx = buyList.indexOf(npc)
        if (idx < 0) continue
        settleSell(state, ctx, order, npc, Math.min(order.qty, npc.qty), idx)
      }
    } else {
      const sellList = mk.npcSell[order.good] ?? []
      const sorted = [...sellList].sort((a, b) => a.price - b.price)
      for (const npc of sorted) {
        if (order.qty <= 0) break
        if (npc.price > order.price) continue
        const idx = sellList.indexOf(npc)
        if (idx < 0) continue
        settleBuy(state, ctx, order, npc, idx)
      }
    }
  }
  // 已成交完毕（qty=0）的挂单移出列表（escrow 已交付/船已交割）
  if (state.orders.some((o) => o.qty <= 0)) {
    state.orders = state.orders.filter((o) => o.qty > 0)
  }
}

/** 卖单成交：钱入账（物品含声望加成，成交扣贸易税），escrow 扣减，池吸收，记录净卖量 */
function settleSell(
  state: GameState,
  ctx: SimContext,
  order: PlayerOrder,
  npc: NpcMarketOrder,
  take: number,
  idx: number,
): void {
  const def = ctx.marketGoods.get(order.good)
  const mult = sellStandingMult(state, def)
  const gross = Math.round(take * order.price * mult)
  const net = netAfterTax(state, ctx, gross)
  const tax = gross - net
  state.wallet.isk += net
  state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - take)
  order.filled += take
  order.qty -= take
  npc.qty -= take
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol -= take
    if (def?.poolTarget && def.poolTarget > 0) pool.q += take
  }
  if (npc.qty <= 0) state.market.npcBuy[order.good]!.splice(idx, 1)
  const taxNote = tax > 0 ? `（贸易税 ${tax.toLocaleString('zh-CN')} ISK）` : ''
  if (state.escrowShips[order.id]) {
    delete state.escrowShips[order.id]
    addLog(state, 'trade', `挂单成交：二手舰船，税后入账 ${net.toLocaleString('zh-CN')} ISK${taxNote}。`)
  } else {
    const bonusNote = mult > 1 ? '（含协会声望加成）' : ''
    addLog(state, 'trade', `挂单成交：${goodName(ctx, order.good)}×${take.toLocaleString('zh-CN')}，税后入账 ${net.toLocaleString('zh-CN')} ISK${bonusNote}${taxNote}。`)
  }
}

/** 买单成交：钱扣除，货入对应库存，池售出，记录净买量 */
function settleBuy(state: GameState, ctx: SimContext, order: PlayerOrder, npc: NpcMarketOrder, idx: number): void {
  const take = Math.min(order.qty, npc.qty)
  const value = take * npc.price
  if (state.wallet.isk < value) return // 钱包不足：暂缓（等钱够了再撮合）
  state.wallet.isk -= value
  const def = ctx.marketGoods.get(order.good)
  depositGood(state, ctx, order.good, take)
  order.filled += take
  order.qty -= take
  npc.qty -= take
  const pool = state.market.pools[order.good]
  if (pool) {
    pool.netVol += take
    if (def?.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - take)
  }
  if (npc.qty <= 0) state.market.npcSell[order.good]!.splice(idx, 1)
  addLog(state, 'trade', `挂单买入成交：${goodName(ctx, order.good)}×${take.toLocaleString('zh-CN')}（${value.toLocaleString('zh-CN')} ISK）。`)
}

/** 买入商品入对应库存（物品→物品仓库；装备→装备库；蓝图→蓝图书；核心→核心库；船→舰队）。
 * 返回：kind=ship 时为本次入队的舰船实例 uid（最后加入的一艘；多艘同批时取末艘），其余返回 null */
function depositGood(state: GameState, ctx: SimContext, goodKey: string, qty: number): string | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return null
  if (def.kind === 'item') addWare(state, def.refId, qty)
  else if (def.kind === 'module') addModule(state, def.refId, qty)
  else if (def.kind === 'blueprint') state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + qty
  else if (def.kind === 'aicore') gainAiCore(state, def.refId as never, qty)
  // v17（T5-B）：船按"艘"实例化——买几艘进几艘（同型多艘自动编号）；返回最后加入的实例 uid
  else if (def.kind === 'ship') {
    const n = Math.max(1, Math.min(50, Math.floor(qty)))
    let uid: string | null = null
    for (let i = 0; i < n; i += 1) uid = addShipToFleet(state, def.refId)
    return uid
  }
  return null
}

/* ═══════════ 玩家操作：挂单 / 撤单 / 市价单 / 卖船 ═══════════ */

/** 挂限价卖单：货先入 escrow（调用方应先从库存扣货入 escrowItems；舰船走 placeShipSellOrder） */
export function placeSellOrder(state: GameState, ctx: SimContext, goodKey: string, price: number, qty: number): PlayerOrder | null {
  if (qty <= 0 || price <= 0) return null
  const order = pushSellOrder(state, goodKey, price, qty)
  state.escrowItems[goodKey] = (state.escrowItems[goodKey] ?? 0) + qty
  addLog(state, 'trade', `已挂卖单：${goodName(ctx, goodKey)}×${qty.toLocaleString('zh-CN')} @ ${order.price.toLocaleString('zh-CN')} ISK。`)
  return order
}

/** 内部：把卖单写入订单表（不碰 escrow、不打日志） */
function pushSellOrder(state: GameState, goodKey: string, price: number, qty: number): PlayerOrder {
  state.market.orderSeq += 1
  const order: PlayerOrder = {
    id: state.market.orderSeq,
    side: 'sell',
    good: goodKey,
    price: Math.round(price),
    qty,
    filled: 0,
    placedAtGameMs: state.gameMs,
  }
  state.orders.push(order)
  return order
}

/** 挂限价买单（成交时扣钱；货直接入库存）；受声望门槛商品在此拒绝 */
export function placeBuyOrder(state: GameState, ctx: SimContext, goodKey: string, price: number, qty: number): PlayerOrder | null {
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0 || price <= 0) return null
  if (goodLockedReason(state, def) !== null) return null
  state.market.orderSeq += 1
  const order: PlayerOrder = {
    id: state.market.orderSeq,
    side: 'buy',
    good: goodKey,
    price: Math.round(price),
    qty,
    filled: 0,
    placedAtGameMs: state.gameMs,
  }
  state.orders.push(order)
  addLog(state, 'trade', `已挂买单：${goodName(ctx, goodKey)}×${qty.toLocaleString('zh-CN')} @ ${order.price.toLocaleString('zh-CN')} ISK。`)
  return order
}

/** 撤单：退回 escrow（按商品类别）；舰船从 escrow 恢复进舰队（耐久保留） */
export function cancelOrder(state: GameState, ctx: SimContext, orderId: number): boolean {
  const idx = state.orders.findIndex((o) => o.id === orderId)
  if (idx < 0) return false
  const order = state.orders[idx]!
  state.orders.splice(idx, 1)
  if (order.side === 'sell' && order.qty > 0) {
    const shipHold = state.escrowShips[order.id]
    if (shipHold) {
      delete state.escrowShips[order.id]
      // v17：原实例原样恢复（uid/船型/耐久/自定义名全保留）；异常残留的同 uid 条目先清除
      delete state.fleet[shipHold.shipId]
      state.fleet[shipHold.shipId] = {
        defId: shipHold.defId,
        customName: shipHold.customName,
        durability: shipHold.durability,
        cargo: {},
        fitted: emptyFitted(),
      }
      addLog(state, 'trade', '卖单已撤销：舰船已退回机库。')
    } else {
      state.escrowItems[order.good] = Math.max(0, (state.escrowItems[order.good] ?? 0) - order.qty)
      refundToStorage(state, ctx, order.good, order.qty)
      addLog(state, 'trade', `卖单已撤销：${goodName(ctx, order.good)}×${order.qty.toLocaleString('zh-CN')} 已退回。`)
    }
  } else if (order.side === 'buy') {
    addLog(state, 'trade', '买单已撤销。')
  }
  return true
}

/** 按商品类别退回库存（撤单/取回用） */
export function refundToStorage(state: GameState, ctx: SimContext, goodKey: string, qty: number): void {
  if (qty <= 0) return
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return
  if (def.kind === 'item') addWare(state, def.refId, qty)
  else if (def.kind === 'module') addModule(state, def.refId, qty)
  else if (def.kind === 'blueprint') state.blueprintStock[def.refId] = (state.blueprintStock[def.refId] ?? 0) + qty
  else if (def.kind === 'aicore') gainAiCore(state, def.refId as never, qty)
}

/**
 * 市价卖出：立即吃 npcBuy 簿（逐档）。剩余自动转限价卖单（免费，不重复收费）。
 * 前置：调用方已把 qty 锁定进 escrowItems（或经 placeSellOrder 挂单）。
 * 返回 total = 税后净入账（含声望加成，扣贸易税）。
 */

/** 卖出技能加成系数（营销学 +1.2%/级；蓝图书另乘 二手市场学 +8%/级）——独立于声望加成 */
export function marketSellSkillMult(state: GameState, kind: MarketGoodDef['kind'] | undefined): number {
  let mult = 1
  const mktLv = Math.min(5, state.skills.trained['marketing'] ?? 0)
  if (mktLv > 0) mult *= 1 + 0.012 * mktLv
  if (kind === 'blueprint') {
    const shLv = Math.min(5, state.skills.trained['secondhand-market'] ?? 0)
    if (shLv > 0) mult *= 1 + 0.08 * shLv
  }
  return mult
}
export function sellAtMarket(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty: number,
): { sold: number; total: number; avg: number; remaining: number } {
  ensureMarket(state, ctx)
  const mk = state.market
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0) return { sold: 0, total: 0, avg: 0, remaining: qty }
  let remaining = qty
  let total = 0
  const fillPrices: number[] = []
  const buyList = mk.npcBuy[goodKey] ?? []
  const sorted = [...buyList].sort((a, b) => b.price - a.price)
  for (const npc of sorted) {
    if (remaining <= 0) break
    const take = Math.min(remaining, npc.qty)
    const idx = buyList.indexOf(npc)
    if (idx < 0) continue
    total += take * npc.price
    fillPrices.push(npc.price)
    remaining -= take
    npc.qty -= take
    if (npc.qty <= 0) buyList.splice(idx, 1)
  }
  const sold = qty - remaining
  const mult = sellStandingMult(state, def) * marketSellSkillMult(state, def.kind) // 声望加成 × 卖出技能加成
  const gross = Math.round(total * mult) // 毛额
  const net = netAfterTax(state, ctx, gross) // 税后净入账
  const tax = gross - net
  state.wallet.isk += net
  state.escrowItems[goodKey] = Math.max(0, (state.escrowItems[goodKey] ?? 0) - sold)
  const pool = mk.pools[goodKey]
  if (pool) {
    pool.netVol -= sold
    if (def.poolTarget && def.poolTarget > 0) pool.q += sold
  }
  if (sold > 0) {
    const bonusNote = mult > 1 ? '（含协会声望加成）' : ''
    const taxNote = tax > 0 ? `，贸易税 ${tax.toLocaleString('zh-CN')} ISK` : ''
    addLog(state, 'trade', `市价售出 ${goodName(ctx, goodKey)}×${sold.toLocaleString('zh-CN')}（税后入账 ${net.toLocaleString('zh-CN')} ISK，${fillPrices.length} 笔）${bonusNote}${taxNote}。`)
  }
  if (remaining > 0 && sold > 0) {
    const edge = fillPrices[fillPrices.length - 1]!
    // 剩余自动按边际价挂限价卖单（货已在 escrow 中，不再重复锁定；挂单不收费）
    pushSellOrder(state, goodKey, edge, remaining)
    addLog(state, 'info', `市价单成交 ${sold.toLocaleString('zh-CN')} 后簿已吃穿，剩余 ${remaining.toLocaleString('zh-CN')} 自动挂限价卖单（免费）。`)
  } else if (remaining > 0) {
    addLog(state, 'info', '市场收购簿为空，暂时无人收购——可挂限价卖单等收购单浮现。')
  }
  return { sold, total: net, avg: sold > 0 ? Math.round(net / sold) : 0, remaining }
}

/** 市价买入：立即吃 npcSell 簿；簿吃穿后提示改挂限价单。受声望门槛商品直接拒绝（空手返回）。
 * shipUid：本次成交（kind=ship 商品）最后入队的一艘舰船实例 uid（购买流程"买完即登舰"用；非船商品为 null） */
export function buyAtMarket(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty: number,
): { bought: number; total: number; avg: number; remaining: number; shipUid: string | null } {
  ensureMarket(state, ctx)
  const mk = state.market
  const def = ctx.marketGoods.get(goodKey)
  if (!def || qty <= 0) return { bought: 0, total: 0, avg: 0, remaining: qty, shipUid: null }
  if (goodLockedReason(state, def) !== null) return { bought: 0, total: 0, avg: 0, remaining: qty, shipUid: null }
  let remaining = qty
  let total = 0
  let shipUid: string | null = null
  const sellList = mk.npcSell[goodKey] ?? []
  const sorted = [...sellList].sort((a, b) => a.price - b.price)
  for (const npc of sorted) {
    if (remaining <= 0) break
    const take = Math.min(remaining, npc.qty)
    const value = take * npc.price
    if (state.wallet.isk < value) break
    const idx = sellList.indexOf(npc)
    if (idx < 0) continue
    state.wallet.isk -= value
    total += value
    remaining -= take
    const depUid = depositGood(state, ctx, goodKey, take)
    if (depUid) shipUid = depUid
    npc.qty -= take
    if (npc.qty <= 0) sellList.splice(idx, 1)
  }
  const bought = qty - remaining
  const pool = mk.pools[goodKey]
  if (pool) {
    pool.netVol += bought
    if (def.poolTarget && def.poolTarget > 0) pool.q = Math.max(0, pool.q - bought)
  }
  if (bought > 0) {
    addLog(state, 'trade', `市价购入 ${goodName(ctx, goodKey)}×${bought.toLocaleString('zh-CN')}（${total.toLocaleString('zh-CN')} ISK）。`)
  }
  if (remaining > 0) {
    addLog(state, 'info', `市价买入成交 ${bought.toLocaleString('zh-CN')} 后供应簿吃穿，剩余 ${remaining.toLocaleString('zh-CN')}——可稍等补给或挂限价买单。`)
  }
  return { bought, total, avg: bought > 0 ? Math.round(total / bought) : 0, remaining, shipUid }
}

/** 舰船是否可出售：在机库、非驾驶中、无 AI 任务、未锁定、不在换船善后返航中、货仓空、无装配 */
export function shipSellable(state: GameState, shipId: string): { ok: boolean; reason?: string } {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return { ok: false, reason: '机库里没有这艘船。' }
  if (state.shipId === shipId) return { ok: false, reason: '正在驾驶的船不能出售。' }
  if (state.aiAssignments[shipId]) return { ok: false, reason: 'AI 任务执行中的船不能出售，先取消指派。' }
  if (isShipLocked(state, shipId)) return { ok: false, reason: '该船已锁定防误售：先到舰船页解锁。' }
  if (shipInReturn(state, shipId)) return { ok: false, reason: '该船正在返航卸货（换船善后），到港后才能出售。' }
  const cargoUnits = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
  if (cargoUnits > 0) return { ok: false, reason: '货仓里有物品，请先清空。' }
  if (allFittedIds(fleetShip.fitted).length > 0) {
    return { ok: false, reason: '还装着模块，请先卸下。' }
  }
  return { ok: true }
}

/**
 * 舰船市价出售：校验 → 移出舰队（escrow）→ 立即吃收购簿。
 * 若簿瞬时空 → 转为限价挂单（免费；撤单可退回机库）。
 * 返回 total = 税后净入账。
 */
export function sellShipAtMarket(state: GameState, ctx: SimContext, shipId: string): { ok: boolean; total?: number; reason?: string } {
  const check = shipSellable(state, shipId)
  if (!check.ok) return check
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return { ok: false, reason: '机库里没有这艘船。' }
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === fleetShip.defId)
  if (!def) return { ok: false, reason: '该舰船不在市场流通目录中。' }
  const display = shipDisplayName(state, ctx, shipId)
  const quote = marketQuote(state, ctx, def.key)
  const bestBuyPrice = quote.buy
  // 估价：当前收购价；无收购单时按均衡收购价 ×0.98 作为挂单价
  const est = bestBuyPrice ?? Math.round(buyPrice(def, priceLevel(state, ctx, def, def.poolTarget ?? 0)) * 0.98)
  const order = placeShipSellOrder(state, ctx, shipId, est)
  if (!order) return { ok: false, reason: '无法挂单：请检查船的状态。' }
  // 立即撮合一轮（只可能吃掉刚挂上的这单 → 成交或留在簿上）
  matchPlayerOrders(state, ctx)
  if (order.qty <= 0) {
    const gross = order.filled * order.price
    return { ok: true, total: netAfterTax(state, ctx, gross) }
  }
  addLog(state, 'info', `「${display}」未能立即成交，已转为限价卖单（撤销卖单可把船退回机库）。`)
  return { ok: true }
}

/** 把整船挂上限价卖单（escrow 锁船；撤单退回机库并保留耐久/自定义名） */
export function placeShipSellOrder(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  price: number,
): PlayerOrder | null {
  const check = shipSellable(state, shipId)
  if (!check.ok || price <= 0) return null
  const fleetShip = state.fleet[shipId]!
  const def = [...ctx.marketGoods.values()].find((g) => g.kind === 'ship' && g.refId === fleetShip.defId)
  if (!def) return null
  const display = shipDisplayName(state, ctx, shipId)
  const hold = {
    shipId,
    defId: fleetShip.defId ?? uidDefId(shipId),
    durability: fleetShip.durability,
    customName: fleetShip.customName ?? null,
  }
  delete state.fleet[shipId]
  state.market.orderSeq += 1
  const order: PlayerOrder = {
    id: state.market.orderSeq,
    side: 'sell',
    good: def.key,
    price: Math.round(price),
    qty: 1,
    filled: 0,
    placedAtGameMs: state.gameMs,
  }
  state.orders.push(order)
  state.escrowShips[order.id] = hold
  addLog(state, 'trade', `已挂卖单：二手舰船「${display}」@ ${order.price.toLocaleString('zh-CN')} ISK（可撤销退回机库）。`)
  return order
}

/** 学习蓝图（消耗 1 本 → 永久学会；重复蓝图只能放市场交易） */
export function learnBlueprint(state: GameState, ctx: SimContext, blueprintId: string): { ok: boolean; error?: string } {
  const known = ctx.blueprints.get(blueprintId) ?? ctx.shipBlueprints.get(blueprintId)
  if (!known) return { ok: false, error: `未知蓝图：${blueprintId}。` }
  const count = state.blueprintStock[blueprintId] ?? 0
  if (count <= 0) return { ok: false, error: '没有可学习的蓝图书。' }
  if (state.learnedRecipes.includes(blueprintId)) {
    return { ok: false, error: '该配方已学会——多余的蓝图书可以挂到市场出售。' }
  }
  state.blueprintStock[blueprintId] = count - 1
  if (state.blueprintStock[blueprintId] === 0) delete state.blueprintStock[blueprintId]
  state.learnedRecipes.push(blueprintId)
  addLog(state, 'info', `已学习「${known.name}」：可前往组装机无限次制造。`)
  return { ok: true }
}

/** 从"自然库存"扣货并计入 escrow（物品→仓库、装备→装备库、蓝图→蓝图书架、核心→核心库）；数量不足返回 false */
function lockNaturalStock(state: GameState, def: MarketGoodDef, n: number): boolean {
  if (n <= 0) return false
  let ok = false
  if (def.kind === 'item') ok = removeWare(state, def.refId, n)
  else if (def.kind === 'module') ok = removeModule(state, def.refId, n)
  else if (def.kind === 'blueprint') {
    const c = state.blueprintStock[def.refId] ?? 0
    if (c >= n) {
      state.blueprintStock[def.refId] = c - n
      if (state.blueprintStock[def.refId] === 0) delete state.blueprintStock[def.refId]
      ok = true
    }
  } else if (def.kind === 'aicore') ok = spendAiCores(state, def.refId as never, n)
  if (ok) state.escrowItems[def.key] = (state.escrowItems[def.key] ?? 0) + n
  return ok
}

/** 自然库存持有量（市场页展示"我的可卖"用：物品→仓库、装备→装备库、蓝图→书架、核心→核心库） */
export function naturalHoldings(state: GameState, def: MarketGoodDef): number {
  if (def.kind === 'item') return countWare(state, def.refId)
  if (def.kind === 'module') return countModule(state, def.refId)
  if (def.kind === 'blueprint') return state.blueprintStock[def.refId] ?? 0
  if (def.kind === 'aicore') return countAiCore(state, def.refId as never)
  return 0
}

/** 市价卖出持有的商品（市场页用）：自动从"自然库存"取货（物品→物品仓库、装备→装备库、
 * 蓝图→蓝图书架、AI 核心→核心库闲置数）；数量省略 = 全卖。舰船请走 sellShipAtMarket/船坞。 */
export function marketSellHolding(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty?: number,
): { ok: boolean; error?: string; sold: number; total: number; remaining: number } {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return { ok: false, error: `未知商品：${goodKey}`, sold: 0, total: 0, remaining: 0 }
  if (def.playerSellable === false) return { ok: false, error: '该商品不支持玩家出售。', sold: 0, total: 0, remaining: 0 }
  if (def.kind === 'ship') {
    return { ok: false, error: '舰船请在船坞/舰船页出售（需货仓清空、无装配）。', sold: 0, total: 0, remaining: 0 }
  }
  const available = naturalHoldings(state, def)
  const want = qty === undefined ? available : Math.max(0, Math.floor(qty))
  if (want <= 0 || available <= 0) {
    return { ok: false, error: '没有可卖的库存。', sold: 0, total: 0, remaining: 0 }
  }
  const n = Math.min(want, available)
  if (!lockNaturalStock(state, def, n)) return { ok: false, error: '取货失败。', sold: 0, total: 0, remaining: 0 }
  const res = sellAtMarket(state, ctx, goodKey, n)
  return { ok: true, sold: res.sold, total: res.total, remaining: res.remaining }
}

/**
 * 市价卖出预览（只读，不改任何状态；船长 2026-09-05：全部卖出前需向玩家展示实际成交与到账）：
 * 与 sellAtMarket 同源模拟——按收购簿出价从高到低逐单吃到簿穿/数量尽；
 * 返回可成交件数、成交毛额、贸易税、税后净到账与剩余（剩余将自动挂限价卖单，不计入本次到账）。
 */
export function marketSellPreview(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  qty?: number,
): { ok: boolean; error?: string; avail: number; want: number; fillable: number; orders: number; gross: number; tax: number; net: number; leftover: number } {
  const def = ctx.marketGoods.get(goodKey)
  const zero = { avail: 0, want: 0, fillable: 0, orders: 0, gross: 0, tax: 0, net: 0, leftover: 0 }
  if (!def) return { ok: false, error: `未知商品：${goodKey}`, ...zero }
  if (def.playerSellable === false) return { ok: false, error: '该商品不支持玩家出售。', ...zero }
  if (def.kind === 'ship') {
    return { ok: false, error: '舰船请在船坞/舰船页出售（需货仓清空、无装配）。', ...zero }
  }
  const avail = naturalHoldings(state, def)
  const want = qty === undefined ? avail : Math.max(0, Math.floor(qty))
  const n = Math.min(want, avail)
  if (n <= 0 || avail <= 0) return { ok: false, error: '没有可卖的库存。', ...zero, avail, want }
  let remaining = n
  let total = 0
  let orders = 0
  const buyList = state.market.npcBuy[goodKey] ?? []
  const sorted = [...buyList].sort((a, b) => b.price - a.price)
  for (const npc of sorted) {
    if (remaining <= 0) break
    const take = Math.min(remaining, npc.qty)
    total += take * npc.price
    remaining -= take
    orders += 1
  }
  const sold = n - remaining
  const mult = sellStandingMult(state, def) * marketSellSkillMult(state, def.kind)
  const gross = Math.round(total * mult)
  const net = netAfterTax(state, ctx, gross)
  return { ok: true, avail, want: n, fillable: sold, orders, gross, tax: gross - net, net, leftover: remaining }
}

/** 挂限价卖单（市场页用）：从自然库存锁定货入 escrow 后挂单；撤单自动退回原库存 */
export function listSellHolding(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  price: number,
  qty?: number,
): { ok: boolean; error?: string; orderId?: number; price?: number } {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return { ok: false, error: `未知商品：${goodKey}` }
  if (def.playerSellable === false) return { ok: false, error: '该商品不支持玩家出售。' }
  if (def.kind === 'ship') return { ok: false, error: '舰船请走整船挂单（舰船页出售入口）。' }
  const available = naturalHoldings(state, def)
  const want = qty === undefined ? available : Math.max(0, Math.floor(qty))
  if (want <= 0 || available <= 0) return { ok: false, error: '没有可卖的库存。' }
  if (price <= 0 || price > def.basePrice * ctx.balance.market.maxPriceRatio) {
    return { ok: false, error: '挂单价异常（需为 0 以上的 ISK，且不超过限价上限）。' }
  }
  const n = Math.min(want, available)
  if (!lockNaturalStock(state, def, n)) return { ok: false, error: '取货失败。' }
  const order = pushSellOrder(state, goodKey, price, n)
  addLog(state, 'trade', `已挂卖单：${goodName(ctx, goodKey)}×${n.toLocaleString('zh-CN')} @ ${order.price.toLocaleString('zh-CN')} ISK。`)
  return { ok: true, orderId: order.id, price: order.price }
}
