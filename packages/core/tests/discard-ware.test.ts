/**
 * **仓库「丢弃」（任意数量）**（船长 2026-09-15：「**仓库添加丢弃按钮，允许玩家丢弃任意数量已有物品**」）。
 *
 * 口径（`industry.discardWareQty`）：
 * - 数量**下取整**并**夹在 [1, 持有量]**（超出按持有量丢 ⇒ 界面点「全部」不必先自己数）；
 * - **纯销毁**：不给信用点、不进回收/精炼链、**不动货仓**（货仓与洞内货柜各有自己的口径）；
 * - 写一条事件日志；返回实际丢弃数。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { addWare, cargoOfShip, countWare } from '../src/inventory'
import { discardWareQty } from '../src/industry'
import { makeTestCtx } from './helpers'

function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const ctx = makeTestCtx()
  addWare(state, 'ore-veldspar', 100)
  return { state, ctx }
}

describe('仓库丢弃（船长 2026-09-15）', () => {
  it('部分丢弃 / 全部丢弃：数量精确、日志一条、不给钱', () => {
    const { state, ctx } = world()
    const iskBefore = state.wallet.isk
    const r1 = discardWareQty(state, 'ore-veldspar', 30, ctx)
    expect(r1).toEqual({ ok: true, dropped: 30 })
    expect(countWare(state, 'ore-veldspar')).toBe(70)
    expect(state.wallet.isk).toBe(iskBefore) // 纯销毁：钱包一分不动
    expect(state.logs.some((l) => l.text.includes('⚑ 丢弃'))).toBe(true)
    const r2 = discardWareQty(state, 'ore-veldspar', 70, ctx)
    expect(r2.ok).toBe(true)
    expect(countWare(state, 'ore-veldspar')).toBe(0)
  })

  it('超出持有量 ⇒ 按持有量丢（夹住，不报错）；数量 ≤ 0 / 仓库没有 ⇒ 拒绝', () => {
    const { state, ctx } = world()
    const r = discardWareQty(state, 'ore-veldspar', 9999, ctx)
    expect(r).toEqual({ ok: true, dropped: 100 })
    expect(countWare(state, 'ore-veldspar')).toBe(0)
    expect(discardWareQty(state, 'ore-veldspar', 5, ctx).ok).toBe(false) // 已空
    expect(discardWareQty(state, 'ore-veldspar', 0, ctx).ok).toBe(false)
    expect(discardWareQty(state, 'min-voidcrystal', 1, ctx).ok).toBe(false) // 从未持有
  })

  it('小数下取整；且**不动货仓**（仓与货仓是两本账）', () => {
    const { state, ctx } = world()
    const r = discardWareQty(state, 'ore-veldspar', 12.9, ctx)
    expect(r.dropped).toBe(12)
    expect(countWare(state, 'ore-veldspar')).toBe(88)
    // 货仓（随船）那本账不受影响
    const shipId = state.shipId
    expect(state.fleet[shipId]).toBeDefined()
    expect(cargoOfShip(state, shipId)["ore-veldspar"] ?? 0).toBe(0) // 货仓那本账不受影响
  })
})
