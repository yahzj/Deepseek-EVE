import { describe, expect, it } from 'vitest'
import { buildSimContext } from '../../packages/data/src/context'
import { createInitialState } from '../../packages/core/src/state'
import { startRefineRun } from '../../packages/core/src/industry/refining/start'
import { advanceRefining } from '../../packages/core/src/industry/refining/advance'
import { refineBatchOutputOf } from '../../packages/core/src/industry/refining/params'
import { REFINING_ITEMS, refiningOutput, refiningRecipe } from './refining-baseline'

const context = buildSimContext()
describe('玩家站预览精炼：真实主控基准适配', () => {
  it.each([0, 1, 2, 3, 4, 5])('技能统一等级%i逐配方与现有起炉/产出一致，不复写公式', level => {
    expect(REFINING_ITEMS.length).toBeGreaterThan(0)
    for (const item of REFINING_ITEMS) {
      const state = createInitialState({ nowWallMs: 0, seed: 1 })
      for (const skill of context.skills.values()) state.skills.trained[skill.id] = level
      state.warehouse.items[item.id] = 1_000_000
      expect(startRefineRun(state, item.id, 'pilot', context).ok).toBe(true)
      const run = state.refineRuns.find(entry => entry.active)!
      expect(refiningRecipe(item.id, level)).toEqual({ batchUnits: run.batchUnits, cycleMs: run.cycleMs })
      const output = Object.fromEntries(refineBatchOutputOf(state, context, item, run.batchUnits).map(row => [row.mineralId, row.units]))
      expect(refiningOutput(item.id, run.batchUnits, level)).toEqual(output)
      const before = { ...state.warehouse.items }
      state.gameMs = run.finishAtGameMs
      advanceRefining(state, context)
      expect(state.warehouse.items[item.id]).toBe(before[item.id] - run.batchUnits)
      for (const [id, n] of Object.entries(output)) expect(state.warehouse.items[id]).toBe((before[id] ?? 0) + n)
    }
  })
  it('无精炼配方不返回参数，缓存结果不暴露可写引用', () => {
    expect(refiningRecipe('part-frame', 0)).toBeUndefined()
    const before = refiningRecipe('ore-veldspar', 0)!
    const copy = refiningRecipe('ore-veldspar', 0)!
    copy.batchUnits = 1
    expect(refiningRecipe('ore-veldspar', 0)).toEqual(before)
  })
})
