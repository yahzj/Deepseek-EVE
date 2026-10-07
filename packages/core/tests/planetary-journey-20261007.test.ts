import { describe, expect, it } from 'vitest'
import { buildSimContext, buildPlanetCatalog, L10N } from '@whale/data'
import {
  createInitialState, advancePlanetary, discoverPlanetHumans, dispatchPlanetDelivery, wakePlanetPopulation,
  startPlanetBuild, startPlanetProject, reconcilePlanetHome, assignPlanetWorker, cancelPlanetJob,
  idleAiShipIds, planetColonyView, PLANET_TEXT_IDS,
  sleepPlanetPopulation, advanceGame,
} from '../src/index'
import { injectPlanetaryRuntimeTestState } from '../../../tools/planetary-runtime-fixture'
const ctx = buildSimContext(), catalog = buildPlanetCatalog()
function setup() {
  const state = createInitialState({ seed: 7, nowWallMs: 0 })
  injectPlanetaryRuntimeTestState(state)
  return state
}
describe('星球完整旅程与公开隔离', () => {
  it('普通环境不准命令、不开实验状态，所有新语义映射到合法编号及双语', () => {
    const state = createInitialState({ seed: 7, nowWallMs: 0 })
    expect(state.planetary).toBeUndefined()
    for (const id of Object.values(PLANET_TEXT_IDS)) {
      expect(id).toMatch(/^ui\.planet\.\d{3}$/)
      expect(L10N[id]?.zh.length).toBeGreaterThan(0)
      expect(L10N[id]?.en.length).toBeGreaterThan(0)
    }
  })
  it('调查找到人类→运输休眠舱→逐批唤醒→改造家园→重做与重复发现拒绝', () => {
    const state = setup()
    const source = Object.values(state.planetary!.planets).find(p => p.traitIds.includes('underground-ruins') || p.traitIds.includes('old-dome'))!
    expect(source).toBeDefined()
    expect(discoverPlanetHumans(state, ctx, catalog, source.id).ok).toBe(true)
    const p = state.planetary!.planets['planet-prototype-medium']!, c = p.colony!
    const ids = Object.keys(state.fleet).filter(id => id.startsWith('sh-manatee'))
    expect(dispatchPlanetDelivery(state, ctx, catalog, p.id, ids[0]!, {}, 0, 4).ok).toBe(true)
    expect(c.sleeping).toBe(0)
    expect(idleAiShipIds(state)).not.toContain(ids[0])
    advancePlanetary(state, 60 * 60000, catalog)
    expect(c.sleeping).toBe(4)
    expect(wakePlanetPopulation(p, catalog, 4).ok).toBe(false)
    expect(wakePlanetPopulation(p, catalog, 1).ok).toBe(true)
    expect(wakePlanetPopulation(p, catalog, 3).ok).toBe(true)
    expect(c.awake).toBe(4)
    const project = [...catalog.projects!.values()].find(project => project.fromTraitId && p.traitIds.includes(project.fromTraitId))!
    expect(startPlanetProject(p, catalog, project.id).ok).toBe(true)
    advancePlanetary(state, project.bill.durationMs, catalog)
    reconcilePlanetHome(state, catalog)
    expect(c.awake).toBe(4)
    expect(planetColonyView(p, catalog).stage).toBe('home')
    expect(state.importantTasks['human-home']!.done).toBe(true)
    expect(discoverPlanetHumans(state, ctx, catalog, source.id).ok).toBe(false)
    expect(startPlanetProject(p, catalog, project.id).ok).toBe(false)
    expect(state.planetary!.humans!.sleeping).toBe(2)
  })
  it('研究已扣账取消只退剩余比例，取消一次以后不能复制', () => {
    const state = setup(), p = state.planetary!.planets['planet-prototype-medium']!, c = p.colony!
    const project = [...catalog.projects!.values()].find(project => project.fromTraitId && p.traitIds.includes(project.fromTraitId))!
    const research = c.supplies.research!
    startPlanetProject(p, catalog, project.id)
    const seq = c.jobs[0]!.seq
    expect(c.supplies.research).toBe(research - project.requiredResearch)
    advancePlanetary(state, 60000, catalog)
    expect(cancelPlanetJob(p, seq).ok).toBe(true)
    expect(c.supplies.research).toBeLessThan(research)
    const end = c.supplies.research
    expect(cancelPlanetJob(p, seq).ok).toBe(false)
    expect(c.supplies.research).toBe(end)
  })
  it('新岗位用人，材料不足不能凭空工业产出，局部布局可以扩建电力', () => {
    const state = setup(), p = state.planetary!.planets['planet-prototype-large']!, c = p.colony!
    const empty = p.cells.filter(cell => !cell.obstacle && !cell.building)
    expect(startPlanetBuild(p, catalog, empty[0]!.index, 'power').ok).toBe(true)
    expect(startPlanetBuild(p, catalog, empty[1]!.index, 'industry').ok).toBe(true)
    advancePlanetary(state, 15 * 60000, catalog)
    c.awake = 1; c.sleeping = 0
    expect(assignPlanetWorker(p, catalog, empty[1]!.index, true).ok).toBe(true)
    c.supplies.metal = 0
    const parts = c.supplies.parts!
    advancePlanetary(state, 60000, catalog)
    expect(c.supplies.parts).toBe(parts)
  })
  it('无原始可改善环境的种子982仍能完成有实际成本的生态工程', () => {
    const state = createInitialState({ seed: 982, nowWallMs: 0 })
    injectPlanetaryRuntimeTestState(state)
    const p = state.planetary!.planets['planet-prototype-medium']!
    expect(startPlanetProject(p, catalog, 'ecology-management').ok).toBe(true)
    advancePlanetary(state, 2400000, catalog)
    expect(p.projectHistory).toContain('ecology-management')
    expect(startPlanetProject(p, catalog, 'ecology-management').ok).toBe(false)
  })
  it('部分休眠有足够保障时能解除保护并再次唤醒，不复制人口', () => {
    const state = setup(), p = state.planetary!.planets['planet-prototype-medium']!
    p.colony!.sleeping = 4
    wakePlanetPopulation(p, catalog, 1); wakePlanetPopulation(p, catalog, 3)
    expect(sleepPlanetPopulation(p, catalog, 1).ok).toBe(true)
    advancePlanetary(state, 60000, catalog)
    expect(p.colony!.crisis).toBe('none')
    expect(wakePlanetPopulation(p, catalog, 1).ok).toBe(true)
    expect(p.colony!.awake + p.colony!.sleeping).toBe(4)
  })
  it('家园中途达标会记账，后续停机不让离线长步漏记', () => {
    const state = setup(), p = state.planetary!.planets['planet-prototype-medium']!
    state.planetary!.humans = { sourcePlanetId: p.id, discoveredAtGameMs: 0, sleeping: 0 }
    state.importantTasks['human-home'] = { done: false }
    p.colony!.awake = 4
    startPlanetProject(p, catalog, 'ecology-management')
    advancePlanetary(state, 2390000, catalog)
    p.cells.find(c => c.building?.id === 'housing')!.building!.condition = .0001
    const a = structuredClone(state), b = structuredClone(state)
    advanceGame(a, 60000, ctx)
    for (let i = 0; i < 60; i++) advanceGame(b, 1000, ctx)
    expect(a.importantTasks['human-home']!.done).toBe(true)
    expect(b.importantTasks['human-home']).toEqual(a.importantTasks['human-home'])
    expect(a.commsInstance?.['msg-planet-home']).toEqual(b.commsInstance?.['msg-planet-home'])
  })
})
