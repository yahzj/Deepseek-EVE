import { describe, expect, it } from 'vitest'
import { advanceStationSecurity, cleanStationSecurity, createStationSecurity, stationSecurityCommand,
  stationSecurityNextEventMs, stationSecurityView, STATION_SECURITY_JOB_MS, STATION_SECURITY_RAID_MS,
  STATION_SECURITY_SOURCES, STATION_SECURITY_TRAVEL_MS, type StationSecurityHost, type StationSecurityResult } from '../src/playerStation/security'

const sourceId = STATION_SECURITY_SOURCES[0]!.id
function fixture(outcome: StationSecurityResult['outcome'] = 'victory') {
  const state = createStationSecurity(), locked = new Set<string>()
  const stock: Record<string, number> = { 'ammo-kinetic-l': 1000, 'repairkit-civ': 100 }
  const ships: Record<string, string> = { a: 'ship-a', b: 'ship-b', c: 'ship-c', d: 'ship-d', e: 'ship-e' }
  let calls = 0, ready = true, warning = true, denyClaim = false, denyTake = false
  const host: StationSecurityHost = {
    ready: () => ready, warningOnline: () => warning,
    team: id => ships[id] ? { available: !locked.has(id), shipId: ships[id]! } : undefined,
    claimTeams(ids) { if (denyClaim || ids.some(id => locked.has(id))) return false; ids.forEach(id => locked.add(id)); return true },
    releaseTeams(ids) { ids.forEach(id => locked.delete(id)) },
    available: id => stock[id] ?? 0,
    take(bill) {
      if (denyTake || Object.entries(bill).some(([id, n]) => (stock[id] ?? 0) < n)) return false
      for (const [id, n] of Object.entries(bill)) stock[id] = (stock[id] ?? 0) - n
      return true
    },
    settle({ reward }) { for (const [id, n] of Object.entries(reward)) stock[id] = (stock[id] ?? 0) + n },
    resolve() { calls++; return { outcome, durationMs: 10_000, ammoUsed: { 'ammo-kinetic-l': 3 }, reward: { 'part-circuit': 20 } } },
  }
  return { state, host, stock, locked, ships, get calls() { return calls }, setReady: (v: boolean) => { ready = v },
    setWarning: (v: boolean) => { warning = v }, denyClaim: () => { denyClaim = true }, denyTake: () => { denyTake = true } }
}
function start(f: ReturnType<typeof fixture>, kind: 'clear' | 'patrol' | 'escort' = 'clear') {
  return stationSecurityCommand(f.state, f.host, { kind: 'start', missionKind: kind, teamIds: ['a'], ...(kind === 'escort' ? {} : { sourceId }) })
}

