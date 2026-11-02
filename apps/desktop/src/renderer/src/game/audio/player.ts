/**
 * **音效播放层**（2026-11-02）—— 唯一出口是 `playCue`，三条纪律（沿用 2026-09-25 骨架的约定）：
 *
 * 1. **绝不抛错**：调用点（演出/界面）不能因为音频层出事而中断；这里的异常一律吞掉。
 * 2. **没素材 = 静默**：内置缺文件、本机也没覆盖时什么都不做（不报错、不占位）。
 * 3. **节流与并发在播放层**：同一音效按清单的 `minGapMs` / `maxConcurrent` 限流
 *    —— 战斗开火这类高频事件由规则兜住，调用点不必各自防抖。
 *
 * 实现选 `HTMLAudioElement` 而不是 Web Audio：桌面打包后页面是 `file://`，
 * `fetch`/`decodeAudioData` 取不到字节；`new Audio(url)` 对 `file://` 与 https 是同一套写法，
 * 两端行为一致（CSP 已为内置素材放行 `'self'`、为本机覆盖的 object URL 放行 `blob:`）。
 *
 * 资源优先级：**本机覆盖（音效台导入）> 仓库内置素材**；两者都没有 ⇒ 静默。
 */
import { SFX_CUES } from './cues'
import type { SfxCategory, SfxCueId } from './cues'
import { effectiveGain, pickVariant, shouldPlay } from './rules'
import { readSfxPrefs } from './prefs'
import { builtinSfxUrls } from './manifest'
import { getSfxOverrideUrl } from './overrides'

/** 同一音效上次播放时刻（performance.now 口径） */
const lastAtMs = new Map<string, number>()
/** 同一音效正在播放的实例 */
const active = new Map<string, Set<HTMLAudioElement>>()
let unlocked = false

function nowMs(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/** 某个语义 id 当前可用的素材 URL（本机覆盖优先；空表 = 静默） */
function resolveUrls(cueId: SfxCueId): string[] {
  const override = getSfxOverrideUrl(cueId)
  if (override !== null) return [override]
  return [...builtinSfxUrls(cueId)]
}

/** 当前素材来源（音效台显示用） */
export function sfxCueSource(cueId: SfxCueId): 'override' | 'builtin' | 'none' {
  if (getSfxOverrideUrl(cueId) !== null) return 'override'
  return builtinSfxUrls(cueId).length > 0 ? 'builtin' : 'none'
}

/** 播一个语义音效（未接素材/被静音/被节流时静默；**绝不抛错**） */
export function playCue(cueId: SfxCueId): void {
  try {
    playCueUnsafe(cueId)
  } catch {
    /* 音频层的事故不许影响演出与游戏（2026-09-25 骨架约定） */
  }
}

function playCueUnsafe(cueId: SfxCueId): void {
  const cue = SFX_CUES[cueId]
  if (cue === undefined) return
  const prefs = readSfxPrefs()
  const gain = effectiveGain(cueId, prefs)
  if (gain <= 0.002) return
  const set = active.get(cueId) ?? new Set<HTMLAudioElement>()
  if (set.size >= cue.maxConcurrent) return
  const t = nowMs()
  if (!shouldPlay(lastAtMs.get(cueId), t, cue.minGapMs)) return
  const url = pickVariant(resolveUrls(cueId), Math.random)
  if (url === null) return
  lastAtMs.set(cueId, t)
  let audio: HTMLAudioElement | null = null
  /** 起播被浏览器拒绝/解码失败：立刻把实例从并发表里摘掉（否则这条音效会被"幽灵实例"永久占满） */
  const onFail = (): void => {
    if (audio === null) return
    set.delete(audio)
    if (set.size === 0) active.delete(cueId)
    try {
      audio.src = ''
    } catch {
      /* 忽略 */
    }
  }
  audio = startAudio(url, gain, onFail)
  if (audio === null) return
  set.add(audio)
  active.set(cueId, set)
  audio.addEventListener(
    'ended',
    () => {
      set.delete(audio as HTMLAudioElement)
      if (set.size === 0) active.delete(cueId)
    },
    { once: true },
  )
  audio.addEventListener(
    'error',
    () => {
      set.delete(audio as HTMLAudioElement)
      if (set.size === 0) active.delete(cueId)
    },
    { once: true },
  )
}

/** 建一个 Audio 并起播；构造失败返 null；被自动播放策略拒绝时走 `onFail`（丢弃这一次，不延迟补播） */
function startAudio(url: string, gain: number, onFail?: () => void): HTMLAudioElement | null {
  try {
    const audio = new Audio(url)
    audio.preload = 'auto'
    audio.volume = Math.min(1, Math.max(0, gain))
    const p = audio.play()
    if (p !== undefined && typeof p.catch === 'function') {
      p.catch(() => {
        if (onFail !== undefined) onFail()
        else {
          try {
            audio.src = ''
          } catch {
            /* 忽略 */
          }
        }
      })
    }
    return audio
  } catch {
    return null
  }
}

/**
 * 音效台「试听」：**绕过节流与静音**（静音时也能调音听效果），但严格按当前音量播放。
 * 返回是否真的播了（没素材 = false，面板据此提示）。
 */
export function previewCue(cueId: SfxCueId): boolean {
  try {
    const cue = SFX_CUES[cueId]
    if (cue === undefined) return false
    const prefs = readSfxPrefs()
    const gain = Math.min(1, Math.max(0, prefs.master * prefs.categories[cue.category] * cue.gain))
    if (gain <= 0.002) return false
    const url = pickVariant(resolveUrls(cueId), Math.random)
    if (url === null) return false
    return startAudio(url, gain) !== null
  } catch {
    return false
  }
}

/** 停掉全部正在播放的音效（音效台/调试用） */
export function stopAllSfx(): void {
  for (const [cueId, set] of [...active.entries()]) {
    for (const audio of set) {
      try {
        audio.pause()
        audio.src = ''
      } catch {
        /* 忽略 */
      }
    }
    active.delete(cueId)
  }
}

/** 首次用户手势后视为已解锁（浏览器自动播放策略；只用于状态展示） */
export function sfxAudioUnlocked(): boolean {
  return unlocked
}

/** 挂一次性手势监听（两个入口共用；重复调用无副作用） */
export function installSfxUnlock(): void {
  if (unlocked) return
  try {
    if (typeof document === 'undefined') return
    const onGesture = (): void => {
      unlocked = true
      document.removeEventListener('pointerdown', onGesture, true)
      document.removeEventListener('keydown', onGesture, true)
    }
    document.addEventListener('pointerdown', onGesture, true)
    document.addEventListener('keydown', onGesture, true)
  } catch {
    /* 非浏览器环境（工具/探针）忽略 */
  }
}

/** 音效台/自检用的状态快照 */
export interface SfxCueStatus {
  id: SfxCueId
  category: SfxCategory
  nameId: string
  source: 'override' | 'builtin' | 'none'
  builtinCount: number
  playing: number
}

/** 全部语义音效的当前状态（清单顺序） */
export function sfxStatusList(): SfxCueStatus[] {
  return (Object.keys(SFX_CUES) as SfxCueId[]).map((id) => {
    const cue = SFX_CUES[id]
    return {
      id,
      category: cue.category,
      nameId: cue.nameId,
      source: sfxCueSource(id),
      builtinCount: builtinSfxUrls(id).length,
      playing: active.get(id)?.size ?? 0,
    }
  })
}
