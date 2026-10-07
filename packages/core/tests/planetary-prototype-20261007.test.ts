import { describe, expect, it } from 'vitest'
import { buildPlanetCatalog, buildSimContext, PLANET_DEFS } from '@whale/data'
import {
  createInitialState, generatePlanet, discoverPlanet, surveyPlanet, planetSurveyView,
  planetEnvironmentFactors, planetEnvironmentOf, planetNeighborIndices, planetConstructionCheck,
  planetClearanceCheck, planetAdjacencyOf, planetBuildingOutputMul, planetTraitsCompatible,
  PLANET_RULES, CURRENT_STATE_VERSION, planetCatalogIssues,
  advanceGame,
} from '../src/index'
import type { PlanetCatalog, PlanetState } from '../src/planetTypes'
import { cleanPlanetaryState } from '../src/planetSave'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const catalog = buildPlanetCatalog()
const initial = () => createInitialState({ seed: 7, nowWallMs: 0 })
const gen = (seed = 7, size: 4 | 5 | 6 = 4) => generatePlanet({ id: `planet-test-${size}`, galaxyId: 'galaxy-hub', size }, seed, catalog)
function layout(): PlanetState {
  const planet = gen()
  planet.survey = 3
  planet.traitIds = ['temperate']
  planet.hiddenTraitId = 'temperate'
  planet.cells = Array.from({ length: 16 }, (_, index) => ({ index }))
  return planet
}
function put(planet: PlanetState, index: number, id: string, changes: Partial<NonNullable<PlanetState['cells'][number]['building']>> = {}): void {
  planet.cells[index]!.building = { id, status: 'ready', powered: true, staffed: true, ...changes }
}

describe('星球目录与确定性生成', () => {
  it('目录编号、参数与引用合法', () => {
    expect(planetCatalogIssues(catalog)).toEqual([])
    expect([...new Set(PLANET_DEFS.map(p => p.size))]).toEqual([4, 5, 6])
  })
  it.each([4, 5, 6] as const)('%i格边长：形状、障碍占比、资源来源和互斥跨种子成立', size => {
    for (let seed = 0; seed < 180; seed++) {
      const p = gen(seed, size)
      expect(p.cells).toHaveLength(size * size)
      expect(p.cells.map(c => c.index)).toEqual(Array.from({ length: size * size }, (_, i) => i))
      const obstacles = p.cells.filter(c => c.obstacle).length
      expect(obstacles).toBeGreaterThanOrEqual(Math.ceil(size * size * PLANET_RULES.obstacleMinShare))
      expect(obstacles).toBeLessThanOrEqual(Math.floor(size * size * PLANET_RULES.obstacleMaxShare))
      expect(size * size - obstacles).toBeGreaterThanOrEqual(PLANET_RULES.minFreeCells)
      const selected = p.traitIds.map(id => catalog.traits.get(id)!)
      expect(p.traitIds).toContain(p.hiddenTraitId)
      for (const t of selected) expect(planetTraitsCompatible(t, selected.filter(o => o.id !== t.id))).toBe(true)
      for (const [kind, min, max] of [['environment', 2, 4], ['resource', 1, 3], ['special', 0, 2]] as const) {
        const count = selected.filter(t => t.kind === kind).length
        expect(count).toBeGreaterThanOrEqual(min)
        expect(count).toBeLessThanOrEqual(max)
      }
      for (const t of selected.filter(t => t.deposit)) {
        const cells = p.cells.filter(c => c.deposit?.sourceTraitId === t.id)
        expect(cells.length).toBeGreaterThanOrEqual(t.deposit!.minCells)
        expect(cells.length).toBeLessThanOrEqual(t.deposit!.maxCells)
        expect(cells.every(c => c.deposit!.resource === t.deposit!.resource)).toBe(true)
      }
      for (const cell of p.cells.filter(c => c.deposit)) expect(p.traitIds).toContain(cell.deposit!.sourceTraitId)
    }
  })
  it('同种子相同、不同种子变化、目录插入顺序不影响结果', () => {
    expect(gen()).toEqual(gen())
    expect(new Set(Array.from({ length: 30 }, (_, seed) => JSON.stringify(gen(seed)))).size).toBe(30)
    const reversed = { ...catalog, traits: new Map([...catalog.traits].reverse()) }
    expect(generatePlanet(PLANET_DEFS[0]!, 7, reversed)).toEqual(generatePlanet(PLANET_DEFS[0]!, 7, catalog))
  })
  it('互斥组与双向冲突都禁止，缺失内容与非法数字不静默生成', () => {
    const a = catalog.traits.get('cold')!
    expect(planetTraitsCompatible(a, [catalog.traits.get('hot')!])).toBe(false)
    expect(planetTraitsCompatible(a, [{ ...a, id: 'other', conflicts: ['cold'] }])).toBe(false)
    const invalid = { ...catalog, traits: new Map(catalog.traits).set('cold', { ...a, weight: NaN }) }
    expect(() => generatePlanet(PLANET_DEFS[0]!, 7, invalid)).toThrow('invalid-planet-catalog')
    expect(() => generatePlanet(PLANET_DEFS[0]!, 7, { ...catalog, traits: new Map(), projects: undefined })).toThrow('insufficient-planet-traits')
    expect(() => gen(NaN)).toThrow('invalid-planet-definition')
    expect(() => generatePlanet({ ...PLANET_DEFS[0]!, id: 'constructor' }, 7, catalog)).toThrow('invalid-planet-definition')
  })
})

