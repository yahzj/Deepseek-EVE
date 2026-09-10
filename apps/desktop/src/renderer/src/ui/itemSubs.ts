/**
 * 「类型 → 子分类」分类表（市场页二级筛选 与 手册图鉴分组 的**唯一实现**，
 * 2026-09-10 船长：手册图鉴按类型划分、与市场子分类同口径；
 * 同日追加（船长）：**装备与装备蓝图改按槽类（高槽 / 中槽 / 低槽）分组**——
 * 原来是按功能分组（武器/护盾/装甲/推进/无人机装置…），与装配页的「高/中/低槽」不一致，
 * 现统一走 core 的归槽单点 `rackOf`（模块显式 rack 优先，缺省按槽位推导）。
 *
 * 检索入口：`grep MODULE_SUBS|SUBS_OF_KIND|moduleSubKeyOf`。
 * - 市场页 MarketPage：类型下拉的二级子分类（筛选市场商品目录）；
 * - 手册 Handbook：物品/装备/舰船/蓝图的分组标题与分组判定（同一套键与中文名，避免两页口径漂移）。
 * 新增/调整分类只改本文件，两页同时生效。
 */
import { rackOf } from '@whale/core'
import type { MarketGoodDef, ModuleSlot, RackSlot, SimContext } from '@whale/core'

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

/** 装备子类 = 槽类（高 / 中 / 低；与装配页槽位、core `rackOf` 同口径） */
export const MODULE_SUBS: SubOption[] = [
  { key: 'high', label: '高槽装备' },
  { key: 'mid', label: '中槽装备' },
  { key: 'low', label: '低槽装备' },
]

export const SHIP_SUBS: SubOption[] = [
  { key: 'industrial', label: '采矿舰' },
  { key: 'hauler', label: '货运舰' },
  { key: 'armed', label: '武装舰' },
  { key: 'armored', label: '重装舰' },
]

/** 蓝图子类：装备蓝图按**产物槽类**分三档，另有舰船蓝图与补给（弹药/修理组件）蓝图 */
export const BLUEPRINT_SUBS: SubOption[] = [
  { key: 'high', label: '高槽装备蓝图' },
  { key: 'mid', label: '中槽装备蓝图' },
  { key: 'low', label: '低槽装备蓝图' },
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
    return rackOf(mod) === sub
  }
  if (kind === 'ship') {
    const ship = ctx.ships.get(good.refId)
    return (ship?.role ?? '') === sub
  }
  if (kind === 'blueprint') {
    const eq = ctx.blueprints.get(good.refId)
    if (eq) {
      // 物品蓝图（弹药/修理组件）归补给档；模块蓝图按**产物模块的槽类**归高/中/低档
      if (eq.moduleId === undefined) return sub === 'supply'
      const mod = ctx.modules.get(eq.moduleId)
      return mod ? rackOf(mod) === sub : false
    }
    const shipBp = ctx.shipBlueprints.get(good.refId)
    return shipBp ? sub === 'ship' : false
  }
  if (kind === 'aicore') return good.refId === sub
  return true
}

/**
 * 模块 → 装备子分类键（= 槽类；手册图鉴分组用）。
 * 传整个模块（含 `rack`）最准——支援件的槽类由模块自身标注（命中/闪避 = 中槽、伤害/射速 = 低槽）；
 * 只有槽位信息时可传 `{ slot }`（按 core 归槽单点推导）。
 */
export function moduleSubKeyOf(mod: { slot: string; rack?: string }): string {
  return rackOf({ slot: mod.slot as ModuleSlot, rack: mod.rack as RackSlot | undefined })
}

/** 子分类中文名（查不到时回退原键） */
export function subLabelOf(kind: string, key: string): string {
  const list = SUBS_OF_KIND[kind] ?? []
  return list.find((s) => s.key === key)?.label ?? key
}
