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
  }
  if (changed) notify()
}

export function reportRealSfxScene(scene: SfxScene): void {
  realScene = scene
  apply()
}

export function forceSfxScene(scene: SfxScene): void {
  forcedScene = scene
  apply()
  notify()
}

export function clearForcedSfxScene(): void {
  if (forcedScene === null) return
  forcedScene = null
  apply()
  notify()
}

export function realSfxScene(): SfxScene {
  return realScene
}

export function forcedSfxScene(): SfxScene | null {
  return forcedScene
}

export function activeSfxScene(): SfxScene | null {
  return appliedScene
}

export function subscribeSfxScene(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
