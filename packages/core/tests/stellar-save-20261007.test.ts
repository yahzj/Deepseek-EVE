import { describe, expect, it } from 'vitest'
import { buildPlanetCatalog } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { cleanPlanetaryState } from '../src/planetSave'
import { cleanStellarState } from '../src/stellarSave'
import { generateStellarSystem, parseStellarSeed } from '../src/stellarGeneration'
import { discardStellarSystem, stellarCandidateCount } from '../src/stellarSearch'
import { planetConstructionCheck } from '../src/planetGrid'
import { planetSurveyView } from '../src/planetSurvey'
import type { PlanetColonyState, PlanetaryState, PlanetState } from '../src/planetTypes'
import type { StellarBody, StellarSearch, StellarState, StellarSystem } from '../src/stellarTypes'

const MAX = Number.MAX_SAFE_INTEGER
const SIX_HOURS = 6 * 60 * 60 * 1000
const catalog = buildPlanetCatalog()

function system(seed = 0, bodyCount = 8): StellarSystem {
  const id = `system-v1-${seed}`
  return { id, generationVersion: 1, seed, kind: 'single', starClass: 'yellow',
    stars: [{ x: 500, y: 350, radius: 20 }], routeMinutes: 20,
    bodies: Array.from({ length: bodyCount }, (_, i) => ({ planetId: `${id}-p${i + 1}`, ordinal: i + 1,
      kind: i === bodyCount - 1 ? 'gas' : 'rocky', orbit: 65 + i * 30, x: -20 + i * 50, y: 350 })) }
}
function planet(id = 'legacy-planet', systemId?: string, surfaceAllowed?: boolean, size: 4 | 5 | 6 = 4): PlanetState {
  return { id, galaxyId: systemId ?? 'galaxy-hub', size, seed: 7, generationVersion: 1,
    traitIds: ['temperate'], hiddenTraitId: 'temperate', survey: 3,
    cells: Array.from({ length: size ** 2 }, (_, index) => ({ index })),
    ...(systemId !== undefined ? { systemId } : {}), ...(surfaceAllowed !== undefined ? { surfaceAllowed } : {}) }
}
function colony(): PlanetColonyState {
  return { runtimeVersion: 1, items: { 'future-item': 3, exhausted: 0 }, credits: 20,
    supplies: { food: 0, water: 0, medicine: .25, research: 7.5 }, awake: 0, sleeping: 2,
    jobs: [{ seq: 12, kind: 'build', cellIndex: 0, buildingId: 'future-building',
      remainingMs: 2000.5, totalMs: 9000.5, spentItems: { 'future-item': 40 }, spentCredits: 1200, paused: true },
    { seq: 13, kind: 'project', projectId: 'future-project', remainingMs: 1000, totalMs: 8000,
      spentItems: { 'project-item': 2 }, spentCredits: 300, spentResearch: 4.25, paused: false }],
    jobSeq: 17, clockMs: 90000.25, tickRemainderMs: 9999.5, crisis: 'rescue',
    event: { seq: 6, kind: 'health', atMs: 90000, cellIndex: 0 }, eventSeq: 9,
    nextEventMs: 95000.5, eventRngCount: 8, pauseEvents: false }
}
function search(changes: Partial<StellarSearch> = {}): StellarSearch {
  return { seq: 3, mode: 'specified', seed: 0, durationMs: SIX_HOURS, progressMs: 1000.5, paused: true, ...changes }
}
function stellar(systems: StellarSystem[] = [], changes: Partial<StellarState> = {}): StellarState {
  return { systems: Object.fromEntries(systems.map(s => [s.id, s])), searchSeq: 0, autoSearch: false, ...changes }
}
function planetary(systems: StellarSystem[] = [system()]): PlanetaryState {
  return { planets: Object.fromEntries(systems.flatMap(s => s.bodies.map((b, i) =>
    [b.planetId, planet(b.planetId, s.id, b.kind !== 'gas', (4 + i % 3) as 4 | 5 | 6)]))), stellar: stellar(systems) }
}
function roundtrip(raw: PlanetaryState): PlanetaryState {
  const state = createInitialState({ seed: 7, nowWallMs: 0 })
  state.planetary = raw
  return loadSaveFile(serializeSaveFile(state, 0)).state.planetary!
}
function cleanSystem(changes: Record<string, unknown>): StellarState | undefined {
  const s = { ...system(), ...changes }
  return cleanStellarState({ systems: { [s.id as string]: s } })
}
function expectKeys<T extends object>(value: T, keys: Record<keyof T, true>): void {
  expect(Object.keys(value).sort()).toEqual(Object.keys(keys).sort())
}

