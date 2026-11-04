import { ceilFinalQuantity } from '../quantity'
import type { GameState } from '../state'
import type { MarketBalance, MarketGoodDef, MarketRarity, SimContext } from '../types'
import { DSI_FACTION_ID, standingOf } from '../standing'

/* ═══════════ 建站收购网络扩容（2026-09-09 船长定：每建成一座副站，协会收购网扩容，
 * 玩家"单件商品"卖出吞吐 ×1.5，乘法叠加无封顶——只作用于单件商品（装备/蓝图/船等件货的
 * NPC 收购单与站内吸收配额），池商品（矿石/矿物/弹药等大宗）不受影响。见
 * docs/design/market-station-sell-expansion.md）═══════════ */

/** 已建成副站数（stage ≥ 全部档位；驱动卖出扩容倍率） */
export function builtStationCount(state: GameState, ctx: SimContext): number {
  let n = 0
  for (const site of ctx.stations.values()) {
    const p = state.stationSites[site.id]
    if (p && p.stage >= site.tiers.length) n += 1
  }
  return n
}

/** 玩家卖出侧扩容倍率 = builtSellMulPerSite^N（N = 已建成副站数；池商品不乘） */
export function builtSellBoost(state: GameState, ctx: SimContext): number {
  return Math.pow(ctx.balance.market.builtSellMulPerSite, builtStationCount(state, ctx))
}

/**
 * 协会声望卖出加成：物品类（矿石/矿物）成交价 ×(1 + 声望×1%)，上限 +15%（v4 规则延续）。
 *
 * ⚠ **2026-09-26 船长令**：「**修改原先的所有声望门槛，改为根据玩家的累计声望**」⇒ 读**累计获得**
 * 那一本（`standing.standingOf`）。理由：这是"声望练到多少"的收益，属**成长读数**；
 * 若读可支配那本，去章鱼人那里换几张图纸就会把卖出加成打回去（换图纸是消费，不是退步）。
 */
export function sellStandingMult(state: GameState, def: MarketGoodDef | undefined): number {
  if (!def || def.kind !== 'item') return 1
  return 1 + Math.min(0.15, standingOf(state, DSI_FACTION_ID) * 0.01)
}

/**
 * 当前贸易税率（销售税）：基础 5% × (1 − 8%×(会计学级 + 贸易谈判学级))；
 * 双技能满级合计减免 80% → 1%。税率只针对"玩家卖出成交"（买入/挂单不收）。
 * 2026-09-08（船长定）：移除「减免 100%」防负护栏——技能等级上限内不会越界，税率下限 0。
 */
export function salesTaxRate(state: GameState, ctx: SimContext): number {
  const bal = ctx.balance.market
  const lvA = state.skills.trained[bal.taxSkillAId] ?? 0
  const lvB = state.skills.trained[bal.taxSkillBId] ?? 0
  const cut = bal.taxCutPerLevel * (lvA + lvB)
  return Math.max(0, bal.salesTaxRate * (1 - cut))
}

/** 毛额（声望加成后）→ 税后净入账 */
export function netAfterTax(state: GameState, ctx: SimContext, gross: number): number {
  return gross - ceilFinalQuantity(gross * salesTaxRate(state, ctx))
}

/* ═══════════ 价格 ═══════════ */

/** 均衡价 L：池商品 = base×库存压力×(1+冲击)·(1+慢速噪声)；单件 = base×(1+冲击)·(1+噪声)。输出按比例钳制防失控 */
/**
 * **倾销惩罚层数 → NPC 买单挂单量放大**（2026-09-11 船长：「提高倾销惩罚，同时每层惩罚还会提高
 * 系数一半的订单量」→ 追问后定「**修改为每层提高 8% 买单数量**」「**所有商品都适用**」；
 * **2026-09-17 船长改判**：「买单量 +8%/层…**分别改为 +40%/−40% 每层，并且是乘法叠加**」
 * ⇒ 本函数公式由线性 `1 + 0.4×层` 改为**乘幂** `(1 + 0.4)^层`）。
 *
 * 层数 = **当前未衰减的净惩罚层数** = `|shock| ÷ shockPerTrigger`（**不取整**——衰减中的半层也按比例算，
 * 量随行情平滑回落，不会卡在整层上）；只在**砸盘方向**（`shock < 0`）放大：玩家买入把价格顶上去时
 * 不动买单量（那不是"惩罚"）。所有商品共用本单点：池商品收购阶梯、单件平价品、稀有、奇货、开局铺簿。
 * ⚠ 量级：砸盘稳态 8.2 层 ⇒ **×15.8**（旧线性口径 ×1.66）；9.2 层 ⇒ ×21.9。
 */
