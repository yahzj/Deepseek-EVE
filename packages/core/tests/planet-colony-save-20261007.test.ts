import { describe, expect, it } from 'vitest'
import { cleanPlanetColonyState, cleanPlanetaryState } from '../src/planetSave'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile, SaveError } from '../src/save'
import type {
  PlanetBuildingState, PlanetColonyState, PlanetDelivery, PlanetDeposit, PlanetEvent, PlanetGridCell, PlanetJob,
  PlanetLocalResource, PlanetaryState, PlanetState,
} from '../src/planetTypes'

const MAX = Number.MAX_SAFE_INTEGER
const WEEK = 7 * 24 * 60 * 60 * 1000
const INVALID_COUNTS = [NaN, Infinity, -Infinity, -1, 0.5, MAX + 1, '2', null]

function prototype(size: 4 | 5 | 6 = 4): PlanetState {
  return { id: `planet-${size}`, galaxyId: 'galaxy-unknown', size,
    generationVersion: 1, seed: 0xffffffff, traitIds: ['trait-unknown'], hiddenTraitId: 'trait-unknown', survey: 3,
    cells: Array.from({ length: size ** 2 }, (_, index) => ({ index })) }
}
function job(changes: Partial<PlanetJob> = {}): PlanetJob {
  return { seq: 1, kind: 'build', cellIndex: 0, buildingId: 'building-unknown',
    remainingMs: 60_000.5, totalMs: 120_000.5,
    spentItems: { 'item-unknown': 37 }, spentCredits: 1500, paused: true, ...changes }
}
function colony(): PlanetColonyState {
  return { runtimeVersion: 1, items: { 'item-unknown': 100, 'depleted-item': 0 }, credits: 1234,
    supplies: { food: 10.25, water: 20.5, medicine: 0, metal: 40, parts: 2.5, research: 300.25, rare: .125 },
    awake: 2, sleeping: 4,
    jobs: [job(), job({ seq: 2, kind: 'clear', cellIndex: 1, buildingId: undefined }),
      job({ seq: 3, kind: 'move', cellIndex: 2, targetIndex: 3, paused: false }),
      job({ seq: 4, kind: 'project', cellIndex: undefined, buildingId: undefined, projectId: 'project-unknown', spentResearch: 80.25 })],
    jobSeq: 12, clockMs: WEEK * 10 + .5, tickRemainderMs: 9999.25, crisis: 'sheltered',
    event: { seq: 5, kind: 'ruins', atMs: WEEK * 10 - 1000.5, cellIndex: 15 },
    eventSeq: 8, nextEventMs: WEEK * 10 + 10_000.5, eventRngCount: 27, pauseEvents: false }
}
function delivery(changes: Partial<PlanetDelivery> = {}): PlanetDelivery {
  return { seq: 1, planetId: 'planet-unknown', shipUid: 'ship-unknown', items: { 'cargo-unknown': 4 },
    credits: 250, humans: 2, remainingMs: 1234.5, durationMs: 60_000.5, ...changes }
}
function runtime(): PlanetaryState {
  const planet = prototype()
  planet.cells[0]!.building = { id: 'building-unknown', status: 'construction', powered: false, staffed: false, condition: 0, enabled: false }
  planet.cells[2]!.building = { id: 'building-unknown', status: 'ready', powered: true, staffed: true, condition: .25, enabled: false }
  planet.cells[1]!.obstacle = 'rubble'
  planet.cells[15]!.deposit = { resource: 'research', sourceTraitId: 'trait-unknown', bonus: .125 }
  planet.colony = colony()
  planet.originalTraitIds = ['original-unknown', 'trait-unknown']
  planet.projectHistory = ['completed-project-unknown']
  return { planets: { [planet.id]: planet }, runtimeVersion: 1,
    humans: { discoveredAtGameMs: WEEK * 20 + .25, sourcePlanetId: 'source-unknown', sleeping: 3 },
    deliveries: [delivery(), delivery({ seq: 2, shipUid: 'other-ship', humans: 0, credits: 0 })] }
}
function cleanColony(changes: Record<string, unknown>): PlanetColonyState {
  return cleanPlanetColonyState({ ...colony(), ...changes }, 16)!
}
function roundtrip(planetary: PlanetaryState): PlanetaryState {
  const state = createInitialState({ seed: 7, nowWallMs: 0 })
  state.planetary = planetary
  return loadSaveFile(serializeSaveFile(state, 0)).state.planetary!
}
function expectKeys<T extends object>(value: T, keys: Record<keyof T, true>): void {
  expect(Object.keys(value).sort()).toEqual(Object.keys(keys).sort())
}

