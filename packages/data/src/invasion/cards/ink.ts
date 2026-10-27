/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, enemyParameterOf, FOE_MOUNT_IDS } from '@whale/core'
import invasionFleetsParameters from '../../static/invasionFleets.json'
import { FOE_H_INK_CORVETTE, FOE_H_INK_TORPEDO, FOE_H_INK_BATTLECRUISER, FOE_H_INK_JAMMER, FOE_H_INK_FLAGSHIP } from '../../foe-ships'

/**
 * **1. 墨潮帮骚扰舰队**（船长 2026-09-24：「**墨潮帮骚扰舰队：墨潮突击舰*4**」）——入侵外围的常驻编成。
 *
 * **2026-09-25 重定价**：威胁 **90**（船长令）· 4 艘突击舰（舰级 364 血 / 51 单发）。
 * `K = 2.2842`（`hpMul` = K · `dmgMul` = K ÷ 补偿 1.6 = 1.4276）⇒ 每艘 **831.4 血 / 116 单发**
 * （血÷DPS 28.67 vs 舰级 28.55）· 全波总血 **3,325.80** · 峰值波火力 **116.00 DPS** · X = **621.12**
 * ⇒ 达成预算 `5X÷3` = **1,035.20 ≤ F(90) = 1,038** ✓。
 * 遇袭（强度 ×0.75 · 入侵侧缩放）：血 2,494.27 · 峰值 87.00 DPS ⇒ 标签 **威胁 76**。
 */
export const WEEKEND_INK_HARASS_CARD: AnomalyDef = {
  id: 'ink-harass',
  foeFamily: 'H',
  name: '墨潮帮骚扰舰队',
  galaxyId: 'galaxy-hub',
  // 2026-09-26 船长令「**H族残骸不分高安低安，统一为入侵残骸**（原先的是高安，低安，虫洞。新增一个类别）」
  // ⇒ 卡级地区由 `hi` 改新类别 **`inv`**（与残骸组 `h-hi` 的 `region` 一致；契约「卡地区 = 组地区」由此成立）。
  region: 'inv',
  // 2026-09-26 船长令「**将G族和H族残骸价格提高到和D族差不多的位置**」⇒ 卡级回收档覆写 **危档**：
  // 缺省会按锚星系 `galaxy-hub` 的基础密度 58 现算成常档，那样组池/组档都会与保值契约对不上。
  wreckTier: 'dire',
  threat: enemyParameterOf(invasionFleetsParameters, "ink-harass", "threat"),
  foeTargeting: 'random',
  dmgMix: { kinetic: enemyParameterOf(invasionFleetsParameters, "ink-harass", "dmgMix_kinetic"), explosive: enemyParameterOf(invasionFleetsParameters, "ink-harass", "dmgMix_explosive") }, // 全卡都是突击舰（船长 2026-09-24 第二轮令：突击舰改 6 动能 : 4 爆炸）
  ships: [{ ship: FOE_H_INK_CORVETTE, count: enemyParameterOf(invasionFleetsParameters, "ink-harass", "ships_0_count"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-harass", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-harass", "ships_0_dmgMul") }],
  standingReq: enemyParameterOf(invasionFleetsParameters, "ink-harass", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "ink-harass", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "ink-harass", "rewardIsk"),
  loot: [],
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "ink-harass", "combatSeconds"),
  hidden: true,
  description: '周末入侵：墨潮帮的骚扰舰队（隐藏卡，只由入侵活动生成）。',
}

