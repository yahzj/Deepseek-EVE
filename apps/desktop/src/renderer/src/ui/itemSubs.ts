/**
 * 「类型 → 子分类」分类表（市场页二级筛选 与 手册图鉴分组 的**唯一实现**，
 * 2026-09-10 船长：手册图鉴按类型划分、与市场子分类同口径）。
 *
 * 同日追加（船长）：**市场的类型筛选移除「装备」，改为「高槽装备 / 中槽装备 / 低槽装备」三个类型**——
 * 装备子分类（功能分组）保持不变，在三个槽类类型下同样可用（槽类与功能两级叠加筛选，槽类判定走
 * core 归槽单点 `rackOf`，见 MarketPage.kindPasses）；**蓝图的「装备蓝图」子分类**则按产物模块的
 * 槽类拆成「高槽 / 中槽 / 低槽装备蓝图」（见 BLUEPRINT_SUBS）。
 *
 * **2026-09-11 船长：「应该将消耗品独立出来」**——「物品」一类从三层变四层：
 * - **物品**（`item`）只留原料类：矿石 / 矿物 / 气体 / 冰矿（+ 动态蓝图碎片）；
 * - **消耗品**（`consume`，新一级类型）收**用一次就少一件**的三类：**弹药 / 修理组件 / 无人机**；
 * - **残骸**（`wreck`）自 2026-09-08 起就独立成类；
 * - 「物品」**不再包含**消耗品与残骸（剔除判定在 `subPasses` 与 `MarketPage.kindPasses` 两处，键集合单点 = `CONSUME_KIND_KEYS`）。
 * 注意：手册图鉴的物品分组走 core 的 `ITEM_KIND_ORDER`/`ITEM_KIND_LABELS`（按物品大类分），**不受本表拆分影响**。
 *
 * **2026-09-16 船长（本批）**：「**将货柜添加到市场的分类里，和货物同级**」＋（同日上一句）
 * 「给市场的添加奢侈品分类，放入物品下，**物品改名叫货物**」⇒
 * - **货柜**（`container`，新一级类型）：五族遗迹安全货柜 · 三档图纸货柜 · 贵重品货柜 · 军用备货柜
 *   从「货物」剔出（键集合单点 = `CONTAINER_KIND_KEYS`，本批第三次同类拆分）；**无二级子分类**（照「残骸」先例）；
 * - 「物品」→「**货物**」只是**市场类型下拉的显示名**（`MarketPage.KIND_TEXT.item`，导航页与手册不随改）；
 * - 「货物」子分类补一档「**奢侈品**」（`ITEM_SUBS`）。
 *
 * **2026-09-11 船长（第二批）：「对组装机的蓝图添加子筛选，根据产物的类型进行二次分类。舰船部分按舰船
 * 级别划分。弹药蓝图改为消耗品蓝图。」**（集中提问后定「甲：装备蓝图按**产物功能**分组」＋「甲：市场页
 * 蓝图子分类**同步改**」）：
 * - **组装机**（Industry.tsx）：一级标签 = 全部 / 装备蓝图 / 舰船蓝图 / **消耗品蓝图**（原「弹药蓝图」，
 *   它实际含弹药 + 修理组件）；二级子筛选 = 装备按**产物功能**（复用 `MODULE_SUBS` 九组）/ 舰船按
 *   **舰船级别**（`SHIP_TIER_SUBS` 五档）/ 消耗品按产物大类（复用 `CONSUME_SUBS`）；
 * - **市场页**：`BLUEPRINT_SUBS` 由 5 项变 **9 项**——保留高/中/低槽装备蓝图三档、舰船蓝图由 1 档拆成
 *   **T1~T5 五档**、原「补给蓝图（弹药·修理组件）」改名「**消耗品蓝图（弹药·修理组件）**」；
 * - **手册「蓝图图鉴」**分组随同（同一张表）：舰船从 1 组变 5 个级别组。
 *
 * 检索入口：`grep MODULE_SUBS|SUBS_OF_KIND|moduleSubKeyOf|CONSUME_SUBS|SHIP_TIER_SUBS|BLUEPRINT_SUBS|MARKET_BLUEPRINT_SUBS|RACK_SUBS`。
 * - 市场页 MarketPage：类型下拉的一级类型与二级子分类（筛选市场商品目录；蓝图那档走 `MARKET_BLUEPRINT_SUBS`）；
 * - 组装机 Industry.tsx：蓝图标签行 + 二级子筛选（按蓝图产物分类，不走市场商品目录）；
 * - 手册 Handbook：装备/舰船/蓝图的分组标题与分组判定（**蓝图分组表 = `BLUEPRINT_SUBS`，不含"学没学会"两档**），
 *   以及 2026-09-13 起的**图鉴筛选行**（一级 `RACK_SUBS`/`SHIP_SUBS`/…，二级 `MODULE_SUBS`/`SHIP_TIER_SUBS`/`RACK_SUBS`）；
 * - 物品页 ItemsPage：仓库筛选的装备二级（`RACK_SUBS`）与槽类判定（core `rackOf`）。
 * 新增/调整分类只改本文件，各处同时生效。
 */
