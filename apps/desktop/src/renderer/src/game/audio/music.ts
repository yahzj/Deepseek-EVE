/**
 * **BGM 层**（2026-11-02 追加批）——按场景循环 + **2.5s 交叉淡入淡出**
 * （2026-11-04 船长令：切场景要自动交叉淡变，否则切歌突兀；同曲调音量走 250ms 短淡变）。
 *
 * 场景来源：`scene.ts`（App 的 `useSceneAudio` 每帧把场景推进来，只在场景变化时才切曲）。
 * 素材：`assets/bgm/<id>.mp3`，本机覆盖（音效台导入）优先；**缺素材 = 静音**（不占位、不报错）。
 * 音量：总音量 ×「音乐」分类 × 单曲增益；静音/拖滑条即时生效。
 * 后台：最小化/切标签页由 `index.ts` 的 visibility 生命周期暂停、恢复时从暂停处继续。
 * 网页首次自动播放被拒：由 `installMusicGestureRetry()` 在首次点击/按键后重试当前场景。
 */
import { SFX_CUES } from './cues'
import type { SfxCueId } from './cues'
import { LoopChannel } from './loops'
import { builtinSfxUrls } from './manifest'
import { getSfxOverrideUrl } from './overrides'
import { readSfxPrefs } from './prefs'
import { BGM_CROSSFADE_MS, VOLUME_FADE_MS } from './rules'
import { sceneBgmOf } from './scene'
import type { SfxScene } from './scene'

let channel: LoopChannel | null = null
let currentScene: SfxScene | null = null
let gestureArmed = false

function ensureChannel(): LoopChannel | null {
  try {
    if (typeof Audio === 'undefined') return null
    channel ??= new LoopChannel(BGM_CROSSFADE_MS, VOLUME_FADE_MS)
    return channel
  } catch {
    return null
  }
}

/** 某个语义 id 的有效素材 URL（本机覆盖优先） */
function urlOf(cueId: SfxCueId): string | null {
  const override = getSfxOverrideUrl(cueId)
  if (override !== null) return override
  return builtinSfxUrls(cueId)[0] ?? null
}

function bgmVolumeOf(cueId: SfxCueId): number {
  const prefs = readSfxPrefs()
  if (prefs.muted) return 0
  return Math.min(1, Math.max(0, prefs.master * prefs.categories.music * SFX_CUES[cueId].gain))
}

function apply(): void {
  try {
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
    /* 音频层事故不许影响游戏 */
  }
}

/** 场景变化时调用（只在变化时切；同曲不重启） */
export function setMusicScene(scene: SfxScene | null): void {
  currentScene = scene
  apply()
}

/** 音量/静音变化时调用（不切曲，只调音量） */
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

/** 调试台「重播场景音乐」：销毁通道后按当前场景重新起播（从 0 开始，不是续播） */
export function restartMusic(): void {
  try {
    channel?.destroy()
  } catch {
    /* 忽略 */
  }
  channel = null
  apply()
}

/** 首次用户手势后重试（网页自动播放策略）；只挂一次 */
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
    /* 非浏览器环境忽略 */
  }
}

/** 当前 BGM 语义 id（调试/音效台展示用） */
export function currentBgmCue(): SfxCueId | null {
  return currentScene === null ? null : sceneBgmOf(currentScene)
}
