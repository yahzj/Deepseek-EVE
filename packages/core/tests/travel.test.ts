/**
 * 星图航行（V12.1）测试：跃迁速度 × 航行加速技能族 → 实际航程耗时。
 * 覆盖：缺省船不缩放 / warp 反比 / 技能乘算 / minFactor 下限 / 慢船惩罚 /
 * oneLegMs 基础段不缩放 / 远征出发锁定。
 */
import { describe, expect, it } from 'vitest'
import type { SimContext } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addShipToFleet, changeShip } from '../src/shipyard'
import { belt, makeTestCtx, ship } from './helpers'
import { oneLegMs } from '../src/mining'
import { startExpedition } from '../src/expedition'
import { travelLegMs, travelMinutesEff, travelTimeFactor, warpSpeedAus } from '../src/travel'

function freshState(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 42 })
  s.wallet.isk = 5_000_000
  return s
}

/** 测试世界：hub↔far 单程 2 分钟 + 三条不同跃迁速度的船 */
function warpCtx(): SimContext {
  return makeTestCtx({
    ships: [ship('warpy', { warpSpeedAus: 3.5 }), ship('fasty', { warpSpeedAus: 3.9 }), ship('slowpoke', { warpSpeedAus: 2.8 })],
    belts: [belt('belt-far-t', 'ore-a', '远星带', { galaxyId: 'galaxy-far' })],
  })
}

describe('travel.ts 换算（缺省船不缩放）', () => {
  it('测试默认船无 warp 数据 → 因子 1.0，标称分钟原样换算', () => {
    const ctx = makeTestCtx()
    const state = freshState()
    expect(warpSpeedAus(state, ctx)).toBe(3.0)
    expect(travelTimeFactor(state, ctx)).toBe(1)
    expect(travelLegMs(state, ctx, 2)).toBe(120_000)
    expect(travelLegMs(state, ctx, 6)).toBe(360_000)
    expect(travelMinutesEff(state, ctx, 6)).toBe(6)
  })

  it('warp 反比：3.5 快 14%、2.8 慢 7%；分钟取整展示', () => {
    const ctx = warpCtx()
    const state = freshState()
    state.shipId = 'warpy'
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(3 / 3.5, 6)
    // 6 分钟标称 → 360000 × 3/3.5 = 308571.4 → 308571 ms
    expect(travelLegMs(state, ctx, 6)).toBe(Math.round(360_000 * (3 / 3.5)))
    state.shipId = 'slowpoke'
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(3 / 2.8, 6)
    expect(travelMinutesEff(state, ctx, 10)).toBe(Math.round(10 * (3 / 2.8)))
    expect(travelMinutesEff(state, ctx, 10)).toBeGreaterThan(10) // 慢船更慢
  })

  it('航行加速技能族乘算：每级 -4%（nav/wdo/acc 逐级生效）', () => {
    const ctx = warpCtx()
    const state = freshState()
    state.shipId = 'warpy'
    const base = 3 / 3.5
    state.skills.trained['navigation'] = 5
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(base * 0.8, 6)
    state.skills.trained['warp-drive-operation'] = 3
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(base * 0.8 * 0.88, 6)
    state.skills.trained['acceleration-control'] = 2
    expect(travelTimeFactor(state, ctx)).toBeCloseTo(base * 0.8 * 0.88 * 0.92, 6)
    // 与毫秒换算一致
    expect(travelLegMs(state, ctx, 6)).toBe(Math.round(360_000 * base * 0.8 * 0.88 * 0.92))
  })

  it('minFactor 下限：warp 过高/组合过强时不会把航程压没', () => {
    const ctx = makeTestCtx({
      ships: [ship('warpgod', { warpSpeedAus: 12 })],
    })
    const state = freshState()
    state.shipId = 'warpgod'
    for (const sk of ['navigation', 'warp-drive-operation', 'acceleration-control']) {
      state.skills.trained[sk] = 5
    }
    expect(warpSpeedAus(state, ctx)).toBe(12)
    expect(travelTimeFactor(state, ctx)).toBe(0.35)
    expect(travelLegMs(state, ctx, 60)).toBe(Math.round(60 * 60_000 * 0.35))
  })

  it('shipId 参数化：同技能下不同船速各自换算', () => {
    const ctx = warpCtx()
    const state = freshState()
    expect(travelLegMs(state, ctx, 6, 'warpy')).toBe(Math.round(360_000 * (3 / 3.5)))
    expect(travelLegMs(state, ctx, 6, 'fasty')).toBe(Math.round(360_000 * (3 / 3.9)))
    expect(travelLegMs(state, ctx, 6, 'slowpoke')).toBe(Math.round(360_000 * (3 / 2.8)))
  })
})

