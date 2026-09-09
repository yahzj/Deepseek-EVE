/**
 * B3 打捞作业（采矿式自动循环，2026-09-09 船长定：默认满仓返航卸货后同星系自动续捞）测试：
 * 装配门槛（需打捞器）/ 即时打捞结算（密度下降、残骸入货仓）/ 满仓自动返航卸货后自动续捞 /
 * stopAfterTrip 单趟收工 / 手动停止 / AI 打捞任务循环。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { advanceSalvageOp, assayChanceOf, pullOneWreck, salvagerCyclesOf, setSalvageAutoCycle, setSalvageStopAfterTrip, startSalvageOp, stopSalvageOp } from '../src/salvaging'
import { injectWreckDensity, wreckDensityOf } from '../src/salvage'
import { assignAiSalvage, advanceAi, cancelAiTask } from '../src/ai'
import { DEFAULT_BALANCE } from '../src/balance'
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

describe('打捞作业（采矿式自动循环：去程取消，指令即打捞）', () => {
  it('没有打捞器不能出发；装上打捞器即可合法开捞（下达即打捞）', () => {
    const state = fittedState(1)
    const ctx = ctxOf()
    const noSalvager = startSalvageOp(state, 'galaxy-far', ctx)
    expect(noSalvager.ok).toBe(false)
    expect(noSalvager.error).toContain('打捞器')
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    const ok = startSalvageOp(state, 'galaxy-far', ctx)
    expect(ok.ok).toBe(true)
    expect(state.salvaging.phase).toBe('salvaging') // 去程取消：指令即进入打捞
  })

  it('即时打捞结算：密度下降、残骸入货仓、本趟累计增长', () => {
    const state = fittedState(3)
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    injectWreckDensity(state, ctx, 'galaxy-far', 60) // base(sec−0.6 → 34) + 24 = 58
    const d0 = wreckDensityOf(state, 'galaxy-far', ctx)
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    // 5 秒 = 打捞 ~5 轮（周期 1s；无出航等待）
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

  it('满仓→自动返航卸货→自动循环（默认开）：卸入仓库后同星系自动续捞、跨趟多次返港', () => {
    const state = fittedState(5)
    const ctx = ctxOf(20) // 小货仓：几轮就满，便于快速跨趟
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    expect(state.salvaging.autoCycle).toBe(true) // 默认开
    // 逐拍推进到转返航（返航腿随货仓占比缩放，不用固定毫秒断言）
    let guard = 0
    while (state.salvaging.phase !== 'returning' && state.salvaging.active && guard++ < 500) {
      advanceSalvageOp(state, 100, ctx)
    }
    expect(state.salvaging.phase).toBe('returning')
    advanceSalvageOp(state, 60_000, ctx) // 覆盖多趟：卸货 → 续捞 → 再满 → 再返航…
    expect(state.salvaging.active).toBe(true) // 自动循环：作业不结束
    expect(state.salvaging.galaxyId).toBe('galaxy-far') // 同星系续捞
    expect(state.logs.filter((l) => l.text.includes('打捞自动返港')).length).toBeGreaterThanOrEqual(2) // 至少卸了两趟
    const wreckId = 'wreck-ano-far'
    expect(countWare(state, wreckId)).toBeGreaterThan(0) // 残骸已卸入物品仓库
    // 手动停止：本轮作业结束（偏好保留）
    expect(stopSalvageOp(state, ctx)).toBe(true)
    expect(state.salvaging.active).toBe(false)
  })

  it('勾「本次返航卸货后停止」：卸完这一趟即收工（自动循环已结束）', () => {
    const state = fittedState(6)
    const ctx = ctxOf(1.5) // 小货仓：第一轮就放不下 → 立即返航
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    setSalvageStopAfterTrip(state, true) // 与采矿同款联动：autoCycle 被置回开
    expect(state.salvaging.autoCycle).toBe(true)
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    let guard = 0
    while (state.salvaging.phase !== 'returning' && state.salvaging.active && guard++ < 500) {
      advanceSalvageOp(state, 100, ctx)
    }
    expect(state.salvaging.phase).toBe('returning')
    advanceSalvageOp(state, 60_000, ctx)
    expect(state.salvaging.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('自动循环已结束'))).toBe(true)
  })

  it('关闭自动循环：仍满仓返航卸货，但卸完即收工（单趟，不续捞）', () => {
    const state = fittedState(8)
    const ctx = ctxOf(1.5)
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    setSalvageAutoCycle(state, false)
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    let guard = 0
    while (state.salvaging.phase !== 'returning' && state.salvaging.active && guard++ < 500) {
      advanceSalvageOp(state, 100, ctx)
    }
    expect(state.salvaging.phase).toBe('returning')
    advanceSalvageOp(state, 60_000, ctx)
    expect(state.salvaging.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('打捞自动返港'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('未开启自动循环'))).toBe(true)
  })

  it('AI 打捞任务：指派（需打捞器/名额/核心）→ 自动循环（多趟返港卸货）→ 取消才结束、核心归还', () => {
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
    // 大推进：出航（效率 40% 拉长）→ 打捞（基础周期 1s ÷40% = 2.5s/轮）→ 满仓（100 m³）→ 返航 →
    // 卸货 → 自动循环再出航（多趟）；核心持续占用直到取消
    injectWreckDensity(state, ctx, 'galaxy-far', 40)
    state.gameMs = 0
    advanceAi(state, 300_000, ctx)
    expect(state.aiAssignments['sandcat2']).toBeDefined() // 循环中：任务未结束
    expect(state.aiCores.basic).toBe(0) // 核心仍被占用
    const wreckId = 'wreck-ano-far'
    expect(countWare(state, wreckId)).toBeGreaterThan(0) // 残骸已卸入物品仓库（至少一趟）
    expect(state.logs.filter((l) => l.text.includes('[AI') && l.text.includes('打捞自动返港')).length).toBeGreaterThanOrEqual(2) // 至少两趟
    // 取消任务 → 结束并归还核心
    expect(cancelAiTask(state, 'sandcat2', ctx)).toBe(true)
    expect(state.aiAssignments['sandcat2']).toBeUndefined()
    expect(state.aiCores.basic).toBe(1)
  })

  it('漂流物打捞学：残骸打捞量每级 +12%（Lv5 = ×1.6；主控/AI 同源 pullOneWreck）', () => {
    const mk = (lv: number) => {
      const state = fittedState(3)
      const ctx = ctxOf()
      if (lv > 0) state.skills.trained['salvage-diving'] = lv
      state.galaxyWrecks['galaxy-far'] = { density: 34, rare: 0 }
      const pulled = pullOneWreck(state, ctx, 'galaxy-far', 1000)!
      return pulled.volumeM3
    }
    const v0 = mk(0)
    const v5 = mk(5)
    expect(v5).toBeCloseTo(v0 * 1.6, 6)
    expect(v0).toBeGreaterThan(0)
  })

  it('打捞技能组（对标采矿）：整备学 Lv5 周期 −15%；富集识别学 = 按分钟概率（卷B3⑨）', () => {
    const state = fittedState(17)
    const ctx = ctxOf()
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(salvagerCyclesOf(state, ctx, state.shipId)).toEqual([1000])
    state.skills.trained['salvage-rigging'] = 5
    expect(salvagerCyclesOf(state, ctx, state.shipId)).toEqual([850]) // 1000×0.85
    // 卷B3⑨：基础 0.08%/打捞分钟 ×1.2/级，按"轮占分钟"换算（不再 1%/轮）
    expect(assayChanceOf(state, ctx, 60_000)).toBe(0.0008) // 1 分钟轮
    expect(assayChanceOf(state, ctx, 30_000)).toBeCloseTo(0.0004, 12) // 0.5 分钟轮 → 线性减半
    state.skills.trained['wreck-assaying'] = 5
    expect(assayChanceOf(state, ctx, 60_000)).toBeCloseTo(0.0008 * Math.pow(1.2, 5), 12)
    expect(assayChanceOf(state, ctx, 60_000)).toBeGreaterThan(0.0008)
  })
})

describe('完好舰体当场直发（卷B3⑨：命中 = 敌群回收彩头，不再翻体积）', () => {
  const moduleBayOf = (state: GameState): number =>
    Object.values(state.moduleBay).reduce((a, b) => a + b, 0)
  /** 初始装备库基线（经典开局预置 1 件 mod-turret-kin-1） */
  const bayBaseline = (state: GameState): number => moduleBayOf(state)

  it('主控打捞命中 → 基础件必中 1 件入装备库、写日志、不翻体积（rate=60 → 每轮必中）', () => {
    const state = fittedState(3)
    const ctx = makeTestCtx({
      ships: [ship('sandcat', { cargo: 800 })],
      galaxies: [{ ...galaxy('galaxy-hub', '母港'), security: 1.0 }],
      anomalies: [anomaly('ano-a', 'galaxy-hub', { threat: 8, tactic: 'brawl' })],
      balance: { ...DEFAULT_BALANCE, richVeinChance: 0, intactHullRatePerMin: 60, intactMk2Chance: 0 },
      modules: [
        moduleDef('mod-miner-civ', 'miner', 0),
        moduleDef('mod-turret-civ', 'turret', 0),
        moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 }),
      ],
    })
    const baseline = bayBaseline(state)
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(startSalvageOp(state, 'galaxy-hub', ctx).ok).toBe(true)
    advanceSalvageOp(state, 4_000, ctx) // ≥3 轮 → 每轮命中 1 件
    const base = (state.moduleBay['mod-miner-civ'] ?? 0) + (state.moduleBay['mod-turret-civ'] ?? 0)
    const hitLogs = state.logs.filter((l) => l.text.includes('完好舰体')).length
    expect(base).toBeGreaterThanOrEqual(3)
    expect(hitLogs).toBe(base) // 每命中必中 1 件且写 1 条日志
    expect(moduleBayOf(state)).toBe(baseline + base) // 只有基础件入装备库
  })

  it('低安命中 → 命中当轮叠加 MK2 层（intactMk2Chance=1 强制）；高安不掷 MK2', () => {
    const mk2Ctx = makeTestCtx({
      ships: [ship('sandcat', { cargo: 800 })],
      galaxies: [
        { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
        { ...galaxy('galaxy-low', '低安'), security: -0.6 },
      ],
      edges: [{ from: 'galaxy-hub', to: 'galaxy-low', travelMinutes: 2 }],
      anomalies: [anomaly('ano-low', 'galaxy-low', { threat: 40, tactic: 'brawl' })],
      balance: { ...DEFAULT_BALANCE, richVeinChance: 0, intactHullRatePerMin: 60, intactMk2Chance: 1 },
      modules: [
        moduleDef('mod-miner-civ', 'miner', 0),
        moduleDef('mod-turret-kin-2', 'turret', 0),
        moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 }),
      ],
    })
    const state = fittedState(5)
    state.exploredGalaxies.push('galaxy-low')
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(startSalvageOp(state, 'galaxy-low', mk2Ctx).ok).toBe(true)
    advanceSalvageOp(state, 4_000, mk2Ctx) // ≥3 次命中
    const base = state.moduleBay['mod-miner-civ'] ?? 0
    const mk2 = state.moduleBay['mod-turret-kin-2'] ?? 0
    expect(base).toBeGreaterThanOrEqual(3) // 基础件每命中必中
    expect(mk2).toBe(base) // intactMk2Chance=1：每命中同掷 MK2
    // 高安对照：sec≥0 → 同配置无 MK2 层
    const hiCtx = makeTestCtx({
      ships: [ship('sandcat', { cargo: 800 })],
      galaxies: [{ ...galaxy('galaxy-hub', '母港'), security: 1.0 }],
      anomalies: [anomaly('ano-a2', 'galaxy-hub', { threat: 40, tactic: 'brawl' })],
      balance: { ...DEFAULT_BALANCE, richVeinChance: 0, intactHullRatePerMin: 60, intactMk2Chance: 1 },
      modules: [
        moduleDef('mod-miner-civ', 'miner', 0),
        moduleDef('mod-turret-kin-2', 'turret', 0),
        moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 }),
      ],
    })
    const s2 = fittedState(7)
    s2.fleet[s2.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(startSalvageOp(s2, 'galaxy-hub', hiCtx).ok).toBe(true)
    advanceSalvageOp(s2, 4_000, hiCtx)
    expect(s2.moduleBay['mod-miner-civ'] ?? 0).toBeGreaterThanOrEqual(3)
    expect(s2.moduleBay['mod-turret-kin-2'] ?? 0).toBe(0) // 高安不掷 MK2
  })

  it('禁用例（rate=0）：不命中、不入装备库（测试用它保 rng 时序）', () => {
    const state = fittedState(11)
    const ctx = makeTestCtx({
      ships: [ship('sandcat', { cargo: 800 })],
      galaxies: [{ ...galaxy('galaxy-hub', '母港'), security: 1.0 }],
      anomalies: [anomaly('ano-a3', 'galaxy-hub', { threat: 8, tactic: 'brawl' })],
      balance: { ...DEFAULT_BALANCE, richVeinChance: 0, intactHullRatePerMin: 0 },
      modules: [
        moduleDef('mod-miner-civ', 'miner', 0),
        moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 }),
      ],
    })
    const baseline = bayBaseline(state)
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    expect(startSalvageOp(state, 'galaxy-hub', ctx).ok).toBe(true)
    advanceSalvageOp(state, 10_000, ctx) // 10 轮：不命中
    expect(moduleBayOf(state)).toBe(baseline) // 装备库无新增
    expect(state.logs.some((l) => l.text.includes('完好舰体'))).toBe(false)
  })

  it('AI 打捞同享当场直发（pullOneWreck 单点；主控/AI 同源）', () => {
    const state = fittedState(13)
    const ctx = makeTestCtx({
      ships: [ship('sandcat', { cargo: 800 }), ship('sandcat2', { cargo: 100 })],
      galaxies: [
        { ...galaxy('galaxy-hub', '母港'), security: 1.0 },
        { ...galaxy('galaxy-low', '低安'), security: -0.6 },
      ],
      edges: [{ from: 'galaxy-hub', to: 'galaxy-low', travelMinutes: 2 }],
      anomalies: [anomaly('ano-low2', 'galaxy-low', { threat: 40, tactic: 'brawl' })],
      balance: { ...DEFAULT_BALANCE, richVeinChance: 0, intactHullRatePerMin: 60, intactMk2Chance: 0 },
      modules: [
        moduleDef('mod-miner-civ', 'miner', 0),
        moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 }),
      ],
    })
    state.skills.trained['ai-expert'] = 1
    state.aiCores.basic = 1
    state.exploredGalaxies.push('galaxy-low')
    state.fleet['sandcat2'] = { defId: 'sandcat2', customName: null, durability: 1, cargo: {}, fitted: { high: ['mod-salvager-1'], mid: [], low: [] } }
    const baseline = bayBaseline(state)
    expect(assignAiSalvage(state, 'sandcat2', 'basic', 'galaxy-low', ctx).ok).toBe(true)
    advanceAi(state, 60_000, ctx) // 出航（debugQuick 腿 1s）→ 打捞（基础 1s ÷0.4 = 2.5s/轮）
    expect(moduleBayOf(state)).toBeGreaterThan(baseline)
    expect(state.logs.some((l) => l.text.includes('完好舰体'))).toBe(true)
  })
})