describe('星系存档兼容与大容量往返', () => {
  it('旧档查询和两次往返不创建星系、地表标记或殖民字段，也不改变旧世界', () => {
    const p = planet()
    p.cells[0]!.building = { id: 'base', status: 'stopped', powered: false, staffed: false }
    const raw = { planets: { [p.id]: p } }
    const before = structuredClone(raw)
    expect(planetSurveyView(p, catalog)).toBeDefined()
    expect(cleanPlanetaryState(raw)).toStrictEqual(raw)
    const back = roundtrip(raw)
    expect(roundtrip(back)).toStrictEqual(raw)
    expect(raw).toStrictEqual(before)
    expect(back).not.toHaveProperty('stellar')
    expect(back).not.toHaveProperty('runtimeVersion')
    expect(back.planets[p.id]).not.toHaveProperty('systemId')
    expect(back.planets[p.id]).not.toHaveProperty('surfaceAllowed')
    expect(back.planets[p.id]).not.toHaveProperty('colony')
    const oldState = createInitialState({ seed: 7, nowWallMs: 0 })
    expect(loadSaveFile(serializeSaveFile(oldState, 0)).state).not.toHaveProperty('planetary')
  })
  it.each([undefined, null, {}, [], { systems: {} }])('空星系字段%o不向旧档插入默认值', value => {
    const p = planet()
    const raw = { planets: { [p.id]: p } }
    expect(cleanStellarState(value)).toBeUndefined()
    expect(cleanPlanetaryState({ ...raw, stellar: value })).toStrictEqual(raw)
    expect(cleanPlanetaryState({ planets: {}, stellar: value })).toBeUndefined()
  })
  it('显式关闭、已耗搜索序号和停止原因独立保留，不需要先发现星系', () => {
    const s = stellar([], { searchSeq: 30, stoppedReason: 'probe-stock' })
    expect(roundtrip({ planets: {}, stellar: s })).toEqual({ planets: {}, stellar: s })
    expect(cleanStellarState(stellar())).toEqual(stellar())
  })
  it('十个星系的八十颗星球与各自施工、人口减损、工程历史和物流全部往返保留', () => {
    const raw = planetary(Array.from({ length: 10 }, (_, seed) => system(seed)))
    raw.runtimeVersion = 1
    raw.tickRemainderMs = 9999.5
    for (const s of Object.values(raw.stellar!.systems)) {
      s.developed = true
      const p = raw.planets[s.bodies[0]!.planetId]!
      p.cells[0]!.building = { id: 'future-building', status: 'construction', powered: false, staffed: false,
        condition: .1, enabled: false }
      p.colony = colony()
      p.originalTraitIds = ['future-original-trait', 'temperate']
      p.projectHistory = Array.from({ length: 40 }, (_, i) => `future-project-${i}`)
    }
    const destination = raw.stellar!.systems['system-v1-9']!.bodies[0]!.planetId
    raw.humans = { discoveredAtGameMs: 20000, sourcePlanetId: destination, sleeping: 0 }
    raw.deliveries = [{ seq: 2, planetId: destination, shipUid: 'future-ship', items: { 'future-cargo': 8 },
      credits: 10, humans: 1, remainingMs: 50.5, durationMs: 120000 }]
    const back = roundtrip(raw)
    expect(Object.keys(back.planets)).toHaveLength(80)
    expect(back).toStrictEqual(raw)
    expect(roundtrip(back)).toStrictEqual(raw)
    expect(back.planets[destination]!.colony).toMatchObject({ awake: 0, sleeping: 2, crisis: 'rescue' })
    expect(back.planets[destination]!.cells[0]!.building!.status).toBe('construction')
  })
  it('十五份候选坐标全部保留，异常超额和已开发星系也不在读档时删除', () => {
    const raw = planetary(Array.from({ length: 18 }, (_, seed) => system(seed)))
    raw.stellar!.systems['system-v1-15']!.developed = true
    raw.planets['system-v1-16-p1']!.colony = colony()
    raw.planets['system-v1-16-p1']!.cells[0]!.building = { id: 'base', status: 'ready', powered: true, staffed: false }
    raw.stellar!.systems['system-v1-17']!.developed = true
    const state = createInitialState({ seed: 7, nowWallMs: 0 })
    state.planetary = roundtrip(raw)
    expect(stellarCandidateCount(state)).toBe(15)
    expect(state.planetary).toEqual(raw)
    raw.stellar!.systems['system-v1-15']!.developed = false
    expect(Object.keys(roundtrip(raw).stellar!.systems)).toHaveLength(18)
  })
  it.each([true, false])('新星球放在旧星球%s之前或之后都不共享六十四条上限', first => {
    const raw = planetary(Array.from({ length: 10 }, (_, seed) => system(seed)))
    const legacy = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`legacy-${i}`, planet(`legacy-${i}`)]))
    raw.planets = first ? { ...raw.planets, ...legacy } : { ...legacy, ...raw.planets }
    const back = roundtrip(raw)
    expect(Object.keys(back.planets)).toHaveLength(144)
    expect(Object.keys(back.planets).filter(id => id.startsWith('legacy-'))).toEqual(Object.keys(legacy).slice(0, 64))
    for (const s of Object.values(raw.stellar!.systems)) {
      for (const b of s.bodies) expect(back.planets[b.planetId]).toEqual(raw.planets[b.planetId])
    }
  })
  it('新旧随档键纳入本专项白名单，完整星系快照不依赖当前内容表', () => {
    const raw = planetary()
    const p = raw.planets['system-v1-0-p1']!
    p.generationVersion = 99
    p.traitIds = ['future-trait']
    p.hiddenTraitId = 'future-trait'
    p.cells[0]!.deposit = { resource: 'research', sourceTraitId: 'future-trait', bonus: .25 }
    p.cells[1]!.building = { id: 'future-building', status: 'construction', powered: false, staffed: false }
    const back = roundtrip(raw)
    expect(back).toEqual(raw)
    expect(planetConstructionCheck(back.planets[p.id]!, 0, 'base', catalog)).toEqual({ ok: false, reason: 'unsupported' })
  })
  it('新随档类型所有字段纳入清洗白名单，包括明确的false和零值', () => {
    const raw = planetary()
    raw.runtimeVersion = 1
    raw.tickRemainderMs = 0
    raw.humans = { discoveredAtGameMs: 0, sourcePlanetId: 'system-v1-0-p1', sleeping: 0 }
    raw.deliveries = []
    raw.stellar!.systems['system-v1-0']!.developed = false
    raw.stellar!.search = search()
    raw.stellar!.searchSeq = 3
    raw.stellar!.stoppedReason = 'capacity'
    const p = raw.planets['system-v1-0-p1']!
    p.colony = colony()
    p.originalTraitIds = ['temperate']
    p.projectHistory = []
    const back = cleanPlanetaryState(raw)!
    expect(back).toStrictEqual(raw)
    expectKeys<PlanetaryState>(back, { planets: true, stellar: true, runtimeVersion: true, tickRemainderMs: true,
      humans: true, deliveries: true })
    expectKeys<PlanetState>(back.planets[p.id]!, { id: true, galaxyId: true, size: true, systemId: true, surfaceAllowed: true,
      seed: true, generationVersion: true, traitIds: true, hiddenTraitId: true, survey: true, cells: true,
      colony: true, originalTraitIds: true, projectHistory: true })
    expectKeys<StellarState>(back.stellar!, { systems: true, search: true, searchSeq: true, autoSearch: true, stoppedReason: true })
    const s = back.stellar!.systems['system-v1-0']!
    expectKeys<StellarSystem>(s, { id: true, generationVersion: true, seed: true, kind: true,
      starClass: true, stars: true, bodies: true, routeMinutes: true, developed: true })
    expectKeys<StellarBody>(s.bodies[0]!, { planetId: true, ordinal: true, kind: true, orbit: true, x: true, y: true })
    expectKeys<StellarSearch>(back.stellar!.search!, { seq: true, mode: true, seed: true, durationMs: true, progressMs: true, paused: true })
    expectKeys<StellarSystem['stars'][number]>(s.stars[0]!, { x: true, y: true, radius: true })
  })
})

