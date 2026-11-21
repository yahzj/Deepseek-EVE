import { CREW_CHOICE_EVENTS, CREW_COURSES, CREW_EVENTS, CREW_SKILLS, CREW_TRAITS } from './crewContent'
import type { CrewAttribute, CrewCourse, CrewReward } from './crewContent'
export type { CrewAttribute, CrewCourse } from './crewContent'

export const CREW_TICK_MS = 10 * 60_000
export const CREW_QUALIFICATION_MS = 30 * 60_000
export const CREW_CHOICE_INTERVAL_MS = 6 * 60 * 60_000
export const CREW_BONUS_CAP = 0.15
export type CrewTier = 1 | 2 | 3
export type CrewActivity = 'idle' | 'qualifying' | 'training' | 'mission' | 'guard'
export interface CrewTeam {
  id: string
  name: string
  members: number[]
  /** 缺省表示战沉后未绑定；成员与培养记录保留，只能待命或继续考核资格。 */
  shipId?: string
  tier: CrewTier
  activity: CrewActivity
  course: CrewCourse
  progressMs: number
  qualificationMs: number
  attributes: Record<CrewAttribute, number>
  earnedPoints: number
  spentPoints: number
  growth: number
  potential: number
  opportunities: string[]
  skills: string[]
  traits: string[]
  eventCount: number
  choiceCount: number
  pending?: { eventId: string; options: [CrewReward, CrewReward] }
  planned: boolean
  paused: boolean
  tickTag: string
  eventProgress: number
  eventThreshold: 2 | 3 | 4
  rng: number
}
export interface StationCrew {
  version: 1
  clockMs: number
  sequence: number
  teams: CrewTeam[]
  eventsTotal: number
  choicesTotal: number
  lastChoiceAtMs: number | null
}
export interface StationCrewShip { tier: CrewTier; available: boolean; home: boolean; trainingTags: readonly string[] }
export interface StationCrewHost {
  /** 返回已接收居民；personAvailable 只在新招募时判断普通身份与外部岗位互斥。 */
  residents(): readonly number[]
  personAvailable(index: number): boolean
  ship(id: string): StationCrewShip | undefined
  claimShip(id: string): boolean
  releaseShip(id: string): void
  ready(): boolean
  /** 宿主冻结的统一培训中心单席、课程及供电条件，不递归调用推进器。 */
  trainingReady(): boolean
  teamAvailable(id: string): boolean
}
export type StationCrewAction = { kind: 'create'; shipId: string; name?: string; tier?: CrewTier; members?: number[] }
  | { kind: 'bind'; teamId: string; shipId: string }
  | { kind: 'plan'; teamId: string; course: CrewCourse }
  | { kind: 'learn'; teamId: string; skillId: string }
  | { kind: 'reply'; teamId: string; choice: 0 | 1 }
  | { kind: 'disband' | 'idle' | 'pause' | 'resume' | 'promote'; teamId: string }
export type StationCrewReason = 'invalid-action' | 'team' | 'person' | 'ship' | 'tier' | 'busy' | 'qualifying'
  | 'course' | 'skill' | 'opportunity' | 'attributes' | 'points' | 'choice' | 'name'
export type StationCrewResult = { ok: true; teamId?: string } | { ok: false; reason: StationCrewReason }

const attributeKeys: CrewAttribute[] = ['fireControl', 'piloting', 'engineering', 'command']
const isCourse = (value: unknown): value is CrewCourse => value === 'fire-control' || value === 'damage-control' || value === 'drones'
const isTier = (value: unknown): value is CrewTier => value === 1 || value === 2 || value === 3
const isDuty = (activity: CrewActivity) => activity === 'mission' || activity === 'guard'
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const validTag = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)
const skillById = (id: string) => CREW_SKILLS.find(skill => skill.id === id)
const traitById = (id: string) => CREW_TRAITS.find(trait => trait.id === id)
const teamById = (state: StationCrew, id: string) => state.teams.find(team => team.id === id)
const cloneTeam = (team: CrewTeam): CrewTeam => ({ ...team, members: [...team.members], attributes: { ...team.attributes },
  opportunities: [...team.opportunities], skills: [...team.skills], traits: [...team.traits],
  ...(team.pending ? { pending: { eventId: team.pending.eventId, options: team.pending.options.map(option => ({ ...option })) as [CrewReward, CrewReward] } } : {}) })

