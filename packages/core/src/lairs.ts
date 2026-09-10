/**
 * 赏金任务 · 敌人窝点（2026-09-10 船长定：任务中心「赏金任务」的目标）。
 *
 * 设计（船长口径）：
 * - 赏金任务不是"再刷一遍普通悬赏"，而是**难度更高的特色敌人窝点**：以该星系的主题悬赏为底
 *   派生强化（威胁 ×档位系数、外加波次与僚机），敌人类型与该星系特色一致；
 * - **最高难度由玩家声望决定**：声望 0~5 只出「外围窝点」、6~10「核心窝点」、11+「深层窝点」，
 *   且只有「主题悬赏声望门槛 ≤ 当前声望」的星系会刷出任务；
 * - 窝点**只作为赏金任务目标存在**（不入星图常驻悬赏列表、不入档：任务里只记「主题悬赏 id + 档位」，
 *   开战时现算强化卡）；
 * - 三档称呼按**敌族**分别定制（见 FOE_LAIR_TIERS；船长 2026-09-10 词表定稿），
 *   窝点名 = 卡上的核心词（`AnomalyDef.lairCore`）+ 档位词；单卡可用 `lairTierNames` 覆盖；
 * - 三档都是"地点"语义（藏货据点 / 隐蔽船坞 / 隐秘陵寝…）——不写"主城/本部"这类会把整族一锅端的说法。
 *
 * 数值（威胁系数、波次占比、僚机增量、酬金比例、稀有残骸件数）都是**可调常量**，
 * 集中在文件顶部，等船长定数后改这里一处即可。
 */
import type { AnomalyDef, FoeFamily } from './types'

/** 窝点档位：1 外围 / 2 核心 / 3 深层 */
export type LairTier = 1 | 2 | 3

/* ═══════════ 可调常量（待船长定数值；改动只动这里） ═══════════ */

/** 档位威胁系数：主题悬赏威胁 × 本值 = 窝点威胁 */
export const LAIR_THREAT_MUL: Record<LairTier, number> = { 1: 1.3, 2: 1.6, 3: 2.0 }
/**
 * 赏金倍率（2026-09-10 船长定：2/4/8）：窝点奖金 = 主题悬赏奖金 × 本值。
 * **只管钱、不管难度**——威胁/波次/僚机仍走 LAIR_THREAT_MUL（难度不动），
 * 三档奖金差距拉开成 2/4/8 倍，一档也明确高于常驻悬赏原值。
 */
export const LAIR_REWARD_MUL: Record<LairTier, number> = { 1: 2, 2: 4, 3: 8 }
/** 僚机增量（在主题悬赏基础上加；总数上限沿用引擎的 0~2） */
export const LAIR_ESCORT_BONUS: Record<LairTier, number> = { 1: 0, 2: 1, 3: 1 }
/**
 * 档位波次（**威胁大头后置**：首波试探、末波才是硬骨头；船长 2026-09-10 定）。
 * tier 1 = 沿用主题悬赏原有波次；tier 2 = 双波 0.35/0.65；tier 3 = 三波 0.2/0.3/0.5。
 */
export const LAIR_WAVES: Record<LairTier, ReadonlyArray<{ units: number; hpShare: number }> | null> = {
  1: null,
  2: [
    { units: 1, hpShare: 0.35 },
    { units: 1, hpShare: 0.65 },
  ],
  3: [
    { units: 1, hpShare: 0.2 },
    { units: 1, hpShare: 0.3 },
    { units: 1, hpShare: 0.5 },
  ],
}
/** 声望 → 档位门槛：**已退役（2026-09-10 船长定）**——档位改由"日板席位"决定
 *  （中安席位 = 外围/核心、低安席位 = 核心/深层，每天三档必现），不再随声望封顶；
 *  接取门槛改由**卡自身声望要求**（`AnomalyDef.standingReq`）把关。 */
/** 赏金任务酬金 = 窝点基础奖金 × 本比例（跟强度递增；刷出时锁定） */
export const LAIR_TASK_REWARD_MUL: Record<LairTier, number> = { 1: 0.5, 2: 0.75, 3: 1.0 }
/** 击败窝点 → 该星系稀有残骸 +本件数（随难度递增） */
export const LAIR_RARE_WRECK_GAIN: Record<LairTier, number> = { 1: 1, 2: 2, 3: 3 }

/* ═══════════ 敌对派系活跃（2026-09-10 船长定：每天选中一个中安/低安星系） ═══════════ */