describe('星系身份、结构和几何清洗', () => {
  it.each([0, 0xffffffff])('无符号种子%i两端和二至八颗天体保留', seed => {
    for (let n = 2; n <= 8; n++) {
      const s = system(seed, n)
      expect(cleanStellarState(stellar([s]))).toEqual(stellar([s]))
    }
  })
  it.each([-1, .5, 0x100000000, NaN, Infinity, '0', null])('非法星系种子%o不修成新世界', seed => {
    expect(cleanSystem({ seed })).toBeUndefined()
  })
  it.each([0, -1, .5, NaN, Infinity, MAX + 1, '1', null])('非法生成版本%o丢弃，不改写版本一', generationVersion => {
    expect(cleanSystem({ generationVersion })).toBeUndefined()
  })
  it('版本一身份必须与种子及字典键相同，未来身份不强套版本一格式', () => {
    expect(cleanSystem({ id: 'system-v1-1' })).toBeUndefined()
    const s = system()
    expect(cleanStellarState({ systems: { different: s } })).toBeUndefined()
    for (const id of ['system-v99-0', 'future-coordinate-0']) {
      const future = { ...s, id, generationVersion: 99 as 1 }
      const raw = planetary([future])
      for (const p of Object.values(raw.planets)) p.generationVersion = 99
      const back = roundtrip(raw)
      expect(back).toEqual(raw)
      expect(back.stellar!.systems[id]!.generationVersion).toBe(99)
      expect(planetConstructionCheck(Object.values(back.planets)[0]!, 0, 'base', catalog).ok).toBe(false)
    }
  })
  it('未来生成版本保留原中心天体组合，不拿版本一规则重写或抹掉版本', () => {
    const future = { ...system(), id: 'future-system', generationVersion: MAX as 1, stars: [] }
    expect(roundtrip(planetary([future]))).toEqual(planetary([future]))
  })
  it.each([
    ['single', 'yellow', 1], ['binary', 'blue', 2], ['white-dwarf', 'white', 1],
    ['neutron', 'neutron', 1], ['black-hole', 'black-hole', 1], ['rogue', 'none', 0],
  ] as const)('%s类型保留对应的%i颗中心天体', (kind, starClass, count) => {
    const s = system()
    s.kind = kind; s.starClass = starClass
    s.stars = Array.from({ length: count }, (_, i) => ({ x: -5 + i * 10, y: 0, radius: .25 }))
    expect(cleanStellarState(stellar([s]))).toEqual(stellar([s]))
    s.stars = count === 0 ? [{ x: 0, y: 0, radius: 1 }] : []
    expect(cleanStellarState({ systems: { [s.id]: s } })).toBeUndefined()
  })
  it.each([{ kind: 'unknown' }, { starClass: 'unknown' }, { starClass: 'none' }, { stars: [] },
    { stars: [{ x: 0, y: 0, radius: 1 }, { x: 1, y: 1, radius: 1 }, { x: 2, y: 2, radius: 1 }] },
    { bodies: system(0, 1).bodies }, { bodies: system(0, 9).bodies }, { bodies: [] }, { bodies: {} },
    { routeMinutes: 19.99 }, { routeMinutes: 120.01 }, { routeMinutes: NaN }, { routeMinutes: '20' }])('畸形星系%o整份丢弃，不删坏天体再生成', changes => {
    expect(cleanSystem(changes)).toBeUndefined()
  })
  it.each([20, 120, 42.5])('航路分钟边界%o保留，不按当前玩家速度重算', routeMinutes => {
    expect(cleanSystem({ routeMinutes })!.systems['system-v1-0']!.routeMinutes).toBe(routeMinutes)
  })
  it.each([{ x: NaN }, { y: Infinity }, { x: '0' }, { radius: 0 }, { radius: -1 }, { radius: NaN }])('中心天体坏几何%o不修补坐标', changes => {
    expect(cleanSystem({ stars: [{ ...system().stars[0], ...changes }] })).toBeUndefined()
  })
  it.each([{ x: NaN }, { y: -Infinity }, { x: '0' }, { orbit: 0 }, { orbit: Infinity }, { ordinal: 0 },
    { ordinal: .5 }, { ordinal: 9 }, { planetId: '' }, { planetId: 'constructor' }, { kind: 'unknown' }])('行星坏几何或身份%o不生成免费地表', changes => {
    const bodies = system().bodies
    bodies[0] = { ...bodies[0]!, ...changes } as typeof bodies[number]
    expect(cleanSystem({ bodies })).toBeUndefined()
  })
  it('天体序号和星球编号必须各自唯一，重复跨星系引用不能覆盖归属索引', () => {
    const a = system(), b = system(1)
    const duplicateOrdinal = structuredClone(a)
    duplicateOrdinal.bodies[1]!.ordinal = duplicateOrdinal.bodies[0]!.ordinal
    expect(cleanStellarState({ systems: { [a.id]: duplicateOrdinal } })).toBeUndefined()
    const duplicateId = structuredClone(a)
    duplicateId.bodies[1]!.planetId = duplicateId.bodies[0]!.planetId
    expect(cleanStellarState({ systems: { [a.id]: duplicateId } })).toBeUndefined()
    b.bodies[0]!.planetId = a.bodies[0]!.planetId
    expect(cleanStellarState(stellar([a, b]))!.systems).toEqual({ [a.id]: a })
  })
  it('父生成器的实际星系快照跨种子完整往返，含两颗行星与无恒星类型', () => {
    const seen = new Set<string>()
    let twoBodies = false
    for (let seed = 0; seed < 150; seed++) {
      const generated = generateStellarSystem(seed)
      const raw = { planets: Object.fromEntries(generated.planets.map(p => [p.id, p])), stellar: stellar([generated.system]) }
      expect(cleanPlanetaryState(raw)).toEqual(raw)
      seen.add(generated.system.kind)
      twoBodies ||= generated.system.bodies.length === 2
    }
    expect(seen.size).toBe(6)
    expect(twoBodies).toBe(true)
  })
})

