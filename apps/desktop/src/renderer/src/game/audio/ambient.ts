/**
 * **环境音层**（2026-11-02 追加批）——场景底噪循环 + 随机点缀。
 *
 * - 底噪：3 条 loop（停靠 / 太空 / 战斗；虫洞与入侵沿用太空），与 BGM 同款交叉淡变（`LoopChannel`）；
 * - 点缀：每 20–90 秒随机播一声（通讯滴答 / 金属声 / 电流杂音），走环境分类音量与节流；
 * - 缺素材 = 静音；隐藏/最小化由 `useSceneAudio` 的 visibility 生命周期暂停与恢复。
 */
import { SFX_CUES } from './cues'
import type { SfxCueId } from './cues'
import { LoopChannel } from './loops'
import { builtinSfxUrls } from './manifest'
import { getSfxOverrideUrl } from './overrides'
import { readSfxPrefs } from './prefs'
import { playCue } from './player'
import { AMBIENT_CROSSFADE_MS, VOLUME_FADE_MS } from './rules'
import { AMBIENT_BLIP_IDS, sceneAmbientOf } from './scene'
import type { SfxScene } from './scene'

const BLIP_MIN_MS = 20_000
const BLIP_MAX_MS = 90_000
const CHECK_MS = 5_000

let channel: LoopChannel | null = null
let currentScene: SfxScene | null = null
let paused = false
let timer: ReturnType<typeof setInterval> | null = null
let nextBlipAt = 0

function ensureChannel(): LoopChannel | null {
  try {
    if (typeof Audio === 'undefined') return null
    channel ??= new LoopChannel(AMBIENT_CROSSFADE_MS, VOLUME_FADE_MS)
    return channel
  } catch {
    return null
  }
}

function urlOf(cueId: SfxCueId): string | null {
  const override = getSfxOverrideUrl(cueId)
  if (override !== null) return override
  return builtinSfxUrls(cueId)[0] ?? null
}

function ambientVolumeOf(cueId: SfxCueId): number {
  const prefs = readSfxPrefs()
  if (prefs.muted) return 0
  return Math.min(1, Math.max(0, prefs.master * prefs.categories.ambient * SFX_CUES[cueId].gain))
}

function apply(): void {
  try {
    const ch = ensureChannel()
    if (ch === null) return
    if (currentScene === null) {
      ch.set(null, 0)
      return
    }
    const cueId = sceneAmbientOf(currentScene)
    const url = urlOf(cueId)
    if (url === null) {
      ch.set(null, 0)
      return
    }
    ch.set(url, ambientVolumeOf(cueId))
  } catch {
    /* 忽略 */
  }
}

function nextDelayMs(): number {
  return BLIP_MIN_MS + Math.random() * (BLIP_MAX_MS - BLIP_MIN_MS)
}

function tick(): void {
  try {
    if (paused) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (Date.now() < nextBlipAt) return
    const cueId = AMBIENT_BLIP_IDS[Math.floor(Math.random() * AMBIENT_BLIP_IDS.length)] ?? AMBIENT_BLIP_IDS[0]!
    playCue(cueId)
    nextBlipAt = Date.now() + nextDelayMs()
  } catch {
    /* 忽略 */
  }
}

function ensureScheduler(): void {
  if (timer !== null || paused) return
  nextBlipAt = Date.now() + nextDelayMs()
  timer = setInterval(tick, CHECK_MS)
}

function clearScheduler(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

/** 场景变化时切底噪（同曲不重启） */
export function setAmbientScene(scene: SfxScene | null): void {
  currentScene = scene
  apply()
  if (scene === null) {
    paused = true
    clearScheduler()
    return
  }
  paused = false
  ensureScheduler()
}

export function refreshAmbientVolume(): void {
  apply()
}

export function pauseAmbient(): void {
  paused = true
  clearScheduler()
  channel?.pause()
}

export function resumeAmbient(): void {
  paused = false
  apply()
  channel?.resume()
  if (currentScene !== null) ensureScheduler()
}

/** 当前环境底噪语义 id（调试/音效台展示用） */
export function currentAmbientCue(): SfxCueId | null {
  return currentScene === null ? null : sceneAmbientOf(currentScene)
}
