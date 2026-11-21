import type { DamageType, DamageResists, DroneDefense, DroneClass, FoeTactic, FoeTargetingMode, FoeFamily } from './combat/types/damage'
import type { BattleBalance } from './combat/types/balance'
import type { FoeShipDef, FoeShipSlot } from './combat/types/foes'

import type { WreckGroupDef } from './wreckGroups'
import type { RecycleTier } from './salvage'

export interface SkillDef {
  readonly id: string
  readonly name: string
  readonly group: string
  readonly rank: number
  /** 单技能训练许可定价（信用点）；缺省沿用rank价目表，可为低阶技能显式要求许可。 */
  readonly licensePriceIsk?: number
  /** 购买许可的累计协会声望门槛，不消耗声望；已购或已练的许可资格不回收。 */
  readonly licenseStandingReq?: number
  readonly baseMs?: number
  readonly description: string
  readonly branch?: string
  readonly prereq?: readonly string[]
  readonly prereqLevel?: Readonly<Record<string, number>>
}

export type SkillCatalog = ReadonlyMap<string, SkillDef>


export interface RefineRow {
  mineralId: string
  perOre: number
}

export type ItemKind =
  | 'ore'
  | 'mineral'
  | 'part'
  | 'gas'
  | 'ice'
  | 'ammo'
  | 'drone'
  | 'wreck'
  | 'container'
  | 'matter'
  | 'fragment'
  | 'kit'
  | 'aicore'
  | 'essence'
  | 'luxury'
  | 'blackbox'
  | 'consumable'






export interface ItemDef {
  id: string
  name: string
  kind: ItemKind
  unitM3: number
  holdForbidden?: boolean
  baseSellPriceIsk: number
  description: string
  refine?: readonly RefineRow[]
  refineBatchUnits?: number
  refineCycleMs?: number
  damageType?: DamageType
  dmg?: number
  cpuUse?: number
  defense?: DroneDefense
  maxRangeM?: number;
  reloadMs?: number;
  droneClass?: DroneClass
  repairDrone?: boolean
  repairArmorHp?: number
  repairHullHp?: number
  repairIntervalMs?: number
  repairKit?: string
  hitRate?: number
  falloff?: number
  repairRestore?: number
  exclusive?: boolean
  unreleased?: boolean
}



export interface BeltDef {
  id: string
  name: string
  oreId: string
  outputs?: ReadonlyArray<{ itemId: string; weight: number }>
  standingReq?: number
  galaxyId?: string
  description: string
}

export type ShipRole = 'industrial' | 'armed' | 'armored' | 'hauler'







export type ShipSubClass =
  | '电子舰'
  | '炮舰'
  | '重型突击巡洋舰'
  | '截击舰'
  | '指挥舰'
  | '鱼雷舰'
  | '无人机作战舰'
  | '侦察舰'
  | '后勤舰'
  | '武装货舰'

import type { ShipDef } from './ships/types'
export type { ShipDef } from './ships/types'

export type AiCoreType = 'basic' | 'gamma' | 'beta' | 'alpha'


export type MarketRarity = 'common' | 'rare' | 'exotic'

export type MarketGoodKind = 'item' | 'module' | 'ship' | 'blueprint' | 'aicore'

export interface MarketGoodDef {
  key: string
  kind: MarketGoodKind
  refId: string
  rarity: MarketRarity
  basePrice: number
  poolTarget?: number
  supplyFlow?: number
  limitedSupplyCap?: number
  limitedSupplyEveryMs?: number
  limitedSupplyUnits?: number
  absorbQtyPerWindow?: number
  supplyMultiplier?: number
  rareQtyMul?: number
  rareWeightMul?: number
  demandMultiplier?: number
  playerSellable?: boolean
  playerBuyable?: boolean
  blackMarketBuyable?: boolean
  unreleased?: boolean
  standingReq?: number
  bmStanding?: number
  rarityTier?: number
}

