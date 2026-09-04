/**
 * 槽位与物品分类的展示常量（V10）。
 *
 * 说明（中文）：槽位集合是"存档结构的一部分"（FittedModules 的形状），从 v10 起
 * 固定为六槽、不再扩展；装备/界面/存档兜底一律从这里取常量，避免散落字面量。
 * 物品大类（kind）只影响展示分组与"是否能被采集/精炼"的判断，不落盘。
 */

import type { ItemDef, ItemKind, ModuleSlot, ShipRole } from './types'

/** 槽位展示顺序（装配页从上到下的渲染顺序） */
export const MODULE_SLOTS: readonly ModuleSlot[] = ['miner', 'cargo', 'turret', 'shield', 'armor', 'propulsion']

/** 槽位中文名（装配页与日志共用） */
export const SLOT_LABELS: Record<ModuleSlot, string> = {
  miner: '采集器槽',
  cargo: '货舱槽',
  turret: '炮台槽',
  shield: '护盾槽',
  armor: '装甲槽',
  propulsion: '推进器槽',
}

/** 槽位中文名（单点实现） */
export function slotLabel(slot: ModuleSlot): string {
  return SLOT_LABELS[slot] ?? slot
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

/** 制造一艘"全新空船"的 fitted（六槽全空）；存档兜底/新船入坞共用 */
export function emptyFitted(): Record<ModuleSlot, string | null> {
  const fitted = {} as Record<ModuleSlot, string | null>
  for (const slot of MODULE_SLOTS) fitted[slot] = null
  return fitted
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
