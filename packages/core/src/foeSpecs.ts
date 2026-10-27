/** 旧路径兼容出口；实现按职责归战斗域。 */
export { foeStrengthOf, foeThreatOfAnomaly, type FoeSpecOpts, createFoeSpecs, activeFoeSpecsOf, flagshipBattleLedger } from './combat/foes/catalog'
export { FOE_REPAIR_THREAT_REF } from './combat/foes/ships'
export { resolveFoeRevive, foesWithSupport, resolveFoeSummon, resolveReinforcements } from './combat/foes/reinforcements'
export { blinkProcessMs, blinkGapMs, BLINK_VANISH_SHARE_NUM, BLINK_SHARE_DEN, battleOpenM, rFamilyDesireOf, battleMaxDistanceM, mainWeaponOf, nominalWeaponDps, desiredRangeFor, foeDesiredRange } from './combat/foes/tactics'
export { createBattleState, announceStealthStart, announceSupportCallStart, seedUnit, initFoeDronePools, initFoeRepairPulses } from './combat/foes/state'
