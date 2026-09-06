/**
 * 蓝图制造与装备装配的单元测试（M2）。
 * 2026-09-08：制造劳动者制与精炼炉同款（主控亲自全局限 1 条 + 每闲置 AI 核心 1 条；
 * 主控手动位与精炼炉/回收炉共用；旧作业豁免）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { cargoCapacityM3, countItem, countWare } from '../src/inventory'
import { countModule, fitModule, unfitAt } from '../src/equipment'
import { miningStatus, startMining } from '../src/mining'
import { startRefineRun } from '../src/industry'
import { calcPower } from '../src/expedition'
import { learnBlueprint } from '../src/market'
import {
  calcBuildDurationMs,
  cancelManufacturing,
  manufacturingManualActive,
  manufacturingRunViews,
  missingMaterials,
  ownsBlueprint,
  startManufacturing,
} from '../src/manufacturing'
import { makeTestCtx, moduleDef } from './helpers'

describe('蓝图学习（V9 消耗品制）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 }) // 初始 10_000 ISK
    ctx = makeTestCtx() // bp-a：测试蓝图
  })

  it('学习成功：消耗一本蓝图书、永久学会、不扣 ISK、写日志', () => {
    state.blueprintStock['bp-a'] = 1
    const r = learnBlueprint(state, ctx, 'bp-a')
    expect(r.ok).toBe(true)
    expect(ownsBlueprint(state, 'bp-a')).toBe(true)
    expect(state.wallet.isk).toBe(10_000) // 学会不花钱（书是市场买的）
    expect(state.blueprintStock['bp-a'] ?? 0).toBe(0) // 书已消耗
    expect(state.logs.some((l) => l.text.includes('已学习'))).toBe(true)
  })

  it('重复学习 / 未知蓝图 / 没有书 → 拒绝', () => {
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a')
    // 已学会再学（哪怕还有书）
    state.blueprintStock['bp-a'] = 2
    expect(learnBlueprint(state, ctx, 'bp-a').ok).toBe(false)
    // 未知蓝图（数据表里没有）
    state.blueprintStock['不存在的蓝图'] = 1
    expect(learnBlueprint(state, ctx, '不存在的蓝图').ok).toBe(false)
    // 没有蓝图书
    expect(learnBlueprint(state, ctx, 'bp-b').ok).toBe(false)
  })
})

describe('制造作业（2026-09-08 劳动者制：主控亲自全局限 1 条、每闲置 AI 核心 1 条，与精炼炉同款）', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx() // bp-a：10 单位矿粉 min-a、制造费 500、耗时 600 秒；bp-b：mod-b（8 单位 min-b、300 秒、300 ISK）
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a')
  })

  it('未学配方 / 制造费不足 / 材料不足 → 拒绝并说明缺什么', () => {
    const fresh = createInitialState({ nowWallMs: 0, seed: 1 })
    // 未学会配方
    expect(startManufacturing(fresh, 'bp-a', 'pilot', ctx).ok).toBe(false)
    // 制造费不足
    state.warehouse.items['min-a'] = 10
    state.wallet.isk = 100
    expect(startManufacturing(state, 'bp-a', 'pilot', ctx).ok).toBe(false)
    state.wallet.isk = 10_000
    // 材料不足（只有 6/10）→ 错误信息说明缺量
    state.warehouse.items['min-a'] = 6
    const r = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('材料不足')
    expect(missingMaterials(state, ctx, ctx.blueprints.get('bp-a')!)).toHaveLength(1)
  })

  it('主控手动开工成功：扣材料、扣制造费、锁定耗时（600 秒）；主控全局限 1 条', () => {
    state.warehouse.items['min-a'] = 10
    const r = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r.ok).toBe(true)
    expect(state.warehouse.items['min-a'] ?? 0).toBe(0)
    expect(state.wallet.isk).toBe(9_500) // 10000 - 500(制造费)；学习不花钱
    expect(state.manufacturingRuns).toHaveLength(1)
    expect(state.manufacturingRuns[0]!.finishAtGameMs).toBe(600_000)
    expect(state.manufacturingRuns[0]!.durationMs).toBe(600_000)
    expect(state.manufacturingRuns[0]!.worker).toBe('pilot')
    expect(state.logs.some((l) => l.text.includes('制造开始'))).toBe(true)
    expect(manufacturingManualActive(state)).toBe(true)
    // 主控手动位全局限 1 条：第二条（哪怕另一张蓝图）被拒
    state.warehouse.items['min-a'] = 10
    const r2 = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('已亲自开着一条制造线')
    expect(state.manufacturingRuns).toHaveLength(1) // 未新增
  })

  it('手动工作位与精炼炉/回收炉共用：双向互斥、AI 不受限', () => {
    // 1) 主控手动精炼在跑 → 亲自开制造线被拒（AI 驱动不受限）
    state.fleet[state.shipId].cargo['ore-a'] = 10
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).ok).toBe(true)
    state.warehouse.items['min-a'] = 10
    const r1 = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('精炼炉/回收炉')
    expect(state.manufacturingRuns).toHaveLength(0)
    // AI 核心驱动的制造不受手动位限制（可与手动炉并行）
    state.aiCores['basic'] = 1
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true)
    expect(state.manufacturingRuns).toHaveLength(1)
    // 2) 主控手动制造线在跑 → 亲自开精炼炉被拒（全新局面：无手动炉干扰）
    const s2 = createInitialState({ nowWallMs: 0, seed: 2 })
    s2.blueprintStock['bp-a'] = 1
    learnBlueprint(s2, ctx, 'bp-a')
    s2.warehouse.items['min-a'] = 10
    expect(startManufacturing(s2, 'bp-a', 'pilot', ctx).ok).toBe(true)
    s2.fleet[s2.shipId].cargo['ore-a'] = 10
    const r2 = startRefineRun(s2, 'ore-a', 'pilot', ctx)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('制造线')
    expect(s2.refineRuns).toHaveLength(0)
  })

  it('主控手动制造中反向封锁出海作业（与精炼炉同款）：采矿被拒', () => {
    state.warehouse.items['min-a'] = 10
    expect(startManufacturing(state, 'bp-a', 'pilot', ctx).ok).toBe(true)
    const m = startMining(state, 'belt-a', ctx)
    expect(m.ok).toBe(false)
    expect(m.error).toContain('制造作业正由你亲自开线')
  })

  it('AI 核心驱动：库存不足拒；出库占用、耗时 ÷效率（基础 0.4 → 1500 秒）、完成自动归还', () => {
    state.warehouse.items['min-a'] = 10
    // 无核心 → 拒
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(false)
    state.aiCores['basic'] = 1
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true)
    expect(state.aiCores['basic']).toBe(0) // 出库占用
    expect(state.manufacturingRuns[0]!.worker).toBe('basic')
    expect(state.manufacturingRuns[0]!.durationMs).toBe(1_500_000) // 600s ÷ 0.4
    // 时间推进到 AI 线到点 → 完成 + 核心归还
    advanceGame(state, 1_500_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(countModule(state, 'mod-a')).toBe(1)
    expect(state.aiCores['basic']).toBe(1)
  })

  it('AI 线受工业自动化 −5%/级（与 AI 精炼炉同款；满级 600×2.5×0.75 = 1125 秒）', () => {
    state.skills.trained['industrial-automation'] = 5
    state.aiCores['basic'] = 1
    state.warehouse.items['min-a'] = 10
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true)
    expect(state.manufacturingRuns[0]!.durationMs).toBe(1_125_000)
  })

  it('同一蓝图可开多条 AI 线、不同蓝图也并行：逐线独立完成、核心逐枚归还', () => {
    state.blueprintStock['bp-b'] = 1
    learnBlueprint(state, ctx, 'bp-b')
    state.aiCores['basic'] = 2
    state.warehouse.items['min-a'] = 20
    state.warehouse.items['min-b'] = 8
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true) // 1500s
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true) // 同蓝图第二线（还有 10 矿粉）
    expect(startManufacturing(state, 'bp-b', 'basic', ctx).ok).toBe(false) // 核心已尽（库存 0）
    expect(state.manufacturingRuns).toHaveLength(2)
    expect(state.aiCores['basic']).toBe(0)
    const views = manufacturingRunViews(state, ctx)
    expect(views).toHaveLength(2)
    expect(views.every((v) => v.blueprintId === 'bp-a')).toBe(true)
    expect(views.every((v) => v.worker === 'basic' && v.workerLabel.includes('基础 AI 核心'))).toBe(true)
    expect(views[0]!.id).toBeLessThan(views[1]!.id) // 线号独立递增
    // 两条同蓝图线各自到点完成 → 产物 2 件、2 枚核心归还
    advanceGame(state, 1_500_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(countModule(state, 'mod-a')).toBe(2)
    expect(state.aiCores['basic']).toBe(2)
  })

  it('两张蓝图并行：各自独立完成入装备库（AI 核心并行）', () => {
    state.blueprintStock['bp-b'] = 1
    learnBlueprint(state, ctx, 'bp-b') // bp-b：8 单位矿粉 min-b、300 秒、300 ISK
    state.aiCores['basic'] = 2
    state.warehouse.items['min-a'] = 10
    state.warehouse.items['min-b'] = 8
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true) // 600s ÷0.4 = 1500s
    expect(startManufacturing(state, 'bp-b', 'basic', ctx).ok).toBe(true) // 300s ÷0.4 = 750s
    expect(state.manufacturingRuns).toHaveLength(2)
    expect(state.wallet.isk).toBe(9_200) // 10000 - 500 - 300
    // 750s：bp-b 完成
    advanceGame(state, 750_000, ctx)
    expect(countModule(state, 'mod-b')).toBe(1)
    expect(state.manufacturingRuns).toHaveLength(1)
    expect(state.manufacturingRuns[0]!.blueprintId).toBe('bp-a')
    expect(state.aiCores['basic']).toBe(1) // 一枚已归还
    // 再 750s：bp-a 完成
    advanceGame(state, 750_000, ctx)
    expect(countModule(state, 'mod-a')).toBe(1)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(state.aiCores['basic']).toBe(2)
  })

  it('取消 AI 线：材料退回、核心归还、另一条不受影响', () => {
    state.blueprintStock['bp-b'] = 1
    learnBlueprint(state, ctx, 'bp-b')
    state.aiCores['basic'] = 2
    state.warehouse.items['min-a'] = 10
    state.warehouse.items['min-b'] = 8
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).ok).toBe(true)
    expect(startManufacturing(state, 'bp-b', 'basic', ctx).ok).toBe(true)
    const bRunId = state.manufacturingRuns.find((r) => r.blueprintId === 'bp-b')!.id
    expect(cancelManufacturing(state, ctx, bRunId).ok).toBe(true)
    expect(state.manufacturingRuns).toHaveLength(1)
    expect(state.manufacturingRuns[0]!.blueprintId).toBe('bp-a')
    expect(countWare(state, 'min-b')).toBe(8) // 材料退回
    expect(state.aiCores['basic']).toBe(1) // 核心归还（另一条仍占用 1）
    // 取消不存在线 → 拒绝
    expect(cancelManufacturing(state, ctx, bRunId).ok).toBe(false)
  })

  it('老档遗留旧作业（无 worker）豁免：照常到点完成、不占主控（主控可再亲自开线）', () => {
    // 模拟旧档在跑线：材料当时已扣，运行中
    state.warehouse.items['min-a'] = 10
    state.manufacturingRuns.push({
      active: true,
      id: state.manufacturingSeq++,
      blueprintId: 'bp-a',
      finishAtGameMs: state.gameMs + 600_000,
      durationMs: 600_000,
      // worker 缺省 = 旧作业
    })
    expect(manufacturingManualActive(state)).toBe(false) // 旧作业不占主控
    const views0 = manufacturingRunViews(state, ctx)
    expect(views0[0]!.worker).toBeNull()
    expect(views0[0]!.workerLabel).toBe('旧作业')
    // 主控仍可亲自开一条新线（与旧作业并行）
    expect(startManufacturing(state, 'bp-a', 'pilot', ctx).ok).toBe(true)
    expect(state.manufacturingRuns).toHaveLength(2)
    expect(manufacturingManualActive(state)).toBe(true)
    // 双双到点完成（旧作业不需要劳动者位）
    advanceGame(state, 600_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(countModule(state, 'mod-a')).toBe(2)
  })

  it('时间推进到点自动完成：装备入库、线移除、写日志', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', 'pilot', ctx)
    // 还差 1 秒
    advanceGame(state, 599_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(1)
    expect(countModule(state, 'mod-a')).toBe(0)
    // 最后一秒到点
    advanceGame(state, 2_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(countModule(state, 'mod-a')).toBe(1)
    expect(state.logs.some((l) => l.text.includes('制造完成'))).toBe(true)
  })

  it('作业耗时开工即锁定：中途升技能不改变完成时刻', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', 'pilot', ctx) // 600 秒
    state.skills.trained['industry'] = 5 // 中途升到 5 级
    advanceGame(state, 449_999, ctx)
    expect(state.manufacturingRuns).toHaveLength(1) // 锁 600s，未完成
    advanceGame(state, 200_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(0) // 超过 600s 完成
    expect(countModule(state, 'mod-a')).toBe(1)
  })

  it('离线巨量时间一步推进也能完成制造', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', 'pilot', ctx)
    advanceGame(state, 2_000_000, ctx)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(countModule(state, 'mod-a')).toBe(1)
  })

  it('制造状态查询：进度百分比与剩余时间准确（逐线 view 带 id/worker）', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', 'pilot', ctx)
    advanceGame(state, 300_000, ctx) // 一半
    const views = manufacturingRunViews(state, ctx)
    expect(views).toHaveLength(1)
    expect(views[0]!.active).toBe(true)
    expect(views[0]!.productName).toBe('模块mod-a')
    expect(views[0]!.worker).toBe('pilot')
    expect(views[0]!.workerLabel).toBe('主控')
    expect(views[0]!.remainingMs).toBe(300_000)
    expect(views[0]!.percent).toBeCloseTo(50, 0)
    expect(views[0]!.id).toBeGreaterThan(0)
  })
})

describe('装备装配与加成', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx() // mod-a：miner +50%；mod-b：cargo +30%
  })

  it('装配（V18）：装入槽类首空位、装备库扣 1；库空/未持有被拒绝', () => {
    state.moduleBay['mod-a'] = 1
    const r = fitModule(state, 'mod-a', ctx)
    expect(r.ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.high[0]).toBe('mod-a') // 采集器 → 高槽首空位
    expect(countModule(state, 'mod-a')).toBe(0)
    expect(fitModule(state, 'mod-a', ctx).ok).toBe(false) // 装备库已空
    expect(fitModule(state, 'mod-b', ctx).ok).toBe(false) // 未持有
  })

  it('复数安装：可叠件多把并存（矿枪 ×2）；槽类位满后拒绝第三件', () => {
    const ctx2 = makeTestCtx({ modules: [moduleDef('mod-c', 'miner', 0.2), moduleDef('mod-d', 'miner', 0.3)] })
    state.moduleBay['mod-a'] = 1
    state.moduleBay['mod-c'] = 1
    state.moduleBay['mod-d'] = 1
    expect(fitModule(state, 'mod-a', ctx2).ok).toBe(true)
    const r = fitModule(state, 'mod-c', ctx2)
    expect(r.ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.high[0]).toBe('mod-a') // 旧件不自动退（复数共存）
    expect(state.fleet[state.shipId].fitted.high[1]).toBe('mod-c')
    expect(countModule(state, 'mod-a')).toBe(0)
    expect(countModule(state, 'mod-c')).toBe(0)
    // 高槽满（2/2）：第三把矿枪被拒
    const r3 = fitModule(state, 'mod-d', ctx2)
    expect(r3.ok).toBe(false)
    expect(r3.error).toContain('高槽已满')
    expect(state.moduleBay['mod-d']).toBe(1) // 未扣库
  })

  it('卸下（unfitAt 按 槽类+位）：装备放回装备库', () => {
    state.moduleBay['mod-b'] = 1
    fitModule(state, 'mod-b', ctx)
    expect(unfitAt(state, 'low', 0)).toBe(true)
    expect(state.fleet[state.shipId].fitted.low[0]).toBeNull()
    expect(countModule(state, 'mod-b')).toBe(1)
    expect(unfitAt(state, 'low', 0)).toBe(false) // 空位卸无可卸
    expect(unfitAt(state, 'high', 5)).toBe(false) // 越界位拒绝
  })

  it('采集器加成接入采矿：+50% 产量 → 每循环 15 单位', () => {
    state.moduleBay['mod-a'] = 1
    fitModule(state, 'mod-a', ctx)
    startMining(state, 'belt-a', ctx)
    expect(miningStatus(state, ctx).unitsPerCycle).toBe(15) // floor(10 × 1.5)
    advanceGame(state, 12_000, ctx) // 去程取消：指令即采掘 → 1 个循环
    expect(countItem(state, 'ore-a')).toBe(15)
  })

  it('货舱扩展加成接入容量：+30% → 1040 m³', () => {
    state.moduleBay['mod-b'] = 1
    fitModule(state, 'mod-b', ctx)
    expect(cargoCapacityM3(state, ctx)).toBe(1_040)
  })

  it('炮台（V18）：与采集器同高槽复数并存；火力指数不含装备；换炮先卸后装', () => {
    state.moduleBay['mod-a'] = 1 // miner 件
    // 默认测试装备没有 turret 类，补一个
    const ctxWithTurret = makeTestCtx({ modules: [moduleDef('mod-t', 'turret', 0.6)] })
    state.moduleBay['mod-t'] = 1
    expect(fitModule(state, 'mod-a', ctxWithTurret).ok).toBe(true)
    expect(fitModule(state, 'mod-t', ctxWithTurret).ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.high[0]).toBe('mod-a') // 矿枪先装占首空位
    expect(state.fleet[state.shipId].fitted.high[1]).toBe('mod-t') // 炮台占第二高位
    // V17：火力指数（calcPower）只计基础 + 炮术 + 船型加成——炮台不再以百分比乘入，
    // 其真实战力由 battleWinPreview 期望推演评估（装备 = 弹伤害 × dmgMult × 技能）
    expect(calcPower(state, ctxWithTurret)).toBeCloseTo(10, 5)
    // 换炮：卸下旧炮再装新炮（V18 无自动替换——复数语义）
    const ctxT2 = makeTestCtx({ modules: [moduleDef('mod-t2', 'turret', 0.25), moduleDef('mod-t', 'turret', 0.6)] })
    state.moduleBay['mod-t2'] = 1
    expect(unfitAt(state, 'high', 1)).toBe(true)
    expect(fitModule(state, 'mod-t2', ctxT2).ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.high[1]).toBe('mod-t2')
    expect(countModule(state, 'mod-t')).toBe(1) // 卸下的旧炮台退回装备库
  })
})