describe('星球发现与勘探隔离', () => {
  it('新旧档无默认星球，未知编号与未探索星系不写状态', () => {
    const state = initial()
    expect(state.planetary).toBeUndefined()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.planetary).toBeUndefined()
    const before = structuredClone(state)
    expect(discoverPlanet(state, catalog, 'missing')).toEqual({ ok: false, reason: 'unknown-planet' })
    expect(discoverPlanet(state, catalog, PLANET_DEFS[1]!.id)).toEqual({ ok: false, reason: 'unknown-galaxy' })
    expect(state).toEqual(before)
  })
  it('显式发现幂等，勘探升级只揭示，全球随机/仓库/钱包/任务不动', () => {
    const state = initial()
    const before = structuredClone(state)
    const id = PLANET_DEFS[0]!.id
    expect(discoverPlanet(state, catalog, id)).toEqual({ ok: true })
    const generated = structuredClone(state.planetary!.planets[id]!)
    expect(surveyPlanet(state, catalog, id, 2)).toEqual({ ok: true })
    expect(surveyPlanet(state, catalog, id, 1)).toEqual({ ok: true })
    expect(discoverPlanet(state, catalog, id)).toEqual({ ok: true })
    expect(state.planetary!.planets[id]).toEqual({ ...generated, survey: 2 })
    expect(surveyPlanet(state, catalog, id, 3)).toEqual({ ok: true })
    const { planetary, ...rest } = state
    expect(planetary).toBeDefined()
    expect(rest).toEqual(before)
  })
  it('初探不暴露地图或隐藏编号，范围包含真实环境；详探环境准确', () => {
    for (let seed = 0; seed < 180; seed++) {
      const p = gen(seed)
      const before = structuredClone(p)
      const view = planetSurveyView(p, catalog)!
      expect(view.cells).toBeUndefined()
      expect(view.traitIds).not.toContain(p.hiddenTraitId)
      const actual = planetEnvironmentOf(p, catalog)!
      expect(actual.hazard).toBeGreaterThanOrEqual(view.hazard.min)
      expect(actual.hazard).toBeLessThanOrEqual(view.hazard.max)
      expect(actual.habitability).toBeGreaterThanOrEqual(view.habitability.min)
      expect(actual.habitability).toBeLessThanOrEqual(view.habitability.max)
      expect(p).toEqual(before)
      p.survey = 2
      const detail = planetSurveyView(p, catalog)!
      expect(detail.hazard).toEqual({ min: actual.hazard, max: actual.hazard })
      expect(detail.habitability).toEqual({ min: actual.habitability, max: actual.habitability })
      expect(detail.cells).toEqual(p.cells)
      for (const trait of p.traitIds.map(id => catalog.traits.get(id)!)) if (trait.hazard || trait.habitability || trait.deposit) expect(detail.traitIds).toContain(trait.id)
      detail.cells![0]!.obstacle = p.cells[0]!.obstacle === 'rubble' ? 'ice' : 'rubble'
      expect(detail.cells).not.toEqual(p.cells)
    }
  })
  it('估计范围不读取未揭示特性的实际数值', () => {
    const p = layout()
    p.survey = 1
    p.traitIds = ['cold', 'radiation', 'old-dome']
    p.hiddenTraitId = 'cold'
    const a = planetSurveyView(p, catalog)!
    p.traitIds[0] = 'hot'
    p.hiddenTraitId = 'hot'
    expect(planetSurveyView(p, catalog)).toEqual(a)
  })
  it('非生存特殊特性保留到专项；依赖它的建设检查不泄露隐藏内容', () => {
    const p = layout()
    p.traitIds.push('old-dome')
    p.hiddenTraitId = 'old-dome'
    p.survey = 2
    const c = { ...catalog, buildings: new Map(catalog.buildings).set('dome-research', { id: 'dome-research', kind: 'research' as const, worker: 'human' as const, requiredTraitId: 'old-dome' }) }
    expect(planetSurveyView(p, c)!.traitIds).not.toContain('old-dome')
    expect(planetConstructionCheck(p, 0, 'dome-research', c)).toEqual({ ok: false, reason: 'trait-required' })
    p.survey = 3
    expect(planetConstructionCheck(p, 0, 'dome-research', c)).toEqual({ ok: true })
  })
  it('非法勘探、未知规则和满额发现不会改变状态', () => {
    const state = initial()
    expect(surveyPlanet(state, catalog, 'missing', 2)).toEqual({ ok: false, reason: 'not-discovered' })
    expect(surveyPlanet(state, catalog, 'missing', 9 as 1)).toEqual({ ok: false, reason: 'invalid-survey' })
    discoverPlanet(state, catalog, PLANET_DEFS[0]!.id)
    const p = state.planetary!.planets[PLANET_DEFS[0]!.id]!
    p.generationVersion = 2
    const before = structuredClone(state)
    expect(surveyPlanet(state, catalog, p.id, 3)).toEqual({ ok: false, reason: 'unsupported' })
    expect(state).toEqual(before)
    expect(planetSurveyView(p, catalog)).toBeUndefined()
    state.planetary!.planets = Object.fromEntries(Array.from({ length: PLANET_RULES.maxPlanets }, (_, i) => [`planet-${i}`, { ...p, id: `planet-${i}` }]))
    const full = structuredClone(state)
    expect(discoverPlanet(state, catalog, PLANET_DEFS[0]!.id)).toEqual({ ok: false, reason: 'limit' })
    expect(state).toEqual(full)
  })
  it('目录层的特殊互斥和非法地块在运行时拒绝，不当作可建设状态', () => {
    const p = layout()
    p.traitIds = ['hot', 'cold']
    p.hiddenTraitId = 'hot'
    expect(planetConstructionCheck(p, 0, 'base', catalog)).toEqual({ ok: false, reason: 'unsupported' })
    p.traitIds = ['hot']
    p.cells[0]!.index = 1
    expect(planetSurveyView(p, catalog)).toBeUndefined()
  })
})

