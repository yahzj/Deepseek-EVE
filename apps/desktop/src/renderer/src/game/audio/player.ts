/**
 * **音效播放层**（2026-11-02 · 追加批加入：按弹种回落、战斗音高随机、循环试听）——
 * 唯一出口是 `playCue`，三条纪律（沿用 2026-09-25 骨架的约定）：
 *
 * 1. **绝不抛错**：调用点（演出/界面）不能因为音频层出事而中断；这里的异常一律吞掉。
 * 2. **没素材 = 静默**：内置缺文件、本机也没覆盖时什么都不做（不报错、不占位）；
 *    带 `fallback` 的 cue（战斗开火按弹种拆分的三条）在自身无素材时**回落**到旧 `combat-fire`。
 * 3. **节流与并发在播放层**：同一音效按清单的 `minGapMs` / `maxConcurrent` 限流。
 *
 * 实现选 `HTMLAudioElement` 而不是 Web Audio：桌面打包后页面是 `file://`，
 * `fetch`/`decodeAudioData` 取不到字节；`new Audio(url)` 对 `file://` 与 https 是同一套写法。
 *
 * **音高随机**（2026-11-02 船长口径「1200 音分的八度里上下浮动 100 音分」）：
 * 对带 `pitchJitter` 标记的战斗重复音，每次播放随机 `±prefs.pitchJitterCents` 音分：
 * `playbackRate = 2^(音分/1200)` 且 `preservesPitch = false`（浏览器默认 true 只变速不变调，已实测）；
 * 1 音分 ≈ 0.058% 频率差、100 音分 = 1 个半音。一次性重音与 BGM/环境不加标记。
 *
 * **UI 点击音**（2026-11-05 船长口径「UI点击的音效也要有50个音分的上下浮动」）：
 * `ui-click` 按清单里的固定 ±50 音分抖动，不跟随战斗滑条。
 */
import { SFX_CUES } from './cues'
import type { SfxCategory, SfxCueId } from './cues'
import { effectiveGain, pickVariant, pitchRateFor, shouldPlay } from './rules'
import { readSfxPrefs } from './prefs'
import { builtinSfxUrls } from './manifest'
import { getSfxOverrideUrl } from './overrides'
import { recordSfxPlay } from './playLog'

/** 同一音效上次播放时刻（performance.now 口径） */
const lastAtMs = new Map<string, number>()
/** 同一音效正在播放的实例 */
const active = new Map<string, Set<HTMLAudioElement>>()
/** 试听实例（音效台关掉/重开时统一停掉） */
const previewing = new Set<HTMLAudioElement>()
const previewIntervals = new Set<ReturnType<typeof setInterval>>()
const previewTimeouts = new Set<ReturnType<typeof setTimeout>>()
let unlocked = false

