import { describe, expect, it } from 'vitest'
import { STATION_FIRST_RESEARCH, advanceStationResearch, cleanStationResearch, createStationResearch,
  stationResearchCommand, stationResearchNextEventMs, stationResearchView } from '../src/playerStation/index'
import type { StationResearchAction, StationResearchHost } from '../src/playerStation/index'

function world() {
  const state = createStationResearch(), researchers = [1, 2], busy = new Set<number>(), facilities = new Set([4, 5])
  let powered = true
  const host: StationResearchHost = {
    researchers: () => researchers, personAvailable: index => !busy.has(index),
    facilityAvailable: index => facilities.has(index), powered: () => powered,
  }
  const command = (action: StationResearchAction) => stationResearchCommand(state, host, action)
  return { state, host, researchers, busy, facilities, command, power: (value: boolean) => { powered = value },
    assign: (personIndex = 1, cellIndex = 4) => command({ kind: 'assign', personIndex, cellIndex }),
    advance: (ms: number) => advanceStationResearch(state, host, ms), view: () => stationResearchView(state, host) }
}

describe('独立玩家站C3：首项科研', () => {
  it('只有合格研究员与实际研究室能派工，一站仅一项，不抢占其他人员', () => {
    const w = world()
    expect(w.assign(0)).toEqual({ ok: false, reason: 'person' })
    expect(w.assign(1, 3)).toEqual({ ok: false, reason: 'facility' })
    w.busy.add(1); expect(w.assign()).toEqual({ ok: false, reason: 'person' }); w.busy.clear()
    expect(w.assign()).toEqual({ ok: true })
    expect(w.assign(2, 5)).toEqual({ ok: false, reason: 'busy' })
    expect(w.state.progressMs).toBe(0)
  })
  it('只累计实际有效工时，到点自动登记技术并释放人员，不需领取', () => {
    const w = world(); w.assign(); w.advance(STATION_FIRST_RESEARCH.durationMs - 1)
    expect(w.state.completed).toBe(false); w.advance(1)
    expect(w.state).toMatchObject({ completed: true, progressMs: STATION_FIRST_RESEARCH.durationMs })
    expect(w.state.assignment).toBeUndefined()
    expect(w.assign()).toEqual({ ok: false, reason: 'completed' })
    const saved = structuredClone(w.state); w.advance(10_000_000); expect(w.state).toEqual(saved)
  })
  it('暂停和缺电都保留原人及进度，恢复不补无效工时', () => {
    const w = world(); w.assign(); w.advance(100)
    w.command({ kind: 'pause' }); w.advance(1_000_000)
    expect(w.view()).toMatchObject({ progressMs: 100, blocked: 'paused', assignment: { personIndex: 1 } })
    w.command({ kind: 'resume' }); w.power(false); w.advance(1_000_000)
    expect(w.view()).toMatchObject({ progressMs: 100, blocked: 'power' })
    expect(stationResearchNextEventMs(w.state, w.host)).toBe(Infinity)
    w.power(true); w.advance(100); expect(w.state.progressMs).toBe(200)
  })
  it('撤出人员只释放岗位，不清项目进度或自动续研，换合格人员后继续', () => {
    const w = world(); w.assign(); w.advance(100); w.command({ kind: 'release' }); w.advance(1000)
    expect(w.view()).toMatchObject({ blocked: 'unassigned', progressMs: 100 })
    expect(w.state.assignment).toBeUndefined(); w.assign(2, 5); w.advance(100)
    expect(w.state.progressMs).toBe(200)
  })
  it('人员资格/互斥/设施条件消失时保留进度，恢复原条件才继续', () => {
    const w = world(); w.assign(); w.advance(100)
    w.researchers.splice(0, 1); w.advance(1000); expect(w.view().blocked).toBe('person')
    w.researchers.push(1); w.facilities.delete(4); w.advance(1000); expect(w.view().blocked).toBe('facility')
    w.facilities.add(4); w.busy.add(1); w.advance(1000); expect(w.state.progressMs).toBe(100)
    w.busy.clear(); w.advance(100); expect(w.state.progressMs).toBe(200)
  })
  it('大步小步一致，视图不泄露可修改状态引用', () => {
    const a = world(), b = world(); a.assign(); b.assign()
    a.advance(STATION_FIRST_RESEARCH.durationMs); for (let i = 0; i < 60; i++) b.advance(60_000)
    expect(a.state).toEqual(b.state)
    const w = world(); w.assign(); w.view().assignment!.personIndex = 5
    expect(w.state.assignment!.personIndex).toBe(1)
    expect(cleanStationResearch(JSON.parse(JSON.stringify(a.state)))).toEqual(a.state)
  })
  it('快照拒绝未知项目、伪造完成态、非法进度与完成后残留派工', () => {
    const w = world(); w.assign(); w.advance(100)
    for (const mutate of [(s: any) => { s.projectId = 'unknown' }, (s: any) => { s.progressMs = -1 },
      (s: any) => { s.completed = true }, (s: any) => { s.progressMs = STATION_FIRST_RESEARCH.durationMs },
      (s: any) => { s.assignment.personIndex = 6 }, (s: any) => { s.assignment.paused = 'false' },
      (s: any) => { s.progressMs = STATION_FIRST_RESEARCH.durationMs; s.completed = true }]) {
      const invalid = structuredClone(w.state); mutate(invalid); expect(() => cleanStationResearch(invalid)).toThrow()
    }
  })
  it('拒绝非法时间与未知命令，不把未知命令解释为恢复', () => {
    const w = world(); w.assign(); w.command({ kind: 'pause' })
    const before = structuredClone(w.state)
    expect(w.command({ kind: 'unknown' } as never)).toEqual({ ok: false, reason: 'invalid-action' })
    for (const ms of [-1, NaN, 0.5, Infinity]) expect(() => w.advance(ms)).toThrow()
    expect(w.state).toEqual(before)
  })
})
