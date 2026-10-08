/**
 * V12 实时战斗引擎（核心逻辑，无 UI 依赖）。
 *
 * 模型（中文说明，详见 docs/design/v12-combat.md）：
 * - 编队对编队：我方 = 玩家主控船 1 单位（炮台或基础舰炮 + 装载的无人机各自展开为武器条目，
 *   无人机不单独成单位、不损毁）；敌方 = 异常点按威胁卡面展开：主体 + 0~2 僚机
 *   （卡面 threat = 编队总战力：主体份额 = T/(1+0.6×escorts)，僚机 = 主体×0.6）；
 * - BattleState 只存动态量（血/装填/距离/弹药/统计）；静态卡由 ship+fleet+anomaly 每次重建；
 * - 确定性事件步进：BATTLE_STEP_MS 基本步长；随机全部走 state.rng（种子可复现）；
 * - 命中：hit = clamp((weapon.hitRate + 攻方命中加成×锁定修正) × 距离衰减 − 守方有效回避)；
 * - 伤害：我方炮台单发 = 弹 dmg × dmgMult ×(1+5%/级炮术)×(1+powerBonus)（构建期折算好
 *   每型弹的单发伤害 shotsByType）；其它武器固定值；按 类型×层克制系数 ×(1−层抗) 逐层消费；
 * - 弹药：我方炮台开火即时消耗 1 发（弹型 = 剩余最多型，平局 kin→exp→pla）；
 *   战斗结束剩余退回仓库（V18 口径取消：单档通用弹，无轻/重之分）。
 */
import type { GameState } from './state'
import { addLog } from './state'
import type {
  AnomalyDef,
  BattleBalance,
  DamageResists,
  DamageType,
  FoeDroneSlot,
  FoeFamily,
  FoeReinforceTrigger,
  FoeSupportBranch,
  FoeTactic,
  FoeTargetingMode,
  ShipRole,
  SimContext,
} from './types'
import { factionAnomalyOf, lairAnomalyOf } from './lairs'
import type { LairTier } from './lairs'
// 洞内敌卡的按层派生（F 批）：**单向依赖** —— wormholeFoes 只吃类型，不反向依赖本模块
import { WORMHOLE_FOE_BASE_STRENGTH_MUL, WORMHOLE_TIER_THREAT_MUL, wormholeAnomalyOf, wormholeTierOfCard } from './wormholeFoes'
import { wormholeCardThreatOf, wormholeSkippedBranch } from './wormholeFoes'
import { wormholeExpeditionCard, wormholeExpeditionModifyCard } from './wormholeExpeditionFoes'
import type { WormholeExpeditionFoeCard } from './wormholeExpeditionFoes'
// F3c 谜质（B1）：战斗增益一律从货仓**现算**（本模块只读，不反向依赖 wormhole.ts ⇒ 无环）
import { wormholeMatterBuffs, wormholeMatterThreatMul } from './wormholeMatter'
import { matterTechBattleSpeedTiers, matterTechWhBuffs } from './matterTech'
import type { WormholeMatterBuffs } from './wormholeMatter'
import { nextInt, nextRandom, pickWeighted } from './rng'
import { volleyGunCountOf, volleyDamageShareOf } from './combatVolley'
export { volleyGunCountOf, volleyDamageShareOf } from './combatVolley'
import { countWare, removeCargoOfShip, removeWare } from './inventory'
import { shipDisplayName } from './instances'
import { uidDefId } from './labels'
import { refillDroneLoadTo, takeDroneUnit } from './equipment'
import { applyFirstBountyBuff, isFirstBountyBattle } from './firstTasks'
// **无人机储备甲板**（2026-09-27 船长令）：战中复位状态机（建档 / 入队 / 每拍推进 / 复活计数）
import { droneRevivedCount, droneRevivedOf, initDroneRevive, initDroneReviveStock, resolveDroneRevive } from './droneRevive'
// 命中与伤害数学（2026-10-02 批次 4a 拆到 combatMath.ts）；本文件借回使用并再导出，既有引用零改动
import { applyDamage, battleClockNowMs, clamp, distFactor, droneHitChance, hitChance, inRange, isAlive, typeLayerMult } from './combatMath'
import { triggerAcidBurst, applyAlienCorrosion, advanceFoeHatcheries, advanceFoeAbilityClocks, foeFleetSpeedMulOf } from './alienCombat'
import type { Hp3 } from './combatMath'
export { applyDamage, battleClockNowMs, battleShowWindowMs, battleSpeedOf, distFactor, droneHitChance, hitChance, inRange, typeLayerMult, waveGapTotalMs } from './combatMath'
export type { Hp3 } from './combatMath'
// 战报与四档判定（2026-10-02 批次 4b 拆到 combatReport.ts）；本文件借回使用并再导出
import { spreadWinChance } from './combatReport'
export { battleVerdictOf, captureBattleReport, spreadWinChance, sunkShipIdsOfBattle } from './combatReport'
export type { BattleVerdict } from './combatReport'
// 战斗演出层（2026-10-02 批次 4c 拆到 combatFx.ts）；本文件借回使用并再导出
import { BATTLE_ARRIVAL_STAGGER_MS, pushBattleFx, pushBattleNotice, WORMHOLE_FOE_VOLLEY_STAGGER_MS } from './combatFx'
import { equipmentCycleMsOf } from './equipment'
import { battleWeaponCyclesOf, type BattleWeaponCycleView } from './battleWeaponView'
import { battleDeviceCyclesOf, type BattleDeviceCycleView } from './battleDeviceView'
export { BATTLE_ARRIVAL_FLY_MS, BATTLE_ARRIVAL_STAGGER_MS, pushBattleFx, stampFoeArrivalFx, WORMHOLE_FOE_VOLLEY_STAGGER_MS } from './combatFx'
// 敌卡档案（2026-10-02 批次 4d 拆到 foeCard.ts）；本文件只再导出
export { FOE_LIGHT_WORD, FOE_ELITE_WORD, FOE_SUPPORT_TAG_RE, baseFoeTag, foeCardShipIdOf, foeClassName, foeMainTagOf, foeShipEliteOf, foeShipIdOfTag, foeShipTierOf, foeUnitNameOf } from './foeCard'
// 敌力曲线（2026-10-02 批次 4e 拆到 foePower.ts）；本文件借回使用并再导出
import { foeHpOfThreat, foeJudgedThreatOf } from './foePower'
export { foeHpOfThreat, foeJudgedThreatOf, foeRefSpeedMps, foeThreatRatingOf } from './foePower'
// 火力构成/血型层（2026-10-02 批次 4f 迁到 wormholeFoes.ts）；本文件借回使用并再导出
import { foeMainDamageType } from './wormholeFoes'
export { foeLayerSplit, foeMainDamageType, splitShotByComposition } from './wormholeFoes'
// 玩家规格（2026-10-02 批次 4g 拆到 playerSpec.ts）；本文件借回使用并再导出
import { AMMO_IDS, createPlayerSpec, DRONE_SKILL, droneSkillLv, WEB_BREAK_DIST_M } from './playerSpec'
export { DRONE_SKILL, MY_WEB_RANGE_M, WEB_BREAK_DIST_M, createPlayerSpec, damageUpgradeMult, droneReloadUpgradeMult, familyUpgradeMult, familyUpgradeSkillIdOf, hitUpgradeMult, mergeResist, playerAmmoType, reloadUpgradeMult } from './playerSpec'
// 维修与护盾脉冲（2026-10-02 批次 4h 拆到 combatRepair.ts）；本文件借回使用并再导出
import { preloadRepairFor, preloadShieldChargeFor, preloadShieldFieldFor, pulseRepairsFor, pulseShieldChargeFor, pulseShieldFieldFor, REPAIR_PULSE_MS, repairLedgersOf, SHIELD_REGEN_FLOOR_PCT, shieldChargeLedgersOf, shieldChargeStreamsOf, shieldFieldStreamsOf } from './combatRepair'
export { REPAIR_PULSE_MS, SHIELD_PULSE_MS, SHIELD_FIELD_COST_PCT, SHIELD_REGEN_FLOOR_PCT, fittedRepairModules, preloadRepairFor, preloadShieldChargeFor, preloadShieldFieldFor, pulseShieldCharge, pulseShieldChargeFor, pulseShieldFieldFor, refundRepairKits, refundRepairKitsAll, repairKitAvailableOf, repairLedgersOf, repairStatsFor, repairStreamsOf, repairUsageText, shieldChargeLedgersOf, shieldChargeStreamsOf, shieldFieldOf, shieldFieldStreamsOf, shieldPulsePctOf } from './combatRepair'
// 战斗弹药装载（2026-10-02 批次 4i 拆到 combatAmmo.ts）；本文件借回使用并再导出
import { ammoKeyOf, ammoLoadTotals, ammoTierFallbackLog, loadAmmoTier, battleAmmoIdsFor, battleAmmoAvailable, consumeBattleAmmo, loadWormholeBattleAmmo, wormholeAmmoIdsForSpec } from './combatAmmo'
import { deployWormholeSupply, returnWormholeDroneSupply, settleWormholeDroneRevives, takeWormholeSupply, wormholeSupplyForBattle } from './wormholeSupplies'
export { ammoKeyOf, ammoLoadTotals, loadAmmo, loadAmmoTier, nextAmmoType, refundAmmo, resolveAmmoTier } from './combatAmmo'
export type { AmmoKey } from './combatAmmo'
// 机群池与近防炮（2026-10-02 批次 4j 拆到 combatDrones.ts）；本文件借回使用并再导出
import { buildDronePoolsFor, dronePoolKey, dronePoolOwner, isFoeEngageable, pickFoeDroneTarget, resolvePointDefense } from './combatDrones'
export { droneLostCount, dronePoolKey, dronePoolOwner, pdPriorityOf, pdShotOf, pickFoeDroneTarget } from './combatDrones'
import { applyFoeRangeDebuff, applyMeJammerDebuff, foeDroneRangeOf, foeGunMaxRangeOf, foeGunPowerFactorOf, markFoeDroneRangeBuff, announceFoeGunRangeBuff, meFoeRangeDebuffOf, meJammerNetOf } from './foeRange'
import { coronaFocusFalloffOf } from './coronaFocus'
export { coronaFocusFalloffOf } from './coronaFocus'
export { FOE_RANGE_DEBUFF_FLOOR_M, applyMeJammerDebuff, fittedEffectParamsOf, foeDroneRangeOf, foeGunMaxRangeOf, foeGunPowerFactorOf, foeGunRangeMulOf, foeJammerCountOf, foeRangeDebuffOf, foeUnitDeadOf, meFoeRangeDebuffOf, meJammerNetOf, meRangeMulForBonus, meRangeMulOf } from './foeRange'
// 敌群建档与增援（2026-10-02 批次 4l 拆到 foeSpecs.ts）；本文件借回使用并再导出
export { FOE_REPAIR_THREAT_REF, activeFoeSpecsOf, battleMaxDistanceM, battleOpenM, createBattleState, createFoeSpecs, desiredRangeFor, flagshipBattleLedger, foeDesiredRange, foeStrengthOf, foeThreatOfAnomaly, mainWeaponOf, rFamilyDesireOf } from './foeSpecs'
export type { FoeSpecOpts } from './foeSpecs'
import { activeFoeSpecsOf, announceStealthStart, announceSupportCallStart, battleMaxDistanceM, battleOpenM, BLINK_SHARE_DEN, BLINK_VANISH_SHARE_NUM, blinkGapMs, blinkProcessMs, createBattleState, createFoeSpecs, desiredRangeFor, foeDesiredRange, foesWithSupport, initFoeDronePools, initFoeRepairPulses, mainWeaponOf, nominalWeaponDps, rFamilyDesireOf, resolveFoeRevive, resolveReinforcements, seedUnit } from './foeSpecs'

/** 战斗基本步长（毫秒） */
export const BATTLE_STEP_MS = 100
/** 步数守卫上限（防失控循环） */
export const BATTLE_MAX_STEPS = 40_000

/** 武器来源（2026-09-10 船长批：无人机战斗动画差异化地基——纯展示字段，不参与任何数值结算） */
export type WeaponSrc = 'turret' | 'missile' | 'laser' | 'drone' | 'base'

/** 静态武器卡 */
export interface WeaponSpec {
  foeDroneRangeBonusPct?: number
  /** 运行规格中的装配型号，仅用于逐件列表，不新增随档字段。 */
  moduleId?: string
  label: string
  /** gun = 我方炮台/导弹架（吃弹药，按 shotsByType 给单发伤害）；beam = 激光炮（必中、
   * 逐发扣能量弹药、威力随距离衰减）；fixed = 固定单发（基础舰炮/无人机/敌方） */
  kind: 'gun' | 'beam' | 'fixed'
  /** 武器来源（展示层用：无人机机群/弹道形制据此区分；缺省 = 旧口径不区分） */
  src?: WeaponSrc
  /** 无人机机型 id（src='drone' 时携带：drone-scout/assault/heavy/sentry —— UI 按机型出机体与弹点） */
  artId?: string
  /** **备用机条目**（2026-09-12 乙 · 备用机库）：`true` = 本条目属于**备用机**（开局在库、战损后补位）。
   *  只作**账目标记**：总火力/守恒类核对一律排除它（备用机是"库存深度"，不是常驻齐射的一份）。
   *  缺省 = 常备机（零行为变化）。 */
  reserve?: boolean
  /** fixed/beam 的固定伤害类型（beam = plasma 能量弹药键） */
  fixedType?: DamageType
  /** fixed/beam 单发伤害 */
  shotDmg?: number
  /** gun：弹型 → 单发伤害（构建期含 dmgMult×(1+炮术×5%)×(1+powerBonus)×伤害稳定器） */
  shotsByType?: Partial<Record<DamageType, number>>
  /**
   * **【我方】叠光同款 · 装填自加速参数**（**船长 2026-10-01 令**）—— 由 R 族势力特色激光炮
   * （`mod-lair-laser-r` 的 `ModuleDef.overlayDrive`）在建档时带来；缺省不写 ⇒ 既有各武器零行为变化。
   */
  overlayDrive?: { stepMs: number; floorMs: number }
  /**
   * **【敌方】连发**（**船长 2026-10-02 令**：「**每次开火是三次间隔100ms的射击，目标选择随机**」）——
   * 由舰级字段 `FoeShipDef.burst` 原样带来（目前只有 R 族 T5「光环中枢」写）。
   *
   * 口径 = **一轮装填**打 `shots` 发、发间隔 `gapMs`：前 `shots − 1` 发之后装填计时**重置为
   * `gapMs`**（不是 `reloadMs`），最后一发之后才回到 `reloadMs` ⇒ 复用既有"一次装填一发"的开火环，
   * 每发都会各自 `pickTarget()`（**逐发独立选靶**）。缺省不写 ⇒ 一门一次、既有武器零行为变化。
   */
  burst?: { shots: number; gapMs: number }
  /** V18 同型合并条目代表的**武器门数**（同 id 同参炮台/激光合并为「×N 齐射」一条，缺省 1）。
   *  **2026-09-11 修复**：一轮齐射按**门数**扣弹（此前只扣 1 发 → 多门武器等于白嫖弹药；
   *  弹药预载同样按门数放大，见 `ammoLoadTotals`）。 */
  count?: number
  /** 敌方主炮门数；不改变shotDmg的武器组总伤语义。 */
  gunCount?: number
  /**
   * **全体攻击**（2026-09-13 船长：C 族「孢子导弹巢」＝「对所有敌方同时攻击」）：
   * `true` = 本武器每轮齐射**逐个结算到全部存活敌舰**（逐目标独立掷命中、各吃各自的层克制与抗性），
   * 演出层按目标数推多条弹道 ⇒「一次罩住全场」。缺省 = 单目标（既有武器零变化）。
   */
  allFoes?: boolean
  /** **附加伤害段**（2026-09-13 虫洞专属·掠袭破片炮）：主段结算之后，按**主段实收** ×该比例
   *  再打一段**固定弹种**的伤害——与主段弹种/所耗弹药无关（船长：「是附加伤害，和弹种无关」） */
  secondaryDamagePct?: number
  /** 附加段弹种（缺省 kinetic） */
  secondaryDamageType?: DamageType
  /** 每次攻击消耗的弹药发数（缺省 1；陵卫连装炮 = 2）——预载与实战扣弹都按「门数 × 本值」 */
  ammoPerShot?: number
  /** V18.1 索敌阵列（命中件）：炮台命中整体乘子（EVE 曲线合成；仅 gun 携带，缺省 1；
   * beam 必中不携带——命中件对激光无效） */
  eqHitMul?: number
  /** V18B 敌方近盲带伤害比例（2026-09-05）：敌在近盲带内（dist < minRange）仍开火，
   * 伤害 × 本值；玩家武器不受影响（近盲带内不开火） */
  blindDmgMul?: number;
  /**
   * **防空**（属性 · 引擎侧标记）——**装备带「防空」属性**（`ModuleDef.antiDrone`）时写入本字段。
   * 只有带本标记的武器能筛到敌方无人机；不带 = 按构造看不到机群
   * （与我方'无人机是子单位、不进主目标池'的既有契约同源）。
   *
   * 口径（设计稿 `docs/design/foe-drone-system-20260911.md` §四/S4）：
   * - 玩家侧 = **真武器**（占槽、可打机群、**也可打舰**——船长 C1「玩家的炮能，敌方的不能。
   *   毕竟玩家的是真的武器」）；玩家侧首件 = **近防炮**；
   * - **我方的无人机不算防空武器**（船长 B1）⇒ 想打机群就得装防空武器；
   * - 敌侧近防炮是**抽象自动系统**（不参与对玩家的常规攻击），**不走本字段**（船长 B3/C1）。
   * ⚠ 缺省 = 打不到敌机 ⇒ **既有武器零行为变化**。
   */
  canHitDrones?: boolean
  /**
   * **防空属性**的第二半：**对无人机伤害倍率**（与 `canHitDrones` 同源，来自 `ModuleDef.antiDrone`）——
   * 船长 2026-09-12：「近防炮给予一个对无人机伤害加成」→「**那伤害倍率按2倍算**」。
   * ⚠ **只对机群生效**——对舰伤害一字不动（`tests/pd-damage-ladder.test.ts` 锁住对舰单发定值 10/16/17）。
   */
  antiDroneMul?: number
  maxRangeM: number
  minRangeM: number
  hitRate: number
  falloff: number
  reloadMs: number
}

/**
 * **激光威力系数**（**2026-09-11 船长定：合并旧修正、不再与命中衰减挂钩**）——
 * 旧口径 = `1 − 进度 ×(1−falloff) ×0.8`（"幅度 = 命中衰减的 0.8 倍"，falloff 0.3 时远端 ×0.44）；
 * 新口径 = **近端 ×1 → 最远端 = 该武器 `falloff`（激光件现统一 0.1）**，线性内插、无任何换算系数：
 *   系数 = 1 − 进度 × (1 − falloff)   （falloff 0.1 → 最远端威力 ×0.10）
 * ⇒ "远端衰减"对能量武器就是**最远端威力倍率本身**，与动能/爆炸的"远端命中倍率"语义对齐、一眼可读。
 *
 * ⚠ **2026-09-12 审计 B1：本函数与 `distFactor` 已合并为同一实现**——两者原本是两份**逐字相同**的代码，
 * 本函数唯一多出的是 `Math.max(0, …)`，而那一层在 **`falloff ∈ [0,1]`** 时**恒不生效**
 * （`t` 已 clamp 到 `[0,1]` ⇒ `1 − t(1−falloff) ≥ 1 − (1−falloff) = falloff ≥ 0`）。
 * 该前提由 `content:check`「**远端衰减取值域契约**」守住（越界即报错）。
 * **保留本名字与语义标签**（**威力**衰减，与动能/爆炸的**命中**衰减并列），实现一律走 `distFactor`。
 */
export function beamPowerFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  return distFactor(dist, w)
}

/**
 * **光束件的"对目标"威力系数**（我方开火路径专用）—— **打机群恒 1**、打舰照旧 {@link beamPowerFactor}。
 *
 * 🔴 **船长 2026-10-02 令**（原话）：「**甲，并且对无人机无衰减**」——起因是一号当天的检查：
 * `mod-lair-pd-r`（PD激光）是全仓**唯一一件"带防空属性的光束件"**（`antiDrone: 2` + `slot: 'laser'`），
 * 而 beam 分支算 `dmg` 时**不看目标类型**、一律乘 `beamPowerFactor(两舰间距)` ⇒ 它打机群也被距离砍
 * （3,000m 外锁 `falloff` = ×0.5），与本仓既有的三条口径**不一致**：
 * · 2026-09-11 甲案「**打机群不看两舰间距**」（**选靶**：出击型不受射程限制、哨戒机才要进射程）；
 * · 2026-09-12「**按丁修复**」（**命中**：`droneHitChance` 的 df 固定为 1）；
 * · 三档**动能**近防炮打机群的单发是**定值**（`dmg = shotDmg`，本就不吃距离）。
 * ⇒ 船长裁「甲」＝承认这条口径，并明确**打机群无衰减** ⇒ 本函数把"打机群那一支"的距离系数钉成 1。
 *
 * **只作用于打机群**：打舰（含我方无人机、僚舰的武器打舰）**一字未动**，仍走 `beamPowerFactor`；
 * 非光束件（动能/爆炸/能量掷命中）本就不走威力衰减、也不经过本函数。
 * ⚠ 抽成函数只为**单一取数口 + 可测**（用例直接断言两支；`beamPowerFactor` 本体与 `v18b2` 那批公式断言不变）。
 */
export function beamPowerVsTargetOf(
  dist: number,
  w: { minRangeM: number; maxRangeM: number; falloff: number },
  vsDrone: boolean,
): number {
  return vsDrone ? 1 : beamPowerFactor(dist, w)
}

/** 静态单位卡（构建后不进存档） */
export interface UnitSpec {
  acidBurst?: import('./types').FoeShipDef['acidBurst']
  foeHatchery?: import('./types').FoeMountDef['hatchery']
  foeFleetSpeedRamp?: import('./types').FoeMountDef['fleetSpeedRamp']
  corrosionAppliedPct?: number
  tag: string
  name: string
  /** **舰种档**（1 护卫舰 … 5 旗舰；2026-09-12 加）：敌方单位 = 编成条目所引舰级的档位；
   *  旧威胁推导路径不写（缺省按 1 处理）。用途 = **敌舰近防炮的档系数**（`balance.pdTierMul`）。 */
  hullClassTier?: number
  /**
   * **敌族**（**2026-09-25 船长令**：H 族近防炮单独特化）：由 `createFoeSpecs` 按舰级写。
   * 用途 = **按族的近防炮覆写**（`balance.pdFamilyOverride`）；缺省（旧路径/合成 spec）= 全局值。
   */
  family?: FoeFamily
  /**
   * **我方单位的舰种档**（虫洞 D 批 · 2026-09-13）：`createPlayerSpec` 恒按 `ShipDef.tier` 写入。
   * 用途 = 敌方选靶模式「**打最小的 / 打最大的**」（见 `pickMyUnitTarget`）。
   * ⚠ 与 `hullClassTier` 同义但**分开**：后者是敌方字段（旧路径缺省按 1），混用会让
   * "旧路径敌舰缺省档 1"污染我方选靶判据。
   */
  shipTier?: number
  /** **我方单位的舰种定位**（虫洞 D 批）：`createPlayerSpec` 恒按 `ShipDef.role` 写入。
   *  用途 = 敌方选靶模式「**打非战斗船**」——`industrial`（工业/采矿）与 `hauler`（货舰）算非战斗，
   *  `armed`（武装）/ `armored`（装甲）算战斗。 */
  shipRole?: ShipRole
  /**
   * **我方舰 id**（`createPlayerSpec` 恒写）——损伤管制装置启动时要"从本舰货仓取组件"
   * （「从母港仓库取用」开着时改走仓库），故需要它。
   */
  shipId?: string
  /**
   * **被选中权重**（**2026-09-26 船长令**）：靶标插件 ×2 / 隐匿插件 ×0.4，由 `createPlayerSpec`
   * 按插件累乘写入（多件相乘，与"不吃递减"一致）。**缺省 / 1 = 与改动前逐位等价**。
   *
   * 语义 = **敌方挑目标时这一条被抽中的相对权重**（船长明确「**增加被选中的权重**」⇒
   * 不改命中率、不改回避，只改选靶）。
   */
  targetWeightMul?: number
  /**
   * **损伤管制装置**（**2026-09-25 船长令**：「当舰船第一次结构低于 1 时，将结构恢复到 1（避免一次死亡）」
   * ＋「触发损管效果时需要消耗一份」＋改判「**1 秒内结构锁定 1**」）。
   *
   * 值 = 启动时消耗的**组件物品 id**（`'repairkit-dc'`）；不写 = 本舰没装该件 ⇒ 免死逻辑整条不生效。
   */
  hullSaveKit?: string
  /**
   * **我方「后勤舰」标记**（船长 2026-09-16：「**后勤舰添加特性，维修装置可以修理血量最少的队友**」）：
   * `createPlayerSpec` 按 `ShipDef.subClass === '后勤舰'` 写入（现在只有「亡军后勤舰」一艘）。
   * 语义 = 本舰的**船体维修装置脉冲改为修队友**（三层剩余比例最低者，含自己）；不写 ⇒ 只修自己（旧口径）。
   */
  logistics?: boolean
  /**
   * **敌方后勤舰：把自身多少比例的名义 DPS 转成修理值**（`FoeShipDef.repairPct` 下发的运行时副本；
   * 见 `types.ts` 该字段的完整口径）。缺省 ⇒ 该敌舰零行为变化。
   */
  repairPct?: number
  side: 'me' | 'foe'
  hp: Hp3
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
  /**
   * **本舰无人机结构层加成**（2026-09-13 船长：G 族「鱿蜂结构层」＝残兵结构层改名 ——
   * 「提高无人机 80% 的结构」）＝ 该舰所装模块 `droneHullHpBonusPct` 之和。
   * 只放大**机群生存池的结构层**（`DronePoolEntry.h`），与三层血 buff 同链、在建池时一次算清。
   */
  droneHullBonusPct?: number
  /**
   * **本舰无人机护盾层加成**（**2026-09-27 船长令**：无人机护盾投射仪）：该舰所装模块
   * `droneShieldHpBonusPct` 之和；只放大**机群生存池的护盾层**（`DronePoolEntry.s`），与三层血同链。
   */
  droneShieldBonusPct?: number
  /**
   * **对方对机群的命中收窄**（**2026-09-29 船长令**：巨构导控塔「对方对无人机的命中收窄 5%」）＝
   * 该舰所装模块 `droneHitGapPct` 之和（只有一件带它时与"取值"等价，与上面两条无人机旋钮同款）。
   *
   * 消费点 = `droneHitChance`：综合闪避 = 机型闪避 × (1 − 本值)，等价于**打机群的命中 ×0.95**。
   * ⚠ 只作用于"打机群"这一支，打舰与敌方近防炮两条链一字不动（见 `ModuleDef.droneHitGapPct`）。
   */
  droneHitGapPct?: number
  evasion: number
  hitBonus: number
  /** V17.1 开火失稳乘子（**点火期值**）：推进器点火期间命中整体 ×hitMul；V18.1 多件推进器只取
   * 最重（削减最大）一件；**2026-09-10 船长：代价只在点火期生效** → 冷却期不用本字段（见 stepBattle 的 meAtk） */
  hitMul?: number
  signatureM: number
  scanResMm: number
  /** 基础战斗机动速度（不含推进器）——推进器改为周期爆发（见 thrusterBoost），
   *  实际机动 = 本值 ×(1 + 爆发期内的 thrusterBoost) */
  speedMps: number
  agility: number
  weapons: WeaponSpec[]
  /** 推进器爆发倍率（2026-09-10 船长定：多件 EVE 曲线收敛后的合成值 − 1，如 MK1 = 0.4）；
   *  **只在爆发窗口内生效**（`thrusterPhase` 判定），冷却期不生效 → 缺省 0 = 无推进器 */
  thrusterBoost?: number
  /**
   * **本单位的推进器点火周期**（2026-09-14 船长新增「微型跃迁引擎」：点火 **10 秒** / 冷却 **60 秒**，
   * 而三档矢量推进器仍是 60/60）——周期自此**逐单位**判定：
   * - 装配里**没有任何覆盖件** ⇒ 这两个字段**不写** ⇒ 走 `balance.battle` 的全局值（**旧读数逐字不变**）；
   * - 有覆盖件 ⇒ 取**点火最短的那件**（同长再取冷却更短的那件），见 `createPlayerSpec`。
   * 判定单点 = `thrusterPhase(battle, bal, unitThrusterCycle(u, bal))`（引擎与界面同源）。
   */
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
  /** 锁定装置（2026-09-09）：被锁定目标受本舰伤害加深等效比例（多件 EVE 曲线收敛）；
   *  >0 同时表示"本场集火模式"——全部武器打存活编队首位（替代每发随机分散） */
  lockedDmgBonus?: number;
  /**
   * **本单位的隐身窗口时长（ms）**（2026-09-15 船长：「隐秘行动装置」——高槽，**自身武器开火前
   * 隐身 20/30 秒**：不被锁定、不被攻击）。
   *
   * `createPlayerSpec` 写入：取所装隐秘装置里**最长**的一件；**装了任何推进器 ⇒ 不写**
   * （船长同日追加的禁令：「有推进器类的时候直接解除隐身」）。
   * 缺省不写 ⇒ 零行为变化（未装装置的船、敌舰、老档）。
   */
  stealthMs?: number;
  /** 敌冲锋（2026-09-10 船长定；资格 2026-09-11 扩为两条来源；**2026-09-14 改逐单位**）：本单位为 true 时，
   *  触发条件命中即**自己**加速（×`foeChargeMul`）、**自身炮台命中我方即解除** + 逐单位冷却。
   *  来源 ① **挂载件**（`FoeMountDef.charge`，2026-09-16 起）／舰级级 opt-in（`FoeShipDef.foeCanCharge`，兼容回退）
   *  ② 老路（威胁 ≥ 门槛 且 brawl）。 */
  foeCanCharge?: boolean;
  /** 本单位的冲锋倍率（**2026-09-14 船长：「大虫子的冲锋倍率改为3，给小虫子添加冲锋，倍率为1.5」**）——
   *  缺省不写 ⇒ 走全局 `BattleBalance.foeChargeMul`（**旧读数逐字不变**）。 */
  foeChargeMul?: number;
  /** **本单位的冲锋冷却覆写**（2026-09-16 船长：A 族海盗「冲锋倍率为1.6，**冷却30秒**」）——
   *  缺省不写 ⇒ 走全局 `BattleBalance.foeChargeCooldownMs`（10 秒）。 */
  foeChargeCooldownMs?: number;
  /**
   * **本单位的「闪现跃迁」参数**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）——
   * 由 R 族那件「瞬光跃迁仪」（`FoeMountDef.blink`）解析而来。
   *
   * 消费点 = **本体被命中的那一处**（与 `foeDroneRangeMulOnHit` / `foeGunRangeMulOnHit` 同一个钩子）：
   * 拉开 `BattleState.distanceM` 并盖冷却（冷却态记在 `BattleState.foeBlinks[tag]`，`kind: 'runtime'`）。
   * 缺省不写 ⇒ 既有各族各件零行为变化。
   */
  foeBlink?: { distanceM: number; cooldownMs: number };
  /**
   * **本单位的「叠光装置」参数**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者
   * 闪现后，攻击间隔缩短，最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。**」）——
   * 由 R 族 T3 叠光级那件「叠光装置」（`FoeMountDef.overlayDrive`）解析而来。
   *
   * 消费点两处：① **开火**处（用当前间隔重置装填计时、随后递减）；② **闪现**处（闪现一次也递减）。
   * 当前间隔记在 `BattleState.foeOverlayReload[tag]`（`kind: 'runtime'`）。缺省不写 ⇒ 零行为变化。
   */
  foeOverlayDrive?: { stepMs: number; floorMs: number; dmgMul: number };
  /**
   * **本单位的「闪烁过载装置」参数**（**船长 2026-10-01 令**：「**粼光添加闪烁过载装置，效果是每次
   * 触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。**」）——
   * 由 R 族 T1 粼光级那件「闪烁过载装置」（`FoeMountDef.flashOverload`）解析而来。
   *
   * 消费单点 = 闪现**成功**那一刻（`settleFoeBlinkExtras`）：护盾直接回满、结构 −结构上限的 `hullCostPct`
   * （**无保底 ⇒ 可扣死自毁**，船长选「乙」）。缺省不写 ⇒ 零行为变化。
   */
  foeFlashOverload?: { healShield: true; hullCostPct: number };
  /**
   * **本单位的「待机护盾阵列」参数**（**船长 2026-10-02 令**：「**闪现未处于冷却中的时候，
   * 护盾拥有全伤害50%的抗性。**」）—— 由 R 族 T4 垂暮级那件「待机护盾阵列」
   * （`FoeMountDef.standbyShield`）解析而来。
   *
   * 消费单点 = `applyFoeUnitDamage`（打敌舰本体的唯一收口）：闪现**不在冷却中**
   * （`now >= b.foeBlinks[tag]`，从未闪过也算可用）⇒ 把 `resistPct` 并进**护盾层**抗性
   * （与既有层抗**乘算**：`1 − (1−a)(1−b)`；装甲/结构不并）。缺省不写 ⇒ 零行为变化。
   */
  foeStandbyShield?: { resistPct: number; lingerMs?: number };
  /**
   * **本单位的「聚焦阵列」参数**（**船长 2026-10-02 令**：「**武器的远端衰减，随时间提高到1
   * （就是无衰减）。**」＋改判「**旗舰挂载件的会随波重置**」）—— 由 R 族 T5 光环中枢那件
   * 「聚焦阵列」（`FoeMountDef.focusArray`）解析而来。
   *
   * 消费单点 = 敌方开火段（本单位的**当拍**远端衰减系数按本波起点现算，见 `coronaFocusFalloffOf`）；
   * **只影响它自己**的武器。缺省不写 ⇒ 零行为变化。
   */
  foeFocusArray?: { rampMs: number; rangeBonusPct?: number; antiDroneBonusPct?: number };
  /**
   * **本条冲锋不吃网子的「关推进器」**（**2026-09-30 船长令**「给C族添加族设定，他们的冲锋不会被网子
   * 解除」；见 `FoeMountDef.charge.webImmune`）——C 族四件「虫群冲锋器」解析出来的旗标。
   *
   * 消费单点 = `applyFoeWebDebuff`：本旗标为 true 时**不清零** `thrusterBoost`
   * （我方「墨潮捕获网」三层的"推进器全关"对本族不生效；**减速与闪避归零照旧**）。
   * 缺省不写 ⇒ 旧口径（能被网关推进器）。
   */
  foeChargeWebImmune?: true;
  /**
   * **截击舰特性 · 不会被网子选为目标**（**2026-09-30 船长令**「给拦截舰添加效果，不会被网子选为目标」；
   * 数据开关 = `ShipDef.interceptorImmuneToWeb`）。
   *
   * 消费单点 = `fireFoeCaptureWeb` 的入口守卫（敌方「劫掠捕获网」在首次开火选靶时跳过本船）。
   * ⚠ 只豁免那四层减益，**普通炮火照旧会打**。缺省不写 ⇒ 旧口径（会被网钉住）。
   */
  interceptorImmuneToWeb?: boolean;
  /**
   * **【我方】闪现跃迁参数**（**船长 2026-10-01 令**：「闪现装置为中槽，和R族同款，挨打触发闪现。
   * 但是冷却时间延长到12秒。」）—— 由 R 族势力特色中槽件 `mod-lair-blink-r` 带来。
   * 消费点 = 敌方舰炮命中我方那两处（光束 / 实弹）；冷却态记在 `BattleState.meBlinks`。
   * 缺省不写 ⇒ 既有各装配零行为变化。
   */
  meBlink?: { distanceM: number; cooldownMs: number }
  /** **本单位的挂载件展示名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——建档时由 `mounts` 解析，
   *  视图与战报直接渲染；**不是 id**、也不参与任何判定。 */
  foeMountNames?: readonly string[]
  /**
   * **同序的「双语名对」**（2026-09-24 加；与 `foeMountNames` 逐项对齐）——
   * 显示层按当前语言挑一列（`BattleScreen.mountNamesTextOf`）；缺省 ⇒ 回退中文名数组。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /** **单波次内增援**（2026-09-11 船长裁决：机制实现、不启用）——本单位的入场触发条件；
   *  **建档时已按总开关过滤**：开关关闭时本字段一律不写（= 开战即在）。
   *  带本字段的单位**不进开战编队**，由 `advanceBattleFor` 每拍检查、条件命中才补入。 */
  foeReinforceAt?: FoeReinforceTrigger
  /**
   * **支援呼叫分支**（2026-09-19 船长「支援呼叫装置」批）——本条目属于哪一支援军
   * （`'inside'` = 判定时玩家在呼叫者射程内 / `'outside'` = 在射程外）。
   *
   * ⚠ **建档时一律带上**（不受总开关影响）：洞内派生要用它排除"不到场的那一支"
   * （见 `wormholeSkippedBranch`）——它只是标签，**入场与否仍由 `foeReinforceAt` 决定**。
   */
  foeReinforceBranch?: FoeSupportBranch
  /**
   * **支援呼叫装置参数**（2026-09-19 船长：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远
   * 射程之外时，增援2艘静滞卫舰。**」）——挂件在**呼叫者**自己身上：它决定"何时判定 + 判定基准射程"，
   * 两支的到场单位由卡的条目声明（`enterAt` ＋ `foeReinforceBranch`）。
   * **建档时按总开关过滤**（关 = 不写 = 本机制完全不参与，零行为变化）。
   */
  foeSupportCall?: { delaySec: number; threatMul: number }
  /** **本单位自己的有效射程带**（m）——**只有舰级路径会写**（`createFoeSpecsFromShips`；
   *  含条目 `rangeMul`/`rangeMinM`/`rangeMaxM` 覆写后的绝对值）。
   *  用途：`foeDesiredRange` 在**舰级路径**上以"自己的带"取代旧路径的全局战术表，
   *  让期望交距落在自己打得到的距离（2026-09-11 船长裁决②）。
   *  **旧威胁推导路径一律不写本字段** ⇒ 旧口径行为一字不动。 */
  foeRangeBand?: { min: number; max: number };
  /** **期望作战距离覆写**（米；见 `FoeShipDef.desireRangeM`）——写了的单位直接用这个值 */
  foeDesireRangeM?: number;
  /** **本单位的舰载机群**（2026-09-11 机群批）——只有舰级路径写入（`FoeShipDef.drones` 原样带到单位上）。
   *  用途：①建档时把机群展开成 `src:'drone'` 的武器条目（每架一条）；②开战与每次换波按机型
   *  `defense` 建生存池（`BattleState.foeDronePools`，按 tag 索引、与本单位 drone 条目**同序**）。
   *  **不写 = 无机群** ⇒ 既有单位一字不动。 */
  foeDrones?: readonly FoeDroneSlot[]
  /** **受击增程倍率**（见 `FoeShipDef.droneRangeMulOnHit`；2026-09-11 船长：「受到攻击后，大幅提高
   *  无人机射程（提高 400%）」）——舰级路径把该字段带到单位上；**任一此类敌舰被命中一次**即在
   *  `BattleState.foeDroneRangeBuff`（**标量**）上给**整支敌队**盖章，此后**所有敌舰**的机群射程
   *  ×本倍率（本场永久）；提示只推一条（船长二次裁定：「只触发一次，**对所有敌舰生效**」）。 */
  foeDroneRangeMulOnHit?: number
  /** **受击增程（炮台）倍率**（见 `FoeShipDef.gunRangeMulOnHit`；2026-09-12 船长：D 族静滞卫舰
   *  「挨打后射程增加 50%」，**只影响所有静滞卫舰**）——与机群那条**同款触发、不同作用面**：
   *  任一此类敌舰被命中 ⇒ `BattleState.foeGunRangeBuff` 盖章；读射程时**只对本字段存在的单位**生效。 */
  foeGunRangeMulOnHit?: number
  /** 实际挂载件的触发提示编号，仅用于显示，不入档。 */
  foeGunRangeNoticeId?: string
  /**
   * **劫掠捕获网**（船长 2026-09-16，A 族新舰「劫掠电子舰」专属；参数见 `FoeMountDef.web`）：
   * 本舰**第一次开火那一刻**（不看命中）钉住**它这一发的目标**；**击杀发动者**（2026-09-16）
   * 或**交战距离超过 4500 米**（**2026-09-26**「这个断开对敌我都有效」）即解除，整场只张一次。
   * 被钉的我方舰：战斗机动 ×`slowMul`（0.1）· 推进器全关 · 闪避归零 · 武器射程 −`rangeDownM`。
   */
  foeCaptureWeb?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  /**
   * **我方「墨潮捕获网」**（**船长 2026-09-26**，H 族势力装备之一；模块字段见 `ModuleDef.captureWebCycleMs`）：
   * 带本字段的我方舰 = 一台**周期装置**——钉一艘**未被钉住**的敌舰（**独立瞄准 · 不看命中**）；
   * ⚠ **不是"开战即钉"**：只有交战距离 ≤ `MY_WEB_RANGE_M`（3800 米）时才张网（船长 2026-09-26 令
   * 「我方网子的射程是3800米」）。
   * **一次使用进入冷却**的两种情形：目标被击沉、**与目标距离超过 4500 米断开**（`WEB_BREAK_DIST_M`，
   * 船长同日追答「断开也当使用一次」）——冷却结束再选新目标；**携带者被击沉** ⇒ 该网解除。
   * 效果三层：机动 ×0.5（**减速 50%**，船长 2026-09-26 改判；原 ×0.1）· 推进器全关 · 闪避归零（⚠ **不含射程**，船长同日明令移除）。
   * 周期账本 = `BattleState.myWebs`，被钉状态 = `BattleState.foeWebDebuffs`（见 `advanceMyCaptureWebs`）。
   *
   * ⚠ **三项读数随件上字段走**（**2026-09-29 船长令**：关键属性要"进属性里"）：
   * `rangeM`（投网射程）/ `breakM`（断开距离）/ `slowMul`（减速倍率）由 `ModuleDef.captureWeb*` 供给，
   * 缺省回落到 `MY_WEB_RANGE_M` / `WEB_BREAK_DIST_M` / 0.5 ⇒ 老档与既有件零行为变化。
   */
  myCaptureWeb?: { cycleMs: number; rangeM: number; breakM: number; slowMul: number }
  /** **单次出击上限**（见 `FoeShipDef.droneLaunch`；2026-09-12 船长「限制敌机单次出击数量」） */
  foeDroneLaunch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean }
  /** **备用机库**（见 `FoeShipDef.droneReserve`；2026-09-12 船长「损坏后补充敌机」） */
  foeDroneReserve?: { count: number; respawnMs: number }
  /**
   * **敌方「射程压制」**（H 族墨潮干扰舰 · 2026-09-24 船长；见 `FoeShipDef.foeRangeDebuffPct`）：
   * 本舰压制**我方武器**的最远射程，多艘乘法合成、与我方电子舰的削减**做加法抵消**。
   * 缺省不写 ⇒ 不压制（既有全部敌舰零行为变化）。
   */
  foeRangeDebuffPct?: number
  /**
   * **姿态陀螺仪的闪避加数**（船长 2026-09-24；见 `FoeMountDef.evasionBonus`）——建档时**已经加进**
   * `evasion` 并夹到 0.9 上限；本字段只是把"这件件给了多少"留在单位上（战报/读数/用例用）。
   * 缺省不写 ⇒ 零行为变化。
   */
  foeEvasionBonusAdd?: number
  /**
   * **船体修理装置的逐单位脉冲参数**（船长 2026-09-24；见 `FoeMountDef.repairPulse`）——
   * `k` = **本层本次实际威胁 ÷ 45**（建档时按本场是哪张卡/哪一层/什么用途现算），
   * 每 `everyMs` 给**它自己**回 `round(armor × k)` 装甲与 `round(hull × k)` 结构（各层夹满值）。
   * 缺省不写 ⇒ 该单位没有这个机制（零行为变化）。
   */
  foeRepairPulse?: { everyMs: number; armor: number; hull: number; k: number }
  foePointDefenseEnabled?: boolean
  /**
   * **支援舰船召唤装置的节拍**（船长 2026-09-25；见 `FoeMountDef.reviveEscort`）——
   * 挂件单位（入侵母舰）每 `everyMs`（60 秒）把**当前波已阵亡**的敌舰满血复活入场
   * （新 tag `sup{n}-<原tag>`；上限 = 不超本波原编成）。缺省不写 ⇒ 该单位不会召唤（零行为变化）。
   *
   * ⚠ **2026-09-26 船长改判**：「入侵活动中，H族入侵母舰的挂载件复活效果，**改为每60秒复活2艘船**。
   * 且**必定会复活干扰舰**」⇒ `count`（每次艘数）与 `priorityShipIds`（优先名单）随挂载件带到单位上；
   * **同日追答**「**应该是优先复活干扰舰**」⇒ 名单是**优先**语义：名单内的舰在可补池里就先占一个名额
   * （它活着 / 已补进场则名额回落到随机）。
   */
  foeReviveEscort?: import('./types').FoeMountDef['reviveEscort']
  foeTactic: FoeTactic | null
  /**
   * **舰级 id**（2026-09-24 加；只给"舰级路径"建的敌单位写）：旗舰 BOSS 的伤害台账靠它认出母舰
   * （战斗态里此前没有"我是哪条舰级"的标记）。缺省 = 旧路径 ⇒ 零行为变化。
   */
  foeShipId?: string
}

/**
 * **待机护盾阵列：本拍是否生效**（**船长 2026-10-02 令**：「**闪现未处于冷却中的时候，护盾拥有
 * 全伤害50%的抗性。**」）—— 判据 = 带该件，且闪现不在冷却中或仍在触发后的宽限内
 * （`now >= BattleState.foeBlinks[tag]`；**从未闪过也算可用** ⇒ **开场即生效**，船长原话的读法）。
 *
 * 闪现触发后仍保留 `lingerMs` 的抗性宽限；用冷却截止戳减去件的冷却时长还原触发时刻。
 * ⚠ 与闪现**共用那条冷却**是机制的一部分（宽限之外没有这层抗性；**冷却 = 件的 `blink.cooldownMs`，
 * 2026-10-03 起 12 秒**），不是缺陷。
 * ⚠ **本函数只是那条纯判据**（"这一瞬是否就绪"）：**引擎里请走 `foeStandbyReadyOf`**
 * （它按**每拍开头**取快照 ⇒ 同一拍整次齐射同命，船长 2026-10-03 裁定）。
 * 缺省（没带件）⇒ 恒 `false`；没带件的单位**一次都不会走到下面的并抗性**。
 */
export function standbyShieldActiveOf(
  unit: Pick<UnitSpec, 'foeStandbyShield' | 'foeBlink'>,
  blinkReadyAtMs: number | undefined,
  nowMs: number,
): boolean {
  if (unit.foeStandbyShield === undefined) return false
  if (blinkReadyAtMs === undefined || nowMs >= blinkReadyAtMs) return true
  const cooldown = unit.foeBlink?.cooldownMs
  const linger = unit.foeStandbyShield.lingerMs ?? 0
  if (cooldown === undefined || linger <= 0) return false
  const triggeredAt = blinkReadyAtMs - cooldown
  return nowMs >= triggeredAt && nowMs < triggeredAt + linger
}

/**
 * **把「待机护盾阵列」的抗性并进层抗**——**只并护盾层**（装甲/结构两列原样返回，船长口径）。
 * 并入方式 = **乘算**：`1 − (1 − 既有) × (1 − 新增)`（与 `applyDamage` 那把"抗性夹 −0.9~0.9"的尺同域；
 * 既有为负（易伤）时同样成立）。R 族本身不带层抗 ⇒ 实况就是护盾层 50%。
 */
export function withStandbyShield(
  resists: UnitSpec['resists'],
  resistPct: number,
): UnitSpec['resists'] {
  const merge = (t: DamageType): number => 1 - (1 - (resists.shield?.[t] ?? 0)) * (1 - resistPct)
  return {
    ...resists,
    shield: { kinetic: merge('kinetic'), explosive: merge('explosive'), plasma: merge('plasma') },
  }
}

/**
 * **本拍该舰的「待机护盾阵列」是否就绪**（**船长 2026-10-03 裁定**：「**同一拍整次齐射都算**」）——
 * 判据 = **本拍开头那一瞬**闪现是否在冷却中（`standbyShieldActiveOf` 是那条纯判据），
 * **同一拍之内恒定不变**。
 *
 * 为什么必须按拍定死：闪现是**挨打触发**的（同一发里"伤害结算在前、盖冷却在后"）——
 * 若现查冷却表，同一拍里只有**触发那一发**吃得到抗性，随后同拍的其余发全被刚盖上的冷却挡掉
 * （2026-10-03 实测：出荷配置下这层抗性只挡下约 7%，几乎等于没挂）。船长第一句原话是
 * 「**触发的那次齐射**受到的伤害减半」⇒ 本拍整次齐射同命。
 *
 * 取数次序：① 本拍开头由 `stepBattle` 盖好的快照（`BattleState.foeStandbyTick`）；
 * ② 没有本拍快照（拍外调用 / 增援新 tag）⇒ **现算并补一份本拍快照** ⇒ 语义恒为"本拍开头"。
 * 没带该件的单位**一次都不写这张表**（`foeStandbyShield` 缺省 ⇒ 直接 `false`，零行为变化）。
 */
export function foeStandbyReadyOf(
  b: {
    lastTickGameMs?: number
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foe: Pick<UnitSpec, 'tag' | 'foeStandbyShield' | 'foeBlink'>,
): boolean {
  if (foe.foeStandbyShield === undefined) return false
  const now = b.lastTickGameMs ?? 0
  const reg = b.foeStandbyTick ?? (b.foeStandbyTick = {})
  const hit = reg[foe.tag]
  if (hit !== undefined && hit.atMs === now) return hit.ready
  const ready = standbyShieldActiveOf(foe, b.foeBlinks?.[foe.tag], now)
  reg[foe.tag] = { atMs: now, ready }
  return ready
}

/**
 * **本拍打这一艘敌舰要用的层抗**（单点）——带「待机护盾阵列」且**本拍就绪**（见 `foeStandbyReadyOf`）时，
 * 把 50% 并进**护盾层**；否则**原样返回 `foe.resists` 那个引用**（零分配、零行为变化）。
 * 只被 `applyFoeUnitDamage`（唯一收口）与 `carryVolleyOverflow`（溢火结转的"打空它要多少"）调用。
 */
function foeResistsNow(
  b: {
    lastTickGameMs?: number
    foeBlinks?: Record<string, number>
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foe: {
    tag: string
    resists?: UnitSpec['resists']
    foeStandbyShield?: UnitSpec['foeStandbyShield']
    foeBlink?: UnitSpec['foeBlink']
  },
): UnitSpec['resists'] {
  if (foe.foeStandbyShield === undefined) return foe.resists ?? {}
  return foeStandbyReadyOf(b, foe)
    ? withStandbyShield(foe.resists ?? {}, foe.foeStandbyShield.resistPct)
    : (foe.resists ?? {})
}

/**
 * **每拍开头：把敌阵里挂了「待机护盾阵列」的单位的就绪态定死**（船长 2026-10-03「同一拍整次齐射都算」）。
 * 放在 `stepBattle` 最前面（任何伤害结算之前）⇒ 本拍之内无论谁开火、闪没闪，读到的都是**同一份答案**。
 * 只扫"带该件"的单位（R 族那几档才有）⇒ 其余场次一次判断都不多做。
 */
function snapshotFoeStandby(b: import('./state').BattleState, foes: readonly UnitSpec[]): void {
  const now = b.lastTickGameMs
  const reg = b.foeStandbyTick ?? (b.foeStandbyTick = {})
  for (const f of foes) {
    if (f.foeStandbyShield === undefined) continue
    reg[f.tag] = { atMs: now, ready: standbyShieldActiveOf(f, b.foeBlinks?.[f.tag], now) }
  }
}

/**
 * **打敌舰本体的唯一收口**（**2026-09-27 船长令**：「**不能使用触发制吗？因为肯定已经有一个用于判断舰船
 * 是否死亡的点了，假设给死亡加个触发挂载点，这样之后有什么死亡效果也能添加。**」）。
 *
 * 原先玩家打敌舰的四条伤害结算（主段 / 附加段 / 全体攻击两段）＋ 齐射协调仪的溢火链**各自**
 * `applyDamage(...)` 再各自写回三层血，**没有"死亡那一刻"**——全仓的生死判据是 `isAlive` 这个纯读取，
 * 每次要用就把三层血重算一遍（无人机的"击落"反倒是有事件点的：`pool.alive = false`）。
 *
 * 本函数把四＋一处收成一个口子，只做两件事、**不改算术**：
 * 1. 照旧 `applyDamage` 并写回三层血（层抗、层克制、随机数消费顺序一字不动）；
 * 2. **算完做观测**——这一发把它的三层血打空 ⇒ 在该单位上落 `downAtMs`（死亡时刻）；
 *    若它正是本场 BOSS（`foeOverride.bossShipId`）⇒ 顺带在本场落 `BattleState.bossDownAtMs`。
 *
 * ⚠ `dealt` 仍由调用方记账（`stats.meDmg` / 飘字读数）——本函数只负责"血写回 ＋ 死亡观测"。
 * ⚠ 尸体再挨打 ⇒ `killedNow = false`（死亡时刻只记第一次）。
 *
 * @returns `dealt` = 本发实收；`killedNow` = **这一发刚刚把它打沉**（此前还活着）
 */
function applyFoeUnitDamage(
  b: {
    distanceM?: number
    alienCorrosion?: number
    acidBursts?: import('./state').BattleState['acidBursts']
    units: Record<string, { hp: Hp3; foeShipId?: string; downAtMs?: number }>
    foeOverride?: { bossShipId?: string }
    lastTickGameMs?: number
    bossDownAtMs?: number
    /** **闪现冷却表**（敌方「瞬光跃迁仪」那一本）——「待机护盾阵列」按它判"闪现是否在冷却中" */
    foeBlinks?: Record<string, number>
    /** **「待机护盾阵列」的本拍就绪快照**（船长 2026-10-03「同一拍整次齐射都算」） */
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  /** 目标单位（认 tag；`resists` 取它自己的层抗，「待机护盾阵列」也取它自己的那份） */
  foe: {
    tag: string
    acidBurst?: UnitSpec['acidBurst']
    resists?: UnitSpec['resists']
    /** **待机护盾阵列参数**（带该件的单位才有；判据见 `standbyShieldActiveOf`） */
    foeStandbyShield?: UnitSpec['foeStandbyShield']
    foeBlink?: UnitSpec['foeBlink']
  },
  dmg: number,
  type: DamageType,
  /** 这一发的时刻（缺省 = 本拍起点）；诊断用，不参与结算 */
  atMsOverride?: number,
): { dealt: number; killedNow: boolean } {
  const rt = b.units[foe.tag]
  if (!rt) return { dealt: 0, killedNow: false }
  const wasAlive = rt.hp.s + rt.hp.a + rt.hp.h > 0
  /**
   * **待机护盾阵列**（**船长 2026-10-02 令**：「**闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。**」）
   * —— 挂在 R 族 T4 垂暮级上的那件：闪现**不在冷却中**（从未闪过也算可用）⇒ **只有护盾层**吃这层抗性。
   * ⚠ 放在**唯一收口**里 ⇒ 主段 / 附加段 / 全体攻击 / 齐射溢火**四条伤害路径同源**吃到它。
   * 没带该件的单位 ⇒ `foeResistsNow` 直接返回原引用 ⇒ **既有各族逐字不变**。
   */
  const r = applyDamage(rt.hp, foeResistsNow(b, foe), dmg, type)
  rt.hp = r.hp
  let killedNow = false
  if (rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
    const atMs = atMsOverride ?? b.lastTickGameMs ?? 0
    if (rt.downAtMs === undefined) rt.downAtMs = atMs
    killedNow = wasAlive
    if (killedNow) triggerAcidBurst(b, foe, 'killed', atMs)
    const bossId = b.foeOverride?.bossShipId
    if (killedNow && bossId !== undefined && rt.foeShipId === bossId) {
      b.bossDownAtMs ??= atMs
    }
  }
  return { dealt: r.dealt, killedNow }
}

/**
 * **打空这一艘所需的最小原始伤害**（F3c B2 · 谜质「齐射协调仪」的溢火结转要用）。
 *
 * 为什么不用"实收伤害"算溢出：`applyDamage` 的消费是**逐层乘系数**的（层克制 × (1−该层该系抗性)），
 * 一发超出部分的"实收"与"原始"不是一个量纲；要把多余火力转给**另一艘**（它有自己的层克制与抗性），
 * 必须把溢出量换回**原始伤害**再走一遍正常结算。
 *
 * 做法 = 对单调函数 `applyDamage(...).dealt` 做二分（`dealt` 随 dmg 单调不减）：
 * 找最小 X 使三层被打空。上限取 `总血 × 12`（抗性最多削 90% ⇒ 需求最多 ×10，留余量）。
 */
export function rawDamageToKill(hp: Hp3, resists: UnitSpec['resists'], type: DamageType): number {
  const total = hp.s + hp.a + hp.h
  if (total <= 0) return 0
  let lo = 0
  let hi = total * 12 + 8
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (applyDamage(hp, resists, mid, type).dealt >= total - 1e-9) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * **谜质「齐射协调仪」：溢出火力转移**（F3c B2 · 船长 2026-09-13：
 * 「**齐射协调仪改为溢出火力会转移到其他敌舰**」）。
 *
 * 口径：目标被打死后，把 `原始伤害 − 打空它所需的原始伤害` 这一截转给**下一艘存活敌舰**，
 * 并按那一艘**自己的层克制**重算（`applyDamage` 原样走一遍）；若把第二艘也打空就继续往下转
 * （`maxChain` 封顶，防一条链子无限转）。**只在本场带了该装置时调用**（`battle.wormhole.volleyOverflow`）。
 *
 * 参数刻意收成结构化小对象（`units` + `stats`）⇒ 用例可以拿一份手搓状态直接验这条机制。
 */
export function carryVolleyOverflow(
  b: {
    distanceM?: number
    alienCorrosion?: number
    acidBursts?: import('./state').BattleState['acidBursts']
    units: Record<string, { hp: Hp3; foeShipId?: string; downAtMs?: number }>
    stats: { meDmg: number }
    foeOverride?: { bossShipId?: string }
    lastTickGameMs?: number
    /** **闪现冷却表**（供「待机护盾阵列」判据用；缺省 ⇒ 一律算"可用"） */
    foeBlinks?: Record<string, number>
    /** **「待机护盾阵列」的本拍就绪快照**（船长 2026-10-03「同一拍整次齐射都算」；缺省 ⇒ 现算补一份） */
    foeStandbyTick?: Record<string, { atMs: number; ready: boolean }>
  },
  foes: readonly UnitSpec[],
  killedTag: string,
  type: DamageType,
  rawDamage: number,
  hpBefore: Hp3,
  maxChain = 3,
): { total: number; hits: number; lastTag: string | null } {
  let raw = rawDamage
  let prevHp = hpBefore
  let prevTag = killedTag
  let total = 0
  let hits = 0
  let lastTag: string | null = null
  for (let n = 0; n < maxChain; n++) {
    // ⚠ 2026-09-15 修：转移伤害与"打空它需要多少"都要按**目标自己的层抗**算（此前传 `{}` ⇒ 敌抗性不生效）
    // 🔴 2026-10-02：层抗改走 `foeResistsNow` ⇒ **「待机护盾阵列」也吃进"打空它要多少"这把尺**（口径同源）
    const prevFoe = foes.find((f) => f.tag === prevTag)
    const prevRes = prevFoe ? foeResistsNow(b, prevFoe) : {}
    const excess = raw - rawDamageToKill(prevHp, prevRes, type)
    if (excess <= 0.5) break
    const next = foes.find((f) => {
      if (f.tag === prevTag) return false
      const rt = b.units[f.tag]
      return !!rt && rt.hp.s + rt.hp.a + rt.hp.h > 0
    })
    if (!next) break
    const rt = b.units[next.tag]!
    const before = { ...rt.hp }
    /** 走**敌舰伤害唯一收口**（血写回 ＋ 死亡观测；算术与随机数消费一字不变） */
    const r = applyFoeUnitDamage(b, next, excess, type)
    b.stats.meDmg += r.dealt
    total += r.dealt
    hits += 1
    lastTag = next.tag
    raw = excess
    prevHp = before
    prevTag = next.tag
    if (rt.hp.s + rt.hp.a + rt.hp.h > 0) break
  }
  return { total, hits, lastTag }
}

/* ═══════════ 敌方后勤舰（船长 2026-09-16）═══════════ */

/**
 * **敌舰开火单发的两把折减尺**（按下面的顺序逐层相乘；两层都不挂 ⇒ **原值返回，零行为变化**）：
 *
 * ① **后勤舰打折**（船长 2026-09-16：「**敌人后勤舰则是将 50% 的自身DPS转换为修理值**」）——
 *    把该单位打出去的单发按 `×(1 − repairPct)` 折掉，被折掉的那半**按秒转成修理量**
 *    （见 `pulseFoeRepair`）。⚠ **只折炮台（`src` 非 `drone`）**：后勤舰本就不挂机群（我方新舰如此设计），
 *    且"自身 DPS"的修理口径也只算炮台 ⇒ 两边同一把尺。
 *
 * ② **叠光装置的伤害折减**（**船长 2026-10-01 令**：「伤害给予一个0.3的倍率。」；追问裁定
 *    「**甲：该舰全部伤害 ×0.3**」）——`FoeOverlayDrive.dmgMul` 乘在该舰**打出去的每一发**上
 *    （光束与实弹**都走本收口**）。它是「装填间隔越缩越短」的对价：间隔缩到 500ms（8.4 倍射速）时
 *    单发只剩 0.3 ⇒ 峰值 DPS 仍被压在预算内。⚠ 卡面 `threat` 与账面 DPS **不动**（预算锚点不变）。
 */
export function foeRepairDiscountedShot(f: UnitSpec, dmg: number): number {
  const pct = f.repairPct ?? 0
  const afterRepair = pct > 0 ? Math.max(1, Math.round(dmg * (1 - pct))) : dmg
  const ov = f.foeOverlayDrive?.dmgMul
  return ov !== undefined && ov >= 0 ? Math.max(1, Math.round(afterRepair * ov)) : afterRepair
}

/**
 * **敌方后勤舰的名义 DPS**（用于每跳修理量）：该单位**战斗中炮台面板**的
 * `Σ 单发 × 门数 × 1000 ÷ 装填`——**不含命中与距离衰减**（固定、可预测）。
 * ⚠ 排除机群条目（`src === 'drone'`）与**备用机**条目（`reserve`）：两者都不是常驻齐射的一份。
 */
export function foeNominalDpsOf(f: UnitSpec): number {
  let dps = 0
  for (const w of f.weapons) {
    if (w.src === 'drone' || w.reserve === true) continue
    const per = w.shotDmg ?? 0
    if (per <= 0) continue
    dps += (per * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
  }
  return dps
}

/**
 * **一记敌方后勤脉冲**（每 `REPAIR_PULSE_MS` = 5 秒一跳，与玩家维修装置同节拍）：
 *
 * - 修理量 = `Σ 在场后勤舰(名义 DPS × repairPct) × (5 秒)`（各舰按自己的名义 DPS 出力）；
 * - 目标 = **非后勤**敌舰里**三层剩余比例最低**者（船长 2026-09-16 补充裁定：
 *   「**敌方的修理无法以其他敌方后勤舰为目标（包括自己）**」）⇒ 候选**排除一切 `repairPct > 0` 的单位，
 *   也排除"甲+结构 都满"的单位（修不动 ⇒ 换下一个；全不可修 ⇒ 空转）；
 * - **只修装甲/结构**（与玩家维修装置同一套层位语义），**不超过目标满血**、**不耗组件**；
 * - 返回实际修好的点数（累加进 `ledger.healed`，供战报/读数）。
 */
export function pulseFoeRepair(
  b: import('./state').BattleState,
  foeSpecs: ReadonlyArray<UnitSpec>,
  ledger: { nextPulseAtMs?: number; pulses: number; healed: number },
): void {
  /**
   * ⚠ **2026-09-19 报障修复**（船长转述玩家：「**生物损管腔之类的修理会让已经损毁的船复活**」）：
   * 供血方必须**还活着**（`isAlive`）——尸体不再产生修理值。判据与被动护盾回充同源，
   * 理由是同一把尺：尸体在 `battle.units` 里**永不摘除**（多波/战报/「在场过 = 存在」都靠它）⇒
   * 只查字段存在、不查存活，就会让"阵亡的后勤舰照旧供血"。
   */
  const donors = foeSpecs.filter((s) => (s.repairPct ?? 0) > 0 && isAlive(b, s.tag))
  if (donors.length === 0) return
  const perSecond = donors.reduce((sum, s) => sum + foeNominalDpsOf(s) * (s.repairPct ?? 0), 0)
  const amount = (perSecond * REPAIR_PULSE_MS) / 1000
  ledger.pulses += 1
  if (amount <= 0) return
  // 选靶：非后勤 + 甲/结构未满 + 三层比例最低（并列取 spec 顺序靠前）
  let target: UnitSpec | undefined
  let bestRatio = Number.POSITIVE_INFINITY
  for (const s of foeSpecs) {
    if ((s.repairPct ?? 0) > 0) continue // 永不以任何后勤舰为目标（含自己）
    if (s.foeShipId === 'foe-alien-broodmother' && b.foeOverride?.bossShipId === s.foeShipId) continue
    const rt = b.units[s.tag]
    if (!rt) continue
    // 阵亡敌舰不修（2026-09-19 报障修复）：三层全 0 ⇒ 修活 = 玩家的"已沉没"敌舰复活
    if (!isAlive(b, s.tag)) continue
    const capA = Math.max(0, s.hp.a)
    const capH = Math.max(0, s.hp.h)
    if (rt.hp.a >= capA && rt.hp.h >= capH) continue
    const capAll = capA + capH + Math.max(0, s.hp.s)
    const ratio = capAll > 0 ? (rt.hp.s + rt.hp.a + rt.hp.h) / capAll : 1
    if (ratio < bestRatio) {
      bestRatio = ratio
      target = s
    }
  }
  if (!target) return
  const rt = b.units[target.tag]
  if (!rt) return
  const capA = Math.max(0, target.hp.a)
  const capH = Math.max(0, target.hp.h)
  let left = amount
  const healA = Math.min(left, Math.max(0, capA - rt.hp.a))
  rt.hp.a += healA
  left -= healA
  const healH = Math.min(left, Math.max(0, capH - rt.hp.h))
  rt.hp.h += healH
  ledger.healed += healA + healH
}

/* ═══════════ 敌方挂载件「船体修理装置」（船长 2026-09-24）═══════════ */

/**
 * **一记「船体修理装置」脉冲**（每 `UnitSpec.foeRepairPulse.everyMs` = 5 秒一跳，与维修装置同节拍）：
 * **只修挂件的那艘自己**（不选靶、不外溢），装甲与结构各 `round(基数 × k)`、各层夹自己的满值。
 *
 * ⚠ 与 `pulseFoeRepair`（敌方后勤舰）**不是一套**，两条独立并存：
 * - 后勤舰 = **把自己的 DPS 折成修理值去修队友**（有选靶、有"永不修后勤舰"约束、按账本一跳一选）；
 * - 本装置 = **自修**、不折火力、逐单位各按各的计时（`battle.foeRepairPulses[tag]`）。
 *
 * 返回实际修好的点数（累加进该单位的账本，供战报/读数用）。
 * 阵亡单位不修（与 2026-09-19「尸体不复活」同一把尺：尸体在 `battle.units` 里永不摘除）。
 */
export function pulseFoeMountRepair(
  b: import('./state').BattleState,
  spec: UnitSpec,
  ledger: { nextPulseAtMs?: number; pulses: number; healed: number },
): void {
  const rp = spec.foeRepairPulse
  if (rp === undefined) return
  ledger.pulses += 1
  if (!isAlive(b, spec.tag)) return
  const rt = b.units[spec.tag]
  if (!rt) return
  const capA = Math.max(0, spec.hp.a)
  const capH = Math.max(0, spec.hp.h)
  const healA = Math.min(Math.max(0, Math.round(rp.armor * rp.k)), Math.max(0, capA - rt.hp.a))
  const healH = Math.min(Math.max(0, Math.round(rp.hull * rp.k)), Math.max(0, capH - rt.hp.h))
  if (healA <= 0 && healH <= 0) return
  rt.hp.a += healA
  rt.hp.h += healH
  ledger.healed += healA + healH
}

/* ═══════════ 构建 ═══════════ */

/**
 * **我方"不被一击带走"保险**（船长 2026-09-16：「**血量 100%，单次齐射伤害最多只能造成总血量 80% 的伤害
 * （只对我方生效）**」）。
 *
 * 口径：**同一拍内落在同一艘我方舰上的敌方伤害合计 ≤ 该舰满血（三层合计）× 本比例（0.8）**
 * —— 逐拍账本 `battle.meVolleyDmg[tag]`（每拍开头清空）⇒ **满血舰永不可能被一次齐射带走**（至少留 20%）。
 * - **只削我方承伤**：本函数只在"敌方 → 我方"的三处结算点调用（敌机群 / 敌光束 / 敌炮台），
 *   我方打敌人**一字不动**；
 * - **洞内洞外都生效**：挂在共用的 `stepBattle` 上 ⇒ 悬赏 / 低安遭遇 / AI 副船 / 虫洞一律吃保险；
 * - 夹的是**入伤**（已含近盲折扣与受击增程折减之后），所以实际掉血 ≤ 上面那条上限。
 * - "一次齐射"按**同拍落地**计（错开首轮之后各敌首发已不同拍；同拍多为同一艘的多门炮）。
 */
export const PLAYER_VOLLEY_DMG_CAP_SHARE = 0.8

/** 把一发"敌方 → 我方"的伤害夹进本拍保险额度内，并记账（返回实际可造成的伤害） */
export function cappedFoeDamage(
  b: import('./state').BattleState,
  tag: string,
  spec: UnitSpec,
  dmg: number,
): number {
  if (dmg <= 0) return dmg
  const max = b.units[tag]?.hpMax
  const full = max ? max.s + max.a + max.h : spec.hp.s + spec.hp.a + spec.hp.h
  if (full <= 0) return dmg
  const cap = full * PLAYER_VOLLEY_DMG_CAP_SHARE
  const used = b.meVolleyDmg?.[tag] ?? 0
  const room = Math.max(0, cap - used)
  const out = Math.min(dmg, room)
  // ⚠ **必须无条件记账**（哪怕这一发全额放行）：额度是"本拍累计"口径，漏记就等于给下一发多开口子
  b.meVolleyDmg = { ...(b.meVolleyDmg ?? {}), [tag]: used + out }
  return out
}

/* ═══════════ 损伤管制装置 · 免死（2026-09-25 船长令） ═══════════ */

/** **结构锁定窗口**（1 秒；船长改判「1 秒内结构锁定 1」）——`BattleState.dc[tag].lockUntilMs` 的时长 */
export const DC_LOCK_MS = 1_000

/**
 * **损伤管制装置 · 免死判定**（船长口径：**1 秒内结构锁定 1** · **每场一次** · **启动消耗 1 枚损管修理组件**）。
 *
 * 位置 = **敌方 → 我方的唯一入伤口**（三处结算点：敌机群 / 敌光束 / 敌炮台，都先过 `cappedFoeDamage`
 * 那道 80% 齐射保险，再过本函数）——这是"逐段夹伤"能成立的关键：
 * - **窗口内**（`lockUntilMs > 本拍时刻`）：把本发原始伤害夹到"结算后结构 ≥ 1"⇒ **同拍/同秒多段都破不了**；
 * - **窗口外且未用过**：若本发会导致结构 ≤ 0 ⇒ ①扣 1 枚组件（没组件 ⇒ 不启动，仅记一条日志）
 *   ②开窗 1 秒 ③本场标记已用 ④把本发夹到结构 = 1 ⑤日志 ＋ 战斗提示；
 * - **已用过且出窗** ⇒ 原样放行（照常被打死 —— 丁案的既定后果）。
 *
 * `applyRaw` = 调用方自己的施加函数（单系 `applyDamage` / 混伤 `applyFoeShot`）；
 * 缺省按单系 `applyDamage(hp, spec.resists, raw, type)` 估。二分反解（`applyDamage` 对伤害单调）。
 */
export function applyDcGuard(
  state: GameState,
  b: import('./state').BattleState,
  tag: string,
  spec: UnitSpec,
  hpNow: Hp3,
  raw: number,
  type: DamageType | undefined,
  /** 调用方真正的施加函数（混伤路径传它自己的；缺省 = 单系 applyDamage） */
  applyRaw?: (r: number) => Hp3,
): number {
  if (raw <= 0 || spec.hullSaveKit === undefined) return raw
  const apply = (r: number): Hp3 => (applyRaw ? applyRaw(r) : applyDamage(hpNow, spec.resists, r, type ?? 'kinetic').hp)
  const st = b.dc?.[tag]
  const inWindow = st?.lockUntilMs !== undefined && st.lockUntilMs > b.lastTickGameMs
  const lethal = apply(raw).h <= 0
  if (inWindow) {
    // 窗口内：结构不许掉到 1 以下（本发可能直接致死 ⇒ 夹住）
    return lethal || apply(raw).h < 1 ? clampRawLeavingHull(apply, raw) : raw
  }
  if (!lethal) return raw
  if (st?.used === true) return raw
  /** 启动：扣 1 枚损管修理组件（仓库优先/关掉开关则走本舰货仓，与修理组件同一口径） */
  const kitId = spec.hullSaveKit
  const shipId = spec.shipId ?? state.shipId
  const supply = wormholeSupplyForBattle(state, b)
  const took = supply ? takeWormholeSupply(supply, kitId, 1) === 1 : state.resupplyFromWarehouse !== false
    ? countWare(state, kitId) > 0 && (removeWare(state, kitId, 1), true)
    : removeCargoOfShip(state, shipId, kitId, 1) > 0
  if (!took) {
    addLog(state, 'warn', '损伤管制装置未能启动：损管修理组件不足。', 'core.combat.003')
    return raw
  }
  b.dcKitsUsed = Math.max(0, Math.floor(b.dcKitsUsed ?? 0)) + 1
  b.dc = { ...(b.dc ?? {}), [tag]: { lockUntilMs: b.lastTickGameMs + DC_LOCK_MS, used: true } }
  addLog(state, 'combat', '✦ 损伤管制装置启动：结构锁定在 1 点、持续 1 秒（消耗损管修理组件 ×1）。', 'core.combat.002')
  pushBattleNotice(b, '损伤管制装置启动：结构锁定 1')
  return clampRawLeavingHull(apply, raw)
}

/**
 * **把原始伤害夹到"结算后结构 ≥ 1"的最大值**（二分；`apply` 对伤害单调不减）。
 * 结构本来就 < 1（异常/已锁死）⇒ 返回 0（不再放行任何伤害）。
 */
function clampRawLeavingHull(apply: (r: number) => Hp3, raw: number): number {
  if (apply(0).h < 1) return 0
  if (apply(raw).h >= 1) return raw
  let lo = 0
  let hi = raw
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (apply(mid).h >= 1) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * **战后总结里的"损伤管制装置"一行**（2026-09-25 船长令：战报单列一条）。
 * 本场一次没启动 = `''`（战报不添尾巴），否则形如 `损伤管制装置启动 ×1（消耗损管修理组件 ×1）`。
 * 与 `repairUsageText` 同哲学：四处战报（远征胜/败、遭遇、AI 副船）共用。
 */
export function dcUsageText(
  battle: { dcKitsUsed?: number } | null | undefined,
  ctx: SimContext,
): string {
  const n = Math.max(0, Math.floor(battle?.dcKitsUsed ?? 0))
  if (n <= 0) return ''
  const kitName = ctx.items.get('repairkit-dc')?.name ?? '损管修理组件'
  return `损伤管制装置启动 ×${n.toLocaleString('zh-CN')}（消耗${kitName} ×${n.toLocaleString('zh-CN')}）`
}

/**
 * 结算敌人一发（2026-09-10 船长：窝点混伤）：
 * 武器带 `shotsByType`（混伤，主 60% / 副 40%）→ 按构成**逐系**调用 `applyDamage`
 * （各系吃各自的 `typeLayerMult` 与层抗，逐系依次消费 盾→甲→结构）；
 * 纯系武器（无 `shotsByType`）→ 与旧行为一字不差。
 * `totalDmg` 是本次开火的总伤害（含近盲/距离折扣），按构成比例分摊、**总量不变**。
 * 返回更新后的三层血量（调用方直接赋值）。导出供回归测试直接验证"混伤绕过单系抗"。
 */
export function applyFoeShot(
  hp: Hp3,
  resists: UnitSpec['resists'],
  weapon: WeaponSpec,
  totalDmg: number,
  mainType: DamageType,
): Hp3 {  const shots = weapon.shotsByType
  const entries = shots ? Object.entries(shots).filter(([, v]) => (v ?? 0) > 0) : []
  if (entries.length <= 1) return applyDamage(hp, resists, totalDmg, mainType).hp
  const sum = entries.reduce((s, [, v]) => s + (v ?? 0), 0)
  if (sum <= 0) return applyDamage(hp, resists, totalDmg, mainType).hp
  // 主系在前（与构成降序一致：shotsByType 由 splitShotByComposition 生成 → 主系份额最大）
  let next = hp
  let left = totalDmg
  entries.forEach(([t, v], i) => {
    // 多炮拆小单发后不逐系取整，避免低伤炮把原混伤比例改成一半一半。
    const share = (totalDmg * (v ?? 0)) / sum
    const dmg = i === entries.length - 1 ? left : (weapon.gunCount ?? 1) > 1 ? share : Math.max(1, Math.round(share))
    const take = Math.max(0, Math.min(left, dmg))
    if (take <= 0) return
    next = applyDamage(next, resists, take, t as DamageType).hp
    left -= take
  })
  return next
}

function combatSpeed(maxSpeedMps: number, agility: number, bal: BattleBalance): number {
  return Math.max(20, maxSpeedMps * bal.speedFactor * (1 + (agility - 0.5) * 2 * bal.agilitySpeedBonus))
}

/**
 * 开火失稳乘子的**当前有效值**（2026-09-10 船长：推进器失稳代价只在**点火期**生效）：
 * 点火期 = 装配值（`1 − 最重一件 hitPenalty`）；冷却期 = 1（没点火就不失稳）。
 */
export function effectiveHitMul(spec: Pick<UnitSpec, 'hitMul'>, boosting: boolean): number {
  return boosting ? (spec.hitMul ?? 1) : 1
}

/**
 * 推进器周期状态（2026-09-10 船长定：**爆发 60 秒 → 冷却 60 秒，开场即启动**）。
 * **由战斗时钟推导**（`lastTickGameMs - startedAtGameMs`）→ 不占任何存档字段、战中重载不丢。
 * 引擎（距离步进取我方机动）与界面（战斗界面底部推进器冷却格）**同源读这一个函数**。
 *
 * **2026-09-14 船长（新增「微型跃迁引擎」）**：周期改为**逐单位**——第三参 `cycle` 给该单位自己的
 * 点火/冷却毫秒（缺省仍是 `balance.battle` 的全局值）。同一个函数、同一个时钟锚（**开场即点火**），
 * 只是窗口长短各算各的 ⇒ 装微型跃迁引擎那条船 10 秒爆发、其余船仍 60 秒。
 */
export function thrusterPhase(
  battle: Pick<import('./state').BattleState, 'lastTickGameMs' | 'startedAtGameMs'>,
  bal: BattleBalance,
  cycle?: { boostMs?: number; cooldownMs?: number },
): { boosting: boolean; remainMs: number; cycleMs: number; posMs: number } {
  const boostMs = cycle?.boostMs ?? bal.thrusterBoostMs
  const cooldownMs = cycle?.cooldownMs ?? bal.thrusterCooldownMs
  const cycleMs = Math.max(1, boostMs + cooldownMs)
  const elapsed = Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs)
  const posMs = elapsed % cycleMs
  const boosting = posMs < boostMs
  return { boosting, posMs, cycleMs, remainMs: boosting ? boostMs - posMs : cycleMs - posMs }
}

/** 某单位的推进器周期（没写覆盖 = 全局 `balance.battle`）——引擎与界面取周期的**单点** */
export function unitThrusterCycle(
  u: Pick<UnitSpec, 'thrusterBoostMs' | 'thrusterCooldownMs'>,
  bal: BattleBalance,
): { boostMs: number; cooldownMs: number } {
  return {
    boostMs: u.thrusterBoostMs ?? bal.thrusterBoostMs,
    cooldownMs: u.thrusterCooldownMs ?? bal.thrusterCooldownMs,
  }
}

/**
 * 敌冲锋状态机（2026-09-10 定；结束条件 2026-09-11 改判；触发条件 2026-09-14 加"乙"；
 * **2026-09-14 同日晚些时候船长再改判：逐单位 + 自身命中解除 + 冷却 10 秒**）。
 *
 * **触发两条取或**：① 够不着（距离在**自己武器射程之外**）② **距离 > 期望交距 + 1,000**
 * （船长「冲锋按乙方案来」）→ 该单位**自己**加速（机动 ×倍率，仍走拔河公式）。
 * **解除两条取或**：① **自身炮台命中我方**（船长：「冲锋解除机制为自身攻击命中后解除冲锋状态，
 * 并进入 10 秒冷却」）② 压到期望交距 `arrived`（2026-09-11 口径，**留作兜底**）。
 * 解除后该单位进 `foeChargeCooldownMs`（**本批由 20 秒改判为 10 秒**）冷却，期满且再次满足触发条件才重启。
 *
 * ⚠ **逐单位**（2026-09-14 船长：「现在多单位的战斗速度难道不是取速度全队平均值吗？那么**各自触发
 * 冲锋的提速**应该没什么问题吧？」＋「给小虫子添加冲锋，倍率为 1.5」）：每个挂资格的单位各持一份
 * 「在冲 / 冷却到某时刻」（`b.foeCharges[tag]`），互不顶替——原编队级单标志下，先命中那条会把
 * 别的冲锋者的状态一并清掉。
 * ⚠ **倍率不外溢**（2026-09-11 船长：「冲锋还是按照**巨兽自己的速度**算…**哪怕是冲锋也是按照巨兽速度**」）：
 * 加速只乘进**该单位自己**那一项（见 `stepBattle` 的"逐单位乘各自倍率 → 取平均"）。
 * 只对挂了 `foeCanCharge` 的敌人生效——资格有**两条互相独立**的来源（见 `createFoeSpecsFromShips`）：
 * **舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件）与**老路**（威胁 ≥ `foeChargeThreatFloor`
 * 且战术 = brawl，受总开关 `foeChargeEnabled` 约束）；无总时长上限。
 *
 * ⚠ **2026-09-16 船长报障「洞内被 C 族贴上后拉不开距离」——查实与本机制无关，别再当 BUG 修**：
 * 定向实测（洞内 C 族卡、敌命中率临时置 1）：敌炮命中那一拍**照常解除并进 10 秒冷却**，洞内外同源。
 * 拉不开距离的真因是**机动拔河**（距离 = 双方各朝自己期望值推，推力 = 各自机动），
 * 关键数字见下（**按现行数据**，「C 族三卡改编成」并入 main 之后）：
 * - **敌方**：洞内 C 族 = 星髓成虫 **398** / 孢群异虫 **400** / 噬口巨兽 **297**（编队均速 364~399；
 *   冲锋 ×1.5 / ×3 ⇒ **598~891**）。⚠ 改版前洞里是**畸变/星髓幼虫 544（冲锋 816）**——那批幼虫
 *   现已从洞内三卡退场（仍留悬赏线），**"被钉死"的历史读数出自那一版编成**。
 * - **我方**：T3 巡洋基础 **272**，推进 MK2 点火 **435** / MK3 点火 **544**。
 * - **实测（现行编成 · 4×长尾鲨）**：满炮装 MK3 能把距离从 3,220 拉到 **4,169** 再赢下（拉得开）；
 *   摸金装 MK2 在 2,454~3,158 之间徘徊（不再单向被压）。最快档护卫舰（点火 864）轻松保持 ~4,700 m，
 *   但中层卡的**孢群机群**会扑上来打 ⇒ 纯风筝不再零风险。
 * - **距离仍受两条洞内口径约束**：近战怪按 2026-09-13 规则**开局就站在玩家中距档（3,220 m）**；
 *   **冲锋触发线 = 敌期望交距（C 族 ~540）+ 1,000 ≈ 1,540 m** ⇒ 想常驻在这条线之外，得靠推进器/快船。
 * **船长 2026-09-16 裁定：戊案——现状即设计，不改**；对策在配船与信息提示，不在改机制。
 *
 * 历史 BUG（2026-09-14 船长报障「冲锋到达目标距离后并不会解除」）：当时解除条件**只有** `arrived`，
 * 而"我方更快、且期望交距更远"时距离会**停在期望交距之上**（拔河平衡点：我方外拉 = 敌方内推），
 * `arrived` 永不可达 ⇒ 冲锋永不解除、冷却永不启动。本批加的**命中解除**就是这条 BUG 的出口
 * （在冲的单位既然已经进射程，炮台迟早打中）；`arrived` 仍留作兜底。
 */
/**
 * **劫掠捕获网：把四层效果施加到被钉的我方规格上**（船长 2026-09-16 两句话的落点）。
 *
 * 语义 = **只改这一份规格**（不改存档、不改数据）：战斗机动 ×`slowMul`、推进器倍率清零、
 * 闪避归零、每条武器**两端各减** `rangeDownM`（近界下限 1m、远界下限 2m）。
 * 三处调用（缺一不可）：① 触发那一发**当场**施加（这一发的命中判定就该看到闪避 0）；
 * ② `buildMyUnitSpecs` 每拍重建后施加（否则下一拍又"复活"）；③ 视图 `battleArcsFor`（面板/射程带同尺）。
 */
/**
 * **记下"这一场有哪些敌方舰级"**（船长 2026-09-16：「**在玩家第一次遭遇劫掠电子舰之后**…给玩家发送一封
 * 通讯，介绍劫掠电子舰的捕获网」）。出口唯一：两处开战入口（单船 `startBattleFor` / 编队 `startFleetBattleFor`）
 * 各调一次 ⇒ 通讯触发器只读 `state.foeShipSeen`，不必在别处再判"遇到过没有"。
 * ⚠ 只认**这一场敌卡编成里出现过的舰级**（含派生卡的编成）——与"这卡有没有它"同源。
 */
export function noteFoeShipsSeen(state: GameState, anomaly: AnomalyDef): void {
  const slots = anomaly.ships
  if (!slots || slots.length === 0) return
  let next: Record<string, true> | null = null
  for (const slot of slots) {
    const id = slot.ship?.id
    if (!id || state.foeShipSeen?.[id] === true) continue
    next = next ?? { ...(state.foeShipSeen ?? {}) }
    next[id] = true
  }
  if (next) state.foeShipSeen = next
}

export function applyMeWebDebuff<T extends UnitSpec>(spec: T, d: import('./state').BattleWebDebuff): T {
  spec.speedMps = Math.max(20, spec.speedMps * d.slowMul)
  if (d.noThruster) spec.thrusterBoost = 0
  if (d.noEvasion) spec.evasion = 0
  if (d.rangeDownM > 0) {
    spec.weapons = spec.weapons.map((w) => {
      const maxRangeM = Math.max(2, w.maxRangeM - d.rangeDownM)
      const minRangeM = Math.max(1, Math.min(maxRangeM - 1, w.minRangeM - d.rangeDownM))
      return { ...w, maxRangeM, minRangeM }
    })
  }
  return spec
}

/**
 * **发动捕获网**（船长 2026-09-16：「**在自身第一次开火时发动**」——不看是否命中）：
 * 给目标上账本、**当场**把效果打在本发目标的规格上、推一条**蓝色连线**特效与一条日志。
 *
 * 三条口径（第三条于 **⟪2026-09-25 船长报障⟫** 修）：
 * 1. 同一艘舰**整场只发一次**（`foeWebFired`）；
 * 2. **多艘不叠加**：目标已有账本 ⇒ **不再上账本、不推特效、不写日志**（只留最早那条）；
 * 3. ⚠ **打空不算用掉**：第 2 条那种"目标已被别的网钉住"的情形下，**本舰的网保留**，
 *    等它**真正钉住一个未被捕获的目标**时才记 `foeWebFired`。
 * 4. **截击舰跳过**（**船长 2026-09-30**「给拦截舰添加效果，不会被网子选为目标」）：
 *    目标带 `interceptorImmuneToWeb` ⇒ 与第 3 条同款处置（不发出、不算用掉、网保留）。
 *
 * 为什么第 3 条必须这样（船长 2026-09-25 原话）：「**装备劫掠捕获网的船攻击时，如果命中已经被捕获的船时，
 * 并不会触发，而是保留直到攻击了没有被捕获的船**」。修前：本函数**无条件**先记 `foeWebFired` 再判"已钉"，
 * 于是第 2 艘起的网被**静默作废**（无蓝线、无日志、此后整场不再发放）。真引擎实测（真实入侵卡
 * `ink-harass` = 墨潮突击舰 ×4 全带网 · 我方只 1 艘船）：**`foeWebFired` 记 4 艘、实际只钉住 1 个目标、
 * 蓝线只出 1 条** ⇒ 3 张网白费。修后同上场景应记 **1** 艘、留着另外 3 张。
 */
function fireFoeCaptureWeb(
  state: GameState,
  b: import('./state').BattleState,
  f: UnitSpec,
  target: UnitSpec,
): void {
  const web = f.foeCaptureWeb
  if (!web) return
  /**
   * **截击舰不可被网选中**（**船长 2026-09-30**：「**给拦截舰添加效果，不会被网子选为目标**」；
   * 数据开关 = `ShipDef.interceptorImmuneToWeb` ⇒ `spec.interceptorImmuneToWeb`）。
   *
   * 与下一条"目标已被别的网钉住"**同一处置**：本发的网**不发出、也不算用掉**（`foeWebFired` 不记）
   * ⇒ 该舰保留着网，等它某一发打到合法目标再张（既有口径第 3 条「打空不算用掉」）。
   * ⚠ 只挡**网**：这一发炮火的命中判定与伤害不受影响（选靶在调用方，已定）。
   */
  if (target.interceptorImmuneToWeb === true) return
  // ⚠ 目标已被别的网钉住 ⇒ **本次不算发放**（本舰的网保留到它钉住新目标为止）——见函数头注第 3 条
  if (b.meWebDebuffs?.[target.tag]) return
  b.foeWebFired = { ...(b.foeWebFired ?? {}), [f.tag]: true }
  const debuff: import('./state').BattleWebDebuff = {
    byTag: f.tag,
    slowMul: web.slowMul,
    noThruster: web.noThruster,
    noEvasion: web.noEvasion,
    rangeDownM: web.rangeDownM,
    atMs: b.lastTickGameMs,
  }
  b.meWebDebuffs = { ...(b.meWebDebuffs ?? {}), [target.tag]: debuff }
  applyMeWebDebuff(target, debuff) // 本发立即生效（含闪避归零）
  pushBattleFx(b, { atMs: b.lastTickGameMs, side: 'foe', tag: f.tag, to: target.tag, type: 'kinetic', hit: true, web: true })
  addLog(
    state,
    'warn',
    `${f.name} 张开劫掠捕获网，钉住了 ${target.name}：机动骤降、推进器熄火、闪避失效、射程缩短——` +
      `击沉 ${f.name} 才能解除。`,
  )
}

/**
 * **捕获网解除**（船长 2026-09-16：「**击杀发动者即解除**」＋ **2026-09-26**：「**将断开距离提高到4500米，
 * 且这个断开对敌我都有效**」）：每拍清理"施放者已不在场/已阵亡"与"交战距离超过断开距离"的条目。
 * 只删账本（效果随"每拍重建规格"自然消失）；解除时推一条日志，让玩家知道网松了。
 *
 * ⚠ 敌方那张网**整场只张一次**（既有口径：`fireFoeCaptureWeb` 的 `foeWebFired` 已记发放）⇒ 距离拉开断开后
 * 本场不再补发；要恢复只能指望**另一艘还没发过网的敌舰**（多网同场那条报障口径不变）。
 */
function expireFoeWebs(state: GameState, b: import('./state').BattleState, foes: readonly UnitSpec[]): void {
  const list = b.meWebDebuffs
  if (!list || Object.keys(list).length === 0) return
  const aliveTags = new Set(foes.filter((f) => isAlive(b, f.tag)).map((f) => f.tag))
  for (const [tag, d] of Object.entries(list)) {
    const name = b.units[tag]?.name ?? tag
    if (!aliveTags.has(d.byTag)) {
      delete list[tag]
      addLog(state, 'combat', `劫掠捕获网已失效：${name} 摆脱了束缚（发动者已被击沉）。`, 'core.combat.008', { p1: name })
      continue
    }
    if (b.distanceM > WEB_BREAK_DIST_M) {
      delete list[tag]
      addLog(state, 'combat', `劫掠捕获网已失效：${name} 摆脱了束缚（距离超过 ${WEB_BREAK_DIST_M} 米）。`, 'core.combat.009', { p1: name, p2: WEB_BREAK_DIST_M })
    }
  }
}

/**
 * **捕获网的断开距离（敌我通用）**（**船长 2026-09-26**：「**将断开距离提高到4500米，
 * 且这个断开对敌我都有效**」；前令为 4000 米）。
 *
 * 口径：网是**实体缆索**——每拍结算时若交战距离 `b.distanceM` 超过本值 ⇒ **两边的网都立刻断开**：
 * - **我方「墨潮捕获网」**：清目标 ＋ 清减益，**断开算一次使用**（船长同日追答「断开也当使用一次」）
 *   ⇒ 进满一轮周期冷却（`advanceMyCaptureWebs`）；
 * - **敌方「劫掠捕获网」**：清账本（`expireFoeWebs`）——该舰本场只张一次网 ⇒ 本场不再补发。
 *
 * （2026-10-02 批次 4g 迁到 playerSpec.ts：createPlayerSpec 建档时要用它俩当缺省，留在本文件
 * 会造 combat↔playerSpec 回边；本文件借回 + 再导出。）
 */

/**
 * **把我方「墨潮捕获网」的三层效果打在一艘敌舰的规格上**（**船长 2026-09-26**）。
 *
 * 与 `applyMeWebDebuff`（敌方那件打在我们身上）**同构，少一层**：船长明令
 * 「**我方捕获网移除武器射程下降的效果**」⇒ 只留 **机动 ×`slowMul`** · **推进器全关** · **闪避归零**。
 * ⚠ 敌阵规格**每拍由卡重建** ⇒ 本函数也必须**每拍重新施加**（与 `applyMeJammerDebuff` 同一套写法），
 * 否则效果"下一拍就复活"。
 */
export function applyFoeWebDebuff<T extends UnitSpec>(
  spec: T,
  d: import('./state').BattleFoeWebDebuff,
): T {
  if (!foeWebBases.has(spec)) foeWebBases.set(spec, { speedMps: spec.speedMps, evasion: spec.evasion, thrusterBoost: spec.thrusterBoost })
  spec.speedMps = Math.max(20, spec.speedMps * d.slowMul)
  /**
   * **C 族族设定**（**船长 2026-09-30**：「给C族添加族设定，**他们的冲锋不会被网子解除**」；
   * 口径追问取甲 = 「网『关推进器』对 C 族无效」）⇒ 带 `foeChargeWebImmune` 的单位**不清零推进器层**
   * （见 `FoeMountDef.charge.webImmune`；四件虫群冲锋器带它，A 族那件不带）。
   * ⚠ 其余两层（减速 / 闪避归零）对 C 族**照常生效**。
   */
  if (d.noThruster && spec.foeChargeWebImmune !== true) spec.thrusterBoost = 0
  if (d.noEvasion) spec.evasion = 0
  return spec
}

// 长步会复用本波规格；恢复网修改的字段，不能把上个时间片的减速作为新基准。
const foeWebBases = new WeakMap<UnitSpec, Pick<UnitSpec, 'speedMps' | 'evasion' | 'thrusterBoost'>>()

function restoreFoeWebSpecs(foes: readonly UnitSpec[]): void {
  for (const foe of foes) {
    const base = foeWebBases.get(foe)
    if (!base) continue
    foe.speedMps = base.speedMps
    foe.evasion = base.evasion
    if (base.thrusterBoost === undefined) delete foe.thrusterBoost
    else foe.thrusterBoost = base.thrusterBoost
  }
}

/**
 * **我方捕获网的每拍推进**（**船长 2026-09-26** 全套口径的落点）：
 * 「**玩家的捕获网和武器一样有冷却周期，独立瞄准，不看命中，击沉携带者才解除，或者对面被击沉，
 * 不选取重复目标。对方被击沉后进入冷却，冷却结束选择新目标。**」
 *
 * 三条状态机（键 = 携带者 tag，账本 `BattleState.myWebs`）：
 * 1. **待发/冷却中**（`targetTag` 空）：只有 `now ≥ cooldownUntilMs`、**交战距离 ≤ `MY_WEB_RANGE_M`**
 *    且**存在可选目标**时才张网 —— 可选 = 存活 · 在当前波 · **未被任何网钉住**（"不选重复目标"）；
 *    **没有可选目标或距离过远 ⇒ 保持待发**（不空转冷却，沿用既有"打空不算用掉"口径）。初始冷却 = 0
 *    （⚠ **不是"开战即钉"**：船长 2026-09-26 令「**我方网子的射程是3800米**」⇒ 开战距离远于 3800 米时，
 *    要等距离压进来才张网）。
 * 2. **已钉住**：每拍把三层效果施加到目标规格上；目标一死 ⇒ 清目标、**记冷却 = 现在 + 周期**、写日志；
 *    **交战距离 > `WEB_BREAK_DIST_M`（4500 米）⇒ 断开**（同样算一次使用 ⇒ 同样进冷却）。
 * 3. **携带者阵亡** ⇒ 整条账本删掉、它的网全部解除（"击沉携带者才解除"）。
 *
 * **不看命中 · 独立瞄准**：不掷命中、也不跟武器打谁 —— 目标按**敌阵顺序**取第一个可选的（确定性、
 * 可复现，不消费随机数）。演出 = 一条蓝色连线（`web: true`，与敌方那套同款）＋ 一条日志。
 */
export function advanceMyCaptureWebs(
  state: GameState,
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
  foes: readonly UnitSpec[],
): void {
  restoreFoeWebSpecs(foes)
  const webs = b.myWebs
  const debuffs = b.foeWebDebuffs
  const carriers = myUnits.filter((u) => (u.myCaptureWeb?.cycleMs ?? 0) > 0)
  // ① 携带者已不在场/已阵亡 ⇒ 它的网解除（"击沉携带者才解除"）
  if (webs) {
    for (const tag of Object.keys(webs)) {
      const carrier = carriers.find((u) => u.tag === tag)
      if (carrier && isAlive(b, tag)) continue
      delete webs[tag]
      if (debuffs) {
        for (const [to, d] of Object.entries(debuffs)) {
          if (d.byTag !== tag) continue
          delete debuffs[to]
          addLog(state, 'combat', `墨潮捕获网已失效：${b.units[to]?.name ?? to} 挣脱了束缚（网手已被击沉）。`, 'core.combat.010', { p1: b.units[to]?.name ?? to })
        }
      }
    }
  }
  if (carriers.length === 0) return
  const now = b.lastTickGameMs
  const aliveFoes = foes.filter((f) => isAlive(b, f.tag))
  for (const me of carriers) {
    // ⚠ 已阵亡的网手**不再张网**（上面的清理段刚把它的账本删掉；这里不跳过就会被 `??=` 重建）
    if (!isAlive(b, me.tag)) continue
    const cycleMs = me.myCaptureWeb!.cycleMs
    /**
     * ⚠ **三项读数按"网手"各自取**（**2026-09-29 船长令**：关键属性进属性栏）——
     * 原先这里读的是引擎常量（`MY_WEB_RANGE_M` / `WEB_BREAK_DIST_M` / 写死的 0.5），
     * 卡面因此看不到任何一项。现在取 `myCaptureWeb` 上的三个值（由件上字段供给、缺省回落常量）。
     */
    const webRangeM = me.myCaptureWeb!.rangeM
    const webBreakM = me.myCaptureWeb!.breakM
    const webSlowMul = me.myCaptureWeb!.slowMul
    const existingTarget = b.myWebs?.[me.tag]?.targetTag
    if (existingTarget && b.foeWebDebuffs?.[existingTarget]?.byTag === me.tag) {
      b.foeWebDebuffs[existingTarget]!.slowMul = webSlowMul
    }
    b.myWebs = { ...(b.myWebs ?? {}) }
    const st = (b.myWebs[me.tag] ??= { cooldownUntilMs: 0 })
    // ② 目标已死/已不在本波 ⇒ 清目标并进冷却
    if (st.targetTag !== undefined && !aliveFoes.some((f) => f.tag === st.targetTag)) {
      const gone = b.units[st.targetTag]?.name ?? st.targetTag
      if (b.foeWebDebuffs) delete b.foeWebDebuffs[st.targetTag]
      delete st.targetTag
      st.cooldownUntilMs = now + cycleMs
      addLog(state, 'combat', `墨潮捕获网松开：${gone} 已被击沉，${me.name} 的网开始冷却。`, 'core.combat.011', { p1: gone, p2: me.name })
    }
    /**
     * ②b **距离超过断开距离 ⇒ 网断开**（**船长 2026-09-26**：「将断开距离提高到4500米，
     * 且这个断开对敌我都有效」＋前令「距离超过4000米就会断开」＋追答「**断开也当使用一次**」）。
     * 断开 = **用掉一次** ⇒ 进满一轮周期冷却（与"目标被击沉"同等对待）；
     * 冷却到点后若距离仍在 `MY_WEB_RANGE_M`（3800 米）外，下面的 ③ 会拒绝张网（保持待发）。
     *
     * ⚠ **4500 与 3800 之间是滞回带**：拉远到 3900~4500 米**不会**掉网（只是张不了新网）。
     */
    if (st.targetTag !== undefined && b.distanceM > webBreakM) {
      const gone = b.units[st.targetTag]?.name ?? st.targetTag
      if (b.foeWebDebuffs) delete b.foeWebDebuffs[st.targetTag]
      delete st.targetTag
      st.cooldownUntilMs = now + cycleMs
      addLog(
        state,
        'combat',
        `墨潮捕获网断开：${gone} 与 ${me.name} 的距离超过 ${webBreakM} 米，` +
          `${me.name} 的网开始冷却。`,
      )
    }
    // ③ 待发且冷却已过 ⇒ 张网（不看命中、独立瞄准、跳过已被钉住的；**超出投网射程不张**）
    if (st.targetTag === undefined && now >= st.cooldownUntilMs && b.distanceM <= webRangeM) {
      const taken = new Set(Object.keys(b.foeWebDebuffs ?? {}))
      const pick = aliveFoes.find((f) => !taken.has(f.tag))
      if (!pick) continue // 无目标可选 ⇒ 保持待发（不空转冷却）
      st.targetTag = pick.tag
      b.foeWebDebuffs = {
        ...(b.foeWebDebuffs ?? {}),
        [pick.tag]: {
          byTag: me.tag,
          slowMul: webSlowMul,
          noThruster: true,
          noEvasion: true,
          atMs: now,
        },
      }
      pushBattleFx(b, { atMs: now, side: 'me', tag: me.tag, to: pick.tag, type: 'kinetic', hit: true, web: true })
      /**
       * 战报正文按**本网自己的减速**说（2026-09-29 起三项读数随件走）：
       * 减速 50% 仍读作「机动减半」，其它倍率读成「机动 ×N」——数字由 `webSlowMul` 现算，不再写死"减半"。
       */
      const slowTxt = webSlowMul === 0.5 ? '机动减半' : `机动 ×${webSlowMul}`
      /**
       * **按族改一句**（**船长 2026-09-30 裁决**：「网钉住 C 族，**按族改一句**」）——
       * C 族的冲锋不吃网的「关推进器」那层（见 `FoeMountDef.charge.webImmune` / `applyFoeWebDebuff`），
       * 所以钉住 C 族时**不写「推进器熄火」**，改说「冲锋不受网的推进器压制」。
       *
       * ⚠ 新写的玩家可见文案走 **id 制**（甲案）：本句 `core.combat.004`，槽 3 的减速那句自己的模板
       * 由 `p3Id` 选（`core.combat.005` = 机动减半 / `core.combat.006` = 机动 ×N，`p3p1` 给倍率）；
       * `text` 仍是中文原串（老档 / 工具断言 / 控制台用）。非 C 族那一句**照旧**（既有文案，不动）。
       */
      /* ⟪文案调整 2026-10-01⟫ 船长报障「不应该直接用X族」：本句中文原写「C 族的冲锋…」（数据侧族
         代号，而英文侧早已用正式族名）⇒ 中文改正式名「异形生物」、英文改权威族名表的 `Alien`
         （同 `core.combat.004` 的两列；口径见 `weekendComms.ts` 的族名表头注）。 */
      const immune = pick.foeChargeWebImmune === true
      addLog(
        state,
        'warn',
        immune
          ? `${me.name} 张开墨潮捕获网，钉住了 ${pick.name}：${slowTxt}、闪避失效，` +
            `异形生物的冲锋不受网的推进器压制——击沉目标或击沉网手才能解除。`
          : `${me.name} 张开墨潮捕获网，钉住了 ${pick.name}：${slowTxt}、推进器熄火、闪避失效——` +
            `击沉目标或击沉网手才能解除。`,
        immune ? 'core.combat.004' : undefined,
        immune
          ? {
              p1: me.name,
              p2: pick.name,
              p3: slowTxt,
              p3Id: webSlowMul === 0.5 ? 'core.combat.005' : 'core.combat.006',
              ...(webSlowMul === 0.5 ? {} : { p3p1: webSlowMul }),
            }
          : undefined,
      )
    }
  }
  // ④ 把当前所有网的效果施加到本拍敌阵上（每拍重建 ⇒ 每拍重施加）
  if (b.foeWebDebuffs) {
    for (const f of foes) {
      const d = b.foeWebDebuffs[f.tag]
      if (d) applyFoeWebDebuff(f, d)
    }
  }
}

function updateFoeCharge(
  b: import('./state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
  desireM: number,
): void {
  const margin = bal.foeChargeTriggerMarginM ?? 1_000
  const arrived = b.distanceM <= desireM
  for (const f of foes) {
    if (f.foeCanCharge !== true) continue
    const rt = b.foeCharges?.[f.tag]
    if (!isAlive(b, f.tag)) {
      if (rt && b.foeCharges) delete b.foeCharges[f.tag]
      continue
    }
    const w = f.weapons[0]
    const inOwnRange = w ? inRange(b.distanceM, w) : false
    const wantCharge = !inOwnRange || b.distanceM > desireM + margin
    if (rt?.on === true) {
      if (arrived) {
        rt.on = false
        rt.cdUntilMs = nowMs + (f.foeChargeCooldownMs ?? bal.foeChargeCooldownMs)
      }
      continue
    }
    if (nowMs >= (rt?.cdUntilMs ?? 0) && wantCharge) {
      if (!b.foeCharges) b.foeCharges = {}
      b.foeCharges[f.tag] = { ...(rt ?? {}), on: true }
    }
  }
}

/**
 * **冲锋解除：自身炮台命中我方**（船长 2026-09-14：「冲锋解除机制为自身攻击命中后解除冲锋状态，
 * 并进入 10 秒冷却」）。
 * ⚠ **只算炮台主武器**（`weapons[0]`）：机群（`src:'drone'`）命中**不算**——那是舰载机打的，
 * 不是"自身炮台"；近防炮同理（防御武器，不在这里结算）。
 */
function releaseFoeChargeOnHit(
  b: import('./state').BattleState,
  tag: string,
  bal: BattleBalance,
  /** 本单位的冲锋冷却覆写（挂载件给的，2026-09-16 船长：A 族海盗 30 秒）——缺省走全局 */
  cdMs?: number,
): void {
  const rt = b.foeCharges?.[tag]
  if (rt?.on !== true) return
  rt.on = false
  rt.cdUntilMs = b.lastTickGameMs + (cdMs ?? bal.foeChargeCooldownMs)
}

/**
 * **单位机动倍率（单点）**——两侧"周期/状态 ⇒ 机动乘子"都从这里取，免得同一段判断散在多处：
 * - **我方**：推进器**周期爆发**（`thrusterPhase`，周期逐单位；点火窗口内 ×(1+`thrusterBoost`)，冷却期 ×1）；
 * - **敌方**：**冲锋**（`b.foeCharges[tag].on` ⇒ ×(舰级 `foeChargeMul` ?? 全局 `bal.foeChargeMul`)）。
 *
 * 两侧都只乘进**自己那一项**：编队速度 = "逐单位乘各自倍率 → 取平均"（见 `stepBattle`），
 * 故倍率**不外溢**到队里别的船。
 * ⚠ 只合并这一层：**冲锋的状态机**（事件驱动：命中解除 / 到达解除 / 冷却）与**推进器的相位**
 * （时钟推导：`elapsed % 周期`）不是一回事，各自的"何时开、何时关"留在原处，不硬并成一个函数。
 */
function unitSpeedMulOf(
  u: UnitSpec,
  b: import('./state').BattleState,
  bal: BattleBalance,
  side: 'me' | 'foe',
): number {
  if (side === 'me') {
    const boosting = thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
    return 1 + (boosting ? (u.thrusterBoost ?? 0) : 0)
  }
  if (b.foeCharges?.[u.tag]?.on !== true) return 1
  return u.foeChargeMul ?? bal.foeChargeMul
}

/** 正在冲锋的敌单位条数（界面标记用）。⚠ 只数**存活**：阵亡单位的状态在同一拍已清掉，这里再兜一层 */
export function foeChargeCount(
  b: Pick<import('./state').BattleState, 'foeCharges' | 'units'>,
): number {
  let n = 0
  for (const [tag, rt] of Object.entries(b.foeCharges ?? {})) {
    if (rt?.on !== true) continue
    const u = b.units[tag]
    if (!u || !(u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)) continue
    n += 1
  }
  return n
}

/** 敌方编队主伤害类型（V17 导出；卡面 dmgMix 取最高权重，缺省 = 动能）——悬赏卡展示/玩家配抗参考
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts，本文件再导出） */

/**
 * 敌方**火力构成**（2026-09-10 船长：混伤）——战斗、胜率预估与界面**同源单点**：
 * 返回按份额降序的 `[{ type, share }]`（份额归一化、和 = 1）。
 * - 写了两系及以上（常驻悬赏/低安遇袭 8:2、窝点派生 6:4）→ 逐系份额；
 * - 只写一系 / 未写（教学卡）→ 单条 `{ 主系, 1 }`（纯系）。
 *
 * **2026-10-02 破环搬家**：`compositionOfMix` / `foeDamageComposition` 两件搬到 `wormholeFoes.ts`
 * （那里是它们唯一的跨模块消费者；combat↔wormholeFoes 的运行期环只剩 `foeDamageComposition` 这一条边，
 * 搬走即断）。这里**原样再导出**保持既有 `from './combat'` 引用不变（先例：fitted.ts）。
 */
export { compositionOfMix, foeDamageComposition } from './wormholeFoes'
import { foeDamageComposition } from './wormholeFoes'

/**
 * 把一次开火的总伤害按火力构成**拆成逐系单发**（2026-09-10：窝点混伤）。
 * 取整口径：先按份额分配、**最后一条吃余数**，保证 Σ = 总单发（敌总伤不变，只改构成）。
 * 返回空数组 = 总伤为 0（调用方跳过）。
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts，本文件再导出） */

/** 敌方血型层占比（V17.2 导出；悬赏卡"敌型"展示——与 createFoeSpecs 同源）：
 * 盾型 50/25/25 · 甲型 20/55/25 · 均衡 33/33/33（盾/甲/结构）
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts，本文件再导出） */

/** 构建我方单位静态卡（V18 多件语义：全位装配生效——多炮/多矿枪/盾甲多件/无人机装置；null = 船记录缺失） */
/** 我方规格快照（手动/AI/MC/预估同源）。
 * ammoIds（弹药 MK2，2026-09-09）：战斗内实装弹 id 覆盖（缺货回退等）——
 * 推进/视图重建传 battle.ammoIds 使伤害与实装弹种一致；缺省 = 船装配 ammoPref，再缺省 = 基础弹。 */
/* ══════════ 2026-09-27 船长令：R4/R5 上位技能批 · 战斗侧乘数单点 ══════════
 * 每级值 = 父技能每级 ÷ 3；全部与父技能**同乘区乘算**。数值与技能 id 写在同一句里，
 * 既是唯一真相源，也让「技能说明契约」的现场复核（±400 字内找每级值）稳定命中。
 * （2026-10-02 批次 4g-1 迁到 playerSpec.ts，本文件借回 + 再导出） */


/** 我方主武器固定弹种（V18 多炮：取高槽第一门武器（炮台/导弹架）的 damageType；无武器
 * 也返回 kinetic——基础舰炮实际不消耗弹药）。多门异弹型武器的装载/消耗在出发预载时按
 * 主武器型装载（battle.ammo 单型；异型武器在主弹种耗尽后停火，见 E 台阶 per-gun 完整化）。
 * （2026-10-02 批次 4g-1 迁到 playerSpec.ts，本文件再导出） */


/**
 * **谜质 B1：我方静态增益**（F3c · 船长 2026-09-13）——**只在洞内战斗**里调用。
 *
 * 六类，全部按"从货仓现算"的派生值施加：
 * - **抗性**：对**敌队主伤害系**（单层单系）走既有"缺口削减"合成 `1 − (1−基础)×(1−值)`，
 *   三层各自上限 **0.9 不变**（不新增旋钮）；
 * - **命中 / 回避**：直接加（回避的**加成**在派生端已 +0.25 封顶）；
 * - **射程**：只放大 `maxRangeM`（放大 `minRangeM` 等于把近盲带往前推，反而吃亏 ⇒ 不放大）；
 * - **单发伤害**：与"全舰单发伤害光环"同款改法（`shotDmg` / `shotsByType` 同乘）；
 * - **装填周期**：周期 ×(1 − 削减)，物理下限 50ms（不封顶，但周期不能到 0）。
 */
export function applyMatterPlayerBuffs(spec: UnitSpec, b: WormholeMatterBuffs, foeMain: DamageType): void {
  /**
   * ⚠ **不要在这里按"装置台数"提前返回**（2026-09-19 修 · 船长实测会让"只点科技"完全无效）：
   * 原实现是 `if (b.devices === 0) return`，而 `devices` **只数货仓里的谜质装置台数**——
   * 谜质科技贡献（同一只袋子，字段由 `wormholeMatterBuffs` 合并进来）**不带装置也应当生效**。
   * 实测：3 级测距延展（+12%）在"0 台装置"时最长射程 7,350m **一动不动**，带 1 台装置才 8,232m。
   *
   * 现在**不设提前返回**：下面逐项都自带"零值即跳过"的判断（`add <= 0` / `!== 1` 等），
   * 空袋子（`WORMHOLE_MATTER_BUFFS_NONE`）走一遍等于没走 ⇒ 行为与"提前返回"逐字一致。
   * 同类事故第二次：第一次在 `wormholeMatterBattleModsOf`（同日已修），教训 = **袋子是"装置 + 科技"两只
   * 来源合并的，任何按单只来源判空的早退都会把另一只来源一起吞掉**。
   */
  spec.hitBonus += b.hitBonus
  if (b.evasion > 0) spec.evasion = spec.evasion + b.evasion
  const applyResist = (layer: 'shield' | 'armor' | 'hull', add: number): void => {
    if (add <= 0) return
    const cur = spec.resists[layer]
    const base = cur?.[foeMain] ?? 0
    const v = Math.min(0.9, 1 - (1 - base) * (1 - add))
    spec.resists[layer] = { ...(cur ?? {}), [foeMain]: v }
  }
  applyResist('shield', b.resistShield)
  applyResist('armor', b.resistArmor)
  applyResist('hull', b.resistHull)
  const rangeMul = 1 + b.weaponRangePct
  const dmgMul = 1 + b.damagePct
  const reloadMul = Math.max(0.1, 1 - b.reloadPct)
  for (const w of spec.weapons) {
    if (rangeMul !== 1) w.maxRangeM = Math.round(w.maxRangeM * rangeMul)
    if (dmgMul !== 1) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * dmgMul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * dmgMul
        }
      }
    }
    if (reloadMul !== 1) w.reloadMs = Math.max(50, Math.round(w.reloadMs * reloadMul))
  }
}

/**
 * **谜质在开战那一刻的快照**（F3c B1）：威胁乘数（按用途三档、各自 −50% 封顶）/ 敌队主伤害系 /
 * 敌方削弱两项。**只在洞内战斗里调用**（`state.wormhole.run?.hold` 就是本趟的装置）。
 *
 * ⚠ **2026-09-19 修**：科技树与装置是**同一个增益袋**，本快照必须**一并吃科技**
 * （原实现只传装置、且开头 `devices === 0` 直接返回 `null` ⇒ 「压制力场增幅 / 守卫解析 /
 * 信号噪化 / 近盲抑制」四个节点**只点科技、不带装置时完全无效**：真死线，本批修）。
 * 是否返回快照一律由下方 `any` 判据说话——它已逐项覆盖科技与装置的全部战斗字段。
 */
export function wormholeMatterBattleModsOf(
  state: GameState,
  ctx: SimContext,
  baseCard: AnomalyDef,
  kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn',
): { threatMul: number; foeMainType: DamageType; foeHitDown: number; blindReduce: number; volleyOverflow: boolean } | null {
  const buffs = wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx))
  const bucket: 'node' | 'boss' | 'extract' = kind === 'boss' ? 'boss' : kind === 'extract' ? 'extract' : 'node'
  const threatMul = wormholeMatterThreatMul(buffs, bucket)
  /**
   * **只有真会改变战斗结果的装置才返回快照**（否则返回 `null` ⇒ 走改动前的老路径、存档形状也不变）：
   * 探索与作业类装置（测绘仪 / 时序核心 / 起重机 / 钻机 / 星云 / 富集器 / 扩展器）不影响战斗。
   */
  const any =
    threatMul < 1 ||
    buffs.enemyHitDown > 0 ||
    buffs.blindReduce > 0 ||
    buffs.resistShield > 0 ||
    buffs.resistArmor > 0 ||
    buffs.resistHull > 0 ||
    buffs.hitBonus > 0 ||
    buffs.evasion > 0 ||
    buffs.weaponRangePct > 0 ||
    buffs.damagePct > 0 ||
    buffs.reloadPct > 0 ||
    buffs.volleyOverflow
  if (!any) return null
  return {
    threatMul,
    foeMainType: foeMainDamageType(baseCard),
    foeHitDown: buffs.enemyHitDown,
    blindReduce: buffs.blindReduce,
    volleyOverflow: buffs.volleyOverflow,
  }
}

/**
 * **本场我方的单位规格**（虫洞 D 批 · 每拍重建）：
 * - **单船路径**（`battle.myFleet` 未写）：等价于改动前的单点 `createPlayerSpec(shipId)` + 教学战加成；
 * - **多单位路径**（写了）：按 `myFleet` 逐条重建（各自装配/技能/血条/装填），并把 `tag` 覆盖成
 *   编队标识（`player` / `ally-N`）。**弹药按同一份 `battle.ammoIds` 口径**（共用池的"主控优先档口"，
 *   见 `startFleetBattleFor` 注释）。
 * 返回**空数组** = 主力船记录缺失（调用方按判负收场，与改动前 `!me` 同路径）。
 */
function buildMyUnitSpecs(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  shipId: string,
  anomalyId: string | null,
  /**
   * **本场敌阵的单位规格**（2026-09-24 加；缺省不传）——只用于算**敌方干扰舰的射程压制率**
   * （`meRangeMulOf`：净削减率 = 我方电子舰 + 敌方干扰舰，相加抵消）。不传 = 无压制（老行为）。
   */
  foes?: readonly UnitSpec[],
): UnitSpec[] {
  const fleet = battle.myFleet
  /**
   * **谜质 B1**：洞内战斗的每拍重建也要吃同一份增益（否则"开战吃、之后几拍又吐回去"）。
   * 快照里的 `foeMainType` 决定三张谐振片对哪一系加抗性。
   */
  const wh = battle.wormhole
  const matterBuffs = wh ? wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx)) : null
  const matterFoeMain: DamageType = wh?.foeMainType ?? 'kinetic'
  /**
   * **干扰压制的基准账**：逐件记「基准射程 + 该系加成倍率」，供 `applyMeJammerDebuff` 按船长
   * **加法口径**（`1 + bonus − 净削减`）反解施加系数。缺省不传时该函数退化为"相对当前射程直接乘
   * `1 − 净`"（= 只对不带任何射程加成的武器正确）⇒ 所以这两条路径**必须传**。
   */
  const jammerRefs: { weaponRanges?: Array<{ baseM: number; bonusMul: number }> } = { weaponRanges: [] }
  if (!fleet || fleet.length === 0) {
    const me = createPlayerSpec(state, ctx, shipId, battleAmmoIdsFor(battle, 'player'), jammerRefs)
    if (!me) return []
    if (matterBuffs) applyMatterPlayerBuffs(me, matterBuffs, matterFoeMain)
    // **捕获网**（船长 2026-09-16）：每拍重建后重新施加（否则下一拍就"复活"）
    const web0 = battle.meWebDebuffs?.[me.tag]
    if (web0) applyMeWebDebuff(me, web0)
    // **敌干扰压制**（H 族墨潮干扰舰 · 2026-09-24）：与我方电子舰的削减相加抵消后缩小我方射程
    // ⚠ 传的是**净削减率**（0.35 = 压掉三成半），不是射程系数（2026-09-26 修正）
    applyMeJammerDebuff(me, meJammerNetOf(battle, foes ?? []), jammerRefs.weaponRanges)
    // 「第一次完成悬赏」的照会战加成（演习场 + 主控 + 任务未完成；每拍规格重建处注入）
    if (isFirstBountyBattle(state, anomalyId, shipId)) applyFirstBountyBuff(me)
    // **指挥舰全舰单发光环**（2026-09-17 修：原先只在开战那一刻乘 ⇒ 被每拍重建冲掉、从未生效）
    applyFleetDamageAura([me], 1 + fleetDamageAuraOf(state, ctx, [shipId]))
    applyAlienCorrosion(me, battle.alienCorrosion ?? 0)
    return applyFleetLockAura([me])
  }
  const out: UnitSpec[] = []
  for (const entry of fleet) {
    const shipRefs: { weaponRanges?: Array<{ baseM: number; bonusMul: number }> } = { weaponRanges: [] }
    const spec = createPlayerSpec(state, ctx, entry.shipId, battleAmmoIdsFor(battle, entry.tag), shipRefs)
    if (!spec) continue
    if (matterBuffs) applyMatterPlayerBuffs(spec, matterBuffs, matterFoeMain)
    spec.tag = entry.tag
    if (entry.tag === 'player' && isFirstBountyBattle(state, anomalyId, entry.shipId)) {
      applyFirstBountyBuff(spec)
    }
    // **捕获网**（船长 2026-09-16）：同上，逐舰按账本施加
    const web = battle.meWebDebuffs?.[entry.tag]
    if (web) applyMeWebDebuff(spec, web)
    // **敌干扰压制**：逐舰施加（同上——每拍重建后重新施加，否则下一拍就"恢复"）；同样传**净削减**
    applyMeJammerDebuff(spec, meJammerNetOf(battle, foes ?? []), shipRefs.weaponRanges)
    out.push(spec)
  }
  // **指挥舰全舰单发光环**：全队取最高一份、不叠加（同批修：见 `applyFleetDamageAura` 的注释）
  applyFleetDamageAura(out, 1 + fleetDamageAuraOf(state, ctx, fleet.map((e) => e.shipId)))
  for (const spec of out) applyAlienCorrosion(spec, battle.alienCorrosion ?? 0)
  return applyFleetLockAura(out)
}

/**
 * **目标锁定阵列：增伤与集火「全队生效」**（船长 2026-09-17：「**增伤改为全队生效。**」＋「**集火也是全队生效**」）——
 * 编队内任一舰装了 `lockDmgBonus` 件 ⇒ **全队取最高一份**（各舰先按自己那几件走 `curveMult` 收敛、再取最大），
 * 全队每舰的 `lockedDmgBonus` 都置为该值（船长裁定甲：与指挥舰「全队单发 +15% 取最高不叠加」同口径）。
 *
 * 为什么放在这里而不是只写一次：该字段在 `stepBattle` 里**一处驱动两件事**——
 * ① **集火**「存活编队首位」（`unit.lockedDmgBonus ? firstAliveFoe : randomAliveFoe`：主舰优先、击毁接力）；
 * ② **增伤**：本舰伤害 ×(1 + 值)（只对"打舰"生效；打敌机不吃，见 `stepBattle` 的机群分支）。
 * ⇒ 置满全队 = 增伤与集火**同时**全队化。而战斗是**逐拍重建规格**的（`buildMyUnitSpecs`）⇒ 必须在这一处施加，
 * 与「谜质增益 / 捕获网 / 教学战加成」同一处纪律（只写在开战那一刻会被下一拍冲掉）。
 *
 * **零份 ⇒ 一个字段都不写**（没装阵列的编队逐字不变）；**单舰路径取到的就是它自己 ⇒ 逐字等价**
 * （远征单人 / 遭遇战 / 虫洞单舰的读数不受影响）。件数值（8/12/20/30%）一个不动，**零存档迁移**。
 */
function applyFleetLockAura(specs: UnitSpec[]): UnitSpec[] {
  let best = 0
  for (const s of specs) best = Math.max(best, s.lockedDmgBonus ?? 0)
  if (best > 0) for (const s of specs) s.lockedDmgBonus = best
  return specs
}

/**
 * **指挥舰「全舰单发伤害 ×(1+光环)」光环的取用口径**（原 +15%，2026-09-26 起陵卫/虎鲸两艘都是 +20%）：编队（或单舰）里**取最高一份**、**不叠加**
 * （2026-09-13 船长口径：「提高全舰的单发伤害 15%」＋"多艘同类只取最高"，与"同项取优"惯例一致）。
 * 数据来源 = `ShipDef.fleetDamageBonusPct`（2026-09-26 起两艘：陵卫指挥舰 0.20 · 虎鲸级指挥舰 0.20）。
 */
function fleetDamageAuraOf(state: GameState, ctx: SimContext, shipIds: readonly string[]): number {
  return Math.max(
    0,
    ...shipIds.map((sid) => {
      const defId = state.fleet[sid]?.defId
      return (defId ? ctx.ships.get(defId)?.fleetDamageBonusPct : 0) ?? 0
    }),
  )
}

/**
 * **把全舰单发光环乘进这一份规格的每条武器**（`mul` = 1 + 光环值；`<= 1` 直接跳过）。
 *
 * ⚠ **2026-09-17 修一个真 BUG（船长「本批一起修」）**：这段乘算原先是**内联写在
 * `startFleetBattleFor` 里的**——只乘**开战那一刻**的规格，而战斗是**逐拍重建规格**的
 * （`buildMyUnitSpecs` → `createPlayerSpec`，后者不认识 `fleetDamageBonusPct`）⇒ 那些被乘过的值
 * **一拍都没用上**，指挥舰的光环自始至终是**死代码**。真引擎 A/B 取证（同编队同种子、只差光环船那 15%、
 * 双方都不死比每发均值）：带光环 **每发 91.640 / 命中 25** 与无光环**逐位相同** ⇒ 比值 **1.000**
 * （生效应 ≈1.15）。⇒ 现在统一由**每拍重建处**（`buildMyUnitSpecs`）调用，`startFleetBattleFor`
 * 也调一次同一函数（开战首拍的规格同源，避免两处各写一份乘算）。
 */
function applyFleetDamageAura(specs: readonly UnitSpec[], mul: number): void {
  if (mul <= 1) return
  for (const spec of specs) {
    for (const w of spec.weapons) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * mul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * mul
        }
      }
    }
  }
}

/**
 * 到港开战通用组装（主控与 AI 共用）：建状态 + 预载弹药；返回 battle 或 null（记录缺失）。
 * atGameMs = 开战时刻（应传"到港时刻"，让离线大推进能把后续时间全部推完）。
 * desireM = 玩家期望距离偏好（缺省 = 主武器有效射程中点）。 */
/** 本场战斗的目标卡（2026-09-10）：赏金任务·窝点按 tier 现场派生强化卡（威胁/波次/僚机/名称）；
 *  敌对派系活跃（factionActive）= 当日选中星系的常驻悬赏威胁 ×1.1；
 *  普通悬赏、低安遭遇（都没设）一律返回原卡。战斗构建、推进、展示共用此口，避免口径漂移。 */
export function battleAnomalyOf(
  ctx: SimContext,
  anomalyId: string | null | undefined,
  lairTier?: LairTier,
  factionActive?: boolean,
): AnomalyDef | undefined {
  const base = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  if (!base) return undefined
  const card = lairTier ? lairAnomalyOf(base, lairTier, ctx.balance.battle) : base
  return factionActive ? factionAnomalyOf(card) : card
}
/**
 * **敌群强度覆写**（2026-09-23 周末入侵）：给"从卡派生敌群"的两条开战入口一个**可选覆写口**——
 * 入侵的威胁/波数是**绝对值**（旗舰 120 威胁 · 4 波 · 每波 4 艘），而卡表里的卡自带自己的强度，
 * 不覆写就只能打成"原卡强度"。**不传 = 一字不变**（既有调用方与读数不受影响）。
 */
export interface FoeOverride {
  threat?: number
  waves?: ReadonlyArray<{ units: number; hpShare: number }>
  /**
   * **保留卡自带的波表**（2026-09-24 加；船长给定 H 族入侵卡"每波各自编成"时要用）：
   * 置真 ⇒ `waves` **不覆盖**卡上的 `waves`（卡自己声明了 4 波各自的编成与波血）。
   * 缺省假 = 老行为（覆写波表，如入侵原先固定的"4 波 × 4 艘"）。
   */
  keepCardWaves?: boolean
  /**
   * **真·强度倍率**（2026-09-25 船长令「**遇袭的时候遭遇的敌人按强度 ×0.75 算**」）：
   * 把每条 `ships[]` 的 `hpMul`/`dmgMul` 同乘该倍率（血与火力同缩 ⇒ `X` 同缩），
   * `firepowerAnchor` 一并按倍率缩放（同"重定价批"的落法）。
   *
   * ⚠ **它只改属性，不改标签**：调用方若要把标签写对，必须接着用 `foeThreatOfAnomaly(缩放后的卡, 系数, bal)`
   * 反解（本函数不碰 `threat`，避免"标签 ≠ 实测价"）。
   * 缺省 / 非正 / 等于 1 ⇒ 不缩放（零行为变化）；**只对舰级路径（写了 `ships[]`）生效**
   * （旧路径卡的强度由威胁曲线表达，本倍率对它无意义）。
   */
  strengthMul?: number
  /**
   * **BOSS 血条覆写**（2026-09-25 船长令「甲：母舰血条 = 池子剩余」）：
   * 把 `ships[]` 里 `ship.id === bossShipId` 的那条目 `hpMul` 覆写成 `bossHp ÷ 舰级血`
   * ⇒ 该单位建档后的**满血 = `bossHp`**（三层按该条目的血型分摊）。缺省/非正/缺 `bossShipId` ⇒ 不动。
   *
   * ⚠ **在 `strengthMul` 之后施加且取绝对值**（BOSS 血条由池子说了算，不再吃强度倍率）；
   * 覆写会随档存进 `BattleState.foeOverride` ⇒ 逐拍重建母舰时血条恒等于池子剩余。
   */
  bossHp?: number
  /**
   * **BOSS 血条的"上限读数"**（船长 2026-09-25：「**母舰哪怕残血，在战斗中血上限依旧保持不变**」）：
   * `bossHp` 是**这一场的满值**（= 开战那一刻的池子剩余），池子被打薄之后它就变小 ⇒ 若直接拿它当
   * 血条分母，最后几仗会显示成"满血母舰"（读数与"母舰已经很残"矛盾）。
   * ⇒ 本字段写**池子总量**（恒定），只用于**界面血条的分母**（`battleArcsFor` 的 `maxHp.foe`）：
   * 战斗里那条血 = `当前 ÷ 池子总量`（残血就是残血）。
   *
   * ⚠ **只动显示**：单位自己的 `hpMax`（引擎满值）与伤害台账（`flagshipBattleLedger` =
   * `ΣhpMax − Σhp`）一个字不改——否则跨场累计会重复计伤害。
   * 缺省 / 非正 / 不大于本场满值 ⇒ 不缩放（零行为变化）。
   */
  bossHpMax?: number
  /**
   * **母舰"当前"三层血**（船长 2026-09-25 令：「**母舰当前血条不要按照三个等比扣除，应该按照
   * 护盾-装甲-结构的顺序扣除**」）——由 `weekendEvent.weekendFlagshipLayersOf` 按"池子剩余从最后一层
   * 往回灌"算好传进来（护盾先空、再装甲、最后结构）。
   *
   * 落法 = 把 `ships[]` 里 BOSS 那条目的 **`split` 覆写成 `bossHpLayers ÷ bossHp`**
   * ⇒ 建档后三层血**逐个等于**本字段（`hp = 总量 × split`）。
   * ⚠ 这**不只是显示**：`applyDamage` 逐层乘"层克制 × (1−该层该系抗性)"⇒ 分层血量决定每发实收伤害。
   * 缺省 ⇒ 仍按卡面 `split` 等比分摊（老档/其它卡零变化）。
   */
  bossHpLayers?: { s: number; a: number; h: number }
  /**
   * **母舰三层血的容量**（= 池子总量 × 卡面 `split`）：**界面血条三行的分母**（恒为池子口径，
   * 不随剩余缩水）——与"当前值"（`bossHpLayers`）分开给，界面**不许**拿当前值反推分母。
   */
  bossMaxLayers?: { s: number; a: number; h: number }
  /** 哪一条舰级当 BOSS（配 `bossHp` 用；缺省 = 不覆写） */
  bossShipId?: string
}

/** 把覆写应用到派生出来的敌卡上（纯函数；`override` 缺省或字段缺省 ⇒ 原样返回） */
export function applyFoeOverride<T>(anomaly: T, override?: FoeOverride): T {
  if (!anomaly || !override) return anomaly
  const next = { ...(anomaly as Record<string, unknown>) }
  if (override.threat !== undefined && Number.isFinite(override.threat)) next.threat = Math.max(1, Math.round(override.threat))
  if (override.keepCardWaves !== true && override.waves !== undefined && override.waves.length > 0) next.waves = override.waves
  const strengthMul = override.strengthMul
  if (strengthMul !== undefined && Number.isFinite(strengthMul) && strengthMul > 0 && strengthMul !== 1) {
    const ships = next.ships
    if (Array.isArray(ships)) {
      next.ships = ships.map((raw) => {
        const slot = raw as { hpMul?: number; dmgMul?: number; firepowerAnchor?: number }
        const out: Record<string, unknown> = {
          ...slot,
          hpMul: (slot.hpMul ?? 1) * strengthMul,
          dmgMul: (slot.dmgMul ?? 1) * strengthMul,
        }
        // 总火力锚点（写了才有）：按同一倍率缩放——**不许按自然合计重算**（它是船长有意钉住的总量；例外只有取整平局）
        if (slot.firepowerAnchor !== undefined) out.firepowerAnchor = Math.max(1, Math.round(slot.firepowerAnchor * strengthMul))
        return out
      })
    }
  }
  /**
   * **BOSS 血条覆写**（在强度倍率之后 · 取绝对值）：`hpMul = bossHp ÷ 舰级血` ⇒ 建档满血 = `bossHp`。
   * 池子里"玩家已打掉的量"不在这里扣（那由 `weekendFlagshipHpRemaining` 在开战时算好传进来）。
   */
  const bossHp = override.bossHp
  const bossShipId = override.bossShipId
  if (bossHp !== undefined && Number.isFinite(bossHp) && bossHp > 0 && typeof bossShipId === 'string' && bossShipId.length > 0) {
    const ships = next.ships
    if (Array.isArray(ships)) {
      next.ships = ships.map((raw) => {
        const slot = raw as { ship?: { id?: string; hp?: number } }
        if (slot.ship?.id !== bossShipId) return raw
        const classHp = Math.max(1, slot.ship.hp ?? 1)
        /**
         * ⚠ **三层血按 护盾 → 装甲 → 结构 的顺序扣**（船长 2026-09-25）：`bossHpLayers` 是"当前值"，
         * 拆成 `split` 覆写 ⇒ 建档后 `hp = bossHp × split` 逐层等于它；没给 ⇒ 保持卡面 `split`（等比分摊）。
         */
        const layers = override.bossHpLayers
        const layerSplit =
          layers !== undefined
            ? { s: Math.max(0, layers.s) / bossHp, a: Math.max(0, layers.a) / bossHp, h: Math.max(0, layers.h) / bossHp }
            : undefined
        return { ...(raw as object), hpMul: bossHp / classHp, ...(layerSplit !== undefined ? { split: layerSplit } : {}) }
      })
    }
  }
  return next as T
}

export function startBattleFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  /**
   * 目标距离：`number > 0` = 显式指定；**`null` = 强制"射程中段"、不吃该星系的玩家设定**
   * （2026-09-11 船长「只有主控吃」⇒ AI 副船走这一档）；`undefined` = 用该星系设定、没设过则射程中段。
   */
  desireM?: number | null,
  /** **敌群强度覆写**（2026-09-23 入侵用：伏击 39/60；缺省 = 原行为，一字不变） */
  foeOverride?: FoeOverride,
): import('./state').BattleState | null {
  if (!anomalyId) return null
  const anomaly = applyFoeOverride(battleAnomalyOf(ctx, anomalyId, state.expedition.lairTier, state.expedition.factionActive), foeOverride)
  // **记下这一场的敌方舰级**（船长 2026-09-16：首次遭遇劫掠电子舰后发通讯）
  if (anomaly) noteFoeShipsSeen(state, anomaly)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  /**
   * **满值上限**（血条分母）——必须在**承伤持久化之前**留一份。
   *
   * ⚠ 2026-09-14 修船长报障「**虫洞战斗中，我方舰船的血量上限显示不正确**」：洞内多舰路径把
   * `hpMax` 取自**打完折之后**的规格（下面那两行 `me.hp.a *= armorMul`），于是"上限"跟着场间残余
   * 一起缩水（装甲剩 60% ⇒ 血条分母只有满值的 60%、开局读作满格）；而**单船路径的视图上限**
   * （`battleArcsFor` 的 `maxHp.me`）用的是**现建的满值规格** ⇒ 洞外 60%、洞内 100%，两条路不一致。
   * 语义定案：**上限恒为该舰的满值**，承伤持久化只打"当前值"（与护盾每场满值重建同一条口径）。
   */
  const meFullHp = { ...me.hp }
  // P0 承伤持久化：装甲/结构（=耐久合并属性）按场间残余开局；护盾每场满值重建
  const fleetShip = state.fleet[shipId]
  if (fleetShip) {
    const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
    const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
    me.hp.a = Math.max(0, me.hp.a * armorMul)
    me.hp.h = Math.max(0, me.hp.h * hullMul)
  }
  // 照会战加成（开战规格重建处也注入，命中/回避影响后续弹道与 UI 读到的克制无涉）
  if (isFirstBountyBattle(state, anomalyId, shipId)) applyFirstBountyBuff(me)
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 期望距离：显式传入（出发时的偏好/战术）优先；`null` = 强制默认档（AI 副船）；否则用
  // **该星系的目标距离**；该星系没设过 → **默认档 = 主武器射程带 0.8 处**（2026-09-15 船长裁定，
  // 旧"射程中段"作废：远程武器默认要站远端，见 `balance.battle.desireBandMid`；星图与洞内同值）。
  // 记忆可能来自更远射程的战斗：一律钳到本次开战距离内。
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal)
      : desireM !== undefined && desireM > 0
        ? Math.round(desireM)
        : (desirePrefOf(state, anomaly.galaxyId) ?? desiredRangeFor(me, 'mid', bal))
  const desire = Math.min(openM, Math.max(bal.minDistanceM, rawDesire))
  /**
   * 🔴 **R 族族格：以"玩家的射程盲区"为期望距离**（**船长 2026-10-01 三次澄清 · 正解**，原话照抄）：
   *
   * > 「**这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。等于R族敌人会寻找
   * > 玩家的射程漏洞，玩家如果射程短，则R族采取风筝玩家，如果玩家射程长，有近盲区，则R族会主动贴身。**」
   *
   * 口径与落点见 `rFamilyDesireOf` 的头注；**非 R 族一律不动**（返回 `null`）。返回 `null` ⇒
   * 期望距离与开战距离都逐字走原口径。
   */
  const rDesire = rFamilyDesireOf(me, foes, bal)
  const battle = createBattleState(me, foes, atGameMs, desire)
  /**
   * **把本场的敌群覆写照原样存下**（2026-09-25 修）：`advanceBattleFor` 每拍从 `ctx` 重建敌卡，
   * 不存就会**只有第 0 波吃到覆写**——多波卡的后续波会回到满强度（H 族遇袭 ×0.75 的 2 波卡首当其冲）。
   */
  if (foeOverride !== undefined) battle.foeOverride = foeOverride
  /**
   * **把血条分母修回满值**（2026-09-14 修船长报障「虫洞战斗中，我方舰船的血量上限显示不正确」）：
   * `createBattleState` 是按"传入规格"写 `hp`/`hpMax` 的，而上面已经把规格的装甲/结构按场间残余打过折
   * ⇒ 分母跟着缩水。这里显式改回**满值**，只让 `hp`（当前值）吃那份折扣。
   */
  const meRt0 = battle.units['player']
  if (meRt0) meRt0.hpMax = meFullHp
  // **电子舰 · 压制敌舰射程**（2026-09-18）：单船路径同样按编队（= 它自己）算一次
  applyFoeRangeDebuff(state, ctx, battle, [shipId])
  announceStealthStart(battle) // 隐秘行动装置：开战那一刻的提示条（没装装置的场次不推）
  announceSupportCallStart(battle, foes) // 支援呼叫装置：开战即告诉玩家"有一支援军在路上"（没挂的不推）
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  /**
   * 🔴 **开场距离 = `openM`，与族格/期望距离/按星系记忆一律无关**（**船长 2026-10-03 报障修**：
   * 「**开场双方距离的规则已经很明确了，现在的情况是BUG**」）。
   *
   * 规则出处 = `docs/design/desire-band-20260915.md`（船长 2026-09-15 裁定）：
   * ① 开场距离 = `battleOpenM` = 双方所有武器最远射程 ×1.0 ＋ 缓冲 `max(100m, 10%)`；
   * ② 期望距离只决定**稳态**（"t=30s 起停在期望位"）；
   * ③ 该文档 §二 的「**明确不动的**」清单第一条就是**开战距离公式**。
   *
   * ⚠ **旧写法**（2026-10-02 及以前）：`battle.distanceM = rDesire ?? openM` —— R 族场次**用族格值
   * 当开场距离** ⇒ **一开场就贴脸**（船长实测：回音荒区 512 m），把上面规则 ① 顶掉了。
   * R 族"主动贴身"应当是**它自己走过来**（`foeDesireRangeM` 那一支照旧钉着），不是"开局就站在脸上"。
   */
  battle.distanceM = openM
  /**
   * 🔴 **R 族族格：只钉"敌人自己"的期望距离**（**船长 2026-10-01 正解原话**：
   * 「**这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。**」）。
   *
   * ⚠ **旧写法还多改了一行 `battle.myDesireM = rDesire`**（用**敌人**的偏好去改**我方**的期望距离）
   * ——与船长的澄清**直接冲突**（等于 R 族场次里玩家拖距离条/按星系记忆全都不算数）⇒ **2026-10-03 删掉**。
   * 我方期望距离照旧走既有的三级链：显式传入 → 按星系记忆 → 默认档 `desireBandMid`。
   */
  if (rDesire !== null) {
    // 把 R 族自己那几艘的期望距离钉到"我方射程盲区"位置（`foeDesiredRange` 读 `foeDesireRangeM`）
    for (const f of foes) if (f.family === 'R') f.foeDesireRangeM = rDesire
  }
  // V18B-2：per-gun 多键预载——动能/爆破导弹/能量弹药各按自身装填估量装载
  // （纯激光船也能带上能量弹药；混装各型互不挤占）
  // 2026-09-09 弹药 MK2：按船装配档位（ammoPref）装载；**取档口径 2026-09-16 船长改判**——
  // 同族取"能装得最多"的那一档、允许装不满（细则见 `loadAmmoTier`）。
  // ⚠ `battle.ammoIds` **只要有实装就记实际档**（哪怕实际档 = 基础弹）：推进重建（`ammoIdFor`）
  //   与退还都按它走 —— 若这里漏记，重建会回落到 `ammoPref`（= MK2 口径伤害）而实际烧的是基础弹。
  const totals = ammoLoadTotals(me, bal, state)
  const ammoIds: Partial<Record<DamageType, string>> = {}
  for (const [t, n] of Object.entries(totals)) {
    const type = t as DamageType
    const key = ammoKeyOf(type)
    // 2026-10-02 批次 4i：ammoLoadTotals 迁出后其 Partial 返回的 entries 值类型在模块边界解析为
    // `number | undefined`；运行期 out 只写数字键 ⇒ `n ?? 0` 为纯类型微调、零行为变化
    const res = loadAmmoTier(state, ctx, shipId, type, n ?? 0)
    battle.ammo[key] += res.loaded
    if (res.loaded > 0) ammoIds[type] = res.id
    if (res.fellBack && res.loaded > 0) {
      addLog(state, 'warn', ammoTierFallbackLog(state, ctx, shipId, type, res.id, res.loaded))
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：记一份，战后按「预载 − 余额」算这一场打出去多少
  battle.ammoLoaded = { ...battle.ammo }
  // 机群生存池（2026-09-10 船长「无人机可被击落」）：**逐舰**建池（2026-09-14 船长「逐舰机群」），
  // 键 = `舰tag:武器下标`；只有 src='drone' 的条目参战。
  const pools: Record<string, import('./state').DronePoolEntry> = {}
  // 无人机线技能（2026-09-10 船长）：耐久学（基础档）与强化学（进阶档）**乘算**放大三层血
  // （"全血条"）、规避学提闪避（封顶 0.9）
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  buildDronePoolsFor(ctx, me, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    battle.droneLost = {}
    battle.droneLostBy = {}
    // 开战清单快照（战后判定"机群战损过半"→ 停重复清剿用）：单船路径只有主控一份
    const load = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
    battle.droneLoadAtStart = load
    battle.droneLoadAtStartBy = { [me.tag ?? 'player']: load }
    // **无人机储备甲板建档**（2026-09-27 船长令）：装了这件才开账（没装 ⇒ 一个字段都不写）
    // ⚠ **先拍库存快照**（复活预算，全队一本），再建逐舰的队列/周期账 —— 快照要读 `battle.dronePools`
    initDroneReviveStock(state, ctx, battle, [shipId])
    initDroneRevive(state, ctx, battle, shipId, me.tag ?? 'player')
  }
  // 敌机机群生存池（2026-09-11 机群批）：与敌方编队同建；无 `foeDrones` 的敌舰不建池 ⇒ 零行为变化
  initFoeDronePools(battle, foes);
  // **挂载件「船体修理装置」账本**（2026-09-24 船长）：只为挂了这件、且账本里还没有的单位建一条
  initFoeRepairPulses(battle, foes);
  // 近防炮调度（威胁 ≥ pdThreatFloor 的敌舰各装一台；与敌编队同序、独立冷却）
  if (pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  // 船体维修装置（2026-09-09 船长定）：装配快照 + 修理组件预载（货舱优先、仓库兜底）；
  // 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1，战斗结束退还未用（与弹药同哲学）。
  // 2026-09-11 船长：「船体修理装置不单独显示日志。只将消耗组件数量显示到战后总结」
  // ⇒ 开战的「待命 / 缺组件」两条日志**取消**（装备效果与"是否吃组件"在装配页与手册里已写明，
  //   战斗中是否运转由战斗界面底部状态灯表达），消耗数只在战报里以「消耗 …×N」出现。
  const repair = preloadRepairFor(state, ctx, shipId, bal.maxBattleMs)
  if (repair) {
    const ready = repair.units.filter((u) => !u.stopped)
    // **逐台排首跳**（2026-09-21 逐型号独立回转）：每台各带自己的计时器，开战 5 秒后第一跳
    for (const u of repair.units) {
      if (u.stopped) continue
      u.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS)
    }
    if (ready.length > 0) repair.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS)
    battle.repair = repair
  }
  // 护盾充能装置（2026-09-14）：**独立 15 秒计时**（与维修装置的 5 秒互不干扰），开战 15 秒后第一跳；
  // **逐型号一路**（2026-09-21）：每路各排各的首跳
  const shieldCharge = preloadShieldChargeFor(state, ctx, shipId)
  if (shieldCharge) {
    for (const s of shieldCharge.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
    battle.shieldCharge = shieldCharge
  }
  /**
   * **力场（高槽）也要在单船路径建账本**（**2026-09-21 修**）：此前只有多舰路径（`startFleetBattleFor`）
   * 建 `shieldFieldBy`，单船路径**根本没有这一块** ⇒ 悬赏卡 / 低安遭遇 / AI 副船这些单船场次里，
   * 装了力场也**一跳都不跳**（我写本条用例时探针实测：`battle.shieldFieldBy` 为 `undefined`）。
   * 属"装置静默失效"，与 2026-09-16「僚舰装了也白装」同一类缺陷。
   */
  const shieldField = preloadShieldFieldFor(state, ctx, shipId)
  if (shieldField) {
    for (const s of shieldField.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
    battle.shieldFieldBy = { [me.tag ?? 'player']: shieldField }
  }
  return battle
}

/**
 * **洞内敌卡的派生单点**（F 批 · 2026-09-13）：开战与逐拍重建**必须走同一处**，
 * 否则会出现"建档给了一套数值、逐拍又换一套"的静默错位——
 * 首版就是这么错的：`advanceBattleFor` 漏了总血预算 ⇒ 敌人**血是强化后的、炮还是自然值**
 * （探针实测：敌总血 11,168、单发 1,336，实战里每发只掉 6~7 点，整场残血 100%）。
 */
/**
 * `wormholeDerivedAnomaly` 的一层记忆（见该函数注释；键 = 卡 id|层|用途|波数|强度覆写）。
 * 只存最近一份：一局里同时只会有一种用途在场（节点/守卫/撤离），换键即重算。
 */
let wormholeDerivedMemo: { key: string; card: AnomalyDef } | null = null
const expeditionDerivedMemo = new WeakMap<SimContext, Map<string, WormholeExpeditionFoeCard>>()

export function wormholeDerivedAnomaly(
  ctx: SimContext,
  baseCard: AnomalyDef,
  spec: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    strengthMul?: number
    /** 谜质：威胁乘数（缺省 1）+ 敌方命中/近盲带削减（见 `battle.wormhole` 的字段说明） */
    threatMul?: number
    foeHitDown?: number
    blindReduce?: number
  },
): AnomalyDef {
  if (spec.expeditionRules !== undefined) {
    if (spec.expeditionRules !== 2) throw new Error('wormhole-expedition-unsupported-rules')
    const family = baseCard.foeFamily
    if (family !== 'A' && family !== 'C' && family !== 'D' && family !== 'E' && family !== 'G') throw new Error('wormhole-expedition-family-invalid')
    const role = spec.expeditionRole ?? (spec.kind === 'boss' ? 'guard' : spec.kind === 'spawn' ? 'patrol' : 'ordinary')
    const key = JSON.stringify([family, spec.depth, role, spec.guardSupportDisabled, spec.threatMul, spec.foeHitDown, spec.blindReduce])
    const cache = expeditionDerivedMemo.get(ctx) ?? new Map<string, WormholeExpeditionFoeCard>()
    if (!expeditionDerivedMemo.has(ctx)) expeditionDerivedMemo.set(ctx, cache)
    const old = cache.get(key)
    if (old) return old
    const base = wormholeExpeditionCard(ctx, family, spec.depth, role, spec.guardSupportDisabled)
    const card = wormholeExpeditionModifyCard(base, ctx.balance.battle, spec)
    if (cache.size >= 64) cache.clear()
    cache.set(key, card)
    return card
  }
  /**
   * **一层记忆（2026-09-13 性能修）**：本函数被**每 100ms 一拍**（战斗推进）＋**每次重渲染**
   * （战场视图 `wormholeBattleViewOf`）调用，每次都克隆/缩放整张敌卡与槽位 ⇒ 拖距离条那种
   * 高频重渲染下会顶出顿挫（船长："依旧还是有顿挫感"、"参考洞外战斗的距离调整"）。
   * 入参只由 `(卡 id, 层, 用途, 波数, 强度覆写, 谜质三项)` 决定 ⇒ **同键复用上一份**（调用方都只读不写）。
   */
  const threatMul = spec.threatMul ?? 1
  /**
   * **分层"威胁预算"修正**（2026-09-16 船长改口径：「档位血量修正改为威胁预算修正，比例降为 1 : 1.05 : 1.1」）：
   * 档位由**卡 id 反查**（`wormholeTierOfCard`）⇒ 不进存档、老档零迁移；
   * 查不到（不是洞内卡）⇒ 1（= 与旧口径逐字一致）。
   */
  const tierThreatMul = WORMHOLE_TIER_THREAT_MUL[wormholeTierOfCard(baseCard.id) ?? 'shallow']
  /**
   * **该卡的自然总火力**（含机群）——决定它的"自然血/火力比 `r`"（甲案口径：血与火力按 `r` 反算）。
   * 用**未派生**的卡建一遍规格即可（与派生无关，纯卡面事实）；同一张卡只算一次（记忆在派生记忆里）。
   *
   * ⚠ **互斥支援分支只记一支**（2026-09-19「支援呼叫装置」批）：与 `wormholeNaturalHp` **同一个函数**
   * 取"被排除的那一支" ⇒ 血与火力两侧口径一致（两支都算会让本卡比同层同档弱约 24%）。
   */
  const naturalDps = (() => {
    const skip = wormholeSkippedBranch(baseCard)
    let dps = 0
    for (const f of createFoeSpecs(baseCard, ctx.balance.battle)) {
      if (skip !== null && f.foeReinforceBranch === skip) continue
      for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    return dps
  })()
  const zero = (v: number | undefined): string => (v === undefined || v === 0 ? '' : String(v))
  const memoKey = `${baseCard.id}|${spec.depth}|${spec.kind}|${spec.waves}|${spec.strengthMul ?? ''}|${threatMul}|${tierThreatMul}|${zero(spec.foeHitDown)}|${zero(spec.blindReduce)}`
  if (wormholeDerivedMemo !== null && wormholeDerivedMemo.key === memoKey) return wormholeDerivedMemo.card
  const derived = wormholeAnomalyOf(baseCard, spec.depth, spec.kind, spec.waves, {
    // **本层本档的"血尺度"**（单船威胁曲线 × **洞内强度系数**——4 舰对 4 舰口径 × **谜质威胁乘数**）；
    // 新口径下它经平方化成"威胁预算 T"，再由卡的自然比拆成血与火力（见 `wormholeAnomalyOf`）。
    // ⚠ 威胁取 `wormholeCardThreatOf`（= 层威胁 × 本卡补偿；挂了「支援呼叫装置」的卡有 ×1.1）
    // ——与 `wormholeAnomalyOf` 写进派生卡的 `threat` **同一个数** ⇒ 标尺与预算同源。
    hpBudget:
      foeHpOfThreat(wormholeCardThreatOf(baseCard, spec.depth, spec.kind), ctx.balance.battle) *
      WORMHOLE_FOE_BASE_STRENGTH_MUL *
      threatMul,
    tierThreatMul,
    naturalDps,
    ...(spec.strengthMul !== undefined ? { strengthMul: spec.strengthMul } : {}),
  })
  /**
   * **谜质 B1：敌方削弱折进派生卡**（这样**所有** `createFoeSpecs` 调用点自动生效——
   * 开战、逐拍重建、下一波补刷、战场视图都读同一张派生卡，不必各处再补一次）：
   * `foeHitRate` 直接减（命中率是**概率**，按绝对值减、下限 0）；`blindDmgMul` 同样按绝对值减。
   */
  const foeHitDown = spec.foeHitDown ?? 0
  const blindReduce = spec.blindReduce ?? 0
  const card: AnomalyDef =
    foeHitDown > 0 || blindReduce > 0
      ? {
          ...derived,
          ...(foeHitDown > 0 ? { foeHitRate: Math.max(0, (derived.foeHitRate ?? ctx.balance.battle.foeHitRate) - foeHitDown) } : {}),
          ...(blindReduce > 0 ? { blindDmgMul: Math.max(0, (derived.blindDmgMul ?? 0.3) - blindReduce) } : {}),
        }
      : derived
  wormholeDerivedMemo = { key: memoKey, card }
  return card
}

/**
 * **多舰编队开战**（虫洞 D 批 · 船长 2026-09-13：「4 艘同时参战」）——与 `startBattleFor` 并列的
 * 第二条建档入口，**既有单船路径一字不动**。
 *
 * 口径（逐条见设计稿 §二 冲突 1 的 D 批落地表）：
 * - **主控 = `state.shipId`**（若在编队里，否则编队第一艘）；tag 恒为 `'player'`，僚舰 `'ally-1'..`；
 * - **逐船**按自己的装配/技能建三层血，并按自己的**场间残余**（`armorPct`/`durability`）开局；
 * - **弹药整队共用一个池，但池 = 每艘船各自装载量之和**（各船按自己的装配档与货仓装载、
 *   **照付成本**）；⚠ 多船混装**不同弹种档位**时，`battle.ammoIds` 与退还都按**主控优先**
 *   的档口（共用池记不住两套档位——已知简化，F 批可细化）；
 * - **不挂 `hullEscapeFrac`** ⇒ 副本内没有"结构过半自动脱离"保险（冲突 2 · 船长裁定「关闭」）；
 * - 僚舰的**无人机机群 / 近防炮 / 修理包不参战**（D 批边界；机群与点防的多单位化留 F 批）。
 */
export function startFleetBattleFor(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number | null,
  /**
   * **虫洞战斗标记**（F 批 · 2026-09-13）：给了就按层派生敌卡（`wormholeAnomalyOf`），
   * 并把 `{cardId, depth, kind, waves}` 写进 `battle.wormhole` ⇒ 逐拍重建同源。
   * **不给 = 普通多舰战斗**（既有行为）。
   * `strengthMul` = **校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   */
  wormhole?: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
    waves: number
    expeditionRules?: number
    expeditionRole?: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'
    guardSupportDisabled?: boolean
    desireRangeMul?: number
    strengthMul?: number
    /**
     * **谜质装置在开战那一刻的快照**（F3c B1 · 船长 2026-09-13）：
     * 战斗是"逐拍重建规格"的（`buildMyUnitSpecs` / `createFoeSpecs` 每拍按敌卡重建）
     * ⇒ 把**这一场**吃到的四个值随标记写进 `battle.wormhole`，逐拍重建时**同一份**，不各算各的。
     * - `threatMul`：威胁乘数（压制力场/守卫解析仪/撤离掩护器，**三档各自 −50% 封顶**）；
     * - `foeMainType`：敌队主伤害类型（护盾/装甲/结构三张谐振片**只对它**加抗性）；
     * - `foeHitDown`：敌方命中 −（干扰发射器，**−0.25 封顶**）；
     * - `blindReduce`：敌方近盲带伤害比例 −（盲区压制器，下限 0）。
     */
    threatMul?: number
    foeMainType?: DamageType
    foeHitDown?: number
    blindReduce?: number
  },
  /** **敌群强度覆写**（2026-09-23 入侵旗舰用：120 威胁 · 4 波；缺省 = 原行为） */
  foeOverride?: FoeOverride,
): import('./state').BattleState | null {
  if (!anomalyId || shipIds.length === 0) return null
  // 虫洞内的敌卡取**原卡**（不套窝点派生/派系活跃——那是悬赏线的口径），再按层派生
  const baseCard = battleAnomalyOf(ctx, anomalyId)
  // **记下这一场的敌方舰级**（用**原卡**，两处派生之前；船长 2026-09-16）
  if (baseCard) noteFoeShipsSeen(state, baseCard)
  if (!baseCard) return null
  /**
   * **谜质在开战那一刻的快照**（F3c B1 · 船长 2026-09-13）：威胁乘数（三档各自 −50% 封顶）、
   * 敌队主伤害系（三张谐振片"单层单系"只对它加抗性）、敌方削弱两项。
   * 快照随 `battle.wormhole` 落进战斗 ⇒ 逐拍重建读同一份。
   */
  const matterMods = wormhole ? wormholeMatterBattleModsOf(state, ctx, baseCard, wormhole.kind) : null
  // 洞内敌卡：按层派生（**与逐拍重建同源**，见 `wormholeDerivedAnomaly` 的注释）
  /**
   * **敌群强度覆写**（2026-09-23 入侵）：旗舰要打**120 威胁 · 4 波**（绝对值），而族卡自带自己的强度
   * ⇒ 派生之后套一层覆写。**不传 ⇒ 一字不变**（虫洞与既有调用方都不传）。
   */
  const anomaly = applyFoeOverride(
    wormhole
      ? wormholeDerivedAnomaly(ctx, baseCard, {
        ...wormhole,
        ...(matterMods
          ? {
              ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
              ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
              ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            }
          : {}),
      })
    : baseCard,
    foeOverride,
  )
  const bal = ctx.balance.battle
  // 编队顺序：**主控置首**（`state.shipId` 在编队里就提到第一位），其余保持传入顺序
  const ordered = [...shipIds]
  const leaderIdx = ordered.indexOf(state.shipId)
  if (leaderIdx > 0) {
    ordered.splice(leaderIdx, 1)
    ordered.unshift(state.shipId)
  }
  const specs: UnitSpec[] = []
  const fleet: NonNullable<import('./state').BattleState['myFleet']> = []
  /** 逐船规格（弹药装载要按船各算一次，故留一份） */
  const specOf = new Map<string, UnitSpec>()
  /**
   * **逐船满值三层血**（血条分母）——必须在承伤持久化**之前**留一份。
   * ⚠ 2026-09-14 修船长报障「**虫洞战斗中，我方舰船的血量上限显示不正确**」：见 `startBattleFor`
   * 里同款注释（洞内多舰路径原先拿"打完折的规格"当初始 `hpMax` ⇒ 上限凭空缩水、与洞外口径不一致）。
   * 语义定案：**上限恒为该舰满值**，承伤持久化只打"当前值"。
   */
  const fullHpOf = new Map<string, { s: number; a: number; h: number }>()
  for (let i = 0; i < ordered.length; i++) {
    const sid = ordered[i]!
    let spec = createPlayerSpec(state, ctx, sid)
    // 主力船记录缺失 = 与单船路径同样的"开不了战"（不让它退化成"打头的变成僚舰"）
    if (!spec) {
      if (i === 0) return null
      continue
    }
    if (wormhole && state.wormhole.run?.supplyVersion === 1) {
      const ids = wormholeAmmoIdsForSpec(state, ctx, sid, spec, state.wormhole.run.supplies?.items ?? {})
      spec = createPlayerSpec(state, ctx, sid, ids)!
    }
    spec.tag = i === 0 ? 'player' : `ally-${i}`
    fullHpOf.set(spec.tag, { ...spec.hp })
    // P0 承伤持久化：装甲/结构（=耐久合并属性）按**各自**场间残余开局；护盾每场满值重建
    const fleetShip = state.fleet[sid]
    if (fleetShip) {
      const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
      const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
      spec.hp.a = Math.max(0, spec.hp.a * armorMul)
      spec.hp.h = Math.max(0, spec.hp.h * hullMul)
    }
    specs.push(spec)
    specOf.set(sid, spec)
    fleet.push({ tag: spec.tag, shipId: sid })
  }
  if (specs.length === 0) return null
  // **全舰单发伤害光环**（2026-09-13 船长：指挥舰「提高全舰的单发伤害 15%」）——
  // 建完各舰规格后统一乘；**多艘同类只取最高、不叠加**（与"同项取优"惯例一致）。
  // ⚠ **2026-09-17**：乘算抽成 `applyFleetDamageAura` 单点，**每拍重建处（`buildMyUnitSpecs`）也要调**
  // ——原先只在这里乘一次，而开火读的是每拍重建后的规格 ⇒ 光环从未生效（真 BUG，同批已修）。
  applyFleetDamageAura(specs, 1 + fleetDamageAuraOf(state, ctx, ordered))
  // **目标锁定阵列：全队生效**（船长 2026-09-17）——见 `applyFleetLockAura` 的注释：
  // 开战这一刻的规格也要置上（首拍用）；**真正的每拍生效靠 `buildMyUnitSpecs` 里同一次调用**。
  applyFleetLockAura(specs)
  // **谜质 B1：我方静态增益**（抗性 / 命中 / 回避 / 射程 / 单发 / 装填）——只在洞内战斗里生效
  if (matterMods) {
    const buffs = wormholeMatterBuffs(state.wormhole.run?.hold, matterTechWhBuffs(state, ctx))
    for (const spec of specs) applyMatterPlayerBuffs(spec, buffs, matterMods.foeMainType)
  }
  const me = specs[0]!
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 期望距离：`null` = 强制默认档（洞内编队默认走这条）；显式值优先；否则该星系偏好 → 默认档。
  // ⚠ **2026-09-15 船长裁定：星图与洞内同一个默认档**（`desireBandMid` = 射程带 0.8 高位；
  // 当天先落成"星图 0.8 / 洞内 0.5"分档，船长更正「这个是我口误，可以回滚那句」⇒ 取消分档）。
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal)
      : desireM !== undefined && desireM > 0
        ? Math.round(desireM)
        : (desirePrefOf(state, anomaly.galaxyId) ?? desiredRangeFor(me, 'mid', bal))
  const desire = Math.min(openM, Math.max(bal.minDistanceM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire, specs.slice(1))
  // **敌群覆写照原样存下**（2026-09-25 修）：后续波由 `advanceBattleFor` 从 `ctx` 重建敌卡，不存就只有第 0 波吃到覆写
  if (foeOverride !== undefined) battle.foeOverride = foeOverride
  /**
   * **逐船把血条分母修回满值**（2026-09-14 修船长报障「虫洞战斗中，我方舰船的血量上限显示不正确」）：
   * `createBattleState` 按"传入规格"写 `hp`/`hpMax`，而上面已按各舰的场间残余打过折 ⇒ 分母跟着缩水
   * （洞内 4 条舰的血条开局全是满格、上限比洞外小）。这里显式改回**各自满值**。
   */
  for (const [tag, full] of fullHpOf) {
    const rt = battle.units[tag]
    if (rt) rt.hpMax = full
  }
  // **电子舰 · 压制敌舰射程**（2026-09-18）：按本场编队算一次（每拍还会在 `advanceBattleFor` 里重算）
  applyFoeRangeDebuff(state, ctx, battle, ordered)
  announceStealthStart(battle) // 隐秘行动装置：开战那一刻的提示条（逐舰各一条，没装的船不推）
  announceSupportCallStart(battle, foes) // 支援呼叫装置：开战即告诉玩家"有一支援军在路上"（没挂的不推）
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  //
  // ⚠ **虫洞内战斗的特殊规则（船长 2026-09-13）**：洞内**不吃**上面那条常规开战距离 ——
  //   ① **非近战敌人**：初始距离 = **其目标距离**（敌人一开场就站在自己想打的位置）；
  //   ② **近战敌人**：初始距离 = **玩家的中距离位置**（贴脸怪一开场就在你脸上）。
  //   动机：常规口径下长射程编队能把近程敌人**永远钉在射程外**（F1 校准实测「敌开火 0」），
  //   洞内要的是"进去就得挨打"的搜打撤张力。混合编成按"**卡内任一近战单位 ⇒ 走近战口径**"。
  /**
   * **R 族想站的期望距离**（以"玩家的射程盲区"为目标）——在开战距离的 if/else **之前**先算出来，
   * 因为两条路径都要用它。非 R 族 ⇒ `null`。
   */
  const rDesire = rFamilyDesireOf(me, foes, bal)
  if (wormhole) {
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    // ⚠ 近战怪的开局距离走**独立的洞内档** `wormholeBrawlOpenBand`（0.5 = 中段）——船长选定「乙」：
    // 默认期望抬到 0.8 时**不把它一起带走**（2026-09-13「贴脸怪一开场就在你脸上」的张力保住）。
    const want = anyBrawl
      ? desiredRangeFor(me, 'mid', bal, bal.wormholeBrawlOpenBand)
      : // 电子舰削减之后，敌人也**在洞里**主动压近（船长 2026-09-18：「削减射程后，敌人的期望距离也要随之改变」）
        foeDesiredRange(me, foes, bal, meFoeRangeDebuffOf(state, ctx, ordered))
    battle.distanceM = Math.max(bal.minDistanceM, Math.min(openM, Math.round(want)))
  } else {
    /**
     * **开战距离（非洞内）= `openM`，与族格无关**（**船长 2026-10-03 报障修**：「**开场双方距离的规则
     * 已经很明确了，现在的情况是BUG**」）——规则出处 `docs/design/desire-band-20260915.md`：
     * 开场距离 = `battleOpenM`（双方最远射程 ×1.0 ＋ 缓冲 10%），且该文档 §二 的「**明确不动的**」
     * 清单第一条就是**开战距离公式**。⚠ 旧写法 `rDesire ?? openM` 让 R 族场次**用族格值当开场距离**
     * ⇒ **一开场就贴脸**（船长实测：回音荒区 512 m）。R 族"主动贴身"由它**自己走过来**
     * （`foeDesireRangeM` 那一支照旧钉着），不是"开局就站在脸上"。
     */
    battle.distanceM = openM
  }
  /**
   * 🔴 **R 族族格：只钉"敌人自己"的期望距离**（**船长 2026-10-01 正解原话**：
   * 「**这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。**」）——
   * **放在 `if (wormhole) / else` 之外**：洞内洞外都要生效（洞内的开场距离有自己的口径，
   * 但"R 族想站哪"这件事与洞口径无关）。
   * ⚠ **旧写法还多改了一行 `battle.myDesireM = rDesire`**（用**敌人**的偏好改**我方**的期望距离）
   * ——与船长的澄清**直接冲突** ⇒ **2026-10-03 删掉**；我方期望距离走既有三级链。
   * ⚠ 非 R 族 `rDesire === null` ⇒ 这一段整体不执行，**既有各族零行为变化**。
   */
  if (rDesire !== null) {
    // 把 R 族自己那几艘的期望距离钉到"我方射程盲区"位置（`foeDesiredRange` 读 `foeDesireRangeM`）
    for (const f of foes) if (f.family === 'R') f.foeDesireRangeM = rDesire
  }
  battle.myFleet = fleet
  if (wormhole) battle.wormhole = { cardId: anomalyId, ...wormhole }
  if (wormhole?.desireRangeMul) battle.myDesireM = Math.min(battle.myDesireM, openM * wormhole.desireRangeMul)
  // 弹药：**逐船装载、汇入同一个池**（成本按各船各付；档口按主控优先）
  // **取档口径 2026-09-16 船长改判**：同族取"能装得最多"的那一档、允许装不满（细则见 `loadAmmoTier`）
  const ammoIds: Partial<Record<DamageType, string>> = {}
  if (!loadWormholeBattleAmmo(state, ctx, battle, specOf)) for (const entry of fleet) {
    const spec = specOf.get(entry.shipId)!
    const totals = ammoLoadTotals(spec, bal, state)
    for (const [t, n] of Object.entries(totals)) {
      const type = t as DamageType
      const key = ammoKeyOf(type)
      // 同上（批次 4i 类型微调）：n 运行期恒为数字键的值
      const res = loadAmmoTier(state, ctx, entry.shipId, type, n ?? 0)
      battle.ammo[key] += res.loaded
      // ⚠ 只要有实装就记实际档（含"实际 = 基础弹"）：推进重建与退还都按它走，漏记会串档
      if (res.loaded > 0 && ammoIds[type] === undefined) ammoIds[type] = res.id
      if (res.fellBack && res.loaded > 0) {
        addLog(state, 'warn', ammoTierFallbackLog(state, ctx, entry.shipId, type, res.id, res.loaded))
      }
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：记一份，战后按「预载 − 余额」算这一场打出去多少
  battle.ammoLoaded = { ...battle.ammo }
  // 机群生存池：**逐舰建池**（2026-09-14 船长「逐舰机群」——此前只有主控的机群参战，僚舰的
  // 无人机条目被 `stepBattle` 跳过；键 = `舰tag:武器下标`，逐舰各自的机型/技能/舱位口径）
  const pools: Record<string, import('./state').DronePoolEntry> = {}
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  for (const spec of specs) buildDronePoolsFor(ctx, spec, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    battle.droneLost = {}
    battle.droneLostBy = {}
    // 开战清单快照：**逐舰**一份（战后按舰扣各自的机舱清单）；老字段 `droneLoadAtStart` 仍是主控那份
    const by: Record<string, Record<string, number>> = {}
    for (const e of fleet) by[e.tag] = { ...(state.fleet[e.shipId]?.droneLoad ?? {}) }
    battle.droneLoadAtStartBy = by
    battle.droneLoadAtStart = { ...(state.fleet[fleet[0]!.shipId]?.droneLoad ?? {}) }
    // **无人机储备甲板建档**（2026-09-27 船长令）：**逐舰**一份（每舰各自的复位周期与队列）
    // ⚠ 预算快照**全队只拍一本**（`initDroneReviveStock`）——按舰各拍一份会从同一只仓库里超补
    initDroneReviveStock(state, ctx, battle, fleet.map((e) => e.shipId))
    for (const e of fleet) initDroneRevive(state, ctx, battle, e.shipId, e.tag)
  }
  initFoeDronePools(battle, foes);
  // 挂载件「船体修理装置」账本（2026-09-24 船长）：与多舰编队路径同一处（幂等，缺省不建）
  initFoeRepairPulses(battle, foes);
  if (pdEnabledFor(foeJudgedThreatOf(anomaly), bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  /**
   * **维修装置 / 护盾充能装置：逐舰预载**（2026-09-16 船长裁定「甲：逐舰维修」——
   * 起因是玩家报障「船体维修装置在虫洞里无效」：旧口径只预载主控，装置装在僚舰上就完全不工作）。
   *
   * - 每艘参战船**各自的装置、各自的组件**（**本舰货舱**优先、仓库兜底）、各自被修；
   * - `battle.repair` / `battle.shieldCharge` 仍是**主控那一份**（老读法零迁移；主控没装而僚舰装了
   *   ⇒ 指向第一份有的，界面状态灯据此仍能显示"运转中"，逐舰明细走 `*By`）；
   * - 逐舰账本在 `repairBy` / `shieldChargeBy`（键 = tag）；退款与战报**只认逐舰入口**
   *   （`refundRepairKitsAll` / `repairUsageText`）⇒ 不会与别名重复结算。
   */
  const repairBy: Record<string, import('./state').BattleRepairLedger> = {}
  const shieldChargeBy: Record<string, import('./state').BattleShieldChargeLedger> = {}
  /** 力场账本（2026-09-20 新增；与上面两套**各自计时**） */
  const shieldFieldBy: Record<string, import('./state').BattleShieldFieldLedger> = {}
  for (const e of fleet) {
    const r = preloadRepairFor(state, ctx, e.shipId, bal.maxBattleMs)
    if (r) {
      const ready = r.units.filter((u) => !u.stopped)
      /**
       * **逐台排首跳**（**2026-09-21 船长令：逐型号独立回转**）：每台装置各带自己的
       * `nextPulseAtMs`，首跳 = 开战 + 该型号自己的间隔（本族现为常量 `REPAIR_PULSE_MS`）。
       * ⚠ 旧档在途战斗没有逐台字段 ⇒ `advanceBattleFor` 里走迁移分支（借账本那一个值）。
       * 账本上的 `nextPulseAtMs` **仍然保留**：它现在是"最近一台的首跳"（旧档/外部读法的兼容读数）。
       */
      for (const u of r.units) {
        if (u.stopped) continue
        u.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, e.shipId, REPAIR_PULSE_MS)
      }
      if (ready.length > 0) r.nextPulseAtMs = battle.startedAtGameMs + equipmentCycleMsOf(state, ctx, e.shipId, REPAIR_PULSE_MS)
      repairBy[e.tag] = r
    }
    const sc = preloadShieldChargeFor(state, ctx, e.shipId)
    if (sc) {
      for (const s of sc.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
      shieldChargeBy[e.tag] = sc
    }
    const sf = preloadShieldFieldFor(state, ctx, e.shipId)
    if (sf) {
      // **逐路排首跳** = 开战 + 该型号自带冷却（与另两套装置同款：开场即排第一跳）
      for (const s of sf.streams) s.nextPulseAtMs = battle.startedAtGameMs + s.ms
      shieldFieldBy[e.tag] = sf
    }
  }
  if (Object.keys(repairBy).length > 0) {
    battle.repairBy = repairBy
    battle.repair = repairBy['player'] ?? Object.values(repairBy)[0]!
  }
  if (Object.keys(shieldChargeBy).length > 0) {
    battle.shieldChargeBy = shieldChargeBy
    battle.shieldCharge = shieldChargeBy['player'] ?? Object.values(shieldChargeBy)[0]!
  }
  if (Object.keys(shieldFieldBy).length > 0) battle.shieldFieldBy = shieldFieldBy
  /**
   * **敌方后勤账本**（船长 2026-09-16）：**只在敌阵里真有 `repairPct > 0` 的舰时才建**
   * （缺省 ⇒ `battle.foeRepair` 不写、tick 里那一块直接跳过 ⇒ 零开销、零行为变化）。
   * 首跳 = 开战 + `REPAIR_PULSE_MS`（与维修装置同节拍）。
   */
  if (foes.some((f) => (f.repairPct ?? 0) > 0)) {
    battle.foeRepair = { nextPulseAtMs: battle.startedAtGameMs + REPAIR_PULSE_MS, pulses: 0, healed: 0 }
  }
  // **虫洞战斗标记**（F 批）：写进 battle ⇒ 每拍按同一份派生重建敌卡（`advanceBattleFor` 读它）；
  // F3c B1 起，谜质在开战那一刻的快照（威胁乘数 / 敌主伤害系 / 敌方削弱）**一并写进去**，
  // 逐拍重建与下一波补刷都读这一份（不各算各的）。
  if (wormhole) {
    battle.wormhole = {
      cardId: anomalyId,
      ...wormhole,
      /**
       * 谜质快照**只写真正生效的项**（没带战斗类装置时 `matterMods` = null ⇒ 一个字段都不写）：
       * 于是"没带装置"的洞内战斗与改动前**逐字一致**（存档形状、既有用例、战报都不受影响）。
       */
      ...(matterMods
        ? {
            ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
            ...(matterMods.foeMainType ? { foeMainType: matterMods.foeMainType } : {}),
            ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
            ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            ...(matterMods.volleyOverflow ? { volleyOverflow: true } : {}),
          }
        : {}),
    }
  }
  // ⚠ **刻意不写 `battle.hullEscapeFrac`**：副本内无"结构过半自动脱离"保险（冲突 2 · 船长裁定）。
  return battle
}

/** 战斗射程带查询（小剧场距离条用）：返回双方主武器带与开战距离上限；无战斗返回 null */
export function battleZonesFor(state: GameState, ctx: SimContext): {
  openM: number
  me: { minM: number; maxM: number; name: string }
  foe: { minM: number; maxM: number }
} | null {
  const anomaly = battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, state.shipId)
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const main = mainWeaponOf(me) ?? me.weapons[0]!
  let foeMin = 0
  let foeMax = 0
  for (const f of foes) {
    for (const w of f.weapons) {
      foeMin = Math.min(foeMin, w.minRangeM)
      foeMax = Math.max(foeMax, w.maxRangeM)
    }
  }
  return {
    openM: battleOpenM(me, foes, bal),
    me: { minM: main.minRangeM, maxM: main.maxRangeM, name: main.label },
    foe: { minM: foeMin, maxM: foeMax },
  }
}

/** 战斗可视化武器卡（战场射程弧/弹药颜色用）：返回双方射程带、当前弹药与开火弹型。
 * 我方逐武器展开：炮台颜色 = 与引擎同口径的"剩余最多弹型"（无弹 null，画虚线灰弧）；
 * 敌方整编队聚合一道（同型同射程）。无战斗/记录缺失返回 null。 */
export function battleArcsFor(
  state: GameState,
  ctx: SimContext,
  /**
   * **显式战斗上下文**（2026-09-13 F 批）：不给 = 既有"远征战斗"口径（逐字不变）；
   * 给了 = 按这套上下文出视图（虫洞战斗由 `wormholeBattleViewOf` 传进来，与远征互不干扰）。
   */
  override?: {
    battle: import('./state').BattleState
    anomaly: AnomalyDef
    /** 视图锚（我方主视角/主控）的船型 uid */
    leaderShipId: string
  } | null,
): {
  nearM: number
  openM: number
  /**
   * **战场远端 = 距离上限**（2026-09-19 船长裁定「甲」新增）：
   * 按**当前**双方有效射程现算（含我方技能/科技增程、敌方受击增程），只增不减；
   * **无增程时逐字等于 `openM`** ⇒ 常规战斗的界面几何/距离尺一字不变。
   */
  maxM: number
  desireMaxM: number
  /** 敌方当前战术期望距离（与引擎推进同口径：按战术系数换算后钳制在开战距离内）——UI 判断敌舰意图方向用 */
  foeDesireM: number
  ammo: { kin: number; exp: number; pla: number }
  /** 弹药 MK2（2026-09-09）：本场实装弹名（键 → 弹药卡名；缺省 = UI 用默认弹型名） */
  ammoNames?: Partial<Record<'kin' | 'exp' | 'pla', string>>
  me: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    /** 武器装填周期毫秒（静态；UI 冷却条分母） */
    reloadMs: number
    /** 武器来源（2026-09-10：无人机条目据此出机群/弹道；缺省 = 旧口径） */
    src?: WeaponSrc
    /** 无人机机型 id（src='drone'）；UI 按机型出机体与弹点 */
    artId?: string
    /** 该条目合并的架数（无人机同机型多架合并为「机型 ×N」一条；非无人机为 1） */
    count?: number
    /** **主武器**（战术距离口径，同 `mainWeaponOf`：射程最远、并列取名义火力大的）——
     *  UI 据此在射程弧端画米数刻度（2026-09-12 船长裁定「甲」后单点下发，界面不再自己 find(kind==='gun')） */
    isMain?: boolean
  }>
  /** 我方各武器当前装填剩余毫秒（与 me 同序；0 = 可开火；战斗单位缺失时为空数组） */
  meReload: number[]
  weapons: BattleWeaponCycleView[]
  devices: BattleDeviceCycleView[]
  /** **我方编队逐舰读数**（F 批「4 条舰影 + 血条」；单船路径 = 一条 = 主控） */
  myUnits: Array<{
    tag: string
    /** 编队 uid（`船型id#序号`）：血条 / 名称 / 装配查找用它 */
    shipId: string
    /** 船型 id（`sh-thresher`）：**画舰影必须用它**（uid 查不到舰形资产表 ⇒ 会退回兜底剪影） */
    defId: string
    name: string
    className: string
    /** 主控（视图锚） */
    leader: boolean
    /**
     * **本舰的机群机体清单**（2026-09-14 船长「逐舰机群」）：按该舰**存活**的池条目归并
     * （`artId → 架数`）。界面据此**逐舰**画机体（挂在各舰自己的锚点上）；
     * 键里带 owner，故主控那条与旧口径同源（同 artId、同架数、同锚点 ⇒ 逐像素不变）。
     * 缺省/空数组 = 该舰没有机群（或不参战）。
     */
    drones: Array<{ artId: string; count: number }>
    hp: { s: number; a: number; h: number }
    hpMax: { s: number; a: number; h: number }
    alive: boolean
    /** 本舰推进器当前有效点火状态，含逐舰周期与捕获网压制。 */
    boosting: boolean
    ammoIds?: Partial<Record<DamageType, string>>
  }>
  /** 敌方各武器射程带（聚合）：`minM~maxM` 跨全部单位取极值，`type` = 遍历到的最后一件武器弹种 */
  foe: { minM: number; maxM: number; type: DamageType }
  /**
   * 敌方**逐射程带**分解（2026-09-11 船长反馈"敌方射程不一致时只显示其中一个"）：
   * 按 (min, max, 弹种) 去重、外圈在前；`count` = 用该带的**敌舰艘数**，`names` = 舰名（悬停说明用）。
   * 只有一条带时界面观感与旧版完全一致（同一条「敌方 X~Ym」）；多条带时界面逐带各出一条。
   */
  foeBands: Array<{ minM: number; maxM: number; type: DamageType; count: number; names: string[]; mounts?: string[] }>
  /** 各单位三层满血量（UI 垂直血条按各自满值比例绘制） */
  maxHp: { me: { s: number; a: number; h: number }; foe: Record<string, { s: number; a: number; h: number }> }
  /** 机群战损（2026-09-10）：本场已击落架数（机型 id → 架数）；缺省 = 无损失 */
  droneLost?: Record<string, number>
  /** 推进器爆发倍率（2026-09-10 船长定：0 = 未装；点火期乘在战斗机动上）——UI 冷却格显示用 */
  thrusterBoost: number
  /** **我方首舰的推进器周期**（2026-09-14 逐单位周期：微型跃迁引擎 = 10 秒点火）——UI 冷却格与倒计时读它 */
  thrusterCycle: { boostMs: number; cooldownMs: number }
  /** 敌方是否有突进资格（威胁 ≥ 门槛 且 近战）——UI「突进中」标记用（未突进时为 false） */
  foeCanCharge: boolean;
  /** 本波存活且正在冲锋的敌舰，含支援舰；战斗结束后为空。 */
  foeChargingTags: string[]
  /**
   * **双方当前速度（m/s）**（2026-09-16 船长：距离条两端显示；同日裁「只改战斗显示数值」）——
   * **面板同源口径**：单位 `speedMps` × 机动倍率（我方点火期含推进器倍率、敌方冲锋期含冲锋倍率），逐单位平均；
   * 与装配页「机动速度」同一把尺（**不含**引擎内部的 ×0.6 折算）。
   * **开战首拍之前缺省**（老档在途战斗同样缺省 ⇒ 界面不显示这一格）。
   */
  meSpeedMps?: number
  foeSpeedMps?: number
  /**
   * **敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——本场敌方挂了哪些件
   * （去重展示名，如「劫掠冲锋推进器」）；**缺省 = 本场敌人没挂件**（既有战斗零变化）。
   */
  foeMounts?: string[]
  /**
   * **同序的「双语名对」**（2026-09-24 加；与 `foeMounts` 下标对齐）——界面按当前语言挑一列
   * （`BattleScreen.mountNamesTextOf`）；**缺省**（老档在途战斗）⇒ 回退中文名数组。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /**
   * **捕获网连线**（船长 2026-09-16）：每条形如 `{ from: 施放者 tag, to: 被钉舰 tag }`；
   * 渲染层画一条蓝色光束、**持续到解除**（击杀发动者即消失）。缺省 = 本场没有网。
   */
  webLinks?: Array<{ from: string; to: string; fromName: string; toName: string; slowPct: number }>
  /** **敌方机群**（2026-09-11 机群批 S5）——按敌单位 tag 汇总：机型 id / 机库存量 / **现存架数**。
   *  表现层据此在**敌舰旁**画出警戒机群（与我方机群层共用 `droneArt` 的机体资产）。
   *  **缺省 = 本场没有敌机**（既有战斗零行为变化）。 */
  foeDrones?: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    /** **受击增程已触发**（见 `FoeShipDef.droneRangeMulOnHit`）——表现层把机群阵位后撤、出击线拉长 */
    rangeBuff: boolean
    /** **机库余量**（备用机库：在库待命的架数；2026-09-12 船长「损坏后补充敌机」）——缺省 = 无备用 */
    hangar?: number
  }>
} | null {
  const anomaly =
    override?.anomaly ??
    battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  const battle = override?.battle ?? state.expedition.battle
  if (!anomaly || !battle) return null
  const bal = ctx.balance.battle
  const leaderShipId = override?.leaderShipId ?? state.shipId
  /** 干扰压制的基准账（见 `applyMeJammerDebuff`）——视图锚舰同样要吃这份基准 */
  const meRefs: { weaponRanges?: Array<{ baseM: number; bonusMul: number }> } = { weaponRanges: [] }
  const leaderTag = battle.myFleet?.find((e) => e.shipId === leaderShipId)?.tag ?? 'player'
  const me = createPlayerSpec(state, ctx, leaderShipId, battleAmmoIdsFor(battle, leaderTag), meRefs)
  if (!me) return null
  applyAlienCorrosion(me, battle.alienCorrosion ?? 0)
  // **捕获网**（船长 2026-09-16）：视图锚舰被钉时同样施加四层效果 ⇒ 面板速度/射程带与引擎同尺
  {
    const web = battle.meWebDebuffs?.[me.tag]
    if (web) applyMeWebDebuff(me, web)
  }
  /**
   * **敌干扰压制**（H 族墨潮干扰舰 · 2026-09-24）：视图锚舰与引擎**同一处口径**——
   * 不然射程弧 / 底部射程标签会拿"没被压过"的射程去画（与引擎实际开火门不一致）。
   * ⚠ 敌阵取**当前波**（`activeFoeSpecsOf`，与引擎 `specsOf(waveIdx)` 同源）：多波卡里干扰舰只在
   * 某一波出场 ⇒ 取第 0 波会漏判。
   */
  const foes = activeFoeSpecsOf(anomaly, bal, battle.waveIdx)
  applyMeJammerDebuff(me, meJammerNetOf(battle, foes), meRefs.weaponRanges)
  /** 我方各武器当前装填剩余（与 units['player'].weapons 同序；单位缺失 = 空） */
  const meRt = battle.units['player']?.weapons ?? []
  /**
   * 2026-09-10 船长批：无人机逐架条目在弧列表里合并为「机型 ×N」一条（16 架蜂鸟不再 16 条弧/16 条冷却条）。
   * 冷却剩余取组内最小值（任一可开火即视为群就绪）；非无人机条目原样一条。
   */
  const meArcs: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    reloadMs: number
    src?: WeaponSrc
    artId?: string
    count?: number
    isMain?: boolean
  }> = []
  const meReload: number[] = []
  const droneAt = new Map<string, number>()
  const droneN: number[] = []
  // 主武器（战术距离口径）：与三按钮/射程带/预估同源——弧上米数刻度照它出
  const mainW = mainWeaponOf(me)
  me.weapons.forEach((w, i) => {
    // 2026-09-10 船长「无人机可被击落」：被点防打掉的架次不出现在射程弧/机群计数里
    if (w.src === 'drone' && battle.dronePools?.[i]?.alive === false) return
    let type: DamageType | null = null
    if (w.kind === 'fixed') type = w.fixedType ?? 'kinetic'
    else if (w.kind === 'beam') type = battleAmmoAvailable(battle, leaderTag, 'plasma') >= Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1) ? 'plasma' : null
    else {
      /**
       * **炮台 / 导弹架：报"这件武器自己打的那一型"**，不是全船主流弹种。
       *
       * ⚠ **2026-09-24 船长报障（玩家截图）**：「攻坚炮台 MK3·动能型背后写着**能量弹药**，巡航导弹架 MK3
       * 也写着」——根因就是这里：旧口径取 `nextAmmoType(battle.ammo)`（**全船剩余最多的那一型**），
       * 于是只要场上有激光/能量弹占多数，**每一门炮**（含动能炮、导弹架）的弹种徽标与射程弧颜色
       * 都会被写成"能量"。现按**这件武器自己的弹种**判（与 `stepBattle` 的取弹口径逐字同源：
       * 弹型 = `shotsByType` 的键、耗弹 = 门数 × 每发耗弹数），该型打光 ⇒ `null`（界面照既有口径
       * 显示"无弹/虚线弧"，不再假装有弹）。
       */
      const own = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? w.fixedType ?? null
      const need = Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1)
      type = own !== null && battleAmmoAvailable(battle, leaderTag, own) >= need ? own : null
    }
    const rem = Math.max(0, Math.floor(meRt[i] ?? 0))
    if (w.src === 'drone') {
      const key = w.artId ?? 'drone'
      const at = droneAt.get(key)
      if (at !== undefined) {
        droneN[at] = (droneN[at] ?? 1) + 1
        meReload[at] = Math.min(meReload[at] ?? rem, rem)
        if (w === mainW) meArcs[at]!.isMain = true // 同机型合并条目：主武器落在组内也标上
        return
      }
      droneAt.set(key, meArcs.length)
      droneN.push(1)
      meArcs.push({
        label: w.label,
        kind: w.kind,
        type,
        minM: w.minRangeM,
        maxM: w.maxRangeM,
        reloadMs: w.reloadMs,
        src: w.src,
        artId: w.artId,
        count: 1,
        ...(w === mainW ? { isMain: true } : {}),
      })
      meReload.push(rem)
      return
    }
    meArcs.push({
      label: w.label,
      kind: w.kind,
      type,
      minM: w.minRangeM,
      maxM: w.maxRangeM,
      reloadMs: w.reloadMs,
      src: w.src,
      count: 1,
      ...(w === mainW ? { isMain: true } : {}),
    })
    meReload.push(rem)
  })
  meArcs.forEach((a, i) => {
    const n = droneN[droneAt.get(a.artId ?? '') ?? -1]
    if (a.src === 'drone' && n !== undefined) {
      a.count = n
      if (n > 1) a.label = `${a.label}×${n}`
    }
  })
  // 我方各武器当前装填剩余已在上面与 meArcs 同步构建（无人机按机型合并、组内取最小值）
  // 敌方整编队聚合：min/max 跨各单位武器取极值（min 以 +∞ 起步——否则 0 初值会把
  // 近盲带最小射程吞成 0，底部"敌方 X~Ym"显示错误，2026-09-08 玩家反馈）
  let foeMin = Number.POSITIVE_INFINITY
  let foeMax = 0
  let foeType: DamageType = 'kinetic'
  /**
   * 敌方**逐射程带**分解（2026-09-11 船长：「战斗场景内，假如敌方的舰船射程不一致，只会显示其中一个的射程」
   * ——指屏幕下方那条「敌方 X~Ym」标签）。上面那条聚合带只够表达"最远的威胁"：编队里短射程的船
   * （如快速艇 1~1883 对头目舰 1~2210）会被并集吃掉、看起来只剩一个射程。这里按
   * (最小射程, 最大射程, 弹种) 分组去重下发，界面照**我方逐武器一条**的同款做法逐带出一条。
   */
  const foeBandMap = new Map<string, { minM: number; maxM: number; type: DamageType; units: number; names: Set<string>; mounts: Set<string> }>()
  for (const f of foes) {
    // 同一单位的多件同带武器只算一艘；`count` = **用该带的敌舰艘数**（三艘同名快艇 = 3，不是 1）
    const seenBandOfUnit = new Set<string>()
    for (const w of f.weapons) {
      // **敌机射程要读"实战射程"**（2026-09-12 船长实测反馈：「无人机射程变更后，下方的射程标签内数值
      // 也要变动」）：敌机武器条目的 `maxRangeM` 是**机型射程**（原始值），而实战射程 = 机型射程 ×
      // **受击增程倍率**（`foeDroneRangeOf`，母舰被命中后 ×4）⇒ 标签若读原始值，就会出现
      // "打得着 20km、标签还写 5km"。**与开火射程门同源**（见 `resolvePointDefense` 上游那处）✓
      const wMin = w.minRangeM
      const wMax =
        w.src === 'drone'
          ? foeDroneRangeOf(battle, w)
          : foeGunMaxRangeOf(battle, f, w)
      foeMin = Math.min(foeMin, wMin)
      foeMax = Math.max(foeMax, wMax)
      const type = w.fixedType ?? 'kinetic'
      foeType = type
      const key = `${wMin}|${wMax}|${type}`
      let band = foeBandMap.get(key)
      if (!band) {
        band = { minM: wMin, maxM: wMax, type, units: 0, names: new Set<string>(), mounts: new Set<string>() }
        foeBandMap.set(key, band)
      }
      band.names.add(f.name)
      // 该带的敌方挂载件（2026-09-16 船长：敌舰悬停要能看到挂载）
      for (const m of f.foeMountNames ?? []) band.mounts.add(m)
      if (!seenBandOfUnit.has(key)) {
        seenBandOfUnit.add(key)
        band.units += 1
      }
    }
  }
  if (!Number.isFinite(foeMin)) foeMin = 0
  // 外圈在前（远 → 近），同远者近端更小者在前——与界面"从外往里读"一致
  const foeBands = [...foeBandMap.values()]
    .map((b) => ({
      minM: b.minM,
      maxM: b.maxM,
      type: b.type,
      count: b.units,
      names: [...b.names],
      ...(b.mounts.size > 0 ? { mounts: [...b.mounts] } : {}),
    }))
    .sort((a, b) => b.maxM - a.maxM || a.minM - b.minM)
  const openM = battleOpenM(me, foes, bal)
  // 各单位三层满血量（UI 垂直血条按各自满值比例绘制）：以战斗实况单位为准——
  // 2026-09-09 多波修复：foes 仅按"单波默认"重建，波次增援/多小队单位（w{n}-foe-* 等）不在其内，
  // 曾致后续波敌人血条为空（数值正常）；现优先 battle.units[tag].hpMax（引擎生成时写入），
  // 旧档缺省 hpMax 时以当前血兜底（读档中断局近似满值显示）。
  const foeMaxHp: Record<string, { s: number; a: number; h: number }> = {}
  /**
   * **母舰血条的分母 = 池子口径的三层容量**（船长 2026-09-25：「母舰哪怕残血，在战斗中血上限依旧保持不变」
   * ＋「**当前血条按 护盾 → 装甲 → 结构 的顺序扣除**」）：
   * 单位自己的 `hpMax` 是"本场开打那一刻的分层血量"（可能护盾已经是 0、装甲只半满）⇒ 直接当分母会让
   * 血条越打越"满"。这里三行分母改用 `FoeOverride.bossMaxLayers`（= 池子总量 × 卡面 split，恒定）。
   * ⚠ **只改这一份显示读数**：`battle.units[tag].hpMax` 与伤害台账（`flagshipBattleLedger`）都保持原值，
   * 跨场累计不会重复计。
   */
  const bossShipId = battle.foeOverride?.bossShipId
  const bossHpMax = battle.foeOverride?.bossHpMax
  const bossMaxLayers = battle.foeOverride?.bossMaxLayers
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    const max = u.hpMax ?? { s: Math.max(0.001, u.hp.s), a: Math.max(0.001, u.hp.a), h: Math.max(0.001, u.hp.h) }
    const isBoss = bossShipId !== undefined && u.foeShipId === bossShipId
    /** ① 首选：显式三层容量（池子口径；与"当前值"分开给的那份） */
    const layered =
      isBoss &&
      bossMaxLayers !== undefined &&
      Number.isFinite(bossMaxLayers.s) &&
      Number.isFinite(bossMaxLayers.a) &&
      Number.isFinite(bossMaxLayers.h) &&
      bossMaxLayers.s + bossMaxLayers.a + bossMaxLayers.h > 0
        ? { s: Math.max(0, bossMaxLayers.s), a: Math.max(0, bossMaxLayers.a), h: Math.max(0, bossMaxLayers.h) }
        : null
    /** ② 兜底（老档/只给了总量）：按 `bossHpMax ÷ 本场满值` 等比放大三层 */
    const sum = max.s + max.a + max.h
    const scale =
      layered === null &&
      isBoss &&
      bossHpMax !== undefined &&
      Number.isFinite(bossHpMax) &&
      bossHpMax > 0 &&
      sum > 0 &&
      bossHpMax > sum
        ? bossHpMax / sum
        : 1
    foeMaxHp[tag] =
      layered !== null
        ? layered
        : scale === 1
          ? max
          : { s: max.s * scale, a: max.a * scale, h: max.h * scale }
  }
  // 弹药 MK2（2026-09-09）：本场实装弹名（仅当与基础弹不同时提供；UI 兜底用弹型名）
  const ammoNames: Partial<Record<'kin' | 'exp' | 'pla', string>> = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const id = battleAmmoIdsFor(battle, leaderTag)?.[t]
    if (!id) continue
    const def = ctx.items.get(id)
    if (def?.name && id !== AMMO_IDS[t]) ammoNames[ammoKeyOf(t)] = def.name
  }
  // 敌方机群（2026-09-11 机群批 S5）：按 tag 汇总"机型 / 机库存量 / 现存架数"给表现层——
  // 敌机与母舰同建同灭（母舰阵亡 ⇒ 其池不再参战），故这里只汇总**当前波存活单位**的池。
  const foeDroneWings: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    /** **受击增程已触发**（2026-09-11 船长）——表现层据此把机群阵位后撤、出击/攻击线拉长 */
    rangeBuff: boolean
  }> = []
  /**
   * ⚠ **支援舰的机群也要画**（2026-09-27）：它的池由 `resolveFoeRevive` 建（`initFoeDronePools(b, [spec])`），
   * 而"参战敌阵"含支援舰（`foesWithSupport`）⇒ 它复活的战列巡洋舰**真会放飞那架重袭机**；
   * 若这里只遍历编成条目，那架无人机会**打人却看不见**（引擎与画面两套口径）。
   */
  for (const f of foesWithSupport(battle, foes)) {
    const pools = battle.foeDronePools?.[f.tag]
    if (!pools || pools.length === 0) continue
    // **备用机库**（2026-09-12）：在库待命的架次**不算出战架数**（画面不画、血条不计），
    // 单独以 `hangar` 报给界面（可显示"机库余量"）。
    const active = pools.filter((p) => p.inHangar !== true)
    const hangarN = pools.length - active.length
    const byArt = new Map<string, { count: number; alive: number }>()
    for (const p of active) {
      const id = p.artId ?? 'drone'
      const cur = byArt.get(id) ?? { count: 0, alive: 0 }
      cur.count += 1
      if (p.alive) cur.alive += 1
      byArt.set(id, cur)
    }
    for (const [artId, v] of byArt)
      foeDroneWings.push({
        tag: f.tag,
        artId,
        count: v.count,
        alive: v.alive,
        rangeBuff: (battle.foeDroneRangeBuff ?? 1) > 1,
        ...(hangarN > 0 ? { hangar: hangarN } : {}),
      })
  }
  /**
   * **我方编队逐舰读数**（2026-09-13 F 批「4 条舰影 + 血条」的数据源）：
   * 单船路径 = 只有主控一条（`tag='player'`）；多单位路径 = 主控 + 僚舰（各自三层血）。
   */
  const mySpecs = new Map(buildMyUnitSpecs(state, ctx, battle, leaderShipId, anomaly.id, foes).map(spec => [spec.tag, spec]))
  const myUnits = (battle.myFleet && battle.myFleet.length > 0
    ? battle.myFleet
    : [{ tag: 'player', shipId: leaderShipId }]
  ).map((e) => {
    const u = battle.units[e.tag]
    const def = ctx.ships.get(uidDefId(e.shipId))
    const spec = mySpecs.get(e.tag)
    return {
      tag: e.tag,
      /** **编队 uid**（`船型id#序号`）—— 血条 / 名称 / 装配查找都用它 */
      shipId: e.shipId,
      /**
       * **船型 id**（`sh-thresher` 这种）—— **画舰影必须用它**。
       *
       * ⚠ 2026-09-14 修船长报障「**在虫洞内，友方舰船的图形不正确**」：战斗界面多舰路径原先拿
       * `shipId`（uid）去查 `SHIP_ART` ⇒ `sh-thresher#3` 查不到资产表 ⇒ **退回 role 兜底剪影**
       * （于是洞里 4 条友舰都成了"通用突击舰/作业船"轮廓）。单船路径一直传的是 `ShipDef.id`，
       * 所以只有洞内多舰战斗会错。这里直接把 defId 一并给出去，界面不必再自己拆 uid。
       */
      defId: uidDefId(e.shipId),
      name: shipDisplayName(state, ctx, e.shipId),
      className: def?.name ?? e.shipId,
      leader: e.tag === 'player',
      hp: u ? { ...u.hp } : { s: 0, a: 0, h: 0 },
      hpMax: u?.hpMax ?? { s: 0, a: 0, h: 0 },
      alive: !!u && u.hp.s + u.hp.a + u.hp.h > 0,
      boosting: battle.ended === null && isAlive(battle, e.tag) && !!spec && unitSpeedMulOf(spec, battle, bal, 'me') > 1,
      ...(battle.expeditionAmmo ? { ammoIds: battleAmmoIdsFor(battle, e.tag) } : {}),
      /** 逐舰机群机体清单（见上方类型注释；只算**该舰存活**的池条目） */
      drones: (() => {
        const byArt = new Map<string, number>()
        for (const [k, p] of Object.entries(battle.dronePools ?? {})) {
          if (!p.alive || !p.artId) continue
          if (dronePoolOwner(k) !== e.tag) continue
          byArt.set(p.artId, (byArt.get(p.artId) ?? 0) + 1)
        }
        return [...byArt].map(([artId, count]) => ({ artId, count }))
      })(),
    }
  })
  const cycleUnits = myUnits.flatMap(unit => {
    const spec = mySpecs.get(unit.tag)
    return spec ? [{ spec, shipId: unit.shipId, name: unit.name }] : []
  })
  return {
    nearM: bal.minDistanceM,
    openM,
    /**
     * **战场远端（距离上限）**——2026-09-19 船长裁定「甲」后新增：界面那把距离尺/泳道几何按它定"拉开"那一端，
     * 这样敌方挨打增程（或我方科技增程）把战场撑宽时，画面与引擎**同一把尺**（无增程时 = `openM`，逐像素不变）。
     */
    maxM: battleMaxDistanceM(battle, me, foes, bal),
    desireMaxM: battleMaxDistanceM(battle, me, foes, bal) * (battle.wormhole?.desireRangeMul ?? 1),
    foeDesireM: Math.min(openM, foeDesiredRange(me, foes, bal, battle.meFoeRangeDebuff ?? 0, battle)),
    ammo: { kin: battle.ammo.kin, exp: battle.ammo.exp, pla: battle.ammo.pla },
    ...(Object.keys(ammoNames).length > 0 ? { ammoNames } : {}),
    me: meArcs,
    meReload,
    weapons: battleWeaponCyclesOf(battle, cycleUnits, ctx),
    devices: battleDeviceCyclesOf(state, ctx, battle, cycleUnits,
      spec => thrusterPhase(battle, bal, unitThrusterCycle(spec, bal))),
    myUnits,
    foe: { minM: foeMin, maxM: foeMax, type: foeType },
    foeBands,
    maxHp: { me: { s: me.hp.s, a: me.hp.a, h: me.hp.h }, foe: foeMaxHp },
    // 机群战损（2026-09-10）：本场已击落架数（UI 战报/提示用；缺省 = 无损失）
    ...(battle.droneLost && Object.keys(battle.droneLost).length > 0 ? { droneLost: battle.droneLost } : {}),
    // 推进器爆发倍率与敌方突进资格（2026-09-10 船长定）——UI 与引擎同源
    thrusterBoost: me.thrusterBoost ?? 0,
    /** **我方首舰（= 距离/读数锚）的推进器周期**（2026-09-14 逐单位周期后，战斗界面那一格读它） */
    thrusterCycle: unitThrusterCycle(me, bal),
    // 双方战斗机动速度（2026-09-16 船长：距离条两端显示）——读引擎逐拍落的那份，界面不自己算
    ...(battle.meSpeedMps !== undefined ? { meSpeedMps: battle.meSpeedMps } : {}),
    ...(battle.foeSpeedMps !== undefined ? { foeSpeedMps: battle.foeSpeedMps } : {}),
    foeCanCharge: foes.some((f) => f.foeCanCharge === true),
    foeChargingTags: battle.ended === null
      ? foesWithSupport(battle, foes).filter(f => isAlive(battle, f.tag) && unitSpeedMulOf(f, battle, bal, 'foe') > 1).map(f => f.tag)
      : [],
    // **捕获网连线**（船长 2026-09-16：「动画效果为一根蓝色的光速连着命中舰船」）——
    // 渲染层按 (from = 施放者 tag, to = 被钉舰 tag) 画一条蓝色光束，**持续到效果解除**。
    // ⚠ **2026-09-26 起两个方向都下发**：敌方网钉我方（`meWebDebuffs`）＋ 我方网钉敌方（`foeWebDebuffs`，
    //   墨潮捕获网）——同一份 `webLinks` 结构，渲染层一行不用改。
    ...(() => {
      const links = [
        ...Object.entries(battle.meWebDebuffs ?? {}).map(([to, d]) => ({ from: d.byTag, to, slowPct: 1 - d.slowMul })),
        ...Object.entries(battle.foeWebDebuffs ?? {}).map(([to, d]) => ({ from: d.byTag, to, slowPct: 1 - d.slowMul })),
      ].filter(link => isAlive(battle, link.from) && isAlive(battle, link.to)).map(link => ({ ...link,
        fromName: battle.units[link.from]?.name ?? link.from, toName: battle.units[link.to]?.name ?? link.to }))
      return links.length > 0 ? { webLinks: links } : {}
    })(),
    // **敌方挂载件**（去重展示名）——界面/战报同源；空 = 本场敌人没挂件（老档同样缺省）
    // ⚠ 2026-09-24 起**连同双语名对**一起下发（两条数组下标对齐，见 `foeMountNamePairs`）
    ...(() => {
      const pairs = new Map<string, readonly [string, string]>()
      for (const f of foes) {
        const names = f.foeMountNames ?? []
        const ps = f.foeMountNamePairs ?? []
        for (let i = 0; i < names.length; i++) {
          const n = names[i]!
          if (!pairs.has(n)) pairs.set(n, ps[i] ?? [n, n])
        }
      }
      return pairs.size > 0 ? { foeMounts: [...pairs.keys()], foeMountNamePairs: [...pairs.values()] } : {}
    })(),
    ...(foeDroneWings.length > 0 ? { foeDrones: foeDroneWings } : {}),
  }
}

/**
 * P0 承伤持久化：把装甲/结构残余写回船（结构 = 耐久合并属性；护盾不保留）。
 * cap 用该船当前满值（技能/装配同源 createPlayerSpec）——换装后残余按新上限比例折算。
 * 调用方在战斗结束（或手动撤退收场）后、其余结算（失利附加扣损等）之前调用；
 * battle.ended 为空也允许（撤退时记录当前残余）。
 */
export function persistFleetHullDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('./state').BattleState | null,
): void {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return
  // 多单位（虫洞 D 批）：按 `myFleet` 查本船在这场战斗里的 tag（单船路径 = 恒 'player'）
  const tag = battle?.myFleet?.find((e) => e.shipId === shipId)?.tag ?? 'player'
  const unit = battle?.units[tag]
  if (!unit) return
  const cap = createPlayerSpec(state, ctx, shipId)
  if (!cap) return
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  fleetShip.armorPct = cap.hp.a > 0 ? clamp01(unit.hp.a / cap.hp.a) : 1
  fleetShip.durability = cap.hp.h > 0 ? clamp01(unit.hp.h / cap.hp.h) : 0
}

/**
 * 机群战损结算（2026-09-10 船长拍板「无人机可被击落」+ **永久损失制**；
 * 2026-09-11 船长：「当回收损坏的无人机时，**优先回收高价值的**」）：
 * 把本场被点防击落的架数从该船无人机舱清单里**永久扣除**（清单是"带上船的那批"，
 * 本就不在仓库里——扣清单即真实损失），并写事件日志 + 一次性提示（渲染层读到弹 toast）。
 * 胜负/撤退都照扣（打掉的飞机不会因为撤退飞回来）；在 resolveBattleOutcome 等结算入口调用，
 * 且必须在其它结算之前（战报文案要用损失摘要）。
 *
 * **回收分配（2026-09-11 起）**：总回收架数仍 = round(总损坏 × 回收率)（**回收率数值不动**），
 * 但名额的分配改为**优先高价值**：
 *   ①每型先取 floor(损坏数 × 回收率)；
 *   ②余数名额按**机型基准价从高到低**依次补满（某型补到"损坏数"就换下一型）。
 * 排序读 `ctx.items` 的 `baseSellPriceIsk`（不写死顺序，日后调价自动跟随；同价按 id 稳定排序）。
 * 返回损失摘要文案（无损失 = null）。
 */
export function settleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('./state').BattleState | null,
  /** **回收率加成**（谜质「机群回收网」· F3c B2）：按百分点加在既有回收率上，并夹在 100% 以内。缺省 0 = 既有行为。 */
  recoveryBonus = 0,
  /**
   * **战损归属**（船长 2026-09-14「按舰归属」）：结算哪条舰的机群——键进 `battle.droneLostBy`。
   * 缺省 `'player'`（主控）= 旧口径；老档没有 `droneLostBy` ⇒ 回落到全队合计 `droneLost`（零迁移）。
   */
  ownerTag = 'player',
): string | null {
  const byOwner = battle?.droneLostBy
  const lost = byOwner ? byOwner[ownerTag] : ownerTag === 'player' ? battle?.droneLost : undefined
  if (!lost) return null
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  const rate = droneRecoveryRateWithBonus(state, recoveryBonus)
  const load: Record<string, number> = { ...(fleetShip.droneLoad ?? {}) }
  const supply = wormholeSupplyForBattle(state, battle)
  const startLoad = battle?.droneLoadAtStartBy?.[ownerTag] ??
    (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined) ?? load
  const revivedMap = droneRevivedOf(battle, ownerTag)
  const revivedTotal = droneRevivedCount(battle, ownerTag)

  // 新趟损坏按出发与复位实物数校验；旧趟仍以清单实有数封顶。
  type Row = { id: string; name: string; value: number; lost: number; back: number }
  const rows: Row[] = []
  let total = 0
  for (const [id, n] of Object.entries(lost)) {
    if (!n || n <= 0) continue
    const def = ctx.items.get(id)
    const cut = supply
      ? Math.min((startLoad[id] ?? 0) + (revivedMap[id] ?? 0), Math.max(0, Math.floor(n)))
      : Math.min(load[id] ?? 0, n)
    if (cut <= 0) continue
    rows.push({
      id,
      name: def?.name ?? id,
      value: def?.baseSellPriceIsk ?? 0,
      lost: cut,
      back: Math.floor(cut * rate),
    })
    total += cut
  }
  if (total <= 0) return null

  // ── ② 余数名额按价值从高到低补满（总回收数 = round(总损坏 × 回收率)，与旧口径一致）──
  let rest = Math.max(0, Math.round(total * rate) - rows.reduce((s, r) => s + r.back, 0))
  const byValue = [...rows].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  for (const r of byValue) {
    if (rest <= 0) break
    const room = r.lost - r.back
    if (room <= 0) continue
    const add = Math.min(room, rest)
    r.back += add
    rest -= add
  }

  if (supply) {
    settleWormholeDroneRevives(state, battle!)
    const alive: Record<string, number> = {}
    const recovered: Record<string, number> = {}
    for (const [id, n] of Object.entries(startLoad)) {
      const row = rows.find((r) => r.id === id)
      const left = Math.max(0, n + (revivedMap[id] ?? 0) - (row?.lost ?? 0))
      if (left > 0) alive[id] = left
      if ((row?.back ?? 0) > 0) recovered[id] = row!.back
    }
    const takeFrom = (stock: Record<string, number>) => (id: string): 'hold' | null => {
      if ((stock[id] ?? 0) <= 0) return null
      stock[id] = stock[id]! - 1
      return 'hold'
    }
    fleetShip.droneLoad = undefined
    refillDroneLoadTo(state, ctx, shipId, { ...alive }, takeFrom(alive))
    refillDroneLoadTo(state, ctx, shipId, startLoad, takeFrom(recovered))
    const settledLoad: Record<string, number> = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
    const survivors = Object.values(settledLoad).reduce((n, v) => n + v, 0)
    const returnedToSupply: Record<string, number> = {}
    for (const id of new Set([...Object.keys(alive), ...Object.keys(recovered)])) {
      const n = (alive[id] ?? 0) + (recovered[id] ?? 0)
      if (n <= 0) continue
      returnWormholeDroneSupply(supply, id, n)
      returnedToSupply[id] = n
    }
    const refill = refillDroneLoadTo(state, ctx, shipId, startLoad, (id) => deployWormholeSupply(supply, id, 1) === 1 ? 'hold' : null)
    battle!.droneLost = undefined
    if (battle!.droneLostBy) delete battle!.droneLostBy[ownerTag]
    if (ownerTag === 'player') {
      const back = rows.reduce((n, r) => n + r.back, 0)
      state.droneLossReport = {
        battleStartedAtGameMs: battle!.startedAtGameMs,
        rate, total, recovered: back, gone: total - back, survivors, revived: revivedTotal, returnedToSupply,
        rows: byValue.map((r) => ({ id: r.id, name: r.name, value: r.value, lost: r.lost, back: r.back, gone: r.lost - r.back })),
      }
    }
    const back = rows.reduce((n, r) => n + r.back, 0)
    addLog(state, 'warn', '', 'core.whExpedition.001', { p1: total, p2: back, p3: total - back })
    if (revivedTotal > 0) addLog(state, 'combat', '', 'core.whExpedition.002', { p1: revivedTotal })
    const returned = Object.values(returnedToSupply).reduce((n, v) => n + v, 0)
    if (returned > 0) addLog(state, 'combat', '', 'core.whExpedition.003', { p1: returned })
    if (Object.keys(refill.short).length > 0) addLog(state, 'warn', '', 'core.whExpedition.004')
    return byValue.map((r) => `${r.name}×${r.lost}`).join('、')
  }

  // ── ③ 落库：先扣**战中复活**的货、再扣净损失、最后按出发快照补货 ──
  /**
   * **战中复活的扣货点（唯一一处）**（**2026-09-27 船长令**）。
   *
   * 船长两条原话：
   * ① 「已经损失的无人机依旧计入战损，因为战后回收需要。**但是复活了的无人机等于已经补充了**。」
   * ② 「战斗中损失的无人机是在战斗结束后一次性扣除吧？那么**复活无人机数量的上限在战斗开始时
   *    设置一个库存的快照**可以吗」
   *
   * ⇒ 落地：
   * - 战中**只扣预算快照**（`battle.droneReviveStock`，开战那一刻拍的备用机数），**绝不写玩家库存**；
   * - **扣货全部收在本处**，顺序 = ①扣复活的 `v` 架 → ②扣净损失 → ③按出发快照补货（下面既有逻辑）；
   * - `droneLost` / `droneLostBy` **照记不回冲**（上面算回收率读的就是它，回冲会让回收率失真）
   *   ⇒ 只是把**清单纯损失**减掉战中复活的架数（那几架已经补回来了，不能再算一次损失）。
   */
  /**
   * ① **扣复活的那几架货**（本舰货舱 → 物品仓库；`takeDroneUnit` 是唯一取货口）。
   * ⚠ 可能扣不满：预算快照是**开战那一刻**拍的，若同队其它舰在本场结算前先扣过同一只仓库，
   * 到本舰时可能已空 ⇒ 记一条 warn（那几架等于白补，不静默吞掉）。
   */
  const revivedShort: string[] = []
  for (const [id, n] of Object.entries(revivedMap)) {
    for (let i = 0; i < n; i++) {
      if (takeDroneUnit(state, shipId, id) === null) {
        revivedShort.push(`${ctx.items.get(id)?.name ?? id} 缺 ${n - i} 架`)
        break
      }
    }
  }
  let recovered = 0
  for (const r of rows) {
    const goneInBattle = Math.max(0, (revivedMap[r.id] ?? 0))
    const gone = Math.max(0, r.lost - r.back - goneInBattle)
    recovered += r.back
    if (gone > 0) {
      const left = (load[r.id] ?? 0) - gone
      if (left > 0) load[r.id] = left
      else delete load[r.id]
    }
  }
  fleetShip.droneLoad = Object.keys(load).length > 0 ? load : undefined
  /**
   * **补货前的存活架数**（船长 2026-09-20 批：本场结束立刻补足机群）——
   * 停环记账与"战损过半"判定都必须读这个数，**不能**读补货后的清单（否则安全阀永远判不出来）。
   */
  const survivors = Object.values(load).reduce((s, n) => s + n, 0)
  // 结算后清空战损账本（调用幂等：重复结算不会重复扣；战报/日志已带损失摘要）
  battle!.droneLost = undefined
  // **逐舰账本也清掉本舰那一份**（2026-09-14「按舰归属」：多舰各结算一次，清掉才能幂等）
  if (battle!.droneLostBy) {
    const rest = { ...battle!.droneLostBy }
    delete rest[ownerTag]
    battle!.droneLostBy = rest
  }
  /**
   * **立刻补足机群**（船长 2026-09-20：「战斗结束立刻自动补充，优先货仓，其次是仓库」＋「按本场出发快照补」）。
   *
   * 目标 = **本场出发时的清单快照**（多舰走 `droneLoadAtStartBy[本舰]`，主控回落 `droneLoadAtStart`），
   * 货源 = 本船货仓 → 物品仓库（`refillDroneLoadTo` 单一入口，受舱容/CPU 校验、不自动购买）。
   * ⚠ **必须在 `survivors` 之后**：停环记账与战损判定读的是补货前的架数。
   */
  const legacyStartLoad = battle?.droneLoadAtStartBy?.[ownerTag] ??
    (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined) ?? {}
  const refill = refillDroneLoadTo(state, ctx, shipId, legacyStartLoad)
  const refillRows = Object.entries(refill.added)
  const refillTxt = refillRows
    .map(([id, n]) => {
      const nm = ctx.items.get(id)?.name ?? id
      const h = refill.fromHold[id] ?? 0
      const w = refill.fromWare[id] ?? 0
      const src = h > 0 && w > 0 ? `货仓 ${h} · 仓库 ${w}` : h > 0 ? `货仓 ${h}` : `仓库 ${w}`
      return `${nm}×${n}（${src}）`
    })
    .join('、')
  const shortTxt = Object.entries(refill.short)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} 缺 ${n} 架`)
    .join('、')

  // 展示口径：具名清单按价值降序（高价值在前，与"优先回收"的观感一致）
  const lostParts = byValue.map((r) => `${r.name}×${r.lost}`)
  const backParts = byValue.filter((r) => r.back > 0).map((r) => `${r.name}×${r.back}`)
  const ratePct = Math.round(rate * 100)
  const text = lostParts.join('、')
  const backTxt =
    backParts.length > 0 ? `，其中 ${backParts.join("、")} 已回收修复归队` : ''
  /**
   * **战报按舰列出**（船长 2026-09-14「战损按舰归属」）：多舰趟次里每艘舰各出一条战损日志，
   * 日志抬头点名是哪条舰（单舰/主控那条不写抬头 ⇒ 与旧文案逐字一致）。
   */
  const who =
    ownerTag === 'player' ? '' : `${state.fleet[shipId] ? shipDisplayName(state, ctx, shipId) : ownerTag}：`
  /** 「战中复活」那半句：只在真复活过时才加（没装储备甲板 ⇒ 文案与旧版**逐字一致**） */
  const revivedTxt = revivedTotal > 0 ? `，战中复活 ${revivedTotal} 架（由无人机储备甲板补回）` : ''
  addLog(
    state,
    'warn',
    `⚠ 机群战损${who ? `（${who.replace(/：$/, '')}）` : ''}：损坏 ${text}（合计 ${total} 架）${backTxt}（回收率 ${ratePct}%，优先回收高价值，净损失 ${Math.max(0, total - recovered - revivedTotal)} 架${revivedTxt}）——净损失已从无人机舱清单扣除。`,
  )
  // 立刻补足（船长 2026-09-20）：补货结果单独一行；货源不足再补一行 warn 说明缺多少
  if (refillRows.length > 0) {
    addLog(state, 'combat', `机群补充${who ? `（${who.replace(/：$/, '')}）` : ''}：${refillTxt}——本场出发时的编制已复位。`)
  }
  if (shortTxt.length > 0) {
    addLog(
      state,
      'warn',
      `⚠ 机群未能补满${who ? `（${who.replace(/：$/, '')}）` : ''}：${shortTxt}——货仓与物品仓库都没有存货了，购买或制造后再到装配页装入。`,
    )
  }
  /**
   * 复活的货**没扣满**（预算快照是开战那一刻拍的；同队别的舰先结算过同一只仓库就可能不够）——
   * 单独一条 warn，不静默吞掉。
   */
  if (revivedShort.length > 0) {
    addLog(
      state,
      'warn',
      `⚠ 无人机储备甲板的补货未能扣满${who ? `（${who.replace(/：$/, '')}）` : ''}：${revivedShort.join('、')}——` +
        `开战时的备用库存已被同队其它舰的先期结算用掉，超出的那几架按白补处理。`,
    )
  }
  state.droneLossNotice =
    recovered > 0
      ? `机群战损：损坏 ${total} 架，回收 ${recovered} 架归队（回收率 ${ratePct}%，优先回收高价值），净损失 ${Math.max(0, total - recovered - revivedTotal)} 架${revivedTxt}。${refillRows.length > 0 ? `已自动补充 ${refillTxt}。` : ''}${shortTxt.length > 0 ? `仍有 ${shortTxt}。` : ''}`
      : `机群战损：${text} 被近防炮击落、共 ${total} 架（回收率 ${ratePct}%，优先回收高价值）${revivedTotal > 0 ? `，战中复活 ${revivedTotal} 架` : ''}——已从无人机舱清单扣除。${refillRows.length > 0 ? `已自动补充 ${refillTxt}。` : ''}${shortTxt.length > 0 ? `仍有 ${shortTxt}。` : ''}`
  // 结构化结果（2026-09-11：战报弹层要显示"回收了哪些、净损失哪些"；与 battle 起手时刻配对，
  // 避免并行会话/AI 战斗的结果串场）——只在**当前驾驶船**的结算里写，AI 副船的损失不进战报
  if (state.shipId === shipId) {
    state.droneLossReport = {
      battleStartedAtGameMs: battle?.startedAtGameMs ?? 0,
      rate,
      total,
      recovered,
      gone: Math.max(0, total - recovered - revivedTotal),
      survivors,
      rows: byValue.map((r) => ({
        id: r.id,
        name: r.name,
        value: r.value,
        lost: r.lost,
        back: r.back,
        // 逐型的净损失同样减掉**该型**战中复活的架数（与总账同一口径）
        gone: Math.max(0, r.lost - r.back - (revivedMap[r.id] ?? 0)),
      })),
    }
  }
  return text
}

/** 多波演出窗口总时长（2026-09-09）：单次大预算推进（胜率 MC/校准工具）把 state.gameMs * 一次设到 maxBattleMs+余量——若波次间隙（waveEnterGapMs，战斗时钟冻结）吃掉余量，末段
 * 跨窗口会提前耗尽预算判负。调用方应在预算外加本值（无 waves = 0）。
 * （2026-10-02 批次 4j 迁到 combatMath.ts，本文件借回 + 再导出） */

/**
 * **解析本拍该跑多少倍速**（唯一判据点）：
 * - **非洞内战斗** ⇒ 1（倍速只属于虫洞，船长 2026-09-19）；
 * - **科技未解锁** ⇒ 1（`matterTechBattleSpeed` 1 = 没点过时间压缩矩阵）；
 * - 否则把传入档位**夹到已解锁档位**（界面传错 / 老档 / 改档都拿不到未解锁的速度）。
 */
function resolveBattleSpeed(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  want: number,
): number {
  if (!battle.wormhole) return 1
  const tiers = matterTechBattleSpeedTiers(state, ctx)
  const pick = Math.floor(want)
  if (!Number.isFinite(pick) || pick <= 1) return 1
  let best = 1
  for (const t of tiers) if (t <= pick && t > best) best = t
  return best
}

/**
 * **推进指定战斗**（主控远征与 AI 远征通用）；结束后 ended 非空由调用方结算。
 *  favorAdv：AI 远征专属优势量 ∈[−1,1]（null = 玩家手动战斗，无 favor）——
 *  AI 方命中 ×(1+k·adv)（可到 100%），敌方 ×(1−k·adv)（上限保留 97%）。
 *  `opts.battleSpeedX`：**本拍想跑的倍速**（1 缺省 = 老行为）——**只由前台心跳传**，
 *  离线/后台结算/AI/胜率模拟一律不传 ⇒ 逐字等价；实际生效值还要过
 *  `resolveBattleSpeed` 的"洞内 + 已解锁档位"夹紧，写进 `battle.speedX` 供界面与演出窗口用。
 */
export function advanceBattleFor(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  shipId: string,
  anomalyId: string | null,
  favorAdv: number | null = null,
  lairTier?: LairTier,
  factionActive?: boolean,
  opts?: { battleSpeedX?: number },
): void {
  if (!battle || battle.ended) return
  // **倍速时间轴**（2026-09-19 · 谜质科技「时间压缩矩阵」）：先解析本拍生效倍速并写进战斗
  //（夹在科技已解锁档位内；洞外战斗恒 1）。写值只为**洞内**战斗——洞外保持"字段不存在"，
  // 演出窗口与界面据此逐字走老路径。
  const speedX = resolveBattleSpeed(state, ctx, battle, opts?.battleSpeedX ?? 1)
  if (battle.wormhole) battle.speedX = speedX
  /** 本拍的"现在"（战斗时钟口径；1× 时 = `state.gameMs`） */
  const nowMs = (): number => battleClockNowMs(state, battle)
  /** **每拍收尾：刷新倍速锚点**（把"此刻的全局时钟"与"此刻的战斗时钟"重新配对） */
  const rebaseAxis = (): void => {
    battle.speedAxis = { anchor: state.gameMs, clock: battle.lastTickGameMs }
  }
  const baseAnomaly = applyFoeOverride(battleAnomalyOf(ctx, anomalyId, lairTier, factionActive), battle.foeOverride)
  if (!baseAnomaly) return
  // 虫洞战斗（F 批）：**每拍按层重建**派生敌卡（**与开战同源**——同一处 `wormholeDerivedAnomaly`）
  const anomaly = battle.wormhole
    ? wormholeDerivedAnomaly(ctx, baseAnomaly, battle.wormhole)
    : baseAnomaly
  const bal = ctx.balance.battle
  /**
   * **本场的敌阵规格**（2026-09-24 起提前到这里）：只用于算**敌方干扰舰的射程压制率**
   * （`meRangeMulOf`，见 `buildMyUnitSpecs` 的入参说明）。⚠ `createFoeSpecs` 只吃 `anomaly` 与 `bal`，
   * **不依赖我方规格** ⇒ 提前建不改变任何既有口径（下游仍用同一份、同一序）。
   *
   * ⚠⚠ **2026-09-25 修：干扰压制必须取"当前波"**（`activeFoeSpecsOf(…, battle.waveIdx)`），
   * 不能取第 0 波。原先写 `createFoeSpecs(anomaly, bal)`（= **恒定第 0 波**）⇒ 多波卡里干扰舰在
   * 后续波出场时，**界面射程弧显示被压制、引擎实际开火门却是原射程**（两处各拿一份敌阵）。
   * 与视图（`battleArcsFor` 同一行取法）统一 ⇒ 显示与实际同一把尺。
   * ⚠ `foes`（下面 `foeDesire` / `openM` 用的那份）**照旧取第 0 波**：那是"开战距离"的既有口径，
   * 本次只动干扰压制这一件事，不顺手改距离账。
   */
  const foesForDebuff = activeFoeSpecsOf(anomaly, bal, battle.waveIdx)
  /**
   * **电子舰 · 压制敌舰射程**（2026-09-18）：**每拍重算**（运行态、不随档 ⇒ 换编队/读档都不陈旧）。
   * 编队口径 = `battle.myFleet`（单船路径取本条 `shipId`）。
   *
   * ⚠ **必须排在 `buildMyUnitSpecs` 之前**（2026-09-24 挪上来）：H 族干扰压制要按"敌方干扰 −
   * **我方电子舰**"算净削减，读的正是本函数写下的 `battle.meFoeRangeDebuff`；晚一步就会让本拍的
   * 我方规格吃错净削减（船长例①/②/③全走这一减）。
   */
  applyFoeRangeDebuff(state, ctx, battle, battle.myFleet?.map((e) => e.shipId) ?? [shipId])
  const myUnits = buildMyUnitSpecs(state, ctx, battle, shipId, anomalyId, foesForDebuff)
  if (myUnits.length === 0) {
    battle.ended = 'foe'
    return
  }
  const me = myUnits[0]! // 主控：距离 / 期望交距 / favor 等既有口径的锚（单船路径 = 唯一那条）
  /**
   * **本场开战距离**（= 首波口径）：只服务**转场回拉**（`waveReopenFrac`）与**增援补入**
   * （`resolveReinforcements`）。⚠ 敌方的"期望距离"与它的钳制上界**不用它**——那两个按**当前波**算，
   * 见下面 `foeDesire` 的注释。
   */
  const foes = createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  const favor =
    favorAdv === null
      ? null
      : { meMul: 1 + bal.aiFavorStrength * favorAdv, foeMul: 1 - bal.aiFavorStrength * favorAdv }
  // 多波次（2026-09-09）：按 AnomalyDef.waves 分批推进；无 waves = 单波（现行为）
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const lastIdx = waves ? waves.length - 1 : 0
  /** 本波敌阵：与视图（`battleArcsFor`）**同一个取法** `activeFoeSpecsOf`（干扰压制两处同源） */
  const specsOf = (wi: number): UnitSpec[] => activeFoeSpecsOf(anomaly, bal, wi)
  let waveIdx = Math.min(battle.waveIdx ?? 0, lastIdx)
  let curFoes = specsOf(waveIdx)
  /**
   * **本波敌方的期望距离与钳制上界**（`let`：**换波时按新一波重算**）。
   *
   * 船长 2026-09-25 报障①：「**敌人期望距离似乎不会变化？**」——病根就在这两行的**初值**：
   *
   * - **必须取"当前波"**（`curFoes`）—— 2026-09-25 早前那版只加了"**换波时刷新**"，可那个分支
   *   只在**同一次调用里**跑完整个转场（清空→等演出窗口→续刷下一波）时才会执行；而引擎是**逐拍调用**
   *   `advanceBattleFor` 的：转场发生在第 N 拍，第 N+1 拍进来时 `battle.waveIdx` 已经是新波、
   *   转场分支不再触发 ⇒ 初值又用**第 0 波**那份 `foes` 算了一遍。
   *   实测（旗舰战 · 真实引擎）：第 2 波（墨潮鱼雷舰 ×3 ＋ 干扰舰，`kite` 带 1,000~12,000）
   *   引擎里 `foeDesire` 恒为 **2,352**（第 1 波突击舰的值），而界面按当前波显示 **10,350**
   *   ⇒ 敌人**实际往里收**、读数却写"想拉开"。
   *
   * 口径（与视图同一把尺）：
   * - `foeDesire` = `foeDesiredRange(本波敌阵)`（含我方电子舰削减、含条目/舰级的 `desireRangeM` 钉值）；
   * - `desireCapM` = `battleOpenM(me, 本波敌阵)` —— 即「**这一波若单独开战，开战距离在哪**」，
   *   与视图 `Math.min(openM, foeDesiredRange(...))` 的钳制上界同源；
   * - ⚠ **单波场次逐字等于旧行为**（同一份敌阵、同一算式，只算一次）。
   */
  let foeDesire = foeDesiredRange(me, curFoes, bal, battle.meFoeRangeDebuff ?? 0)
  let desireCapM = battleOpenM(me, curFoes, bal)
  // 开战首波由 startBattleFor 生成（无装填延迟）；此处只兜读档中断补缺（视为增援入场）
  for (const f of curFoes) {
    // ⚠ 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**带入场触发、条件未命中的单位
    // 不许在这里补缺**——否则每次推进都会把"还没该到的援军"直接塞进战场（本批用例抓到过这个洞）。
    // 它们只由下面的 `resolveReinforcements` 按条件补入；开关关闭时本字段一律不存在 → 本行不生效。
    if (f.foeReinforceAt) continue
    // 读档中断补缺 = 视为"增援入场" ⇒ 同样盖入场窗口（时刻取**全局时钟**，理由同转场那一处）
    seedUnit(battle, f, { enterReload: true, arrivedAtMs: nowMs() })
  }
  let guard = 0
  while (nowMs() > battle.lastTickGameMs && !battle.ended && guard < BATTLE_MAX_STEPS) {
    guard++
    restoreFoeWebSpecs(curFoes)
    // 切波：当前波全灭且还有后续波 → 先走演出窗口（爆炸/残骸播完），窗口结束才续刷下一波。
    // 窗口语义（2026-09-09 船长反馈"切换突兀/爆炸未播完就刷下一波"）：
    // - 清空瞬间记 waveClearAt = 战斗时钟 + waveEnterGapMs；窗口内本拍只停表等待
    //   （battle.lastTickGameMs 不推进——与击杀慢镜同语义：演出时间不计入 maxBattleMs 超时）；
    // - 实时战斗中游戏时钟与墙钟 1:1，窗口 = 上一波最后一艘的爆炸 + 残骸淡出完整播完；
    // - 大步长/离线推进下 state.gameMs 越过窗口即立刻续刷，无额外等待。
    if (
      waves &&
      waveIdx < lastIdx &&
      // 参战敌阵含**已入场的支援舰**（`sup{n}-`）：它们还活着就不算本波清空（否则"复活出来的船
      // 还在场，下一波却已经刷出来"，两份编队同时在打）
      !foesWithSupport(battle, curFoes).some((f) => isAlive(battle, f.tag))
    ) {
      // ⚠ 转场窗口在**洞内现行玩法里几乎走不到**（网格层一律单波，只有老档 `pendingNode` 路径可能多波）；
      //   这里的 `× speedX` 与 `battleShowWindowMs` 同一口径（倍速只压进度、不压演出）
      const gapMs = Math.max(0, bal.waveEnterGapMs ?? 0) * speedX
      /** **进入本拍时就已经在等**转场窗口（= 真的等过一段，而不是"本拍才发现全灭、本拍就续刷"） */
      const pendingGap = battle.waveClearAt !== undefined
      if (gapMs > 0 && battle.waveClearAt === undefined) {
        battle.waveClearAt = battle.lastTickGameMs + gapMs
        const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
        addLog(
          state,
          'warn',
          `⚔ 第 ${waveIdx + 1}/${waves.length} 波已全灭（${waveName ? waveName + '·' : ''}${anomaly.name}），` +
            (bal.waveReopenEnabled === true ? '敌方增援正在从远处入场…' : '敌方增援正在入场…'),
        )
      }
      if (gapMs > 0 && battle.waveClearAt !== undefined && nowMs() < battle.waveClearAt) break // 演出窗口未走完：停表等待，下一拍再续
      /**
       * **这一波是不是"真的等过转场窗口"**（`pendingGap`：进入本拍时 `waveClearAt` 就已经在）。
       * 只有它为真时才盖入场窗口（船长 2026-09-14「动画没结束不开火」）：
       * - **实时**：清空那一拍先记 `waveClearAt` 并 `break`，等 33 拍后才走到这里 ⇒ **等过** ⇒ 有动画、给窗口；
       * - **大步长 / 离线补算**：一次推进就跨过了整个窗口（本拍才发现全灭、`state.gameMs` 一上来就 ≥
       *   `waveClearAt`）⇒ **没等过**、玩家根本没看见过转场（也就没有动画可言）⇒ **不盖窗口**，
       *   行为与改动前逐字一致（否则"离线结算时最后一波敌人免疫到本次推进结束"⇒ 该赢的场次会被
       *   拖成超时判负——`tests/wave-battle.test.ts` 的大步长用例抓到过）；
       * - `waveEnterGapMs = 0`（无转场节拍）⇒ 同样不盖（没有转场演出，也就没有入场动画）。
       */
      const waitedGap = pendingGap
      battle.waveClearAt = undefined
      waveIdx += 1
      battle.waveIdx = waveIdx
      /**
       * **换波 ⇒ 记下本波起点**（**船长 2026-10-02 改判**：「**旗舰挂载件的会随波重置**」）——
       * 「聚焦阵列」的远端衰减爬升以它为计时锚（`foeWaveStartMsOf`）；取 `nowMs()`（= 全局时钟，
       * 即新一波**真正入场**的那一刻）而不是 `battle.lastTickGameMs`：转场窗口里战斗时钟是**冻住**的
       * （上面那条"停表等待"），拿冻住的值当"现在"会把起点算到过去（与 `arrivedAtMs` 同一处坑）。
       */
      battle.foeWaveStartMs = nowMs()
      curFoes = specsOf(waveIdx)
      /**
       * **换波 ⇒ 期望距离与钳制上界随新一波刷新**（船长 2026-09-25 报障；口径详见上面 `foeDesire` 的注释）。
       * 位置在 `curFoes` 换新之后、`seedUnit` 之前 —— 本拍之内新一波就已按自己的期望距离机动。
       */
      foeDesire = foeDesiredRange(me, curFoes, bal, battle.meFoeRangeDebuff ?? 0)
      desireCapM = battleOpenM(me, curFoes, bal)
      // 增援入场装填（转场窗口）+ **入场窗口**（船长 2026-09-14「动画没结束不开火」）：
      // 逐舰错峰写进 `enteredAtMs`，与界面 `--arrive-delay` 同一算式 ⇒ 动画演完才可被选中。
      // ⚠⚠ **入场时刻取 `state.gameMs`（全局时钟 / 本帧结束时的推进目标），绝不能取 `battle.lastTickGameMs`**
      //   ——转场窗口内战斗时钟是**冻住**的（上面那条"停表等待"），此刻它还是"上一波全灭那一刻"的值；
      //   本帧收尾时战斗时钟会**追平**全局时钟（实测：一帧内推进了 3300ms）⇒ 拿冻住的值当"现在"
      //   会把窗口算到**过去**（真 BUG：窗口一出生就已过期、新一波照样在登场那一拍被打死）。
      //   按全局时钟算 ⇒ 窗口 = **追平之后实实在在的 950ms**（实测：14800 入场 → 15900 才掉第一滴血）。
      if (waitedGap) {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, {
            enterReload: true,
            arrivedAtMs: nowMs() + i * BATTLE_ARRIVAL_STAGGER_MS * speedX,
            // 洞内：同一波新入场的敌舰也按序错开首轮（见 `WORMHOLE_FOE_VOLLEY_STAGGER_MS`）
            ...(battle.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
          }),
        )
      } else {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, {
            enterReload: true,
            ...(battle.wormhole ? { foePhaseMs: i * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
          }),
        )
      }
      // 近防炮调度随波重建（pdCd 与敌编队同序）
      if (battle.pdCd && battle.dronePools) {
        battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
      }
      // 敌机机群随波重建（2026-09-11 机群批）：每波单位是新对象、tag 也不同 ⇒ 旧池自然作废
      initFoeDronePools(battle, curFoes);
      // 挂载件「船体修理装置」账本（幂等）：新波里挂了这件的单位补账本，已在账上的**不重置计时**
      initFoeRepairPulses(battle, curFoes);
      // 波次转场（2026-09-09 船长建议）：把战斗距离向开战距离回拉 waveReopenFrac 比例——
      // 增援从"更远的接战距离"进入，双方重新接近（重演接近期，kite/远程敌同样被拉回）；
      // 0 = 原地续战（旧行为），1 = 完整回到开战距离
      // ⚠ **2026-09-11 船长：「将敌人增援波次距离会后退的惩罚暂时关闭」** ⇒ 本段由**总开关
      //   `waveReopenEnabled`** gate（现值 false = 关闭）：关闭时**距离原地不动**，下一波在当前交战距离入场，
      //   玩家可见日志同步改为中性表述（不再说"从远处入场 / 重新接近中"——否则文案与实际不符）。
      //   机制整套保留：把开关改回 true 即恢复 2026-09-09 口径。
      const reopenOn = bal.waveReopenEnabled === true
      const reopen = reopenOn ? (bal.waveReopenFrac ?? 0) : 0
      if (reopen > 0 && Number.isFinite(openM)) {
        battle.distanceM = Math.round(openM * reopen + battle.distanceM * (1 - reopen))
      }
      const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
      addLog(
        state,
        'warn',
        `⚔ 第 ${waveIdx + 1}/${waves.length} 波来袭（${waveName ? waveName + '·' : ''}${anomaly.name}）：` +
          (reopenOn ? '敌方增援自远处入场，重新接近中。' : '敌方增援入场。'),
      )
      continue
    }
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）——每拍结算"尚未入场"的编成条目；
    // 放在 `stepBattle` **之前**：上一拍刚打死的单位本拍即可触发援军，且判胜检查看到的是补入后的编队。
    // 总开关关闭时本函数第一步就返回（且建档期也没写过 `foeReinforceAt`）= 零行为变化。
    resolveReinforcements(state, ctx, battle, anomaly, curFoes, bal, openM)
    /**
     * **支援舰召唤**（船长 2026-09-25：「支援舰船召唤装置」）——与上面那条同位置（`stepBattle` 之前）：
     * 上一拍刚打死的僚舰，本拍就能被"复活/支援"补回场；没挂该件的战斗第一步就返回（零行为变化）。
     */
    const dt = Math.min(BATTLE_STEP_MS, nowMs() - battle.lastTickGameMs)
    advanceFoeAbilityClocks(battle, curFoes, dt)
    resolveFoeRevive(state, battle, curFoes, bal, nowMs())
    /**
     * **无人机储备甲板：每拍复位**（2026-09-27 船长令）——与上面那条**同位置**（`stepBattle` 之前）：
     * 本拍到点补回来的那架，这一拍就重新进开火循环/选靶池。
     * 周期到点判定读的是**战斗时钟** ⇒ 离线大步长一次跨多秒也照样把该补的架数按周期逐格补齐
     * （"离线折算"不必另写公式）；没装这件装备 ⇒ 字段不存在 ⇒ 一步返回（零行为变化）。
     */
    resolveDroneRevive(state, ctx, battle, nowMs())
    /**
     * **本拍参战敌阵**（编成 ＋ 已入场支援舰）——**必须在 `resolveFoeRevive` 之后取**：
     * 本拍刚召唤入场的支援舰这一拍就进开火循环/选靶池（支援舰与编成的关系见 `foesWithSupport`）。
     */
    const liveFoes = foesWithSupport(battle, curFoes)
    if (!battle.foeRepair && liveFoes.some(f => (f.repairPct ?? 0) > 0)) {
      battle.foeRepair = { nextPulseAtMs: battle.lastTickGameMs + REPAIR_PULSE_MS, pulses: 0, healed: 0 }
    }
    stepBattle(
      state,
      battle,
      myUnits,
      liveFoes,
      foeDesire,
      // **钳制上界取"本波"的开战距离**（`desireCapM`；单波场次 = 上面的 `openM`，逐字不变）
      desireCapM,
      bal,
      dt,
      favor,
      waves ? waveIdx < lastIdx : false,
      // 敌方选靶模式（虫洞内敌卡专属；缺省 random）——单船路径不消费选靶随机数，见 pickMyUnitTarget
      anomaly.foeTargeting ?? 'random',
      // 倾向概率（2026-09-14 船长定 0.6；缺省 1 = 铁律 ⇒ 洞外场次连一次骰都不掷）
      anomaly.foeTargetingChance ?? 1,
    )
    battle.lastTickGameMs += dt
    // 连续作战保险（2026-09-08 船长定，仅巡回场次 battle.hullEscapeFrac 有值）：
    // 本场结构损失过半（剩余 < 满值结构 × 阈值）→ 中止步进并请求自动撤退，绝不拖到弃船
    if (!battle.autoEscaped && battle.hullEscapeFrac !== undefined) {
      const pl = battle.units['player']
      if (pl && pl.hp.h < me.hp.h * battle.hullEscapeFrac) {
        battle.autoEscaped = true
        battle.escapeReason = 'hull'
        break
      }
    }
    /**
     * 船体维修装置脉冲（**逐舰 · 逐台** · 2026-09-16 船长「甲」＋ **2026-09-21 逐型号独立回转**）：
     * 本拍内到期的脉冲补齐——修复发生在受伤结算之后（≤1 拍延迟，保守口径）；战斗结束/自动撤退后不再补跳。
     *
     * ⚠ **2026-09-21 船长令**：「**哪怕同类型装备，只要是不同型号，就要独立的回转冷却**」⇒ 循环从
     * "逐舰、一跳结算全部装置"改为**逐舰 × 逐台**：每台装置按**自己的** `nextPulseAtMs` 到点就跳，
     * 各修各的量（改前第一台跳完这一拍就结束，装三台与装一台几乎没差别）。
     *
     * ⚠ **旧档迁移**（在途战斗没有逐台字段）：借账本那一个 `nextPulseAtMs` 当"本拍是否到期"，
     * 到期后给所有未停机装置**同时补上这一跳并各自排下一跳**（等价于旧口径的"一跳结算全部"，
     * 只是从此转入逐台计时；迁移不需要升版本、不动存档字段名）。
     */
    if (!battle.ended && repairLedgersOf(battle).length > 0) {
      const specByTag = new Map(myUnits.map((u) => [u.tag, u]))
      for (const { tag, ledger } of repairLedgersOf(battle)) {
        if (battle.ended) break
        const spec = specByTag.get(tag)
        if (!spec) continue // 该舰已不在这场（沉了/被摘）⇒ 它的账本不跳
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const interval = equipmentCycleMsOf(state, ctx, owner, REPAIR_PULSE_MS)
        /** 逐台：own = 本台自己的计时器；旧档（无逐台字段）⇒ 借账本的统一计时器（本拍只判一次到期） */
        const hasPerUnit = ledger.units.some((u) => u.nextPulseAtMs !== undefined)
        if (!hasPerUnit) {
          const legacyAt = ledger.nextPulseAtMs
          if (legacyAt === undefined || legacyAt > battle.lastTickGameMs) continue
          /** 迁移落地：本拍给所有未停机装置补跳一次，并把它们各自的计时器排到本拍时刻之后 */
          for (const u of ledger.units) {
            if (u.stopped) continue
            u.nextPulseAtMs = legacyAt
            }
        }
        for (const unit of ledger.units) {
          if (battle.ended) break
          if (unit.stopped) continue
          if (unit.nextPulseAtMs === undefined || unit.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardR = 0
          while (
            !battle.ended &&
            unit.nextPulseAtMs !== undefined &&
            unit.nextPulseAtMs <= battle.lastTickGameMs &&
            guardR < BATTLE_MAX_STEPS
          ) {
            const alive = pulseRepairsFor(state, ctx, battle, spec, ledger, specByTag, unit)
            if (!alive) {
              // 本舰阵亡 ⇒ 全部装置永久停机（脉冲函数已把账本计时清空）
              for (const u2 of ledger.units) u2.nextPulseAtMs = undefined
              break
            }
            /**
             * ⚠ **逐台计时器由谁前移**：`pulseRepairsFor` 只负责"结算这一跳"，计时器推进在**这里** ——
             * 与另两族（流里 `nextPulseAtMs += ms`）同款，避免"结算函数既改业务又管调度"两处口径。
             *
             * ⚠⚠ **必须判"这一跳之后它还活着吗"**：组件耗尽 / 修不动都会在结算里把该台 `stopped` 或
             * 清掉它自己的计时器；这里若无条件前移，就会把刚清掉的计时器**又写回来**
             * （我第一版就是这么错的：最后一台停机那一跳之后账本还留着 20,000，用例当场抓出）。
             */
            if (unit.stopped) {
              unit.nextPulseAtMs = undefined
              if (!ledger.units.some((u) => !u.stopped)) ledger.nextPulseAtMs = undefined
              break
            }
            unit.nextPulseAtMs = (unit.nextPulseAtMs ?? battle.lastTickGameMs) + interval
            guardR++
          }
        }
      }
    }
    /**
     * **敌方后勤脉冲**（船长 2026-09-16）：只在场上存在 `repairPct > 0` 的敌舰时才有账本
     * （`battle.foeRepair` 由开战建档；缺省 ⇒ 零开销、零行为变化）。
     * 与维修装置同节拍（5 秒），在受伤结算之后补跳；一记脉冲 = 累加一跳修理量。
     */
    if (!battle.ended && battle.foeRepair) {
      let guardF = 0
      while (
        !battle.ended &&
        battle.foeRepair.nextPulseAtMs !== undefined &&
        battle.foeRepair.nextPulseAtMs <= battle.lastTickGameMs &&
        guardF < BATTLE_MAX_STEPS
      ) {
        pulseFoeRepair(battle, liveFoes, battle.foeRepair)
        battle.foeRepair.nextPulseAtMs += REPAIR_PULSE_MS
        guardF++
      }
    }
    /**
     * **挂载件「船体修理装置」脉冲**（船长 2026-09-24）：逐单位各按各的计时器（键 = 战斗 tag），
     * 拍点与后勤脉冲同节拍（5 秒）、在受伤结算之后补跳（≤1 拍延迟）。
     * 账本由开战/换波建档时按"真有单位挂了这件"建（缺省 ⇒ 本块直接跳过 ⇒ 零开销、零行为变化）。
     */
    if (!battle.ended && battle.foeRepairPulses) {
      for (const f of foes) {
        if (battle.ended) break
        if (f.foeRepairPulse === undefined) continue
        const ledger = battle.foeRepairPulses[f.tag]
        if (!ledger) continue
        let guardM = 0
        while (
          !battle.ended &&
          ledger.nextPulseAtMs !== undefined &&
          ledger.nextPulseAtMs <= battle.lastTickGameMs &&
          guardM < BATTLE_MAX_STEPS
        ) {
          pulseFoeMountRepair(battle, f, ledger)
          ledger.nextPulseAtMs += Math.max(1, Math.round(f.foeRepairPulse.everyMs))
          guardM++
        }
      }
    }
    /**
     * 护盾充能装置脉冲（逐舰 · **逐型号** · 2026-09-16 逐舰化 ＋ **2026-09-21 逐型号独立回转**）：
     * 与维修装置**各按各的计时**（30 秒 vs 5 秒），同样在受伤结算之后补跳（≤1 拍延迟）；
     * 破盾后它是唯一能把盾点起来的路径。
     *
     * ⚠ **一场一路一跳**：每路按自己的 `nextPulseAtMs` 到点就跳、只补**那一路**的比例
     * （船长令：「不同型号就要独立的回转冷却」）。改前是"一跳补合计值"——MK1 与 MK3 混装会被
     * 并成一路，弱档的量被并进强档的节奏里。
     */
    if (!battle.ended && shieldChargeLedgersOf(battle).length > 0) {
      const specByTag = new Map(myUnits.map((u) => [u.tag, u]))
      for (const { tag, ledger } of shieldChargeLedgersOf(battle)) {
        if (battle.ended) break
        const spec = specByTag.get(tag)
        if (!spec) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const currentStreams = shieldChargeStreamsOf(state, ctx, owner)
        for (const stream of ledger.streams) {
          stream.ms = currentStreams.find(s => s.modelId === stream.modelId)?.ms ??
            (stream.modelId === '' && currentStreams.length > 0 ? Math.min(...currentStreams.map(s => s.ms)) : stream.ms)
          if (battle.ended) break
          if (stream.nextPulseAtMs === undefined || stream.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardS = 0
          while (
            !battle.ended &&
            stream.nextPulseAtMs !== undefined &&
            stream.nextPulseAtMs <= battle.lastTickGameMs &&
            guardS < BATTLE_MAX_STEPS
          ) {
            pulseShieldChargeFor(battle, spec, ledger, stream)
            ledger.pulses += 1
            stream.nextPulseAtMs += Math.max(1, stream.ms)
            guardS++
          }
        }
      }
    }
    /**
     * **力场脉冲**（2026-09-20 船长「护盾充能力场装置」）：与上面两套**各自计时** ——
     * **逐型号各带各的冷却**（`stream.ms`：MK2 = 10 秒 / MK3 = 8 秒；**2026-09-21 船长令**：
     * 「哪怕同类型装备，只要是不同型号，就要独立的回转冷却」⇒ 由"取最短那一档的一路"改为**逐路**）。
     *
     * ⚠ **必须独立门控**（不能挂在护盾充能那段 `if` 里）：力场与「护盾充能装置」是**两族两件**，
     * 玩家完全可能只装力场不装充能装置 —— 第一版我把它写在上面那个 `if` 内，
     * 结果"只装力场 ⇒ 一跳都不跳"（用例当场抓出）。
     *
     * 2026-10-07：只恢复其他存活单位，有目标且足够支付时才扣施放者满盾代价；排程照旧。
     *
     * ⚠ **本跳的绝对回盾量按"本路施放者（装件舰）的满盾"算**（**2026-09-25 船长改判**：
     * 「恢复量为本舰护盾量的 10%」）⇒ 逐路把**该路的施放者**传给 `pulseShieldFieldFor`；
     * 多舰各带一件时，各路的施放者不同 ⇒ **各按自己满盾各跳一路**。
     */
    if (!battle.ended && Object.keys(battle.shieldFieldBy ?? {}).length > 0) {
      const specByTagF = new Map(myUnits.map((u) => [u.tag, u]))
      for (const [tag, ledger] of Object.entries(battle.shieldFieldBy!)) {
        if (battle.ended) break
        if (!specByTagF.get(tag) || !isAlive(battle, tag)) continue
        const owner = battle.myFleet?.find(e => e.tag === tag)?.shipId ?? shipId
        const currentStreams = shieldFieldStreamsOf(state, ctx, owner)
        for (const stream of ledger.streams) {
          stream.ms = currentStreams.find(s => s.modelId === stream.modelId)?.ms ??
            (stream.modelId === '' && currentStreams.length > 0 ? Math.min(...currentStreams.map(s => s.ms)) : stream.ms)
          if (battle.ended) break
          if (stream.nextPulseAtMs === undefined || stream.nextPulseAtMs > battle.lastTickGameMs) continue
          let guardF = 0
          while (
            !battle.ended &&
            stream.nextPulseAtMs !== undefined &&
            stream.nextPulseAtMs <= battle.lastTickGameMs &&
            guardF < BATTLE_MAX_STEPS
          ) {
            pulseShieldFieldFor(battle, myUnits, stream, specByTagF.get(tag)!)
            ledger.pulses += 1
            stream.nextPulseAtMs += Math.max(1, stream.ms)
            guardF++
          }
        }
      }
    }
  }
  // 本拍收尾：把倍速锚点重新配对（下一拍按新锚点起算增量 ⇒ 切档连续、1× 与老口径逐字一致）
  rebaseAxis()
}

/** 推进当前主控远征的战斗（到耗尽时间或分出胜负） */
export function advanceBattle(state: GameState, ctx: SimContext): void {
  const battle = state.expedition.battle
  if (battle) advanceBattleFor(state, ctx, battle, state.shipId, state.expedition.anomalyId)
}

/* ══════════ 机群战损（2026-09-10 船长拍板「无人机可被击落」，永久损失制） ══════════ */

/** 战后损坏机体的回收比例（2026-09-10 船长：基础 20%，回收学满级 50%） */
/**
 * **回收率（含谜质加成）**（F3c B2 · 船长：「机群回收网」）：既有回收率 + 装置加成，
 * **夹在 100% 以内**（物理上限：回收率是比例）。单点抽出 ⇒ 用例可直接验这条口径。
 */
export function droneRecoveryRateWithBonus(state: GameState, bonus = 0): number {
  return Math.min(1, droneRecoveryRate(state) + Math.max(0, bonus))
}
export function droneRecoveryRate(state: GameState): number {
  const rate = DRONE_SKILL.recoveryBase + DRONE_SKILL.recoveryPerLevel * droneSkillLv(state, 'drone-recovery')
  return Math.min(DRONE_SKILL.recoveryMax, rate)
}

/** 该威胁的敌舰是否装近防炮（威胁 < pdThreatFloor 不装；2026-09-10 船长：60） */
export function pdEnabledFor(threat: number, bal: BattleBalance): boolean {
  return threat >= bal.pdThreatFloor
}

/** **单次出击（分批放飞）的"在空窗口"**（2026-09-12 船长「限制敌机单次出击数量」）——
 *  按**在场架次列表**轮换：每 `cycleMs` 换一批，每批最多 `maxAloft` 架在空（其余在机库待命）。
 *  `cycleMs` 缺省 = 机型装填时长（一批打完换下一批）。
 *  ⚠ 纯**由战斗时钟推导**（`startedAtGameMs` 起算）⇒ **不新增存档字段**；
 *  触发增程/备用补位都会自然改变"在场列表"，窗口随之重排。 */
function aloftDroneSet(
  pools: readonly import('./state').DronePoolEntry[],
  launch: { maxAloft: number; cycleMs?: number },
  reloadMs: number,
  b: import('./state').BattleState,
): ReadonlySet<number> {
  const active: number[] = []
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i]!
    if (p.alive && p.inHangar !== true) active.push(i)
  }
  const out = new Set<number>()
  if (active.length === 0) return out
  const k = Math.max(1, Math.min(Math.round(launch.maxAloft), active.length))
  const cycle = Math.max(200, launch.cycleMs ?? reloadMs)
  const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
  const batch = Math.floor(elapsed / cycle)
  const start = (batch * k) % active.length
  for (let j = 0; j < k; j++) out.add(active[(start + j) % active.length]!)
  return out
}


/**
 * **闪现的"一跳"**（**船长 2026-10-01 三次裁定**，敌我**同一口径**）：
 * 从当前位置朝目标距离走一跳，**单次位移不超过 `stepM`**：
 * - 相距不到 `stepM` ⇒ 正好落在目标上（"一次闪到位"）；
 * - 相距超过 `stepM` ⇒ 只走 `stepM`（**要归位就得闪多次**）。
 *
 * 🔴 为什么必须有这个上限（船长原话）：「**闪现之前不是设定每次闪现最多2000米吗**」——
 * 上一版我为了修「越闪越远被无伤」把落点改成了"闪到期望距离"，**却把件上那个 `distanceM`（2,000m）
 * 当成无用字段丢在一边** ⇒ 实测出现过 **3,185m 的单次瞬移**（`corona-nexus` 第 4 波：换波时期望距离
 * 突变 5,740 → 8,925）。船长报的正是这个。
 *
 * ⚠ **方向与步长是两件事，缺一不可**：方向（朝谁走）由调用方给的目标决定，步长（跳多远）由件决定
 * ⇒ 两者都在，才既不会"越闪越远被无伤"、也不会"一键归位/瞬移一大截"。
 * ⚠ 多闪几次才归位 = **闪烁过载的结构代价真的按次计**（每闪一次扣上限 5%）——这正是该件设计意图。
 *
 * @param curM 当前交战距离
 * @param wantM 目标距离（敌 = 它自己的期望交战距离；我 = 朝远离侧拉开）
 * @param stepM 单次位移上限（= 件上的 `blink.distanceM`）
 * @param minM 交战距离下限、`maxM` 战场最大距离（两端都钳）
 * @returns 跳完之后应该站在哪；**与 `curM` 相同 = 跳不动**（调用方据此不白盖冷却）
 */
function blinkStep(curM: number, wantM: number, stepM: number, minM: number, maxM: number): number {
  /**
   * ⚠ **起点与目标都要先取整再算步长**（2026-10-01 修）：`distanceM` 是**逐拍走位累加出来的小数**
   * （实测 3553.48416），若只在最后对落点取整，跳幅会变成 `|round(起点 ± 2000) − 起点|`
   * = **2000.207**（超出件上限 0.2 米，实测踩到）。取整后两断点都是整数 ⇒ 跳幅恒 ≤ `stepM`，
   * 与"距离以米为单位、件上写 2,000"的语义一致。
   */
  const cur = Math.round(curM)
  const want = Math.round(wantM)
  const gap = want - cur
  const moved = cur + Math.sign(gap) * Math.min(Math.abs(gap), stepM)
  return Math.max(minM, Math.min(maxM, Math.round(moved)))
}

/**
 * **敌方「瞬光跃迁仪」的闪现触发器**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）——
 * 由"**敌舰本体被我方命中**"驱动（打它的机群不算、未命中不算）；冷却期内静默。
 *
 * 突变后双向钳制 `[bal.minDistanceM, 战场最大距离]` ⇒ 不会闪出战场。
 * 冷却态记在 `BattleState.foeBlinks[tag]`（`save.ts` 登记 `kind: 'runtime'`，**有意不入档** ——
 * 与 `foeCharges`（冲锋循环）同一口径：落在"重载即重置循环"内）。
 *
 * @returns 本次是否真的闪了（供画面提示＋**闪现动画**用）
 */
function markFoeBlink(
  rt: UnitSpec,
  tag: string,
  b: import('./state').BattleState,
  bal: BattleBalance,
  maxDistanceM: number,
  /** 我方电子舰对敌舰射程的削减率（缺省 0 = 旧口径）——只影响"它想站多远" */
  foeRangeDebuffR = 0,
): boolean {
  const bl = rt.foeBlink
  if (bl === undefined || bl.distanceM <= 0 || bl.cooldownMs <= 0) return false
  // ⚠ `bl.distanceM` = **本跳的位移上限**（2,000m），交 `blinkStep` 执行；
  //   它同时还是"件是否有效"的档位判据（≤0 视为没挂这件）。
  const nowMs = b.lastTickGameMs
  if (nowMs < (b.foeBlinks?.[tag] ?? 0)) return false // 冷却中 ⇒ 再挨打也不闪
  /**
   * **方向 = 朝「敌人自己的期望交战距离」走，步长 = 件上的 2,000m**（**船长 2026-10-01 三次改判**）：
   *
   * > 第一次：「**闪烁的方向问题反而导致敌人能被无伤，建议修改为，闪烁方向以期望距离为目标。**」
   * > 🔴 第二次（实测报障）：「**有些问题，当我攻击敌人后，敌人会瞬间闪现到我的期望距离**」
   * > 🔴 第三次（复核口径）：「**闪现之前不是设定每次闪现最多2000米吗**」
   *
   * 第一次我实现成了"闪到 `b.myDesireM`（**我方**的期望）"——那是**玩家的意图距离**，
   * 于是出现船长实测的怪相：**我方一开火，敌人就瞬移到"我方想要的距离"上**（等于敌人替玩家走位）。
   * 第二次我改成"闪到**它自己的**期望距离 `foeDesiredRange(...)`"（正解：那是它按自己的射程带
   * 与战术算出来的位置，也**正好吃族格覆写**——R 族的 `foeDesireRangeM` 会被钉成"风筝位 / 钻盲区位"），
   * **但把件上的 `distanceM`（2,000m）当成无用字段丢在一边** ⇒ 期望距离一突变（换波等）就出现
   * **3,185m 的单次瞬移**（`corona-nexus` 实测）。第三次裁定把步长补回来。
   *
   * ⇒ 现在 = `blinkStep(当前, 它自己的期望, 2,000, 下限, 战场上限)`：**朝对的方位走，但一次只走 2 公里**
   * ——差得远就多闪几次（每次扣上限 5% 结构，代价照算）；已经在期望距离上 ⇒ **闪不动**（不白盖冷却）。
   *
   * ⚠ 射程压制（我方电子舰）照常计入：与 `advanceBattleFor` 的走位口径同一把尺，不传时按 0。
   */
  const want = foeDesiredRange(rt, [rt], bal, foeRangeDebuffR)
  const landed = blinkStep(b.distanceM, want, bl.distanceM, bal.minDistanceM, maxDistanceM)
  if (landed === b.distanceM) return false // 已在期望距离上／已被钳到边界 ⇒ 闪不动（不白盖冷却）
  /** 记账起点 = **取整后的位置**（与 `blinkStep` 内部同一把尺）：`distanceM` 是逐拍累加的小数，
   *  若记小数起点，跳幅会带上 0.2 米级尾巴（实测 2000.207）⇒ 与"件上写 2,000"的语义不符。 */
  const from = Math.round(b.distanceM)
  const moved = Math.abs(landed - from)
  /**
   * 🔴 **位置不在这里换**（**船长 2026-10-02 令**：「**移动的时间节点应该放在发生时间的等待处**」）——
   * 旧实现在这一行就写了 `b.distanceM = landed`（"触发即换位"）⇒ 演出里**没有"等待"这一段**，
   * 船长的实机反馈指的正是这个。现在改成：**入队 + 等到 `moveAtMs` 那一拍由 `settleBlinkQueue` 兑现**。
   */
  if (!b.foeBlinks) b.foeBlinks = {}
  b.foeBlinks[tag] = nowMs + bl.cooldownMs
  /**
   * **旁路记账：这一跳从哪起跳、走了多远、朝哪边**（2026-10-01 加，见 `BattleState.foeBlinkJumps` 头注）——
   * 只写不进任何算式。存在的理由：落点是**全局标量**，多舰同拍各闪一次时，光看 `distanceM`
   * 的变化**既分不出单舰跳幅、也分不出单舰方向**（实测踩过：聚合位移 2,678 m 被误读成"一跳超 2,000m"）。
   * ⚠ 记账在**触发当刻**就写好（跳幅与方向**与兑现时刻无关**）⇒ 用例读数不受"位移推迟"影响。
   */
  if (!b.foeBlinkJumps) b.foeBlinkJumps = {}
  b.foeBlinkJumps[tag] = { from, moved, dir: landed > from ? 1 : landed < from ? -1 : 0 }
  /**
   * 🔴 **排进"闪现演出队列"**（**船长 2026-10-01 令**：「**闪现现在会有一个发生时间，同时触发的多个闪现
   * 需要排队发生**」；口径与时刻表见 `BattleState.foeBlinkQueue`）——
   * **多个闪现依次排定**，每段占「整个过程 ＋ 间隔」，本舰那一段从现在开始。
   * ⚠ **不停表**（船长裁定）：战斗时钟照走，只是这段窗口里**我方不开火**（`blinkHoldSides` 门控）。
   */
  const queue = b.foeBlinkQueue ?? (b.foeBlinkQueue = {})
  /**
   * 排期：**从"已有各段里最晚的那个结束时刻"起、再加一个间隔**，本舰那一段才开始
   * （船长：「**多个闪现需要有200ms的间隔**」⇒ 段与段之间空一个 `foeBlinkGapMs`；
   * ⚠ `.slice()` 是必需的：下面马上要往同一个 `queue` 里写本舰，先取快照免得跳过一段）。
   */
  let startMs = nowMs
  for (const q of Object.values(queue).slice()) startMs = Math.max(startMs, q.appearMs + blinkGapMs(bal))
  const vanishMs = startMs
  /** 三段的边界（见 `foeBlinkQueue` 头注）：消失 → **等待（位移在这一瞬兑现）** → 出现 */
  const moveAtMs = vanishMs + Math.round((blinkProcessMs(bal) * BLINK_VANISH_SHARE_NUM) / BLINK_SHARE_DEN)
  const appearMs = vanishMs + blinkProcessMs(bal)
  queue[tag] = { queuedMs: nowMs, vanishMs, moveAtMs, appearMs, from, to: landed }
  /**
   * 演出事件：界面据此让本舰**消失**并播淡出；位移在 `moveAtMs` 由引擎兑现，界面到 `appearMs`
   * 在新位置播"出现"。
   *
   * ⚠ **`atMs` 一并带动画时长与倍速**（2026-10-02 修）：界面原先**根本没消费 `atMs`**
   * （一律 `set(tag, performance.now())`）⇒ 引擎排好的"依次错开"在画面上被抹平、同一拍触发的
   * 多艘会**同时闪**。现在界面按 `atMs − nowMs` 换算出"该等多久才开始播"，并把游戏毫秒**除以倍速**
   * 折成真实毫秒（`speedX`）⇒ 排队错开与倍速缩放在画面上都能对上。
   */
  pushBattleFx(b, {
    atMs: vanishMs,
    side: 'foe',
    tag,
    type: 'kinetic',
    hit: true,
    blink: true,
    speedX: b.speedX ?? 1,
  })
  return true
}

/**
 * **把"到点的闪现位移"兑现**（**船长 2026-10-02 令**：「**移动的时间节点应该放在发生时间的等待处**」）——
 * 每拍扫一遍队列：`moveAtMs` 到点的段**真正写进 `b.distanceM`**；`appearMs` 过完的段从队列删掉。
 *
 * ⚠ **为什么必须"到点才写"而不是"触发就写"**：船长的演出设计是
 * 「**播放动画的同时舰船消失 → 等待发生时间 → 在新位置播放动画同时舰船出现**」——
 * 位置若在触发当刻就换，"消失"这一段播的就是**新位置**（根本看不到旧位置消失），中间也不存在"等待"。
 * ⇒ 位移落在**消失演完、等待开始**的那一瞬（`moveAtMs`）。
 *
 * ⚠ **队列项一直留到 `appearMs`**（不是兑现位移就删）：界面要读这张时刻表才知道
 * 「哪艘正处在消失→等待→出现」里、以及"出现"从哪一刻开始 ⇒ 提前删会让界面失去时间轴。
 * ⚠ 多条闪现**排队**时各自按自己的 `moveAtMs` 兑现；同一拍到点多个 ⇒ 按队列顺序依次写。
 * ⚠ 幂等：写过的段打 `moved` 标记 ⇒ 同一拍内重复调用不会写两次。
 *
 * 🔴 **2026-10-02 §35：敌我两张表一起结算**（**船长裁定「2甲」**：「**我方闪现的位移兑现点一并统一**」）
 * —— 本批之前**只有敌方**走"到点才写"，我方是"触发即写"（旧 `markMeBlink` 里那一行）。
 * 现在两侧同源：`foeBlinkQueue` 与 `meBlinkQueue` 共用本函数、同一把尺。
 * ⚠ **本仓只有一根距离标量** ⇒ 两侧同拍到点兑现时**后写者胜**（与 §34 那条假红用例同一个事实，
 *   不是新引入的问题；用例的采样粒度须细于引擎子步，见 `corona-loot` ⑥ 头注）。
 */
function settleBlinkQueue(b: import('./state').BattleState): void {
  const now = b.lastTickGameMs
  for (const q of [b.foeBlinkQueue, b.meBlinkQueue]) {
    if (!q) continue
    for (const [tag, seg] of Object.entries(q)) {
      if (now >= seg.moveAtMs && seg.moved !== true) {
        b.distanceM = seg.to
        seg.moved = true
        void tag
      }
      if (now >= seg.appearMs) delete q[tag]
    }
  }
}

/**
 * **闪现演出期间"谁禁火"**（**船长 2026-10-01 令**：「**不停表，但是敌舰消失时，玩家的武器不会开火
 * （哪怕武器转好了）**」；**2026-10-02 §35 扩为双向**：「**我方触发闪现时，闪现禁火对敌人也生效**」）。
 *
 * **口径 = 严格窗口 ＋ 按表分侧**：某一段处在「已消失、还没出现」（`vanishMs → appearMs`，
 * 长度 = `balance.battle.foeBlinkProcessMs`），**对面那一侧**这一拍就全门不开火。
 * - `foeBlinkQueue` 在窗口 ⇒ **`me`**（我方不开火）—— 2026-10-01 的原始口径；
 * - `meBlinkQueue` 在窗口 ⇒ **`foe`**（敌方不开火）—— 2026-10-02 §35 新增。
 *
 * ⚠ **两张表必须分开判**：合成一张会让"我方自己闪"变成"我方自己停火"（详见 `meBlinkQueue` 头注）。
 * ⚠ 判定阈是"离开"而不是"到达"：`appearMs` 那一拍**允许开火**（那一侧已经回来了）。
 * ⚠ 与既有 `cd > 0` 同一口径：**冷却照推**，转好了就停在 0 等窗口，窗口一过立刻开火（不白扣一发）。
 * ⚠ **全队一起演不改变本判据**（**裁定 1甲**）：一次触发只排**一段**，窗口按触发者那一段算
 *   ⇒ 禁火时长与队伍人数无关。
 */
function blinkHoldSides(b: import('./state').BattleState): { me: boolean; foe: boolean } {
  const now = b.lastTickGameMs
  const inWindow = (q: Record<string, import('./state').BlinkSeg> | undefined): boolean => {
    if (!q) return false
    for (const seg of Object.values(q)) if (now >= seg.vanishMs && now < seg.appearMs) return true
    return false
  }
  return { me: inWindow(b.foeBlinkQueue), foe: inWindow(b.meBlinkQueue) }
}

/**
 * **叠光装置的当前装填间隔**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者闪现后，
 * 攻击间隔缩短，最多缩短至0.5秒攻击间隔。**」）——读 `/ 懒初始化 / 顺带推进` 三合一。
 *
 * `baseReloadMs` = 条目的固定装填间隔（本舰主武器那条）。首次访问时把基准值**登记**进
 * `BattleState.foeOverlayReload[tag]`；此后每次调用都按
 * `基准 − stepMs × (开火次数 + 闪现次数)` 现算、夹下限 `floorMs`，并把结果写回登记表。
 *
 * **为什么现算而不是逐次累减**：装填间隔本身决定开火次数 ⇒ 逐次累减要维护两个计数器、还要防
 * "同一拍多算一次"；而 `nowMs` 基准的**开火次数**与**闪现次数**都是单调可数的整数
 * （闪现次数由已过时间 ÷ 冷却直接算出，不缺一个字段），于是同一拍内重复调用**幂等**、重载重开也
 * 不会漂。⚠ 登记表仍记着"当前间隔"，供战报/悬停等展示读（与 `foeBlinks` 同一口径：有意不入档）。
 *
 * @returns 本发的装填间隔（毫秒）；本舰没挂叠光装置 ⇒ 原样返回 `baseReloadMs`
 */
function foeOverlayReloadOf(
  rt: UnitSpec,
  tag: string,
  b: import('./state').BattleState,
  /** 本发的**基准**装填间隔 = 条目上的固定 `reloadMs`（只用来定义"起点"与加速度，不当作当前值） */
  baseReloadMs: number,
): number {
  const od = rt.foeOverlayDrive
  if (od === undefined) return baseReloadMs
  const step = Math.max(1, od.stepMs)
  const reg = b.foeOverlayReload ?? (b.foeOverlayReload = {})
  // 闪现台阶：数"这艘敌舰已经闪现过几次"，再扣掉**已经折算过**的那几次
  //（⚠ 不能由 `lastTickGameMs ÷ 冷却` 推：到点却没挨打 ⇒ 没闪、不该推进；只能查 `foeBlinks`）
  const blink = rt.foeBlink
  const blinkCount =
    blink !== undefined && blink.cooldownMs > 0
      ? Math.max(reg[tag]?.bs ?? 0, countFoeBlinksAt(b, tag, blink.cooldownMs))
      : 0
  const prev = reg[tag]
  // 首次访问 = 基准值；此后按（开火次数 + 闪现次数）现算、夹下限
  const fired = prev?.f ?? 0
  const next = Math.max(od.floorMs, baseReloadMs - (fired + blinkCount) * step)
  reg[tag] = { r: next, f: fired + 1, bs: blinkCount }
  return next
}

/**
 * **本波起点**（战斗时钟 ms）——「聚焦阵列」**逐波重置**的计时锚
 * （**船长 2026-10-02 改判**：「**旗舰挂载件的会随波重置**」）。
 *
 * - 第 1 波（以及一切没换过波的场次）⇒ 缺省回落到 `startedAtGameMs`（**老档 / 单波卡零迁移**）；
 * - 每次**波次转场**由 `advanceBattleFor` 写一次 ⇒ 新一波从 0 起算。
 * ⚠ 用**战斗时钟**而不是全局时钟：转场窗口里战斗时钟是冻住的，窗口那一段不该计入爬升时间。
 */
export function foeWaveStartMsOf(
  b: Pick<import('./state').BattleState, 'foeWaveStartMs' | 'startedAtGameMs'>,
): number {
  return b.foeWaveStartMs ?? b.startedAtGameMs
}

/**
 * **我方「叠光同款 · 装填自加速」的当前装填间隔**（**船长 2026-10-01 令**：「激光武器为叠光同款叠加攻速的，
 * 基础伤害偏低，需要玩家叠满才威力较强」）——与敌方 `foeOverlayReloadOf` **逐字同款**的机制，
 * 只有两处差别：① 键是 `tag#炮位`（一艘船可能装多门）；② **不乘伤害倍率**（船长令只说了"基础伤害偏低"，
 * 那由 `dmgMult` 本身表达 ⇒ 本处不再叠一层折减）。
 *
 * @param baseReloadMs 本条目的**基准**装填间隔（建档时已是"过完技能/射速计算机"的有效值）
 * @returns 本发要用的装填间隔（毫秒）；本门没挂该件 ⇒ 原样返回 `baseReloadMs`
 */
function meOverlayReloadOf(
  spec: UnitSpec,
  tag: string,
  wi: number,
  b: import('./state').BattleState,
  baseReloadMs: number,
): number {
  const od = spec.weapons[wi]?.overlayDrive
  if (od === undefined) return baseReloadMs
  const step = Math.max(1, od.stepMs)
  const key = `${tag}#${wi}`
  const reg = b.meOverlayReload ?? (b.meOverlayReload = {})
  const cur = reg[key] ?? (reg[key] = { r: baseReloadMs, f: 0 })
  const next = Math.max(od.floorMs, baseReloadMs - (cur.f + 1) * step)
  reg[key] = { r: next, f: cur.f + 1 }
  return next
}

/**
 * **我方「三连射」的装填计时 ＋ 本轮记账**（**船长 2026-10-03 令**：「**添加一个旗舰同款的势力能量武器
 * （三连射）…射速为3000MS**」＋定名「三叉戟光束炮」）—— R 族势力激光炮（`mod-lair-beam-r`）专属。
 *
 * 口径与**敌方旗舰那把**（`foeBurstFired` 那一套）**逐字同款**：一轮装填打 `shots` 发、发间隔 `gapMs`；
 * **每发都各自**走一遍选靶 / 扣弹 / 命中 / 飘字（它们在外层循环里，本函数只管计时与记账）。
 * - 本轮**还有下一发** ⇒ 装填计时重置为 `max(0, gapMs − dtMs)`。
 *   ⚠ **减去本拍 `dtMs`** 是必需的：本仓开火环的节拍是"冷却减到 0 的那一拍不开火、下一拍才开火"
 *   ⇒ 直接写 `gapMs` 实得 **200ms**（敌方那张表 2026-10-02 实测踩过同一个坑）。
 * - 本轮**已打完** ⇒ 删除键，并交回 `meOverlayReloadOf`（既有那件装填自加速的出口，本仓两件互斥）。
 *
 * 缺省（本门没挂连发件）⇒ 与改动前**逐字一致**（走 `meOverlayReloadOf`，连一次多余判断都不多做）。
 */
function meBurstReloadOf(
  spec: UnitSpec,
  tag: string,
  wi: number,
  b: import('./state').BattleState,
  dtMs: number,
  baseReloadMs: number,
): number {
  const burst = spec.weapons[wi]?.burst
  if (burst === undefined) return meOverlayReloadOf(spec, tag, wi, b, baseReloadMs)
  const shots = Math.max(1, Math.floor(burst.shots))
  const key = `${tag}#${wi}`
  const reg = b.meBurstFired ?? (b.meBurstFired = {})
  const fired = reg[key] ?? 0
  const more = fired + 1 < shots
  if (more) {
    reg[key] = fired + 1
    return Math.max(0, Math.round(burst.gapMs) - dtMs)
  }
  delete reg[key]
  return meOverlayReloadOf(spec, tag, wi, b, baseReloadMs)
}

/**
 * **我方「跃迁规避装置」的闪现触发器**（**船长 2026-10-01 令**：「闪现装置为中槽，和R族同款，挨打触发闪现。
 * 但是冷却时间延长到12秒。」）——只由"**敌方舰炮命中我方舰船本体**"调用
 * （打我方无人机不算、未命中不算；与敌方那件的受击钩子同口径）。
 *
 * **口径与敌方那件统一**（**船长 2026-10-01**：「**与敌舰统一口径**」）⇒ 两件都走同一条 `blinkStep`
 * （**朝目标走一跳、单次不超过件上的 `distanceM`**）。两件**只差"目标"这一项**：
 * - 敌方：目标是**它自己的期望交战距离**（它往它想站的位置闪）；
 * - 我方：目标是**朝远离敌人一侧拉开**（本件是玩家自己的保命件 ⇒ "挨打换一口气"）。
 *
 * 拉开后引擎的走位逻辑会按 `myDesireM` 逐拍把我方拉回去 ⇒ 净效果 = "挨打换一口气"。
 * 突变受既有钳制（`bal.minDistanceM` 与战场最大距离）；**闪不动时不白耗冷却**。
 *
 * @returns 本次是否真的闪了（供画面提示与闪现动画用）
 */
function markMeBlink(
  spec: UnitSpec,
  tag: string,
  b: import('./state').BattleState,
  bal: BattleBalance,
  maxDistanceM: number,
): boolean {
  const bl = spec.meBlink
  if (bl === undefined || bl.distanceM <= 0 || bl.cooldownMs <= 0) return false
  const nowMs = b.lastTickGameMs
  if (nowMs < (b.meBlinks?.[tag] ?? 0)) return false // 冷却中 ⇒ 再挨打也不闪
  const landed = blinkStep(b.distanceM, b.distanceM + bl.distanceM, bl.distanceM, bal.minDistanceM, maxDistanceM)
  if (landed === b.distanceM) return false // 已被钳到边界 ⇒ 闪不动（不白盖冷却）
  /** 记账起点 = **取整后的位置**（与 `blinkStep` 内部同一把尺；理由同 `markFoeBlink` 那处） */
  const from = Math.round(b.distanceM)
  if (!b.meBlinks) b.meBlinks = {}
  b.meBlinks[tag] = nowMs + bl.cooldownMs
  /**
   * 🔴 **入队 + 到点才换位**（**船长 2026-10-02 §35 裁定「2甲」**：「**我方闪现的位移兑现点一并统一**」）
   * —— 旧实现在上面直接写 `b.distanceM = landed`（"触发即换位"）⇒ 我方的三段演出**没有"等待"**，
   * 而且界面拿不到时刻表（`foeBlinkQueue` 里没有我方 tag）⇒ **演出与光柱一格都不播**（§35.4 的现状）。
   * 现在与 `markFoeBlink` **逐字同构**：排进 `meBlinkQueue`，位移交 `settleBlinkQueue` 在 `moveAtMs` 兑现。
   * ⚠ 排队口径与敌方一致：从"已有各段里最晚的结束时刻 ＋ 间隔"起排本段（`.slice()` 先取快照）。
   */
  const queue = b.meBlinkQueue ?? (b.meBlinkQueue = {})
  let startMs = nowMs
  for (const q of Object.values(queue).slice()) startMs = Math.max(startMs, q.appearMs + blinkGapMs(bal))
  const vanishMs = startMs
  /** 三段的边界（同 `foeBlinkQueue` 头注）：消失 → **等待（位移在这一瞬兑现）** → 出现 */
  const moveAtMs = vanishMs + Math.round((blinkProcessMs(bal) * BLINK_VANISH_SHARE_NUM) / BLINK_SHARE_DEN)
  const appearMs = vanishMs + blinkProcessMs(bal)
  queue[tag] = { queuedMs: nowMs, vanishMs, moveAtMs, appearMs, from, to: landed }
  /**
   * **演出事件**（与敌方那条同款，含 `speedX`）——界面据此排"消失 / 等待 / 出现"三段与两根光柱。
   * ⚠ `atMs` 取 **`vanishMs`**（排队之后真正的起点），**不是**触发刻 —— 界面的排队错开就靠它。
   * ⚠ `speedX` 必须有：引擎给的是**游戏毫秒**、动画跑**真实毫秒**（敌方那条 2026-10-02 补过，此处对齐）。
   */
  pushBattleFx(b, {
    atMs: vanishMs,
    side: 'me',
    tag,
    type: 'kinetic',
    hit: true,
    blink: true,
    speedX: b.speedX ?? 1,
  })
  return true
}
function countFoeBlinksAt(
  b: import('./state').BattleState,
  tag: string,
  cooldownMs: number,
): number {
  const until = b.foeBlinks?.[tag]
  if (until === undefined) return 0
  const elapsed = b.lastTickGameMs - (until - cooldownMs)
  if (elapsed < 0) return 0
  return Math.floor(elapsed / cooldownMs) + 1
}

/**
 * **闪现成功后的挂载件结算**（**船长 2026-10-01 令**）——把"闪现"这件事通知给两个挂在闪现上的装置：
 *
 * - **闪烁过载装置**（粼光级）：「**每次触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。**」
 *   ⇒ 护盾**直接回满**（`hpMax.s`，缺省回落规格 `spec.hp.s`），结构 −`hpMax.h × hullCostPct`；
 *   ⚠ **无保底、可扣死自毁**（船长选「乙」）——扣到 ≤0 就把护盾一并清零 ⇒ 该舰按既有"三层全空 = 阵亡"
 *   口径当场自毁，照常进战报与残骸（**不是**"死不掉"或"锁 1 点"）。
 * - **叠光装置**（叠光级）：「每次…闪现后，攻击间隔缩短」⇒ 这里调一次 `foeOverlayReloadOf` 把它推进一格
 *   （返回值由**开火**那处消费，本处只需保证闪现这一格被算进去）。
 *
 * ⚠ 只由"闪现**真的发生了**"调用（`markFoeBlink` 返回 true / 本函数自身的两个装置均缺省 ⇒ 什么都不做）。
 * 缺省不写 ⇒ 既有各族零行为变化。
 */
function settleFoeBlinkExtras(
  rt: UnitSpec,
  tag: string,
  b: import('./state').BattleState,
  /** 本舰主武器的固定装填间隔（叠光级从调用点带进来；不带叠光的舰走缺省 ⇒ 本函数不推进装填） */
  baseReloadMs?: number,
): void {
  const fo = rt.foeFlashOverload
  if (fo !== undefined) {
    const rtUnit = b.units[tag]
    if (rtUnit !== undefined) {
      // ① 护盾回满（上限优先读容量，缺省回落规格 —— 与全仓「满盾」同一把尺）
      const capS = Math.max(0, rtUnit.hpMax?.s ?? rt.hp.s)
      rtUnit.hp.s = capS
      // ② 结构代价：**结构上限的 5%**（船长选「甲」）——无保底（船长选「乙」：可扣死自毁）
      const capH = Math.max(0, rtUnit.hpMax?.h ?? rt.hp.h)
      if (capH > 0 && fo.hullCostPct > 0) {
        rtUnit.hp.h = rtUnit.hp.h - capH * fo.hullCostPct
        if (rtUnit.hp.h <= 0) {
          rtUnit.hp.h = 0
          rtUnit.hp.s = 0
          rtUnit.hp.a = 0
        }
      }
    }
  }
  // 叠光装置：闪现也推进一格装填（写回登记表；下一发开火时由 `foeOverlayReloadOf` 读出）
  if (rt.foeOverlayDrive !== undefined && baseReloadMs !== undefined) {
    foeOverlayReloadOf(rt, tag, b, baseReloadMs)
  }
}


/**
 * 一步战斗推进。
 *
 * **多单位（虫洞 D 批 · 船长 2026-09-13）**：`myUnits` 恒为**我方编队**——单船路径传 `[me]` 一条，
 * 虫洞内传 `[主控, ...僚舰]`（见 `BattleState.myFleet`）。硬纪律：**`myUnits.length === 1` 时
 * 每一处多单位分支都必须与改动前逐字等价**（尤其**随机数消费顺序**——选靶函数在"只剩一艘"时
 * 直接返回、一次 `nextRandom` 都不多消耗），否则既有 27 张卡的标定读数会整体漂移。
 */
function stepBattle(
  state: GameState,
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
  foes: UnitSpec[],
  foeDesire: number,
  /**
   * **敌方期望距离的钳制上界**（米）。传的是**本波**的开战距离（`advanceBattleFor` 的 `desireCapM`，
   * 换波即刷新）——原语义 = 本场开战距离；单波场次二者逐字同值。
   */
  openM: number,
  bal: BattleBalance,
  dtMs: number,
  favor: { meMul: number; foeMul: number } | null = null,
  hasMoreWaves = false, // 多波（2026-09-09）：本波清空但还有后续波 → 不判胜，由推进方切波续刷
  /** 敌方选靶模式（虫洞内敌卡专属；`random` = 等权随机，多单位下的缺省） */
  foeTargeting: FoeTargetingMode = 'random',
  /**
   * **选靶倾向概率**（船长 2026-09-14「虫洞敌人的攻击倾向，加一个概率」→「挨个定为 60%」）：
   * `1` = 铁律（缺省，不掷骰）· `<1` ⇒ 每发开火前掷一次，没掷中退回随机（见 `pickMyUnitTarget`）。
   */
  foeTargetingChance = 1,
): void {
  const dtSec = dtMs / 1000
  advanceFoeHatcheries(b, foes, b.lastTickGameMs)
  // **我方"不被一击带走"保险：本拍账本清零**（船长 2026-09-16；见 `cappedFoeDamage`。
  // 逐拍重置 ⇒ 运行态、不入档；洞外洞内共用这一处）
  b.meVolleyDmg = {}
  /**
   * **本拍开头：把「待机护盾阵列」的就绪态定死**（**船长 2026-10-03 裁定**「**同一拍整次齐射都算**」）——
   * 必须在**任何伤害结算之前**盖这一份（伤害结算在前、闪现盖冷却在后 ⇒ 现查的话只有触发那一发吃得到）。
   * 只扫带该件的单位 ⇒ 其余场次零成本、零行为变化。
   */
  snapshotFoeStandby(b, foes)
  // 主控 = 编队首条（距离/期望交距/胜率口径的锚；单船路径即唯一那条）
  const me = myUnits[0]!

  // ── 距离机动（无过冲转向：每方朝自己期望距离推进，剩余距离不足本步航程时只走剩余，
  //    到位即停；双方意图相反时在中间形成无振荡角力平衡，杜绝"到点来回抖动"）──
  // 2026-09-10 船长（推进器周期爆发）：我方机动 = 基础机动 ×(1 + 推进器爆发倍率)——**只在爆发窗口内**；
  // 冷却期回到基础值（不再常驻加成）。
  // 2026-09-14 船长（微型跃迁引擎）：窗口**逐单位**判定——各舰按自己装配的周期算（见 `unitThrusterCycle`）。
  const phaseOf = (u: UnitSpec): boolean => thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
  // **整队机动 = 存活我方单位的「平均」战斗机动**（虫洞 D 批 · 船长 2026-09-13 选定"整队平均"）——
  // 与敌方 2026-09-11 定的「敌舰速度按所有船的平均值算」**同一把尺**；单船 = 该船自己（逐字不变）。
  // 爆发倍率**逐舰各取自己的**（装微型跃迁引擎那条只在它自己的 10 秒窗口里快；其余船维持 60/60）——
  // 全队同款推进器时与改前逐字等价（相位与倍率都相同 ⇒ 平均速度 ×(1+倍率)）。
  // 敌方期望距离不得超出开战距离（近距开局下 kite 战术系数可能越界 → 钳制，避免一直想拉开）
  const normalDesire = foes.some(f => f.acidBurst) ? foeDesiredRange(me, foes, bal, b.meFoeRangeDebuff ?? 0, b) : foeDesire
  const foeDesireClamped = Math.min(openM, normalDesire);
  // 冲锋状态机（2026-09-14 船长改判：**逐单位** + **自身炮台命中解除** + 冷却 10 秒）——
  // ⚠ **顺序**：先更新状态、再算接近速度（倍率由状态读出来，见 `unitSpeedMulOf` 的单点）。
  // 触发条件（乙）与"到达期望交距"兜底都在 `updateFoeCharge` 里；本处只管"读状态算速度"。
  updateFoeCharge(b, foes, bal, b.lastTickGameMs, foeDesireClamped)
  // **捕获网解除**（船长 2026-09-16「击杀发动者即解除」＋ **2026-09-26「这个断开对敌我都有效」**）
  // ——每拍清理"施放者已不在场"与"交战距离超过 4500 米"的条目
  expireFoeWebs(state, b, foes)
  // **我方捕获网**（**船长 2026-09-26** · 墨潮捕获网）：周期账本推进（选目标/冷却/解除）＋
  // 把三层效果（机动 ×0.5 · 推进器全关 · 闪避归零）**每拍重新施加**到本拍敌阵上
  advanceMyCaptureWebs(state, b, myUnits, foes)
  // **整队机动 = 存活单位的「平均」战斗机动 ×各自倍率**（倍率单点 = `unitSpeedMulOf`）：
  // 我方倍率 = 推进器**周期爆发**（逐单位周期）；敌方倍率 = **冲锋**（逐单位状态）。
  // ⚠ 冲锋倍率**不外溢**（船长 2026-09-11：「冲锋还是按照巨兽自己的速度算…哪怕是冲锋也是按照巨兽速度」）：
  // 逐单位乘各自倍率**再取平均** ⇒ 只有正在冲的那条吃到倍率。
  // **2026-09-14 船长改判（本批）**：删掉旧的 `max(编队平均, 冲锋者速度 × 全局倍率)` 补丁——
  // 那条写法在"逐单位各自倍率"下已不成立（小虫 1.5 与巨兽 3 各异），改回**纯平均**：
  // 例 C 族噬口第 3 波（小虫 544×1.5 ×3 条 + 巨兽 297×3 ×1 条）⇒ 编队接近速度
  // = (816×3 + 891) ÷ 4 = **834.8 m/s**（旧的 `max(编队最快, 冲锋者×倍率)` 补丁会给 891）。
  // 敌方接近速度沿用 2026-09-11 船长口径（「能否敌舰移动速度按照敌方是所有船的平均值算」）：
  // 原口径是**取最快单位**（`Math.max`）——混编卡里一条快船会把整队拖快：例 穹顶守卫
  // = 2 静滞卫舰（129）+ 1 守墓长舰（232）⇒ 原口径整队按 **232** 走，与「静滞卫舰是半速炮台」
  // 的设定相冲；改平均后该队按 **163**（战斗机动 92）走。
  // 同速编成（单舰卡 / 同型多舰卡，如 A 族头目+同族杂鱼、C 族虫群）**逐字不变**（平均值 = 该速度）。
  let meV = 0
  /** **面板同源口径**（见下方落盘注释）：只乘机动倍率，**不乘 `combatSpeed` 的 speedFactor/敏捷修正** */
  let mePanel = 0
  {
    let n = 0
    for (const u of myUnits) {
      if (!isAlive(b, u.tag)) continue
      const mul = unitSpeedMulOf(u, b, bal, 'me')
      meV += combatSpeed(u.speedMps, u.agility, bal) * mul
      mePanel += u.speedMps * mul
      n += 1
    }
    if (n > 0) {
      meV /= n
      mePanel /= n
    }
  }
  let foeV = 0
  let foePanel = 0
  let foeAliveN = 0
  const fleetSpeedMul = foeFleetSpeedMulOf(b, foes)
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue
    const mul = unitSpeedMulOf(f, b, bal, 'foe') * fleetSpeedMul
    foeV += combatSpeed(f.speedMps, f.agility, bal) * mul
    foePanel += f.speedMps * mul
    foeAliveN += 1
  }
  if (foeAliveN > 0) {
    foeV /= foeAliveN
    foePanel /= foeAliveN
  }
  /**
   * **落盘给界面显示的那对速度 = 面板同源口径**（2026-09-16 船长：「**战斗中实际速度和面板显示的机动速度
   * 不一致**」⇒ 裁决「**只修改战斗显示数值，实际数值不变动**」）。
   *
   * 两套口径的分工（都保留、都不改）：
   * - **引擎推进/距离拔河** = 上面那对 `meV` / `foeV`（= `combatSpeed` ⇒ 含全局 `speedFactor 0.6`
   *   与敏捷修正，逐拍驱动 `b.distanceM`）——**一字不动**；
   * - **界面显示** = 本对（= 单位自身 `speedMps` × 机动倍率，逐单位取平均）⇒ **与装配页「机动速度」
   *   同一把尺**：我方点火期 = `speedMps × (1+推进器倍率)`（装配页那行「加力推进点火期」）、
   *   敌方冲锋期 = `speedMps × 冲锋倍率`（敌卡/体检里的"实速 ×倍率"）。
   * 这样面板与战斗读数不再对不上，而战斗手感/触发线/标定完全不受影响。
   */
  b.meSpeedMps = Math.round(mePanel)
  b.foeSpeedMps = Math.round(foePanel)
  const rate =
    steerStep(b.distanceM, b.myDesireM, meV, dtSec) +
    steerStep(b.distanceM, foeDesireClamped, foeV, dtSec)
  // **距离上限 = 战场远端**（2026-09-19 船长裁定「甲」）：按**当前**双方有效射程现算（含我方技能/科技
  // 增程与敌方受击增程），只增不减、无增程时逐字等于 `openM` ⇒ 见 `battleMaxDistanceM` 的头注。
  // **2026-09-22 船长令**：我队**全队**（`myUnits`）的最远射程一并计入 ⇒ 僚舰装远射武器也能拉开战场。
  b.distanceM = clamp(bal.minDistanceM, battleMaxDistanceM(b, me, foes, bal, myUnits), b.distanceM + rate)

  /**
   * 🔴 **兑现"到点的闪现位移"**（**船长 2026-10-02 令**：「**移动的时间节点应该放在发生时间的等待处**」）——
   * 位置不再在"触发那一刻"就换，而是**推迟到本段演出演完「消失」、进入「等待」的那一瞬**（`moveAtMs`）。
   * 放在走位之后、开火之前：本拍换好 ⇒ 后面的开火/命中判定与画面严格同拍。
   */
  settleBlinkQueue(b)

  // ── 我方开火（主炮 + 无人机条目）——**逐舰结算**（单船路径 = 只循环一次，逐字等价）──
  // 开火失稳代价只在点火期生效（2026-09-10 船长：没点火就不失稳）——每次开火取当前有效乘子，
  // 冷却期 = 1（不改 me 本身，避免污染其它读法）；**逐舰各取自己的 `hitMul`**。
  /**
   * **本拍"谁因闪现演出禁火"**（船长 2026-10-01 令 ＋ **2026-10-02 §35 扩为双向**）——
   * **每拍只算一次**（循环外）：原来放在"每门炮"里，那是 O(门数 × 队列段数) 的重复扫描，纯浪费。
   * ⚠ **两侧各判各的表**：我方开火读 `blinkHold.me`（= 敌表在窗口）；敌方开火读 `blinkHold.foe`
   * （= 我表在窗口）。判据与理由见 `blinkHoldSides` 头注。
   */
  const blinkHold = blinkHoldSides(b)
  /** 敌方那一半（**2026-10-02 §35**）：我表在窗口 ⇒ **敌方**不开火。同拍只算一次，供下面敌方开火段读。 */
  const foeBlinkHold = blinkHold.foe
  const meAtkOf = (u: UnitSpec): UnitSpec =>
    phaseOf(u) ? u : { ...u, hitMul: effectiveHitMul(u, false) }
  for (const unit of myUnits) {
    const meRt = b.units[unit.tag]
    if (!meRt || !isAlive(b, unit.tag)) continue
    // 主控（`player`）——单船路径与多单位路径的首条都走这里
    const meAtk = meAtkOf(unit)
    for (let wi = 0; wi < unit.weapons.length; wi++) {
      const w = unit.weapons[wi]!
      /**
       * **逐舰放飞**（船长 2026-09-14「逐舰机群」；此前只有主控的机群参战、僚舰条目被跳过）：
       * 本舰的无人机条目查**本舰自己的池**（键 = `舰tag:武器下标`）。
       * ⚠ 查不到池条目 = 这条无人机**不参战**（该舰没带 / 老档没这类键 / 未建池）——**跳过而非
       * "无池开火"**，否则会出现打不掉的幽灵机群（这条纪律从 D 批起就有，本轮换成逐舰判定）。
       */
      if (w.src === 'drone') {
        const poolEntry = b.dronePools?.[dronePoolKey(unit.tag, wi)]
        if (!poolEntry || poolEntry.alive === false) continue // 已被点防打掉的架次不再开火（条目保留占位）
      }
      const cd = meRt.weapons[wi] ?? 0
      if (cd > 0) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      /**
       * 🔴 **闪现演出禁火**（**船长 2026-10-01 令**，原话照抄）：
       * 「**不停表，但是敌舰消失时，玩家的武器不会开火（哪怕武器转好了）**」
       *
       * ⇒ 只要有**任一敌舰**正处在"消失 → 出现"这段演出窗口里（见 `BattleState.foeBlinkQueue`），
       * 本门**这一拍不开火**（⚠ **冷却照推**：与上面 `cd > 0` 那支同一口径——转好了就停在 0 等窗口结束，
       * 窗口一过立刻开火，不白扣一发）。敌舰都消失了还开火，看着像打空气；这也是船长要的效果。
       * ⚠ **2026-10-02 §35 起是双向机制的一半**：反方向（我表在窗口 ⇒ 敌方停火）在敌方开火段，
       * 两处都走 `blinkHoldSides`。
       */
      if (blinkHold.me) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      // ── **隐秘行动 · 基础舰炮闭麦**（船长 2026-09-17：「**让舰船自带的基础舰炮在隐身情况下不开炮**」）──
      // `src === 'base'` 的兜底炮**恒在且卸不掉** ⇒ 若照常开火，**开战第一拍就由它自己**把隐身窗口
      // 终结掉（下方 `stats.meShots` 处的"开火即现形"）——装置等于白装。⇒ **窗口生效期内这一门不开火**；
      // 窗口到点、或本舰其它武器开火现形之后，它**立刻恢复**（射程/弹药/装填/命中的口径一字不动）。
      // **只认 `src === 'base'`**：外挂武器与无人机**照旧开火**——"主动开火现形"仍是玩家的选择与代价。
      // 判据复用敌方选靶那把尺 `isMyUnitTargetable`（不另立第二份隐身判据）。
      if (w.src === 'base' && isMyUnitStealthed(b, unit.tag)) continue
      // ── 防空属性（船长 A1）：**只有带 `canHitDrones` 的武器能筛到敌机** ──
      // 机群不在主目标池里 ⇒ 其余武器（含我方无人机，船长 B1）按构造看不到它们。
      // 带标记的武器**优先打机群**（防空是它的本职）。
      // **射程口径（船长 2026-09-11 甲案）**：打机群**不看两舰间距**（敌机扑到您舰旁才开火，
      // 机制服从画面）⇒ 有敌机可打时不受 `inRange` 拦截；只有"打舰"才按本武器射程判。
      let droneHit = w.canHitDrones
        ? pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi, unit.tag)
        : null
      if (!droneHit && !inRange(b.distanceM, w)) continue;
      // V18B 随机目标（船长 2026-09-05）：每发武器在开火瞬间从存活敌人中独立抽取
      // （确定性 rng 种子，可复现；齐射可分散到不同目标）。目标死亡即时换人。
      // 2026-09-09 锁定装置：装上即切换"集火模式"——全部武器打存活编队首位（主舰优先、击毁接力）。
      let foeTarget = droneHit
        ? null
        : unit.lockedDmgBonus
          ? firstAliveFoe(foes, b)
          : randomAliveFoe(state, b, foes)
      if (!foeTarget && !droneHit) continue
      let type: DamageType
      let dmg: number
      let autoHit = false
      /** 一轮齐射的用弹量（同型合并条目 ×N × 每次耗弹数；2026-09-11 修复：此前多门武器只扣 1 发弹药） */
      const roundsPerVolley = Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1)
      if (w.kind === 'gun') {
        // V18B-2 per-gun 弹型：每件武器打自己的键（动能/爆破导弹/能量弹药混装各自供弹），
        // 该键弹尽 → 本武器停火（不拖累其它型）。**齐射按门数扣弹**：不足一轮齐射的余弹不发射
        // （等返港补弹；预载已按门数放大，正常战斗不会因缺弹中断）
        const pick = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
        if (!pick || !consumeBattleAmmo(b, unit.tag, pick, roundsPerVolley)) {
          meRt.weapons[wi] = w.reloadMs // 无弹：等一轮再查（避免每步空转）
          continue
        }
        type = pick
        dmg = w.shotsByType?.[pick] ?? 0
        // **装填计时**（合并入口）：挂了「三连射」（本轮还没打完 ⇒ 100ms 后再来一发）或
        // 「叠光同款 · 装填自加速」的门走 `meBurstReloadOf`；两者都不挂 ⇒ 逐字回到老路径（零行为变化）
        // ⚠ 传 **`unit`**（正在开火那一艘）而不是主控 `me`：登记表的键按设计是 `舰tag#炮位`
        //   （2026-10-03 修——此前传 `me`，僚舰的这门会跟主控共用同一个键/读主控的件）。
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
      } else if (w.kind === 'beam') {
        // V18B-2 激光：必中光束——逐发扣能量弹药（按门数）；威力随距离衰减（beamPowerFactor）
        // ⚠ **打机群不吃这个衰减**（船长 2026-10-02 令「对无人机无衰减」）⇒ 距离系数走单一取数口
        //   `beamPowerVsTargetOf`（`droneHit` 非空 ⇔ 本发打的是敌机群）。
        if (!consumeBattleAmmo(b, unit.tag, 'plasma', roundsPerVolley)) {
          meRt.weapons[wi] = w.reloadMs
          continue
        }
        type = 'plasma'
        dmg = Math.max(1, Math.round((w.shotDmg ?? 0) * beamPowerVsTargetOf(b.distanceM, w, droneHit !== null)))
        // **装填计时**：激光这一路同样走合并入口（三连射 / 叠光自加速 / 老路径三合一）
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
        autoHit = true
      } else {
        type = w.fixedType ?? 'kinetic'
        dmg = w.shotDmg ?? 0
        // **装填计时**：固定值武器这一路同样走合并入口（三连射 / 叠光自加速 / 老路径三合一）
        meRt.weapons[wi] = meBurstReloadOf(unit, unit.tag, wi, b, dtMs, w.reloadMs)
      }
      // **对无人机伤害加成**（船长 2026-09-12：「近防炮给予一个对无人机伤害加成」→「**那伤害倍率按2倍算**」）：
      // 只作用于**打机群**这一支（`droneHit` 非空 ⇔ 本发打的是敌机，见上方 `pickFoeDroneTarget`）；
      // **对舰伤害一字不动**——`tests/pd-damage-ladder.test.ts` 的对舰单发定值就是这条的守卫。
      // 倍率来自装备表（`ModuleDef.antiDroneDmgMul` → `WeaponSpec.antiDroneMul`），缺省 = 1 ⇒ 不乘。
      if (droneHit && (w.antiDroneMul ?? 1) !== 1)
        dmg = Math.round(dmg * (w.antiDroneMul ?? 1))
      const gunCount = volleyGunCountOf(w)
      const volleyDmg = dmg
      const rawBeam = w.kind === 'beam' ? w.shotDmg ?? 0 : dmg
      // 合并条目只共享装填与弹药账；每门炮独立命中和伤害事件。
      for (let gun = 0; gun < gunCount; gun++) {
        if (gun > 0 && droneHit && !droneHit.pool.alive) {
          droneHit = pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi, unit.tag, true)
          if (!droneHit) {
            if (!inRange(b.distanceM, w)) break
            foeTarget = unit.lockedDmgBonus ? firstAliveFoe(foes, b) : randomAliveFoe(state, b, foes)
            if (!foeTarget) break
          }
        }
        if (gun > 0 && !droneHit && !isAlive(b, foeTarget!.tag)) {
          foeTarget = unit.lockedDmgBonus ? firstAliveFoe(foes, b) : randomAliveFoe(state, b, foes)
          if (!foeTarget) break
        }
        const targetVolleyDmg = w.kind === 'beam'
          ? Math.round(Math.max(1, Math.round(rawBeam * beamPowerVsTargetOf(b.distanceM, w, droneHit !== null))) * (droneHit ? w.antiDroneMul ?? 1 : 1))
          : droneHit ? volleyDmg : (w.kind === 'gun' ? w.shotsByType?.[type] ?? 0 : w.shotDmg ?? 0)
        dmg = volleyDamageShareOf(targetVolleyDmg, gunCount, gun)
        b.stats.meShots += 1;
        // **隐秘行动：开火即现形**（2026-09-15 船长 Q1 甲）——本舰任一门武器打出第一发时窗口清空；
        // 同一拍稍后的敌方开火段因此已经"看得见"它（现实语义亦然：枪口一闪就暴露了）。
        if (meRt.stealthUntilMs !== undefined) {
          meRt.stealthUntilMs = undefined
          pushBattleNotice(b, '隐秘行动结束：本舰开火现形')
        }
        // **反应式防空**：我方**无人机**打过敌舰 ⇒ 记录时刻，供**敌方近防炮**在窗口内反击
        // ⚠ 记的是**敌方全队共用**的一枚令牌（**不按被打的敌舰 tag 分记**）——船长 2026-09-16「点防没问题」
        //   = 现状为准；换靶/换敌舰都共用它，消费一次即全队过窗（见 `resolvePointDefense`）。
        if (w.src === 'drone')
          b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: b.lastTickGameMs };
        // AI favor：我方（AI 副船）命中按优势放大，上限放开到 100%（可必中）；
        // beam 已必中（autoHit），不掷骰、favor 不放大
        // **两条命中分开算**（船长 2026-09-12 裁定「按丁修复」，口径说明见 `droneHitChance`）：
        // 打**机群**不吃两舰距离衰减（守方只用该架的闪避 `DronePoolEntry.evasion`，机型表绝对值）；
        // 打**舰**一字未动（仍按两舰间距算 `distFactor`）。
        const meHit = autoHit
          ? 1
          : droneHit
            ? droneHitChance(w, meAtk, droneHit.pool.evasion, bal)
            : hitChance(w, meAtk, foeTarget!, b.distanceM, bal)
        const meHitEff = autoHit
          ? 1
          : favor
            ? clamp(0, 1, meHit * favor.meMul)
            : meHit
        const hit = autoHit || (dmg > 0 && nextRandom(state.rng) < meHitEff)
        /**
         * **本发对主目标的实收伤害**（2026-09-24 船长令「战斗伤害的数值动画」）——
         * 逐段累加（主段 + 附伤段），仅供飘字读数：与 `stats.meDmg` 同源（同一批 `dealt`）。
         * 未命中保持 0 ⇒ 下面**不写 `dmg`**（UI 就只飘 MISS，不硬编数字）。
         * ⚠ 齐射协调仪的**溢火结转那一截不计在本发头上**（它落在另一艘敌舰身上，已有画面提示）。
         */
        let selfDealt = 0
        if (hit) {
          b.stats.meHits += 1
          if (droneHit) {
            // 打机群：扣该架的三层血（吃它自己的层抗）；打空 = **击落**（停火 + 小型爆炸演出）。
            // ⚠ 锁定装置的加深**不作用于机群**（锁定锁的是舰）——防空靠的是射速与命中，不是锁定。
            const pool = droneHit.pool
            const r = applyDamage(
              { s: pool.s, a: pool.a, h: pool.h },
              pool.resists ?? {},
              dmg,
              type,
            )
            pool.s = r.hp.s
            pool.a = r.hp.a
            pool.h = r.hp.h
            b.stats.meDmg += r.dealt
            selfDealt = r.dealt
            if (pool.s + pool.a + pool.h <= 0) {
              pool.alive = false
              // **备用机库补位排期**（2026-09-12 船长「损坏后补充敌机」）：前线战损 ⇒ 从机库放出一架，
              // `respawnMs` 后到位。⚠ 同一时刻只排**一架**（在前的那架到位后才轮到下一架）。
              const droneFoeTag = droneHit.foeTag
              const reserveOf = foes.find((x) => x.tag === droneFoeTag)?.foeDroneReserve
              const hangar = b.foeDronePools?.[droneHit.foeTag] ?? []
              if (
                reserveOf &&
                reserveOf.count > 0 &&
                !hangar.some((p) => p.inHangar === true && p.readyAtMs !== undefined)
              ) {
                const next = hangar.find(
                  (p) => p.inHangar === true && p.readyAtMs === undefined,
                )
                if (next) next.readyAtMs = b.lastTickGameMs + reserveOf.respawnMs
              }
              pushBattleFx(b, {
                atMs: b.lastTickGameMs + dtMs,
                side: 'foe',
                tag: droneHit.foeTag,
                to: 'player',
                type,
                src: 'drone',
                artId: pool.artId,
                hit: true,
                droneDown: true, // 击落演出（与我方被点防打落同款事件类型）
              })
            }
          } else {
            const rt = b.units[foeTarget!.tag]!;
            const hpBefore = { ...rt.hp }
            // 锁定装置：被锁目标受本舰伤害加深（对锁定目标的任意命中都乘入；2026-09-09）
            const volleyLocked = unit.lockedDmgBonus ? Math.round(targetVolleyDmg * (1 + unit.lockedDmgBonus)) : targetVolleyDmg
            const dmgLocked = volleyDamageShareOf(volleyLocked, gunCount, gun)
            /** 主段：走**敌舰伤害唯一收口**（血写回 ＋ 死亡观测；算术与消费顺序一字不变） */
            const r = applyFoeUnitDamage(b, foeTarget!, dmgLocked, type, b.lastTickGameMs + dtMs)
            b.stats.meDmg += r.dealt
            selfDealt = r.dealt
            /**
             * **谜质「齐射协调仪」：溢出火力转移**（F3c B2 · 船长 2026-09-13：
             * 「齐射协调仪改为溢出火力会转移到其他敌舰」）——目标被这一发打空后，把超出
             * 「打空它所需原始伤害」的那一截转给下一艘存活敌舰（按那一艘自己的层克重重算）。
             * 只在本场带了该装置时生效（`battle.wormhole.volleyOverflow`）。
             */
            if (b.wormhole?.volleyOverflow === true && rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
              const carry = carryVolleyOverflow(b, foes, foeTarget!.tag, type, dmgLocked, hpBefore)
              if (carry.hits > 0) {
                pushBattleNotice(b, `齐射协调：溢火结转 ${Math.round(carry.total)} 点伤害到下一艘敌舰`)
              }
            }
            // **附加伤害段**（2026-09-13 船长：掠袭破片炮「额外造成 50% 的动能伤害是附加伤害，
            // 和弹种无关」）——口径（船长 2026-09-13 二次裁定）：「**伤害各自吃各自的制（克制）效果**」：
            // 副段取**武器原伤害**（含锁定加深，不含主段已吃的克制）×比例，然后**两段各吃各自的层克制**。
            // ⚠ 不能用主段实收做基数——那会把主系的克制乘进副段（实测该目标会从 +50% 放大到 +75%）。
            const secPct = w.secondaryDamagePct ?? 0
            if (secPct > 0 && rt.hp.s + rt.hp.a + rt.hp.h > 0) {
              const secType = w.secondaryDamageType ?? 'kinetic'
              const secDmg = volleyDamageShareOf(Math.max(1, Math.round(volleyLocked * secPct)), gunCount, gun)
              /** 附伤段：同走唯一收口（它也可能就是打沉那一发） */
              const r2 = applyFoeUnitDamage(b, foeTarget!, secDmg, secType, b.lastTickGameMs + dtMs)
              b.stats.meDmg += r2.dealt
              selfDealt += r2.dealt
            }
            // **受击增程触发点（唯一）**——2026-09-11 船长：「受到攻击后，大幅提高无人机射程
            // （提高 400%）」：**母舰本体被命中** ⇒ 该舰全部机群射程 ×倍率（本场永久）。
            // ⚠ 打机群（上面的 `droneHit` 分支）**不触发**、未命中（`hit === false`）也进不到这里。
            if (markFoeDroneRangeBuff(foeTarget!, b)) {
              // **画面提示**（船长 2026-09-11 二次裁定：日志不写，改走画面顶部提示位 ⇒ `battle.notices`，
              // 与「敌方增援」同一处显示、限时自动消失）。
              // ⚠ **整队只推一条**（三次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
              // **只触发一次**，**对所有敌舰生效**」）⇒ 文案不点单舰名（生效范围是全敌队）。
              pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
            }
            // ⟪文案调整 2026-10-07⟫ 两件独立观瞄按实际挂载提示，受击距离判据不变。
            announceFoeGunRangeBuff(foeTarget!, b)
            // **闪现跃迁触发点（唯一）**——**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」。
            // 与上面两条**同一个钩子**（本体被命中；打机群／未命中都进不到这里）。冷却期内静默。
            if (
              markFoeBlink(
                foeTarget!,
                foeTarget!.tag,
                b,
                bal,
                battleMaxDistanceM(b, me, foes, bal, myUnits),
                // 它自己的期望距离要跟着"我方电子舰的射程压制"走 —— 直接读每拍写进运行态的那个值
                // （pplyFoeRangeDebuff 每拍**先**写 attle.meFoeRangeDebuff，与走位口径同源）
                b.meFoeRangeDebuff ?? 0,
              )
            ) {
              /**
               * 🔴 **不推画面提示**（**船长 2026-10-02 令**，原话照抄）：
               * 「**跳跃规避的提示同样过于频繁**」——本条原先推「跃迁规避：目标瞬时换位」。
               * 现在演出本身就足够显眼（整段 2 秒的消失 → 出现 + 配套动画）⇒ 提示是多余的噪音。
               * ⚠ 与"闪烁过载"那条同口径（那条更早就不再推提示）。
               */
              // **闪现演出**（**船长 2026-10-01 令**：「闪现时候要给舰船一个闪现的动画」）——
              // 与捕获网同款承载（`: true` 旗标 + `type` 占位）；界面对该 tag 播"淡出→淡入"。
              pushBattleFx(b, {
                atMs: b.lastTickGameMs,
                side: 'foe',
                tag: foeTarget!.tag,
                type: 'kinetic',
                hit: true,
                blink: true,
              })
              // **挂在闪现上的两个装置**（2026-10-01）：闪烁过载（护盾回满 / 结构 −上限5%）
              // ＋ 叠光（攻击间隔再缩一格）。只在"闪现真的发生了"这一支里结算。
              // ⚠ 装填基准取本舰主武器那条（与开火处同一个数）。
              settleFoeBlinkExtras(foeTarget!, foeTarget!.tag, b, foeTarget!.weapons[0]?.reloadMs)
            }
          }
        }
        // **全体攻击**（2026-09-13 船长：C 孢子导弹巢「对所有敌方同时攻击」）——
        // 主目标已按上面的常规口径结算；这里把**同一轮齐射**逐个结算到其余存活敌舰：
        // 逐目标独立掷命中（各用各自的命中条件）、各吃各自的层克制与抗性；受击增程等触发点照常逐舰触发。
        // ⚠ 副目标**不吃锁定加深**（锁定锁的是主目标）⇒ 基数用 dmg，主目标仍用 dmgLocked。
        //
        // ⚠⚠ **2026-09-25 船长报障修复**：「**装孢子导弹巢有时候会只有一发弹道**」。
        // 根因 = **本段原先整块写在上面那个 `if (hit) { … }` 里面**（那一层的 `hit` 就是**主目标那一发的
        // 命中判定**）⇒ 主目标没中时，"整轮是否铺开"跟着一起被跳过：副目标**连掷都不掷**，画面只剩主目标
        // 那一条弹道（原条件里那个多余的 `&& hit` 只是同一件事的第二道锁，去掉它并不改变行为）。
        // 现把本段**移出 `if (hit)`** ⇒ **主目标的命中只决定它自己**，副目标照常逐个独立结算。
        // 真跑读数（3 敌 · 28 轮 · 主目标命中率 0.357）：修复前**单发轮 18 / 铺开轮 10 = 64%**
        // （正好等于 `1 − 0.357`），每轮期望命中目标数 0.679；修复后 = 命中率 × 3 = 1.071 ⇒ **×1.58**。
        // 为什么判定为缺陷（三份口径里两份都是"每目标独立"）：① 落码记录（2026-09-13）只写
        // 「**逐目标独立掷命中** + 各吃各自层克制」，从没提过这道闸；② **胜率预估器**（`steadyPreview`
        // 的 `allFoesMul = foes.length`）一直按"每轮打全部敌舰"算 ⇒ 与实战差 1.58×（预估偏高）；
        // ③ 船长 2026-09-13 原话就是「对所有敌方同时攻击」。⇒ 船长 2026-09-25 裁「按甲」。
        // 影响面：只此一件武器带 `allFoes`（`mod-wh-c-missile`）⇒ 只有装了它的场次读数变化；
        // 单发/装填/射程/命中一字未动，**单体标称 DPS 锚（`wh-weapon-dps` 的 ×0.69）不受影响**
        // （只有 1 艘敌舰时本就没有副目标，这一段本就不做事）。
        if (w.allFoes === true && !droneHit) {
          for (const other of foes) {
            if (other.tag === foeTarget!.tag) continue
            const ort = b.units[other.tag]
            if (!ort || !isAlive(b, other.tag)) continue
            const oHitChance = autoHit ? 1 : hitChance(w, meAtk, other, b.distanceM, bal)
            const oHit = autoHit || (dmg > 0 && nextRandom(state.rng) < oHitChance)
            /** 本发打**这一艘副目标**的实收（含附伤段）——飘字逐舰各出一个数字 */
            let oDealt = 0
            if (oHit) {
              b.stats.meHits += 1
              /** 全体攻击主段：同走唯一收口 */
              const rAll = applyFoeUnitDamage(b, other, dmg, type, b.lastTickGameMs + dtMs)
              b.stats.meDmg += rAll.dealt
              oDealt = rAll.dealt
              const secPctAll = w.secondaryDamagePct ?? 0
              if (secPctAll > 0 && ort.hp.s + ort.hp.a + ort.hp.h > 0) {
                const secTypeAll = w.secondaryDamageType ?? 'kinetic'
              const secDmgAll = volleyDamageShareOf(Math.max(1, Math.round(targetVolleyDmg * secPctAll)), gunCount, gun)
                /** 全体攻击附伤段：同走唯一收口 */
                const rAll2 = applyFoeUnitDamage(b, other, secDmgAll, secTypeAll, b.lastTickGameMs + dtMs)
                b.stats.meDmg += rAll2.dealt
                oDealt += rAll2.dealt
              }
              if (markFoeDroneRangeBuff(other, b)) {
                pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
              }
              announceFoeGunRangeBuff(other, b)
              // **闪现跃迁**（2026-10-01）：与上面两条**同款**——"全体攻击"打到的副目标同样会触发。
              // ⚠ 2026-10-01 补：初版只写在了主目标那处 ⇒ 用全体攻击武器（孢子导弹巢那类）打中带闪现的
              // 敌舰时**不会闪**，与两条受击增程的行为不一致。
              if (
                markFoeBlink(other, other.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits), b.meFoeRangeDebuff ?? 0)
              ) {
                /**
                 * ⚠ **这里不再推演出事件**（**2026-10-02 修**）：`markFoeBlink` **内部已经推过**一条带
                 * 队列时刻（`atMs = vanishMs`）、`blink: true` 与倍速的事件；原先此处再推一条**没有 `blink`
                 * 旗标的 `pushBattleFx`** —— 界面会把它当**一次开火**处理（画弹道 + 打命中闪光）。
                 * 顺带也不推画面提示（船长：「跃迁规避的提示同样过于频繁」）。
                 */
                // **挂在闪现上的两个装置**（2026-10-01）：与主目标那处**同一函数** ⇒ 全体攻击
                // 打中带闪烁过载 / 叠光的敌舰同样结算（不因"它是副目标"而漏）。
                settleFoeBlinkExtras(other, other.tag, b, other.weapons[0]?.reloadMs)
              }
            }
            pushBattleFx(b, {
              atMs: b.lastTickGameMs + dtMs,
              side: 'me',
              tag: unit.tag,
              to: other.tag,
              type,
              src: w.src,
              artId: w.artId,
              hit: oHit,
              ...(oDealt > 0 ? { dmg: oDealt } : {}),
            })
          }
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: unit.tag,
          to: droneHit ? droneHit.foeTag : foeTarget!.tag,
          type,
          src: w.src,
          artId: w.artId,
          hit,
          // **本发实收**（2026-09-24 船长令）：命中才有，飘字用；未命中 ⇒ 缺省（UI 只飘 MISS）
          ...(selfDealt > 0 ? { dmg: selfDealt } : {}),
          // **打的是机群**（船长 2026-09-11：「炮在攻击无人机时**不显示弹道**」）——UI 只出炮口闪光。
          ...(droneHit ? { pd: true } : {}),
        })
      }
    }
  }

  // ── 敌方开火（按**选靶模式**打我方；单船路径 = 恒打唯一那艘、零随机数消费） ──
  for (const f of foes) {
    if (f.acidBurst && isFoeEngageable(b, f.tag)) triggerAcidBurst(b, f, 'attack', b.lastTickGameMs + dtMs)
  }
  // 包含玩家炮火、全体攻击及溢火产生的死亡爆发；每只结算一次，伤害先于自身腐蚀。
  for (const f of foes) {
    const event = b.acidBursts?.[f.tag]
    const acid = f.acidBurst
    if (!acid || !event || event.resolved) continue
    event.resolved = true
    const target = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
    let hit = false
    let dealt = 0
    if (target) {
      const rt = b.units[target.tag]!
      const chance = hitChance({ hitRate: acid.hitRate ?? .95, minRangeM: 1, maxRangeM: acid.deathRangeM, falloff: 1 }, f, target, b.distanceM, bal, 1)
      hit = nextRandom(state.rng) < (favor ? clamp(0, .97, chance * favor.foeMul) : chance)
      b.stats.foeShots += 1
      if (hit) {
        b.stats.foeHits += 1
        const raw = applyDcGuard(state, b, target.tag, target, rt.hp, cappedFoeDamage(b, target.tag, target, acid.damage ?? 0), 'kinetic')
        const result = applyDamage(rt.hp, target.resists, raw, 'kinetic')
        rt.hp = result.hp
        dealt = result.dealt
      }
    }
    pushBattleFx(b, { atMs: event.atMs, side: 'foe', tag: f.tag, ...(target ? { to: target.tag } : {}),
      type: 'kinetic', acidBurst: true, hit, ...(dealt > 0 ? { dmg: dealt } : {}) })
    // 2026-10-07 船长确认：逐只追加腐蚀，仍先伤害后施加自身减抗。
    b.alienCorrosion = (b.alienCorrosion ?? 0) + acid.corrosionPct
    for (const u of myUnits) applyAlienCorrosion(u, b.alienCorrosion)
  }
  for (const u of myUnits) applyAlienCorrosion(u, b.alienCorrosion ?? 0)
  advanceFoeHatcheries(b, foes, b.lastTickGameMs + dtMs)
  for (const f of foes) {
    const rt = b.units[f.tag]
    if (!rt || !isAlive(b, f.tag)) continue;
    // 本发（本次齐射）的目标：**每次开火前重选**——目标被打沉后自动换人，与"每发独立抽敌人"对称。
    const pickTarget = (): { spec: UnitSpec; rt: import('./state').BattleState['units'][string] } | null => {
      const spec = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
      if (!spec) return null
      const urt = b.units[spec.tag]
      return urt ? { spec, rt: urt } : null
    }
    // ── 敌方机群开火（2026-09-11 机群批）──
    // 逐架独立装填、独立掷命中（与我方无人机条目同款口径：`src:'drone'` + `artId` 供演出层识别）。
    // ⚠ 本段**放在主武器之前**：主武器有 `continue`（无弹分支之外还有 beam 分支的 continue），
    //   放在循环尾部会被那些 `continue` 跳过。
    // 池与 drone 条目**同序**（`initFoeDronePools` 按 slot 顺序展开），故用独立计数 `di` 对位。
    const fPools = b.foeDronePools?.[f.tag]
    if (fPools && fPools.length > 0 && isAliveAnyOf(b, myUnits)) {
      // **备用机库补位到位**（2026-09-12 船长「损坏后补充敌机」）：到点的备用机翻成**在空**并**满血**放出
      for (const p of fPools) {
        if (p.inHangar !== true || p.readyAtMs === undefined) continue
        if (b.lastTickGameMs < p.readyAtMs) continue
        p.inHangar = false
        p.readyAtMs = undefined
        p.alive = true
        p.s = p.maxS ?? p.s
        p.a = p.maxA ?? p.a
        p.h = p.maxH ?? p.h
      }
      // **单次出击上限**（2026-09-12 船长「限制敌机单次出击数量」）：本拍只有"在空窗口"里的架次能开火，
      // 其余在机库待命（装填也冻着 ⇒ 轮到它时即打）。缺省不写该字段 ⇒ `aloft = null` ⇒ 全群照旧同时开火。
      const launch = f.foeDroneLaunch
      const reloadBase = f.weapons.find((w) => w.src === 'drone')?.reloadMs ?? 4400
      const aloft = launch
        ? aloftDroneSet(fPools, launch, reloadBase, b)
        : null
      const activeCount = fPools.filter((p) => p.alive && p.inHangar !== true).length
      const kAloft = launch
        ? Math.max(1, Math.min(Math.round(launch.maxAloft), Math.max(1, activeCount)))
        : 0
      // `keepDps`（推荐）：在空架次的有效装填 ×(k ÷ 在场架数) ⇒ **平均 DPS 守恒**（限制的是同时在空数）
      const aloftReload = (base: number): number =>
        launch && launch.keepDps === true && kAloft > 0 && activeCount > 0
          ? Math.max(200, Math.round((base * kAloft) / activeCount))
          : base
      let di = 0
      for (let k = 0; k < f.weapons.length; k++) {
        const dw = f.weapons[k]!
        if (dw.src !== 'drone') continue
        const pool = fPools[di]
        const idx = di
        di += 1
        if (!pool || !pool.alive) continue; // 已被防空武器击落的架次：停火（条目保留占位）
        if (pool.inHangar === true) continue; // **备用机**：在库待命（不开火、不算在场架数）
        if (aloft && !aloft.has(idx)) continue; // **不在本批出击窗口**：在库待命（装填冻结）
        const dcd = rt.weapons[k] ?? 0
        if (dcd > 0) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        /**
         * 🔴 **闪现演出禁火 · 敌方那一半**（**船长 2026-10-02 §35 令**：「**我方触发闪现时，闪现禁火
         * 对敌人也生效**」）——我方某段闪现正处在演出窗口里（见 `BattleState.meBlinkQueue`）⇒
         * **本架敌机这一拍不开火**。口径与我方那处**逐字对称**：**冷却照推**、转好了停在 0 等窗口，
         * 窗口一过立刻开火（不白扣一发）。
         */
        if (foeBlinkHold) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        rt.weapons[k] = aloftReload(dw.reloadMs)
        // 射程门：**受击增程**生效时读 `foeDroneRangeOf`（机型射程 × 倍率），否则就是机型射程
        if (b.distanceM > foeDroneRangeOf(b, dw)) continue // 机群够不着（我方在它射程外）
        // 选靶（多单位）：**每架敌机独立选靶**——与我方"每发独立抽敌人"同款粒度
        const dtgt = pickTarget()
        if (!dtgt) break // 我方已全灭（正常由结束判定收场）
        b.stats.foeShots += 1;
        /**
         * **全队令牌**（**2026-09-27 船长令**：「**将反击原本是被打的舰船反击改为全队反击一次（对我方也生效）**」）：
         * 挨打即刷新**共用**时刻 `droneHitAt.me`；`droneHitAtMeBy` 从"挨打记录"改由**消费处独占**
         * （记"本舰已对哪一次令牌反击过"）⇒ 这里不再写它。
         *
         * ⚠ **旧实现在逐舰路径下从不写 `droneHitAt.me`**（`if (逐舰表) 写逐舰表; else 写共用令牌`）——
         * 而上一条令改判据后读的正是 `droneHitAt.me` ⇒ 这里**必须无条件写**，否则我方近防炮一发都不反击。
         */
        b.droneHitAt = { ...(b.droneHitAt ?? {}), me: b.lastTickGameMs }
        const dType = dw.fixedType ?? 'kinetic';
        // 机群为掷命中（`fixed`）：吃自己的 `hitRate`、吃我方回避与距离衰减——与我方无人机同源
        const droneHit = hitChance(dw, f, dtgt.spec, b.distanceM, bal)
        const droneHitEff = favor
          ? clamp(0, 0.97, droneHit * favor.foeMul)
          : droneHit
        const dHit = nextRandom(state.rng) < droneHitEff
        /** 本发对**被打的那艘我方舰**的实收伤害（2026-09-24 船长令：飘字读数；未命中保持 0） */
        let dDealt = 0
        if (dHit) {
          b.stats.foeHits += 1
          const dBefore = dtgt.rt.hp.s + dtgt.rt.hp.a + dtgt.rt.hp.h
          /** 损伤管制装置：先过 80% 齐射保险，再过免死夹伤（窗口内逐段夹 ⇒ 同拍多段破不了） */
          const dRaw = applyDcGuard(
            state,
            b,
            dtgt.spec.tag,
            dtgt.spec,
            dtgt.rt.hp,
            cappedFoeDamage(b, dtgt.spec.tag, dtgt.spec, dw.shotDmg ?? 0),
            dType,
            (r) => applyFoeShot(dtgt.rt.hp, dtgt.spec.resists, dw, r, dType),
          )
          dtgt.rt.hp = applyFoeShot(dtgt.rt.hp, dtgt.spec.resists, dw, dRaw, dType)
          dDealt = Math.max(0, dBefore - (dtgt.rt.hp.s + dtgt.rt.hp.a + dtgt.rt.hp.h))
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'foe',
          tag: f.tag,
          to: dtgt.spec.tag,
          type: dType,
          src: 'drone',
          artId: dw.artId,
          hit: dHit,
          ...(dDealt > 0 ? { dmg: dDealt } : {}),
        })
      }
    }
    if (f.acidBurst) continue
    const w = f.weapons[0]!
    const cd = rt.weapons[0] ?? 0
    if (cd > 0) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    /**
     * 🔴 **闪现演出禁火 · 敌方那一半**（**船长 2026-10-02 §35 令**：「**我方触发闪现时，闪现禁火
     * 对敌人也生效**」）——我方某段闪现正处在演出窗口里（见 `BattleState.meBlinkQueue`）⇒
     * **本舰这一发不开火**。口径与我方那处**逐字对称**：**冷却照推**、转好了停在 0 等窗口，
     * 窗口一过立刻开火（不白扣一发）。
     * ⚠ 门槛放在 `foeOverlayReloadOf` **之前**：与"没到点"那支同一口径 ⇒ 停火期间**叠光格不推进**
     *   （我方那处也是先过禁火门、再调 `meOverlayReloadOf`，两侧一致）。
     */
    if (foeBlinkHold) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    /**
     * **本发的装填间隔**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者闪现后，
     * 攻击间隔缩短，最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。**」）——
     * 挂了「叠光装置」的舰（R 族 T3 叠光级）用**当前间隔**重置计时（首访问 = 条目的固定 `reloadMs`，
     * 此后每开一火 −400ms、夹下限 500ms、闪现另算一格）；没挂的舰走缺省 ⇒ **返回 `w.reloadMs`，
     * 读数与行为逐字不变**。⚠ 间隔的递减状态记在 `BattleState.foeOverlayReload[tag]`（运行态、不入档）。
     *
     * 🔴 **连发优先**（**船长 2026-10-02 令**：「**每次开火是三次间隔100ms的射击，目标选择随机。**」）
     * —— 挂了连发的舰（R 族 T5 光环中枢）：本轮**前 `shots − 1` 发之后装填重置为 `gapMs`**（100ms），
     * 打完**最后一发才回到 `reloadMs`** ⇒ 三连发天然按 100ms 摊在既有"一次装填一发"的开火环上，
     * 每发各走一遍下面的选靶（**逐发独立随机选靶**）。⚠ 连发期间**不调 `foeOverlayReloadOf`**
     * （本仓两件互斥：挂了连发的舰不挂叠光；写成"每发都调"会让两条机制互相污染）。
     * 没挂连发的舰 ⇒ `burst` 缺省 ⇒ 与改动前**逐字一致**（连一次判断都不多做）。
     */
    const burst = w.burst
    const burstFired = burst !== undefined ? (b.foeBurstFired?.[f.tag] ?? 0) : 0
    const burstMore = burst !== undefined && burstFired + 1 < Math.max(1, Math.floor(burst.shots))
    /**
     * ⚠ **连发的"发间隔"要减掉一拍**（`− dtMs`）：本仓开火环的固有节拍是"**冷却减到 0 的那一拍不
     * 开火、下一拍才开火**"（`cd > 0 ⇒ 递减并 continue`）⇒ 直接写 `gapMs` 会实得 **200ms** 而不是
     * 船长要的 **100ms**（2026-10-02 探针实测：三连阶梯 1.80s → 2.00s → 2.20s）。减掉本拍 `dtMs`
     * 后：`gapMs = 100 · dt = 100 ⇒ 置 0 ⇒ 下一拍即开火` = 真正的 100ms；`gapMs` 更大时同样成立
     * （实得格数 = `⌈gapMs ÷ dt⌉`）。⚠ 只在连发期间生效，最后一发照旧回到 `reloadMs`（那一拍不算）。
     */
    rt.weapons[0] = burstMore
      ? Math.max(0, Math.round(burst!.gapMs) - dtMs)
      : foeOverlayReloadOf(f, f.tag, b, w.reloadMs)
    if (burst !== undefined) {
      const reg = b.foeBurstFired ?? (b.foeBurstFired = {})
      // 打完这一发：本轮还有剩余 ⇒ 记已发数；本轮打完 ⇒ 删键（下一发重新从第 1 发起算）
      if (burstMore) reg[f.tag] = burstFired + 1
      else delete reg[f.tag]
    }
    /**
     * **聚焦阵列：当拍的远端衰减**（**船长 2026-10-02 令**：「**武器的远端衰减，随时间提高到1
     * （就是无衰减）。**」＋改判「**旗舰挂载件的会随波重置**」）——挂了件的舰（R 族 T5 光环中枢）
     * 按本波起点现算爬升后的 falloff；动态射程由 foeGunMaxRangeOf 同源计算。
     * 面板 0.2 + 120 秒 ⇒ 第 60 秒 0.6、第 120 秒起 1.0（**无衰减**）。
     *
     * ⚠ **没挂件的舰 ⇒ `wShot === w`（同一个对象引用）** ⇒ 下游两条折减调用与改动前逐字一致
     * （连一次对象复制都不发生）；挂了件也只多一次浅拷贝。
     */
    const wShot =
      f.foeFocusArray !== undefined
        ? {
            ...w,
            falloff: coronaFocusFalloffOf(
              w.falloff,
              f.foeFocusArray.rampMs,
              b.lastTickGameMs - foeWaveStartMsOf(b),
            ),
          }
        : w
    // V18B（2026-09-05 船长拍板）：敌人近盲带（dist < minRange）内**不停火**——放行到
    // maxRange 内即可开火；伤害按 blindDmgMul 打折（玩家贴脸钻近盲不再零风险）。
    // 玩家武器无此待遇（近盲带内仍不开火）——双方在近盲带上行为区分。
    // 射程门：**炮台受击增程**生效时读 `foeGunMaxRangeOf`（原射程 × 倍率；仅带该字段的舰）
    if (b.distanceM > foeGunMaxRangeOf(b, f, w)) continue
    const gunCount = volleyGunCountOf(w)
    // 敌主武器仍保存整组总伤；各门共享本轮装填、独立命中。
    let volleyTarget: ReturnType<typeof pickTarget> = null
    for (let gun = 0; gun < gunCount; gun++) {
      // 选靶（多单位）：**本发开火前重选**（上一次齐射可能已把目标打沉）
      if (!volleyTarget || !isAlive(b, volleyTarget.spec.tag)) volleyTarget = pickTarget()
      if (!volleyTarget) break // 我方已全灭（正常由结束判定收场）
      const gtgt = volleyTarget
      // **劫掠捕获网**（船长 2026-09-16）：「在自身第一次开火时发动」——**不看命中**，
      // 就在这一发之前钉住本发目标（于是这一发的命中判定也吃到"闪避归零"）。
      // ⚠ ⟪2026-09-25 船长报障⟫：目标**已被别的网钉住**时本舰的网**不算用掉**（保留到它钉住新目标为止）
      // —— 该判定在 `fireFoeCaptureWeb` 内部，这里只判"本舰还没发过"。
      if (f.foeCaptureWeb !== undefined && b.foeWebFired?.[f.tag] !== true) {
        fireFoeCaptureWeb(state, b, f, gtgt.spec)
      }
      b.stats.foeShots += 1
      const fType = w.fixedType ?? 'kinetic'
      // 2026-09-08（船长定）：能量（beam）= 必中——不掷命中骰；威力：近盲带内 ×blindDmgMul
      // （近盲带保留），带内至远端按 beamPowerFactor 距离衰减（与玩家激光同源语义）
      if (w.kind === 'beam') {
        // **炮台受击增程感知的折减**（船长选乙：原射程内读数一字不变，延长段同斜率外推）
        const pow = b.distanceM < w.minRangeM ? w.blindDmgMul ?? 0.3 : foeGunPowerFactorOf(b, f, wShot, b.distanceM)
        const dmg = volleyDamageShareOf(foeRepairDiscountedShot(f, Math.max(1, Math.round((w.shotDmg ?? 0) * pow))), gunCount, gun)
        // 冲锋解除（船长 2026-09-14）：光束必中 ⇒ 本发即"自身炮台命中我方"
        releaseFoeChargeOnHit(b, f.tag, bal, f.foeChargeCooldownMs)
        b.stats.foeHits += 1
        // 混伤（2026-09-10 船长）：按逐系单发各自结算（各系吃自己的层位克制与层抗）
        const beamBefore = gtgt.rt.hp.s + gtgt.rt.hp.a + gtgt.rt.hp.h
        gtgt.rt.hp = applyFoeShot(
          gtgt.rt.hp,
          gtgt.spec.resists,
          w,
          /* 损伤管制装置：光束这一路同样过免死夹伤（窗口内逐段夹 ⇒ 同拍多段破不了） */
          applyDcGuard(
            state,
            b,
            gtgt.spec.tag,
            gtgt.spec,
            gtgt.rt.hp,
            cappedFoeDamage(b, gtgt.spec.tag, gtgt.spec, dmg),
            fType,
            (r) => applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, r, fType),
          ),
          fType,
        )
        // 本发实收（2026-09-24 船长令：飘字读数；光束必中 ⇒ 恒有值）
        const beamDealt = Math.max(0, beamBefore - (gtgt.rt.hp.s + gtgt.rt.hp.a + gtgt.rt.hp.h))
        pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: true, ...(beamDealt > 0 ? { dmg: beamDealt } : {}) })
        /**
         * **我方「跃迁规避装置」触发点**（**船长 2026-10-01 令**：「闪现装置为中槽，和R族同款，挨打触发闪现。
         * 但是冷却时间延长到12秒。」）—— **敌方舰炮命中我方舰船本体**这一支（打我方无人机不算、
         * 未命中不算，与敌方那两件受击挂载件同一钩子口径）。
         */
        if (
          markMeBlink(gtgt.spec, gtgt.spec.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits))
        ) {
          /**
           * ⚠ **演出事件不在这里推了**（**2026-10-02 §35 抽出**）：`markMeBlink` 内部已推一条带
           * `atMs`（排队后的真实起点）与 `speedX` 的（与 `markFoeBlink` 同款）——在这里再推一条
           * 会**排两根柱**、而且缺 `speedX`（倍速下时长会跑飞）。这里只留画面提示。
           */
          pushBattleNotice(b, '跃迁规避：本舰瞬时换位')
        }      continue
      }
      const blindMul = b.distanceM < w.minRangeM ? (w.blindDmgMul ?? 0.3) : 1
      const shotDmgRaw = blindMul < 1 ? Math.max(1, Math.round((w.shotDmg ?? 0) * blindMul)) : (w.shotDmg ?? 0)
      const shotDmg = volleyDamageShareOf(foeRepairDiscountedShot(f, shotDmgRaw), gunCount, gun)
      // AI favor：敌方命中被优势压制，且始终保留 97% 命中上限（3% miss 底线不变）
      // ⚠ 距离折减传**增程感知**的 `foeGunPowerFactorOf`（原射程内与原公式逐字一致；延长段同斜率外推）
      const foeHit = hitChance(w, f, gtgt.spec, b.distanceM, bal, foeGunPowerFactorOf(b, f, wShot, b.distanceM))
      const foeHitEff = favor ? clamp(0, 0.97, foeHit * favor.foeMul) : foeHit
      const fHit = nextRandom(state.rng) < foeHitEff
      /** 本发对**被打的那艘我方舰**的实收伤害（2026-09-24 船长令：飘字读数；未命中保持 0） */
      let gunDealt = 0
      if (fHit) {
        b.stats.foeHits += 1
        const gunBefore = gtgt.rt.hp.s + gtgt.rt.hp.a + gtgt.rt.hp.h
        gtgt.rt.hp = applyFoeShot(
          gtgt.rt.hp,
          gtgt.spec.resists,
          w,
          /* 损伤管制装置：炮台这一路同样过免死夹伤（窗口内逐段夹 ⇒ 同拍多段破不了） */
          applyDcGuard(
            state,
            b,
            gtgt.spec.tag,
            gtgt.spec,
            gtgt.rt.hp,
            cappedFoeDamage(b, gtgt.spec.tag, gtgt.spec, shotDmg),
            fType,
            (r) => applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, r, fType),
          ),
          fType,
        )
        gunDealt = Math.max(0, gunBefore - (gtgt.rt.hp.s + gtgt.rt.hp.a + gtgt.rt.hp.h))
        // 冲锋解除（船长 2026-09-14）：**自身炮台命中我方** ⇒ 立刻解除冲锋并进入冷却（掷命中，只有真命中才算）
        releaseFoeChargeOnHit(b, f.tag, bal, f.foeChargeCooldownMs)
      }
      pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: fHit, ...(gunDealt > 0 ? { dmg: gunDealt } : {}) })
        /**
         * **我方「跃迁规避装置」触发点**（**船长 2026-10-01 令**：「闪现装置为中槽，和R族同款，挨打触发闪现。
         * 但是冷却时间延长到12秒。」）—— **敌方舰炮命中我方舰船本体**这一支（打我方无人机不算、
         * 未命中不算，与敌方那两件受击挂载件同一钩子口径）。
         */
        if (
          markMeBlink(gtgt.spec, gtgt.spec.tag, b, bal, battleMaxDistanceM(b, me, foes, bal, myUnits))
        ) {
          /** ⚠ 同上：演出事件由 `markMeBlink` 内部推（带 `atMs`/`speedX`），这里只留画面提示。 */
          pushBattleNotice(b, '跃迁规避：本舰瞬时换位')
        }
    }
  }

  // ── 敌方点防（2026-09-10 船长「无人机可被击落」）：对我方放飞机群逐架结算 ──
  // ⚠ 机群池自 2026-09-14「逐舰机群」起是**逐舰**建的（键 = `舰tag:武器下标`，见 4803 一带），
  //   敌方点防也**逐舰选靶**（`pdFocus` 按池键存）⇒ 本条注释此前那句"仍只结算主控的机群"已过期，一并改正。
  resolvePointDefense(state, b, foes, bal, dtMs)

  // ── P0：护盾战中被动回充（EVE 式；损失不跨场，只回盾层）。
  // 甲/结构已打穿时停止回充——避免"只剩一层盾皮"的无限僵持（P2 可再调）
  // ⚠ **2026-09-14 船长改判**：回充量由"**满盾** × 费率"改为"**当前盾** × 费率"
  //   （原话：「改成按当前盾比例，这样护盾被击穿后应该是 0 回复对吧？」＋「不留，破盾后 0 回复」）
  //   ⇒ 回充变成**指数式**（回满时间 = ln(满盾/当前盾) ÷ 费率），且**盾归零后回充恒为 0**：
  //   盾被打穿 = 本场的分水岭，此后全程由甲/结构承伤。想重新把盾点起来只有一条路 =
  //   中槽「**护盾充能装置**」（`shieldPulsePct`，每 `SHIELD_PULSE_MS` 脉冲回满盾的一个比例）。──
  // ⚠ **2026-09-20 船长追加「恢复速度下限」**（原话：「舰船护盾的恢复速度下限改为1%。
  //   **但是当护盾被击穿时，依旧是0%**」→ 追问口径后补：「**满盾依旧是2%，当盾量接近0的时候是1%**」）：
  //   指数式的副作用是**盾越少回得越慢**（剩 2% 时每秒只回 0.04% ⇒ 回到半盾要 19.6 分钟）
  //   ⇒ 加一条**下限 = 满盾 × 1% / 秒**：
  //     盾 > 0 ⇒ `max(当前盾 × k, 满盾 × 1%)`；盾 = 0 ⇒ **仍为 0**（破盾那条裁定不变）。
  //   效果：满盾时 `100%×2% = 2%`（仍是 2%，下限不介入）；盾降到 50% 以下后由下限接管，
  //   **回充量不再随盾量继续缩水**（从 2% 回到半盾：19.6 分钟 → 44 秒）。
  if (bal.shieldRegenPerSec > 0) {
    for (const unit of myUnits) {
      const urt = b.units[unit.tag]
      if (!urt || !isAlive(b, unit.tag)) continue
      // ⚠ 满盾优先取战斗单位的 `hpMax.s`；老档/异常缺省时回退到该单位的 `spec.hp.s`（= 满盾口径）
      const sMax = urt.hpMax?.s ?? unit.hp.s
      if (urt.hp.s >= sMax || (urt.hp.a <= 0 && urt.hp.h <= 0)) continue
      // 下限 = 该舰**满盾**的 1%/秒；`urt.hp.s > 0` 是"破盾后 0 回复"那条裁定的落点
      const floor = sMax * SHIELD_REGEN_FLOOR_PCT
      const rate = urt.hp.s > 0 ? Math.max(urt.hp.s * bal.shieldRegenPerSec, floor) : 0
      const regen = rate * dtSec
      if (regen > 0) urt.hp.s = Math.min(sMax, urt.hp.s + regen)
    }
  }

  // ── 隐秘行动装置（2026-09-15 船长）：**窗口到点即现形** —— "先到者为准"的另一支
  //    （开火那一支在上面 `stats.meShots` 处已处理）⇒ 一直没开火也不会永久隐身。──
  for (const unit of myUnits) {
    const urt = b.units[unit.tag]
    const until = urt?.stealthUntilMs
    if (urt && until !== undefined && b.lastTickGameMs >= until) {
      urt.stealthUntilMs = undefined
      pushBattleNotice(b, '隐秘行动结束：隐身窗口到点，本舰现形')
    }
  }

  // ── 结束判定 ──
  // **判负 = 我方全灭**（虫洞 D 批 · 船长 2026-09-13 定）：主控沉了僚舰继续打；
  // 单船路径下"全灭"与"主控沉"等价 ⇒ 与改动前逐字一致。
  const meAlive = isAliveAnyOf(b, myUnits)
  const foeAlive = foes.some((f) => isAlive(b, f.tag))
  if (!meAlive) {
    b.ended = 'foe'
    return
  }
  if (!foeAlive) {
    // 多波未完：本波清空不判胜（推进方下一拍切波续刷）；末波清空 = 胜利
    if (!hasMoreWaves) b.ended = 'me'
    return
  }
  // **无法交战 ⇒ 提前脱战**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：
  // 三件同时成立 —— ①开战满 `bal.cannotEngageMs`；②我方**全程一炮未发**（`stats.meShots === 0`，
  // 开过一炮就永不触发）；③当前距离仍**在我方最远射程之外**且**敌人已经开火**（`stats.foeShots > 0`，
  // 即"它在打我、我打不着它"）。判负口径与「超时判负」同源（结算侧走轻损撤退、**不掷弃船骰**），
  // 只把 `escapeReason` 记为 'cannot-engage'，好让战报写明"我方射程不足"。
  // 数值一个字不动：这一条只决定**什么时候收场**（灰霾 ②/⑤/③ 原为打满 600 秒触顶；
  // 蜃影/赤潮三行原是 140/373 秒被打死）。双方都够不着（敌也未开火）**不触发**，仍走 `maxBattleMs`。
  if (
    !b.ended &&
    bal.cannotEngageMs > 0 &&
    b.lastTickGameMs - b.startedAtGameMs >= bal.cannotEngageMs &&
    b.stats.meShots === 0 &&
    b.stats.foeShots > 0
  ) {
    const myTopRangeM = myUnits.reduce(
      (m, u) => u.weapons.reduce((mm, w) => Math.max(mm, w.maxRangeM), m),
      0,
    )
    if (b.distanceM > myTopRangeM) {
      b.ended = 'foe'
      b.autoEscaped = true
      b.escapeReason = 'cannot-engage'
    }
  }
  if (b.lastTickGameMs - b.startedAtGameMs >= bal.maxBattleMs) {
    // 超时判负（2026-09-10 船长定）：打满战斗上限**不再按剩余血量比判胜**（旧口径
    // "meRatio >= bestFoe 即我方胜"= 平局算赢，已作废），一律判负并按**撤退**处理——
    // 置 autoEscaped 交给结算侧走轻损撤退路径（远征据 escapeReason 区分文案）。
    // 动机：旧口径下"打不死但打不着我"的风筝流可白拿全额赏金（见 docs/design/
    // mixed-damage-review-20260910.md §6、docs/design/timeout-defeat-20260910.md）。
    b.ended = 'foe'
    b.autoEscaped = true
    b.escapeReason = 'timeout'
  }
}

/**
 * 距离机动的单方转向步（米）：
 * - 已到位（差 <0.5m）不动；
 * - 否则以 ≤ 本步全速航程推进，且绝不越过期望距离 → 到达后下一拍即停，不产生过冲振荡。
 * 比例收尾段（剩余 < 本步航程时推力 = 剩余）让系统天然收敛，拔河也只在平衡点静止。
 */
export function steerStep(cur: number, desire: number, speedMps: number, dtSec: number): number {
  const gap = desire - cur
  if (Math.abs(gap) < 0.5) return 0
  const cap = Math.max(0.5, speedMps * dtSec)
  const step = Math.min(Math.abs(gap), cap)
  return gap > 0 ? step : -step
}

/** 敌舰是否"可被我方选中"（2026-10-02 批次 4j 迁到 combatDrones.ts，本文件借回） */

/**
 * **我方单位当前是否"可被敌方选中"**（2026-09-15 船长：「隐秘行动装置」——**开火前隐身：不被锁定、
 * 不被攻击**）。
 *
 * 判据 = 该单位的隐身窗口不在生效期：`stealthUntilMs === undefined || lastTickGameMs >= stealthUntilMs`。
 * 为什么做成**选靶判据**而不是"伤害免疫"：与上面 `isFoeEngageable` 同一条理由——引擎里**命中与伤害
 * 同拍结算**（没有在途弹道状态）⇒ 选靶处排除即彻底；且敌舰主炮与机群在**无处可选**时自然
 * **停火待机**（Q2 甲：本拍若没有别的可打目标就不开火）。
 *
 * 缺字段（未装装置的船 / 敌舰 / 老档）⇒ **恒可选中**（零行为变化）。
 */
function isMyUnitTargetable(b: import('./state').BattleState, tag: string): boolean {
  const until = b.units[tag]?.stealthUntilMs
  return until === undefined || b.lastTickGameMs >= until
}

/**
 * 我方单位**当前是否正处于隐身窗口内**（`isMyUnitTargetable` 的补集）——给"隐身时不自动开火"这类
 * 判据用（船长 2026-09-17：「**让舰船自带的基础舰炮在隐身情况下不开炮**」；落码点 = 我方开火循环里
 * 对 `src === 'base'` 的那一条）。**故意与选靶共用同一把尺**：两处若各写一份判据，日后改隐身旁支
 * 必然出现"打得着却打不到 / 打不到却挨打"的错位。缺字段（未装装置 / 敌舰 / 老档）⇒ `false`。
 */
function isMyUnitStealthed(b: import('./state').BattleState, tag: string): boolean {
  return !isMyUnitTargetable(b, tag)
}

/** 我方还有没有活着的单位（`myUnits` 里任一存活）——单船路径等价于 `isAlive(b,'player')` */function isAliveAnyOf(b: import('./state').BattleState, myUnits: readonly UnitSpec[]): boolean {
  return myUnits.some((u) => isAlive(b, u.tag))
}

/* ═══════════ 虫洞 D 批：敌方选靶（船长 2026-09-13 定） ═══════════ */

/** 存活的我方单位（按编队顺序；`myFleet` 首条 = 主控 ⇒ 首位恒为 `player`） */
export function aliveMyUnits(
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
): UnitSpec[] {
  return myUnits.filter((u) => isAlive(b, u.tag))
}

/** 我方单位的**输出分**（模式「打输出最高的」判据）= 各武器条目名义 DPS 之和
 *  （`nominalWeaponDps` 与装配页 `rawDpsOf` 同口径：炮台取首弹种单发 × 门数 ÷ 装填） */
export function myUnitOutputScore(u: UnitSpec): number {
  let sum = 0
  for (const w of u.weapons) sum += nominalWeaponDps(w)
  return sum
}

/** **非战斗船**（模式「打非战斗船」判据）：工业/采矿与货舰算非战斗；武装/装甲算战斗 */
export function isNonCombatShipRole(role: ShipRole | undefined): boolean {
  return role === 'industrial' || role === 'hauler'
}

/**
 * **敌方选靶**（虫洞 D 批 · 船长 2026-09-13 定的五种模式；见 `FoeTargetingMode`）：
 * 从**存活我方单位**里挑一个目标。并列（同输出 / 同档 / 多艘非战斗船）一律**按被选中权重抽取**
 * （缺省权重都是 1 ⇒ 等权随机，也就是改动前的口径）。
 *
 * ⚠⚠ **只剩一艘我方单位时直接返回、一次随机数都不消费** —— 这条是单船路径零漂移的命门：
 * 既有 27 张悬赏卡 / 低安遭遇 / AI 副船的战斗里，敌方开火从不掷"选靶骰"，本函数在那些
 * 场次里也不会多消耗一个 `nextRandom`（否则整批标定读数会漂移）。
 * ⚠ `noncombat` 模式下编队里**没有**非战斗船 ⇒ **退回随机**（船长口径）。
 * ⚠ 模式只由**虫洞内敌卡**（`AnomalyDef.foeTargeting`）写；不写 = `random`。
 *
 * **倾向概率**（船长 2026-09-14：「虫洞敌人的攻击倾向，加一个概率」→「目前先挨个定为60%」）：
 * `chance` = 该模式下**每发开火前**按这个概率生效一次，没掷中 ⇒ **这一发乱了（退回随机抽取）**。
 * `chance >= 1`（缺省）或模式本来就是 `random` ⇒ **连一次骰都不掷** ⇒ 旧场次的随机数消费顺序逐字节不变。
 */
export function pickMyUnitTarget(
  state: GameState,
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
  mode: FoeTargetingMode = 'random',
  /** 模式的作用概率（1 = 铁律；<1 ⇒ 每发开火前掷一次，没掷中退回随机） */
  chance = 1,
): UnitSpec | null {
  // ⚠ **单船路径逐字等价**：编队只有一条（= 既有 27 张悬赏卡 / 低安遭遇 / AI 副船全部场次）
  // ⇒ 恒返回那一条、**一次随机数都不消费**。这里**刻意不看存活**：改动前敌方主炮分支只判
  // `!meRt`、不判 `isAlive`，故"我方在某一拍被打沉后、本拍剩余敌人仍照旧结算开火"——
  // 那一发打在尸体上、对战果无影响，但**会进 `stats.foeShots`**（标定工具「敌开火」列）。
  // 若在此提前返回 null，该计数会少掉最后一拍 ⇒ 与改动前口径不一致（D 批实测到的唯一漂移）。
  if (myUnits.length === 1) {
    /**
     * **隐秘行动**（2026-09-15 船长）：唯一那艘若在隐身窗口内 ⇒ 敌方**无人可选** ⇒ 本发停火
     * （Q2 甲）。**零漂移命门照旧**：没装装置时 `isMyUnitTargetable` 恒真 ⇒ 与改动前逐字等价、
     * 一次随机数都不多消费。
     */
    const only = myUnits[0]!
    return isMyUnitTargetable(b, only.tag) ? only : null
  }
  const alive = aliveMyUnits(b, myUnits).filter((u) => isMyUnitTargetable(b, u.tag))
  if (alive.length === 0) return null
  if (alive.length === 1) return alive[0]!
  /**
   * **按"被选中权重"加权抽取**——走仓内单点 `pickWeighted`（`bound: 'lt'`，与原先的
   * `nextInt(rng, n) = ⌊u × n⌋` 同边界），**恰好消费一次 `nextRandom`**。
   *
   * ⚠⚠ **零漂移命门（2026-09-26 插件批的等价性证明）**：全部权重都等于 1 时，
   * `roll = u × n` 落在第 k 段 ⇔ `⌊u × n⌋ = k`（仅在 `u × n` 精确等于整数 k 的边界上两者都取 k）
   * ⇒ 与改动前的 `nextInt(state.rng, cands.length)` **恒等**，随机数消费次数也一致。
   * 没装靶标/隐匿插件的全部既有场次（含 27 张悬赏卡与标定读数）**逐位不变**。
   */
  const weightOf = (u: UnitSpec): number => {
    const w = u.targetWeightMul
    return w !== undefined && Number.isFinite(w) && w > 0 ? w : 1
  }
  const randomOf = (cands: UnitSpec[]): UnitSpec =>
    pickWeighted(state.rng, cands, weightOf) ?? cands[cands.length - 1]!
  /**
   * **倾向概率的掷骰点**（2026-09-14 船长）：**每发开火前各掷一次**，没掷中 ⇒ 这一发乱了。
   * 位置刻意放在两个早退**之后** —— 单船 / 只剩一艘时恒返回、不掷骰（洞外零漂移的命门）。
   */
  const missed = chance < 1 && mode !== 'random' && nextRandom(state.rng) >= chance
  if (mode === 'random' || missed) return randomOf(alive)
  switch (mode) {
    case 'top-output': {
      const best = Math.max(...alive.map((u) => myUnitOutputScore(u)))
      return randomOf(alive.filter((u) => myUnitOutputScore(u) === best))
    }
    case 'smallest':
    case 'largest': {
      const tiers = alive.map((u) => u.shipTier ?? 1)
      const want = mode === 'smallest' ? Math.min(...tiers) : Math.max(...tiers)
      return randomOf(alive.filter((u) => (u.shipTier ?? 1) === want))
    }
    case 'noncombat': {
      const civ = alive.filter((u) => isNonCombatShipRole(u.shipRole))
      return civ.length > 0 ? randomOf(civ) : randomOf(alive)
    }
    // `random` 已在上面早退（`mode === 'random' || missed`）⇒ 这里只剩兜底
    default:
      return randomOf(alive)
  }
}

/** 锁定目标（2026-09-09 锁定装置）：存活编队首位（foes 生成序 = 主舰优先），
 * 主舰击毁自动接力下一艘——集火永不卡空；确定性、不消耗 rng */
function firstAliveFoe(foes: UnitSpec[], b: import('./state').BattleState): UnitSpec | null {
  for (const f of foes) if (isFoeEngageable(b, f.tag)) return f
  return null
}

/**
 * V18B 随机目标（船长 2026-09-05）：从存活敌人中均匀随机抽一个（确定性走 state.rng——
 * 种子固定则每场可复现；每发武器调用一次 = 齐射可分散到不同目标）。
 */
function randomAliveFoe(state: import('./state').GameState, b: import('./state').BattleState, foes: UnitSpec[]): UnitSpec | null {
  // ⚠ 抽签池 = **可选中**的敌人（`isFoeEngageable`：存活 + 已过入场窗口）——池子为空 ⇒ 返回 null
  //    ⇒ 本发武器跳过（`advanceBattleFor` 里 `if (!foeTarget && !droneHit) continue`），本拍停火。
  const alive = foes.filter((f) => isFoeEngageable(b, f.tag))
  if (alive.length === 0) return null
  const i = nextInt(state.rng, alive.length)
  return alive[i]!
}

/**
 * **某星系的玩家目标距离设定**（船长 2026-09-11：「玩家每个星系设定的目标距离独立保存，
 * 预估胜率的战斗按照那个距离决定。如果没有，采用射程中段距离」）。
 * 返回 null = 该星系没设过（调用方回落到默认档：**星图 = 射程带 0.8、洞内 = 中段 0.5**，
 * 2026-09-15 船长裁定；见 `balance.battle.desireBand*`）。
 * 单点：实战开战（远征/遭遇/AI）、胜率预估（MC 与稳态解析）全走这一处，避免多处各读各的。
 */
export function desirePrefOf(state: GameState, galaxyId: string | null | undefined): number | null {
  if (!galaxyId) return null
  const v = state.expedition.desirePrefByGalaxy?.[galaxyId]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

/** 写入某星系的目标距离（战斗内拖条/战术切换、出发时显式指定共用）；返回写入后的值 */
export function setDesirePrefOf(state: GameState, galaxyId: string, desireM: number): number {
  const v = Math.max(1, Math.round(desireM))
  state.expedition.desirePrefByGalaxy = { ...(state.expedition.desirePrefByGalaxy ?? {}), [galaxyId]: v }
  return v
}

/* ═══════════ 预估胜率（确定性期望推演；UI/AI 门槛同源，不消耗 rng） ═══════════ */

/**
 * 稳态距离近似：双方期望距离的中点（钳制在开战距离内）。
 * `midPos` = 我方**默认期望档**在射程带内的位置（`bal.desireBandMid` = 0.8；星图与洞内同值，
 * 2026-09-15 船长取消分档后不再按 `wh-*` 分辨）。
 */
function steadyDistance(
  me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  midPos: number,
  foeRangeDebuffR = 0,
): number {
  const dMe = desiredRangeFor(me, 'mid', bal, midPos)
  const dFoe = foeDesiredRange(me, foes, bal, foeRangeDebuffR)
  const open = battleOpenM(me, foes, bal)
  return clamp(bal.minDistanceM, open, (dMe + dFoe) / 2)
}

/** 预估胜率核心（确定性期望推演；不消耗 rng）。
 * meMul/foeMul = 命中率缩放系数（AI favor 用；玩家手动 = 1/1），返回未扩散的模型胜率 raw ∈ [0,1] */
/** 稳态预览引擎（battleWinPreview 与带伤预警共用同一公式源——DPS/承伤/tick 换算与展示一一对应）。
 * 2026-09-09 修正（real sim 终验暴露低估，docs/design/wave-battles-20260909.md）：
 * ① 多波卡：敌方总血 = 全波预算；敌方火力 = 峰值波（各波不同时在场，不吃全波火力加成）；
 * ② 护盾回充进承伤模型（引擎 shieldRegenPerSec 实回，长盘显著）——回充窗口 ≈ 直到装甲击穿，
 *    净敌火 = foeDps − 回充率，破甲时间 tA = (盾+甲)/(净敌火)，可承受总伤 = 总 EHP + 回充量。
 * ③ **2026-09-25（船长令「改」）**：敌血**按卡面属性建档取值**（舰级路径 = 逐波三层血之和），
 *    不再一律读威胁曲线 ⇒ 与实战同源；见下方 `foeHpTotal` 的口径说明。 */
function steadyPreview(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): {
  me: UnitSpec
  meHpTotal: number
  foeHpTotal: number
  meDps: number
  foeDps: number
  ttrMe: number
  ttrFoe: number
} | null {
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  // 敌方编制口径（两处**故意分开**）：
  //   ① `foes` = **波 0** 编制 —— 实战的开战距离 / 期望交距就由波 0 首个主体单位决定（见波次注释）
  //      ⇒ 距离口径必须与实战同源，不随"峰值波"改；
  //   ② `firepowerFoes` = **各波里火力最大的那一波** —— 多波不同时在场，峰值波才是承伤口径（见下）。
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const peakUnits = waves ? Math.max(...waves.map((w) => w.units)) : 1
  const foes = peakUnits > 1 ? createFoeSpecs(anomaly, bal, { units: peakUnits }) : createFoeSpecs(anomaly, bal)

  /**
   * **舰级路径的逐波建档**（波号从 `slot.wave` 现算 ⇒ 不依赖 `waves[]` 是否写出；一次建好，血与火力共用）：
   * - **血**：全波之和（多波 = 全波预算）；
   * - **火力**：取 `dps` 最大的那一波（`firepowerFoes`）。
   *
   * ⚠ **2026-09-25 修正（船长令「改」）**：旧口径一律读曲线 `foeHpOfThreat(威胁)` 当敌血，而舰级路径
   * 的真实血量是 `ship.hp × hpMul` 的绝对值 ⇒ 两把尺子可差数倍（穹顶守卫 真 **5,729** vs 曲线价
   * F(110)=1,435），且**动威胁标签就会牵动这些显示读数**；火力侧同样有失配——
   * `createFoeSpecsFromShips` **忽略 `units`**、按 `tagPrefix` 取波（缺省 = 波 0）⇒ 多波舰级卡
   * 只按**波 0 的火力**算（噬口猎杀令：波 0 = 10.0 DPS vs 头目波 107.8 DPS，差 ×10.78）。
   * 现改为与实战同源：**血 = 属性建档之和** · **火力 = 各波取最大**（船长「按'各波取最大'改」）。
   * 旧路径（无 `ships[]`）两侧都保持原口径（曲线血 + `units` 峰值波）⇒ 逐字零变化；
   * `foeHpOverride` 仍只对旧路径生效（舰级路径本就忽略它，与实战一致）。
   */
  const shipSlots = anomaly.ships ?? []
  const shipWaveBuilds =
    shipSlots.length > 0
      ? ((): Array<{ specs: UnitSpec[]; hp: number; dps: number }> => {
          const idxs = new Set<number>()
          for (const s of shipSlots) idxs.add(Math.max(0, Math.floor(s.wave ?? 0)))
          if (idxs.size === 0) idxs.add(0)
          return [...idxs].map((i) => {
            const specs = createFoeSpecs(anomaly, bal, { tagPrefix: i === 0 ? '' : `w${i}-` })
            let hp = 0
            let dps = 0
            for (const f of specs) {
              hp += f.hp.s + f.hp.a + f.hp.h
              for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
            }
            return { specs, hp, dps }
          })
        })()
      : null
  const curveHp = anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)
  /** 敌血总预算（多波 = 全波）：舰级路径 = 逐波三层血之和；旧路径 = 曲线（建档出 0 血时同兜底曲线） */
  const foeHpTotal = shipWaveBuilds ? shipWaveBuilds.reduce((n, b) => n + b.hp, 0) || curveHp : curveHp
  /** 火力侧编制：舰级路径 = 各波中 DPS 最大的一波；旧路径 = `foes`（`units` 口径本就是峰值波） */
  const firepowerFoes = shipWaveBuilds
    ? shipWaveBuilds.reduce((best, b) => (b.dps > best.dps ? b : best), shipWaveBuilds[0]!).specs
    : foes
  // 距离口径（船长 2026-09-11：「预估胜率的战斗按照那个距离决定，如果没有，采用射程中段距离」）：
  // 该星系设过目标距离 → 用它（钳到本次开战距离内）；没设过 → 双方期望距离中点（旧口径）。
  const steadyPref = desirePrefOf(state, anomaly.galaxyId)
  const steady =
    steadyPref !== null
      ? clamp(bal.minDistanceM, battleOpenM(me, foes, bal), steadyPref)
      : steadyDistance(me, foes, bal, bal.desireBandMid, meFoeRangeDebuffOf(state, ctx, [shipId]))

  const meHpTotal = me.hp.s + me.hp.a + me.hp.h

  // 我方 DPS：逐武器（V17.2 炮台 = 固定弹种：按炮型 × 敌方血型克制精确计算；
  // V18B-2 激光 beam = 命中恒 1（必中）且按稳态距离折算威力衰减）
  let meDps = 0
  for (const w of me.weapons) {
    let shot = 0
    let ammoType: DamageType | null = null
    let hit = 0
    let power = 1
    if (w.kind === 'gun') {
      const entries = Object.entries(w.shotsByType ?? {})
      if (entries.length > 0) {
        const [t, v] = entries[0]!
        ammoType = t as DamageType
        shot = v ?? 0
      }
      hit = hitChance(w, me, foes[0]!, steady, bal)
    } else if (w.kind === 'beam') {
      ammoType = w.fixedType ?? 'plasma'
      shot = w.shotDmg ?? 0
      hit = 1 // 必中
      power = beamPowerFactor(steady, w)
    } else {
      shot = w.shotDmg ?? 0
      hit = hitChance(w, me, foes[0]!, steady, bal)
    }
    if (hit <= 0) continue
    const mult = effectiveDmgMultAgainst(foes, ammoType ?? w.fixedType ?? 'kinetic')
    // **全体攻击**（2026-09-13 船长：C 孢子导弹巢「对所有敌方同时攻击」）——
    // 预估必须同步：一轮齐射的实收 = 单目标 × **当前在场敌舰数**（多波卡按峰值波小队数，与 `foes` 同源）。
    const allFoesMul = w.allFoes === true ? Math.max(1, foes.length) : 1
    meDps += (shot * power * mult * hit * allFoesMul * 1000) / w.reloadMs
    // 附加伤害段同步（掠袭破片炮）：预估不许"卡面混伤、按纯系算"——副段走它自己那系的克制倍率
    const secPctEst = w.secondaryDamagePct ?? 0
    if (secPctEst > 0) {
      const secMul = effectiveDmgMultAgainst(foes, w.secondaryDamageType ?? 'kinetic')
      meDps += (shot * power * secMul * hit * allFoesMul * secPctEst * 1000) / w.reloadMs
    }
  }
  // 敌方 DPS（打我，含类型克制与层抗；近盲带内伤害按 blindDmgMul 折算——
  // 2026-09-08：能量 beam 必中（hit=1）且威力走 beamPowerFactor/盲带，与实时引擎同源）
  // 2026-09-10 船长（窝点混伤）：克制倍率按**火力构成加权求和**（与实时逐系结算同源，
  // 否则"卡面写混伤、预估按纯系算"会骗人）
  const foeComp = foeDamageComposition(anomaly)
  const foeCompWeighted = (type: DamageType): number =>
    foeComp.length <= 1
      ? avgLayerMult(meHpTotal, me, type)
      : foeComp.reduce((s, c) => s + c.share * avgLayerMult(meHpTotal, me, c.type), 0)
  let foeDpsPeak = 0
  // ⚠ 用 `firepowerFoes`（各波里火力最大的一波），**不是** `foes`（波 0，只服务距离口径）——
  //   舰级路径多波卡的头目常在末波（噬口猎杀令：波 0 = 10.0 DPS vs 头目波 107.8 DPS）
  for (const f of firepowerFoes) {
    const w = f.weapons[0]!
    const isBeam = w.kind === 'beam'
    const hit = isBeam ? 1 : hitChance(w, f, me, steady, bal)
    if (hit <= 0) continue
    const power = isBeam ? (steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : beamPowerFactor(steady, w)) : steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : 1
    const shot = Math.max(1, Math.round((w.shotDmg ?? 0) * power))
    const mult = foeCompWeighted(w.fixedType ?? 'kinetic')
    /**
     * ⚠ **连发按"一轮 `shots` 发 ÷ 同一个装填周期"计入**（**2026-10-02 加**）：
     * `w.burst` 缺省 ⇒ `shotsPerCycle = 1` ⇒ 本行与改动前**逐字一致**（既有全部敌舰）。
     * 不乘 `shots` 会把三连发武器的期望承伤**低估到 1/3**（发间隔 100ms 相对 5 秒装填可忽略，
     * 故周期仍按 `reloadMs` 计）。
     */
    const shotsPerCycle = Math.max(1, Math.floor(w.burst?.shots ?? 1))
    foeDpsPeak += (shot * shotsPerCycle * mult * hit * 1000) / w.reloadMs
  }
  // 2026-09-09 减员修正（稳态把"敌人满员全程输出"当真相，多单位/多波严重高估承伤）：
  // 我方逐个击毁敌方单位 → 敌方在场火力近似线性衰减，全程平均 ≈ 峰值 × (N+1)/(2N)
  // （N = **峰值火力那一波的单位数**；随机目标下各单位击杀时刻 ≈ 按血量比例均匀分布）
  const foeUnitN = Math.max(1, firepowerFoes.length)
  const foeDps = foeDpsPeak * ((foeUnitN + 1) / (2 * foeUnitN))

  // 承伤窗口含护盾回充（2026-09-09 修正）——**2026-09-14 船长改判后为指数式**：
  // 回充按**当前盾**比例（引擎：`urt.hp.s × 费率`）⇒ 盾动力学 `ds/dt = k·s − D`（k = 费率、D = 净敌火）
  //   · 盾被打穿时刻 `tBreak = ln(D/(D − k·s₀)) ÷ k`（**仅当 D > k·s₀**；否则回充永远顶得住、盾不破）
  //   · **破盾后回充归 0**（船长「不留，破盾后 0 回复」）⇒ 之后 D 全打在甲+结构上
  //   · 装了「护盾充能装置」时：把 15 秒脉冲折成**恒定附加回充** `c = 满盾 × 每跳比例 ÷ 15 秒`，
  //     **只在破盾后计入**（盾没破时被动回充远大于它）——这样估算不会对带装置的人过分悲观。
  // ⚠ **2026-09-20 船长加「恢复速度下限」后本模型必须同改**（原话见 `SHIELD_REGEN_FLOOR_PCT`）：
  //   引擎的回充已是 `max(当前盾 × k, 满盾 × 1%)` ⇒ **盾低于 50% 后回充不再随盾量缩水**
  //   （速率恒定 = 满盾的 1%/秒）。本模型若还用纯指数式，会**低估**玩家的盾抗 ⇒ AI 派单误判。
  //   新的分段动力学（`sMax` = 满盾、`sCap = sMax × 1%` = 恒速下限、`sX = sCap / k` = 两段交点）：
  //     · `s > sX`：指数段（同旧口径）
  //     · `sX ≥ s > 0`：**恒速段**（净掉率 = D − sCap；`D ≤ sCap` ⇒ 恒速回充，永远打不穿）
  //     · `s = 0`：破盾，回充归 0（不变）
  const foeDpsNet = foeDps * foeMul
  const k = bal.shieldRegenPerSec
  const sMax = Math.max(0, me.hp.s) // ⚠ `UnitSpec` 上**没有** `hpMax`；`steadyPreview` 取的是满盾规格，故这里就是满盾
  const s0 = Math.max(0, me.hp.s)
  const sCap = sMax * SHIELD_REGEN_FLOOR_PCT
  const sX = k > 0 ? sCap / k : Number.POSITIVE_INFINITY
  /**
   * **每秒回盾量 = Σ 逐路「本路比例 × 满盾 ÷ 本路间隔」**（**2026-09-21 逐型号独立回转**后：
   * 各路各按各的节奏跳，所以必须逐路换算再相加，不能拿"合计比例 ÷ 某个间隔"）。
   */
  const chargePerSec =
    shieldChargeStreamsOf(state, ctx, shipId).reduce((n, s) => n + (s.pct * sMax) / Math.max(1, s.ms) / 1000, 0)
  let ttrMe: number
  if (foeDpsNet <= 0) {
    ttrMe = Number.POSITIVE_INFINITY // 敌方打不动我
  } else if (k > 0 && s0 > 0 && foeDpsNet <= Math.max(k * s0, sCap)) {
    ttrMe = Number.POSITIVE_INFINITY // 回充顶住敌火：盾永不破 ⇒ 只有超时血比才可能落败
  } else if (k > 0 && s0 > 0) {
    // 第一段：指数衰减到交点（已在交点以下就直接进第二段）
    const tExp = s0 > sX ? Math.log((foeDpsNet - sCap) / (foeDpsNet - k * s0)) / k : 0
    // 第二段：从 `min(s0, sX)` 恒速掉到 0
    const lin = foeDpsNet - sCap
    const tLin = lin > 0 ? Math.min(s0, sX) / lin : Number.POSITIVE_INFINITY
    const tBreak = tExp + tLin // 盾被打穿（∞ = 恒速段也顶得住 ⇒ 永远打不穿）
    const after = Math.max(0, foeDpsNet - chargePerSec) // 破盾后：充能装置托底
    ttrMe = Number.isFinite(tBreak) && after > 0 ? tBreak + (me.hp.a + me.hp.h) / after : Number.POSITIVE_INFINITY
  } else {
    ttrMe = meHpTotal / foeDpsNet // 无回充（费率 0 或无盾）：原口径
  }
  const ttrFoe = meDps > 0 ? foeHpTotal / Math.max(1e-9, meDps * meMul) : Infinity // 我击毁敌方所需秒数
  return { me, meHpTotal, foeHpTotal, meDps, foeDps, ttrMe, ttrFoe }
}

function winPreviewRaw(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): number {
  const sp = steadyPreview(state, ctx, anomaly, shipId, meMul, foeMul)
  if (!sp) return 0
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) return 0.5
  if (!Number.isFinite(sp.ttrMe)) return 1 // 敌永远打不死我 → 必胜
  if (!Number.isFinite(sp.ttrFoe)) return 0 // 我永远打不死敌 → 必败
  return clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
}

/**
 * 带伤预警预估（2026-09-08 船长定）：在满耐久稳态模型上，把"预计承受总伤"按 盾→装甲→结构
 * 三层顺序分摊，得到预计装甲损耗比与结构损耗比（0~1）。战斗持续时长 = 先到者（我被击毁 /
 * 我击毁敌方），与实时引擎同源公式。
 */
export function bountyDamageForecast(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): { armorLoss: number; hullLoss: number; rawWin: number } {
  const sp = steadyPreview(state, ctx, anomaly, shipId, 1, 1)
  if (!sp) return { armorLoss: 0, hullLoss: 0, rawWin: 0 }
  let rawWin: number
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) rawWin = 0.5
  else if (!Number.isFinite(sp.ttrMe)) rawWin = 1
  else if (!Number.isFinite(sp.ttrFoe)) rawWin = 0
  else rawWin = clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
  const duration = Math.min(sp.ttrMe, sp.ttrFoe)
  /**
   * **隐秘行动装置计入预估**（2026-09-15 船长 · Q6 甲）：隐身窗口内**双方都不开火**
   * （我方一开火就现形 ⇒ 窗口内我方同样停火）⇒ 敌方的**有效输出时长**要扣掉这一段
   * （窗口比战斗还长就扣到 0，不会出现"负输出"）。
   *
   * **口径边界（如实登记）**：胜率**比值**不受影响（双方 DPS 没变，只是开打得更晚）——
   * 玩家可见的胜率走 `winEstimate.ts` 的**蒙特卡洛**（直接跑真引擎）⇒ 装置**自动计入**、无需另算；
   * 本处改的是**损耗预估**（预计装甲/结构损耗），免得"装了装置、面板还按旧损耗显示"。
   */
  const stealthSec = Math.max(0, (sp.me.stealthMs ?? 0) / 1000)
  const foeFireSec = Math.max(0, duration - stealthSec)
  const dmg = Number.isFinite(duration) ? sp.foeDps * foeFireSec : 0
  const afterShield = Math.max(0, dmg - sp.me.hp.s)
  const armorLoss = sp.me.hp.a > 0 ? clamp(0, 1, afterShield / sp.me.hp.a) : afterShield > 0 ? 1 : 0
  const hullLoss = sp.me.hp.h > 0 ? clamp(0, 1, Math.max(0, afterShield - sp.me.hp.a) / sp.me.hp.h) : afterShield > sp.me.hp.a ? 1 : 0
  return { armorLoss, hullLoss, rawWin }
}

/**
 * 【已退役的展示口径，2026-09-09】悬赏展示胜率 = 稳态解析 + 带伤扣分(旧方案)——探针实测双向
 * 大偏差(显示 2% 却常胜),被 winEstimate.ts 蒙特卡洛推演(玩家可见)取代。本函数保留仅作：
 * ①缓存预热完成前的临时回退显示；②活动远征视图/测试兼容。结算与 AI/工具口径 battleWinPreview 不变。
 * = 原显示胜率（满耐久基准 + logit 扩散）− 预计装甲损耗×winPenaltyArmorPerFull
 * − 预计结构损耗×winPenaltyHullPerFull（结构伤扣更重），下限 2%。
 *
 * ⚠ **2026-09-23 船长报障后去掉 98% 上限**（玩家：「**胜率过于极端，98 胜率打噬口猎杀令连续失败**」）：
 * 旧写法 `Math.min(0.98, …)` 把"稳赢"也显示成 **98%**，玩家读成"几乎必胜"；而**派系/窝点卡**
 * 这条回退口径是**唯一的显示来源**（蒙特卡洛只管未加成卡，见 `Expedition` 的 `factionHit`）
 * ⇒ 那条路径上"98%"就是天花板值，与实际胜率无关。**下限 2% 保留**（"仍有希望"语义），
 * 上限改为不截断（真正稳赢就显示 99%/100%，由显示端按整数呈现）。
 */
export function bountyWinPercentGuarded(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): number {
  const f = bountyDamageForecast(state, ctx, anomaly, shipId)
  if (f.rawWin <= 0) return 0
  const shown = spreadWinChance(f.rawWin, ctx.balance.battle.winSpread)
  const bal = ctx.balance.battle
  const penalty = f.armorLoss * bal.winPenaltyArmorPerFull + f.hullLoss * bal.winPenaltyHullPerFull
  return Math.max(0.02, Math.min(1, shown - penalty))
}

/** 玩家口径预估胜率：无 favor 模型 + logit 扩散（悬赏卡/玩家手动战斗展示用；实际结算与之对应） */
export function battleWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string = state.shipId): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return spreadWinChance(raw, ctx.balance.battle.winSpread)
}

/** AI 远征 favor 优势量（与结算推进同一来源；指派与展示共用） */
export function aiFavorAdv(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return clamp(-1, 1, (raw - 0.5) * 2)
}

/** AI 口径预估胜率（"最终成功率"）：无 favor 模型 → 按 aiFavorStrength 修正命中 → logit 扩散。
 *  AI 接单门槛与 AI 指挥中心展示用它；数值 = AI 副船在该 favor 下的期望表现。 */
export function aiWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const k = ctx.balance.battle.aiFavorStrength
  const adv = aiFavorAdv(state, ctx, anomaly, shipId)
  const favored = winPreviewRaw(state, ctx, anomaly, shipId, 1 + k * adv, 1 - k * adv)
  return spreadWinChance(favored, ctx.balance.battle.winSpread)
}

/** 伤害类型 × 敌方三层占比的期望克制倍率（敌方无抗） */
function effectiveDmgMultAgainst(foes: UnitSpec[], type: DamageType): number {
  let total = 0
  let acc = 0
  for (const f of foes) {
    const s = f.hp.s + f.hp.a + f.hp.h
    total += s
    acc += f.hp.s * typeLayerMult(type, 'shield') + f.hp.a * typeLayerMult(type, 'armor') + f.hp.h * typeLayerMult(type, 'hull')
  }
  return total > 0 ? acc / total : 1
}

/** 我方三层占比 × 类型克制 × (1−层抗) 的期望倍率 */
function avgLayerMult(meHpTotal: number, me: UnitSpec, type: DamageType): number {
  if (meHpTotal <= 0) return 1
  const s = (me.hp.s / meHpTotal) * typeLayerMult(type, 'shield') * (1 - (me.resists.shield?.[type] ?? 0))
  const a = (me.hp.a / meHpTotal) * typeLayerMult(type, 'armor') * (1 - (me.resists.armor?.[type] ?? 0))
  const h = (me.hp.h / meHpTotal) * typeLayerMult(type, 'hull') * (1 - (me.resists.hull?.[type] ?? 0))
  return s + a + h
}
