/**
 * B3 残骸密度引擎单元测试（docs/design/b3-salvage.md）：
 * 基础密度（2026-09-10 改口径：按各星系可见悬赏「20 次注入」求和，无卡回退安全等级曲线）/
 * 击杀注入给定量 / 闲置漂移（48h 衰减·4h 回升·打捞中挂起·回 base 清记录）/
 * 打捞放干守恒（每轮扣超出量 2%、保底线 5 进位、保底稳态半效不扣）。
 *
 * 注意：测试 ctx 默认带若干测试悬赏卡（helpers），凡"无可见卡星系"才走安全等级兜底；
 * 机制类用例统一用无卡的 galaxy-kor / galaxy-grave，避免受默认卡影响。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { anomaly, galaxy, makeTestCtx } from './helpers'
import {
  RECYCLE_TIER_DIRE,
  RECYCLE_TIER_RISKY,
  WRECK_DECAY_MS,
  WRECK_RECOVER_MS,
  advanceWreckDrift,
  bountyEnemyCount,
  bountyWreckInjection,
  injectWreckDensity,
  recycleTierOf,
  salvageRoundPull,
  strongestBountyInjection,
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

describe('B3 星系基础密度（2026-09-10：按各自星系的可见悬赏卡「20 次注入」求和）', () => {
  it('无可见悬赏卡的星系回退安全等级曲线：高安 10 → 最危险低安 40', () => {
    const ctx = ctxOf()
    expect(wreckBaseDensity('galaxy-kor', ctx)).toBe(18) // round(17.5)
    expect(wreckBaseDensity('galaxy-abyss', ctx)).toBe(36)
    expect(wreckBaseDensity('galaxy-grave', ctx)).toBe(40)
  })

  it('有卡的星系 = 该星系全部可见卡注入量之和 ×20（两卡求和、含敌人数加成）', () => {
    const ctx = makeTestCtx({
      galaxies: [{ ...galaxy('galaxy-two', '双卡星系'), security: 0.5 }],
      anomalies: [
        anomaly('ano-two-a', 'galaxy-two', { threat: 40 }), // 单敌：40×0.4×1.2 = 19.2
        anomaly('ano-two-b', 'galaxy-two', { threat: 60, waves: [{ units: 3, hpShare: 1 }] }), // 3 敌：60×0.4×1.6 = 38.4
      ],
    })
    const expectBase = Math.round(20 * (bountyWreckInjection(40, 1) + bountyWreckInjection(60, 3)))
    expect(wreckBaseDensity('galaxy-two', ctx)).toBe(expectBase) // 20×(19.2+38.4) = 1152
    expect(expectBase).toBe(1152)
  })

  it('隐藏卡（遭遇模板）不计入；最强卡注入量 = 各卡注入最大值（遇袭基准）', () => {
    const ctx = makeTestCtx({
      galaxies: [{ ...galaxy('galaxy-mix', '混合星系'), security: 0.1 }],
      anomalies: [
        anomaly('ano-mix-a', 'galaxy-mix', { threat: 30 }),
        anomaly('ano-mix-b', 'galaxy-mix', { threat: 70, waves: [{ units: 5, hpShare: 1 }] }),
        { ...anomaly('ano-mix-hidden', 'galaxy-mix', { threat: 200 }), hidden: true },
      ],
    })
    expect(wreckBaseDensity('galaxy-mix', ctx)).toBe(
      Math.round(20 * (bountyWreckInjection(30, 1) + bountyWreckInjection(70, 5))),
    )
    expect(strongestBountyInjection('galaxy-mix', ctx)).toBeCloseTo(bountyWreckInjection(70, 5), 10)
    expect(strongestBountyInjection('galaxy-empty', ctx)).toBeNull()
  })

  it('敌人数口径：主舰+僚机+多波全部单位；无波表 = 1', () => {
    expect(bountyEnemyCount({ waves: undefined })).toBe(1)
    expect(bountyEnemyCount({ waves: [{ units: 2, hpShare: 0.5 }, { units: 1, hpShare: 0.5 }] })).toBe(3)
    expect(bountyEnemyCount({ waves: [{ units: 2, hpShare: 0.4 }, { units: 2, hpShare: 0.4 }, { units: 1, hpShare: 0.2 }] })).toBe(5)
    // 每敌 +20%：单敌 ×1.2 / 三敌 ×1.6 / 五敌 ×2.0
    expect(bountyWreckInjection(100, 1)).toBeCloseTo(48, 10)
    expect(bountyWreckInjection(100, 3)).toBeCloseTo(64, 10)
    expect(bountyWreckInjection(100, 5)).toBeCloseTo(80, 10)
  })
})

describe('击杀注入（2026-09-10：注入给定量；调用方按 威胁×0.4×(1+0.2N) 计算）', () => {
  it('给定量可叠加无上限；初始无记录 = 基础密度；非正量不建记录', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const ctx = ctxOf()
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBe(18) // 无记录 = base（18）
    injectWreckDensity(state, ctx, 'galaxy-kor', 45)
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBeCloseTo(63, 10)
    injectWreckDensity(state, ctx, 'galaxy-kor', 45)
    injectWreckDensity(state, ctx, 'galaxy-kor', 45) // 无上限
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBeCloseTo(153, 10)
    injectWreckDensity(state, ctx, 'galaxy-kor', 0) // 非正量不注入
    expect(wreckDensityOf(state, 'galaxy-kor', ctx)).toBeCloseTo(153, 10)
  })
})

describe('回收档位阈值（2026-09-10 随基础密度等比上移：险 428 / 危 642）', () => {
  it('边界：<428 常、428~641 险、≥642 危', () => {
    expect(RECYCLE_TIER_RISKY).toBe(428)
    expect(RECYCLE_TIER_DIRE).toBe(642)
    expect(recycleTierOf(427)).toBe('common')
    expect(recycleTierOf(RECYCLE_TIER_RISKY)).toBe('risky')
    expect(recycleTierOf(RECYCLE_TIER_DIRE - 1)).toBe('risky')
    expect(recycleTierOf(RECYCLE_TIER_DIRE)).toBe('dire')
    expect(recycleTierOf(1536)).toBe('dire')
  })
})

describe('闲置漂移（打捞中挂起；回 base 自动清记录）', () => {
  it('>base：单次推进满 48h 恰好回 base（中途 24h 收掉一半间距），到 base 记录清除', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-grave'] = { density: 88, rare: 0 } // base40，超出 48
    advanceWreckDrift(state, ctx, WRECK_DECAY_MS / 2) // 24h：收一半 → 64
    expect(state.galaxyWrecks['galaxy-grave']!.density).toBeCloseTo(64, 10)
    advanceWreckDrift(state, ctx, WRECK_DECAY_MS) // 再满 48h（间距×1）→ 回到 base
    expect(state.galaxyWrecks['galaxy-grave']).toBeUndefined()
    expect(wreckDensityOf(state, 'galaxy-grave', ctx)).toBe(40)
  })

  it('<base：96h 线性回升回 base（2026-09-10 船长：恢复速度大幅下调），到 base 记录清除', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 9 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-kor'] = { density: 5, rare: 0 } // base18 下方（打捞到底）
    advanceWreckDrift(state, ctx, WRECK_RECOVER_MS / 4) // 1/4 段 → +25% 间距
    expect(state.galaxyWrecks['galaxy-kor']!.density).toBeCloseTo(5 + 13 * 0.25, 10)
    advanceWreckDrift(state, ctx, WRECK_RECOVER_MS) // 满 96h → 回 base
    expect(state.galaxyWrecks['galaxy-kor']).toBeUndefined()
  })

  it('正在打捞的星系双向漂移挂起（advanceGame 传入 salvagingGalaxyId）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-grave'] = { density: 88, rare: 0 }
    state.galaxyWrecks['galaxy-kor'] = { density: 5, rare: 0 }
    advanceWreckDrift(state, ctx, WRECK_RECOVER_MS, 'galaxy-grave') // 挂起 grave；kor 正常回升（96h 满程）
    expect(state.galaxyWrecks['galaxy-grave']!.density).toBe(88)
    expect(state.galaxyWrecks['galaxy-kor']).toBeUndefined() // kor 已回 base 清记录
  })
})

describe('残骸物品（按敌群注册；乙案：计数 = 体积 → unit 恒 1 m³，数量即体积）', () => {
  it('id/名称/计数口径正确；id ↔ 敌群互转', () => {
    const def = wreckItemDefOf('ano-training', '演习场驱逐令', 6)
    expect(def.id).toBe('wreck-ano-training')
    expect(def.kind).toBe('wreck')
    expect(def.unitM3).toBe(1) // 计数 = 体积（m³）：数量即体积
    expect(def.baseSellPriceIsk).toBe(1) // 残骸物品本身不带价（站内收价由市场收购卡定，见 marketCatalog 残骸卡）
    expect(wreckItemIdOf('ano-x')).toBe('wreck-ano-x')
    expect(anomalyIdOfWreck('wreck-ano-x')).toBe('ano-x')
    expect(anomalyIdOfWreck('ore-a')).toBeNull()
  })
})

describe('打捞放干守恒（每轮扣当前超出量 2%，保底线 10）', () => {
  it('密度越高每瓢越肥（mul = max(0.5, d/10)，分母不变），扣减随超出量指数放干', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 13 })
    const ctx = ctxOf()
    state.galaxyWrecks['galaxy-grave'] = { density: 40, rare: 0 } // 无卡低安兜底 base 40
    const mul1 = salvageRoundPull(state, ctx, 'galaxy-grave')
    expect(mul1).toBe(4)
    expect(state.galaxyWrecks['galaxy-grave']!.density).toBeCloseTo(40 - 30 * 0.02, 10) // 超出量 = 40−10 → 39.4
    // 连续多轮 → 向保底线收敛（每轮扣 2% 超出量；间距 <0.05 进位到保底线 10）
    for (let i = 0; i < 400; i++) salvageRoundPull(state, ctx, 'galaxy-grave')
    const d = state.galaxyWrecks['galaxy-grave']!.density
    expect(d).toBe(10) // 进位收口（2026-09-10 保底线 5 → 10）
    // 保底稳态：≤10 不扣密度；mul 分母不变（d/10）→ 密度 10 时系数 = 1.0
    state.galaxyWrecks['galaxy-grave'] = { density: 10, rare: 0 }
    const mulFloor = salvageRoundPull(state, ctx, 'galaxy-grave')
    expect(mulFloor).toBe(1)
    expect(state.galaxyWrecks['galaxy-grave']!.density).toBe(10)
  })
})
