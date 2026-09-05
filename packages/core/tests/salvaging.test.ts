/**
 * B3 打捞作业（采矿式单趟）测试（2026-09-05 船长定稿口径）：
 * 装配门槛（需打捞器）/ 出航→打捞结算（密度下降、残骸入货仓）/ 满仓自动返航卸货结束 /
 * 手动停止。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceSalvageOp, assayChanceOf, pullOneWreck, salvagerCyclesOf, startSalvageOp, stopSalvageOp } from '../src/salvaging'
import { injectWreckDensity, wreckDensityOf } from '../src/salvage'
import { assignAiSalvage, advanceAi } from '../src/ai'
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

  it('AI 打捞任务：指派（需打捞器/名额/核心）→ 单趟往返 → 满仓返港卸货 → 任务结束核心归还', () => {
    const state = fittedState(7)
    state.debugQuick = true
    const ctx = ctxOf(100)
    // 副船 + 名额 + 基础核心
    state.skills.trained['ai-expert'] = 1
    state.aiCores.basic = 1
    state.fleet['sandcat2'] = { defId: 'sandcat2', customName: null, durability: 1, cargo: {}, fitted: { high: ['mod-salvager-1'], mid: [], low: [] } }
    // 无打捞器 → 拒绝
    state.fleet['sandcat2']!.fitted = { high: [], mid: [], low: [] }
    expect(assignAiSalvage(state, 'sandcat2', 'basic', 'galaxy-far', ctx).ok).toBe(false)
    // 装上打捞器 → 出发
    state.fleet['sandcat2']!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(assignAiSalvage(state, 'sandcat2', 'basic', 'galaxy-far', ctx).ok).toBe(true)
    // 大推进：出航（效率 40% 拉长）→ 打捞（基础周期 1s ÷40% = 2.5s/轮）→ 满仓（100 m³）→ 返航 → 结束
    injectWreckDensity(state, ctx, 'galaxy-far', 40)
    state.gameMs = 0
    advanceAi(state, 200_000, ctx)
    expect(state.aiAssignments['sandcat2']).toBeUndefined() // 任务结束
    expect(state.aiCores.basic).toBe(1) // 核心已归还
    const wreckId = 'wreck-ano-far'
    expect(countItem(state, wreckId) + countWare(state, wreckId)).toBeGreaterThan(0) // 残骸已入物品仓库
    expect(state.logs.some((l) => l.text.includes('打捞任务完成'))).toBe(true)
  })

  it('漂流物打捞学：残骸打捞量每级 +12%（Lv5 = ×1.6；主控/AI 同源 pullOneWreck）', () => {
    const mk = (lv: number) => {
      const state = fittedState(3)
      const ctx = ctxOf()
      if (lv > 0) state.skills.trained['salvage-diving'] = lv
      state.galaxyWrecks['galaxy-far'] = { density: 34, rare: 0 }
      const pulled = pullOneWreck(state, ctx, 'galaxy-far')!
      return pulled.volumeM3
    }
    const v0 = mk(0)
    const v5 = mk(5)
    expect(v5).toBeCloseTo(v0 * 1.6, 6)
    expect(v0).toBeGreaterThan(0)
  })

  it('打捞技能组（对标采矿）：整备学 Lv5 周期 −15%；富集识别学 Lv5 概率 ×1.2⁵', () => {
    const state = fittedState(17)
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(salvagerCyclesOf(state, ctx, state.shipId)).toEqual([1000])
    state.skills.trained['salvage-rigging'] = 5
    expect(salvagerCyclesOf(state, ctx, state.shipId)).toEqual([850]) // 1000×0.85
    expect(assayChanceOf(state)).toBe(0.01) // 未学富集识别学
    state.skills.trained['wreck-assaying'] = 5
    expect(assayChanceOf(state)).toBeCloseTo(0.01 * Math.pow(1.2, 5), 12)
    expect(assayChanceOf(state)).toBeGreaterThan(0.01)
  })
})