export interface MarketBalance {
  tickMs: number
  orderLifeMs: Record<MarketRarity, number>
  poolRegenHalfMs: number
  commonFlowPerWindow: number
  rareWindowChance: number
  exoticWindowChance: number
  rareTier3Weight: number
  rareTier4Weight: number
  rareTier5Weight: number
  blueprintWeight: number
  singleUseBlueprintWeight: number
  blueprintLifeMs: number
  shockTriggerRatio: number
  shockPerTrigger: number
  dumpBuyVolumePerLayer: number
  dumpSellVolumePerLayer: number
  shockDecayHalfMs: number
  noiseHalfLifeMs: number
  noiseStep: number
  minPriceRatio: number
  maxPriceRatio: number
  digestPerWindow: number
  absorbPerPoint: number
  absorbMaxMul: number
  builtSellMulPerSite: number
  referenceVolRatio: number
  salesTaxRate: number
  taxSkillAId: string
  taxSkillBId: string
  taxCutPerLevel: number
  snatchSellChance: number
  snatchSellDecay: number
  snatchBuyChance: number
  snatchBuyDecay: number
}

export interface BalanceConfig {
  mining: {
    yieldSkillId: string
    yieldPerLevel: number
    timeSkillId: string
    timePerLevel: number
    localLegMs: number
  }
  refining: {
    baseRate: number
    rateSkillId: string
    ratePerLevel: number
    secondRateSkillId: string
    secondRatePerLevel: number
  }
  manufacturing: {
    timeSkillId: string
    timePerLevel: number
  }
  combat: {
    basePower: number
    gunnerySkillId: string
    powerPerLevel: number
    minWinChance: number
    maxWinChance: number
    defeatCostRatio: number
    durabilityLossMin: number
    durabilityLossMax: number
    retreatHitFirepowerSec: number
    minAbandonChance: number
    maxAbandonChance: number
    agilityEscapeFactor: number
    durabilityFactor: number
  }
  aiCore: {
    skillId: string
    industrySkillSlots: Readonly<Record<string, number>>
    dispatchSkillId: string
    dispatchPerLevel: number
    basicPriceIsk: number
    efficiency: Record<AiCoreType, number>
    drops: readonly {
      minThreat: number
      rewards: readonly { type: AiCoreType; chance: number }[]
    }[]
  }
  repair: {
    perHpCost: number
    quickRepairSkills: { id: string; perLevel: number }[]
  }
  market: MarketBalance
  battle: BattleBalance
  encounter: EncounterBalance
  events: {
    enabled: boolean
    minGapMs: number
    maxGapMs: number
    gapPower: number
    miscWeight: number
    voyageWeight: number
    marketShockWeight: number
    marketOrderWeight: number
    exploreBoost: number
    exploreBonusPerGalaxy: number
    exploreBonusCap: number
  }
  richVeinChance: number
  intactHullRatePerMin: number
  intactMk2Chance: number
  travelEventChance: number
  rewardJitter: number
  travel: TravelBalance
  haul: HaulBalance
}

export interface EncounterBalance {
  industrial: import('./encounters/riskTypes').IndustrialEncounterConfig
  lowSecMax: number
  zoneCooldownMs: number
  inviteWaitMs: number
  entryBufferMs: number
  ambushChanceAtZero: number
  ambushChancePerSec: number
  scanAmbushMul: number
  hitFirepowerSec: number
  retreatHullFrac: number
  repairTargetFrac: number
  lootTakenMaxPct: number
  lootFracOfBounty: number
}

export interface TravelBalance {
  warpRefAus: number
  skillIds: readonly string[]
  cutPerLevel: number
}

export interface HaulBalance {
  securityMul: { 高安: number; 中安: number; 低安: number }
  distExp: number
  anchorNominalMinutes: number
  anchorEffectiveMinutes: number
}



export type DefProfile = 'shield' | 'armor' | 'balanced'



export const FOE_TARGETING_LABELS: Record<FoeTargetingMode, string> = {
  random: '随机抽取',
  'top-output': '打输出最高的',
  smallest: '打最小的',
  largest: '打最大的',
  noncombat: '打非战斗船',
}

export type EnergyForm = 'beam' | 'spit'



