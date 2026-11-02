/**
 * **声音系统安装入口**（2026-11-02；追加批加入 BGM/环境/UI 反馈）——
 * 两个入口（桌面 `main.tsx` / 网页 `web/src/main.tsx`）都只经 `game/boot.ts` 调用本模块。
 *
 * - `installAudio()`：首帧前装播放器（注册进 `game/sfx.ts`）、手势监听、UI 点击音、装载本机覆盖；
 * - `attachAudioEngine(engine)`：引擎启动后挂日志/生产进度桥（只读 state）；
 * - 场景 BGM / 环境音由 App 里的 `useSceneAudio` 每帧推进（场景变化才切曲）。
 *
 * 发布版（公网域名、桌面打包 `file:`）调试门禁关闭 ⇒ `window.__whaleSfx` 不暴露；
 * 但**播放本身对所有玩家生效**（内置素材随包发布）。
 */
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

let installed = false
let engineAttached = false

/** 首帧前调用一次（幂等）：注册播放器 + 手势解锁 + UI 点击音 + 装载本机覆盖 */
export function installAudio(): void {
  if (installed) return
  installed = true
  registerSfxPlayer((kind) => playCue(kind))
  installSfxUnlock()
  installUiSfx()
  void initSfxOverrides()
  exposeDebugApi()
}

/** 引擎启动后调用一次（幂等）：挂日志桥与生产进度桥 */
export function attachAudioEngine(engine: Pick<GameEngine, 'state' | 'subscribe'>): () => void {
  if (engineAttached) return () => {}
  engineAttached = true
  return attachGameSfx(engine)
}

/** 本机调试控制台入口（发布版不暴露；探针/船长试听可用） */
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
    }
  } catch {
    /* 忽略 */
  }
}
