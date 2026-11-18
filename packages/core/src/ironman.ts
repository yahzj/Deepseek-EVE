
export const IRONMAN_OFFLINE_CAP_BONUS_MS = 8 * 3_600_000

export const IRONMAN_COMMON_FLOW_MUL = 3
export const IRONMAN_RARE_WEIGHT_MUL = 2
export const IRONMAN_EXOTIC_WEIGHT_MUL = 2
export const IRONMAN_EXOTIC_CAP_BONUS = 2

export const IRONMAN_REWARD_MUL = 1.1
export const IRONMAN_RARE_DROP_MUL = 1.2
export const IRONMAN_TRAINING_MUL = 0.9

export const IRONMAN_RESCUE_MIN_AGE_MS = 48 * 3_600_000

export type { IronmanState } from './state'

export interface IronmanLike {
  on?: boolean
  seq?: number
  sinceWallMs?: number
  closedWallMs?: number
}

export function ironmanOf(state: { ironman?: IronmanLike } | null | undefined): Required<Pick<IronmanLike, 'on' | 'seq'>> &
  Omit<IronmanLike, 'on' | 'seq'> {
  const raw = state?.ironman
  const seq = typeof raw?.seq === 'number' && Number.isFinite(raw.seq) ? Math.max(0, Math.floor(raw.seq)) : 0
  return {
    on: raw?.on === true,
    seq,
    ...(typeof raw?.sinceWallMs === 'number' && Number.isFinite(raw.sinceWallMs) ? { sinceWallMs: raw.sinceWallMs } : {}),
    ...(typeof raw?.closedWallMs === 'number' && Number.isFinite(raw.closedWallMs) ? { closedWallMs: raw.closedWallMs } : {}),
  }
}

export function ironmanOn(state: { ironman?: IronmanLike } | null | undefined): boolean {
  return ironmanOf(state).on
}

export function ironmanEver(state: { ironman?: IronmanLike } | null | undefined): boolean {
  const it = ironmanOf(state)
  return it.on || it.sinceWallMs !== undefined
}

export function ironmanClosed(state: { ironman?: IronmanLike } | null | undefined): boolean {
  return ironmanOf(state).closedWallMs !== undefined
}

export function ironmanModeChosen(
  state: ({ ironman?: IronmanLike } & { modeChosen?: boolean }) | null | undefined,
): boolean {
  if (ironmanEver(state)) return true
  return state?.modeChosen === true
}

export function markModeChosenAsStandard(state: { modeChosen?: boolean }): void {
  state.modeChosen = true
}

export function ironmanSeq(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOf(state).seq
}

export function bumpIronmanSeq(state: { ironman?: IronmanLike }): number {
  const it = ironmanOf(state)
  if (!it.on) return it.seq
  const next = it.seq + 1
  state.ironman = {
    on: true,
    seq: next,
    ...(it.sinceWallMs !== undefined ? { sinceWallMs: it.sinceWallMs } : {}),
    ...(it.closedWallMs !== undefined ? { closedWallMs: it.closedWallMs } : {}),
  }
  return next
}

export function enterIronman(
  state: { ironman?: IronmanLike },
  atWallMs: number,
  ledgerSeq = 0,
): boolean {
  const it = ironmanOf(state)
  if (it.closedWallMs !== undefined) return false
  if (it.on) return true
  const base = Math.max(it.seq, Math.max(0, Math.floor(ledgerSeq || 0)))
  state.ironman = {
    on: true,
    seq: base,
    sinceWallMs: it.sinceWallMs ?? Math.max(0, Math.floor(atWallMs)),
  }
  return true
}

export function closeIronman(state: { ironman?: IronmanLike }, atWallMs: number): boolean {
  const it = ironmanOf(state)
  if (!it.on) return false
  state.ironman = {
    on: false,
    seq: it.seq,
    ...(it.sinceWallMs !== undefined ? { sinceWallMs: it.sinceWallMs } : {}),
    closedWallMs: Math.max(0, Math.floor(atWallMs)),
  }
  return true
}

export function ironmanLoadVerdict(args: {
  ironman: boolean
  incomingSeq: number
  currentSeq: number
  ledgerSeq: number
  incomingSavedAtWallMs: number
  nowWallMs: number
  bypass?: boolean
}): { ok: true; rescue: boolean } | { ok: false; reason: 'rolled-back'; threshold: number } {
  if (args.bypass === true) return { ok: true, rescue: false }
  if (!args.ironman) return { ok: true, rescue: false }
  const threshold = Math.max(
    0,
    Math.floor(args.currentSeq || 0),
    Math.floor(args.ledgerSeq || 0),
  )
  if (Math.floor(args.incomingSeq || 0) >= threshold) return { ok: true, rescue: false }
  const age = args.nowWallMs - Math.max(0, Math.floor(args.incomingSavedAtWallMs || 0))
  if (args.incomingSavedAtWallMs > 0 && age >= IRONMAN_RESCUE_MIN_AGE_MS) return { ok: true, rescue: true }
  return { ok: false, reason: 'rolled-back', threshold }
}


export function ironmanOfflineCapBonusMs(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_OFFLINE_CAP_BONUS_MS : 0
}

export function ironmanCommonFlowMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_COMMON_FLOW_MUL : 1
}

export function ironmanRareWeightMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_RARE_WEIGHT_MUL : 1
}

export function ironmanExoticWeightMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_EXOTIC_WEIGHT_MUL : 1
}

export function ironmanExoticCapBonus(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_EXOTIC_CAP_BONUS : 0
}

export function ironmanRewardMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_REWARD_MUL : 1
}

export function ironmanRareDropMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_RARE_DROP_MUL : 1
}

export function ironmanTrainingMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_TRAINING_MUL : 1
}
