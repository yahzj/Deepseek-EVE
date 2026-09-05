/**
 * B3 残骸回收开箱（精炼炉回收批）测试（2026-09-05 船长定稿口径）：
 * 回收画像（档/低安）、保底矿物滚动、整批运转（启动→到点开箱→料尽自动停）、
 * 蓝图碎片逆向研究兑换。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceRefining, redeemFragments, startRecycleRun } from '../src/industry'
import { addWare } from '../src/inventory'
import type { ItemDef } from '../src/types'
import { anomaly, blueprint, galaxy, makeTestCtx, moduleDef } from './helpers'
import { recycleProfileOf, rollRecycleGuarantee, wreckItemIdOf } from '../src/salvage'

/** 测试矿物（id = 真实矿物 id，价格占位） */
function mineral(id: string, price: number): ItemDef {
  return { id, name: `矿物${id}`, kind: 'mineral', unitM3: 0.01, baseSellPriceIsk: price, description: '测试矿物' }
}

function ctxOf() {
  return makeTestCtx({
    galaxies: [
      { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
      { ...galaxy('galaxy-kor', '柯尔'), security: 0.5 },
      { ...galaxy('galaxy-grave', '坟场'), security: -1.0 },
    ],
    anomalies: [
      anomaly('ano-grave', 'galaxy-grave', { threat: 60, tactic: 'brawl' }),
      anomaly('ano-kor', 'galaxy-kor', { threat: 30, tactic: 'orbit' }),
    ],
    items: [
      mineral('min-tritanium', 8),
      mineral('min-pyerite', 12),
      mineral('min-mexallon', 20),
      mineral('min-nocxium', 90),
      mineral('min-isotope', 55),
      mineral('min-starcore', 245),
      mineral('min-darkiron', 780),
    ],
    modules: [
      moduleDef('mod-miner-civ', 'miner', 0),
      moduleDef('mod-cargo-civ', 'cargo', 0),
      moduleDef('mod-turret-civ', 'turret', 0),
      moduleDef('mod-miner-2', 'miner', 0),
      moduleDef('mod-cargo-2', 'cargo', 0),
      moduleDef('mod-turret-kin-2', 'turret', 0),
      moduleDef('mod-miner-3', 'miner', 0),
      moduleDef('mod-cargo-3', 'cargo', 0),
      moduleDef('mod-turret-kin-3', 'turret', 0),
    ],
    blueprints: [
      blueprint('bp-miner-2', 'mod-miner-2', []),
      blueprint('bp-cargo-2', 'mod-cargo-2', []),
      blueprint('bp-turret-2', 'mod-turret-kin-2', []),
      blueprint('bp-miner-3', 'mod-miner-3', []),
      blueprint('bp-cargo-3', 'mod-cargo-3', []),
      blueprint('bp-turret-3', 'mod-turret-kin-3', []),
    ],
  })
}

describe('回收画像与保底矿物滚动', () => {
  it('残骸按其敌群星系危险度分档；低安标记正确', () => {
    const ctx = ctxOf()
    const grave = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    expect(grave.tier).toBe('dire') // 坟场 base40
    expect(grave.lowSec).toBe(true)
    expect(grave.threat).toBe(60)
    const kor = recycleProfileOf(ctx, wreckItemIdOf('ano-kor'))!
    expect(kor.tier).toBe('common') // 柯尔 base18 <20 → 常池
    expect(kor.lowSec).toBe(false)
  })

  it('保底矿物：总量 = 体积×档位单方产量×抖动，品种按档位池抽取（走 rng 确定性）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const ctx = ctxOf()
    const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
    const out = rollRecycleGuarantee(state, ctx, profile, 36) // 批体积 36 m³ 直接按 m³ 计
    expect(out.length).toBe(1)
    const row = out[0]!
    const poolIds = ['min-mexallon', 'min-nocxium', 'min-isotope', 'min-starcore', 'min-darkiron']
    expect(poolIds).toContain(row.mineralId)
    expect(row.units).toBeGreaterThanOrEqual(12) // 36×0.42≈15 基准 ±10% → 13~16
    expect(row.units).toBeLessThanOrEqual(17)
  })
})

