import type { UnitSpec } from '../model'
import type { FoeReinforceTrigger, FoeSupportBranch, BattleBalance, SimContext, AnomalyDef } from '../../types'
import { foeGunMaxRangeOf } from '../foeRange'
import { type GameState, addLog } from '../../state'
import { isAlive } from '../combatMath'
import { seedUnit, initFoeDronePools, initFoeRepairPulses } from './state'
import { WORMHOLE_FOE_VOLLEY_STAGGER_MS, pushBattleNotice, BATTLE_ARRIVAL_STAGGER_MS } from '../combatFx'
import { baseFoeTag, FOE_SUPPORT_TAG_RE, supportFoeModelTagOf } from '../foeCard'
import { nextInt } from '../../rng'

export function foeResidualHpFrac(b: import('../../state').BattleState, curFoes: readonly UnitSpec[]): number {
  let max = 0
  let cur = 0
  for (const f of curFoes) {
    max += f.hp.s + f.hp.a + f.hp.h
    const u = b.units[f.tag]
    if (u) cur += u.hp.s + u.hp.a + u.hp.h
  }
  return max > 0 ? Math.max(0, cur) / max : 0
}

export function foeKillCount(b: import('../../state').BattleState): number {
  let n = 0
  for (const tag of Object.keys(b.units)) {
    const u = b.units[tag]!
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) n += 1
  }
  return n
}

export function reinforceTriggered(
  at: FoeReinforceTrigger,
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): boolean {
  if (at.sec !== undefined && b.lastTickGameMs - b.startedAtGameMs >= at.sec * 1000) return true
  if (at.afterKills !== undefined && foeKillCount(b) >= at.afterKills) return true
  if (at.hpBelow !== undefined && foeResidualHpFrac(b, curFoes) <= at.hpBelow) return true
  return false
}

export function supportCallerOf(
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): UnitSpec | undefined {
  for (const spec of curFoes) {
    if (spec.foeSupportCall === undefined) continue
    const u = b.units[spec.tag]
    if (u && u.side === 'foe' && u.hp.s > 0 && u.hp.a > 0 && u.hp.h > 0) return spec
  }
  return undefined
}

export function supportCallerReachM(b: import('../../state').BattleState, caller: UnitSpec): number {
  return caller.weapons.reduce((m, w) => Math.max(m, foeGunMaxRangeOf(b, caller, w)), 0)
}

export function arrivedSupportBranch(
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): FoeSupportBranch | null {
  for (const spec of curFoes) {
    const br = spec.foeReinforceBranch
    if (br !== undefined && b.units[spec.tag]) return br
  }
  return null
}

export function resolveSupportBranch(
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
): FoeSupportBranch | null {
  const settled = arrivedSupportBranch(b, curFoes)
  if (settled !== null) return settled
  const caller = supportCallerOf(b, curFoes)
  if (caller === undefined || caller.foeSupportCall === undefined) return null
  const delayMs = Math.max(0, Math.round(caller.foeSupportCall.delaySec * 1000))
  if (b.lastTickGameMs - b.startedAtGameMs < delayMs) return null
  return b.distanceM <= supportCallerReachM(b, caller) ? 'inside' : 'outside'
}

