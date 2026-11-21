import { describe, expect, it } from 'vitest'
import { advanceStationMining, cleanStationMining, createStationMining, stationMiningCommand, stationMiningNextEventMs, stationMiningView } from '../src/playerStation/index'
import type { StationMiningAction, StationMiningHost } from '../src/playerStation/index'

function world() {
  const state = createStationMining(), residents = [0, 1], busy = new Set<number>()
  let available = true, ready = true, claims = 0, releases = 0
  const inventory: Record<string, number> = { ore: 0 }
  let cargo: Record<string, number> = {}
  const host: StationMiningHost = {
    residents: () => residents, personAvailable: index => !busy.has(index), ready: () => ready,
    ship: id => id === 'ship' ? { available, auxiliary: true, home: available } : undefined,
    params: (_id, belt) => belt === 'belt' ? { cycleMs: 1000, unitsPerCycle: 10, capacityM3: 20, departureMs: 100 } : undefined,
    claimShip: () => { if (!available) return undefined; available = false; claims++; const result = cargo; cargo = {}; return result },
    releaseShip: (_id, value) => { available = true; releases++; cargo = { ...value } },
    cycle: run => ({ cargo: (run.cargo.ore ?? 0) >= 20 ? { ...run.cargo } : { ore: (run.cargo.ore ?? 0) + 10 },
      returning: (run.cargo.ore ?? 0) >= 20, rvLeft: 0, rng: { ...run.rng, count: run.rng.count + 1 } }),
    returnMs: () => 2000,
    unload: value => { for (const [id, n] of Object.entries(value)) inventory[id] = (inventory[id] ?? 0) + n },
  }
  const command = (action: StationMiningAction) => stationMiningCommand(state, host, action)
  return { state, host, residents, busy, inventory, command, assign: (personIndex = 0) => command({ kind: 'assign', shipId: 'ship', personIndex, beltId: 'belt' }),
    advance: (ms: number) => advanceStationMining(state, host, ms), ready: (value: boolean) => { ready = value },
    setCargo: (value: Record<string, number>) => { cargo = { ...value } }, available: () => available, counts: () => [claims, releases] }
}

describe('独立玩家站C2：人类采矿与返航入库', () => {
  it('离港后采到船上，满舱返航到港才整仓入库，不重复入库', () => {
    const w = world(); expect(w.assign()).toEqual({ ok: true }); w.advance(100 + 2000)
    expect(w.state.runs[0]).toMatchObject({ phase: 'mining', cargo: { ore: 20 }, cyclesDone: 2 })
    expect(w.inventory.ore).toBe(0); w.advance(1000)
    expect(w.state.runs[0].phase).toBe('returning'); w.advance(1999); expect(w.inventory.ore).toBe(0)
    w.advance(1); expect(w.inventory.ore).toBe(20)
    expect(w.state.runs[0]).toMatchObject({ phase: 'departure', cargo: {}, tripsDone: 1 })
    expect(w.available()).toBe(false)
  })
  it('一人一船、外部忙人不能抢占，未接收人口不可派工', () => {
    const w = world(); w.busy.add(0)
    expect(w.assign()).toEqual({ ok: false, reason: 'person' })
    expect(w.assign(5)).toEqual({ ok: false, reason: 'person' })
    w.busy.clear(); w.assign()
    expect(w.assign(1)).toEqual({ ok: false, reason: 'busy' })
    expect(w.counts()).toEqual([1, 0])
  })
  it('停止采掘清本循环，保留货物并真实返航，未到港不释放船与人', () => {
    const w = world(); w.assign(); w.advance(1600)
    w.command({ kind: 'stop', shipId: 'ship' })
    expect(w.state.runs[0]).toMatchObject({ phase: 'returning', progressMs: 0, stopping: true, cargo: { ore: 10 }, personIndex: 0 })
    w.advance(1999); expect(w.available()).toBe(false); expect(w.inventory.ore).toBe(0)
    w.advance(1); expect(w.state.runs).toEqual([]); expect(w.inventory.ore).toBe(10)
    expect(w.counts()).toEqual([1, 1]); w.advance(10000); expect(w.inventory.ore).toBe(10)
  })
  it('返航中停止保留已走时间，不能重新清零或瞬移卸货', () => {
    const w = world(); w.assign(); w.advance(4100)
    expect(w.state.runs[0]).toMatchObject({ phase: 'returning', progressMs: 1000 })
    w.command({ kind: 'stop', shipId: 'ship' }); w.advance(999)
    expect(w.inventory.ore).toBe(0); w.advance(1); expect(w.inventory.ore).toBe(20)
    expect(w.state.runs).toEqual([])
  })
  it('尚未离港可撤回，原船已有货物原物保留、不复制入库', () => {
    const w = world(); w.setCargo({ ore: 7 }); w.assign(); w.advance(50)
    w.command({ kind: 'stop', shipId: 'ship' })
    expect(w.available()).toBe(true); expect(w.inventory.ore).toBe(0); expect(w.state.runs).toEqual([])
    w.assign(); expect(w.state.runs[0].cargo).toEqual({ ore: 7 })
  })
  it('暂停/站点不可用不采矿，进度保留；安全返航不被暂停和停电卡住', () => {
    const w = world(); w.assign(); w.advance(600); w.command({ kind: 'pause', shipId: 'ship' }); w.advance(5000)
    expect(w.state.runs[0]).toMatchObject({ progressMs: 500, paused: true })
    expect(stationMiningNextEventMs(w.state, w.host)).toBe(Infinity)
    w.command({ kind: 'resume', shipId: 'ship' }); w.ready(false); w.advance(5000)
    expect(w.state.runs[0].progressMs).toBe(500)
    w.command({ kind: 'stop', shipId: 'ship' }); w.command({ kind: 'pause', shipId: 'ship' }); w.advance(2000)
    expect(w.available()).toBe(true); expect(w.state.runs).toEqual([])
  })
  it('大步/分步与中间快照一致，视图不暴露货物或随机状态引用', () => {
    const large = world(), small = world(); large.assign(); small.assign(); large.advance(20000)
    for (let i = 0; i < 200; i++) { small.advance(100); expect(cleanStationMining(JSON.parse(JSON.stringify(small.state)))).toEqual(small.state) }
    expect(small.state).toEqual(large.state); expect(small.inventory).toEqual(large.inventory)
    const before = structuredClone(small.state), view = stationMiningView(small.state, small.host)
    view.runs[0].cargo.ore = 999; view.runs[0].rng.count = 999
    expect(small.state).toEqual(before)
  })
  it('拒绝重复船/人、非法航程/货物/随机状态和未知命令', () => {
    const w = world(); w.assign(); w.advance(500)
    for (const mutate of [(s: any) => { s.runs.push({ ...s.runs[0] }) }, (s: any) => { s.runs[0].durationMs = 0 },
      (s: any) => { s.runs[0].progressMs = s.runs[0].durationMs }, (s: any) => { s.runs[0].cargo.ore = -1 },
      (s: any) => { s.runs[0].rng.seed = s.sequence + 1 }, (s: any) => { s.runs[0].rvLeft = 3 },
      (s: any) => { s.runs[0].stopping = true }, (s: any) => { s.runs[0].personIndex = 6 }]) {
      const bad = structuredClone(w.state); mutate(bad); expect(() => cleanStationMining(bad)).toThrow()
    }
    const before = structuredClone(w.state)
    expect(w.command({ kind: 'unknown', shipId: 'ship' } as never)).toEqual({ ok: false, reason: 'invalid-action' })
    expect(() => w.advance(-1)).toThrow(); expect(w.state).toEqual(before)
  })
})