export type ModuleSlot =
  | 'miner'
  | 'cargo'
  | 'turret'
  | 'missile'
  | 'laser'
  | 'salvager'
  | 'shield'
  | 'armor'
  | 'propulsion'
  | 'drone-rack'
  | 'drone-tac'
  | 'drone-relay'
  | 'drone-launch'
  | 'drone-deck'
  | 'drone-shield'
  | 'support'
  | 'cpu'
  | 'plug'
  | 'target-lock'
  | 'shield-field'

export type RackSlot = 'high' | 'mid' | 'low'

export interface ShipSlots {
  high: number
  mid: number
  low: number
}

export type FittedModules = {
  high: Array<string | null>
  mid: Array<string | null>
  low: Array<string | null>
}

export interface ModuleDef {
  rangeEwStrength?: number
  droneLaunchCutPct?: number
  laserFalloffBonus?: number
  id: string
  name: string
  slot: ModuleSlot
  rack?: RackSlot
  bonus?: number
  workEfficiency?: number
  description: string
  unreleased?: boolean
  shieldHpBonus?: number
  shieldResistAdd?: DamageResists
  armorHpBonus?: number
  hullHpBonus?: number
  speedPenaltyPct?: number
  shieldHpAdd?: number
  armorHpAdd?: number
  hullHpAdd?: number
  speedAddMps?: number
  speedPenaltyMps?: number
  plugNonStacking?: boolean
  damageManagement?: { penaltyReductionPct: number; hullResistPerKind: number; maxKinds: number }
  armorCapacityPenaltyPct?: number
  armorRegenPerSec?: number
  chargedWeapons?: { reloadMul: number; damageMul: number; falloffReductionPct: number }
  droneCommand?: { sharePct: number; targetWeightPerM3: number }
  hullCapacityBonusPct?: number
  recoveryDamageImmune?: boolean
  stealthWithPropulsion?: boolean
  shieldArmorConversionPct?: number
  shieldCapacityRetainedPct?: number
  shieldPassiveBonusPct?: number
  cargoCapacityBonusPct?: number
  cpuPenalty?: number
  dronePrinting?: { hpMul: number; damageMul: number; launchMul: number; deckCycleMul: number }
  blueprintExchangeDisabled?: boolean
  midSlotsAdd?: number
  lowSlotsAdd?: number
  targetWeightMul?: number
  plugRangeBonusPct?: number
  armorResistAdd?: DamageResists
  speedBonusPct?: number
  speedRamp?: { rampMs: number; maxBonusPct: number }
  acidOnHit?: { cutPct: number; durationMs: number }
  blindDmgMul?: number
  hitPenalty?: number
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
  overlayDrive?: { stepMs: number; floorMs: number }
  railCharge?: { damageStepPct: number; reloadStepPct: number; maxStacks: number }
  crisisOverload?: { rangeBonusPct: number; damageBonusPct: number; speedPenaltyPct: number; droneInitialCutPct: number; droneCycleCutPct: number }
  rebirthRepair?: { repairMs: number; armorTotalPct: number; hullTotalPct: number }
  burst?: { shots: number; gapMs: number }
  blink?: { distanceM: number; cooldownMs: number }
  warpSpeedBonusPct?: number
  damageType?: DamageType
  ammoPerEngagement?: number
  maxRangeM?: number
  minRangeM?: number
  hitRate?: number
  falloff?: number
  reloadMs?: number
  dmgMult?: number
  shots?: number
  cpuUse?: number;
  antiDrone?: number;
  droneBayBonusM3?: number
  droneDmgBonus?: number
  droneRangeBonusPct?: number
  droneHullHpBonusPct?: number
  droneReviveCycleMs?: number
  droneShieldHpBonusPct?: number
  droneHitGapPct?: number
  salvageCycleMs?: number
  repairArmorHp?: number
  repairHullHp?: number
  repairIntervalMs?: number
  repairKit?: string
  repairFree?: boolean
  repairIgnoresCapacityAmp?: boolean
  shieldPulsePct?: number
  shieldFieldPct?: number
  shieldFieldMs?: number
  hullResistAdd?: DamageResists
  hullSaveKit?: string
  hullRecoveryChance?: number
  unique?: boolean
  damageTypeBonusPct?: DamageResists
  reloadCutPct?: number
  hitBonusPct?: number
  evasionGapPct?: number
  lockDmgBonus?: number
  lockTargetChance?: number
  stealthMs?: number
  secondaryDamagePct?: number
  secondaryDamageType?: DamageType
  ammoPerShot?: number
  hitsAllFoes?: boolean
  rangeCutPct?: number
  rangeTypeBonusPct?: DamageResists
  foeRangeDebuffPct?: number
  captureWebCycleMs?: number
  captureWebRangeM?: number
  captureWebBreakM?: number
  captureWebSlowMul?: number
  damageBonusPct?: number
  reloadPenaltyPct?: number
  allResistPenaltyPct?: number
  droneCycleCutPct?: number
  cpuBonus?: number
}

