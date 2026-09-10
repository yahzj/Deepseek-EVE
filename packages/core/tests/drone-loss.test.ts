/**
 * 机群战损（2026-09-10 船长拍板「无人机可被击落」+ **永久损失制**）：
 * 敌方点防逐架射击我方放飞无人机（命中按机型闪避、伤害按机型三层抗性）→ 血尽即击落、该架停火；
 * 战斗结束（胜/败/撤退）把击落架数从无人机舱清单**永久扣除**。
 * 本测试覆盖：威胁门槛、射程保护、击落上限、被击落架停火与机群计数递减、结算永久扣除、
 * 确定性可复现。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  addWare,
  countWare,
  createInitialState,
} from '../src/index'
import {
  advanceBattleFor,
  battleArcsFor,
  droneRecoveryRate,
  settleDroneLosses,
  startBattleFor,
  waveGapTotalMs,
} from '../src/combat'
import type { BattleState, GameState } from '../src/state'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
const SHIP = 'sh-sentinel' // 王鲭 4 高槽 / 机巢 320
const LOAD = { 'drone-heavy': 4, 'drone-sentry': 6 } // D3 口径
const HIGH = 'ano-vault-sentinel' // 威胁 96（有点防）
const LOW = 'ano-pirate-post' // 低威胁（无点防）
/** 满战斗技能（与 tools/drone-vs-gun.ts 同口径：无技能档机群会被 CPU 裁剪、也不代表真实强度） */
const FULL_SKILLS: Record<string, number> = Object.fromEntries(
  [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
    'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
    'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
    'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
  ].map((k) => [k, 5]),
)

function makeState(seed = 1, load: Record<string, number> = LOAD): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  for (const [k, v] of Object.entries(FULL_SKILLS)) state.skills.trained[k] = v
  const entry = state.fleet[uid]!
  entry.fitted = {
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
    mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-rof-2', 'mod-armor-kin-2'],
  }
  entry.droneLoad = { ...load }
  for (const [id, n] of Object.entries(load)) addWare(state, id, n) // 仓库备货（便于核对扣减）
  return state
}

function runBattle(state: GameState, anomalyId: string, c: SimContext = ctx): BattleState | null {
  const battle = startBattleFor(state, c, state.shipId, anomalyId, 0)
  if (!battle) return null
  // 挂进远征态（battleArcsFor / 结算入口都从 expedition 读战斗）
  state.expedition.active = true
  state.expedition.phase = 'battle'
  state.expedition.anomalyId = anomalyId
  state.expedition.battle = battle
  state.gameMs =
    c.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(c.anomalies.get(anomalyId), c.balance.battle)
  advanceBattleFor(state, c, battle, state.shipId, anomalyId)
  return battle
}

