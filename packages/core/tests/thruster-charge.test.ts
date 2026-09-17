/**
 * 推进器周期爆发 + 高威胁近战敌突进（2026-09-10 船长定，设计稿 docs/design/thruster-charge-20260910.md）：
 *
 * - **推进器**：不再常驻提速 → 点火 **60 秒** → 冷却 **60 秒**，**开场即点火**；
 *   点火期机动 ×(1+爆发倍率)（MK1 +30%/MK2 +60%/MK3 +100%，多件 EVE 曲线收敛），冷却期回基础值。
 *   周期由**战斗时钟推导**（`thrusterPhase`），不占存档字段。
 * - **敌冲锋**：资格两条来源——**舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件，
 *   用于慢而硬的重型单位与 C 族小虫）与老路（威胁 ≥ 60 且 战术 = brawl，受总开关约束）；
 *   触发两条取或——① 够不着（距离在自己武器射程之外）② **距离 > 期望交距 + 1,000**（乙，2026-09-14）；
 *   **逐单位**加速：**该单位自己**的机动 **×(舰级 `foeChargeMul` ?? 全局 `foeChargeMul`)**，
 *   编队接近速度 = 逐单位乘各自倍率 → **取平均**（故倍率**不外溢**到别的单位）；
 *   **解除两条取或**——① **自身炮台命中我方**（2026-09-14 船长新定）② 压到**期望交距**（兜底）；
 *   随后 **10 秒冷却**（2026-09-14 船长由 20 秒改判）。
 *   倍率（2026-09-14 船长）：「大虫子的冲锋倍率改为 3，给小虫子添加冲锋，倍率为 1.5」；全局缺省 3.0。
 */
