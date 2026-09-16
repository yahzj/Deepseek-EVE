/**
 * 槽位与物品分类的展示常量（V10）。
 *
 * 说明（中文）：槽位集合是"存档结构的一部分"（FittedModules 的形状），从 v10 起
 * 固定为六槽、不再扩展；装备/界面/存档兜底一律从这里取常量，避免散落字面量。
 * 物品大类（kind）只影响展示分组与"是否能被采集/精炼"的判断，不落盘。
 */

import { DEFAULT_BALANCE } from './balance'
import type { BattleBalance, DroneClass, FittedModules, ItemDef, ItemKind, ModuleSlot, RackSlot, ShipRole, ShipSlots } from './types'

/** 槽位展示顺序（装配页从上到下的渲染顺序；V18.1 支援件排尾、V18B 武器形态随武器） */
export const MODULE_SLOTS: readonly ModuleSlot[] = [
  'miner',
  'cargo',
  'turret',
  'missile',
  'laser',
  'salvager',
  'shield',
  'armor',
  'propulsion',
  'drone-rack',
  'drone-tac',
  'drone-relay',
  'support',
  'cpu',
  'target-lock',
]

/** 槽位中文名（装配页与日志共用；V18 无人机装置家族同样落在"家族徽标"语义） */
export const SLOT_LABELS: Record<ModuleSlot, string> = {
  miner: '采集器',
  cargo: '货舱扩展',
  turret: '炮台',
  missile: '导弹架',
  laser: '激光炮',
  salvager: '打捞器',
  shield: '护盾装置',
  armor: '装甲装置',
  propulsion: '推进器',
  'drone-rack': '无人机甲板扩展',
  'drone-tac': '战术导控阵列',
  'drone-relay': '无人机中继天线',
  support: '支援件',
  cpu: '协处理器',
  'target-lock': '锁定装置',
}

/** 槽位中文名（单点实现） */
export function slotLabel(slot: ModuleSlot): string {
  return SLOT_LABELS[slot] ?? slot
}

/* ═══════════ V18：槽类（高/中/低）与归槽映射 ═══════════ */

/** 槽类展示顺序（高 → 中 → 低） */
export const RACK_SLOTS: readonly RackSlot[] = ['high', 'mid', 'low']

/** 槽类中文名（装配页分组标题/徽标） */
export const RACK_LABELS: Record<RackSlot, string> = {
  high: '高槽',
  mid: '中槽',
  low: '低槽',
}

/** 槽类中文名（单点实现） */
export function rackLabel(rack: RackSlot): string {
  return RACK_LABELS[rack] ?? rack
}

/** 船体槽位布局缺省（{1,1,1}；正式舰船数据全部显式标注 slots） */
export function shipSlotsOf(ship: { slots?: ShipSlots }): ShipSlots {
  return ship.slots ?? { high: 1, mid: 1, low: 1 }
}

/**
 * V18 模块归槽（Q3 映射单点实现）：显式 ModuleDef.rack 优先；缺省按家族/字段推导——
 * turret・missile・laser・drone-rack・drone-tac（炮台・导弹架・激光炮・无人机装置）→ high；
 * shield・propulsion（盾系・推进）→ mid；
 * **miner・salvager（采集器・打捞器）→ high**（2026-09-05 定稿高槽 → 2026-09-13 一度改判低槽
 * → **2026-09-14 船长「改回高槽」**：低槽口径下作业装备与装甲/货舱混在低槽组里，判定为错位 BUG
 * ⇒ 归位高槽，与炮台/矿枪/无人机装置同组竞争；content:check 有对应契约钉子防漂移）；
 * armor・cargo（甲系・货舱）→ low；
 * support（V18.1 支援件）必须显式标注 rack（伤害/射速 = low、命中/闪避 = mid）。
 */