export function createStationCrew(): StationCrew {
  return { version: 1, clockMs: 0, sequence: 0, teams: [], eventsTotal: 0, choicesTotal: 0, lastChoiceAtMs: null }
}
export function crewBusyPeople(state: StationCrew): number[] { return state.teams.flatMap(team => team.members) }
function random(team: CrewTeam): number {
  team.rng = (Math.imul(team.rng, 1664525) + 1013904223) >>> 0
  return team.rng / 0x100000000
}
function threshold(team: CrewTeam): 2 | 3 | 4 { return (2 + Math.floor(random(team) * 3)) as 2 | 3 | 4 }
function pointCost(team: CrewTeam, id: string): number {
  const discount = team.traits.reduce((sum, trait) => sum + (traitById(trait)?.learningDiscount ?? 0), 0)
  return Math.max(1, skillById(id)!.cost - discount)
}
function learnBlock(team: CrewTeam, id: string): StationCrewReason | undefined {
  const skill = skillById(id)
  if (!skill || team.skills.includes(id)) return 'skill'
  if (!team.opportunities.includes(id)) return 'opportunity'
  if (attributeKeys.some(key => team.attributes[key] < (skill.requires[key] ?? 0))) return 'attributes'
  if (team.earnedPoints - team.spentPoints < pointCost(team, id)) return 'points'
  return undefined
}
export function crewTeamBonuses(team: CrewTeam): { damagePct: number; defensePct: number } {
  let damagePct = (team.attributes.fireControl * 2 + team.attributes.command) * 0.00025
  let defensePct = (team.attributes.piloting + team.attributes.engineering * 2) * 0.00025
  for (const id of team.skills) {
    const skill = skillById(id)
    if (!skill) continue
    const modifier = team.traits.reduce((sum, trait) => sum + (traitById(trait)?.effectMods[skill.category] ?? 0), 0)
    const factor = Math.max(0, Math.min(2, 1 + modifier))
    damagePct += skill.damagePct * factor; defensePct += skill.defensePct * factor
  }
  return { damagePct: Math.max(0, Math.min(CREW_BONUS_CAP, damagePct)), defensePct: Math.max(0, Math.min(CREW_BONUS_CAP, defensePct)) }
}
function newPeople(state: StationCrew, host: StationCrewHost): number[] {
  const occupied = new Set(crewBusyPeople(state))
  return [...new Set(host.residents())].filter(index => nonnegative(index) && !occupied.has(index) && host.personAvailable(index)).sort((a, b) => a - b)
}
function validShip(state: StationCrew, host: StationCrewHost, id: string | undefined, tier: CrewTier, except?: string): boolean {
  if (!id) return false
  const ship = host.ship(id)
  return !!ship && isTier(ship.tier) && ship.tier <= tier && ship.available && ship.home
    && !state.teams.some(team => team.id !== except && team.shipId === id)
}
function seatTeam(state: StationCrew): CrewTeam | undefined {
  return state.teams.find(team => team.activity === 'training')
    ?? state.teams.find(team => team.activity === 'qualifying')
}
export function reconcileStationCrew(state: StationCrew, host: StationCrewHost): void {
  if (seatTeam(state) || !host.ready() || !host.trainingReady()) return
  for (const team of state.teams) {
    if (!team.shipId || !team.planned || team.paused || team.activity !== 'idle' || team.growth >= team.potential || !host.teamAvailable(team.id)) continue
    const ship = host.ship(team.shipId)
    if (!validShip(state, host, team.shipId, team.tier, team.id) || !ship!.trainingTags.includes(team.course)) continue
    if (!host.claimShip(team.shipId)) continue
    team.activity = 'training'
    return
  }
}
function seatBlock(team: CrewTeam, host: StationCrewHost): string | undefined {
  if (team.paused) return 'paused'
  if (!team.shipId) return 'ship'
  if (!host.ready()) return 'facilities'
  if (!host.trainingReady()) return 'training'
  if (!host.teamAvailable(team.id)) return 'busy'
  if (team.members.some(index => !host.residents().includes(index))) return 'person'
  if (team.activity === 'training') {
    const ship = host.ship(team.shipId)
    // available 在成功 claim 后通常为 false；该船锁归本团队，不能拿 available 再次拒绝自己。
    if (!ship || !ship.home || ship.tier > team.tier) return 'ship'
    if (!ship.trainingTags.includes(team.course)) return 'course'
  }
  return undefined
}
export function stationCrewNextEventMs(state: StationCrew, host: StationCrewHost): number {
  const team = seatTeam(state)
  if (!team) {
    return host.ready() && host.trainingReady() && state.teams.some(candidate => candidate.planned && !candidate.paused
      && candidate.activity === 'idle' && candidate.growth < candidate.potential && host.teamAvailable(candidate.id)
      && validShip(state, host, candidate.shipId, candidate.tier, candidate.id)
      && host.ship(candidate.shipId!)!.trainingTags.includes(candidate.course)) ? 0 : Infinity
  }
  return seatBlock(team, host) ? Infinity : team.activity === 'qualifying'
    ? CREW_QUALIFICATION_MS - team.qualificationMs : CREW_TICK_MS - team.progressMs
}
function owns(team: CrewTeam, reward: CrewReward): boolean {
  return reward.kind === 'trait' ? team.traits.includes(reward.id) : team.skills.includes(reward.id) || team.opportunities.includes(reward.id)
}
function eligible(team: CrewTeam, reward: CrewReward): boolean {
  return !owns(team, reward) && !team.pending?.options.some(option => option.kind === reward.kind && option.id === reward.id)
}
function applyReward(team: CrewTeam, reward: CrewReward): void {
  if (owns(team, reward)) return
  if (reward.kind === 'trait') team.traits.push(reward.id)
  else team.opportunities.push(reward.id)
}
function preferred<T extends { tags: readonly string[] }>(pool: readonly T[], tag: string): readonly T[] {
  const tagged = pool.filter(entry => entry.tags.length === 0 || entry.tags.includes(tag))
  return tagged.length ? tagged : pool
}
function rollEvent(state: StationCrew, team: CrewTeam, tag: string): void {
  const ordinary = CREW_EVENTS.filter(event => eligible(team, event.result))
  const choices = CREW_CHOICE_EVENTS.filter(event => event.options.every(reward => eligible(team, reward)))
  const choiceAllowed = !team.pending && state.teams.filter(entry => entry.pending).length < 2
    && (team.choiceCount + 1) * 5 <= team.eventCount + 1 && (state.choicesTotal + 1) * 5 <= state.eventsTotal + 1
    && (state.lastChoiceAtMs === null || state.clockMs - state.lastChoiceAtMs >= CREW_CHOICE_INTERVAL_MS)
  if (choiceAllowed && choices.length && random(team) < 0.1) {
    const pool = preferred(choices, tag), event = pool[Math.floor(random(team) * pool.length)]
    team.pending = { eventId: event.id, options: event.options.map(option => ({ ...option })) as [CrewReward, CrewReward] }
    team.choiceCount++; state.choicesTotal++; state.lastChoiceAtMs = state.clockMs
  } else {
    if (ordinary.length === 0) return
    const pool = preferred(ordinary, tag), event = pool[Math.floor(random(team) * pool.length)]
    applyReward(team, event.result)
  }
  team.eventCount++; state.eventsTotal++
}
function growthTick(state: StationCrew, team: CrewTeam, tag: string): void {
  if (team.growth >= team.potential) return
  const pair = isCourse(tag) ? CREW_COURSES[tag] : tag === 'guard'
    ? { primary: 'engineering' as const, secondary: 'command' as const }
    : { primary: 'fireControl' as const, secondary: 'piloting' as const }
  team.attributes[team.growth % 3 === 2 ? pair.secondary : pair.primary]++
  team.growth++
  // 点数独立累计，消费余额不恢复普通点数预算。
  team.earnedPoints = Math.min(team.tier * 6, Math.floor(team.growth / 4))
  team.eventProgress++
  if (team.eventProgress >= team.eventThreshold) {
    team.eventProgress -= team.eventThreshold
    rollEvent(state, team, tag)
    team.eventThreshold = threshold(team)
  }
}
function addExperience(state: StationCrew, team: CrewTeam, elapsed: number, tag: string): void {
  let left = elapsed
  while (left > 0 && team.growth < team.potential) {
    if (team.progressMs === 0) team.tickTag = tag
    const step = Math.min(left, CREW_TICK_MS - team.progressMs)
    team.progressMs += step; left -= step
    if (team.progressMs === CREW_TICK_MS) {
      team.progressMs = 0; growthTick(state, team, team.tickTag); team.tickTag = ''
    }
  }
}
export function advanceStationCrew(state: StationCrew, host: StationCrewHost, deltaMs: number, deferBoundary = false): void {
  if (!nonnegative(deltaMs) || !Number.isSafeInteger(state.clockMs + deltaMs)) throw new Error('Invalid crew elapsed time')
  reconcileStationCrew(state, host)
  let left = deltaMs
  while (left > 0) {
    const team = seatTeam(state)
    if (!team || seatBlock(team, host)) { state.clockMs += left; break }
    const remaining = team.activity === 'qualifying' ? CREW_QUALIFICATION_MS - team.qualificationMs : CREW_TICK_MS - team.progressMs
    const step = Math.min(left, remaining)
    state.clockMs += step; left -= step
    if (team.activity === 'qualifying') {
      team.qualificationMs += step
      if (team.qualificationMs === CREW_QUALIFICATION_MS) team.activity = 'idle'
    } else {
      addExperience(state, team, step, team.course)
      if (team.growth === team.potential) { host.releaseShip(team.shipId!); team.activity = 'idle'; team.planned = false }
    }
    if (left > 0 || !deferBoundary) reconcileStationCrew(state, host)
  }
}
/** 宿主只在完成真实任务后调用一次；时间戳由 advance 推进，任务去重属于宿主。 */
export function awardCrewExperience(state: StationCrew, teamId: string, minutes: number, tag: string): boolean {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || !nonnegative(minutes * 60_000) || !validTag(tag)) return false
  const team = teamById(state, teamId)
  if (!team || !isDuty(team.activity)) return false
  addExperience(state, team, minutes * 60_000, tag)
  return true
}
/** 仅改职责，不代替宿主 claim/release；不能把资格期或训练船锁直接转成外派。 */
export function markCrewDuty(state: StationCrew, id: string, duty: 'mission' | 'guard' | 'idle'): boolean {
  const team = teamById(state, id)
  if (!team || !['mission', 'guard', 'idle'].includes(duty) || team.activity === 'qualifying' || team.activity === 'training') return false
  if (duty !== 'idle' && team.activity !== 'idle') return false
  team.activity = duty; team.planned = false; team.paused = false
  return true
}
export function stationCrewCommand(state: StationCrew, host: StationCrewHost, action: StationCrewAction): StationCrewResult {
  const fail = (reason: StationCrewReason): StationCrewResult => ({ ok: false, reason })
  if (!action || typeof action !== 'object') return fail('invalid-action')
  if (action.kind === 'create') {
    const ship = typeof action.shipId === 'string' ? host.ship(action.shipId) : undefined
    const tier = action.tier ?? ship?.tier
    if (!isTier(tier)) return fail('tier')
    if (!validShip(state, host, action.shipId, tier)) return fail('ship')
    const name = action.name === undefined ? `crew-${state.sequence + 1}` : action.name
    if (typeof name !== 'string' || !name.trim() || name.length > 48) return fail('name')
    const candidates = newPeople(state, host), members = action.members ?? candidates.slice(0, tier)
    if (!Array.isArray(members) || members.length !== tier || new Set(members).size !== tier
      || !Array.from(members).every(index => nonnegative(index) && candidates.includes(index))) return fail('person')
    if (!Number.isSafeInteger(state.sequence + 1)) return fail('invalid-action')
    const sequence = ++state.sequence
    const team: CrewTeam = { id: `crew-${sequence}`, name: name.trim(), members: [...members], shipId: action.shipId, tier,
      activity: 'qualifying', course: 'fire-control', progressMs: 0, qualificationMs: 0,
      attributes: { fireControl: 0, piloting: 0, engineering: 0, command: 0 }, earnedPoints: 0, spentPoints: 0,
      growth: 0, potential: tier * 24, opportunities: [], skills: [], traits: [], eventCount: 0, choiceCount: 0,
      planned: false, paused: false, tickTag: '', eventProgress: 0, eventThreshold: 2,
      rng: (Math.imul(sequence, 2654435761) ^ 0x9e3779b9) >>> 0 }
    team.eventThreshold = threshold(team); state.teams.push(team)
    return { ok: true, teamId: team.id }
  }
  const team = teamById(state, 'teamId' in action ? action.teamId : '')
  if (!team) return fail('team')
  if (action.kind === 'reply') {
    if ((action.choice !== 0 && action.choice !== 1) || !team.pending) return fail('choice')
    applyReward(team, team.pending.options[action.choice]); delete team.pending
  } else if (action.kind === 'learn') {
    const blocked = learnBlock(team, action.skillId)
    if (blocked) return fail(blocked)
    team.spentPoints += pointCost(team, action.skillId); team.skills.push(action.skillId)
    team.opportunities = team.opportunities.filter(id => id !== action.skillId)
  } else if (action.kind === 'disband') {
    if (isDuty(team.activity) || !host.teamAvailable(team.id)) return fail('busy')
    if (team.activity === 'training') host.releaseShip(team.shipId!)
    state.teams = state.teams.filter(entry => entry.id !== team.id)
  } else if (action.kind === 'bind') {
    if (team.activity !== 'idle' && team.activity !== 'qualifying' || !host.teamAvailable(team.id)) return fail('busy')
    if (!validShip(state, host, action.shipId, team.tier, team.id)) return fail('ship')
    team.shipId = action.shipId
  } else if (action.kind === 'promote') {
    if (team.activity !== 'idle' || !host.teamAvailable(team.id)) return fail('busy')
    if (team.tier === 3) return fail('tier')
    const person = newPeople(state, host)[0]
    if (person === undefined) return fail('person')
    team.members.push(person); team.tier = (team.tier + 1) as CrewTier; team.potential = team.tier * 24
    team.activity = 'qualifying'; team.qualificationMs = 0; team.planned = false; team.paused = false
  } else if (action.kind === 'plan') {
    if (!isCourse(action.course)) return fail('course')
    if (team.activity === 'qualifying') return fail('qualifying')
    if (isDuty(team.activity) || !host.teamAvailable(team.id)) return fail('busy')
    if (team.activity === 'training' && team.course !== action.course) { host.releaseShip(team.shipId!); team.activity = 'idle' }
    team.course = action.course; team.planned = true; team.paused = false
  } else if (action.kind === 'idle') {
    if (team.activity === 'qualifying') return fail('qualifying')
    if (isDuty(team.activity) || !host.teamAvailable(team.id)) return fail('busy')
    if (team.activity === 'training') host.releaseShip(team.shipId!)
    team.activity = 'idle'; team.planned = false; team.paused = false
  } else if (action.kind === 'pause' || action.kind === 'resume') {
    if (isDuty(team.activity) || !host.teamAvailable(team.id)) return fail('busy')
    team.paused = action.kind === 'pause'
  } else return fail('invalid-action')
  reconcileStationCrew(state, host)
  return { ok: true }
}
export function stationCrewView(state: StationCrew, host: StationCrewHost) {
  const seat = seatTeam(state)
  return { clockMs: state.clockMs, eventsTotal: state.eventsTotal, choicesTotal: state.choicesTotal, lastChoiceAtMs: state.lastChoiceAtMs,
    seatCount: 1, seatUsed: seat ? 1 : 0,
    teams: state.teams.map(team => ({ ...cloneTeam(team),
      blocked: seat?.id === team.id ? seatBlock(team, host) : team.paused ? 'paused' : team.planned || team.activity === 'qualifying' ? 'seat' : undefined,
      remainingMs: CREW_TICK_MS - team.progressMs, qualificationRemainingMs: CREW_QUALIFICATION_MS - team.qualificationMs,
      pointsAvailable: team.earnedPoints - team.spentPoints, growthRemaining: team.potential - team.growth, pointPotential: team.tier * 6,
      bonuses: crewTeamBonuses(team), learnable: team.opportunities.filter(id => !learnBlock(team, id)) })),
    skills: CREW_SKILLS.map(skill => ({ ...skill, requires: { ...skill.requires } })),
    traits: CREW_TRAITS.map(trait => ({ ...trait, effectMods: { ...trait.effectMods } })),
    courses: Object.entries(CREW_COURSES).map(([id, pair]) => ({ id, ...pair })) }
}

