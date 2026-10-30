import type { GameState } from '../state'
import type { SimContext } from '../types'
import { nextRandom } from '../rng'
import { advanceLimitedSupply } from '../marketLimitedSupply'
import { ensureMarket } from './initialize'
import { refreshGoodOrders, slowSupplyDraw } from './supply'
import { RARE_DRAW_PERIOD_MS, PRICE_SAMPLE_MS, PRICE_HISTORY_LIMIT } from './constants'
import { matchPlayerOrders, absorbViaStation } from './matching'
import { priceLevel } from './pricing'
import { referenceVol } from './book'

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

  // 主循环：过期清理 → 池回归/冲击衰减 → 内部消化 → 刷单（common 阶梯 + 收购侧）
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
    advanceLimitedSupply(pool, def, dt, nextNow)
    pool.shock *= 1 - decayK
    // 慢速均值回归噪声：随机游走 + 向 0 回报，钳制 ±0.4（船长 2026-09-05：常驻行情"太稳定"，加真实起伏）
    pool.noise = Math.max(-0.4, Math.min(0.4, pool.noise * (1 - noiseK) + (nextRandom(state.rng) - 0.5) * bal.noiseStep))

    // 内部消化（冲突大单随时间推进消化）
    const dig = mk.digest[key]!
    if (dig.qty > 0) {
      dig.qty = Math.max(0, dig.qty - dig.perWindow)
      /**
       * **不变量：`qty === 0` ⇒ 价格与额度也归零**（2026-09-25 修）。
       * 存档清洗（`save.ts` 的市场段）只保留 `qty > 0` 的消化条目、其余按零值补回
       * ⇒ 若这里留着"排空后的残留价"，写出去会在读档时被丢成 0，**往返丢信息**
       * （`save.test.ts` 的"引擎跑过的档不许丢键"护栏抓到：`market.digest.<键>.price`）。
       * 归零后档面与引擎内存逐字一致（消化队列为空本就没有有效价格）。
       */
      if (dig.qty === 0) {
        dig.price = 0
        dig.perWindow = 0
      }
    }

    // 刷单（common 常驻阶梯每窗；rare/奇货仅收购侧——供给侧在 slowSupplyDraw）
    refreshGoodOrders(state, ctx, def, pool.q, nextNow)
  }

  // ── P2 稀有/奇货抽取节拍（2026-09-06 船长定：每 RARE_DRAW_PERIOD_MS 执行一次）──
  // rare：本窗抽 N 张（浮动百分比 × 已解锁件数，加权有放回 → 同窗可重复抽中同一类型）；
  // 奇货：每件独立掷骰（**1%** × 技能），全窗命中 >EXOTIC_CAP_PER_DRAW 张时随机抽选保留。
  // 无 rare/奇货的目录（如纯采矿测试档）不掷骰，避免扰动确定性 RNG 计数。
  if ((mk.slowDrawLastGameMs ?? 0) + RARE_DRAW_PERIOD_MS <= nextNow) {
    mk.slowDrawLastGameMs = nextNow
    slowSupplyDraw(state, ctx, nextNow)
  }

  // 撮合我的限价单（含已成交挂单的清理）
  matchPlayerOrders(state, ctx, nextNow)
  // 站内让利吸收（2026-09-08 船长定：吸收量与卖单价挂钩——先吃簿，差额按折价倍率站内补收）
  absorbViaStation(state, ctx)

  // 价格小史 + 冲击结算
  /**
   * **采样判据**（船长 2026-09-16「按照原来的30分钟来」）：**这一窗是否跨过了 30 分钟边界**
   * ——用 `lastTickGameMs → nextNow` 的桶号变化判断（不新增存档字段 ⇒ 零迁移）。
   * 同一分钟内多笔交易只留一个点；跨边界那一窗记的是**该窗结算后**的均衡价。
   */
  const sampleNow = Math.floor(nextNow / PRICE_SAMPLE_MS) !== Math.floor(mk.lastTickGameMs / PRICE_SAMPLE_MS)
  for (const def of ctx.marketGoods.values()) {
    const key = def.key
    const pool = mk.pools[key]!
    // 记当前均衡价 L（含慢速噪声/压力/冲击）。不用 bestBuy：其是"20 窗移动最大值"，
    // 旧高单会在下行时压制，掩盖噪声波动（尤其便宜货整数取整后钉死）——L 每窗重算，更能即时反映行情趋势。
    const hist = mk.priceHistory[key]!
    // ⚠ **历史为空时先补一个起点**（老档/非 freshInit 路径也能立刻有基线；否则折线图要空等 30 分钟）
    if (sampleNow || hist.length === 0) {
      hist.push(priceLevel(state, ctx, def, pool.q))
      if (hist.length > PRICE_HISTORY_LIMIT) hist.shift()
    }
    const ref = referenceVol(def, bal.referenceVolRatio)
    if (ref > 0 && Math.abs(pool.netVol) > ref * bal.shockTriggerRatio) {
      pool.shock += Math.sign(pool.netVol) * bal.shockPerTrigger // 无叠加上限（用户确认）
    }
    pool.netVol = 0
  }

  mk.lastTickGameMs = nextNow
  // ── 市场事件预留钩子：未来"囤积/短缺/协会收购周"在此检查并生效 ──
}