export function rackOf(def: {
  slot: ModuleSlot
  rack?: RackSlot
  droneBayBonusM3?: number
  droneDmgBonus?: number
  droneRangeBonusPct?: number
}): RackSlot {
  if (def.rack !== undefined) return def.rack
  if (
    def.slot === 'turret' ||
    def.slot === 'missile' ||
    def.slot === 'laser' ||
    def.slot === 'drone-rack' ||
    def.slot === 'drone-tac' ||
    def.slot === 'drone-relay' ||
    def.slot === 'target-lock'
  )
    return 'high'
  if (def.slot === 'shield' || def.slot === 'propulsion') return 'mid'
  // 采集器 / 打捞器：高槽（船长 2026-09-14「改回高槽」——低槽口径作废）
  if (def.slot === 'miner' || def.slot === 'salvager') return 'high'
  // 2026-09-11 协处理器：低槽（与装甲/货舱/支援件同槽类竞争——占一个低槽换 CPU 预算）
  if (def.slot === 'cpu') return 'low'
  return 'low'
}

/** 物品分类展示顺序 */
export const ITEM_KIND_ORDER: readonly ItemKind[] = ['ore', 'mineral', 'gas', 'ice', 'ammo', 'drone', 'wreck', 'container', 'matter', 'essence', 'luxury', 'fragment', 'kit', 'aicore']

/** 物品分类中文名（仓库/货仓分组标题与空态文案用）
 *  ⚠ **术语（船长 2026-09-12 定）**：`ore` = 「**原矿**」（未精炼的石头，1 m³/单位）；
 *  `mineral` = 「**原材料**」（精炼产物，0.01 m³/单位）。旧称「矿石 / 矿物」作废，勿再混用。
 *  `container` = 「**货柜**」（F4 · 2026-09-13：占形状格的大件、带回后拆解）。
 *  `aicore` = 「**AI 核心**」（2026-09-14：洞内实物形态，占 1 格、撤离后自动接入核心库）。 */
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  ore: '原矿',
  mineral: '原材料',
  gas: '气体',
  ice: '冰矿',
  ammo: '弹药',
  drone: '无人机',
  wreck: '残骸',
  container: '货柜',
  matter: '谜质储存器',
  essence: '虫洞谜质', // 船长 2026-09-15：谜质精华形态（撤离成功时换算入仓库、只收不卖）
  luxury: '奢侈品', // 船长 2026-09-15：贵重品货柜拆解产物（纯贸易品、可买可卖）
  fragment: '蓝图碎片',
  kit: '修理组件',
  aicore: 'AI 核心',
}

export function itemKindLabel(kind: ItemKind): string {
  return ITEM_KIND_LABELS[kind] ?? kind
}

/** 无人机分类中文名（2026-09-10 船长拍板：界面「种类」与无人机子属性合并显示） */
export const DRONE_CLASS_LABELS: Record<DroneClass, string> = {
  scout: '侦察机',
  combat: '战斗机',
  assault: '攻坚机',
  sentry: '哨戒机',
}

/** 「种类」文案单点（2026-09-10 船长：无人机把归类子属性一起显示在种类中）：
 * 无人机 → 「无人机 · 侦察机」；其余物品 → 大类名（矿石/弹药/修理组件…）。
 * 市场行、物品仓库/货仓、图鉴/手册悬浮卡统一走此函数。 */
export function itemKindText(item: { kind: ItemKind; droneClass?: DroneClass }): string {
  const base = itemKindLabel(item.kind)
  if (item.kind === 'drone' && item.droneClass !== undefined) {
    return `${base} · ${DRONE_CLASS_LABELS[item.droneClass] ?? item.droneClass}`
  }
  return base
}

/** 舰船角色中文名（船卡徽标用；V10 占位展示；2026-09-09 船长定：industrial 展示名「工业」→「采矿」
 * ——两艘货舰分出后工业线全为矿舰，标签更直观。role id 不变，存档零迁移）
 * **2026-09-16 船长：「将重装舰类的名称改为装甲舰」** ⇒ `armored` 展示名「重装」→「**装甲**」（id 不变）。 */
