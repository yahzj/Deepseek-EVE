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
 * 检索入口：`grep MODULE_SUBS|SUBS_OF_KIND|moduleSubKeyOf|CONSUME_SUBS|SHIP_TIER_SUBS|BLUEPRINT_SUBS|RACK_SUBS`。
 * - 市场页 MarketPage：类型下拉的一级类型与二级子分类（筛选市场商品目录）；
 * - 组装机 Industry.tsx：蓝图标签行 + 二级子筛选（按蓝图产物分类，不走市场商品目录）；
 * - 手册 Handbook：装备/舰船/蓝图的分组标题与分组判定（同一套键与中文名，避免两页口径漂移），
 *   以及 2026-09-13 起的**图鉴筛选行**（一级 `RACK_SUBS`/`SHIP_SUBS`/…，二级 `MODULE_SUBS`/`SHIP_TIER_SUBS`/`RACK_SUBS`）；
 * - 物品页 ItemsPage：仓库筛选的装备二级（`RACK_SUBS`）与槽类判定（core `rackOf`）。
 * 新增/调整分类只改本文件，各处同时生效。
 */
import {
  isRareWreck,
  rackOf,
  shipCategoryKeyOf,
  shipSizeLabel,
  WORMHOLE_BP_BOX_IDS,
  WORMHOLE_MILITARY_BOX_ID,
  WORMHOLE_VALUABLES_BOX_ID,
} from '@whale/core'
import type { MarketGoodDef, SimContext } from '@whale/core'

/** 「全部子类」哨兵键（市场下拉与分组判定共用；不作为分组键） */
export const SUB_ALL = 'sub-all'

export interface SubOption {
  key: string
  label: string
}

/**
 * 「物品」的三个消耗性子类（2026-09-11 船长：「应该将消耗品独立出来」——**消耗品独立成一级类型**，
 * 并从「物品」里剔除，与当年「残骸」独立成类的口径一致）：
 * 弹药（打完就少）/ 修理组件（战斗中烧）/ 无人机（永久损失制，用一场少一批）。
 */
export const CONSUME_SUBS: SubOption[] = [
  { key: 'ammo', label: '弹药' },
  { key: 'kit', label: '修理组件' },
  { key: 'drone', label: '无人机' },
]

/** 消耗品子类键集合（市场类型判定与子分类判定共用一处） */
export const CONSUME_KIND_KEYS: readonly string[] = CONSUME_SUBS.map((s) => s.key)

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
  { key: 'safe', label: '遗迹安全货柜' },
  { key: 'bp', label: '图纸货柜' },
  { key: 'valuables', label: '贵重品货柜' },
  { key: 'military', label: '军用备货柜' },
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
  { key: 'common', label: '普通残骸' },
  { key: 'rare', label: '稀有残骸' },
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
  { key: 'ore', label: '原矿' },
  { key: 'mineral', label: '原材料' },
  { key: 'gas', label: '气体' },
  { key: 'ice', label: '冰矿' },
  // 2026-09-20 零件体系：零件在「货物」下按基础/高级两档（键 = `part-<档>`，与组装机零件门类同一套 `PART_SUBS`）
  { key: 'part-basic', label: '基础零件' },
  { key: 'part-advanced', label: '高级零件' },
  { key: 'luxury', label: '奢侈品' },
]

/** 零件「基础 / 高级」维度（2026-09-20 零件体系：组装机「零件」门类二级筛选与市场「货物」子分类共用）。
 *  键 = `part-<档>`（基础 = 隐式蓝图直接可造 / 高级 = 需学习蓝图）。 */
export const PART_SUBS: SubOption[] = [
  { key: 'part-basic', label: '基础零件' },
  { key: 'part-advanced', label: '高级零件' },
]

