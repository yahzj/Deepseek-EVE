/**
 * 赏金任务 · 敌人窝点（2026-09-10 船长定：任务中心「赏金任务」的目标）。
 *
 * 设计（船长口径）：
 * - 赏金任务不是"再刷一遍普通悬赏"，而是**难度更高的特色敌人窝点**：以该星系的主题悬赏为底
 *   派生强化（威胁 ×档位系数、外加波次与僚机），敌人类型与该星系特色一致；
 * - **档位由"地图级别"封顶**（2026-09-10 船长定）：每张窝点卡标一个 `lairLevel`（1/2/3），
 *   它是该地图的**档位上限**——1 级图只出外围、2 级图到核心、3 级图全档；族内越低级的地图
 *   出高档位赏金的概率越低。旧规则（档位随玩家声望封顶）已退役，且**每天三档各一张的保底已取消**；
 *   接取门槛仍看卡自身声望要求（`AnomalyDef.standingReq`）；
 * - 窝点**只作为赏金任务目标存在**（不入星图常驻悬赏列表、不入档：任务里只记「主题悬赏 id + 档位」，
 *   开战时现算强化卡）；
 * - 三档称呼按**敌族**分别定制（见 FOE_LAIR_TIERS；船长 2026-09-10 词表定稿），
 *   窝点名 = 卡上的核心词（`AnomalyDef.lairCore`）+ 档位词；单卡可用 `lairTierNames` 覆盖；
 * - 三档都是"地点"语义（藏货据点 / 隐蔽船坞 / 隐秘陵寝…）——不写"主城/本部"这类会把整族一锅端的说法。
 *
 * 数值（威胁系数、波次占比、僚机增量、酬金比例、稀有残骸件数）都是**可调常量**，
 * 集中在文件顶部，等船长定数后改这里一处即可。
 */
import type { AnomalyDef, DamageType, FoeFamily } from './types'
import type { GameState } from './state'
/**
 * ⚠ **运行时 import**（2026-09-24 加）：为了把"当前实际掉落率"收成**同一个口径**。
 * 依赖链 = `lairs` → `tuning` → `ironman`，**无环**（`tuning` 只 type-import `state`，
 * `ironman` 不 import 任何运行时模块）⇒ 不会重蹈 2026-09-24 那次
 * 「`combat` ↔ `wormholeFoes` 循环依赖、只在 CJS 转译下顶层求值炸 TDZ」的坑。
 * 另：本文件的两个新函数都在**函数体内**调用它（不是模块顶层常量）⇒ 即便将来出现环也不会顶层求值。
 */
import { rareDropRateMulOf } from './tuning'

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
 *  （席位地点的**地图级别**决定档位上限，见 lairLevelOf；不再随声望封顶）；
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
 * 派系活跃 · 胜利后掉落稀有残骸的概率（**船长 2026-09-20 改定：30%**）。
 *
 * ⚠ 2026-09-10 的旧口径「5%（同日先由 10% 下调）」**已作废**，连它的审计理由一起改写：
 * 旧理由要求派系活跃"只是顺手多一次摸奖、不与当日 5 席赏金（8~11 件/天）争主供给"；
 * 船长 2026-09-20 拍板提高出率（原话：「**敌对派系活跃的稀有残骸出率提高到30%，保底提高到每10次必出一个**」，
 * 冲突说明后选「甲：照此改并接受派系活跃成为主力供给来源」）⇒ **现口径 = 派系活跃与当日 5 席赏金同级**。
 *
 * 现行读数（`npm run faction:audit`，均值 ≈3.5 趟/时）：30% + 保底 10 ⇒ **实际 ≈30.9%/趟**、
 * 4 小时刷 ≈4.3 件 · 8 小时刷 ≈8.7 件 —— 稀有残骸日供给由 ~10~13 件抬到 ~19~22 件。
 * 命中一次掉 `FACTION_RARE_DROP_COUNT` 件，进该星系残骸场（打捞必得，与窝点同一条链路）。
 */
