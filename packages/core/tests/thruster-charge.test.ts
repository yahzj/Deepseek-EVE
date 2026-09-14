/**
 * 推进器周期爆发 + 高威胁近战敌突进（2026-09-10 船长定，设计稿 docs/design/thruster-charge-20260910.md）：
 *
 * - **推进器**：不再常驻提速 → 点火 **60 秒** → 冷却 **60 秒**，**开场即点火**；
 *   点火期机动 ×(1+爆发倍率)（MK1 +30%/MK2 +60%/MK3 +100%，多件 EVE 曲线收敛），冷却期回基础值。
 *   周期由**战斗时钟推导**（`thrusterPhase`），不占存档字段。
 * - **敌突进/冲锋**：资格两条来源——**舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件，
 *   用于慢而硬的重型单位）与老路（威胁 ≥ 60 且 战术 = brawl，受总开关约束）；
 *   够不着（距离在自己武器射程之外）时**冲锋者自己**的机动 **×`foeChargeMul`**
 *   （**2026-09-14 船长试验：2.0 → 4.0**；2026-09-11 船长：
 *   「冲锋还是按照**巨兽自己的速度**算…哪怕是冲锋也是按照巨兽速度」——倍率**不外溢**到别的单位）；
 *   **到达目标距离（敌方期望交距）即结束**（2026-09-11 船长改判；原口径"进射程维持 2 秒"作废）；
 *   随后 **20 秒冷却**。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import type { FoeShipDef } from '../src/types'
import { addShipToFleet, createInitialState, createPlayerSpec, effectiveHitMul, repairDeprecatedModules, thrusterCycleFullText, thrusterCycleOfModule, thrusterCycleSeconds, thrusterCycleText, thrusterPhase, unitThrusterCycle } from '../src/index'
import { DEFAULT_BALANCE } from '../src/balance'
import { advanceBattleFor, battleOpenM, createFoeSpecs, foeDesiredRange, startBattleFor } from '../src/combat'
import { anomaly, galaxy, makeTestCtx, moduleDef } from './helpers'

function world(): { state: GameState; ctx: SimContext } {
  // 测试世界默认只有采集/货舱件——这里补三档推进器（数值与 data/modules.ts 一致）
  const ctx = makeTestCtx({
    quietEvents: true,
    modules: [
      moduleDef('mod-prop-1', 'propulsion', 0, { speedBonusPct: 0.3, hitPenalty: 0.05 }),
      moduleDef('mod-prop-2', 'propulsion', 0, { speedBonusPct: 0.6, hitPenalty: 0.12 }),
      moduleDef('mod-prop-3', 'propulsion', 0, { speedBonusPct: 1, hitPenalty: 0.2 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  addShipToFleet(state, 'sandcat2')
  state.shipId = 'sandcat2'
  return { state, ctx }
}

/** 造一艘装了指定数量推进器的驾驶船（用测试装备 id 覆写 speedBonusPct） */
function withThruster(state: GameState, ctx: SimContext, mods: string[]): void {
  state.fleet[state.shipId]!.fitted = { high: [], mid: [...mods], low: [] }
  repairDeprecatedModules(state, ctx)
}

