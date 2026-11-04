import { ceilFinalQuantity } from '../quantity'
import type { GameState } from '../state'
import type { MarketBalance, MarketGoodDef, SimContext } from '../types'
import { nextInt, nextRandom, pickWeighted } from '../rng'
import { ironmanCommonFlowMul, ironmanExoticCapBonus, ironmanExoticWeightMul, ironmanRareWeightMul } from '../ironman'
import { hasLimitedSupply } from '../marketLimitedSupply'
import { priceLevel, sellPrice, dumpBuyVolumeMul, buyPrice, dumpSellVolumeMul, builtSellBoost } from './pricing'
import { bestBuy, npcPushSell, npcPushBuy } from './book'
import { SWEEP_PER_LEVEL, SECONDHAND_PER_LEVEL, RARE_PCT_MIN, RARE_PCT_MAX, RARE_LIFE_MUL, RARE_LOCKED_WEIGHT, EXOTIC_CAP_PER_DRAW } from './constants'
import { bmGateLocked } from './access'

/** 行数字稀有度 → 稀有订单渠道权重乘子（2026-09-09 船长拍板：稀有度入物品本体 RARITY_TIER，
 * 只驱动稀有订单渠道——卖单抽取权重 + NPC 收购窗概率；奇货渠道出率与数字不挂钩）。
 *
 * ⟪**2026-09-25 船长令（现行）**⟫：「**2~5稀有度的稀有订单，权重调整为 1/0.5/0.2/0.05**」
 * ⇒ **档 2 ×1 · 档 3 ×0.5 · 档 4 ×0.2 · 档 5 ×0.05**（四个数一次给全）。
 *
 * 沿革（**别照旧文重开**）：
 * - 2026-09-09 立表：只给档 3 系数 = 0.25（档 2 = 1；档 4/5 落 `else` ⇒ ×1）；
 * - 2026-09-10：0.25 → **0.15**（「高阶稀有订单更难碰」，实测 tier3 占比 10% → 6%）；
 * - 2026-09-16 选「选项 B」：补档 4 系数 **0.05**（此前档 4 也拿 ×1 ≈32 分钟一件）；
 * - ⚠ **档 5 一直没有系数**（2026-09-20 记账"要系数另立条目"，但没立）⇒ 它按 ×1 与大众档同频，
 *   实测 `bp-shieldfield-3`（档 5）**68 窗 ≈11.4h** 反而比 `bp-shieldfield-2`（档 4，214 窗 ≈35.7h）
 *   常见 3 倍 —— **本次一并修好**。 */
function rareTierWeight(def: MarketGoodDef, ctx: SimContext): number {
  const m = ctx.balance.market
  if (def.rarityTier === 5) return m.rareTier5Weight ?? 0.05
  if (def.rarityTier === 4) return m.rareTier4Weight ?? 0.2
  return def.rarityTier === 3 ? (m.rareTier3Weight ?? 0.5) : 1
}

/** 蓝图书权重乘子（2026-09-10 船长定：**50% → 5%**）——稀有卖单抽取与奇货掷骰**两个渠道共用**；
 * 非蓝图行 = 1。降到 5% 后蓝图让出的份额全部回到同渠道的现货装备/商品上（稀有渠道每窗张数不变）。
 *
 * **2026-09-13 船长（一次性舰船蓝图）**：「还是有惩罚吧，**按50%算**」⇒
 * 一次性舰船蓝图（`ctx.shipBlueprints` 里 `singleUse === true` 的那批）走
 * `balance.market.singleUseBlueprintWeight`（0.5），**不吃普通蓝图那档 ×0.05**——
 * 理由是它是消耗品（造一艘吃一张），不是"学会即量产"的配方。
 *
 * ⚠ **导出仅供白盒回归测试调用**（与 `slowSupplyDraw` 同款处置）：口径 = 两个渠道共用。 */
export function blueprintWeight(def: MarketGoodDef, ctx: SimContext): number {
  if (def.kind !== 'blueprint') return 1
  const refId = def.refId
  if (refId && ctx.shipBlueprints?.get(refId)?.singleUse === true) {
    return ctx.balance.market.singleUseBlueprintWeight ?? 0.5
  }
  return ctx.balance.market.blueprintWeight ?? 0.05
}