/**
 * 派系活跃 · 目标悬赏的奖金加成（2026-09-10 船长定：+10%）。
 * **只作用于该星系的常驻悬赏（普通悬赏）**——与赏金任务的窝点无关（船长同日明确）；
 * 该星系当天从常规赏金席位抽签池里剔除（避免同星系两条）。
 */
export const FACTION_BOUNTY_REWARD_MUL = 1.1
/** 派系活跃 · 目标悬赏的威胁加成（+10%）：威胁驱动敌舰属性（血量/火力/速度/射程），不是纯数字 */
export const FACTION_BOUNTY_THREAT_MUL = 1.1
/**
 * 派系活跃 · 胜利后掉落稀有残骸的概率（**船长 2026-09-10 定：10%**）。
 * 口径：该目标当天**可反复刷**（不像赏金任务那样打完下板），所以概率按"每天平均能刷几次"审算——
 * 见 `npm run faction:audit`（当前均值 ≈3.5 趟/时 → 4 小时 ≈14 趟 → P=10% 期望 ≈1.4 件/天）。
 * 命中一次掉 `FACTION_RARE_DROP_COUNT` 件，进该星系残骸场（打捞必得，与窝点同一条链路）。
 */
export const FACTION_RARE_DROP_CHANCE = 0.1
/** 派系活跃 · 命中一次掉几件稀有残骸 */
export const FACTION_RARE_DROP_COUNT = 1

/** 派系活跃派生卡：只改威胁（×1.1），其余继承——名字沿用原悬赏名，界面另挂「派系活跃」徽标 */
export function factionAnomalyOf(anomaly: AnomalyDef): AnomalyDef {
  return { ...anomaly, threat: Math.round(anomaly.threat * FACTION_BOUNTY_THREAT_MUL) }
}

/** 派系活跃目标的基础奖金 = 主题悬赏奖金 ×1.1（胜利结算沿用既有浮动与技能系数） */
export function factionBaseRewardIsk(anomaly: AnomalyDef): number {
  return Math.round(anomaly.rewardIsk * FACTION_BOUNTY_REWARD_MUL)
}

/* ═══════════ 名称（船长 2026-09-10 词表定稿） ═══════════ */

/** 敌族 → 三档称呼（[一档, 二档, 三档]；二三档是"地点"语义） */
export const FOE_LAIR_TIERS: Record<FoeFamily, readonly [string, string, string]> = {
  A: ['小头目', '藏货据点', '隐蔽船坞'], // 海盗舰系
  B: ['小队头目', '拾荒营地', '隐蔽拆解场'], // 武装拾荒者【已停用：2026-09-10 船长定取消 B 族窝点/赏金任务，词表留档】
  C: ['虫群头目', '虫巢', '隐秘孵化地'], // 异形生物
  D: ['守卫舰长', '残舰泊地', '隐秘陵寝'], // 守墓古舰
  E: ['警戒机群', '核心舱段', '深层机库'], // 泰坦巨构
  F: ['巡逻队长', '据点', '隐蔽据点'], // 制式巡逻（当前无窝点成员，留词表备用）
  G: ['残兵头目', '聚落营地', '藏匿地'], // 烬火流亡
}
/** 未登记敌族时的兜底档位词 */
const LAIR_TIER_FALLBACK: readonly [string, string, string] = ['头目', '据点', '秘密据点']

/* ═══════════ 敌族专属装备（2026-09-10 船长认可草案；数值待定） ═══════════ */

/**
 * 敌族 → 专属装备池（稀有残骸·高级箱额外掉落优先掷此池）。
 * 只在**打赢窝点 → 捞回稀有残骸 → 精炼炉开高级箱**这条链路上产出：无蓝图、不上市场、不入常规掉落。
 * 卡级 `AnomalyDef.lairGear` 可覆盖之。
 * - **B 族（武装拾荒者）留空**：2026-09-10 船长定取消 B 族窝点/赏金任务，专属件（拾荒者拆解臂）一并撤下；
 * - **F 族（制式巡逻）留空**：当前只有隐藏遭遇模板、没有窝点成员，故无专属件。
 */
export const FOE_LAIR_GEAR: Record<FoeFamily, readonly string[]> = {
  // A 族（海盗）：2026-09-10 船长逐件过审（三件齐）——泼弹近战炮 / 贴脸导弹巢 / 搬赃舱
  A: ['mod-lair-turret-a', 'mod-lair-missile-a', 'mod-lair-cargo-a'],
  B: [], // 【已停用】原「拾荒者拆解臂」随 B 族窝点取消撤下
  C: ['mod-lair-armor-c'], // 生体甲壳板（另两件待逐件过审）
  D: ['mod-lair-shield-d'], // 陵墓护盾阵列（另两件待逐件过审）
  E: ['mod-lair-turret-e'], // 巨构残骸炮（另两件待逐件过审）
  F: [],
  G: ['mod-lair-drone-rack-g'], // 流亡蜂群巢（另两件待逐件过审）
}