import {
  isRareWreck,
  ownsBlueprint,
  rackOf,
  shipCategoryKeyOf,
  shipSizeLabel,
  WORMHOLE_BP_BOX_IDS,
  WORMHOLE_MILITARY_BOX_ID,
  WORMHOLE_VALUABLES_BOX_ID,
} from '@whale/core'
import type { GameState, MarketGoodDef, ModuleSlot, RackSlot, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'

/** 「全部子类」哨兵键（市场下拉与分组判定共用；不作为分组键） */
export const SUB_ALL = 'sub-all'

/**
 * 一个筛选子项：`key` = 判定键；`label` = **中文原串**（同时充当"键表"里的可读常量）。
 *
 * ⚠ **`label` 一律不在界面直接显示**：渲染处必须走 `tr(id)` 取当前语言（`id` 见各表；
 * 三张 `*_TABS` 门类表已逐项带 `id`）。所以本文件里出现的 `label: '中文'` 是**数据/键**、
 * 不是漏译 —— 这批 `label` 已由文件内的 `l10n-keep-start` / `l10n-keep-end` 区间统一声明。
 */
export interface SubOption {
  key: string
  label: string
  /** 本地化 id（有则渲染处用它取词；缺 = 尚未接线，仍显示 `label`） */
  id?: string
  /** 配 `id` 用的插值参数（该 id 是带 `{p1}` 的整句模板时才需要，如舰船级别的「T{n} 护卫舰」） */
  idParam?: string
}

/**
 * 「物品」的三个消耗性子类（2026-09-11 船长：「应该将消耗品独立出来」——**消耗品独立成一级类型**，
 * 并从「物品」里剔除，与当年「残骸」独立成类的口径一致）：
 * 弹药（打完就少）/ 修理组件（战斗中烧）/ 无人机（永久损失制，用一场少一批）。
 */
// l10n-keep-start：**本文件自下方起的所有中文串都是数据/键**（`label` 只作可读常量与判定键，
// 渲染一律走 `subText` 按 `id` 取当前语言，见文件头注释）。
// ⚠ **2026-09-22 补上这个起点标记**：此前只有收尾标记（本文件最后一行）、区间没生效，
// `l10n:check` 把下面已接线的 `label`（各有 `id`）误报成"未译中文串"。
export const CONSUME_SUBS: SubOption[] = [
  { key: 'ammo', label: tr("ui.BattleScreen.003") },
  { key: 'kit', label: tr("ui.itemSubs.001") },
  { key: 'drone', label: tr("ui.Handbook.004") },
]

/** 消耗品子类键集合（市场类型判定与子分类判定共用一处） */
export const CONSUME_KIND_KEYS: readonly string[] = CONSUME_SUBS.map((s) => s.key)

/**
 * **黑匣键集合**（**2026-09-26 船长**：「**入侵获得的黑匣在仓库内查看不到，需要新增分类**」＋
 * 「**市场内黑匣单独一个分类，不要挪到「货物」**」）。
 *
 * 单点用途：`itemBucketPasses` 的「货物」档**必须把黑匣剔出去**（与残骸/消耗品/货柜三次独立同一套做法），
 * 并给市场一级类型供一个新的 `'blackbox'` 桶。⚠ 它**不是**消耗品——黑匣是战利品兼生产原料
 * （组装机造舰船插件每件吃 1 个），故不并入 `CONSUME_KIND_KEYS`。
 */
export const BLACKBOX_KIND_KEYS: readonly string[] = ['blackbox']

/**
 * **「货柜」独立成一级类型**（船长 2026-09-16：「**将货柜添加到市场的分类里，和货物同级**」）——
 * 货柜（`container`：五族遗迹安全货柜 · 三档图纸货柜 · 贵重品货柜 · 军用备货柜）从「货物」里剔出，
 * 与「残骸」（2026-09-08 独立）、「消耗品」（2026-09-11 独立）同一套做法。
 *
 * ⚠ **2026-09-16 船长追答：「货柜要二级子分类」** ⇒ 四档子类（`CONTAINER_SUBS`），
 * 判定走 `containerSubKeyOf`（**按 id 规则派生**，不复述清单：`box-relic-<族字母>` 来自 core 的
 * `wormholeRelicBoxPoolOf` 同一把尺，另两类读 core 的货柜常量）。
 */
export const CONTAINER_KIND_KEYS: readonly string[] = ['container']

/** 货柜的四个二级子类（顺序 = 渲染顺序；"安全柜"五族在前，"贵重品/军用"两个新柜在后） */
export const CONTAINER_SUBS: SubOption[] = [
  { key: 'safe', label: tr("ui.itemSubs.002") },
  { key: 'bp', label: tr("ui.itemSubs.003") },
  { key: 'valuables', label: tr("ui.itemSubs.004") },
  { key: 'military', label: tr("ui.itemSubs.005") },
]

/**
 * 货柜物品 → 子类键（查不到 ⇒ `''`，调用方按"其它"兜底）。
 * ⚠ **按 id 规则派生**，不另存清单：五族安全柜 = `box-relic-<族字母>`（与 core `wormholeRelicBoxPoolOf`
 * 的正则同一把尺）· 三档图纸柜 = core `WORMHOLE_BP_BOX_IDS` · 贵重品/军用柜 = core 两个常量。
 */
export function containerSubKeyOf(refId: string): string {
  if (/^box-relic-[a-z]$/.test(refId)) return 'safe'
  if ((WORMHOLE_BP_BOX_IDS as readonly string[]).includes(refId)) return 'bp'
  if (refId === WORMHOLE_VALUABLES_BOX_ID) return 'valuables'
  if (refId === WORMHOLE_MILITARY_BOX_ID) return 'military'
  return ''
}

/** **残骸档位**（普通 / 稀有）——物品页仓库 · 手册物品图鉴 · 市场 · 工业页回收炉**共用同一张表**
 *  （原写死在 `pages/IndustryPage.tsx`，2026-09-19 按基线⑤收编到本文件）。 */
export const WRECK_SUBS: SubOption[] = [
  { key: 'common', label: tr("ui.IndustryPage.008") },
  { key: 'rare', label: tr("ui.IndustryPage.009") },
]

/** 残骸档位判据（**单点**）：直接委托 core 的 `isRareWreck`（`wreck-rare-*` 前缀，13 组同源），
 *  渲染层不再自己判前缀——图标配色（`Glyphs.inventoryItemTone`）与几处筛选都读本函数。 */
export function wreckTierOf(refId: string): 'rare' | 'common' {
  return isRareWreck(refId) ? 'rare' : 'common'
}

/** 「物品」类 = 除残骸与消耗品以外的物品（2026-09-11 起消耗品独立，故此处剔除三类）
 *  ⚠ 术语（船长 2026-09-12）：`ore` = **原矿**、`mineral` = **原材料**（旧称矿石/矿物作废）
 *  ⚠ **2026-09-16 船长**：「给市场的添加奢侈品分类，放入物品下，**物品改名叫货物**」⇒ 本表补
 *  **奢侈品**（`luxury`）一档（三件纯贸易品：星港陈酿 / 贵族香料 / 失落艺术品，出自贵重品货柜拆解），
 *  一级类型中文名「物品」→「**货物**」在 `MarketPage.KIND_TEXT` 单点改。 */
export const ITEM_SUBS: SubOption[] = [
  { key: 'ore', label: '原矿', id: 'ui.IndustryPage.005' },
  { key: 'mineral', label: '原材料', id: 'ui.itemSubs.006' },
  { key: 'gas', label: '气体', id: 'ui.IndustryPage.006' },
  { key: 'ice', label: '冰矿', id: 'ui.IndustryPage.007' },
  // 2026-09-20 零件体系：零件在「货物」下按基础/高级两档（键 = `part-<档>`，与组装机零件门类同一套 `PART_SUBS`）
  { key: 'part-basic', label: '基础零件', id: 'ui.itemSubs.033' },
  { key: 'part-advanced', label: '高级零件', id: 'ui.itemSubs.034' },
  { key: 'luxury', label: '奢侈品', id: 'ui.itemSubs.007' },
]

/** 零件「基础 / 高级」维度（2026-09-20 零件体系：组装机「零件」门类二级筛选与市场「货物」子分类共用）。
 *  键 = `part-<档>`（基础 = 隐式蓝图直接可造 / 高级 = 需学习蓝图）。 */
export const PART_SUBS: SubOption[] = [
  { key: 'part-basic', label: '基础零件', id: 'ui.itemSubs.033' },
  { key: 'part-advanced', label: '高级零件', id: 'ui.itemSubs.034' },
]

/** 装备子类 = 模块槽位聚合（文案玩家向；含异星原型等特殊件按槽归位） */
export const MODULE_SUBS: SubOption[] = [
  { key: 'prod', label: tr("ui.itemSubs.008") },
  { key: 'weapon', label: tr("ui.itemSubs.009") },
  { key: 'shield', label: tr("ui.FitPage.001") },
  { key: 'armor', label: tr("ui.FitPage.003") },
  { key: 'prop', label: tr("ui.BattleScreen.004") },
  { key: 'drone', label: tr("ui.itemSubs.010") },
  // 支援件三档（2026-09-26 船长令，见 SUPPORT_MODULE_KEYS 的说明）——原「支援件（辅助与维修）」一档拆成同级三档
  { key: 'support-combat', label: tr("ui.itemSubs.038") },
  { key: 'support-aux', label: tr("ui.itemSubs.039") },
  { key: 'support-repair', label: tr("ui.itemSubs.040") },
  { key: 'cpu', label: tr("ui.itemSubs.012") },
  { key: 'salvager', label: tr("ui.Wormhole.001") },
  { key: 'lock', label: tr("ui.itemSubs.013") },
  // 舰船插件（2026-09-26 船长令）：装备功能族里的一档 —— 文案与归属档、物品种类名共用一条 id
  { key: 'plug', label: tr("ui.labelsText.069") },
]

/**
 * **支援件的三个同级子类**（**2026-09-26 船长令**：「**将装备细分类的支援件筛选拆分成三个同级：
 * 战斗支援件，辅助支援件，修理装置。**」）——集中提问后三条裁定：「**按效果族分**」·「**都跟着拆**」
 * （市场二级筛选 / 手册装备图鉴分组 / 组装机装备蓝图子筛选 / 碎片子类**四处同一张表**）·
 * 「**直接替掉**旧键」（`support` 这个键从此不再出现）。
 *
 * 为什么要单列一份**逐件清单**：这一族的 34 件**共用同一个 `slot: 'support'`**（横跨高/中/低三槽），
 * 而槽位与"战斗/辅助/修理"是**两个不同维度**（例：跃迁计算机是低槽、姿态陀螺是中槽，却分属辅助与战斗）
 * ⇒ `moduleSubKeyOf` 的"槽位 → 键"一对一映射装不下，必须按**件**登记。
 *
 * ⚠ **完备性由 `content:check` 的「支援件三分契约」守住**（2026-09-26 加）：`slot === 'support'` 的每一件
 * 必须恰好落在下面三组之一，**漏登记即红**（漏了会掉进"其它"、玩家在这个筛选里永远看不到它）。
 */
export const SUPPORT_MODULE_KEYS: Record<string, readonly string[]> = {
  /** 战斗支援件：直接提升开火侧或生存侧的战斗表现（伤害/射速/命中/回避/干扰） */
  'support-combat': [
    'mod-stab-kin-1', 'mod-stab-kin-2', 'mod-stab-kin-3',
    'mod-stab-exp-1', 'mod-stab-exp-2', 'mod-stab-exp-3',
    'mod-stab-pla-1', 'mod-stab-pla-2', 'mod-stab-pla-3',
    'mod-rof-1', 'mod-rof-2', 'mod-rof-3',
    'mod-track-1', 'mod-track-2', 'mod-track-3',
    'mod-gyro-1', 'mod-gyro-2', 'mod-gyro-3',
    'mod-wh-a-scan', // 赃物扫描阵（命中 ×1.24，代价射程 −15%）
    'mod-wh-g-fcs', // 亡军火控（命中 + 单发）
    'mod-wh-d-steady', // 陵墓弹道铭文（动能/能量单发 +18%）
    'mod-wh-d-loader', // 守墓者速装填机（装填 −18%）
    'mod-wh-g-ballistic', // 幽灵弹道校正器（动能单发 + 射程）
    'mod-lair-web-h', // 墨潮捕获网（战斗中钉住敌舰）
    'mod-lair-ecm-h', // 墨潮电子舱（压制敌方武器射程）
    'mod-stealth-2', 'mod-stealth-3', // 隐秘行动装置：**开战保护**，属战斗侧（不是航行/后勤）
  ],
  /** 辅助支援件：航行、后勤与作业面（不直接改变交火读数） */
  'support-aux': [
    'mod-warpcomp-2', 'mod-warpcomp-3', // 跃迁计算机（星系际航行速度）
    'mod-wh-c-pulse', // 生体脉搏加速器（装填 −6%）
  ],
  /** 修理装置：交火中回复装甲/结构（吃或不吃组件两种） */
  'support-repair': [
    'mod-hullrep-civ', 'mod-hullrep-1', 'mod-hullrep-2', // 船体维修装置三档（吃修理组件）
    'mod-lair-dc-c', // 生体损管腔（结构自修 + 三系壳抗，不吃组件）
    // 损伤管制装置三档（2026-09-26 船长令：「**损管装置和修理装置是同一类型装备分类，不是装甲**」
    // ⇒ 与船体维修装置同一档；低槽件，靠 `rack: 'low'` 落在低槽）
    'mod-dc-1', 'mod-dc-2', 'mod-dc-3',
  ],
}

export const MODULE_SUB_SLOTS: Record<string, readonly string[]> = {
  prod: ['miner', 'cargo'],
  weapon: ['turret', 'laser', 'missile'],
  shield: ['shield'],
  armor: ['armor'],
  prop: ['propulsion'],
  drone: ['drone-rack', 'drone-tac', 'drone-relay'], // 2026-09-10 + 无人机中继天线
  // 三档支援件**都来自同一个槽**（`support`）——逐件归属见 `SUPPORT_MODULE_KEYS`
  'support-combat': ['support'],
  'support-aux': ['support'],
  'support-repair': ['support'],
  cpu: ['cpu'], // 2026-09-11 协处理器（低槽 CPU 预算扩容）
  salvager: ['salvager'],
  lock: ['target-lock'],
  // 舰船插件（2026-09-26 船长令）：独立槽 `plug` 自成一家族（否则插件在装备图鉴里掉进「其它」）
  plug: ['plug'],
}

export const SHIP_SUBS: SubOption[] = [
  { key: 'industrial', label: tr("ui.itemSubs.014") },
  { key: 'hauler', label: tr("ui.itemSubs.015") },
  { key: 'armed', label: tr("ui.itemSubs.016") },
  // 2026-09-16 船长：「将重装舰类的名称改为装甲舰」（键仍 = role id，机制零迁移）
  { key: 'armored', label: tr("ui.itemSubs.017") },
]

/** 舰船级别（T1~T5；顺序即渲染顺序，分组判定与子分类判定共用一处） */
export const SHIP_TIER_KEYS = [1, 2, 3, 4, 5] as const

/**
 * **舰船级别子类**（2026-09-11 船长：「舰船部分按舰船级别划分」）：T1~T5 五档，
 * 键 = `t<级别>`，中文名走 core `shipSizeLabel`（**不存第二份**；改舰种名只改 core 一处）。
 * 用途：组装机「舰船蓝图」二级筛选、市场「蓝图」类型的舰船档、手册蓝图图鉴分组。
 */
export const SHIP_TIER_SUBS: SubOption[] = SHIP_TIER_KEYS.map((t) => ({
  key: `t${t}`,
  label: `T${t} ${shipSizeLabel(t)}`,
  /**
   * 2026-09-21：`label` 里的舰级名来自 core `shipSizeLabel`（中文），故指到渲染层的本地化版
   * （`ui/labelsText.ts` 的 `shipTierText`）。**用带 `{p1}` 的整档模板**（`ui.labelsText.xxx` =
   * `"T{p1} 护卫舰"` / `"T{p1} Frigate"`）——`subText` 只按 id 取整句、不带参数，
   * 所以档号必须写进译文里，不能只译舰级名（否则英文侧会丢掉 "T1" 前缀）。
   */
  id: `ui.labelsText.0${13 + t}`,
  idParam: String(t),
}))

/**
 * 蓝图子类（市场「蓝图」类型下的二级筛选 与 手册「蓝图图鉴」分组）：
 * **装备蓝图按产物槽类**分高/中/低档（2026-09-10 船长）· **舰船蓝图按舰船级别**分 T1~T5
 * （2026-09-11 船长：「舰船部分按舰船级别划分」）· 物品蓝图归「**消耗品蓝图**」
 * （2026-09-11 船长：「弹药蓝图改为消耗品蓝图」——该档实际含**弹药 + 修理组件**两张，
 * 「弹药」是旧称，与市场一级类型「消耗品」对齐）。
 * ⚠ 组装机（Industry.tsx）用的**是另一套粒度**：它的「装备蓝图」标签下按**产物功能**分九组
 * （复用 `MODULE_SUBS`），因组装机已用标签行区分装备/舰船/消耗品三大类，槽类不足以收窄 81 张装备蓝图。
 */
/** 蓝图「**学没学会**」两档（市场蓝图子筛选 ＋ 组装机那一行共用同一套键与文案 id） */
export const BLUEPRINT_LEARN_SUBS: SubOption[] = [
  { key: 'learned', label: '已学会', id: 'ui.itemSubs.031' },
  { key: 'unlearned', label: '未学会', id: 'ui.itemSubs.032' },
]

export const BLUEPRINT_SUBS: SubOption[] = [
  { key: 'high', label: '高槽装备蓝图', id: 'ui.itemSubs.018' },
  { key: 'mid', label: '中槽装备蓝图', id: 'ui.itemSubs.019' },
  { key: 'low', label: '低槽装备蓝图', id: 'ui.itemSubs.020' },
  /**
   * 舰船档接在舰级档后面（`SHIP_TIER_SUBS`）
   * ⚠ **2026-09-22 补 id**：这一排原先是**拼接标签**（``label: `${s.label}蓝图```、没有 id）
   * ⇒ 静态扫描看不见（不是字面量），英文界面下市场「蓝图」与手册「蓝图图鉴」按舰级分的档整句中文。
   * 现给 `ui.labelsText.060~064` 五条**整档模板**（档号写进译文），与舰级档同一套 `idParam` 口径。
   */
  ...SHIP_TIER_SUBS.map((s) => ({
    key: s.key,
    label: `${s.label}蓝图`,
    id: `ui.labelsText.0${59 + (s.idParam ? Number(s.idParam) : 0)}`,
    idParam: s.idParam,
  })),
  { key: 'supply', label: '消耗品蓝图（弹药·修理组件）', id: 'ui.itemSubs.021' },
  // 2026-09-20 零件体系：高级零件蓝图（常驻市场）——基础零件为隐式蓝图无书，故只有高级一档
  { key: 'part-advanced', label: '零件蓝图', id: 'ui.itemSubs.035' },
]

/**
 * **市场「蓝图」类型的二级子筛选**（= 上面那张分组表 ＋ 末两档「**学没学会**」）。
 *
 * ⚠ 为什么另起一张、不直接往 `BLUEPRINT_SUBS` 里加：那张表**同时是手册「蓝图图鉴」的分组顺序表**
 * （`Handbook.orderOf('blueprints')`），而 `groupCells` 对"顺序表里有、但没有卡片"的键**会原样留下一组**
 * ⇒ 往它里面加 `learned`/`unlearned` 会让图鉴多出两个空组标题。故市场走本表，图鉴照旧读 `BLUEPRINT_SUBS`。
 *
 * 2026-09-24 船长：「市场蓝图筛选的子筛选里，加入一个未学习蓝图的子筛选」⇒ 补上「**未学会**」，
 * 同时补对称的「**已学会**」（与组装机那一行 `BLUEPRINT_LEARN_TABS` **同一套键、同一套文案 id**）。
 * 判定见 `subPasses`：**未学会 = 永久图纸且尚未学会**（一次性图纸按定义不能学，不计入）。
 */
export const MARKET_BLUEPRINT_SUBS: SubOption[] = [...BLUEPRINT_SUBS, ...BLUEPRINT_LEARN_SUBS]

export const CORE_SUBS: SubOption[] = [
  { key: 'basic', label: tr("ui.MarketPage.020") },
  { key: 'gamma', label: tr("ui.itemSubs.022") },
  { key: 'beta', label: tr("ui.itemSubs.023") },
  { key: 'alpha', label: tr("ui.itemSubs.024") },
]

/**
 * 市场装备的三个**槽类类型**（2026-09-10 船长：移除「装备」类型，改为这三个新选项）——
 * 子分类沿用 MODULE_SUBS 的功能分组，两级筛选叠加（类型定槽类、子类定功能）。
 */
export const RACK_KIND_KEYS = ['module-high', 'module-mid', 'module-low'] as const
export type RackKind = (typeof RACK_KIND_KEYS)[number]

/** 装备槽类中文名（键 = core `rackOf` 的返回值 ＋ 2026-09-26 新增的 `plug`）——**全仓唯一一份**：
 *  市场页「类型」下拉的三项（`module-high/mid/low`）、手册「装备图鉴」主筛选、
 *  手册「蓝图图鉴」装备蓝图的子筛选、物品页仓库的装备二级筛选，全部读这里。 */
export const RACK_LABELS: Record<string, string> = {
  high: tr("ui.itemSubs.025"),
  mid: tr("ui.itemSubs.026"),
  low: tr("ui.itemSubs.027"),
  // 舰船插件（2026-09-26 船长令）：与高/中/低槽**同级**的一档；文案与物品种类名共用一条 id
  plug: tr("ui.labelsText.069"),
}

/**
 * 装备**归属档**子项（顺序 = 高 / 中 / 低 / **舰船插件**；手册装备图鉴主筛选与仓库的装备二级筛选直接渲染这张表）。
 * ⚠ 键空间 = `rackDimKeyOf` 的取值域（`plug` 是**归属档**不是 `RackSlot`——插件走独立插件槽，见 data/plugs.ts）。
 */
export const RACK_SUBS: SubOption[] = (['high', 'mid', 'low', 'plug'] as const).map((k) => ({
  key: k,
  label: RACK_LABELS[k],
}))


/** 主类型 → 可用子分类（装备四档桶共用装备的功能子分类；残骸按档位，2026-09-19 补） */
export const SUBS_OF_KIND: Record<string, SubOption[]> = {
  item: ITEM_SUBS,
  container: CONTAINER_SUBS,
  consume: CONSUME_SUBS,
  module: MODULE_SUBS,
  'module-high': MODULE_SUBS,
  'module-mid': MODULE_SUBS,
  'module-low': MODULE_SUBS,
  ship: SHIP_SUBS,
  // 市场「蓝图」用它（＝分组表 ＋ 末两档「学没学会」）；手册图鉴分组仍读 `BLUEPRINT_SUBS`（见上面注释）
  blueprint: MARKET_BLUEPRINT_SUBS,
  aicore: CORE_SUBS,
  // 残骸：普通 / 稀有（2026-09-19 甲组补丁——原先市场「残骸」类型没有任何子筛选）
  wreck: WRECK_SUBS,
}

/**
 * 子分类判定（good 是否属于所选子类；sub = SUB_ALL 恒真）。
 *
 * **甲组·判定单点**（船长 2026-09-19「六条基线」之⑥）：物品 / 装备两域（市场的「货物」「四个装备桶」
 * 「消耗品」「货柜」「残骸」五种类型都是它们）一律交**唯一入口** `itemSubPasses`——本条原先自己写了
 * 一整套分支，与物品页、手册各写一份。市场**特有**的舰船 / 蓝图 / AI 核心三条留着（各自的键空间不同，
 * 例：AI 核心市场商品的 `refId` 是类型键本身，而仓库物品是 `ai-core-<类型>`）。
 */
export function subPasses(ctx: SimContext, good: MarketGoodDef, kind: string, sub: string, state?: GameState): boolean {
  if (sub === SUB_ALL || kind === 'all') return true
  if (good.kind === 'item' || good.kind === 'module') return itemSubPasses(ctx, good.refId, kind, sub)
  // 只装物品/装备的桶：别的商品（舰船/蓝图/核心）**不属此桶**（收敛前各分支自带这条护栏，别丢）
  if (ITEM_SPACE_BUCKETS.includes(kind)) return false
  if (kind === 'ship') {
    // 舰船类别走**唯一入口** `shipRolePasses`（2026-09-19 乙组：原先这里用原始 `role`，
    // 与舰队/虫洞/手册的派生类别键 `shipCategoryKeyOf` 不一致 ⇒ 已统一）
    return shipRolePasses(ctx.ships.get(good.refId), sub)
  }
  if (kind === 'blueprint') {
    /**
     * **「学没学会」两档**（2026-09-24 船长令）——与组装机同一口径：
     * **未学会 = 永久图纸且尚未学会**。⚠ **一次性图纸不计入"未学会"**——它按定义
     * 「不上市场、不能学、只能造一次」（`BlueprintDef.singleUse`），放进去就是一张永远学不会的清单。
     * `ownsBlueprint` 是 core 单点（读 `state.learnedRecipes`）；**不传 state**（老调用方）⇒ 这两档恒不命中，
     * 宁可不筛也不猜。
     */
    if (sub === 'learned' || sub === 'unlearned') {
      if (!state) return false
      const single = ctx.blueprints.get(good.refId)?.singleUse === true
      const learned = ownsBlueprint(state, good.refId)
      return sub === 'learned' ? learned : !learned && !single
    }
    const eq = ctx.blueprints.get(good.refId)
    if (eq) {
      // 零件蓝图（2026-09-20 零件体系）：按基础/高级档；基础零件 = 隐式蓝图无市场行，市场只有高级一档
      if (eq.partTier) return partSubPasses(ctx, good.refId, sub)
      // 物品蓝图（弹药/修理组件）归消耗品档；模块蓝图按**产物模块的槽类**归高/中/低档
      if (eq.moduleId === undefined) return sub === 'supply'
      const mod = ctx.modules.get(eq.moduleId)
      return mod ? rackOf(mod) === sub : false
    }
    // 舰船蓝图按**舰船级别**（2026-09-11 船长：「舰船部分按舰船级别划分」）——键 = t<级别>
    const shipBp = ctx.shipBlueprints.get(good.refId)
    if (!shipBp) return false
    const ship = ctx.ships.get(shipBp.shipId)
    return ship !== undefined && `t${ship.tier}` === sub
  }
  if (kind === 'aicore') return good.refId === sub
  return true
}

/**
 * 模块 → 装备子分类键（手册图鉴分组、市场/碎片二级判定共用；未收录返回 `''`，调用方按「其它」兜底）。
 *
 * ⚠ **支援件必须传模块 id**（2026-09-26 三档拆分）：那 34 件共用同一个 `slot: 'support'`，
 * 只看槽位分不出「战斗/辅助/修理」三档 ⇒ 只传 slot 时**支援件一律落回 `support-combat`**（最接近的档），
 * 传了 id 才能精确归属。**新调用点请一律带上第二个参数。**
 */
export function moduleSubKeyOf(slot: string, moduleId?: string): string {
  if (moduleId !== undefined) {
    for (const [key, ids] of Object.entries(SUPPORT_MODULE_KEYS)) {
      if (ids.includes(moduleId)) return key
    }
  }
  for (const [key, slots] of Object.entries(MODULE_SUB_SLOTS)) {
    if (slots.includes(slot)) return key
  }
  return ''
}

/* ═══════════ 零件「基础 / 高级」维度（2026-09-20 零件体系）═══════════
 * 判定单点 = `partTierOf`：蓝图按 `BlueprintDef.partTier`；零件物品按蓝图反查；
 * 键空间 = `part-basic` / `part-advanced`（`PART_SUBS`，组装机与市场共用）。 */

/** 零件档位（蓝图 id 或零件物品 id 均可传入）：基础 = 隐式蓝图直接可造 / 高级 = 需学习蓝图；非零件返回 null */
export function partTierOf(ctx: SimContext, refId: string): 'basic' | 'advanced' | null {
  const bp = ctx.blueprints.get(refId)
  if (bp?.partTier) return bp.partTier
  const item = ctx.items.get(refId)
  if (item?.kind !== 'part') return null
  for (const b of ctx.blueprints.values()) {
    if (b.itemId === refId && b.partTier) return b.partTier
  }
  return null
}

/** 零件子筛选判定（`sub` = `part-basic` / `part-advanced`；`SUB_ALL` 恒真） */
export function partSubPasses(ctx: SimContext, refId: string, sub: string): boolean {
  if (sub === SUB_ALL) return true
  const tier = partTierOf(ctx, refId)
  return tier !== null && `part-${tier}` === sub
}

/* ═══════════ 甲组·判定单点（船长 2026-09-19「六条基线」之⑥）═══════════
 * 起因：「筛选太多太杂」的根因之一是**同一概念有两三份实现**——市场 `subPasses`、手册自带的
 * `mainPasses/subPassesCell`、物品页仓库的 `kindHit/rackHit` 各写一份，改口径必漂移。
 * 现收敛成三个入口，各页**只许调用、不许自写**：
 *   ① `itemBucketPasses` —— **一级**：物品大类 + 「货物/装备/消耗品/货柜」这些桶键；
 *   ② `rackPasses`       —— **二级（槽类）**：高/中/低槽装备；
 *   ③ `moduleSubKeyOf`   —— **二级（功能分组）**：采集与货舱 / 武器 / 护盾 …（上面已有，市场也改读它）。
 * 行为与收敛前**逐字等价**（`tools/_probe-filter-parity.ts` 对全目录 / 全桶键 / 全子类做过对拍）。 */

/**
 * **一级「物品 / 装备维度」的唯一判定入口**。
 *
 * `bucket`（桶键）＝ 各页一级筛选实际用到的键：
 * - **真实物品大类**：`ITEM_KIND_ORDER` 的 15 个（`ore/mineral/part/gas/ice/ammo/drone/wreck/container/matter/essence/luxury/fragment/blackbox/kit/aicore`）；
 * - **`'item'`** ＝「货物」：除**残骸 / 消耗品 / 货柜 / 黑匣**以外的物品（市场一级类型用它，2026-09-08/09-11/09-16/09-26 四次拆分的结果）；
 * - **`'module'`** ＝ 装备（任意槽类）· **`'module-<归属档>'`** ＝ 按归属档（`rackDimKeyOf`：高/中/低槽 ＋ 舰船插件；市场一级类型与手册主筛选）；
 * - **`'consume'`** ＝ 消耗品整体（弹药/修理组件/无人机）· **`'container'`** ＝ 货柜整体 · **`'blackbox'`** ＝ 黑匣整体（2026-09-26 独立）；
 * - **`SUB_ALL`** ＝ 不筛（恒真）。
 */
export function itemBucketPasses(ctx: SimContext, refId: string, bucket: string): boolean {
  if (bucket === SUB_ALL || bucket === 'all') return true
  /* ── 装备域（`ctx.modules`）── */
  if (bucket === 'module' || bucket.startsWith('module-')) {
    const mod = ctx.modules.get(refId)
    if (!mod) return false
    if (bucket === 'module') return true // 「装备」= 任意槽类
    // 2026-09-26：归属档走单点 `rackDimKeyOf`（舰船插件自成一档 ⇒ **不再算低槽**，另见 `RACK_SUBS`）
    return rackDimKeyOf(mod) === bucket.slice('module-'.length)
  }
  /* ── 物品域（`ctx.items`）── */
  const it = ctx.items.get(refId)
  if (!it) return false
  if (bucket === 'item') {
    if (it.kind === 'wreck') return false
    if (CONSUME_KIND_KEYS.includes(it.kind)) return false
    if (CONTAINER_KIND_KEYS.includes(it.kind)) return false
    // 2026-09-26 船长令：「市场内黑匣单独一个分类，不要挪到「货物」」⇒ 黑匣也从「货物」里剔出
    if (BLACKBOX_KIND_KEYS.includes(it.kind)) return false
    return true
  }
  if (bucket === 'consume') return CONSUME_KIND_KEYS.includes(it.kind)
  if (bucket === 'container') return CONTAINER_KIND_KEYS.includes(it.kind)
  if (bucket === 'blackbox') return BLACKBOX_KIND_KEYS.includes(it.kind)
  return it.kind === bucket // 真实大类（含 wreck / aicore / fragment …）
}

/**
 * **二级「归属档」维度的唯一判定入口**（高 / 中 / 低槽装备 ＋ **舰船插件**）。
 *
 * 2026-09-26 起本维度多一档：船长「**在装备图鉴中，和高中低槽同级的位置，新增一个舰船插件的分类**」
 * ⇒ 归属档不再等于 core 的 `rackOf()`（插件数据里为满足体检契约声明了 `rack: 'low'`，
 * 若直接读它，插件会**藏在低槽里**、分组还会掉进「其它」）。
 *
 * **单点 `rackDimKeyOf`**：`slot === 'plug'` ⇒ `'plug'`；其余照旧走 core `rackOf`。
 * 三处消费同一把尺：本函数（筛选）· 手册装备图鉴的分组标题 · 手册蓝图图鉴的装备蓝图分组。
 */
export function rackDimKeyOf(def: { slot: ModuleSlot; rack?: RackSlot }): string {
  return def.slot === 'plug' ? 'plug' : rackOf(def)
}

/**
 * **筛选判定**：`key` = 归属档键（`high` / `mid` / `low` / `plug`）。
 * ⚠ 高/中/低三档**不再收插件**（`rackDimKeyOf` 的必然结果）——插件只在「舰船插件」档里出现。
 */
export function rackPasses(ctx: SimContext, refId: string, key: string): boolean {
  if (key === SUB_ALL) return true
  const mod = ctx.modules.get(refId)
  return mod !== undefined && rackDimKeyOf(mod) === key
}

/** 子分类中文名（查不到时回退原键） */
export function subLabelOf(kind: string, key: string): string {
  const list = SUBS_OF_KIND[kind] ?? []
  return list.find((s) => s.key === key)?.label ?? key
}

/**
 * **子分类/筛选档的显示文案**（单点；2026-09-21 船长报障：「各个子标签页和筛选似乎并没有本地化」）。
 *
 * 有 `id` ⇒ 走 `tr(id)` 取当前语言；无 `id`（尚未接线）⇒ 回退 `label`。
 * ⚠ **所有渲染 `SubOption` 的地方都必须走这里，不许直接写 `s.label`**——`label` 是数据/键
 * （见本文件头注释），直接渲染在英文界面下就会漏出中文（本轮报障的正是这批）。
 * 适用范围不限于本文件的表：`Handbook` / `IndustryPage` / `Shipyard` / `Wormhole` 里那些
 * `{ id, label }` 形状的门类与筛选项同样适用。
 */
export function subText(opt: { id?: string; label: string; idParam?: string }): string {
  if (opt.id === undefined) return opt.label
  return opt.idParam !== undefined ? tr(opt.id, { p1: opt.idParam }) : tr(opt.id)
}

/* ═══════════ 级联筛选的**空档隐藏**（2026-09-20 船长：「进行筛选清理，一些明显不存在某个子类下的筛选建议隐藏」）═══════════
 * 船长给的两个例子：**组装机-零件-高级零件-一次性蓝图**（零件没有一次性图纸）· **市场-高槽装备-护盾**（护盾是中槽件）。
 * 口径 = 蓝图书架 2026-09-19 那次报障修复的做法**推广到全线**：
 *   **「全部」档常显，其余档只在"该维度下真有内容"时出现**（内容判定由调用方给，键与顺序仍取既有单点表）。
 * 为什么必须这样：静态全列会让玩家选进一个**必然空**的档（2026-09-14 船长「避免看不见的筛选」的原话就是这个坑）。 */

/**
 * 过滤掉"该维度下没有内容"的档（`SUB_ALL` 常显）。
 *
 * @param options 既有单点表（`MANU_TABS` / `manuSubsOf` / `SUBS_OF_KIND[kind]` / `BLUEPRINT_USE_TABS` …）
 * @param hasAny  判定"该档是否真有内容"——由调用方按自己的数据源现算（不在此处硬编码任何页面数据）
 */
export function presentSubs<T extends { key: string }>(options: readonly T[], hasAny: (key: string) => boolean): T[] {
  return options.filter((s) => s.key === SUB_ALL || hasAny(s.key))
}

/* ═══════════ 甲组补丁 · 子维度补齐（船长 2026-09-19：「这种涉及到特定分类的父分类时，将其子分类也放入」）═══════════
 * 原则：**父分类有天然子维度，就该给出子筛选**。补齐范围（船长圈定「零新维度」那一批）：
 * 物品页仓库/手册物品图鉴的 货柜→四档 · 残骸→普通/稀有 · AI 核心→档位 · 蓝图碎片→功能分组；
 * 手册蓝图图鉴的 消耗品蓝图→产物大类；市场的 残骸→普通/稀有。
 * 弹药（弹种/档位）与无人机（机型）**需新建维度表**，另议。 */

/**
 * **「子维度」的唯一判定入口**（二级 / 三级筛选）：`bucket` = 一级桶键（与 `itemBucketPasses` 同一套），
 * `sub` = 该桶下的子键；`SUB_ALL` 恒真。
 *
 * | 一级桶 | 子键 | 判据 |
 * |---|---|---|
 * | `container` | `CONTAINER_SUBS` | `containerSubKeyOf(refId)` |
 * | `wreck` | `WRECK_SUBS` | `wreckTierOf(refId)` |
 * | `aicore` | `CORE_SUBS` | `refId === 'ai-core-<子键>'`（**物品空间**：洞内实物形态；市场那侧 refId 是类型键本身，故市场仍走自己的判定） |
 * | `fragment` | `MODULE_SUBS` | `frag-<模块 id>` 反解后取 `moduleSubKeyOf(slot, 模块 id)` |
 * | `module` / `module-high·mid·low` | `MODULE_SUBS` | `moduleSubKeyOf(mod.slot, mod.id)` |
 * | `item`（货物）/ `consume` | 物品大类 | `item.kind === sub` |
 * | 其余 | — | 只认 `SUB_ALL` |
 */
export function itemSubPasses(ctx: SimContext, refId: string, bucket: string, sub: string): boolean {
  if (sub === SUB_ALL) return true
  if (bucket === 'container') {
    const it = ctx.items.get(refId)
    return it !== undefined && CONTAINER_KIND_KEYS.includes(it.kind) && containerSubKeyOf(refId) === sub
  }
  if (bucket === 'wreck') {
    // ⚠ 必须先确认"它真是残骸"：`wreckTierOf` 对**非残骸 id** 也返回 `'common'`（前缀判定的天然性质）
    const it = ctx.items.get(refId)
    return it !== undefined && it.kind === 'wreck' && wreckTierOf(refId) === sub
  }
  if (bucket === 'aicore') return refId === `ai-core-${sub}`
  if (bucket === 'fragment') {
    const modId = refId.startsWith('frag-') ? refId.slice('frag-'.length) : ''
    const mod = modId ? ctx.modules.get(modId) : undefined
    return mod !== undefined && moduleSubKeyOf(mod.slot, mod.id) === sub
  }
  if (bucket === 'module' || (RACK_KIND_KEYS as readonly string[]).includes(bucket)) {
    const mod = ctx.modules.get(refId)
    return mod !== undefined && moduleSubKeyOf(mod.slot, mod.id) === sub
  }
  // 零件两档（2026-09-20 零件体系：市场「货物」子分类 part-basic / part-advanced）
  if (sub === 'part-basic' || sub === 'part-advanced') return partSubPasses(ctx, refId, sub)
  const it = ctx.items.get(refId)
  if (!it) return false
  return it.kind === sub // item（货物）/ consume / 真实大类
}

/** 一级桶中**只装物品 / 装备**的那些（`itemSubPasses` 的适用范围；其余桶由各页自己判）
 *  ⚠ 2026-09-26：黑匣独立成市场一级类型（船长令）⇒ 它同样"只装物品"，必须登记进本表，
 *  否则市场选「黑匣」时非物品商品会落进 `subPasses` 的兜底分支。 */
export const ITEM_SPACE_BUCKETS: readonly string[] = ['item', 'container', 'consume', 'wreck', 'blackbox', 'module', ...RACK_KIND_KEYS]

/* ═══════════ 乙组 · 舰船维度（船长 2026-09-19 六条基线：⑤表收编 ＋ ⑥判定单点）═══════════
 * 「我的舰队 / 舰船仓库 / 虫洞出征编队 / 手册舰船图鉴 / 市场舰船档」五处读同一套表与同一套判定。
 * ⚠ 收敛前的**真不一致**（本组修掉）：舰队/虫洞/手册 的「类别」走**派生类别键** `core.shipCategoryKeyOf`
 *   （装甲线 = `role: 'armored'` **或** 武装舰里装甲 > 护盾），而**舰船仓库与市场**走的是原始 `role`
 *   ⇒ 同一型船在两处会落进不同类别（core 注释里本就写明这是"同源单点"）。 */

/** **我的舰队「状态」维度**（并列属性行，第一行）：全部 / 驾驶中 / AI 执勤 / 空闲 / 待维修。
 *  「全部」键 = `SUB_ALL`（基线②：下级/维度选择器一律用它；`'all'` 只留给一级选择器）。 */
export const FLEET_STATE_TABS: SubOption[] = [
  { key: SUB_ALL, label: tr("ui.IndustryPage.001") },
  { key: 'pilot', label: tr("ui.ShipPage.010") },
  { key: 'ai', label: tr("ui.ShipPage.118") },
  { key: 'idle', label: tr("ui.ShipPage.117") },
  { key: 'damaged', label: tr("ui.ShipPage.119") },
]

/** **舰船仓库「拥有」维度**（并列属性行，第一行）：全部 / 已拥有 / 未拥有。
 *  判据口径见 2026-09-14 船长裁定「乙」：**只看仓库库存**（在役舰队里的同型不算"已拥有"）。 */
export const STORE_OWN_TABS: SubOption[] = [
  { key: SUB_ALL, label: tr("ui.IndustryPage.001") },
  { key: 'owned', label: tr("ui.ShipPage.122") },
  { key: 'unowned', label: tr("ui.ShipPage.041") },
]

/** 舰船定义的最小形状（类别判据只需要 role + 盾/甲结构值） */
type ShipCategoryInput = Parameters<typeof shipCategoryKeyOf>[0]

/** **舰船「类别」维度判据（唯一入口）**：走 core 派生类别键 `shipCategoryKeyOf`
 *  （`SHIP_SUBS` 的键 = 角色/类别 id：industrial / hauler / armed / armored）。
 *  ⚠ 缺 `def`（老档/异常条目）时按 `{}` 派生——与收敛前舰队/虫洞那两处的写法**逐字一致**，
 *  不借收敛之名改这个边界行为。 */
export function shipRolePasses(def: ShipCategoryInput | undefined, role: string): boolean {
  if (role === SUB_ALL) return true
  return shipCategoryKeyOf(def ?? {}) === role
}

/** **舰船「级别」维度判据（唯一入口）**：键 = `t<级别>`（与组装机「舰船蓝图」子筛选同一张 `SHIP_TIER_SUBS` 表）。 */
export function shipTierPasses(def: { tier?: number } | undefined, tier: string): boolean {
  if (tier === SUB_ALL) return true
  return def !== undefined && `t${def.tier}` === tier
}

/* ═══════════ 丙组 · 蓝图维度（船长 2026-09-19 六条基线：⑤表收编 ＋ ⑥判定单点）═══════════
 * 「蓝图书架 / 组装机 / 手册蓝图图鉴 / 市场蓝图档」四处读同一套表；判定单点 = `bpFilterKeysOf`
 * （住在 `panels/Industry.tsx`——书架与组装机同文件共用，手册/市场各按自己的产物维度判）。 */

/** 组装机 / 蓝图书架「**门类**」维度（一级选择器 ⇒ 「全部」键用 `'all'`，基线②）：
 *  全部 / 装备蓝图 / 舰船蓝图 / 消耗品蓝图（2026-09-11 船长：「弹药蓝图改为消耗品蓝图」）。 */
export type ManuTabKey = 'all' | 'equip' | 'ship' | 'supply' | 'part' | 'plug'
/** 蓝图书架 / 手册 / 市场蓝图档的门类表（**旧口径不动**，2026-09-20 船长：「只改组装机」） */
export const MANU_TABS: Array<{ key: ManuTabKey; label: string; id: string }> = [
  { key: 'all', label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'equip', label: '装备蓝图', id: 'ui.ShipPage.115' },
  { key: 'ship', label: '舰船蓝图', id: 'ui.ShipPage.116' },
  { key: 'supply', label: '消耗品蓝图', id: 'ui.ShipPage.114' },
]
/** 组装机专用门类表（2026-09-20 船长：舰船蓝图拆去造船厂；改名去「蓝图」二字；新增「零件」分页）
 *  ⚠ **2026-09-26 船长令**：「**在工业-组装机的门类筛选中，添加舰船插件的新分类**」⇒ 补「舰船插件」一档。
 *  ⚠ **同日再令：「舰船插件要放到最后」** ⇒ 它排在这张表的**末位**（顺序 = 渲染顺序，别往前挪）。
 *  该档在**取得第一个黑匣前是锁着的**（判据 = `blackbox.plugCraftUnlockedOf`，界面侧见 Industry 面板）。 */
export const MANU_TABS_CRAFT: Array<{ key: ManuTabKey; label: string; id: string }> = [
  { key: 'all', label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'equip', label: '装备', id: 'ui.MarketPage.178' },
  { key: 'part', label: '零件', id: 'ui.itemSubs.036' },
  { key: 'supply', label: '消耗品', id: 'ui.itemSubs.037' },
  { key: 'plug', label: '舰船插件', id: 'ui.itemSubs.042' },
]

/** 组装机/书架「**子类**」候选（按当前门类给；全部取自本文件单点表）：
 *  装备 = 产物功能十组（`MODULE_SUBS`）· 舰船 = 舰船级别五档（`SHIP_TIER_SUBS`）· 消耗品 = 产物大类（`CONSUME_SUBS`）·
 *  零件 = 基础/高级两档（`PART_SUBS`，2026-09-20）；「全部」门类不带子筛选（与市场「全部类型」同款）。 */
export function manuSubsOf(tab: ManuTabKey): SubOption[] {
  if (tab === 'equip') return MODULE_SUBS
  if (tab === 'ship') return SHIP_TIER_SUBS
  if (tab === 'supply') return CONSUME_SUBS
  if (tab === 'part') return PART_SUBS
  return []
}

/** 组装机/书架「**图纸**」维度（三级；下级 ⇒ 「全部」键用 `SUB_ALL`，基线②）：
 *  全部 / 永久蓝图 / 一次性蓝图（2026-09-14 船长：「组装机添加第三个筛选…需要选完上一级子类后才出现」）。 */
export type BlueprintUseKey = 'perm' | 'single' | typeof SUB_ALL
export const BLUEPRINT_USE_TABS: Array<{ key: BlueprintUseKey; label: string; id: string }> = [
  { key: SUB_ALL, label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'perm', label: '永久蓝图', id: 'ui.itemSubs.029' },
  { key: 'single', label: '一次性蓝图', id: 'ui.itemSubs.030' },
]

/**
 * 组装机「**学会**」维度（并列属性行，**放最上一行**——船长 2026-09-19：
 * 「组装机我想添加一个过滤已有蓝图的筛选」→ 追问后定「放第一行」）：
 * 全部 / 已学会 / 未学会。判据 = `ownsBlueprint(state, id)`（core 单点）。
 * ⚠ 蓝图书架**不加**这一维：书架列的是"还没学的书 ＋ 可逆向的碎片"，按定义都未学会 ⇒ 加了恒空。
 */
export type BlueprintLearnKey = 'learned' | 'unlearned' | typeof SUB_ALL
export const BLUEPRINT_LEARN_TABS: Array<{ key: BlueprintLearnKey; label: string; id: string }> = [
  { key: SUB_ALL, label: '全部', id: 'ui.IndustryPage.001' },
  { key: 'learned', label: '已学会', id: 'ui.itemSubs.031' },
  { key: 'unlearned', label: '未学会', id: 'ui.itemSubs.032' },
]
// l10n-keep-end
