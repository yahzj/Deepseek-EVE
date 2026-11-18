import type { SfxCategory, SfxCueId } from './cues'

export interface SfxPlayLogEntry {
  readonly cueId: SfxCueId
  readonly category: SfxCategory
  readonly atMs: number
}

export const SFX_PLAY_LOG_MAX = 60

let entries: SfxPlayLogEntry[] = []
let paused = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
    }
  }
}

export function recordSfxPlay(cueId: SfxCueId, category: SfxCategory, atMs: number = Date.now()): void {
  if (paused) return
  entries.push({ cueId, category, atMs })
  if (entries.length > SFX_PLAY_LOG_MAX) entries = entries.slice(entries.length - SFX_PLAY_LOG_MAX)
  notify()
}

export function sfxPlayLog(): readonly SfxPlayLogEntry[] {
  return entries
}

export function clearSfxPlayLog(): void {
  if (entries.length === 0) return
  entries = []
  notify()
}

export function setSfxPlayLogPaused(value: boolean): void {
  if (paused === value) return
  paused = value
  notify()
}

export function sfxPlayLogPaused(): boolean {
  return paused
}

export function subscribeSfxPlayLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