describe('星球运行态存档字段穷尽及往返', () => {
  it('所有随档类型的键都纳入清洗白名单', () => {
    const back = cleanPlanetaryState(runtime())!
    const p = back.planets['planet-4']!
    back.tickRemainderMs = 1234
    back.stellar = { systems: {}, searchSeq: 0, autoSearch: false }
    expectKeys<PlanetaryState>(back, { planets: true, stellar: true, runtimeVersion: true, tickRemainderMs: true, humans: true, deliveries: true })
    expect(cleanPlanetaryState(back)!.tickRemainderMs).toBe(1234)
    const typed = { ...p, systemId: 'system-v1-0', surfaceAllowed: false }
    expectKeys<PlanetState>(typed, { id: true, galaxyId: true, size: true, systemId: true, surfaceAllowed: true, generationVersion: true, seed: true,
      traitIds: true, hiddenTraitId: true, survey: true, cells: true, colony: true, originalTraitIds: true, projectHistory: true })
    expectKeys<PlanetBuildingState>(p.cells[0]!.building!, { id: true, status: true, powered: true, staffed: true, condition: true, enabled: true })
    expectKeys<PlanetGridCell>({ ...p.cells[15]!, obstacle: 'rubble', building: p.cells[0]!.building },
      { index: true, deposit: true, obstacle: true, building: true })
    expectKeys<PlanetDeposit>(p.cells[15]!.deposit!, { resource: true, sourceTraitId: true, bonus: true })
    expectKeys<PlanetColonyState>(p.colony!, { runtimeVersion: true, items: true, credits: true, supplies: true,
      awake: true, sleeping: true, jobs: true, jobSeq: true, clockMs: true, tickRemainderMs: true, crisis: true,
      event: true, eventSeq: true, nextEventMs: true, eventRngCount: true, pauseEvents: true })
    expectKeys<Record<PlanetLocalResource, number>>(p.colony!.supplies as Record<PlanetLocalResource, number>,
      { food: true, water: true, medicine: true, metal: true, parts: true, research: true, rare: true })
    const allJobKeys = cleanColony({ jobs: [{ ...job(), targetIndex: 3, projectId: 'optional-unknown', spentResearch: 7.25 }] }).jobs[0]!
    expectKeys<PlanetJob>(allJobKeys, { seq: true, kind: true, cellIndex: true, targetIndex: true, buildingId: true,
      projectId: true, remainingMs: true, totalMs: true, spentItems: true, spentCredits: true, spentResearch: true, paused: true })
    expectKeys<PlanetEvent>(p.colony!.event!, { seq: true, kind: true, atMs: true, cellIndex: true })
    expectKeys<PlanetDelivery>(back.deliveries![0]!, { seq: true, planetId: true, shipUid: true, items: true,
      credits: true, humans: true, remainingMs: true, durationMs: true })
    expectKeys<NonNullable<PlanetaryState['humans']>>(back.humans!, { discoveredAtGameMs: true, sourcePlanetId: true, sleeping: true })
  })
  it.each([4, 5, 6] as const)('旧原型边长%i两次往返不插空殖民或运行字段', size => {
    const p = prototype(size)
    p.cells[0]!.building = { id: 'old-building', status: 'stopped', powered: false, staffed: true }
    const raw = { planets: { [p.id]: p } }
    expect(cleanPlanetaryState(raw)).toStrictEqual(raw)
    const back = roundtrip(raw)
    expect(back).toStrictEqual(raw)
    expect(roundtrip(back)).toStrictEqual(raw)
    expect(back).not.toHaveProperty('runtimeVersion')
    expect(back).not.toHaveProperty('humans')
    expect(back).not.toHaveProperty('deliveries')
    expect(back.planets[p.id]).not.toHaveProperty('colony')
    expect(back.planets[p.id]!.cells[0]!.building).not.toHaveProperty('condition')
    expect(back.planets[p.id]!.cells[0]!.building).not.toHaveProperty('enabled')
  })
  it('完整运行态两次保存读取保留余数、暂停、人口、材料账和未知内容编号', () => {
    const raw = runtime()
    expect(cleanPlanetaryState(raw)).toEqual(raw)
    const back = roundtrip(raw)
    expect(back).toEqual(raw)
    expect(roundtrip(back)).toEqual(raw)
    expect(back.planets['planet-4']!.colony!.jobs[0]!.paused).toBe(true)
    expect(back.planets['planet-4']!.cells[0]!.building!.status).toBe('construction')
    expect(back.planets['planet-4']!.cells[0]!.building!.condition).toBe(0)
    expect(back.planets['planet-4']!.cells[0]!.building!.enabled).toBe(false)
  })
  it('有效字段缺省不凭空生成，人类与物流不依赖地图内容表', () => {
    const c = colony()
    delete c.event
    delete c.pauseEvents
    expect(cleanPlanetColonyState(c)).toEqual(c)
    expect(cleanPlanetaryState({ planets: {} })).toBeUndefined()
    expect(cleanPlanetaryState(undefined)).toBeUndefined()
    expect(cleanPlanetaryState({ planets: {}, runtimeVersion: 1, deliveries: [] }))
      .toEqual({ planets: {}, runtimeVersion: 1, deliveries: [] })
    const raw = { planets: {}, runtimeVersion: 1 as const, humans: runtime().humans, deliveries: [delivery()] }
    expect(roundtrip(raw)).toEqual(raw)
  })
  it('改造后超过九条的特性保留到二十四条，原始特性与工程历史不按九条截断', () => {
    const p = prototype()
    p.traitIds = Array.from({ length: 24 }, (_, i) => `trait-${i}`)
    p.hiddenTraitId = p.traitIds[23]!
    p.originalTraitIds = [...p.traitIds]
    p.projectHistory = Array.from({ length: 40 }, (_, i) => `project-${i}`)
    const raw = { planets: { [p.id]: p } }
    expect(roundtrip(raw)).toEqual(raw)
    p.traitIds.push('overflow-trait')
    expect(cleanPlanetaryState(raw)!.planets[p.id]!.traitIds).toEqual(p.traitIds.slice(0, 24))
  })
  it('未来生成版本原样保留，不静默写成版本一', () => {
    const p = prototype()
    p.generationVersion = MAX
    expect(roundtrip({ planets: { [p.id]: p } }).planets[p.id]!.generationVersion).toBe(MAX)
  })
  it.each([2, 99, 0, -1, NaN, Infinity, '1', null])('非当前运行版本%s显式拒读，绝不降级', version => {
    expect(() => cleanPlanetaryState({ ...runtime(), runtimeVersion: version })).toThrow('unsupported-planet-runtime-version')
    expect(() => cleanPlanetColonyState({ ...colony(), runtimeVersion: version })).toThrow('unsupported-planet-runtime-version')
    const raw = runtime()
    const p = raw.planets['planet-4']!
    expect(() => cleanPlanetaryState({ ...raw, planets: { [p.id]: { ...p, colony: { ...colony(), runtimeVersion: version } } } }))
      .toThrow('unsupported-planet-runtime-version')
  })
  it('完整存档读取入口拒绝未来全球或殖民规则版本', () => {
    expect(() => roundtrip({ ...runtime(), runtimeVersion: 2 as 1 })).toThrow(SaveError)
    try { roundtrip({ ...runtime(), runtimeVersion: 2 as 1 }) } catch (e) { expect((e as SaveError).code).toBe('VERSION') }
    const raw = runtime()
    raw.planets['planet-4']!.colony!.runtimeVersion = 2 as 1
    expect(() => roundtrip(raw)).toThrow(SaveError)
  })
  it('缺少版本的坏殖民记录不修成空基地', () => {
    const p = prototype()
    expect(cleanPlanetaryState({ planets: { [p.id]: { ...p, colony: { items: { gift: 100 } } } } })).toBeUndefined()
    expect(cleanPlanetColonyState({})).toBeUndefined()
  })
})