/** 该卡的专属装备池（卡级优先，其次按敌族；都没有 = 空池） */
export function lairGearOf(anomaly: AnomalyDef): readonly string[] {
  if (anomaly.lairGear && anomaly.lairGear.length > 0) return anomaly.lairGear
  return anomaly.foeFamily ? FOE_LAIR_GEAR[anomaly.foeFamily] : []
}

/**
 * 该卡是否具备窝点派生能力（非隐藏 + 有核心词）——**只有名字/派生能力，不含"是否派发"的判断**。
 * 稀有残骸物品的注册范围按它走：包含已停用的 B 族，好让旧档里可能已存在的 B 族稀有残骸
 * 仍能被识别、进精炼炉开高级箱（只是不再新增）。
 */
export function hasLairCore(anomaly: AnomalyDef): boolean {
  if (anomaly.hidden === true) return false
  return (anomaly.lairCore ?? '') !== ''
}

/**
 * 该卡能否作为窝点目标（= 赏金任务主体）。
 * - 有核心词、非隐藏、奖金 > 0（教学卡「演习场讨伐令」刻意不设核心词，故不入池）；
 * - **B 族（武装拾荒者）排除**：2026-09-10 船长定取消 B 族相关的残骸与赏金任务。
 */
export function isLairCandidate(anomaly: AnomalyDef): boolean {
  if (!hasLairCore(anomaly)) return false
  if (anomaly.foeFamily === 'B') return false
  return anomaly.rewardIsk > 0
}

/** 窝点名的核心词（无 = 不可作窝点目标） */
export function lairCoreOf(anomaly: AnomalyDef): string {
  return anomaly.lairCore ?? anomaly.name
}

/** 档位称呼词（卡级 `lairTierNames` 覆盖族级词表） */
export function lairTierWordOf(anomaly: AnomalyDef, tier: LairTier): string {
  const table = anomaly.lairTierNames ?? (anomaly.foeFamily ? FOE_LAIR_TIERS[anomaly.foeFamily] : undefined) ?? LAIR_TIER_FALLBACK
  return table[tier - 1] ?? LAIR_TIER_FALLBACK[tier - 1]!
}

/** 窝点显示名：核心词 + 档位词（如「星髓虫群·隐秘孵化地」） */
export function lairNameOf(anomaly: AnomalyDef, tier: LairTier): string {
  return `${lairCoreOf(anomaly)}·${lairTierWordOf(anomaly, tier)}`
}

/** 窝点基础奖金 = 主题悬赏奖金 ×**赏金倍率**（2/4/8；胜利结算沿用既有浮动与技能系数） */
export function lairBaseRewardIsk(anomaly: AnomalyDef, tier: LairTier): number {
  return Math.round(anomaly.rewardIsk * LAIR_REWARD_MUL[tier])
}

/** 赏金任务酬金（刷出时锁定）= 窝点基础奖金 × 档位酬金比例 */
export function lairTaskRewardIsk(anomaly: AnomalyDef, tier: LairTier): number {
  return Math.round(lairBaseRewardIsk(anomaly, tier) * LAIR_TASK_REWARD_MUL[tier])
}

/**
 * 派生窝点卡（开战/结算/展示统一走这里，数据文件不改）：改威胁、加僚机与波次、换显示名。
 * 其余字段（战术性格、血型、伤害配比、命中、抗性缺口、回收池…）全部继承主题悬赏 —— 窝点与
 * 该星系特色敌人同源。**奖金不在这里改**：卡上的 `rewardIsk` 仍是主题悬赏原值，
 * 窝点奖金一律经 `lairBaseRewardIsk`（×赏金倍率 2/4/8）取，避免同一字段两种口径。
 */
export function lairAnomalyOf(anomaly: AnomalyDef, tier: LairTier): AnomalyDef {
  const waves = LAIR_WAVES[tier]
  return {
    ...anomaly,
    name: lairNameOf(anomaly, tier),
    threat: Math.round(anomaly.threat * LAIR_THREAT_MUL[tier]),
    escorts: Math.min(2, (anomaly.escorts ?? 0) + LAIR_ESCORT_BONUS[tier]),
    ...(waves ? { waves } : {}),
  }
}

/** 档位中文（界面徽标与日志用） */
export const LAIR_TIER_LABELS: Record<LairTier, string> = { 1: '外围', 2: '核心', 3: '深层' }
