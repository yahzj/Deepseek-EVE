/**
 * **实时触发日志**（2026-11-04 音效台调试批）——只记真实播放，不含试听。
 *
 * 用途：船长到真实场景里看画面时，音效台「实时触发」页签滚动显示最近响过的语义 id，
 * 方便反查"这个画面到底该配什么声音"。
 *
 * 记录点 = `player.ts` 的 `playCueUnsafe`：起播成功并登记进并发表之后才记；
 * `previewCue` / `previewLoopCue`（音效台试听）**不算**真实触发。
 * 纯内存、环形上限 60 条；不落盘、不进存档、不随发布。
 */
import type { SfxCategory, SfxCueId } from './cues'

export interface SfxPlayLogEntry {
  readonly cueId: SfxCueId
  readonly category: SfxCategory
  /** 墙钟毫秒（只用于显示时间；节流仍用 performance.now） */
  readonly atMs: number
}

/** 环形上限：调试台只看最近这些条，避免长时间挂机把内存拖大 */
export const SFX_PLAY_LOG_MAX = 60

let entries: SfxPlayLogEntry[] = []
let paused = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* 订阅方自己的异常不影响记录 */
    }
  }
}

/** 记一条真实播放（暂停记录时直接丢弃） */
export function recordSfxPlay(cueId: SfxCueId, category: SfxCategory, atMs: number = Date.now()): void {
  if (paused) return
  entries.push({ cueId, category, atMs })
  if (entries.length > SFX_PLAY_LOG_MAX) entries = entries.slice(entries.length - SFX_PLAY_LOG_MAX)
  notify()
}

/** 最近的真实触发（旧 → 新；面板自行倒序展示） */
export function sfxPlayLog(): readonly SfxPlayLogEntry[] {
  return entries
}

/** 清空记录（不影响暂停状态） */
export function clearSfxPlayLog(): void {
  if (entries.length === 0) return
  entries = []
  notify()
}

/** 暂停/继续记录（暂停期间真实播放也不记；用于盯住某段画面） */
export function setSfxPlayLogPaused(value: boolean): void {
  if (paused === value) return
  paused = value
  notify()
}

export function sfxPlayLogPaused(): boolean {
  return paused
}

/** 订阅记录变化（音效台刷新用） */
export function subscribeSfxPlayLog(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
