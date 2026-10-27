/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf } from '@whale/core'
import invasionFleetsParameters from '../../static/invasionFleets.json'
import { FOE_R_CORONA_GLINT, FOE_R_CORONA_ECHO, FOE_R_CORONA_DUSK, FOE_R_CORONA_OVERLAY, FOE_R_CORONA_NEXUS } from '../../foe-ships'

/**
 * **R 族 · 1「光环 · 游弋集群」**（外围常驻 · 威胁 90）。
 *
 * 编成 = **粼光级 ×5**（对照 H 族骚扰卡：突击舰 ×4）—— 光环走"多而脆"，故 5 艘。
 * 全卡都是粼光级 ⇒ `dmgMix` 与舰级一致（等离子为主）。
 */
export const WEEKEND_CORONA_DRIFT_CARD: AnomalyDef = {
  id: 'corona-drift',
  foeFamily: 'R',
  name: '光环 · 游弋集群',
  galaxyId: 'galaxy-hub', // 只作日志/展示归属（与 H 族四张卡同款；本卡 hidden、不进星系目录）
  region: 'inv', // 与 H 族同口径：入侵族的残骸走「入侵」类
  wreckTier: 'dire', // 与 H 族同口径：残骸价提到 D 族水平（卡级回收档覆写危档）
  threat: enemyParameterOf(invasionFleetsParameters, "corona-drift", "threat"),
  foeTargeting: 'random',
  // **卡级战术登记**（2026-10-01 加）：与五档舰级的 	actic: 'kite' 对齐 ——
  // 引擎的实际口径是 slot.tactic ?? ship.tactic（本卡不覆写 ⇒ 取舰级），本行只让**卡级登记值**与之一致
  // （attle:calibrate 的「敌方虚拟装配校验」段按卡级字段显示战术，缺省会显示成 orbit）。
  tactic: 'kite',
  dmgMix: { plasma: enemyParameterOf(invasionFleetsParameters, "corona-drift", "dmgMix_plasma"), kinetic: enemyParameterOf(invasionFleetsParameters, "corona-drift", "dmgMix_kinetic") },
  ships: [{ ship: FOE_R_CORONA_GLINT, count: enemyParameterOf(invasionFleetsParameters, "corona-drift", "ships_0_count"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-drift", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-drift", "ships_0_dmgMul") }],
  standingReq: enemyParameterOf(invasionFleetsParameters, "corona-drift", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "corona-drift", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "corona-drift", "rewardIsk"),
  loot: [],
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "corona-drift", "combatSeconds"),
  hidden: true,
  description: '周末入侵：光环的游弋集群（隐藏卡，只由入侵活动生成）。',
}

/**
 * **R 族 · 2「光环 · 分光集群」**（2 波 · 威胁 108）。
 *
 * 第 1 波 = 粼光级 ×3（轻兵先上）· 第 2 波 = 回响级 ×3（驱逐档接战）。
 */
