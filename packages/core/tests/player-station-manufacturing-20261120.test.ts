import { describe, expect, it } from 'vitest'
import { advanceStationManufacturing, cleanStationManufacturing, createStationManufacturing, stationManufacturingBlock,
  stationManufacturingCommand, stationManufacturingNextEventMs, stationManufacturingView } from '../src/playerStation/manufacturing'
import type { StationManufacturingAction, StationManufacturingHost, StationManufacturingRecipe } from '../src/playerStation/manufacturing'

function world() {
  const state = createStationManufacturing(), residents = [0, 1, 2, 3, 4, 5], busy = new Set<number>(), off = new Set<number>()
  const facilities = new Set([0, 3, 4, 15])
  const inventory: Record<string, number> = { metal: 1000, gas: 1000, part: 0 }
  const recipe: StationManufacturingRecipe = { cycleMs: 1000, input: { metal: 10, gas: 2 }, output: { part: 3 } }
  let settlements = 0
  const host: StationManufacturingHost = {
    residents: () => residents, personAvailable: index => !busy.has(index), facilityAvailable: index => facilities.has(index),
    powered: index => !off.has(index), recipe: id => id === 'bp-part' ? recipe : undefined,
    available: id => inventory[id] ?? 0,
    settle: (input, output) => {
      settlements++
      if (Object.entries(input).some(([id, n]) => (inventory[id] ?? 0) < n)) return false
      for (const [id, n] of Object.entries(input)) inventory[id] -= n
      for (const [id, n] of Object.entries(output)) inventory[id] = (inventory[id] ?? 0) + n
      return true
    },
  }
  const command = (action: StationManufacturingAction) => stationManufacturingCommand(state, host, action)
  return { state, host, residents, busy, off, facilities, inventory, recipe, command,
    assign: (cellIndex = 3, personIndex = 0, batches = 3) => command({ kind: 'assign', cellIndex, personIndex, blueprintId: 'bp-part', batches }),
    advance: (ms: number) => advanceStationManufacturing(state, host, ms), view: () => stationManufacturingView(state, host),
    next: () => stationManufacturingNextEventMs(state, host), settlements: () => settlements }
}

