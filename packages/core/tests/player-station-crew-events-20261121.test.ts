import { describe, expect, it } from 'vitest'
import { advanceStationCrew, awardCrewExperience, cleanStationCrew, createStationCrew, markCrewDuty, stationCrewCommand,
  stationCrewView, CREW_CHOICE_INTERVAL_MS } from '../src/playerStation/crew'
import type { CrewTeam, StationCrewHost } from '../src/playerStation/crew'
import { CREW_CHOICE_EVENTS, CREW_EVENTS } from '../src/playerStation/crewContent'
import type { CrewReward } from '../src/playerStation/crewContent'

function fixture(count = 1, tier: 1 | 2 | 3 = 3) {
  const state = createStationCrew(), residents = [0, 1, 2, 3, 4, 5]
  const host: StationCrewHost = { residents: () => residents, personAvailable: () => true,
    ship: () => ({ tier: 1, available: true, home: true, trainingTags: ['fire-control', 'damage-control', 'drones'] }),
    claimShip: () => true, releaseShip: () => {}, ready: () => true, trainingReady: () => true, teamAvailable: () => true }
  for (let i = 0; i < count; i++) stationCrewCommand(state, host, { kind: 'create', shipId: `ship-${i}`, tier })
  advanceStationCrew(state, host, count * 30 * 60_000)
  for (const team of state.teams) markCrewDuty(state, team.id, 'mission')
  return { state, host, roundtrip: () => cleanStationCrew(JSON.parse(JSON.stringify(state)), host),
    award: (team: CrewTeam, ticks = 1) => awardCrewExperience(state, team.id, ticks * 10, 'mission'),
    command: (team: CrewTeam, choice: 0 | 1) => stationCrewCommand(state, host, { kind: 'reply', teamId: team.id, choice }) }
}
function rewardKey(reward: CrewReward) { return `${reward.kind}:${reward.id}` }
function held(team: CrewTeam, reward: CrewReward) {
  return reward.kind === 'trait' ? team.traits.includes(reward.id) : team.opportunities.includes(reward.id) || team.skills.includes(reward.id)
}
// 前四次是有效普通事件；第五次满足团队与全局比例门禁。rng=2000 的下一抽小于10%。
function prepare(team: CrewTeam, events = 4) {
  team.growth = events * 2 + 1; team.attributes.fireControl = team.growth
  team.earnedPoints = Math.floor(team.growth / 4); team.eventCount = events
  team.eventProgress = 1; team.eventThreshold = 2; team.rng = 2000
  for (const event of CREW_EVENTS.slice(0, events)) {
    (event.result.kind === 'trait' ? team.traits : team.opportunities).push(event.result.id)
  }
}