describe('玩家站非破坏安全 core', () => {
  it('三来源固定真实身份；拒绝重复队伍、无队伍、超过四队、未知来源', () => {
    const f = fixture()
    expect(f.state.sources.map(s => s.id)).toEqual(STATION_SECURITY_SOURCES.map(s => s.id))
    for (const teamIds of [[], ['a', 'a'], ['a', 'b', 'c', 'd', 'e'], ['missing']])
      expect(stationSecurityCommand(f.state, f.host, { kind: 'start', missionKind: 'clear', teamIds, sourceId }).ok).toBe(false)
    expect(stationSecurityCommand(f.state, f.host, { kind: 'start', missionKind: 'clear', teamIds: ['a'], sourceId: 'bad' }).ok).toBe(false)
    expect(stationSecurityCommand(f.state, f.host, { kind: 'start', missionKind: 'escort', teamIds: ['a'], sourceId }).ok).toBe(false)
    expect(f.locked.size).toBe(0)
  })
  it('出发原子锁船，守备同船不可外派，暂停仍保留锁', () => {
    const f = fixture()
    f.ships.b = f.ships.a!
    expect(stationSecurityCommand(f.state, f.host, { kind: 'guard', teamIds: ['a'] }).ok).toBe(true)
    expect(stationSecurityCommand(f.state, f.host, { kind: 'start', missionKind: 'clear', teamIds: ['b'], sourceId }).ok).toBe(false)
    stationSecurityCommand(f.state, f.host, { kind: 'pause', target: 'guard' })
    expect(f.locked.has('a')).toBe(true)
    expect(stationSecurityCommand(f.state, f.host, { kind: 'unguard' }).ok).toBe(true)
    f.denyClaim()
    expect(start(f).ok).toBe(false)
    expect(f.stock['ammo-kinetic-l']).toBe(1000)
  })
  it.each(['victory', 'defeat'] as const)('清剿%s按真实战斗耗时，返航释放，成功只奖一次', outcome => {
    const f = fixture(outcome)
    expect(start(f).ok).toBe(true)
    expect(stationSecurityNextEventMs(f.state, f.host)).toBe(STATION_SECURITY_TRAVEL_MS)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS)
    expect(f.calls).toBe(1)
    expect(f.stock['ammo-kinetic-l']).toBe(997)
    expect(f.state.sources[0]!.cleared).toBe(false)
    advanceStationSecurity(f.state, f.host, 10_000)
    expect(f.state.sources[0]!.cleared).toBe(outcome === 'victory')
    expect(f.state.mission?.phase).toBe('returning')
    expect(f.locked.has('a')).toBe(true)
    expect(f.stock['part-circuit'] ?? 0).toBe(outcome === 'victory' ? 20 : 0)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS)
    expect(f.locked.size).toBe(0)
    expect(f.state.mission).toBeUndefined()
    if (outcome === 'victory') expect(start(f)).toEqual({ ok: false, reason: 'cleared' })
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS)
    expect(f.calls).toBe(1)
    expect(f.state.reports.filter(r => r.experience > 0)).toHaveLength(1)
  })
  it('护航固定30分钟，只扣一次固定物资，不调用战斗，不自动循环', () => {
    const f = fixture()
    expect(start(f, 'escort').ok).toBe(true)
    expect(f.stock['repairkit-civ']).toBe(96)
    expect(f.stock['ammo-kinetic-l']).toBe(940)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS - 1)
    expect(f.locked.has('a')).toBe(true)
    expect(f.stock['part-circuit']).toBe(20)
    advanceStationSecurity(f.state, f.host, 1)
    expect(f.locked.size).toBe(0)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS)
    expect(f.calls).toBe(0)
    expect(f.stock['part-circuit']).toBe(20)
  })
  it('巡逻一次30分钟有限结算，忽略清剿奖励且不清来源', () => {
    const f = fixture()
    start(f, 'patrol')
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS * 2)
    expect(f.calls).toBe(1)
    expect(f.stock['part-circuit']).toBe(4)
    expect(f.state.sources[0]!.cleared).toBe(false)
    expect(f.state.mission).toBeUndefined()
  })
  it('巡逻战败按真实战斗时长提前返航，不等待满30分钟', () => {
    const f = fixture('defeat')
    start(f, 'patrol')
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS + 10_000)
    expect(f.state.mission).toMatchObject({ phase: 'returning', reason: 'defeat' })
    expect(cleanStationSecurity(JSON.parse(JSON.stringify(f.state)), f.host)).toEqual(f.state)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS)
    expect(f.state.mission).toBeUndefined()
    expect(f.stock['part-circuit']).toBeUndefined()
    expect(f.calls).toBe(1)
  })
  it('停止按已飞行去程返航；已结算奖保留至归航，不瞬移', () => {
    const f = fixture()
    start(f)
    advanceStationSecurity(f.state, f.host, 1234)
    stationSecurityCommand(f.state, f.host, { kind: 'stop' })
    expect(f.state.mission?.durationMs).toBe(1234)
    advanceStationSecurity(f.state, f.host, 1233)
    expect(f.locked.has('a')).toBe(true)
    advanceStationSecurity(f.state, f.host, 1)
    expect(f.calls).toBe(0)
    start(f)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS + 10_000)
    stationSecurityCommand(f.state, f.host, { kind: 'stop' })
    expect(f.stock['part-circuit']).toBe(20)
    expect(f.locked.has('a')).toBe(true)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS)
    expect(f.locked.size).toBe(0)
  })
  it('战斗开始后停止保留已扣弹药报告，不奖励，不重复停止报告', () => {
    const f = fixture()
    start(f)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS + 1)
    stationSecurityCommand(f.state, f.host, { kind: 'stop' })
    stationSecurityCommand(f.state, f.host, { kind: 'stop' })
    expect(f.state.reports).toHaveLength(1)
    expect(f.state.reports[0]).toMatchObject({ ammoUsed: { 'ammo-kinetic-l': 3 }, experience: 0, reason: 'stopped' })
    expect(cleanStationSecurity(JSON.parse(JSON.stringify(f.state)), f.host)).toEqual(f.state)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS)
    expect(f.stock['part-circuit']).toBeUndefined()
    expect(f.state.sources[0]!.cleared).toBe(false)
  })
  it('缺补给明确返航，暂停任务不重试；船绑定变更不出战', () => {
    for (const mismatch of [false, true]) {
      const f = fixture()
      start(f)
      if (mismatch) f.ships.a = 'changed'
      else f.stock['ammo-kinetic-l'] = 0
      advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS)
      expect(f.state.mission?.reason).toBe(mismatch ? 'teams' : 'supplies')
      advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS)
      expect(f.calls).toBe(mismatch ? 0 : 1)
      expect(f.locked.size).toBe(0)
      expect(f.stock['part-circuit']).toBeUndefined()
    }
    const f = fixture()
    f.denyTake()
    expect(start(f, 'escort')).toEqual({ ok: false, reason: 'supplies' })
    expect(f.locked.size).toBe(0)
  })
  it('暂停与供电只暂停作业，返回不依赖供电', () => {
    const f = fixture()
    start(f)
    stationSecurityCommand(f.state, f.host, { kind: 'pause' })
    advanceStationSecurity(f.state, f.host, 100)
    expect(f.state.mission?.progressMs).toBe(0)
    expect(f.locked.has('a')).toBe(true)
    stationSecurityCommand(f.state, f.host, { kind: 'resume' })
    f.setReady(false)
    advanceStationSecurity(f.state, f.host, 100)
    expect(f.state.exposure).toBe(0)
    stationSecurityCommand(f.state, f.host, { kind: 'stop' })
    advanceStationSecurity(f.state, f.host, 1)
    expect(f.state.mission).toBeUndefined()
  })
  it('无外派不袭扰；外派暴露后每六小时来袭，警戒只读计划，未守只报告风险', () => {
    const f = fixture()
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_RAID_MS)
    expect(f.state.reports).toHaveLength(0)
    start(f, 'escort')
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS)
    const stock = { ...f.stock }
    f.setWarning(false)
    expect(stationSecurityView(f.state, f.host).sources[0]!.remainingMs).toBeUndefined()
    f.setWarning(true)
    expect(stationSecurityView(f.state, f.host).sources[0]!.remainingMs).toBe(STATION_SECURITY_RAID_MS - STATION_SECURITY_JOB_MS)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_RAID_MS - STATION_SECURITY_JOB_MS)
    expect(f.state.reports.filter(r => r.materialRisk)).toHaveLength(3)
    expect(f.stock).toEqual(stock)
    expect(f.calls).toBe(0)
  })
  it.each(['victory', 'defeat'] as const)('守备%s真调用resolve，连袭不重叠且无反复清剿奖', outcome => {
    const f = fixture(outcome)
    start(f, 'escort')
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS)
    stationSecurityCommand(f.state, f.host, { kind: 'guard', teamIds: ['b'] })
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_RAID_MS - STATION_SECURITY_JOB_MS)
    expect(f.calls).toBe(1)
    expect(f.state.raid).toBeDefined()
    expect(stationSecurityCommand(f.state, f.host, { kind: 'unguard' }).ok).toBe(false)
    advanceStationSecurity(f.state, f.host, 30_000)
    expect(f.state.guard?.paused).toBe(outcome === 'defeat')
    expect(f.calls).toBe(outcome === 'victory' ? 3 : 1)
    expect(f.stock['part-circuit']).toBe(20)
    expect(f.locked.has('b')).toBe(true)
    expect(f.state.sources.every(s => !s.cleared)).toBe(true)
  })
  it('守备缺弹暂停且持锁；无守备袭扰暂停在途任务，警戒不改变状态', () => {
    const f = fixture()
    start(f, 'escort')
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_JOB_MS)
    stationSecurityCommand(f.state, f.host, { kind: 'guard', teamIds: ['b'] })
    f.stock['ammo-kinetic-l'] = 0
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_RAID_MS - STATION_SECURITY_JOB_MS)
    expect(f.state.guard?.paused).toBe(true)
    expect(f.state.raid).toBeUndefined()
    expect(f.calls).toBe(1)
    expect(f.locked.has('b')).toBe(true)
    expect(f.state.reports.some(r => r.reason === 'supplies' && r.materialRisk)).toBe(true)
    f.stock['ammo-kinetic-l'] = 100
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_RAID_MS - 1)
    start(f)
    const before = structuredClone(f.state)
    stationSecurityView(f.state, f.host)
    expect(f.state).toEqual(before)
    advanceStationSecurity(f.state, f.host, 1)
    expect(f.state.mission?.paused).toBe(true)
    expect(f.state.mission?.reason).toBe('harassment')
    expect(f.calls).toBe(1)
  })
  it('任务清剿完成的快照恢复不重新发奖，清除来源不再来袭', () => {
    const f = fixture()
    start(f)
    advanceStationSecurity(f.state, f.host, STATION_SECURITY_TRAVEL_MS + 10_000)
    const restored = cleanStationSecurity(JSON.parse(JSON.stringify(f.state)), f.host)
    advanceStationSecurity(restored, f.host, STATION_SECURITY_RAID_MS)
    expect(f.stock['part-circuit']).toBe(20)
    expect(restored.sources[0]!.raids).toBe(0)
    expect(restored.reports.filter(r => r.kind === 'clear')).toHaveLength(1)
  })
  it('正在防守的快照往返不重新resolve或扣弹，恢复后与原实例一致', () => {
    const a = fixture(), b = fixture()
    for (const f of [a, b]) {
      start(f, 'escort')
      stationSecurityCommand(f.state, f.host, { kind: 'guard', teamIds: ['b'] })
      advanceStationSecurity(f.state, f.host, STATION_SECURITY_RAID_MS + 1)
    }
    const restored = cleanStationSecurity(JSON.parse(JSON.stringify(b.state)), b.host)
    expect(restored).toEqual(b.state)
    advanceStationSecurity(a.state, a.host, 30_000)
    advanceStationSecurity(restored, b.host, 30_000)
    expect(restored).toEqual(a.state)
    expect(b.stock).toEqual(a.stock)
    expect(b.calls).toBe(a.calls)
  })
  it('大小步结果一致，快照往返和视图无可变引用', () => {
    const a = fixture(), b = fixture()
    for (const f of [a, b]) {
      start(f, 'escort')
      stationSecurityCommand(f.state, f.host, { kind: 'guard', teamIds: ['b'] })
    }
    const duration = STATION_SECURITY_RAID_MS * 2 + 30_000
    advanceStationSecurity(a.state, a.host, duration)
    for (let elapsed = 0; elapsed < duration; elapsed += 1000) advanceStationSecurity(b.state, b.host, Math.min(1000, duration - elapsed))
    expect(a.state).toEqual(b.state)
    expect(a.stock).toEqual(b.stock)
    expect(cleanStationSecurity(JSON.parse(JSON.stringify(a.state)), a.host)).toEqual(a.state)
    const view = stationSecurityView(a.state, a.host)
    view.guard!.teamIds[0] = 'bad'
    expect(a.state.guard!.teamIds[0]).toBe('b')
  })
  it('拒绝快照范围、重复来源、队伍/船交叉占用、伪造阶段、未知字段和非法时间', () => {
    const f = fixture()
    start(f)
    stationSecurityCommand(f.state, f.host, { kind: 'guard', teamIds: ['b'] })
    const mutations = [
      (s: typeof f.state) => { s.sources[1] = { ...s.sources[0]! } },
      (s: typeof f.state) => { s.guard!.teamIds = ['a'] },
      (s: typeof f.state) => { s.guard!.shipIds = ['ship-a'] },
      (s: typeof f.state) => { s.mission!.progressMs = -1 },
      (s: typeof f.state) => { s.mission!.durationMs = 9 },
      (s: typeof f.state) => { s.exposure = 1 },
      (s: typeof f.state) => { s.sources[0]!.nextRaidMs = 1 },
      (s: typeof f.state) => { Object.assign(s, { residents: [] }) },
    ]
    for (const mutate of mutations) { const value = structuredClone(f.state); mutate(value); expect(() => cleanStationSecurity(value, f.host)).toThrow() }
    expect(() => cleanStationSecurity(f.state, { team: () => undefined })).toThrow()
    for (const dt of [-1, Infinity, NaN, 0.5]) expect(() => advanceStationSecurity(f.state, f.host, dt)).toThrow()
  })
})