describe('独立玩家站制造：有限批量与原子交接', () => {
  it('开工与未到点不扣料/发物，整批到点只调用一次原子交接', () => {
    const w = world()
    expect(w.state).toEqual({ version: 1, runs: [] })
    expect(w.next()).toBe(Infinity)
    expect(w.assign()).toEqual({ ok: true })
    w.advance(999)
    expect(w.inventory).toEqual({ metal: 1000, gas: 1000, part: 0 })
    expect(w.settlements()).toBe(0)
    expect(w.next()).toBe(1)
    w.advance(1)
    expect(w.inventory).toEqual({ metal: 990, gas: 998, part: 3 })
    expect(w.settlements()).toBe(1)
    expect(w.state.runs[0]).toMatchObject({ progressMs: 0, batchesDone: 1, batches: 3, personIndex: 0 })
  })
  it('末批交付即释放人员，保留完成批数和配置，巨量离线时间也不超产', () => {
    const w = world(); w.assign(15, 5, 2); w.advance(Number.MAX_SAFE_INTEGER)
    expect(w.state.runs[0]).toEqual({ cellIndex: 15, blueprintId: 'bp-part', batches: 2, batchesDone: 2,
      cycleMs: 1000, input: { metal: 10, gas: 2 }, output: { part: 3 }, progressMs: 0, paused: false })
    expect(w.inventory).toEqual({ metal: 980, gas: 996, part: 6 })
    expect(w.next()).toBe(Infinity)
    expect(w.view().runs[0]).toMatchObject({ completed: true, blocked: 'completed', remainingMs: 0, remainingBatches: 0 })
    w.advance(100_000); w.advance(0)
    expect(w.settlements()).toBe(2)
    expect(w.assign(0, 5, 1)).toEqual({ ok: true })
    expect(w.assign(15, 4, 1)).toEqual({ ok: true })
    expect(w.state.runs[0]).toMatchObject({ personIndex: 4, batchesDone: 0, batches: 1 })
  })
  it('批数上限1000不是无限循环，产物数量按单批输出而非批数计件', () => {
    const w = world(); w.inventory.metal = 10_001; w.inventory.gas = 2_001
    expect(w.assign(3, 0, 1000)).toEqual({ ok: true })
    w.advance(10_000_000)
    expect(w.state.runs[0]).toMatchObject({ batchesDone: 1000, progressMs: 0 })
    expect(w.state.runs[0].personIndex).toBeUndefined()
    expect(w.inventory).toEqual({ metal: 1, gas: 1, part: 3000 })
  })
  it('每台一人、一人一台，外部岗位忙碌或不是居民时不抢人', () => {
    const w = world(); w.assign()
    expect(w.assign(4, 0)).toEqual({ ok: false, reason: 'busy' })
    expect(w.assign(3, 1)).toEqual({ ok: false, reason: 'busy' })
    w.busy.add(1)
    expect(w.assign(4, 1)).toEqual({ ok: false, reason: 'person' })
    w.residents.splice(2, 1)
    expect(w.assign(4, 2)).toEqual({ ok: false, reason: 'person' })
    expect(w.state.runs).toHaveLength(1)
  })
  it('缺任一材料保留人员/配置/进度，补料后不倒算等待工时', () => {
    const w = world(); w.assign(); w.advance(400); w.inventory.gas = 1
    const before = structuredClone(w.state)
    w.advance(10_000)
    expect(w.state).toEqual(before)
    expect(w.view().runs[0]).toMatchObject({ blocked: 'materials', remainingMs: 600, available: { metal: 1000, gas: 1 } })
    expect(w.next()).toBe(Infinity)
    w.inventory.gas = 2; w.advance(599)
    expect(w.inventory.part).toBe(0)
    w.advance(1)
    expect(w.inventory).toEqual({ metal: 990, gas: 0, part: 3 })
  })
  it('允许缺料缺电时先派工，条件恢复后才开始累计工时', () => {
    const w = world(); w.inventory.metal = 0; w.off.add(3)
    expect(w.assign()).toEqual({ ok: true })
    w.advance(100_000)
    expect(w.state.runs[0]).toMatchObject({ personIndex: 0, progressMs: 0, batchesDone: 0 })
    w.inventory.metal = 10
    expect(w.view().runs[0].blocked).toBe('power')
    w.off.clear(); w.advance(1000)
    expect(w.inventory.part).toBe(3)
  })
  it('暂停和缺电都保留工时与占用，恢复仍是同批', () => {
    const w = world(); w.assign(); w.advance(250); w.off.add(3); w.advance(10_000)
    expect(w.view().runs[0]).toMatchObject({ blocked: 'power', progressMs: 250, personIndex: 0 })
    w.off.clear()
    expect(w.command({ kind: 'pause', cellIndex: 3 })).toEqual({ ok: true })
    w.advance(10_000)
    expect(w.view().runs[0]).toMatchObject({ blocked: 'paused', progressMs: 250, personIndex: 0 })
    expect(w.assign(4, 0)).toEqual({ ok: false, reason: 'busy' })
    expect(w.command({ kind: 'resume', cellIndex: 3 })).toEqual({ ok: true })
    expect(w.next()).toBe(750)
    w.advance(750)
    expect(w.inventory.part).toBe(3)
  })
  it.each(['person', 'resident', 'facility'] as const)('运行中%s条件丢失也只阻塞，恢复保留进度', condition => {
    const w = world(); w.assign(); w.advance(200)
    if (condition === 'person') w.busy.add(0)
    else if (condition === 'resident') w.residents.shift()
    else w.facilities.delete(3)
    const before = structuredClone(w.state); w.advance(100_000)
    expect(w.state).toEqual(before)
    expect(w.next()).toBe(Infinity)
    expect(stationManufacturingBlock(w.state.runs[0], w.host)).toBe(condition === 'facility' ? 'facility' : 'person')
    w.busy.clear(); w.residents.unshift(0); w.facilities.add(3); w.advance(800)
    expect(w.inventory.part).toBe(3)
  })
  it('主动停止只清当前未完工时、不退未消费材料、不抹已完成批数，释放人', () => {
    const w = world(); w.assign(); w.advance(1500); w.command({ kind: 'pause', cellIndex: 3 })
    const inventory = { ...w.inventory }
    expect(w.command({ kind: 'stop', cellIndex: 3 })).toEqual({ ok: true })
    expect(w.state.runs[0]).toMatchObject({ progressMs: 0, batchesDone: 1, batches: 3, paused: false, blueprintId: 'bp-part' })
    expect(w.state.runs[0].personIndex).toBeUndefined()
    expect(w.view().runs[0].blocked).toBe('no-run')
    w.advance(10_000)
    expect(w.inventory).toEqual(inventory)
    expect(cleanStationManufacturing(w.state)).toEqual(w.state)
    expect(w.assign(4, 0, 1)).toEqual({ ok: true })
  })
  it('同刻共享材料只给先派工者，失败者保留到点工时；补料零时间交付且不重发', () => {
    const w = world(); w.inventory.metal = 10; w.assign(4, 0, 1); w.assign(3, 1, 1); w.advance(1000)
    expect(w.inventory.part).toBe(3)
    expect(w.state.runs.map(run => [run.batchesDone, run.progressMs, run.personIndex])).toEqual([[1, 0, undefined], [0, 1000, 1]])
    expect(cleanStationManufacturing(JSON.parse(JSON.stringify(w.state)))).toEqual(w.state)
    w.inventory.metal = 10
    expect(w.next()).toBe(0)
    w.advance(0)
    expect(w.inventory.part).toBe(6)
    expect(w.state.runs[1]).toMatchObject({ batchesDone: 1, progressMs: 0 })
    expect(w.state.runs[1].personIndex).toBeUndefined()
    w.advance(0)
    expect(w.inventory.part).toBe(6)
  })
  it('停止已到点但未交接的批次不耗料、不发物', () => {
    const w = world(); w.inventory.metal = 10; w.assign(3, 0, 1); w.assign(4, 1, 1); w.advance(1000)
    w.command({ kind: 'stop', cellIndex: 4 }); w.inventory.metal = 10; w.advance(0)
    expect(w.inventory.part).toBe(3)
    expect(w.inventory.metal).toBe(10)
    expect(w.state.runs[1]).toMatchObject({ batchesDone: 0, progressMs: 0 })
  })
  it('共享库存多台大步/分步一致，完成或缺料后不多产', () => {
    const large = world(), small = world()
    for (const w of [large, small]) { w.inventory.metal = 35; w.assign(3, 0, 2); w.assign(4, 1, 2) }
    large.advance(10_000)
    for (let i = 0; i < 100; i++) small.advance(100)
    expect(small.state).toEqual(large.state)
    expect(small.inventory).toEqual(large.inventory)
    expect(large.inventory).toEqual({ metal: 5, gas: 994, part: 9 })
  })
  it('不同周期与产物接续原料的事件推进大步/分步一致', () => {
    const large = world(), small = world()
    for (const w of [large, small]) {
      w.host.recipe = (id): StationManufacturingRecipe => id === 'first' ? { cycleMs: 700, input: { metal: 10 }, output: { middle: 1 } }
        : { cycleMs: 300, input: { middle: 1 }, output: { part: 2 } }
      w.command({ kind: 'assign', cellIndex: 3, personIndex: 0, blueprintId: 'first', batches: 3 })
      w.command({ kind: 'assign', cellIndex: 4, personIndex: 1, blueprintId: 'second', batches: 3 })
    }
    large.advance(3000)
    for (let i = 0; i < 30; i++) small.advance(100)
    expect(small.state).toEqual(large.state)
    expect(small.inventory).toEqual(large.inventory)
    expect(large.inventory.part).toBe(6)
  })
  it('配方派工锁定、视图与清洗双向深拷贝，后续不再请求配方', () => {
    const w = world(); w.assign(); w.advance(100)
    const before = structuredClone(w.state)
    w.recipe.cycleMs = 1; w.recipe.input.metal = 999; w.recipe.output.part = 999
    w.host.recipe = () => { throw new Error('不应再次取配方') }
    const view = w.view(), cleaned = cleanStationManufacturing(w.state)
    view.runs[0].input.metal = 888; view.runs[0].output.part = 888; view.runs[0].personIndex = 5
    cleaned.runs[0].input.metal = 777; cleaned.runs[0].output.part = 777
    expect(w.state).toEqual(before)
    const independent = cleanStationManufacturing(w.state)
    w.state.runs[0].input.metal = 11
    expect(independent).toEqual(before)
    w.state.runs[0].input.metal = 10; w.advance(900)
    expect(w.inventory.part).toBe(3)
  })
  it('交接传出的是配方副本，宿主改参数也不能改run', () => {
    const w = world(), settle = w.host.settle
    w.host.settle = (input, output) => {
      const ok = settle(input, output)
      Object.assign(input, { metal: 999 })
      Object.assign(output, { part: 999 })
      return ok
    }
    w.assign(3, 0, 2); w.advance(2000)
    expect(w.inventory.part).toBe(6)
    expect(w.state.runs[0].input.metal).toBe(10)
    expect(w.state.runs[0].output.part).toBe(3)
  })
  it('材料足够却拒绝交接时明确抛错，不陷入零工时循环', () => {
    const w = world(); w.assign(); w.host.settle = () => false
    expect(() => w.advance(1000)).toThrow('Manufacturing settlement rejected without material shortage')
    expect(w.state.runs[0]).toMatchObject({ progressMs: 1000, batchesDone: 0, personIndex: 0 })
    expect(w.inventory.part).toBe(0)
  })
  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('拒绝非法推进时间%s且不改状态', ms => {
    const w = world(); w.assign(); const before = structuredClone(w.state)
    expect(() => w.advance(ms)).toThrow('Invalid manufacturing elapsed time')
    expect(w.state).toEqual(before)
  })
})