export const SHIP_ROLE_LABELS: Record<ShipRole, string> = {
  industrial: '采矿',
  armed: '武装',
  armored: '装甲',
  hauler: '航运',
}

export function shipRoleLabel(role: ShipRole): string {
  return SHIP_ROLE_LABELS[role] ?? role
}

/**
 * **「装甲线」判据**（船长 2026-09-16：「**将重装舰类的名称改为装甲舰**」＋
 * 「**将装甲占比比护盾高的船也归入装甲舰**」＋丙案「**只在武装舰里判**」）：
 * - `role === 'armored'`（甲壳三艘 / C 族 / 陵墓 D 族 —— 既有装甲族）；**或**
 * - **武装舰里装甲占比 > 护盾占比**者（牛鲨级突击巡洋舰 + E 族三艘；船长同日要求「护盾和装甲互换」）。
 *
 * ⚠ **只判"类别"（显示层）**：`role` 一字不动 ⇒ 等效质量不折抵、不吃「装甲舰操作」技能、
 * 仍算战斗舰（敌方选靶「打非战斗船」口径不变）、货舱/采掘的 role 口径不变。
 */
export function isArmorLineShip(ship: { role?: ShipRole; shieldHp?: number; armorHp?: number }): boolean {
  if (ship.role === 'armored') return true
  if (ship.role !== 'armed') return false
  return (ship.armorHp ?? 0) > (ship.shieldHp ?? 0)
}

/**
 * **「类别」展示键**（我的舰队 / 手册图鉴 / 虫洞页 / 市场·图纸列 的类别筛选与徽标**同源单点**）：
 * 装甲线 ⇒ `'armored'`，其余按 `role`。改类别口径只改这一处。
 */
export function shipCategoryKeyOf(ship: { role?: ShipRole; shieldHp?: number; armorHp?: number }): ShipRole {
  return isArmorLineShip(ship) ? 'armored' : (ship.role ?? 'industrial')
}

/** 「类别」中文名（与筛选同一判据；船卡徽标与「定位 / 档次」行用） */
export function shipCategoryLabelOf(ship: { role?: ShipRole; shieldHp?: number; armorHp?: number }): string {
  return shipRoleLabel(shipCategoryKeyOf(ship))
}

/** 舰船尺寸大分类名（2026-09-09 船长定：护卫 T1 / 驱逐 T2 / 巡洋 T3 / 主力 T4 / 旗舰 T5；
 * 由等效质量落档的 tier 决定；船名内的旧规格词（炮舰/巡舰/母舰/艇…）作为子分类保留） */
export const SHIP_SIZE_CLASS: Record<number, string> = {
  1: '护卫舰',
  2: '驱逐舰',
  3: '巡洋舰',
  4: '战列舰', // 2026-09-13 船长定：T4 档名 = **战列舰**（原写「主力舰」，与词典『舰种』条口径统一）
  5: '旗舰',
}

export function shipSizeLabel(tier: number): string {
  return SHIP_SIZE_CLASS[tier] ?? ''
}

/** 可被矿船直接采集的资源大类（矿石/气体/冰矿） */
export const MINEABLE_KINDS: ReadonlySet<ItemKind> = new Set(['ore', 'gas', 'ice'])

/** 该物品是否可被采集（矿带产出物必须满足） */
export function isMineableItem(item: ItemDef | undefined): item is ItemDef {
  return !!item && MINEABLE_KINDS.has(item.kind)
}

/** 制造一艘"全新空船"的 fitted（V18：三类位数组全空；缺省 1/1/1 每类 1 位，
 * 存档兜底/新船入坞共用——长度与实际船槽位布局的对齐由 repair 链完成） */
export function emptyFitted(slots: ShipSlots = { high: 1, mid: 1, low: 1 }): FittedModules {
  return {
    high: Array<string | null>(slots.high).fill(null),
    mid: Array<string | null>(slots.mid).fill(null),
    low: Array<string | null>(slots.low).fill(null),
  }
}

