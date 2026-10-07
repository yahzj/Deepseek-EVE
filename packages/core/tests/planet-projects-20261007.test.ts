import { describe, expect, it, vi } from 'vitest'
import type { PlanetCatalog, PlanetEvent, PlanetProjectDef, PlanetState, PlanetTraitDef } from '../src/planetTypes'
import { advancePlanetEvents, completePlanetProject, planetProjectCheck, resolvePlanetEvent } from '../src/planetProjects'
import { planetEnvironmentOf, planetRulesSupported } from '../src/planetRules'
import { hashSeed, nextInt } from '../src/rng'
import { createInitialState } from '../src/state'
import { advancePlanetConstruction, startPlanetProject } from '../src/planetConstruction'

const HOUR_MS = 60 * 60 * 1000
const traits: PlanetTraitDef[] = [
  { id: 'corrosive', kind: 'environment', weight: 1, exclusiveGroup: 'atmosphere', hazard: 20, habitability: -15 },
  { id: 'controlled-corrosion', kind: 'environment', weight: 0, exclusiveGroup: 'atmosphere', hazard: 5, habitability: -5 },
  { id: 'breathable', kind: 'environment', weight: 1, exclusiveGroup: 'atmosphere' },
  { id: 'radiation', kind: 'environment', weight: 1, hazard: 15, habitability: -20 },
  { id: 'shielded-radiation', kind: 'environment', weight: 0, hazard: 5, habitability: -5 },
  { id: 'cold', kind: 'environment', weight: 1, exclusiveGroup: 'temperature' },
  { id: 'hot', kind: 'environment', weight: 1, exclusiveGroup: 'temperature' },
  { id: 'moderated-cold', kind: 'environment', weight: 0, exclusiveGroup: 'temperature' },
  { id: 'moderated-hot', kind: 'environment', weight: 0, exclusiveGroup: 'temperature' },
  { id: 'metal-veins', kind: 'resource', weight: 1, deposit: { resource: 'metal', minCells: 1, maxCells: 2, bonus: .2 } },
  { id: 'rare-crystals', kind: 'resource', weight: 1, deposit: { resource: 'rare', minCells: 1, maxCells: 2, bonus: .1 } },
  { id: 'ruins', kind: 'special', weight: 1, deposit: { resource: 'research', minCells: 1, maxCells: 2, bonus: .2 } },
  { id: 'old-dome', kind: 'special', weight: 1 },
  { id: 'restored-dome', kind: 'special', weight: 0, habitability: 10 },
]
function project(id: string, changes: Partial<PlanetProjectDef>): PlanetProjectDef {
  return { id, requiredResearch: 20, bill: { items: { plate: 10 }, credits: 50, durationMs: HOUR_MS }, ...changes }
}
function makeCatalog(extraProjects: PlanetProjectDef[] = []): PlanetCatalog {
  const projects = [
    project('detox-corrosive', { fromTraitId: 'corrosive', toTraitId: 'controlled-corrosion' }),
    project('screen-radiation', { fromTraitId: 'radiation', toTraitId: 'shielded-radiation' }),
    project('climate-cold', { fromTraitId: 'cold', toTraitId: 'moderated-cold' }),
    project('climate-hot', { fromTraitId: 'hot', toTraitId: 'moderated-hot' }),
    project('repair-dome', { fromTraitId: 'old-dome', toTraitId: 'restored-dome' }),
    ...extraProjects,
  ]
  return {
    planets: new Map(), traits: new Map(traits.map(trait => [trait.id, trait])),
    buildings: new Map([['power', { id: 'power', kind: 'power', worker: 'automatic' }]]),
    projects: new Map(projects.map(def => [def.id, def])),
  }
}
const catalog = makeCatalog()
function makePlanet(traitIds = ['corrosive', 'metal-veins', 'rare-crystals', 'ruins', 'old-dome']): PlanetState {
  const planet: PlanetState = {
    id: 'planet-project-test', galaxyId: 'galaxy-hub', size: 4, generationVersion: 1, seed: 7,
    traitIds: [...traitIds], hiddenTraitId: traitIds[0]!, survey: 3,
    cells: Array.from({ length: 16 }, (_, index) => ({ index })),
    colony: {
      runtimeVersion: 1, items: { plate: 100 }, credits: 500,
      supplies: { research: 30, parts: 20, food: 100, water: 100, rare: 3 },
      awake: 2, sleeping: 5, jobs: [], jobSeq: 0,
      clockMs: 0, tickRemainderMs: 0, crisis: 'none', eventSeq: 0, nextEventMs: 0, eventRngCount: 0,
    },
  }
  for (const [index, id] of ['metal-veins', 'rare-crystals', 'ruins'].entries()) {
    if (traitIds.includes(id)) {
      const deposit = catalog.traits.get(id)!.deposit!
      planet.cells[index]!.deposit = { resource: deposit.resource, sourceTraitId: id, bonus: deposit.bonus }
    }
  }
  planet.cells[0]!.obstacle = 'rubble'
  planet.cells[4]!.building = { id: 'power', status: 'ready', powered: true, staffed: false, condition: .75 }
  return planet
}
function pending(kind: PlanetEvent['kind']): PlanetState {
  const planet = makePlanet()
  Object.assign(planet.colony!, {
    clockMs: 6 * HOUR_MS, nextEventMs: 11 * HOUR_MS,
    eventSeq: 1, event: { seq: 1, kind, atMs: 6 * HOUR_MS, cellIndex: 4 },
  })
  return planet
}
function step(planet: PlanetState, deltaMs: number): void {
  planet.colony!.clockMs += deltaMs
  advancePlanetEvents(planet, catalog, deltaMs)
}

