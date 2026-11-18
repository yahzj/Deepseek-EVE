
import type { SkillDef } from '../types'
import type { GameState } from '../state'
import { ironmanTrainingMul } from '../ironman'
import { tuningMul } from '../tuning'

export const SYNAPTIC_ACCELERANT_MS = 24 * 60 * 60 * 1000
export const SYNAPTIC_ACCELERANT_MUL = 0.5

export function synapticAccelerantActive(state: GameState): boolean {
  return (state.skillBoostUntilMs ?? 0) > state.gameMs
}

export function trainingTimeFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['accelerated-learning'] ?? 0)
  const boost = synapticAccelerantActive(state) ? SYNAPTIC_ACCELERANT_MUL : 1
  return (1 - 0.04 * lv) * ironmanTrainingMul(state) * boost
}

export function normalizeTrainingProgress(state: GameState): void {
  if (state.skills.progressVersion === 1) return
  const factor = state.debugQuick ? 1 : trainingTimeFactor(state) * tuningMul(state, 'skillTrainMs')
  for (const item of state.skills.queue) item.progressMs /= factor
  for (const id of Object.keys(state.skills.savedProgress)) state.skills.savedProgress[id]! /= factor
  state.skills.progressVersion = 1
}

export function trainingLevelProgress(state: GameState, def: SkillDef, level: number, workMs: number) {
  const totalWorkMs = state.debugQuick ? 1000 : Math.max(1, skillLevelTimeMs(def, level))
  const levelTimeMs = state.debugQuick ? 1000 : Math.max(1, Math.round(
    totalWorkMs * trainingTimeFactor(state) * tuningMul(state, 'skillTrainMs'),
  ))
  const progressWorkMs = Math.min(totalWorkMs, Math.max(0, workMs))
  const workPerMs = totalWorkMs / levelTimeMs
  return {
    totalWorkMs,
    workPerMs,
    levelTimeMs,
    progressMs: progressWorkMs / workPerMs,
    remainingMs: (totalWorkMs - progressWorkMs) / workPerMs,
    percent: progressWorkMs / totalWorkMs * 100,
  }
}

export const DEFAULT_TRAIN_BASE_MS = 60_000

const RANK_BASE_MS: Record<number, number> = {
  1: 60_000,
  2: 60_000,
  3: 155_000,
  4: 696_000,
  5: 742_000,
}

export const LEVEL_TIME_COEF: readonly number[] = [1, 2, 4, 16, 64]

export function skillLevelTimeMs(def: SkillDef, level: number): number {
  const base = def.baseMs ?? RANK_BASE_MS[def.rank] ?? DEFAULT_TRAIN_BASE_MS
  const coef = LEVEL_TIME_COEF[level - 1] ?? LEVEL_TIME_COEF[LEVEL_TIME_COEF.length - 1]!
  return Math.round(base * def.rank * coef)
}

export function totalTimeToLevel(def: SkillDef, fromLevel: number, targetLevel: number): number {
  let total = 0
  for (let level = fromLevel + 1; level <= targetLevel; level++) {
    total += skillLevelTimeMs(def, level)
  }
  return total
}

export function totalQueueTimeMs(
  trained: Record<string, number>,
  queue: ReadonlyArray<{ skillId: string; targetLevel: number }>,
  catalog: ReadonlyMap<string, SkillDef>,
): number {
  let total = 0
  for (const item of queue) {
    const def = catalog.get(item.skillId)
    if (!def) continue
    const current = trained[item.skillId] ?? 0
    total += totalTimeToLevel(def, current, item.targetLevel)
  }
  return total
}