/** 价格阶梯只是独立余额的分档，过期/换价不创造新库存，也不受经济池断供门影响。 */
export function refreshLimitedSupplyBook(state: GameState, ctx: SimContext, def: MarketGoodDef, now: number): void {
  const pool = state.market.pools[def.key]!
  const remaining = pool.limitedSupply?.remaining ?? 0
  const L = priceLevel(state, ctx, def, pool.q)
  const base = Math.max(sellPrice(def, L), (bestBuy(state.market.npcBuy[def.key]!.filter(o => !o.relay)) ?? 0) + 1)
  const step = Math.max(1, ceilFinalQuantity(base * 0.04))
  const shares = [Math.ceil(remaining * 0.3), Math.floor(remaining * 0.35)]
  shares.push(remaining - shares[0]! - shares[1]!)
  state.market.npcSell[def.key] = [...state.market.npcSell[def.key]!.filter(o => o.relay), ...shares.flatMap((qty, i) => qty > 0 ? [{
    price: base + i * step, qty, expiresAtGameMs: now + orderLifeMsOf(def, ctx.balance.market),
  }] : [])]
}

/** 常驻商品开局簿（openAtMs = 开盘时刻：订单寿命与簿面基准） */
export function seedCommonBook(state: GameState, ctx: SimContext, def: MarketGoodDef, openAtMs: number): void {
  const mk = state.market
  const life = ctx.balance.market.orderLifeMs.common
  const now = openAtMs
  const L = priceLevel(state, ctx, def, def.poolTarget ?? 0)
  const sellable = def.playerSellable !== false
  /**
   * **只收不卖 ⇒ 一笔 NPC 卖单都不铺**；虚空晶2026-10-06改走限额慢补货，母矿仍受此门约束。
   *
   * 原实现**无条件**铺卖单（池商品 `flow×0.8` 一笔 / 单件平价品两笔）⇒ 货架上挂着"买不了"的卖单：
   * 实测 `box-relic-a`（洞内货柜，`playerBuyable: false`）开盘就有 **2 件卖单**，点买入被
   * `buyGood` 的 `not-buyable` 拦下——簿面与口径不一致。现按 `playerBuyable` 收口（与
   * `slowSupplyDraw` / 供应阶梯两处既有门同一把尺）；**收购侧（`npcBuy`）不受影响**。
   */
  const buyable = def.playerBuyable !== false
  // 开局/目录扩增铺簿同样吃"砸得越狠、买家越多"的倍率（常态 shock=0 ⇒ ×1，不改变开盘簿面）
  const buyVolMul = dumpBuyVolumeMul(state.market.pools[def.key], ctx.balance.market)
  if (def.poolTarget && def.poolTarget > 0) {
    const flow = def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))
    if (sellable) {
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L), qty: Math.max(1, ceilFinalQuantity(flow * buyVolMul)), expiresAtGameMs: now + life })
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L, -0.01), qty: Math.max(1, ceilFinalQuantity(flow * 1.25 * buyVolMul)), expiresAtGameMs: now + life })
    }
    if (buyable && !hasLimitedSupply(def)) {
      mk.npcSell[def.key]!.push({ price: sellPrice(def, L), qty: Math.max(1, ceilFinalQuantity(flow * 0.8)), expiresAtGameMs: now + life })
    }
    mk.pools[def.key]!.q = def.poolTarget
  } else {
    // 单件平价品（装备/蓝图/船/基础核心）：1 收购（qty 3，2026-09-08 船长定件数放大）+ 2 供应
    if (sellable) {
      mk.npcBuy[def.key]!.push({ price: buyPrice(def, L), qty: 3, expiresAtGameMs: now + life })
    }
    if (buyable && !hasLimitedSupply(def)) {
      mk.npcSell[def.key]!.push({ price: sellPrice(def, L), qty: 1, expiresAtGameMs: now + life })
      mk.npcSell[def.key]!.push({ price: sellPrice(def, L, 0.02), qty: 1, expiresAtGameMs: now + life })
    }
  }
}

/* ═══════════ P2 稀有/奇货抽取节拍（2026-09-06 船长定稿） ═══════════ */

/** 现货抢购学倍率（每级 +10%，上限 5 级 → ≤×1.5；rare 张数与奇货命中共用） */
function sweepMul(state: GameState): number {
  return 1 + SWEEP_PER_LEVEL * Math.min(5, state.skills.trained['source-sweeping'] ?? 0)
}

