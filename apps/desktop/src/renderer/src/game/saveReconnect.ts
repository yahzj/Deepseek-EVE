import { loadSaveFile, serializeSaveFile } from '@whale/core'
import type { GameState } from '@whale/core'

export interface ReconnectProgress {
  name: string
  wallMs: number
  gameMs: number
  seq: number
  ironman: boolean
}
export interface ReconnectChoice {
  token: number
  text: string
  fileName: string
  current: ReconnectProgress
  file: ReconnectProgress
}
export function reconnectProgress(state: GameState, wallMs: number): ReconnectProgress {
  return { name: state.character.name, wallMs, gameMs: state.gameMs, seq: state.ironman?.seq ?? 0, ironman: state.ironman?.on === true }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]))
  }
  return value
}
/** 只忽略保存时刻与会话日志，不把角色名或墙钟当成档案身份。 */
export function sameReconnectProgress(a: string, b: string): boolean {
  const fingerprint = (text: string): string => {
    const state = loadSaveFile(text).state
    state.logs = []
    state.savedAtWallMs = 0
    return JSON.stringify(canonical(JSON.parse(serializeSaveFile(state, 0)).state))
  }
  return fingerprint(a) === fingerprint(b)
}
