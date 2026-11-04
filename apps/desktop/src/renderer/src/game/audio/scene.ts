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

/* ═══════════ 调试台（音效台「场景预演」）═══════════ */

/** 五个场景（展示顺序 = 音效台账单顺序；优先级另见 `resolveSfxScene`） */
export const SFX_SCENE_ORDER: readonly SfxScene[] = ['docked', 'space', 'battle', 'wormhole', 'invasion'] as const

/** 场景中文名 id（音效台场景预演卡片） */
export const SFX_SCENE_NAME_ID: Record<SfxScene, string> = {
  docked: 'ui.sfx.102',
  space: 'ui.sfx.103',
  battle: 'ui.sfx.104',
  wormhole: 'ui.sfx.105',
  invasion: 'ui.sfx.106',
}

/**
 * 实际生效场景 = 强制预演场景 ?? 真实场景。
 * 音效台「切到此场景的声音」只锁定 BGM/环境底噪，不动存档、画面与引擎状态。
 */
export function effectiveSfxScene(real: SfxScene, forced: SfxScene | null): SfxScene {
  return forced ?? real
}

/**
 * 场景相关事件（音效台场景预演**参考展示**用；不影响真实触发）。
 * 只作"这个场景大概会响哪些声音"的锚定提示，允许与真实触发顺序不同。
 */
export const SCENE_RELATED_CUES: Record<SfxScene, readonly SfxCueId[]> = {
  docked: ['ambient-docked', 'ui-click', 'trade-done', 'industry-done', 'skill-done'],
  space: [
    'bgm-space',
    'ambient-space',
    'scan-done',
    'comms-received',
    'combat-fire',
    'combat-hit',
    'combat-foe-down',
  ],
  battle: [
    'combat-fire',
    'combat-fire-kinetic',
    'combat-fire-explosive',
    'combat-fire-plasma',
    'combat-hit',
    'combat-hurt',
    'combat-miss',
    'combat-foe-fire',
    'combat-foe-down',
    'combat-me-down',
    'combat-win',
    'combat-lose',
  ],
  wormhole: ['bgm-wormhole', 'comms-received', 'scan-done', 'combat-hurt', 'ui-error'],
  invasion: ['invasion-alarm', 'invasion-end', 'combat-foe-fire', 'ambient-blip-comms', 'ui-error'],
}
