export type SfxCategory = 'alarm' | 'combat' | 'progress' | 'ui' | 'music' | 'ambient'

export interface SfxCueDef {
  readonly category: SfxCategory
  readonly gain: number
  readonly minGapMs: number
  readonly maxConcurrent: number
  readonly nameId: string
  readonly loop?: true
  readonly pitchJitter?: true
  readonly pitchJitterCents?: number
  readonly fallback?: 'combat-fire'
}

const SFX_CUE_DEFS = {
  'invasion-alarm': { category: 'alarm', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.001' },
  'invasion-end': { category: 'alarm', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.002' },

  'combat-fire': { category: 'combat', gain: 0.5, minGapMs: 90, maxConcurrent: 3, nameId: 'ui.sfx.003', pitchJitter: true },
  'combat-fire-kinetic': {
    category: 'combat', gain: 0.5, minGapMs: 90, maxConcurrent: 3, nameId: 'ui.sfx.091', pitchJitter: true, fallback: 'combat-fire',
  },
  'combat-fire-explosive': {
    category: 'combat', gain: 0.5, minGapMs: 90, maxConcurrent: 3, nameId: 'ui.sfx.092', pitchJitter: true, fallback: 'combat-fire',
  },
  'combat-fire-plasma': {
    category: 'combat', gain: 0.5, minGapMs: 90, maxConcurrent: 3, nameId: 'ui.sfx.093', pitchJitter: true, fallback: 'combat-fire',
  },
  'combat-hit': { category: 'combat', gain: 0.45, minGapMs: 80, maxConcurrent: 3, nameId: 'ui.sfx.004', pitchJitter: true },
  'combat-hurt': { category: 'combat', gain: 0.6, minGapMs: 120, maxConcurrent: 2, nameId: 'ui.sfx.005', pitchJitter: true },
  'combat-miss': { category: 'combat', gain: 0.35, minGapMs: 100, maxConcurrent: 2, nameId: 'ui.sfx.094', pitchJitter: true },
  'combat-foe-fire': { category: 'combat', gain: 0.25, minGapMs: 150, maxConcurrent: 2, nameId: 'ui.sfx.095', pitchJitter: true },
  'combat-foe-down': { category: 'combat', gain: 0.8, minGapMs: 200, maxConcurrent: 2, nameId: 'ui.sfx.006', pitchJitter: true },
  'combat-me-down': { category: 'combat', gain: 1, minGapMs: 600, maxConcurrent: 1, nameId: 'ui.sfx.007' },
  'combat-win': { category: 'combat', gain: 1, minGapMs: 1500, maxConcurrent: 1, nameId: 'ui.sfx.008' },
  'combat-lose': { category: 'combat', gain: 1, minGapMs: 1500, maxConcurrent: 1, nameId: 'ui.sfx.009' },

  'industry-done': { category: 'progress', gain: 0.7, minGapMs: 300, maxConcurrent: 2, nameId: 'ui.sfx.010' },
  'skill-done': { category: 'progress', gain: 0.8, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.011' },
  'trade-done': { category: 'progress', gain: 0.6, minGapMs: 300, maxConcurrent: 2, nameId: 'ui.sfx.012' },
  'scan-done': { category: 'progress', gain: 0.8, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.013' },
  'build-done': { category: 'progress', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.014' },

  'comms-received': { category: 'ui', gain: 0.6, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.015' },
  'ui-click': { category: 'ui', gain: 0.35, minGapMs: 60, maxConcurrent: 2, nameId: 'ui.sfx.096', pitchJitterCents: 50 },
  'ui-error': { category: 'ui', gain: 0.5, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.097' },
  'exchange-deposit': { category: 'ui', gain: 0.6, minGapMs: 300, maxConcurrent: 1, nameId: 'ui.sfx.132' },
  'exchange-withdraw': { category: 'ui', gain: 0.6, minGapMs: 300, maxConcurrent: 1, nameId: 'ui.sfx.133' },
  'exchange-deposit-confirm': { category: 'ui', gain: 0.6, minGapMs: 300, maxConcurrent: 1, nameId: 'ui.sfx.137' },
  'exchange-withdraw-confirm': { category: 'ui', gain: 0.6, minGapMs: 300, maxConcurrent: 1, nameId: 'ui.sfx.138' },
  'exchange-bet': { category: 'ui', gain: 0.55, minGapMs: 250, maxConcurrent: 2, nameId: 'ui.sfx.134' },
  'exchange-buy': { category: 'ui', gain: 0.55, minGapMs: 250, maxConcurrent: 2, nameId: 'ui.sfx.135' },
  'exchange-sell': { category: 'ui', gain: 0.55, minGapMs: 250, maxConcurrent: 2, nameId: 'ui.sfx.136' },
  'exchange-allin': { category: 'ui', gain: 0.7, minGapMs: 300, maxConcurrent: 1, nameId: 'ui.sfx.139' },

  'bgm-docked': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.080', loop: true },
  'bgm-space': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.081', loop: true },
  'bgm-battle': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.082', loop: true },
  'bgm-wormhole': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.083', loop: true },
  'bgm-invasion': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.084', loop: true },

  'ambient-docked': { category: 'ambient', gain: 0.7, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.085', loop: true },
  'ambient-space': { category: 'ambient', gain: 0.7, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.086', loop: true },
  'ambient-battle': { category: 'ambient', gain: 0.7, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.087', loop: true },

  'ambient-blip-comms': { category: 'ambient', gain: 0.8, minGapMs: 5000, maxConcurrent: 1, nameId: 'ui.sfx.088' },
  'ambient-blip-metal': { category: 'ambient', gain: 0.8, minGapMs: 5000, maxConcurrent: 1, nameId: 'ui.sfx.089' },
  'ambient-blip-static': { category: 'ambient', gain: 0.8, minGapMs: 5000, maxConcurrent: 1, nameId: 'ui.sfx.090' },
} as const satisfies Record<string, SfxCueDef>

export type SfxCueId = keyof typeof SFX_CUE_DEFS

export const SFX_CUES: Record<SfxCueId, SfxCueDef> = SFX_CUE_DEFS

export const SFX_CUE_IDS = Object.keys(SFX_CUES) as SfxCueId[]

export const SFX_CATEGORIES: readonly SfxCategory[] = ['music', 'ambient', 'alarm', 'combat', 'progress', 'ui'] as const

export const SFX_CATEGORY_NAME_ID: Record<SfxCategory, string> = {
  music: 'ui.sfx.024',
  ambient: 'ui.sfx.025',
  alarm: 'ui.sfx.020',
  combat: 'ui.sfx.021',
  progress: 'ui.sfx.022',
  ui: 'ui.sfx.023',
}

export type SfxConsoleGroup = 'sfx' | 'music' | 'ambient'

export const SFX_CONSOLE_GROUPS: readonly { key: SfxConsoleGroup; labelId: string }[] = [
  { key: 'sfx', labelId: 'ui.sfx.066' },
  { key: 'music', labelId: 'ui.sfx.024' },
  { key: 'ambient', labelId: 'ui.sfx.025' },
]

export function sfxConsoleGroupOf(category: SfxCategory): SfxConsoleGroup {
  if (category === 'music') return 'music'
  if (category === 'ambient') return 'ambient'
  return 'sfx'
}