/** 装备子类 = 模块槽位聚合（文案玩家向；含异星原型等特殊件按槽归位） */
export const MODULE_SUBS: SubOption[] = [
  { key: 'prod', label: '采集与货舱' },
  { key: 'weapon', label: '武器' },
  { key: 'shield', label: '护盾' },
  { key: 'armor', label: '装甲' },
  { key: 'prop', label: '推进器' },
  { key: 'drone', label: '无人机装置' },
  { key: 'support', label: '支援件（辅助与维修）' },
  { key: 'cpu', label: '协处理器（CPU 扩容）' },
  { key: 'salvager', label: '打捞器' },
  { key: 'lock', label: '目标锁定' },
]

export const MODULE_SUB_SLOTS: Record<string, readonly string[]> = {
  prod: ['miner', 'cargo'],
  weapon: ['turret', 'laser', 'missile'],
  shield: ['shield'],
  armor: ['armor'],
  prop: ['propulsion'],
  drone: ['drone-rack', 'drone-tac', 'drone-relay'], // 2026-09-10 + 无人机中继天线
  support: ['support'],
  cpu: ['cpu'], // 2026-09-11 协处理器（低槽 CPU 预算扩容）
  salvager: ['salvager'],
  lock: ['target-lock'],
}

export const SHIP_SUBS: SubOption[] = [
  { key: 'industrial', label: '采矿舰' },
  { key: 'hauler', label: '货运舰' },
  { key: 'armed', label: '武装舰' },
  // 2026-09-16 船长：「将重装舰类的名称改为装甲舰」（键仍 = role id，机制零迁移）
  { key: 'armored', label: '装甲舰' },
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
export const BLUEPRINT_SUBS: SubOption[] = [
  { key: 'high', label: '高槽装备蓝图' },
  { key: 'mid', label: '中槽装备蓝图' },
  { key: 'low', label: '低槽装备蓝图' },
  ...SHIP_TIER_SUBS.map((s) => ({ key: s.key, label: `${s.label}蓝图` })),
  { key: 'supply', label: '消耗品蓝图（弹药·修理组件）' },
  // 2026-09-20 零件体系：高级零件蓝图（常驻市场）——基础零件为隐式蓝图无书，故只有高级一档
  { key: 'part-advanced', label: '零件蓝图' },
]

export const CORE_SUBS: SubOption[] = [
  { key: 'basic', label: '基础核心' },
  { key: 'gamma', label: '伽马核心' },
  { key: 'beta', label: '贝塔核心' },
  { key: 'alpha', label: '阿尔法核心' },
]

/**
 * 市场装备的三个**槽类类型**（2026-09-10 船长：移除「装备」类型，改为这三个新选项）——
 * 子分类沿用 MODULE_SUBS 的功能分组，两级筛选叠加（类型定槽类、子类定功能）。
 */
export const RACK_KIND_KEYS = ['module-high', 'module-mid', 'module-low'] as const
export type RackKind = (typeof RACK_KIND_KEYS)[number]

/** 装备槽类中文名（键 = core `rackOf` 的返回值）——**全仓唯一一份**：
 *  市场页「类型」下拉的三项（`module-high/mid/low`）、手册「装备图鉴」主筛选、
 *  手册「蓝图图鉴」装备蓝图的子筛选、物品页仓库的装备二级筛选，全部读这里。 */
export const RACK_LABELS: Record<string, string> = {
  high: '高槽装备',
  mid: '中槽装备',
  low: '低槽装备',
}

/** 装备槽类子项（顺序 = 高 / 中 / 低；手册与仓库的筛选行直接渲染这张表） */
export const RACK_SUBS: SubOption[] = (['high', 'mid', 'low'] as const).map((k) => ({
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
  blueprint: BLUEPRINT_SUBS,
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
export function subPasses(ctx: SimContext, good: MarketGoodDef, kind: string, sub: string): boolean {
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

/** 模块槽位 → 装备子分类键（手册图鉴分组用；未收录槽位返回 ''，调用方按「其它」兜底） */
export function moduleSubKeyOf(slot: string): string {
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
 * - **真实物品大类**：`ITEM_KIND_ORDER` 的 14 个（`ore/mineral/gas/ice/ammo/drone/wreck/container/matter/essence/luxury/fragment/kit/aicore`）；
 * - **`'item'`** ＝「货物」：除**残骸 / 消耗品 / 货柜**以外的物品（市场一级类型用它，2026-09-08/09-11/09-16 三次拆分的结果）；
 * - **`'module'`** ＝ 装备（任意槽类）· **`'module-high' | 'module-mid' | 'module-low'`** ＝ 按槽类（市场一级类型）；
 * - **`'consume'`** ＝ 消耗品整体（弹药/修理组件/无人机）· **`'container'`** ＝ 货柜整体；
 * - **`SUB_ALL`** ＝ 不筛（恒真）。
 */
export function itemBucketPasses(ctx: SimContext, refId: string, bucket: string): boolean {
  if (bucket === SUB_ALL || bucket === 'all') return true
  /* ── 装备域（`ctx.modules`）── */
  if (bucket === 'module' || (RACK_KIND_KEYS as readonly string[]).includes(bucket)) {
    const mod = ctx.modules.get(refId)
    if (!mod) return false
    if (bucket === 'module') return true // 「装备」= 任意槽类
    return rackOf(mod) === bucket.slice('module-'.length)
  }
  /* ── 物品域（`ctx.items`）── */
  const it = ctx.items.get(refId)
  if (!it) return false
  if (bucket === 'item') {
    if (it.kind === 'wreck') return false
    if (CONSUME_KIND_KEYS.includes(it.kind)) return false
    if (CONTAINER_KIND_KEYS.includes(it.kind)) return false
    return true
  }
  if (bucket === 'consume') return CONSUME_KIND_KEYS.includes(it.kind)
  if (bucket === 'container') return CONTAINER_KIND_KEYS.includes(it.kind)
  return it.kind === bucket // 真实大类（含 wreck / aicore / fragment …）
}

/**
 * **二级「槽类」维度的唯一判定入口**（高 / 中 / 低槽装备）——`rackOf`（core 单点）的薄包装。
 * 市场那侧的一级就是三个槽类桶，二级走**功能分组**（`moduleSubKeyOf`）；物品页仓库反过来：
 * 一级是「装备」整体、二级才是槽类 ⇒ 两处都读本函数 / 那个函数，不再各写一份。
 */
export function rackPasses(ctx: SimContext, refId: string, rack: string): boolean {
  if (rack === SUB_ALL) return true
  const mod = ctx.modules.get(refId)
  return mod !== undefined && rackOf(mod) === rack
}

/** 子分类中文名（查不到时回退原键） */
export function subLabelOf(kind: string, key: string): string {
  const list = SUBS_OF_KIND[kind] ?? []
  return list.find((s) => s.key === key)?.label ?? key
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
 * | `fragment` | `MODULE_SUBS` | `frag-<模块 id>` 反解后取 `moduleSubKeyOf(slot)` |
 * | `module` / `module-high·mid·low` | `MODULE_SUBS` | `moduleSubKeyOf(mod.slot)` |
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
    return mod !== undefined && moduleSubKeyOf(mod.slot) === sub
  }
  if (bucket === 'module' || (RACK_KIND_KEYS as readonly string[]).includes(bucket)) {
    const mod = ctx.modules.get(refId)
    return mod !== undefined && moduleSubKeyOf(mod.slot) === sub
  }
  // 零件两档（2026-09-20 零件体系：市场「货物」子分类 part-basic / part-advanced）
  if (sub === 'part-basic' || sub === 'part-advanced') return partSubPasses(ctx, refId, sub)
  const it = ctx.items.get(refId)
  if (!it) return false
  return it.kind === sub // item（货物）/ consume / 真实大类
}

/** 一级桶中**只装物品 / 装备**的那些（`itemSubPasses` 的适用范围；其余桶由各页自己判） */
export const ITEM_SPACE_BUCKETS: readonly string[] = ['item', 'container', 'consume', 'wreck', 'module', ...RACK_KIND_KEYS]

/* ═══════════ 乙组 · 舰船维度（船长 2026-09-19 六条基线：⑤表收编 ＋ ⑥判定单点）═══════════
 * 「我的舰队 / 舰船仓库 / 虫洞出征编队 / 手册舰船图鉴 / 市场舰船档」五处读同一套表与同一套判定。
 * ⚠ 收敛前的**真不一致**（本组修掉）：舰队/虫洞/手册 的「类别」走**派生类别键** `core.shipCategoryKeyOf`
 *   （装甲线 = `role: 'armored'` **或** 武装舰里装甲 > 护盾），而**舰船仓库与市场**走的是原始 `role`
 *   ⇒ 同一型船在两处会落进不同类别（core 注释里本就写明这是"同源单点"）。 */

/** **我的舰队「状态」维度**（并列属性行，第一行）：全部 / 驾驶中 / AI 执勤 / 空闲 / 待维修。
 *  「全部」键 = `SUB_ALL`（基线②：下级/维度选择器一律用它；`'all'` 只留给一级选择器）。 */
export const FLEET_STATE_TABS: SubOption[] = [
  { key: SUB_ALL, label: '全部' },
  { key: 'pilot', label: '驾驶中' },
  { key: 'ai', label: 'AI 执勤' },
  { key: 'idle', label: '空闲' },
  { key: 'damaged', label: '待维修' },
]

/** **舰船仓库「拥有」维度**（并列属性行，第一行）：全部 / 已拥有 / 未拥有。
 *  判据口径见 2026-09-14 船长裁定「乙」：**只看仓库库存**（在役舰队里的同型不算"已拥有"）。 */
export const STORE_OWN_TABS: SubOption[] = [
  { key: SUB_ALL, label: '全部' },
  { key: 'owned', label: '已拥有' },
  { key: 'unowned', label: '未拥有' },
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
export type ManuTabKey = 'all' | 'equip' | 'ship' | 'supply' | 'part'
/** 蓝图书架 / 手册 / 市场蓝图档的门类表（**旧口径不动**，2026-09-20 船长：「只改组装机」） */
export const MANU_TABS: Array<{ key: ManuTabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'equip', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
  { key: 'supply', label: '消耗品蓝图' },
]
/** 组装机专用门类表（2026-09-20 船长：舰船蓝图拆去造船厂；改名去「蓝图」二字；新增「零件」分页） */
export const MANU_TABS_CRAFT: Array<{ key: ManuTabKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'equip', label: '装备' },
  { key: 'part', label: '零件' },
  { key: 'supply', label: '消耗品' },
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
export const BLUEPRINT_USE_TABS: Array<{ key: BlueprintUseKey; label: string }> = [
  { key: SUB_ALL, label: '全部' },
  { key: 'perm', label: '永久蓝图' },
  { key: 'single', label: '一次性蓝图' },
]

/**
 * 组装机「**学会**」维度（并列属性行，**放最上一行**——船长 2026-09-19：
 * 「组装机我想添加一个过滤已有蓝图的筛选」→ 追问后定「放第一行」）：
 * 全部 / 已学会 / 未学会。判据 = `ownsBlueprint(state, id)`（core 单点）。
 * ⚠ 蓝图书架**不加**这一维：书架列的是"还没学的书 ＋ 可逆向的碎片"，按定义都未学会 ⇒ 加了恒空。
 */
export type BlueprintLearnKey = 'learned' | 'unlearned' | typeof SUB_ALL
export const BLUEPRINT_LEARN_TABS: Array<{ key: BlueprintLearnKey; label: string }> = [
  { key: SUB_ALL, label: '全部' },
  { key: 'learned', label: '已学会' },
  { key: 'unlearned', label: '未学会' },
]
