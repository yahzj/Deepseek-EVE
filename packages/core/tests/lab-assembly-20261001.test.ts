/**
 * **实验室 = 组装机型**（**2026-10-01 船长令**：「**实验室本质上也是一个组装机，建议按照组装机的来。
 * 之后所有的新的生产，优先采用组装机的。除非是将原矿/冰/云转化为原材料这种一转多的情况。**」）。
 *
 * 本文件钉住改造后的四条口径（改前是"炉子那套"）：
 * ① **开工整批扣料 · 只吃物品仓库**（货仓里的料不参与 ⇒ 货仓有料但仓库为空时起线被拒）；
 * ② **一条线 = 一批**：到点出一批 ⇒ 线即结束（不像炉子那样"连跑到料尽"）；
 * ③ **停机退料**：手动停 / 自动停机 / 换线，都按线自己的退料账退回物品仓库；
 * ④ **循环**：开了才续做，缺料/封顶/达标三类自停并写停因（关开关）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSimContext, LAB_RECIPES } from '@whale/data'
import type { GameState } from '../src/state'
import { createInitialState, haltActivityForSwitch } from '../src/state'
import { addItem, addWare, countItem, countWare } from '../src/inventory'
import { advanceLab, labAffordableBatches, labLoopOf, setLabLoop, startLabRun, stopLabRun } from '../src/lab'
import { gainAiCore } from '../src/ai'
import { advanceGame } from '../src/engine'

const ctx = buildSimContext()
const RECIPE = LAB_RECIPES[0]!

/** 实验室已解锁（首座空间站建成）＋ 料按需要放进**物品仓库** */
function ready(mult = 2): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  for (const site of ctx.stations.values()) s.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  for (const m of RECIPE.materials) addWare(s, m.itemId, m.units * mult)
  return s
}

/** 仓库里某味料（起线后用来核对"扣了/退了"） */
const ware = (s: GameState, i: number): number => countWare(s, RECIPE.materials[i]!.itemId)

