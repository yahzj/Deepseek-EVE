/**
 * V16 矿带分层与复合产出池测试：
 * 复合带按权重出多品种 / 单产带不消耗 rng / 被删矿石的 v15→v16 折算迁移。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { BeltDef, SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { countItem, countWare } from '../src/inventory'
import { miningStatus, rollBeltOutput, startMining } from '../src/mining'
import { assignAiMining, gainAiCore } from '../src/ai'
import { belt, makeTestCtx, ore , fittedOf } from './helpers'
import { loadSaveFile, serializeSaveFile } from '../src/save'

function mixedBelt(): BeltDef {
  return {
    ...belt('belt-mix', 'ore-a', '混合带'),
    outputs: [
      { itemId: 'ore-a', weight: 55 },
      { itemId: 'ore-b', weight: 30 },
      { itemId: 'ore-c', weight: 15 },
    ],
  }
}

describe('V16 复合矿带：按权重抽取产出', () => {
  let ctx: SimContext
  beforeEach(() => {
    ctx = makeTestCtx({ items: [ore('ore-c')], belts: [mixedBelt()] })
  })

  it('rollBeltOutput：单产物带不掷（返回主产物）；复合带按权重落在合法条目内', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    const single = ctx.belts.get('belt-a')!
    const rngBefore = state.rng.count
    for (let i = 0; i < 20; i++) {
      const r = rollBeltOutput(state, ctx, single)
      expect(r!.id).toBe('ore-a')
    }
    expect(state.rng.count).toBe(rngBefore) // 单产带零 rng 消耗（既有确定性不变）
    const mix = ctx.belts.get('belt-mix')!
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(rollBeltOutput(state, ctx, mix)!.id)
    expect(seen.size).toBeGreaterThan(1)
    expect(state.rng.count).toBeGreaterThan(rngBefore)
  })

  it('主控长采：多品种混装、主产物占比占优（550 循环；含多次自动卸货入仓）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.debugQuick = true // 1 秒/循环
    expect(startMining(state, 'belt-mix', ctx).ok).toBe(true)
    advanceGame(state, 550_000, ctx)
    const totalOf = (id: string): number => countItem(state, id) + countWare(state, id)
    const a = totalOf('ore-a')
    const b = totalOf('ore-b')
    const c = totalOf('ore-c')
    const total = a + b + c
    // 550 循环 ×10 单位 ≈ 5500（富矿脉少量翻倍）
    expect(total).toBeGreaterThan(4_800)
    expect(total).toBeLessThan(6_500)
    expect(Math.min(a, b, c)).toBeGreaterThan(0) // 三种都出现过
    expect(a / total).toBeGreaterThan(0.42)
    expect(a / total).toBeLessThan(0.68)
  })

  it('AI 采矿同样按池混装（仓库+货仓合计多品种）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    state.debugQuick = true
    state.skills.trained['ai-expert'] = 1
    state.fleet['sandcat2'] = {
      durability: 1,
      cargo: {},
      fitted: fittedOf({ turret: null, miner: null, shield: null, propulsion: null, armor: null, cargo: null }),
    }
    gainAiCore(state, 'basic', 2)
    expect(assignAiMining(state, 'sandcat2', 'basic', 'belt-mix', ctx).ok).toBe(true)
    advanceGame(state, 300_000, ctx) // 300 循环，足够多趟
    const ids = ['ore-a', 'ore-b', 'ore-c']
    const counts = ids.map((id) => (state.fleet['sandcat2']!.cargo[id] ?? 0) + countWare(state, id))
    expect(counts.filter((n) => n > 0).length).toBeGreaterThan(1)
    expect(Math.max(...counts)).toBeGreaterThan(0)
  })
})

describe('V16 迁移：被删矿石折算', () => {
  it('仓库/货仓/锁仓/挂单全部折算成矿物入仓，键清理，日志说明', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    // 克洛基石 ×150（仓库 100 + 锁仓 50）；熔辉石 ×10（仓库）；赤曜石 ×5（船货仓）
    state.warehouse.items['ore-kernite'] = 100
    state.warehouse.items['ore-fluxite'] = 10
    state.fleet['sandcat']!.cargo['ore-crimsonite'] = 5
    state.escrowItems['ore-kernite'] = 50
    state.orders.push({ id: 1, side: 'sell', good: 'ore-kernite', price: 30, qty: 50, filled: 0, placedAtGameMs: 0 })
    state.market.npcBuy['ore-fluxite'] = [{ price: 100, qty: 1, expiresAtGameMs: 9_999_999 }]
    const raw = state as unknown as Record<string, unknown>
    raw.version = 15
    const loaded = loadSaveFile(serializeSaveFile(state, 1000))
    const s = loaded.state
    expect(s.version).toBe(18)
    expect(s.warehouse.items['ore-kernite']).toBeUndefined()
    expect(s.warehouse.items['ore-fluxite']).toBeUndefined()
    expect(s.fleet['sandcat']!.cargo['ore-crimsonite']).toBeUndefined()
    expect(s.escrowItems['ore-kernite']).toBeUndefined()
    expect(s.orders.length).toBe(0)
    expect(s.market.npcBuy['ore-fluxite']).toBeUndefined()
    // kernite150 → mexa 180 + nox 22；fluxite10 → iso15 star5 mexa11；crimsonite5 → star5 mexa9 iso2
    expect(s.warehouse.items['min-mexallon'] ?? 0).toBe(180 + 11 + 9)
    expect(s.warehouse.items['min-nocxium'] ?? 0).toBe(22)
    expect(s.warehouse.items['min-isotope'] ?? 0).toBe(15 + 2)
    expect(s.warehouse.items['min-starcore'] ?? 0).toBe(5 + 5)
    expect(s.logs.some((l) => l.text.includes('内容整合'))).toBe(true)
  })

  it('无损档（无被删矿石）迁移不写折算日志', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const raw = state as unknown as Record<string, unknown>
    raw.version = 15
    const loaded = loadSaveFile(serializeSaveFile(state, 1000))
    expect(loaded.state.version).toBe(18)
    expect(loaded.state.logs.some((l) => l.text.includes('内容整合'))).toBe(false)
  })
})
