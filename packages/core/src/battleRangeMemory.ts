import type { BattleState, GameState } from './state'
import type { UnitSpec } from './combat'
import type { SimContext } from './types'
import type { LairTier } from './lairs'
import type { WormholeFoeKind } from './wormholeFoes'
import type { WormholeEventAction, WormholeEventPreview } from './wormholeExpedition'

export interface BattleRangeRecord { desireM: number; maxRangeM?: number }
export interface BattleRangeSnapshot extends BattleRangeRecord { cardId: string; signature: string; minM: number; limitM: number; maxRangeM: number }
export type BattleRangeIntent =
  | { kind: 'expedition'; cardId: string; fromMining?: boolean; autoRepair?: boolean; invasionSeq?: number; options?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number; confirmActivitySwitch?: boolean } }
  | { kind: 'expedition-arrival'; cardId: string; shipId: string }
  | { kind: 'encounter'; invitedAtGameMs: number }
  | { kind: 'flagship'; squad?: readonly string[]; eventSeq?: number }
  | { kind: 'wormhole-fight'; battleKind: Exclude<WormholeFoeKind, 'extract'>; atGameMs?: number; strengthMul?: number }
  | { kind: 'wormhole-travel'; target: { q: number; r: number }; options?: { confirmUnknown?: boolean; confirmIntercept?: boolean; deferAmbush?: boolean; confirmLeaveCargo?: boolean }; atGameMs?: number }
  | { kind: 'wormhole-activate'; atGameMs?: number; options?: { deferRuinsBattle?: boolean } }
  | { kind: 'wormhole-event'; action: WormholeEventAction; expected?: WormholeEventPreview }
export interface PendingBattleRange extends BattleRangeSnapshot { previousRangeM: number; intent: BattleRangeIntent }

function intentKey(i: BattleRangeIntent): unknown {
  switch (i.kind) {
    case 'expedition': return [i.kind, i.cardId, i.fromMining === true, i.autoRepair === true, i.invasionSeq, i.options?.desireM, i.options?.lairTier, i.options?.foeGalaxyId, i.options?.rewardIskOverride, i.options?.confirmActivitySwitch === true]
    case 'expedition-arrival': return [i.kind, i.cardId, i.shipId]
    case 'encounter': return [i.kind, i.invitedAtGameMs]
    case 'flagship': return [i.kind, i.squad, i.eventSeq]
    case 'wormhole-fight': return [i.kind, i.battleKind, i.strengthMul]
    case 'wormhole-travel': return [i.kind, i.target.q, i.target.r, i.options?.confirmUnknown === true, i.options?.confirmIntercept === true, i.options?.deferAmbush === true, i.options?.confirmLeaveCargo === true]
    case 'wormhole-activate': return [i.kind, i.options?.deferRuinsBattle === true]
    case 'wormhole-event': return [i.kind, i.action, i.expected?.fingerprint]
  }
}

function fittedSignature(fitted: GameState['fleet'][string]['fitted'] | undefined): unknown {
  return ['high', 'mid', 'low'].map(rack => {
    const slots = [...(fitted?.[rack as 'high' | 'mid' | 'low'] ?? [])]
    while (slots.length && !slots.at(-1)) slots.pop()
    return slots
  })
}

export function battleCardKey(cardId: string): string { return cardId.startsWith('wk-') ? cardId.slice(3) : cardId }
export function battleCardRangeOf(state: GameState, cardId: string): BattleRangeRecord | undefined {
  return state.battleRangeByCard?.[battleCardKey(cardId)]
}
export function playerFleetMaxRangeOf(units: readonly UnitSpec[]): number {
  return Math.round(units.reduce((top, unit) => unit.weapons.reduce((best, weapon) => weapon.disabled ? best : Math.max(best, weapon.maxRangeM), top), 0))
}
export function battleRangeSnapshot(cardId: string, units: readonly UnitSpec[], desireM: number, limitM: number, minM: number): BattleRangeSnapshot {
  return { cardId: battleCardKey(cardId), desireM, maxRangeM: playerFleetMaxRangeOf(units), minM, limitM,
    signature: JSON.stringify(units.map(unit => [unit.shipId, unit.tag, unit.weapons.map(w => [w.moduleId, w.src, w.disabled, w.minRangeM, w.maxRangeM])])) }
}
export function rememberBattleRange(state: GameState, snapshot: BattleRangeSnapshot): void {
  state.battleRangeByCard = { ...state.battleRangeByCard, [snapshot.cardId]: { desireM: snapshot.desireM, maxRangeM: snapshot.maxRangeM } }
}

