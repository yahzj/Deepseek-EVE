/**
 * 槽位与物品分类的展示常量（V10）。
 *
 * 说明（中文）：槽位集合是"存档结构的一部分"（FittedModules 的形状），从 v10 起
 * 固定为六槽、不再扩展；装备/界面/存档兜底一律从这里取常量，避免散落字面量。
 * 物品大类（kind）只影响展示分组与"是否能被采集/精炼"的判断，不落盘。
 */

import type { FittedModules, ItemDef, ItemKind, ModuleSlot, RackSlot, ShipRole, ShipSlots } from './types'

/** 槽位展示顺序（装配页从上到下的渲染顺序） */
export const MODULE_SLOTS: readonly ModuleSlot[] = ['miner', 'cargo', 'turret', 'shield', 'armor', 'propulsion']

/** 槽位中文名（装配页与日志共用；V18 无人机装置家族同样落在"家族徽标"语义） */
export const SLOT_LABELS: Record<ModuleSlot, string> = {
  miner: '采集器',
  cargo: '货舱扩展',
  turret: '炮台',
  shield: '护盾装置',
  armor: '装甲装置',
  propulsion: '推进器',
  'drone-rack': '无人机甲板扩展',
  'drone-tac': '战术导控阵列',
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
 * turret・miner（炮台・采集器）→ high；shield・propulsion（盾系・推进）→ mid；
 * armor・cargo（甲系・货舱）→ low；无人机装置（droneBayBonusM3/droneDmgBonus 字段）→ high。
 */
export function rackOf(def: { slot: ModuleSlot; rack?: RackSlot; droneBayBonusM3?: number; droneDmgBonus?: number }): RackSlot {
  if (def.rack !== undefined) return def.rack
  if (def.slot === 'turret' || def.slot === 'miner' || def.slot === 'drone-rack' || def.slot === 'drone-tac') return 'high'
  if (def.slot === 'shield' || def.slot === 'propulsion') return 'mid'
  return 'low'
}

/** 物品分类展示顺序 */
export const ITEM_KIND_ORDER: readonly ItemKind[] = ['ore', 'mineral', 'gas', 'ice', 'ammo', 'drone']

/** 物品分类中文名（仓库/货仓分组标题与空态文案用） */
export const ITEM_KIND_LABELS: Record<ItemKind, string> = {
  ore: '矿石',
  mineral: '矿物',
  gas: '气体',
  ice: '冰矿',
  ammo: '弹药',
  drone: '无人机',
}

export function itemKindLabel(kind: ItemKind): string {
  return ITEM_KIND_LABELS[kind] ?? kind
}

/** 舰船角色中文名（船卡徽标用；V10 占位展示） */
export const SHIP_ROLE_LABELS: Record<ShipRole, string> = {
  industrial: '工业',
  armed: '武装',
  armored: '重装',
  hauler: '航运',
}

export function shipRoleLabel(role: ShipRole): string {
  return SHIP_ROLE_LABELS[role] ?? role
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