describe('星球改造校验与完成', () => {
  it('校验只读，不代施工扣建材、信用点或研究', () => {
    const planet = makePlanet()
    const before = structuredClone(planet)
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: true })
    expect(planet).toEqual(before)
    expect(completePlanetProject(planet, 'detox-corrosive', catalog)).toEqual({ ok: true })
    expect(planet.colony).toEqual(before.colony)
  })
  it.each([
    ['detox-corrosive', 'corrosive', 'controlled-corrosion'],
    ['screen-radiation', 'radiation', 'shielded-radiation'],
    ['climate-cold', 'cold', 'moderated-cold'],
    ['climate-hot', 'hot', 'moderated-hot'],
    ['repair-dome', 'old-dome', 'restored-dome'],
  ])('%s替换特性，保留原始记录和全部地块', (id, from, to) => {
    const planet = makePlanet([from, 'metal-veins', 'rare-crystals'])
    const before = structuredClone(planet)
    const cells = planet.cells
    expect(completePlanetProject(planet, id, catalog)).toEqual({ ok: true })
    expect(planet.traitIds).toEqual([to, 'metal-veins', 'rare-crystals'])
    expect(planet.originalTraitIds).toEqual(before.traitIds)
    expect(planet.projectHistory).toEqual([id])
    expect(planet.hiddenTraitId).toBe(to)
    expect(planet.cells).toBe(cells)
    expect(planet.cells).toEqual(before.cells)
    expect(planetRulesSupported(planet, catalog)).toBe(true)
  })
  it('环境从当前特性派生，不额外叠加永久数值', () => {
    const planet = makePlanet()
    const before = planetEnvironmentOf(planet, catalog)!
    completePlanetProject(planet, 'detox-corrosive', catalog)
    const after = planetEnvironmentOf(planet, catalog)!
    expect(after.hazard).toBe(before.hazard - 15)
    expect(after.habitability).toBe(before.habitability + 10)
    expect(planet).not.toHaveProperty('hazard')
    expect(planet).not.toHaveProperty('habitability')
  })
  it('重复完成被拒绝，已有原始记录和其他工程历史不被覆盖', () => {
    const planet = makePlanet()
    planet.originalTraitIds = ['radiation', 'metal-veins']
    planet.projectHistory = ['screen-radiation']
    const originals = planet.originalTraitIds
    completePlanetProject(planet, 'detox-corrosive', catalog)
    expect(planet.originalTraitIds).toBe(originals)
    expect(planet.projectHistory).toEqual(['screen-radiation', 'detox-corrosive'])
    const before = structuredClone(planet)
    expect(completePlanetProject(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason: 'already-completed' })
    expect(planet).toEqual(before)
  })
  it('详探、殖民地、研究和来源特性是前置，拒绝完成不写状态', () => {
    for (const reason of ['survey-required', 'colony-required', 'research-required', 'trait-required']) {
      const planet = makePlanet()
      if (reason === 'survey-required') planet.survey = 1
      if (reason === 'colony-required') delete planet.colony
      if (reason === 'research-required') planet.colony!.supplies.research = 19
      if (reason === 'trait-required') planet.traitIds[0] = planet.hiddenTraitId = 'breathable'
      const before = structuredClone(planet)
      expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason })
      if (reason !== 'research-required') expect(completePlanetProject(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason })
      expect(planet).toEqual(before)
    }
    const planet = makePlanet()
    planet.colony!.supplies.research = 20
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: true })
  })
  it('施工开工已扣研究后可完成，不在完工二次要求或扣取研究', () => {
    const planet = makePlanet()
    planet.colony!.supplies.research = 20
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: true })
    planet.colony!.supplies.research -= 20
    const supplies = structuredClone(planet.colony!.supplies)
    expect(completePlanetProject(planet, 'detox-corrosive', catalog)).toEqual({ ok: true })
    expect(planet.colony!.supplies).toEqual(supplies)
    expect(planet.traitIds).toContain('controlled-corrosion')
  })
  it('真实施工开工扣料并排队，完工交接成功且只记录一次', () => {
    const planet = makePlanet()
    planet.colony!.supplies.research = 20
    const cells = structuredClone(planet.cells.map(cell => cell.deposit))
    expect(startPlanetProject(planet, catalog, 'detox-corrosive')).toEqual({ ok: true })
    expect(planet.colony!.supplies.research).toBe(0)
    expect(planet.colony!.jobs).toHaveLength(1)
    expect(planet.colony!.items.plate).toBeLessThan(100)
    const paidItems = structuredClone(planet.colony!.items)
    const paidCredits = planet.colony!.credits
    advancePlanetConstruction(planet, catalog, HOUR_MS - 1)
    expect(planet.projectHistory).toBeUndefined()
    advancePlanetConstruction(planet, catalog, 1)
    expect(planet.colony!.jobs).toHaveLength(0)
    expect(planet.projectHistory).toEqual(['detox-corrosive'])
    expect(planet.traitIds).toContain('controlled-corrosion')
    expect(planet.cells.map(cell => cell.deposit)).toEqual(cells)
    expect(planet.colony!.items).toEqual(paidItems)
    expect(planet.colony!.credits).toBe(paidCredits)
    expect(planet.colony!.supplies.research).toBe(0)
    const done = structuredClone(planet)
    advancePlanetConstruction(planet, catalog, HOUR_MS)
    expect(planet).toEqual(done)
  })
  it('未知工程、未注入目录和未知来源或目标拒绝', () => {
    const planet = makePlanet()
    expect(planetProjectCheck(planet, 'missing', catalog)).toEqual({ ok: false, reason: 'unknown-project' })
    expect(planetProjectCheck(planet, 'detox-corrosive', { ...catalog, projects: undefined })).toEqual({ ok: false, reason: 'unknown-project' })
    for (const changes of [{ fromTraitId: 'missing' }, { toTraitId: 'missing' }, { removeTraitId: 'missing' }]) {
      const c = makeCatalog([project('unknown-trait', { toTraitId: 'restored-dome', ...changes })])
      expect(planetProjectCheck(planet, 'unknown-trait', c)).toEqual({ ok: false, reason: 'unknown-trait' })
    }
  })
  it.each([NaN, Infinity, -1])('非法研究需求%s拒绝，非法库存也不能绕过', requiredResearch => {
    const c = makeCatalog([project('bad-research', { toTraitId: 'restored-dome', requiredResearch })])
    expect(planetProjectCheck(makePlanet(), 'bad-research', c)).toEqual({ ok: false, reason: 'invalid-project' })
    const planet = makePlanet()
    planet.colony!.supplies.research = requiredResearch
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason: 'research-required' })
  })
  it.each([
    {},
    { fromTraitId: 'corrosive' },
    { fromTraitId: 'corrosive', toTraitId: 'corrosive' },
    { fromTraitId: 'corrosive', toTraitId: 'controlled-corrosion', removeTraitId: 'corrosive' },
  ])('无改动或不完整的项目定义拒绝：%o', changes => {
    const c = makeCatalog([project('invalid-project', changes)])
    const planet = makePlanet()
    const before = structuredClone(planet)
    expect(completePlanetProject(planet, 'invalid-project', c)).toEqual({ ok: false, reason: 'invalid-project' })
    expect(planet).toEqual(before)
  })
  it('来源替换后再校验互斥组、重复编号和双向冲突', () => {
    const c = makeCatalog([
      project('conflicting-temperature', { toTraitId: 'moderated-hot' }),
      project('duplicate-trait', { toTraitId: 'cold' }),
      project('duplicate-atmosphere', { toTraitId: 'controlled-corrosion' }),
    ])
    const planet = makePlanet(['corrosive', 'cold', 'metal-veins'])
    for (const id of ['conflicting-temperature', 'duplicate-trait', 'duplicate-atmosphere']) {
      expect(planetProjectCheck(planet, id, c)).toEqual({ ok: false, reason: 'trait-conflict' })
    }
    for (const id of ['controlled-corrosion', 'metal-veins']) {
      const conflicts = id === 'metal-veins' ? ['controlled-corrosion'] : ['metal-veins']
      const modified = { ...c, traits: new Map(c.traits).set(id, { ...c.traits.get(id)!, conflicts }) }
      expect(planetProjectCheck(planet, 'detox-corrosive', modified)).toEqual({ ok: false, reason: 'trait-conflict' })
    }
  })
  it('完工时来源和互斥状态已改变则拒绝，不记录虚假完成', () => {
    const planet = makePlanet()
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: true })
    planet.traitIds[0] = planet.hiddenTraitId = 'breathable'
    const before = structuredClone(planet)
    expect(completePlanetProject(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason: 'trait-required' })
    expect(planet).toEqual(before)
  })
  it('隐藏特殊来源未调查前不能由工程旁路识别', () => {
    const planet = makePlanet()
    planet.survey = 2
    planet.hiddenTraitId = 'old-dome'
    expect(planetProjectCheck(planet, 'repair-dome', catalog)).toEqual({ ok: false, reason: 'trait-required' })
    planet.survey = 3
    expect(planetProjectCheck(planet, 'repair-dome', catalog)).toEqual({ ok: true })
  })
  it('移除特性会迁移隐藏标记，但不能留下空特性或破坏资源来源', () => {
    const c = makeCatalog([
      project('remove-dome', { removeTraitId: 'old-dome' }),
      project('remove-corrosion', { removeTraitId: 'corrosive' }),
      project('remove-metal', { removeTraitId: 'metal-veins' }),
    ])
    const planet = makePlanet()
    planet.hiddenTraitId = 'old-dome'
    const cells = structuredClone(planet.cells)
    expect(completePlanetProject(planet, 'remove-dome', c)).toEqual({ ok: true })
    expect(planet.hiddenTraitId).toBe('corrosive')
    expect(planet.traitIds).not.toContain('old-dome')
    expect(planet.cells).toEqual(cells)
    expect(planetRulesSupported(planet, c)).toBe(true)
    expect(planetProjectCheck(makePlanet(['corrosive']), 'remove-corrosion', c)).toEqual({ ok: false, reason: 'empty-traits' })
    const before = structuredClone(planet)
    expect(completePlanetProject(planet, 'remove-metal', c)).toEqual({ ok: false, reason: 'resource-preservation' })
    expect(planet).toEqual(before)
  })
  it('替换与移除可组合，新增人工特性不生成资源格', () => {
    const c = makeCatalog([
      project('combined', { fromTraitId: 'corrosive', toTraitId: 'controlled-corrosion', removeTraitId: 'old-dome' }),
      project('add-dome', { toTraitId: 'restored-dome' }),
    ])
    const planet = makePlanet()
    const cells = structuredClone(planet.cells)
    expect(completePlanetProject(planet, 'combined', c)).toEqual({ ok: true })
    expect(completePlanetProject(planet, 'add-dome', c)).toEqual({ ok: true })
    expect(planet.projectHistory).toEqual(['combined', 'add-dome'])
    expect(planet.cells).toEqual(cells)
  })
  it('未来规则和未知特性拒绝', () => {
    const planet = makePlanet()
    planet.generationVersion = 2
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason: 'unsupported' })
    planet.generationVersion = 1
    planet.traitIds.push('future-trait')
    expect(planetProjectCheck(planet, 'detox-corrosive', catalog)).toEqual({ ok: false, reason: 'unsupported' })
  })
})