let transactionDepth = 0
const confirmations = new WeakMap<GameState, { signature: string; cardId: string; maxRangeM: number; desireM: number }>()
let activeConsent: ReturnType<typeof confirmations.get>
function runNested<T>(state: GameState, run: (state: GameState) => T): T {
  transactionDepth += 1
  const previous = activeConsent
  activeConsent = confirmations.get(state) ?? previous
  try { return run(state) } finally { transactionDepth -= 1; activeConsent = previous }
}
function newlyOpened(before: GameState, after: GameState, result: unknown): BattleState | undefined {
  if (!before.expedition.battle && after.expedition.battle) return after.expedition.battle
  if (!before.encounter.battle && after.encounter.battle) return after.encounter.battle
  if (!before.wormhole.run?.battle && after.wormhole.run?.battle) return after.wormhole.run.battle
  if (typeof result === 'object' && result !== null && 'battle' in result) return (result as { battle?: BattleState }).battle
  return undefined
}

/** 原动作只在副本执行；射程变化时仅提交待确认意图，不提交库存、移动或活动切换。 */
export function withBattleRangeCheck<T extends { ok: boolean }>(state: GameState, intent: BattleRangeIntent, run: (staged: GameState) => T): T {
  if (transactionDepth > 0 || state.wormhole.run?.automaticBattleRanges) return run(state)
  if (state.pendingBattleRange && !confirmations.has(state)) return { ok: false, rangeConfirmation: true } as unknown as T
  const staged = structuredClone(state)
  delete staged.pendingBattleRange
  const consent = confirmations.get(state)
  if (consent) confirmations.set(staged, consent)
  let result = runNested(staged, run)
  if (!result.ok) return result
  const battle = newlyOpened(state, staged, result)
  const snapshot = battle?.rangeMemory
  if (battle && snapshot) {
    const ids = battle.myFleet?.map(row => row.shipId) ?? [intent.kind === 'encounter' ? (state.encounter.shipId ?? state.shipId) : state.shipId]
    snapshot.signature = JSON.stringify([snapshot.signature, intentKey(intent), ids.map(id => {
      const ship = state.fleet[id]
      return [id, ship?.defId, fittedSignature(ship?.fitted), ship?.droneLoad, ship?.ammoPref, ship?.plugs]
    }), Object.entries(state.skills.trained).filter(([, level]) => level > 0).sort(([a], [b]) => a.localeCompare(b)),
      state.wormhole.run ? [state.wormhole.run.seed, state.wormhole.run.depth, state.wormhole.run.grid?.pos, state.wormhole.run.hold] : null,
      intent.kind === 'flagship' ? state.weekendEvent?.seq : null])
    const old = battleCardRangeOf(state, snapshot.cardId)
    const confirmation = confirmations.get(state)
    const accepted = confirmation?.cardId === snapshot.cardId && confirmation.signature === snapshot.signature && confirmation.maxRangeM === snapshot.maxRangeM
    if (old?.maxRangeM !== undefined && !accepted && (old.maxRangeM !== snapshot.maxRangeM || consent)) {
      state.pendingBattleRange = { ...snapshot, desireM: old.desireM, previousRangeM: old.maxRangeM, intent }
      return { ok: false, rangeConfirmation: true } as unknown as T
    }
    if (accepted) {
      battle.myDesireM = Math.max(snapshot.minM, Math.min(snapshot.limitM, Math.round(confirmation.desireM)))
      snapshot.desireM = battle.myDesireM
    }
  }
  if (consent && (!snapshot || snapshot.cardId !== consent.cardId)) return { ok: false } as T
  const before = { expedition: state.expedition.battle, encounter: state.encounter.battle, wormhole: state.wormhole.run?.battle }
  result = runNested(state, run)
  if (!result.ok) return result
  const opened = (!before.expedition && state.expedition.battle) || (!before.encounter && state.encounter.battle)
    || (!before.wormhole && state.wormhole.run?.battle) || (typeof result === 'object' && 'battle' in result ? (result as { battle?: BattleState }).battle : undefined)
  if (opened?.rangeMemory) {
    if (consent && consent.cardId === opened.rangeMemory.cardId) {
      opened.myDesireM = Math.max(opened.rangeMemory.minM, Math.min(opened.rangeMemory.limitM, Math.round(consent.desireM)))
      opened.rangeMemory.desireM = opened.myDesireM
    }
    rememberBattleRange(state, opened.rangeMemory)
  }
  delete state.pendingBattleRange
  return result
}

