/**
 * 市价买入失败**原因分诊**（2026-09-11 船长实测反馈修复）。
 *
 * 现象（船长原话）：「玩家在市场订单有货时，点击市场买入。弹出错误：市场供应簿只剩0件可即时成交
 * ——可用「挂单买入」等NPC 补给后自动成交。无法购买。」
 *
 * 根因：`buyAtMarket` 里三条**静默** `break/continue` 最终都表现为 `bought = 0`，界面把
 * `bought < qty` 一律解释成"没现货"。实测影响面（真档变体）：钱包不足时 141 个"有供应"商品里
 * **104 个**会这样误报、声望不足时 **3 个** MK3 会这样误报。
 *
 * 本文件钉住 `blocked` 四种原因与"部分成交"口径，界面据此给准确提示。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import { advanceGame, buyAtMarket, createInitialState, marketQuote } from '../src/index'
import { makeTestCtx } from './helpers'

/** 一个小世界：池商品（自动铺供应阶梯）+ 稀有商品（无池，靠低频抽单）+ 只收不卖商品 */
function world(): { state: GameState; ctx: SimContext } {
  const ctx = makeTestCtx({
    quietEvents: true,
    marketGoods: [
      // 池商品：开盘即铺 3 档供应（量 = supplyFlow × 可用率）
      { key: 'it-ore-a', kind: 'item', refId: 'ore-a', rarity: 'common', basePrice: 10, poolTarget: 3_000, supplyFlow: 50 },
      // 单件稀有商品：无池 ⇒ 供应只可能来自 10 分钟一轮的低频抽单（用于造"真的没货"）
      { key: 'mod-rare-x', kind: 'module', refId: 'mod-eater', rarity: 'rare', basePrice: 100_000 },
      // 只收不卖（残骸式）
      { key: 'wreck-x', kind: 'item', refId: 'wreck-ano-x', rarity: 'common', basePrice: 30, poolTarget: 3_000, supplyFlow: 50, playerBuyable: false },
      // 声望硬锁
      { key: 'mod-locked', kind: 'module', refId: 'mod-eater', rarity: 'rare', basePrice: 100_000, standingReq: 5 },
      // 暗市闸（声望未达 ⇒ 常驻单被跳过；对玩家按"声望锁"口径措辞）
      { key: 'mod-bm', kind: 'module', refId: 'mod-eater', rarity: 'rare', basePrice: 100_000, bmStanding: 11 },
    ],
    modules: [moduleDefLocal()],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 5 })
  return { state, ctx }
}

/** 稀有/闸位商品引用的那件装备（测试世界默认表里没有） */
function moduleDefLocal() {
  return { id: 'mod-eater', name: '试验装甲', slot: 'armor', rack: 'low', armorHpBonus: 0.2, cpuUse: 4, description: '测试用装备' } as const
}

describe('市价买入：失败原因分诊（不再一律报「只剩 0 件」）', () => {
  it('供应簿确实为空 → blocked = no-stock（并说明是"没现货"）', () => {
    const { state, ctx } = world()
    state.wallet.isk = 10_000_000
    marketQuote(state, ctx, 'mod-rare-x') // 建市场：稀有商品无池 ⇒ 供应簿为空
    const sell = state.market.npcSell['mod-rare-x'] ?? []
    sell.length = 0 // 保险：清空（不吃任何低频抽单的运气）
    const r = buyAtMarket(state, ctx, 'mod-rare-x', 1)
    expect(r.bought).toBe(0)
    expect(r.blocked).toBe('no-stock')
  })

  it('钱包连最低一张都不够 → blocked = insufficient-isk（不再说"没货"）', () => {
    const { state, ctx } = world()
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 60_000, ctx) // 走一个窗口，确认供应阶梯在簿上
    const quote = marketQuote(state, ctx, 'it-ore-a')
    expect(quote.sell).toBeDefined()
    state.wallet.isk = 1 // 连一件都买不起
    const r = buyAtMarket(state, ctx, 'it-ore-a', 1)
    expect(r.bought).toBe(0)
    expect(r.blocked).toBe('insufficient-isk')
  })

  it('声望硬锁 → blocked = standing；只收不卖 → blocked = not-buyable', () => {
    const { state, ctx } = world()
    state.wallet.isk = 10_000_000
    marketQuote(state, ctx, 'mod-locked')
    const locked = buyAtMarket(state, ctx, 'mod-locked', 1)
    expect(locked.bought).toBe(0)
    expect(locked.blocked).toBe('standing')

    marketQuote(state, ctx, 'wreck-x')
    const noBuy = buyAtMarket(state, ctx, 'wreck-x', 1)
    expect(noBuy.bought).toBe(0)
    expect(noBuy.blocked).toBe('not-buyable')
  })

  it('暗市闸未开（声望未达 bmStanding）且簿上只有常驻单 → blocked = standing（对玩家按声望锁口径）', () => {
    const { state, ctx } = world()
    state.wallet.isk = 10_000_000
    state.standings['dsi'] = 0 // 未达 bmStanding = 11
    marketQuote(state, ctx, 'mod-bm')
    // 手动铺一张**非常驻**供应单（bm = false）：闸内应被跳过
    state.market.npcSell['mod-bm'] = [{ price: 120_000, qty: 2, expiresAtGameMs: 10 ** 12 }]
    const r = buyAtMarket(state, ctx, 'mod-bm', 1)
    expect(r.bought).toBe(0)
    expect(r.blocked).toBe('standing') // 而不是 no-stock
    // 声望达标后同一张单可以吃
    state.standings['dsi'] = 11
    const ok = buyAtMarket(state, ctx, 'mod-bm', 1)
    expect(ok.bought).toBe(1)
    expect(ok.blocked).toBeUndefined()
  })

  it('部分成交：买满了就无 blocked；吃穿后 blocked = no-stock 且 remaining 正确', () => {
    const { state, ctx } = world()
    state.wallet.isk = 10_000_000
    marketQuote(state, ctx, 'it-ore-a')
    advanceGame(state, 60_000, ctx)
    const quote = marketQuote(state, ctx, 'it-ore-a')
    const available = quote.sellQty
    expect(available).toBeGreaterThan(1)
    const ok = buyAtMarket(state, ctx, 'it-ore-a', available)
    expect(ok.bought).toBe(available)
    expect(ok.blocked).toBeUndefined()
    // 再买一件：簿已吃穿
    const empty = buyAtMarket(state, ctx, 'it-ore-a', 1)
    expect(empty.bought).toBe(0)
    expect(empty.blocked).toBe('no-stock')
    // 要 5 件但簿上只剩 2 件（重新铺一窗后）→ 部分成交
    advanceGame(state, 60_000, ctx)
    const q2 = marketQuote(state, ctx, 'it-ore-a')
    expect(q2.sellQty).toBeGreaterThan(0)
    const partial = buyAtMarket(state, ctx, 'it-ore-a', q2.sellQty + 5)
    expect(partial.bought).toBe(q2.sellQty)
    expect(partial.remaining).toBe(5)
    expect(partial.blocked).toBe('no-stock')
  })
})
