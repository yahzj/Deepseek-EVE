/**
 * 推进器周期爆发 + 高威胁近战敌突进（2026-09-10 船长定，设计稿 docs/design/thruster-charge-20260910.md）：
 *
 * - **推进器**：不再常驻提速 → 点火 **60 秒** → 冷却 **60 秒**，**开场即点火**；
 *   点火期机动 ×(1+爆发倍率)（MK1 +40%/MK2 +80%/MK3 +130%，多件 EVE 曲线收敛），冷却期回基础值。
 *   周期由**战斗时钟推导**（`thrusterPhase`），不占存档字段。
 * - **敌突进**：仅「威胁 ≥ 60 且 战术 = brawl」的敌卡；够不着时机动 **×2**；
 *   进入自己武器射程后再维持 **2 秒** → 突进结束；随后 **20 秒冷却**。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import { addShipToFleet, createInitialState, createPlayerSpec, effectiveHitMul, repairDeprecatedModules, thrusterPhase } from '../src/index'
import { DEFAULT_BALANCE } from '../src/balance'
import { advanceBattleFor, createFoeSpecs, startBattleFor } from '../src/combat'
import { anomaly, galaxy, makeTestCtx, moduleDef } from './helpers'

function world(): { state: GameState; ctx: SimContext } {
  // 测试世界默认只有采集/货舱件——这里补三档推进器（数值与 data/modules.ts 一致）
  const ctx = makeTestCtx({
    quietEvents: true,
    modules: [
      moduleDef('mod-prop-1', 'propulsion', 0, { speedBonusPct: 0.4, hitPenalty: 0.05 }),
      moduleDef('mod-prop-2', 'propulsion', 0, { speedBonusPct: 0.8, hitPenalty: 0.12 }),
      moduleDef('mod-prop-3', 'propulsion', 0, { speedBonusPct: 1.3, hitPenalty: 0.2 }),
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

describe('高威胁近战敌突进（2026-09-10 船长定：仅 威胁≥60 且 brawl；×2；进射程 2 秒止；冷却 20 秒）', () => {
  const bal = () => makeTestCtx().balance.battle
  /** 造一个"开关可调"的上下文（含 4 张资格对照卡 + 一把远程炮，保证开场够不着） */
  const ctxWith = (enabled: boolean): SimContext =>
    makeTestCtx({
      quietEvents: true,
      ...(enabled ? { balance: { ...DEFAULT_BALANCE, battle: { ...DEFAULT_BALANCE.battle, foeChargeEnabled: true } } } : {}),
      galaxies: [galaxy('g-test')],
      modules: [moduleDef('mod-long', 'turret', 0, { maxRangeM: 12_000, minRangeM: 0, reloadMs: 1_000, hitRate: 1, falloff: 1 })],
      anomalies: [
        anomaly('ano-brawl-hi', 'g-test', { threat: 60, tactic: 'brawl' }),
        anomaly('ano-brawl-lo', 'g-test', { threat: 40, tactic: 'brawl' }),
        anomaly('ano-kite-hi', 'g-test', { threat: 90, tactic: 'kite' }),
        anomaly('ano-orbit-hi', 'g-test', { threat: 90, tactic: 'orbit' }),
      ],
    })

  /** 开一场对阵指定目标的真实战斗（远程炮 → 开场在敌射程之外） */
  function battleVs(ctx: SimContext, anomalyId: string): { b: ReturnType<typeof startBattleFor>; state: GameState } {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    addShipToFleet(state, 'sandcat2')
    state.shipId = 'sandcat2'
    state.fleet['sandcat2']!.fitted = { high: ['mod-long'], mid: [], low: [] }
    repairDeprecatedModules(state, ctx)
    const b = startBattleFor(state, ctx, 'sandcat2', anomalyId, 0)
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

  it('够不着 → 启动突进；进入射程后结束并进入冷却（开关启用时）', () => {
    const ctx = ctxWith(true)
    const { b, state } = battleVs(ctx, 'ano-brawl-hi')
    expect(b).toBeTruthy()
    // 开场距离（我方 12km 炮 → 开战距离 ≈13.2km）远在敌近战射程之外 → 第一步即突进
    state.gameMs = 1_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-brawl-hi')
    expect(b!.foeChargeOn).toBe(true)
    // 持续推进：敌人（×2 突进）终将压进射程，维持 2 秒后突进结束并记下冷却时刻
    state.gameMs = 300_000
    advanceBattleFor(state, ctx, b!, 'sandcat2', 'ano-brawl-hi')
    expect(b!.foeChargeCdUntilMs ?? 0).toBeGreaterThan(0) // 至少完成过一轮"突进 → 结束 → 冷却"
  })

  it('参数口径：突进倍率 ×2、进射程维持 2 秒、冷却 20 秒、门槛 60', () => {
    const b = bal()
    expect(b.foeChargeMul).toBe(2)
    expect(b.foeChargeMaxHoldMs).toBe(2_000)
    expect(b.foeChargeCooldownMs).toBe(20_000)
    expect(b.foeChargeThreatFloor).toBe(60)
  })
})