/**
 * **2. 墨潮帮袭击舰队**（船长 2026-09-24：「**墨潮帮袭击舰队：分2波，墨潮突击舰*2；墨潮鱼雷舰*3**」）。
 * 第 1 波 = 突击舰 ×2 · 第 2 波 = 鱼雷舰 ×3。
 *
 * **2026-09-25 重定价**：威胁 **108**（船长令）· `K = 2.8281`（`hpMul` = K · `dmgMul` = K ÷ 补偿 1.6667 = 1.6969）
 * ⇒ 突击舰 ×2：**1,029.4 血 / 144 单发**（血÷DPS 28.60 vs 舰级 28.55）· 鱼雷舰 ×3：**1,018.1 血 / 255 单发**
 * （22.36 vs 22.40）· 全波总血 **5,113.20**（波 2,058.86 / 3,054.35）· 峰值波火力 **136.61 DPS** · X = **835.76**
 * ⇒ 达成预算 = **1,392.94 ≤ F(108) = 1,393** ✓。
 * 遇袭（强度 ×0.75）：血 3,834.95 · 峰值 102.32 DPS ⇒ 标签 **威胁 91**。
 *
 * ⚠ `waves[].hpShare` 现值 **0.5 / 0.5 保持不动**：舰级路径下**血量走 `slot.hpMul` 的绝对值**、
 * 不由 `hpShare` 决定，该字段对本卡只影响**命名档（"轻装"前缀）与排波次** ⇒ 实测波血已是 40 / 60 也不改它
 * （改它会平白给第 1 波主舰挂上"轻装"前缀）。
 */
