/**
 * 蓝图制造与装备装配的单元测试（M2）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { cargoCapacityM3, countItem } from '../src/inventory'
import { countModule, fitModule, unfitSlot } from '../src/equipment'
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

  it('装配：装备库扣 1、槽位生效；重复装配/未持有被拒绝', () => {
    state.moduleBay['mod-a'] = 1
    const r = fitModule(state, 'mod-a', ctx)
    expect(r.ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.miner).toBe('mod-a')
    expect(countModule(state, 'mod-a')).toBe(0)
    expect(fitModule(state, 'mod-a', ctx).ok).toBe(false) // 装备库已空
    expect(fitModule(state, 'mod-b', ctx).ok).toBe(false) // 未持有
  })

  it('同槽换装：旧件自动退回装备库', () => {
    const ctx2 = makeTestCtx({ modules: [moduleDef('mod-c', 'miner', 0.2)] })
    state.moduleBay['mod-a'] = 1
    state.moduleBay['mod-c'] = 1
    fitModule(state, 'mod-a', ctx2)
    const r = fitModule(state, 'mod-c', ctx2)
    expect(r.ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.miner).toBe('mod-c')
    expect(countModule(state, 'mod-a')).toBe(1) // 旧件退回
    expect(countModule(state, 'mod-c')).toBe(0)
  })

  it('卸下：装备放回装备库', () => {
    state.moduleBay['mod-b'] = 1
    fitModule(state, 'mod-b', ctx)
    expect(unfitSlot(state, 'cargo')).toBe(true)
    expect(state.fleet[state.shipId].fitted.cargo).toBeNull()
    expect(countModule(state, 'mod-b')).toBe(1)
    expect(unfitSlot(state, 'cargo')).toBe(false) // 空槽卸无可卸
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

  it('炮台槽（M4）：装配到 turret 槽位，与其它槽互不干扰', () => {
    state.moduleBay['mod-a'] = 1 // miner 槽装备
    state.moduleBay['mod-b'] = 1 // cargo 槽装备
    // 默认测试装备没有 turret 类，补一个
    const ctxWithTurret = makeTestCtx({ modules: [moduleDef('mod-t', 'turret', 0.6)] })
    state.moduleBay['mod-t'] = 1
    expect(fitModule(state, 'mod-t', ctxWithTurret).ok).toBe(true)
    expect(state.fleet[state.shipId].fitted.turret).toBe('mod-t')
    expect(state.fleet[state.shipId].fitted.miner).toBeNull()
    // 矿船火力公式读取炮台加成
    expect(calcPower(state, ctxWithTurret)).toBeCloseTo(10 * 1.6, 5)
    // 换装炮台：旧件退回装备库（第一件 mod-t 装配后已出库，换装时退回 1 件）
    const ctxT2 = makeTestCtx({ modules: [moduleDef('mod-t2', 'turret', 0.25), moduleDef('mod-t', 'turret', 0.6)] })
    state.moduleBay['mod-t2'] = 1
    fitModule(state, 'mod-t2', ctxT2)
    expect(state.fleet[state.shipId].fitted.turret).toBe('mod-t2')
    expect(countModule(state, 'mod-t')).toBe(1) // 旧炮台退回装备库
  })
})
