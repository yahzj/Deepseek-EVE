/**
 * 挂买单**预扣冻结**（2026-09-11 船长裁决「甲：改成 EVE 式预扣冻结」）。
 *
 * 背景（船长追问）：「当玩家挂单购买时，是否有冻结玩家金钱？」——此前**不冻结**：
 * `placeBuyOrder` 只在成交时扣钱（钱不够就挂着等），于是可以**零资金挂满全市场**
 * （玩家挂单还不过期）＝对未来供给的免费期权。
 *
 * 现口径：挂单即从钱包扣下 `挂价 × 挂量`（记在订单 `escrowIsk` 上）：
 * - 成交按**实际成交价**从预扣里核销，挂价高于成交价的**价差退回钱包**；
 * - **余额不足按余额缩量**（连 1 件都挂不起则拒绝，`buyOrderBlockedReason` 给原因）；
 * - 撤单**全额退回**；成交完毕若有残留预扣也退回（防"单子移出挂单表后钱失踪"）；
 * - 旧档遗留单（`escrowIsk` 缺省 0）仍按旧口径：成交时看钱包。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, PlayerOrder, SimContext } from '../src/index'
import {
  advanceGame,
  buyOrderBlockedReason,
  cancelOrder,
  countWare,
  createInitialState,
  ensureMarket,
  marketQuote,
  placeBuyOrder,
} from '../src/index'
import { makeTestCtx } from './helpers'

const KEY = 'it-min-a'

/** 小世界：单一商品（矿物类物品，仓库计数用），簿面可手动铺 */
function world(): { state: GameState; ctx: SimContext; seed: (asks: Array<[number, number]>) => void } {
  const ctx = makeTestCtx({
    quietEvents: true,
    marketGoods: [{ key: KEY, kind: 'item', refId: 'min-a', rarity: 'common', basePrice: 100, demandMultiplier: 0.6 }],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  state.wallet.isk = 1_000_000
  ensureMarket(state, ctx, { openAtGameMs: 0 })
  const seed = (asks: Array<[number, number]>): void => {
    const list = state.market.npcSell[KEY]!
    list.splice(0, list.length)
    for (const [price, qty] of asks) list.push({ price, qty, expiresAtGameMs: state.gameMs + 30 * 60_000 })
  }
  return { state, ctx, seed }
}

describe('挂买单预扣冻结（挂单即扣钱，撤单/价差退回）', () => {
  it('挂单即扣 `挂价 × 挂量`，金额记在本单的 escrowIsk 上（不再"零资金占位"）', () => {
    const { state, ctx, seed } = world()
    seed([[120, 100]])
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, KEY, 100, 5)!
    expect(order.escrowIsk).toBe(500)
    expect(state.wallet.isk).toBe(wallet0 - 500)
    expect(state.logs.some((l) => l.text.includes('预扣 500 ISK，撤单退回'))).toBe(true)
  })

  it('余额不足按余额缩量；连 1 件都挂不起则拒绝，并给出原因', () => {
    const { state, ctx, seed } = world()
    seed([[120, 100]])
    state.wallet.isk = 250
    const order = placeBuyOrder(state, ctx, KEY, 100, 5)! // 只挂得起 2 件
    expect(order.qty).toBe(2)
    expect(order.escrowIsk).toBe(200)
    expect(state.wallet.isk).toBe(50)
    // 连一件都挂不起 → 拒绝 + 原因
    state.wallet.isk = 10
    expect(placeBuyOrder(state, ctx, KEY, 100, 5)).toBeNull()
    expect(buyOrderBlockedReason(state, ctx, KEY, 100, 5)).toContain('ISK 不足')
    expect(buyOrderBlockedReason(state, ctx, KEY, 100, 5)).toContain('撤单即退回')
  })

  it('成交按实际成交价核销预扣：挂价高于成交价时**价差退回钱包**', () => {
    const { state, ctx, seed } = world()
    seed([[120, 3]])
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, KEY, 150, 3)! // 预扣 450
    expect(order.filled).toBe(3)
    expect(order.qty).toBe(0)
    // 实际按 120×3 = 360 成交，价差 90 退回 ⇒ 净扣 360
    expect(state.wallet.isk).toBe(wallet0 - 360)
    expect(order.escrowIsk).toBe(0)
    expect(countWare(state, 'min-a')).toBe(3)
  })

  it('撤单全额退回预扣（含部分成交后的剩余额度）', () => {
    const { state, ctx, seed } = world()
    seed([[120, 2]])
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, KEY, 120, 10)! // 预扣 1200；即时成交 2 件核销 240
    expect(order.qty).toBe(8)
    expect(order.escrowIsk).toBe(960)
    expect(state.wallet.isk).toBe(wallet0 - 1200)
    expect(cancelOrder(state, ctx, order.id)).toBe(true)
    expect(state.wallet.isk).toBe(wallet0 - 240) // 只花了真正成交的 2 件
    expect(state.orders).toHaveLength(0)
    expect(state.logs.some((l) => l.text.includes('预扣 960 ISK 已退回钱包'))).toBe(true)
  })

  it('成交完毕不留残留预扣（挂单移出后钱不会失踪）', () => {
    const { state, ctx, seed } = world()
    seed([[100, 4], [110, 6]])
    const wallet0 = state.wallet.isk
    // 挂 110 × 10：预扣 1100；吃 100×4 + 110×6 = 400 + 660 = 1060 ⇒ 价差 40 退回
    placeBuyOrder(state, ctx, KEY, 110, 10)
    expect(state.orders).toHaveLength(0) // 全部即时成交 → 移出挂单表
    expect(state.wallet.isk).toBe(wallet0 - 1060)
    // 冻结总额为 0（无挂单）
    expect(state.orders.reduce((s, o) => s + (o.escrowIsk ?? 0), 0)).toBe(0)
    expect(countWare(state, 'min-a')).toBe(10)
  })

  it('旧档遗留单（escrowIsk 缺省 0）仍按旧口径：成交时才看钱包扣钱', () => {
    const { state, ctx, seed } = world()
    seed([[120, 5]])
    const wallet0 = state.wallet.isk
    // 手工造一张"改动前挂的"单（无预扣）
    state.market.orderSeq += 1
    const legacy: PlayerOrder = { id: state.market.orderSeq, side: 'buy', good: KEY, price: 120, qty: 3, filled: 0, placedAtGameMs: 0 }
    state.orders.push(legacy)
    expect(state.wallet.isk).toBe(wallet0)
    advanceGame(state, 60_000, ctx) // 窗口撮合
    expect(legacy.filled).toBe(3)
    // 遗留单按"成交时扣钱"：钱从**钱包**扣（而不是预扣）。窗口刷新会补更便宜的供应单，
    // 故实付 ≤ 挂价上限 120×3 = 360 且 > 0（用区间断言，不锁死具体成交价）
    const spent = wallet0 - state.wallet.isk
    expect(spent).toBeGreaterThan(0)
    expect(spent).toBeLessThanOrEqual(360)
    expect(state.orders).toHaveLength(0) // 成交完毕移出挂单表
  })

  it('抢单（越线买单）也从预扣里核销，且窗口推进不重复扣钱', () => {
    const { state, ctx, seed } = world()
    seed([[120, 100]])
    const wallet0 = state.wallet.isk
    const order = placeBuyOrder(state, ctx, KEY, 60, 5)! // 远低于供应价 → 挂着等抢单
    expect(order.escrowIsk).toBe(300)
    expect(state.wallet.isk).toBe(wallet0 - 300)
    const walletAfterPlace = state.wallet.isk
    advanceGame(state, 60 * 60_000, ctx) // 一小时窗口（抢单概率命中则从预扣核销）
    const o = state.orders.find((x) => x.id === order.id)
    if (o) {
      // 未成交：预扣仍冻着，钱包不变
      expect(state.wallet.isk).toBe(walletAfterPlace)
      expect(o.escrowIsk).toBe(60 * o.qty)
    } else {
      // 全部成交并被移出：钱只花了成交部分（此处成交价比挂价高不了，故按挂价核销）
      expect(state.wallet.isk).toBe(walletAfterPlace)
    }
  })
})
