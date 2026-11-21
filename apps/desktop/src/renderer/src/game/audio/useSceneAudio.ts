import { useEffect, useRef } from 'react'
import type { GameState } from '@whale/core'
import { resolveSfxScene, sceneFlagsFromState } from './scene'
import type { SfxScene } from './scene'
import { installMusicGestureRetry, pauseMusic, refreshMusicVolume, resumeMusic } from './music'
import { pauseAmbient, refreshAmbientVolume, resumeAmbient } from './ambient'
import { reportRealSfxScene } from './sceneSwitch'
import { subscribeSfxPrefs } from './prefs'
import { setCrtBusy } from '../../ui/crtEffect'

let lifecycleInstalled = false

function installLifecycle(): void {
  try {
    if (lifecycleInstalled || typeof document === 'undefined') return
    lifecycleInstalled = true
    installMusicGestureRetry()
    const onGesture = (): void => {
      document.removeEventListener('pointerdown', onGesture, true)
      document.removeEventListener('keydown', onGesture, true)
      resumeAmbient()
    }
    document.addEventListener('pointerdown', onGesture, true)
    document.addEventListener('keydown', onGesture, true)
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
  }
}

export function useSceneAudio({ state, battleOnStage }: { state: GameState; battleOnStage: boolean }): void {
  const lastSceneRef = useRef<SfxScene | null>(null)
  useEffect(() => {
    installLifecycle()
    const scene = resolveSfxScene(sceneFlagsFromState(state, battleOnStage))
    if (scene === lastSceneRef.current) return
    lastSceneRef.current = scene
    reportRealSfxScene(scene)
  })
  useEffect(() => {
    setCrtBusy('battle', battleOnStage)
    return () => setCrtBusy('battle', false)
  }, [battleOnStage])
}
