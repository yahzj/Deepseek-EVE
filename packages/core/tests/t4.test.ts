/**
 * T4 采矿：显式"前往矿带"行程（船长定稿：空船出航跃迁×2 = 返航腿一半；本地满载返航 120s）
 * + 采矿中换驾驶＝直接成功、旧船自动返航卸货（shipReturns 善后账本；原"换船重采"已取消）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { loadSaveFile, SAVE_FORMAT } from '../src/save'
import { countItem, countWare } from '../src/inventory'
import { miningStatus, oneLegMs, oneOutboundLegMs, startMining, startMiningFromExpedition } from '../src/mining'
import { changeShip } from '../src/shipyard'
import { startExpedition, startExpeditionFromMining } from '../src/expedition'
import { makeTestCtx, belt, ship } from './helpers'

/** 世界：驾驶船 sandcat（800 m³/12s/10u）+ 附赠武装艇 sh-falconet（有 def）；关闭富矿脉保时序确定 */
function world() {
  const bal = makeTestCtx().balance
  const ctx: SimContext = makeTestCtx({
    ships: [ship('sh-falconet', { cargo: 120 })],
    balance: { ...bal, richVeinChance: 0 },
    quietEvents: true,
  })
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
  return { state, ctx }
}

describe('T4 显式行程（定稿：空船出航×2 = 返航腿一半）', () => {
  it('本地：返航腿 120s、空船出航 60s；出航途中无产出，到带才采掘', () => {
    const { state, ctx } = world()
    expect(oneLegMs(state, ctx, 'belt-a')).toBe(120_000)
    expect(oneOutboundLegMs(state, ctx, 'belt-a')).toBe(60_000)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.mining.phase).toBe('outbound')
    advanceGame(state, 59_999, ctx)
    expect(state.mining.phase).toBe('outbound')
    expect(countItem(state, 'ore-a')).toBe(0)
    advanceGame(state, 1, ctx)
    expect(state.mining.phase).toBe('mining')
    expect(miningStatus(state, ctx).remainingMs).toBe(12_000)
  })

  it('远处矿带：返航腿 = 航程 + 120s、出航减半；未点亮星系拒绝出发；到带即点亮', () => {
    const { state, ctx } = world()
    const bal = makeTestCtx().balance
    const farCtx: SimContext = makeTestCtx({
      belts: [belt('belt-far', 'ore-a', '远带', { galaxyId: 'galaxy-far' })],
      balance: { ...bal, richVeinChance: 0 },
      quietEvents: true,
    })
    expect(startMining(state, 'belt-far', farCtx).ok).toBe(false) // 未探索
    state.exploredGalaxies.push('galaxy-far')
    expect(startMining(state, 'belt-far', farCtx).ok).toBe(true)
    expect(oneLegMs(state, farCtx, 'belt-far')).toBe(120_000 + 120_000)
    expect(oneOutboundLegMs(state, farCtx, 'belt-far')).toBe(120_000)
    advanceGame(state, 120_000, farCtx)
    expect(state.mining.phase).toBe('mining')
    expect(state.exploredGalaxies).toContain('galaxy-far')
  })
})