describe('星球归属、气态禁入和人类保护', () => {
  it.each([{ systemId: 'missing-system' }, { systemId: 'system-v1-1' }, { systemId: '' },
    { systemId: null }, { systemId: 'constructor' }])('被索引星球的错误归属%o丢弃，不变成旧免费世界', changes => {
    const raw = planetary()
    const id = 'system-v1-0-p1'
    raw.planets[id] = { ...raw.planets[id]!, ...changes } as PlanetState
    const back = cleanPlanetaryState(raw)!
    expect(back.planets).not.toHaveProperty(id)
    expect(Object.keys(back.planets)).toHaveLength(7)
  })
  it('无星系归属的旧基地不被新索引的同名引用删除或改写地表标记', () => {
    const raw = planetary()
    const old = planet('legacy-base')
    old.colony = colony()
    old.cells[0]!.building = { id: 'future-building', status: 'construction', powered: false, staffed: false }
    raw.stellar!.systems['system-v1-0']!.bodies[7]!.planetId = old.id
    delete raw.planets['system-v1-0-p8']
    raw.planets[old.id] = old
    const back = roundtrip(raw)
    expect(back.planets[old.id]).toEqual(old)
    expect(back.planets[old.id]).not.toHaveProperty('systemId')
    expect(back.planets[old.id]).not.toHaveProperty('surfaceAllowed')
  })
  it('未列在有效天体索引中的星球不能仅凭星系字符串绕过旧上限', () => {
    const raw = planetary()
    raw.planets['unlisted-planet'] = planet('unlisted-planet', 'system-v1-0', true)
    const invalid = system(1)
    invalid.stars[0]!.x = NaN
    Object.assign(raw.stellar!.systems, { [invalid.id]: invalid })
    raw.planets['system-v1-1-p1'] = planet('system-v1-1-p1', invalid.id, true)
    const back = cleanPlanetaryState(raw)!
    expect(Object.keys(back.planets)).toHaveLength(8)
    expect(back.stellar!.systems).not.toHaveProperty(invalid.id)
  })
  it('气态星球完整保存标准地块但不能施工，false不会被缺省或真假值转换吞掉', () => {
    const raw = planetary()
    const gasId = 'system-v1-0-p8'
    const back = roundtrip(raw)
    const gas = back.planets[gasId]!
    expect(gas).toEqual(raw.planets[gasId])
    expect(gas.cells).toHaveLength(gas.size ** 2)
    expect(gas.surfaceAllowed).toBe(false)
    expect(planetConstructionCheck(gas, 0, 'base', catalog).ok).toBe(false)
    delete raw.planets[gasId]!.surfaceAllowed
    expect(cleanPlanetaryState(raw)!.planets[gasId]!.surfaceAllowed).toBe(false)
    raw.planets[gasId]!.surfaceAllowed = true
    expect(cleanPlanetaryState(raw)!.planets[gasId]!.surfaceAllowed).toBe(false)
    const rockyId = 'system-v1-0-p1'
    raw.planets[rockyId]!.surfaceAllowed = false
    expect(roundtrip(raw).planets[rockyId]!.surfaceAllowed).toBe(false)
  })
  it.each([0, 1, 'false', null])('错误地表标记%o不修成可施工星球', surfaceAllowed => {
    const raw = planetary()
    const id = 'system-v1-0-p1'
    expect(cleanPlanetaryState({ ...raw, planets: { ...raw.planets,
      [id]: { ...raw.planets[id], surfaceAllowed } } })!.planets).not.toHaveProperty(id)
  })
  it.each([{ cells: [] }, { size: 3 }, { seed: -1 }, { hiddenTraitId: 'missing' },
    { cells: Array.from({ length: 16 }, (_, index) => ({ index: index + 1 })) }, { colony: {} }])('新星球坏地表%o沿用原损坏防护，不补空地或殖民地', changes => {
    const raw = planetary()
    const id = 'system-v1-0-p1'
    const back = cleanPlanetaryState({ ...raw, planets: { ...raw.planets, [id]: { ...raw.planets[id], ...changes } } })!
    expect(back.planets).not.toHaveProperty(id)
    expect(back.stellar).toEqual(raw.stellar)
  })
  it('人类发现账在删除候选后不重置，来源坐标与已有基地在往返后仍锁定', () => {
    const raw = planetary([system(), system(1), system(2)])
    raw.runtimeVersion = 1
    raw.humans = { discoveredAtGameMs: 10000.25, sourcePlanetId: 'system-v1-0-p1', sleeping: 3 }
    raw.planets['system-v1-1-p1']!.colony = colony()
    const state = createInitialState({ seed: 7, nowWallMs: 0 })
    state.planetary = roundtrip(raw)
    expect(discardStellarSystem(state, 'system-v1-0')).toEqual({ ok: false, reason: 'protected' })
    expect(discardStellarSystem(state, 'system-v1-1')).toEqual({ ok: false, reason: 'protected' })
    expect(discardStellarSystem(state, 'system-v1-2')).toEqual({ ok: true })
    expect(roundtrip(state.planetary).humans).toEqual(raw.humans)
    expect(state.planetary.humans!.sleeping).toBe(3)
  })
})