export interface ShipBlueprintDef {
  id: string
  name: string
  shipId: string
  singleUse?: boolean
  unreleased?: boolean
  materials: readonly MaterialNeed[]
  buildSeconds: number
  buildCostIsk: number
  priceIsk: number
  description: string
}

export type TravelEventEffect =
  | { kind: 'none' }
  | { kind: 'isk'; min: number; max: number }
  | { kind: 'mineral'; itemId: string; units: number }

export interface TravelEventDef {
  id: string
  name: string
  text: string
  weight: number
  effect: TravelEventEffect
}

export interface MaterialNeed {
  itemId: string
  count: number
}

export interface BlueprintDef {
  id: string
  name: string
  singleUse?: boolean
  moduleId?: string
  itemId?: string
  outputUnits?: number
  materials: readonly MaterialNeed[]
  buildSeconds: number
  buildCostIsk: number
  priceIsk: number
  description: string
  unreleased?: boolean
  learnless?: boolean
  partTier?: 'basic' | 'advanced'
}

export interface GalaxyDef {
  id: string
  name: string
  x: number
  y: number
  security?: number
  description: string
}

export interface GalaxyEdgeDef {
  from: string
  to: string
  travelMinutes: number
}

export interface LootRow {
  itemId: string
  units: number
}












export interface AnomalyDef {
  pirateGeneration?: { version: 2; statMultiplier: number }
  rangeEwLegacyCard?: AnomalyDef
  foeFormation?: {
    baseline: AnomalyDef
    layout: readonly FoeShipSlot[]
    units: readonly { spec: import('./combat/model').UnitSpec; rawSpec: import('./combat/model').UnitSpec; hpMul: number; dmgMul: number; added: boolean }[]
  }
  wreckEnemyCount?: number
  id: string
  name: string
  galaxyId: string
  threat: number
  wreckThreat?: number
  threatJudged?: number
  wormholeRepairScale?: number
  wormholePdTags?: readonly string[]
  rareWreckDrop?: number
  standingReq: number
  standingGain: number
  rewardIsk: number
  loot: readonly LootRow[]
  combatSeconds: number
  tactic?: FoeTactic
  foeTargeting?: FoeTargetingMode
  foeTargetingChance?: number
  defProfile?: DefProfile
  escorts?: number
  dmgMix?: Partial<Record<DamageType, number>>
  foeSpeedMps?: number
  foeHpOverride?: number
  blindDmgMul?: number
  foeHitRate?: number
  foeFalloff?: number
  foeShotDmg?: number
  waves?: ReadonlyArray<{ units: number; hpShare: number }>
  ships?: readonly FoeShipSlot[]
  description: string
  hidden?: boolean
  region?: 'hi' | 'lo' | 'wh' | 'inv'
  wreckTier?: RecycleTier
  foeFamily?: FoeFamily
  lairCore?: string
  lairTierNames?: readonly [string, string, string]
  lairGear?: readonly string[]
  lairLevel?: 1 | 2 | 3
}