describe('oneLegMs：满载/返航腿不缩放、航程段缩放（出航空船减半见 outbound 腿）', () => {
  it('母港矿带（无星系）：返航腿 = 本地基准 120 秒，与 warp/技能无关', () => {
    const ctx = warpCtx()
    const state = freshState()
    for (const sk of ['navigation', 'warp-drive-operation', 'acceleration-control']) {
      state.skills.trained[sk] = 5
    }
    expect(oneLegMs(state, ctx, 'belt-a')).toBe(120_000)
  })

  it('挂星系矿带：120 秒基准 + 实际航程（warp 3.5 快于无 warp 默认船）', () => {
    const ctx = warpCtx()
    const state = freshState()
    // 默认船（无 warp，因子 1）：120s + 2min = 240s
    expect(oneLegMs(state, ctx, 'belt-far-t')).toBe(120_000 + 120_000)
    // warpy 3.5：120s + 2min×3/3.5
    state.shipId = 'warpy'
    expect(oneLegMs(state, ctx, 'belt-far-t')).toBe(120_000 + Math.round(120_000 * (3 / 3.5)))
    // AI 副船参数：fasty 更快
    expect(oneLegMs(state, ctx, 'belt-far-t', 'fasty')).toBe(120_000 + Math.round(120_000 * (3 / 3.9)))
  })
})

describe('远征出发锁定（V12.1）', () => {
  // 默认测试目标 ano-hard 位于 galaxy-far（单程 2 分钟），需声望 5 且星系已探索（V13 封锁）
  it('outMs 按出发时技能锁定：途中升级不影响本次航行', () => {
    const ctx = makeTestCtx()
    const state = freshState()
    state.standings['dsi'] = 5
    state.exploredGalaxies.push('galaxy-far')
    // 无技能：2 分钟单程 → outMs 120s
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    expect(state.expedition.outMs).toBe(120_000)
    // 升级航行技能：本次已锁定不变
    state.skills.trained['navigation'] = 5
    expect(state.expedition.outMs).toBe(120_000)
    expect(state.expedition.finishAtGameMs - state.gameMs).toBe(120_000)
  })

  it('出发前已练满技能：outMs 按 ×0.8 锁定', () => {
    const ctx = makeTestCtx()
    const state = freshState()
    state.standings['dsi'] = 5
    state.exploredGalaxies.push('galaxy-far')
    state.skills.trained['navigation'] = 5
    state.skills.trained['warp-drive-operation'] = 5
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    expect(state.expedition.outMs).toBe(Math.round(120_000 * 0.8 * 0.8))
  })

  it('换乘 warp 不同的船再出发，outMs 随船速变化', () => {
    const ctx = warpCtx()
    const state = freshState()
    state.standings['dsi'] = 5
    state.exploredGalaxies.push('galaxy-far')
    addShipToFleet(state, 'warpy')
    expect(changeShip(state, 'warpy', ctx).ok).toBe(true)
    expect(state.shipId).toBe('warpy')
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    expect(state.expedition.outMs).toBe(Math.round(120_000 * (3 / 3.5)))
  })
})
