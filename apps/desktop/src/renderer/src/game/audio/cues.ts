/**
 * **音效语义清单（唯一登记处）** —— 2026-11-02 声音系统批次（第一批短音效 + 追加：BGM/环境层/战斗细分/UI）。
 *
 * 口径（船长 2026-11-02 确认）：
 * - 语义 id = 资源文件名 = 代码里的调用键；**新增事件先在这里登记**，再放素材、再接触发点；
 * - 语义 id 一经使用**不复用、不改名**（改名等于让已放好的素材失联）；
 * - 本文件是**纯数据**（不碰 DOM / 浏览器 API），`tools/audio-check.ts` 直接 import 它做确定性检查。
 *
 * 资源约定：
 * - 短音效：`assets/sfx/<id>.mp3`（可放变体 `<id>.1.mp3` 随机取一份）；
 * - BGM / 环境 loop：`assets/bgm/<id>.mp3`、`assets/ambient/<id>.mp3`（同样按 id 匹配，构建时自动收表）；
 * - 缺文件 = 静音；战斗细分音（`combat-fire-*`）缺文件时**回落**到旧 `combat-fire`。
 *
 * `gain` = 单音效增益（再乘"总音量 × 分类音量"）；`minGapMs` = 同一音效两次播放的最短真实毫秒间隔；
 * `maxConcurrent` = 同一音效同时最多几个实例。数值是默认，试听后随时调。
 */
export type SfxCategory = 'alarm' | 'combat' | 'progress' | 'ui' | 'music' | 'ambient'

export interface SfxCueDef {
  /** 分类（决定吃哪一路音量） */
  readonly category: SfxCategory
  /** 单音效增益（0～1.5） */
  readonly gain: number
  /** 同一音效两次播放的最短间隔（真实毫秒） */
  readonly minGapMs: number
  /** 同一音效同时最多几个实例 */
  readonly maxConcurrent: number
  /** 中文名（音效台显示用；id 见 `packages/data/src/l10n/table.ts`） */
  readonly nameId: string
  /** 循环播放（BGM / 环境底噪） */
  readonly loop?: true
  /**
   * 战斗重复音的**音高随机**标记：跟随设置里的「战斗音效音高随机」幅度（默认 ±100 音分 = ±1 半音）。
   * 一次性重音（胜负/沉没/击毁）与 BGM/环境不加，避免仪式感与循环漂移。
   */
  readonly pitchJitter?: true
  /**
   * 固定音高随机幅度（音分）：每次播放随机 ±该值，不跟随设置里的战斗滑条。
   * 目前只用于 UI 点击音（±50 音分，2026-11-05 船长口径）；与 `pitchJitter` 二选一。
   */
  readonly pitchJitterCents?: number
  /** 本音效没素材时回落的语义 id（目前只用于「按弹种拆分的开火音」回落旧 `combat-fire`） */
  readonly fallback?: 'combat-fire'
}

const SFX_CUE_DEFS = {
  // ── 警报 ──
  'invasion-alarm': { category: 'alarm', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.001' },
  'invasion-end': { category: 'alarm', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.002' },

  // ── 战斗（重复音带音高随机；一次性重音不抖）──
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

  // ── 生产 / 进度 ──
  'industry-done': { category: 'progress', gain: 0.7, minGapMs: 300, maxConcurrent: 2, nameId: 'ui.sfx.010' },
  'skill-done': { category: 'progress', gain: 0.8, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.011' },
  'trade-done': { category: 'progress', gain: 0.6, minGapMs: 300, maxConcurrent: 2, nameId: 'ui.sfx.012' },
  'scan-done': { category: 'progress', gain: 0.8, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.013' },
  'build-done': { category: 'progress', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.014' },

  // ── 界面 ──
  'comms-received': { category: 'ui', gain: 0.6, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.015' },
  'ui-click': { category: 'ui', gain: 0.35, minGapMs: 60, maxConcurrent: 2, nameId: 'ui.sfx.096', pitchJitterCents: 50 },
  'ui-error': { category: 'ui', gain: 0.5, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.097' },

  // ── BGM（循环，5 场景；交叉淡入淡出由 `music.ts` 管）──
  'bgm-docked': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.080', loop: true },
  'bgm-space': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.081', loop: true },
  'bgm-battle': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.082', loop: true },
  'bgm-wormhole': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.083', loop: true },
  'bgm-invasion': { category: 'music', gain: 1, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.084', loop: true },

  // ── 环境底噪（循环 3 场景；虫洞/入侵沿用 `ambient-space`）──
  'ambient-docked': { category: 'ambient', gain: 0.7, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.085', loop: true },
  'ambient-space': { category: 'ambient', gain: 0.7, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.086', loop: true },
  'ambient-battle': { category: 'ambient', gain: 0.7, minGapMs: 0, maxConcurrent: 1, nameId: 'ui.sfx.087', loop: true },

  // ── 环境点缀（随机 20–90s 播一声；一次性的短音）──
  'ambient-blip-comms': { category: 'ambient', gain: 0.8, minGapMs: 5000, maxConcurrent: 1, nameId: 'ui.sfx.088' },
  'ambient-blip-metal': { category: 'ambient', gain: 0.8, minGapMs: 5000, maxConcurrent: 1, nameId: 'ui.sfx.089' },
  'ambient-blip-static': { category: 'ambient', gain: 0.8, minGapMs: 5000, maxConcurrent: 1, nameId: 'ui.sfx.090' },
} as const satisfies Record<string, SfxCueDef>

/** 语义 id 联合类型（代码/规则表都从这里取） */
export type SfxCueId = keyof typeof SFX_CUE_DEFS

/** 语义 id → 定义（值类型放宽为 `SfxCueDef`，便于读取可选字段 loop / pitchJitter / fallback） */
export const SFX_CUES: Record<SfxCueId, SfxCueDef> = SFX_CUE_DEFS

/** 全部语义 id（展示顺序：清单声明顺序） */
export const SFX_CUE_IDS = Object.keys(SFX_CUES) as SfxCueId[]

/** 分类展示顺序（设置面板按此顺序出滑条） */
export const SFX_CATEGORIES: readonly SfxCategory[] = ['music', 'ambient', 'alarm', 'combat', 'progress', 'ui'] as const

/** 分类中文名 id */
export const SFX_CATEGORY_NAME_ID: Record<SfxCategory, string> = {
  music: 'ui.sfx.024',
  ambient: 'ui.sfx.025',
  alarm: 'ui.sfx.020',
  combat: 'ui.sfx.021',
  progress: 'ui.sfx.022',
  ui: 'ui.sfx.023',
}

/** 音效台分组（数组顺序 = 展示顺序） */
export type SfxConsoleGroup = 'sfx' | 'music' | 'ambient'

export const SFX_CONSOLE_GROUPS: readonly { key: SfxConsoleGroup; labelId: string }[] = [
  { key: 'sfx', labelId: 'ui.sfx.066' },
  { key: 'music', labelId: 'ui.sfx.024' },
  { key: 'ambient', labelId: 'ui.sfx.025' },
]

/** 某个语义 id 属于音效台哪一组 */
export function sfxConsoleGroupOf(category: SfxCategory): SfxConsoleGroup {
  if (category === 'music') return 'music'
  if (category === 'ambient') return 'ambient'
  return 'sfx'
}
