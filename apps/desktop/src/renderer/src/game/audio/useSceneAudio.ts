/**
 * **场景音频挂载点**（2026-11-02 追加批）——App 顶层调用一次：
 *
 * - 每帧把「引擎状态 + 战场是否上屏」解析成场景（`scene.ts`），**只在场景变化时**切 BGM/环境；
 * - 装一次生命周期：页面隐藏/最小化暂停 BGM 与环境音、恢复时继续；偏好变更即时调音量；
 * - 首次用户手势后重试被自动播放策略拒绝的 BGM。
 *
 * 放在 App 的 hook 区（无早退分支之后？必须在所有早退之前——App 里它在 `battleOnStage` 定义之后、
 * 后续 effect 之前，且不依赖任何条件返回值）。
 */
import { useEffect, useRef } from 'react'
import type { GameState } from '@whale/core'
import { resolveSfxScene, sceneFlagsFromState } from './scene'
import type { SfxScene } from './scene'
import { installMusicGestureRetry, pauseMusic, refreshMusicVolume, resumeMusic, setMusicScene } from './music'
import { pauseAmbient, refreshAmbientVolume, resumeAmbient, setAmbientScene } from './ambient'
import { subscribeSfxPrefs } from './prefs'

let lifecycleInstalled = false

function installLifecycle(): void {
  try {
    if (lifecycleInstalled || typeof document === 'undefined') return
    lifecycleInstalled = true
    installMusicGestureRetry()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        pauseMusic()
        pauseAmbient()
      } else {
        resumeMusic()
        resumeAmbient()
      }
    })
    subscribeSfxPrefs(() => {
      refreshMusicVolume()
      refreshAmbientVolume()
    })
  } catch {
    /* 非浏览器环境忽略 */
  }
}

export function useSceneAudio({ state, battleOnStage }: { state: GameState; battleOnStage: boolean }): void {
  const lastSceneRef = useRef<SfxScene | null>(null)
  useEffect(() => {
    installLifecycle()
    const scene = resolveSfxScene(sceneFlagsFromState(state, battleOnStage))
    if (scene === lastSceneRef.current) return
    lastSceneRef.current = scene
    setMusicScene(scene)
    setAmbientScene(scene)
  })
}
