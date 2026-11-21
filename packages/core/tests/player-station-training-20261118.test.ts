import { describe, expect, it } from 'vitest'
import { advanceStationTraining, cleanStationTraining, createStationTraining, reconcileStationTraining,
  STATION_COURSE_MS, stationTrainingCommand, stationTrainingNextEventMs, stationTrainingView } from '../src/playerStation/index'
import type { StationTrainingHost, StationQualification } from '../src/playerStation/index'

const MIN = 60_000
function world() {
  const state = createStationTraining(), residents: number[] = [], busy = new Set<number>()
  let ready = true
  const host: StationTrainingHost = { residents: () => residents, available: index => !busy.has(index), ready: () => ready }
  return { state, host, residents, busy, enqueue: (course: StationQualification) => stationTrainingCommand(state, host, { kind: 'enqueue', course }),
    advance: (minutes: number) => advanceStationTraining(state, host, minutes * MIN), view: () => stationTrainingView(state, host),
    setReady: (value: boolean) => { ready = value; reconcileStationTraining(state, host) } }
}

describe('独立玩家站：基础课程与人员资格', () => {
  it('队列没有居民时等待，不从在途或容量凭空生人', () => {
    const w = world(); w.enqueue('engineer'); w.advance(60)
    expect(w.view()).toMatchObject({ residents: 0, seatUsed: 0, queue: ['engineer'], wait: 'person' })
    expect(w.state.qualifications).toEqual([null, null, null, null, null, null])
    w.residents.push(2); reconcileStationTraining(w.state, w.host)
    expect(w.state.active).toEqual({ personIndex: 2, course: 'engineer', progressMs: 0, paused: false })
  })
  it('30分钟完成后只给原居民资格，不新增人口或自动派工', () => {
    const w = world(); w.residents.push(0); w.enqueue('engineer'); w.advance(29)
    expect(w.view()).toMatchObject({ engineers: 0, ordinary: 0, seatUsed: 1 })
    w.advance(1)
    expect(w.view()).toMatchObject({ engineers: 1, researchers: 0, ordinary: 0, seatUsed: 0 })
    expect(w.residents).toEqual([0]); expect(w.state.active).toBeUndefined()
    w.advance(120); expect(w.state.qualifications.filter(Boolean)).toEqual(['engineer'])
  })
  it('两门共用一席，不重用已获工种者，第二门等待另一个普通居民', () => {
    const w = world(); w.residents.push(0); w.enqueue('engineer'); w.enqueue('researcher'); w.advance(60)
    expect(w.view()).toMatchObject({ engineers: 1, researchers: 0, seatUsed: 0, queue: ['researcher'], wait: 'person' })
    w.residents.push(1); w.advance(30)
    expect(w.state.qualifications.slice(0, 2)).toEqual(['engineer', 'researcher'])
    expect(w.residents).toHaveLength(2)
  })
  it('手动暂停保留人员/席位/进度，恢复才续行', () => {
    const w = world(); w.residents.push(0, 1); w.enqueue('engineer'); w.enqueue('researcher'); w.advance(15)
    expect(stationTrainingCommand(w.state, w.host, { kind: 'pause' })).toEqual({ ok: true })
    w.advance(60)
    expect(w.view()).toMatchObject({ seatUsed: 1, ordinary: 1, queue: ['researcher'], active: { personIndex: 0, progressMs: 15 * MIN, paused: true } })
    stationTrainingCommand(w.state, w.host, { kind: 'resume' }); w.advance(15)
    expect(w.state.qualifications[0]).toBe('engineer')
    expect(w.state.active).toMatchObject({ personIndex: 1, course: 'researcher', progressMs: 0 })
  })
  it('中心/保障中断保进度与占用，恢复自动续行且不倒算等待时间', () => {
    const w = world(); w.residents.push(0); w.setReady(false); w.enqueue('researcher'); w.advance(60)
    expect(w.view()).toMatchObject({ seatUsed: 0, wait: 'facilities' })
    w.setReady(true); w.advance(10); w.setReady(false); w.advance(120)
    expect(w.view()).toMatchObject({ seatUsed: 1, active: { progressMs: 10 * MIN, blocked: 'facilities' } })
    expect(stationTrainingNextEventMs(w.state, w.host)).toBe(Infinity)
    w.setReady(true); w.advance(20); expect(w.view().researchers).toBe(1)
  })
  it('不强抽忙碌居民；受训时被外部错误占用则阻塞，不继续双占', () => {
    const w = world(); w.residents.push(0, 1); w.busy.add(0); w.enqueue('engineer')
    expect(w.state.active?.personIndex).toBe(1)
    w.busy.add(1); w.advance(30)
    expect(w.view().active).toMatchObject({ progressMs: 0, blocked: 'person' })
    w.busy.delete(1); w.advance(30); expect(w.view().engineers).toBe(1)
  })
  it('只移除未开始排队项，不动正在上课者、其他队列或资格', () => {
    const w = world(); w.residents.push(0, 1); w.enqueue('engineer'); w.enqueue('researcher'); w.enqueue('engineer')
    const active = structuredClone(w.state.active)
    stationTrainingCommand(w.state, w.host, { kind: 'remove', index: 0 })
    expect(w.state.active).toEqual(active); expect(w.state.queue).toEqual(['engineer'])
    w.advance(60); expect(w.view().engineers).toBe(2)
  })
  it('按来源六人限制有限计划，拒绝异常命令且无副作用', () => {
    const w = world()
    for (let i = 0; i < 6; i++) expect(w.enqueue('engineer')).toEqual({ ok: true })
    const before = structuredClone(w.state)
    expect(w.enqueue('researcher')).toEqual({ ok: false, reason: 'queue-full' })
    expect(stationTrainingCommand(w.state, w.host, { kind: 'enqueue', course: 'unknown' } as never)).toEqual({ ok: false, reason: 'invalid-action' })
    expect(stationTrainingCommand(w.state, w.host, { kind: 'remove', index: 9 })).toEqual({ ok: false, reason: 'invalid-index' })
    expect(stationTrainingCommand(w.state, w.host, { kind: 'pause' })).toEqual({ ok: false, reason: 'no-course' })
    expect(() => w.advance(-1)).toThrow(); expect(w.state).toEqual(before)
  })
  it('六人课程大步与小步一致，逐阶段清洗和读写不重复发资格', () => {
    const large = world(), small = world()
    for (const w of [large, small]) {
      w.residents.push(0, 1, 2, 3, 4, 5)
      for (let i = 0; i < 6; i++) w.enqueue(i % 2 ? 'researcher' : 'engineer')
    }
    large.advance(180)
    for (let i = 0; i < 720; i++) { small.advance(0.25); expect(cleanStationTraining(JSON.parse(JSON.stringify(small.state)), small.residents)).toEqual(small.state) }
    expect(small.state).toEqual(large.state)
    expect(small.view()).toMatchObject({ engineers: 3, researchers: 3, seatUsed: 0 })
  })
  it('边界延后协调留给宿主更新条件，不提前抢下一人', () => {
    const w = world(); w.residents.push(0, 1); w.enqueue('engineer'); w.enqueue('researcher')
    advanceStationTraining(w.state, w.host, STATION_COURSE_MS, true)
    expect(w.state.active).toBeUndefined(); expect(w.state.queue).toEqual(['researcher'])
    w.setReady(false); expect(w.state.active).toBeUndefined()
    w.setReady(true); expect(w.state.active).toMatchObject({ personIndex: 1, progressMs: 0 })
  })
  it('视图不修改状态、不暴露资格或队列的可写引用', () => {
    const w = world(); w.residents.push(0); w.enqueue('engineer'); w.enqueue('researcher')
    const before = structuredClone(w.state), view = w.view()
    view.qualifications[0] = 'researcher'; view.queue.length = 0; view.active!.progressMs = 99
    expect(w.state).toEqual(before)
  })
  it('严格拒绝未知资格、孤立受训者、已获资格重复上课或完成边界快照', () => {
    const w = world(); w.residents.push(0); w.enqueue('engineer'); w.advance(15)
    for (const mutate of [(s: any) => { s.qualifications[0] = 'unknown' }, (s: any) => { s.qualifications[5] = 'engineer' },
      (s: any) => { s.active.personIndex = 1 }, (s: any) => { s.qualifications[0] = 'engineer' },
      (s: any) => { s.active.progressMs = STATION_COURSE_MS }, (s: any) => { s.active.paused = 1 },
      (s: any) => { s.queue = ['unknown'] }, (s: any) => { delete s.qualifications }, (s: any) => { s.queue = Array(6).fill('engineer') }]) {
      const bad = structuredClone(w.state); mutate(bad)
      expect(() => cleanStationTraining(bad, w.residents)).toThrow()
    }
  })
})