export const FACTION_RARE_DROP_CHANCE = 0.3
/** 派系活跃 · 命中一次掉几件稀有残骸 */
export const FACTION_RARE_DROP_COUNT = 1
/**
 * 派系活跃 · **稀有残骸保底**（船长 2026-09-11：「有玩家反馈，刷了一天没有看到稀有残骸掉落……加一个
 * 每 20 次必定掉的保底」→ 口径裁决「**甲：只保底派系活跃那条掷骰链**」；
 * **2026-09-20 船长收紧为「每 10 次必出一个」**）。
 *
 * 口径：**连续 9 次掷骰未出 → 第 10 次必掉**（标准保底口径；此前是 19/20）。计数只走**派系活跃掷骰链**
 * （＝当日选中星系的悬赏胜利，`exp.factionActive === true`）——别的星系本来就不掷骰、不计数；
 * **任何稀有残骸入库都会清零**（含窝点必掉的 1~3 件，见 `salvage.injectRareWreck` 单点）。
 * 计数器随档保留（`GameState.rareWreckDryStreak`，可选字段、零迁移）。
 *
 * 背景读数：5% + 保底 20 时 300 趟实测标称 5%、**最长连续空手 64 趟**（按 3.5 趟/时 ≈18 小时，
 * "刷一整天零掉落"真会发生）；收到 30% + 保底 10 后空手尾巴封在 **9 趟**（≈2.6 小时）。
 */
export const FACTION_RARE_DROP_PITY_ROLLS = 10

/**
 * **保底生效后的实际单趟期望掉落率**（解析式，供工具/体检/界面读数打印，避免各处自己算漂移）：
 * 一个循环 = 首次命中或第 N 次强制命中，故
 * `E[循环趟数] = Σ_{k=1..N−1} k·p·(1−p)^(k−1) + N·(1−p)^(N−1)`，实际率 = `1 / E[循环趟数]`。
 * 现值：p = 30% · N = 10 → E ≈ 3.24 趟 → **≈30.9%/趟**（旧值 5%/20 ⇒ ≈7.79%/趟，已作废）。
 *
 * @param rate **单趟自然命中概率**（默认 = 裸常量，即"无任何加成"的标称值）。
 *   要读**当前档位**的实际值，请传 `factionRareDropChanceOf(state)`（含限时倍率与铁人）。
 *   ⚠ **2026-09-24 起才有这个参数**（船长报障「铁人模式的残骸掉率加成似乎没应用到？」）——
 *   此前它**写死裸常量**，于是工具与卡面都印 30%，**把乘区挡在读数之外**（机制本身一直是对的）。
 */
export function factionRareDropEffectiveRate(rate: number = FACTION_RARE_DROP_CHANCE): number {
  const p = Math.min(1, Math.max(0, rate))
  const n = FACTION_RARE_DROP_PITY_ROLLS
  let expected = 0
  for (let k = 1; k < n; k += 1) expected += k * p * Math.pow(1 - p, k - 1)
  expected += n * Math.pow(1 - p, n - 1) // 第 n 趟必掉（含本就自然命中的那部分）
  return expected > 0 ? 1 / expected : 1
}

/**
 * **当前档位下的单趟自然命中概率**（含**全部乘区**：限时倍率 `rareWreckRate` × 铁人 ×1.2），夹 0~1。
 *
 * **与结算是同一处口径** —— `expedition.ts` 那条派系活跃掷骰直接调它，界面读数也调它
 * ⇒ 两边**不可能漂移**（这是本仓反复强调的"读数与结算同一函数"）。
 */
export function factionRareDropChanceOf(
  state: Pick<GameState, 'wallMs' | 'ironman'> | null | undefined,
): number {
  return Math.min(1, FACTION_RARE_DROP_CHANCE * rareDropRateMulOf(state))
}

/**
 * **界面/工具读数：当前档位下的「实际」掉落率** = 自然概率（含乘区）再过一遍保底折算。
 * 普通档 ≈30.9% · 铁人档 ≈36.4%（差 +5.5pp）。
 */
