import { SFX_CUES } from './cues'
import type { SfxCueId } from './cues'
import { webAwaitingFirstGesture } from './gestureGate'
import { LoopChannel } from './loops'
import { builtinSfxUrls } from './manifest'
import { getSfxOverrideUrl } from './overrides'
import { readSfxPrefs } from './prefs'
import { BGM_CROSSFADE_MS, VOLUME_FADE_MS, pickOtherVariant, pickVariant } from './rules'
import { sceneBgmOf } from './scene'
import type { SfxScene } from './scene'

let channel: LoopChannel | null = null
let currentScene: SfxScene | null = null
let gestureArmed = false
let chosenCue: SfxCueId | null = null
let chosenUrl: string | null = null

function ensureChannel(): LoopChannel | null {
  try {
    if (typeof Audio === 'undefined') return null
    channel ??= new LoopChannel(BGM_CROSSFADE_MS, VOLUME_FADE_MS)
    return channel
  } catch {
    return null
  }
}

function urlOf(cueId: SfxCueId): string | null {
  const override = getSfxOverrideUrl(cueId)
  if (override !== null) {
    chosenCue = cueId
    chosenUrl = override
    return override
  }
  const urls = builtinSfxUrls(cueId)
  if (chosenCue === cueId && chosenUrl !== null && urls.includes(chosenUrl)) return chosenUrl
  const picked = pickVariant(urls, Math.random)
  chosenCue = cueId
  chosenUrl = picked
  return picked
}

function bgmVolumeOf(cueId: SfxCueId): number {
  const prefs = readSfxPrefs()
  if (prefs.muted) return 0
  return Math.min(1, Math.max(0, prefs.master * prefs.categories.music * SFX_CUES[cueId].gain))
}

function apply(): void {
  try {
    if (webAwaitingFirstGesture()) return
    const ch = ensureChannel()
    if (ch === null) return
    if (currentScene === null) {
      ch.set(null, 0)
      return
    }
    const cueId = sceneBgmOf(currentScene)
    const url = urlOf(cueId)
    if (url === null) {
      ch.set(null, 0)
      return
    }
    ch.set(url, bgmVolumeOf(cueId))
  } catch {
  }
}

export function setMusicScene(scene: SfxScene | null): void {
  currentScene = scene
  apply()
}

export function refreshMusicVolume(): void {
  apply()
}

export function pauseMusic(): void {
  channel?.pause()
}

export function resumeMusic(): void {
  apply()
  channel?.resume()
}

export function restartMusic(): void {
  try {
    channel?.destroy()
  } catch {
  }
  channel = null
  chosenCue = null
  chosenUrl = null
  apply()
}

export function rerollBgmVariant(cueId: SfxCueId): void {
  try {
    if (getSfxOverrideUrl(cueId) !== null) return
    const urls = builtinSfxUrls(cueId)
    const picked = pickOtherVariant(urls, chosenCue === cueId ? chosenUrl : null)
    if (picked === null) return
    chosenCue = cueId
    chosenUrl = picked
    if (currentScene !== null && sceneBgmOf(currentScene) === cueId) apply()
  } catch {
  }
}

export function installMusicGestureRetry(): void {
  if (gestureArmed) return
  gestureArmed = true
  try {
    if (typeof document === 'undefined') return
    const onGesture = (): void => {
      document.removeEventListener('pointerdown', onGesture, true)
      document.removeEventListener('keydown', onGesture, true)
      resumeMusic()
    }
    document.addEventListener('pointerdown', onGesture, true)
    document.addEventListener('keydown', onGesture, true)
  } catch {
  }
}

export function currentBgmCue(): SfxCueId | null {
  return currentScene === null ? null : sceneBgmOf(currentScene)
}
