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
import { L10N } from '@whale/data'
import { makeTestCtx, ship, skill, skipFirstSkillReward } from './helpers'

describe('精炼与市场（M1 经济）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx()
  })

  describe('精炼产出倍率（2026-09-08 工业收益体检再定：基础 120%、技能每级 +6%/+3%，满级 165%）', () => {
    it('无技能 = 基础 120%（无技能净率 ≈+20%）', () => {
      expect(refineRate(state, ctx)).toBe(1.2)
    })

    it('精炼学 5 级 = 150%；再加高级回收处理 5 级 = 165%（满级）', () => {
      state.skills.trained['refining'] = 5
      expect(refineRate(state, ctx)).toBeCloseTo(1.5, 10)
      state.skills.trained['reprocessing'] = 5 // 1.2 + 0.3 + 0.15 = 1.65（浮点误差见 toBeCloseTo）
      expect(refineRate(state, ctx)).toBeCloseTo(1.65, 10)
    })
  })

  describe('精炼炉运转（v20：同资源多单位并行、原料不锁定实时扣取；主控限 1 台 + 每闲置核心 1 台）', () => {
    // 2026-09-08 AI 核心上限制：本组 AI 炉用例需「AI 核心上限」资格（Lv5 足够覆盖多台并行用例）
    beforeEach(() => {
      state.skills.trained['ai-expert'] = 5
      // 只考机制、不考「第一次」奖励：预置该任务已完成（否则引擎首拍送一枚基础 AI 核心）
      skipFirstSkillReward(state)
    })
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
      // 半途：1 批到点扣 10 单位（货仓优先），产物按 120% 产出倍率入仓库
      advanceGame(state, 7_000, ctx)
      expect(countItem(state, 'ore-a')).toBe(90)
      expect(countWare(state, 'min-a')).toBe(24) // floor(10×2×1.2)
      expect(countWare(state, 'min-b')).toBe(6) // floor(10×0.5×1.2)
      // 跑完剩余：库存耗尽自动停（整批 10×10，无尾料）
      advanceGame(state, 60_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(countItem(state, 'ore-a')).toBe(0)
      expect(countWare(state, 'min-a')).toBe(240)
      expect(countWare(state, 'min-b')).toBe(60)
      expect(state.logs.some((l) => l.text.includes('原料耗尽'))).toBe(true)
      expect(state.logs.some((l) => l.text.includes('精炼所得'))).toBe(true)
    })

    it('产出倍率技能影响每批结算：精炼学 5 级 = 150%（每批 floor 后累计）', () => {
      state.skills.trained['refining'] = 5
      state.fleet[state.shipId].cargo['ore-a'] = totalUnits
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 61_000, ctx)
      expect(countWare(state, 'min-a')).toBe(300) // floor(10×2×1.5)=30/批 ×10
      expect(countWare(state, 'min-b')).toBe(70) // floor(10×0.5×1.5)=7/批 ×10
    })

    it('货仓+仓库一并供料；中途停炉：已完成批保留，余料本来就在仓库无需退回', () => {
      state.fleet[state.shipId].cargo['ore-a'] = 30
      state.warehouse.items['ore-a'] = 70
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(countItem(state, 'ore-a')).toBe(30)
      expect(countWare(state, 'ore-a')).toBe(70)
      advanceGame(state, 7_000, ctx) // 1 批完成（货仓扣 10）
      expect(countWare(state, 'min-a')).toBe(24)
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
      expect(countWare(state, 'min-a')).toBe(24)
      expect(countWare(state, 'min-b')).toBe(6)
      expect(countWare(state, 'ore-a')).toBe(5)
      advanceGame(state, 16_000, ctx) // 余 5 不足一批 → 2026-09-06 起停工保留，不再吃小批
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'min-a')).toBe(24) // 只有整批产出
      expect(countWare(state, 'min-b')).toBe(6)
      expect(countWare(state, 'ore-a')).toBe(5) // 余料保留
      expect(countAiCore(state, 'basic')).toBe(1) // 归还
      expect(state.logs.some((l) => l.text.includes('余量不足一批'))).toBe(true)
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
      expect(countWare(state, 'min-a')).toBe(96) // 每批 20 × 4 批 × (2×1.2) → floor 各批 24×4
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

    it('原料中途卖光：到点即停炉（日志说明）；结束日志带精炼所得明细', () => {
      state.warehouse.items['ore-a'] = 20
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 7_000, ctx) // 批 1 扣 10
      state.warehouse.items['ore-a'] = 0 // 模拟把剩余原料全部卖掉
      advanceGame(state, 7_000, ctx)
      expect(state.refineRuns).toHaveLength(0)
      expect(state.logs.some((l) => l.text.includes('原料耗尽'))).toBe(true)
      // 2026-09-06：精炼与回收统一——结束日志带"精炼所得"明细
      const fin = state.logs.filter((l) => l.text.includes('原料耗尽'))
      expect(fin.length).toBeGreaterThan(0)
      expect(fin[0]!.text).toContain('精炼所得')
      // 甲案（2026-09-20）：本条是"多段 + 段内带词"的重头——基础模板 + 所得段 + 明细段 + 句号段
      expect(fin[0]!.textId).toBe('core.industry.077') // 精炼炉停 … 原料耗尽（共 N 批）
      expect(fin[0]!.textParams?.p1Id).toBe('core.industry.067') // ；精炼所得：{p1}
      expect(fin[0]!.textParams?.p1p1Id).toBe('core.industry.044') // 明细段（光清单形态）
      expect(fin[0]!.textParams?.p1p1p1).toBeDefined() // 清单（内容数据名，按专名不译）
      expect(fin[0]!.textParams?.p1p1p1).toBe(String(fin[0]!.textParams?.p1p1)) // 段内参数键与渲染层命名空间对齐
      expect(fin[0]!.textParams?.p2Id).toBe('core.state.042') // 句号段
      // 渲染层口径复算一遍英文（渲染层在 desktop 侧，core 测试里按同规则走 id 链）：
      // 段号 `p{n}` / 段内参数 `p{n}p{k}`，逐段取 en 列拼起来 ⇒ 应当整句英文、不残留中文小词
      const tp = fin[0]!.textParams ?? {}
      const enOf = (id: string, params: Record<string, string | number>): string =>
        (L10N[id]?.en ?? `「缺 ${id}」`).replace(/\{(\w+)\}/g, (mm, k: string) => (k in params ? String(params[k]) : mm))
      const partsEn: string[] = []
      let curId: string | undefined = fin[0]!.textId
      for (let i = 0; curId !== undefined && i < 8; i++) {
        const ns: Record<string, string | number> = {}
        for (const [k, v] of Object.entries(tp)) {
          if (/^p\d+p\d+$/.test(k) || /^p\d+Id$/.test(k)) continue
          ns[k] = v
        }
        partsEn.push(enOf(curId, ns))
        const nxt = tp[`p${i + 1}Id`]
        curId = typeof nxt === 'string' ? nxt : undefined
      }
      const rendered = partsEn.join('')
      expect(rendered).toContain('Refinery stopped')
      expect(rendered).toContain('refined:')
      // 腔调词（炉/所得/句号）全走 id ⇒ 英文侧只剩内容数据名（测试里是「矿甲」这类专名）
      expect(rendered).toContain('矿甲') // 内容名按专名原样带出（甲案边界内）
      expect(rendered.replace(/矿甲|矿粉[\w-]+×\d+/g, '')).not.toMatch(/[\u4e00-\u9fff]/)
    })

    it('运行中余量不足一批：到批点即停工、余料保留（不再吃小批，2026-09-06 船长拍板）', () => {
      state.warehouse.items['ore-a'] = 30
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      advanceGame(state, 7_000, ctx) // 批 1（10）完成 → 余 20
      advanceGame(state, 7_000, ctx) // 批 2（10）完成 → 余 10
      state.warehouse.items['ore-a'] = 4 // 卖掉到不足一批
      advanceGame(state, 7_000, ctx) // 下一批到点 → 不足一批停工，余料保留
      expect(state.refineRuns).toHaveLength(0)
      expect(countWare(state, 'ore-a')).toBe(4) // 没有吃"小批尾料"
      expect(state.logs.some((l) => l.text.includes('余量不足一批'))).toBe(true)
      expect(state.logs.some((l) => l.text.includes('余料保留'))).toBe(true)
    })

    it('无核心/不在母港拒绝启动；**采矿中 ⇒ 自动停采后照常开工**（2026-09-21 统一批）', () => {
      state.warehouse.items['ore-a'] = 50
      expect(startRefineRun(state, 'ore-a', 'basic', ctx).ok).toBe(false) // 无 AI 核心
      /**
       * ⚠ **2026-09-21 船长令改判**：原先"主控忙 ⇒ 硬拒"，现在统一为**能直接切就自动取消当前活动**
       * （采矿那一档 = 自动停 + 一条统一日志）⇒ 亲自开炉照常开工，矿留在船上。
       */
      state.mining.active = true
      state.mining.beltId = [...ctx.belts.keys()][0]!
      state.mining.phase = 'mining'
      state.mining.tripUnits = 7
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
      expect(state.mining.active).toBe(false)
      expect(state.logs.some((l) => l.text.includes('已自动停止「开采」'))).toBe(true)
      expect(stopRefineRun(state, ctx, runIdOf('ore-a')).ok).toBe(true)
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
      // 不足一批不能开工（2026-09-06 船长反馈：数量不足仍能开工）
      state.warehouse.items['ore-a'] = 5
      const tiny = startRefineRun(state, 'ore-a', 'pilot', ctx)
      expect(tiny.ok).toBe(false)
      expect(tiny.error ?? '').toContain('不足一批')
      state.warehouse.items['ore-a'] = 0
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
      // 2026-09-06：开工不再写日志（卡片/活动栏实时可见，避免刷屏）
      expect(state.logs.some((l) => l.text.includes('开工'))).toBe(false)
      expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(false)
      expect(stopRefineRun(state, ctx, runIdOf('ore-a')).ok).toBe(true)
      expect(state.logs.some((l) => l.text.includes('精炼炉已停'))).toBe(true)
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
