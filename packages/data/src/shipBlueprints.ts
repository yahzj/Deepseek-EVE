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
      { itemId: 'min-tritanium', count: 24_650 },
      { itemId: 'min-pyerite', count: 12_300 },
      { itemId: 'min-mexallon', count: 5_150 },
      { itemId: 'min-nocxium', count: 1_050 },
    ],
    buildSeconds: 5_160, // 开拓级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 75*60=4500）
    buildCostIsk: 250_000,
    priceIsk: 3600000,
    description: '开拓级定制艇图纸：货舱 5200 m³，9 秒循环产 38 单位——比鲸吞级高两成。',
  },
  {
    id: 'sbp-whale-king',
    name: '鲸王级舰船蓝图',
    shipId: 'whale-king',
    materials: [
      { itemId: 'min-tritanium', count: 90_450 },
      { itemId: 'min-pyerite', count: 46_500 },
      { itemId: 'min-mexallon', count: 20_650 },
      { itemId: 'min-nocxium', count: 5_150 },
    ],
    buildSeconds: 15_600, // 鲸王级（2026-09-13 工期阶梯重排：T3 带 3~5 时；原 180*60=10800）
    buildCostIsk: 900_000,
    priceIsk: 19200000,
    description: '鲸王级总装图纸：货舱 7,000 m³，8 秒循环产 58 单位。造完它，你就是深空工业的传说。',
  },
  {
    id: 'sbp-humpback',
    name: '座头鲸级舰船蓝图',
    shipId: 'sh-humpback',
    materials: [
      { itemId: 'min-tritanium', count: 32_150 },
      { itemId: 'min-pyerite', count: 14_050 },
      { itemId: 'min-mexallon', count: 5_200 },
      { itemId: 'min-isotope', count: 1_400 },
    ],
    buildSeconds: 12_960, // 座头鲸级（2026-09-13 工期阶梯重排：T3 带 3~5 时；原 90*60=5400）
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
    buildSeconds: 162_000, // 皇带鱼级（2026-09-13 工期阶梯重排：T5 = T4 带下沿 9h ×5 = 45 时；原 240*60=14400）
    buildCostIsk: 2_400_000,
    priceIsk: 22000000,
    description: '皇带鱼级旗舰货舰总装图纸（限定奇货）：三万六千立方货舱的移动要塞——材料清单本身就是一份远征地图。', // 2026-09-09 货舱数值随船校正（原描述 26000 为旧稿）
  },
  {
    id: 'sbp-burrower',
    name: '掘洞级舰船蓝图',
    shipId: 'burrower',
    materials: [
      { itemId: 'min-tritanium', count: 4_750 },
      { itemId: 'min-pyerite', count: 1_350 },
    ],
    buildSeconds: 1_260, // 掘洞级（2026-09-13 工期阶梯重排：T1 带 15~25 分；原 480）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 240000,
    description: '「掘洞级采矿艇」总装图纸：货舱 1,800 m³、循环 11 秒产 18 单位——矿族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-whale',
    name: '鲸吞级舰船蓝图',
    shipId: 'whale',
    materials: [
      { itemId: 'min-tritanium', count: 27_850 },
      { itemId: 'min-pyerite', count: 8_450 },
      { itemId: 'min-mexallon', count: 4_050 },
    ],
    buildSeconds: 4_800, // 鲸吞级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 3360）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2250000,
    description: '「鲸吞级采矿艇」总装图纸：货舱 4,500 m³、循环 10 秒产 34 单位——矿族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-bowhead',
    name: '蝠鲼级舰船蓝图',
    shipId: 'sh-bowhead',
    materials: [
      { itemId: 'min-tritanium', count: 318_000 },
      { itemId: 'min-pyerite', count: 102_000 },
      { itemId: 'min-mexallon', count: 61_000 },
      { itemId: 'min-nocxium', count: 12_000 },
    ],
    buildSeconds: 43_200, // 蝠鲼级（2026-09-13 工期阶梯重排：T4 带 9~20 时；原 7140）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 54_000_000, // = 行价 13,500,000 × 4（2026-09-13 T4 档上调后跨入 >400 万档系数）
    description: '「蝠鲼级重载货舰」总装图纸：货舱 26,000 m³、循环 36 秒产 110 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-falconet',
    name: '鲣鱼级舰船蓝图',
    shipId: 'sh-falconet',
    materials: [
      { itemId: 'min-tritanium', count: 1_650 },
      { itemId: 'min-pyerite', count: 450 },
    ],
    buildSeconds: 900, // 鲣鱼级（2026-09-13 工期阶梯重排：T1 带 15~25 分；原 180）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 84_000, // 同步：42,000 × 2
    description: '「鲣鱼级护卫舰」总装图纸：货舱 650 m³、循环 16 秒产 6 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-shrike',
    name: '马鲛级舰船蓝图',
    shipId: 'sh-shrike',
    materials: [
      { itemId: 'min-tritanium', count: 4_300 },
      { itemId: 'min-pyerite', count: 1_250 },
    ],
    buildSeconds: 1_230, // 马鲛级（2026-09-13 工期阶梯重排：T1 带 15~25 分；原 420）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 220000,
    description: '「马鲛级护卫舰」总装图纸：货舱 1,050 m³、循环 15 秒产 8 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-tigershark',
    name: '虎鲨级舰船蓝图',
    shipId: 'sh-tigershark',
    materials: [
      { itemId: 'min-tritanium', count: 9_450 },
      { itemId: 'min-pyerite', count: 2_700 },
    ],
    buildSeconds: 1_500, // 虎鲨级（2026-09-13 工期阶梯重排：T1 带 15~25 分；原 900）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 480000,
    description: '「虎鲨级武装护卫舰」总装图纸：货舱 1,500 m³、循环 14 秒产 11 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-mako',
    name: '灰鲭鲨级舰船蓝图',
    shipId: 'sh-mako',
    materials: [
      { itemId: 'min-tritanium', count: 14_850 },
      { itemId: 'min-pyerite', count: 4_500 },
      { itemId: 'min-mexallon', count: 2_150 },
    ],
    buildSeconds: 4_050, // 灰鲭鲨级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 1800）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1200000,
    description: '「灰鲭鲨级驱逐舰」总装图纸：货舱 2,300 m³、循环 13 秒产 15 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-whiteshark',
    name: '大白鲨级舰船蓝图',
    shipId: 'sh-whiteshark',
    materials: [
      { itemId: 'min-tritanium', count: 34_050 },
      { itemId: 'min-pyerite', count: 10_300 },
      { itemId: 'min-mexallon', count: 4_950 },
    ],
    buildSeconds: 5_070, // 大白鲨级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 4140）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3300000,
    description: '「大白鲨级炮舰」总装图纸：货舱 3,200 m³、循环 13 秒产 18 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-swarm',
    name: '梭鱼级舰船蓝图',
    shipId: 'sh-swarm',
    materials: [
      { itemId: 'min-tritanium', count: 19_200 },
      { itemId: 'min-pyerite', count: 5_800 },
      { itemId: 'min-mexallon', count: 2_800 },
    ],
    buildSeconds: 4_350, // 梭鱼级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 2340）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1550000,
    description: '「梭鱼级无人机护卫」总装图纸：货舱 2,600 m³、循环 13 秒产 16 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-sentinel',
    name: '王鲭级舰船蓝图',
    shipId: 'sh-sentinel',
    materials: [
      { itemId: 'min-tritanium', count: 61_450 },
      { itemId: 'min-pyerite', count: 19_500 },
      { itemId: 'min-mexallon', count: 11_700 },
      { itemId: 'min-nocxium', count: 2_350 },
    ],
    buildSeconds: 14_340, // 王鲭级（2026-09-13 工期阶梯重排：T3 带 3~5 时；原 9780）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7800000,
    description: '「王鲭级无人机母舰」总装图纸：货舱 3,600 m³、循环 13 秒产 15 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-thresher',
    name: '长尾鲨级舰船蓝图',
    shipId: 'sh-thresher',
    materials: [
      { itemId: 'min-tritanium', count: 192_400 },
      { itemId: 'min-pyerite', count: 57_400 },
      { itemId: 'min-mexallon', count: 32_400 },
      { itemId: 'min-nocxium', count: 6_300 },
      { itemId: 'min-isotope', count: 11_050 },
    ],
    buildSeconds: 16_920, // 长尾鲨级（2026-09-13 工期阶梯重排：T3 带 3~5 时，去封顶；原 14400）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 36000000,
    description: '「长尾鲨级导弹巡洋舰」总装图纸：货舱 2,600 m³、循环 14 秒产 10 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-electricray',
    name: '电鳐级舰船蓝图',
    shipId: 'sh-electricray',
    materials: [
      { itemId: 'min-tritanium', count: 320_650 },
      { itemId: 'min-pyerite', count: 95_650 },
      { itemId: 'min-mexallon', count: 54_000 },
      { itemId: 'min-nocxium', count: 10_500 },
      { itemId: 'min-isotope', count: 18_400 },
    ],
    buildSeconds: 18_000, // 电鳐级（2026-09-13 工期阶梯重排：T3 带 3~5 时，去封顶；原 14400）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 60000000,
    description: '「电鳐级激光巡洋舰」总装图纸：货舱 2,500 m³、循环 14 秒产 10 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-hammerhead',
    name: '锤头鲨级舰船蓝图',
    shipId: 'sh-hammerhead',
    materials: [
      { itemId: 'min-tritanium', count: 235_150 },
      { itemId: 'min-pyerite', count: 70_150 },
      { itemId: 'min-mexallon', count: 39_600 },
      { itemId: 'min-nocxium', count: 7_700 },
      { itemId: 'min-isotope', count: 13_500 },
    ],
    buildSeconds: 17_340, // 锤头鲨级（2026-09-13 工期阶梯重排：T3 带 3~5 时，去封顶；原 14400）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 44000000,
    description: '「锤头鲨级炮击巡洋舰」总装图纸：货舱 2,800 m³、循环 13 秒产 12 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-bullshark',
    name: '牛鲨级舰船蓝图',
    shipId: 'sh-bullshark',
    materials: [
      { itemId: 'min-tritanium', count: 277_850 },
      { itemId: 'min-pyerite', count: 82_900 },
      { itemId: 'min-mexallon', count: 46_800 },
      { itemId: 'min-nocxium', count: 9_100 },
      { itemId: 'min-isotope', count: 15_950 },
    ],
    buildSeconds: 17_700, // 牛鲨级（2026-09-13 工期阶梯重排：T3 带 3~5 时，去封顶；原 14400）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×4）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 52000000,
    description: '「牛鲨级突击巡洋舰」总装图纸：货舱 3,000 m³、循环 13 秒产 12 单位——武装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-tortoise',
    name: '陆龟级舰船蓝图',
    shipId: 'sh-tortoise',
    materials: [
      { itemId: 'min-tritanium', count: 13_900 },
      { itemId: 'min-pyerite', count: 4_200 },
      { itemId: 'min-mexallon', count: 2_050 },
    ],
    buildSeconds: 3_960, // 陆龟级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 1260）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1_125_000, // 同步：450,000 × 2.5（2026-09-13 船价跟涨）
    description: '「陆龟级重装艇」总装图纸：货舱 7,000 m³、循环 13 秒产 24 单位——重装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-hawksbill',
    name: '玳瑁级舰船蓝图',
    shipId: 'sh-hawksbill',
    materials: [
      { itemId: 'min-tritanium', count: 34_100 },
      { itemId: 'min-pyerite', count: 10_300 },
      { itemId: 'min-mexallon', count: 4_900 },
    ],
    buildSeconds: 12_540, // 玳瑁级（2026-09-13 工期阶梯重排：T3 带 3~5 时；原 2880）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3_300_000, // 同步：1,100,000 × 3（T3 档位系数；2026-09-13 船价跟涨）
    description: '「玳瑁级重装巡舰」总装图纸：货舱 12,000 m³、循环 13 秒产 22 单位——重装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-xuanwu',
    name: '玄武级舰船蓝图',
    shipId: 'sh-xuanwu',
    materials: [
      { itemId: 'min-tritanium', count: 390_000 },
      { itemId: 'min-pyerite', count: 125_000 },
      { itemId: 'min-mexallon', count: 73_000 },
      { itemId: 'min-nocxium', count: 15_000 },
    ],
    buildSeconds: 45_000, // 玄武级（2026-09-13 工期阶梯重排：T4 带 9~20 时；原 8280）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 66_000_000, // = 行价 16,500,000 × 4（2026-09-13 T4 档上调后跨入 >400 万档系数）
    description: '「玄武级重装旗舰」总装图纸：货舱 19,000 m³、循环 14 秒产 26 单位——重装舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-flyingfish',
    name: '飞鱼级舰船蓝图',
    shipId: 'sh-flyingfish',
    materials: [
      { itemId: 'min-tritanium', count: 8_250 },
      { itemId: 'min-pyerite', count: 2_350 },
    ],
    buildSeconds: 3_060, // 飞鱼级（2026-09-13 工期阶梯重排：T2 带 51~86 分；原 780）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 420000,
    description: '「飞鱼级快运舰」总装图纸：货舱 5,000 m³、循环 11 秒产 20 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-sailfish',
    name: '旗鱼级舰船蓝图',
    shipId: 'sh-sailfish',
    materials: [
      { itemId: 'min-tritanium', count: 14_850 },
      { itemId: 'min-pyerite', count: 4_500 },
      { itemId: 'min-mexallon', count: 2_150 },
    ],
    buildSeconds: 10_800, // 旗鱼级（2026-09-13 工期阶梯重排：T3 带 3~5 时；原 1800）（2026-09-09 全蓝图化；材料≈船价×0.22、蓝图=船价×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1200000,
    description: '「旗鱼级高速货舰」总装图纸：货舱 8,500 m³、循环 11 秒产 18 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-swordfish',
    name: '剑鱼级舰船蓝图',
    shipId: 'sh-swordfish',
    materials: [
      { itemId: 'min-tritanium', count: 168_000 },
      { itemId: 'min-pyerite', count: 45_000 },
      { itemId: 'min-mexallon', count: 13_800 },
    ],
    buildSeconds: 32_400, // 剑鱼级（2026-09-13 工期阶梯重排：T4 带 9~20 时；原 4680）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 19_200_000, // = 行价 4,800,000 × 4（2026-09-13 T4 档上调后跨入 >400 万档系数）
    description: '「剑鱼级大型货舰」总装图纸：货舱 14,000 m³、循环 12 秒产 16 单位——货运舰族量产线，学会即可在船坞总装。',
  },
  {
    id: 'sbp-megalodon',
    name: '巨齿鲨级舰船蓝图',
    shipId: 'sh-megalodon',
    materials: [
      { itemId: 'min-tritanium', count: 4_809_750 },
      { itemId: 'min-pyerite', count: 1_434_750 },
      { itemId: 'min-mexallon', count: 810_000 },
      { itemId: 'min-nocxium', count: 157_500 },
      { itemId: 'min-isotope', count: 276_000 },
    ],
    buildSeconds: 72_000, // 巨齿鲨级（2026-09-13 工期阶梯：T4 带 9~20 时，取带上沿）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 900_000_000, // = 行价 225,000,000 × 4（>400 万档系数；契约「舰船价格口径」守）
    description: '「巨齿鲨级战列舰」总装图纸：货舱 4,000 m³、循环 12 秒产 20 单位——掠食者武装线量产线，学会即可在船坞总装。',
  },

  /* ══════════════ 虫洞专属舰船的**一次性图纸**（2026-09-13 船长「所有舰船不掉成品，只掉一次性图纸」）
   * 五族各 3 张（护卫 / 驱逐 / 巡洋），共 15 张：**不上市场、不能学、造一艘吃掉一张**
   * （与装备一次性图纸同口径；不进碎片逆向表）。材料**必须全是矿物** ⇒ 以**虚空晶**为主 +
   * 该族特色矿物。`priceIsk = 0`（不上市场 ⇒ 无书价；定制船蓝图不参与档位系数比对）。
   * ⚠ **施工期闸门**：全部标 `unreleased: true`（手册蓝图图鉴 / 组装机蓝图下拉都遍历全目录）。 */
  {
    id: 'sbp-wh-a-frigate',
    name: '掠袭电子舰图纸（一次性）',
    shipId: 'sh-wh-a-frigate',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 3_200 },
      { itemId: 'min-mexallon', count: 2_200 },
      { itemId: 'min-voidcrystal', count: 45 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「掠袭电子舰」总装图纸，写在整块母岩切片上——**只能用一次**。锁定与分辨率冠绝同级，先看见、先锁上。',
  },
  {
    id: 'sbp-wh-a-destroyer',
    name: '掠袭炮艇图纸（一次性）',
    shipId: 'sh-wh-a-destroyer',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 28_000 },
      { itemId: 'min-pyerite', count: 7_400 },
      { itemId: 'min-mexallon', count: 5_000 },
      { itemId: 'min-voidcrystal', count: 90 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「掠袭炮艇」总装图纸，写在整块母岩切片上——**只能用一次**。动能炮阵加持，正面火力扎实。',
  },
  {
    id: 'sbp-wh-a-cruiser',
    name: '掠袭重型突击巡洋舰图纸（一次性）',
    shipId: 'sh-wh-a-cruiser',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 56_000 },
      { itemId: 'min-pyerite', count: 15_000 },
      { itemId: 'min-mexallon', count: 9_800 },
      { itemId: 'min-voidcrystal', count: 160 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「掠袭重型突击巡洋舰」总装图纸，写在整块母岩切片上——**只能用一次**。动能火力全开、甲壳同步加厚，专啃硬目标。',
  },
  {
    id: 'sbp-wh-c-frigate',
    name: '幼虫截击舰图纸（一次性）',
    shipId: 'sh-wh-c-frigate',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 13_500 },
      { itemId: 'min-mexallon', count: 3_600 },
      { itemId: 'min-isotope', count: 600 },
      { itemId: 'min-voidcrystal', count: 45 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「幼虫截击舰」总装图纸，写在整块母岩切片上——**只能用一次**。快得不像话——护盾几乎不设防，靠甲壳撑着。',
  },
  {
    id: 'sbp-wh-c-destroyer',
    name: '甲壳截击舰图纸（一次性）',
    shipId: 'sh-wh-c-destroyer',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 30_000 },
      { itemId: 'min-mexallon', count: 7_800 },
      { itemId: 'min-isotope', count: 1_400 },
      { itemId: 'min-voidcrystal', count: 90 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「甲壳截击舰」总装图纸，写在整块母岩切片上——**只能用一次**。速度与机动拉满，伤害全由甲与结构承担。',
  },
  {
    id: 'sbp-wh-c-cruiser',
    name: '巢群重型突击巡洋舰图纸（一次性）',
    shipId: 'sh-wh-c-cruiser',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 62_000 },
      { itemId: 'min-mexallon', count: 16_000 },
      { itemId: 'min-isotope', count: 3_000 },
      { itemId: 'min-voidcrystal', count: 165 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「巢群重型突击巡洋舰」总装图纸，写在整块母岩切片上——**只能用一次**。能量主炮配厚甲厚壳，正面硬碰硬。',
  },
  {
    id: 'sbp-wh-d-frigate',
    name: '哨戒电子舰图纸（一次性）',
    shipId: 'sh-wh-d-frigate',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 14_500 },
      { itemId: 'min-mexallon', count: 3_800 },
      { itemId: 'min-starcore', count: 260 },
      { itemId: 'min-voidcrystal', count: 50 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「哨戒电子舰」总装图纸，写在整块母岩切片上——**只能用一次**。锁定与分辨率远压同级，替全队先敌发现。',
  },
  {
    id: 'sbp-wh-d-destroyer',
    name: '陵卫指挥舰图纸（一次性）',
    shipId: 'sh-wh-d-destroyer',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 32_000 },
      { itemId: 'min-mexallon', count: 8_200 },
      { itemId: 'min-starcore', count: 560 },
      { itemId: 'min-darkiron', count: 140 },
      { itemId: 'min-voidcrystal', count: 95 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「陵卫指挥舰」总装图纸，写在整块母岩切片上——**只能用一次**。锁定、分辨率与机巢一并拉高，是编队的眼睛与中枢。',
  },
  {
    id: 'sbp-wh-d-cruiser',
    name: '陵寝巡洋舰图纸（一次性）',
    shipId: 'sh-wh-d-cruiser',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 68_000 },
      { itemId: 'min-mexallon', count: 17_500 },
      { itemId: 'min-starcore', count: 1_200 },
      { itemId: 'min-darkiron', count: 300 },
      { itemId: 'min-voidcrystal', count: 170 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「陵寝巡洋舰」总装图纸，写在整块母岩切片上——**只能用一次**。三层血最厚、炮位最多，站在阵线中央扛火力。',
  },
  {
    id: 'sbp-wh-e-frigate',
    name: '构件鱼雷舰图纸（一次性）',
    shipId: 'sh-wh-e-frigate',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 12_800 },
      { itemId: 'min-mexallon', count: 3_400 },
      { itemId: 'min-nocxium', count: 700 },
      { itemId: 'min-voidcrystal', count: 50 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「构件鱼雷舰」总装图纸，写在整块母岩切片上——**只能用一次**。爆破弹头拆甲，命中扎实。',
  },
  {
    id: 'sbp-wh-e-destroyer',
    name: '机库无人机作战舰图纸（一次性）',
    shipId: 'sh-wh-e-destroyer',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 29_000 },
      { itemId: 'min-mexallon', count: 7_600 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-voidcrystal', count: 95 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「机库无人机作战舰」总装图纸，写在整块母岩切片上——**只能用一次**。机巢与无人机战力双高，一座能跑的机库。',
  },
  {
    id: 'sbp-wh-e-carrier',
    name: '巨构无人机作战舰图纸（一次性）',
    shipId: 'sh-wh-e-carrier',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 60_000 },
      { itemId: 'min-mexallon', count: 15_500 },
      { itemId: 'min-nocxium', count: 3_400 },
      { itemId: 'min-darkiron', count: 260 },
      { itemId: 'min-voidcrystal', count: 175 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「巨构无人机作战舰」总装图纸，写在整块母岩切片上——**只能用一次**。机巢最大、无人机伤害最高，放飞即是主武器。',
  },
  {
    id: 'sbp-wh-g-frigate',
    name: '幽影侦察舰图纸（一次性）',
    shipId: 'sh-wh-g-frigate',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 11_500 },
      { itemId: 'min-mexallon', count: 3_000 },
      { itemId: 'min-starcore', count: 220 },
      { itemId: 'min-nocxium', count: 600 },
      { itemId: 'min-voidcrystal', count: 45 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「幽影侦察舰」总装图纸，写在整块母岩切片上——**只能用一次**。信号极小、闪避极高——它负责先看见别人。',
  },
  {
    id: 'sbp-wh-g-destroyer',
    name: '亡军后勤舰图纸（一次性）',
    shipId: 'sh-wh-g-destroyer',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 26_000 },
      { itemId: 'min-mexallon', count: 6_800 },
      { itemId: 'min-starcore', count: 520 },
      { itemId: 'min-nocxium', count: 1_400 },
      { itemId: 'min-voidcrystal', count: 85 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「亡军后勤舰」总装图纸，写在整块母岩切片上——**只能用一次**。货舱与机巢最大，跟着编队补给、换机。',
  },
  {
    id: 'sbp-wh-g-cruiser',
    name: '亡军鱼雷舰图纸（一次性）',
    shipId: 'sh-wh-g-cruiser',
    singleUse: true,
    unreleased: true,
    materials: [
      { itemId: 'min-tritanium', count: 54_000 },
      { itemId: 'min-mexallon', count: 14_000 },
      { itemId: 'min-starcore', count: 1_000 },
      { itemId: 'min-nocxium', count: 2_800 },
      { itemId: 'min-voidcrystal', count: 165 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '「亡军鱼雷舰」总装图纸，写在整块母岩切片上——**只能用一次**。爆破弹头配扎实命中，专挑大目标的装甲。',
  },
]


/** 构建舰船蓝图目录 */
export function buildShipBlueprintCatalog(): ReadonlyMap<string, ShipBlueprintDef> {
  return new Map(SHIP_BLUEPRINTS.map((bp) => [bp.id, bp]))
}