export const WEEKEND_CORONA_SPLIT_CARD: AnomalyDef = {
  id: 'corona-split',
  foeFamily: 'R',
  name: '光环 · 分光集群',
  galaxyId: 'galaxy-hub',
  region: 'inv',
  wreckTier: 'dire',
  threat: enemyParameterOf(invasionFleetsParameters, "corona-split", "threat"),
  foeTargeting: 'random',
  // **卡级战术登记**（2026-10-01 加）：与五档舰级的 	actic: 'kite' 对齐 ——
  // 引擎的实际口径是 slot.tactic ?? ship.tactic（本卡不覆写 ⇒ 取舰级），本行只让**卡级登记值**与之一致
  // （attle:calibrate 的「敌方虚拟装配校验」段按卡级字段显示战术，缺省会显示成 orbit）。
  tactic: 'kite',
  dmgMix: { plasma: enemyParameterOf(invasionFleetsParameters, "corona-split", "dmgMix_plasma"), kinetic: enemyParameterOf(invasionFleetsParameters, "corona-split", "dmgMix_kinetic") },
  waves: [
    { units: enemyParameterOf(invasionFleetsParameters, "corona-split", "waves_0_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-split", "waves_0_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "corona-split", "waves_1_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-split", "waves_1_hpShare") },
  ],
  ships: [
    { ship: FOE_R_CORONA_GLINT, count: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_0_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_0_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_0_dmgMul") },
    { ship: FOE_R_CORONA_ECHO, count: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_1_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_1_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_1_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-split", "ships_1_dmgMul") },
  ],
  standingReq: enemyParameterOf(invasionFleetsParameters, "corona-split", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "corona-split", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "corona-split", "rewardIsk"),
  loot: [],
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "corona-split", "combatSeconds"),
  hidden: true,
  description: '周末入侵：光环的分光集群（隐藏卡，只由入侵活动生成）。',
}

/**
 * **R 族 · 3「光环 · 汇聚集群」**（2 波 · 威胁 129）。
 *
 * 第 1 波 = 回响级 ×3 · 第 2 波 = **垂暮级 ×1 ＋ 叠光级 ×1 ＋ 回响级 ×2**（共 7 艘）。
 * ⚠ **条目顺序 = 本波"敌方期望距离"的取数依据**（`foeDesiredRange` 取 `foes[0]`）⇒
 * **主体（垂暮级，射程 1~6,000）排在第一**，与 H 族主力卡同一条纪律。
 */
export const WEEKEND_CORONA_CONVERGE_CARD: AnomalyDef = {
  id: 'corona-converge',
  foeFamily: 'R',
  name: '光环 · 汇聚集群',
  galaxyId: 'galaxy-hub',
  region: 'inv',
  wreckTier: 'dire',
  threat: enemyParameterOf(invasionFleetsParameters, "corona-converge", "threat"),
  /**
   * **打赢本卡掉 1 件稀有残骸**（与 H 族主力卡同款；船长 2026-09-27 令「主力舰队添加一个稀有残骸掉落」
   * ＋ 追问落点答「进残骸场」）。落点 = 该星系的入侵残骸场，打捞时稀有池优先、本轮必出一件。
   */
  rareWreckDrop: enemyParameterOf(invasionFleetsParameters, "corona-converge", "rareWreckDrop"),
  foeTargeting: 'random',
  // **卡级战术登记**（2026-10-01 加）：与五档舰级的 	actic: 'kite' 对齐 ——
  // 引擎的实际口径是 slot.tactic ?? ship.tactic（本卡不覆写 ⇒ 取舰级），本行只让**卡级登记值**与之一致
  // （attle:calibrate 的「敌方虚拟装配校验」段按卡级字段显示战术，缺省会显示成 orbit）。
  tactic: 'kite',
  dmgMix: { plasma: enemyParameterOf(invasionFleetsParameters, "corona-converge", "dmgMix_plasma"), kinetic: enemyParameterOf(invasionFleetsParameters, "corona-converge", "dmgMix_kinetic") },
  waves: [
    { units: enemyParameterOf(invasionFleetsParameters, "corona-converge", "waves_0_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-converge", "waves_0_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "corona-converge", "waves_1_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-converge", "waves_1_hpShare") },
  ],
  ships: [
    { ship: FOE_R_CORONA_ECHO, count: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_0_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_0_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_0_dmgMul") },
    { ship: FOE_R_CORONA_DUSK, count: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_1_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_1_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_1_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_1_dmgMul") },
    { ship: FOE_R_CORONA_OVERLAY, count: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_2_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_2_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_2_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_2_dmgMul") },
    { ship: FOE_R_CORONA_ECHO, count: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_3_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_3_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_3_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-converge", "ships_3_dmgMul") },
  ],
  standingReq: enemyParameterOf(invasionFleetsParameters, "corona-converge", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "corona-converge", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "corona-converge", "rewardIsk"),
  loot: [],
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "corona-converge", "combatSeconds"),
  hidden: true,
  description: '周末入侵：光环的汇聚集群（隐藏卡，只由入侵活动生成）。',
}

/**
 * **R 族 · 4「光环 · 中枢卫队」**（4 波 · 威胁 170）—— 周末入侵的族旗舰卡。
 *
 * 4 波各 4 / 4 / 3 / 4 艘（共 15 艘，**光环中枢**在最后一波压轴）——本卡**自带波表**
 * （与 H 族旗舰卡同款：`combat.FoeOverride.keepCardWaves`）。
 *
 * ⚠ **BOSS 口径**：与 H 族同款 —— 战斗里的血条 = **池子剩余**（`FoeOverride.bossHp`，
 * 池子 = 固定 150,000），中枢的舰级血 39,200 只作**卡面基准** ⇒ 单场不死名副其实。
 * ⚠ 第 4 波条目顺序 = 中枢在首（主体决定本波期望距离）。
 */
export const WEEKEND_CORONA_NEXUS_CARD: AnomalyDef = {
  id: 'corona-nexus',
  foeFamily: 'R',
  name: '光环 · 中枢卫队',
  galaxyId: 'galaxy-hub',
  region: 'inv',
  wreckTier: 'dire',
  threat: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "threat"),
  foeTargeting: 'random',
  // **卡级战术登记**（2026-10-01 加）：与五档舰级的 	actic: 'kite' 对齐 ——
  // 引擎的实际口径是 slot.tactic ?? ship.tactic（本卡不覆写 ⇒ 取舰级），本行只让**卡级登记值**与之一致
  // （attle:calibrate 的「敌方虚拟装配校验」段按卡级字段显示战术，缺省会显示成 orbit）。
  tactic: 'kite',
  dmgMix: { plasma: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "dmgMix_plasma"), kinetic: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "dmgMix_kinetic") },
  waves: [
    { units: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_0_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_0_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_1_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_1_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_2_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_2_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_3_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "waves_3_hpShare") },
  ],
  ships: [
    { ship: FOE_R_CORONA_GLINT, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_0_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_0_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_0_dmgMul") },
    { ship: FOE_R_CORONA_ECHO, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_1_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_1_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_1_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_1_dmgMul") },
    { ship: FOE_R_CORONA_OVERLAY, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_2_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_2_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_2_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_2_dmgMul") },
    { ship: FOE_R_CORONA_DUSK, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_3_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_3_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_3_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_3_dmgMul") },
    { ship: FOE_R_CORONA_OVERLAY, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_4_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_4_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_4_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_4_dmgMul") },
    { ship: FOE_R_CORONA_NEXUS, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_5_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_5_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_5_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_5_dmgMul") },
    { ship: FOE_R_CORONA_OVERLAY, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_6_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_6_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_6_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_6_dmgMul") },
    { ship: FOE_R_CORONA_DUSK, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_7_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_7_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_7_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_7_dmgMul") },
    { ship: FOE_R_CORONA_ECHO, count: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_8_count"), wave: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_8_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_8_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "ships_8_dmgMul") },
  ],
  standingReq: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "rewardIsk"),
  loot: [], // 奖励由入侵侧发（中枢匣 ＋ 稀有残骸；卡上不给）
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "corona-nexus", "combatSeconds"),
  hidden: true,
  description: '周末入侵：光环的中枢卫队（隐藏卡，只由入侵活动生成）。',
}