export function confirmedBattleDesire(state: GameState, cardId: string): number | undefined {
  const consent = confirmations.get(state) ?? activeConsent
  return consent?.cardId === battleCardKey(cardId) ? consent.desireM : undefined
}

export function withBattleRangeConsent<T>(state: GameState, desireM: number, run: () => T): T {
  const pending = state.pendingBattleRange!
  confirmations.set(state, { signature: pending.signature, cardId: pending.cardId, maxRangeM: pending.maxRangeM, desireM })
  try { return run() } finally { confirmations.delete(state) }
}
export function cancelBattleRange(state: GameState): void {
  const intent = state.pendingBattleRange?.intent
  delete state.pendingBattleRange
  if (intent?.kind === 'expedition') {
    state.autoLoopAnomalyId = null
    if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  }
  if (intent?.kind === 'expedition-arrival') {
    state.expedition.active = false
    state.expedition.battle = null
    state.expedition.anomalyId = null
    state.expedition.phase = 'out'
    state.autoLoopAnomalyId = null
  }
}

export function pendingBattleRangeView(state: GameState, ctx: SimContext) {
  const pending = state.pendingBattleRange
  return pending ? { ...pending, name: ctx.anomalies.get(pending.cardId)?.name ?? pending.cardId } : undefined
}

export function cleanBattleRangeRecords(value: unknown): GameState['battleRangeByCard'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const rows: Record<string, BattleRangeRecord> = {}
  for (const [key, row] of Object.entries(value)) {
    if (!key || key === '__proto__' || !row || typeof row !== 'object') continue
    const r = row as BattleRangeRecord
    if (!Number.isFinite(r.desireM) || r.desireM <= 0) continue
    if (r.maxRangeM !== undefined && (!Number.isFinite(r.maxRangeM) || r.maxRangeM < 0)) continue
    const card = battleCardKey(key)
    if (!card || ['__proto__', 'constructor', 'prototype'].includes(card)) continue
    rows[card] = { desireM: Math.round(r.desireM), ...(r.maxRangeM !== undefined ? { maxRangeM: Math.round(r.maxRangeM) } : {}) }
  }
  return Object.keys(rows).length ? rows : undefined
}

export function cleanBattleRangeSnapshot(value: unknown): BattleRangeSnapshot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as BattleRangeSnapshot
  if (typeof r.cardId !== 'string' || !r.cardId || typeof r.signature !== 'string'
    || !Number.isFinite(r.desireM) || r.desireM <= 0 || !Number.isFinite(r.maxRangeM) || r.maxRangeM < 0
    || !Number.isFinite(r.minM) || r.minM < 0 || !Number.isFinite(r.limitM) || r.limitM < r.minM) return undefined
  return { cardId: battleCardKey(r.cardId), signature: r.signature, desireM: Math.round(r.desireM), maxRangeM: Math.round(r.maxRangeM), minM: r.minM, limitM: r.limitM }
}