describe('环境与地块建设校验', () => {
  it.each([[20, 60, 1.2, 1.16, 1.24, 1.4, 0.76], [100, 100, 2, 1.8, 2.2, 1, 1], [0, 0, 1, 1, 1, 2, 0.4]])('环境参数：危险%i、宜居%i', (d, h, wear, construction, repair, consume, work) => {
    const e = planetEnvironmentFactors(d, h)
    expect(e.wearMul).toBeCloseTo(wear)
    expect(e.constructionMul).toBeCloseTo(construction)
    expect(e.repairMul).toBeCloseTo(repair)
    expect(e.consumptionMul).toBeCloseTo(consume)
    expect(e.humanWorkMul).toBeCloseTo(work)
  })
  it('环境截断去重，未知特性不会算出假正常值', () => {
    expect(planetEnvironmentFactors(-20, 150)).toEqual(planetEnvironmentFactors(0, 100))
    expect(planetEnvironmentFactors(NaN, Infinity)).toEqual(planetEnvironmentFactors(0, 0))
    expect(planetEnvironmentOf({ traitIds: ['temperate', 'temperate'] }, catalog)).toEqual(planetEnvironmentFactors(20, 80))
    expect(planetEnvironmentOf({ traitIds: ['missing'] }, catalog)).toBeUndefined()
  })
  it('障碍、占地、唯一、矿场资源和勘探前置均校验，成功也不写状态', () => {
    const p = layout()
    p.survey = 1
    expect(planetConstructionCheck(p, 0, 'base', catalog)).toEqual({ ok: false, reason: 'survey-required' })
    p.survey = 2
    p.cells[0]!.obstacle = 'ice'
    p.traitIds.push('metal-veins')
    p.cells[0]!.deposit = { resource: 'metal', sourceTraitId: 'metal-veins', bonus: 0.2 }
    expect(planetClearanceCheck(p, 0, catalog).ok).toBe(true)
    expect(planetConstructionCheck(p, 0, 'mine', catalog)).toEqual({ ok: false, reason: 'obstacle' })
    const deposit = structuredClone(p.cells[0]!.deposit)
    delete p.cells[0]!.obstacle
    expect(p.cells[0]!.deposit).toEqual(deposit)
    expect(planetConstructionCheck(p, 0, 'mine', catalog)).toEqual({ ok: true })
    expect(planetConstructionCheck(p, 1, 'mine', catalog)).toEqual({ ok: false, reason: 'resource-required' })
    put(p, 0, 'base', { status: 'construction' })
    expect(planetConstructionCheck(p, 0, 'power', catalog)).toEqual({ ok: false, reason: 'occupied' })
    expect(planetConstructionCheck(p, 1, 'base', catalog)).toEqual({ ok: false, reason: 'unique' })
    for (const index of [-1, 16, 0.5, NaN]) expect(planetConstructionCheck(p, index, 'base', catalog)).toEqual({ ok: false, reason: 'invalid-cell' })
    expect(planetConstructionCheck(p, 1, 'missing', catalog)).toEqual({ ok: false, reason: 'unknown-building' })
    const before = structuredClone(p)
    expect(planetConstructionCheck(p, 1, 'farm', catalog)).toEqual({ ok: true })
    expect(p).toEqual(before)
  })
  it.each([4, 5, 6])('四向不跨行首尾、不算对角线：%i', size => {
    expect(planetNeighborIndices(size, 0)).toEqual([1, size])
    expect(planetNeighborIndices(size, size - 1)).toEqual([size - 2, 2 * size - 1])
    expect(planetNeighborIndices(size, size)).not.toContain(size - 1)
    expect(planetNeighborIndices(size, size + 1)).toHaveLength(4)
    expect(planetNeighborIndices(size, -1)).toEqual([])
  })
})

