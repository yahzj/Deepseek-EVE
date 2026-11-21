/** 保留旧文件名守住预估、正式入场及旧星系字段兼容；现行默认按编队保存。 */
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
import { setFleetDistance } from './helpers/fleet-range'
import { makeTestCtx, anomaly, moduleDef, ship } from './helpers'
import { setStanding } from './helpers'
import { finishDeparture } from './helpers/departure-ready'

describe('目标距离按编队保存，旧星系字段兼容留存', () => {
  const ctx = buildSimContext()
  const CARDS = [...ctx.anomalies.values()].filter(
    (a) => a.hidden !== true && a.rewardIsk > 0 && a.threat > 0 && a.threat <= 40,
  )
  const A = CARDS[0]!
  const B = CARDS.find((a) => a.galaxyId !== A.galaxyId)!

  function fresh(): GameState {
    const state = createInitialState({ nowWallMs: 0, seed: 20260911 })
    state.wallet.isk = 1e9
    setStanding(state, 'dsi', 30)
    for (const g of ctx.galaxies.values()) state.exploredGalaxies.push(g.id)
    return state
  }

  /** 在该卡上跑一次"预估用的那一局"（与 MC 同源：快照 → startBattleFor），返回本局期望距离 */
  function evalDesire(state: GameState, anomalyId: string): number {
    const snap = buildEvalState(state, state.shipId)!
    return startBattleFor(snap.ev, ctx, snap.uid, anomalyId, 0)!.myDesireM
  }

  it('星图没设过的星系 = **射程带高位档**（2026-09-15 船长改判；旧"射程中点"作废）', () => {
    const state = fresh()
    const snap = buildEvalState(state, state.shipId)!
    const me = createPlayerSpec(snap.ev, ctx, snap.uid)!
    const want = desiredRangeFor(me, 'mid', ctx.balance.battle, ctx.balance.battle.desireBandMid)
    expect(want).toBeGreaterThan(0)
    expect(snap.ev.expedition.desirePrefByGalaxy).toBeUndefined() // 全新档：一个星系都没设过
    expect(evalDesire(state, A.id)).toBe(want) // 星图默认档（该卡开战距离远大于它，不会被钳）
  })

  it('同一编队跨敌卡与星系沿用1,500，不依赖旧星系偏好', () => {
    const state = fresh()
    setFleetDistance(state, ctx, 1_500)
    expect(state.fleetRange?.desireM).toBe(1_500)
    expect(desirePrefOf(state, B.galaxyId)).toBeNull()
    expect(evalDesire(state, A.id)).toBe(1_500)
    expect(evalDesire(state, B.id)).toBe(1_500)
  })

  it('编队默认随估价快照进入每一局模拟', () => {
    const state = fresh()
    setFleetDistance(state, ctx, 1_200)
    const snap = buildEvalState(state, state.shipId)!
    expect(snap.ev.fleetRange?.desireM).toBe(1_200)
    expect(startBattleFor(snap.ev, ctx, snap.uid, A.id, 0)!.myDesireM).toBe(1_200)
    expect(BOUNTY_MC_RUNS).toBe(10) // 2026-09-24 船长：「三点各 10 局就够了」
    // 同卡同装配，仅编队默认不同。
    const other = fresh()
    expect(evalDesire(other, A.id)).not.toBe(1_200)
  })

  it('远征实跑：设置编队默认后开战即用它', () => {
    const state = fresh()
    setFleetDistance(state, ctx, 1_500)
    expect(startExpedition(state, A.id, ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    expect(state.expedition.battle?.myDesireM).toBe(1_500)
  })

  it('显式null采用自动距离，不读写编队默认', () => {
    const state = fresh()
    setFleetDistance(state, ctx, 1_200)
    const snap = buildEvalState(state, state.shipId)!
    const me = createPlayerSpec(snap.ev, ctx, snap.uid)!
    const def = desiredRangeFor(me, 'mid', ctx.balance.battle, ctx.balance.battle.desireBandMid)
    expect(startBattleFor(snap.ev, ctx, snap.uid, A.id, 0)!.myDesireM).toBe(1_200) // 主控吃设定
    const before = structuredClone(snap.ev)
    expect(startBattleFor(snap.ev, ctx, snap.uid, A.id, 0, null)!.myDesireM).toBe(def)
    expect(snap.ev).toEqual(before)
  })

  it('存档往返：按星系的设定随档保留；老档只带全局 desirePrefM 时一律回落默认档', () => {
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
      desiredRangeFor(meOld, 'mid', ctx.balance.battle, ctx.balance.battle.desireBandMid),
    )
  })
})

describe('稳态解析预估（派系/窝点卡）同口径：设定距离真的改变读数', () => {
  /** 手工世界：我方一门 0~4000、远端衰减 1.0 的炮（越近命中越高）；敌群中等威胁 */
  function world(): { state: GameState; ctx: SimContext } {
    const ctx = makeTestCtx({
      quietEvents: true,
      // 敌血增量与基础炮禁用后保留非饱和窗口，仍精确验证距离引起的承伤变化。
      ships: [ship('sandcat', { shieldHp: 400, armorHp: 900, hullHp: 900 })],
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
    setFleetDistance(state, ctx, 400)
    const closeLoss = bountyDamageForecast(state, ctx, card)
    expect(closeLoss.armorLoss).toBeLessThan(midLoss.armorLoss)
    expect(closeLoss.rawWin).toBeGreaterThan(midLoss.rawWin)
    // 恢复自动档后，解析口径回到双方期望距离中点的原值。
    setFleetDistance(state, ctx, null)
    expect(bountyDamageForecast(state, ctx, card).armorLoss).toBeCloseTo(midLoss.armorLoss, 6)
  })
})