describe('星球运行态损坏清洗', () => {
  it.each(INVALID_COUNTS)('坏人口、信用点和计数%s只归零，不向上修补', value => {
    const back = cleanColony({ awake: value, sleeping: value, credits: value, jobSeq: value, eventSeq: value,
      eventRngCount: value, jobs: [], event: undefined })
    expect(back).toMatchObject({ awake: 0, sleeping: 0, credits: 0, jobSeq: 0, eventSeq: 0, eventRngCount: 0 })
  })
  it('库存保留安全整数及耗尽零值，本地补给保留小数，坏数量不修成免费材料', () => {
    const back = cleanColony({ items: { good: 12, empty: 0, huge: MAX, fraction: 1.5, overflow: MAX + 1,
      negative: -1, nan: NaN, infinity: Infinity, text: '8' },
    supplies: { food: 12.75, water: 0, medicine: NaN, metal: -1, parts: Infinity, research: MAX + 1, rare: MAX, unknown: 10 } })
    expect(back.items).toEqual({ good: 12, empty: 0, huge: MAX })
    expect(back.supplies).toEqual({ food: 12.75, water: 0, rare: MAX })
    expect(cleanColony({ items: [], supplies: [] })).toMatchObject({ items: {}, supplies: {} })
  })
  it.each([NaN, Infinity, -Infinity, -1, MAX + 1, '3', null])('坏时钟%s归零，累计时间不被工期上限截断', value => {
    expect(cleanColony({ clockMs: value, nextEventMs: value, tickRemainderMs: value }))
      .toMatchObject({ clockMs: 0, nextEventMs: 0, tickRemainderMs: 0 })
    expect(cleanColony({ clockMs: MAX, nextEventMs: MAX, tickRemainderMs: 9999.5 }))
      .toMatchObject({ clockMs: MAX, nextEventMs: MAX, tickRemainderMs: 9999.5 })
  })
  it.each([10_000, 10_001, WEEK])('非法量子余数%s不取模或额外推进', tickRemainderMs => {
    expect(cleanColony({ tickRemainderMs }).tickRemainderMs).toBe(0)
  })
  it.each(['none', 'sheltered', 'rescue'] as const)('危机状态%s完整保留', crisis => {
    expect(cleanColony({ crisis }).crisis).toBe(crisis)
  })
  it('未知危机按救援停机，事件暂停只保留布尔值', () => {
    expect(cleanColony({ crisis: 'unknown' }).crisis).toBe('rescue')
    expect(cleanColony({ pauseEvents: true }).pauseEvents).toBe(true)
    expect(cleanColony({ pauseEvents: false }).pauseEvents).toBe(false)
    expect(cleanColony({ pauseEvents: 'true' })).not.toHaveProperty('pauseEvents')
  })
  it.each(['equipment', 'weather', 'resources', 'health', 'ruins'] as const)('待处理%s事件及序号保留，不在读取时结算', kind => {
    const event = { seq: 20, kind, atMs: 100.25, cellIndex: 15 }
    expect(cleanColony({ event, eventSeq: 2 })).toMatchObject({ event, eventSeq: 20 })
    expect(cleanColony({ event: { seq: 1, kind, atMs: 0 } }).event).toEqual({ seq: 1, kind, atMs: 0 })
  })
  it.each([{ kind: 'unknown' }, { seq: 0 }, { seq: MAX + 1 }, { atMs: NaN }, { atMs: Infinity },
    { atMs: -1 }, { atMs: MAX + 1 }, { cellIndex: 16 }, { cellIndex: -.5 }, { cellIndex: '0' }])('坏事件%o不发奖励、不替换成另一类', changes => {
    const back = cleanColony({ event: { ...colony().event, ...changes } })
    expect(back).not.toHaveProperty('event')
    expect(back.eventSeq).toBe(8)
    expect(back.supplies).toEqual(colony().supplies)
  })
  it.each([NaN, Infinity, -1, 1.01, '1', null])('坏建筑耐久%s归零，不能免费修成满耐久', condition => {
    const p = prototype()
    const raw = { ...p, cells: p.cells.map(c => c.index === 0 ? { ...c,
      building: { id: 'unknown', status: 'ready', powered: true, staffed: false, condition, enabled: 'true' } } : c) }
    const back = cleanPlanetaryState({ planets: { [p.id]: raw } })!
    expect(back.planets[p.id]!.cells[0]!.building).toMatchObject({ condition: 0, enabled: false })
  })
  it('不改输入对象且没有任何嵌套引用泄漏', () => {
    const raw = runtime()
    const before = structuredClone(raw)
    const back = cleanPlanetaryState(raw)!
    const p = back.planets['planet-4']!
    p.traitIds.push('added')
    p.originalTraitIds!.push('added')
    p.projectHistory!.push('added')
    p.cells[0]!.building!.condition = 1
    p.cells[15]!.deposit!.bonus = 1
    p.colony!.items['item-unknown'] = 1
    p.colony!.supplies.food = 1
    p.colony!.jobs[0]!.spentItems['item-unknown'] = 1
    p.colony!.event!.seq = 99
    back.humans!.sleeping = 1
    back.deliveries![0]!.items['cargo-unknown'] = 1
    expect(raw).toEqual(before)
  })
})

