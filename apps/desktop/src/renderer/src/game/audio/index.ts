import { registerSfxPlayer } from '../sfx'
import type { GameEngine } from '../engine'
import { debugAllowed } from '../debugFlag'
import { attachGameSfx } from './gameBridge'
import { initSfxOverrides, listSfxOverrides, sfxOverrideStorageMode } from './overrides'
import { installSfxUnlock, playCue, previewCue, previewLoopCue, sfxStatusList } from './player'
import { readSfxPrefs } from './prefs'
import { SFX_CUES, SFX_CUE_IDS } from './cues'
import { installUiSfx } from './uiFeedback'
import { currentBgmCue } from './music'
import { currentAmbientCue } from './ambient'
import { activeSfxScene, clearForcedSfxScene, forceSfxScene, forcedSfxScene, realSfxScene } from './sceneSwitch'
import { clearSfxPlayLog, setSfxPlayLogPaused, sfxPlayLog, sfxPlayLogPaused } from './playLog'

let installed = false
let engineAttached = false

export function installAudio(): void {
  if (installed) return
  installed = true
  registerSfxPlayer((kind) => playCue(kind))
  installSfxUnlock()
  installUiSfx()
  void initSfxOverrides()
  exposeDebugApi()
}

export function attachAudioEngine(engine: Pick<GameEngine, 'state' | 'subscribe'>): () => void {
  if (engineAttached) return () => {}
  engineAttached = true
  return attachGameSfx(engine)
}

function exposeDebugApi(): void {
  try {
    if (typeof window === 'undefined' || !debugAllowed()) return
    ;(window as unknown as Record<string, unknown>).__whaleSfx = {
      ids: SFX_CUE_IDS,
      cues: SFX_CUES,
      play: playCue,
      preview: previewCue,
      previewLoop: previewLoopCue,
      status: sfxStatusList,
      prefs: readSfxPrefs,
      overrides: listSfxOverrides,
      overrideMode: sfxOverrideStorageMode,
      currentBgm: currentBgmCue,
      currentAmbient: currentAmbientCue,
      sceneState: () => ({
        real: realSfxScene(),
        forced: forcedSfxScene(),
        active: activeSfxScene(),
        bgm: currentBgmCue(),
        ambient: currentAmbientCue(),
      }),
      forceScene: forceSfxScene,
      clearForcedScene: clearForcedSfxScene,
      playLog: sfxPlayLog,
      clearPlayLog: clearSfxPlayLog,
      logPaused: sfxPlayLogPaused,
      setLogPaused: setSfxPlayLogPaused,
    }
  } catch {
  }
}
