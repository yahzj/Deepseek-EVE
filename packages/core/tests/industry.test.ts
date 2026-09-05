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

  describe('精炼炉运转（v20：同资源多单位并行、原料不锁定实时扣取；主控限 1 台 + 每闲置核心 1 台）', () => {
    // 测试 fixture 无单批参数 → 兜底：10 单位/批、6 秒/批（100 单位 = 10 批 = 60s）
    const totalUnits = 100
    const runIdOf = (itemId: string): number => {
      const r = state.refineRuns.find((x) => x.itemId === itemId)
      expect(r).toBeDefined()
      return r!.id
    }

    it('启动不锁料；每批到点实时扣料出货并自动续批，料尽自动停炉', () => {
      state.fleet[state.shipId].cargo['ore-a'] = totalUnits
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      // 不锁定：货仓原样保留
      expect(countItem(state, 'ore-a')).toBe(totalUnits)
      expect(state.refineRuns).toHaveLength(1)
      expect(state.refineRuns[0]!.worker).toBe('pilot')
      // 半途：1 批到点扣 10 单位（货仓优先），产物按 50% 收率入仓库
      advanceGame(state, 7_000, ctx)
      expect(countItem(state, 'ore-a')).toBe(90)
      expect(countWare(state, 'min-a')).toBe(10) // floor(10×2×0.5)
      expect(countWare(state, 'min-b')).toBe(2) // floor(10×0.5×0.5)
      // 跑完剩余：库存耗尽自动停
      advanceGame(state, 60_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(countWare(state, 'min-a')).toBe(100)
      expect(countWare(state, 'min-b')).toBe(20)
      expect(state.logs.some((l) => l.text.includes('完成'))).toBe(true)
    })

    it('收率技能影响每批结算：精炼学 5 级 = 90%（每批 floor 后累计）', () => {
      state.skills.trained['refining'] = 5
      state.fleet[state.shipId].cargo['ore-a'] = totalUnits
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 61_000, ctx)
      expect(countWare(state, 'min-a')).toBe(180) // floor(10×2×0.9)=18/批 ×10
      expect(countWare(state, 'min-b')).toBe(40) // floor(10×0.5×0.9)=4/批 ×10
    })

    it('货仓+仓库一并供料；中途停炉：已完成批保留，余料本来就在仓库无需退回', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 30
      state.warehouse.items['ore-a'] = 70
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(countItem(state, 'ore-a')).toBe(30)
      expect(countWare(state, 'ore-a')).toBe(70)
      advanceGame(state, 7_000, ctx) // 1 批完成（货仓扣 10）
      expect(countWare(state, 'min-a')).toBe(10)
      const stopId = runIdOf('ore-a')
      const st = stopRefineRun(state, ctx, stopId)
      expect(st.ok).toBe(true)
      expect(state.refineRuns).toHaveLength(0)
      expect(countItem(state, 'ore-a')).toBe(20)
      expect(countWare(state, 'ore-a')).toBe(70)
      expect(state.logs.some((l) => l.text.includes('已停'))).toBe(true)
      // 重复停炉报错
      expect(stopRefineRun(state, ctx, stopId).ok).toBe(false)
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
      expect(countWare(state, 'ore-a')).toBe(5)
      advanceGame(state, 16_000, ctx) // 尾批（5 单位）完成 → 料尽自动停
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'min-a')).toBe(15) // 10 + floor(5×2×0.5)
      expect(countWare(state, 'min-b')).toBe(3) // 2 + floor(5×0.5×0.5)
      expect(countAiCore(state, 'basic')).toBe(1) // 归还
      expect(state.logs.some((l) => l.text.includes('AI 核心已归还'))).toBe(true)
    })

    it('AI 核心驱动中途停炉：核心立即归还，余料留仓', () => {
      state.aiCores['basic'] = 1
      state.warehouse.items['ore-a'] = 25
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      advanceGame(state, 16_000, ctx)
      expect(countAiCore(state, 'basic')).toBe(0)
      expect(stopRefineRun(state, ctx, runIdOf('ore-a')).ok).toBe(true)
      expect(countAiCore(state, 'basic')).toBe(1)
      expect(countWare(state, 'ore-a')).toBe(15) // 25 - 10
      expect(state.refineRuns).toHaveLength(0)
    })

    it('同一资源可多台并行：pilot 1 台 + AI 核心各一台同时炼同一批库存', () => {
      state.aiCores['basic'] = 2
      state.warehouse.items['ore-a'] = 100
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      // 主控第二台仍被拒（pilot 限 1）
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      // 两枚核心开同资源第二、三台（原料不锁定共享扣取）
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      expect(state.refineRuns).toHaveLength(3)
      expect(state.refineRuns.filter((x) => x.worker === 'pilot')).toHaveLength(1)
      expect(state.refineRuns.every((x) => x.itemId === 'ore-a')).toBe(true)
      // 三台各自独立周期（pilot 6s；核心 15s），到点顺次实时扣料
      advanceGame(state, 16_000, ctx)
      // pilot：批 1（6s）、批 2（12s）→ 扣 20；核心两台各批 1（15s）→ 扣 20
      expect(countWare(state, 'ore-a')).toBe(60)
      expect(countWare(state, 'min-a')).toBe(40) // 每批 10 × 4 批 × (2×0.5)
      expect(state.refineRuns).toHaveLength(3)
      // 全部继续推进直到库存耗尽（各自尾批自然收尾）
      advanceGame(state, 200_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'ore-a')).toBe(0)
      expect(countAiCore(state, 'basic')).toBe(2) // 双核心归还
    })

    it('并行中停掉其中一台：其余台继续；停台核心立即归还', () => {
      state.aiCores['basic'] = 2
      state.warehouse.items['ore-a'] = 80
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(true)
      const stopId = state.refineRuns.find((x) => x.worker === 'basic')!.id
      expect(stopRefineRun(state, ctx, stopId).ok).toBe(true)
      expect(state.refineRuns).toHaveLength(2)
      expect(state.refineRuns.some((x) => x.id === stopId)).toBe(false)
      expect(countAiCore(state, 'basic')).toBe(1)
    })

    it('原料中途卖光：到点即停炉（日志说明）', () => {
      state.warehouse.items['ore-a'] = 20
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 7_000, ctx) // 批 1 扣 10
      state.warehouse.items['ore-a'] = 0 // 模拟把剩余原料全部卖掉
      advanceGame(state, 7_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(state.logs.some((l) => l.text.includes('原料耗尽'))).toBe(true)
    })

    it('无核心/主控忙/不在母港均拒绝启动', () => {
      state.warehouse.items['ore-a'] = 50
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(false) // 无 AI 核心
      // 采矿中（主控忙）不能亲自运转
      state.mining.active = true
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      state.mining.active = false
      // 不在母港
      state.awayGalaxy = 'galaxy-x'
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      state.awayGalaxy = null
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(stopRefineRun(state, ctx, runIdOf('ore-a')).ok).toBe(true)
    })

    it('无配方/空库存/未知物品拒绝启动；运行视图可读（多工位逐台一条、带稳定 id）', () => {
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
      expect(views[0]!.id).toBeGreaterThan(0)
      expect(stopRefineRun(state, ctx, views[0]!.id).ok).toBe(true)
    })

    it('手动运转期间禁止再亲自开炉（pilot 限 1 台）', () => {
      state.warehouse.items['ore-a'] = 20
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(state.logs.some((l) => l.text.includes('精炼炉开工'))).toBe(true)
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      expect(stopRefineRun(state, ctx, runIdOf('ore-a')).ok).toBe(true)
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
