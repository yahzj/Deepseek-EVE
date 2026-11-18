import type { SfxCueId } from './cues'

export type SfxScene = 'battle' | 'wormhole' | 'invasion' | 'docked' | 'space'

export interface SceneFlags {
  battleOnStage: boolean
  wormholeActive: boolean
  invasionActive: boolean
  docked: boolean
}

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

export const AMBIENT_BLIP_IDS: readonly SfxCueId[] = [
  'ambient-blip-comms',
  'ambient-blip-metal',
  'ambient-blip-static',
] as const


export const SFX_SCENE_ORDER: readonly SfxScene[] = ['docked', 'space', 'battle', 'wormhole', 'invasion'] as const

export const SFX_SCENE_NAME_ID: Record<SfxScene, string> = {
  docked: 'ui.sfx.102',
  space: 'ui.sfx.103',
  battle: 'ui.sfx.104',
  wormhole: 'ui.sfx.105',
  invasion: 'ui.sfx.106',
}

export function effectiveSfxScene(real: SfxScene, forced: SfxScene | null): SfxScene {
  return forced ?? real
}

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
