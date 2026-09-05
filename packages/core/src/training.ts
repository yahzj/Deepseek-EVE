/**
 * 技能训练时长公式（数值核心之一）。
 *
 * 规则（M0，EVE 风格但刻意简化）：
 *   - 训练到某级 = 按等级逐级累加；
 *   - 单级时长 = 档位基础时长 × 技能 rank × 等级系数；
 *   - 等级系数（船长 2026-09-05 定）：Lv1=1 / Lv2=2 / Lv3=4 / Lv4=16 / Lv5=64
 *     ——前三级轻、Lv4 起陡峭，Lv4→Lv5 是最重的一段（合计系数 87）。
 *
 * 档位基础时长（2026-09-05 船长定档；系数改版后总时长相应放大，船长拍板不作红线修正）：
 *   - rank 1/2（新手常用）60 秒档 → 到 Lv5 合计 ≈1.4h / 2.9h；
 *   - rank 3 基础 155 秒 → 到 Lv5 合计 ≈11.2h；
 *   - rank 4（当前最高，含 人工智能专家）基础 696 秒 → 到 Lv5 合计 ≈67.3h（约 2.8 天，
 *     其中 Lv4→Lv5 单级 ≈49.5h——船长知悉并选择该陡度）。
 *
 * 例：rank=1 的技能练到 5 级 = (1+2+4+16+64) × 1 分钟 = 87 分钟。
 * 这套公式以后可以整体替换成 EVE 的 SP 制（技能点），只要改这一个文件。
 */

import type { SkillDef } from './types'
import type { GameState } from './state'

/** 高效学习法（accelerated-learning，P3b）：训练时长 −4%/级（至少保留 60%）——推进/预估/界面显示同源乘算 */
export function trainingTimeFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['accelerated-learning'] ?? 0)
  return Math.max(0.6, 1 - 0.04 * lv)
}

/** 默认单级基础时长：60 秒（毫秒）——rank 1 档（低档快，保持上手节奏） */
export const DEFAULT_TRAIN_BASE_MS = 60_000

/** 各 rank 档的单级基础时长（无 baseMs 覆盖时按档取用；2026-09-05 船长定档） */
const RANK_BASE_MS: Record<number, number> = {
  1: 60_000, // r1 → Lv5 ≈87 分钟
  2: 60_000, // r2 → Lv5 ≈2.9h
  3: 155_000, // r3 → Lv5 ≈11.2h
  4: 696_000, // r4 → Lv5 ≈67.3h（船长拍板，不按 48h 红线修正）
}

/** 等级系数（船长 2026-09-05 定）：[Lv1, Lv2, Lv3, Lv4, Lv5] */
export const LEVEL_TIME_COEF: readonly number[] = [1, 2, 4, 16, 64]

/** 每个技能定义允许单独覆盖的字段名 */
export const CUSTOM_BASE_MS_FIELD = 'baseMs' as const

/**
 * 从 (level-1) 级升到 level 级要多久（毫秒）。level 从 1 开始计。
 * 例：skillLevelTimeMs(def, 1) = 训练到 1 级；skillLevelTimeMs(def, 2) = 从 1 级升 2 级。
 */
export function skillLevelTimeMs(def: SkillDef, level: number): number {
  const base = def.baseMs ?? RANK_BASE_MS[def.rank] ?? DEFAULT_TRAIN_BASE_MS
  const coef = LEVEL_TIME_COEF[level - 1] ?? LEVEL_TIME_COEF[LEVEL_TIME_COEF.length - 1]!
  return Math.round(base * def.rank * coef)
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