describe('已付施工账和运输账', () => {
  it('正确材料账只保留正安全整数，暂停值和信用点原样保存', () => {
    const back = cleanColony({ jobs: [{ ...job(), spentItems: { paid: 9, huge: MAX, zero: 0, negative: -1,
      fraction: .5, overflow: MAX + 1, nan: NaN, infinity: Infinity, text: '8' } }] })
    expect(back.jobs[0]).toEqual({ ...job(), spentItems: { paid: 9, huge: MAX } })
    expect(back.items).toEqual(colony().items)
    expect(back.credits).toBe(colony().credits)
  })
  it.each([0, 7.25, MAX])('研究已付账%s原样保存，缺省不插账', spentResearch => {
    const paid = job({ seq: 1, kind: 'project', projectId: 'future-project', spentResearch })
    expect(cleanColony({ jobs: [paid] }).jobs).toEqual([paid])
    expect(cleanColony({ jobs: [job()] }).jobs[0]).not.toHaveProperty('spentResearch')
  })
  it.each([NaN, Infinity, -Infinity, -1, MAX + 1, '2', null])('坏研究账%s不补款，也不丢正确材料和信用点账', spentResearch => {
    const paid = job({ kind: 'project', projectId: 'future-project' })
    const c = cleanColony({ jobs: [{ ...paid, spentResearch }] })
    expect(c.jobs).toEqual([paid])
    expect(c.supplies).toEqual(colony().supplies)
  })
  it.each([{ seq: 0 }, { seq: MAX + 1 }, { kind: 'unknown' }, { cellIndex: 16 }, { cellIndex: -1 },
    { cellIndex: .5 }, { cellIndex: '0' }, { cellIndex: undefined }, { buildingId: '' }, { buildingId: '__proto__' },
    { remainingMs: NaN }, { remainingMs: Infinity }, { remainingMs: -1 }, { remainingMs: 120_001 },
    { totalMs: 0 }, { totalMs: Infinity }, { totalMs: WEEK + 1 }, { spentCredits: NaN },
    { spentCredits: -1 }, { spentCredits: .5 }, { spentCredits: MAX + 1 }, { spentItems: [] }, { paused: 'true' }])('坏施工%o丢弃但不完成建筑、不补发材料、不丢相邻正确账', changes => {
    const raw = runtime()
    const p = raw.planets['planet-4']!
    const bad = { ...job(), ...changes }
    const paid = job({ seq: 2 })
    const back = cleanPlanetaryState({ ...raw, planets: { [p.id]: { ...p, colony: { ...p.colony, jobs: [bad, paid] } } } })!
    const c = back.planets[p.id]!.colony!
    expect(c.jobs).toEqual([paid])
    expect(c.items).toEqual(p.colony!.items)
    expect(c.credits).toBe(p.colony!.credits)
    expect(back.planets[p.id]!.cells[0]!.building).toEqual(p.cells[0]!.building)
  })
  it('工期七天边界、零剩余、暂停作业和未知工程不被丢掉或读取完成', () => {
    const jobs = [job({ remainingMs: 0, totalMs: WEEK }),
      job({ seq: MAX, kind: 'project', projectId: 'future-project', remainingMs: WEEK, totalMs: WEEK, spentCredits: MAX })]
    const c = cleanColony({ jobs, jobSeq: 0 })
    expect(c.jobs).toEqual(jobs)
    expect(c.jobSeq).toBe(MAX)
  })
  it.each([job({ kind: 'project', projectId: undefined }), job({ kind: 'clear', cellIndex: undefined }),
    job({ kind: 'move', targetIndex: undefined }), job({ kind: 'move', targetIndex: 0 }),
    job({ kind: 'move', targetIndex: 16 }), job({ kind: 'project', projectId: 'constructor' })])('作业必要参数或编号非法时拒绝%o', bad => {
    expect(cleanColony({ jobs: [bad] }).jobs).toEqual([])
  })
  it('重复作业序号只保留第一笔正确账，不重新分配序号或退料', () => {
    const first = job()
    const second = job({ spentItems: { duplicate: 99 } })
    expect(cleanColony({ jobs: [first, second] }).jobs).toEqual([first])
    expect(cleanColony({ jobs: [first], jobSeq: 0 }).jobSeq).toBe(1)
  })
  it('超过运行队列容量的正确付费账不被结构清洗截断', () => {
    const jobs = Array.from({ length: 20 }, (_, i) => job({ seq: i + 1 }))
    expect(cleanColony({ jobs }).jobs).toEqual(jobs)
  })
  it.each([{ seq: 0 }, { seq: MAX + 1 }, { planetId: '' }, { planetId: '__proto__' }, { shipUid: 'constructor' },
    { credits: NaN }, { credits: -.5 }, { credits: MAX + 1 }, { humans: -1 }, { humans: .5 }, { humans: Infinity },
    { remainingMs: -1 }, { remainingMs: NaN }, { remainingMs: 60_001 }, { durationMs: 0 },
    { durationMs: Infinity }, { durationMs: WEEK + 1 }, { items: [] }])('非法运输%o不会变为立即到货或生成休眠人口', changes => {
    const raw = runtime()
    const back = cleanPlanetaryState({ ...raw, deliveries: [{ ...delivery(), ...changes }] })!
    expect(back.deliveries).toEqual([])
    expect(back.humans).toEqual(raw.humans)
    expect(back.planets).toEqual(raw.planets)
  })
  it('运输至多六十四笔，重复序号或同船不被重新编号成另一趟', () => {
    const first = delivery()
    const next = delivery({ seq: 2, shipUid: 'other-ship' })
    const raw = runtime()
    expect(cleanPlanetaryState({ ...raw, deliveries: [first, delivery({ shipUid: 'duplicate-seq' }),
      delivery({ seq: 3 }), next] })!.deliveries).toEqual([first, next])
    const deliveries = Array.from({ length: 70 }, (_, i) => delivery({ seq: i + 1, shipUid: `ship-${i}` }))
    expect(cleanPlanetaryState({ ...raw, deliveries })!.deliveries).toEqual(deliveries.slice(0, 64))
  })
  it('运输时间七天、零剩余和安全整数边界完整保留但读取不入账', () => {
    const raw = runtime()
    const deliveries = [delivery({ seq: MAX, remainingMs: 0, durationMs: WEEK, humans: MAX, credits: MAX, items: { unknown: MAX } })]
    const back = cleanPlanetaryState({ ...raw, deliveries })!
    expect(back.deliveries).toEqual(deliveries)
    expect(back.planets).toEqual(raw.planets)
    expect(back.humans).toEqual(raw.humans)
  })
  it.each([{ discoveredAtGameMs: NaN }, { discoveredAtGameMs: -1 }, { discoveredAtGameMs: MAX + 1 },
    { sourcePlanetId: 'prototype' }, { sleeping: -1 }, { sleeping: .5 }, { sleeping: MAX + 1 }])('非法人类发现记录%o不修补为免费人口', changes => {
    expect(cleanPlanetaryState({ ...runtime(), humans: { ...runtime().humans, ...changes } })).not.toHaveProperty('humans')
  })
})