describe('实验室 · 组装机口径（2026-10-01 船长令）', () => {
  let state: GameState
  beforeEach(() => {
    state = ready()
  })

  it('① 开工整批扣料：**只吃物品仓库**（仓库扣齐 BOM）', () => {
    const before = RECIPE.materials.map((_, i) => ware(state, i))
    expect(startLabRun(state, ctx, RECIPE.id, 'pilot').ok).toBe(true)
    RECIPE.materials.forEach((m, i) => {
      expect(ware(state, i), `第 ${i + 1} 味料按 BOM 扣走`).toBe(before[i]! - m.units)
    })
    expect(state.labRuns![0]!.spentMaterials?.length, '退料账记下本批扣的料').toBe(RECIPE.materials.length)
  })

  it('①′ **货仓里的料不算数**：仓库空、货仓满 ⇒ 起线被拒（旧语义会吃货仓）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 12 })
    for (const site of ctx.stations.values()) s.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    for (const m of RECIPE.materials) addItem(s, m.itemId, m.units * 3) // 全塞**货仓**
    expect(countItem(s, RECIPE.materials[0]!.itemId), '货仓确实有料').toBeGreaterThan(0)
    expect(labAffordableBatches(s, RECIPE), '仓库空 ⇒ 一批都跑不了').toBe(0)
    const r = startLabRun(s, ctx, RECIPE.id, 'pilot')
    expect(r.ok, '货仓有料也不能开工').toBe(false)
    expect(r.errorId).toBe('core.lab.012')
  })

  it('② **一条线 = 一批**：到点出一批 ⇒ 线结束（要继续跑得开循环）', () => {
    expect(startLabRun(state, ctx, RECIPE.id, 'pilot').ok).toBe(true)
    advanceGame(state, RECIPE.cycleMs + 1, ctx)
    expect(countWare(state, RECIPE.outputItemId), '一批产物入仓库').toBe(RECIPE.outputUnits)
    expect(state.labRuns?.length ?? 0, '线已结束').toBe(0)
  })

  it('③ 停机退料：**手动停**退回本批已扣的料（产物不受影响）', () => {
    expect(startLabRun(state, ctx, RECIPE.id, 'pilot').ok).toBe(true)
    const afterStart = RECIPE.materials.map((_, i) => ware(state, i))
    const runId = state.labRuns![0]!.id
    expect(stopLabRun(state, ctx, runId).ok).toBe(true)
    RECIPE.materials.forEach((m, i) => {
      expect(ware(state, i), '本批的料退回仓库').toBe(afterStart[i]! + m.units)
    })
    expect(countWare(state, RECIPE.outputItemId), '没出料').toBe(0)
  })

  it('③′ 停机退料：**自动停机**（换活动那条路）同样退回（与制造线同一口径）', () => {
    expect(startLabRun(state, ctx, RECIPE.id, 'pilot').ok).toBe(true)
    const afterStart = RECIPE.materials.map((_, i) => ware(state, i))
    haltActivityForSwitch(state, 'lab')
    expect(state.labRuns?.length ?? 0, '线被摘掉').toBe(0)
    RECIPE.materials.forEach((m, i) => {
      expect(ware(state, i), '自动停机也要退料（不许吃料）').toBe(afterStart[i]! + m.units)
    })
  })

  it('④ 循环：开了才续做；**缺料**时自停并写停因（关开关）', () => {
    const s = ready(1) // 只够一批
    expect(setLabLoop(s, RECIPE.id, true, null).ok).toBe(true)
    expect(startLabRun(s, ctx, RECIPE.id, 'pilot').ok).toBe(true)
    advanceGame(s, RECIPE.cycleMs * 3 + 3, ctx)
    expect(countWare(s, RECIPE.outputItemId), '只出了一批').toBe(RECIPE.outputUnits)
    expect(s.labRuns?.length ?? 0, '线结束').toBe(0)
    const loop = labLoopOf(s, RECIPE.id)
    expect(loop.on, '自停时开关自动关').toBe(false)
    expect(loop.produced, '合计记到这一批').toBe(1)
    expect(loop.stopWhy, '停因写明缺料').toContain('材料不足')
  })

  it('④′ 循环：**目标批数**达标即停（合计停在目标上、写停因）', () => {
    const s = ready(3)
    expect(setLabLoop(s, RECIPE.id, true, 2).ok).toBe(true)
    expect(startLabRun(s, ctx, RECIPE.id, 'pilot').ok).toBe(true)
    advanceGame(s, RECIPE.cycleMs * 3 + 3, ctx)
    const loop = labLoopOf(s, RECIPE.id)
    expect(loop.produced).toBe(2)
    expect(loop.on).toBe(false)
    expect(loop.stopWhy).toContain('已达成目标 2 批')
    expect(countWare(s, RECIPE.outputItemId), '做了两批').toBe(RECIPE.outputUnits * 2)
  })

  it('④″ AI 核心驱动：循环出料照常，且**进离线结算统计**（2026-10-01 补的漏项）', () => {
    const s = ready(2)
    s.skills.trained['ai-expert'] = 2
    gainAiCore(s, 'basic', 2)
    expect(setLabLoop(s, RECIPE.id, true, null).ok).toBe(true)
    expect(startLabRun(s, ctx, RECIPE.id, 'basic').ok).toBe(true)
    /** 离线结算那条路：`advanceGame` 带 stats 时 AI 线按批计数（口径同精炼/制造）。
     *  ⚠ 推进量按**这条线自己的周期**算（AI 核心驱动 ÷效率 ⇒ 比配方基准周期长）。 */
    const stats = newSettleStatsForTest()
    const runCycle = s.labRuns![0]!.cycleMs
    advanceGame(s, runCycle * 2 + 2, ctx, { settleStats: stats })
    const rec = stats['basic']
    expect(rec?.labBatches ?? 0, 'AI 实验室线的批数进了统计').toBeGreaterThanOrEqual(1)
    expect(rec?.income ?? 0, '并且算了估收入').toBeGreaterThan(0)
  })
})

/** 只为本文件服务的小包装（与 `settleStats.newSettleStats` 同款；避免 import 名字混淆） */
function newSettleStatsForTest(): Record<string, { labBatches: number; income: number }> {
  return {}
}
