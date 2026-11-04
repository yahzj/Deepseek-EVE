import type { SkillDef } from '@whale/core'
import { SHIP_OPERATION_SKILLS } from './shipOperations'
import { INDUSTRY_SKILLS } from './industry'
import { COMBAT_SKILLS } from './combat'
import { COMMAND_SKILL_DEFS } from './command'
import { ENGINEERING_SKILLS } from './engineering'
import { TRADE_EXPLORATION_LOGISTICS_SKILLS } from './tradeExplorationLogistics'

export const SKILLS: readonly SkillDef[] = [
  ...SHIP_OPERATION_SKILLS,
  ...INDUSTRY_SKILLS,
  ...COMBAT_SKILLS,
  ...COMMAND_SKILL_DEFS,
  ...ENGINEERING_SKILLS,
  ...TRADE_EXPLORATION_LOGISTICS_SKILLS,
]

/** 技能组清单（按此顺序分组展示） */
export const SKILL_GROUPS: readonly string[] = ['舰船', '工业', '矿业', '战斗', '工程', '贸易', '探索', '物流']

/** 把技能表建成引擎用的"按 id 快速查找"目录 */
export function buildSkillCatalog(): ReadonlyMap<string, SkillDef> {
  return new Map(SKILLS.map((s) => [s.id, s]))
}