describe('存档原型污染与额外键防护', () => {
  it('所有材料账和字典拒绝污染键，但保留未知合法编号', () => {
    const polluted = JSON.parse('{"__proto__":10,"constructor":20,"prototype":30,"unknown-item":4}')
    const raw = runtime()
    const p = raw.planets['planet-4']!
    p.colony!.items = polluted
    p.colony!.jobs[0]!.spentItems = polluted
    raw.deliveries![0]!.items = polluted
    p.traitIds.push('__proto__', 'constructor', 'prototype')
    p.originalTraitIds!.push('__proto__', 'constructor', 'prototype')
    p.projectHistory!.push('__proto__', 'constructor', 'prototype')
    Object.assign(raw.planets, JSON.parse('{"__proto__":{"id":"__proto__"},"constructor":{},"prototype":{}}'))
    const back = cleanPlanetaryState(raw)!
    expect(Object.keys(back.planets)).toEqual(['planet-4'])
    expect(back.planets[p.id]!.colony!.items).toEqual({ 'unknown-item': 4 })
    expect(back.planets[p.id]!.colony!.jobs[0]!.spentItems).toEqual({ 'unknown-item': 4 })
    expect(back.deliveries![0]!.items).toEqual({ 'unknown-item': 4 })
    for (const list of [back.planets[p.id]!.traitIds, back.planets[p.id]!.originalTraitIds!, back.planets[p.id]!.projectHistory!]) {
      expect(list).not.toContain('__proto__')
      expect(list).not.toContain('constructor')
      expect(list).not.toContain('prototype')
    }
    expect(Object.getPrototypeOf(back.planets)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(back.planets[p.id]!.colony!.items)).toBe(Object.prototype)
  })
  it('不读取继承字段，也不复制未知额外字段', () => {
    const raw = runtime()
    const p = raw.planets['planet-4']!
    const inherited = Object.create({ runtimeVersion: 1, awake: 99, sleeping: 99, items: { free: 999 } })
    expect(cleanPlanetColonyState(inherited)).toBeUndefined()
    expect(cleanPlanetaryState(Object.create(raw))).toBeUndefined()
    const back = cleanPlanetaryState({ ...raw, freeMoney: 999, planets: { [p.id]: { ...p, freeMoney: 999,
      colony: { ...p.colony, freeMoney: 999, jobs: [{ ...job(), freeMoney: 999 }],
        event: { ...p.colony!.event, freeMoney: 999 } } } },
    deliveries: [{ ...delivery(), freeMoney: 999 }], humans: { ...raw.humans, freeMoney: 999 } })!
    expect(JSON.stringify(back)).not.toContain('freeMoney')
    expect(cleanPlanetaryState({ planets: [] })).toBeUndefined()
  })
})
