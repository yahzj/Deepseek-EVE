import { describe, expect, it } from 'vitest'
import { advanceStationRefining, cleanStationRefining, createStationRefining, stationRefiningCommand,
  stationRefiningNextEventMs, stationRefiningView } from '../src/playerStation/index'
import type { StationRefiningAction, StationRefiningHost } from '../src/playerStation/index'

function world() {
  const state = createStationRefining(), residents = [0, 1], busy = new Set<number>(), off = new Set<number>()
  const inventory: Record<string, number> = { ore: 1000, metal: 0 }
  const host: StationRefiningHost = {
    residents: () => residents, personAvailable: index => !busy.has(index), facilityAvailable: index => index === 3 || index === 4,
    powered: index => !off.has(index), recipe: id => id === 'ore' ? { batchUnits: 10, cycleMs: 1000 } : undefined,
    output: () => ({ metal: 12 }), available: id => inventory[id] ?? 0,
    settle: (input, output) => {
      if (Object.entries(input).some(([id, n]) => inventory[id] < n)) return false
      for (const [id, n] of Object.entries(input)) inventory[id] -= n
      for (const [id, n] of Object.entries(output)) inventory[id] = (inventory[id] ?? 0) + n
      return true
    },
  }
  const command = (action: StationRefiningAction) => stationRefiningCommand(state, host, action)
  return { state, host, residents, busy, off, inventory, command,
    assign: (cellIndex = 3, personIndex = 0) => command({ kind: 'assign', cellIndex, personIndex, itemId: 'ore' }),
    advance: (ms: number) => advanceStationRefining(state, host, ms), view: () => stationRefiningView(state, host) }
}

describe('独立玩家站C1：派工与人类精炼', () => {
  it('开工不扣料，整批到点原子耗料/入库，不预发产物', () => {
    const w = world(); expect(w.assign()).toEqual({ ok: true })
    expect(w.inventory).toEqual({ ore: 1000, metal: 0 })
    w.advance(999); expect(w.inventory.metal).toBe(0)
    w.advance(1); expect(w.inventory).toEqual({ ore: 990, metal: 12 })
    expect(w.state.runs[0]).toMatchObject({ progressMs: 0, batchesDone: 1, personIndex: 0 })
  })
  it('不需要工种课程，一人/一设备不可重复占用，不自动抢其他岗位', () => {
    const w = world(); w.assign()
    expect(w.assign(4, 0)).toEqual({ ok: false, reason: 'busy' })
    expect(w.assign(3, 1)).toEqual({ ok: false, reason: 'busy' })
    w.busy.add(1); expect(w.assign(4, 1)).toEqual({ ok: false, reason: 'person' })
    expect(w.assign(4, 5)).toEqual({ ok: false, reason: 'person' })
    expect(w.state.runs).toHaveLength(1)
  })
  it('缺料保配置/人员/有效进度，补料后继续不倒算等待', () => {
    const w = world(); w.assign(); w.advance(400); w.inventory.ore = 9; w.advance(10_000)
    expect(w.view().runs[0]).toMatchObject({ blocked: 'materials', progressMs: 400, personIndex: 0 })
    expect(stationRefiningNextEventMs(w.state, w.host)).toBe(Infinity)
    w.inventory.ore = 10; w.advance(599); expect(w.inventory.metal).toBe(0)
    w.advance(1); expect(w.inventory).toEqual({ ore: 0, metal: 12 })
  })
  it('缺电/暂停保留人员和进度，恢复后同批继续', () => {
    const w = world(); w.assign(); w.advance(250); w.off.add(3); w.advance(10000)
    expect(w.state.runs[0].progressMs).toBe(250)
    expect(w.view().runs[0].blocked).toBe('power')
    w.off.clear(); w.command({ kind: 'pause', cellIndex: 3 }); w.advance(10000)
    expect(w.view().runs[0]).toMatchObject({ progressMs: 250, blocked: 'paused', personIndex: 0 })
    w.command({ kind: 'resume', cellIndex: 3 }); w.advance(750)
    expect(w.inventory.metal).toBe(12)
  })
  it('主动停止释放人，清未完成进度，不退未消费原料或重发已完成产物', () => {
    const w = world(); w.assign(); w.advance(1500); w.command({ kind: 'stop', cellIndex: 3 })
    expect(w.state.runs[0]).toMatchObject({ progressMs: 0, batchesDone: 1, itemId: 'ore' })
    expect(w.state.runs[0].personIndex).toBeUndefined()
    const inventory = { ...w.inventory }; w.advance(10000); expect(w.inventory).toEqual(inventory)
    w.assign(4, 0); w.advance(999); expect(w.inventory.metal).toBe(12)
    w.advance(1); expect(w.inventory.metal).toBe(24)
  })
  it('多台争最后一批先开先结算，另一台保留到点工时，补料零时间只结算一次', () => {
    const w = world(); w.inventory.ore = 10; w.assign(3, 0); w.assign(4, 1); w.advance(1000)
    expect(w.inventory).toEqual({ ore: 0, metal: 12 })
    expect(w.state.runs.map(run => [run.batchesDone, run.progressMs])).toEqual([[1, 0], [0, 1000]])
    expect(cleanStationRefining(JSON.parse(JSON.stringify(w.state)))).toEqual(w.state)
    w.inventory.ore = 10; w.advance(0)
    expect(w.inventory).toEqual({ ore: 0, metal: 24 })
    w.advance(0); expect(w.inventory.metal).toBe(24)
  })
  it('多台大步/分步一致，库存不足后不再产出', () => {
    const large = world(), small = world()
    for (const w of [large, small]) { w.inventory.ore = 35; w.assign(3, 0); w.assign(4, 1) }
    large.advance(3000); for (let i = 0; i < 30; i++) small.advance(100)
    expect(small.state).toEqual(large.state); expect(small.inventory).toEqual(large.inventory)
    expect(large.inventory).toEqual({ ore: 5, metal: 36 })
  })
  it('视图只读且快照拒绝重复人/格、非法进度/配方字段', () => {
    const w = world(); w.assign(); w.advance(400)
    const before = structuredClone(w.state), view = w.view()
    view.runs[0].personIndex = 5; view.runs[0].output.metal = 999
    expect(w.state).toEqual(before)
    for (const mutate of [(s: any) => { s.runs.push({ ...s.runs[0] }) }, (s: any) => { s.runs.push({ ...s.runs[0], cellIndex: 4 }) },
      (s: any) => { s.runs[0].progressMs = 1001 }, (s: any) => { delete s.runs[0].personIndex },
      (s: any) => { s.runs[0].batchUnits = 0 }, (s: any) => { s.runs[0].personIndex = 6 }, (s: any) => { s.runs[0].itemId = '' }]) {
      const bad = structuredClone(w.state); mutate(bad); expect(() => cleanStationRefining(bad)).toThrow()
    }
  })
  it('拒绝未知操作或无效人员，不把错误命令解释为恢复', () => {
    const w = world(); w.assign(); w.command({ kind: 'pause', cellIndex: 3 })
    const before = structuredClone(w.state)
    expect(w.command({ kind: 'unknown', cellIndex: 3 } as never)).toEqual({ ok: false, reason: 'invalid-action' })
    w.residents.push(6)
    expect(w.assign(4, 6)).toEqual({ ok: false, reason: 'person' })
    expect(w.state).toEqual(before)
  })
})