describe('星球事件独立随机与预警', () => {
  it('首事件至少等待4至8小时，只登记警告、不毁资源建筑或人口', () => {
    for (let seed = 0; seed < 40; seed++) {
      const planet = makePlanet()
      planet.seed = seed
      const before = structuredClone(planet)
      advancePlanetEvents(planet, catalog, 0)
      const due = planet.colony!.nextEventMs
      expect(due).toBeGreaterThanOrEqual(4 * HOUR_MS)
      expect(due).toBeLessThanOrEqual(8 * HOUR_MS)
      expect(planet.colony!.event).toBeUndefined()
      step(planet, due - 1)
      expect(planet.colony!.event).toBeUndefined()
      step(planet, 1)
      expect(planet.colony!.event).toMatchObject({ seq: 1, atMs: due })
      expect(planet.colony!.nextEventMs - due).toBeGreaterThanOrEqual(4 * HOUR_MS)
      expect(planet.colony!.nextEventMs - due).toBeLessThanOrEqual(8 * HOUR_MS)
      expect(planet.cells).toEqual(before.cells)
      expect(planet.traitIds).toEqual(before.traitIds)
      expect(planet.colony!.supplies).toEqual(before.colony!.supplies)
      expect(planet.colony!.items).toEqual(before.colony!.items)
      expect(planet.colony!.awake).toBe(before.colony!.awake)
      expect(planet.colony!.sleeping).toBe(before.colony!.sleeping)
      expect(planet.colony!.crisis).toBe('none')
    }
  })
  it('事件不调用全局随机，种子子流可复现且按保存计数继续', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('global-rng-used') })
    try {
      const planet = makePlanet()
      const state = createInitialState({ seed: 42, nowWallMs: 0 })
      state.planetary = { runtimeVersion: 1, planets: { [planet.id]: planet } }
      const before = structuredClone(state)
      const rng = { seed: hashSeed(`planet-events:1:${planet.seed}:${planet.id}`), count: 0 }
      const expected = 4 * HOUR_MS + nextInt(rng, 4 * HOUR_MS + 1)
      advancePlanetEvents(planet, catalog, 0)
      expect(planet.colony!.nextEventMs).toBe(expected)
      expect(planet.colony!.eventRngCount).toBe(rng.count)
      const restored = structuredClone(planet)
      step(planet, expected)
      step(restored, expected)
      expect(planet).toEqual(restored)
      expect(planet.seed).toBe(7)
      const { planetary, ...rest } = state
      const { planetary: previousPlanets, ...previous } = before
      expect(planetary).toBeDefined()
      expect(previousPlanets).toBeDefined()
      expect(rest).toEqual(previous)
      const other = makePlanet()
      other.id = 'planet-project-other'
      advancePlanetEvents(other, catalog, 0)
      expect(other.colony!.nextEventMs).not.toBe(expected)
    } finally {
      random.mockRestore()
    }
  })
  it('首次大步与小步一致，主时钟不被重复推进', () => {
    const small = makePlanet()
    const large = makePlanet()
    for (let i = 0; i < 12; i++) step(small, HOUR_MS)
    step(large, 12 * HOUR_MS)
    expect(large).toEqual(small)
    expect(large.colony!.clockMs).toBe(12 * HOUR_MS)
    const before = structuredClone(large)
    advancePlanetEvents(large, catalog, 12 * HOUR_MS)
    expect(large).toEqual(before)
  })
  it('待处理事件不覆盖、不积压奖励、不再抽随机', () => {
    const planet = makePlanet()
    step(planet, 12 * HOUR_MS)
    const event = structuredClone(planet.colony!.event)
    const count = planet.colony!.eventRngCount
    step(planet, 30 * 24 * HOUR_MS)
    expect(planet.colony!.event).toEqual(event)
    expect(planet.colony!.eventRngCount).toBe(count)
    expect(planet.colony!.eventSeq).toBe(1)
    const before = structuredClone(planet.colony!.supplies)
    expect(resolvePlanetEvent(planet, catalog, 'dismiss')).toEqual({ ok: true })
    expect(planet.colony!.nextEventMs - planet.colony!.clockMs).toBeGreaterThanOrEqual(4 * HOUR_MS)
    advancePlanetEvents(planet, catalog, 0)
    expect(planet.colony!.event).toBeUndefined()
    expect(planet.colony!.supplies).toEqual(before)
  })
  it('处理后按排定间隔触发下一条，保存计数继续且序号递增', () => {
    const planet = makePlanet()
    step(planet, 8 * HOUR_MS)
    resolvePlanetEvent(planet, catalog, 'dismiss')
    const delay = planet.colony!.nextEventMs - planet.colony!.clockMs
    const count = planet.colony!.eventRngCount
    const restored = structuredClone(planet)
    step(planet, delay - 1)
    expect(planet.colony!.event).toBeUndefined()
    expect(planet.colony!.eventRngCount).toBe(count)
    step(planet, 1)
    step(restored, delay)
    expect(planet).toEqual(restored)
    expect(planet.colony!.event!.seq).toBe(2)
    expect(planet.colony!.eventRngCount).toBeGreaterThan(count)
  })
  it('五种事件都可出现，地块目标只指向已有建筑或研究资源', () => {
    const kinds = new Set<PlanetEvent['kind']>()
    for (let seed = 0; seed < 100; seed++) {
      const planet = makePlanet()
      planet.seed = seed
      step(planet, 8 * HOUR_MS)
      const event = planet.colony!.event!
      kinds.add(event.kind)
      if (event.kind === 'equipment') expect(event.cellIndex).toBe(4)
      else if (event.kind === 'ruins') expect(event.cellIndex).toBe(2)
      else expect(event.cellIndex).toBeUndefined()
    }
    expect([...kinds].sort()).toEqual(['equipment', 'health', 'resources', 'ruins', 'weather'])
  })
  it('无殖民地、未详探、暂停、未知规则及非法时间或计数不触发', () => {
    for (const change of [
      (p: PlanetState) => { delete p.colony },
      (p: PlanetState) => { p.survey = 1 },
      (p: PlanetState) => { p.colony!.pauseEvents = true },
      (p: PlanetState) => { p.generationVersion = 99 },
      (p: PlanetState) => { p.colony!.eventRngCount = -1 },
      (p: PlanetState) => { p.colony!.nextEventMs = NaN },
      (p: PlanetState) => { p.colony!.clockMs = NaN },
      (p: PlanetState) => { p.colony!.eventSeq = -1 },
    ]) {
      const planet = makePlanet()
      change(planet)
      const before = structuredClone(planet)
      advancePlanetEvents(planet, catalog, 8 * HOUR_MS)
      expect(planet).toEqual(before)
    }
    for (const delta of [NaN, Infinity, -1]) {
      const planet = makePlanet()
      const before = structuredClone(planet)
      advancePlanetEvents(planet, catalog, delta)
      expect(planet).toEqual(before)
    }
  })
})

