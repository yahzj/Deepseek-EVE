/**
 * 倾销惩罚（2026-09-11 船长三问三答 + 追加）：
 * ①「提高倾销惩罚」→ 每次触发 **−5% → −8% → −10%**（衰减半程仍 6 分钟）；
 * ②「砸得越狠越卖来买的人越多」⇒ **每层未衰减惩罚把 NPC 收购单量 +8%**（全部商品适用）；
 * ③「移除压力项」→ **只从收购量里移除**：收购阶梯量不再乘库存压力（价格仍保留压力项）；
 * ④「价格钳制下限下调到 0.1」；⑤「砸盘时挂卖单的量同步削减」→ **每层供应单量 −8%（下限 10%）**。
 *
 * 本用例锁：每层 −10% / 稳态 ≈ −0.92 且价格落在地板附近 / 收购量只随惩罚层数放大（×1.73）/
 * 挂卖单量同步削减 / 倍率函数（含方向与地板）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceGame, createInitialState, ensureMarket, sellAtMarket, type GameState, type SimContext } from '@whale/core'
import { dumpBuyVolumeMul, dumpSellVolumeMul } from '../src/market'

const ctx: SimContext = buildSimContext()
const KEY = 'ore-veldspar'
const bal = ctx.balance.market

/** 该商品一窗的触发阈值（与引擎同式：参考量 = max(1, round(supplyFlow ÷ 2))，阈值 = 参考量 × 2） */
function triggerThreshold(): number {
  const def = ctx.marketGoods.get(KEY)!
  const flow = def.supplyFlow ?? Math.max(1, Math.round((def.poolTarget ?? 0) * bal.referenceVolRatio))
  return Math.round(Math.max(1, Math.round(flow / 2)) * bal.shockTriggerRatio)
}

function fresh(): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.escrowItems[KEY] = 20_000_000
  return state
}

/** 在窗口内倾销并推进一窗；返回本窗**新挂上**的 NPC 收购单/供应单量合计 */
function dumpWindow(state: GameState, qty: number): { buys: number; sells: number } {
  const beforeB = new Set(state.market.npcBuy[KEY] ?? [])
  const beforeS = new Set(state.market.npcSell[KEY] ?? [])
  if (qty > 0) sellAtMarket(state, ctx, KEY, qty)
  advanceGame(state, bal.tickMs, ctx)
  const buys = (state.market.npcBuy[KEY] ?? []).filter((o) => !beforeB.has(o)).reduce((s, o) => s + o.qty, 0)
  const sells = (state.market.npcSell[KEY] ?? []).filter((o) => !beforeS.has(o)).reduce((s, o) => s + o.qty, 0)
  return { buys, sells }
}

