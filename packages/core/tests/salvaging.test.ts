/**
 * B3 打捞作业（采矿式单趟）测试（2026-09-05 船长定稿口径）：
 * 装配门槛（需打捞器）/ 出航→打捞结算（密度下降、残骸入货仓）/ 满仓自动返航卸货结束 /
 * 手动停止。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceSalvageOp, startSalvageOp, stopSalvageOp } from '../src/salvaging'
import { injectWreckDensity, wreckDensityOf } from '../src/salvage'
import { anomaly, galaxy, makeTestCtx, moduleDef, ship } from './helpers'
import { countItem, countWare } from '../src/inventory'

function ctxOf(cargo = 800) {
  return makeTestCtx({
    ships: [ship('sandcat', { cargo })],
    galaxies: [
      { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
      { ...galaxy('galaxy-far', '远方'), security: -0.6 },
    ],
    anomalies: [anomaly('ano-far', 'galaxy-far', { threat: 40, tactic: 'brawl' })],
    modules: [moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 })],
  })
}

function fittedState(seed: number, cargoM3 = 800) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.debugQuick = true // 调试模式：行程腿固定 1 秒
  state.exploredGalaxies.push('galaxy-far')
  return state
}

describe('打捞作业（采矿式单趟）', () => {
  it('没有打捞器不能出发；装上打捞器即可合法开捞', () => {
    const state = fittedState(1)
    const ctx = ctxOf()
    const noSalvager = startSalvageOp(state, 'galaxy-far', ctx)
    expect(noSalvager.ok).toBe(false)
    expect(noSalvager.error).toContain('打捞器')
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    const ok = startSalvageOp(state, 'galaxy-far', ctx)
    expect(ok.ok).toBe(true)
    expect(state.salvaging.phase).toBe('outbound')
  })

  it('出航 → 打捞结算：密度下降、残骸入货仓、本趟累计增长', () => {
    const state = fittedState(3)
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    injectWreckDensity(state, ctx, 'galaxy-far', 60) // base(sec−0.6 → 34) + 24 = 58
    const d0 = wreckDensityOf(state, 'galaxy-far', ctx)
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    // 5 秒 = 出航 1s + 打捞 ~4 轮（周期 1s）
    advanceSalvageOp(state, 5_000, ctx)
    expect(state.salvaging.active).toBe(true)
    expect(state.salvaging.phase).toBe('salvaging')
    expect(state.salvaging.tripM3).toBeGreaterThan(0)
    const wreckId = 'wreck-ano-far'
    expect(countItem(state, wreckId) + countWare(state, wreckId)).toBeGreaterThan(0)
    expect(wreckDensityOf(state, 'galaxy-far', ctx)).toBeLessThan(d0) // 放干扣减生效
    // 手动停止：货物留在船上
    expect(stopSalvageOp(state, ctx)).toBe(true)
    expect(countItem(state, wreckId)).toBeGreaterThan(0)
  })

  it('满仓（放不下下一轮）→ 自动返航 → 到港卸入仓库 → 作业结束（不自动续）', () => {
    const state = fittedState(5)
    const ctx = ctxOf(1.5) // 小货仓：第一轮捞取就放不下
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    advanceSalvageOp(state, 2_500, ctx) // 出航 1s + 首轮 1s（放不下）→ 转返航
    expect(state.salvaging.phase).toBe('returning')
    advanceSalvageOp(state, 2_000, ctx) // 返航 1s 到港 → 卸货结束
    expect(state.salvaging.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('打捞自动返港'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('不自动续'))).toBe(true)
  })
})
