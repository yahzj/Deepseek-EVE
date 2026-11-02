import type { SkillDef } from '@whale/core'
import { L10N } from '../l10n/table'
import config from '../../../core/src/combat/command/config.json'

/** 指挥成长与引擎使用同一配置；名称说明只引用本地化表。 */
const TEXT_IDS = [
  ['skill.command.001', 'skill.command.002'],
  ['skill.command.003', 'skill.command.004'],
  ['skill.command.005', 'skill.command.006'],
] as const
export const COMMAND_SKILL_DEFS: readonly SkillDef[] = config.skills.map((row, index) => ({
  id: row.id, rank: row.rank, group: '舰船', branch: 'b-command',
  licensePriceIsk: row.licensePriceIsk,
  licenseStandingReq: row.licenseStandingReq,
  name: L10N[TEXT_IDS[index]![0]]!.zh,
  description: L10N[TEXT_IDS[index]![1]]!.zh,
  ...(index > 0 ? { prereq: [config.skills[index - 1]!.id], prereqLevel: { [config.skills[index - 1]!.id]: 3 } } : {}),
}))