export interface SimContext {
  planetary?: import('./planetTypes').PlanetCatalog
  skills: SkillCatalog
  ships: ReadonlyMap<string, ShipDef>
  belts: ReadonlyMap<string, BeltDef>
  items: ReadonlyMap<string, ItemDef>
  modules: ReadonlyMap<string, ModuleDef>
  blueprints: ReadonlyMap<string, BlueprintDef>
  shipBlueprints: ReadonlyMap<string, ShipBlueprintDef>
  galaxies: ReadonlyMap<string, GalaxyDef>
  galaxyEdges: readonly GalaxyEdgeDef[]
  anomalies: ReadonlyMap<string, AnomalyDef>
  foeShips?: ReadonlyMap<string, FoeShipDef>
  travelEvents: readonly TravelEventDef[]
  stations: ReadonlyMap<string, StationSiteDef>
  labRecipes: ReadonlyMap<string, LabRecipeDef>
  marketGoods: ReadonlyMap<string, MarketGoodDef>
  commsMessages: ReadonlyMap<string, CommsMessageDef>
  commsFactions: ReadonlyMap<string, CommsFactionDef>
  dialogues: ReadonlyMap<string, DialogueScriptDef>
  balance: BalanceConfig
  wreckGroups?: ReadonlyMap<string, WreckGroupDef>
  matterTech?: ReadonlyMap<string, MatterTechNodeDef>
  achievements?: readonly AchievementDef[]
}

export type MatterTechEffect =
  | 'whTurnMax'
  | 'whSalvageEff'
  | 'whCollectEff'
  | 'whHoldCells'
  | 'whScanCut'
  | 'whScanRadius'
  | 'signalAutoYield'
  | 'whBattleSpeed'
  | 'whResistShield'
  | 'whResistArmor'
  | 'whResistHull'
  | 'whHit'
  | 'whEvasion'
  | 'whEnemyHitDown'
  | 'whRange'
  | 'whReload'
  | 'whDamage'
  | 'whBlindReduce'
  | 'whThreatNode'
  | 'whThreatBoss'
  | 'whDroneRecovery'
  | 'whFieldRepair'
  | 'unboxTimeCut'
  | 'voidCrystalYield'
  | 'wreckMineralYield'
  | 'industryAiSlots'
  | 'voidRefineSpeed'
  | 'voidOreDrip'
  | 'fuelRecipeAdvanced'

export type MatterTechBranch = 'explore' | 'battle' | 'industry'

export interface MatterTechNodeDef {
  id: string
  name: string
  branch: MatterTechBranch
  tier: number
  effect: MatterTechEffect
  per: number
  maxLevel: number
  essence: readonly number[]
  isk: readonly number[]
  prereq?: Readonly<Record<string, number>>
  note: string
}


export type AchievementSource =
  | { kind: 'task'; taskId: string }
  | { kind: 'chain'; chainId: string; level: number }
  | { kind: 'milestone'; stat: string; target: number }
  | { kind: 'ironman' }
  | { kind: 'ironmanClosed' }

export type AchievementCategory = 'first-task' | 'chain' | 'milestone' | 'ironman'

export interface AchievementDef {
  id: string
  name: string
  note: string
  category: AchievementCategory
  pattern: string
  tone: string
  hidden?: boolean
  source: AchievementSource
}


export interface StationTierDef {
  name: string
  bill: ReadonlyArray<{ itemId: string; count: number }>
  legacyDeliveredCredit?: {
    previousUnitValues: Readonly<Record<string, number>>
    currentUnitValues: Readonly<Record<string, number>>
  }
  unlockDesc?: string
}

export interface StationSiteDef {
  id: string
  name: string
  galaxyId: string
  standingReq: number
  tiers: readonly StationTierDef[]
  introDialogueId: string | null
  doneDialogueId: string | null
  description: string
}

export interface LabRecipeDef {
  category?: 'fuel' | 'beacon' | 'accelerant'
  id: string
  name: string
  outputItemId: string
  outputUnits: number
  cycleMs: number
  materials: readonly { itemId: string; units: number }[]
  unreleased?: boolean
  requiresTech?: MatterTechEffect
}

export interface DialogueLineDef {
  speaker: string
  text: string
}

export interface DialogueScriptDef {
  id: string
  commsFactionId?: string
  commsDeptId?: string
  commsSigner?: string
  title: string
  subject?: string
  lines: readonly DialogueLineDef[]
}