describe('舰员事件：抽取门禁、永久结果与通讯生命周期', () => {
  it('正阈值2..4，只消费真实成长，停用/切菜单/视图/读档不重抽', () => {
    const w = fixture(), team = w.state.teams[0]
    for (let i = 0; i < 20; i++) {
      const before = structuredClone(team), view = stationCrewView(w.state, w.host)
      expect(view.teams[0].rng).toBe(team.rng); expect(w.roundtrip()).toEqual(w.state); expect(team).toEqual(before)
    }
    team.eventThreshold = 4; team.eventProgress = 0
    w.award(team, 3); expect(team.eventCount).toBe(0)
    w.award(team); expect(team.eventCount).toBe(1); expect([2, 3, 4]).toContain(team.eventThreshold)
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('低于第五个有效事件不发二择；恰到20%允许10%随机抽取，结果未自动应用', () => {
    const early = fixture(), first = early.state.teams[0]
    prepare(first, 3); early.state.eventsTotal = 3; early.award(first)
    expect(first.pending).toBeUndefined(); expect(first.choiceCount).toBe(0)
    const w = fixture(), team = w.state.teams[0]; prepare(team); w.state.eventsTotal = 4; w.award(team)
    expect(team.eventCount).toBe(5); expect(team.choiceCount).toBe(1); expect(w.state.choicesTotal).toBe(1)
    expect(team.pending).toBeDefined(); expect(team.pending!.options.every(option => !held(team, option))).toBe(true)
    expect(w.state.lastChoiceAtMs).toBe(w.state.clockMs); expect(w.roundtrip()).toEqual(w.state)
  })
  it('10%不是保底，门禁通过时高随机值仍只结算普通事件', () => {
    const w = fixture(), team = w.state.teams[0]; prepare(team); w.state.eventsTotal = 4
    team.rng = 1000 // 下一 LCG 值约0.624，超过二择抽取门槛。
    w.award(team); expect(team.pending).toBeUndefined(); expect(team.choiceCount).toBe(0); expect(team.eventCount).toBe(5)
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('待答继续成长，候选排除预留分支；回复只应用一次且未选结果释放', () => {
    const w = fixture(), team = w.state.teams[0]; prepare(team); w.state.eventsTotal = 4; w.award(team)
    const pending = structuredClone(team.pending!), rng = team.rng
    w.award(team, 15)
    expect(team.growth).toBe(25); expect(team.pending).toEqual(pending)
    expect(pending.options.every(option => !held(team, option))).toBe(true); expect(team.rng).not.toBe(rng)
    const view = stationCrewView(w.state, w.host)
    view.teams[0].pending!.options[0].id = 'unknown'; expect(team.pending).toEqual(pending)
    const events = team.eventCount, growth = team.growth, points = team.earnedPoints
    expect(w.command(team, 1)).toEqual({ ok: true }); expect(held(team, pending.options[1])).toBe(true)
    expect(held(team, pending.options[0])).toBe(false); expect(team.pending).toBeUndefined()
    expect(w.command(team, 0)).toEqual({ ok: false, reason: 'choice' })
    expect([team.eventCount, team.growth, team.earnedPoints]).toEqual([events, growth, points]); expect(w.roundtrip()).toEqual(w.state)
  })
  it('潜力满仍能回复旧通讯，没有超时或默认选择', () => {
    const w = fixture(), team = w.state.teams[0]; prepare(team); w.state.eventsTotal = 4; w.award(team)
    const pending = structuredClone(team.pending!); w.award(team, 100)
    expect(team.growth).toBe(72); advanceStationCrew(w.state, w.host, 1000 * 60_000)
    expect(team.pending).toEqual(pending); expect(w.command(team, 0).ok).toBe(true)
    expect(team.growth).toBe(72); expect(w.roundtrip()).toEqual(w.state)
  })
  it('每队一封/全局两封；6小时从产生时计，回复和重载不提前解禁', () => {
    const w = fixture(2), [a, b] = w.state.teams
    prepare(a); prepare(b); w.state.eventsTotal = 8
    w.award(a); expect(a.pending).toBeDefined()
    const at = w.state.lastChoiceAtMs!; w.command(a, 0)
    b.rng = 2000; w.award(b); expect(b.pending).toBeUndefined()
    advanceStationCrew(w.state, w.host, CREW_CHOICE_INTERVAL_MS - 1)
    b.rng = 2000; w.award(b, b.eventThreshold - b.eventProgress); expect(b.pending).toBeUndefined()
    advanceStationCrew(w.state, w.host, 1)
    b.rng = 2000; w.award(b, b.eventThreshold - b.eventProgress); expect(b.pending).toBeDefined()
    expect(w.state.lastChoiceAtMs).toBe(at + CREW_CHOICE_INTERVAL_MS)
    const second = structuredClone(b.pending!); advanceStationCrew(w.state, w.host, CREW_CHOICE_INTERVAL_MS * 2)
    b.rng = 2000; w.award(b, b.eventThreshold - b.eventProgress); expect(b.pending).toEqual(second)
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('待答队解散不退还全局事件/二择计数或冷却，另一队仍按原门禁培养', () => {
    const w = fixture(2), [a, b] = w.state.teams; prepare(a); prepare(b); w.state.eventsTotal = 8
    w.award(a); expect(a.pending).toBeDefined()
    const counters = [w.state.eventsTotal, w.state.choicesTotal, w.state.lastChoiceAtMs]
    markCrewDuty(w.state, a.id, 'idle')
    expect(stationCrewCommand(w.state, w.host, { kind: 'disband', teamId: a.id }).ok).toBe(true)
    expect([w.state.eventsTotal, w.state.choicesTotal, w.state.lastChoiceAtMs]).toEqual(counters)
    expect(w.state.teams).toHaveLength(1); expect(w.roundtrip()).toEqual(w.state)
    w.award(b); expect(b.pending).toBeUndefined()
    advanceStationCrew(w.state, w.host, CREW_CHOICE_INTERVAL_MS)
    b.rng = 2000; w.award(b, b.eventThreshold - b.eventProgress)
    expect(b.pending).toBeDefined(); expect(w.state.choicesTotal * 5).toBeLessThanOrEqual(w.state.eventsTotal)
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('全局已存两封时第三队用普通事件替代，不囤未来必发通讯', () => {
    const w = fixture(3, 1), [a, b, c] = w.state.teams
    for (const team of w.state.teams) prepare(team)
    w.state.eventsTotal = 12
    w.award(a); expect(a.pending).toBeDefined()
    advanceStationCrew(w.state, w.host, CREW_CHOICE_INTERVAL_MS)
    w.award(b); expect(b.pending).toBeDefined()
    advanceStationCrew(w.state, w.host, CREW_CHOICE_INTERVAL_MS)
    w.award(c); expect(c.pending).toBeUndefined(); expect(c.eventCount).toBe(5)
    expect(w.state.choicesTotal).toBe(2); expect(w.roundtrip()).toEqual(w.state)
    w.command(a, 0); expect(c.pending).toBeUndefined()
  })
  it('团队比例单独拦截下一封，历史其他团队的富余分母不能替本队放宽', () => {
    const w = fixture(), team = w.state.teams[0]; prepare(team); w.state.eventsTotal = 4; w.award(team)
    expect(w.command(team, 0).ok).toBe(true)
    // 另一批已解散团队留下大量普通事件，保留本队自己的20%门禁。
    w.state.sequence++; w.state.eventsTotal += 100
    advanceStationCrew(w.state, w.host, CREW_CHOICE_INTERVAL_MS)
    team.rng = 2000; w.award(team, team.eventThreshold - team.eventProgress)
    expect(team.eventCount).toBe(6); expect(team.choiceCount).toBe(1); expect(team.pending).toBeUndefined()
    expect(w.roundtrip()).toEqual(w.state)
  })
  it('普通池耗尽不靠空复盘刷分母，待答分支保持不被普通事件占用', () => {
    const w = fixture(), team = w.state.teams[0]
    const results = new Map(CREW_EVENTS.map(event => [rewardKey(event.result), event.result]))
    team.growth = results.size * 2; team.attributes.fireControl = team.growth; team.earnedPoints = Math.floor(team.growth / 4)
    team.eventCount = results.size; w.state.eventsTotal = results.size
    for (const result of results.values()) (result.kind === 'skill' ? team.opportunities : team.traits).push(result.id)
    const before = team.eventCount
    team.eventThreshold = 2; team.eventProgress = 1; team.rng = 1000; w.award(team)
    expect(team.eventCount).toBe(before); expect(w.state.eventsTotal).toBe(before); expect(w.roundtrip()).toEqual(w.state)
  })
  it('长期自然培养事件唯一、二择比例始终有界，跨读写无重复结果', () => {
    for (let seed = 0; seed < 20; seed++) {
      const w = fixture(), team = w.state.teams[0]; team.rng = seed
      for (let i = 0; i < 72; i++) {
        advanceStationCrew(w.state, w.host, 10 * 60_000); w.award(team)
        if (team.pending && i % 3 === 0) w.command(team, (i % 2) as 0 | 1)
        expect(team.choiceCount * 5).toBeLessThanOrEqual(team.eventCount)
        expect(w.state.choicesTotal * 5).toBeLessThanOrEqual(w.state.eventsTotal)
        expect(w.roundtrip()).toEqual(w.state)
      }
      expect(new Set(team.traits).size).toBe(team.traits.length)
      expect(new Set(team.opportunities).size).toBe(team.opportunities.length)
    }
  })
  it('多种子两队多轮训练与资格进修，真实补员、待答及全局账目持续守约', () => {
    let generatedChoices = 0
    for (let seed = 1; seed <= 32; seed++) {
      const w = fixture(2, 1), [a, b] = w.state.teams
      a.rng = seed; b.rng = seed * 7919
      let lastChoiceAt: number | null = null, lastChoices = 0
      const check = () => {
        expect(w.state.choicesTotal * 5).toBeLessThanOrEqual(w.state.eventsTotal)
        expect(w.state.teams.filter(team => team.pending).length).toBeLessThanOrEqual(2)
        for (const team of w.state.teams) {
          expect(team.choiceCount * 5).toBeLessThanOrEqual(team.eventCount)
          expect(new Set([...team.opportunities, ...team.skills]).size).toBe(team.opportunities.length + team.skills.length)
          if (team.pending) expect(team.pending.options.every(option => !held(team, option))).toBe(true)
        }
        if (w.state.choicesTotal > lastChoices) {
          if (lastChoiceAt !== null) expect(w.state.lastChoiceAtMs! - lastChoiceAt).toBeGreaterThanOrEqual(CREW_CHOICE_INTERVAL_MS)
          lastChoiceAt = w.state.lastChoiceAtMs; lastChoices = w.state.choicesTotal
        }
        expect(w.roundtrip()).toEqual(w.state)
      }
      for (let tier = 1; tier <= 3; tier++) {
        for (const team of [a, b]) {
          markCrewDuty(w.state, team.id, 'idle')
          expect(stationCrewCommand(w.state, w.host, { kind: 'plan', teamId: team.id,
            course: tier === 1 ? 'fire-control' : tier === 2 ? 'damage-control' : 'drones' }).ok).toBe(true)
        }
        // 单席训练两队各24个tick；小步不断读档，保留未答通讯直至最后一档。
        for (let tick = 0; tick < 48; tick++) {
          advanceStationCrew(w.state, w.host, 10 * 60_000)
          if (tier === 3 && tick % 9 === 0) {
            for (const team of w.state.teams) if (team.pending) {
              const eventCount = team.eventCount
              expect(w.command(team, (tick % 2) as 0 | 1).ok).toBe(true)
              expect(w.command(team, 0).ok).toBe(false); expect(team.eventCount).toBe(eventCount)
            }
          }
          check()
        }
        expect([a.growth, b.growth]).toEqual([tier * 24, tier * 24])
        expect([a.earnedPoints, b.earnedPoints]).toEqual([tier * 6, tier * 6])
        if (tier < 3) {
          const before = w.state.teams.map(team => structuredClone(team))
          for (const team of [a, b]) expect(stationCrewCommand(w.state, w.host, { kind: 'promote', teamId: team.id }).ok).toBe(true)
          expect(new Set(w.state.teams.flatMap(team => team.members)).size).toBe((tier + 1) * 2)
          for (let index = 0; index < 2; index++) {
            const team = w.state.teams[index]
            expect(team.growth).toBe(before[index].growth); expect(team.rng).toBe(before[index].rng)
            expect(team.pending).toEqual(before[index].pending); expect(team.eventCount).toBe(before[index].eventCount)
          }
          advanceStationCrew(w.state, w.host, 60 * 60_000); check()
        }
      }
      generatedChoices += w.state.choicesTotal
    }
    expect(generatedChoices).toBeGreaterThan(0)
  })
  it('严格拒绝伪造通讯、已拥有分支、稀疏数组和非JSON数组属性', () => {
    const w = fixture(), team = w.state.teams[0]; prepare(team); w.state.eventsTotal = 4; w.award(team)
    expect(team.pending).toBeDefined()
    const mutations: ((s: any) => void)[] = [
      s => { s.teams[0].pending.eventId = 'unknown' },
      s => { s.teams[0].pending.options.reverse() },
      s => { s.teams[0].pending.options[0].id = 'unknown' },
      s => { s.teams[0].choiceCount = 0 },
      s => { delete s.teams[0].pending.options[0] },
      s => { s.teams[0].members = Array(3) },
      s => { s.teams[0].opportunities.extra = 1 },
      s => { s.teams[0].traits = Array(1) },
      s => { delete s.teams[0] },
    ]
    for (const mutate of mutations) { const bad = structuredClone(w.state); mutate(bad); expect(() => cleanStationCrew(bad, w.host)).toThrow() }
    const event = CREW_CHOICE_EVENTS.find(event => event.id === team.pending!.eventId)!
    const result = event.options[0]
    const pool = result.kind === 'trait' ? team.traits : team.opportunities
    pool.push(result.id)
    expect(() => w.roundtrip()).toThrow()
  })
})
