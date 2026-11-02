/**
 * **音效语义清单（唯一登记处）** —— 2026-11-02 声音系统批次。
 *
 * 口径（船长 2026-11-02 确认）：
 * - 语义 id = 资源文件名 = 代码里的调用键；**新增事件先在这里登记**，再放素材、再接触发点；
 * - 语义 id 一经使用**不复用、不改名**（改名等于让已放好的素材失联）；
 * - 本文件是**纯数据**（不碰 DOM / 浏览器 API），`tools/audio-check.ts` 直接 import 它做确定性检查。
 *
 * 资源约定：`apps/desktop/src/renderer/src/assets/sfx/<id>.mp3`
 * （同 id 可放多份变体 `<id>.1.mp3`、`<id>.2.mp3`，播放时随机取一份；缺文件 = 静音）。
 *
 * `gain` = 单音效增益（再乘"总音量 × 分类音量"）；`minGapMs` = 同一音效两次播放的最短真实毫秒间隔；
 * `maxConcurrent` = 同一音效同时最多几个实例。数值是首版默认，试听后随时调。
 */
export type SfxCategory = 'alarm' | 'combat' | 'progress' | 'ui'

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
}

export const SFX_CUES = {
  'invasion-alarm': { category: 'alarm', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.001' },
  'invasion-end': { category: 'alarm', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.002' },

  'combat-fire': { category: 'combat', gain: 0.5, minGapMs: 90, maxConcurrent: 3, nameId: 'ui.sfx.003' },
  'combat-hit': { category: 'combat', gain: 0.45, minGapMs: 80, maxConcurrent: 3, nameId: 'ui.sfx.004' },
  'combat-hurt': { category: 'combat', gain: 0.6, minGapMs: 120, maxConcurrent: 2, nameId: 'ui.sfx.005' },
  'combat-foe-down': { category: 'combat', gain: 0.8, minGapMs: 200, maxConcurrent: 2, nameId: 'ui.sfx.006' },
  'combat-me-down': { category: 'combat', gain: 1, minGapMs: 600, maxConcurrent: 1, nameId: 'ui.sfx.007' },
  'combat-win': { category: 'combat', gain: 1, minGapMs: 1500, maxConcurrent: 1, nameId: 'ui.sfx.008' },
  'combat-lose': { category: 'combat', gain: 1, minGapMs: 1500, maxConcurrent: 1, nameId: 'ui.sfx.009' },

  'industry-done': { category: 'progress', gain: 0.7, minGapMs: 300, maxConcurrent: 2, nameId: 'ui.sfx.010' },
  'skill-done': { category: 'progress', gain: 0.8, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.011' },
  'trade-done': { category: 'progress', gain: 0.6, minGapMs: 300, maxConcurrent: 2, nameId: 'ui.sfx.012' },
  'scan-done': { category: 'progress', gain: 0.8, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.013' },
  'build-done': { category: 'progress', gain: 1, minGapMs: 1000, maxConcurrent: 1, nameId: 'ui.sfx.014' },

  'comms-received': { category: 'ui', gain: 0.6, minGapMs: 500, maxConcurrent: 1, nameId: 'ui.sfx.015' },
} as const satisfies Record<string, SfxCueDef>

/** 语义 id 联合类型（代码/规则表都从这里取） */
export type SfxCueId = keyof typeof SFX_CUES

/** 全部语义 id（展示顺序：清单声明顺序） */
export const SFX_CUE_IDS = Object.keys(SFX_CUES) as SfxCueId[]

/** 分类展示顺序 */
export const SFX_CATEGORIES: readonly SfxCategory[] = ['alarm', 'combat', 'progress', 'ui'] as const

/** 分类中文名 id */
export const SFX_CATEGORY_NAME_ID: Record<SfxCategory, string> = {
  alarm: 'ui.sfx.020',
  combat: 'ui.sfx.021',
  progress: 'ui.sfx.022',
  ui: 'ui.sfx.023',
}
