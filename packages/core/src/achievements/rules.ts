import type { GameState } from '../state'
import type { AchievementDef, AchievementSource } from '../types'
import { ironmanClosed, ironmanEver } from '../ironman'
import { firstStatOf } from '../firstTasks'
import type { FirstStatKey } from '../firstTasks'

function tableOf(defs: readonly AchievementDef[] | undefined): readonly AchievementDef[] {
  return defs ?? []
}

export function achievementReached(state: GameState, source: AchievementSource): boolean {
  if (source.kind === 'task') return state.importantTasks[source.taskId]?.done === true
  if (source.kind === 'milestone') return firstStatOf(state, source.stat as FirstStatKey) >= source.target
  if (source.kind === 'ironman') return ironmanEver(state)
  if (source.kind === 'ironmanClosed') return ironmanClosed(state)
  return chainProgress(state, source.chainId) >= source.level
}

export function chainProgress(state: GameState, chainId: string): number {
  return state.importantTasks[`chain-${chainId}`]?.delivered ?? 0
}

export function advanceAchievements(
  state: GameState,
  defs: readonly AchievementDef[] | undefined,
  nowWallMs?: number,
): AchievementDef[] {
  const earned = (state.achievements ??= { earned: {} }).earned
  const newly: AchievementDef[] = []
  for (const def of tableOf(defs)) {
    if (earned[def.id] !== undefined) continue
    if (!achievementReached(state, def.source)) continue
    earned[def.id] = { atGameMs: state.gameMs, atWallMs: wallNowOf(nowWallMs) }
    newly.push(def)
  }
  return newly
}

function wallNowOf(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

export function achievementOverview(
  state: GameState,
  defs: readonly AchievementDef[] | undefined,
): Array<{ def: AchievementDef; earnedAt: number | null; earnedWallMs: number; legacy: boolean; reached: boolean }> {
  const earned = state.achievements?.earned ?? {}
  return tableOf(defs)
    .filter((def) => def.hidden !== true || earned[def.id] !== undefined)
    .map((def) => {
    const rec = earned[def.id]
    return {
      def,
      earnedAt: rec ? rec.atGameMs : null,
      earnedWallMs: rec?.atWallMs ?? 0,
      legacy: rec !== undefined && rec.atGameMs === 0 && rec.atWallMs === 0,
      reached: achievementReached(state, def.source),
    }
  })
}

export function achievementCount(state: GameState): number {
  return Object.keys(state.achievements?.earned ?? {}).length
}
