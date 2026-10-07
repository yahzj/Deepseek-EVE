import type { GameState } from './state'

export const PREPARATION_SQUAD_KINDS = ['signal-manual', 'signal-auto', 'wormhole-manual', 'wormhole-auto', 'weekend'] as const
export type PreparationSquadKind = (typeof PREPARATION_SQUAD_KINDS)[number]
export type PreparationSquads = Partial<Record<PreparationSquadKind, string[]>>

function cleanSquad(value: readonly unknown[]): string[] {
  const result: string[] = []
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128 || result.includes(id)) continue
    result.push(id)
    if (result.length === 4) break
  }
  return result
}

/** 空数组表示玩家主动清空；非数组或全坏的非空数组不生成假记忆。 */
export function cleanPreparationSquads(value: unknown): PreparationSquads | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: PreparationSquads = {}
  for (const kind of PREPARATION_SQUAD_KINDS) {
    const raw = (value as Record<string, unknown>)[kind]
    if (!Array.isArray(raw)) continue
    const squad = cleanSquad(raw)
    if (raw.length === 0 || squad.length > 0) result[kind] = squad
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** 仅过滤已不在编的船；忙碌、质量或核心门槛由各准备入口判，不自动替换。 */
export function preparationSquadOf(state: GameState, kind: PreparationSquadKind, fallback: readonly string[] = []): string[] {
  const squad = state.preparationSquads?.[kind] ?? fallback
  return cleanSquad(squad).filter(id => state.fleet[id] !== undefined)
}

/** 只改偏好，保留显式空；不换主控、不停活动或启动任务。 */
export function notePreparationSquad(state: GameState, kind: PreparationSquadKind, squad: readonly string[]): boolean {
  const clean = cleanSquad(squad).filter(id => state.fleet[id] !== undefined)
  const previous = state.preparationSquads?.[kind]
  if (previous && previous.length === clean.length && previous.every((id, index) => id === clean[index])) return false
  state.preparationSquads = { ...state.preparationSquads, [kind]: clean }
  return true
}