export function resolveFoeRevive(
  state: GameState,
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
): void {
  if (bal.foeReviveEnabled !== true) return
  const summoner = curFoes.find((f) => f.foeReviveEscort !== undefined || f.foeSummonEscort !== undefined)
  if (summoner === undefined) return
  const summon = summoner.foeSummonEscort
  if (summon?.formationSlots) return
  const config = summon ?? summoner.foeReviveEscort
  if (!config || summon && !summoner.foeSummonTemplate) return
  if (summon && b.ended !== null) return
  if (summoner.foeReviveEscort?.all && b.ended !== null) return
  const rt = b.units[summoner.tag]
  if (!rt || (rt.hp.s <= 0 && rt.hp.a <= 0 && rt.hp.h <= 0)) return
  const everyMs = Math.max(1_000, Math.round(config.everyMs))
  const activeClock = config.activeClock === true
  const clock = activeClock ? b.foeAbilityClocks?.[summoner.tag] ?? 0
    : summoner.foeReviveEscort?.all ? b.lastTickGameMs : nowMs
  if (b.foeReviveAtMs === undefined) b.foeReviveAtMs = activeClock ? everyMs : (rt.enteredAtMs ?? b.startedAtGameMs) + everyMs
  if (clock < b.foeReviveAtMs) return
  b.foeReviveAtMs = clock + everyMs
  if (summon) {
    const alive = foesWithSupport(b, curFoes).filter(foe => isAlive(b, foe.tag)).length
    const original = curFoes.filter(foe => !foe.foeFormationAdded)
    const originalAlive = foesWithSupport(b, original).filter(foe => isAlive(b, foe.tag)).length
    const quota = Math.min(enemyFleetRoom(b), Math.max(1, Math.round(summon.count)), Math.max(0, original.length - originalAlive), Math.max(0, curFoes.length - alive))
    for (let i = 0; i < quota; i++) {
      const n = (b.foeReviveCount ?? 0) + 1
      b.foeReviveCount = n
      const template = summoner.foeSummonTemplate!
      const spec = { ...structuredClone(template), tag: `sup${n}-${template.tag}` }
      seedUnit(b, spec, { enterReload: true, arrivedAtMs: b.lastTickGameMs,
        ...(b.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}) })
      initFoeDronePools(b, [spec])
      initFoeRepairPulses(b, [spec])
      pushBattleNotice(b, `敌方支援舰船入场：${spec.name}`)
      addLog(state, 'warn', `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`, 'core.combat.001', { p1: spec.name, p2: n })
    }
    return
  }
  const revive = summoner.foeReviveEscort
  if (!revive) return
  const specTags = new Set(curFoes.map((f) => f.tag))
  const aliveSlots = new Set<string>()
  for (const [tag, u] of Object.entries(b.units)) {
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) continue
    const slot = baseFoeTag(tag)
    if (specTags.has(slot)) aliveSlots.add(slot)
  }
  if (aliveSlots.size >= curFoes.length) return
  const dead = curFoes.filter(
    (f) =>
      f.foeFormationAdded !== true &&
      f.foeReviveEscort === undefined &&
      (revive.allowedShipIds === undefined || revive.allowedShipIds.includes(f.foeShipId ?? '')) &&
      b.units[f.tag] !== undefined &&
      !aliveSlots.has(f.tag) &&
      b.units[f.tag]!.hp.s <= 0 &&
      b.units[f.tag]!.hp.a <= 0 &&
      b.units[f.tag]!.hp.h <= 0,
  )
  if (dead.length === 0) return
  const want = revive.all === true ? dead.length : Math.max(1, Math.round(revive.count ?? 1))
  const room = curFoes.length - aliveSlots.size
  const quota = Math.min(want, room, dead.length, enemyFleetRoom(b))
  if (quota <= 0) return
  const priorityIds = revive.priorityShipIds ?? []
  const picks: UnitSpec[] = []
  let rest = [...dead]
  for (const shipId of priorityIds) {
    if (picks.length >= quota) break
    const at = rest.findIndex((f) => f.shipId === shipId)
    if (at < 0) continue
    picks.push(rest[at]!)
    rest = rest.filter((_, i) => i !== at)
  }
  while (picks.length < quota && rest.length > 0) {
    const at = nextInt(state.rng, rest.length)
    picks.push(rest[at]!)
    rest = rest.filter((_, i) => i !== at)
  }
  for (const pick of picks) {
    const n = (b.foeReviveCount ?? 0) + 1
    b.foeReviveCount = n
    const spec: UnitSpec = { ...pick, tag: `sup${n}-${pick.tag}` }
    seedUnit(b, spec, {
      enterReload: true,
      arrivedAtMs: activeClock || revive.all ? b.lastTickGameMs : state.gameMs,
      ...(b.wormhole ? { foePhaseMs: WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
    })
    initFoeDronePools(b, [spec])
    initFoeRepairPulses(b, [spec])
    pushBattleNotice(b, `敌方支援舰船入场：${spec.name}`)
    addLog(
      state,
      'warn',
      `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`,
      'core.combat.001',
      { p1: spec.name, p2: n },
    )
  }
}

export function foesWithSupport(
  b: import('../../state').BattleState,
  foes: readonly UnitSpec[],
): UnitSpec[] {
  if (b.foeReviveCount === undefined) return foes as UnitSpec[]
  let extra: UnitSpec[] | null = null
  for (const tag of Object.keys(b.units)) {
    if (!FOE_SUPPORT_TAG_RE.test(tag)) continue
    if (foes.some((f) => f.tag === tag)) continue
    const sourceTag = supportFoeModelTagOf(tag)
    if (sourceTag !== baseFoeTag(tag) && !foes.some(f => f.tag === baseFoeTag(tag))) continue
    const original = foes.find((f) => f.tag === sourceTag)
    const template = original ? undefined : foes.find(f => f.foeSummonTemplate?.tag === sourceTag)?.foeSummonTemplate
    const base = original ?? (template ? structuredClone(template) : undefined)
    if (base === undefined) continue
    ;(extra ??= []).push({ ...base, tag })
  }
  return extra === null ? (foes as UnitSpec[]) : [...foes, ...extra]
}

export function resolveFoeSummon(
  state: GameState,
  b: import('../../state').BattleState,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
): void {
  if (bal.foeReviveEnabled !== true || b.ended !== null) return
  for (const summoner of curFoes) {
    if (enemyFleetRoom(b) <= 0) break
    const config = summoner.foeSummonEscort
    if (!config?.formationSlots || !isAlive(b, summoner.tag)) continue
    const model = curFoes.find(foe => foe.foeShipId === config.shipId)
    if (!model) continue
    const rt = b.units[summoner.tag]!
    const everyMs = Math.max(1_000, Math.round(config.everyMs))
    const ledger = b.foeSummonAtMs ?? (b.foeSummonAtMs = {})
    const next = ledger[summoner.tag] ?? (ledger[summoner.tag] = (rt.enteredAtMs ?? b.foeWaveStartMs ?? b.startedAtGameMs) + everyMs)
    if (nowMs < next) continue
    ledger[summoner.tag] = nowMs + everyMs
    const occupied = new Set(Object.keys(b.units).filter(tag => isAlive(b, tag)).map(baseFoeTag))
    const slot = curFoes.find(foe => !foe.foeFormationAdded && foe.tag !== summoner.tag && b.units[foe.tag] !== undefined && !occupied.has(foe.tag))
    if (!slot) continue
    const n = (b.foeReviveCount ?? 0) + 1
    b.foeReviveCount = n
    const spec = { ...structuredClone(model), tag: `sup${n}~${model.tag}~${slot.tag}` }
    seedUnit(b, spec, { enterReload: true, arrivedAtMs: nowMs, ...(b.wormhole ? { foePhaseMs: WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}) })
    initFoeDronePools(b, [spec])
    initFoeRepairPulses(b, [spec])
    pushBattleNotice(b, '', 'core.combat.001', { p1: spec.name, p2: n })
    addLog(state, 'warn', `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`, 'core.combat.001', { p1: spec.name, p2: n })
  }
}

export function resolveReinforcements(
  state: GameState,
  ctx: SimContext,
  b: import('../../state').BattleState,
  anomaly: AnomalyDef,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  openM: number,
): void {
  if (bal.foeReinforceEnabled !== true) return
  const supportBranch = resolveSupportBranch(b, curFoes)
  const arrived: UnitSpec[] = []
  let arriveIdx = 0
  for (const spec of curFoes) {
    if (enemyFleetRoom(b) <= 0) break
    if (b.units[spec.tag]) continue
    if (spec.foeReinforceBranch !== undefined && spec.foeReinforceBranch !== supportBranch) continue
    const at = spec.foeReinforceAt
    if (!at) continue
    if (!reinforceTriggered(at, b, curFoes)) continue
    seedUnit(b, spec, {
      enterReload: true,
      arrivedAtMs: state.gameMs + arriveIdx * BATTLE_ARRIVAL_STAGGER_MS,
      ...(b.wormhole ? { foePhaseMs: arriveIdx * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
    })
    arriveIdx += 1
    arrived.push(spec)
  }
  if (arrived.length === 0) return
  initFoeDronePools(b, arrived)
  initFoeRepairPulses(b, arrived)
  const byName = new Map<string, number>()
  for (const s of arrived) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  pushBattleNotice(
    b,
    `敌方增援抵达：${[...byName].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join('、')}`,
  )
  const reopen = bal.foeReinforceReopenFrac ?? 0
  if (reopen > 0 && Number.isFinite(openM)) {
    b.distanceM = Math.round(openM * reopen + b.distanceM * (1 - reopen))
  }
  if (b.pdCd && b.dronePools) {
    for (const spec of arrived) {
      const i = curFoes.indexOf(spec)
      if (i >= 0 && i < b.pdCd.length) b.pdCd[i] = Math.max(100, Math.round(bal.pdJudgementMs))
    }
  }
  const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
  const names = [...new Set(arrived.map((s) => s.name))].join('、')
  addLog(
    state,
    'warn',
    `⚔ 敌方增援自远处入场（${waveName ? waveName + "·" : ""}${anomaly.name}）：${names} ×${arrived.length} 加入战斗` +
      `${reopen > 0 ? "，重新接近中。" : "。"}`,
  )
}
import { enemyFleetRoom } from './capacity'