export function cleanPendingBattleRange(value: unknown): PendingBattleRange | undefined {
  const snapshot = cleanBattleRangeSnapshot(value)
  if (!snapshot) return undefined
  const r = value as PendingBattleRange
  if (!Number.isFinite(r.previousRangeM) || r.previousRangeM < 0 || !r.intent || typeof r.intent !== 'object') return undefined
  const i = r.intent
  const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  let intent: BattleRangeIntent
  switch (i.kind) {
    case 'expedition': {
      if (typeof i.cardId !== 'string' || battleCardKey(i.cardId) !== snapshot.cardId) return undefined
      const o = i.options
      intent = { kind: i.kind, cardId: i.cardId, ...(i.fromMining === true ? { fromMining: true } : {}), ...(i.autoRepair === true ? { autoRepair: true } : {}), ...(number(i.invasionSeq) ? { invasionSeq: i.invasionSeq } : {}), ...(o ? { options: {
        ...(number(o.desireM) && o.desireM > 0 ? { desireM: o.desireM } : {}),
        ...([1, 2, 3].includes(o.lairTier ?? 0) ? { lairTier: o.lairTier } : {}),
        ...(typeof o.foeGalaxyId === 'string' ? { foeGalaxyId: o.foeGalaxyId } : {}),
        ...(number(o.rewardIskOverride) && o.rewardIskOverride >= 0 ? { rewardIskOverride: o.rewardIskOverride } : {}),
        ...(o.confirmActivitySwitch === true ? { confirmActivitySwitch: true } : {}),
      } } : {}) }
      break
    }
    case 'encounter':
      if (!number(i.invitedAtGameMs)) return undefined
      intent = { kind: i.kind, invitedAtGameMs: i.invitedAtGameMs }; break
    case 'expedition-arrival':
      if (typeof i.cardId !== 'string' || battleCardKey(i.cardId) !== snapshot.cardId || typeof i.shipId !== 'string') return undefined
      intent = { kind: i.kind, cardId: i.cardId, shipId: i.shipId }; break
    case 'flagship':
      intent = { kind: i.kind, ...(number(i.eventSeq) ? { eventSeq: i.eventSeq } : {}), ...(Array.isArray(i.squad) ? { squad: i.squad.filter((v): v is string => typeof v === 'string').slice(0, 4) } : {}) }; break
    case 'wormhole-fight':
      if (!['node', 'boss', 'ruins', 'spawn'].includes(i.battleKind)) return undefined
      intent = { kind: i.kind, battleKind: i.battleKind, ...(number(i.atGameMs) ? { atGameMs: i.atGameMs } : {}), ...(number(i.strengthMul) ? { strengthMul: i.strengthMul } : {}) }; break
    case 'wormhole-travel':
      if (!i.target || !number(i.target.q) || !number(i.target.r)) return undefined
      intent = { kind: i.kind, target: { q: i.target.q, r: i.target.r }, options: {
        confirmUnknown: i.options?.confirmUnknown === true, confirmIntercept: i.options?.confirmIntercept === true,
        deferAmbush: i.options?.deferAmbush === true, confirmLeaveCargo: i.options?.confirmLeaveCargo === true,
      }, ...(number(i.atGameMs) ? { atGameMs: i.atGameMs } : {}) }
      if (!i.options) delete intent.options
      break
    case 'wormhole-activate': intent = { kind: i.kind, ...(number(i.atGameMs) ? { atGameMs: i.atGameMs } : {}),
      ...(i.options ? { options: { deferRuinsBattle: i.options.deferRuinsBattle === true } } : {}) }; break
    case 'wormhole-event':
      if (!['repair', 'search', 'supply', 'container', 'force', 'investigate', 'verify', 'respond', 'reject', 'wait', 'cross', 'bypass'].includes(i.action)) return undefined
      intent = { kind: i.kind, action: i.action, ...(i.expected && typeof i.expected.fingerprint === 'string' ? { expected: i.expected } : {}) }; break
    default: return undefined
  }
  return { ...snapshot, previousRangeM: Math.round(r.previousRangeM), intent }
}