export function factionRareDropRateOf(
  state: Pick<GameState, 'wallMs' | 'ironman'> | null | undefined,
): number {
  return factionRareDropEffectiveRate(factionRareDropChanceOf(state))
}

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
  F: ['巡逻队长', '据点', '隐蔽据点'], // 制式巡逻【已废弃·留档：2026-09-11 船长「废弃F族，将F族融合进A族」，字母位保留为空位；本行不删，防旧内容表/旧导出带 'F' 时解析出错】
  G: ['残兵头目', '聚落营地', '藏匿地'], // 鱿烬亡军
  // H 族（墨潮帮 · 2026-09-24 船长定名）：海盗变种/叛出分支 ⇒ 词表沿用海盗腔（窝点=藏货/船坞那一套）
  H: ['堂口头目', '私货仓', '隐蔽坞'], // 墨潮帮
}
/** 未登记敌族时的兜底档位词 */
const LAIR_TIER_FALLBACK: readonly [string, string, string] = ['头目', '据点', '秘密据点']

/* ═══════════ 敌族专属装备（2026-09-10 船长认可草案；数值待定） ═══════════ */

/**
 * 敌族 → 专属装备池（稀有残骸·高级箱额外掉落优先掷此池）。
 * 只在**打赢窝点 → 捞回稀有残骸 → 精炼炉开高级箱**这条链路上产出：
 * **2026-09-14 起市场有"只收不卖"行**（玩家可挂卖，市场不出售现货）——原「不上市场」改判；仍无常规掉落。
 * 卡级 `AnomalyDef.lairGear` 可覆盖之。
 * **池内元素可以是模块 id / 物品 id / 蓝图 id**（2026-09-10 船长：G 族第一件改为专属无人机"物品"；
 * 2026-09-14 船长：「无人机也出蓝图，专属无人机出一次性蓝图」⇒ G 族再收一张 `bp-lair-g-drone`）——
 * 取件时按 `ctx.modules` / `ctx.items` / `ctx.blueprints` 判别：模块进装备库、无人机物品进物品仓库、
 * 蓝图进蓝图书架（见 `rollRareBoxExtra` 的三分支）。
 * - **B 族（武装拾荒者）留空**：2026-09-10 船长定取消 B 族窝点/赏金任务，专属件（拾荒者拆解臂）一并撤下；
 * - **F 族（制式巡逻）【已废弃·留档】**：2026-09-11 船长裁定「废弃F族，将F族融合进A族」——
 *   该族从未有窝点成员（只有四张隐藏遭遇模板，且已显式登记 A 族），故专属件池**恒为空**；
 *   字母位保留为空位，本行留档不删（防旧内容表/旧导出带 `'F'` 时解析出错）。
 */
