/**
 * B3 残骸密度引擎单元测试（2026-09-05 船长定稿口径，docs/design/b3-salvage.md）：
 * 基础密度公式 / 击杀注入无上限 / 闲置漂移（48h 衰减·4h 回升·打捞中挂起·回 base 清记录）/
 * 打捞放干守恒（每轮扣超出量 2%、保底线 5 进位、保底稳态半效不扣）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { galaxy, makeTestCtx } from './helpers'
import {
  WRECK_DECAY_MS,
  WRECK_RECOVER_MS,
  advanceWreckDrift,
  injectWreckDensity,
  salvageRoundPull,
  wreckBaseDensity,
  wreckDensityOf,
  wreckItemDefOf,
  wreckItemIdOf,
  anomalyIdOfWreck,
} from '../src/salvage'

/** 带 security 的测试星系（hub=母港高安 1.0 / kor=中安 0.5 / grave=低安 −1.0 / abyss −0.7） */
function ctxOf() {
  return makeTestCtx({
    galaxies: [
      { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
      { ...galaxy('galaxy-kor', '柯尔'), security: 0.5 },
      { ...galaxy('galaxy-grave', '坟场'), security: -1.0 },
      { ...galaxy('galaxy-abyss', '深渊'), security: -0.7 },
    ],
  })
}

describe('B3 星系基础密度（公式 round(10+15×(1−security)) ∈ [10,40]）', () => {
  it('只随危险度：新手高安 10 → 最危险低安 40', () => {
    const ctx = ctxOf()
    expect(wreckBaseDensity('galaxy-hub', ctx)).toBe(10)
    expect(wreckBaseDensity('galaxy-kor', ctx)).toBe(18) // round(17.5)
    expect(wreckBaseDensity('galaxy-abyss', ctx)).toBe(36)
    expect(wreckBaseDensity('galaxy-grave', ctx)).toBe(40)
  })
})

describe('击杀注入', () => {
  it('Δ = 威胁×0.4，可叠加无上限；初始无记录 = 基础密度', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx = ctxOf()
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBe(18) // 无记录 = base
    injectWreckDensity(state, ctx, 'galaxy-kor', 45)
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBeCloseTo(18 + 18, 10)
    injectWreckDensity(state, ctx, 'galaxy-kor', 45)
    injectWreckDensity(state, ctx, 'galaxy-kor', 45) // 无上限
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBeCloseTo(18 + 54, 10)
    injectWreckDensity(state, ctx, 'galaxy-kor', 0) // 非正威胁不注入不建记录
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBeCloseTo(18 + 54, 10)
  })
})

describe('闲置漂移（打捞中挂起；回 base 自动清记录）', () => {
  it('>base：单次推进满 48h 恰好回 base（中途 24h 收掉一半间距），到 base 记录清除', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-hub'] = { density: 58, rare: 0 } // base10，超出 48
    advanceWreckDrift(state, ctx, WRECK_DECAY_MS / 2) // 24h：收一半 → 34
    expect(state.galaxyWrecks['galaxy-hub']!.density).toBeCloseTo(34, 10)
    advanceWreckDrift(state, ctx, WRECK_DECAY_MS) // 再满 48h（间距×1）→ 回到 base
    expect(state.galaxyWrecks['galaxy-hub']).toBeUndefined()
    expect(wreckDensityOf(state, 'galaxy-hub', ctx)).toBe(10)
  })

  it('<base：4h 线性回升回 base（打捞到底后的回流），到 base 记录清除', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-kor'] = { density: 5, rare: 0 } // base18 下方（打捞到底）
    advanceWreckDrift(state, ctx, WRECK_RECOVER_MS / 4) // 1h → +25% 间距
    expect(state.galaxyWrecks['galaxy-kor']!.density).toBeCloseTo(5 + 13 * 0.25, 10)
    advanceWreckDrift(state, ctx, WRECK_RECOVER_MS) // 满 4h → 回 base
    expect(state.galaxyWrecks['galaxy-kor']).toBeUndefined()
  })

  it('正在打捞的星系双向漂移挂起（advanceGame 传入 salvagingGalaxyId）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-hub'] = { density: 58, rare: 0 }
    state.galaxyWrecks['galaxy-kor'] = { density: 5, rare: 0 }
    advanceWreckDrift(state, ctx, WRECK_DECAY_MS, 'galaxy-hub') // 挂起 hub；kor 正常回升
    expect(state.galaxyWrecks['galaxy-hub']!.density).toBe(58)
    expect(state.galaxyWrecks['galaxy-kor']).toBeUndefined() // kor 已回 base 清记录
  })
})

describe('残骸物品（按敌群注册；乙案：计数 = 体积 → unit 恒 1 m³，数量即体积）', () => {
  it('id/名称/计数口径正确；id ↔ 敌群互转', () => {
    const def = wreckItemDefOf('ano-training', '演习场讨伐令', 6)
    expect(def.id).toBe('wreck-ano-training')
    expect(def.kind).toBe('wreck')
    expect(def.unitM3).toBe(1) // 计数 = 体积（m³）：数量即体积
    expect(def.baseSellPriceIsk).toBe(1) // 残骸不可直接卖钱
    expect(wreckItemIdOf('ano-x')).toBe('wreck-ano-x')
    expect(anomalyIdOfWreck('wreck-ano-x')).toBe('ano-x')
    expect(anomalyIdOfWreck('ore-a')).toBeNull()
  })
})

describe('打捞放干守恒（每轮扣当前超出量 2%，保底线 5）', () => {
  it('密度越高每瓢越肥（mul = max(0.5, d/10)），扣减随超出量指数放干', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-grave'] = { density: 40, rare: 0 } // 最危险 base 40
    const mul1 = salvageRoundPull(state, ctx, 'galaxy-grave')
    expect(mul1).toBe(4)
    expect(state.galaxyWrecks['galaxy-grave']!.density).toBeCloseTo(40 - 35 * 0.02, 10) // 39.3
    // 连续多轮 → 向保底线收敛（每轮扣 2% 超出量；间距 <0.05 进位到保底线 5）
    for (let i = 0; i < 400; i++) salvageRoundPull(state, ctx, 'galaxy-grave')
    const d = state.galaxyWrecks['galaxy-grave']!.density
    expect(d).toBe(5) // 进位收口
    // 保底稳态：≤5 后不扣密度、mul 恒 0.5（半效），且不再写记录变化
    state.galaxyWrecks['galaxy-grave'] = { density: 5, rare: 0 }
    const mulFloor = salvageRoundPull(state, ctx, 'galaxy-grave')
    expect(mulFloor).toBe(0.5)
    expect(state.galaxyWrecks['galaxy-grave']!.density).toBe(5)
  })
})
