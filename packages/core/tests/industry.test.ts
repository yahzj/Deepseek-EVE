/**
 * 精炼 / 出售 / 买船的单元测试（M1 经济闭环）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { countItem, countWare } from '../src/inventory'
import { buyShip, refineAllOre, refineRate, sellAll, sellWareItem } from '../src/industry'
import { makeTestCtx, ship, skill } from './helpers'

describe('精炼与市场（M1 经济）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx()
  })

  describe('精炼收率', () => {
    it('无技能 = 基础 50%', () => {
      expect(refineRate(state, ctx)).toBe(0.5)
    })

    it('精炼学 5 级 = 90%；再加高级回收 2 级顶到上限 95%', () => {
      state.skills.trained['refining'] = 5
      expect(refineRate(state, ctx)).toBe(0.9)
      state.skills.trained['reprocessing'] = 2 // 0.9 + 0.08 = 0.98 → cap 0.95
      expect(refineRate(state, ctx)).toBe(0.95)
    })
  })

  describe('精炼指令', () => {
    it('100 单位矿甲 @50%：产 100 矿粉min-a + 25 矿粉min-b，矿石清空，写日志', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 100
      const result = refineAllOre(state, 'ore-a', ctx)
      expect(result.ok).toBe(true)
      expect(result.produced['min-a']).toBe(100) // floor(100 × 2 × 0.5)
      expect(result.produced['min-b']).toBe(25) // floor(100 × 0.5 × 0.5)
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(countWare(state, 'min-a')).toBe(100) // 产物进物品仓库
      expect(countWare(state, 'min-b')).toBe(25)
      expect(state.logs.some((l) => l.kind === 'trade' && l.text.includes('精炼完成'))).toBe(true)
    })

    it('高技能精炼收益更高：精炼学 5 级时产物按 90% 折算', () => {
      state.skills.trained['refining'] = 5
      state.fleet[state.shipId].cargo['ore-a'] = 100
      const result = refineAllOre(state, 'ore-a', ctx)
      expect(result.produced['min-a']).toBe(180)
      expect(result.produced['min-b']).toBe(45)
    })

    it('矿石原料在仓库时也能精炼（先货仓后仓库自动取用）', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 30
      state.warehouse.items['ore-a'] = 70
      const result = refineAllOre(state, 'ore-a', ctx)
      expect(result.ok).toBe(true)
      expect(result.usedOreUnits).toBe(100)
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(countWare(state, 'ore-a')).toBe(0)
      expect(countWare(state, 'min-a')).toBe(100)
    })

    it('仓库里的物品可单独卖出（sellWareItem）', () => {
      state.warehouse.items['ore-a'] = 50
      const result = sellWareItem(state, 'ore-a', ctx)
      expect(result.ok).toBe(true)
      expect(result.gainedIsk).toBe(50 * 12 - Math.round(50 * 12 * 0.05)) // 扣 5% 贸易税
      expect(countWare(state, 'ore-a')).toBe(0)
    })

    it('矿物不能精炼；空库存精炼返回错误', () => {
      state.fleet[state.shipId].cargo['min-a'] = 10
      expect(refineAllOre(state, 'min-a', ctx).ok).toBe(false)
      expect(refineAllOre(state, 'ore-a', ctx).ok).toBe(false)
      expect(refineAllOre(state, '不存在的矿石', ctx).ok).toBe(false)
    })
  })

  describe('出售', () => {
    it('矿石按单价入账：100 单位 × 12 ISK，扣 5% 贸易税后钱包增加', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 100
      const result = sellAll(state, 'ore-a', ctx)
      expect(result.ok).toBe(true)
      expect(result.gainedIsk).toBe(1_200 - Math.round(1_200 * 0.05)) // 税后 1140
      expect(state.wallet.isk).toBe(10_000 + 1_140)
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(state.logs.some((l) => l.kind === 'trade' && l.text.includes('售出'))).toBe(true)
    })

    it('空库存/未知物品出售返回错误', () => {
      expect(sellAll(state, 'ore-a', ctx).ok).toBe(false)
      expect(sellAll(state, '未知物品', ctx).ok).toBe(false)
    })

    it('协会声望加成售价：加成计入毛额后再扣贸易税（M4 + 贸易税）', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 100
      state.standings['dsi'] = 5 // 5% 加成
      const result = sellAll(state, 'ore-a', ctx)
      const gross = Math.round(1_200 * 1.05)
      expect(result.gainedIsk).toBe(gross - Math.round(gross * 0.05)) // 税后 1197
      // 上限：声望 30 → 15%（封顶）
      state.fleet[state.shipId].cargo['ore-a'] = 100
      state.standings['dsi'] = 30
      const capped = sellAll(state, 'ore-a', ctx)
      const grossCap = Math.round(1_200 * 1.15)
      expect(capped.gainedIsk).toBe(grossCap - Math.round(grossCap * 0.05)) // 税后 1311
    })
  })

  describe('买船', () => {
    const bigShip = ship('big', { cargo: 2000, price: 120_000 })

    beforeEach(() => {
      ctx = makeTestCtx({ ships: [bigShip] })
    })

    it('ISK 不足拒绝；钱够了立即换乘并扣款', () => {
      expect(buyShip(state, 'big', ctx).ok).toBe(false)
      state.wallet.isk = 120_000
      const result = buyShip(state, 'big', ctx)
      expect(result.ok).toBe(true)
      expect(state.shipId).toBe('big')
      expect(state.wallet.isk).toBe(0)
      expect(state.logs.some((l) => l.text.includes('已购入'))).toBe(true)
    })

    it('重复购买当前船 / 未知船 / 免费船 都被拒绝', () => {
      state.shipId = 'big'
      expect(buyShip(state, 'big', ctx).ok).toBe(false)
      expect(buyShip(state, '不存在', ctx).ok).toBe(false)
      expect(buyShip(state, 'sandcat', ctx).ok).toBe(false) // 免费初始船不可购买
    })
  })
})
