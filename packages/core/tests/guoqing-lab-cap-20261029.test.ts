import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, type LabRunState } from '../src/state'
import { advanceLab, labBatchUnitsOf, setLabLoop, startLabRun, stopLabRun } from '../src/lab'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { jumpFuelCapOf } from '../src/jumpFuel'

const ctx = buildSimContext()
const recipe = ctx.labRecipes.get('jump-fuel')!
function ready(stock = 59_400) {
  const state = createInitialState({ nowWallMs: 0, seed: 29 })
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  state.aiCores.basic = 5
  state.skills.trained[ctx.balance.aiCore.skillId] = 5
  state.warehouse.items['jump-fuel'] = stock
  for (const def of ctx.labRecipes.values()) {
    for (const material of def.materials) state.warehouse.items[material.itemId] = material.units * 100
  }
  return state
}
function finish(state: ReturnType<typeof ready>, elapsed = 0) {
  state.gameMs = Math.max(...state.labRuns!.map(run => run.finishAtGameMs)) + elapsed
  advanceLab(state, ctx)
}

describe('C06 实验室并行容量与交付守恒', () => {
  it('实验线随档白名单穷尽，等待标记不会漏存', () => {
    const keys: Record<keyof LabRunState, true> = { active: true, id: true, worker: true, recipeId: true,
      batchUnits: true, cycleMs: true, finishAtGameMs: true, spentMaterials: true, deliveryBlocked: true }
    const s = ready()
    startLabRun(s, ctx, recipe.id, 'basic')
    s.labRuns![0]!.deliveryBlocked = true
    const back = loadSaveFile(serializeSaveFile(s, 0)).state.labRuns![0]!
    for (const key of Object.keys(keys)) expect(Object.hasOwn(back, key)).toBe(true)
  })
  it('同产物并行第二线被拒，材料和核心不再扣除', () => {
    const s = ready()
    expect(startLabRun(s, ctx, recipe.id, 'basic').ok).toBe(true)
    const before = structuredClone(s)
    expect(startLabRun(s, ctx, recipe.id, 'basic')).toMatchObject({ ok: false, errorId: 'core.lab.018' })
    expect(s).toEqual(before)
    finish(s)
    expect(s.warehouse.items['jump-fuel']).toBe(60_000)
  })
  it('取消释放预留，已扣材料与核心原数退回', () => {
    const s = ready()
    const materials = structuredClone(s.warehouse.items)
    startLabRun(s, ctx, recipe.id, 'basic')
    stopLabRun(s, ctx, s.labRuns![0]!.id)
    expect(s.warehouse.items).toEqual(materials)
    expect(s.aiCores.basic).toBe(5)
    expect(startLabRun(s, ctx, recipe.id, 'basic').ok).toBe(true)
  })
  it('主控换线释放旧线的预留，不被自身即将停止的批次拦住', () => {
    const s = ready()
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok).toBe(true)
    const previousId = s.labRuns![0]!.id
    expect(startLabRun(s, ctx, recipe.id, 'pilot').ok).toBe(true)
    expect(s.labRuns).toHaveLength(1)
    expect(s.labRuns![0]!.id).not.toBe(previousId)
    finish(s)
    expect(s.warehouse.items['jump-fuel']).toBe(60_000)
  })
  it('不同配方共用产物、按在产锁定批产预留，技能改变不重估旧批次', () => {
    const s = ready(58_200)
    const other = { ...recipe, id: 'synthetic-fuel', outputUnits: 1200 }
    const local = { ...ctx, labRecipes: new Map(ctx.labRecipes).set(other.id, other) }
    expect(startLabRun(s, local, other.id, 'basic').ok).toBe(true)
    s.skills.trained['fuel-yield-engineering'] = 1
    const next = labBatchUnitsOf(s, recipe)
    s.warehouse.items['jump-fuel'] = jumpFuelCapOf(s) - 1200 - next
    expect(startLabRun(s, local, recipe.id, 'basic').ok).toBe(true)
    expect(startLabRun(s, local, recipe.id, 'basic').ok).toBe(false)
    s.gameMs = Math.max(...s.labRuns!.map(run => run.finishAtGameMs))
    advanceLab(s, local)
    expect(s.warehouse.items['jump-fuel']).toBe(jumpFuelCapOf(s))
  })
  it('循环与离线大步不抢占其他线已预留的最后一批空间', () => {
    const s = ready(58_800)
    setLabLoop(s, recipe.id, true, null)
    expect(startLabRun(s, ctx, recipe.id, 'basic').ok).toBe(true)
    expect(startLabRun(s, ctx, recipe.id, 'basic').ok).toBe(true)
    finish(s, 100_000_000)
    expect(s.warehouse.items['jump-fuel']).toBe(60_000)
    expect(s.labRuns).toHaveLength(0)
    expect(s.aiCores.basic).toBe(5)
  })
  it('外部入库占满时整批等待，重载后释放空间只交付一次', () => {
    const s = ready()
    startLabRun(s, ctx, recipe.id, 'basic')
    const spent = structuredClone(s.labRuns![0]!.spentMaterials)
    s.warehouse.items['jump-fuel'] = 60_000
    finish(s)
    expect(s.warehouse.items['jump-fuel']).toBe(60_000)
    expect(s.labRuns![0]!.spentMaterials).toEqual(spent)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    back.warehouse.items['jump-fuel'] = 59_400
    advanceLab(back, ctx)
    advanceLab(back, ctx)
    expect(back.warehouse.items['jump-fuel']).toBe(60_000)
    expect(back.labRuns).toHaveLength(0)
    expect(back.aiCores.basic).toBe(5)
  })
  it('等待交付的线取消仍按实扣账退料，不生成成品', () => {
    const s = ready()
    const materials = structuredClone(s.warehouse.items)
    startLabRun(s, ctx, recipe.id, 'basic')
    s.warehouse.items['jump-fuel'] = 60_000
    finish(s)
    stopLabRun(s, ctx, s.labRuns![0]!.id)
    expect(s.warehouse.items).toEqual({ ...materials, 'jump-fuel': 60_000 })
    expect(s.aiCores.basic).toBe(5)
  })
  it('仓满等待的时间不追算成后续循环已生产的时间', () => {
    const s = ready()
    setLabLoop(s, recipe.id, true, null)
    startLabRun(s, ctx, recipe.id, 'basic')
    s.warehouse.items['jump-fuel'] = 60_000
    finish(s, 100_000_000)
    s.warehouse.items['jump-fuel'] = 0
    advanceLab(s, ctx)
    expect(s.warehouse.items['jump-fuel']).toBe(600)
    expect(s.labRuns![0]!.finishAtGameMs).toBe(s.gameMs + s.labRuns![0]!.cycleMs)
    expect(s.labRuns![0]!.deliveryBlocked).toBeUndefined()
  })
})
