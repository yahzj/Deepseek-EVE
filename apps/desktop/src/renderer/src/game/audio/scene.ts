/**
 * **场景解析**（2026-11-02 追加批 · BGM/环境层）——纯函数，不碰 DOM/存储，`audio-check` 可直接跑用例。
 *
 * 五个场景与优先级：**战斗 > 虫洞 > 入侵 > 停靠 > 太空**。
 * - 战斗 = 战场屏上屏（由 App 传入 `battleOnStage`，与"挂载≠上屏"同源）；
 * - 虫洞 = `state.wormhole.run` 进行中；
 * - 入侵 = `state.weekendEvent` 存在且未结束（`endedAtWallMs` 缺省 = 进行中）；
 * - 停靠 = `state.awayGalaxy === null`（core 字段注释：null = 停靠空间站，母港或副站）；
 * - 太空 = 其余（野外作业/航行）。
 *
 * BGM 5 条；环境底噪 3 条（虫洞与入侵沿用 `ambient-space`）；环境点缀 3 条随机播。
 */
import type { SfxCueId } from './cues'

export type SfxScene = 'battle' | 'wormhole' | 'invasion' | 'docked' | 'space'

export interface SceneFlags {
  battleOnStage: boolean
  wormholeActive: boolean
  invasionActive: boolean
  docked: boolean
}

/** 引擎状态的最小结构（刻意不 import core 类型：便于工具单测，也避免与 core 版本耦合） */
export interface SceneStateLike {
  awayGalaxy: string | null
  wormhole?: { run?: unknown | null } | null
  weekendEvent?: { endedAtWallMs?: number } | null
}

export function resolveSfxScene(flags: SceneFlags): SfxScene {
  if (flags.battleOnStage) return 'battle'
  if (flags.wormholeActive) return 'wormhole'
  if (flags.invasionActive) return 'invasion'
  if (flags.docked) return 'docked'
  return 'space'
}

/** 引擎状态 + 战场是否上屏 → 场景标志（App 的 `useSceneAudio` 调它） */
export function sceneFlagsFromState(state: SceneStateLike, battleOnStage: boolean): SceneFlags {
  return {
    battleOnStage,
    wormholeActive: Boolean(state.wormhole?.run),
    invasionActive: Boolean(state.weekendEvent && state.weekendEvent.endedAtWallMs === undefined),
    docked: state.awayGalaxy === null,
  }
}

const SCENE_BGM: Record<SfxScene, SfxCueId> = {
  battle: 'bgm-battle',
  wormhole: 'bgm-wormhole',
  invasion: 'bgm-invasion',
  docked: 'bgm-docked',
  space: 'bgm-space',
}

const SCENE_AMBIENT: Record<SfxScene, SfxCueId> = {
  battle: 'ambient-battle',
  wormhole: 'ambient-space',
  invasion: 'ambient-space',
  docked: 'ambient-docked',
  space: 'ambient-space',
}

export function sceneBgmOf(scene: SfxScene): SfxCueId {
  return SCENE_BGM[scene]
}

export function sceneAmbientOf(scene: SfxScene): SfxCueId {
  return SCENE_AMBIENT[scene]
}

/** 环境点缀（随机一声）：与场景无关，随机三选一 */
export const AMBIENT_BLIP_IDS: readonly SfxCueId[] = [
  'ambient-blip-comms',
  'ambient-blip-metal',
  'ambient-blip-static',
] as const
