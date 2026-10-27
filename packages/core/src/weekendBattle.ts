/** 旧路径兼容出口；实现按职责归战斗域。 */
export { type WeekendBattleKind, type WeekendBattleSpec, WEEKEND_FLAGSHIP_REWARD_MUL, WEEKEND_ASSAULT_REWARD_MUL, weekendAssaultSpecOf, weekendAmbushSpecOf, weekendFlagshipSpecOf, weekendFlagshipEncounterOf, weekendNoteFlagshipPlayerKill, weekendBattleInvolvedOf, type WeekendOutcomeHint } from './invasion/battle/specs'
export { WEEKEND_RECLAIM_WRECK, WEEKEND_RECLAIM_ISK, WEEKEND_ALL_CLEAR_ISK, WEEKEND_FLAGSHIP_WRECK, weekendRareWreckUnits, weekendReclaimAwardOf, weekendAllClearAwardOf, noteReward, WEEKEND_BLACKBOX_ITEM_ID, weekendRareWreckIdFor, weekendGrantRewards } from './invasion/battle/rewards'
export { type WeekendOutcome, type WeekendResolveResult, weekendResolveBattle, type WeekendSettlePlan, weekendSettlePlanOf, type WeekendSettleGrant, weekendResultSnapshotOf, weekendSettleAndGrant } from './invasion/battle/settle'
export { weekendApplyBattleOutcome } from './invasion/battle/outcome'