export const FOE_LAIR_GEAR: Record<FoeFamily, readonly string[]> = {
  // A 族（海盗）：2026-09-10 船长逐件过审（三件齐）——泼弹近战炮 / 贴脸导弹巢 / 搬赃舱
  A: ['mod-lair-turret-a', 'mod-lair-missile-a', 'mod-lair-cargo-a'],
  B: [], // 【已停用】原「拾荒者拆解臂」随 B 族窝点取消撤下
  C: ['mod-lair-armor-c', 'mod-lair-dc-c', 'mod-lair-laser-c'], // 生体甲壳板 / 生体损管腔 / 酸液喷吐器（船长逐件过审）
  D: ['mod-lair-shield-d', 'mod-lair-turret-d', 'mod-lair-armor-d'], // 陵墓护盾阵列 / 守墓者长炮 / 陵寝装甲层（最强敌族；2026-09-10 船长定削：强度略高于 MK3，靠必中远程炮与三系全能盾立身——原「对标异星档」口径作废）
  E: ['mod-lair-turret-e', 'mod-lair-hangar-e', 'mod-lair-frame-e'], // 巨构残骸炮 / 深层机库 / 巨构骨架（2026-09-10 船长逐件过审：档位「略高于 MK3」、仍低于 D）
  F: [],
  // G 族（鱿烬亡军）：2026-09-10 船长——第一件由机库模块「鱿蜂群巢」改为**专属侦查无人机「鱿蜂无人机」**
  // （一次掉 ×10 架；无人机是消耗品，打光后再刷可补），另两件为无人机导控 / 中继天线；
  // 2026-09-14 追加**鱿蜂无人机的一次性图纸**（`bp-lair-g-drone`：一次开工出 50 架）
  G: ['drone-exile-bee', 'mod-lair-drone-tac-g', 'mod-lair-drone-relay-g', 'bp-lair-g-drone'],
  // H 族（墨潮帮 · 2026-09-26 起**已有产出面**）：船长当日定三件 —— **射程压制（墨潮电子舱）·
  // 捕获网（墨潮捕获网）· 重袭机（墨潮重袭无人机）**。产出链路 = H 族稀有残骸（`wreck-rare-h-hi`）
  // 开高级箱 ⇒ 本池（5%／箱，集齐前不重复）；同批**打开 H 族残骸回收**（原先"等 H 势力装备"而关着）。
  // 原注释（2026-09-24 留档）：H 曾只作为**周末入侵**的对手，星图侧没有墨潮帮悬赏/窝点卡 ⇒ 池恒空。
  H: ['mod-lair-ecm-h', 'mod-lair-web-h', 'drone-ink-heavy'],
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
 * - 有核心词、非隐藏、奖金 > 0（教学卡「演习场驱逐令」刻意不设核心词，故不入池）；
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

/* ═══════════ 窝点地图级别（2026-09-10 船长定：族内越低级的地图越出不了高档位） ═══════════ */

/** 地图级别的兜底值 = 3（不限制）；只用于"漏标不误伤"，content-check 强制每张窝点候选卡显式标级 */
export const LAIR_LEVEL_DEFAULT: LairTier = 3

/**
 * 该卡的**档位上限**（= 地图级别）：1 = 只能出外围、2 = 到核心、3 = 全档。
 * 语义是**硬封顶**（不是加权）：日板发档时在该卡 `[1..lairLevel]` 内均匀随机，
 * 故"越低级的图出高档位赏金的概率越低"，1 级图永远出不了核心/深层。
 */
export function lairLevelOf(anomaly: AnomalyDef): LairTier {
  return anomaly.lairLevel ?? LAIR_LEVEL_DEFAULT
}

/** 该卡在此地图级别下**可能**出现的档位集合（外围 → 深层，升序） */
export function lairTiersOf(anomaly: AnomalyDef): LairTier[] {
  const max = lairLevelOf(anomaly)
  const out: LairTier[] = []
  for (let t = 1; t <= max; t += 1) out.push(t as LairTier)
  return out
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
 * 窝点混伤（2026-09-10 船长：「给所有赏金任务的敌人添加额外攻击的副伤害类型，让其攻击造成混伤
 * （主类型占大部分），并需要在任务中告知玩家」）：
 * **只有窝点（赏金任务）的敌人**打混伤——常驻悬赏与低安遇袭维持纯系（船长指定范围）。
 * 配比 = 主 **60%** / 副 **40%**（船长定），主系永远沿用主题卡原有主系、**不许变**；
 * 敌**总伤不变**（只是构成变化）。副系按**族签名优先序**取第一个"不与主系相同"的系。
 */
export const LAIR_SUB_DMG_SHARE = 0.4

/**
 * **逐族窝点副系份额覆写**（2026-09-11 船长：「**E 族单独调整，包括 E 族赏金任务的伤害比例**」）。
 *
 * ⚠ **2026-09-19 起本表为空**（船长「**所有E族的默认伤害比改为爆炸60%，动能40%**」）：E 族不再走
 * 「窝点 = 5:5」那条族级特例 ⇒ **与其它族一样走 `LAIR_SUB_DMG_SHARE`（全局主 60 / 副 40）**，
 * 派生窝点的构成与主题卡**逐值一致**（爆炸 60 : 动能 40）。表本身保留：将来若要给某个族单独定
 * 窝点份额，仍从这里覆写（`?? 全局` 的读取链与体检分支都不用再动）。
 */
export const LAIR_SUB_DMG_SHARE_BY_FAMILY: Partial<Record<FoeFamily, number>> = {}

/** 敌族签名副伤害类型（优先序：撞主系则顺延到下一个） */
export const FOE_SUB_DMG: Record<FoeFamily, readonly DamageType[]> = {
  A: ['kinetic', 'explosive', 'plasma'], // 海盗：缴获改装的实弹/破片弹头
  B: ['kinetic', 'explosive', 'plasma'], // 武装拾荒者【已停用，留表兜底】
  C: ['explosive', 'plasma', 'kinetic'], // 异形：酸液与生物爆破
  D: ['plasma', 'kinetic', 'explosive'], // 守墓古舰：古舰的能量副炮
  // E 族：**爆炸 60 / 动能 40**（2026-09-19 船长「所有E族的默认伤害比改为爆炸60%，动能40%」；
  // 主系已由动能变**爆炸** ⇒ 副系取签名序里第一个 ≠ 主系者 = **动能**（旧序以爆炸打头，会让副系落到等离子）
  E: ['kinetic', 'explosive', 'plasma'], // 泰坦巨构：巨构能量核心 + 实弹残炮
  F: ['kinetic', 'explosive', 'plasma'], // 制式巡逻【已废弃·留档：2026-09-11 并入 A 族；与 A 表同序，故当年"缺族回落到 A"零差异】
  G: ['explosive', 'kinetic', 'plasma'], // 鱿烬亡军：拼装火药与土制弹头
  // H 族（墨潮帮 · 2026-09-24）：与 A 族同序（缴获改装的实弹/破片弹头）——它是海盗的变种分支，
  // 弹药来源同一条链；主系仍是动能 ⇒ 副系落到爆炸
  H: ['kinetic', 'explosive', 'plasma'],
}

/**
 * 派生窝点卡（开战/结算/展示统一走这里，数据文件不改）：改威胁、加僚机与波次、换显示名，
 * 并把敌人火力改成**混伤**（主 60% / 副 40%，§`LAIR_SUB_DMG_SHARE`；逐族覆写表
 * §`LAIR_SUB_DMG_SHARE_BY_FAMILY` **2026-09-19 起为空**——E 族那条 5:5 特例随船长「所有E族的默认
 * 伤害比改为爆炸60%，动能40%」作废，全族一律 6:4）。
 * 其余字段（战术性格、血型、命中、抗性缺口、回收池…）全部继承主题悬赏 —— 窝点与该星系特色敌人同源。
 * **奖金不在这里改**：卡上的 `rewardIsk` 仍是主题悬赏原值，窝点奖金一律经 `lairBaseRewardIsk`
 * （×赏金倍率 2/4/8）取，避免同一字段两种口径。
 *
 * **舰级路径（`anomaly.ships` 有值）的派生缩放（2026-09-11 船长裁决④「按甲处理」）**：
 * 旧路径靠"威胁 → 血/火力曲线"自动变强；**舰级路径是绝对值，不会自己涨** ⇒ 派生时
 * **按「原威胁 → 派生威胁」的比例**（= `LAIR_THREAT_MUL[tier]` 的取整实现）**同乘该卡每个条目的
 * `hpMul` 与 `dmgMul`**：血量与火力一起随档位抬，保住「威胁 = 战力标尺」的语义，
 * 也让窝点维持"深层比外围硬"的终局挑战意义（单发/射程/编成/战术一律不动）。
 * ⚠ **舰级路径派生卡不套 `LAIR_WAVES`**：那张波表按"每波几队"描述**旧路径**的编队，
 * 而舰级路径的编队由 `slot.wave` 决定（**2026-09-11 起：边境/碎晶/信标 三张已按船长裁定显式分配
 * `wave: 0/1` 两波**，其余舰级路径卡仍在 `wave: 0`）⇒ 直接套用会让第 2/3 波
 * **刷出 0 个单位**（探针实测）。故舰级路径的窝点**不套旧波表**（每波 ≥ 1 单位、波次按 `slot.wave` 表达）。
 */
export function lairAnomalyOf(anomaly: AnomalyDef, tier: LairTier): AnomalyDef {
  const waves = LAIR_WAVES[tier]
  const main = foeMainDamageTypeOf(anomaly)
  const sub = subDamageTypeOf(anomaly, main)
  // 副系份额：**逐族覆写**（`LAIR_SUB_DMG_SHARE_BY_FAMILY`，2026-09-19 起空表）?? 全局 6:4
  const subShare =
    (anomaly.foeFamily ? LAIR_SUB_DMG_SHARE_BY_FAMILY[anomaly.foeFamily] : undefined) ??
    LAIR_SUB_DMG_SHARE
  const mainWeight = Math.round((1 - subShare) * 10)
  const subWeight = Math.round(subShare * 10)
  const shipSlots = anomaly.ships
  const isShipPath = !!shipSlots && shipSlots.length > 0
  /** 派生缩放比例 = 派生威胁 ÷ 原威胁（与 `threat` 字段同源，故口径天然一致） */
  const tierMul = Math.max(1, anomaly.threat)
  const scale = Math.round(anomaly.threat * LAIR_THREAT_MUL[tier]) / tierMul
  return {
    ...anomaly,
    name: lairNameOf(anomaly, tier),
    threat: Math.round(anomaly.threat * LAIR_THREAT_MUL[tier]),
    // 僚机加成本就是**旧路径**的编队口径（舰级路径的编成由 `ships` 全权决定）⇒ 舰级路径不叠加
    escorts: isShipPath ? (anomaly.escorts ?? 0) : Math.min(2, (anomaly.escorts ?? 0) + LAIR_ESCORT_BONUS[tier]),
    ...(isShipPath
      ? {
          ships: shipSlots!.map((s) => ({
            ...s,
            hpMul: (s.hpMul ?? 1) * scale,
            dmgMul: (s.dmgMul ?? 1) * scale,
            // **总火力锚点也要随档位放大**（2026-09-12）：锚点是"该条目的实收总单发"，
            // 与 `dmgMul` 同属"卡面绝对值"这一层 ⇒ 派生时同乘 `scale`。漏了它会让
            // 写了锚点的卡在窝点里**火力不随档位涨**（血涨火力不涨）。
            ...(s.firepowerAnchor !== undefined
              ? { firepowerAnchor: Math.max(1, Math.round(s.firepowerAnchor * scale)) }
              : {}),
          })),
        }
      : {}),
    ...(waves && !isShipPath ? { waves } : {}),
    // 混伤：窝点用 **6:4**（比常驻悬赏的 8:2 更"混"——窝点本就是更硬的特色敌人）；
    // **2026-09-19 起全族一律 6:4**（E 族那条 5:5 族级特例随船长「所有E族…60/40」作废，
    // `LAIR_SUB_DMG_SHARE_BY_FAMILY` 现为空表）；
    // 显式两系权重即开启混伤（引擎按"正权重键 ≥ 2 系"判定，见 combat.foeDamageComposition）；
    // 主系与主题卡一致（派生态不许改敌人主伤害类型）
    dmgMix: { [main]: mainWeight, [sub]: subWeight },
  }
}

/** 主题卡的**主伤害类型**（= dmgMix 最高权重；正权重键才参战、未写 = 动能，与 combat 同源口径） */
export function foeMainDamageTypeOf(anomaly: AnomalyDef): DamageType {
  let best: DamageType = 'kinetic'
  let bestW = 0
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const w = anomaly.dmgMix?.[t] ?? 0
    if (w > bestW) {
      bestW = w
      best = t
    }
  }
  return best
}

/** 窝点副伤害类型：族签名优先序里第一个 ≠ 主系的系（族未登记则按兜底序） */
export function subDamageTypeOf(anomaly: AnomalyDef, main: DamageType = foeMainDamageTypeOf(anomaly)): DamageType {
  const seq = (anomaly.foeFamily ? FOE_SUB_DMG[anomaly.foeFamily] : undefined) ?? FOE_SUB_DMG.A
  return seq.find((t) => t !== main) ?? 'kinetic'
}


/** 档位中文（界面徽标与日志用） */
export const LAIR_TIER_LABELS: Record<LairTier, string> = { 1: '外围', 2: '核心', 3: '深层' }
