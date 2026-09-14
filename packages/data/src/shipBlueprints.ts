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
    description: '采矿艇，货舱 5,200 m³、循环 9 秒产 38 单位，比鲸吞级高两成。',
  },
  {
    id: 'sbp-whale-king',
    name: '鲸王级舰船蓝图',
    shipId: 'whale-king',
    materials: [
      { itemId: 'min-tritanium', count: 226_000 },
      { itemId: 'min-pyerite', count: 116_000 },
      { itemId: 'min-mexallon', count: 51_600 },
      { itemId: 'min-nocxium', count: 12_900 },
    ],
    buildSeconds: 17_520, // 鲸王级（2026-09-13 价位重排后按带内插值：12M ⇒ 4.9 时）
    buildCostIsk: 900_000,
    priceIsk: 48_000_000, // = 行价 12,000,000 × 4（2026-09-13 价位重排）
    description: '采矿艇，货舱 7,000 m³、循环 8 秒产 58 单位，矿族的产量顶点。',
  },
  {
    id: 'sbp-humpback',
    name: '座头鲸级舰船蓝图',
    shipId: 'sh-humpback',
    materials: [
      { itemId: 'min-tritanium', count: 240_000 },
      { itemId: 'min-pyerite', count: 78_000 },
      { itemId: 'min-mexallon', count: 39_000 },
      { itemId: 'min-isotope', count: 7_500 },
    ],
    buildSeconds: 16_920, // 座头鲸级（2026-09-13 价位重排后按带内插值：9M ⇒ 4.7 时）
    buildCostIsk: 420_000,
    priceIsk: 36_000_000, // = 行价 9,000,000 × 4（2026-09-13 价位重排）
    description: '矿舰，货舱 19,000 m³、循环 30 秒产 140 单位，矿族的产量旗舰。', // 2026-09-09 数值随船校正（旧描述为早期稿）
  },
  {
    id: 'sbp-colossal',
    name: '皇带鱼级舰船蓝图', // 2026-09-09 船长定：随船改名（原巨灵鲸级）
    shipId: 'sh-colossal',
    materials: [
      { itemId: 'min-tritanium', count: 6_880_000 },
      { itemId: 'min-pyerite', count: 3_440_000 },
      { itemId: 'min-mexallon', count: 1_548_000 },
      { itemId: 'min-nocxium', count: 258_000 },
      { itemId: 'min-isotope', count: 430_000 },
      { itemId: 'min-starcore', count: 172_000 },
      { itemId: 'min-darkiron', count: 68_800 },
      { itemId: 'min-voidcrystal', count: 10_320 },
    ],
    buildSeconds: 162_000, // 皇带鱼级（2026-09-13 工期阶梯：T5 = T4 带下沿 9h ×5 = 45 时；价位重排后不变）
    buildCostIsk: 2_400_000,
    priceIsk: 2_560_000_000, // = 行价 640,000,000 × 4（2026-09-13 价位重排：旗舰基准 8 亿 ×0.8）
    description: '旗舰货舰，货舱 36,000 m³、循环 33 秒产 129 单位，移动要塞。', // 2026-09-09 货舱数值随船校正（原描述 26000 为旧稿）
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
    description: '采矿艇，T1 起步船，货舱 1,800 m³、循环 11 秒产 18 单位。',
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
    description: '采矿艇，货舱 4,500 m³、循环 10 秒产 34 单位，矿族的量产主力。',
  },
  {
    id: 'sbp-bowhead',
    name: '蝠鲼级舰船蓝图',
    shipId: 'sh-bowhead',
    materials: [
      { itemId: 'min-tritanium', count: 1_590_000 },
      { itemId: 'min-pyerite', count: 510_000 },
      { itemId: 'min-mexallon', count: 305_000 },
      { itemId: 'min-nocxium', count: 60_000 },
    ],
    buildSeconds: 59_610, // 蝠鲼级（2026-09-13 价位重排后按带内插值：67.5M ⇒ 16.6 时）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 270_000_000, // = 行价 67,500,000 × 4（2026-09-13 价位重排）
    description: '重载货舰，货舱 26,000 m³、循环 36 秒产 110 单位，囤货主力。',
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
    description: '武装护卫舰，T1 最快的轻火力平台。',
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
    description: '武装护卫舰，火力略高于鲣鱼级，代价是航速。',
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
    description: '武装护卫舰，火力骨架更强，深空护航的常客。',
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
    description: '驱逐舰，货舱 2,300 m³、循环 13 秒产 15 单位，火力与容量都均衡。',
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
    description: '炮舰，货舱 3,200 m³、循环 13 秒产 18 单位，武装舰族的量产主力。',
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
    description: '无人机护卫，靠放飞机群替主炮撑火力。',
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
    description: '无人机母舰，货舱 3,600 m³，机巢宽裕、靠放飞机群撑火力。',
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
    description: '导弹巡洋舰，货舱 2,600 m³，靠齐射导弹先声夺人。',
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
    description: '激光巡洋舰，货舱 2,500 m³，接敌即烧穿护盾。',
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
    description: '炮击巡洋舰，货舱 2,800 m³，重炮动能阵列的中坚。',
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
    description: '突击巡洋舰，货舱 3,000 m³，厚盾重炮的咬合者。',
  },
  {
    id: 'sbp-nautilus',
    name: '鹦鹉螺级舰船蓝图',
    shipId: 'sh-nautilus',
    materials: [
      { itemId: 'min-tritanium', count: 190_000 },
      { itemId: 'min-pyerite', count: 56_000 },
      { itemId: 'min-mexallon', count: 31_000 },
      { itemId: 'min-nocxium', count: 6_000 },
      { itemId: 'min-isotope', count: 12_700 },
    ],
    buildSeconds: 16_920, // 鹦鹉螺级（2026-09-13 工期阶梯：T3 带 3~5 时；同价同档 ⇒ 与长尾鲨级同值）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 36_000_000, // = 行价 9,000,000 × 4（>400 万档系数）
    unreleased: true, // 跟随虫洞挂闸门（与 ship-nautilus 同步）
    description: '测绘巡洋舰，货舱 6,600 m³，编入队伍即扩大扫描范围一圈。',
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
    description: '轻装艇，装甲与结构远超同档，换来的航速与货舱都紧。',
  },
  {
    id: 'sbp-hawksbill',
    name: '玳瑁级舰船蓝图',
    shipId: 'sh-hawksbill',
    materials: [
      { itemId: 'min-tritanium', count: 210_000 },
      { itemId: 'min-pyerite', count: 56_000 },
      { itemId: 'min-mexallon', count: 17_400 },
    ],
    buildSeconds: 16_080, // 玳瑁级（2026-09-13 价位重排后按带内插值：6M ⇒ 4.5 时）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 24_000_000, // = 行价 6,000,000 × 4（2026-09-13 价位重排；此前与市场卡不同值，本次一并归位）
    description: '重装巡舰，货舱 12,000 m³、循环 13 秒产 22 单位，厚壳仓库。',
  },
  {
    id: 'sbp-xuanwu',
    name: '玄武级舰船蓝图',
    shipId: 'sh-xuanwu',
    materials: [
      { itemId: 'min-tritanium', count: 2_125_000 },
      { itemId: 'min-pyerite', count: 680_000 },
      { itemId: 'min-mexallon', count: 400_000 },
      { itemId: 'min-nocxium', count: 81_000 },
    ],
    buildSeconds: 62_580, // 玄武级（2026-09-13 价位重排后按带内插值：90M ⇒ 17.4 时）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 360_000_000, // = 行价 90,000,000 × 4（2026-09-13 价位重排）
    description: '重装旗舰，货舱 19,000 m³、三层血最厚，重装线的顶点。',
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
    description: '快运舰，货舱 5,000 m³、航速 430，专项跑短途快件。',
  },
  {
    id: 'sbp-sailfish',
    name: '旗鱼级舰船蓝图',
    shipId: 'sh-sailfish',
    materials: [
      { itemId: 'min-tritanium', count: 84_000 },
      { itemId: 'min-pyerite', count: 22_500 },
      { itemId: 'min-mexallon', count: 6_900 },
    ],
    buildSeconds: 14_160, // 旗鱼级（2026-09-13 价位重排后按带内插值：2.4M ⇒ 3.9 时）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7_200_000, // = 行价 2,400,000 × 3（100~400 万档系数；2026-09-13 价位重排）
    description: '高速货舰，货舱 8,500 m³、循环 11 秒产 18 单位。',
  },
  {
    id: 'sbp-swordfish',
    name: '剑鱼级舰船蓝图',
    shipId: 'sh-swordfish',
    materials: [
      { itemId: 'min-tritanium', count: 840_000 },
      { itemId: 'min-pyerite', count: 225_000 },
      { itemId: 'min-mexallon', count: 69_000 },
    ],
    buildSeconds: 48_960, // 剑鱼级（2026-09-13 价位重排后按带内插值：24M ⇒ 13.6 时）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 96_000_000, // = 行价 24,000,000 × 4（2026-09-13 价位重排）
    description: '大型货舰，货舱 14,000 m³、循环 12 秒产 16 单位。',
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
    description: '战列舰，货舱 4,000 m³，敢站在编队最前面的火力平台。',
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
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 3_200 },
      { itemId: 'min-mexallon', count: 2_200 },
      { itemId: 'min-voidcrystal', count: 45 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '掠袭电子舰，锁定与分辨率冠绝同级，先看见、先锁上。',
  },
  {
    id: 'sbp-wh-a-destroyer',
    name: '掠袭炮艇图纸（一次性）',
    shipId: 'sh-wh-a-destroyer',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 28_000 },
      { itemId: 'min-pyerite', count: 7_400 },
      { itemId: 'min-mexallon', count: 5_000 },
      { itemId: 'min-voidcrystal', count: 90 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '掠袭炮艇，动能炮阵加持，正面火力扎实。',
  },
  {
    id: 'sbp-wh-a-cruiser',
    name: '掠袭重型突击巡洋舰图纸（一次性）',
    shipId: 'sh-wh-a-cruiser',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 56_000 },
      { itemId: 'min-pyerite', count: 15_000 },
      { itemId: 'min-mexallon', count: 9_800 },
      { itemId: 'min-voidcrystal', count: 160 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '掠袭重型突击巡洋舰，动能火力全开、甲壳同步加厚，专啃硬目标。',
  },
  {
    id: 'sbp-wh-c-frigate',
    name: '幼虫截击舰图纸（一次性）',
    shipId: 'sh-wh-c-frigate',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 13_500 },
      { itemId: 'min-mexallon', count: 3_600 },
      { itemId: 'min-isotope', count: 600 },
      { itemId: 'min-voidcrystal', count: 45 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '幼虫截击舰，快得不像话，护盾几乎不设防、靠甲壳撑着。',
  },
  {
    id: 'sbp-wh-c-destroyer',
    name: '甲壳截击舰图纸（一次性）',
    shipId: 'sh-wh-c-destroyer',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 30_000 },
      { itemId: 'min-mexallon', count: 7_800 },
      { itemId: 'min-isotope', count: 1_400 },
      { itemId: 'min-voidcrystal', count: 90 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '甲壳截击舰，速度与机动拉满，伤害全由装甲与结构承担。',
  },
  {
    id: 'sbp-wh-c-cruiser',
    name: '巢群重型突击巡洋舰图纸（一次性）',
    shipId: 'sh-wh-c-cruiser',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 62_000 },
      { itemId: 'min-mexallon', count: 16_000 },
      { itemId: 'min-isotope', count: 3_000 },
      { itemId: 'min-voidcrystal', count: 165 },
    ],
    buildSeconds: 14_400, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T3 4 时；原 6000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '巢群重型突击巡洋舰，能量主炮配厚甲厚壳，正面硬碰硬。',
  },
  {
    id: 'sbp-wh-d-frigate',
    name: '哨戒电子舰图纸（一次性）',
    shipId: 'sh-wh-d-frigate',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 14_500 },
      { itemId: 'min-mexallon', count: 3_800 },
      { itemId: 'min-starcore', count: 260 },
      { itemId: 'min-voidcrystal', count: 50 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '哨戒电子舰，锁定与分辨率远压同级，替全队先敌发现。',
  },
  {
    id: 'sbp-wh-d-destroyer',
    name: '陵卫指挥舰图纸（一次性）',
    shipId: 'sh-wh-d-destroyer',
    singleUse: true,
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
    description: '陵卫指挥舰，锁定、分辨率与机巢一并拉高，是编队的眼睛与中枢。',
  },
  {
    id: 'sbp-wh-d-cruiser',
    name: '陵寝巡洋舰图纸（一次性）',
    shipId: 'sh-wh-d-cruiser',
    singleUse: true,
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
    description: '陵寝巡洋舰，三层血最厚、炮位最多，站在阵线中央扛火力。',
  },
  {
    id: 'sbp-wh-e-frigate',
    name: '构件鱼雷舰图纸（一次性）',
    shipId: 'sh-wh-e-frigate',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 12_800 },
      { itemId: 'min-mexallon', count: 3_400 },
      { itemId: 'min-nocxium', count: 700 },
      { itemId: 'min-voidcrystal', count: 50 },
    ],
    buildSeconds: 1_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T1 20 分；原 1500）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '构件鱼雷舰，爆破弹头拆甲，命中扎实。',
  },
  {
    id: 'sbp-wh-e-destroyer',
    name: '机库无人机作战舰图纸（一次性）',
    shipId: 'sh-wh-e-destroyer',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 29_000 },
      { itemId: 'min-mexallon', count: 7_600 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-voidcrystal', count: 95 },
    ],
    buildSeconds: 4_200, // 2026-09-13 工期阶梯重排（虫洞一次性图纸按档取带中值：T2 70 分；原 3000）
    buildCostIsk: 0,
    priceIsk: 0,
    description: '机库无人机作战舰，机巢与无人机战力双高，一座能跑的机库。',
  },
  {
    id: 'sbp-wh-e-carrier',
    name: '巨构无人机作战舰图纸（一次性）',
    shipId: 'sh-wh-e-carrier',
    singleUse: true,
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
    description: '巨构无人机作战舰，机巢最大、无人机伤害最高，放飞即是主武器。',
  },
  {
    id: 'sbp-wh-g-frigate',
    name: '幽影侦察舰图纸（一次性）',
    shipId: 'sh-wh-g-frigate',
    singleUse: true,
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
    description: '幽影侦察舰，信号极小、闪避极高，负责先看见别人。',
  },
  {
    id: 'sbp-wh-g-destroyer',
    name: '亡军后勤舰图纸（一次性）',
    shipId: 'sh-wh-g-destroyer',
    singleUse: true,
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
    description: '亡军后勤舰，货舱与机巢最大，跟着编队补给、换机。',
  },
  {
    id: 'sbp-wh-g-cruiser',
    name: '亡军鱼雷舰图纸（一次性）',
    shipId: 'sh-wh-g-cruiser',
    singleUse: true,
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
    description: '亡军鱼雷舰，爆破弹头配扎实命中，专挑大目标的装甲。',
  },

  /* ══════════════ T3/T4/T5 的**一次性蓝图**（2026-09-13 船长：「给T3船也添加一次性蓝图」＋
   *  「T4T5舰船都出一张一次性蓝图，价格按照舰船价格的100%算」＋「还是有惩罚吧，按50%算」）
   *
   * 口径（六条）：
   * ① **价格 = 该舰市场行价 × 50%**（**2026-09-14 船长改判**：「将一次性蓝图的价格下调到舰船的
   *    0.5倍」——原「×100%」作废；不是永久图纸的 ×3/×4——它买的是"一艘船"的资格）；
   * ② `singleUse: true` ⇒ **造一艘吃掉一张**（与虫洞 15 张同机制，`manufacturing.ts` 现成通路）；
   * ③ **材料与工期与同舰永久蓝图逐字相同**（造出来是同一艘船）；
   * ④ **不进碎片逆向配方表**（契约「一次性图纸不得出现在碎片逆向配方表」守）；
   * ⑤ 市场渠道：**T3 十张 + 剑鱼/蝠鲼 = 稀有订单层（数字 3）**；**玄武/巨齿鲨/皇带鱼 = 奇货（数字 4）**；
   * ⑥ 权重：`blueprintWeight` 对一次性舰船蓝图 = **×0.5**（普通蓝图仍 ×0.05）。
   * ⚠ 邓氏鱼级（T5 武装）仍是壳体（无价、无市场行）⇒ 本轮不出它的一次性图纸。 */
  {
    id: 'sbp-once-sailfish',
    name: '旗鱼级舰船蓝图（一次性）',
    shipId: 'sh-sailfish',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 84_000 },
      { itemId: 'min-pyerite', count: 22_500 },
      { itemId: 'min-mexallon', count: 6_900 },
    ],
    buildSeconds: 14_160,
    buildCostIsk: 0,
    priceIsk: 1_200_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%） // = 行价 ×100%
    description: '高速货舰，货舱 8,500 m³、循环 11 秒产 18 单位。',
  },
  {
    id: 'sbp-once-sentinel',
    name: '王鲭级舰船蓝图（一次性）',
    shipId: 'sh-sentinel',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 61_450 },
      { itemId: 'min-pyerite', count: 19_500 },
      { itemId: 'min-mexallon', count: 11_700 },
      { itemId: 'min-nocxium', count: 2_350 },
    ],
    buildSeconds: 14_340,
    buildCostIsk: 0,
    priceIsk: 1_300_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '无人机母舰，货舱 3,600 m³，机巢宽裕、靠放飞机群撑火力。',
  },
  {
    id: 'sbp-once-hawksbill',
    name: '玳瑁级舰船蓝图（一次性）',
    shipId: 'sh-hawksbill',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 210_000 },
      { itemId: 'min-pyerite', count: 56_000 },
      { itemId: 'min-mexallon', count: 17_400 },
    ],
    buildSeconds: 16_080,
    buildCostIsk: 0,
    priceIsk: 3_000_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '重装巡舰，货舱 12,000 m³、循环 13 秒产 22 单位，厚壳仓库。',
  },
  {
    id: 'sbp-once-humpback',
    name: '座头鲸级舰船蓝图（一次性）',
    shipId: 'sh-humpback',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 240_000 },
      { itemId: 'min-pyerite', count: 78_000 },
      { itemId: 'min-mexallon', count: 39_000 },
      { itemId: 'min-isotope', count: 7_500 },
    ],
    buildSeconds: 16_920,
    buildCostIsk: 0,
    priceIsk: 4_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '矿舰，货舱 19,000 m³、循环 30 秒产 140 单位，矿族的产量旗舰。',
  },
  {
    id: 'sbp-once-thresher',
    name: '长尾鲨级舰船蓝图（一次性）',
    shipId: 'sh-thresher',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 192_400 },
      { itemId: 'min-pyerite', count: 57_400 },
      { itemId: 'min-mexallon', count: 32_400 },
      { itemId: 'min-nocxium', count: 6_300 },
      { itemId: 'min-isotope', count: 11_050 },
    ],
    buildSeconds: 16_920,
    buildCostIsk: 0,
    priceIsk: 4_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '导弹巡洋舰，货舱 2,600 m³，靠齐射导弹先声夺人。',
  },
  {
    id: 'sbp-once-nautilus',
    name: '鹦鹉螺级舰船蓝图（一次性）',
    shipId: 'sh-nautilus',
    singleUse: true,
    unreleased: true, // 与舰体同步：施工期跟随虫洞挂闸门
    materials: [
      { itemId: 'min-tritanium', count: 190_000 },
      { itemId: 'min-pyerite', count: 56_000 },
      { itemId: 'min-mexallon', count: 31_000 },
      { itemId: 'min-nocxium', count: 6_000 },
      { itemId: 'min-isotope', count: 12_700 },
    ],
    buildSeconds: 16_920,
    buildCostIsk: 0,
    priceIsk: 4_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '测绘巡洋舰，货舱 6,600 m³，编入队伍即扩大扫描范围一圈。',
  },
  {
    id: 'sbp-once-hammerhead',
    name: '锤头鲨级舰船蓝图（一次性）',
    shipId: 'sh-hammerhead',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 235_150 },
      { itemId: 'min-pyerite', count: 70_150 },
      { itemId: 'min-mexallon', count: 39_600 },
      { itemId: 'min-nocxium', count: 7_700 },
      { itemId: 'min-isotope', count: 13_500 },
    ],
    buildSeconds: 17_340,
    buildCostIsk: 0,
    priceIsk: 5_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '炮击巡洋舰，货舱 2,800 m³，重炮动能阵列的中坚。',
  },
  {
    id: 'sbp-once-whale-king',
    name: '鲸王级舰船蓝图（一次性）',
    shipId: 'whale-king',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 226_000 },
      { itemId: 'min-pyerite', count: 116_000 },
      { itemId: 'min-mexallon', count: 51_600 },
      { itemId: 'min-nocxium', count: 12_900 },
    ],
    buildSeconds: 17_520,
    buildCostIsk: 0,
    priceIsk: 6_000_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '采矿艇，货舱 7,000 m³、循环 8 秒产 58 单位，矿族的产量顶点。',
  },
  {
    id: 'sbp-once-bullshark',
    name: '牛鲨级舰船蓝图（一次性）',
    shipId: 'sh-bullshark',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 277_850 },
      { itemId: 'min-pyerite', count: 82_900 },
      { itemId: 'min-mexallon', count: 46_800 },
      { itemId: 'min-nocxium', count: 9_100 },
      { itemId: 'min-isotope', count: 15_950 },
    ],
    buildSeconds: 17_700,
    buildCostIsk: 0,
    priceIsk: 6_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '突击巡洋舰，货舱 3,000 m³，厚盾重炮的咬合者。',
  },
  {
    id: 'sbp-once-electricray',
    name: '电鳐级舰船蓝图（一次性）',
    shipId: 'sh-electricray',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 320_650 },
      { itemId: 'min-pyerite', count: 95_650 },
      { itemId: 'min-mexallon', count: 54_000 },
      { itemId: 'min-nocxium', count: 10_500 },
      { itemId: 'min-isotope', count: 18_400 },
    ],
    buildSeconds: 18_000,
    buildCostIsk: 0,
    priceIsk: 7_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '激光巡洋舰，货舱 2,500 m³，接敌即烧穿护盾。',
  },
  {
    id: 'sbp-once-swordfish',
    name: '剑鱼级舰船蓝图（一次性）',
    shipId: 'sh-swordfish',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 840_000 },
      { itemId: 'min-pyerite', count: 225_000 },
      { itemId: 'min-mexallon', count: 69_000 },
    ],
    buildSeconds: 48_960,
    buildCostIsk: 0,
    priceIsk: 12_000_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '大型货舰，货舱 14,000 m³、循环 12 秒产 16 单位。',
  },
  {
    id: 'sbp-once-bowhead',
    name: '蝠鲼级舰船蓝图（一次性）',
    shipId: 'sh-bowhead',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 1_590_000 },
      { itemId: 'min-pyerite', count: 510_000 },
      { itemId: 'min-mexallon', count: 305_000 },
      { itemId: 'min-nocxium', count: 60_000 },
    ],
    buildSeconds: 59_610,
    buildCostIsk: 0,
    priceIsk: 33_750_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '重载货舰，货舱 26,000 m³、循环 36 秒产 110 单位，囤货主力。',
  },
  {
    id: 'sbp-once-xuanwu',
    name: '玄武级舰船蓝图（一次性）',
    shipId: 'sh-xuanwu',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 2_125_000 },
      { itemId: 'min-pyerite', count: 680_000 },
      { itemId: 'min-mexallon', count: 400_000 },
      { itemId: 'min-nocxium', count: 81_000 },
    ],
    buildSeconds: 62_580,
    buildCostIsk: 0,
    priceIsk: 45_000_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '重装旗舰，货舱 19,000 m³、三层血最厚，重装线的顶点。',
  },
  {
    id: 'sbp-once-megalodon',
    name: '巨齿鲨级舰船蓝图（一次性）',
    shipId: 'sh-megalodon',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 4_809_750 },
      { itemId: 'min-pyerite', count: 1_434_750 },
      { itemId: 'min-mexallon', count: 810_000 },
      { itemId: 'min-nocxium', count: 157_500 },
      { itemId: 'min-isotope', count: 276_000 },
    ],
    buildSeconds: 72_000,
    buildCostIsk: 0,
    priceIsk: 112_500_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '战列舰，货舱 4,000 m³，敢站在编队最前面的火力平台。',
  },
  {
    id: 'sbp-once-colossal',
    name: '皇带鱼级舰船蓝图（一次性）',
    shipId: 'sh-colossal',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 6_880_000 },
      { itemId: 'min-pyerite', count: 3_440_000 },
      { itemId: 'min-mexallon', count: 1_548_000 },
      { itemId: 'min-nocxium', count: 258_000 },
      { itemId: 'min-isotope', count: 430_000 },
      { itemId: 'min-starcore', count: 172_000 },
      { itemId: 'min-darkiron', count: 68_800 },
      { itemId: 'min-voidcrystal', count: 10_320 },
    ],
    buildSeconds: 162_000,
    buildCostIsk: 0,
    priceIsk: 320_000_000, // = 行价 ×50%（2026-09-14 船长改判：原 ×100%）
    description: '旗舰货舰，货舱 36,000 m³、循环 33 秒产 129 单位，移动要塞。',
  },
]


/** 构建舰船蓝图目录 */
export function buildShipBlueprintCatalog(): ReadonlyMap<string, ShipBlueprintDef> {
  return new Map(SHIP_BLUEPRINTS.map((bp) => [bp.id, bp]))
}
