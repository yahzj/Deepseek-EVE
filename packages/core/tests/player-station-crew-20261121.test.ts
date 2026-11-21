import { describe, expect, it } from 'vitest'
import { advanceStationCrew, awardCrewExperience, cleanStationCrew, createStationCrew, crewBusyPeople, crewTeamBonuses,
  markCrewDuty, reconcileStationCrew, stationCrewCommand, stationCrewNextEventMs, stationCrewView,
  CREW_BONUS_CAP, CREW_CHOICE_INTERVAL_MS, CREW_QUALIFICATION_MS, CREW_TICK_MS } from '../src/playerStation/crew'
import type { CrewTeam, CrewTier, StationCrewAction, StationCrewHost, StationCrewShip } from '../src/playerStation/crew'
import { CREW_CHOICE_EVENTS, CREW_COURSES, CREW_DEV_ZH, CREW_EVENTS, CREW_SKILLS, CREW_TRAITS } from '../src/playerStation/crewContent'

const MIN = 60_000
function world() {
  const state = createStationCrew(), residents = [0, 1, 2, 3, 4, 5], busy = new Set<number>(), locked = new Set<string>()
  const duty = new Set<string>(), ships = new Map<string, StationCrewShip>()
  let ready = true, trainingReady = true, denyClaim = false
  for (let i = 1; i <= 6; i++) ships.set(`ship-${i}`, { tier: 1, available: true, home: true, trainingTags: Object.keys(CREW_COURSES) })
  const host: StationCrewHost = { residents: () => residents, personAvailable: index => !busy.has(index),
    ship: id => { const ship = ships.get(id); return ship ? { ...ship, available: ship.available && !locked.has(id) } : undefined },
    claimShip: id => { if (denyClaim || !host.ship(id)?.available) return false; locked.add(id); return true },
    releaseShip: id => { locked.delete(id) }, ready: () => ready, trainingReady: () => trainingReady,
    teamAvailable: id => !duty.has(id) }
  const command = (action: StationCrewAction) => stationCrewCommand(state, host, action)
  const create = (shipId = 'ship-1', tier?: CrewTier) => {
    const result = command({ kind: 'create', shipId, tier })
    expect(result.ok).toBe(true)
    return state.teams[state.teams.length - 1]
  }
  return { state, residents, busy, locked, duty, ships, host, command, create,
    advance: (minutes: number, deferBoundary = false) => advanceStationCrew(state, host, minutes * MIN, deferBoundary),
    plan: (team: CrewTeam, course: 'fire-control' | 'damage-control' | 'drones' = 'fire-control') => command({ kind: 'plan', teamId: team.id, course }),
    view: () => stationCrewView(state, host), roundtrip: () => cleanStationCrew(JSON.parse(JSON.stringify(state)), host),
    setReady: (value: boolean) => { ready = value }, setTrainingReady: (value: boolean) => { trainingReady = value },
    setDenyClaim: (value: boolean) => { denyClaim = value } }
}

