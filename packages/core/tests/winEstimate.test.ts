/**
 * winEstimate（悬赏胜率预估 · 2026-09-24 船长令重做）测试：
 * - 极端场景方向正确（必胜局 = 1、必败局 = 0）；
 * - **三点距离采样**：按主武器的最大 / 最小 / 中距离各跑 N 局（`points` 三条）；
 * - **去种子化但可复现**：同输入逐位一致（预热缓存稳定）· 与存档自身的 rng 无关（不看运气，只看装配指纹）；
 * - **胜利记录取代采样**：该卡有实战胜利记录 ⇒ 只跑记录距离，且**夹回当前射程内**；
 * - 评估不污染真实存档（rng/钱包/真档货仓不动）；快照正确复制战力（装配/技能/耐久/弹药档/开关）。
 */
import { describe, expect, it } from 'vitest'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { createPlayerSpec } from '../src/combat'
import {
  BOUNTY_MC_RUNS,
  buildEvalState,
  estimateBountyWinMC,
  estimateBountyWinOn,
  evalDistancePoints,
} from '../src/winEstimate'
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

function warriorState(seed = 42): { state: GameState; uid: string } {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, 'warrior')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-t', 'mod-t', 'mod-t'], mid: [], low: [] }
  return { state, uid }
}

const hard = ctx.anomalies.get('ano-hard')!
const easy = ctx.anomalies.get('ano-easy')!

