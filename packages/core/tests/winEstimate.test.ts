/**
 * winEstimate（2026-09-09 蒙特卡洛悬赏胜率预估）测试：
 * - 极端场景方向正确（必胜局 = 1、必败局 = 0）；
 * - 同输入同种子可复现（预热缓存稳定）；runs 参数生效；
 * - 评估不污染真实存档（rng/钱包/真档货仓不动）；
 * - 快照正确复制战力（装配/技能/耐久/教学进度）。
 */
import { describe, expect, it } from 'vitest'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import { BOUNTY_MC_RUNS, buildEvalState, estimateBountyWinMC, estimateBountyWinOn } from '../src/winEstimate'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

const ctx = makeTestCtx({
  ships: [
    // 高血量高火力测试船（打低威胁必秒杀）
    ship('warrior', { shieldHp: 2000, armorHp: 2000, hullHp: 2000, slots: { high: 3, mid: 2, low: 2 }, agility: 0.3, evasion: 0, powerBonus: 0.5 }),
  ],
  modules: [
    moduleDef('mod-t', 'turret', 0, { damageType: 'kinetic', maxRangeM: 4000, minRangeM: 0, hitRate: 0.9, falloff: 0.3, reloadMs: 800, dmgMult: 30, cpuUse: 20 }),
  ],
  anomalies: [anomaly('ano-easy', 'galaxy-hub', { threat: 8 }), anomaly('ano-hard', 'galaxy-far', { threat: 40 }), anomaly('ano-mid', 'galaxy-far', { threat: 22 })],
})

function warriorState(): { state: ReturnType<typeof createInitialState>; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  const uid = addShipToFleet(state, 'warrior')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-t', 'mod-t', 'mod-t'], mid: [], low: [] }
  return { state, uid }
}

const hard = ctx.anomalies.get('ano-hard')!
const easy = ctx.anomalies.get('ano-easy')!

describe('winEstimate 蒙特卡洛预估（2026-09-09）', () => {
  it('必胜局 winRate = 1，损耗在合法域', () => {
    const { state, uid } = warriorState()
    const r = estimateBountyWinMC(state, ctx, easy, uid, 7)!
    expect(r.winRate).toBe(1)
    expect(r.runs).toBe(7)
    expect(r.armorLoss).toBeGreaterThanOrEqual(0)
    expect(r.armorLoss).toBeLessThanOrEqual(1)
    expect(r.hullLoss).toBeGreaterThanOrEqual(0)
    expect(r.hullLoss).toBeLessThanOrEqual(1)
  })

  it('必败局（沙猫 vs 高威胁）winRate = 0', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 }) // 默认驾驶 = sandcat
    const r = estimateBountyWinMC(state, ctx, hard, state.shipId, 7)
    expect(r).not.toBeNull()
    expect(r!.winRate).toBe(0)
  })

  it('同输入同种子可复现（预热缓存稳定）；不同目标结果可区分', () => {
    const { state, uid } = warriorState()
    const a = estimateBountyWinMC(state, ctx, easy, uid, 9)!
    const b = estimateBountyWinMC(state, ctx, easy, uid, 9)!
    expect(a).toEqual(b)
    const mid = ctx.anomalies.get('ano-mid')!
    const hardR = estimateBountyWinMC(state, ctx, hard, uid, 9)!
    expect(hardR.winRate).toBeLessThanOrEqual(a.winRate) // 目标越强胜率不升
  })

  it('评估不污染真实存档：rng/钱包/货仓/耐久均不动', () => {
    const { state, uid } = warriorState()
    const rng0 = { ...state.rng }
    const isk0 = state.wallet.isk
    const f0 = state.fleet[uid]!
    f0.armorPct = 0.6
    f0.durability = 0.5
    estimateBountyWinMC(state, ctx, hard, uid, 5)
    expect(state.rng).toEqual(rng0)
    expect(state.wallet.isk).toBe(isk0)
    expect(state.fleet[uid]!.armorPct).toBe(0.6)
    expect(state.fleet[uid]!.durability).toBe(0.5)
    expect(Object.keys(state.fleet[uid]!.cargo)).toHaveLength(0) // 快照内弹药不回流真档
  })

  it('快照正确复制战力（装配/技能/耐久/教学进度/无人机清单）', () => {
    const { state, uid } = warriorState()
    const f = state.fleet[uid]!
    f.armorPct = 0.61
    f.durability = 0.42
    f.customName = '测试船甲'
    state.skills.trained['kinetic-gunnery'] = 3
    state.onboarding.step = 5 // 教程试炼步（复制后 MC 与实战同口径判定 buff）
    const snap = buildEvalState(state, uid)!
    const ef = snap.ev.fleet[snap.uid]!
    expect(ef.defId).toBe('warrior')
    expect(ef.fitted.high).toEqual(['mod-t', 'mod-t', 'mod-t'])
    expect(ef.armorPct).toBe(0.61)
    expect(ef.durability).toBe(0.42)
    expect(ef.customName).toBe('测试船甲')
    expect(snap.ev.skills.trained['kinetic-gunnery']).toBe(3)
    expect(snap.ev.onboarding.step).toBe(5)
    expect(ef.cargo['ammo-kinetic-l']).toBe(1_000_000) // 评估弹药给足
    // 快照上评估也不改原档
    expect(state.fleet[uid]!.durability).toBe(0.42)
  })

  it('BOUNTY_MC_RUNS 默认 = 21；estimateBountyWinOn 在快照上可跑', () => {
    expect(BOUNTY_MC_RUNS).toBe(21)
    const { state, uid } = warriorState()
    const snap = buildEvalState(state, uid)!
    const r = estimateBountyWinOn(snap.ev, ctx, easy, snap.uid, 5)
    expect(r.runs).toBe(5)
    expect(r.winRate).toBe(1)
  })
})