import { describe, expect, it } from 'vitest'
import { ALIEN_CHARGE_MUL_BY_TIER, ANOMALIES_FLAVORED, FOE_SHIPS, WORMHOLE_FOE_CARDS } from '@whale/data'
import type { GameState, SimContext } from '../src/index'
import type { FoeShipDef } from '../src/types'
import { addShipToFleet, createInitialState, createPlayerSpec, effectiveHitMul, foeChargeCount, repairDeprecatedModules, thrusterCycleFullText, thrusterCycleOfModule, thrusterCycleSeconds, thrusterCycleText, thrusterPhase, unitThrusterCycle } from '../src/index'
import { DEFAULT_BALANCE } from '../src/balance'
import { FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'
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

describe('敌冲锋（2026-09-10 定资格；2026-09-11 改"到达解除"；**2026-09-14 乙触发 · 逐单位 · 命中解除 · 冷却 10 秒**）', () => {
  const bal = () => makeTestCtx().balance.battle
  /**
   * "到达期望交距即解除"用例专用舰级：**舰级级 opt-in 开冲锋**（不看总开关/门槛/战术）、
   * 射程带 `1~13,000`（⇒ 目标距离 = `1 + 0.20×(13000−1)` = **2,601 m**）、
   * 血厚 + 单发 1 + 装填 60 秒 + **命中率 0**（永远打不中）⇒ 只可能被**"压到期望交距"**解除，
   * 把"兜底"那条路径单独隔离出来（"命中解除"由下面 STALL 那条用例证明）。
   */
  const ARRIVAL_SHIP: FoeShipDef = {
    id: 't-foe-arrival',
    name: '测试远程虫',
    family: 'C',
    hullClassTier: 1,
    speedRatio: 1.6, // 340 × 1.6 = 544（冲锋 ×3 = 1,632，闭距够快）
    hp: 100_000,
    split: { s: 0.34, a: 0.33, h: 0.33 },
    shotDmg: 1,
    hitRate: 0, // 打不中（隔离"到达"路径；命中解除另有用例）
    reloadMs: 60_000,
    rangeMinM: 1,
    rangeMaxM: 13_000,
    falloff: 0.5,
    dmgMix: { plasma: 10 },
    energyForm: 'spit',
    tactic: 'brawl',
    foeCanCharge: true,
    foeChargeMul: 3, // 巨兽档倍率（2026-09-14 船长）
  }
  /**
   * **BUG 复现专用**（船长 2026-09-14：「发现BUG了，**冲锋到达目标距离后并不会解除**」）：
   * 慢虫（20 m/s，冲锋 ×1.5 = 30 m/s）＋ **我方更快、且期望交距更远（9,000 m）** ⇒ 距离在
   * `myDesire` 一带形成拔河平衡（我方外拉 = 敌方内推），**永远压不到敌方期望交距 2,601 m**
   * ⇒ 旧口径（解除只有 `arrived` 一条）下冲锋永不解除、冷却永不启动、标记一直亮着。
   * 本舰级**命中率 100% + 装填 1 秒** ⇒ 新口径的**命中解除**会在几秒内收场。
   */
  const HIT_SLOW_CHARGER: FoeShipDef = {
    id: 't-foe-stall-charger',
    name: '测试慢虫·会打中',
    family: 'C',
    hullClassTier: 1,
    speedRatio: 0.03, // 340 × 0.03 ≈ 10 m/s（另有 20 m/s 速度地板）⇒ 拔河必输给我方
    hp: 100_000,
    split: { s: 0.34, a: 0.33, h: 0.33 },
    shotDmg: 1, // 打不疼（只验证"命中即解除"）
    hitRate: 1, // 必中（想观察"命中解除"就必须真命中）
    reloadMs: 1_000,
    rangeMinM: 1,
    rangeMaxM: 13_000,
    falloff: 0.5,
    dmgMix: { plasma: 10 },
    energyForm: 'spit',
    tactic: 'brawl',
    foeCanCharge: true,
    foeChargeMul: 1.5, // 小虫倍率（2026-09-14 船长）
  }
  /** 同卡第二条：**永远打不中**的冲锋者 ⇒ 用来证明"解除是**逐单位**的"（它必须一直在冲） */
  const NEVER_HIT_CHARGER: FoeShipDef = {
    ...HIT_SLOW_CHARGER,
    id: 't-foe-stall-neverhit',
    name: '测试慢虫·打不中',
    hitRate: 0,
  }
  /** "倍率取平均"用例：**同卡两条速度/倍率都不同的冲锋者**（快虫 ×1.5、慢虫 ×3） */
  const FAST_MUL15: FoeShipDef = {
    ...HIT_SLOW_CHARGER,
    id: 't-foe-fast-mul15',
    name: '测试快虫·1.5 倍',
    speedRatio: 1.6, // 544
    hitRate: 0, // 量速度的用例里不许发生"命中解除"
    reloadMs: 60_000,
    foeChargeMul: 1.5,
  }
  const SLOW_MUL3: FoeShipDef = {
    ...HIT_SLOW_CHARGER,
    id: 't-foe-slow-mul3',
    name: '测试慢虫·3 倍',
    speedRatio: 0.5, // 170
    hitRate: 0,
    reloadMs: 60_000,
    foeChargeMul: 3,
  }
  /** 上面那两条的**对照版**（同速同带、只是**不开冲锋**）——"倍率取平均"用例靠两卡做差测敌速 */
  const FAST_PLAIN: FoeShipDef = { ...FAST_MUL15, id: 't-foe-fast-plain2', foeCanCharge: false }
  const SLOW_PLAIN: FoeShipDef = { ...SLOW_MUL3, id: 't-foe-slow-plain2', foeCanCharge: false }
  /** 造一个"开关可调"的上下文（含 4 张资格对照卡 + 一把远程炮，保证开场够不着） */
  const ctxWith = (enabled: boolean): SimContext =>
    makeTestCtx({
      quietEvents: true,
      ...(enabled ? { balance: { ...DEFAULT_BALANCE, battle: { ...DEFAULT_BALANCE.battle, foeChargeEnabled: true } } } : {}),
      galaxies: [galaxy('g-test')],
      modules: [
        moduleDef('mod-long', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 1_000, hitRate: 1, falloff: 1 }),
        // 慢炮：开一炮后长期不装填 ⇒ **敌人不会被打死**，于是能一路把"解除/冷却"这套观测跑完
        moduleDef('mod-long-slow', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 600_000, hitRate: 1, falloff: 1 }),
      ],
      anomalies: [
        anomaly('ano-brawl-hi', 'g-test', { threat: 60, tactic: 'brawl' }),
        anomaly('ano-brawl-lo', 'g-test', { threat: 40, tactic: 'brawl' }),
        anomaly('ano-kite-hi', 'g-test', { threat: 90, tactic: 'kite' }),
        anomaly('ano-orbit-hi', 'g-test', { threat: 90, tactic: 'orbit' }),
        // 舰级路径 + 舰级级 opt-in：目标距离 2,601m（够远 ⇒ 能在玩家撑住的时间内压到）
        { ...anomaly('ano-t-arrival', 'g-test', { threat: 20, tactic: 'brawl' }), ships: [{ ship: ARRIVAL_SHIP }] },
        // BUG 复现：慢而必中的冲锋者（期望交距远小于我方期望 ⇒ 拔河平衡点压在目标距离之上）
        { ...anomaly('ano-t-stall', 'g-test', { threat: 20, tactic: 'brawl' }), ships: [{ ship: HIT_SLOW_CHARGER }] },
        // 逐单位：同卡"会打中" + "打不中"两条冲锋者
        {
          ...anomaly('ano-t-two-chargers', 'g-test', { threat: 20, tactic: 'brawl' }),
          ships: [{ ship: HIT_SLOW_CHARGER }, { ship: NEVER_HIT_CHARGER }],
        },
        // 倍率取平均：同卡两条倍率不同的冲锋者（1.5 与 3）
        {
          ...anomaly('ano-t-mul-avg', 'g-test', { threat: 20, tactic: 'brawl' }),
          ships: [{ ship: FAST_MUL15 }, { ship: SLOW_MUL3 }],
        },
        // 上一条的对照卡：同编成同速度、只是**不开冲锋**（做差用）
        {
          ...anomaly('ano-t-mul-plain', 'g-test', { threat: 20, tactic: 'brawl' }),
          ships: [{ ship: FAST_PLAIN }, { ship: SLOW_PLAIN }],
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

  it('⚙ 默认未实装：开关关闭时**任何敌人都不具备冲锋资格**（机制保留但不触发）', () => {
    const ctx = ctxWith(false)
    expect(ctx.balance.battle.foeChargeEnabled).toBe(false)
    for (const id of ['ano-brawl-hi', 'ano-brawl-lo', 'ano-kite-hi', 'ano-orbit-hi']) {
      expect(createFoeSpecs(ctx.anomalies.get(id)!, ctx.balance.battle)[0]!.foeCanCharge).toBeUndefined()
    }
    const { b, state } = battleVs(ctx, 'ano-brawl-hi')
    state.gameMs = 120_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-brawl-hi')
    expect(foeChargeCount(b!)).toBe(0) // 关着就是关着（老路整条不生效）
  })

  it('资格门槛（开关启用时）：威胁 ≥60 且近战才有 foeCanCharge；长射程或低威胁一律没有', () => {
    const ctx = ctxWith(true)
    const can = (id: string): boolean =>
      createFoeSpecs(ctx.anomalies.get(id)!, ctx.balance.battle)[0]!.foeCanCharge === true
    expect(can('ano-brawl-hi')).toBe(true) // 门槛恰好 60 = 起始值
    expect(can('ano-brawl-lo')).toBe(false)
    expect(can('ano-kite-hi')).toBe(false) // 高威胁但长射程：不给（它们本就打得到）
    expect(can('ano-orbit-hi')).toBe(false)
    // **倍率缺省**：走老路的单位没写舰级倍率 ⇒ 不写字段（读全局缺省值，旧读数逐字不变）
    const legacy = createFoeSpecs(ctx.anomalies.get('ano-brawl-hi')!, ctx.balance.battle)[0]!
    expect(legacy.foeChargeMul).toBeUndefined()
  })

  it('C 族冲锋配置（2026-09-16 船长「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」）：按档契约（**走挂载件**）', () => {
    const of = (id: string): FoeShipDef => FOE_SHIPS.find((s) => s.id === id)!
    // **全族一律具冲锋资格**，且倍率**只看舰种档**（`ALIEN_CHARGE_MUL_BY_TIER` 是契约基准）；
    // 2026-09-16 起资格/倍率/冷却都在**挂载件**里（`resolveFoeMounts` 是唯一解析点）
    const aliens = FOE_SHIPS.filter((s) => s.family === 'C')
    expect(aliens.length).toBeGreaterThanOrEqual(5)
    for (const s of aliens) {
      const r = resolveFoeMounts(s.mounts)
      expect(r.foeCanCharge, `${s.name} 须具冲锋资格`).toBe(true)
      expect(r.foeChargeMul, `${s.name}（T${s.hullClassTier}）倍率`).toBe(ALIEN_CHARGE_MUL_BY_TIER[s.hullClassTier])
      expect(r.foeChargeCooldownMs, `${s.name} 冲锋冷却`).toBe(10_000) // C 族维持 10 秒
    }
    // 逐条点名（防"表改了但舰级没跟上"被上面那条掩盖）：T1 1.5 · T2 2 · T3 2.5 · T4 3
    expect(resolveFoeMounts(of('foe-alien-rift-larva').mounts).foeChargeMul).toBe(1.5)
    expect(resolveFoeMounts(of('foe-alien-starcore-larva').mounts).foeChargeMul).toBe(1.5)
    expect(resolveFoeMounts(of('foe-alien-starcore-adult').mounts).foeChargeMul).toBe(2)
    expect(resolveFoeMounts(of('foe-alien-spore-hive').mounts).foeChargeMul).toBe(2.5)
    expect(resolveFoeMounts(of('foe-alien-maw').mounts).foeChargeMul).toBe(3)
    // 建档要把挂载件带上单位（否则逐单位倍率/冷却落不了地）
    const ctx = ctxWith(false)
    const specs = createFoeSpecs(
      { ...anomaly('ano-c-contract', 'g-test', { threat: 20, tactic: 'brawl' }), ships: [{ ship: of('foe-alien-maw') }] },
      ctx.balance.battle,
    )
    expect(specs[0]!.foeCanCharge).toBe(true)
    expect(specs[0]!.foeChargeMul).toBe(3)
    expect(specs[0]!.foeMountNames).toEqual(['虫群冲锋器 T4'])
    // 冲锋件只给 C 族**舰级**、洞内三张 A 族卡**条目**、以及 A 族新舰「劫掠电子舰」（见下）
    for (const s of FOE_SHIPS) {
      if (s.family === 'C') continue
      if (s.id === 'foe-pirate-raider') continue // 例外，见下方专条
      expect(resolveFoeMounts(s.mounts).foeCanCharge ?? false, s.id).toBe(false)
    }
    /**
     * **舰级挂载的例外：劫掠电子舰**（船长 2026-09-16「**新增A族敌人劫掠电子舰，添加挂载件冲锋**，
     * 并额外加装一件新的挂载件，劫掠捕获网…**添加进深层的海盗战团里**」）。
     * 它连同捕获网一起写在**舰级**上（引擎与体检都按"条目 ?? 舰级"取有效挂载）；
     * 之所以不违反"洞外不许冲锋"，是因为这条舰级**只被深层战团使用**——下面即为此事实的守卫：
     * 一旦有人把它放进洞外卡，冲锋就跟着上洞外，这里会红。
     */
    const raider = FOE_SHIPS.find((s) => s.id === 'foe-pirate-raider')!
    const raiderMounts = resolveFoeMounts(raider.mounts)
    expect(raiderMounts.foeCanCharge, '劫掠电子舰应具冲锋资格（舰级挂载）').toBe(true)
    expect(raiderMounts.foeChargeMul).toBe(1.6)
    expect(raiderMounts.foeChargeCooldownMs).toBe(30_000)
    expect(raiderMounts.foeCaptureWeb, '劫掠电子舰应挂捕获网件').toBeDefined()
    const whIds = new Set(WORMHOLE_FOE_CARDS.map((a) => a.id))
    for (const a of ANOMALIES_FLAVORED) {
      if (whIds.has(a.id)) continue
      for (const sl of a.ships ?? []) {
        expect(sl.ship.id, `洞外卡 ${a.id} 不得用劫掠电子舰（它的舰级挂载带冲锋）`).not.toBe('foe-pirate-raider')
      }
    }
    // 深层战团必须带它一条（船长「添加进深层的海盗战团里」）
    const warbandSlots = WORMHOLE_FOE_CARDS.find((a) => a.id === 'wh-pirate-warband')!.ships ?? []
    expect(warbandSlots.filter((sl) => sl.ship.id === 'foe-pirate-raider')).toHaveLength(1)
  })

  /**
   * **A 族海盗冲锋**（船长 2026-09-16：「给A族虫洞内的海盗添加冲锋…**冲锋倍率为1.6，冷却30秒**」）。
   *
   * 关键口径（同日裁决「能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了」）：
   * 只挂**洞内三张 A 族卡的条目**（`FoeShipSlot.mounts`）——那三条舰级洞外（低安遭遇 / 悬赏）
   * 也在用，所以挂舰级会让洞外海盗也冲锋。
   */
  describe('A 族海盗冲锋（×1.6 · 冷却 30 秒 · 只在洞内）', () => {
    it('洞内三卡：**逐条目**挂海盗件 ⇒ 每个单位带 ×1.6 / 30 秒 / 展示名', () => {
      for (const id of ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband']) {
        const card = WORMHOLE_FOE_CARDS.find((a) => a.id === id)!
        expect(card, `${id} 应在洞内敌卡表里`).toBeTruthy()
        const specs = createFoeSpecs(card, DEFAULT_BALANCE.battle)
        expect(specs.length, `${id} 应有编成单位`).toBeGreaterThan(0)
        for (const s of specs) {
          expect(s.foeCanCharge, `${id}/${s.name} 应具冲锋资格`).toBe(true)
          expect(s.foeChargeMul, `${id}/${s.name} 倍率`).toBe(1.6)
          expect(s.foeChargeCooldownMs, `${id}/${s.name} 冷却`).toBe(30_000)
          expect(s.foeMountNames, `${id}/${s.name} 挂载件名`).toContain('劫掠冲锋推进器')
        }
      }
    })

    it('**洞外反证**：同一批海盗舰级、不挂条目 ⇒ 不冲锋（挂载件必须挂在条目上）', () => {
      const corvette = FOE_SHIPS.find((s) => s.id === 'foe-pirate-corvette')!
      const warband = FOE_SHIPS.find((s) => s.id === 'foe-pirate-warlord')!
      expect(resolveFoeMounts(corvette.mounts).foeCanCharge ?? false, '舰级本身不该有冲锋').toBe(false)
      expect(corvette.mounts, '舰级不该挂任何冲锋件').toBeUndefined()
      const outside = {
        ...anomaly('ano-outside-pirates', 'g-test', { threat: 60, tactic: 'brawl' }),
        ships: [{ ship: corvette, count: 2 }, { ship: warband, count: 1 }],
      }
      for (const s of createFoeSpecs(outside, DEFAULT_BALANCE.battle)) {
        expect(s.foeCanCharge ?? false, `${s.name} 洞外不该冲锋`).toBe(false)
        expect(s.foeChargeCooldownMs).toBeUndefined()
      }
    })

    it('**30 秒冷却**实测：解除后 cd = 30 秒（C 族同款机制仍 10 秒）', () => {
      const ctx = ctxWith(true)
      /** 合成卡：把海盗件挂在**条目**上（与洞内三卡同款写法），目标距离压到很近 ⇒ 能观测"到达解除" */
      const pirateEntry = { ...anomaly('ano-a-arrival', 'g-test', { threat: 20, tactic: 'brawl' }), ships: [{ ship: ARRIVAL_SHIP, mounts: [FOE_MOUNT_IDS.chargePirate] as const }] }
      const ctx2 = makeTestCtx({
        quietEvents: true,
        balance: ctx.balance,
        galaxies: [galaxy('g-test')],
        modules: [moduleDef('mod-long-slow', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 600_000, hitRate: 1, falloff: 1 })],
        anomalies: [pirateEntry],
      })
      const specs = createFoeSpecs(pirateEntry, ctx2.balance.battle)
      expect(specs[0]!.foeChargeMul).toBe(1.6)
      expect(specs[0]!.foeChargeCooldownMs).toBe(30_000)
      const { b, state } = battleVs(ctx2, 'ano-a-arrival', 'mod-long-slow', 300)
      expect(b).toBeTruthy()
      state.gameMs = 1_000
      advanceBattleFor(state, ctx2, b!, 'sandcat2', 'ano-a-arrival')
      expect(b!.foeCharges?.['foe-0']?.on, '开场够不着 ⇒ 应已冲锋').toBe(true)
      let cd = 0
      for (let t = 2_000; t <= 300_000; t += 1_000) {
        state.gameMs = t
        advanceBattleFor(state, ctx2, b!, 'sandcat2', 'ano-a-arrival')
        if (b!.ended) break
        const rt = b!.foeCharges?.['foe-0']
        if (rt && rt.on !== true && (rt.cdUntilMs ?? 0) > 0) {
          cd = (rt.cdUntilMs ?? 0) - t
          break
        }
      }
      // 逐拍推进 ⇒ 允许 1 拍误差（1000ms）
      expect(cd, '解除后的冷却应约为 30 秒').toBeGreaterThanOrEqual(29_000)
      expect(cd, '解除后的冷却应约为 30 秒').toBeLessThanOrEqual(31_000)
    })
  })

  it('乙方案（船长 2026-09-14）：距离在**自己射程之内**、但 > 期望交距 + 1000 ⇒ 也冲锋（逐单位状态）', () => {
    // ARRIVAL_SHIP：射程 1~13,000 ⇒ 期望交距 2,601 ⇒ 乙的触发线 = 3,601 m；取 5,000 m（**在它射程之内**，旧口径不触发）。
    const ctx = ctxWith(true)
    const s1 = battleVs(ctx, 'ano-t-arrival', 'mod-long-slow', 300)
    s1.b!.foeCharges = {} // 清掉开场那一拍的状态，单看"5,000 m 这一步"能不能起冲
    s1.b!.distanceM = 5_000
    s1.state.gameMs = 1_000
    advanceBattleFor(s1.state, ctx, s1.b!, 'sandcat2', 'ano-t-arrival')
    expect(s1.b!.foeCharges?.['foe-0']?.on, '乙：5,000 m > 2,601 + 1,000 ⇒ 应冲锋').toBe(true)
    // 反证：把余量调到极大 = 等效"只留旧口径（够不着才冲）" ⇒ 同一距离不冲锋
    ctx.balance.battle.foeChargeTriggerMarginM = 999_999
    const s2 = battleVs(ctx, 'ano-t-arrival', 'mod-long-slow', 300)
    s2.b!.foeCharges = {}
    s2.b!.distanceM = 5_000
    s2.state.gameMs = 1_000
    advanceBattleFor(s2.state, ctx, s2.b!, 'sandcat2', 'ano-t-arrival')
    expect(s2.b!.foeCharges?.['foe-0']?.on ?? false, '旧口径：同一距离在射程之内 ⇒ 不冲锋').toBe(false)
  })

  it('够不着 → 启动冲锋；**压到期望交距**后解除并进入 10 秒冷却（命中率 0 ⇒ 隔离出兜底路径）', () => {
    const ctx = ctxWith(true)
    // 专用场景（舰级级 opt-in + 目标距离 2,601m + 我方期望交距压到 300m ⇒ 双方都往内压）
    const { b, state } = battleVs(ctx, 'ano-t-arrival', 'mod-long-slow', 300)
    expect(b).toBeTruthy()
    // 开场距离（双方最远射程 13km → 开战距离 ≈14.3km）在敌射程之外 → 第一步即冲锋
    state.gameMs = 1_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-t-arrival')
    expect(b!.foeCharges?.['foe-0']?.on).toBe(true)
    // 逐秒推进取观测（2026-09-11 改判后需要"进了射程仍在冲锋"这一段证据）
    const specs = createFoeSpecs(ctx.anomalies.get('ano-t-arrival')!, ctx.balance.battle)
    const foeMax = specs[0]!.weapons[0]!.maxRangeM
    const foeDesire = foeDesiredRange(specs[0]!, specs, ctx.balance.battle)
    expect(foeDesire).toBe(2601) // 1 + 0.2 × (13000 − 1)
    const rt = () => b!.foeCharges?.['foe-0']
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
      if (rt()?.on === true && b!.distanceM <= foeMax && b!.distanceM > foeDesire) inRangeStillCharging = true
      if (rt()?.on !== true && (rt()?.cdUntilMs ?? 0) > 0) {
        cycleEnded = true
        endedAtMs = t
        if (b!.distanceM > foeDesire) endedAboveTarget = true
        break
      }
    }
    const trace = `敌射程上限 ${foeMax}m / 目标距离 ${foeDesire}m / 最近距离 ${Math.round(minSeen)}m / 结束于 ${endedAtMs}ms / ${endedReason}`
    // ① 进了自己射程**仍继续冲锋**——旧口径（进射程维持 2 秒）在这一段早就结束了
    expect(inRangeStillCharging, `进入射程后应继续冲锋（${trace}）`).toBe(true)
    // ② 命中率 0 ⇒ 只可能"压到目标距离"才解除（绝不会在目标距离之上结束）
    expect(endedAboveTarget, `不得在未到目标距离时结束冲锋（${trace}）`).toBe(false)
    // ③ 压到目标距离即解除，并进入 10 秒冷却
    expect(cycleEnded, `应压到目标距离 ${foeDesire}m 后解除冲锋（${trace}）`).toBe(true)
    expect(minSeen, `最近距离应已到目标距离（${trace}）`).toBeLessThanOrEqual(foeDesire)
    // 冷却 = 10 秒。⚠ 口径：状态机的时刻戳取自**子步起点**（`BATTLE_STEP_MS = 100`，本拍首个子步的起点
    // 即上一拍末尾），而这里拿的是"本拍结束"的战斗时钟 ⇒ 读数落在 **[9,000, 10,000]** 内才是 10 秒口径
    // （若还是旧的 20 秒，读数会是 19,000+）。
    const cdLeft = (rt()!.cdUntilMs ?? 0) - b!.lastTickGameMs
    expect(cdLeft, `冷却应为 10 秒（${trace}）`).toBeLessThanOrEqual(10_000)
    expect(cdLeft, `冷却应为 10 秒（${trace}）`).toBeGreaterThanOrEqual(9_000)
  })

  it('🔴 BUG 修复（船长 2026-09-14）：距离**永远压不到**目标距离时，**自身炮台命中**也能解除冲锋', () => {
    const ctx = ctxWith(true)
    // 我方期望交距 9,000 m（远大于敌方目标距离 2,601 m）＋ 我方更快 ⇒ 距离停在拔河平衡点，
    // `arrived` 永不可达（这就是船长报的"到达目标距离后并不会解除"）。
    const { b, state } = battleVs(ctx, 'ano-t-stall', 'mod-long-slow', 9_000)
    const rt = () => b!.foeCharges?.['foe-0']
    expect(b!.myDesireM).toBe(9_000)
    let minSeen = Number.POSITIVE_INFINITY
    let chargingSeen = false
    let releasedAtMs = 0
    for (let t = 1_000; t <= 120_000; t += 1_000) {
      state.gameMs = t
      advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-t-stall')
      minSeen = Math.min(minSeen, b!.distanceM)
      if (rt()?.on === true) chargingSeen = true
      if (chargingSeen && rt()?.on !== true && (rt()?.cdUntilMs ?? 0) > 0) {
        releasedAtMs = t
        break
      }
      if (b!.ended) break
    }
    const trace = `最近距离 ${Math.round(minSeen)}m / 敌方目标距离 2,601m / 解除于 ${releasedAtMs}ms / 敌命中累计 ${b!.stats.foeHits}`
    expect(chargingSeen, `应当起冲（${trace}）`).toBe(true)
    // ① 距离**从未**压到目标距离 ⇒ 旧口径（只有 arrived）在这里是死结
    expect(minSeen, `本用例前提是"压不到目标距离"（${trace}）`).toBeGreaterThan(2_601)
    // ② 仍然解除了 ⇒ 只可能是"自身炮台命中我方"那条，且当时确实已有命中
    expect(releasedAtMs, `应在命中后解除（${trace}）`).toBeGreaterThan(0)
    expect(b!.stats.foeHits, `解除时应有真实命中（${trace}）`).toBeGreaterThan(0)
    // 冷却 10 秒（同"到达"那条的时刻戳口径：读数落在 [9,000, 10,000]；旧的 20 秒会是 19,000+）
    const cdLeft = (rt()!.cdUntilMs ?? 0) - b!.lastTickGameMs
    expect(cdLeft, `冷却应为 10 秒（${trace}）`).toBeLessThanOrEqual(10_000)
    expect(cdLeft, `冷却应为 10 秒（${trace}）`).toBeGreaterThanOrEqual(9_000)
    // ③ 冷却期内不许复位（10 秒内保持不冲）
    state.gameMs = releasedAtMs + 9_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-t-stall')
    expect(rt()?.on ?? false, `冷却期内不得再次冲锋（${trace}）`).toBe(false)
  })

  it('逐单位：同卡两条冲锋者各自结算——会打中的那条解除并进冷却，打不中的那条**一直在冲**', () => {
    const ctx = ctxWith(true)
    const { b, state } = battleVs(ctx, 'ano-t-two-chargers', 'mod-long-slow', 9_000)
    const specs = createFoeSpecs(ctx.anomalies.get('ano-t-two-chargers')!, ctx.balance.battle)
    expect(specs.length).toBe(2)
    const [hitTag, missTag] = [specs[0]!.tag, specs[1]!.tag]
    for (let t = 1_000; t <= 30_000; t += 1_000) {
      state.gameMs = t
      advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-t-two-chargers')
      if (b!.ended) break
    }
    const hitRt = b!.foeCharges?.[hitTag]
    const missRt = b!.foeCharges?.[missTag]
    const trace = `会打中(×1.5)：${JSON.stringify(hitRt)} / 打不中(×1.5)：${JSON.stringify(missRt)} / 敌命中累计 ${b!.stats.foeHits}`
    expect(b!.stats.foeHits, `应至少命中一次（${trace}）`).toBeGreaterThan(0)
    // 命中那条：已解除且进过冷却（10 秒一循环 ⇒ 30 秒窗口里必然出现"冷却中"）
    expect(hitRt?.cdUntilMs ?? 0, `命中者应已解除并进冷却（${trace}）`).toBeGreaterThan(0)
    // 打不中的那条：从未命中 ⇒ **一次都没解除过**（编队级单标志做不到这一点）
    expect(missRt?.on, `打不中者应仍在冲锋（${trace}）`).toBe(true)
    expect(missRt?.cdUntilMs, `打不中者不该有冷却（${trace}）`).toBeUndefined()
  })

  it('倍率**不外溢**且取"逐单位乘各自倍率 → 平均"（同卡 1.5 与 3 两条冲锋者 · 对照卡做差）', () => {
    /**
     * 观测法（**做差**）：同编成跑两遍——① 两条都开冲锋（×1.5 / ×3）② 两条都不开（对照）。
     * 我方期望交距压到 300 m ⇒ 双方**全程满速内压**（无敌方死区干扰）⇒
     * 闭距速度 = 敌编队接近速度 + 我方速度，两遍的"我方那一项"完全相同 ⇒ **差值 = 敌方那部分的变化**。
     * 逐单位乘各自倍率取平均 ⇒ Δ = [(v快×1.5 + v慢×3) − (v快 + v慢)] ÷ 2；
     * 旧的 `max(编队平均, 冲锋者×倍率)` 补丁会给出更大的 Δ（被下面的上界钉住）。
     */
    const ctx = ctxWith(true)
    const runCard = (anomalyId: string): { closing: number; charges: number } => {
      const state = createInitialState({ nowWallMs: 0, seed: 3 })
      addShipToFleet(state, 'sandcat2')
      state.shipId = 'sandcat2'
      state.fleet['sandcat2']!.fitted = { high: ['mod-long-slow'], mid: [], low: [] }
      repairDeprecatedModules(state, ctx)
      const b = startBattleFor(state, ctx, 'sandcat2', anomalyId, 0, 300)!
      const d0 = b.distanceM
      const seconds = 6
      for (let t = 1_000; t <= seconds * 1_000; t += 1_000) {
        state.gameMs = t
        advanceBattleFor(state, ctx, b, 'sandcat2', anomalyId)
      }
      return { closing: (d0 - b.distanceM) / seconds, charges: foeChargeCount(b) }
    }
    const charged = runCard('ano-t-mul-avg')
    const plain = runCard('ano-t-mul-plain')
    // 战斗机动换算（敌敏捷 0.3；与 `combat.combatSpeed` 同式，取值来自 balance 而非手抄）
    const b2 = ctx.balance.battle
    const k = b2.speedFactor * (1 + (0.3 - 0.5) * 2 * b2.agilitySpeedBonus)
    const vFast = Math.max(20, 544 * k) // speedRatio 1.6 → 544
    const vSlow = Math.max(20, 170 * k) // speedRatio 0.5 → 170
    const delta = charged.closing - plain.closing
    const wantDelta = (vFast * 1.5 + vSlow * 3 - (vFast + vSlow)) / 2 // 逐单位乘各自倍率 → 平均
    const oldMaxPatch = Math.max((vFast + vSlow) / 2, vFast * 3) - (vFast + vSlow) / 2 // 旧补丁（会明显更大）
    const spillAll = ((vFast + vSlow) / 2) * 2 // 倍率外溢到整队（×3 → +2 倍）
    const trace = `开冲锋 ${charged.closing.toFixed(1)} m/s（在冲 ${charged.charges} 条）− 对照 ${plain.closing.toFixed(1)} m/s ⇒ Δ=${delta.toFixed(1)}（期望 ${wantDelta.toFixed(1)}；旧 max 补丁 ${oldMaxPatch.toFixed(1)}；整队外溢 ${spillAll.toFixed(1)}）`
    expect(charged.charges, `开冲锋那张卡应两条都在冲（${trace}）`).toBe(2)
    expect(plain.charges, `对照卡不该有冲锋（${trace}）`).toBe(0)
    expect(Math.abs(delta - wantDelta) / wantDelta, `应等于"逐单位乘各自倍率后的平均"（${trace}）`).toBeLessThan(0.02)
    // 反证：旧 `max(编队平均, 冲锋者速度 × 倍率)` 补丁的 Δ 明显更大 —— 本口径必须低于它
    expect(delta, `仍带着旧的 max 补丁（${trace}）`).toBeLessThan(oldMaxPatch * 0.95)
  })


  it('参数口径：全局倍率 ×3、冷却 **10 秒**、门槛 60（`foeChargeMaxHoldMs` 已停用但保留）', () => {
    const b = bal()
    expect(b.foeChargeMul).toBe(3) // 船长 2026-09-14：「大虫子的冲锋倍率改为 3」（同日试验值 4 作废）
    expect(b.foeChargeCooldownMs).toBe(10_000) // 船长 2026-09-14：「并进入 10 秒冷却」
    expect(b.foeChargeThreatFloor).toBe(60)
    // ⚠ 2026-09-11 船长改判：结束条件改"到达目标距离" ⇒ 维持时长旋钮**停用**（保留字段仅为可回退）
    expect(b.foeChargeMaxHoldMs).toBe(2_000)
    expect(b.foeChargeTriggerMarginM).toBe(1_000) // 乙：期望交距 + 1,000 m 即起冲
  })
})