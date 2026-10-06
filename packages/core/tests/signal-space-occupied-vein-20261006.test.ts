import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import { wormholeEnter } from '../src/wormhole'
import { advanceWormhole, wormholeTravelTo } from '../src/wormholeBattle'
import { wormholeCollectOreAt, wormholeEnsureVeinPiles, wormholeEnsureSalvagePiles, wormholeEnsureArrivalPiles, wormholeGrantShipSpoils, wormholeHoldCapacityOf, wormholeSalvageAt } from '../src/wormholeSalvage'
import { hasLiveFoe } from '../src/wormholeGrid'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { makeHoldState } from '../src/wormholeHold'
import type { GameState } from '../src/state'
import type { WormholeGridCell } from '../src/wormholeGrid'

const ctx = buildSimContext()
const ore = 'ore-voidmother'

function world(depth = 7) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'sh-thresher')
  state.shipId = uid
  expect(wormholeEnter(state, ctx, [uid], 7).ok).toBe(true)
  state.fleet[uid]!.fitted = { high: ['mod-miner-1'], mid: [], low: [] }
  const run = state.wormhole.run!
  run.depth = depth
  run.family = 'A'
  run.turnsLeft = 30
  run.turnsTotal = Math.max(run.turnsTotal, 30)
  state.wormhole.noCommonWreckSalvage = true
  const vein: WormholeGridCell = { key: '1,0', q: 1, r: 0, place: 'vein', foe: { card: 'wh-pirate-scout', seq: 1 } }
  run.grid = {
    radius: 2, start: { q: 0, r: 0 }, pos: { q: 0, r: 0 }, exit: { q: 2, r: 0 }, scanRadius: 1,
    scanned: ['0,0', '1,0'], visited: ['0,0'], activated: [], spawnSeq: 1,
    cells: [{ key: '0,0', q: 0, r: 0, place: 'empty' }, vein, { key: '2,0', q: 2, r: 0, place: 'empty' }],
  }
  return { state, run, vein }
}

function arrive(state: GameState) {
  const r = wormholeTravelTo(state, ctx, { q: 1, r: 0 }, { confirmIntercept: true })
  expect(r.ok, r.error).toBe(true)
  expect(r.autoBattle).toBe(true)
  expect(state.wormhole.run!.battle!.wormhole!.kind).toBe('spawn')
}

/** 胜负用夹具指定，仅排除战力变量；移动、开场、慢镜收口、战果与采集均走正式入口。 */
function settleWin(state: GameState) {
  const run = state.wormhole.run!
  const battle = run.battle!
  for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
  battle.ended = 'me'
  run.attending = true
  state.gameMs = battle.lastTickGameMs + ctx.balance.battle.killcamMs + 1
  advanceWormhole(state, ctx)
  expect(state.wormhole.run).not.toBeNull()
  expect(run.battle).toBeFalsy()
  // 清理合成战果货柜的临时空间，排除“整理货物后才能继续”的正常门禁。
  run.tempGrid = makeHoldState(4)
}

