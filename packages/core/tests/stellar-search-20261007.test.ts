import { describe, expect, it } from 'vitest'
import { buildPlanetCatalog, buildSimContext } from '@whale/data'
import { createInitialState, generateStellarSystem, stellarSystemId, parseStellarSeed, beginStellarSearch,
  advanceStellarSearch, pauseStellarSearch, cancelStellarSearch, setStellarAutoSearch, stellarCapacity,
  stellarSearchDuration, discardStellarSystem, stellarCandidateCount, planetConstructionCheck,
  preparePlanetBase, surveyPlanet, advanceGame, discoverPlanet, stellarSystemDeveloped, startManufacturing,
  advancePlanetary, createPlanetColony, startPlanetBuild, loadSaveFile, serializeSaveFile, addShipToFleet,
  dispatchPlanetDelivery, travelLegMs } from '../src/index'
const catalog = buildPlanetCatalog()
function setup(seed = 7) {
  const state = createInitialState({ seed, nowWallMs: 0 })
  state.planetary = { planets: {}, runtimeVersion: 1 }
  state.warehouse.items['deep-space-probe'] = 30
  return state
}
describe('版本化星系生成', () => {
  it.each([0, 1, 7, 982, 0xffffffff])('种子%i可复现，不引用玩家档案', seed => {
    expect(generateStellarSystem(seed)).toEqual(generateStellarSystem(seed))
    const a = setup(1), b = setup(200)
    beginStellarSearch(a, 'specified', String(seed)); beginStellarSearch(b, 'specified', String(seed))
    advanceStellarSearch(a, 6 * 3600000); advanceStellarSearch(b, 6 * 3600000)
    expect(a.planetary!.stellar!.systems).toEqual(b.planetary!.stellar!.systems)
    expect(a.planetary!.planets).toEqual(b.planetary!.planets)
  })
  it('1000种子均有固态表面且布局有界，六种类型均出现，无矛盾温度', () => {
    const kinds = new Set<string>()
    for (let seed = 0; seed < 1000; seed++) {
      const g = generateStellarSystem(seed)
      kinds.add(g.system.kind)
      expect(g.system.bodies.length).toBeGreaterThanOrEqual(2)
      expect(g.system.bodies.length).toBeLessThanOrEqual(8)
      expect(g.planets.some(p => p.surfaceAllowed)).toBe(true)
      expect(g.system.routeMinutes).toBeGreaterThanOrEqual(20)
      expect(g.system.routeMinutes).toBeLessThanOrEqual(120)
      for (const body of g.system.bodies) {
        const p = g.planets.find(p => p.id === body.planetId)!
        expect(p.systemId).toBe(g.system.id)
        expect(p.cells).toHaveLength(p.size * p.size)
        expect(body.x).toBeGreaterThanOrEqual(150); expect(body.x).toBeLessThanOrEqual(850)
        expect(body.y).toBeGreaterThanOrEqual(40); expect(body.y).toBeLessThanOrEqual(660)
        const environments = p.traitIds.filter(id => catalog.traits.get(id)?.kind === 'environment')
        expect(environments.length).toBeGreaterThanOrEqual(2); expect(environments.length).toBeLessThanOrEqual(4)
        if (body.kind === 'lava') { expect(p.traitIds).not.toContain('cold'); expect(p.traitIds).not.toContain('fertile-soil'); expect(p.traitIds).not.toContain('ice-deposits'); expect(p.traitIds).toContain('hot') }
        if (body.kind === 'ice') expect(p.traitIds).not.toContain('hot')
        if (body.kind === 'gas') { p.survey = 3; expect(planetConstructionCheck(p, 0, 'base', catalog)).toEqual({ ok: false, reason: 'no-surface' }); expect(preparePlanetBase(p, catalog).ok).toBe(false) }
      }
    }
    expect(kinds.size).toBe(6)
  })
  it.each(['-1', '1.2', '1e3', '', '4294967296', 'NaN', '0x12'])('非法种子%s拒绝', value => expect(parseStellarSeed(value)).toBeUndefined())
  it('种子零、空格和前导零合法，生成器非法数字拒绝', () => {
    expect(parseStellarSeed(' 0007 ')).toBe(7)
    expect(parseStellarSeed('0')).toBe(0)
    expect(() => generateStellarSystem(NaN)).toThrow('invalid-stellar-seed')
  })
})
describe('探测任务资源与时间', () => {
  it('派出扣一架，目标与时长锁定；暂停续搜不二扣，放弃不返机', () => {
    const s = setup()
    expect(beginStellarSearch(s, 'specified', '7').ok).toBe(true)
    expect(s.warehouse.items['deep-space-probe']).toBe(29)
    expect(s.planetary!.stellar!.search!.seed).toBe(7)
    s.skills.trained['deep-space-probing'] = 5
    expect(s.planetary!.stellar!.search!.durationMs).toBe(6 * 3600000)
    advanceStellarSearch(s, 3600000)
    pauseStellarSearch(s, true); advanceStellarSearch(s, 8 * 3600000)
    expect(s.planetary!.stellar!.search!.progressMs).toBe(3600000)
    pauseStellarSearch(s, false); advanceStellarSearch(s, 5 * 3600000)
    expect(s.planetary!.stellar!.systems[stellarSystemId(7)]).toBeDefined()
    expect(s.warehouse.items['deep-space-probe']).toBe(29)
    beginStellarSearch(s, 'random'); const probes = s.warehouse.items['deep-space-probe']
    cancelStellarSearch(s); expect(s.warehouse.items['deep-space-probe']).toBe(probes)
  })
  it('失败不扣、不改变状态，已有坐标幂等免费定位不重生成', () => {
    const s = setup(), before = structuredClone(s)
    expect(beginStellarSearch(s, 'specified', '-1').ok).toBe(false); expect(s).toEqual(before)
    s.warehouse.items['deep-space-probe'] = 0
    const noProbe = structuredClone(s); expect(beginStellarSearch(s, 'random').ok).toBe(false); expect(s).toEqual(noProbe)
    s.warehouse.items['deep-space-probe'] = 2
    beginStellarSearch(s, 'specified', '0'); advanceStellarSearch(s, 6 * 3600000)
    const id = Object.keys(s.planetary!.planets)[0]!
    s.planetary!.planets[id]!.survey = 3
    const snap = structuredClone(s)
    expect(beginStellarSearch(s, 'specified', '0000').ok).toBe(true); expect(s).toEqual(snap)
  })
  it('连续随机搜索在容量／耗材边界停机，任务序号与全局随机独立', () => {
    const s = setup(), rng = { ...s.rng }
    s.debugQuick = true
    setStellarAutoSearch(s, true); beginStellarSearch(s, 'random')
    advanceStellarSearch(s, 20000)
    expect(stellarCandidateCount(s)).toBe(5)
    expect(s.warehouse.items['deep-space-probe']).toBe(25)
    expect(s.planetary!.stellar!.search).toBeUndefined()
    expect(s.planetary!.stellar!.stoppedReason).toBe('capacity')
    expect(s.rng).toEqual(rng)
    expect(new Set(Object.keys(s.planetary!.stellar!.systems)).size).toBe(5)
  })
  it('在线小步与离线长步相同，进度不额外加一轮', () => {
    const a = setup(), b = setup(); a.debugQuick = b.debugQuick = true
    setStellarAutoSearch(a, true); setStellarAutoSearch(b, true); beginStellarSearch(a, 'random'); beginStellarSearch(b, 'random')
    advanceStellarSearch(a, 3500)
    for (let i = 0; i < 35; i++) advanceStellarSearch(b, 100)
    expect(a.planetary).toEqual(b.planetary)
  })
  it('新坐标可以勘探，不需要伪造旧星图探索；正常新档无免费探测或星系', () => {
    const s = setup(); beginStellarSearch(s, 'specified', '7'); advanceStellarSearch(s, 6 * 3600000)
    const p = Object.values(s.planetary!.planets)[0]!
    expect(surveyPlanet(s, catalog, p.id, 2).ok).toBe(true)
    const plain = createInitialState({ seed: 7, nowWallMs: 0 })
    advanceGame(plain, 6 * 3600000, buildSimContext())
    expect(plain.planetary).toBeUndefined()
  })
  it('四项技能数量／周期隔离，不改原扫描技能', () => {
    const s = setup()
    expect(stellarCapacity(s)).toBe(5); expect(stellarSearchDuration(s)).toBe(6 * 3600000)
    s.skills.trained['signal-analysis'] = 5; expect(stellarSearchDuration(s)).toBe(6 * 3600000)
    s.skills.trained['deep-space-probing'] = 5; s.skills.trained['advanced-deep-space-probing'] = 5; s.skills.trained['stellar-archive'] = 5
    expect(stellarCapacity(s)).toBe(15); expect(stellarSearchDuration(s)).toBe(3 * 3600000)
  })
  it('非法技能等级和耗尽序号不产生NaN任务，不扣机', () => {
    const s = setup()
    s.skills.trained['deep-space-probing'] = NaN; s.skills.trained['stellar-archive'] = Infinity
    expect(stellarCapacity(s)).toBe(5); expect(stellarSearchDuration(s)).toBe(6 * 3600000)
    s.planetary!.stellar = { systems: {}, searchSeq: Number.MAX_SAFE_INTEGER, autoSearch: false }
    const before = structuredClone(s)
    expect(beginStellarSearch(s, 'random').ok).toBe(false); expect(s).toEqual(before)
  })
  it('空整备与失败施工不释放候选，基地建成后才永久开发', () => {
    const s = setup(); beginStellarSearch(s, 'specified', '7'); advanceStellarSearch(s, 6 * 3600000)
    const p = Object.values(s.planetary!.planets)[0]!, id = p.systemId!
    p.survey = 3; preparePlanetBase(p, catalog)
    expect(stellarSystemDeveloped(s, id)).toBe(false); expect(stellarCandidateCount(s)).toBe(1)
    const index = p.cells.find(c => !c.obstacle)!.index
    expect(startPlanetBuild(p, catalog, index, 'base').ok).toBe(false)
    expect(stellarCandidateCount(s)).toBe(1)
    p.cells[index]!.building = { id: 'base', status: 'ready', powered: true, staffed: false }
    advancePlanetary(s, 10000, catalog)
    expect(stellarCandidateCount(s)).toBe(0); expect(s.planetary!.stellar!.systems[id]!.developed).toBe(true)
    expect(loadSaveFile(serializeSaveFile(s, 0)).state.planetary!.stellar!.systems[id]!.developed).toBe(true)
  })
  it('超过64颗新星球仍可发现旧候选；未知版本勘探与混合物流冻结', () => {
    const s = setup()
    for (let seed = 0; seed < 20; seed++) {
      const g = generateStellarSystem(seed)
      s.planetary!.stellar ??= { systems: {}, searchSeq: 0, autoSearch: false }
      s.planetary!.stellar.systems[g.system.id] = g.system
      for (const p of g.planets) s.planetary!.planets[p.id] = p
    }
    expect(Object.keys(s.planetary!.planets).length).toBeGreaterThan(64)
    const legacy = [...catalog.planets.values()][0]!
    s.exploredGalaxies.push(legacy.galaxyId)
    expect(discoverPlanet(s, catalog, legacy.id).ok).toBe(true)
    const p = s.planetary!.planets['system-v1-0-p1']!, system = s.planetary!.stellar!.systems[p.systemId!]!
    system.generationVersion = 99 as 1
    expect(surveyPlanet(s, catalog, p.id, 3)).toEqual({ ok: false, reason: 'unsupported' })
    p.colony = createPlanetColony()
    const normal = s.planetary!.planets[legacy.id]!
    normal.survey = 3; normal.colony = createPlanetColony()
    s.planetary!.deliveries = [{ seq: 1, planetId: p.id, shipUid: s.shipId, items: { 'part-coolant': 2 }, credits: 30, humans: 1, remainingMs: 10000, durationMs: 10000 }]
    const before = structuredClone(p), delivery = structuredClone(s.planetary!.deliveries)
    advancePlanetary(s, 10000, catalog)
    expect(p).toEqual(before); expect(s.planetary!.deliveries).toEqual(delivery)
  })
  it.each([1, 7])('制造在第%i小时完成时，长步与小时分片的连续搜索一致', manufacturingHours => {
    const ctx = buildSimContext(), a = setup()
    a.warehouse.items['deep-space-probe'] = 1
    const bp = ctx.blueprints.get('bp-deep-space-probe')!
    for (const m of bp.materials) a.warehouse.items[m.itemId] = m.count
    expect(startManufacturing(a, bp.id, 'pilot', ctx).ok).toBe(true)
    a.manufacturingRuns[0]!.finishAtGameMs = manufacturingHours * 3600000
    a.manufacturingRuns[0]!.durationMs = manufacturingHours * 3600000
    setStellarAutoSearch(a, true); beginStellarSearch(a, 'random')
    const b = structuredClone(a)
    advanceGame(a, 8 * 3600000, ctx, { offline: true })
    for (let h = 0; h < 8; h++) advanceGame(b, 3600000, ctx, { offline: true })
    expect(a.planetary).toEqual(b.planetary)
    expect(a.warehouse.items['deep-space-probe']).toBe(b.warehouse.items['deep-space-probe'])
    if (manufacturingHours === 1) expect(a.planetary!.stellar!.search!.progressMs).toBe(2 * 3600000)
    else { expect(a.planetary!.stellar!.search).toBeUndefined(); expect(a.warehouse.items['deep-space-probe']).toBe(1) }
  })
  it('基地先建成再收到搜索结果时，长步不会误停在候选容量', () => {
    const a = setup()
    a.planetary!.stellar = { systems: {}, searchSeq: 0, autoSearch: false }
    for (let seed = 0; seed < 5; seed++) {
      const g = generateStellarSystem(seed)
      a.planetary!.stellar.systems[g.system.id] = g.system
      for (const p of g.planets) a.planetary!.planets[p.id] = p
    }
    const p = a.planetary!.planets['system-v1-0-p1']!
    p.survey = 3; p.colony = createPlanetColony()
    const index = p.cells.find(c => !c.obstacle)!.index
    p.cells[index]!.building = { id: 'base', status: 'construction', powered: false, staffed: false, condition: 1 }
    p.colony.jobs = [{ seq: 1, kind: 'build', cellIndex: index, buildingId: 'base', remainingMs: 10000, totalMs: 10000,
      spentItems: {}, spentCredits: 1, paused: false }]
    a.planetary!.stellar.search = { mode: 'specified', seed: 50, seq: 1, durationMs: 20000, progressMs: 0, paused: false }
    const b = structuredClone(a)
    advancePlanetary(a, 20000, catalog)
    advancePlanetary(b, 10000, catalog); advancePlanetary(b, 10000, catalog)
    expect(a.planetary).toEqual(b.planetary)
    expect(a.planetary!.stellar.systems['system-v1-50']).toBeDefined()
  })
  it('新航路按种子与实船速度计程，实际扣料和到货，旧路径不伪造节点', () => {
    const ctx = buildSimContext(), state = setup(), g = generateStellarSystem(7)
    state.planetary!.stellar = { systems: { [g.system.id]: g.system }, searchSeq: 0, autoSearch: false }
    for (const p of g.planets) state.planetary!.planets[p.id] = p
    const p = g.planets[0]!
    p.survey = 3
    const uid = addShipToFleet(state, 'sh-manatee')
    state.warehouse.items['part-coolant'] = 10; state.wallet.isk = 100
    expect(ctx.galaxies.has(g.system.id)).toBe(false)
    expect(dispatchPlanetDelivery(state, ctx, catalog, p.id, uid, { 'part-coolant': 2 }, 30, 0).ok).toBe(true)
    expect(state.warehouse.items['part-coolant']).toBe(8); expect(state.wallet.isk).toBe(70)
    const trip = state.planetary!.deliveries![0]!
    expect(trip.durationMs).toBe(Math.max(10000, 2 * travelLegMs(state, ctx, g.system.routeMinutes, uid)))
    expect(p.colony!.items['part-coolant']).toBeUndefined()
    const expected = Math.ceil(trip.durationMs / 10000) * 10000
    advancePlanetary(state, expected - 10000, catalog)
    expect(p.colony!.items['part-coolant']).toBeUndefined()
    advancePlanetary(state, 10000, catalog)
    expect(p.colony!.items['part-coolant']).toBe(2); expect(p.colony!.credits).toBe(30)
    expect(state.planetary!.deliveries).toHaveLength(0)
    const slow = travelLegMs(state, ctx, g.system.routeMinutes, uid)
    state.skills.trained['spaceship-command'] = 5
    expect(travelLegMs(state, ctx, g.system.routeMinutes, uid)).toBeLessThan(slow)
  })
  it('候选可放弃，已开发或人类来源锁定，不能销毁建设', () => {
    const s = setup(); beginStellarSearch(s, 'specified', '7'); advanceStellarSearch(s, 6 * 3600000)
    const id = stellarSystemId(7), p = Object.values(s.planetary!.planets)[0]!
    p.colony = undefined
    expect(discardStellarSystem(s, id).ok).toBe(true)
    beginStellarSearch(s, 'specified', '7'); advanceStellarSearch(s, 6 * 3600000)
    const recovered = Object.values(s.planetary!.planets)[0]!
    preparePlanetBase({ ...recovered, survey: 3 }, catalog)
    s.planetary!.stellar!.systems[id]!.developed = true
    expect(discardStellarSystem(s, id).ok).toBe(false)
  })
})
