/**
 * 目标距离**按星系独立保存**（船长 2026-09-11）：
 * 「玩家每个星系设定的目标距离独立保存，预估胜率的战斗按照那个距离决定。如果没有，采用射程中段距离。」
 *
 * 口径：
 * - 战斗内拖距离条 / 点战术按钮（`setBattleDesire`）→ 写入**本场所在星系**的设定（跨会话沿用）；
 * - 出发时显式 `desireM` → 写进**目标星系**；
 * - 开战（远征 / 遭遇 / AI 副船）与**胜率预估的每一局模拟**都读该星系的设定；没设过 = 主武器有效射程中点；
 * - 稳态解析预估（派系活跃卡 / 窝点卡）同口径；
 * - 存档随档保留（老档的全局 `desirePrefM` 不再沿用，一律回落中段）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  BOUNTY_MC_RUNS,
  addModule,
  bountyDamageForecast,
  buildEvalState,
  createInitialState,
  desiredRangeFor,
  desirePrefOf,
  fitModule,
  loadSaveFile,
  serializeSaveFile,
  setDesirePrefOf,
  startExpedition,
  type GameState,
  type SimContext,
} from '@whale/core'
import { createPlayerSpec, startBattleFor } from '../src/combat'
import { makeTestCtx, anomaly, moduleDef, ship } from './helpers'

describe('目标距离按星系独立保存（船长 2026-09-11）', () => {
  const ctx = buildSimContext()
  const CARDS = [...ctx.anomalies.values()].filter(
    (a) => a.hidden !== true && a.rewardIsk > 0 && a.threat > 0 && a.threat <= 40,
  )
  const A = CARDS[0]!
  const B = CARDS.find((a) => a.galaxyId !== A.galaxyId)!

  function fresh(): GameState {
    const state = createInitialState({ nowWallMs: 0, seed: 20260911 })
    state.wallet.isk = 1e9
    state.standings['dsi'] = 30
    for (const g of ctx.galaxies.values()) state.exploredGalaxies.push(g.id)
    return state
  }

  /** 在该卡上跑一次"预估用的那一局"（与 MC 同源：快照 → startBattleFor），返回本局期望距离 */
  function evalDesire(state: GameState, anomalyId: string): number {
    const snap = buildEvalState(state, state.shipId)!
    return startBattleFor(snap.ev, ctx, snap.uid, anomalyId, 0)!.myDesireM
  }

  it('没设过的星系 = 主武器有效射程中点', () => {
    const state = fresh()
    const snap = buildEvalState(state, state.shipId)!
    const me = createPlayerSpec(snap.ev, ctx, snap.uid)!
    const mid = desiredRangeFor(me, 'mid', ctx.balance.battle)
    expect(mid).toBeGreaterThan(0)
    expect(snap.ev.expedition.desirePrefByGalaxy).toBeUndefined() // 全新档：一个星系都没设过
    expect(evalDesire(state, A.id)).toBe(mid) // 中段（该卡开战距离远大于中段，不会被钳）
  })

  it('两个星系各自独立：给 A 设 1,500 只影响 A，B 仍回落中段', () => {
    const state = fresh()
    const midB = evalDesire(state, B.id)
    setDesirePrefOf(state, A.galaxyId, 1_500)
    expect(desirePrefOf(state, A.galaxyId)).toBe(1_500)
    expect(desirePrefOf(state, B.galaxyId)).toBeNull() // 独立保存：B 没设过
    expect(evalDesire(state, A.id)).toBe(1_500) // A 的模拟按 1,500 打
    expect(evalDesire(state, B.id)).toBe(midB) // B 不受影响
  })

  it('胜率预估的战斗按该星系设定：设定随估价快照进入每一局模拟', () => {
    const state = fresh()
    setDesirePrefOf(state, A.galaxyId, 1_200)
    const snap = buildEvalState(state, state.shipId)!
    expect(snap.ev.expedition.desirePrefByGalaxy?.[A.galaxyId]).toBe(1_200)
    expect(startBattleFor(snap.ev, ctx, snap.uid, A.id, 0)!.myDesireM).toBe(1_200)
    expect(BOUNTY_MC_RUNS).toBe(21)
    // 同一张卡、同一装配：只有"该星系设定"不同 ⇒ 预估里的开战距离不同
    const other = fresh()
    expect(evalDesire(other, A.id)).not.toBe(1_200)
  })

  it('远征实跑：设过该星系距离后开战即用它', () => {
    const state = fresh()
    setDesirePrefOf(state, A.galaxyId, 1_500)
    expect(startExpedition(state, A.id, ctx).ok).toBe(true)
    expect(state.expedition.battle?.myDesireM).toBe(1_500)
  })

  it('存档往返：按星系的设定随档保留；老档只带全局 desirePrefM 时一律回落中段', () => {
    const state = fresh()
    setDesirePrefOf(state, A.galaxyId, 1_500)
    setDesirePrefOf(state, B.galaxyId, 2_500)
    const loaded = loadSaveFile(serializeSaveFile(state, state.savedAtWallMs)).state
    expect(loaded.expedition.desirePrefByGalaxy).toEqual({ [A.galaxyId]: 1_500, [B.galaxyId]: 2_500 })
    const file = JSON.parse(serializeSaveFile(state, state.savedAtWallMs)) as {
      state: { expedition: Record<string, unknown> }
    }
    delete file.state.expedition.desirePrefByGalaxy
    file.state.expedition.desirePrefM = 4_321 // 老档的全局偏好
    const old = loadSaveFile(JSON.stringify(file)).state
    expect(old.expedition.desirePrefByGalaxy).toBeUndefined()
    expect(desirePrefOf(old, A.galaxyId)).toBeNull() // 不沿用老全局值
    const snapOld = buildEvalState(old, old.shipId)!
    const meOld = createPlayerSpec(snapOld.ev, ctx, snapOld.uid)!
    expect(startBattleFor(snapOld.ev, ctx, snapOld.uid, A.id, 0)!.myDesireM).toBe(
      desiredRangeFor(meOld, 'mid', ctx.balance.battle),
    )
  })
})

