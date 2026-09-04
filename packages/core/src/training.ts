/**
 * 技能训练时长公式（数值核心之一）。
 *
 * 规则（M0，EVE 风格但刻意简化）：
 *   - 训练到某级 = 按等级逐级累加；
 *   - 单级时长 = 基础时长(默认 60 秒) × 技能 rank × 2^(等级-1)；
 *   - 所以低级快、高级慢，rank 越大整条技能线越慢。
 *
 * 例：rank=1 的技能练到 5 级 = 1 + 2 + 4 + 8 + 16 = 31 分钟。
 * 这套公式以后可以整体替换成 EVE 的 SP 制（技能点），只要改这一个文件。
 */

import type { SkillDef } from './types'

/** 默认单级基础时长：60 秒（毫秒） */
export const DEFAULT_TRAIN_BASE_MS = 60_000

/** 每个技能定义允许单独覆盖的字段名 */
export const CUSTOM_BASE_MS_FIELD = 'baseMs' as const

/**
 * 从 (level-1) 级升到 level 级要多久（毫秒）。level 从 1 开始计。
 * 例：skillLevelTimeMs(def, 1) = 训练到 1 级；skillLevelTimeMs(def, 2) = 从 1 级升 2 级。
 */
export function skillLevelTimeMs(def: SkillDef, level: number): number {
  const base = def.baseMs ?? DEFAULT_TRAIN_BASE_MS
  return Math.round(base * def.rank * Math.pow(2, level - 1))
}

/**
 * 从 fromLevel 级训练到 targetLevel 级的总时长（毫秒）。
 * targetLevel <= fromLevel 时返回 0。
 */
export function totalTimeToLevel(def: SkillDef, fromLevel: number, targetLevel: number): number {
  let total = 0
  for (let level = fromLevel + 1; level <= targetLevel; level++) {
    total += skillLevelTimeMs(def, level)
  }
  return total
}

/**
 * 当前游戏进度里，把队列中所有未完成目标加起来一共要多久（毫秒）。
 * 用于界面显示"队列总时长"。
 */
export function totalQueueTimeMs(
  trained: Record<string, number>,
  queue: ReadonlyArray<{ skillId: string; targetLevel: number }>,
  catalog: ReadonlyMap<string, SkillDef>,
): number {
  let total = 0
  for (const item of queue) {
    const def = catalog.get(item.skillId)
    if (!def) continue
    const current = trained[item.skillId] ?? 0
    total += totalTimeToLevel(def, current, item.targetLevel)
  }
  return total
}
