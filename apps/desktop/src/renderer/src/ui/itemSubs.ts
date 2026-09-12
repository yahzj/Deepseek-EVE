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
 * 检索入口：`grep MODULE_SUBS|SUBS_OF_KIND|moduleSubKeyOf|CONSUME_SUBS|SHIP_TIER_SUBS|BLUEPRINT_SUBS`。
 * - 市场页 MarketPage：类型下拉的一级类型与二级子分类（筛选市场商品目录）；
 * - 组装机 Industry.tsx：蓝图标签行 + 二级子筛选（按蓝图产物分类，不走市场商品目录）；
 * - 手册 Handbook：装备/舰船/蓝图的分组标题与分组判定（同一套键与中文名，避免两页口径漂移）。
 * 新增/调整分类只改本文件，三处同时生效。
 */
import { rackOf, shipSizeLabel } from '@whale/core'
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

/** 「物品」类 = 除残骸与消耗品以外的物品（2026-09-11 起消耗品独立，故此处剔除三类）
 *  ⚠ 术语（船长 2026-09-12）：`ore` = **原矿**、`mineral` = **原材料**（旧称矿石/矿物作废） */
export const ITEM_SUBS: SubOption[] = [
  { key: 'ore', label: '原矿' },
  { key: 'mineral', label: '原材料' },
  { key: 'gas', label: '气体' },
  { key: 'ice', label: '冰矿' },
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
  { key: 'armored', label: '重装舰' },
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

/** 主类型 → 可用子分类（残骸 wreck 无二级；三个槽类装备类型共用装备的功能子分类） */
export const SUBS_OF_KIND: Record<string, SubOption[]> = {
  item: ITEM_SUBS,
  consume: CONSUME_SUBS,
  module: MODULE_SUBS,
  'module-high': MODULE_SUBS,
  'module-mid': MODULE_SUBS,
  'module-low': MODULE_SUBS,
  ship: SHIP_SUBS,
  blueprint: BLUEPRINT_SUBS,
  aicore: CORE_SUBS,
}

/** 子分类判定（good 是否属于所选子类；sub = SUB_ALL 恒真） */
export function subPasses(ctx: SimContext, good: MarketGoodDef, kind: string, sub: string): boolean {
  if (sub === SUB_ALL || kind === 'all' || kind === 'wreck') return true
  if (kind === 'item') {
    const it = ctx.items.get(good.refId)
    // 消耗品三类已独立成类（2026-09-11 船长），「物品」不再包含它们
    return it?.kind === sub && !CONSUME_KIND_KEYS.includes(it.kind)
  }
  if (kind === 'consume') {
    const it = ctx.items.get(good.refId)
    return it !== undefined && CONSUME_KIND_KEYS.includes(it.kind) && it.kind === sub
  }
  if (kind === 'module' || (RACK_KIND_KEYS as readonly string[]).includes(kind)) {
    const mod = ctx.modules.get(good.refId)
    if (!mod) return false
    return (MODULE_SUB_SLOTS[sub] ?? []).includes(mod.slot)
  }
  if (kind === 'ship') {
    const ship = ctx.ships.get(good.refId)
    return (ship?.role ?? '') === sub
  }
  if (kind === 'blueprint') {
    const eq = ctx.blueprints.get(good.refId)
    if (eq) {
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

/** 子分类中文名（查不到时回退原键） */
export function subLabelOf(kind: string, key: string): string {
  const list = SUBS_OF_KIND[kind] ?? []
  return list.find((s) => s.key === key)?.label ?? key
}
