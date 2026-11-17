import { SFX_CUES } from './cues'
import type { SfxCategory, SfxCueId } from './cues'
import { effectiveGain, pickVariant, pitchRateFor, shouldPlay } from './rules'
import { readSfxPrefs } from './prefs'
import { builtinSfxUrls } from './manifest'
import { getSfxOverrideUrl } from './overrides'
import { recordSfxPlay } from './playLog'

const lastAtMs = new Map<string, number>()
const active = new Map<string, Set<HTMLAudioElement>>()
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

export function sfxCueSource(cueId: SfxCueId): SfxCueStatus['source'] {
  return resolvePlayable(cueId)?.source ?? 'none'
}

function pitchCentsOf(cueId: SfxCueId): number {
  const cue = SFX_CUES[cueId]
  if (cue.loop === true) return 0
  if (cue.pitchJitterCents !== undefined) return cue.pitchJitterCents
  if (cue.pitchJitter !== true) return 0
  return readSfxPrefs().pitchJitterCents
}

export function playCue(cueId: SfxCueId): HTMLAudioElement | null {
  try {
    return playCueUnsafe(cueId)
  } catch {
    return null
  }
}

function playCueUnsafe(cueId: SfxCueId): HTMLAudioElement | null {
  const cue = SFX_CUES[cueId]
  if (cue === undefined) return null
  const prefs = readSfxPrefs()
  const gain = effectiveGain(cueId, prefs)
  if (gain <= 0.002) return null
  const set = active.get(cueId) ?? new Set<HTMLAudioElement>()
  if (set.size >= cue.maxConcurrent) return null
  const t = nowMs()
  if (!shouldPlay(lastAtMs.get(cueId), t, cue.minGapMs)) return null
  const playable = resolvePlayable(cueId)
  if (playable === null) return null
  const url = pickVariant(playable.urls, Math.random)
  if (url === null) return null
  lastAtMs.set(cueId, t)
  let audio: HTMLAudioElement | null = null
  const onFail = (): void => {
    if (audio === null) return
    set.delete(audio)
    if (set.size === 0) active.delete(cueId)
    try {
      audio.src = ''
    } catch {
    }
  }
  audio = startAudio(url, gain, { cents: pitchCentsOf(cueId), onFail })
  if (audio === null) return null
  set.add(audio)
  active.set(cueId, set)
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
  return audio
}

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
        ;(audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false
        audio.playbackRate = pitchRateFor(cents, Math.random)
      } catch {
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
          }
        }
      })
    }
    return audio
  } catch {
    return null
  }
}

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
        }
        if (fade >= 25) {
          clearInterval(timer)
          previewIntervals.delete(timer)
          try {
            audio.pause()
            audio.src = ''
          } catch {
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

export function stopAllSfx(): void {
  for (const timer of [...previewIntervals]) {
    try {
      clearInterval(timer)
    } catch {
    }
  }
  for (const timer of [...previewTimeouts]) {
    try {
      clearTimeout(timer)
    } catch {
    }
  }
  previewIntervals.clear()
  previewTimeouts.clear()
  for (const audio of [...previewing]) {
    try {
      audio.pause()
      audio.src = ''
    } catch {
    }
  }
  previewing.clear()
  for (const [cueId, set] of [...active.entries()]) {
    for (const audio of set) {
      try {
        audio.pause()
        audio.src = ''
      } catch {
      }
    }
    active.delete(cueId)
  }
}

export function sfxAudioUnlocked(): boolean {
  return unlocked
}

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
  }
}

export interface SfxCueStatus {
  id: SfxCueId
  category: SfxCategory
  nameId: string
  source: 'override' | 'builtin' | 'fallback' | 'none'
  builtinCount: number
  playing: number
  loop: boolean
  pitchCents: number
}

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