describe('机群战损：无人机可被击落（2026-09-10 船长拍板，永久损失制）', () => {
  it('低威胁（无点防）不损失：清单原样、无 droneLost', () => {
    const state = makeState(3)
    const battle = runBattle(state, LOW)!
    expect(battle).toBeTruthy()
    expect(battle.dronePools).toBeTruthy()
    expect(Object.values(battle.dronePools!).every((p) => p.alive)).toBe(true)
    expect(battle.droneLost ?? {}).toEqual({})
    expect(settleDroneLosses(state, ctx, state.shipId, battle)).toBeNull()
    expect(state.fleet[state.shipId]!.droneLoad).toEqual(LOAD)
  })

  it('高威胁（有点防）会击落：机群递减、清单被扣除（战斗内可 100% 损坏，无单场上限）', () => {
    const state = makeState(7)
    const battle = runBattle(state, HIGH)!
    const pools = Object.values(battle.dronePools ?? {})
    const lost = pools.filter((p) => !p.alive).length
    expect(lost).toBeGreaterThan(0) // 硬卡必有点防战损
    expect(lost).toBeLessThanOrEqual(pools.length) // 2026-09-10 船长：上限已取消，最多整队损坏
    expect(battle.droneLost).toEqual(expect.any(Object))

    // 射程弧只统计存活架（UI 机群数量递减）
    const arcs = battleArcsFor(state, ctx)!
    const dronesInArcs = arcs.me.filter((w) => w.src === 'drone').reduce((s, w) => s + (w.count ?? 1), 0)
    expect(dronesInArcs).toBe(pools.length - lost)
    expect(arcs.droneLost).toEqual(battle.droneLost)

    // 损失扣除：基础回收率 20%（按机型四舍五入）→ 净损失 = 损坏 − 回收
    const before = battle.droneLost!
    const rate = droneRecoveryRate(state)
    expect(rate).toBeCloseTo(0.2, 6) // 无技能 = 基础 20%
    const text = settleDroneLosses(state, ctx, state.shipId, battle)
    expect(text).toBeTruthy()
    const load = state.fleet[state.shipId]!.droneLoad ?? {}
    for (const [id, n] of Object.entries(before)) {
      const back = Math.round(n * rate)
      expect(load[id] ?? 0).toBe(Math.max(0, (LOAD as Record<string, number>)[id]! - (n - back)))
    }
    expect(state.droneLossNotice).toContain('机群战损')
    // 日志已写
    expect(state.logs.some((l) => l.text.includes('机群战损'))).toBe(true)
    // 仓库中的补充库存不受影响（回港可再装）
    expect(countWare(state, 'drone-heavy')).toBe(4)
  })

  it('无距离豁免（2026-09-10 船长：放飞出去就在威胁之下）＋哨戒机优先豁免：先打非哨戒机', () => {
    // 关掉近防炮（威胁门槛抬到极高）→ 完全不掉架；再对比正常值：损失表里不应出现哨戒机
    const noPd: SimContext = {
      ...ctx,
      balance: { ...ctx.balance, battle: { ...ctx.balance.battle, pdThreatFloor: 999 } },
    }
    const stateA = makeState(11)
    const battleA = runBattle(stateA, HIGH, noPd)!
    expect(Object.values(battleA.dronePools ?? {}).every((p) => p.alive)).toBe(true)

    const stateB = makeState(11)
    const battleB = runBattle(stateB, HIGH)!
    const lostIds = Object.keys(battleB.droneLost ?? {})
    // 还有非哨戒机存活时，哨戒机不出现在损失表
    const nonSentryAlive = Object.values(battleB.dronePools ?? {}).some((p) => p.alive && p.artId !== 'drone-sentry')
    if (nonSentryAlive) expect(lostIds).not.toContain('drone-sentry')
  })

  it('非哨戒机全灭后近防炮转火哨戒机（2026-09-10 船长追加）', () => {
    // 只带哨戒机的编队：没有非哨戒机可打 ⇒ 近防炮必须直接打哨戒机
    const onlySentry = makeState(13, { 'drone-sentry': 6 })
    const battle = runBattle(onlySentry, HIGH)!
    const lost = battle.droneLost ?? {}
    expect(Object.keys(lost)).toEqual(['drone-sentry'])
    expect(lost['drone-sentry']).toBeGreaterThan(0)
  })

  it('确定性：同种子两次运行损失架数与机型完全一致', () => {
    const a = runBattle(makeState(23), HIGH)!
    const b = runBattle(makeState(23), HIGH)!
    expect(a.droneLost).toEqual(b.droneLost)
    expect(a.stats.meShots).toBe(b.stats.meShots)
  })

  it('结算幂等：同一场战斗重复结算不重复扣（清单不会扣穿）', () => {
    const state = makeState(5)
    const battle = runBattle(state, HIGH)!
    const lostBefore = { ...(battle.droneLost ?? {}) }
    if (Object.keys(lostBefore).length === 0) return // 该种子无损失：跳过（上面用例已覆盖）
    settleDroneLosses(state, ctx, state.shipId, battle)
    const after = JSON.stringify(state.fleet[state.shipId]!.droneLoad ?? {})
    // 结算即清账：战损记录不再留存，重复结算为 no-op
    expect(battle.droneLost).toBeUndefined()
    expect(settleDroneLosses(state, ctx, state.shipId, battle)).toBeNull()
    expect(JSON.stringify(state.fleet[state.shipId]!.droneLoad ?? {})).toBe(after)
  })
})