/** 某槽类的位数组（fitted 内部引用，可读写；长度 = 船对应槽类数量） */
export function rackBays(fitted: FittedModules, rack: RackSlot): Array<string | null> {
  return fitted[rack]
}

/** 全部已装模块 id（跳过空位；顺序 = 高槽位序 → 中槽位序 → 低槽位序） */
export function allFittedIds(fitted: FittedModules): string[] {
  const out: string[] = []
  for (const rack of RACK_SLOTS) {
    for (const id of fitted[rack]) if (id) out.push(id)
  }
  return out
}

/* ───── 推进器周期口径文案（2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」） ───── */

/**
 * 一件装备（或一个单位）的**周期覆盖**——`undefined` = 用 `balance.battle` 的全局值。
 * 2026-09-14 船长新增「微型跃迁引擎」（件自带 10 秒点火 / 60 秒冷却）后，周期不再是全队一条常量：
 * 界面文案按**件**取值（下面三个函数的第 2 参），未写覆盖的件仍旧走全局 ⇒ 旧文案逐字不变。
 */
export interface ThrusterCycleOverride {
  boostMs?: number
  cooldownMs?: number
}

/** 从模块定义取它自己的周期覆盖（没写 = undefined ⇒ 走全局） */
export function thrusterCycleOfModule(m: {
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
}): ThrusterCycleOverride | undefined {
  return m.thrusterBoostMs === undefined && m.thrusterCooldownMs === undefined
    ? undefined
    : { boostMs: m.thrusterBoostMs, cooldownMs: m.thrusterCooldownMs }
}

/** 推进器周期秒数（点火 / 冷却）：**数值唯一出处 = `balance.battle`**（与引擎 `combat.thrusterPhase` 同源），
 *  件自带覆盖时以件为准（2026-09-14 微型跃迁引擎）。
 *  界面文案一律经下面两个函数取值，不许再写死 60——改周期只需改 `balance.ts` 或该件的两个字段。 */
export function thrusterCycleSeconds(
  bal: BattleBalance = DEFAULT_BALANCE.battle,
  cycle?: ThrusterCycleOverride,
): { boost: number; cooldown: number } {
  return {
    boost: Math.round((cycle?.boostMs ?? bal.thrusterBoostMs) / 1_000),
    cooldown: Math.round((cycle?.cooldownMs ?? bal.thrusterCooldownMs) / 1_000),
  }
}

/** 推进器周期·短缀：`点火 60 秒 / 冷却 60 秒`（换装卡 / 装备库行 / 手册网格的短效文案用） */
export function thrusterCycleText(bal: BattleBalance = DEFAULT_BALANCE.battle, cycle?: ThrusterCycleOverride): string {
  const { boost, cooldown } = thrusterCycleSeconds(bal, cycle)
  return `点火 ${boost} 秒 / 冷却 ${cooldown} 秒`
}

/** 推进器周期·全缀：`60 秒点火 / 60 秒冷却，开场即点火`（模块信息卡 / 装配页机动速度行用） */
export function thrusterCycleFullText(
  bal: BattleBalance = DEFAULT_BALANCE.battle,
  cycle?: ThrusterCycleOverride,
): string {
  const { boost, cooldown } = thrusterCycleSeconds(bal, cycle)
  return `${boost} 秒点火 / ${cooldown} 秒冷却，开场即点火`
}

/* ───── T5-B（v17）舰船实例 uid 工具（内容约定：ShipDef.id 不得含 '#'，实例号分隔符） ───── */

/** 实例 uid → 船型 id（第 1 艘 uid = 船型 id 本身，无后缀） */
export function uidDefId(uid: string): string {
  const i = uid.indexOf('#')
  return i > 0 ? uid.slice(0, i) : uid
}

/** 实例 uid → 同型序号（第 1 艘 = 1；第 N 艘 = N，来自「船型id#N」尾号） */
export function uidSeqNum(uid: string): number {
  const i = uid.indexOf('#')
  if (i < 0) return 1
  const n = Number(uid.slice(i + 1))
  return Number.isInteger(n) && n > 1 ? n : 1
}
