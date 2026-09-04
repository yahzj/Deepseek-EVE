/**
 * 蓝图制造与装备装配的单元测试（M2）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { cargoCapacityM3, countItem } from '../src/inventory'
import { countModule, fitModule, unfitAt } from '../src/equipment'
import { miningStatus, startMining } from '../src/mining'
import { calcPower } from '../src/expedition'
import { learnBlueprint } from '../src/market'
import {
  calcBuildDurationMs,
  manufacturingStatus,
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

describe('制造作业', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 1 })
    ctx = makeTestCtx() // bp-a：10 单位矿粉min-a、制造费 500、耗时 600 秒
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a')
  })

  it('未学配方 / 制造费不足 / 材料不足 → 拒绝并说明缺什么', () => {
    const fresh = createInitialState({ nowWallMs: 0, seed: 1 })
    // 未学会配方
    expect(startManufacturing(fresh, 'bp-a', ctx).ok).toBe(false)
    // 制造费不足
    state.warehouse.items['min-a'] = 10
    state.wallet.isk = 100
    expect(startManufacturing(state, 'bp-a', ctx).ok).toBe(false)
    state.wallet.isk = 10_000
    // 材料不足（只有 6/10）→ 错误信息说明缺量
    state.warehouse.items['min-a'] = 6
    const r = startManufacturing(state, 'bp-a', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('材料不足')
    expect(missingMaterials(state, ctx, ctx.blueprints.get('bp-a')!)).toHaveLength(1)
  })

  it('开工成功：扣材料、扣制造费、锁定耗时（600 秒）', () => {
    state.warehouse.items['min-a'] = 10
    const r = startManufacturing(state, 'bp-a', ctx)
    expect(r.ok).toBe(true)
    expect(countItem(state, 'min-a')).toBe(0)
    expect(state.wallet.isk).toBe(9_500) // 10000 - 500(制造费)；学习不花钱
    expect(state.manufacturing.active).toBe(true)
    expect(state.manufacturing.finishAtGameMs).toBe(600_000)
    expect(state.manufacturing.durationMs).toBe(600_000)
    expect(state.logs.some((l) => l.text.includes('制造开始'))).toBe(true)
    // 制造中不能再开工
    expect(startManufacturing(state, 'bp-a', ctx).ok).toBe(false)
  })

  it('工业理论 5 级把耗时缩短 25%（450 秒）', () => {
    state.skills.trained['industry'] = 5
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', ctx)
    expect(state.manufacturing.durationMs).toBe(450_000)
    expect(calcBuildDurationMs(state, ctx, ctx.blueprints.get('bp-a')!)).toBe(450_000)
  })

  it('时间推进到点自动完成：装备入库、作业复位、写日志', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', ctx)
    // 还差 1 秒
    advanceGame(state, 599_000, ctx)
    expect(state.manufacturing.active).toBe(true)
    expect(countModule(state, 'mod-a')).toBe(0)
    // 最后一秒到点
    advanceGame(state, 2_000, ctx)
    expect(state.manufacturing.active).toBe(false)
    expect(state.manufacturing.blueprintId).toBeNull()
    expect(countModule(state, 'mod-a')).toBe(1)
    expect(state.logs.some((l) => l.text.includes('制造完成'))).toBe(true)
  })

  it('作业耗时开工即锁定：中途升技能不改变完成时刻', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', ctx) // 600 秒
    state.skills.trained['industry'] = 5 // 中途升到 5 级
    advanceGame(state, 449_999, ctx)
    expect(state.manufacturing.active).toBe(true) // 锁 600s，未完成
    advanceGame(state, 200_000, ctx)
    expect(state.manufacturing.active).toBe(false) // 超过 600s 完成
    expect(countModule(state, 'mod-a')).toBe(1)
  })

  it('离线巨量时间一步推进也能完成制造', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', ctx)
    advanceGame(state, 2_000_000, ctx)
    expect(state.manufacturing.active).toBe(false)
    expect(countModule(state, 'mod-a')).toBe(1)
  })

  it('制造状态查询：进度百分比与剩余时间准确', () => {
    state.warehouse.items['min-a'] = 10
    startManufacturing(state, 'bp-a', ctx)
    advanceGame(state, 300_000, ctx) // 一半
    const view = manufacturingStatus(state, ctx)
    expect(view.active).toBe(true)
    expect(view.productName).toBe('模块mod-a')
    expect(view.remainingMs).toBe(300_000)
    expect(view.percent).toBeCloseTo(50, 0)
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
    advanceGame(state, 60_000 + 12_000, ctx) // 空船出航 60s + 1 个循环
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