describe('T4 换驾驶善后（原"换船重采"取消）', () => {
  it('采掘中直接换驾驶成功：旧船入善后账本（货留旧船），采矿结束，新船为驾驶船', () => {
    const { state, ctx } = world()
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 60_000 + 36_000, ctx) // 空船出航 60s 到带 + 3 循环 = 30 单位
    expect(countItem(state, 'ore-a')).toBe(30)

    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(state.shipId).toBe('sh-falconet')
    expect(state.mining.active).toBe(false)
    expect(state.shipReturns['sandcat']).toEqual({ beltId: 'belt-a', legMs: 120_000, phaseAccMs: 0 })
    expect(state.fleet.sandcat.cargo['ore-a']).toBe(30) // 货随旧船
    expect(state.logs.some((l) => l.text.includes('自动返航'))).toBe(true)

    // 旧船 120s 后到港整仓卸货、账本清除
    advanceGame(state, 120_000, ctx)
    expect(state.shipReturns['sandcat']).toBeUndefined()
    expect(countWare(state, 'ore-a')).toBe(30)
    expect(state.fleet.sandcat.cargo['ore-a'] ?? 0).toBe(0)
  })

  it('返航途中换驾驶：旧船继续走完剩余返航；出航中换驾驶按空船 2× 折算', () => {
    const { state, ctx } = world()
    // 返航途中（已走 15s / 120s）
    state.fleet.sandcat.cargo['ore-a'] = 70
    state.mining = {
      active: true,
      beltId: 'belt-a',
      phase: 'returning',
      cycleAccMs: 0,
      phaseAccMs: 15_000,
      tripUnits: 70,
      autoCycle: true,
      stopAfterTrip: false,
      originGalaxy: null,
    }
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(true)
    expect(state.shipReturns['sandcat']).toEqual({ beltId: 'belt-a', legMs: 120_000, phaseAccMs: 15_000 })
    advanceGame(state, 105_000, ctx)
    expect(countWare(state, 'ore-a')).toBe(70)
    expect(state.shipReturns['sandcat']).toBeUndefined()

    // 出航中（空船腿 60s 已走 12s → 等效满载已走 24s，剩余返航 96s）
    const state2: GameState = createInitialState({ nowWallMs: 0, seed: 2 })
    startMining(state2, 'belt-a', ctx)
    advanceGame(state2, 12_000, ctx)
    expect(changeShip(state2, 'sh-falconet', ctx).ok).toBe(true)
    expect(state2.shipReturns['sandcat']).toEqual({ beltId: 'belt-a', legMs: 120_000, phaseAccMs: 24_000 })
    advanceGame(state2, 96_000, ctx)
    expect(state2.shipReturns['sandcat']).toBeUndefined()
  })

  it('远征/扫描在途换驾驶仍被拒（回归守卫）', () => {
    const { state, ctx } = world()
    state.expedition = {
      active: true,
      anomalyId: 'ano-a',
      finishAtGameMs: 120_000,
      durationMs: 240_000,
      outMs: 120_000,
      combatMs: 60_000,
      power: 1,
      eventId: null,
      eventFired: false,
      phase: 'out',
      battle: null,
    }
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(false)
    state.expedition.active = false
    state.scanning = { active: true, galaxyId: 'galaxy-far', finishAtGameMs: 600_000, startedAtGameMs: 0, originGalaxy: null }
    expect(changeShip(state, 'sh-falconet', ctx).ok).toBe(false)
  })
})

describe('T4 存档（善后账本兼容字段）', () => {
  it('shipReturns 往返与容错：只收合法条目，已走封顶单程；缺失自动补空', () => {
    const text = JSON.stringify({
      format: SAVE_FORMAT,
      version: 16,
      savedAtWallMs: 0,
      state: {
        skills: {},
        shipReturns: {
          sandcat: { beltId: 'belt-a', legMs: 120_000, phaseAccMs: 12_000 },
          'junk-ship': '垃圾',
          broken: { beltId: 'belt-a', legMs: 5_000, phaseAccMs: 99_999 },
        },
      },
    })
    const loaded = loadSaveFile(text)
    expect(loaded.state.shipReturns).toEqual({
      sandcat: { beltId: 'belt-a', legMs: 120_000, phaseAccMs: 12_000 },
      broken: { beltId: 'belt-a', legMs: 5_000, phaseAccMs: 5_000 },
    })
    const text2 = JSON.stringify({ format: SAVE_FORMAT, version: 16, savedAtWallMs: 0, state: { skills: {} } })
    expect(loadSaveFile(text2).state.shipReturns).toEqual({})
  })
})

/* ═══════ T4 延后项：远征 ↔ 采矿互斥解除（船长 2026-09-04 定稿转场语义） ═══════ */

function startLocalMining(state: GameState, ctx: SimContext): void {
  expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
  // 走完出航腿，进入采掘
  advanceGame(state, 60_001, ctx)
  expect(state.mining.phase).toBe('mining')
}

