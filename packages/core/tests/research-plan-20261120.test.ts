import { describe, expect, it } from 'vitest'
import { STATION_FIRST_RESEARCH, STATION_RESEARCH_CATALOG, advanceStationResearch, cleanStationResearch,
  createStationResearch, researchCompleted, stationResearchCommand, stationResearchNextEventMs,
  stationResearchView } from '../src/playerStation/research'
import type { StationResearch, StationResearchAction, StationResearchHost } from '../src/playerStation/research'

const MIN = 60_000
const FIRST = STATION_FIRST_RESEARCH.id
const POWER = 'station-power-2'
const LIFE = 'station-life-2'
const MANUFACTURING = 'station-manufacturing'
const TRAINING = 'station-training'
const WARNING = 'station-warning'

function world(initial = createStationResearch()) {
  const state = initial, researchers = [1, 2], busy = new Set<number>(), facilities = new Set([0, 4, 15])
  let powered = true
  const host: StationResearchHost = {
    researchers: () => researchers, personAvailable: index => !busy.has(index),
    facilityAvailable: index => facilities.has(index), powered: () => powered,
  }
  const command = (action: StationResearchAction) => stationResearchCommand(state, host, action)
  return { state, host, researchers, busy, facilities, command,
    assign: (projectId?: string, personIndex = 1, cellIndex = 4) => command({ kind: 'assign', projectId, personIndex, cellIndex }),
    enqueue: (projectId: string) => command({ kind: 'enqueue', projectId }),
    advance: (deltaMs: number, deferBoundary = false) => advanceStationResearch(state, host, deltaMs, deferBoundary),
    power: (value: boolean) => { powered = value }, view: () => stationResearchView(state, host) }
}

function savedState(): StationResearch {
  const w = world()
  w.assign(); w.advance(123); w.command({ kind: 'release' })
  w.assign(POWER); w.advance(456); w.command({ kind: 'release' })
  w.assign(WARNING); w.advance(60 * MIN)
  w.assign(TRAINING); w.advance(789); w.enqueue(FIRST); w.enqueue(POWER); w.enqueue(LIFE)
  return w.state
}