describe('推进器周期爆发（2026-09-10 船长定：点火 60 秒 / 冷却 60 秒 / 开场即点火）', () => {
  it('周期相位：t=0 点火 → 60s 起冷却 → 120s 再次点火；冷却剩余时间为 60s 起算', () => {
    const bal = makeTestCtx().balance.battle
    const at = (ms: number) => thrusterPhase({ startedAtGameMs: 0, lastTickGameMs: ms }, bal)
    expect(at(0).boosting).toBe(true) // 开场即点火
    expect(at(0).remainMs).toBe(bal.thrusterBoostMs)
    expect(at(bal.thrusterBoostMs - 1).boosting).toBe(true)
    expect(at(bal.thrusterBoostMs).boosting).toBe(false) // 点火结束 → 进冷却
    expect(at(bal.thrusterBoostMs).remainMs).toBe(bal.thrusterCooldownMs)
    expect(at(bal.thrusterBoostMs + bal.thrusterCooldownMs - 1).boosting).toBe(false)
    expect(at(bal.thrusterBoostMs + bal.thrusterCooldownMs).boosting).toBe(true) // 第二轮点火
  })

  it('未装推进器：无爆发倍率，机动速度与基础值一致', () => {
    const { state, ctx } = world()
    withThruster(state, ctx, [])
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    expect(spec.thrusterBoost).toBeUndefined()
  })

  it('装推进器：爆发放进 thrusterBoost（不再计入基础 speedMps）；多件按 EVE 曲线收敛', () => {
    const { state, ctx } = world()
    withThruster(state, ctx, ['mod-prop-1'])
    const base = createInitialState({ nowWallMs: 0, seed: 7 })
    addShipToFleet(base, 'sandcat2')
    base.shipId = 'sandcat2'
    const bare = createPlayerSpec(base, ctx, base.shipId)!
    const one = createPlayerSpec(state, ctx, state.shipId)!
    expect(one.speedMps).toBeCloseTo(bare.speedMps, 6) // 基础速度不含推进器
    expect(one.thrusterBoost).toBeGreaterThan(0)
    // 第二件收益递减（EVE 曲线：第二件按 ×0.87 权重并入）——判据是"第二件的**乘数增量**小于第一件"
    withThruster(state, ctx, ['mod-prop-1', 'mod-prop-1'])
    const two = createPlayerSpec(state, ctx, state.shipId)!
    expect(two.thrusterBoost!).toBeGreaterThan(one.thrusterBoost!) // 仍更好
    const firstMul = 1 + one.thrusterBoost!
    const secondMul = (1 + two.thrusterBoost!) / firstMul
    expect(secondMul).toBeLessThan(firstMul) // 递减：第二件的乘数 < 第一件的乘数
  })

  it('失稳代价只在点火期生效（2026-09-10 船长追加）：点火期 = 装配值，冷却期 = 1', () => {
    const { state, ctx } = world()
    withThruster(state, ctx, ['mod-prop-2']) // hitPenalty 0.12
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    expect(spec.hitMul).toBeCloseTo(0.88, 10) // 装配值（点火期）
    expect(effectiveHitMul(spec, true)).toBeCloseTo(0.88, 10)
    expect(effectiveHitMul(spec, false)).toBe(1) // 冷却期：没点火就不失稳
    expect(effectiveHitMul({}, true)).toBe(1) // 无推进器恒为 1
  })

  it('周期口径文案与平衡同源（2026-09-11 船长：持续/冷却时间要在推进器说明里讲清）', () => {
    const bal = makeTestCtx().balance.battle
    expect(thrusterCycleSeconds(bal)).toEqual({ boost: 60, cooldown: 60 })
    expect(thrusterCycleText(bal)).toBe('点火 60 秒 / 冷却 60 秒')
    expect(thrusterCycleFullText(bal)).toBe('60 秒点火 / 60 秒冷却，开场即点火')
    // 改平衡 → 文案跟着变（界面不许写死 60）：45 秒点火 / 30 秒冷却
    const custom = { ...bal, thrusterBoostMs: 45_000, thrusterCooldownMs: 30_000 }
    expect(thrusterCycleText(custom)).toBe('点火 45 秒 / 冷却 30 秒')
    expect(thrusterCycleFullText(custom)).toBe('45 秒点火 / 30 秒冷却，开场即点火')
    // 同源校验：文案里的两个秒数正好是相位切换点（点火结束 / 第二轮点火）
    const at = (ms: number) => thrusterPhase({ startedAtGameMs: 0, lastTickGameMs: ms }, custom)
    expect(at(44_999).boosting).toBe(true)
    expect(at(45_000).boosting).toBe(false) // 45 秒 = 文案的"点火 45 秒"
    expect(at(74_999).boosting).toBe(false)
    expect(at(75_000).boosting).toBe(true) // 45 + 30 = 文案的"冷却 30 秒"
  })
})

