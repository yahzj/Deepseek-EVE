/**
 * 舰船蓝图（M5 + V10）：用矿物制造商店买不到的定制舰船，造好入船坞。
 * V10 新增：座头鲸级（稀有现货的替代制造线）与巨灵鲸级（旗舰货舰，材料含星髓/冥铁/虚空晶）。
 */

import type { ShipBlueprintDef } from '@whale/core'

export const SHIP_BLUEPRINTS: readonly ShipBlueprintDef[] = [
  {
    id: 'sbp-pioneer',
    name: '开拓级舰船蓝图',
    shipId: 'pioneer',
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 6_000 },
      { itemId: 'min-mexallon', count: 2_500 },
      { itemId: 'min-nocxium', count: 500 },
    ],
    buildSeconds: 150 * 60,
    buildCostIsk: 250_000,
    priceIsk: 150_000,
    description: '开拓级定制艇图纸：货舱 5200 m³，9 秒循环产 38 单位——比鲸吞级高两成。',
  },
  {
    id: 'sbp-whale-king',
    name: '鲸王级舰船蓝图',
    shipId: 'whale-king',
    materials: [
      { itemId: 'min-tritanium', count: 35_000 },
      { itemId: 'min-pyerite', count: 18_000 },
      { itemId: 'min-mexallon', count: 8_000 },
      { itemId: 'min-nocxium', count: 2_000 },
    ],
    buildSeconds: 360 * 60,
    buildCostIsk: 900_000,
    priceIsk: 600_000,
    description: '鲸王级总装图纸：货舱 10000 m³，8 秒循环产 58 单位。造完它，你就是深空工业的传说。',
  },
  {
    id: 'sbp-humpback',
    name: '座头鲸级舰船蓝图',
    shipId: 'sh-humpback',
    materials: [
      { itemId: 'min-tritanium', count: 16_000 },
      { itemId: 'min-pyerite', count: 7_000 },
      { itemId: 'min-mexallon', count: 2_600 },
      { itemId: 'min-isotope', count: 700 },
    ],
    buildSeconds: 180 * 60,
    buildCostIsk: 420_000,
    priceIsk: 260_000,
    description: '座头鲸级矿舰总装图纸（V10）：货舱 9000 m³、10 秒循环产 40 单位——比鲸吞级更能装更能挖。',
  },
  {
    id: 'sbp-colossal',
    name: '巨灵鲸级舰船蓝图',
    shipId: 'sh-colossal',
    materials: [
      { itemId: 'min-tritanium', count: 80_000 },
      { itemId: 'min-pyerite', count: 40_000 },
      { itemId: 'min-mexallon', count: 18_000 },
      { itemId: 'min-nocxium', count: 3_000 },
      { itemId: 'min-isotope', count: 5_000 },
      { itemId: 'min-starcore', count: 2_000 },
      { itemId: 'min-darkiron', count: 800 },
      { itemId: 'min-voidcrystal', count: 120 },
    ],
    buildSeconds: 480 * 60,
    buildCostIsk: 2_400_000,
    priceIsk: 900_000,
    description: '巨灵鲸级旗舰货舰总装图纸（V10 限定奇货）：货舱 26000 m³ 的移动要塞——材料清单本身就是一份远征地图。',
  },
]

/** 构建舰船蓝图目录 */
export function buildShipBlueprintCatalog(): ReadonlyMap<string, ShipBlueprintDef> {
  return new Map(SHIP_BLUEPRINTS.map((bp) => [bp.id, bp]))
}