describe('winEstimate 蒙特卡洛预估（2026-09-24 重做：三点距离 + 去种子化 + 胜利记录）', () => {
  it('必胜局 winRate = 1，损耗在合法域', () => {
    const { state, uid } = warriorState()
    const r = estimateBountyWinMC(state, ctx, easy, uid, 3)!
    expect(r.winRate).toBe(1)
    expect(r.worstWinRate).toBe(1)
    expect(r.runs).toBe(9) // 三点各 3 局
    expect(r.armorLoss).toBeGreaterThanOrEqual(0)
    expect(r.armorLoss).toBeLessThanOrEqual(1)
    expect(r.hullLoss).toBeGreaterThanOrEqual(0)
    expect(r.hullLoss).toBeLessThanOrEqual(1)
  })

  it('必败局（沙猫 vs 高威胁）winRate = 0', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 }) // 默认驾驶 = sandcat
    const r = estimateBountyWinMC(state, ctx, hard, state.shipId, 3)
    expect(r).not.toBeNull()
    expect(r!.winRate).toBe(0)
    expect(r!.worstWinRate).toBe(0)
  })

  it('三点 = 主武器的最大 / 最小 / 中距离各 N 局（不新增参数，复用引擎口径）', () => {
    const { state, uid } = warriorState()
    const snap = buildEvalState(state, uid)!
    const me = createPlayerSpec(snap.ev, ctx, snap.uid)!
    const pts = evalDistancePoints(me, ctx)
    const r = estimateBountyWinOn(snap.ev, ctx, easy, snap.uid, 3)
    expect(r.points.map((p) => p.desireM)).toEqual([pts.max, pts.min, pts.mid])
    expect(r.points.map((p) => p.runs)).toEqual([3, 3, 3])
    expect(r.recorded).toBe(false)
    // 最差距离点 = 三点里最低的那个（"运气最差的距离上也赢得下来吗"）
    expect(r.worstWinRate).toBe(Math.min(...r.points.map((p) => p.winRate)))
  })

  it('去种子化：同输入逐位一致（可复现），且与存档自身的 rng、无关字段都无关', () => {
    const a = warriorState(42)
    const b = warriorState(987654) // 只有建档种子不同（= 玩家"这局的运气起点"）
    a.state.rng = { seed: 12345, count: 7 }
    b.state.rng = { seed: 999, count: 3 }
    const ra = estimateBountyWinMC(a.state, ctx, easy, a.uid, 3)!
    const rb = estimateBountyWinMC(b.state, ctx, easy, b.uid, 3)!
    expect(ra).toEqual(rb) // 只看装配/技能指纹，不看存档手里的随机数
    // 同输入再跑一次：逐位一致（预热缓存稳定的前提）
    expect(estimateBountyWinMC(a.state, ctx, easy, a.uid, 3)).toEqual(ra)
    // 指纹之外的字段（改名）不进种子：结果不变
    a.state.fleet[a.uid]!.customName = '另一条名字'
    expect(estimateBountyWinMC(a.state, ctx, easy, a.uid, 3)).toEqual(ra)
  })

  it('有胜利记录 ⇒ 取代三点采样，只跑记录距离（局数 ×3），且夹回当前射程内', () => {
    const { state, uid } = warriorState()
    const snap = buildEvalState(state, uid)!
    const pts = evalDistancePoints(createPlayerSpec(snap.ev, ctx, snap.uid)!, ctx)
    // ① 记录落在射程内：原样使用
    snap.ev.winRecord = { 'ano-easy': { desireM: 1234, remainPct: 0.5 } }
    const r = estimateBountyWinOn(snap.ev, ctx, easy, snap.uid, 3)
    expect(r.recorded).toBe(true)
    expect(r.points).toHaveLength(1)
    expect(r.points[0]!.desireM).toBe(1234)
    expect(r.points[0]!.runs).toBe(9) // 单点 ⇒ 局数 ×3，精度不降
    expect(r.worstWinRate).toBe(r.points[0]!.winRate) // 单点 ⇒ 最差 = 平均
    // ② 记录超出当前射程（换过更短的武器）：夹到当前射程边界
    snap.ev.winRecord = { 'ano-easy': { desireM: 999_999, remainPct: 0.5 } }
    expect(estimateBountyWinOn(snap.ev, ctx, easy, snap.uid, 2).points[0]!.desireM).toBe(pts.max)
    snap.ev.winRecord = { 'ano-easy': { desireM: 1, remainPct: 0.5 } }
    expect(estimateBountyWinOn(snap.ev, ctx, easy, snap.uid, 2).points[0]!.desireM).toBe(pts.min)
    // ③ 记录只按卡生效：换一张卡 ⇒ 回到三点采样
    snap.ev.winRecord = { 'ano-easy': { desireM: 1234, remainPct: 0.5 } }
    expect(estimateBountyWinOn(snap.ev, ctx, hard, snap.uid, 2).recorded).toBe(false)
  })

  it('评估不污染真实存档：rng/钱包/货仓/耐久/胜利记录均不动', () => {
    const { state, uid } = warriorState()
    const rng0 = { ...state.rng }
    const isk0 = state.wallet.isk
    const f0 = state.fleet[uid]!
    f0.armorPct = 0.6
    f0.durability = 0.5
    estimateBountyWinMC(state, ctx, hard, uid, 3)
    expect(state.rng).toEqual(rng0)
    expect(state.wallet.isk).toBe(isk0)
    expect(state.fleet[uid]!.armorPct).toBe(0.6)
    expect(state.fleet[uid]!.durability).toBe(0.5)
    expect(Object.keys(state.fleet[uid]!.cargo)).toHaveLength(0) // 快照内弹药不回流真档
    // 评估是只读克隆：**评估里的胜负绝不写实战胜利记录**（否则会自证）
    expect(state.winRecord).toBeUndefined()
  })

  it('快照正确复制战力（装配/技能/耐久/弹药档/照会战判定/无人机清单/取用开关）', () => {
    const { state, uid } = warriorState()
    const f = state.fleet[uid]!
    f.armorPct = 0.61
    f.durability = 0.42
    f.customName = '测试船甲'
    f.ammoPref = { kinetic: 'ammo-kinetic-l' }
    state.skills.trained['kinetic-gunnery'] = 3
    // 照会战加成（演习场 + 主控 + 「第一次完成悬赏」未完成）改读 importantTasks ⇒ 快照必须带上它，
    // 否则"已完成该任务"的玩家在预估里会白白多一份加成（见 core/firstTasks.isFirstBountyBattle）
    state.importantTasks['first-bounty'] = { done: true }
    const snap = buildEvalState(state, uid)!
    const ef = snap.ev.fleet[snap.uid]!
    expect(ef.defId).toBe('warrior')
    expect(ef.fitted.high).toEqual(['mod-t', 'mod-t', 'mod-t'])
    expect(ef.armorPct).toBe(0.61)
    expect(ef.durability).toBe(0.42)
    expect(ef.customName).toBe('测试船甲')
    expect(ef.ammoPref).toEqual({ kinetic: 'ammo-kinetic-l' }) // 2026-09-24 船长：弹药采用玩家当前选择弹药
    expect(snap.ev.skills.trained['kinetic-gunnery']).toBe(3)
    expect(snap.ev.importantTasks['first-bounty']?.done).toBe(true)
    // 评估弹药给足：**放进开关真正会读的那个池**（2026-09-23 开关默认 = 只从仓库取用）
    expect(snap.ev.resupplyFromWarehouse).toBe(true)
    expect(snap.ev.warehouse.items['ammo-kinetic-l']).toBe(1_000_000)
    expect(snap.ev.warehouse.items['repairkit-mil']).toBe(1_000_000)
    // 开关关掉 ⇒ 料进该舰货仓（评估同样"完全充足"，只是池不同）
    state.resupplyFromWarehouse = false
    const snap2 = buildEvalState(state, uid)!
    expect(snap2.ev.resupplyFromWarehouse).toBe(false)
    expect(snap2.ev.warehouse.items['ammo-kinetic-l'] ?? 0).toBeLessThan(1_000_000) // 料没进仓库
    expect(snap2.ev.fleet[snap2.uid]!.cargo['ammo-kinetic-l']).toBe(1_000_000)
    // 快照上评估也不改原档
    expect(state.fleet[uid]!.durability).toBe(0.42)
  })

  it('BOUNTY_MC_RUNS 默认 = 10（三点各 10 局）；estimateBountyWinOn 在快照上可跑', () => {
    expect(BOUNTY_MC_RUNS).toBe(10) // 2026-09-24 船长：「三点各 10 局就够了」
    const { state, uid } = warriorState()
    const snap = buildEvalState(state, uid)!
    const r = estimateBountyWinOn(snap.ev, ctx, easy, snap.uid, 2)
    expect(r.runs).toBe(6)
    expect(r.winRate).toBe(1)
  })
})