describe('相邻与能力倍率', () => {
  it('同一来源只算一次，四向加算封顶且无链式加成', () => {
    const p = layout()
    put(p, 5, 'farm')
    for (const i of [1, 4, 6, 9]) put(p, i, 'water')
    put(p, 0, 'base')
    const adjacency = planetAdjacencyOf(p, 5, catalog)
    expect(adjacency.outputAdd).toBeCloseTo(0.6)
    expect(adjacency.sourceIndices).toEqual([1, 4, 6, 9])
    const boosted = { ...catalog, buildings: new Map(catalog.buildings).set('water', { ...catalog.buildings.get('water')!, adjacency: [{ target: 'farm' as const, outputAdd: .4 }, { target: 'farm' as const, outputAdd: .4 }] }) }
    expect(planetAdjacencyOf(p, 5, boosted).outputAdd).toBe(.6)
    delete p.cells[6]!.building
    delete p.cells[9]!.building
    expect(planetAdjacencyOf(p, 5, catalog).outputAdd).toBeCloseTo(.3)
    p.cells[0]!.building!.powered = false
    expect(planetAdjacencyOf(p, 5, catalog).outputAdd).toBeCloseTo(.3)
  })
  it.each([{ powered: false }, { status: 'construction' as const }, { status: 'stopped' as const }])('停止支援来源无效：%o', status => {
    const p = layout()
    put(p, 5, 'farm')
    put(p, 4, 'water', status)
    expect(planetAdjacencyOf(p, 5, catalog).outputAdd).toBe(0)
  })
  it('无人岗位无产出及支援，自动机械忽略宜居效率', () => {
    const p = layout()
    put(p, 5, 'farm', { staffed: false })
    put(p, 4, 'water')
    expect(planetBuildingOutputMul(p, 5, catalog)).toBe(0)
    expect(planetAdjacencyOf(p, 5, catalog).outputAdd).toBe(0)
    expect(planetBuildingOutputMul(p, 4, catalog)).toBe(1)
    const c: PlanetCatalog = { ...catalog, buildings: new Map(catalog.buildings).set('water', { ...catalog.buildings.get('water')!, worker: 'human' }) }
    p.cells[5]!.building!.staffed = true
    p.cells[4]!.building!.staffed = false
    expect(planetAdjacencyOf(p, 5, c).outputAdd).toBe(0)
  })
  it('地块和相邻加算，工作效率单独乘算，文档示例同源', () => {
    const p = layout()
    put(p, 5, 'farm')
    put(p, 4, 'water')
    put(p, 6, 'base')
    p.traitIds.push('fertile-soil', 'metal-veins')
    p.cells[5]!.deposit = { resource: 'food', sourceTraitId: 'fertile-soil', bonus: .2 }
    expect(10 * planetBuildingOutputMul(p, 5, catalog)).toBeCloseTo(12.76)
    p.cells[5]!.deposit = { resource: 'metal', sourceTraitId: 'metal-veins', bonus: .2 }
    expect(planetBuildingOutputMul(p, 5, catalog)).toBeCloseTo(1.25 * .88)
  })
  it('维护同类取最强、单独计减损，不支持另一维护站', () => {
    const p = layout()
    put(p, 5, 'power')
    put(p, 1, 'maintenance')
    put(p, 4, 'maintenance')
    expect(planetAdjacencyOf(p, 5, catalog)).toMatchObject({ outputAdd: 0, wearCut: .15 })
    put(p, 5, 'maintenance')
    expect(planetAdjacencyOf(p, 5, catalog).wearCut).toBe(0)
  })
  it('没有来源特性或类型不符的资源格不可产出或建设', () => {
    const p = layout()
    put(p, 5, 'farm')
    p.cells[5]!.deposit = { resource: 'food', sourceTraitId: 'fertile-soil', bonus: .2 }
    expect(planetBuildingOutputMul(p, 5, catalog)).toBe(0)
    expect(planetConstructionCheck(p, 0, 'base', catalog)).toEqual({ ok: false, reason: 'unsupported' })
    p.traitIds.push('fertile-soil')
    expect(planetBuildingOutputMul(p, 5, catalog)).toBeGreaterThan(0)
    p.cells[5]!.deposit!.resource = 'rare'
    expect(planetBuildingOutputMul(p, 5, catalog)).toBe(0)
  })
})