describe('独立玩家站制造：命令与严格JSON快照', () => {
  it('合法格索引含0与15；非法格/人/批数/蓝图和未知操作都不改状态', () => {
    for (const cell of [0, 15]) { const w = world(); expect(w.assign(cell, 5, 1)).toEqual({ ok: true }) }
    const cases: [Record<string, unknown>, string][] = [
      ...[-1, 16, 0.5, NaN].map(cellIndex => [{ cellIndex }, 'facility'] as [Record<string, unknown>, string]),
      ...[-1, 6, 0.5, NaN].map(personIndex => [{ personIndex }, 'person'] as [Record<string, unknown>, string]),
      ...[0, -1, 1001, 0.5, NaN, Infinity].map(batches => [{ batches }, 'batches'] as [Record<string, unknown>, string]),
      [{ blueprintId: '' }, 'recipe'], [{ blueprintId: 'missing' }, 'recipe'], [{ kind: 'unknown' }, 'invalid-action'],
    ]
    for (const [patch, reason] of cases) {
      const w = world()
      expect(w.command({ kind: 'assign', cellIndex: 3, personIndex: 0, blueprintId: 'bp-part', batches: 1, ...patch } as StationManufacturingAction)).toEqual({ ok: false, reason })
      expect(w.state).toEqual({ version: 1, runs: [] })
    }
    const w = world(); w.assign(); w.command({ kind: 'pause', cellIndex: 3 }); const before = structuredClone(w.state)
    expect(w.command({ kind: 'unknown', cellIndex: 3 } as never)).toEqual({ ok: false, reason: 'invalid-action' })
    expect(w.state).toEqual(before)
  })
  it('无任务及完工后停止/暂停/恢复均不重新占人', () => {
    const w = world()
    for (const kind of ['stop', 'pause', 'resume'] as const) expect(w.command({ kind, cellIndex: 3 })).toEqual({ ok: false, reason: 'no-run' })
    w.assign(3, 0, 1); w.advance(1000)
    for (const kind of ['stop', 'pause', 'resume'] as const) expect(w.command({ kind, cellIndex: 3 })).toEqual({ ok: false, reason: 'no-run' })
  })
  it('拒绝非法配方工期、空/负/零/非整数/不安全/非JSON物料表', () => {
    const invalidBills = [{}, [], null, { metal: 0 }, { metal: -1 }, { metal: 1.5 }, { metal: NaN }, { metal: Infinity },
      { metal: Number.MAX_SAFE_INTEGER + 1 }, { '': 1 }, { ' ': 1 }, { metal: '1' }, new Map([['metal', 1]])]
    for (const bad of [undefined, ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(cycleMs => ({ cycleMs, input: { metal: 1 }, output: { part: 1 } })),
      ...invalidBills.map(input => ({ cycleMs: 1000, input, output: { part: 1 } })),
      ...invalidBills.map(output => ({ cycleMs: 1000, input: { metal: 1 }, output }))]) {
      const w = world(); w.host.recipe = () => bad as never
      expect(w.assign()).toEqual({ ok: false, reason: 'recipe' })
      expect(w.state.runs).toEqual([])
    }
  })
  it('严格拒绝重复人/格、越界、不一致完成状态、非法进度与物料', () => {
    const w = world(); w.assign(); w.advance(400)
    const mutations: ((s: any) => void)[] = [
      s => { s.version = 2 }, s => { s.runs.push({ ...s.runs[0], personIndex: 1 }) },
      s => { s.runs.push({ ...s.runs[0], cellIndex: 4 }) }, s => { s.runs[0].cellIndex = 16 },
      s => { s.runs[0].personIndex = 6 }, s => { s.runs[0].personIndex = null }, s => { delete s.runs[0].personIndex },
      s => { s.runs[0].progressMs = 1001 }, s => { s.runs[0].progressMs = -1 }, s => { s.runs[0].cycleMs = 0 },
      s => { s.runs[0].progressMs = NaN }, s => { s.runs[0].batchesDone = -1 }, s => { s.runs[0].batchesDone = 4 },
      s => { s.runs[0].batchesDone = 3 }, s => { s.runs[0].batches = 1001 }, s => { s.runs[0].batches = 0 },
      s => { s.runs[0].blueprintId = '' }, s => { s.runs[0].paused = 1 }, s => { s.runs[0].input = {} },
      s => { s.runs[0].output = { part: 0 } }, s => { s.runs[0].input.metal = 1.5 },
      s => { s.runs[0].output.part = Infinity }, s => { s.runs[0].input.metal = Number.MAX_SAFE_INTEGER + 1 },
      s => { s.runs = Array(17).fill(s.runs[0]) }, s => { s.runs = new Array(1) },
    ]
    for (const mutate of mutations) {
      const bad = structuredClone(w.state); mutate(bad)
      expect(() => cleanStationManufacturing(bad)).toThrow('Invalid station manufacturing snapshot')
    }
    for (const bad of [null, [], 'x', { version: 1, runs: [null] }, { version: 1, runs: {} }]) expect(() => cleanStationManufacturing(bad)).toThrow()
    w.command({ kind: 'stop', cellIndex: 3 })
    const stopped = structuredClone(w.state); stopped.runs[0].paused = true
    expect(() => cleanStationManufacturing(stopped)).toThrow()
  })
  it('清洗只保留白名单JSON，暂停和完成记录可往返，无源对象引用', () => {
    const w = world(); w.assign(); w.advance(400); w.command({ kind: 'pause', cellIndex: 3 })
    const snapshot = { ...w.state, extra: 'discard', runs: w.state.runs.map(run => ({ ...run, extra: 'discard' })) }
    expect(cleanStationManufacturing(snapshot)).toEqual(w.state)
    const paused = cleanStationManufacturing(JSON.parse(JSON.stringify(w.state)))
    expect(paused).toEqual(w.state)
    w.command({ kind: 'resume', cellIndex: 3 }); w.advance(2600)
    expect(cleanStationManufacturing(JSON.parse(JSON.stringify(w.state)))).toEqual(w.state)
    expect(paused.runs[0]).toMatchObject({ progressMs: 400, paused: true, batchesDone: 0 })
  })
})