/** 二手市场学（卷B3⑪，2026-09-08 船长定：淘货折扣）——稀有供给单价格每级 −2%（满级 −10%）。
 *  只作用于 rare 类目供给单（slowSupplyDraw 刷出，含闸内 ×4 暗市单同乘——折后仍 ≫ 原价，
 *  声望解锁节奏不受影响）；奇货（exotic）不参与：其收购档 = 1.0L 全价回收，折价会击穿
 *  「收购 ≤1.0L < 供应」防套利不变式（买入折价单 → 全价回购 = 税后正利差印钱）。 */
function secondhandMul(state: GameState): number {
  return 1 - SECONDHAND_PER_LEVEL * Math.min(5, state.skills.trained['secondhand-market'] ?? 0)
}

/** rare 池构成：全市场 rare 商品中解锁（权重 1）与闸内（权重 RARE_LOCKED_WEIGHT）的数量 */
function rarePoolStats(state: GameState, ctx: SimContext): { unlockedN: number; lockedN: number } {
  let unlockedN = 0
  let lockedN = 0
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'rare') continue
    if (bmGateLocked(state, def)) lockedN += 1
    else unlockedN += 1
  }
  return { unlockedN, lockedN }
}

/** 本抽取窗 rare 供给张数 N：浮动百分比 × 已解锁件数（船长 2026-09-06 定：基数=已解锁件数、
 * 删除旧 4~9 张/批加成；加新商品自动按比例扩），现货抢购学放大；池内有货时至少抽 1 张。
 * **铁人福利 B**（2026-09-23 船长令「稀有订单出现权重 +100%」）⇒ 张数 ×2（非铁人 ×1，逐字不变）。 */
function rareDrawCount(state: GameState, stat: { unlockedN: number; lockedN: number }): number {
  if (stat.unlockedN + stat.lockedN <= 0) return 0
  const r = RARE_PCT_MIN + (RARE_PCT_MAX - RARE_PCT_MIN) * nextRandom(state.rng)
  return Math.max(1, ceilFinalQuantity(r * stat.unlockedN * sweepMul(state) * ironmanRareWeightMul(state)))
}

/** NPC 订单价格微扰 ±2%（每次调用消耗一枚随机数） */
function priceJitter(state: GameState): number {
  return 1 + (nextRandom(state.rng) - 0.5) * 0.04
}

/** 订单寿命：rare ×RARE_LIFE_MUL（36 分钟）；**蓝图书另按 balance.blueprintLifeMs（6 小时，
 *  2026-09-10 船长定）**——权重降到 5% 后书出得稀，36 分钟只会让玩家错过；
 *  奇货/常驻按 balance（奇货 6h，2026-09-06 船长定） */
function orderLifeMsOf(def: MarketGoodDef, bal: MarketBalance): number {
  if (def.kind === 'blueprint' && def.rarity === 'rare') return Math.round(bal.blueprintLifeMs)
  return Math.round(bal.orderLifeMs[def.rarity] * (def.rarity === 'rare' ? RARE_LIFE_MUL : 1))
}

/** 抽取命中一张 rare 供给单：解锁原价；闸内 = ×4 暗市单（标 bm，外观同普通稀有单，玩家向隐身）。
 * 数量：**每张恒 1 件**（船也是 1 艘）——⟪**2026-09-25 船长令**⟫「**每次恒 1 件**」。
 * ⚠ **旧口径（已作废）**：单件商品 = `1 + nextInt(rng, 3)` ⇒ 一次抽中随机给 **1/2/3 件**；
 * 玩家报障「**单件相同的商品，一次性刷出了 3 件**」即出自这里
 * （读真档推进 3 小时实测：供给侧 `rare · module` 单张最大 **3 件**、`rare · blueprint` 最大 3 件；
 *  奇货与船的供给单本来就是 1 件 ⇒ **只有稀有这一档会"一次 2~3 件"**）。
 * **消耗品批量档**（`rareQtyMul`，2026-09-20 船长令）⇒ 单张件数 ×本值
 * （弹药 MK2 = 200；⚠ 基数恒 1 之后它由「200~600 发/张」变为「**200 发/张**」——**倍率本身一字未动**）。
 * 价格：原价/×4 之上再乘 二手市场学折扣（卷B3⑪；见 secondhandMul）。 */
