import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceSalvageOp, pullOneWreck, salvagerCyclesOf, startSalvageOp } from '../src/salvaging'
import { advanceAi, aiEfficiency, assignAiSalvage } from '../src/ai'
import { addShipToFleet } from '../src/fleetBook'
import { injectRareWreck, injectWeekendRareWreck, injectWeekendWreck, weekendRareWreckCountOf,
  weekendWreckDensityOf, weekendWreckPoolsOf, wreckGroupOfCard } from '../src/salvage'
import { invasionWreckRowsOf } from '../../../apps/desktop/src/renderer/src/pages/wreckCards'

const ctx = buildSimContext()
const galaxyId = 'galaxy-redring'
const resident = [...ctx.anomalies.values()].find(a => !a.hidden && a.galaxyId === galaxyId)!
const residentGroup = wreckGroupOfCard(resident.id, ctx)!
const sources = [
  { family: 'R', cardId: 'corona-converge', wreck: 'wreck-r-inv', rare: 'wreck-rare-r-inv' },
  { family: 'H', cardId: 'ink-main', wreck: 'wreck-h-hi', rare: 'wreck-rare-h-hi' },
  { family: 'C', cardId: 'alien-main', wreck: 'wreck-c-inv', rare: 'wreck-rare-c-inv' },
] as const

function legacyState() {
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  state.galaxyWrecks[galaxyId] = { density: 1000, rare: 0, byGroup: { [residentGroup.key]: 1000 } }
  state.salvaging.active = true
  state.salvaging.galaxyId = galaxyId
  state.salvaging.phase = 'salvaging'
  state.salvaging.targetGroup = residentGroup.key
  return state
}

describe('入侵稀有捞完后普通池继续扣量', () => {
  it.each(sources)('$family 族：读档保留的常驻筛选不能绕过入侵稀有或普通池', source => {
    let state = legacyState()
    injectWeekendWreck(state, galaxyId, 1000, source.family)
    injectWeekendRareWreck(state, galaxyId, source.cardId, 1, source.family)
    state = loadSaveFile(serializeSaveFile(state, 0)).state
    const residentBefore = structuredClone(state.galaxyWrecks)

    expect(pullOneWreck(state, ctx, galaxyId, 0)?.itemId).toBe(source.rare)
    expect(weekendRareWreckCountOf(state, galaxyId)).toBe(0)
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(1000)
    expect(state.salvaging.targetGroup).toBeUndefined()

    let total = 0
    for (let round = 0; round < 100 && weekendWreckDensityOf(state, galaxyId) > 0; round++) {
      const before = weekendWreckDensityOf(state, galaxyId)
      const pulled = pullOneWreck(state, ctx, galaxyId, 0)!
      expect(pulled.itemId).toBe(source.wreck)
      expect(pulled.volumeM3).toBeGreaterThan(0)
      total += pulled.volumeM3
      expect(before - weekendWreckDensityOf(state, galaxyId)).toBeCloseTo(pulled.volumeM3, 6)
      expect(invasionWreckRowsOf(state, ctx, galaxyId).find(row => row.key === source.family)?.density ?? 0)
        .toBeCloseTo(1000 - total, 6)
    }
    expect(total).toBeCloseTo(1000, 6)
    expect(state.weekendWrecks?.[galaxyId]).toBeUndefined()
    expect(state.galaxyWrecks).toEqual(residentBefore)
    expect(pullOneWreck(state, ctx, galaxyId, 0)?.itemId).toBe(`wreck-${residentGroup.key}`)
  })

  it('常驻稀有清空后，仍有库存的旧常驻筛选不能阻止入侵普通扣量', () => {
    const state = legacyState()
    injectRareWreck(state, galaxyId, resident.id, 1)
    injectWeekendWreck(state, galaxyId, 1000, 'R')
    expect(pullOneWreck(state, ctx, galaxyId, 0)?.itemId).toBe(`wreck-rare-${residentGroup.key}`)
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(1000)
    const ordinary = pullOneWreck(state, ctx, galaxyId, 0)!
    expect(ordinary.itemId).toBe('wreck-r-inv')
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(1000 - ordinary.volumeM3)
  })

  it('混合三族：清空全部稀有后逐轮只扣产出族，其他族保持原量', () => {
    const state = legacyState()
    for (const source of sources) {
      injectWeekendWreck(state, galaxyId, 500, source.family)
      injectWeekendRareWreck(state, galaxyId, source.cardId, 1, source.family)
    }
    const rare = sources.map(() => pullOneWreck(state, ctx, galaxyId, 0)!.itemId)
    expect(new Set(rare)).toEqual(new Set(sources.map(source => source.rare)))
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(1500)
    const totals: Record<string, number> = { R: 0, H: 0, C: 0 }
    for (let round = 0; round < 100 && weekendWreckDensityOf(state, galaxyId) > 0; round++) {
      const before = Object.fromEntries(weekendWreckPoolsOf(state, galaxyId).map(pool => [pool.key, pool.density]))
      const pulled = pullOneWreck(state, ctx, galaxyId, 0)!
      const source = sources.find(row => row.wreck === pulled.itemId)!
      expect(source).toBeDefined()
      totals[source.family]! += pulled.volumeM3
      const after = Object.fromEntries(weekendWreckPoolsOf(state, galaxyId).map(pool => [pool.key, pool.density]))
      for (const row of sources) {
        expect((before[row.family] ?? 0) - (after[row.family] ?? 0))
          .toBeCloseTo(row.family === source.family ? pulled.volumeM3 : 0, 6)
      }
    }
    expect(totals).toEqual({ R: 500, H: 500, C: 500 })
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(0)
  })

  it.each(['pilot', 'ai'] as const)('%s 完整作业：稀有清空后普通货入舱且池量同步减少', owner => {
    const state = legacyState()
    state.salvaging.active = false
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standingsEarned = { dsi: 100 }
    state.skills.trained['ai-expert'] = 1
    const shipId = owner === 'pilot' ? state.shipId : addShipToFleet(state, 'sh-thresher')
    state.fleet[shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    if (owner === 'pilot') {
      expect(startSalvageOp(state, galaxyId, ctx).ok).toBe(true)
      state.salvaging.targetGroup = residentGroup.key // 模拟仍在作业的旧档。
    } else {
      state.aiCores.basic = 1
      expect(assignAiSalvage(state, shipId, 'basic', galaxyId, ctx).ok).toBe(true)
      const task = state.aiAssignments[shipId]!.task
      if (task.kind !== 'salvage') throw new Error('预期打捞任务')
      task.phase = 'salvaging'
    }
    injectWeekendWreck(state, galaxyId, 1000, 'R')
    injectWeekendRareWreck(state, galaxyId, 'corona-converge', 1, 'R')
    const cycle = salvagerCyclesOf(state, ctx, shipId)[0]!
    const advance = () => owner === 'pilot'
      ? advanceSalvageOp(state, cycle, ctx)
      : advanceAi(state, Math.ceil(cycle / aiEfficiency(state, ctx, 'basic')), ctx)
    advance()
    expect(state.fleet[shipId]!.cargo['wreck-rare-r-inv']).toBe(30)
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(1000)
    advance()
    const gained = state.fleet[shipId]!.cargo['wreck-r-inv']!
    expect(gained).toBeGreaterThan(0)
    expect(weekendWreckDensityOf(state, galaxyId)).toBe(1000 - gained)
  })
})
