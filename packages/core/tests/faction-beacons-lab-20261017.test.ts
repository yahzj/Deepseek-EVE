import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { availableInvasionBeacons, INVASION_BEACON_TYPES, invasionBeaconTypeOf, useInvasionBeacon, useSynapticAccelerant } from '../src/consumables'
import { startLabRun, advanceLab, stopLabRun } from '../src/lab'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { blackMarketCandidateGoods } from '../src/blackMarket'
import { beaconTargetBlocked } from '../src/consumables'
import { securityZoneOf } from '../src/securityZone'
import { trainingTimeFactor } from '../src/training'

const ctx = buildSimContext()
const specific = INVASION_BEACON_TYPES.filter(row => row.familyId !== undefined)
function ready() {
  const state = createInitialState({ nowWallMs: 0, seed: 41 })
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.weekendEvent = undefined
  for (const row of INVASION_BEACON_TYPES) state.warehouse.items[row.itemId] = 2
  return state
}
function target(state: ReturnType<typeof ready>, high: boolean) {
  return [...ctx.galaxies.keys()].find(id => !beaconTargetBlocked(state, ctx, id) && (securityZoneOf(ctx, id) === '高安') === high)!
}

describe('四族专属发射器与旧发射器共源', () => {
  it('固定四族、未知物品不误认，只有库存中的类型出现在下拉', () => {
    expect(specific.map(row => row.familyId)).toEqual(['R', 'C', 'H', 'D'])
    expect(invasionBeaconTypeOf('other')).toBeUndefined()
    const state = ready()
    state.warehouse.items['invasion-beacon'] = 0
    state.warehouse.items['invasion-beacon-r'] = 0
    state.fleet[state.shipId]!.cargo['invasion-beacon-r'] = 1
    const options = availableInvasionBeacons(state)
    expect(options.map(row => row.itemId)).toEqual(specific.map(row => row.itemId))
    expect(options[0]!.units).toBe(1)
  })

  it.each(specific)('$itemId：随机与指定落点均固定势力，只扣选中物品一枚', ({ itemId, familyId }) => {
    for (const chosen of [false, true]) {
      const state = ready(), galaxyId = chosen ? target(state, false) : undefined
      expect(useInvasionBeacon(state, ctx, { itemId, galaxyId }).ok).toBe(true)
      expect(state.weekendEvent!.family).toBe(familyId)
      if (galaxyId) expect(state.weekendEvent!.coreId).toBe(galaxyId)
      for (const row of INVASION_BEACON_TYPES) expect(state.warehouse.items[row.itemId]).toBe(row.itemId === itemId ? 1 : 2)
      const loaded = loadSaveFile(serializeSaveFile(state)).state
      expect(loaded.weekendEvent!.family).toBe(familyId)
    }
  })

  it('指定类型库存耗尽不扣旧发射器；失败与冲突势力保持原档', () => {
    const state = ready()
    state.warehouse.items['invasion-beacon-d'] = 0
    let before = JSON.stringify(state)
    expect(useInvasionBeacon(state, ctx, { itemId: 'invasion-beacon-d' }).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    before = JSON.stringify(state)
    expect(useInvasionBeacon(state, ctx, { itemId: 'invasion-beacon-h', familyId: 'D' }).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    expect(useInvasionBeacon(state, ctx, { itemId: 'ghost' }).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('高安扣10声望，已进行入侵/空间站目标/声望不足均零消耗', () => {
    const state = ready(), id = 'invasion-beacon-d'
    const high = target(state, true)
    state.standings.dsi = 9
    const before = JSON.stringify(state)
    expect(useInvasionBeacon(state, ctx, { itemId: id, galaxyId: high }).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    state.standings.dsi = 10
    expect(useInvasionBeacon(state, ctx, { itemId: id, galaxyId: high }).ok).toBe(true)
    expect(state.standings.dsi).toBe(0)
    expect(state.weekendEvent!.family).toBe('D')
    const active = JSON.stringify(state)
    expect(useInvasionBeacon(state, ctx, { itemId: 'invasion-beacon-r' }).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(active)
    const station = ready(), old = JSON.stringify(station)
    expect(useInvasionBeacon(station, ctx, { itemId: id, galaxyId: 'galaxy-hub' }).ok).toBe(false)
    expect(JSON.stringify(station)).toBe(old)
  })
})

describe('专属配方与MK1兼容', () => {
  it.each(specific)('$itemId：四倍虚空晶、五倍总料价取整、两小时，合法开工/取消/交付', ({ itemId }) => {
    const recipe = ctx.labRecipes.get(itemId)!, old = ctx.labRecipes.get('invasion-beacon')!
    expect(recipe.category).toBe('beacon')
    expect(recipe.materials).toEqual([
      { itemId: 'min-voidcrystal', units: 40000 }, { itemId: 'part-qchip', units: 2000 },
      { itemId: 'part-circuit', units: 18000 }, { itemId: 'part-grav-comp', units: 8859 },
    ])
    const price = (r: typeof recipe) => r.materials.reduce((n, row) => n + ctx.items.get(row.itemId)!.baseSellPriceIsk * row.units, 0)
    expect(price(recipe)).toBe(285552500)
    expect(price(recipe) - price(old) * 5).toBe(2500)
    expect(recipe.cycleMs).toBe(7200000)
    expect(recipe.outputUnits).toBe(1)
    const state = ready()
    state.warehouse.items[itemId] = 0
    for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    for (const m of recipe.materials) state.warehouse.items[m.itemId] = m.units
    expect(startLabRun(state, ctx, itemId, 'pilot').ok).toBe(true)
    const pending = loadSaveFile(serializeSaveFile(state)).state
    expect(stopLabRun(pending, ctx, pending.labRuns![0]!.id).ok).toBe(true)
    for (const m of recipe.materials) expect(pending.warehouse.items[m.itemId]).toBe(m.units)
    state.gameMs = state.labRuns![0]!.finishAtGameMs
    advanceLab(state, ctx)
    expect(state.warehouse.items[itemId]).toBe(1)
    expect(state.labRuns).toHaveLength(0)
    expect(ctx.marketGoods.get(itemId)).toMatchObject({ playerBuyable: false, basePrice: 480000000 })
    expect(blackMarketCandidateGoods(ctx).some(g => g.refId === itemId)).toBe(false)
  })

  it('配方均登记筛选域；MK1保留ID、时长与倍率，新批次2100虚空晶，旧批取消仍按原账退', () => {
    expect([...ctx.labRecipes.values()].every(r => r.category)).toBe(true)
    expect([...ctx.labRecipes.values()].filter(r => r.category === 'beacon')).toHaveLength(5)
    const mk1 = ctx.labRecipes.get('synaptic-accelerant')!
    expect(mk1.name).toBe('突触加速剂 MK1')
    expect(mk1.materials.find(m => m.itemId === 'min-voidcrystal')!.units).toBe(2100)
    expect(buildSimContext('en').labRecipes.get(mk1.id)!.name).toBe('Synaptic Accelerant MK1')
    const state = ready()
    state.warehouse.items[mk1.outputItemId] = 1
    expect(useSynapticAccelerant(state).ok).toBe(true)
    expect(state.skillBoostUntilMs).toBe(24 * 3600000)
    expect(trainingTimeFactor(state)).toBe(.5)
    state.labRuns = [{ id: 1, active: true, worker: 'pilot', recipeId: mk1.id, cycleMs: 1800000, batchUnits: 1,
      finishAtGameMs: 1800000, spentMaterials: [{ itemId: 'min-voidcrystal', count: 2000 }] }]
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    expect(stopLabRun(loaded, ctx, 1).ok).toBe(true)
    expect(loaded.warehouse.items['min-voidcrystal']).toBe(2000)
  })
})
