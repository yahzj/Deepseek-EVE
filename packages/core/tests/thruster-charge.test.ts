/**
 * 推进器周期爆发 + 高威胁近战敌突进（2026-09-10 船长定，设计稿 docs/design/thruster-charge-20260910.md）：
 *
 * - **推进器**：不再常驻提速 → 点火 **60 秒** → 冷却 **60 秒**，**开场即点火**；
 *   点火期机动 ×(1+爆发倍率)（MK1 +30%/MK2 +60%/MK3 +100%，多件 EVE 曲线收敛），冷却期回基础值。
 *   周期由**战斗时钟推导**（`thrusterPhase`），不占存档字段。
 * - **敌突进/冲锋**：资格两条来源——**舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件，
 *   用于慢而硬的重型单位）与老路（威胁 ≥ 60 且 战术 = brawl，受总开关约束）；
 *   够不着（距离在自己武器射程之外）时整编队接近速度 **×2**；
 *   **到达目标距离（敌方期望交距）即结束**（2026-09-11 船长改判；原口径"进射程维持 2 秒"作废）；
 *   随后 **20 秒冷却**。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import type { FoeShipDef } from '../src/types'
import { addShipToFleet, createInitialState, createPlayerSpec, effectiveHitMul, repairDeprecatedModules, thrusterPhase } from '../src/index'
import { DEFAULT_BALANCE } from '../src/balance'
import { advanceBattleFor, createFoeSpecs, foeDesiredRange, startBattleFor } from '../src/combat'
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
})

describe('敌突进/冲锋（2026-09-10 定资格与 ×2；**2026-09-11 船长改判结束条件 = 到达目标距离**）', () => {
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
    speedRatio: 1.6, // 340 × 1.6 = 544（冲锋期 ×2 = 1,088，闭距够快）
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

  it('参数口径：突进倍率 ×2、冷却 20 秒、门槛 60（`foeChargeMaxHoldMs` 已停用但保留）', () => {
    const b = bal()
    expect(b.foeChargeMul).toBe(2)
    expect(b.foeChargeCooldownMs).toBe(20_000)
    expect(b.foeChargeThreatFloor).toBe(60)
    // ⚠ 2026-09-11 船长改判：结束条件改"到达目标距离" ⇒ 维持时长旋钮**停用**（保留字段仅为可回退）
    expect(b.foeChargeMaxHoldMs).toBe(2_000)
  })
})
