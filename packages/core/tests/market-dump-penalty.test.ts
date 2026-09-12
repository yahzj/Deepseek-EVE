/**
 * 倾销惩罚（2026-09-11 船长两问两答）：
 * ①「提高倾销惩罚」→ 每次触发 **−5% → −8%**（衰减半程仍 6 分钟）；
 * ②「砸得越狠越卖来买的人越多」＋「每层惩罚提高 8% 买单数量」「所有商品都适用」
 *    ⇒ 每层**未衰减**惩罚把 **NPC 收购单（买单）挂单量 +8%**（层数 = |shock| ÷ 每层幅度，不取整；
 *      只在砸盘方向生效）。
 *
 * 本用例锁三条：**每层 8%**、**稳态 ≈ −0.73**（衰减兜底，不会一路叠到地板）、
 * **砸得越狠本窗铺出的收购单量越大**；另锁"买入方向不放大"与倍率函数本身。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { advanceGame, createInitialState, ensureMarket, sellAtMarket, type GameState, type SimContext } from '@whale/core'
import { dumpBuyVolumeMul } from '../src/market'

const ctx: SimContext = buildSimContext()
const KEY = 'ore-veldspar'
const bal = ctx.balance.market

/** 该商品一窗的触发阈值（与引擎同式：参考量 = max(1, round(supplyFlow ÷ 2))，阈值 = 参考量 × 2） */
function triggerThreshold(): number {
  const def = ctx.marketGoods.get(KEY)!
  const flow = def.supplyFlow ?? Math.max(1, Math.round((def.poolTarget ?? 0) * bal.referenceVolRatio))
  return Math.round(Math.max(1, Math.round(flow / 2)) * bal.shockTriggerRatio)
}

function fresh(stock = 2_000_000): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.escrowItems[KEY] = stock
  return state
}

/** 在窗口内倾销并推进一窗；返回本窗**新挂上**的 NPC 收购单量合计 */
function dumpWindow(state: GameState, qty: number): number {
  const before = new Set(state.market.npcBuy[KEY] ?? [])
  sellAtMarket(state, ctx, KEY, qty)
  advanceGame(state, bal.tickMs, ctx)
  return (state.market.npcBuy[KEY] ?? []).filter((o) => !before.has(o)).reduce((s, o) => s + o.qty, 0)
}

describe('倾销惩罚（每层 −8% · 每层 +8% 买单量）', () => {
  it('一次触发 = 每层 −8%（原 5%）', () => {
    const state = fresh()
    expect(bal.shockPerTrigger).toBe(0.08)
    dumpWindow(state, triggerThreshold() + 1_000)
    expect(state.market.pools[KEY]!.shock).toBeCloseTo(-0.08, 3)
  })

  it('连续每窗倾销：稳态 ≈ −0.73（衰减 6 分钟半程兜底，叠不到 −1）', () => {
    const state = fresh()
    for (let i = 0; i < 40; i++) dumpWindow(state, triggerThreshold() + 1_000)
    const shock = state.market.pools[KEY]!.shock!
    // 稳态解析 = −p ÷ (1 − 0.5^(1窗/半程)) = −0.08 ÷ 0.1091 ≈ −0.733
    expect(shock).toBeLessThan(-0.7)
    expect(shock).toBeGreaterThan(-0.78)
    // 价格 ≈ 基准 × 压力 × (1+shock)：砸到底也应明显高于 0.2× 硬地板
    const def = ctx.marketGoods.get(KEY)!
    const price = state.market.priceHistory[KEY]!.at(-1)!
    expect(price / def.basePrice).toBeGreaterThan(0.2)
    expect(price / def.basePrice).toBeLessThan(0.35)
  })

  it('砸得越狠、来收货的买家越多：本窗新铺的收购单量随惩罚层数放大', () => {
    const state = fresh()
    advanceGame(state, bal.tickMs, ctx) // 先让开市铺簿/首窗落定，避免把开局那两张收购单算进来
    const freshSum = dumpWindow(state, 0) // shock=0 的干净一窗（只算本窗新铺的收购单）
    for (let i = 0; i < 40; i++) dumpWindow(state, triggerThreshold() + 1_000)
    const shock = Math.abs(state.market.pools[KEY]!.shock!)
    expect(dumpBuyVolumeMul(state.market.pools[KEY], bal)).toBeCloseTo(1 + shock, 3) // 倍率 = 1 + |shock|（层数 × 8%）
    const satSum = dumpWindow(state, 0)
    // 倍率 ≈ 1.73，再乘库存压力项（砸盘后压力 ≈0.90）⇒ 本窗新铺量约为干净一窗的 ×1.57
    const ratio = satSum / freshSum
    expect(ratio).toBeGreaterThan(1.4)
    expect(ratio).toBeLessThan(1.8)
  })

  it('只在砸盘方向放大：玩家买入推高价格时不加买单量', () => {
    // 倍率函数本身（单一出处，全部商品共用）
    expect(dumpBuyVolumeMul({ shock: 0 }, bal)).toBe(1)
    expect(dumpBuyVolumeMul({ shock: 0.4 }, bal)).toBe(1) // 正冲击（买入方向）不放大
    expect(dumpBuyVolumeMul({ shock: -0.4 }, bal)).toBeCloseTo(1.4, 6) // 5 层 × 8%
    expect(dumpBuyVolumeMul({ shock: -0.733 }, bal)).toBeCloseTo(1.733, 3)
    expect(dumpBuyVolumeMul(undefined, bal)).toBe(1)
    // 买入方向的真实读数：连续灌正净量只把 shock 推正、收购单量不随之放大
    const state = fresh(0)
    state.wallet.isk = 1e12
    ensureMarket(state, ctx)
    for (let i = 0; i < 3; i++) {
      state.market.pools[KEY]!.netVol = 10_000 // 直接给窗口灌正净量（买入方向）
      advanceGame(state, bal.tickMs, ctx)
    }
    expect(state.market.pools[KEY]!.shock!).toBeGreaterThan(0)
    expect(dumpBuyVolumeMul(state.market.pools[KEY], bal)).toBe(1)
  })
})