describe('信号空间被占矿点：覆盖和地点完成不能混用', () => {
  it.each([7, 8])('第%s层首次抵达被占矿脉、战后可以采虚空母矿', depth => {
    const { state, run, vein } = world(depth)
    arrive(state)
    expect(run.grid!.activated).not.toContain(vein.key)
    expect(vein.resourcePilesGenerated).toBe(true)
    settleWin(state)
    expect(hasLiveFoe(vein)).toBe(false)
    expect(vein.place).toBe('vein')
    const collected = wormholeCollectOreAt(state, ctx)
    expect(collected.ok, collected.error).toBe(true)
    expect(collected.taken!.some(p => p.itemId === ore)).toBe(true)
  })

  it('到达前已经铺矿的被占地点，战后仍保留原矿，不复制', () => {
    const { state, vein } = world()
    vein.piles = [{ itemId: ore, units: 10 }]
    arrive(state)
    settleWin(state)
    expect(vein.piles).toEqual([{ itemId: ore, units: 10 }])
    const taken = wormholeCollectOreAt(state, ctx)
    expect(taken.ok, taken.error).toBe(true)
    expect(taken.taken).toEqual([{ itemId: ore, units: 10 }])
    wormholeEnsureVeinPiles(state, vein)
    expect(vein.piles ?? []).toEqual([])
  })

  it('采空后再被围剿占领，不恢复原矿，重载后仍不刷', () => {
    const { state, run, vein } = world()
    run.grid!.activated.push(vein.key)
    arrive(state)
    settleWin(state)
    expect(vein.piles?.some(p => p.itemId === ore) ?? false).toBe(false)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    const loadedVein = loaded.wormhole.run!.grid!.cells.find(c => c.key === vein.key)!
    wormholeEnsureVeinPiles(loaded, loadedVein)
    expect(loadedVein.piles?.some(p => p.itemId === ore) ?? false).toBe(false)
  })

  it('战果滞留的未采矿脉先初始化母矿，保留残骸且不重复铺矿', () => {
    const { state, run, vein } = world()
    run.grid!.pos = { q: vein.q, r: vein.r }
    state.wormhole.noCommonWreckSalvage = false
    const capacity = wormholeHoldCapacityOf(state, ctx)
    run.bag = [{ itemId: ore, units: (capacity + 32) * 500 }]
    // 正式战果入口令一堆普通残骸装不下后散落该格。
    const loot = wormholeGrantShipSpoils(state, ctx, 'spawn')
    expect(loot.leftOnCell).toBeGreaterThan(0)
    const wrecks = structuredClone(vein.piles!.filter(p => p.itemId !== ore))
    expect(wrecks.length).toBeGreaterThan(0)
    wormholeEnsureVeinPiles(state, vein)
    expect(vein.piles!.filter(p => p.itemId === ore).length).toBeGreaterThan(0)
    expect(vein.piles!.filter(p => p.itemId !== ore)).toEqual(wrecks)
    const once = structuredClone(vein.piles)
    wormholeEnsureVeinPiles(state, vein)
    expect(vein.piles).toEqual(once)
  })

  it('旧矿脉只有散落残骸时铺原矿；只采母矿、不搬残骸或货柜，耗尽后仍不重铺', () => {
    const { state, run, vein } = world(6)
    run.grid!.pos = { q: vein.q, r: vein.r }
    delete vein.foe
    const leftovers = [{ itemId: 'wreck-a-wh', units: 20 }, { itemId: 'box-military', units: 1 }]
    vein.piles = structuredClone(leftovers)
    wormholeEnsureVeinPiles(state, vein)
    const initial = structuredClone(vein.piles!.filter(p => p.itemId === ore))
    expect(initial.length).toBeGreaterThan(0)
    // 本例只验分类和耗尽去重；缩小各堆避免货仓容量成为变量。
    for (const pile of vein.piles!) if (pile.itemId === ore) pile.units = 1
    const taken: unknown[] = []
    for (let i = 0; i < initial.length; i++) {
      const r = wormholeCollectOreAt(state, ctx)
      expect(r.ok, r.error).toBe(true)
      expect(r.taken!.every(p => p.itemId === ore)).toBe(true)
      expect(r.left).toBe(initial.length - i - 1)
      expect(r.finished).toBe(i === initial.length - 1)
      taken.push(...r.taken!)
    }
    expect(taken).toHaveLength(initial.length)
    expect(vein.piles).toEqual(leftovers)
    expect(run.grid!.activated).toContain(vein.key)
    const turns = run.turnsLeft
    expect(wormholeCollectOreAt(state, ctx)).toMatchObject({ ok: false, errorId: 'core.wormholeSalvage.021' })
    expect(run.turnsLeft).toBe(turns)
    for (let pass = 0; pass < 2; pass++) {
      const loaded = loadSaveFile(serializeSaveFile(state)).state
      const cell = loaded.wormhole.run!.grid!.cells.find(c => c.key === vein.key)!
      expect(cell.resourcePilesGenerated).toBe(true)
      wormholeEnsureVeinPiles(loaded, cell)
      expect(cell.piles).toEqual(leftovers)
      Object.assign(state, loaded)
    }
  })

  it('旧误标完成但有剩余母矿只采已有矿；无母矿的旧完成格不自动补满', () => {
    const { state, run, vein } = world(6)
    run.grid!.pos = { q: vein.q, r: vein.r }
    run.grid!.activated.push(vein.key)
    delete vein.foe
    vein.piles = [{ itemId: ore, units: 1 }, { itemId: 'wreck-a-wh', units: 20 }]
    wormholeEnsureVeinPiles(state, vein)
    expect(vein.resourcePilesGenerated).toBe(true)
    expect(wormholeCollectOreAt(state, ctx).taken).toEqual([{ itemId: ore, units: 1 }])
    const saved = loadSaveFile(serializeSaveFile(state)).state
    const cell = saved.wormhole.run!.grid!.cells.find(c => c.key === vein.key)!
    delete cell.resourcePilesGenerated
    wormholeEnsureVeinPiles(saved, cell)
    expect(cell.piles).toEqual([{ itemId: 'wreck-a-wh', units: 20 }])
  })

  it('战斗中保存重载，胜场后生成状态与母矿原样保留', () => {
    const { state, vein } = world()
    arrive(state)
    const original = structuredClone(vein.piles)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    const cell = loaded.wormhole.run!.grid!.cells.find(c => c.key === vein.key)!
    expect(cell.resourcePilesGenerated).toBe(true)
    expect(cell.piles).toEqual(original)
    settleWin(loaded)
    expect(hasLiveFoe(cell)).toBe(false)
    expect(cell.piles).toEqual(original)
    const taken = wormholeCollectOreAt(loaded, ctx)
    expect(taken.ok, taken.error).toBe(true)
    expect(taken.taken!.every(p => p.itemId === ore)).toBe(true)
  })

  it('满舱拒收保留原矿，腾出后可采，不因失败重铺或丢失', () => {
    const { state, run, vein } = world(6)
    run.grid!.pos = { q: vein.q, r: vein.r }
    delete vein.foe
    wormholeEnsureVeinPiles(state, vein)
    const original = structuredClone(vein.piles!)
    const capacity = wormholeHoldCapacityOf(state, ctx)
    run.bag = [{ itemId: 'min-titanium', units: capacity * 500 }]
    run.tempGrid = makeHoldState(4)
    run.tempGrid.placements = [{ id: 'full-temp', itemId: 'box-military', kind: 'box', x: 0, y: 0, w: 4, h: 8 }]
    const r = wormholeCollectOreAt(state, ctx)
    expect(r.ok).toBe(false)
    expect(r.taken ?? []).toEqual([])
    expect(vein.piles).toEqual(original)
    run.bag = []
    run.hold = makeHoldState()
    run.tempGrid = makeHoldState(4)
    wormholeEnsureVeinPiles(state, vein)
    expect(vein.piles).toEqual(original)
    expect(wormholeCollectOreAt(state, ctx).taken!.length).toBeGreaterThan(0)
  })

  it.each(['graveyard', 'ruins'] as const)('围剿覆盖的%s战后可打捞，重载和原产出初始化不重掷首捞', place => {
    const { state, run, vein: cell } = world()
    cell.place = place
    state.fleet[state.shipId]!.fitted.high = ['mod-salvager-1']
    state.wormhole.noCommonWreckSalvage = false
    arrive(state)
    expect(run.grid!.activated).not.toContain(cell.key)
    expect(cell.resourcePilesGenerated).toBe(true)
    const original = structuredClone(cell.piles!)
    expect(original.some(p => p.itemId.startsWith('wreck-'))).toBe(true)
    settleWin(state)
    expect(cell.piles).toEqual(original)
    for (const pile of cell.piles!) if (pile.itemId.startsWith('wreck-')) pile.units = 1
    const r = wormholeSalvageAt(state, ctx)
    expect(r.ok, r.error).toBe(true)
    expect(r.taken!.length).toBeGreaterThan(0)
    const current = structuredClone(cell.piles)
    const rolls = structuredClone(run.grid!.ruinsRolled)
    wormholeEnsureSalvagePiles(state, cell)
    expect(cell.piles).toEqual(current)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    const loadedCell = loaded.wormhole.run!.grid!.cells.find(c => c.key === cell.key)!
    wormholeEnsureSalvagePiles(loaded, loadedCell)
    expect(loadedCell.piles ?? []).toEqual(current ?? [])
    expect(loaded.wormhole.run!.grid!.ruinsRolled).toEqual(rolls)
  })

  it('新虫洞不使用信号空间生成标记，原始资源逻辑不改', () => {
    const { state, run, vein } = world()
    run.expeditionRules = 2
    run.grid!.pos = { q: vein.q, r: vein.r }
    vein.piles = [{ itemId: 'wreck-a-wh', units: 20 }]
    const original = structuredClone(vein.piles)
    wormholeEnsureVeinPiles(state, vein)
    expect(vein.piles).toEqual(original)
    expect(vein.resourcePilesGenerated).toBeUndefined()
    run.grid!.activated.push(vein.key)
    vein.piles = []
    wormholeEnsureArrivalPiles(state, ctx)
    expect(vein.piles).toEqual([])
    expect(vein.resourcePilesGenerated).toBeUndefined()
  })

  it.each(['ship', 'beacon'] as const)('未覆盖的%s仍按原到达激活；被覆盖时只打覆盖者', place => {
    const ordinary = world(6)
    ordinary.vein.place = place
    delete ordinary.vein.foe
    const r = wormholeTravelTo(ordinary.state, ctx, { q: 1, r: 0 }, { confirmIntercept: true })
    expect(r.ok, r.error).toBe(true)
    expect(ordinary.run.grid!.activated).toContain(ordinary.vein.key)
    if (place === 'ship') expect(ordinary.run.battle!.wormhole!.kind).toBe('node')
    else expect(r.beacon).toBe(true)

    const covered = world()
    covered.vein.place = place
    arrive(covered.state)
    expect(covered.run.grid!.activated).not.toContain(covered.vein.key)
    settleWin(covered.state)
    expect(covered.run.grid!.activated).not.toContain(covered.vein.key)
    expect(covered.vein.place).toBe(place)
  })

  it('资源标记只接受true，坏值不写入，空堆字段丢掉后标记仍在', () => {
    const { state, run, vein } = world(6)
    run.grid!.pos = { q: vein.q, r: vein.r }
    vein.resourcePilesGenerated = true
    vein.piles = []
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    const cell = loaded.wormhole.run!.grid!.cells.find(c => c.key === vein.key)!
    expect(cell.piles).toBeUndefined()
    expect(cell.resourcePilesGenerated).toBe(true)
    wormholeEnsureVeinPiles(loaded, cell)
    expect(cell.piles).toBeUndefined()
    for (const value of [false, 'true', 1, null]) {
      const raw = JSON.parse(serializeSaveFile(state))
      raw.state.wormhole.run.grid.cells.find((c: { key: string }) => c.key === vein.key).resourcePilesGenerated = value
      const invalid = loadSaveFile(JSON.stringify(raw)).state
      expect(invalid.wormhole.run!.grid!.cells.find(c => c.key === vein.key)!.resourcePilesGenerated).toBeUndefined()
    }
  })

  it('真炮火击败围剿者后直接采矿，不手写胜负或清除完成状态', () => {
    const { state, run, vein } = world(8)
    const laser = ctx.modules.get('mod-laser-3')!
    const ship = ctx.ships.get('sh-thresher')!
    // 仅合成测试配装提高火力/耐久，排除平衡变量；正式移动、炮火、胜场收口和采矿连跑。
    const local = {
      ...ctx,
      modules: new Map([...ctx.modules, [laser.id, { ...laser, dmgMult: 1000, reloadMs: 100, maxRangeM: 60000 }]]),
      ships: new Map([...ctx.ships, [ship.id, { ...ship, shieldHp: 100000, armorHp: 100000, hullHp: 100000 }]]),
    }
    state.fleet[state.shipId]!.fitted.high = ['mod-miner-1', laser.id]
    state.warehouse.items['ammo-plasma-l'] = 10000
    const move = wormholeTravelTo(state, local, { q: 1, r: 0 }, { confirmIntercept: true })
    expect(move.ok, move.error).toBe(true)
    const battle = run.battle!
    for (let time = 100; time <= 60000 && run.battle; time += 100) {
      state.gameMs = time
      advanceWormhole(state, local)
    }
    expect(run.battle).toBeFalsy()
    expect(battle.ended).toBe('me')
    expect(battle.stats.meHits).toBeGreaterThan(0)
    expect(battle.stats.meDmg).toBeGreaterThan(0)
    expect(hasLiveFoe(vein)).toBe(false)
    expect(run.grid!.activated).not.toContain(vein.key)
    const collect = wormholeCollectOreAt(state, local)
    expect(collect.ok, collect.error).toBe(true)
    expect(collect.taken!.some(p => p.itemId === ore)).toBe(true)
  })
})
