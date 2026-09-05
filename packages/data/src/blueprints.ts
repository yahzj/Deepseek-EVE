/**
 * 蓝图表（M2 + V10）：ISK 购买蓝图书学习后永久可造；每次制造扣矿物材料 + 制造费 + 时间。
 *
 * V10 新增：民用档 ×3（平价常驻、新手入门）与 MK3 攻坚档 ×3（市场稀有、材料含同位聚晶/星髓晶；
 * MK3 蓝图学习需协会声望 4）。材料全部来自精炼产物（挖矿 → 精炼 → 制造闭环）。
 */

import type { BlueprintDef } from '@whale/core'

export const BLUEPRINTS: readonly BlueprintDef[] = [
  {
    id: 'bp-miner-1',
    name: '强化采集器 MK1 蓝图',
    moduleId: 'mod-miner-1',
    materials: [
      { itemId: 'min-tritanium', count: 1_200 },
      { itemId: 'min-pyerite', count: 500 },
    ],
    buildSeconds: 8 * 60,
    buildCostIsk: 8_000,
    priceIsk: 5_000,
    description: '入门蓝图：教你用三钛与类银组装第一部采集器。',
  },
  {
    id: 'bp-cargo-1',
    name: '货舱扩展 MK1 蓝图',
    moduleId: 'mod-cargo-1',
    materials: [
      { itemId: 'min-pyerite', count: 800 },
      { itemId: 'min-mexallon', count: 250 },
    ],
    buildSeconds: 10 * 60,
    buildCostIsk: 10_000,
    priceIsk: 6_000,
    description: '货舱改造图纸，需要类晶体胶体做密封衬层。',
  },
  {
    id: 'bp-miner-2',
    name: '强化采集器 MK2 蓝图',
    moduleId: 'mod-miner-2',
    materials: [
      { itemId: 'min-tritanium', count: 4_500 },
      { itemId: 'min-pyerite', count: 1_800 },
      { itemId: 'min-mexallon', count: 600 },
    ],
    buildSeconds: 50 * 60,
    buildCostIsk: 60_000,
    priceIsk: 35_000,
    description: '谐振钻头图纸：类晶体胶体谐振环 + 类银散热栅，中期工业的里程碑。',
  },
  {
    id: 'bp-cargo-2',
    name: '货舱扩展 MK2 蓝图',
    moduleId: 'mod-cargo-2',
    materials: [
      { itemId: 'min-pyerite', count: 2_200 },
      { itemId: 'min-mexallon', count: 900 },
      { itemId: 'min-nocxium', count: 200 },
    ],
    buildSeconds: 70 * 60,
    buildCostIsk: 80_000,
    priceIsk: 45_000,
    description: '折叠货舱技术，核心是超噬矿合金框架——希莫非特矿带的宝藏。',
  },
  {
    id: 'bp-turret-1',
    name: '轻型炮台 MK1（动能）蓝图',
    moduleId: 'mod-turret-kin-1',
    materials: [
      { itemId: 'min-tritanium', count: 2_000 },
      { itemId: 'min-mexallon', count: 500 },
    ],
    buildSeconds: 20 * 60,
    buildCostIsk: 20_000,
    priceIsk: 12_000,
    description: '给矿船装一门正经的轻型动能炮（协会制式弹种；高爆/能量款市场专供）。远征失利维修费太贵？先装个炮台。',
  },
  {
    id: 'bp-turret-2',
    name: '重型炮台 MK2（动能）蓝图',
    moduleId: 'mod-turret-kin-2',
    materials: [
      { itemId: 'min-mexallon', count: 1_600 },
      { itemId: 'min-nocxium', count: 500 },
      { itemId: 'min-tritanium', count: 6_000 },
    ],
    buildSeconds: 100 * 60,
    buildCostIsk: 150_000,
    priceIsk: 90_000,
    description: '重型动能炮：远程 8.2 km，全船通用、远程压制首选。深渊之门卫队也会忌惮你的船。',
  },

  // ══════════ V10 民用档（常驻平价） ══════════
  {
    id: 'bp-miner-civ',
    name: '民用采集器蓝图',
    moduleId: 'mod-miner-civ',
    materials: [
      { itemId: 'min-tritanium', count: 350 },
      { itemId: 'min-pyerite', count: 120 },
    ],
    buildSeconds: 6 * 60,
    buildCostIsk: 1_200,
    priceIsk: 2_200,
    description: '最基础的采集器图纸：造价比市场现货略低，适合练手。',
  },
  {
    id: 'bp-cargo-civ',
    name: '民用货舱扩展蓝图',
    moduleId: 'mod-cargo-civ',
    materials: [
      { itemId: 'min-pyerite', count: 220 },
      { itemId: 'min-mexallon', count: 60 },
    ],
    buildSeconds: 7 * 60,
    buildCostIsk: 1_400,
    priceIsk: 2_400,
    description: '入门货舱改装图纸，类银与类晶体的经典配方。',
  },
  {
    id: 'bp-turret-civ',
    name: '民用舰炮蓝图',
    moduleId: 'mod-turret-civ',
    materials: [
      { itemId: 'min-tritanium', count: 500 },
      { itemId: 'min-mexallon', count: 100 },
    ],
    buildSeconds: 8 * 60,
    buildCostIsk: 1_800,
    priceIsk: 2_800,
    description: '自警队制式舰炮图纸：让新手矿船也敢正眼看海盗。',
  },

  // ══════════ V10 MK3 攻坚档（稀有；材料含同位聚晶/星髓晶/冥铁） ══════════
  {
    id: 'bp-miner-3',
    name: '精密采集器 MK3 蓝图',
    moduleId: 'mod-miner-3',
    materials: [
      { itemId: 'min-tritanium', count: 14_000 },
      { itemId: 'min-pyerite', count: 5_000 },
      { itemId: 'min-mexallon', count: 2_000 },
      { itemId: 'min-isotope', count: 900 },
      { itemId: 'min-starcore', count: 250 },
    ],
    buildSeconds: 300 * 60,
    buildCostIsk: 260_000,
    priceIsk: 140_000,
    description: '精密采集器 MK3 图纸：同位聚晶谐振腔 + 星髓晶轴承（学习需声望 4）。',
  },
  {
    id: 'bp-cargo-3',
    name: '折叠货舱扩展 MK3 蓝图',
    moduleId: 'mod-cargo-3',
    materials: [
      { itemId: 'min-pyerite', count: 8_000 },
      { itemId: 'min-mexallon', count: 3_000 },
      { itemId: 'min-starcore', count: 600 },
      { itemId: 'min-darkiron', count: 150 },
    ],
    buildSeconds: 360 * 60,
    buildCostIsk: 240_000,
    priceIsk: 130_000,
    description: '折叠货舱 MK3 图纸：空间衬层需要星髓晶压铸（学习需声望 4）。',
  },
  {
    id: 'bp-turret-3',
    name: '攻坚炮台 MK3（动能）蓝图',
    moduleId: 'mod-turret-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 22_000 },
      { itemId: 'min-mexallon', count: 4_000 },
      { itemId: 'min-starcore', count: 800 },
      { itemId: 'min-darkiron', count: 250 },
    ],
    buildSeconds: 420 * 60,
    buildCostIsk: 480_000,
    priceIsk: 260_000,
    description: '攻坚炮台 MK3 图纸：冥铁炮管与星髓炮闩的杰作（学习需声望 4）。',
  },
  /* ═══ 弹药蓝图（2026-09-05 船长：基础弹可自制；单批 120 发，材料成本≈市价 55% 锚定，参数可调） ═══ */
  {
    id: 'bp-ammo-kinetic',
    name: '动能弹生产线蓝图',
    itemId: 'ammo-kinetic-l',
    outputUnits: 120,
    materials: [{ itemId: 'min-tritanium', count: 48 }], // 384 ISK ≈ 720×0.53
    buildSeconds: 10, // 船长 2026-09-06：弹药单批默认缩至 10 秒
    buildCostIsk: 12,
    priceIsk: 900,
    description: '动能弹生产线图纸：把三钛合金轧成高速实心弹（120 发/批，对护盾 ×1.5）。',
  },
  {
    id: 'bp-ammo-explosive',
    name: '爆破导弹生产线蓝图',
    itemId: 'ammo-explosive-l',
    outputUnits: 120,
    materials: [{ itemId: 'min-pyerite', count: 40 }], // 480 ISK ≈ 840×0.57
    buildSeconds: 10, // 船长 2026-09-06：弹药单批默认缩至 10 秒
    buildCostIsk: 15,
    priceIsk: 1_100,
    description: '爆破导弹生产线图纸：类银超金属冲压弹壳装填高爆装药（120 发/批，对装甲 ×1.5）。',
  },
  {
    id: 'bp-ammo-plasma',
    name: '能量弹药生产线蓝图',
    itemId: 'ammo-plasma-l',
    outputUnits: 120,
    materials: [{ itemId: 'min-mexallon', count: 26 }], // 520 ISK ≈ 960×0.54
    buildSeconds: 10, // 船长 2026-09-06：弹药单批默认缩至 10 秒
    buildCostIsk: 18,
    priceIsk: 1_300,
    description: '能量弹药生产线图纸：类晶体胶体充能电池组（120 发/批，对护盾 ×1.25）。',
  },
  /* ═══ 修理组件蓝图（2026-09-05 P2 定稿：材料≈市价 55% 锚，参数可调） ═══ */
  {
    id: 'bp-repairkit-civ',
    name: '民用修理组件蓝图',
    itemId: 'repairkit-civ',
    outputUnits: 5,
    materials: [
      { itemId: 'min-tritanium', count: 850 }, // 6,800 ISK
      { itemId: 'min-pyerite', count: 120 }, // 1,440 ISK
    ], // 8,240 ≈ 15,000(3,000×5)×0.55
    buildSeconds: 30, // 船长 2026-09-06：修理组件批产,生产时长缩至原 1/3（90s→30s）
    buildCostIsk: 600,
    priceIsk: 3_600,
    description: '民用修理组件蓝图：纳米修复材料压装（5 个/批；基础 30 HP×容量增幅）。',
  },
  {
    id: 'bp-repairkit-mil',
    name: '军用修理组件蓝图',
    itemId: 'repairkit-mil',
    outputUnits: 3,
    materials: [
      { itemId: 'min-mexallon', count: 1_100 }, // 22,000 ISK
      { itemId: 'min-pyerite', count: 1_050 }, // 12,600 ISK
    ], // 34,600 ≈ 63,000(21,000×3)×0.55
    buildSeconds: 40, // 船长 2026-09-06：修理组件批产,生产时长缩至原 1/3（120s→40s）
    buildCostIsk: 1_200,
    priceIsk: 9_000,
    description: '军用修理组件蓝图：高密度纳米修复剂封装（3 个/批；基础 70 HP×容量增幅）。',
  },
]

/** 构建"蓝图 id → 定义"目录 */
export function buildBlueprintCatalog(): ReadonlyMap<string, BlueprintDef> {
  return new Map(BLUEPRINTS.map((bp) => [bp.id, bp]))
}