describe('独立玩家站科研目录与计划', () => {
  it('固定六项目工时，视图保留旧字段并列出未开工项目', () => {
    const w = world()
    expect(STATION_RESEARCH_CATALOG).toEqual([
      { id: FIRST, durationMs: 60 * MIN }, { id: POWER, durationMs: 120 * MIN },
      { id: LIFE, durationMs: 120 * MIN }, { id: MANUFACTURING, durationMs: 90 * MIN },
      { id: TRAINING, durationMs: 90 * MIN }, { id: WARNING, durationMs: 60 * MIN },
    ])
    expect(w.state).toEqual({ version: 2, projectId: FIRST, progressMs: 0, completed: false, archives: {}, queue: [] })
    expect(w.view()).toMatchObject({ projectId: FIRST, durationMs: 60 * MIN, remainingMs: 60 * MIN,
      progressMs: 0, completed: false, blocked: 'unassigned', queue: [],
      catalog: STATION_RESEARCH_CATALOG.map(project => ({ ...project, progressMs: 0, completed: false })) })
  })

  it.each(STATION_RESEARCH_CATALOG)('$id 可直接开工，无互锁或材料接口', project => {
    const w = world()
    expect(w.assign(project.id)).toEqual({ ok: true })
    expect(stationResearchNextEventMs(w.state, w.host)).toBe(project.durationMs)
    w.advance(project.durationMs - 1)
    expect(researchCompleted(w.state, project.id)).toBe(false)
    expect(stationResearchNextEventMs(w.state, w.host)).toBe(1)
    w.advance(1)
    expect(researchCompleted(w.state, project.id)).toBe(true)
    expect(w.state.assignment).toBeUndefined()
    expect(w.view()).toMatchObject({ projectId: project.id, durationMs: project.durationMs, remainingMs: 0, blocked: 'completed' })
    expect(w.view().catalog.filter(entry => entry.completed).map(entry => entry.id)).toEqual([project.id])
    expect(w.assign(project.id)).toEqual({ ok: false, reason: 'completed' })
    expect(researchCompleted(w.state, 'unknown')).toBe(false)
  })

  it('换项目归档并恢复部分进度，当前项目不重复归档', () => {
    const w = world(); w.assign(); w.advance(123)
    const busy = structuredClone(w.state)
    expect(w.assign(POWER)).toEqual({ ok: false, reason: 'busy' })
    expect(w.state).toEqual(busy)
    w.command({ kind: 'release' }); w.assign(POWER); w.advance(456)
    expect(w.state.archives).toEqual({ [FIRST]: { progressMs: 123, completed: false } })
    w.command({ kind: 'release' }); w.assign(FIRST, 2, 15)
    expect(w.state).toMatchObject({ projectId: FIRST, progressMs: 123, assignment: { cellIndex: 15, personIndex: 2 } })
    expect(w.state.archives).toEqual({ [POWER]: { progressMs: 456, completed: false } })
    w.advance(1)
    expect(w.state.progressMs).toBe(124)
    expect(w.view().catalog.find(entry => entry.id === POWER)).toMatchObject({ progressMs: 456, completed: false })
  })

  it('完成归档仍可查询且不能重复研究，其他基础项仍可选择', () => {
    const w = world(); w.assign(); w.advance(60 * MIN)
    expect(w.assign(POWER)).toEqual({ ok: true })
    expect(w.state.archives[FIRST]).toEqual({ progressMs: 60 * MIN, completed: true })
    expect(researchCompleted(w.state, FIRST)).toBe(true)
    expect(researchCompleted(w.state, POWER)).toBe(false)
    const before = structuredClone(w.state)
    expect(w.assign(FIRST)).toEqual({ ok: false, reason: 'completed' })
    expect(w.enqueue(FIRST)).toEqual({ ok: false, reason: 'completed' })
    expect(w.state).toEqual(before)
  })

  it('入队、按下标移位和移除只改变计划，不替换当前项目', () => {
    const w = world(); w.assign(); w.advance(12)
    expect(w.enqueue(POWER)).toEqual({ ok: true })
    expect(w.enqueue(LIFE)).toEqual({ ok: true })
    expect(w.enqueue(WARNING)).toEqual({ ok: true })
    expect(w.command({ kind: 'move', fromIndex: 2, toIndex: 0 })).toEqual({ ok: true })
    expect(w.state.queue).toEqual([WARNING, POWER, LIFE])
    expect(w.command({ kind: 'move', fromIndex: 0, toIndex: 2 })).toEqual({ ok: true })
    expect(w.command({ kind: 'move', fromIndex: 1, toIndex: 1 })).toEqual({ ok: true })
    expect(w.command({ kind: 'remove', index: 1 })).toEqual({ ok: true })
    expect(w.state.queue).toEqual([POWER, WARNING])
    expect(w.state).toMatchObject({ projectId: FIRST, progressMs: 12, assignment: { personIndex: 1 } })
    expect(w.state.archives).toEqual({})
  })

  it('非法计划命令不改状态，不能排入当前项、重复项或未知项', () => {
    const w = world(); w.enqueue(POWER)
    for (const [action, reason] of [
      [{ kind: 'enqueue', projectId: FIRST }, 'busy'], [{ kind: 'enqueue', projectId: POWER }, 'queued'],
      [{ kind: 'enqueue', projectId: 'unknown' }, 'project'], [{ kind: 'assign', projectId: 'unknown', personIndex: 1, cellIndex: 4 }, 'project'],
      [{ kind: 'remove', index: -1 }, 'invalid-index'], [{ kind: 'remove', index: 1 }, 'invalid-index'],
      [{ kind: 'remove', index: 0.5 }, 'invalid-index'], [{ kind: 'remove', index: NaN }, 'invalid-index'],
      [{ kind: 'move', fromIndex: 0, toIndex: 1 }, 'invalid-index'], [{ kind: 'move', fromIndex: Infinity, toIndex: 0 }, 'invalid-index'],
      [{ kind: 'move', fromIndex: 0, toIndex: -1 }, 'invalid-index'], [{ kind: 'unknown' }, 'invalid-action'],
    ] as const) {
      const before = structuredClone(w.state)
      expect(w.command(action as StationResearchAction)).toEqual({ ok: false, reason })
      expect(w.state).toEqual(before)
    }
  })

  it('选中队列项目会去除对应待研项，派工校验失败不提前切换或出队', () => {
    const w = world(); w.enqueue(POWER); w.enqueue(LIFE)
    const before = structuredClone(w.state)
    expect(w.assign(POWER, 0)).toEqual({ ok: false, reason: 'person' })
    expect(w.assign(POWER, 1, 3)).toEqual({ ok: false, reason: 'facility' })
    expect(w.state).toEqual(before)
    expect(w.assign(POWER)).toEqual({ ok: true })
    expect(w.state.queue).toEqual([LIFE])
    expect(w.state.projectId).toBe(POWER)
    expect(w.state.archives[POWER]).toBeUndefined()
  })

  it.each([false, true])('完成边界只切换一项且保留同一岗位，不透支工时（deferBoundary=%s）', deferBoundary => {
    const w = world(); w.assign(); w.enqueue(POWER); w.enqueue(WARNING)
    const assignment = w.state.assignment
    w.advance(Number.MAX_SAFE_INTEGER, deferBoundary)
    expect(w.state).toMatchObject({ projectId: POWER, progressMs: 0, completed: false, queue: [WARNING] })
    expect(w.state.assignment).toBe(assignment)
    expect(researchCompleted(w.state, FIRST)).toBe(true)
    expect(stationResearchNextEventMs(w.state, w.host)).toBe(120 * MIN)
    w.advance(0, deferBoundary)
    expect(w.state.progressMs).toBe(0)
    w.advance(17, deferBoundary)
    expect(w.state.progressMs).toBe(17)
    w.advance(120 * MIN - 17, deferBoundary)
    expect(w.state).toMatchObject({ projectId: WARNING, progressMs: 0, queue: [] })
    expect(w.state.assignment).toBe(assignment)
    expect(researchCompleted(w.state, POWER)).toBe(true)
    w.advance(60 * MIN, deferBoundary)
    expect(w.state).toMatchObject({ projectId: WARNING, completed: true, progressMs: 60 * MIN })
    expect(w.state.assignment).toBeUndefined()
  })

  it('衔接已归档项目沿用原进度，后续区间重新核验宿主条件', () => {
    const w = world(); w.assign(POWER); w.advance(100); w.command({ kind: 'release' })
    w.assign(FIRST); w.enqueue(POWER); w.advance(60 * MIN)
    expect(w.state.progressMs).toBe(100)
    expect(w.state.archives[POWER]).toBeUndefined()
    w.power(false); w.advance(1000)
    expect(w.view().blocked).toBe('power')
    expect(stationResearchNextEventMs(w.state, w.host)).toBe(Infinity)
    w.power(true); w.busy.add(1); w.advance(1000)
    expect(w.view().blocked).toBe('person')
    w.busy.clear(); w.facilities.delete(4); w.advance(1000)
    expect(w.view().blocked).toBe('facility')
    w.facilities.add(4); w.command({ kind: 'pause' }); w.advance(1000)
    expect(w.view().blocked).toBe('paused')
    expect(w.state.progressMs).toBe(100)
    w.command({ kind: 'resume' }); w.advance(1)
    expect(w.state.progressMs).toBe(101)
  })

  it('无派工的计划不私自抓人，完成后新计划需重新派工', () => {
    const w = world(); w.enqueue(POWER); w.advance(60 * MIN)
    expect(w.state).toMatchObject({ projectId: FIRST, progressMs: 0, queue: [POWER] })
    expect(w.state.assignment).toBeUndefined()
    w.assign(); w.command({ kind: 'release' }); w.advance(60 * MIN)
    expect(w.state.progressMs).toBe(0)
    w.assign(); w.advance(60 * MIN); w.advance(120 * MIN)
    expect(w.state.completed).toBe(true)
    expect(w.enqueue(WARNING)).toEqual({ ok: true })
    expect(w.state).toMatchObject({ projectId: WARNING, progressMs: 0, queue: [] })
    w.advance(60 * MIN)
    expect(w.state.progressMs).toBe(0)
    expect(w.state.assignment).toBeUndefined()
    expect(w.assign()).toEqual({ ok: true })
  })

  it('整条计划经 nextEvent 分段与逐分钟推进一致，含全部六项', () => {
    const a = world(), b = world()
    for (const w of [a, b]) {
      w.assign()
      for (const project of STATION_RESEARCH_CATALOG.slice(1)) w.enqueue(project.id)
    }
    for (const project of STATION_RESEARCH_CATALOG) {
      expect(stationResearchNextEventMs(a.state, a.host)).toBe(project.durationMs)
      a.advance(project.durationMs, true)
    }
    for (let i = 0; i < 540; i++) b.advance(MIN, true)
    expect(a.state).toEqual(b.state)
    expect(a.view().catalog.every(project => project.completed)).toBe(true)
    expect(Object.keys(a.state.archives)).toHaveLength(5)
    expect(a.state.archives[a.state.projectId]).toBeUndefined()
    expect(cleanStationResearch(JSON.parse(JSON.stringify(a.state)))).toEqual(a.state)
  })

  it.each([0, 15])('扩站格 %i 可派工和读档', cellIndex => {
    const w = world()
    expect(w.assign(POWER, 1, cellIndex)).toEqual({ ok: true })
    expect(cleanStationResearch(JSON.parse(JSON.stringify(w.state)))).toEqual(w.state)
  })

  it.each([-1, 16, 0.5, NaN, Infinity])('拒绝非法格 %s 且不信任宿主放宽范围', cellIndex => {
    const w = world(); w.facilities.add(cellIndex)
    expect(w.assign(POWER, 1, cellIndex)).toEqual({ ok: false, reason: 'facility' })
    w.assign()
    const invalid = structuredClone(w.state)
    invalid.assignment!.cellIndex = cellIndex
    expect(() => cleanStationResearch(invalid)).toThrow('Invalid station research snapshot')
  })

  it('v1 未派工、派工、暂停与完成快照均迁移成 v2，不凭空生成技术或计划', () => {
    for (const legacy of [
      { version: 1, projectId: FIRST, progressMs: 0, completed: false },
      { version: 1, projectId: FIRST, progressMs: 50, completed: false, assignment: { cellIndex: 4, personIndex: 1, paused: false } },
      { version: 1, projectId: FIRST, progressMs: 60, completed: false, assignment: { cellIndex: 8, personIndex: 2, paused: true } },
      { version: 1, projectId: FIRST, progressMs: 60 * MIN, completed: true },
    ]) {
      const before = structuredClone(legacy)
      const state = cleanStationResearch(legacy)
      expect(state).toEqual({ ...legacy, version: 2, archives: {}, queue: [] })
      expect(legacy).toEqual(before)
      expect(researchCompleted(state, FIRST)).toBe(legacy.completed)
      expect(researchCompleted(state, POWER)).toBe(false)
      expect(cleanStationResearch(state)).toEqual(state)
    }
  })

  it('混合完成/部分进度与计划无损往返，读档后同一边界得相同结果', () => {
    const state = savedState(), loaded = cleanStationResearch(JSON.parse(JSON.stringify(state)))
    expect(loaded).toEqual(state)
    const a = world(state), b = world(loaded)
    expect(researchCompleted(loaded, WARNING)).toBe(true)
    expect(researchCompleted(loaded, FIRST)).toBe(false)
    for (let i = 0; i < 4; i++) {
      const next = stationResearchNextEventMs(a.state, a.host)
      expect(stationResearchNextEventMs(b.state, b.host)).toBe(next)
      a.advance(next, true); b.advance(next, true)
      expect(a.state).toEqual(b.state)
    }
  })

  it('视图和清洗返回的队列、目录、岗位与归档均不泄露状态引用', () => {
    const w = world(savedState()), before = structuredClone(w.state), view = w.view()
    view.queue.length = 0; view.catalog[0].progressMs = 999; view.catalog[0].completed = true
    view.assignment!.personIndex = 5
    const cleaned = cleanStationResearch(w.state)
    cleaned.queue.length = 0; cleaned.assignment!.paused = true
    cleaned.archives[FIRST]!.progressMs = 999
    expect(w.state).toEqual(before)
  })

  it('拒绝非法快照容器和缺失版本字段', () => {
    for (const invalid of [null, undefined, [], new Date(), 1, 'research', {},
      { ...createStationResearch(), version: 3 }, { ...createStationResearch(), projectId: 'unknown' }]) {
      expect(() => cleanStationResearch(invalid)).toThrow('Invalid station research snapshot')
    }
  })

  it('拒绝非法/重复归档、伪造完成与非法队列，拒绝时不修改输入', () => {
    const mutations: ((state: any) => void)[] = [
      s => { s.progressMs = -1 }, s => { s.progressMs = NaN }, s => { s.progressMs = Infinity },
      s => { s.progressMs = 0.5 }, s => { s.progressMs = 90 * MIN + 1 },
      s => { s.completed = true }, s => { s.completed = 'false' }, s => { s.progressMs = 90 * MIN },
      s => { s.progressMs = 90 * MIN; s.completed = true },
      s => { delete s.archives }, s => { s.archives = [] }, s => { s.archives = null },
      s => { s.archives = new Date() }, s => { s.archives.unknown = { progressMs: 0, completed: false } },
      s => { s.archives[TRAINING] = { progressMs: 789, completed: false } },
      s => { s.archives[FIRST] = null }, s => { s.archives[FIRST].progressMs = -1 },
      s => { s.archives[FIRST].progressMs = 0.5 }, s => { s.archives[FIRST].progressMs = Infinity },
      s => { s.archives[FIRST].progressMs = 60 * MIN + 1 }, s => { s.archives[FIRST].completed = true },
      s => { s.archives[FIRST].progressMs = 60 * MIN }, s => { s.archives[WARNING].progressMs-- },
      s => { s.archives[WARNING].completed = false },
      s => { delete s.queue }, s => { s.queue = null }, s => { s.queue = {} },
      s => { s.queue.push(FIRST) }, s => { s.queue.push(TRAINING) }, s => { s.queue.push(WARNING) },
      s => { s.queue.push('unknown') }, s => { s.queue.push(1) }, s => { s.queue = Array(1) },
      s => { s.queue = [FIRST, POWER, LIFE, MANUFACTURING, WARNING, TRAINING] },
      s => { s.assignment.cellIndex = 16 }, s => { s.assignment.personIndex = 6 },
      s => { s.assignment.personIndex = -1 }, s => { s.assignment.personIndex = 1.5 },
      s => { s.assignment.paused = 0 }, s => { s.assignment = [] }, s => { s.assignment = null },
    ]
    for (const mutate of mutations) {
      const invalid = structuredClone(savedState()); mutate(invalid)
      const before = structuredClone(invalid)
      expect(() => cleanStationResearch(invalid)).toThrow('Invalid station research snapshot')
      expect(invalid).toEqual(before)
    }
    const completed = createStationResearch()
    completed.progressMs = 60 * MIN; completed.completed = true; completed.queue = [POWER]
    expect(() => cleanStationResearch(completed)).toThrow('Invalid station research snapshot')
  })

  it('v1 不能夹带新目录、归档或队列字段绕过迁移校验', () => {
    const legacy = { version: 1, projectId: FIRST, progressMs: 0, completed: false }
    for (const invalid of [{ ...legacy, projectId: POWER }, { ...legacy, archives: {} }, { ...legacy, queue: [] },
      { ...legacy, progressMs: 60 * MIN, completed: true, assignment: { cellIndex: 4, personIndex: 1, paused: false } }]) {
      expect(() => cleanStationResearch(invalid)).toThrow('Invalid station research snapshot')
    }
  })
})