/** 拒绝结构、账目或宿主身份不一致的快照；不修补、不调用 claim/release。 */
export function cleanStationCrew(value: unknown, host: StationCrewHost): StationCrew {
  const invalid = (): never => { throw new Error('Invalid station crew snapshot') }
  const record = (entry: unknown): entry is Record<string, unknown> => !!entry && typeof entry === 'object'
    && (Object.getPrototypeOf(entry) === Object.prototype || Object.getPrototypeOf(entry) === null)
  const keys = (entry: Record<string, unknown>, allowed: string[]) => Object.keys(entry).every(key => allowed.includes(key))
  const array = (entry: unknown): entry is unknown[] => Array.isArray(entry) && Object.getPrototypeOf(entry) === Array.prototype
    && Object.keys(entry).length === entry.length && Array.from({ length: entry.length }, (_, index) => Object.hasOwn(entry, index)).every(Boolean)
  const strings = (entry: unknown, allowed: readonly string[]): entry is string[] => array(entry)
    && entry.length <= allowed.length && new Set(entry).size === entry.length && entry.every(id => typeof id === 'string' && allowed.includes(id))
  const reward = (entry: unknown): entry is CrewReward => record(entry) && keys(entry, ['kind', 'id'])
    && typeof entry.id === 'string' && (entry.kind === 'skill' ? !!skillById(entry.id) : entry.kind === 'trait' && !!traitById(entry.id))
  if (!record(value) || !keys(value, ['version', 'clockMs', 'sequence', 'teams', 'eventsTotal', 'choicesTotal', 'lastChoiceAtMs'])
    || value.version !== 1 || !nonnegative(value.clockMs) || !nonnegative(value.sequence)
    || !nonnegative(value.eventsTotal) || !nonnegative(value.choicesTotal) || value.choicesTotal * 5 > value.eventsTotal
    || !array(value.teams) || value.teams.length > host.residents().length
    || (value.lastChoiceAtMs !== null && (!nonnegative(value.lastChoiceAtMs) || value.lastChoiceAtMs > value.clockMs))
    || (value.choicesTotal === 0) !== (value.lastChoiceAtMs === null)
    || (value.lastChoiceAtMs !== null && value.lastChoiceAtMs < (value.choicesTotal - 1) * CREW_CHOICE_INTERVAL_MS)) return invalid()
  const state = createStationCrew()
  state.clockMs = value.clockMs; state.sequence = value.sequence; state.eventsTotal = value.eventsTotal
  state.choicesTotal = value.choicesTotal; state.lastChoiceAtMs = value.lastChoiceAtMs as number | null
  const ids = new Set<string>(), people = new Set<number>(), ships = new Set<string>()
  for (const raw of value.teams) {
    if (!record(raw) || !keys(raw, ['id', 'name', 'members', 'shipId', 'tier', 'activity', 'course', 'progressMs', 'qualificationMs',
      'attributes', 'earnedPoints', 'spentPoints', 'growth', 'potential', 'opportunities', 'skills', 'traits', 'eventCount', 'choiceCount',
      'pending', 'planned', 'paused', 'tickTag', 'eventProgress', 'eventThreshold', 'rng'])
      || typeof raw.id !== 'string' || !/^crew-[1-9][0-9]*$/.test(raw.id) || !Number.isSafeInteger(Number(raw.id.slice(5)))
      || Number(raw.id.slice(5)) > state.sequence || ids.has(raw.id)
      || typeof raw.name !== 'string' || !raw.name.trim() || raw.name !== raw.name.trim() || raw.name.length > 48
      || raw.shipId !== undefined && (typeof raw.shipId !== 'string' || !raw.shipId || ships.has(raw.shipId)) || !isTier(raw.tier)
      || !array(raw.members) || raw.members.length !== raw.tier || new Set(raw.members).size !== raw.tier
      || !raw.members.every(index => nonnegative(index) && host.residents().includes(index) && !people.has(index))
      || !['idle', 'qualifying', 'training', 'mission', 'guard'].includes(raw.activity as string) || !isCourse(raw.course)
      || !nonnegative(raw.progressMs) || raw.progressMs >= CREW_TICK_MS
      || !nonnegative(raw.qualificationMs) || raw.qualificationMs > CREW_QUALIFICATION_MS
      || !record(raw.attributes) || !keys(raw.attributes, attributeKeys) || !attributeKeys.every(key => nonnegative((raw.attributes as Record<string, unknown>)[key]))
      || !nonnegative(raw.growth) || raw.potential !== raw.tier * 24 || raw.growth > raw.potential
      || attributeKeys.reduce((sum, key) => sum + (raw.attributes as Record<string, number>)[key], 0) !== raw.growth
      || !nonnegative(raw.earnedPoints) || raw.earnedPoints !== Math.floor(raw.growth / 4)
      || !nonnegative(raw.spentPoints) || raw.spentPoints > raw.earnedPoints
      || !strings(raw.opportunities, CREW_SKILLS.map(skill => skill.id)) || !strings(raw.skills, CREW_SKILLS.map(skill => skill.id))
      || raw.opportunities.some(id => (raw.skills as string[]).includes(id)) || !strings(raw.traits, CREW_TRAITS.map(trait => trait.id))
      || !nonnegative(raw.eventCount) || !nonnegative(raw.choiceCount) || raw.choiceCount * 5 > raw.eventCount
      || raw.eventCount > Math.floor(raw.growth / 2) || typeof raw.planned !== 'boolean' || typeof raw.paused !== 'boolean'
      || !nonnegative(raw.rng) || raw.rng > 0xffffffff || ![2, 3, 4].includes(raw.eventThreshold as number)
      || !nonnegative(raw.eventProgress) || raw.eventProgress >= (raw.eventThreshold as number)
      || (raw.progressMs === 0 ? raw.tickTag !== '' : !validTag(raw.tickTag))) return invalid()
    const team = raw as unknown as CrewTeam, ship = team.shipId === undefined ? undefined : host.ship(team.shipId)
    if (team.shipId === undefined ? team.activity !== 'idle' && team.activity !== 'qualifying' : !ship || !isTier(ship.tier) || ship.tier > team.tier) return invalid()
    if ((team.activity === 'qualifying') !== (team.qualificationMs < CREW_QUALIFICATION_MS)
      || (team.activity === 'training' && (!team.planned || team.growth === team.potential || !ship?.home || !ship.trainingTags.includes(team.course)))
      || (isDuty(team.activity) && (team.planned || team.paused))
      || (team.growth === team.potential && team.progressMs !== 0)
      || team.spentPoints < team.skills.length || team.spentPoints > team.skills.reduce((sum, id) => sum + skillById(id)!.cost, 0)
      || team.skills.some(id => attributeKeys.some(key => team.attributes[key] < (skillById(id)!.requires[key] ?? 0)))) return invalid()
    if (raw.pending !== undefined) {
      if (!record(raw.pending) || !keys(raw.pending, ['eventId', 'options']) || !array(raw.pending.options)
        || raw.pending.options.length !== 2 || !raw.pending.options.every(reward) || team.choiceCount === 0) return invalid()
      const pending = raw.pending
      const event = CREW_CHOICE_EVENTS.find(event => event.id === pending.eventId)
      if (!event || !event.options.every((option, index) => option.kind === team.pending!.options[index].kind && option.id === team.pending!.options[index].id)
        || team.pending!.options.some(option => owns(team, option))) return invalid()
    }
    // 每个有效事件恰好留下一个结果；未答二择只预留、不应用结果。
    const results = team.opportunities.length + team.skills.length + team.traits.length
    if (results + (team.pending ? 1 : 0) !== team.eventCount) return invalid()
    ids.add(team.id); if (team.shipId !== undefined) ships.add(team.shipId); team.members.forEach(index => people.add(index))
    state.teams.push(cloneTeam(team))
  }
  const retiredEvents = state.eventsTotal - state.teams.reduce((sum, team) => sum + team.eventCount, 0)
  const retiredChoices = state.choicesTotal - state.teams.reduce((sum, team) => sum + team.choiceCount, 0)
  if (state.teams.filter(team => team.activity === 'training').length > 1 || state.teams.filter(team => team.pending).length > 2
    || retiredEvents < 0 || retiredChoices < 0 || retiredChoices * 5 > retiredEvents
    || (state.sequence === state.teams.length && (retiredEvents !== 0 || retiredChoices !== 0))) return invalid()
  return state
}
