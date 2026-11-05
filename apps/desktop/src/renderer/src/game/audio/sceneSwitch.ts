/**
 * **场景音频切换（真实场景 + 调试预演）**（2026-11-04 音效台调试批）
 *
 * App 的 `useSceneAudio` 不再直接切 BGM/环境，而是把**真实场景**报给本模块；
 * 音效台「场景预演」可以强制一个场景——**只切声音，不动存档、画面与引擎状态**：
 * - `forceSfxScene(scene)`：锁定某场景的声音（BGM + 环境底噪）；
 * - `clearForcedSfxScene()`：恢复真实场景。
 *
 * 实际生效场景 = 强制场景 ?? 真实场景（`scene.ts` 的 `effectiveSfxScene`）。
 * 场景没变时不重播（`music/ambient` 的 LoopChannel 同曲也只调音量）。
 * 与 `music.ts` / `ambient.ts` 同一纪律：音频层事故不许影响游戏（这里全部吞异常）。
 */
import { setAmbientScene } from './ambient'
import { setMusicScene } from './music'
import { effectiveSfxScene } from './scene'
import type { SfxScene } from './scene'

let realScene: SfxScene = 'space'
let forcedScene: SfxScene | null = null
let appliedScene: SfxScene | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* 订阅方自己的异常不影响音频层 */
    }
  }
}

function apply(): void {
  let changed = false
  try {
    const scene = effectiveSfxScene(realScene, forcedScene)
    if (scene !== appliedScene) {
      appliedScene = scene
      changed = true
      setMusicScene(scene)
      setAmbientScene(scene)
    }
  } catch {
    /* 音频层事故不许影响游戏 */
  }
  if (changed) notify()
}

/** 引擎推来的真实场景（App 的 `useSceneAudio` 每帧调，只在变化时真正切曲） */
export function reportRealSfxScene(scene: SfxScene): void {
  realScene = scene
  apply()
}

/** 音效台「切到此场景的声音」：只锁定音频，不动存档/画面 */
export function forceSfxScene(scene: SfxScene): void {
  forcedScene = scene
  apply()
  notify()
}

/** 音效台「恢复真实场景」 */
export function clearForcedSfxScene(): void {
  if (forcedScene === null) return
  forcedScene = null
  apply()
  notify()
}

/** 真实场景（引擎状态解析） */
export function realSfxScene(): SfxScene {
  return realScene
}

/** 当前强制预演场景（null = 跟随真实场景） */
export function forcedSfxScene(): SfxScene | null {
  return forcedScene
}

/** 当前实际生效场景（BGM/环境正按它播放；启动前为 null） */
export function activeSfxScene(): SfxScene | null {
  return appliedScene
}

/** 订阅场景切换（音效台状态行刷新用） */
export function subscribeSfxScene(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
