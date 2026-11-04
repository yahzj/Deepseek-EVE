import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { wormholeMakeGrid } from '../src/wormholeGrid'
import { ENCRYPTED_FAMILIES, encryptedBlueprintGroups, encryptedFamilyOf } from '../src/encryptedContainer'
import { wormholeUnboxRoll, wormholeResearchBox, wormholeRelicBoxPoolOf, wormholeSalvageAt, wormholeHoldCapacityOf } from '../src/wormholeSalvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { wormholeEnter } from '../src/wormhole'
import { startUnboxRun } from '../src/industry/refining/unbox'
import { advanceRefining } from '../src/industry/refining/advance'
import { finishDeparture } from './helpers/departure-ready'
import { addShipToFleet } from '../src/fleetBook'
import { wormholeShapeOf } from '../src/wormholeHold'
import { startManufacturing, advanceManufacturing, cancelManufacturing } from '../src/manufacturing'
import { learnBlueprint } from '../src/market'
import { rareWreckItemIdOfCard } from '../src/salvage'

const ctx = buildSimContext()
function researchWorld(seed = 19) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.shipId = addShipToFleet(state, 'sh-manatee')
  expect(wormholeEnter(state, ctx, [state.shipId], seed, { family: 'A' }).ok).toBe(true)
  finishDeparture(state, ctx)
  state.fleet[state.shipId]!.fitted.high = ['mod-salvager-1']
  const run = state.wormhole.run!
  run.depth = 8
  run.grid = wormholeMakeGrid(seed, 8)
  const grid = run.grid
  const cell = grid.cells.find(row => row.key !== `${grid.start.q},${grid.start.r}` && row.key !== `${grid.exit.q},${grid.exit.r}`)!
  cell.place = 'ruins'; cell.researchLab = true
  grid.pos = { q: cell.q, r: cell.r }
  grid.visited.push(cell.key)
  cell.piles = Array.from({ length: 5 }, () => ({ itemId: rareWreckItemIdOfCard('wh-pirate-scout')!, units: 1 }))
  cell.resourcePilesGenerated = true
  return { state, run, grid, cell }
}
describe('生产研究所与势力加密货柜', () => {
  it('仅第8层起可生成，分布接近每层20%，不覆盖入口出口或旧玩法', () => {
    let labs = 0
    for (let seed = 1; seed <= 1000; seed++) {
      for (const depth of [7, 8, 9]) {
        const grid = wormholeMakeGrid(seed, depth)
        const found = grid.cells.filter(cell => cell.researchLab)
        expect(found.length).toBeLessThanOrEqual(1)
        if (depth === 7) expect(found).toHaveLength(0)
        if (depth === 8) labs += found.length
        for (const cell of found) {
          expect(cell.place).toBe('ruins')
          expect(cell.key).not.toBe(`${grid.start.q},${grid.start.r}`)
          expect(cell.key).not.toBe(`${grid.exit.q},${grid.exit.r}`)
        }
      }
      expect(wormholeMakeGrid(seed, 8, 0, 1, 2).cells.some(cell => cell.researchLab)).toBe(false)
    }
    expect(labs).toBeGreaterThan(150)
    expect(labs).toBeLessThan(250)
  })
  it.each(ENCRYPTED_FAMILIES)('%s柜仅出本族一次性图纸，1至3张且允许重复', family => {
    const box = `box-encrypted-${family.toLowerCase()}`
    const groups = encryptedBlueprintGroups(ctx, family)!
    const expected = new Set(groups.flat())
    expect(groups.map(group => group.length)).toEqual([2, family === 'C' || family === 'D' ? 2 : 1, 3])
    expect(encryptedFamilyOf(box)).toBe(family)
    expect(wormholeRelicBoxPoolOf(ctx, 8, family)).not.toContain(box)
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    const counts = new Set<number>()
    let duplicate = false
    for (let i = 0; i < 300; i++) {
      const result = wormholeUnboxRoll(state, ctx, box)!
      const ids = [result.itemId, ...(result.extra ?? []).map(row => row.itemId)]
      counts.add(ids.length)
      duplicate ||= new Set(ids).size < ids.length
      for (const id of ids) expect(expected.has(id)).toBe(true)
    }
    expect([...counts].sort()).toEqual([1, 2, 3])
    expect(duplicate).toBe(true)
  })
  it('研究所保底非贵重品，约15%为本趟势力加密柜', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    expect(wormholeEnter(state, ctx, [state.shipId], 7, { family: 'C' }).ok).toBe(true)
    finishDeparture(state, ctx)
    state.wormhole.run!.depth = 8
    const cell = state.wormhole.run!.grid!.cells[0]!
    cell.place = 'ruins'
    cell.researchLab = true
    let encrypted = 0
    for (let seed = 1; seed <= 1000; seed++) {
      state.wormhole.run!.seed = seed
      const box = wormholeResearchBox(state, ctx, cell)!
      expect(box).toBeTruthy()
      expect(box).not.toBe('box-valuables')
      if (box.startsWith('box-encrypted-')) { expect(box).toBe('box-encrypted-c'); encrypted++ }
    }
    expect(encrypted).toBeGreaterThan(110)
    expect(encrypted).toBeLessThan(190)
  })
  it('研究所标记及拆解结果序号存读保真，实际产出入图纸库存', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    expect(wormholeEnter(state, ctx, [state.shipId], 42, { family: 'A' }).ok).toBe(true)
    finishDeparture(state, ctx)
    const grid = state.wormhole.run!.grid!
    grid.cells[0]!.place = 'ruins'
    grid.cells[0]!.researchLab = true
    let loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.wormhole.run!.grid!.cells[0]!.researchLab).toBe(true)
    loaded.wormhole.run = null
    loaded.warehouse.items['box-encrypted-a'] = 1
    expect(startUnboxRun(loaded, ctx, 'box-encrypted-a', 'pilot').ok).toBe(true)
    loaded = loadSaveFile(serializeSaveFile(loaded, 0)).state
    loaded.gameMs = loaded.refineRuns[0]!.finishAtGameMs
    advanceRefining(loaded, ctx)
    const sum = Object.entries(loaded.blueprintStock).filter(([id]) => encryptedBlueprintGroups(ctx, 'A')!.flat().includes(id)).reduce((n, [, count]) => n + count, 0)
    expect(sum).toBeGreaterThanOrEqual(1)
    expect(sum).toBeLessThanOrEqual(3)
    expect(loaded.warehouse.items['box-encrypted-a'] ?? 0).toBe(0)
    expect(loaded.rng.box).toBe(1)
  })
  it('奖池缺失时不扣箱、不消耗开箱序号，已运行产线也安全停止', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.warehouse.items['box-encrypted-a'] = 1
    const broken = { ...ctx, blueprints: new Map(ctx.blueprints) }
    broken.blueprints.delete('bp-wh-a-frag')
    expect(startUnboxRun(state, broken, 'box-encrypted-a', 'pilot').ok).toBe(false)
    expect(state.warehouse.items['box-encrypted-a']).toBe(1)
    expect(state.rng.box ?? 0).toBe(0)
    expect(startUnboxRun(state, ctx, 'box-encrypted-a', 'pilot').ok).toBe(true)
    state.gameMs = state.refineRuns[0]!.finishAtGameMs
    advanceRefining(state, broken)
    expect(state.warehouse.items['box-encrypted-a']).toBe(1)
    expect(state.rng.box ?? 0).toBe(0)
    expect(state.refineRuns).toHaveLength(0)
  })
  it('真实首捞保底一柜，继续打捞和读档后不重复领取，正常地点不出加密柜', () => {
    const { state, cell } = researchWorld()
    const first = wormholeSalvageAt(state, ctx)
    expect(first.ok).toBe(true)
    expect(first.relics).toHaveLength(1)
    expect(first.relics![0]).not.toBe('box-valuables')
    expect(first.boxes).toHaveLength(1)
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    restored.wormhole.run!.pendingRuinsBattle = false
    for (const candidate of restored.wormhole.run!.grid!.cells) delete candidate.foe
    const again = wormholeSalvageAt(restored, ctx)
    expect(again.ok).toBe(true)
    expect(again.relics ?? []).toHaveLength(0)
    expect(restored.wormhole.run!.grid!.ruinsRolled).toContain(cell.key)
    for (const family of ENCRYPTED_FAMILIES) expect(wormholeRelicBoxPoolOf(ctx, 9, family).some(id => id.startsWith('box-encrypted-'))).toBe(false)
  })
  it('缺失保底奖励时不扣回合、不收走残骸、不记首捞', () => {
    const { state, run, grid, cell } = researchWorld()
    const selected = wormholeResearchBox(state, ctx, cell)!
    expect(selected).toBeTruthy()
    const broken = { ...ctx, items: new Map(ctx.items) }
    broken.items.delete(selected)
    const turns = run.turnsLeft, piles = structuredClone(cell.piles)
    expect(wormholeSalvageAt(state, broken)).toMatchObject({ ok: false, errorId: 'core.researchLab.001' })
    expect(run.turnsLeft).toBe(turns)
    expect(cell.piles).toEqual(piles)
    expect(grid.ruinsRolled ?? []).not.toContain(cell.key)
    expect(wormholeSalvageAt(state, ctx).relics).toHaveLength(1)
  })
  it('空动作不浪费首捞，货柜满仓则留在临时空间或原地而不丢失', () => {
    const { state, run, grid, cell } = researchWorld(27)
    const snapshot = structuredClone(state)
    run.bag = [{ itemId: 'ore-voidmother', units: 1_000_000 }]
    const blocked = wormholeSalvageAt(state, ctx)
    expect(blocked.taken ?? []).toHaveLength(0)
    expect(grid.ruinsRolled ?? []).not.toContain(cell.key)
    const loaded = loadSaveFile(serializeSaveFile(snapshot, 0)).state
    const small = { ...ctx, ships: new Map(ctx.ships) }
    const defId = loaded.fleet[loaded.shipId]!.defId!
    small.ships.set(defId, { ...small.ships.get(defId)!, cargoM3: 500 })
    expect(wormholeHoldCapacityOf(loaded, small)).toBe(1)
    const result = wormholeSalvageAt(loaded, small)
    expect(result.relics).toHaveLength(1)
    const box = result.relics![0]!
    const lr = loaded.wormhole.run!
    const all = [...(lr.hold?.placements ?? []), ...(lr.tempGrid?.placements ?? []), ...(lr.grid!.cells.find(c => c.key === cell.key)?.piles ?? [])]
    expect(all.filter(p => p.itemId === box)).toHaveLength(1)
    expect(wormholeShapeOf(box).w * wormholeShapeOf(box).h).toBeGreaterThan(1)
  })
  it.each(ENCRYPTED_FAMILIES)('%s插件新图纸只造一次，取消还书，原永久图纸不变', family => {
    const id = encryptedBlueprintGroups(ctx, family)![0]![0]!
    const bp = ctx.blueprints.get(id)!
    const state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.blueprintStock[id] = 1
    for (const mat of bp.materials) state.warehouse.items[mat.itemId] = mat.count * 2
    expect(learnBlueprint(state, ctx, id).ok).toBe(false)
    expect(startManufacturing(state, id, 'pilot', ctx).ok).toBe(true)
    expect(cancelManufacturing(state, ctx, state.manufacturingRuns[0]!.id).ok).toBe(true)
    expect(state.blueprintStock[id]).toBe(1)
    expect(startManufacturing(state, id, 'pilot', ctx).ok).toBe(true)
    state.gameMs = state.manufacturingRuns[0]!.finishAtGameMs
    advanceManufacturing(state, ctx)
    expect(state.moduleBay[bp.moduleId!]).toBe(1)
    expect(startManufacturing(state, id, 'pilot', ctx).ok).toBe(false)
    const permanent = ctx.blueprints.get(id.replace('bp-once-', 'bp-'))!
    expect(permanent.singleUse).not.toBe(true)
    expect(bp.materials).toEqual(permanent.materials)
  })
})
