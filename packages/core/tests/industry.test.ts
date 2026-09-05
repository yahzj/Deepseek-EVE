/**
 * 精炼 / 出售 / 买船的单元测试（M1 经济闭环）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { countItem, countWare } from '../src/inventory'
import { buyShip, refineRate, sellAll, sellWareItem, startRefineRun, stopRefineRun, refineRunViews } from '../src/industry'
import { advanceGame } from '../src/engine'
import { countAiCore } from '../src/ai'
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

  describe('精炼炉运转（v19 多工位并行：固定批量 × 自动续批，料尽/停炉收尾；主控限 1 台 + 每闲置核心 1 台）', () => {
    // 测试 fixture 无单批参数 → 兜底：10 单位/批、6 秒/批（100 单位 = 10 批 = 60s）
    const totalUnits = 100

    it('启动锁定全量（货仓优先），每批到点出货并自动续批，料尽自动停炉', () => {
      state.fleet[state.shipId].cargo['ore-a'] = totalUnits
      const r = startRefineRun(state, 'ore-a', 'pilot', ctx)
      expect(r.ok).toBe(true)
      // 锁定：货仓清空、炉内 lockedQty = 全量
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(state.refineRuns).toHaveLength(1)
      expect(state.refineRuns[0]!.lockedQty).toBe(totalUnits)
      expect(state.refineRuns[0]!.worker).toBe('pilot')
      // 半途：1 批完成后锁定减 10，产物按 50% 收率入仓库
      advanceGame(state, 7_000, ctx)
      expect(state.refineRuns[0]!.lockedQty).toBe(90)
      expect(countWare(state, 'min-a')).toBe(10) // floor(10×2×0.5)
      expect(countWare(state, 'min-b')).toBe(2) // floor(10×0.5×0.5)
      // 跑完剩余 9 批
      advanceGame(state, 60_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'min-a')).toBe(100)
      expect(countWare(state, 'min-b')).toBe(20)
      expect(state.logs.some((l) => l.text.includes('运转完成'))).toBe(true)
    })

    it('收率技能影响每批结算：精炼学 5 级 = 90%（每批 floor 后累计）', () => {
      state.skills.trained['refining'] = 5
      state.fleet[state.shipId].cargo['ore-a'] = totalUnits
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 61_000, ctx)
      expect(countWare(state, 'min-a')).toBe(180) // floor(10×2×0.9)=18/批 ×10
      expect(countWare(state, 'min-b')).toBe(40) // floor(10×0.5×0.9)=4/批 ×10
    })

    it('货仓+仓库库存一并锁定；中途停炉：已完成批保留、剩余料全额退回', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 30
      state.warehouse.items['ore-a'] = 70
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(countWare(state, 'ore-a')).toBe(0)
      expect(state.refineRuns[0]!.lockedQty).toBe(100)
      advanceGame(state, 7_000, ctx) // 1 批完成
      expect(countWare(state, 'min-a')).toBe(10)
      const st = stopRefineRun(state, ctx, 'ore-a')
      expect(st.ok).toBe(true)
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'ore-a')).toBe(90) // 剩余退回
      expect(countWare(state, 'min-a')).toBe(10)
      expect(state.logs.some((l) => l.text.includes('已停炉'))).toBe(true)
      // 重复停炉报错
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(false)
    })

    it('AI 核心驱动：出库占用、周期 ÷效率(基础40%)、料尽自动归还核心', () => {
      state.aiCores['basic'] = 1
      state.warehouse.items['ore-a'] = 15
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      expect(state.refineRuns[0]!.cycleMs).toBe(15_000) // 6000 ÷ 0.4
      expect(countAiCore(state, 'basic')).toBe(0) // 占用
      advanceGame(state, 16_000, ctx) // 第 1 批（10 单位）完成
      expect(countWare(state, 'min-a')).toBe(10)
      expect(countWare(state, 'min-b')).toBe(2)
      expect(state.refineRuns[0]!.lockedQty).toBe(5)
      advanceGame(state, 16_000, ctx) // 尾批（5 单位）完成 → 料尽自动停
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'min-a')).toBe(15) // 10 + floor(5×2×0.5)
      expect(countWare(state, 'min-b')).toBe(3) // 2 + floor(5×0.5×0.5)
      expect(countAiCore(state, 'basic')).toBe(1) // 归还
      expect(state.logs.some((l) => l.text.includes('AI 核心已归还'))).toBe(true)
    })

    it('AI 核心驱动中途停炉：剩余料退回 + 核心立即归还', () => {
      state.aiCores['basic'] = 1
      state.warehouse.items['ore-a'] = 25
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      advanceGame(state, 16_000, ctx)
      expect(countAiCore(state, 'basic')).toBe(0)
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(true)
      expect(countAiCore(state, 'basic')).toBe(1)
      expect(countWare(state, 'ore-a')).toBe(15) // 25 - 10
      expect(state.refineRuns).toHaveLength(0)
    })

    it('主控限 1 台 + 每闲置核心 1 台：pilot 炉与 AI 炉可并行，各自独立推进与停炉收尾', () => {
      state.aiCores['basic'] = 1
      state.warehouse.items['ore-a'] = 30
      state.warehouse.items['ore-b'] = 20
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      // 同资源至多一台炉
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      // 主控只能亲自运转一台
      expect(startRefineRun(state, 'ore-b', 'pilot', ctx).ok).toBe(false)
      // AI 核心并行开第二台（不同资源）
      expect(startRefineRun(state, 'ore-b', 'basic', ctx).ok).toBe(true)
      expect(state.refineRuns).toHaveLength(2)
      expect(state.refineRuns.map((x) => x.itemId).sort()).toEqual(['ore-a', 'ore-b'])
      advanceGame(state, 7_000, ctx)
      // 主控炉 ore-a（6s/批）：1 批 → min-a 10、min-b 2；AI 炉 ore-b（15s/批）未到点
      expect(countWare(state, 'min-a')).toBe(10)
      expect(countWare(state, 'min-b')).toBe(2)
      // 只停 ore-a 主控炉 → ore-b 继续
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(true)
      expect(state.refineRuns).toHaveLength(1)
      expect(state.refineRuns[0]!.itemId).toBe('ore-b')
      expect(countWare(state, 'ore-a')).toBe(20) // 30 - 10 退回
      // AI 炉 ore-b（20 单位 = 2 批）继续跑完：t=15s 批 1、t=30s 批 2（每批 floor(10×1.2×0.5)=6）
      advanceGame(state, 25_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'min-a')).toBe(22) // 10 + 12
      expect(countAiCore(state, 'basic')).toBe(1)
    })

    it('同资源第二台/主控第二台/无核心/主控忙/不在母港均拒绝启动', () => {
      state.warehouse.items['ore-a'] = 50
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      // 同资源炉位占用
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(true)
      // 无 AI 核心
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(false)
      // 采矿中（主控忙）不能亲自运转
      state.mining.active = true
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      state.mining.active = false
      // 不在母港
      state.awayGalaxy = 'galaxy-x'
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      state.awayGalaxy = null
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(true)
    })

    it('无配方/空库存/未知物品拒绝启动；运行视图可读（多工位逐台一条）', () => {
      state.fleet[state.shipId].cargo['min-a'] = 10
      expect(startRefineRun(state, 'min-a', 'pilot', ctx).ok).toBe(false) // 矿物无配方
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false) // 无库存
      expect(startRefineRun(state, '不存在的矿石', 'pilot', ctx).ok).toBe(false)
      // 运行视图：空态
      expect(refineRunViews(state, ctx)).toHaveLength(0)
      // 运行中视图：进度 0~100、剩余毫秒 > 0
      state.warehouse.items['ore-a'] = 100
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 3_000, ctx)
      const views = refineRunViews(state, ctx)
      expect(views).toHaveLength(1)
      expect(views[0]!.active).toBe(true)
      expect(views[0]!.itemName).toBe('矿甲')
      expect(views[0]!.workerLabel).toBe('主控')
      expect(views[0]!.percent).toBeGreaterThan(0)
      expect(views[0]!.percent).toBeLessThanOrEqual(100)
      expect(views[0]!.remainingMs).toBeGreaterThan(0)
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(true)
    })

    it('手动运转期间禁止再亲自开炉（矿种切换需先停炉）', () => {
      state.warehouse.items['ore-a'] = 20
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(state.logs.some((l) => l.text.includes('精炼炉启动'))).toBe(true)
      // 精炼炉占用时重复启动失败
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      expect(stopRefineRun(state, ctx, 'ore-a').ok).toBe(true)
    })
  })

  describe('出售', () => {
    it('仓库里的物品可单独卖出（sellWareItem）', () => {
      state.warehouse.items['ore-a'] = 50
      const result = sellWareItem(state, 'ore-a', ctx)
      expect(result.ok).toBe(true)
      expect(result.gainedIsk).toBe(50 * 12 - Math.round(50 * 12 * 0.05)) // 扣 5% 贸易税
      expect(countWare(state, 'ore-a')).toBe(0)
    })

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