describe('星球事件处理只生效一次', () => {
  it('未知类型、无效序号、未来事件和越界目标拒绝，不发奖也不丢事件', () => {
    for (const change of [
      (event: PlanetEvent) => { event.kind = 'future-event' as PlanetEvent['kind'] },
      (event: PlanetEvent) => { event.seq = 0 },
      (event: PlanetEvent) => { event.seq = 2 },
      (event: PlanetEvent) => { event.seq = -1 },
      (event: PlanetEvent) => { event.atMs = 7 * HOUR_MS },
      (event: PlanetEvent) => { event.cellIndex = 16 },
    ]) {
      const planet = pending('resources')
      change(planet.colony!.event!)
      const before = structuredClone(planet)
      expect(resolvePlanetEvent(planet, catalog, 'investigate')).toEqual({ ok: false, reason: 'unsupported' })
      expect(planet).toEqual(before)
    }
  })
  it.each([NaN, Infinity, -1])('非法研究库存%s不能从调查变成奖励', research => {
    const planet = pending('resources')
    planet.colony!.supplies.research = research
    const before = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'investigate')).toEqual({ ok: false, reason: 'research-required' })
    expect(planet).toEqual(before)
  })
  it('设备维修只消耗10本地零件，失败保留事件且不扣款', () => {
    const planet = pending('equipment')
    planet.colony!.supplies.parts = 9
    const before = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'repair')).toEqual({ ok: false, reason: 'parts-required' })
    expect(planet).toEqual(before)
    planet.colony!.supplies.parts = 10
    expect(resolvePlanetEvent(planet, catalog, 'repair')).toEqual({ ok: true })
    expect(planet.colony!.supplies.parts).toBe(0)
    expect(planet.colony!.credits).toBe(before.colony!.credits)
    expect(planet.colony!.items).toEqual(before.colony!.items)
    expect(planet.cells).toEqual(before.cells)
    const done = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'repair')).toEqual({ ok: false, reason: 'no-event' })
    expect(planet).toEqual(done)
  })
  it.each(['resources', 'ruins'] as const)('%s调查只得少量研究，不生成稀有矿脉且不能重复领奖', kind => {
    const planet = pending(kind)
    const before = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'investigate')).toEqual({ ok: true })
    expect(planet.colony!.supplies.research).toBe(35)
    expect(planet.colony!.supplies.rare).toBe(before.colony!.supplies.rare)
    expect(planet.traitIds).toEqual(before.traitIds)
    expect(planet.cells).toEqual(before.cells)
    const done = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'investigate')).toEqual({ ok: false, reason: 'no-event' })
    expect(planet).toEqual(done)
  })
  it.each(['weather', 'health'] as const)('%s调查耗研究，不会悄悄降低人口或物资', kind => {
    const planet = pending(kind)
    planet.colony!.supplies.research = 4
    const before = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'investigate')).toEqual({ ok: false, reason: 'research-required' })
    expect(planet).toEqual(before)
    planet.colony!.supplies.research = 5
    expect(resolvePlanetEvent(planet, catalog, 'investigate')).toEqual({ ok: true })
    expect(planet.colony!.supplies.research).toBe(0)
    expect(planet.colony!.awake).toBe(before.colony!.awake)
    expect(planet.colony!.sleeping).toBe(before.colony!.sleeping)
    expect(planet.colony!.supplies.food).toBe(before.colony!.supplies.food)
  })
  it.each(['none', 'sheltered', 'rescue'] as const)('避险暂停后续事件，保留原危机状态%s并清待处理事件', crisis => {
    const planet = pending('weather')
    planet.colony!.crisis = crisis
    const supplies = structuredClone(planet.colony!.supplies)
    expect(resolvePlanetEvent(planet, catalog, 'shelter')).toEqual({ ok: true })
    expect(planet.colony!.pauseEvents).toBe(true)
    expect(planet.colony!.crisis).toBe(crisis)
    expect(planet.colony!.event).toBeUndefined()
    const count = planet.colony!.eventRngCount
    step(planet, 48 * HOUR_MS)
    expect(planet.colony!.event).toBeUndefined()
    expect(planet.colony!.eventRngCount).toBe(count)
    expect(planet.colony!.supplies).toEqual(supplies)
  })
  it('动作按事件类型限制，拒绝时状态不变', () => {
    for (const [kind, choice] of [
      ['equipment', 'investigate'], ['weather', 'repair'], ['health', 'repair'],
      ['resources', 'repair'], ['resources', 'shelter'], ['ruins', 'repair'], ['ruins', 'shelter'],
    ] as const) {
      const planet = pending(kind)
      const before = structuredClone(planet)
      expect(resolvePlanetEvent(planet, catalog, choice)).toEqual({ ok: false, reason: 'invalid-choice' })
      expect(planet).toEqual(before)
    }
  })
  it.each(['equipment', 'weather', 'resources', 'health', 'ruins'] as const)('%s忽略不扣物资、不奖励、不关闭危机', kind => {
    const planet = pending(kind)
    planet.colony!.crisis = 'rescue'
    const before = structuredClone(planet)
    expect(resolvePlanetEvent(planet, catalog, 'dismiss')).toEqual({ ok: true })
    expect(planet.colony!.event).toBeUndefined()
    expect(planet.colony!.supplies).toEqual(before.colony!.supplies)
    expect(planet.colony!.crisis).toBe('rescue')
    expect(planet.colony!.eventRngCount).toBe(before.colony!.eventRngCount)
    expect(planet.cells).toEqual(before.cells)
  })
})