describe('星球可选存档', () => {
  it('正常引擎推进不创建或运转星球，现有活动、经济、剧情和随机序列保持一致', () => {
    const a = initial()
    const b = initial()
    discoverPlanet(b, catalog, PLANET_DEFS[0]!.id)
    const snapshot = structuredClone(b.planetary)
    const ctx = buildSimContext()
    expect(ctx).not.toHaveProperty('planets')
    advanceGame(a, 60_000, ctx)
    advanceGame(b, 60_000, ctx)
    expect(a.planetary).toBeUndefined()
    expect(b.planetary).toEqual(snapshot)
    const { planetary, ...rest } = b
    expect(planetary).toBeDefined()
    expect(rest).toEqual(a)
  })
  it('三颗不同大小和勘探层级往返完全保留，建筑停电、停工与无人标记保留', () => {
    const state = initial()
    state.exploredGalaxies = PLANET_DEFS.map(p => p.galaxyId)
    PLANET_DEFS.forEach((def, i) => {
      discoverPlanet(state, catalog, def.id)
      surveyPlanet(state, catalog, def.id, (i + 1) as 1 | 2 | 3)
      const p = state.planetary!.planets[def.id]!
      const index = p.cells.findIndex(c => !c.obstacle)
      put(p, index, 'base', { powered: false, staffed: false, status: 'stopped' })
    })
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.version).toBe(CURRENT_STATE_VERSION)
    expect(back.planetary).toEqual(state.planetary)
    expect(loadSaveFile(serializeSaveFile(back, 0)).state.planetary).toEqual(state.planetary)
  })
  it('未来生成版本与未知编号保留，但禁止解释为当前地图', () => {
    const p = gen()
    p.generationVersion = 99
    p.traitIds.push('future-trait')
    const raw = { planets: { [p.id]: p } }
    const back = cleanPlanetaryState(raw)!
    expect(back).toEqual(raw)
    expect(planetConstructionCheck(back.planets[p.id]!, 0, 'base', catalog)).toEqual({ ok: false, reason: 'unsupported' })
  })
  it.each(['cells', 'seed', 'hiddenTraitId', 'generationVersion'])('结构损坏的%s不重生成或补出空地', key => {
    const p = gen()
    const raw = { ...p, [key]: key === 'seed' ? -1 : null }
    expect(cleanPlanetaryState({ planets: { [p.id]: raw } })).toBeUndefined()
  })
  it('畸形地块、原型污染与未识别额外字段不会写回', () => {
    const p = gen()
    const raw = { planets: { [p.id]: { ...p, freeMoney: 1000 } } }
    expect(cleanPlanetaryState(raw)!.planets[p.id]).not.toHaveProperty('freeMoney')
    p.cells[0]!.index = 1
    expect(cleanPlanetaryState({ planets: { [p.id]: p } })).toBeUndefined()
    expect(cleanPlanetaryState(JSON.parse('{"planets":{"__proto__":{"id":"__proto__"}}}'))).toBeUndefined()
    expect(cleanPlanetaryState({ planets: [] })).toBeUndefined()
  })
  it('未知建筑保留，运行规则拒绝，空星球字段不强插入老档', () => {
    const p = gen()
    const i = p.cells.findIndex(c => !c.obstacle)
    put(p, i, 'future-building')
    const back = cleanPlanetaryState({ planets: { [p.id]: p } })!
    expect(back.planets[p.id]).toEqual(p)
    expect(planetSurveyView(back.planets[p.id]!, catalog)).toBeUndefined()
    expect(cleanPlanetaryState(undefined)).toBeUndefined()
    expect(cleanPlanetaryState({ planets: {} })).toBeUndefined()
  })
})
