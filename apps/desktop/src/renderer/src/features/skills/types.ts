import type { SkillDef, SkillPrereqGap } from '@whale/core'

export type Status = {
  lv: number
  isTraining: boolean
  queued: number
  maxed: boolean
  /** 前置缺口（**按等级**：每条带 `needLevel`；2026-09-23 起形状由 `SkillDef[]` 改为缺口数组） */
  locked: readonly SkillPrereqGap[]
  cls: string
}

export type SkillBook = { branch: string; defs: SkillDef[] }