function spawnRareSupply(state: GameState, ctx: SimContext, def: MarketGoodDef, now: number, locked: boolean): void {
  const poolQ = state.market.pools[def.key]?.q ?? 0
  const L = priceLevel(state, ctx, def, poolQ)
  const lifeMs = orderLifeMsOf(def, ctx.balance.market)
  // 船恒 1 艘；其余单件商品恒 1 件，只有消耗品的批量档倍率照旧乘入。
  // ⚠ **仍掷一次骰但丢弃结果**：本函数原口径是 `1 + nextInt(rng, 3)`，少掷一枚会**整体推移 rng 序列**
  // ⇒ 市场慢噪声/价线的轨迹跟着变（实测：`market.test.ts` 的"站内让利吸收"一条当场红）。
  // 这与 2026-09-11 稀有残骸保底的「**恒掷一次随机数**（只取 `||`）」是同一款时序纪律。
  if (def.kind !== 'ship') void nextInt(state.rng, 3)
  const qty = def.kind === 'ship' ? 1 : Math.max(1, ceilFinalQuantity(def.rareQtyMul ?? 1))
  const price = ceilFinalQuantity(sellPrice(def, L) * priceJitter(state) * secondhandMul(state) * (locked ? 4 : 1))
  npcPushSell(state, ctx, def, poolQ, now, lifeMs, price, qty, locked)
}

/** 抽取命中一张奇货供给单：原价、单张、寿命 6h（balance orderLifeMs.exotic） */
function spawnExoticSupply(state: GameState, ctx: SimContext, def: MarketGoodDef, now: number): void {
  const poolQ = state.market.pools[def.key]?.q ?? 0
  const L = priceLevel(state, ctx, def, poolQ)
  const lifeMs = orderLifeMsOf(def, ctx.balance.market)
  const price = ceilFinalQuantity(sellPrice(def, L) * priceJitter(state))
  npcPushSell(state, ctx, def, poolQ, now, lifeMs, price, 1, false)
}

/** 每 RARE_DRAW_PERIOD_MS 一次（10 分钟）：rare 加权有放回抽取 + 奇货掷骰（超上限随机抽选）。
 * 抽取时刻 = 常规 60s 窗口的整倍数对齐点（slowDrawLastGameMs 由 ensureMarket 开盘补齐）。
 * 导出仅供"蓝图书权重口径"回归测试白盒调用；引擎内部推进走 processWindow。 */
export function slowSupplyDraw(state: GameState, ctx: SimContext, now: number): void {
  const stat = rarePoolStats(state, ctx)
  // ── rare：N 张加权有放回抽取（同窗可重复抽中同一类型）──
  const n = rareDrawCount(state, stat)
  if (n > 0) {
    const defs: MarketGoodDef[] = []
    let totalW = 0
    // 蓝图书权重 ×blueprintWeight（2026-09-10 船长定 5%；旧值 0.5）；闸内另乘 RARE_LOCKED_WEIGHT；
    // 数字稀有度 3 档 ×rareTier3Weight（2026-09-09：稀有订单层内分层，2 大众基准 1）
    const wOf = (def: MarketGoodDef): number =>
      blueprintWeight(def, ctx) *
      (bmGateLocked(state, def) ? RARE_LOCKED_WEIGHT : 1) *
      rareTierWeight(def, ctx) *
      Math.max(1, def.rareWeightMul ?? 1)
    for (const def of ctx.marketGoods.values()) {
      if (def.rarity !== 'rare' || def.playerBuyable === false) continue // 只收商品（残骸等）不出供给单
      defs.push(def)
      totalW += wOf(def)
    }
    for (let i = 0; i < n; i++) {
      // 2026-09-12 审计 B3：改走单点 `pickWeighted`（原累加循环 `acc += w; hit < acc` 就是它的 `lt` 口径，
      // 权重函数与上面的 `wOf` 同一份）；中选后才算一次锁定位（与改前 break 前那次一致）。
      const picked = pickWeighted(state.rng, defs, wOf)
      if (picked) spawnRareSupply(state, ctx, picked, now, bmGateLocked(state, picked))
    }
  }
  // ── 奇货：每件独立掷骰（**1%** × 现货抢购学；蓝图书再 ×blueprintWeight，同 5% 口径）；
  //    命中 > EXOTIC_CAP_PER_DRAW 张 → 随机抽选保留 ──
  const sweep = sweepMul(state)
  const winners: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'exotic' || def.playerBuyable === false) continue
    // **铁人福利 B**（2026-09-23 船长令「奇货订单权重 +100%」）⇒ 命中概率 ×2（封顶仍走 EXOTIC_CAP_PER_DRAW）
    const chance = ctx.balance.market.exoticWindowChance * sweep * blueprintWeight(def, ctx) * ironmanExoticWeightMul(state)
    if (nextRandom(state.rng) < chance) winners.push(def)
  }
  while (winners.length > EXOTIC_CAP_PER_DRAW + ironmanExoticCapBonus(state)) {
    winners.splice(nextInt(state.rng, winners.length), 1) // 随机抽选（每次删一张，结果均匀）
  }
  for (const def of winners) spawnExoticSupply(state, ctx, def, now)
}