export const WEEKEND_INK_RAID_CARD: AnomalyDef = {
  id: 'ink-raid',
  foeFamily: 'H',
  name: '墨潮帮袭击舰队',
  galaxyId: 'galaxy-hub',
  region: 'inv', // 2026-09-26 船长令：H 族残骸统一为「入侵」类（与组 h-hi 的 region 一致）
  wreckTier: 'dire', // 2026-09-26 船长令：G/H 残骸价提到 D 族水平（卡级回收档覆写危档）
  threat: enemyParameterOf(invasionFleetsParameters, "ink-raid", "threat"),
  foeTargeting: 'random',
  dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-raid", "dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-raid", "dmgMix_kinetic") }, // 主体（鱼雷舰 ×3）是导弹/爆炸系
  waves: [
    { units: enemyParameterOf(invasionFleetsParameters, "ink-raid", "waves_0_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-raid", "waves_0_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "ink-raid", "waves_1_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-raid", "waves_1_hpShare") },
  ],
  ships: [
    { ship: FOE_H_INK_CORVETTE, count: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_0_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_0_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_0_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_0_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_0_dmgMix_kinetic") } },
    { ship: FOE_H_INK_TORPEDO, count: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_1_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_1_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_1_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-raid", "ships_1_dmgMul") },
  ],
  standingReq: enemyParameterOf(invasionFleetsParameters, "ink-raid", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "ink-raid", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "ink-raid", "rewardIsk"),
  loot: [],
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "ink-raid", "combatSeconds"),
  hidden: true,
  description: '周末入侵：墨潮帮的袭击舰队（隐藏卡，只由入侵活动生成）。',
}

/**
 * **3. 墨潮帮主力舰队**（船长 2026-09-24：「**墨潮帮主力舰队：分2波，墨潮突击舰*3；墨潮干扰舰+墨潮战列巡洋舰+墨潮鱼雷舰*2**」）。
 * 每波各自编成（第 2 波 4 艘：干扰舰 / 战列巡洋舰 / 鱼雷舰 ×2）⇒ 本卡**必须用自己的波表**
 * （引擎按 `waves` 的 `units` 逐波建档：同一舰级可出现在多波，`w1-` 前缀区分）。
 *
 * **2026-09-25 重定价**：威胁 **129**（船长令）· `K = 1.3004`（`hpMul` = K · `dmgMul` = K ÷ 补偿 1.75 = 0.7431）
 * ⇒ 突击舰 ×3 **473.3 血 / 66 单发**（28.69 vs 舰级 28.55）· 干扰舰 **1,170.4 / 137**（34.17 vs 34.29）·
 * 战列巡洋舰 **3,641.1 / 519**（42.09 vs 42.11）· 鱼雷舰 ×2 **468.1 / 117**（22.41 vs 22.40）·
 * 全波总血 **7,167.80**（波 1,420.04 / 5,747.77）· 峰值波火力 **173.18 DPS** · X = **1,114.14**
 * ⇒ 达成预算 = **1,856.90 ≤ F(129) = 1,857** ✓。遇袭（强度 ×0.75）：血 5,375.85 · 峰值 130.93 DPS ⇒ 标签 **威胁 109**。
 *
 * ⚠ **两处已报备的口径**：
 * ① 第 2 波舰体 DPS 名义 **162.4 越 150 线** ⇒ 引擎按既有规则（超出部分 15% 折扣）实收 **160.55**，
 *    K 是按**折扣后**的达成预算收敛的；
 * ② 该波战巡那架机群**相对偏弱约 42%**（机群不吃多舰补偿、却与炮台共用同一条 `dmgMul`，占该波火力约 7%）——
 *    要精确对齐需给该条目加 `droneFireShare`（守恒拆分），船长 2026-09-25 裁定本轮不做。
 */
export const WEEKEND_INK_MAIN_CARD: AnomalyDef = {
  id: 'ink-main',
  foeFamily: 'H',
  name: '墨潮帮主力舰队',
  galaxyId: 'galaxy-hub',
  region: 'inv', // 2026-09-26 船长令：H 族残骸统一为「入侵」类（与组 h-hi 的 region 一致）
  wreckTier: 'dire', // 2026-09-26 船长令：G/H 残骸价提到 D 族水平（卡级回收档覆写危档）
  threat: enemyParameterOf(invasionFleetsParameters, "ink-main", "threat"), // **2026-09-25 无人机微调后重算的实测价**（129 → 132：战巡那架重袭机调强了）
  /**
   * ⚠ **回收口径的冻结值**（船长 2026-09-25「**冻结残骸经济**」，与 `anomalies.ts` 同一条纪律）：
   * 本卡的**战力标签**刚从 129 涨到 132，但**残骸侧一律不动** ⇒ 用 `wreckThreat` 把它钉在 129
   * （否则 H 残骸组的代表威胁会从 124 跟着漂到 125，牵动回收画像与碎片门槛）。
   */
  wreckThreat: enemyParameterOf(invasionFleetsParameters, "ink-main", "wreckThreat"),
  /**
   * **打赢本卡掉 1 件稀有残骸**（**2026-09-27 船长令**：「**主力舰队添加一个稀有残骸掉落**」＋
   * 追问落点答「**进残骸场**」）。
   *
   * 落点 = **该星系的入侵残骸场**（`weekendWrecks.rare/rareBy`）⇒ 打捞时稀有池优先、本轮必出一件
   * （物品 = 本卡所属组 `h-hi` 的稀有残骸 `wreck-rare-h-hi`）。**只在战斗里打赢才算**
   * （主动出击全歼 / 遇袭击退）；文字结算与失利不算。**不设每场上限**（船长同日令）。
   * 主力舰队是四张卡里唯一写本字段的 —— 骚扰/袭击/旗舰的掉落口径不动（旗舰走它自己那 3 件）。
   */
  rareWreckDrop: enemyParameterOf(invasionFleetsParameters, "ink-main", "rareWreckDrop"),
  foeTargeting: 'random',
  dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-main", "dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-main", "dmgMix_kinetic") },
  waves: [
    { units: enemyParameterOf(invasionFleetsParameters, "ink-main", "waves_0_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-main", "waves_0_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "ink-main", "waves_1_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-main", "waves_1_hpShare") },
  ],
  ships: [
    { ship: FOE_H_INK_CORVETTE, count: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_0_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_0_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_0_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_0_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_0_dmgMix_kinetic") } },
    /**
     * ⚠ **条目顺序 = 本波"敌方期望距离"的取数依据**（`foeDesiredRange` 取 `foes[0]`）——
     * 2026-09-25 船长令「甲：改卡面条目顺序」：本波主体（**战列巡洋舰 11 km ＋ 鱼雷舰 ×2 12 km**）
     * 排在**干扰舰之前** ⇒ 本波期望距离 = 战巡的 **9,500 m**（改前干扰舰排第一 ⇒ 整波被拖到 2,352，
     * 而战巡/鱼雷舰的近盲带 ×0.3 正在那个距离上）。
     */
    { ship: FOE_H_INK_BATTLECRUISER, count: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_1_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_1_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_1_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_1_dmgMul") },
    { ship: FOE_H_INK_TORPEDO, count: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_2_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_2_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_2_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_2_dmgMul") },
    { ship: FOE_H_INK_JAMMER, count: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_3_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_3_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_3_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_3_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_3_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-main", "ships_3_dmgMix_kinetic") } },
  ],
  standingReq: enemyParameterOf(invasionFleetsParameters, "ink-main", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "ink-main", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "ink-main", "rewardIsk"),
  loot: [],
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "ink-main", "combatSeconds"),
  hidden: true,
  description: '周末入侵：墨潮帮的主力舰队（隐藏卡，只由入侵活动生成）。',
}

/**
 * **4. 墨潮旗舰部队**（船长 2026-09-24：「**墨潮旗舰部队：分4波，墨潮突击舰*4；墨潮鱼雷舰*3+墨潮干扰舰；
 * 墨潮干扰舰+墨潮战列巡洋舰*2；墨潮入侵母舰+墨潮干扰舰+墨潮战列巡洋舰+墨潮鱼雷舰**」）。
 *
 * 4 波各 4 / 4 / 3 / 3 艘（共 14 艘，旗舰在最后一波压轴）——**本卡必须自带波表**
 * （`combat.FoeOverride.keepCardWaves`）：入侵侧覆写的是 `waves[]` 字段（"跑几波、每波几艘"），
 * 卡自己的编成在 `ships[]` 的 `wave` 上；舰级路径不吃覆写的 `units`/`hpShare` ⇒ 两者都 4 波时实战一致，
 * 但**波声明数**（预估胜率的"峰值波小队数"与命名档都用它）必须写对。
 *
 * ⚠ **2026-09-25 旗舰轮：本卡已按新定价式重标**——威胁 **170**（船长令）· 系数 **4 舰小队 ×10**
 * （入侵的压轴小队战，与三张"单舰 ×3"的卡不同源）；母舰**舰级血 3,920 → 39,200**（船长令 ×10）。
 * 属性落法与三张非旗舰卡同源 = **每艘船的血与单发同乘 K**（⇒ 血÷DPS = 舰级自然比），
 * `K = 1.7753`（`hpMul` = K · `dmgMul` = K ÷ 补偿 1.875 = 0.9468）：
 * - 母舰 **69,592 血 / 799 单发**（＋2 架重袭机）· 战巡 ×3 **4,971 / 658** · 干扰舰 ×3 **1,598 / 186** ·
 *   突击舰 ×4 **646 / 91** · 鱼雷舰 ×4 **639 / 160**（共 15 艘）；
 * - 全波总血 **94,439** · 峰值波 **357.7 DPS**（名义 ≈398，吃现行"150 越线 15% 折扣"后）· X = 5,812
 *   ⇒ 达成预算 `5X÷10` = **2,906 ≤ F(170) = 2,906** ✓；**护航强度 = 旧 120 方案的 102%**；
 * - **BOSS 口径**（船长 2026-09-25 选甲）：战斗里的血条 = **池子剩余**（`weekendLaunch` 传
 *   `FoeOverride.bossHp`，池子 = 固定 **150,000**）⇒ 单场不死名副其实；母舰卡面 69,592 只作**基准**。
 */
export const WEEKEND_INK_FLAGSHIP_CARD: AnomalyDef = {
  id: 'ink-flagship',
  foeFamily: 'H',
  name: '墨潮旗舰部队',
  galaxyId: 'galaxy-hub', // 只作日志/展示归属；本卡不进任何星系目录（hidden）
  region: 'inv', // 2026-09-26 船长令：H 族残骸统一为「入侵」类（原与本卡注释里的洞内口径一致，现独立成类）
  wreckTier: 'dire', // 2026-09-26 船长令：G/H 残骸价提到 D 族水平（卡级回收档覆写危档）
  threat: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "threat"), // 2026-09-25 船长令：卡面威胁 = 实测价（旗舰战不再覆写 120）
  foeTargeting: 'random',
  dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "dmgMix_kinetic") },
  waves: [
    { units: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_0_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_0_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_1_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_1_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_2_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_2_hpShare") },
    { units: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_3_units"), hpShare: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "waves_3_hpShare") }, // ⚠ 原写 3：与 `ships` 里第 3 波的 4 条条目不符（船长 2026-09-24 追问后改齐）
  ],
  ships: [
    { ship: FOE_H_INK_CORVETTE, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_0_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_0_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_0_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_0_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_0_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_0_dmgMix_kinetic") } },
    { ship: FOE_H_INK_TORPEDO, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_1_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_1_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_1_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_1_dmgMul") },
    { ship: FOE_H_INK_JAMMER, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_2_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_2_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_2_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_2_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_2_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_2_dmgMix_kinetic") } },
    /**
     * ⚠⚠ **条目顺序 = 本波"敌方期望距离"的取数依据**（`combat.foeDesiredRange` 取 `foes[0]` =
     * 该波卡面顺序**第 1 条**）⇒ **本波主体必须排在前**（2026-09-25 船长令「甲：改卡面条目顺序」）。
     * 第 3 波原先把干扰舰排第一 ⇒ 整波（含 2 艘 11 km 的**战列巡洋舰**）被拖到干扰舰的近战带
     * **2,352 m** 打，而战巡的近盲带（`blindDmgMul 0.3`）正在那个距离上。
     * ⇒ 现改为 **战巡 ×2 在前、干扰舰在后** ⇒ 本波期望距离 = 战巡的 **9,500 m**
     * （`1,000 + 0.85 × (11,000 − 1,000)`）。同理：鱼雷舰那一波（第 2 波）与母舰那一波（第 4 波）
     * 本来就是主体排第一，未动。
     */
    { ship: FOE_H_INK_BATTLECRUISER, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_3_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_3_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_3_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_3_dmgMul") },
    { ship: FOE_H_INK_JAMMER, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_4_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_4_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_4_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_4_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_4_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_4_dmgMix_kinetic") } },
    // ⚠ **母舰挂「支援舰船召唤装置」**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，
    //   只不过改为复活被摧毁的友军（但是表现形式上为敌方支援舰船入场），增援时间是60秒，每次随机复活一艘」）
    // **2026-09-26 船长改判**：「入侵活动中，H族入侵母舰的挂载件复活效果，改为每60秒复活2艘船。
    //   且必定会复活干扰舰」⇒ 挂载件参数加了 count: 2 与干扰舰优先名单（见 core/foeMounts.ts）
    //   ⇒ 每 60 秒把**本波（第 4 波）已阵亡**的一艘僚舰满血复活入场（上限 = 不超本波编成 4 艘）。
    { ship: FOE_H_INK_FLAGSHIP, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_5_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_5_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_5_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_5_dmgMul"), mounts: [FOE_MOUNT_IDS.reviveEscort] },
    { ship: FOE_H_INK_JAMMER, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_6_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_6_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_6_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_6_dmgMul"), dmgMix: { explosive: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_6_dmgMix_explosive"), kinetic: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_6_dmgMix_kinetic") } },
    { ship: FOE_H_INK_BATTLECRUISER, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_7_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_7_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_7_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_7_dmgMul") },
    { ship: FOE_H_INK_TORPEDO, count: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_8_count"), wave: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_8_wave"), hpMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_8_hpMul"), dmgMul: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "ships_8_dmgMul") },
  ],
  standingReq: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "standingReq"),
  standingGain: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "standingGain"),
  rewardIsk: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "rewardIsk"),
  loot: [], // 奖励由入侵侧发（黑匣 ＋ 稀有残骸；卡上不给）
  combatSeconds: enemyParameterOf(invasionFleetsParameters, "ink-flagship", "combatSeconds"),
  hidden: true,
  description: '周末入侵：墨潮帮的旗舰部队（隐藏卡，只由入侵活动生成）。',
}