describe('舰员团队：人员、资格、舰船与单席训练', () => {
  it('初始状态严格 JSON；组建按档真实占人，资格期不锁船也不改人口资格', () => {
    const w = world()
    expect(w.state).toEqual({ version: 1, clockMs: 0, sequence: 0, teams: [], eventsTotal: 0, choicesTotal: 0, lastChoiceAtMs: null })
    w.ships.get('ship-1')!.tier = 3; w.busy.add(0)
    const team = w.create('ship-1')
    expect(team).toMatchObject({ tier: 3, members: [1, 2, 3], activity: 'qualifying', potential: 72 })
    expect(crewBusyPeople(w.state)).toEqual([1, 2, 3]); expect(w.locked.size).toBe(0)
    w.advance(29); expect(team.qualificationMs).toBe(29 * MIN)
    w.advance(1); expect(team.activity).toBe('idle'); expect(team.qualificationMs).toBe(CREW_QUALIFICATION_MS)
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('拒绝重复成员、重复映射、忙碌居民、非法档位及低资格高档船，无副作用', () => {
    const w = world(); w.busy.add(0); w.ships.get('ship-3')!.tier = 3
    for (const action of [
      { kind: 'create', shipId: 'ship-1', members: [0] },
      { kind: 'create', shipId: 'ship-1', members: Array(1) },
      { kind: 'create', shipId: 'ship-2', tier: 2, members: [1, 1] },
      { kind: 'create', shipId: 'ship-3', tier: 1 },
      { kind: 'create', shipId: 'ship-1', tier: 4 },
      { kind: 'create', shipId: 'missing' },
    ]) { const before = structuredClone(w.state); expect(w.command(action as never).ok).toBe(false); expect(w.state).toEqual(before) }
    w.create(); const before = structuredClone(w.state)
    expect(w.command({ kind: 'create', shipId: 'ship-1' })).toEqual({ ok: false, reason: 'ship' })
    expect(w.state).toEqual(before)
  })
  it('资格排队不并行；暂停保席和所有人口，恢复后才轮到下一队', () => {
    const w = world(), first = w.create(), second = w.create('ship-2')
    w.advance(10); w.command({ kind: 'pause', teamId: first.id }); w.advance(100)
    expect(w.view().seatUsed).toBe(1); expect(first.qualificationMs).toBe(10 * MIN); expect(second.qualificationMs).toBe(0)
    expect(crewBusyPeople(w.state)).toEqual([0, 1]); expect(stationCrewNextEventMs(w.state, w.host)).toBe(Infinity)
    w.command({ kind: 'resume', teamId: first.id }); w.advance(50)
    expect([first.activity, second.activity]).toEqual(['idle', 'idle']); expect(w.roundtrip()).toEqual(w.state)
  })
  it('训练真实占船、共用单席；缺电不放锁不倒算，idle释放锁但保留未完tick', () => {
    const w = world(), a = w.create(), b = w.create('ship-2'); w.advance(60)
    w.plan(a); w.plan(b, 'damage-control'); expect([...w.locked]).toEqual(['ship-1'])
    expect([a.activity, b.activity, b.planned]).toEqual(['training', 'idle', true])
    w.advance(7); w.setTrainingReady(false); w.advance(200)
    expect(a.progressMs).toBe(7 * MIN); expect(w.locked.has(a.shipId!)).toBe(true)
    expect(stationCrewNextEventMs(w.state, w.host)).toBe(Infinity)
    w.setTrainingReady(true); w.command({ kind: 'idle', teamId: a.id })
    expect(w.locked.has('ship-1')).toBe(false); expect(b.activity).toBe('training')
    w.command({ kind: 'idle', teamId: b.id }); w.plan(a); w.advance(3)
    expect(a.growth).toBe(1); expect(a.progressMs).toBe(0); expect(w.roundtrip()).toEqual(w.state)
  })
  it('课程不满足、船不在家、claim失败时只排队；中断保活动，不能活动中换船', () => {
    const w = world(), team = w.create(); w.advance(30)
    w.ships.get('ship-1')!.trainingTags = ['drones']; w.plan(team)
    expect(team.activity).toBe('idle'); expect(w.locked.size).toBe(0)
    w.ships.get('ship-1')!.trainingTags = ['fire-control']; w.ships.get('ship-1')!.home = false
    reconcileStationCrew(w.state, w.host); expect(team.activity).toBe('idle')
    w.ships.get('ship-1')!.home = true; w.setDenyClaim(true)
    reconcileStationCrew(w.state, w.host); expect(team.activity).toBe('idle')
    w.setDenyClaim(false); reconcileStationCrew(w.state, w.host); w.advance(4)
    expect(w.command({ kind: 'bind', teamId: team.id, shipId: 'ship-2' })).toEqual({ ok: false, reason: 'busy' })
    w.setReady(false); w.advance(100); expect(team.progressMs).toBe(4 * MIN); expect(team.activity).toBe('training')
    w.setReady(true); w.advance(6); expect(team.growth).toBe(1)
  })
  it('资格完成defer边界不提前抢训练船，NextEvent提供下一协调边界', () => {
    const w = world(), a = w.create(); w.advance(30); const b = w.create('ship-2'); w.plan(a)
    w.advance(30, true)
    expect(b.activity).toBe('idle'); expect(a.activity).toBe('idle'); expect(w.locked.size).toBe(0)
    expect(stationCrewNextEventMs(w.state, w.host)).toBe(0)
    w.setTrainingReady(false); reconcileStationCrew(w.state, w.host); expect(a.activity).toBe('idle')
    w.setTrainingReady(true); reconcileStationCrew(w.state, w.host); expect(a.activity).toBe('training')
  })
  it('进修补真实可用人口且保成长；高资格可换低档船，低资格不能绑高档船', () => {
    const w = world(), team = w.create(); w.advance(30); w.plan(team); w.advance(45); w.command({ kind: 'idle', teamId: team.id })
    const before = structuredClone(team); w.residents.splice(1)
    expect(w.command({ kind: 'promote', teamId: team.id })).toEqual({ ok: false, reason: 'person' }); expect(team).toEqual(before)
    w.residents.push(1); w.busy.add(1)
    expect(w.command({ kind: 'promote', teamId: team.id }).ok).toBe(false); w.busy.delete(1)
    expect(w.command({ kind: 'promote', teamId: team.id })).toEqual({ ok: true })
    expect(team).toMatchObject({ tier: 2, members: [0, 1], activity: 'qualifying', growth: before.growth,
      progressMs: before.progressMs, attributes: before.attributes, eventCount: before.eventCount, potential: 48 })
    expect(crewBusyPeople(w.state)).toEqual([0, 1]); w.advance(30)
    w.ships.get('ship-2')!.tier = 2
    expect(w.command({ kind: 'bind', teamId: team.id, shipId: 'ship-2' }).ok).toBe(true)
    expect(w.command({ kind: 'bind', teamId: team.id, shipId: 'ship-3' }).ok).toBe(true)
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('真实外派只由宿主标记和发经验，advance不给guard/mission经验且不抢外派锁', () => {
    const w = world(), team = w.create(); w.advance(30)
    expect(awardCrewExperience(w.state, team.id, 60, 'mission')).toBe(false)
    w.plan(team); expect(markCrewDuty(w.state, team.id, 'mission')).toBe(false)
    w.command({ kind: 'idle', teamId: team.id }); expect(markCrewDuty(w.state, team.id, 'mission')).toBe(true)
    w.duty.add(team.id); w.advance(120); expect(team.growth).toBe(0)
    for (const kind of ['disband', 'promote', 'idle', 'pause'] as const) expect(w.command({ kind, teamId: team.id }).ok).toBe(false)
    expect(w.plan(team).ok).toBe(false); expect(awardCrewExperience(w.state, team.id, 25, 'mission')).toBe(true)
    expect(team).toMatchObject({ growth: 2, progressMs: 5 * MIN }); expect(w.roundtrip()).toEqual(w.state)
    expect(markCrewDuty(w.state, team.id, 'guard')).toBe(false)
    w.duty.delete(team.id); expect(markCrewDuty(w.state, team.id, 'idle')).toBe(true)
    w.duty.add(team.id); expect(w.command({ kind: 'disband', teamId: team.id }).ok).toBe(false)
    w.duty.delete(team.id); expect(markCrewDuty(w.state, team.id, 'guard')).toBe(true)
    w.advance(100); expect(team.growth).toBe(2)
    expect(awardCrewExperience(w.state, team.id, 5, 'guard')).toBe(true); expect(team.growth).toBe(3)
  })
  it('换课不重抽或转移已有tick侧重；新tick才使用新课程', () => {
    const w = world(), team = w.create(); w.advance(30); w.plan(team); w.advance(9)
    const rng = team.rng; w.plan(team, 'damage-control'); w.advance(1)
    expect(team.attributes).toEqual({ fireControl: 1, piloting: 0, engineering: 0, command: 0 }); expect(team.rng).toBe(rng)
    w.advance(10); expect(team.attributes.engineering).toBe(1)
    expect(w.roundtrip()).toEqual(w.state)
  })
})

describe('舰员团队：成长、事件与严格快照', () => {
  it('三个档位成长与累计点数上限独立；满额停训练放船且空挂机不抽事件', () => {
    for (const tier of [1, 2, 3] as const) {
      const w = world(), team = w.create('ship-1', tier); w.advance(30); w.plan(team); w.advance(2000)
      expect(team.growth).toBe(tier * 24); expect(team.earnedPoints).toBe(tier * 6)
      expect(Object.values(team.attributes).reduce((a, b) => a + b)).toBe(tier * 24)
      expect(team.activity).toBe('idle'); expect(w.locked.size).toBe(0)
      const before = structuredClone(team), total = w.state.eventsTotal; w.advance(5000)
      expect(team).toEqual(before); expect(w.state.eventsTotal).toBe(total); expect(w.roundtrip()).toEqual(w.state)
    }
  })
  it('大步、小步和逐步读写的随机、计数、时间、成长完全一致', () => {
    const a = world(), b = world()
    for (const w of [a, b]) { const team = w.create('ship-1', 3); w.advance(30); w.plan(team) }
    a.advance(1200)
    for (let i = 0; i < 1200; i++) { b.advance(1); expect(b.roundtrip()).toEqual(b.state) }
    expect(b.state).toEqual(a.state); expect([...b.locked]).toEqual([...a.locked])
  })
  it('技能必须先有机会、满足属性和点数；学习只扣余额不返普通预算，不重复学习', () => {
    const w = world(), team = w.create('ship-1', 3); w.advance(30); w.plan(team); w.advance(720)
    const learnable = w.view().teams[0].learnable
    expect(learnable.length).toBeGreaterThan(0)
    const skillId = learnable[0], points = team.earnedPoints, events = team.eventCount
    expect(w.command({ kind: 'learn', teamId: team.id, skillId }).ok).toBe(true)
    expect(team.spentPoints).toBeGreaterThan(0); expect(team.earnedPoints).toBe(points); expect(team.eventCount).toBe(events)
    const before = structuredClone(team)
    expect(w.command({ kind: 'learn', teamId: team.id, skillId }).ok).toBe(false)
    expect(w.command({ kind: 'learn', teamId: team.id, skillId: 'unknown' }).ok).toBe(false)
    expect(team).toEqual(before); expect(w.roundtrip()).toEqual(w.state)
  })
  it('属性/余额不足不能学习；指定学习特性降低价格且不新增点数', () => {
    const w = world(), team = w.create(); w.advance(30)
    team.opportunities.push('firing-solution'); team.eventCount = 1; w.state.eventsTotal = 1
    expect(w.command({ kind: 'learn', teamId: team.id, skillId: 'firing-solution' })).toEqual({ ok: false, reason: 'attributes' })
    team.attributes.fireControl = 6; team.attributes.engineering = 2; team.growth = 8
    expect(w.command({ kind: 'learn', teamId: team.id, skillId: 'firing-solution' })).toEqual({ ok: false, reason: 'points' })
    team.earnedPoints = 2; team.spentPoints = 1; team.traits.push('applied-learning')
    expect(w.command({ kind: 'learn', teamId: team.id, skillId: 'firing-solution' }).ok).toBe(true)
    expect(team.spentPoints).toBe(2); expect(team.earnedPoints).toBe(2)
  })
  it('视图与清洗结果没有状态或内容库的可写引用', () => {
    const w = world(), team = w.create(); w.advance(30); w.plan(team); w.advance(100)
    const before = structuredClone(w.state), view = w.view(), clean = w.roundtrip()
    view.teams[0].members.length = 0; view.teams[0].traits.push('unknown'); view.teams[0].attributes.command = 99
    view.skills[0].requires.fireControl = 99; view.traits[0].effectMods.gunnery = 99
    clean.teams[0].members.length = 0
    expect(w.state).toEqual(before); expect(CREW_SKILLS[0].requires.fireControl).toBe(2)
    expect(CREW_TRAITS[0].effectMods.gunnery).toBe(0.2)
  })
  it('有界小数增量、特性同轴先相加且只影响团队收益，不倒扣原船能力', () => {
    const w = world(), team = w.create()
    expect(crewTeamBonuses(team)).toEqual({ damagePct: 0, defensePct: 0 })
    team.skills = ['target-reading']; team.traits = ['decisive', 'maintenance-focus']
    expect(crewTeamBonuses(team).damagePct).toBeCloseTo(0.012)
    team.skills = CREW_SKILLS.map(skill => skill.id); team.traits = CREW_TRAITS.map(trait => trait.id)
    const bonuses = crewTeamBonuses(team)
    expect(bonuses.damagePct).toBeGreaterThan(0); expect(bonuses.damagePct).toBeLessThanOrEqual(CREW_BONUS_CAP)
    expect(bonuses.defensePct).toBeGreaterThan(0); expect(bonuses.defensePct).toBeLessThanOrEqual(CREW_BONUS_CAP)
  })
  it('拒绝非JSON、未知字段、伪造预算、未知内容、重复人口船映射及不合宿主船tier', () => {
    const w = world(), team = w.create(); w.advance(30); w.plan(team); w.advance(80)
    const mutations: ((s: any) => void)[] = [
      s => { s.version = 2 }, s => { s.clockMs = Infinity }, s => { s.clockMs = -1 }, s => { s.extra = true },
      s => { s.sequence = 0 }, s => { s.teams[0].id = 'bad' }, s => { s.teams[0].rng = 0x100000000 },
      s => { s.teams[0].members = [5, 5] }, s => { s.teams[0].members = [8] }, s => { s.teams[0].course = 'unknown' },
      s => { s.teams[0].progressMs = CREW_TICK_MS }, s => { s.teams[0].qualificationMs = 0 },
      s => { s.teams[0].attributes.command++ }, s => { s.teams[0].potential++ }, s => { s.teams[0].earnedPoints++ },
      s => { s.teams[0].spentPoints = 10 }, s => { s.teams[0].opportunities = ['unknown'] },
      s => { s.teams[0].traits = ['decisive', 'decisive'] }, s => { s.teams[0].eventThreshold = 0 },
      s => { s.teams[0].eventProgress = 5 }, s => { s.teams[0].paused = 'yes' }, s => { s.teams[0].choiceCount = 9 },
      s => { s.eventsTotal++ },
      s => { s.teams.push(structuredClone(s.teams[0])) }, s => { s.lastChoiceAtMs = 1 },
      s => { s.teams[0].pending = { eventId: 'unknown', options: [] } },
    ]
    for (const mutate of mutations) { const bad = structuredClone(w.state); mutate(bad); expect(() => cleanStationCrew(bad, w.host)).toThrow() }
    w.ships.get(team.shipId!)!.tier = 2; expect(() => w.roundtrip()).toThrow()
    w.ships.get(team.shipId!)!.tier = 1; w.residents.shift(); expect(() => w.roundtrip()).toThrow()
    expect(() => cleanStationCrew(new Date(), w.host)).toThrow()
  })
  it('拒绝异常推进与任务经验，失败不改状态；训练队不能领取外派经验', () => {
    const w = world(), team = w.create(); w.advance(30); w.plan(team)
    const before = structuredClone(w.state)
    for (const elapsed of [-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) expect(() => advanceStationCrew(w.state, w.host, elapsed)).toThrow()
    expect(awardCrewExperience(w.state, team.id, 10, 'mission')).toBe(false)
    w.command({ kind: 'idle', teamId: team.id }); markCrewDuty(w.state, team.id, 'guard')
    const guard = structuredClone(w.state)
    for (const minutes of [-1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) expect(awardCrewExperience(w.state, team.id, minutes, 'guard')).toBe(false)
    expect(awardCrewExperience(w.state, team.id, 10, 'bad tag')).toBe(false); expect(w.state).toEqual(guard)
    expect(before.teams[0].growth).toBe(0)
  })
  it('内容库真实数量、类别、引用、中文id映射齐全，不复用已确认的特性名称或轴', () => {
    expect(CREW_SKILLS).toHaveLength(14); expect(new Set(CREW_SKILLS.map(skill => skill.category)).size).toBe(7)
    expect(CREW_TRAITS).toHaveLength(16); expect(new Set(CREW_TRAITS.map(trait => trait.category)).size).toBe(8)
    expect(CREW_EVENTS).toHaveLength(24); expect(CREW_CHOICE_EVENTS).toHaveLength(12)
    const content = [...CREW_SKILLS, ...CREW_TRAITS, ...CREW_EVENTS, ...CREW_CHOICE_EVENTS]
    expect(new Set(content.map(entry => entry.id)).size).toBe(content.length)
    for (const entry of content) { expect(CREW_DEV_ZH[entry.nameId]).toBeTruthy(); expect(CREW_DEV_ZH[entry.descId]).toBeTruthy() }
    for (const reward of [...CREW_EVENTS.map(event => event.result), ...CREW_CHOICE_EVENTS.flatMap(event => event.options)]) {
      expect((reward.kind === 'skill' ? CREW_SKILLS : CREW_TRAITS).some(entry => entry.id === reward.id)).toBe(true)
    }
    expect(CREW_TRAITS.some(trait => ['flexible', 'repeat-review', 'cooperation-first'].includes(trait.id))).toBe(false)
    expect(Object.isFrozen(CREW_SKILLS[0].requires)).toBe(true); expect(Object.isFrozen(CREW_TRAITS[0].effectMods)).toBe(true)
    expect(Object.isFrozen(CREW_EVENTS[0].result)).toBe(true); expect(Object.isFrozen(CREW_CHOICE_EVENTS[0].options)).toBe(true)
    expect(CREW_QUALIFICATION_MS).toBe(30 * MIN); expect(CREW_CHOICE_INTERVAL_MS).toBe(360 * MIN)
  })
})