/** 每 60s 窗口按商品刷单：common 常驻供需阶梯 + rare/奇货的 NPC 收购侧低频单（玩家卖出对手盘）。
 * 供给侧 rare/奇货订单不在此生成——由 slowSupplyDraw 每 RARE_DRAW_PERIOD_MS 统一抽取
 * （含闸内 ×4 暗市单；订单寿命见 orderLifeMsOf：rare 36 分钟、奇货 6h）。 */
export function refreshGoodOrders(state: GameState, ctx: SimContext, def: MarketGoodDef, poolQ: number, now: number): void {
  const mk = state.market
  const bal = ctx.balance.market
  const sellList = mk.npcSell[def.key]!
  const sellable = def.playerSellable !== false
  const lifeMs = orderLifeMsOf(def, bal)
  const L = priceLevel(state, ctx, def, poolQ)
  // **砸得越狠 → 来收货的买家越多**（船长 2026-09-11：每层未衰减惩罚把 **NPC 收购单量 +8%**，
  // 全部商品适用、只在砸盘方向生效）：本窗该商品的所有收购单一律乘这个倍率。
  const buyVolMul = dumpBuyVolumeMul(mk.pools[def.key], bal)
  // 砸盘时挂卖单量同步削减（与买单放大对称；只用于池商品供应阶梯）
  const sellVolMul = dumpSellVolumeMul(mk.pools[def.key], bal)
  // bmStanding 仅配置于 rare 商品：闸内 = ×4 价暗市单语义（含收购侧同规则）
  const locked = def.rarity === 'rare' && bmGateLocked(state, def)
  const priceMul = locked ? 4 : 1

  if (def.rarity === 'common') {
    if (def.poolTarget && def.poolTarget > 0) {
      // 池商品：按价格档铺阶梯（船长 2026-09-05：不要全部挤在一个价——不同档位不同价/量，低价品取整后也差 ≥1 ISK）
      // **铁人福利 B**（2026-09-23 船长令「常驻行情每窗刷单量 +200%」）⇒ 流量 ×3（买卖两侧阶梯同时放大；
      // 价格侧**不动** ⇒ 只影响"簿面有多厚"，不影响行情中枢）。非铁人 ×1 ⇒ 既有读数逐字不变。
      const flow = (def.supplyFlow ?? Math.max(1, Math.round(def.poolTarget / 120))) * ironmanCommonFlowMul(state)
      const avail = Math.max(0.05, Math.min(1.5, poolQ / def.poolTarget))
      const buyBase = ceilFinalQuantity(buyPrice(def, L)) // 最佳收购价 = L
      const sellBase = ceilFinalQuantity(sellPrice(def, L)) // 最低供应价 ≈ L×1.06
      const buyStep = Math.max(1, ceilFinalQuantity(buyBase * 0.04))
      const sellStep = Math.max(1, ceilFinalQuantity(sellBase * 0.04))
      // 收购阶梯：最佳档在 L，越深越便宜、量越大（墙）；每窗始终铺满 3 档（盘口稳定成阶梯，避免挤单一价）。
      // **量不再乘库存压力**（2026-09-11 船长：移除压力项；压力只留在价格侧）——量 = 流量 × 阶梯 × 补偿倍率，
      // 于是"砸得越狠 → 收购单量越大"全程成立，不再被池量淤积反向压制。
      for (let i = 0; i < 3; i += 1) {
        const price = Math.max(1, buyBase - i * buyStep)
        const qty = Math.max(1, ceilFinalQuantity(flow * (0.5 + 0.35 * i) * buyVolMul))
        npcPushBuy(state, ctx, def, now, lifeMs, price, qty)
      }
      // 供应阶梯：最低档在 L×1.06，越深越贵、量越大（playerBuyable=false 的只收商品不出售）。
      // **砸盘时挂卖单量同步削减**（2026-09-11 船长：每层未衰减惩罚 −8%）——价格崩了卖方缩手，
      // 与"买家变多"对称：砸得越狠，簿面上接货的越多、出货的越少。
      if (hasLimitedSupply(def)) {
        refreshLimitedSupplyBook(state, ctx, def, now)
      } else if (def.playerBuyable !== false) {
        for (let i = 0; i < 3; i += 1) {
          const price = Math.max(1, sellBase + i * sellStep)
          const qty = Math.max(1, ceilFinalQuantity(flow * avail * (0.5 + 0.35 * i) * sellVolMul))
          npcPushSell(state, ctx, def, poolQ, now, lifeMs, price, qty)
        }
      }
    } else {
      // 单件平价品：维持供应线与低价收购线（收购单 qty 3/张 ×建站扩容 boost，2026-09-08 件数放大 + 2026-09-09 扩容）
      const boost = builtSellBoost(state, ctx)
      if (nextRandom(state.rng) < 0.85) npcPushBuy(state, ctx, def, now, lifeMs, ceilFinalQuantity(buyPrice(def, L) * priceJitter(state)), Math.max(1, ceilFinalQuantity(3 * boost * buyVolMul)))
      // 常驻供给：蓝图书出现概率 −50%（2026-09-09 船长定——蓝图不走"簿薄必补"保底，纯 0.425 掷骰；
      // 收购侧不变：玩家回卖蓝图不受影响）
      const sellChance = def.kind === 'blueprint' ? 0.425 : 0.85
      if (hasLimitedSupply(def)) refreshLimitedSupplyBook(state, ctx, def, now)
      else if (
        def.playerBuyable !== false &&
        (def.kind === 'blueprint' ? nextRandom(state.rng) < sellChance : sellList.filter(o => !o.relay).length < 2 || nextRandom(state.rng) < sellChance)
      ) {
        npcPushSell(state, ctx, def, poolQ, now, lifeMs, ceilFinalQuantity(sellPrice(def, L) * priceJitter(state)), 1)
      }
    }
  } else if (def.rarity === 'rare') {
    // 玩家卖方向（二手/多余）：低频出现（每 60s 窗 3% ×建站扩容；qty 2/张 ×扩容；2026-09-08 船长定；
    // 闸内 ×4 收购价同规则；寿命同供给侧 36 分钟）
    // 2026-09-09 数字稀有度：稀有订单层内分层——3 档收购概率 ×rareTierWeight（同卖单权重表）
    // **2026-09-20 消耗品批量档**（`rareWeightMul` / `rareQtyMul`，船长令）：概率与单张件数同乘
    // ⇒ 弹药 MK2 这类消耗品在簿上"看得见在收"（否则一张单只有 2 件，玩家以为没人收购）
    const boost = builtSellBoost(state, ctx)
    const wMul = Math.max(1, def.rareWeightMul ?? 1)
    const qMul = Math.max(1, ceilFinalQuantity(def.rareQtyMul ?? 1))
    if (sellable && nextRandom(state.rng) < Math.min(0.9, 0.03 * boost * rareTierWeight(def, ctx) * wMul)) {
      npcPushBuy(state, ctx, def, now, lifeMs, ceilFinalQuantity(buyPrice(def, L) * priceMul), Math.max(1, ceilFinalQuantity(2 * boost * buyVolMul * qMul)), locked)
    }
  } else if (def.rarity === 'exotic') {
    // 玩家卖方向（二手/多余）：低频出现（每 60s 窗 1% ×建站扩容；寿命同供给侧 6h；qty ×扩容）
    const boost = builtSellBoost(state, ctx)
    if (sellable && nextRandom(state.rng) < Math.min(0.9, 0.01 * boost)) {
      npcPushBuy(state, ctx, def, now, lifeMs, ceilFinalQuantity(buyPrice(def, L)), Math.max(1, ceilFinalQuantity(boost * buyVolMul)))
    }
  }
}