export function dumpBuyVolumeMul(pool: { shock?: number } | undefined, bal: MarketBalance): number {
  const shock = pool?.shock ?? 0
  if (!(shock < 0)) return 1
  const layers = Math.abs(shock) / Math.max(1e-9, bal.shockPerTrigger)
  return Math.pow(1 + bal.dumpBuyVolumePerLayer, layers) // 乘法叠加（船长 2026-09-17）
}

/**
 * **砸盘时 NPC 挂卖单量的同步削减**（2026-09-11 船长：「砸盘时，挂卖单的量进行同步削减」；
 * **2026-09-17 船长改判**：「…卖单量 −8%/层…**改为 −40% 每层，并且是乘法叠加**」⇒ `0.6^层数`）：
 * 与买单放大对称，下限 10%（不把供应簿削光）。⚠ `0.6^层数` 在 ~4.5 层即撞下限 ⇒ 深砸盘时供应侧停摆。
 * 方向同样是**只在砸盘方向生效**；池商品供应阶梯共用本单点（单件/稀有/奇货的供应单恒为 1 张，不适用）。
 */
export function dumpSellVolumeMul(pool: { shock?: number } | undefined, bal: MarketBalance): number {
  const shock = pool?.shock ?? 0
  if (!(shock < 0)) return 1
  const layers = Math.abs(shock) / Math.max(1e-9, bal.shockPerTrigger)
  return Math.max(0.1, Math.pow(1 - bal.dumpSellVolumePerLayer, layers)) // 乘法叠加（船长 2026-09-17）
}

export function priceLevel(state: GameState, ctx: SimContext, def: MarketGoodDef, poolQ: number): number {
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

/** 收购档位（2026-09-08 船长定：单件收购 = 该档 × L；防套利——收购恒低于供应、倒卖亏税） */
export const BUY_TIER: Record<MarketRarity, number> = {
  common: 0.6,
  rare: 0.65,
  exotic: 1.0,
}

/** 商品收购倍率（数据目录 demandMultiplier 优先；缺省按 rarity 档位）——UI 默认卖价同源用 */
export function acquisitionFactorOf(def: MarketGoodDef): number {
  return def.demandMultiplier ?? BUY_TIER[def.rarity]
}

/** 当前收购价线（引擎吸收/抢单基准 buyPrice 同源；UI 提示与默认卖价须用它——簿最高价含 jitter，
 * 若当基准展示，UI 显示的"平价档"与引擎实际通道会在 ±2% 临界带错位） */
export function buyLineOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const poolQ = state.market.pools[goodKey]?.q ?? 0
  return ceilFinalQuantity(buyPrice(def, priceLevel(state, ctx, def, poolQ)))
}

/** 当前供应价线（sellPrice 同源；买单默认价/低挂提示基准） */
export function askLineOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const poolQ = state.market.pools[goodKey]?.q ?? 0
  return ceilFinalQuantity(sellPrice(def, priceLevel(state, ctx, def, poolQ)))
}

/** 收购单价（NPC 收玩家的价）：池商品 = L × 倍率（原料留空 = 1.0 平价；弹药/修理件/无人机等
 * 池耗材显式 0.6）；单件 = 档位倍率 × L（common 0.6 / rare 0.65 / exotic 1.0）；delta = 档位差 */
export function buyPrice(def: MarketGoodDef, L: number, delta = 0): number {
  const tier = def.poolTarget && def.poolTarget > 0 ? (def.demandMultiplier ?? 1) : acquisitionFactorOf(def)
  return ceilFinalQuantity(L * tier * (1 + delta))
}

/** 供应单价（NPC 卖给玩家的价）：池商品微溢（+6%，至少 +1 ISK，防整数取整后与收购价同价）；
 * 单件 = supplyMultiplier×L（默认 1 = 平价） */
export function sellPrice(def: MarketGoodDef, L: number, delta = 0): number {
  const base = def.poolTarget && def.poolTarget > 0 ? Math.max(L * 1.06, L + 1) : L * (def.supplyMultiplier ?? 1)
  return ceilFinalQuantity(base * (1 + delta))
}

/** 当前均衡价 L（展示/估价用；不含单边价差与 jitter） */
export function levelOf(state: GameState, ctx: SimContext, goodKey: string): number {
  const def = ctx.marketGoods.get(goodKey)
  if (!def) return 0
  const q = state.market.pools[goodKey]?.q ?? def.poolTarget ?? 0
  return priceLevel(state, ctx, def, q)
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