describe('T4 延后项：采矿 ↔ 远征 转场', () => {
  it('采矿中（本地矿带）转战悬赏：采矿结束、货随船、远征从母港出发', () => {
    const { state, ctx } = world()
    startLocalMining(state, ctx)
    state.fleet[state.shipId]!.cargo['ore-a'] = 5 // 船上已有货
    expect(startExpeditionFromMining(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.mining.active).toBe(false)
    expect(state.expedition.active).toBe(true)
    expect(state.expedition.anomalyId).toBe('ano-a')
    expect(state.expedition.phase).toBe('out')
    expect(state.awayGalaxy).toBeNull() // 本地矿带 → 母港出发
    expect(state.fleet[state.shipId]!.cargo['ore-a']).toBe(5) // 货随船
    expect(state.logs.some((l) => l.text.includes('采矿已结束'))).toBe(true)
  })

  it('采矿中（异地矿带）转战：远征从矿带所在星系出发', () => {
    const ctx2 = makeTestCtx({
      quietEvents: true,
      belts: [belt('belt-a', 'ore-a', '带belt-a', { galaxyId: 'galaxy-hub' }), belt('belt-f', 'ore-a', '远处带', { galaxyId: 'galaxy-far' })],
    })
    const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
    state.exploredGalaxies.push('galaxy-far') // 点亮远方星系，解锁采矿封锁
    expect(startMining(state, 'belt-f', ctx2).ok).toBe(true)
    advanceGame(state, 500_000, ctx2) // 2 分钟航程到达后在采掘
    expect(state.mining.phase).toBe('mining')
    expect(startExpeditionFromMining(state, 'ano-a', ctx2).ok).toBe(true) // 目标在母港星系
    expect(state.expedition.active).toBe(true)
    // 出发点 = 矿带星系：远征出发日志带起点名（startExpedition 会清空 awayGalaxy 表达）
    expect(state.expedition.outMs).toBeGreaterThan(0) // 从 far 飞回 hub 有航程
    expect(state.logs.some((l) => l.text.includes('从「远方」启程'))).toBe(true)
  })

  it('预检先行：声望不足时拒绝转战，采矿作业不受影响', () => {
    const { state, ctx } = world()
    startLocalMining(state, ctx)
    const r = startExpeditionFromMining(state, 'ano-hard', ctx) // 需声望 5
    expect(r.ok).toBe(false)
    expect(state.mining.active).toBe(true) // 采矿没被打断
  })

  it('无采矿作业时转战入口回落普通出击', () => {
    const { state, ctx } = world()
    expect(startExpeditionFromMining(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.expedition.active).toBe(true)
    expect(state.mining.active).toBe(false)
  })

  it('远征去程中直接开矿：远征取消（连击同步停）、采矿从母港开始', () => {
    const { state, ctx } = world()
    state.autoLoopAnomalyId = 'ano-a' // 模拟连击发起
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.expedition.active).toBe(true)
    expect(startMiningFromExpedition(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.expedition.active).toBe(false)
    expect(state.expedition.anomalyId).toBeNull()
    expect(state.mining.active).toBe(true)
    expect(state.mining.phase).toBe('outbound')
    expect(state.autoLoopAnomalyId).toBeNull() // 连击停止
    expect(state.awayGalaxy).toBeNull()
  })

  it('交火中不能转开采：拒绝且远征原样', () => {
    const { state, ctx } = world()
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 1, ctx) // 零航程 → 立即进入交火
    expect(state.expedition.phase).toBe('battle')
    const r = startMiningFromExpedition(state, 'belt-a', ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('交火')
    expect(state.expedition.active).toBe(true)
    expect(state.mining.active).toBe(false)
  })

  it('无远征时转开采入口回落普通采矿', () => {
    const { state, ctx } = world()
    expect(startMiningFromExpedition(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.mining.active).toBe(true)
    expect(state.expedition.active).toBe(false)
  })
})