function nowMs(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/** 素材解析：本机覆盖 > 自身内置 > fallback 内置；没有则 null（静默） */
function resolvePlayable(cueId: SfxCueId): { urls: string[]; source: SfxCueStatus['source'] } | null {
  const override = getSfxOverrideUrl(cueId)
  if (override !== null) return { urls: [override], source: 'override' }
  const own = builtinSfxUrls(cueId)
  if (own.length > 0) return { urls: [...own], source: 'builtin' }
  const fallback = SFX_CUES[cueId].fallback
  if (fallback !== undefined) {
    const fbOverride = getSfxOverrideUrl(fallback)
    if (fbOverride !== null) return { urls: [fbOverride], source: 'fallback' }
    const fbOwn = builtinSfxUrls(fallback)
    if (fbOwn.length > 0) return { urls: [...fbOwn], source: 'fallback' }
  }
  return null
}

/** 当前素材来源（音效台显示用） */
export function sfxCueSource(cueId: SfxCueId): SfxCueStatus['source'] {
  return resolvePlayable(cueId)?.source ?? 'none'
}

/** 该 cue 当前适用的音高随机幅度（0 = 不抖）：固定幅度优先，战斗重复音跟随设置；loop 永不抖 */
function pitchCentsOf(cueId: SfxCueId): number {
  const cue = SFX_CUES[cueId]
  if (cue.loop === true) return 0
  if (cue.pitchJitterCents !== undefined) return cue.pitchJitterCents
  if (cue.pitchJitter !== true) return 0
  return readSfxPrefs().pitchJitterCents
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
  const playable = resolvePlayable(cueId)
  if (playable === null) return
  const url = pickVariant(playable.urls, Math.random)
  if (url === null) return
  lastAtMs.set(cueId, t)
  let audio: HTMLAudioElement | null = null
  /** 起播被浏览器拒绝/解码失败：立刻把实例从并发表里摘掉（否则会被"幽灵实例"永久占满） */
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
  audio = startAudio(url, gain, { cents: pitchCentsOf(cueId), onFail })
  if (audio === null) return
  set.add(audio)
  active.set(cueId, set)
  // 音效台「实时触发」：只记真实起播成功（试听走 previewCue，不进这里）
  recordSfxPlay(cueId, cue.category)
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

/** 建一个 Audio 并起播（pitch 用 `preservesPitch=false` + playbackRate） */
function startAudio(
  url: string,
  gain: number,
  opts?: { cents?: number; loop?: boolean; onFail?: () => void },
): HTMLAudioElement | null {
  try {
    const audio = new Audio(url)
    audio.preload = 'auto'
    audio.loop = opts?.loop === true
    audio.volume = Math.min(1, Math.max(0, gain))
    const cents = opts?.cents ?? 0
    if (cents > 0) {
      try {
        // TS DOM lib 未声明 preservesPitch（Chrome 实际支持，2026-11-02 实测默认 true）
        ;(audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false
        audio.playbackRate = pitchRateFor(cents, Math.random)
      } catch {
        /* 老浏览器不支持：退回原音高 */
      }
    }
    const p = audio.play()
    if (p !== undefined && typeof p.catch === 'function') {
      p.catch(() => {
        if (opts?.onFail !== undefined) opts.onFail()
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
 * 音效台「试听」：**绕过节流与静音**（静音时也能调音听效果），但严格按当前音量与音高随机播放。
 * 返回是否真的播了（没素材 = false，面板据此提示）。
 */
export function previewCue(cueId: SfxCueId): boolean {
  try {
    const cue = SFX_CUES[cueId]
    if (cue === undefined) return false
    const prefs = readSfxPrefs()
    const gain = Math.min(1, Math.max(0, prefs.master * prefs.categories[cue.category] * cue.gain))
    if (gain <= 0.002) return false
    const playable = resolvePlayable(cueId)
    if (playable === null) return false
    const url = pickVariant(playable.urls, Math.random)
    if (url === null) return false
    const audio = startAudio(url, gain, { cents: pitchCentsOf(cueId) })
    if (audio === null) return false
    previewing.add(audio)
    audio.addEventListener('ended', () => previewing.delete(audio), { once: true })
    audio.addEventListener('error', () => previewing.delete(audio), { once: true })
    return true
  } catch {
    return false
  }
}

/**
 * 音效台「试听」BGM/环境 loop：播 `ms` 毫秒后约 1 秒淡出停止（不切场景、不写覆盖）。
 * 返回是否真的播了。
 */
export function previewLoopCue(cueId: SfxCueId, ms = 5000): boolean {
  try {
    const cue = SFX_CUES[cueId]
    if (cue === undefined) return false
    const prefs = readSfxPrefs()
    const gain = Math.min(1, Math.max(0, prefs.master * prefs.categories[cue.category] * cue.gain))
    if (gain <= 0.002) return false
    const playable = resolvePlayable(cueId)
    if (playable === null) return false
    const url = pickVariant(playable.urls, Math.random)
    if (url === null) return false
    const audio = startAudio(url, gain, { loop: true })
    if (audio === null) return false
    previewing.add(audio)
    const hold = setTimeout(() => {
      previewTimeouts.delete(hold)
      const startLevel = audio.volume
      let fade = 0
      const timer = setInterval(() => {
        fade += 1
        try {
          audio.volume = Math.max(0, startLevel * (1 - fade / 25))
        } catch {
          /* 忽略 */
        }
        if (fade >= 25) {
          clearInterval(timer)
          previewIntervals.delete(timer)
          try {
            audio.pause()
            audio.src = ''
          } catch {
            /* 忽略 */
          }
          previewing.delete(audio)
        }
      }, 40)
      previewIntervals.add(timer)
    }, ms)
    previewTimeouts.add(hold)
    return true
  } catch {
    return false
  }
}

/** 停掉全部正在播放的音效与试听（音效台/调试用） */
export function stopAllSfx(): void {
  for (const timer of [...previewIntervals]) {
    try {
      clearInterval(timer)
    } catch {
      /* 忽略 */
    }
  }
  for (const timer of [...previewTimeouts]) {
    try {
      clearTimeout(timer)
    } catch {
      /* 忽略 */
    }
  }
  previewIntervals.clear()
  previewTimeouts.clear()
  for (const audio of [...previewing]) {
    try {
      audio.pause()
      audio.src = ''
    } catch {
      /* 忽略 */
    }
  }
  previewing.clear()
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
  source: 'override' | 'builtin' | 'fallback' | 'none'
  builtinCount: number
  playing: number
  /** 循环音频（BGM/环境底噪） */
  loop: boolean
  /** 该 cue 当前适用的音高随机幅度（0 = 不抖） */
  pitchCents: number
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
      loop: cue.loop === true,
      pitchCents: pitchCentsOf(id),
    }
  })
}