describe('倾销惩罚（每层 −10% · 收购量只吃补偿 · 挂卖单量同步削减）', () => {
  it('一次触发 = 每层 −10%（5% → 8% → 10%）', () => {
    const state = fresh()
    expect(bal.shockPerTrigger).toBe(0.1)
    dumpWindow(state, triggerThreshold() + 1_000)
    expect(state.market.pools[KEY]!.shock).toBeCloseTo(-0.1, 3)
  })

  it('连续每窗倾销：稳态 ≈ −0.92，价格落在地板附近（钳制下限已降到 0.1×）', () => {
    const state = fresh()
    for (let i = 0; i < 40; i++) dumpWindow(state, triggerThreshold() + 1_000)
    const shock = state.market.pools[KEY]!.shock!
    // 稳态解析 = −p ÷ (1 − 0.5^(1窗/半程)) = −0.10 ÷ 0.1091 ≈ −0.917
    expect(shock).toBeLessThan(-0.85)
    expect(shock).toBeGreaterThan(-1)
    const def = ctx.marketGoods.get(KEY)!
    const price = state.market.priceHistory[KEY]!.at(-1)!
    expect(bal.minPriceRatio).toBe(0.1)
    // 价格 = 基准 × 压力 × (1+shock)：已跌破**旧的 0.2× 地板**（说明地板下调确实生效），
    // 但仍在新的 0.1× 地板之上（整数取整后略高一点）
    expect(price / def.basePrice).toBeLessThan(0.2)
    expect(price / def.basePrice).toBeGreaterThanOrEqual(0.08)
  })

  it('砸得越狠、来收货的买家越多：本窗新铺收购单量只随惩罚层数放大（不再被库存压力压制）', () => {
    const state = fresh()
    advanceGame(state, bal.tickMs, ctx) // 先让开市铺簿落定
    const base = dumpWindow(state, 0)
    for (let i = 0; i < 40; i++) dumpWindow(state, triggerThreshold() + 1_000)
    const shock = Math.abs(state.market.pools[KEY]!.shock!)
    expect(dumpBuyVolumeMul(state.market.pools[KEY], bal)).toBeCloseTo(1 + 0.08 * (shock / bal.shockPerTrigger), 3)
    const sat = dumpWindow(state, 0)
    // 量 = 流量 × 阶梯 × 补偿（无压力项）⇒ 比值 = 补偿倍率 ≈ 1.73
    const ratio = sat.buys / base.buys
    expect(ratio).toBeGreaterThan(1.6)
    expect(ratio).toBeLessThan(1.9)
  })

  it('砸盘时挂卖单的量同步削减（每层 −8%，下限 10%）', () => {
    const state = fresh()
    advanceGame(state, bal.tickMs, ctx)
    const base = dumpWindow(state, 0)
    for (let i = 0; i < 40; i++) dumpWindow(state, triggerThreshold() + 1_000)
    const sat = dumpWindow(state, 0)
    // 供应量另有 avail = clamp(0.05,1.5,池量/目标) 这一项（砸盘后池量高 ⇒ avail 变大），
    // 故净读数 = avail × sellVolMul：实测应明显小于"干净一窗"
    expect(sat.sells).toBeLessThan(base.sells)
    expect(dumpSellVolumeMul(state.market.pools[KEY], bal)).toBeLessThan(0.4)
    expect(dumpSellVolumeMul(state.market.pools[KEY], bal)).toBeGreaterThanOrEqual(0.1)
  })

  it('倍率函数：方向（只砸盘生效）与地板', () => {
    expect(dumpBuyVolumeMul({ shock: 0 }, bal)).toBe(1)
    expect(dumpBuyVolumeMul({ shock: 0.4 }, bal)).toBe(1) // 买入方向不放大
    expect(dumpBuyVolumeMul({ shock: -0.4 }, bal)).toBeCloseTo(1.32, 6) // 4 层 × 8%
    expect(dumpBuyVolumeMul(undefined, bal)).toBe(1)
    expect(dumpSellVolumeMul({ shock: 0 }, bal)).toBe(1)
    expect(dumpSellVolumeMul({ shock: 0.4 }, bal)).toBe(1) // 买入方向不削减
    expect(dumpSellVolumeMul({ shock: -0.4 }, bal)).toBeCloseTo(0.68, 6) // 4 层 × 8%
    expect(dumpSellVolumeMul({ shock: -10 }, bal)).toBe(0.1) // 下限 10%
    // 买入方向的真实读数：连续灌正净量只把 shock 推正、两侧倍率都保持 1
    const state = fresh()
    state.escrowItems[KEY] = 0
    state.wallet.isk = 1e12
    ensureMarket(state, ctx)
    for (let i = 0; i < 3; i++) {
      state.market.pools[KEY]!.netVol = 10_000
      advanceGame(state, bal.tickMs, ctx)
    }
    expect(state.market.pools[KEY]!.shock!).toBeGreaterThan(0)
    expect(dumpBuyVolumeMul(state.market.pools[KEY], bal)).toBe(1)
    expect(dumpSellVolumeMul(state.market.pools[KEY], bal)).toBe(1)
  })
})