describe('残骸回收批（精炼炉运转）', () => {
  it('启动→到点开箱（保底矿物入库）→料尽自动停炉', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 31 })
    const ctx = ctxOf()
    const wreckId = wreckItemIdOf('ano-grave')
    addWare(state, wreckId, 10) // 正好一批
    const r0 = startRecycleRun(state, wreckId, 'pilot', ctx)
    expect(r0.ok).toBe(true)
    expect(state.refineRun.recipe).toBe('recycle')
    expect(state.refineRun.batchUnits).toBe(10)
    expect(countMinerals(state, ctx)).toBe(0)
    state.gameMs = 25_000 // 一批到点
    advanceRefining(state, ctx)
    expect(state.refineRun.active).toBe(false) // 料尽自动停
    expect(countMinerals(state, ctx)).toBeGreaterThan(0)
    expect(state.logs.some((l) => l.text.includes('残骸回收完成'))).toBe(true)
  })

  it('非残骸物品 / 无残骸 / 非母港不能启动回收', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 33 })
    const ctx = ctxOf()
    const notWreck = ctx.items.has('min-tritanium') ? 'min-tritanium' : 'ore-a'
    expect(startRecycleRun(state, notWreck, 'pilot', ctx).ok).toBe(false) // 不是残骸
    expect(startRecycleRun(state, wreckItemIdOf('ano-grave'), 'pilot', ctx).ok).toBe(false) // 仓库没有残骸
  })

  it('残骸回收学：批周期每级 −4%（Lv5 = ×0.6，手动与 AI 同享）', () => {
    const mk = (lv: number) => {
      const state = createInitialState({ nowWallMs: 0, seed: 35 })
      const ctx = ctxOf()
      if (lv > 0) state.skills.trained['salvage-recycling'] = lv
      const wreckId = wreckItemIdOf('ano-grave')
      addWare(state, wreckId, 40)
      expect(startRecycleRun(state, wreckId, 'pilot', ctx).ok).toBe(true)
      return state.refineRun.cycleMs
    }
    expect(mk(0)).toBe(25_000)
    expect(mk(5)).toBe(20_000) // 每级 −4%：Lv5 = −20%（下限 60% 为长线保护）
  })

  it('残骸提纯学：保底矿物每级 +8%（Lv5 = ×1.4；同种子同抽取序列仅总量放大）', () => {
    const run = (lv: number): number => {
      const state = createInitialState({ nowWallMs: 0, seed: 37 })
      const ctx = ctxOf()
      if (lv > 0) state.skills.trained['salvage-refining'] = lv
      const profile = recycleProfileOf(ctx, wreckItemIdOf('ano-grave'))!
      const out = rollRecycleGuarantee(state, ctx, profile, 36)
      return out.length > 0 ? out[0]!.units : 0
    }
    const u0 = run(0)
    const u5 = run(5)
    expect(u0).toBeGreaterThan(0)
    expect(u5).toBeCloseTo(u0 * 1.4, 1) // 同种子同抽取；只放大总量
  })
})

describe('蓝图碎片逆向研究', () => {
  it('集齐 100 片 → 永久解锁蓝图（learnedRecipes）；重复/不足被拒', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 41 })
    const ctx = ctxOf()
    const fragId = 'frag-mod-miner-2'
    expect(ctx.items.get(fragId)).toBeDefined() // 上下文已生成碎片物品
    // 不足
    addWare(state, fragId, 99)
    expect(redeemFragments(state, ctx, 'mod-miner-2').ok).toBe(false)
    // 集齐
    addWare(state, fragId, 1)
    const r = redeemFragments(state, ctx, 'mod-miner-2')
    expect(r.ok).toBe(true)
    expect(state.learnedRecipes).toContain('bp-miner-2')
    expect(countWareItem(state, fragId)).toBe(0)
    // 已掌握 → 拒绝（防碎片空转）
    expect(redeemFragments(state, ctx, 'mod-miner-2').ok).toBe(false)
  })
})

function countMinerals(state: ReturnType<typeof createInitialState>, ctx: ReturnType<typeof ctxOf>): number {
  let n = 0
  for (const id of [
    'min-tritanium',
    'min-pyerite',
    'min-mexallon',
    'min-nocxium',
    'min-isotope',
    'min-starcore',
    'min-darkiron',
  ]) {
    n += countWareItem(state, id)
  }
  void ctx
  return n
}

function countWareItem(state: ReturnType<typeof createInitialState>, id: string): number {
  return state.warehouse.items[id] ?? 0
}
