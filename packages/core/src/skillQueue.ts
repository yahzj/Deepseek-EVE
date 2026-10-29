/** 旧路径兼容出口；实际实现归技能域。 */
export { HIDDEN_SKILL_IDS, advanceSkillQueue, PREREQ_MIN_LEVEL, prereqNeedLevel, skillLockMissing, skillLockMissingAtQueue, planPrereqChain, skillCancelImpact, enqueueSkill, removeQueueAt, moveQueueItem, queueMovePlan, clearSkillQueue, noteLabOpened } from './skills/queue'
export type { SkillPrereqGap, QueueMovePlan, HeadTrainingInfo, QueueView } from './skills/queue'