describe('稳态解析预估（派系/窝点卡）同口径：设定距离真的改变读数', () => {
  /** 手工世界：我方一门 0~4000、远端衰减 1.0 的炮（越近命中越高）；敌群中等威胁 */
  function world(): { state: GameState; ctx: SimContext } {
    const ctx = makeTestCtx({
      quietEvents: true,
      ships: [ship('sandcat', { shieldHp: 400, armorHp: 600, hullHp: 900 })],
      modules: [
        moduleDef('gun-wide', 'turret', 0.5, {
          maxRangeM: 4000,
          minRangeM: 0,
          hitRate: 0.9,
          falloff: 1,
          reloadMs: 1500,
          dmgMult: 1.2,
        }),
      ],
      anomalies: [anomaly('ano-desire', 'galaxy-hub', { threat: 40, reward: 10_000 })],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    state.wallet.isk = 1_000_000
    addModule(state, 'gun-wide')
    expect(fitModule(state, 'gun-wide', ctx).ok).toBe(true)
    return { state, ctx }
  }

  it('设定贴近距离后：解析口径读数真的按该距离算（承伤↓、rawWin↑），改回中段即复现原读数', () => {
    const { state, ctx } = world()
    const card = ctx.anomalies.get('ano-desire')!
    const midLoss = bountyDamageForecast(state, ctx, card)
    expect(midLoss.armorLoss).toBeGreaterThan(0) // 非饱和：中段会掉甲
    expect(midLoss.armorLoss).toBeLessThan(1)
    setDesirePrefOf(state, 'galaxy-hub', 400) // 贴近打：命中更高 → 打得更快 → 承伤更少
    const closeLoss = bountyDamageForecast(state, ctx, card)
    expect(closeLoss.armorLoss).toBeLessThan(midLoss.armorLoss)
    expect(closeLoss.rawWin).toBeGreaterThan(midLoss.rawWin)
    // 删掉该星系的设定 → 读数回到"没设过"的原值（证明读数只由该星系的设定决定；
    // 注：解析口径"没设过"时沿用模型基准「双方期望距离中点」，不是射程中段——中段是**战斗**的回落口径）
    state.expedition.desirePrefByGalaxy = {}
    expect(bountyDamageForecast(state, ctx, card).armorLoss).toBeCloseTo(midLoss.armorLoss, 6)
  })
})
