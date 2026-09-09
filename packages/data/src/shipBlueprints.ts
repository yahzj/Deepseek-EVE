/**
 * 舰船蓝图（M5 + V10）：用矿物制造商店买不到的定制舰船，造好入船坞。
 * V10 新增：座头鲸级（稀有现货的替代制造线）与皇带鱼级（鲸盟旗舰货舰，材料含星髓/冥铁/虚空晶；
 * 2026-09-09 船长定随船改名——原巨灵鲸级）。
 * 2026-09-09 船长定：舰船制造速度 ×2（耗时 ÷2，全 4 张）。
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
    buildSeconds: 75 * 60, // ×2 提速（原 150*60=9000s）
    buildCostIsk: 250_000,
    priceIsk: 3600000,
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
    buildSeconds: 180 * 60, // ×2 提速（原 360*60=21600s）
    buildCostIsk: 900_000,
    priceIsk: 19200000,
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
    buildSeconds: 90 * 60, // ×2 提速（原 180*60=10800s）
    buildCostIsk: 420_000,
    priceIsk: 4050000,
    description: '座头鲸级矿舰总装图纸：货舱 19000 m³、30 秒循环产 140 单位——采矿舰族的产量旗舰。', // 2026-09-09 数值随船校正（旧描述为早期稿）
  },
  {
    id: 'sbp-colossal',
    name: '皇带鱼级舰船蓝图', // 2026-09-09 船长定：随船改名（原巨灵鲸级）
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
    buildSeconds: 240 * 60, // ×2 提速（原 480*60=28800s）
    buildCostIsk: 2_400_000,
    priceIsk: 22000000,
    description: '皇带鱼级旗舰货舰总装图纸（限定奇货）：三万六千立方货舱的移动要塞——材料清单本身就是一份远征地图。', // 2026-09-09 货舱数值随船校正（原描述 26000 为旧稿）
  },
  {
    id: 'sbp-burrower',
    name: '掘洞级舰船蓝图',
    shipId: 'burrower',
    materials: [
      { itemId: 'min-tritanium', count: 2310 },
      { itemId: 'min-pyerite', count: 660 },
    ],
    buildSeconds: 480, // 掘洞级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 240000,
    description: '「掘洞级采矿艇」总装图纸：货舱 1,800 m³、循环 11 秒产 18 单位——矿族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-whale',
    name: '鲸吞级舰船蓝图',
    shipId: 'whale',
    materials: [
      { itemId: 'min-tritanium', count: 13610 },
      { itemId: 'min-pyerite', count: 4130 },
      { itemId: 'min-mexallon', count: 1980 },
    ],
    buildSeconds: 3360, // 鲸吞级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2250000,
    description: '「鲸吞级采矿艇」总装图纸：货舱 4,500 m³、循环 10 秒产 34 单位——矿族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-bowhead',
    name: '蝠鲼级舰船蓝图',
    shipId: 'sh-bowhead',
    materials: [
      { itemId: 'min-tritanium', count: 21950 },
      { itemId: 'min-pyerite', count: 6970 },
      { itemId: 'min-mexallon', count: 4180 },
      { itemId: 'min-nocxium', count: 840 },
    ],
    buildSeconds: 7140, // 蝠鲼级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5700000,
    description: '「蝠鲼级重载货舰」总装图纸：货舱 26,000 m³、循环 36 秒产 110 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-falconet',
    name: '鲣鱼级舰船蓝图',
    shipId: 'sh-falconet',
    materials: [
      { itemId: 'min-tritanium', count: 810 },
      { itemId: 'min-pyerite', count: 230 },
    ],
    buildSeconds: 180, // 鲣鱼级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 80000,
    description: '「鲣鱼级护卫舰」总装图纸：货舱 650 m³、循环 16 秒产 6 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-shrike',
    name: '马鲛级舰船蓝图',
    shipId: 'sh-shrike',
    materials: [
      { itemId: 'min-tritanium', count: 2120 },
      { itemId: 'min-pyerite', count: 610 },
    ],
    buildSeconds: 420, // 马鲛级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 220000,
    description: '「马鲛级护卫舰」总装图纸：货舱 1,050 m³、循环 15 秒产 8 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-tigershark',
    name: '虎鲨级舰船蓝图',
    shipId: 'sh-tigershark',
    materials: [
      { itemId: 'min-tritanium', count: 4620 },
      { itemId: 'min-pyerite', count: 1320 },
    ],
    buildSeconds: 900, // 虎鲨级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 480000,
    description: '「虎鲨级武装护卫舰」总装图纸：货舱 1,500 m³、循环 14 秒产 11 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-mako',
    name: '灰鲭鲨级舰船蓝图',
    shipId: 'sh-mako',
    materials: [
      { itemId: 'min-tritanium', count: 7260 },
      { itemId: 'min-pyerite', count: 2200 },
      { itemId: 'min-mexallon', count: 1060 },
    ],
    buildSeconds: 1800, // 灰鲭鲨级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1200000,
    description: '「灰鲭鲨级驱逐舰」总装图纸：货舱 2,300 m³、循环 13 秒产 15 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-whiteshark',
    name: '大白鲨级舰船蓝图',
    shipId: 'sh-whiteshark',
    materials: [
      { itemId: 'min-tritanium', count: 16640 },
      { itemId: 'min-pyerite', count: 5040 },
      { itemId: 'min-mexallon', count: 2420 },
    ],
    buildSeconds: 4140, // 大白鲨级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3300000,
    description: '「大白鲨级炮舰」总装图纸：货舱 3,200 m³、循环 13 秒产 18 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-swarm',
    name: '梭鱼级舰船蓝图',
    shipId: 'sh-swarm',
    materials: [
      { itemId: 'min-tritanium', count: 9380 },
      { itemId: 'min-pyerite', count: 2840 },
      { itemId: 'min-mexallon', count: 1360 },
    ],
    buildSeconds: 2340, // 梭鱼级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1550000,
    description: '「梭鱼级无人机护卫」总装图纸：货舱 2,600 m³、循环 13 秒产 16 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-sentinel',
    name: '王鲭级舰船蓝图',
    shipId: 'sh-sentinel',
    materials: [
      { itemId: 'min-tritanium', count: 30030 },
      { itemId: 'min-pyerite', count: 9530 },
      { itemId: 'min-mexallon', count: 5720 },
      { itemId: 'min-nocxium', count: 1140 },
    ],
    buildSeconds: 9780, // 王鲭级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7800000,
    description: '「王鲭级无人机母舰」总装图纸：货舱 3,600 m³、循环 13 秒产 15 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-thresher',
    name: '长尾鲨级舰船蓝图',
    shipId: 'sh-thresher',
    materials: [
      { itemId: 'min-tritanium', count: 94050 },
      { itemId: 'min-pyerite', count: 28050 },
      { itemId: 'min-mexallon', count: 15840 },
      { itemId: 'min-nocxium', count: 3080 },
      { itemId: 'min-isotope', count: 5400 },
    ],
    buildSeconds: 14400, // 长尾鲨级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 36000000,
    description: '「长尾鲨级导弹巡洋舰」总装图纸：货舱 2,600 m³、循环 14 秒产 10 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-electricray',
    name: '电鳐级舰船蓝图',
    shipId: 'sh-electricray',
    materials: [
      { itemId: 'min-tritanium', count: 156750 },
      { itemId: 'min-pyerite', count: 46750 },
      { itemId: 'min-mexallon', count: 26400 },
      { itemId: 'min-nocxium', count: 5130 },
      { itemId: 'min-isotope', count: 9000 },
    ],
    buildSeconds: 14400, // 电鳐级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 60000000,
    description: '「电鳐级激光巡洋舰」总装图纸：货舱 2,500 m³、循环 14 秒产 10 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-hammerhead',
    name: '锤头鲨级舰船蓝图',
    shipId: 'sh-hammerhead',
    materials: [
      { itemId: 'min-tritanium', count: 114950 },
      { itemId: 'min-pyerite', count: 34280 },
      { itemId: 'min-mexallon', count: 19360 },
      { itemId: 'min-nocxium', count: 3760 },
      { itemId: 'min-isotope', count: 6600 },
    ],
    buildSeconds: 14400, // 锤头鲨级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 44000000,
    description: '「锤头鲨级炮击巡洋舰」总装图纸：货舱 2,800 m³、循环 13 秒产 12 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-bullshark',
    name: '牛鲨级舰船蓝图',
    shipId: 'sh-bullshark',
    materials: [
      { itemId: 'min-tritanium', count: 135850 },
      { itemId: 'min-pyerite', count: 40520 },
      { itemId: 'min-mexallon', count: 22880 },
      { itemId: 'min-nocxium', count: 4450 },
      { itemId: 'min-isotope', count: 7800 },
    ],
    buildSeconds: 14400, // 牛鲨级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 52000000,
    description: '「牛鲨级突击巡洋舰」总装图纸：货舱 3,000 m³、循环 13 秒产 12 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-tortoise',
    name: '陆龟级舰船蓝图',
    shipId: 'sh-tortoise',
    materials: [
      { itemId: 'min-tritanium', count: 4990 },
      { itemId: 'min-pyerite', count: 1510 },
      { itemId: 'min-mexallon', count: 730 },
    ],
    buildSeconds: 1260, // 陆龟级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 830000,
    description: '「陆龟级重装艇」总装图纸：货舱 7,000 m³、循环 13 秒产 24 单位——重装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-hawksbill',
    name: '玳瑁级舰船蓝图',
    shipId: 'sh-hawksbill',
    materials: [
      { itemId: 'min-tritanium', count: 11500 },
      { itemId: 'min-pyerite', count: 3480 },
      { itemId: 'min-mexallon', count: 1670 },
    ],
    buildSeconds: 2880, // 玳瑁级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1900000,
    description: '「玳瑁级重装巡舰」总装图纸：货舱 12,000 m³、循环 13 秒产 22 单位——重装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-xuanwu',
    name: '玄武级舰船蓝图',
    shipId: 'sh-xuanwu',
    materials: [
      { itemId: 'min-tritanium', count: 25410 },
      { itemId: 'min-pyerite', count: 8070 },
      { itemId: 'min-mexallon', count: 4840 },
      { itemId: 'min-nocxium', count: 970 },
    ],
    buildSeconds: 8280, // 玄武级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6600000,
    description: '「玄武级重装旗舰」总装图纸：货舱 19,000 m³、循环 14 秒产 26 单位——重装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-flyingfish',
    name: '飞鱼级舰船蓝图',
    shipId: 'sh-flyingfish',
    materials: [
      { itemId: 'min-tritanium', count: 4040 },
      { itemId: 'min-pyerite', count: 1160 },
    ],
    buildSeconds: 780, // 飞鱼级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 420000,
    description: '「飞鱼级快运舰」总装图纸：货舱 5,000 m³、循环 11 秒产 20 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-sailfish',
    name: '旗鱼级舰船蓝图',
    shipId: 'sh-sailfish',
    materials: [
      { itemId: 'min-tritanium', count: 7260 },
      { itemId: 'min-pyerite', count: 2200 },
      { itemId: 'min-mexallon', count: 1060 },
    ],
    buildSeconds: 1800, // 旗鱼级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1200000,
    description: '「旗鱼级高速货舰」总装图纸：货舱 8,500 m³、循环 11 秒产 18 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-swordfish',
    name: '剑鱼级舰船蓝图',
    shipId: 'sh-swordfish',
    materials: [
      { itemId: 'min-tritanium', count: 18910 },
      { itemId: 'min-pyerite', count: 5730 },
      { itemId: 'min-mexallon', count: 2750 },
    ],
    buildSeconds: 4680, // 剑鱼级（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3750000,
    description: '「剑鱼级大型货舰」总装图纸：货舱 14,000 m³、循环 12 秒产 16 单位——货运舰族量产线，学会即可在船坞总装。',
  },
]


/** 构建舰船蓝图目录 */
export function buildShipBlueprintCatalog(): ReadonlyMap<string, ShipBlueprintDef> {
  return new Map(SHIP_BLUEPRINTS.map((bp) => [bp.id, bp]))
}
