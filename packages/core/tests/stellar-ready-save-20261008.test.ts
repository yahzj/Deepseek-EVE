import { describe, expect, it } from 'vitest'
import { buildPlanetCatalog, buildSimContext } from '@whale/data'
import { createInitialState, loadSaveFile, serializeSaveFile, stellarCapacity, stellarCandidateCount, stellarSystemDeveloped,
  beginStellarSearch, advanceGame, startManufacturing, dispatchPlanetDelivery, advancePlanetary, wakePlanetPopulation,
  planetColonyView, surveyPlanet, startPlanetBuild, planetBillOf } from '../src/index'
import { injectStellarReadyTestState } from '../../../tools/stellar-search-fixture'

const catalog = buildPlanetCatalog(), ctx = buildSimContext()
function ready() {
  const state = createInitialState({ seed: 7, nowWallMs: 0 })
  injectStellarReadyTestState(state)
  return loadSaveFile(serializeSaveFile(state, 0)).state
}
describe('新星系即用合成档', () => {
  it('六种世界、耗材和技能往返不丢，原流程无在途任务', () => {
    const state = ready(), systems = Object.values(state.planetary!.stellar!.systems)
    expect(new Set(systems.map(s => s.kind)).size).toBe(6)
    expect(Object.keys(state.planetary!.planets)).toHaveLength(18)
    expect(state.warehouse.items['deep-space-probe']).toBe(30)
    expect(state.debugQuick).toBe(true); expect(stellarCapacity(state)).toBe(15)
    expect(stellarCandidateCount(state)).toBe(5); expect(stellarSystemDeveloped(state, 'system-v1-0')).toBe(true)
    expect(state.planetary!.stellar!.search).toBeUndefined(); expect(state.planetary!.stellar!.autoSearch).toBe(false)
    expect(state.manufacturingRuns).toHaveLength(0); expect(state.planetary!.deliveries ?? []).toHaveLength(0)
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.planetary).toEqual(state.planetary)
  })
  it('搜索和制造可立刻运行，真实扣耗材并交付', () => {
    const state = ready()
    expect(beginStellarSearch(state, 'specified', '7').ok).toBe(true)
    expect(startManufacturing(state, 'bp-deep-space-probe', 'pilot', ctx).ok).toBe(true)
    advanceGame(state, 1000, ctx, { offline: true })
    expect(state.planetary!.stellar!.systems['system-v1-7']).toBeDefined()
    expect(state.warehouse.items['deep-space-probe']).toBe(30)
  })
  it('六名休眠人类可真实运输和唤醒，船与保障容量足够', () => {
    const state = ready(), p = state.planetary!.planets['system-v1-0-p2']!
    expect(state.planetary!.humans!.sleeping).toBe(6); expect(p.colony!.awake).toBe(0)
    const uid = Object.keys(state.fleet).find(id => state.fleet[id]!.defId === 'sh-manatee')!
    expect(dispatchPlanetDelivery(state, ctx, catalog, p.id, uid, {}, 0, 4).ok).toBe(true)
    advancePlanetary(state, state.planetary!.deliveries![0]!.durationMs + 10000, catalog)
    expect(wakePlanetPopulation(p, catalog, 1).ok).toBe(true)
    expect(wakePlanetPopulation(p, catalog, 3).ok).toBe(true)
    expect(p.colony!.awake).toBe(4); expect(p.colony!.crisis).toBe('none')
    expect(planetColonyView(p, catalog).housing).toBeGreaterThanOrEqual(4)
  })
  it('备料空地可建设，气态勘探可执行但仍禁止建造', () => {
    const state = ready(), p = state.planetary!.planets['system-v1-0-p1']!
    const index = p.cells.find(c => !c.obstacle && !c.building)!.index
    const cost = planetBillOf(p, catalog, catalog.operations!.get('base')!.bill)
    const before = p.colony!.credits
    expect(startPlanetBuild(p, catalog, index, 'base').ok).toBe(true)
    expect(p.colony!.credits).toBe(before - cost.credits)
    const gas = Object.values(state.planetary!.planets).find(p => p.surfaceAllowed === false)!
    expect(surveyPlanet(state, catalog, gas.id, 3).ok).toBe(true)
    expect(startPlanetBuild(gas, catalog, 0, 'base').ok).toBe(false)
  })
})