describe('搜索任务与随机序号保存', () => {
  it.each(['random', 'specified'] as const)('%s任务两次往返保留目标、暂停、工期和完成进度，不立即发星系', mode => {
    const s = stellar([], { search: search({ mode, progressMs: SIX_HOURS }), searchSeq: 20, autoSearch: true, stoppedReason: 'capacity' })
    const raw = { planets: {}, stellar: s }
    expect(roundtrip(roundtrip(raw))).toEqual(raw)
    expect(roundtrip(raw).stellar!.systems).toEqual({})
  })
  it.each([0, 1, 3, 7, MAX])('全局序号%i至少达到待处理任务序号，不重新抽坐标', searchSeq => {
    const s = stellar([], { search: search({ seq: 7 }), searchSeq })
    const back = cleanStellarState(s)!
    expect(back.searchSeq).toBe(Math.max(searchSeq, 7))
    expect(back.search).toEqual(s.search)
  })
  it.each([1000, SIX_HOURS, 1000.5])('合法搜索工期%o及零进度保留', durationMs => {
    expect(cleanStellarState(stellar([], { search: search({ durationMs, progressMs: 0, paused: false }) }))!.search)
      .toEqual(search({ durationMs, progressMs: 0, paused: false }))
  })
  it.each([{ seq: 0 }, { seq: -1 }, { seq: .5 }, { seq: MAX + 1 }, { mode: 'unknown' }, { seed: -1 },
    { seed: .5 }, { seed: 0x100000000 }, { seed: '0' }, { durationMs: 999 }, { durationMs: SIX_HOURS + 1 },
    { durationMs: Infinity }, { progressMs: -1 }, { progressMs: NaN }, { progressMs: SIX_HOURS + 1 },
    { paused: 1 }, { paused: 'false' }])('坏任务%o丢弃，不完成、不重发机或改抽目标', changes => {
    const back = cleanStellarState({ ...stellar(), searchSeq: 21, search: { ...search(), ...changes } })!
    expect(back).toEqual(stellar([], { searchSeq: 21 }))
  })
  it('损坏任务仍保存可验证的已耗随机序号，防止清洗后复用随机序列', () => {
    expect(cleanStellarState({ systems: {}, searchSeq: 2, search: { ...search({ seq: 40 }), durationMs: 0 } }))
      .toEqual(stellar([], { searchSeq: 40 }))
  })
  it.each([-1, .5, NaN, Infinity, MAX + 1, '2', null])('坏计数%o不保留为非法数字或向上补免费结果', searchSeq => {
    expect(cleanStellarState({ ...stellar(), searchSeq })).toEqual(stellar())
  })
  it.each(['capacity', 'probe-stock'] as const)('停止原因%s及严格布尔开关保留', stoppedReason => {
    const raw = stellar([], { autoSearch: false, stoppedReason })
    expect(cleanStellarState(raw)).toEqual(raw)
    expect(cleanStellarState({ ...raw, autoSearch: 'true' })!.autoSearch).toBe(false)
    expect(cleanStellarState({ ...raw, stoppedReason: 'unknown' })).not.toHaveProperty('stoppedReason')
  })
  it.each([[' 0000 ', 0], ['0000000042', 42], ['4294967295', 0xffffffff],
    ['-1', undefined], ['1.5', undefined], ['1e3', undefined], ['4294967296', undefined], ['', undefined]] as const)('输入%s规范化为%o，保存时不重新解析或改目标', (input, expected) => {
    expect(parseStellarSeed(input)).toBe(expected)
    if (expected !== undefined) {
      const raw = { planets: {}, stellar: stellar([], { search: search({ seed: expected }), searchSeq: 3 }) }
      expect(roundtrip(raw)).toEqual(raw)
    }
  })
})