describe('微型跃迁引擎（2026-09-14 船长定：中槽短爆发——点火 10 秒 / 冷却 60 秒）', () => {
  /**
   * 测试世界补三档微型跃迁引擎（数值与 `data/modules.ts` 逐字一致）+ 三档矢量推进器：
   * 微型跃迁引擎 = **自带周期覆盖**（10 秒点火 / 60 秒冷却），矢量推进器 = 不写覆盖（走全局 60/60）。
   */
  function mwdWorld(): { state: GameState; ctx: SimContext } {
    const ctx = makeTestCtx({
      quietEvents: true,
      modules: [
        moduleDef('mod-prop-1', 'propulsion', 0, { speedBonusPct: 0.3, hitPenalty: 0.05 }),
        moduleDef('mod-prop-3', 'propulsion', 0, { speedBonusPct: 1, hitPenalty: 0.2 }),
        moduleDef('mod-mwd-1', 'propulsion', 0, {
          speedBonusPct: 0.8,
          hitPenalty: 0.2,
          thrusterBoostMs: 10_000,
          thrusterCooldownMs: 60_000,
        }),
        moduleDef('mod-mwd-2', 'propulsion', 0, {
          speedBonusPct: 1.5,
          hitPenalty: 0.25,
          thrusterBoostMs: 10_000,
          thrusterCooldownMs: 60_000,
        }),
        moduleDef('mod-mwd-3', 'propulsion', 0, {
          speedBonusPct: 2.5,
          hitPenalty: 0.4,
          thrusterBoostMs: 10_000,
          thrusterCooldownMs: 60_000,
        }),
      ],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    addShipToFleet(state, 'sandcat2')
    state.shipId = 'sandcat2'
    return { state, ctx }
  }

  it('三档数值与自带周期：+80/150/250% · 命中 ×0.80/0.75/0.60 · 10 秒点火 / 60 秒冷却（船长给定）', () => {
    const cases = [
      { id: 'mod-mwd-1', boost: 0.8, hit: 0.8 },
      { id: 'mod-mwd-2', boost: 1.5, hit: 0.75 },
      { id: 'mod-mwd-3', boost: 2.5, hit: 0.6 },
    ]
    for (const c of cases) {
      const { state, ctx } = mwdWorld()
      withThruster(state, ctx, [c.id])
      const spec = createPlayerSpec(state, ctx, state.shipId)!
      expect(spec.thrusterBoost, c.id).toBeCloseTo(c.boost, 6)
      expect(spec.hitMul, c.id).toBeCloseTo(c.hit, 6) // 点火期命中代价（1 − hitPenalty）
      expect(spec.thrusterBoostMs, c.id).toBe(10_000) // 件自带周期 → 逐单位写入
      expect(spec.thrusterCooldownMs, c.id).toBe(60_000)
    }
  })

  it('**逐单位相位**：装它的船第 10 秒就进冷却，装矢量推进器的船第 10 秒仍在点火', () => {
    const { state, ctx } = mwdWorld()
    const bal = ctx.balance.battle
    // 同一场战斗里的两条船（同一时钟锚 = 开场即点火）
    const at = (ms: number, spec: Parameters<typeof unitThrusterCycle>[0]): boolean =>
      thrusterPhase({ startedAtGameMs: 0, lastTickGameMs: ms }, bal, unitThrusterCycle(spec, bal)).boosting
    withThruster(state, ctx, ['mod-mwd-1'])
    const mwd = createPlayerSpec(state, ctx, state.shipId)!
    withThruster(state, ctx, ['mod-prop-3'])
    const vec = createPlayerSpec(state, ctx, state.shipId)!
    // t=0~9.999s：两者都在点火
    expect(at(0, mwd)).toBe(true)
    expect(at(9_999, mwd)).toBe(true)
    expect(at(9_999, vec)).toBe(true)
    // t=10s：微型跃迁引擎的点火窗口结束（矢量推进器还有 50 秒）
    expect(at(10_000, mwd)).toBe(false)
    expect(at(10_000, vec)).toBe(true)
    // 周期：微型 10+60=70 秒 ⇒ t=70s 第二轮点火；矢量 60+60=120 秒 ⇒ t=70s 仍在冷却
    expect(at(70_000, mwd)).toBe(true)
    expect(at(70_000, vec)).toBe(false)
    expect(at(120_000, vec)).toBe(true)
  })

  it('一船多件取**点火最短的那件**；没有覆盖件的装配**不写字段**（旧读数逐字不变）', () => {
    const { state, ctx } = mwdWorld()
    const bal = ctx.balance.battle
    // 只装矢量推进器（无覆盖）⇒ 两个字段都不写，走全局 60/60
    withThruster(state, ctx, ['mod-prop-1'])
    const plain = createPlayerSpec(state, ctx, state.shipId)!
    expect(plain.thrusterBoostMs).toBeUndefined()
    expect(plain.thrusterCooldownMs).toBeUndefined()
    expect(unitThrusterCycle(plain, bal)).toEqual({ boostMs: bal.thrusterBoostMs, cooldownMs: bal.thrusterCooldownMs })
    // 矢量 MK3 + 微型 MK1：周期取微型那条（10 秒点火），倍率仍按 EVE 曲线合成
    withThruster(state, ctx, ['mod-prop-3', 'mod-mwd-1'])
    const mixed = createPlayerSpec(state, ctx, state.shipId)!
    expect(mixed.thrusterBoostMs).toBe(10_000)
    expect(mixed.thrusterCooldownMs).toBe(60_000)
    expect(mixed.thrusterBoost!).toBeGreaterThan(1) // 两件合成仍更强
  })

  it('周期文案**按件取值**（2026-09-11 口径不写死秒数 + 2026-09-14 按件覆盖）', () => {
    const bal = makeTestCtx().balance.battle
    const mwdMod = { thrusterBoostMs: 10_000, thrusterCooldownMs: 60_000 } // 模块定义的字段形状
    const mwdCycle = { boostMs: 10_000, cooldownMs: 60_000 } // 周期覆盖的形状（引擎/界面共用）
    expect(thrusterCycleOfModule(mwdMod)).toEqual(mwdCycle)
    expect(thrusterCycleSeconds(bal, mwdCycle)).toEqual({ boost: 10, cooldown: 60 })
    expect(thrusterCycleText(bal, mwdCycle)).toBe('点火 10 秒 / 冷却 60 秒')
    expect(thrusterCycleFullText(bal, mwdCycle)).toBe('10 秒点火 / 60 秒冷却，开场即点火')
    // 没有覆盖（矢量推进器那三档）= 全局 60/60（逐字不变）
    expect(thrusterCycleOfModule({})).toBeUndefined()
    expect(thrusterCycleText(bal, thrusterCycleOfModule({}))).toBe('点火 60 秒 / 冷却 60 秒')
  })

  it('实战：点火窗口**只在前 10 秒**给速度（第 11 秒起回到基础机动）', () => {
    /**
     * 观测法（与"冲锋倍率不外溢"那条同款）：造一个**不会动**的敌人（`speedRatio: 0`），
     * 我方期望交距压到 1m ⇒ **闭距全是我方走的**，于是"前 10 秒 vs 之后"两段闭距直接反映点火窗口。
     */
    const stationary: FoeShipDef = {
      id: 't-foe-still',
      name: '测试静物',
      family: 'E',
      hullClassTier: 3,
      speedRatio: 0,
      hp: 100_000,
      split: { s: 0.34, a: 0.33, h: 0.33 },
      shotDmg: 1,
      hitRate: 0.85,
      reloadMs: 600_000, // 打不疼、也打不死玩家
      rangeMinM: 1,
      rangeMaxM: 12_000,
      falloff: 0.5,
      dmgMix: { kinetic: 10 },
      energyForm: 'spit',
      tactic: 'orbit',
    }
    const ctx = makeTestCtx({
      quietEvents: true,
      galaxies: [galaxy('g-test')],
      modules: [
        moduleDef('mod-long', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 600_000, hitRate: 1, falloff: 1 }),
        moduleDef('mod-mwd-2', 'propulsion', 0, {
          speedBonusPct: 1.5,
          hitPenalty: 0.25,
          thrusterBoostMs: 10_000,
          thrusterCooldownMs: 60_000,
        }),
      ],
      anomalies: [
        { ...anomaly('ano-t-still', 'g-test', { threat: 20, tactic: 'orbit' }), ships: [{ ship: stationary }] },
      ],
    })
    const run = (modIds: string[]): { first: number; after: number; open: number } => {
      const state = createInitialState({ nowWallMs: 0, seed: 3 })
      addShipToFleet(state, 'sandcat2')
      state.shipId = 'sandcat2'
      state.fleet['sandcat2']!.fitted = { high: ['mod-long'], mid: [...modIds], low: [] }
      repairDeprecatedModules(state, ctx)
      const b = startBattleFor(state, ctx, 'sandcat2', 'ano-t-still', 0, 1)! // 期望交距 1m ⇒ 一路内压
      const open = b.distanceM
      const d0 = b.distanceM
      state.gameMs = 9_000
      advanceBattleFor(state, ctx, b, 'sandcat2', 'ano-t-still')
      const first = d0 - b.distanceM // 前 9 秒（点火期）
      const d1 = b.distanceM
      state.gameMs = 20_000
      advanceBattleFor(state, ctx, b, 'sandcat2', 'ano-t-still')
      const after = d1 - b.distanceM // 第 9~20 秒（点火早已结束）
      return { first, after, open }
    }
    const withMwd = run(['mod-mwd-2'])
    const bare = run([])
    const trace = `带微型跃迁引擎：前 9 秒 ${Math.round(withMwd.first)}m / 之后 11 秒 ${Math.round(withMwd.after)}m（开战距离 ${Math.round(withMwd.open)}m）；裸船：${Math.round(bare.first)}m / ${Math.round(bare.after)}m`
    // 裸船两段接近速度相同（没有推进器 = 恒基础机动）
    expect(Math.abs(bare.first / 9 - bare.after / 11), trace).toBeLessThan(bare.first / 9 * 0.05)
    // 装了微型跃迁引擎：前 9 秒明显更快（+150% 的合成倍率），之后回落到与裸船同档
    expect(withMwd.first / 9, `点火窗口没生效（${trace}）`).toBeGreaterThan((bare.first / 9) * 1.5)
    expect(withMwd.after / 11, `点火窗口结束后没有回落（${trace}）`).toBeLessThan((bare.after / 11) * 1.25)
  })
})

describe('敌突进/冲锋（2026-09-10 定资格；**2026-09-11 改判结束条件 = 到达目标距离**；**2026-09-14 倍率 2.0 → 4.0**）', () => {
  const bal = () => makeTestCtx().balance.battle
  /**
   * "到达目标距离"用例专用舰级：**舰级级 opt-in 开冲锋**（不看总开关/门槛/战术）、
   * 射程带 `1~13,000`（⇒ 目标距离 = `1 + 0.20×(13000−1)` = **2,601 m**）、
   * 血厚 + 单发 1 + 装填 60 秒（**打不动玩家、也打不死**）⇒ 战斗不会在"到达"之前结束，
   * 冲锋的"启动 → 进射程仍继续 → 到达即结束 → 进冷却"这一整轮可以被确定性地观测到。
   */
  const ARRIVAL_SHIP: FoeShipDef = {
    id: 't-foe-arrival',
    name: '测试远程虫',
    family: 'C',
    hullClassTier: 1,
    speedRatio: 1.6, // 340 × 1.6 = 544（冲锋期 ×4 = 2,176，闭距够快）
    hp: 100_000,
    split: { s: 0.34, a: 0.33, h: 0.33 },
    shotDmg: 1,
    hitRate: 0.85,
    reloadMs: 60_000,
    rangeMinM: 1,
    rangeMaxM: 13_000,
    falloff: 0.5,
    dmgMix: { plasma: 10 },
    energyForm: 'spit',
    tactic: 'brawl',
    foeCanCharge: true,
  }
  /** "倍率不外溢"用例专用：**快的非冲锋者**（T1 ×2.0 = 680 m/s）+ **慢的冲锋者**（T1 ×0.5 = 170 m/s）
   *  ——巨兽比小虫慢正是 C 族噬口的现实（277 vs 544），这条口径就是为它定的。 */
  const FAST_PLAIN: FoeShipDef = {
    ...ARRIVAL_SHIP,
    id: 't-foe-fast-plain',
    speedRatio: 2,
    foeCanCharge: false,
    rangeMaxM: 8_000,
  }
  const SLOW_CHARGER: FoeShipDef = { ...ARRIVAL_SHIP, id: 't-foe-slow-charger', speedRatio: 0.5, rangeMaxM: 8_000 }
  /** 造一个"开关可调"的上下文（含 4 张资格对照卡 + 一把远程炮，保证开场够不着） */
  const ctxWith = (enabled: boolean): SimContext =>
    makeTestCtx({
      quietEvents: true,
      ...(enabled ? { balance: { ...DEFAULT_BALANCE, battle: { ...DEFAULT_BALANCE.battle, foeChargeEnabled: true } } } : {}),
      galaxies: [galaxy('g-test')],
      modules: [
        moduleDef('mod-long', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 1_000, hitRate: 1, falloff: 1 }),
        // 慢炮（"到达目标距离"用例专用）：开一炮后长期不装填 ⇒ **敌人不会被打死**，
        // 于是能一路压到目标距离把"结束条件"这套观测跑完（快炮会把敌人在半路打爆，战斗提前结束）
        moduleDef('mod-long-slow', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 600_000, hitRate: 1, falloff: 1 }),
      ],
      anomalies: [
        anomaly('ano-brawl-hi', 'g-test', { threat: 60, tactic: 'brawl' }),
        anomaly('ano-brawl-lo', 'g-test', { threat: 40, tactic: 'brawl' }),
        anomaly('ano-kite-hi', 'g-test', { threat: 90, tactic: 'kite' }),
        anomaly('ano-orbit-hi', 'g-test', { threat: 90, tactic: 'orbit' }),
        // 舰级路径 + 舰级级 opt-in：目标距离 2,601m（够远 ⇒ 能在玩家撑住的时间内压到）
        { ...anomaly('ano-t-arrival', 'g-test', { threat: 20, tactic: 'brawl' }), ships: [{ ship: ARRIVAL_SHIP }] },
        // 混速编成：快的**不**冲锋 + 慢的冲锋（验证倍率不外溢）
        {
          ...anomaly('ano-t-charge-spill', 'g-test', { threat: 20, tactic: 'brawl' }),
          ships: [{ ship: FAST_PLAIN }, { ship: SLOW_CHARGER }],
        },
      ],
    })

  /** 开一场对阵指定目标的真实战斗（远程炮 → 开场在敌射程之外）
   *  `desireM` = 我方期望交距（缺省 = 主武器射程中点）；调小它可让**我方也往内压**，
   *  用于"到达目标距离"用例——否则双方会在敌方目标距离**略外侧**僵住（我方外拉 = 敌方内推）。 */
  function battleVs(
    ctx: SimContext,
    anomalyId: string,
    modId = 'mod-long',
    desireM?: number,
  ): { b: ReturnType<typeof startBattleFor>; state: GameState } {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addShipToFleet(state, 'sandcat2')
    state.shipId = 'sandcat2'
    state.fleet['sandcat2']!.fitted = { high: [modId], mid: [], low: [] }
    repairDeprecatedModules(state, ctx)
    const b = startBattleFor(state, ctx, 'sandcat2', anomalyId, 0, desireM)
    return { b, state }
  }

  it('⚙ 默认未实装：开关关闭时**任何敌人都不具备突进资格**（机制保留但不触发）', () => {
    const ctx = ctxWith(false)
    expect(ctx.balance.battle.foeChargeEnabled).toBe(false)
    for (const id of ['ano-brawl-hi', 'ano-brawl-lo', 'ano-kite-hi', 'ano-orbit-hi']) {
      expect(createFoeSpecs(ctx.anomalies.get(id)!, ctx.balance.battle)[0]!.foeCanCharge).toBeUndefined()
    }
    const { b, state } = battleVs(ctx, 'ano-brawl-hi')
    state.gameMs = 120_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-brawl-hi')
    expect(b!.foeChargeOn ?? false).toBe(false) // 关着就是关着
  })

  it('资格门槛（开关启用时）：威胁 ≥60 且近战才有 foeCanCharge；长射程或低威胁一律没有', () => {
    const ctx = ctxWith(true)
    const can = (id: string): boolean =>
      createFoeSpecs(ctx.anomalies.get(id)!, ctx.balance.battle)[0]!.foeCanCharge === true
    expect(can('ano-brawl-hi')).toBe(true) // 门槛恰好 60 = 起始值
    expect(can('ano-brawl-lo')).toBe(false)
    expect(can('ano-kite-hi')).toBe(false) // 高威胁但长射程：不给（它们本就打得到）
    expect(can('ano-orbit-hi')).toBe(false)
  })

  it('乙方案（船长 2026-09-14）：距离在**自己射程之内**、但 > 期望交距 + 1000 ⇒ 也冲锋', () => {
    // ARRIVAL_SHIP：射程 1~13,000 ⇒ 期望交距 2,601 ⇒ 乙的触发线 = 3,601 m；取 5,000 m（**在它射程之内**，旧口径不触发）。
    const ctx = ctxWith(true)
    const s1 = battleVs(ctx, 'ano-t-arrival', 'mod-long-slow', 300)
    s1.b!.foeChargeOn = false
    s1.b!.foeChargeCdUntilMs = 0
    s1.b!.distanceM = 5_000
    s1.state.gameMs = 1_000
    advanceBattleFor(s1.state, ctx, s1.b!, 'sandcat2', 'ano-t-arrival')
    expect(s1.b!.foeChargeOn, '乙：5,000 m > 2,601 + 1,000 ⇒ 应冲锋').toBe(true)
    // 反证：把余量调到极大 = 等效"只留旧口径（够不着才冲）" ⇒ 同一距离不冲锋
    ctx.balance.battle.foeChargeTriggerMarginM = 999_999
    const s2 = battleVs(ctx, 'ano-t-arrival', 'mod-long-slow', 300)
    s2.b!.foeChargeOn = false
    s2.b!.foeChargeCdUntilMs = 0
    s2.b!.distanceM = 5_000
    s2.state.gameMs = 1_000
    advanceBattleFor(s2.state, ctx, s2.b!, 'sandcat2', 'ano-t-arrival')
    expect(s2.b!.foeChargeOn, '旧口径：同一距离在射程之内 ⇒ 不冲锋').toBe(false)
  })

  it('够不着 → 启动突进；**到达目标距离**后结束并进入冷却（开关启用时）', () => {
    const ctx = ctxWith(true)
    // 专用场景（舰级级 opt-in + 目标距离 2,601m + 我方期望交距压到 300m ⇒ 双方都往内压）：
    // 敌人在半路不会被打死、也不会打死玩家，于是"到达即结束"这一轮能跑完
    const { b, state } = battleVs(ctx, 'ano-t-arrival', 'mod-long-slow', 300)
    expect(b).toBeTruthy()
    // 开场距离（双方最远射程 13km → 开战距离 ≈14.3km）在敌射程之外 → 第一步即突进
    state.gameMs = 1_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-t-arrival')
    expect(b!.foeChargeOn).toBe(true)
    // 逐秒推进取观测（2026-09-11 改判后需要"进了射程仍在冲锋"这一段证据）
    const specs = createFoeSpecs(ctx.anomalies.get('ano-t-arrival')!, ctx.balance.battle)
    const foeMax = specs[0]!.weapons[0]!.maxRangeM
    const foeDesire = foeDesiredRange(specs[0]!, specs, ctx.balance.battle)
    expect(foeDesire).toBe(2601) // 1 + 0.2 × (13000 − 1)
    let inRangeStillCharging = false
    let cycleEnded = false
    let endedAboveTarget = false
    let minSeen = Number.POSITIVE_INFINITY
    let endedAtMs = 0
    let endedReason = 'running'
    for (let t = 2_000; t <= 300_000; t += 1_000) {
      state.gameMs = t
      advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-t-arrival')
      minSeen = Math.min(minSeen, b!.distanceM)
      if (b!.ended) {
        endedReason = `battle ended=${String(b!.ended)}`
        break
      }
      if (b!.foeChargeOn && b!.distanceM <= foeMax && b!.distanceM > foeDesire) inRangeStillCharging = true
      if (!b!.foeChargeOn && (b!.foeChargeCdUntilMs ?? 0) > 0) {
        cycleEnded = true
        endedAtMs = t
        if (b!.distanceM > foeDesire) endedAboveTarget = true
        break
      }
    }
    const trace = `敌射程上限 ${foeMax}m / 目标距离 ${foeDesire}m / 最近距离 ${Math.round(minSeen)}m / 结束于 ${endedAtMs}ms / ${endedReason}`
    // ① 进了自己射程**仍继续突进**——旧口径（进射程维持 2 秒）在这一段早就结束了
    expect(inRangeStillCharging, `进入射程后应继续突进（${trace}）`).toBe(true)
    // ② 结束必定发生在**到达目标距离**之后（绝不会"进了射程就结束"）
    expect(endedAboveTarget, `不得在未到目标距离时结束突进（${trace}）`).toBe(false)
    // ③ 压到目标距离即结束，并进入冷却
    expect(cycleEnded, `应压到目标距离 ${foeDesire}m 后结束突进（${trace}）`).toBe(true)
    expect(minSeen, `最近距离应已到目标距离（${trace}）`).toBeLessThanOrEqual(foeDesire)
  })

  it('冲锋倍率**不外溢**：只按冲锋者自己的速度算，非冲锋单位不跟着 ×2（船长 2026-09-11）', () => {
    const ctx = ctxWith(true)
    const def = ctx.anomalies.get('ano-t-charge-spill')!
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addShipToFleet(state, 'sandcat2')
    state.shipId = 'sandcat2'
    state.fleet['sandcat2']!.fitted = { high: ['mod-long-slow'], mid: [], low: [] }
    repairDeprecatedModules(state, ctx)
    const me = createPlayerSpec(state, ctx, 'sandcat2')!
    const specs = createFoeSpecs(def, ctx.balance.battle)
    // 我方期望交距 = 开战距离 ⇒ **我方原地不动**，观测到的闭距全是敌人走的（隔离出敌速口径）
    const open = battleOpenM(me, specs, ctx.balance.battle)
    const b = startBattleFor(state, ctx, 'sandcat2', 'ano-t-charge-spill', 0, open)!
    expect(b.myDesireM).toBe(open)
    const d0 = b.distanceM
    const seconds = 6
    state.gameMs = seconds * 1_000
    advanceBattleFor(state, ctx, b, 'sandcat2', 'ano-t-charge-spill')
    expect(b.foeChargeOn).toBe(true) // 全程在冲锋（开场即在双方射程之外）
    const closed = d0 - b.distanceM
    const closing = closed / seconds
    // 战斗机动换算（敌敏捷 0.3；与 `combat.combatSpeed` 同式，取值来自 balance 而非手抄）
    const b2 = ctx.balance.battle
    const k = b2.speedFactor * (1 + (0.3 - 0.5) * 2 * b2.agilitySpeedBonus)
    const fastV = 680 * k // 非冲锋者 383.5：**不该**被乘
    // **编队接近速度 = 存活单位的平均**（船长 2026-09-11「能否敌舰移动速度按照敌方是所有船的平均值算」）
    // ⇒ 本卡两条不同速单位 = `(680+170)/2 × k`；若冲锋倍率**外溢到整队**，平均值会再翻一倍。
    const avgV = ((680 + 170) / 2) * k
    const spillV = avgV * b2.foeChargeMul
    const trace = `闭距 ${Math.round(closed)}m / ${seconds}s ⇒ 接近速度 ${closing.toFixed(1)} m/s（编队平均 ${avgV.toFixed(1)}、非冲锋者 ${fastV.toFixed(1)}、外溢口径会是 ${spillV.toFixed(1)}）`
    expect(closing, `冲锋倍率外溢到整队了（${trace}）`).toBeLessThan(avgV * 1.2)
    expect(closing, `敌人根本没在接近（${trace}）`).toBeGreaterThan(avgV * 0.1)
  })

  it('参数口径：突进倍率 ×4（2026-09-14 船长试验）、冷却 20 秒、门槛 60（`foeChargeMaxHoldMs` 已停用但保留）', () => {
    const b = bal()
    expect(b.foeChargeMul).toBe(4) // 船长 2026-09-14：「将效果改为4倍我测试下」
    expect(b.foeChargeCooldownMs).toBe(20_000)
    expect(b.foeChargeThreatFloor).toBe(60)
    // ⚠ 2026-09-11 船长改判：结束条件改"到达目标距离" ⇒ 维持时长旋钮**停用**（保留字段仅为可回退）
    expect(b.foeChargeMaxHoldMs).toBe(2_000)
  })
})