export type CommsFactionAlignment = '官方' | '民间' | '中立' | '系统'

export type CommsKind = '剧情' | '提示' | '委托' | '教程'

export interface CommsDeptDef {
  id: string
  name: string
  brief: string
  kinds: readonly CommsKind[]
}

export interface CommsFactionDef {
  id: string
  name: string
  species: string
  alignment: CommsFactionAlignment
  tone: string
  glyph: string
  brief: string
  kinds: readonly CommsKind[]
  departments: readonly CommsDeptDef[]
}


export type CommsJumpPage = 'map' | 'ship' | 'fit' | 'items' | 'market' | 'industry' | 'skills' | 'comms' | 'task'

export type CommsTrigger =
  | { kind: 'industrialFleetRisk' }
  | { kind: 'start' }
  | { kind: 'firstTask'; taskId: string }
  | { kind: 'day'; days: number }
  | { kind: 'explored'; count: number }
  | { kind: 'galaxy'; galaxyId: string }
  | { kind: 'skill'; skillId: string; level: number }
  | { kind: 'isk'; amount: number }
  | { kind: 'siteBuilt'; siteId: string }
  | { kind: 'labOpened' }

  | { kind: 'lowSec' }
  | { kind: 'foeFamily'; family: FoeFamily }
  | { kind: 'foeShipSeen'; shipId: string }
  | { kind: 'blackboxSeen' }
  | { kind: 'wormholeSiege' }
  | { kind: 'wormholeNebula' }
  | { kind: 'ambushRetreat' }
  | { kind: 'standing'; factionId: string; min: number }
  | { kind: 'shipBuilt' }

export interface CommsReplyDef {
  id: string
  label: string
}


export interface CommsMessageDef {
  id: string
  factionId: string
  deptId?: string
  signer?: string
  kind: CommsKind
  subject: string
  body: readonly string[]
  highlight?: readonly string[]
  holdWhenBusy?: boolean
  trigger: CommsTrigger
  hint?: { text: string; page: CommsJumpPage; tab?: string; taskTab?: string; shipTab?: string; skillBranch?: string; action?: string }
  replies?: readonly CommsReplyDef[]
  popup?: boolean
  unreleased?: boolean
}

export interface CommsEntryView {
  id: string
  source: 'message' | 'dialogue'
  from: string
  factionName: string
  alignment: CommsFactionAlignment | ''
  kind: CommsKind | ''
  signer?: string
  fromBrief?: string
  tone: string
  glyph: string
  subject: string
  paragraphs: readonly string[]
  highlight?: readonly string[]
  deliveredAtGameMs: number
  read: boolean
  hint?: { text: string; page?: CommsJumpPage; tab?: string; taskTab?: string; shipTab?: string; skillBranch?: string }
  replies?: readonly CommsReplyDef[]
  subjectId?: string
  bodyIds?: readonly string[]
  textParams?: Readonly<Record<string, string | number>>
  action?: string
  rewards?: readonly CommsRewardLine[]
}

export interface CommsInstanceEntry {
  id: string
  factionId: string
  deptId?: string
  kind?: CommsKind
  atGameMs: number
  subject: string
  subjectId: string
  paragraphs: readonly string[]
  bodyIds: readonly string[]
  params?: Readonly<Record<string, string | number>>
  hint?: { text: string; page?: CommsJumpPage; action?: string }
  rewards?: readonly CommsRewardLine[]
}

export interface CommsRewardLine {
  itemId?: string
  isk?: number
  qty?: number
}

export { type DamageType, type DamageResists, type DroneDefense, type DroneClass, type FoeTactic, type FoeTargetingMode, type FoeFamily } from './combat/types/damage'
export { type FoeMountId, type FoeMountDef, type FoeSupportBranch } from './combat/types/mounts'
export { type BattleBalance } from './combat/types/balance'
export { type FoeShipDef, type FoeDroneDef, type FoeDroneSlot, type FoeShipSlot, type FoeReinforceTrigger } from './combat/types/foes'
