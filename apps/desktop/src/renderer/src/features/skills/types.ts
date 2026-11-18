import type { SkillDef, SkillPrereqGap } from '@whale/core'

export type Status = {
  lv: number
  isTraining: boolean
  queued: number
  maxed: boolean
  locked: readonly SkillPrereqGap[]
  cls: string
}

export type SkillBook = { branch: string; defs: SkillDef[] }
