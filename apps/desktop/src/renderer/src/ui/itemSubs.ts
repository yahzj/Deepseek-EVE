/**
 * 「类型 → 子分类」分类表（市场页二级筛选 与 手册图鉴分组 的**唯一实现**，
 * 2026-09-10 船长：手册图鉴按类型划分、与市场子分类同口径）。
 *
 * 检索入口：`grep MODULE_SUBS|SUBS_OF_KIND|moduleSubKeyOf`。
 * - 市场页 MarketPage：类型下拉的二级子分类（筛选市场商品目录）；
 * - 手册 Handbook：物品/装备/舰船/蓝图的分组标题与分组判定（同一套键与中文名，避免两页口径漂移）。
 * 新增/调整分类只改本文件，两页同时生效。
 */
import type { MarketGoodDef, SimContext } from '@whale/core'

/** 「全部子类」哨兵键（市场下拉与分组判定共用；不作为分组键） */
export const SUB_ALL = 'sub-all'

export interface SubOption {
  key: string
  label: string
}

export const ITEM_SUBS: SubOption[] = [
  { key: 'ore', label: '矿石' },
  { key: 'mineral', label: '矿物' },
  { key: 'gas', label: '气体' },
  { key: 'ice', label: '冰矿' },
  { key: 'ammo', label: '弹药' },
  { key: 'drone', label: '无人机' },
  { key: 'kit', label: '修理组件' },
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
  salvager: ['salvager'],
  lock: ['target-lock'],
}

export const SHIP_SUBS: SubOption[] = [
  { key: 'industrial', label: '采矿舰' },
  { key: 'hauler', label: '货运舰' },
  { key: 'armed', label: '武装舰' },
  { key: 'armored', label: '重装舰' },
]

export const BLUEPRINT_SUBS: SubOption[] = [
  { key: 'module', label: '装备蓝图' },
  { key: 'ship', label: '舰船蓝图' },
  { key: 'supply', label: '补给蓝图（弹药·修理组件）' },
]

export const CORE_SUBS: SubOption[] = [
  { key: 'basic', label: '基础核心' },
  { key: 'gamma', label: '伽马核心' },
  { key: 'beta', label: '贝塔核心' },
  { key: 'alpha', label: '阿尔法核心' },
]

/** 主类型 → 可用子分类（残骸 wreck 无二级） */
export const SUBS_OF_KIND: Record<string, SubOption[]> = {
  item: ITEM_SUBS,
  module: MODULE_SUBS,
  ship: SHIP_SUBS,
  blueprint: BLUEPRINT_SUBS,
  aicore: CORE_SUBS,
}

/** 子分类判定（good 是否属于所选子类；sub = SUB_ALL 恒真） */
export function subPasses(ctx: SimContext, good: MarketGoodDef, kind: string, sub: string): boolean {
  if (sub === SUB_ALL || kind === 'all' || kind === 'wreck') return true
  if (kind === 'item') {
    const it = ctx.items.get(good.refId)
    return it?.kind === sub
  }
  if (kind === 'module') {
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
    if (eq) return eq.moduleId !== undefined ? sub === 'module' : sub === 'supply'
    const shipBp = ctx.shipBlueprints.get(good.refId)
    return shipBp ? sub === 'ship' : false
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