describe('星系存档污染防护与副本隔离', () => {
  it('污染键、继承字段和额外字段不写回，未知合法星球或材料编号仍保留', () => {
    const raw = planetary()
    const s = raw.stellar!.systems['system-v1-0']!
    Object.assign(raw.stellar!.systems, JSON.parse('{"__proto__":{},"constructor":{},"prototype":{}}'))
    const back = cleanPlanetaryState({ ...raw, freeMoney: 10, stellar: { ...raw.stellar, freeMoney: 10,
      search: { ...search(), freeMoney: 10 }, systems: { ...raw.stellar!.systems,
        [s.id]: { ...s, freeMoney: 10, stars: s.stars.map(star => ({ ...star, freeMoney: 10 })),
          bodies: s.bodies.map(body => ({ ...body, freeMoney: 10 })) } } } })!
    expect(Object.keys(back.stellar!.systems)).toEqual([s.id])
    expect(JSON.stringify(back)).not.toContain('freeMoney')
    expect(Object.getPrototypeOf(back.stellar!.systems)).toBe(Object.prototype)
    expect(cleanStellarState(Object.create(stellar([s])))).toBeUndefined()
    expect(cleanStellarState({ systems: { [s.id]: Object.create(s) } })).toBeUndefined()
    expect(cleanStellarState({ search: Object.create(search()) })).toBeUndefined()
    expect(cleanStellarState({ systems: { [s.id]: { ...s, bodies: [Object.create(s.bodies[0]!), ...s.bodies.slice(1)] } } })).toBeUndefined()
  })
  it('未来身份污染键也拒绝，不能通过未知规则版本绕过', () => {
    const s = system()
    for (const id of ['__proto__', 'constructor', 'prototype']) {
      expect(cleanStellarState({ systems: Object.fromEntries([[id, { ...s, id, generationVersion: 99 }]]) })).toBeUndefined()
    }
  })
  it('清洗不改输入，星系、恒星、行星、搜索、地表和殖民副本无嵌套引用泄漏', () => {
    const raw = planetary()
    raw.stellar!.search = search()
    raw.stellar!.searchSeq = 3
    raw.planets['system-v1-0-p1']!.colony = colony()
    const before = structuredClone(raw)
    const back = cleanPlanetaryState(raw)!
    const s = back.stellar!.systems['system-v1-0']!
    s.stars[0]!.x = 0
    s.bodies[0]!.x = 0
    s.bodies.push({ ...s.bodies[0]!, ordinal: 9 })
    back.stellar!.search!.progressMs = 0
    back.planets['system-v1-0-p1']!.cells[0]!.obstacle = 'ice'
    back.planets['system-v1-0-p1']!.colony!.sleeping = 99
    expect(raw).toEqual(before)
  })
})
