/**
 * 蓝图表（M2 + V10）：信用点 购买蓝图书学习后永久可造；每次制造扣矿物材料 + 时间
 * （制造费 2026-09-08 船长定取消；buildCostIsk 字段保留为历史遗留数据）。
 *
 * V10 新增：民用档 ×3（平价常驻、新手入门）与 MK3 攻坚档 ×3（市场稀有、材料含同位聚晶/星髓晶；
 * MK3 蓝图学习需协会声望 4）。材料全部来自精炼产物（挖矿 → 精炼 → 制造闭环）。
 *
 * **2026-09-11 船长：「调整所有蓝图到合适价格」→ 裁决「甲」**：装备/物品蓝图书价一律按
 * **档位系数**定——`奇货 ×4 · 民用/基础/MK1 ×2 · MK2 ×2.5 · MK3 ×3`（乘**产物现货价**，取整到 500 信用点）；
 * 系数即**默认值**，个例可用 `BLUEPRINT_PRICE_OVERRIDES` 单独覆盖（船长同日：「如果有单独调整过的则允许覆盖默认值」）。
 * 单点实现 = `blueprintTierCoefOf()`（下方），`tools/content-check.ts` 的「蓝图价格口径契约」据此校验。
 * 背景：2026-09-10「MK2/MK3 装备价对齐同级武器价」那次只改了成品价、**书价没跟**，
 * 导致 91 张里 56 张的「书价 ÷ 产物价」漂移到 0.18~1.88（武器线与新件是合规的 2/2.5/3）。
 */

import type { BlueprintDef, MarketRarity } from '@whale/core'

/**
 * 装备/物品蓝图的**档位系数**（2026-09-11 船长裁决「甲」+ 同日复核补正）：
 * - **奇货档（市场稀有度 `exotic`）默认 ×4**（船长：「蓝图价格排除奇货档。奇货档默认 4 倍」）——
 *   奇货**不参与** MK 档阶梯，单列一档；
 * - 其余按蓝图 id 后缀判档：`-3` = MK3（×3）· `-2` = MK2（×2.5）· 其余（民用/基础/MK1）= ×2。
 * **书价 = 产物现货价 × 本系数**（取整到 500 信用点）；改系数只改这一处。
 * `rarity` **必填**（奇货档只能从市场行取，漏传会算错档 ⇒ 由类型强制）。
 */
export function blueprintTierCoefOf(
  bpId: string,
  rarity: MarketRarity,
): { tier: 1 | 2 | 3 | 4; coef: number; label: string } {
  if (rarity === 'exotic') return { tier: 4, coef: 4, label: '奇货' }
  if (/-3$/.test(bpId)) return { tier: 3, coef: 3, label: 'MK3' }
  if (/-2$/.test(bpId)) return { tier: 2, coef: 2.5, label: 'MK2' }
  return { tier: 1, coef: 2, label: '民用/基础/MK1' }
}

/** 书价取整粒度（船长口径：合适价格取整到 500 信用点） */
export const BLUEPRINT_PRICE_STEP = 500

/**
 * **单独调整过的蓝图价**（船长 2026-09-11：「所有蓝图按系数都是默认值。**如果有单独调整过的
 * 则允许覆盖默认值**」）：键 = 蓝图 id，值 = 覆盖书价 + 理由。
 * 只放"有意偏离系数"的个例；`content-check` 会校验键必须是真实蓝图、且两处价必须等于覆盖价。
 *
 * **现存 6 条 = 弹药蓝图**（船长同日复核：「**弹药蓝图回滚到 1.5 倍，其他保持不变**」）：
 * 弹药线维持 2026-09-09「补给线 ×1.5」那批的落账原值（6 张全数入表，故弹药书价不随系数漂移）。
 * 修理组件蓝图与之无关（船长：「其他保持不变」⇒ 走系数默认值）。
 */
export const BLUEPRINT_PRICE_OVERRIDES: Readonly<Record<string, { price: number; reason: string }>> = {
  // 基础弹（民用档）：2026-09-09 原值
  'bp-ammo-kinetic': { price: 1_350, reason: '弹药线维持 2026-09-09 补给线「×1.5」口径原值（船长 2026-09-11 复核）' },
  'bp-ammo-explosive': { price: 1_650, reason: '弹药线维持 2026-09-09 补给线「×1.5」口径原值（船长 2026-09-11 复核）' },
  'bp-ammo-plasma': { price: 1_950, reason: '弹药线维持 2026-09-09 补给线「×1.5」口径原值（船长 2026-09-11 复核）' },
  // 弹药 MK2（奇货书）：2026-09-09 原值（＝当时「现价 ×1.5」的落账值 9k/12.75k/18k）
  'bp-ammo-kinetic-2': { price: 9_000, reason: '弹药线维持 2026-09-09 补给线「×1.5」口径原值（船长 2026-09-11 复核）' },
  'bp-ammo-explosive-2': { price: 12_750, reason: '弹药线维持 2026-09-09 补给线「×1.5」口径原值（船长 2026-09-11 复核）' },
  'bp-ammo-plasma-2': { price: 18_000, reason: '弹药线维持 2026-09-09 补给线「×1.5」口径原值（船长 2026-09-11 复核）' },
}

/**
 * 按系数算出的**应有书价**：① 有单独覆盖 → 用覆盖价；② 否则 = 产物现货价 × 档位系数（取整 500 信用点）。
 * `rarity` 传该蓝图的市场行稀有度（奇货档 ×4 由它决定）。
 */
export function blueprintBookPriceOf(bpId: string, productPrice: number, rarity: MarketRarity): number {
  const override = BLUEPRINT_PRICE_OVERRIDES[bpId]
  if (override) return override.price
  return Math.round((productPrice * blueprintTierCoefOf(bpId, rarity).coef) / BLUEPRINT_PRICE_STEP) * BLUEPRINT_PRICE_STEP
}

export const BLUEPRINTS: readonly BlueprintDef[] = [
  {
    id: 'bp-miner-1',
    name: '强化采集器 MK1 蓝图',
    moduleId: 'mod-miner-1',
    materials: [
      { itemId: 'min-tritanium', count: 1_200 },
      { itemId: 'min-pyerite', count: 500 },
    ],
    buildSeconds: 80, // ×6 提速（2026-09-09 船长定：制造速度 ×6；原 8*60=480s）
    buildCostIsk: 8_000,
    priceIsk: 62500,
    description: '入门蓝图，教你用钛钢合金与银纹超金属组装第一部采集器。',
  },
  {
    id: 'bp-cargo-1',
    name: '货舱扩展 MK1 蓝图',
    moduleId: 'mod-cargo-1',
    materials: [
      { itemId: 'min-pyerite', count: 800 },
      { itemId: 'min-mexallon', count: 250 },
    ],
    buildSeconds: 100, // ×6 提速（原 10*60=600s）
    buildCostIsk: 10_000,
    priceIsk: 58500,
    description: '货舱改造图纸，需要晶态胶体做密封衬层。',
  },
  {
    id: 'bp-miner-2',
    name: '强化采集器 MK2 蓝图',
    moduleId: 'mod-miner-2',
    materials: [
      { itemId: 'min-tritanium', count: 13_550 },
      { itemId: 'min-pyerite', count: 5_400 },
      { itemId: 'min-mexallon', count: 1_800 },
    ],
    buildSeconds: 500, // ×6 提速（原 50*60=3000s）
    buildCostIsk: 60_000,
    priceIsk: 1165000,
    description: '谐振钻头图纸，晶态胶体谐振环加银纹超金属散热栅，中期工业的里程碑。',
  },
  {
    id: 'bp-cargo-2',
    name: '货舱扩展 MK2 蓝图',
    moduleId: 'mod-cargo-2',
    materials: [
      { itemId: 'min-pyerite', count: 7_550 },
      { itemId: 'min-mexallon', count: 3_100 },
      { itemId: 'min-nocxium', count: 700 },
    ],
    buildSeconds: 700, // ×6 提速（原 70*60=4200s）
    buildCostIsk: 80_000,
    priceIsk: 1187500,
    description: '折叠货舱技术，核心是重钨合金框架带来的大容量。',
  },
  // 巨构近防炮三档（2026-09-11 机群批 S4 加入）——**2026-09-12 船长裁定「乙」按全表口径对齐**：
  // 书价 = 产物现货价 × 档位系数（MK1 ×2 / MK2 ×2.5 / 奇货 ×4），材料抬到同族锚 45%（料/价原 15.8~17.6%）。
  // 起因 = `content:check` 的「蓝图价格口径」常驻 6 条预警（书价 3 处 + 料/价 3 处），全表仅此三张不合规。
  {
    id: 'bp-pd-e',
    name: '近防炮 MK1 蓝图',
    moduleId: 'mod-pd-e',
    materials: [
      { itemId: 'min-tritanium', count: 4_100 },
      { itemId: 'min-mexallon', count: 1_000 },
    ],
    buildSeconds: 180, // 比轻型炮台略快（点防炮结构简单）
    buildCostIsk: 24_000,
    priceIsk: 236_000, // = 产物现货价 118,000 ×2（2026-09-12 对齐；原 120,000）
    description: '近防炮图纸，射程短、射速快，是唯一能打敌方机群的炮。',
  },
  {
    id: 'bp-pd-e-2',
    name: '近防炮 MK2 蓝图',
    moduleId: 'mod-pd-e-2',
    materials: [
      { itemId: 'min-tritanium', count: 8_300 },
      { itemId: 'min-mexallon', count: 2_400 },
      { itemId: 'min-nocxium', count: 300 },
    ],
    buildSeconds: 300,
    buildCostIsk: 52_000,
    priceIsk: 787_500, // = 产物现货价 315,000 ×2.5（2026-09-12 对齐；原 315,000）
    description: '强化型近防炮图纸，射速更快、单发更重，射程依旧偏短。',
  },
  {
    id: 'bp-pd-e-3',
    name: '近防炮 MK3 蓝图',
    moduleId: 'mod-pd-e-3',
    materials: [
      { itemId: 'min-tritanium', count: 16_000 },
      { itemId: 'min-mexallon', count: 4_500 },
      { itemId: 'min-nocxium', count: 1_000 },
    ],
    buildSeconds: 460,
    buildCostIsk: 96_000,
    priceIsk: 2_760_000, // = 产物现货价 690,000 ×4（奇货档；2026-09-12 对齐；原 690,000）
    description: '顶档近防炮图纸，射速与单发都拉到极限，射程仍是贴身那一小段。',
  },
  {
    id: 'bp-turret-1',
    name: '轻型炮台 MK1（动能）蓝图',
    moduleId: 'mod-turret-kin-1',
    materials: [
      { itemId: 'min-tritanium', count: 2_000 },
      { itemId: 'min-mexallon', count: 500 },
    ],
    buildSeconds: 200, // ×6 提速（原 20*60=1200s）
    buildCostIsk: 20_000,
    priceIsk: 106000,
    description: '轻型动能炮图纸，让矿船也有一门正经的舰炮。',
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
    buildSeconds: 1000, // ×6 提速（原 100*60=6000s）
    buildCostIsk: 150_000,
    priceIsk: 962500,
    description: '重型动能炮图纸，远程 5.7 km，是全船通用的远程压制首选。',
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
    buildSeconds: 60, // ×6 提速（原 6*60=360s）
    buildCostIsk: 1_200,
    priceIsk: 18000,
    description: '最基础的采集器图纸，造价比市场现货略低，适合练手。',
  },
  {
    id: 'bp-cargo-civ',
    name: '民用货舱扩展蓝图',
    moduleId: 'mod-cargo-civ',
    materials: [
      { itemId: 'min-pyerite', count: 220 },
      { itemId: 'min-mexallon', count: 60 },
    ],
    buildSeconds: 70, // ×6 提速（原 7*60=420s）
    buildCostIsk: 1_400,
    priceIsk: 16000,
    description: '入门货舱改装图纸，银纹超金属与晶态胶体的经典配方。',
  },
  {
    id: 'bp-turret-civ',
    name: '民用舰炮蓝图',
    moduleId: 'mod-turret-civ',
    materials: [
      { itemId: 'min-tritanium', count: 500 },
      { itemId: 'min-mexallon', count: 100 },
    ],
    buildSeconds: 80, // ×6 提速（2026-09-09 船长定：制造速度 ×6；原 8*60=480s）
    buildCostIsk: 1_800,
    priceIsk: 24000,
    description: '自警队制式舰炮图纸，让新手矿船也敢正眼看海盗。',
  },

  // ══════════ V10 MK3 攻坚档（稀有；材料含同位聚晶/星髓晶/冥铁） ══════════
  {
    id: 'bp-miner-3',
    name: '精密采集器 MK3 蓝图',
    moduleId: 'mod-miner-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_500 },
      { itemId: 'min-pyerite', count: 16_250 },
      { itemId: 'min-mexallon', count: 6_500 },
      { itemId: 'min-isotope', count: 2_900 },
      { itemId: 'min-starcore', count: 800 },
    ],
    buildSeconds: 3000, // ×6 提速（原 300*60=18000s）
    buildCostIsk: 260_000,
    priceIsk: 6990000,
    description: '精密采集器 MK3 图纸，同位聚晶谐振腔加星髓晶轴承。',
  },
  {
    id: 'bp-cargo-3',
    name: '折叠货舱扩展 MK3 蓝图',
    moduleId: 'mod-cargo-3',
    materials: [
      { itemId: 'min-pyerite', count: 20_550 },
      { itemId: 'min-mexallon', count: 7_700 },
      { itemId: 'min-starcore', count: 1_550 },
      { itemId: 'min-darkiron', count: 390 },
    ],
    buildSeconds: 3600, // ×6 提速（原 360*60=21600s）
    buildCostIsk: 240_000,
    priceIsk: 7200000,
    description: '折叠货舱 MK3 图纸，空间衬层需要星髓晶压铸。',
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
    buildSeconds: 4200, // ×6 提速（原 420*60=25200s）
    buildCostIsk: 480_000,
    priceIsk: 5748000,
    description: '攻坚炮台 MK3 图纸，冥铁炮管与星髓炮闩的杰作。',
  },
  /* ═══ 弹药蓝图（2026-09-05 船长：基础弹可自制；单批 120 发，材料成本≈市价 55% 锚定，参数可调） ═══ */
  {
    id: 'bp-ammo-kinetic',
    name: '动能弹生产线蓝图',
    itemId: 'ammo-kinetic-l',
    outputUnits: 120,
    materials: [{ itemId: 'min-tritanium', count: 48 }], // 384 信用点 ≈ 720×0.53
    buildSeconds: 10, // 船长 2026-09-06：弹药单批默认缩至 10 秒
    buildCostIsk: 12,
    priceIsk: 1350, // 弹药线维持 2026-09-09「×1.5」口径原值（登记于 BLUEPRINT_PRICE_OVERRIDES）
    description: '动能弹生产线图纸，把钛钢合金轧成高速实心弹，120 发/批，对护盾 ×1.5。',
  },
  {
    id: 'bp-ammo-explosive',
    name: '爆破导弹生产线蓝图',
    itemId: 'ammo-explosive-l',
    outputUnits: 120,
    materials: [{ itemId: 'min-pyerite', count: 40 }], // 480 信用点 ≈ 840×0.57
    buildSeconds: 10, // 船长 2026-09-06：弹药单批默认缩至 10 秒
    buildCostIsk: 15,
    priceIsk: 1650, // 弹药线维持 2026-09-09「×1.5」口径原值（登记于 BLUEPRINT_PRICE_OVERRIDES）
    description: '爆破导弹生产线图纸，120 发/批，对装甲 ×1.5。',
  },
  {
    id: 'bp-ammo-plasma',
    name: '能量弹药生产线蓝图',
    itemId: 'ammo-plasma-l',
    outputUnits: 120,
    materials: [{ itemId: 'min-mexallon', count: 26 }], // 520 信用点 ≈ 960×0.54
    buildSeconds: 10, // 船长 2026-09-06：弹药单批默认缩至 10 秒
    buildCostIsk: 18,
    priceIsk: 1950, // 弹药线维持 2026-09-09「×1.5」口径原值（登记于 BLUEPRINT_PRICE_OVERRIDES）
    description: '能量弹药生产线图纸，晶态胶体充能电池组，120 发/批，对护盾 ×1.25。',
  },
  /* ═══ 弹药 MK2 蓝图（2026-09-09 船长拍板：三族高级弹稀有书可造；材料≈市价 55% 锚沿用） ═══ */
  {
    id: 'bp-ammo-kinetic-2',
    name: '动能弹 MK2 生产线蓝图',
    itemId: 'ammo-kinetic-2',
    outputUnits: 120,
    materials: [{ itemId: 'min-nocxium', count: 33 }], // 2,970 信用点 ≈ 5,400×0.55
    buildSeconds: 10,
    buildCostIsk: 90,
    priceIsk: 9_000, // 弹药线维持 2026-09-09「×1.5」口径原值（登记于 BLUEPRINT_PRICE_OVERRIDES）
    description: '动能弹 MK2 生产线图纸，重钨合金弹芯轧制，120 发/批，对护盾 ×1.5。',
  },
  {
    id: 'bp-ammo-explosive-2',
    name: '爆破导弹 MK2 生产线蓝图',
    itemId: 'ammo-explosive-2',
    outputUnits: 120,
    materials: [{ itemId: 'min-isotope', count: 72 }], // 3,960 信用点 ≈ 7,200×0.55
    buildSeconds: 10,
    buildCostIsk: 120,
    priceIsk: 12_750, // 弹药线维持 2026-09-09「×1.5」口径原值（登记于 BLUEPRINT_PRICE_OVERRIDES）
    description: '爆破导弹 MK2 生产线图纸，120 发/批，对装甲 ×1.5。',
  },
  {
    id: 'bp-ammo-plasma-2',
    name: '能量弹药 MK2 生产线蓝图',
    itemId: 'ammo-plasma-2',
    outputUnits: 120,
    materials: [{ itemId: 'min-starcore', count: 22 }], // 5,390 信用点 ≈ 9,600×0.56
    buildSeconds: 10,
    buildCostIsk: 160,
    priceIsk: 18_000, // 弹药线维持 2026-09-09「×1.5」口径原值（登记于 BLUEPRINT_PRICE_OVERRIDES）
    description: '能量弹药 MK2 生产线图纸，120 发/批，对护盾 ×1.25。',
  },
  /* ═══ 修理组件蓝图（2026-09-05 P2 定稿：材料≈市价 55% 锚，参数可调） ═══ */
  {
    id: 'bp-repairkit-civ',
    name: '民用修理组件蓝图',
    itemId: 'repairkit-civ',
    outputUnits: 5,
    materials: [
      { itemId: 'min-tritanium', count: 850 }, // 6,800 信用点
      { itemId: 'min-pyerite', count: 120 }, // 1,440 信用点
    ], // 8,240 ≈ 15,000(3,000×5)×0.55
    buildSeconds: 30, // 船长 2026-09-06：修理组件批产,生产时长缩至原 1/3（90s→30s）
    buildCostIsk: 600,
    priceIsk: 33000,
    description: '民用修理组件图纸，纳米修复材料压装，5 个/批，基础 5 HP。',
  },
  {
    id: 'bp-repairkit-mil',
    name: '军用修理组件蓝图',
    itemId: 'repairkit-mil',
    outputUnits: 3,
    materials: [
      { itemId: 'min-mexallon', count: 1_100 }, // 22,000 信用点
      { itemId: 'min-pyerite', count: 1_050 }, // 12,600 信用点
    ], // 34,600 ≈ 63,000(21,000×3)×0.55
    buildSeconds: 40, // 船长 2026-09-06：修理组件批产,生产时长缩至原 1/3（120s→40s）
    buildCostIsk: 1_200,
    priceIsk: 138500,
    description: '军用修理组件图纸，高密度纳米修复剂封装，3 个/批，基础 10 HP。',
  },
  {
    id: 'bp-laser-1',
    name: '轻型激光炮 MK1蓝图',
    moduleId: 'mod-laser-1',
    materials: [
      { itemId: 'min-tritanium', count: 2040 },
      { itemId: 'min-pyerite', count: 620 },
      { itemId: 'min-mexallon', count: 295 },
    ],
    buildSeconds: 180, // 轻型激光炮 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 132000,
    description: '能量束聚焦谐振腔，透镜镀层与散热栅决定光束纯度。',
  },
  {
    id: 'bp-laser-2',
    name: '重型激光炮 MK2蓝图',
    moduleId: 'mod-laser-2',
    materials: [
      { itemId: 'min-tritanium', count: 10605 },
      { itemId: 'min-pyerite', count: 3365 },
      { itemId: 'min-mexallon', count: 2020 },
      { itemId: 'min-nocxium', count: 405 },
    ],
    buildSeconds: 900, // 重型激光炮 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1202500,
    description: '加固型能量束聚焦谐振腔，射程更远、单发更重。',
  },
  {
    id: 'bp-laser-3',
    name: '攻坚激光炮 MK3蓝图',
    moduleId: 'mod-laser-3',
    materials: [
      { itemId: 'min-tritanium', count: 38320 },
      { itemId: 'min-pyerite', count: 11175 },
      { itemId: 'min-mexallon', count: 6225 },
      { itemId: 'min-nocxium', count: 1275 },
      { itemId: 'min-starcore', count: 665 },
      { itemId: 'min-darkiron', count: 150 },
    ],
    buildSeconds: 4200, // 攻坚激光炮 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7185000,
    description: '顶配能量束聚焦谐振腔，射程与穿透在激光系里封顶。',
  },
  {
    id: 'bp-missile-1',
    name: '轻型导弹架 MK1蓝图',
    moduleId: 'mod-missile-1',
    materials: [
      { itemId: 'min-tritanium', count: 1920 },
      { itemId: 'min-pyerite', count: 580 },
      { itemId: 'min-mexallon', count: 280 },
    ],
    buildSeconds: 180, // 轻型导弹架 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 124000,
    description: '导弹弹巢与发射滑轨，制导片装夹由组装机自动完成。',
  },
  {
    id: 'bp-missile-2',
    name: '重型导弹架 MK2蓝图',
    moduleId: 'mod-missile-2',
    materials: [
      { itemId: 'min-tritanium', count: 9945 },
      { itemId: 'min-pyerite', count: 3155 },
      { itemId: 'min-mexallon', count: 1895 },
      { itemId: 'min-nocxium', count: 380 },
    ],
    buildSeconds: 900, // 重型导弹架 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1127500,
    description: '加固型导弹弹巢与发射滑轨，弹更重、射程更远。',
  },
  {
    id: 'bp-missile-3',
    name: '巡航导弹架 MK3蓝图',
    moduleId: 'mod-missile-3',
    materials: [
      { itemId: 'min-tritanium', count: 42600 },
      { itemId: 'min-pyerite', count: 12705 },
      { itemId: 'min-mexallon', count: 7175 },
      { itemId: 'min-nocxium', count: 1395 },
      { itemId: 'min-isotope', count: 2445 },
    ],
    buildSeconds: 4200, // 巡航导弹架 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6726000,
    description: '顶配导弹弹巢与发射滑轨，射程与单发在导弹系里封顶。',
  },
  {
    id: 'bp-drone-rack-1',
    name: '无人机甲板扩展 MK1蓝图',
    moduleId: 'mod-drone-rack-1',
    materials: [
      { itemId: 'min-tritanium', count: 470 },
      { itemId: 'min-pyerite', count: 135 },
    ],
    buildSeconds: 180, // 无人机甲板扩展 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 24000,
    description: '无人机甲板扩展舱段，挂架、回收网与供电母线一应俱全。',
  },
  {
    id: 'bp-drone-rack-2',
    name: '无人机甲板扩展 MK2蓝图',
    moduleId: 'mod-drone-rack-2',
    materials: [
      { itemId: 'min-tritanium', count: 12_950 },
      { itemId: 'min-pyerite', count: 3_950 },
      { itemId: 'min-mexallon', count: 1_850 },
    ],
    buildSeconds: 900, // 无人机甲板扩展 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1045000,
    description: '加大的无人机甲板扩展舱段，能多带一档机群。',
  },
  {
    id: 'bp-drone-rack-3',
    name: '无人机甲板扩展 MK3蓝图',
    moduleId: 'mod-drone-rack-3',
    materials: [
      { itemId: 'min-tritanium', count: 46_200 },
      { itemId: 'min-pyerite', count: 14_700 },
      { itemId: 'min-mexallon', count: 8_800 },
      { itemId: 'min-nocxium', count: 1_800 },
    ],
    buildSeconds: 2000, // 无人机甲板扩展 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5880000,
    description: '顶配无人机甲板扩展舱段，机位与供电余量都拉到极限。',
  },
  {
    id: 'bp-drone-tac-1',
    name: '战术导控阵列 MK1蓝图',
    moduleId: 'mod-drone-tac-1',
    materials: [
      { itemId: 'min-tritanium', count: 555 },
      { itemId: 'min-pyerite', count: 170 },
      { itemId: 'min-mexallon', count: 80 },
    ],
    buildSeconds: 180, // 战术导控阵列 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 36000,
    description: '战术导控阵列的相控计算单元，火控数据链路压铸成型。',
  },
  {
    id: 'bp-drone-tac-2',
    name: '战术导控阵列 MK2蓝图',
    moduleId: 'mod-drone-tac-2',
    materials: [
      { itemId: 'min-tritanium', count: 10_750 },
      { itemId: 'min-pyerite', count: 3_400 },
      { itemId: 'min-mexallon', count: 2_050 },
      { itemId: 'min-nocxium', count: 410 },
    ],
    buildSeconds: 900, // 战术导控阵列 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1137500,
    description: '战术导控阵列的加强版相控计算单元，导控更快更稳。',
  },
  {
    id: 'bp-drone-tac-3',
    name: '战术导控阵列 MK3蓝图',
    moduleId: 'mod-drone-tac-3',
    materials: [
      { itemId: 'min-tritanium', count: 48_200 },
      { itemId: 'min-pyerite', count: 15_300 },
      { itemId: 'min-mexallon', count: 9_200 },
      { itemId: 'min-nocxium', count: 1_850 },
    ],
    buildSeconds: 2200, // 战术导控阵列 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6120000,
    description: '战术导控阵列的顶配相控计算单元，火控数据链路拉满。',
  },
  {
    id: 'bp-drone-relay-1',
    name: '无人机中继天线 MK1蓝图',
    moduleId: 'mod-drone-relay-1',
    materials: [
      { itemId: 'min-tritanium', count: 400 }, // 3,200 信用点
      { itemId: 'min-pyerite', count: 130 }, // 1,560 信用点
      { itemId: 'min-mexallon', count: 80 }, // 1,600 信用点
    ], // 6,360 ≈ 15,000×0.42
    buildSeconds: 180, // 无人机中继天线 MK1（2026-09-10；材料≈产物价×0.42、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 30000,
    description: '制导中继天线的信号转发单元，把无人机指令链路中继放大。',
  },
  {
    id: 'bp-drone-relay-2',
    name: '无人机中继天线 MK2蓝图',
    moduleId: 'mod-drone-relay-2',
    materials: [
      { itemId: 'min-tritanium', count: 8_350 }, // 20,800 信用点
      { itemId: 'min-pyerite', count: 2_550 }, // 9,480 信用点
      { itemId: 'min-mexallon', count: 1_200 }, // 7,500 信用点
      { itemId: 'min-nocxium', count: 900 }, // 25,200 信用点
    ], // 62,980 ≈ 150,000×0.42
    buildSeconds: 900, // 无人机中继天线 MK2（2026-09-10；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1122500,
    description: '双频段制导中继天线，抗干扰滤波一并压进转发单元。',
  },
  {
    id: 'bp-drone-relay-3',
    name: '无人机中继天线 MK3蓝图',
    moduleId: 'mod-drone-relay-3',
    materials: [
      { itemId: 'min-tritanium', count: 30_000 }, // 43,680 信用点
      { itemId: 'min-pyerite', count: 9_550 }, // 20,820 信用点
      { itemId: 'min-mexallon', count: 5_700 }, // 20,800 信用点
      { itemId: 'min-nocxium', count: 4_950 }, // 81,000 信用点
    ], // 166,300 ≈ 400,000×0.42
    buildSeconds: 2000, // 无人机中继天线 MK3（2026-09-10；材料≈产物价×0.42、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6090000,
    description: '远程相位阵中继天线，无人机指令可走星间链路。',
  },
  {
    id: 'bp-shield-kin-1',
    name: '护盾增强器 MK1·动能型蓝图',
    moduleId: 'mod-shield-kin-1',
    materials: [
      { itemId: 'min-tritanium', count: 195 },
      { itemId: 'min-pyerite', count: 60 },
    ],
    buildSeconds: 180, // 护盾增强器 MK1·动能型（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 10000,
    description: '护盾发生器线圈图（动能频段调谐），磁场包覆层按弹道冲击标定。',
  },
  {
    id: 'bp-shield-exp-1',
    name: '护盾增强器 MK1·高爆型蓝图',
    moduleId: 'mod-shield-exp-1',
    materials: [
      { itemId: 'min-tritanium', count: 195 },
      { itemId: 'min-pyerite', count: 60 },
    ],
    buildSeconds: 180, // 护盾增强器 MK1·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 10000,
    description: '护盾发生器线圈图（高爆频段调谐），冲击波前被偏转场的相位差撕裂。',
  },
  {
    id: 'bp-shield-pla-1',
    name: '护盾增强器 MK1·能量型蓝图',
    moduleId: 'mod-shield-pla-1',
    materials: [
      { itemId: 'min-tritanium', count: 195 },
      { itemId: 'min-pyerite', count: 60 },
    ],
    buildSeconds: 180, // 护盾增强器 MK1·能量型（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 10000,
    description: '护盾发生器线圈图（能量频段调谐），高能光束在极性层上被折射散焦。',
  },
  {
    id: 'bp-shield-kin-2',
    name: '护盾增强器 MK2·动能型蓝图',
    moduleId: 'mod-shield-kin-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_950 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 1_700 },
    ],
    buildSeconds: 900, // 护盾增强器 MK2·动能型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 962500,
    description: '动能型护盾增强器，磁场包覆层按弹道冲击标定，加厚一档。',
  },
  {
    id: 'bp-shield-exp-2',
    name: '护盾增强器 MK2·高爆型蓝图',
    moduleId: 'mod-shield-exp-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_950 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 1_700 },
    ],
    buildSeconds: 900, // 护盾增强器 MK2·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 962500,
    description: '高爆型护盾增强器，冲击波前被偏转场的相位差撕裂，加厚一档。',
  },
  {
    id: 'bp-shield-pla-2',
    name: '护盾增强器 MK2·能量型蓝图',
    moduleId: 'mod-shield-pla-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_950 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 1_700 },
    ],
    buildSeconds: 900, // 护盾增强器 MK2·能量型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 962500,
    description: '能量型护盾增强器，高能光束在极性层上被折射散焦，加厚一档。',
  },
  {
    id: 'bp-shield-kin-3',
    name: '护盾增强器 MK3·动能型蓝图',
    moduleId: 'mod-shield-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_400 },
      { itemId: 'min-pyerite', count: 14_450 },
      { itemId: 'min-mexallon', count: 8_650 },
      { itemId: 'min-nocxium', count: 1_720 },
    ],
    buildSeconds: 1900, // 护盾增强器 MK3·动能型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5760000,
    description: '动能型护盾增强器，磁场包覆层按弹道冲击标定，抗性拉满。',
  },
  {
    id: 'bp-shield-exp-3',
    name: '护盾增强器 MK3·高爆型蓝图',
    moduleId: 'mod-shield-exp-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_400 },
      { itemId: 'min-pyerite', count: 14_450 },
      { itemId: 'min-mexallon', count: 8_650 },
      { itemId: 'min-nocxium', count: 1_720 },
    ],
    buildSeconds: 1900, // 护盾增强器 MK3·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5760000,
    description: '高爆型护盾增强器，冲击波前被偏转场的相位差撕裂，抗性拉满。',
  },
  {
    id: 'bp-shield-pla-3',
    name: '护盾增强器 MK3·能量型蓝图',
    moduleId: 'mod-shield-pla-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_400 },
      { itemId: 'min-pyerite', count: 14_450 },
      { itemId: 'min-mexallon', count: 8_650 },
      { itemId: 'min-nocxium', count: 1_720 },
    ],
    buildSeconds: 1900, // 护盾增强器 MK3·能量型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5760000,
    description: '能量型护盾增强器，高能光束在极性层上被折射散焦，抗性拉满。',
  },
  {
    id: 'bp-shield-ext-1',
    name: '护盾扩展器 MK1蓝图',
    moduleId: 'mod-shield-ext-1',
    materials: [
      { itemId: 'min-tritanium', count: 195 },
      { itemId: 'min-pyerite', count: 60 },
    ],
    buildSeconds: 180, // 护盾扩展器 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 10000,
    description: '护盾电容扩展舱，额外储能单元并联进发生器组。',
  },
  {
    id: 'bp-shield-ext-2',
    name: '护盾扩展器 MK2蓝图',
    moduleId: 'mod-shield-ext-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_950 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 1_700 },
    ],
    buildSeconds: 900, // 护盾扩展器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 962500,
    description: '加大的护盾电容扩展舱，多带一组并联储能单元。',
  },
  {
    id: 'bp-shield-ext-3',
    name: '护盾扩展器 MK3蓝图',
    moduleId: 'mod-shield-ext-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_400 },
      { itemId: 'min-pyerite', count: 14_450 },
      { itemId: 'min-mexallon', count: 8_650 },
      { itemId: 'min-nocxium', count: 1_720 },
    ],
    buildSeconds: 1900, // 护盾扩展器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5760000,
    description: '顶配护盾电容扩展舱，储能单元与母线容量都拉满。',
  },
  /* ── 护盾充能装置（2026-09-14 船长新增件）三条蓝图：材料与书价**照同槽同档的护盾扩展器**取
     （同槽同档同价 ⇒ 同一套料价/书价系数，`content:check` 的蓝图价格口径自动核） ── */
  {
    id: 'bp-shieldchg-1',
    name: '护盾充能装置 MK1蓝图',
    moduleId: 'mod-shieldchg-1',
    materials: [
      { itemId: 'min-tritanium', count: 930 },
      { itemId: 'min-pyerite', count: 280 },
      { itemId: 'min-mexallon', count: 135 },
    ],
    buildSeconds: 60, // 照船体维修装置·民用档（材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0,
    priceIsk: 60000,
    description: '护盾充能回路图纸：把发生器组改成可周期性强制充能的分时母线。',
  },
  {
    id: 'bp-shieldchg-2',
    name: '护盾充能装置 MK2蓝图',
    moduleId: 'mod-shieldchg-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_050 },
      { itemId: 'min-pyerite', count: 3_500 },
      { itemId: 'min-mexallon', count: 2_100 },
      { itemId: 'min-nocxium', count: 420 },
    ],
    buildSeconds: 180, // 照船体维修装置 MK1（材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0,
    priceIsk: 936000,
    description: '大功率护盾充能回路图纸：并联一组专用充能母线，一跳补回的护盾量翻倍。',
  },
  {
    id: 'bp-shieldchg-3',
    name: '护盾充能装置 MK3蓝图',
    moduleId: 'mod-shieldchg-3',
    materials: [
      { itemId: 'min-tritanium', count: 48_950 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_250 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-isotope', count: 2_800 },
    ],
    buildSeconds: 2800, // 照船体维修装置 MK2（材料≈产物价×0.40、蓝图=产物×2.5）
    buildCostIsk: 0,
    priceIsk: 5725000,
    description: '主力舰级护盾充能回路图纸：一跳把打空的护盾拉回可战水平。',
  },
  {
    id: 'bp-armor-kin-1',
    name: '装甲镀层 MK1·动能型蓝图',
    moduleId: 'mod-armor-kin-1',
    materials: [
      { itemId: 'min-tritanium', count: 215 },
      { itemId: 'min-pyerite', count: 65 },
    ],
    buildSeconds: 180, // 装甲镀层 MK1·动能型（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 11000,
    description: '抗动能装甲镀层，叠层陶瓷夹板化解穿甲弹头。',
  },
  {
    id: 'bp-armor-exp-1',
    name: '装甲镀层 MK1·高爆型蓝图',
    moduleId: 'mod-armor-exp-1',
    materials: [
      { itemId: 'min-tritanium', count: 215 },
      { itemId: 'min-pyerite', count: 65 },
    ],
    buildSeconds: 180, // 装甲镀层 MK1·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 11000,
    description: '抗高爆装甲镀层，蜂窝背板把爆压导向船体外侧。',
  },
  {
    id: 'bp-armor-pla-1',
    name: '装甲镀层 MK1·能量型蓝图',
    moduleId: 'mod-armor-pla-1',
    materials: [
      { itemId: 'min-tritanium', count: 215 },
      { itemId: 'min-pyerite', count: 65 },
    ],
    buildSeconds: 180, // 装甲镀层 MK1·能量型（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 11000,
    description: '抗能量装甲镀层，烧蚀涂层用自身汽化带走光束热量。',
  },
  {
    id: 'bp-armor-kin-2',
    name: '装甲镀层 MK2·动能型蓝图',
    moduleId: 'mod-armor-kin-2',
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 3_700 },
      { itemId: 'min-mexallon', count: 1_720 },
    ],
    buildSeconds: 900, // 装甲镀层 MK2·动能型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 970000,
    description: '抗动能装甲镀层，叠层陶瓷夹板化解穿甲弹头，夹层加厚一档。',
  },
  {
    id: 'bp-armor-exp-2',
    name: '装甲镀层 MK2·高爆型蓝图',
    moduleId: 'mod-armor-exp-2',
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 3_700 },
      { itemId: 'min-mexallon', count: 1_720 },
    ],
    buildSeconds: 900, // 装甲镀层 MK2·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 970000,
    description: '抗高爆装甲镀层，蜂窝背板把爆压导向船体外侧，背板加厚一档。',
  },
  {
    id: 'bp-armor-pla-2',
    name: '装甲镀层 MK2·能量型蓝图',
    moduleId: 'mod-armor-pla-2',
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 3_700 },
      { itemId: 'min-mexallon', count: 1_720 },
    ],
    buildSeconds: 900, // 装甲镀层 MK2·能量型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 970000,
    description: '抗能量装甲镀层，烧蚀涂层用自身汽化带走光束热量，涂层加厚一档。',
  },
  {
    id: 'bp-armor-kin-3',
    name: '装甲镀层 MK3·动能型蓝图',
    moduleId: 'mod-armor-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_900 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_750 },
      { itemId: 'min-nocxium', count: 1_730 },
    ],
    buildSeconds: 1900, // 装甲镀层 MK3·动能型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5820000,
    description: '抗动能装甲镀层，叠层陶瓷夹板化解穿甲弹头，防护在镀层系封顶。',
  },
  {
    id: 'bp-armor-exp-3',
    name: '装甲镀层 MK3·高爆型蓝图',
    moduleId: 'mod-armor-exp-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_900 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_750 },
      { itemId: 'min-nocxium', count: 1_730 },
    ],
    buildSeconds: 1900, // 装甲镀层 MK3·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5820000,
    description: '抗高爆装甲镀层，蜂窝背板把爆压导向船体外侧，防护在镀层系封顶。',
  },
  {
    id: 'bp-armor-pla-3',
    name: '装甲镀层 MK3·能量型蓝图',
    moduleId: 'mod-armor-pla-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_900 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_750 },
      { itemId: 'min-nocxium', count: 1_730 },
    ],
    buildSeconds: 1900, // 装甲镀层 MK3·能量型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5820000,
    description: '抗能量装甲镀层，烧蚀涂层用自身汽化带走光束热量，防护在镀层系封顶。',
  },
  {
    id: 'bp-armor-plate-1',
    name: '装甲增厚板 MK1蓝图',
    moduleId: 'mod-armor-plate-1',
    materials: [
      { itemId: 'min-tritanium', count: 215 },
      { itemId: 'min-pyerite', count: 65 },
    ],
    buildSeconds: 180, // 装甲增厚板 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 11000,
    description: '复合装甲厚板，龙骨级板材，牺牲舱容换生存。',
  },
  {
    id: 'bp-armor-plate-2',
    name: '装甲增厚板 MK2蓝图',
    moduleId: 'mod-armor-plate-2',
    materials: [
      { itemId: 'min-tritanium', count: 12_000 },
      { itemId: 'min-pyerite', count: 3_700 },
      { itemId: 'min-mexallon', count: 1_720 },
    ],
    buildSeconds: 900, // 装甲增厚板 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 970000,
    description: '加厚的复合装甲板材，龙骨级用料再加一档。',
  },
  {
    id: 'bp-armor-plate-3',
    name: '装甲增厚板 MK3蓝图',
    moduleId: 'mod-armor-plate-3',
    materials: [
      { itemId: 'min-tritanium', count: 45_900 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_750 },
      { itemId: 'min-nocxium', count: 1_730 },
    ],
    buildSeconds: 1900, // 装甲增厚板 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5820000,
    description: '顶配复合装甲厚板，全船最厚的一层，舱容代价也最大。',
  },
  {
    id: 'bp-prop-1',
    name: '矢量推进器 MK1蓝图',
    moduleId: 'mod-prop-1',
    materials: [
      { itemId: 'min-tritanium', count: 235 },
      { itemId: 'min-pyerite', count: 70 },
    ],
    buildSeconds: 180, // 矢量推进器 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 12000,
    description: '矢量喷口与姿态调节机构，机动转向不再只靠船体姿态轮。',
  },
  {
    id: 'bp-prop-2',
    name: '矢量推进器 MK2蓝图',
    moduleId: 'mod-prop-2',
    materials: [
      { itemId: 'min-tritanium', count: 12_100 },
      { itemId: 'min-pyerite', count: 3_650 },
      { itemId: 'min-mexallon', count: 1_770 },
    ],
    buildSeconds: 900, // 矢量推进器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 977500,
    description: '加力版矢量喷口与姿态调节机构，推进与转向一并加强。',
  },
  {
    id: 'bp-prop-3',
    name: '矢量推进器 MK3蓝图',
    moduleId: 'mod-prop-3',
    materials: [
      { itemId: 'min-tritanium', count: 46_600 },
      { itemId: 'min-pyerite', count: 14_800 },
      { itemId: 'min-mexallon', count: 8_900 },
      { itemId: 'min-nocxium', count: 1_750 },
    ],
    buildSeconds: 2000, // 矢量推进器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5910000,
    description: '顶配矢量喷口与姿态调节机构，速度与机动都拉到极限。',
  },
  // ── 微型跃迁引擎三档（2026-09-14 船长定：短爆发推进，点火 10 秒 / 冷却 60 秒）──
  // 书价 = 产物现货价 × 档位系数（MK1 档 2 ×2.5 · MK2 档 3 ×3 · MK3 奇货 ×4）；
  // 材料 ≈ 产物价 ×0.45（同族锚，见 manufacture:econ），矿物按站内收价计。
  {
    id: 'bp-mwd-1',
    name: '微型跃迁引擎 MK1蓝图',
    moduleId: 'mod-mwd-1',
    materials: [
      { itemId: 'min-tritanium', count: 2_000 },
      { itemId: 'min-pyerite', count: 700 },
      { itemId: 'min-mexallon', count: 130 },
    ],
    buildSeconds: 240, // 微型跃迁引擎 MK1（材料 27,000 ≈ 产物 60,000 ×0.45；蓝图 = 产物 ×2 × MK1 档系数 2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 120000,
    description: '短爆发跃迁线圈与一次性放电组件：十秒的位移，够抢一个阵位。',
  },
  {
    id: 'bp-mwd-2',
    name: '微型跃迁引擎 MK2蓝图',
    moduleId: 'mod-mwd-2',
    materials: [
      { itemId: 'min-tritanium', count: 20_000 },
      { itemId: 'min-pyerite', count: 7_000 },
      { itemId: 'min-mexallon', count: 4_000 },
      { itemId: 'min-nocxium', count: 300 },
    ],
    buildSeconds: 1_100, // 微型跃迁引擎 MK2（材料 351,000 ≈ 产物 780,000 ×0.45；蓝图 = 产物 ×2.5 × MK2 档系数）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1950000,
    description: '大功率跃迁线圈与快放电容组：十秒内把船推到矢量推进器追不上的速度。',
  },
  {
    id: 'bp-mwd-3',
    name: '微型跃迁引擎 MK3蓝图',
    moduleId: 'mod-mwd-3',
    materials: [
      { itemId: 'min-tritanium', count: 61_250 },
      { itemId: 'min-pyerite', count: 20_000 },
      { itemId: 'min-mexallon', count: 13_000 },
      { itemId: 'min-nocxium', count: 2_000 },
    ],
    buildSeconds: 2_400, // 微型跃迁引擎 MK3（材料 1,170,000 ≈ 产物 2,600,000 ×0.45；蓝图 = 产物 ×4 奇货档）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 10400000,
    description: '军规跃迁线圈与瞬放堆：一次点火就是一次跃迁式的位移——十秒，然后哑火一分钟。',
  },
  {
    id: 'bp-stab-kin-1',
    name: '动能稳定器 MK1蓝图',
    moduleId: 'mod-stab-kin-1',
    materials: [
      { itemId: 'min-tritanium', count: 1050 },
      { itemId: 'min-pyerite', count: 320 },
      { itemId: 'min-mexallon', count: 155 },
    ],
    buildSeconds: 180, // 动能稳定器 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 68000,
    description: '动能炮台制退与后坐补偿机构，连续射击的散布被压到最小。',
  },
  {
    id: 'bp-stab-kin-2',
    name: '动能稳定器 MK2蓝图',
    moduleId: 'mod-stab-kin-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_400 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 2_150 },
      { itemId: 'min-nocxium', count: 430 },
    ],
    buildSeconds: 900, // 动能稳定器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1202500,
    description: '动能炮台制退与后坐补偿机构，散布再压一档。',
  },
  {
    id: 'bp-stab-kin-3',
    name: '动能稳定器 MK3蓝图',
    moduleId: 'mod-stab-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 50_450 },
      { itemId: 'min-pyerite', count: 15_050 },
      { itemId: 'min-mexallon', count: 8_500 },
      { itemId: 'min-nocxium', count: 1_650 },
      { itemId: 'min-isotope', count: 2_900 },
    ],
    buildSeconds: 2900, // 动能稳定器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7080000,
    description: '动能炮台制退与后坐补偿机构，散布压到全系最小。',
  },
  {
    id: 'bp-stab-exp-1',
    name: '高爆稳定器 MK1蓝图',
    moduleId: 'mod-stab-exp-1',
    materials: [
      { itemId: 'min-tritanium', count: 1050 },
      { itemId: 'min-pyerite', count: 320 },
      { itemId: 'min-mexallon', count: 155 },
    ],
    buildSeconds: 180, // 高爆稳定器 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 68000,
    description: '高爆炮台制退与后坐补偿机构，弹巢齐射的扭矩被平衡配重吸收。',
  },
  {
    id: 'bp-stab-exp-2',
    name: '高爆稳定器 MK2蓝图',
    moduleId: 'mod-stab-exp-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_400 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 2_150 },
      { itemId: 'min-nocxium', count: 430 },
    ],
    buildSeconds: 900, // 高爆稳定器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1202500,
    description: '高爆炮台制退与后坐补偿机构，齐射扭矩吸收得更多。',
  },
  {
    id: 'bp-stab-exp-3',
    name: '高爆稳定器 MK3蓝图',
    moduleId: 'mod-stab-exp-3',
    materials: [
      { itemId: 'min-tritanium', count: 50_450 },
      { itemId: 'min-pyerite', count: 15_050 },
      { itemId: 'min-mexallon', count: 8_500 },
      { itemId: 'min-nocxium', count: 1_650 },
      { itemId: 'min-isotope', count: 2_900 },
    ],
    buildSeconds: 2900, // 高爆稳定器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7080000,
    description: '高爆炮台制退与后坐补偿机构，齐射扭矩几乎被吃干净。',
  },
  {
    id: 'bp-stab-pla-1',
    name: '等离子稳定器 MK1蓝图',
    moduleId: 'mod-stab-pla-1',
    materials: [
      { itemId: 'min-tritanium', count: 1050 },
      { itemId: 'min-pyerite', count: 320 },
      { itemId: 'min-mexallon', count: 155 },
    ],
    buildSeconds: 180, // 等离子稳定器 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 68000,
    description: '能量炮台制退与后坐补偿机构，电容脉冲放电的回路震荡被阻尼。',
  },
  {
    id: 'bp-stab-pla-2',
    name: '等离子稳定器 MK2蓝图',
    moduleId: 'mod-stab-pla-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_400 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 2_150 },
      { itemId: 'min-nocxium', count: 430 },
    ],
    buildSeconds: 900, // 等离子稳定器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1202500,
    description: '能量炮台制退与后坐补偿机构，回路阻尼再加一档。',
  },
  {
    id: 'bp-stab-pla-3',
    name: '等离子稳定器 MK3蓝图',
    moduleId: 'mod-stab-pla-3',
    materials: [
      { itemId: 'min-tritanium', count: 50_450 },
      { itemId: 'min-pyerite', count: 15_050 },
      { itemId: 'min-mexallon', count: 8_500 },
      { itemId: 'min-nocxium', count: 1_650 },
      { itemId: 'min-isotope', count: 2_900 },
    ],
    buildSeconds: 2900, // 等离子稳定器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 7080000,
    description: '能量炮台制退与后坐补偿机构，回路震荡压到全系最低。',
  },
  {
    id: 'bp-rof-1',
    name: '射速计算机 MK1蓝图',
    moduleId: 'mod-rof-1',
    materials: [
      { itemId: 'min-tritanium', count: 930 },
      { itemId: 'min-pyerite', count: 280 },
      { itemId: 'min-mexallon', count: 135 },
    ],
    buildSeconds: 180, // 射速计算机 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 60000,
    description: '装填机械臂凸轮时序图，循环上弹的节拍比人手快得多。',
  },
  {
    id: 'bp-rof-2',
    name: '射速计算机 MK2蓝图',
    moduleId: 'mod-rof-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_050 },
      { itemId: 'min-pyerite', count: 3_500 },
      { itemId: 'min-mexallon', count: 2_100 },
      { itemId: 'min-nocxium', count: 420 },
    ],
    buildSeconds: 900, // 射速计算机 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1170000,
    description: '加固型装填机械臂凸轮，时序更紧、循环更短。',
  },
  {
    id: 'bp-rof-3',
    name: '射速计算机 MK3蓝图',
    moduleId: 'mod-rof-3',
    materials: [
      { itemId: 'min-tritanium', count: 48_950 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_250 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-isotope', count: 2_800 },
    ],
    buildSeconds: 2800, // 射速计算机 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6870000,
    description: '顶配装填机械臂凸轮，上弹节拍压到机械极限。',
  },
  {
    id: 'bp-track-1',
    name: '索敌阵列 MK1蓝图',
    moduleId: 'mod-track-1',
    materials: [
      { itemId: 'min-tritanium', count: 805 },
      { itemId: 'min-pyerite', count: 245 },
      { itemId: 'min-mexallon', count: 115 },
    ],
    buildSeconds: 180, // 索敌阵列 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 52000,
    description: '传感器阵列与信号处理板，锁定的目标在火控屏上不再甩脱。',
  },
  {
    id: 'bp-track-2',
    name: '索敌阵列 MK2蓝图',
    moduleId: 'mod-track-2',
    materials: [
      { itemId: 'min-tritanium', count: 10_750 },
      { itemId: 'min-pyerite', count: 3_400 },
      { itemId: 'min-mexallon', count: 2_050 },
      { itemId: 'min-nocxium', count: 410 },
    ],
    buildSeconds: 900, // 索敌阵列 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1137500,
    description: '加固型传感器阵列与信号处理板，锁定更快、更稳。',
  },
  {
    id: 'bp-track-3',
    name: '索敌阵列 MK3蓝图',
    moduleId: 'mod-track-3',
    materials: [
      { itemId: 'min-tritanium', count: 47_650 },
      { itemId: 'min-pyerite', count: 14_200 },
      { itemId: 'min-mexallon', count: 8_050 },
      { itemId: 'min-nocxium', count: 1_550 },
      { itemId: 'min-isotope', count: 2_750 },
    ],
    buildSeconds: 2600, // 索敌阵列 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6690000,
    description: '顶配传感器阵列与信号处理板，锁定速度与稳定性封顶。',
  },
  {
    id: 'bp-gyro-1',
    name: '姿态陀螺 MK1蓝图',
    moduleId: 'mod-gyro-1',
    materials: [
      { itemId: 'min-tritanium', count: 745 },
      { itemId: 'min-pyerite', count: 225 },
      { itemId: 'min-mexallon', count: 105 },
    ],
    buildSeconds: 180, // 姿态陀螺 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 48000,
    description: '惯性平台与万向环结构，姿态基准漂移被陀螺稳定在毫弧级。',
  },
  {
    id: 'bp-gyro-2',
    name: '姿态陀螺 MK2蓝图',
    moduleId: 'mod-gyro-2',
    materials: [
      { itemId: 'min-tritanium', count: 10_650 },
      { itemId: 'min-pyerite', count: 3_350 },
      { itemId: 'min-mexallon', count: 2_000 },
      { itemId: 'min-nocxium', count: 400 },
    ],
    buildSeconds: 900, // 姿态陀螺 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1122500,
    description: '加固型惯性平台与万向环，姿态漂移再压一档。',
  },
  {
    id: 'bp-gyro-3',
    name: '姿态陀螺 MK3蓝图',
    moduleId: 'mod-gyro-3',
    materials: [
      { itemId: 'min-tritanium', count: 47_250 },
      { itemId: 'min-pyerite', count: 14_100 },
      { itemId: 'min-mexallon', count: 7_950 },
      { itemId: 'min-nocxium', count: 1_550 },
      { itemId: 'min-isotope', count: 2_700 },
    ],
    buildSeconds: 2600, // 姿态陀螺 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6630000,
    description: '顶配惯性平台与万向环，姿态基准稳到全系最强。',
  },
  // ══════════ 协处理器（2026-09-11 船长新增：低槽 CPU 预算扩容件） ══════════
  // 口径：材料 ≈ 产物价 × 0.45（与全仓配方锚一致）、蓝图书价按档位系数（MK1 产物价 × 2、MK2 × 2.5）；
  // **MK3 无蓝图**（船长定：MK3 稀有度 4 走奇货现货，只能买不能造）。
  {
    id: 'bp-cpu-1',
    name: '协处理器 MK1 蓝图',
    moduleId: 'mod-cpu-1',
    materials: [
      { itemId: 'min-tritanium', count: 13_000 }, // 104,000 信用点
      { itemId: 'min-pyerite', count: 4_000 }, // 48,000 信用点
      { itemId: 'min-mexallon', count: 1_100 }, // 22,000 信用点
    ],
    buildSeconds: 900, // 协处理器 MK1（材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0,
    priceIsk: 776000,
    description: '低槽算力扩展卡，把闲置的机柜空间变成可用算力。',
  },
  {
    id: 'bp-cpu-2',
    name: '协处理器 MK2 蓝图',
    moduleId: 'mod-cpu-2',
    materials: [
      { itemId: 'min-tritanium', count: 47_500 }, // 380,000 信用点
      { itemId: 'min-pyerite', count: 13_500 }, // 162,000 信用点
      { itemId: 'min-mexallon', count: 8_200 }, // 164,000 信用点
      { itemId: 'min-nocxium', count: 1_850 }, // 166,500 信用点
    ],
    buildSeconds: 1900, // 协处理器 MK2（材料≈产物价×0.45、蓝图=产物×2.5）
    buildCostIsk: 0,
    priceIsk: 4850000,
    description: '双路算力扩展卡，算力翻倍而机柜不增。',
  },
  {
    id: 'bp-salvager-1',
    name: '打捞器 MK1蓝图',
    moduleId: 'mod-salvager-1',
    materials: [
      { itemId: 'min-tritanium', count: 620 },
      { itemId: 'min-pyerite', count: 190 },
      { itemId: 'min-mexallon', count: 90 },
    ],
    buildSeconds: 180, // 打捞器 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 40000,
    description: '残骸抓取钳与解构刀具，把废铁拆成可回收原料。',
  },
  {
    id: 'bp-salvager-2',
    name: '打捞器 MK2蓝图',
    moduleId: 'mod-salvager-2',
    materials: [
      { itemId: 'min-tritanium', count: 10_350 },
      { itemId: 'min-pyerite', count: 3_300 },
      { itemId: 'min-mexallon', count: 1_950 },
      { itemId: 'min-nocxium', count: 400 },
    ],
    buildSeconds: 900, // 打捞器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1097500,
    description: '加固型残骸抓取钳与解构刀具，一次能多回收一档。',
  },
  {
    id: 'bp-salvager-3',
    name: '打捞器 MK3蓝图',
    moduleId: 'mod-salvager-3',
    materials: [
      { itemId: 'min-tritanium', count: 47_450 },
      { itemId: 'min-pyerite', count: 14_150 },
      { itemId: 'min-mexallon', count: 8_000 },
      { itemId: 'min-nocxium', count: 1_550 },
      { itemId: 'min-isotope', count: 2_700 },
    ],
    buildSeconds: 2600, // 打捞器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6660000,
    description: '顶配残骸抓取钳与解构刀具，单次回收量全系最高。',
  },
  {
    id: 'bp-hullrep-civ',
    name: '民用船体维修装置蓝图',
    moduleId: 'mod-hullrep-civ',
    materials: [
      { itemId: 'min-tritanium', count: 930 },
      { itemId: 'min-pyerite', count: 280 },
      { itemId: 'min-mexallon', count: 135 },
    ],
    buildSeconds: 60, // 民用船体维修装置（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 60000,
    description: '纳米维修臂与组件注入管路，战斗中让装甲与结构缓缓自愈。',
  },
  {
    id: 'bp-hullrep-1',
    name: '船体维修装置 MK1蓝图',
    moduleId: 'mod-hullrep-1',
    materials: [
      { itemId: 'min-tritanium', count: 11_050 },
      { itemId: 'min-pyerite', count: 3_500 },
      { itemId: 'min-mexallon', count: 2_100 },
      { itemId: 'min-nocxium', count: 420 },
    ],
    buildSeconds: 180, // 船体维修装置 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 936000,
    description: '纳米维修臂与组件注入管路，战斗中让装甲与结构自行愈合。',
  },
  {
    id: 'bp-hullrep-2',
    name: '船体维修装置 MK2蓝图',
    moduleId: 'mod-hullrep-2',
    materials: [
      { itemId: 'min-tritanium', count: 48_950 },
      { itemId: 'min-pyerite', count: 14_600 },
      { itemId: 'min-mexallon', count: 8_250 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-isotope', count: 2_800 },
    ],
    buildSeconds: 2800, // 船体维修装置 MK2（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5725000,
    description: '顶配纳米维修臂与注入管路，回复量与频次都拉到最高。',
  },
  {
    id: 'bp-lock-1',
    name: '目标锁定阵列 MK1蓝图',
    moduleId: 'mod-lock-1',
    materials: [
      { itemId: 'min-tritanium', count: 930 },
      { itemId: 'min-pyerite', count: 280 },
      { itemId: 'min-mexallon', count: 135 },
    ],
    buildSeconds: 180, // 目标锁定阵列 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 60000,
    description: '锁定流程与火控联动，把看住目标这件事写成可量产的规程。',
  },
  {
    id: 'bp-lock-2',
    name: '目标锁定阵列 MK2蓝图',
    moduleId: 'mod-lock-2',
    materials: [
      { itemId: 'min-tritanium', count: 11_000 },
      { itemId: 'min-pyerite', count: 3_500 },
      { itemId: 'min-mexallon', count: 2_100 },
      { itemId: 'min-nocxium', count: 420 },
    ],
    buildSeconds: 900, // 目标锁定阵列 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1162500,
    description: '加固型锁定流程，目标在被咬住之后更难甩脱。',
  },
  {
    id: 'bp-lock-3',
    name: '目标锁定阵列 MK3蓝图',
    moduleId: 'mod-lock-3',
    materials: [
      { itemId: 'min-tritanium', count: 48_550 },
      { itemId: 'min-pyerite', count: 14_450 },
      { itemId: 'min-mexallon', count: 8_150 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-isotope', count: 2_750 },
    ],
    buildSeconds: 2700, // 目标锁定阵列 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6810000,
    description: '顶级锁定流程，从发现到咬住几乎是同一个瞬间。',
  },

  /* ══════════════ 虫洞专属**一次性图纸**（2026-09-13 船长「开工，装备就全部做进来」＋「不掉永久图纸」）
   * 口径（船长逐条裁定）：**不上市场、不能学、只能造一次**（`singleUse`，开工吃掉这本图）；
   * **不进 `FRAGMENT_RECIPES`**（碎片不得逆向出永久配方）；想让第二件就得再拿一张图。
   * 材料**必须全是矿物**（硬契约）⇒ 以**虚空晶**为主 + 该族特色矿物；
   * `priceIsk = 0`（不上市场 ⇒ 无书价；`content:check` 的「蓝图价格口径」对一次性图纸豁免比对）。
   * ⚠ **施工期闸门**：全部标 `unreleased: true`（手册蓝图图鉴 / 组装机蓝图下拉都遍历全目录）。 */
  {
    id: 'bp-wh-a-frag',
    name: '掠袭破片炮图纸（一次性）',
    moduleId: 'mod-wh-a-frag',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 26_000 },
      { itemId: 'min-pyerite', count: 7_000 },
      { itemId: 'min-mexallon', count: 5_000 },
      { itemId: 'min-voidcrystal', count: 110 },
    ],
    buildSeconds: 5400,
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 5_244_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守；原「不上市场 ⇒ 无书价」作废）
    description: '掠袭破片炮，主段爆炸伤、附段动能伤，一轮 20 发。',
  },
  {
    id: 'bp-wh-a-hangar',
    name: '掠袭机库图纸（一次性）',
    moduleId: 'mod-wh-a-hangar',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 20_000 },
      { itemId: 'min-pyerite', count: 5_000 },
      { itemId: 'min-mexallon', count: 3_600 },
      { itemId: 'min-voidcrystal', count: 85 },
    ],
    buildSeconds: 4600,
    buildCostIsk: 0,
    priceIsk: 3_955_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '掠袭机库，扩大无人机舱并加快机群循环。',
  },
  {
    id: 'bp-wh-a-prop',
    name: '掠袭加力器图纸（一次性）',
    moduleId: 'mod-wh-a-prop',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 15_000 },
      { itemId: 'min-pyerite', count: 4_000 },
      { itemId: 'min-mexallon', count: 2_600 },
      { itemId: 'min-voidcrystal', count: 65 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 2_995_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '掠袭加力器，大幅提速，代价是命中下滑。',
  },
  {
    id: 'bp-wh-a-coat',
    name: '掠袭折射涂层图纸（一次性）',
    moduleId: 'mod-wh-a-coat',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 13_000 },
      { itemId: 'min-pyerite', count: 3_400 },
      { itemId: 'min-mexallon', count: 2_400 },
      { itemId: 'min-voidcrystal', count: 60 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 2_674_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '掠袭折射涂层，拉开闪避差，代价是全抗性下调。',
  },
  {
    id: 'bp-wh-a-scan',
    name: '赃物扫描阵图纸（一次性）',
    moduleId: 'mod-wh-a-scan',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 14_000 },
      { itemId: 'min-pyerite', count: 3_600 },
      { itemId: 'min-mexallon', count: 2_600 },
      { itemId: 'min-voidcrystal', count: 60 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 2_802_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '赃物扫描阵，准度大幅提升，代价是射程缩短。',
  },
  {
    id: 'bp-wh-a-shield',
    name: '掠袭者护盾笼图纸（一次性）',
    moduleId: 'mod-wh-a-shield',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 24_000 },
      { itemId: 'min-pyerite', count: 6_000 },
      { itemId: 'min-mexallon', count: 4_600 },
      { itemId: 'min-voidcrystal', count: 100 },
    ],
    buildSeconds: 5000,
    buildCostIsk: 0,
    priceIsk: 4_764_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '掠袭者护盾笼，护盾容量大涨，代价是射程缩短。',
  },
  {
    id: 'bp-wh-c-laser',
    name: '生体棱镜束图纸（一次性）',
    moduleId: 'mod-wh-c-laser',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 24_000 },
      { itemId: 'min-mexallon', count: 5_200 },
      { itemId: 'min-isotope', count: 1_400 },
      { itemId: 'min-voidcrystal', count: 105 },
    ],
    buildSeconds: 5400,
    buildCostIsk: 0,
    priceIsk: 4_995_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '生体棱镜束，必中的等离子光束，射程与衰减都优于同级。',
  },
  {
    id: 'bp-wh-c-prism',
    name: '甲壳棱镜层图纸（一次性）',
    moduleId: 'mod-wh-c-prism',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 22_000 },
      { itemId: 'min-mexallon', count: 4_600 },
      { itemId: 'min-isotope', count: 1_600 },
      { itemId: 'min-voidcrystal', count: 105 },
    ],
    buildSeconds: 5000,
    buildCostIsk: 0,
    priceIsk: 4_844_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '甲壳棱镜层，动能、爆炸、等离子三系装甲抗性同步提高。',
  },
  {
    id: 'bp-wh-c-pulse',
    name: '生体脉搏加速器图纸（一次性）',
    moduleId: 'mod-wh-c-pulse',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 14_000 },
      { itemId: 'min-mexallon', count: 3_200 },
      { itemId: 'min-isotope', count: 800 },
      { itemId: 'min-voidcrystal', count: 60 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 2_915_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '生体脉搏加速器，装填更快、航速略增。',
  },
  {
    id: 'bp-wh-c-missile',
    name: '孢子导弹巢图纸（一次性）',
    moduleId: 'mod-wh-c-missile',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 22_000 },
      { itemId: 'min-mexallon', count: 4_800 },
      { itemId: 'min-isotope', count: 1_300 },
      { itemId: 'min-voidcrystal', count: 100 },
    ],
    buildSeconds: 5400,
    buildCostIsk: 0,
    priceIsk: 4_653_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '孢子导弹巢，爆炸弹头、命中偏差大，但一轮齐射覆盖全体敌人。',
  },
  {
    id: 'bp-wh-c-frame',
    name: '几丁质骨架层图纸（一次性）',
    moduleId: 'mod-wh-c-frame',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 25_000 },
      { itemId: 'min-mexallon', count: 4_800 },
      { itemId: 'min-isotope', count: 1_200 },
      { itemId: 'min-voidcrystal', count: 105 },
    ],
    buildSeconds: 5000,
    buildCostIsk: 0,
    priceIsk: 4_898_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '几丁质骨架层，结构强度大增、航速略增。',
  },
  {
    id: 'bp-wh-d-turret',
    name: '陵卫连装炮图纸（一次性）',
    moduleId: 'mod-wh-d-turret',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 24_000 },
      { itemId: 'min-mexallon', count: 5_000 },
      { itemId: 'min-starcore', count: 900 },
      { itemId: 'min-darkiron', count: 300 },
      { itemId: 'min-voidcrystal', count: 120 },
    ],
    buildSeconds: 5600,
    buildCostIsk: 0,
    priceIsk: 8_555_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '陵卫连装炮，每发双弹的速射动能炮，射速在同级里最高。',
  },
  {
    id: 'bp-wh-d-shield',
    name: '陵墓护盾芯图纸（一次性）',
    moduleId: 'mod-wh-d-shield',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 25_000 },
      { itemId: 'min-mexallon', count: 5_200 },
      { itemId: 'min-starcore', count: 800 },
      { itemId: 'min-darkiron', count: 260 },
      { itemId: 'min-voidcrystal', count: 115 },
    ],
    buildSeconds: 5000,
    buildCostIsk: 0,
    priceIsk: 8_087_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '陵墓护盾芯，护盾容量的顶档核心。',
  },
  {
    id: 'bp-wh-d-lock',
    name: '守墓者丧钟图纸（一次性）',
    moduleId: 'mod-wh-d-lock',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 17_000 },
      { itemId: 'min-mexallon', count: 3_800 },
      { itemId: 'min-starcore', count: 700 },
      { itemId: 'min-darkiron', count: 220 },
      { itemId: 'min-voidcrystal', count: 95 },
    ],
    buildSeconds: 4000,
    buildCostIsk: 0,
    priceIsk: 6_454_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '守墓者丧钟，锁定后对目标的伤害显著提升。',
  },
  {
    id: 'bp-wh-d-laser',
    name: '陵寝棱镜炮图纸（一次性）',
    moduleId: 'mod-wh-d-laser',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 27_000 },
      { itemId: 'min-mexallon', count: 5_600 },
      { itemId: 'min-starcore', count: 1_000 },
      { itemId: 'min-darkiron', count: 320 },
      { itemId: 'min-voidcrystal', count: 125 },
    ],
    buildSeconds: 5600,
    buildCostIsk: 0,
    priceIsk: 9_312_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '陵寝棱镜炮，必中的远程等离子光束，射程最远。',
  },
  {
    id: 'bp-wh-d-loader',
    name: '守墓者速装填机图纸（一次性）',
    moduleId: 'mod-wh-d-loader',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 15_000 },
      { itemId: 'min-mexallon', count: 3_400 },
      { itemId: 'min-starcore', count: 600 },
      { itemId: 'min-darkiron', count: 180 },
      { itemId: 'min-voidcrystal', count: 80 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 5_506_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '守墓者速装填机，大幅缩短装填时间。',
  },
  {
    id: 'bp-wh-d-steady',
    name: '陵墓弹道铭文图纸（一次性）',
    moduleId: 'mod-wh-d-steady',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 14_000 },
      { itemId: 'min-mexallon', count: 3_200 },
      { itemId: 'min-starcore', count: 550 },
      { itemId: 'min-darkiron', count: 170 },
      { itemId: 'min-voidcrystal', count: 75 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 5_141_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '陵墓弹道铭文，同时提高动能与等离子武器的伤害。',
  },
  {
    id: 'bp-wh-e-dc',
    name: '巨构损管阵列图纸（一次性）',
    moduleId: 'mod-wh-e-dc',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 26_000 },
      { itemId: 'min-mexallon', count: 5_000 },
      { itemId: 'min-nocxium', count: 1_600 },
      { itemId: 'min-darkiron', count: 240 },
      { itemId: 'min-voidcrystal', count: 110 },
    ],
    buildSeconds: 5000,
    buildCostIsk: 0,
    priceIsk: 7_442_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '巨构损管阵列，动能与爆炸抗性、结构强度一并提高。',
  },
  {
    id: 'bp-wh-e-tac',
    name: '巨构导控塔图纸（一次性）',
    moduleId: 'mod-wh-e-tac',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 19_000 },
      { itemId: 'min-mexallon', count: 4_000 },
      { itemId: 'min-nocxium', count: 1_300 },
      { itemId: 'min-darkiron', count: 200 },
      { itemId: 'min-voidcrystal', count: 95 },
    ],
    buildSeconds: 4200,
    buildCostIsk: 0,
    priceIsk: 6_009_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '巨构导控塔，大幅提高无人机伤害与结构强度。',
  },
  {
    id: 'bp-wh-e-cpu',
    name: '巨构协处理器图纸（一次性）',
    moduleId: 'mod-wh-e-cpu',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 16_000 },
      { itemId: 'min-mexallon', count: 3_400 },
      { itemId: 'min-nocxium', count: 1_500 },
      { itemId: 'min-darkiron', count: 230 },
      { itemId: 'min-voidcrystal', count: 115 },
    ],
    buildSeconds: 4200,
    buildCostIsk: 0,
    priceIsk: 6_377_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '巨构协处理器，算力冠绝同级，代价是装填变慢。',
  },
  {
    id: 'bp-wh-e-pd',
    name: '巨构近防阵列图纸（一次性）',
    moduleId: 'mod-wh-e-pd',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 21_000 },
      { itemId: 'min-mexallon', count: 4_400 },
      { itemId: 'min-nocxium', count: 1_200 },
      { itemId: 'min-darkiron', count: 190 },
      { itemId: 'min-voidcrystal', count: 100 },
    ],
    buildSeconds: 4600,
    buildCostIsk: 0,
    priceIsk: 6_153_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '巨构近防阵列，射程最短但射速最快，是拦截机群的专用阵列。',
  },
  {
    id: 'bp-wh-e-shield',
    name: '巨构护盾矩阵图纸（一次性）',
    moduleId: 'mod-wh-e-shield',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 25_000 },
      { itemId: 'min-mexallon', count: 5_200 },
      { itemId: 'min-nocxium', count: 1_500 },
      { itemId: 'min-darkiron', count: 240 },
      { itemId: 'min-voidcrystal', count: 115 },
    ],
    buildSeconds: 5000,
    buildCostIsk: 0,
    priceIsk: 7_406_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '巨构护盾矩阵，护盾容量与动能、等离子抗性同时提高。',
  },
  {
    id: 'bp-wh-g-hangar',
    name: '亡军蜂巢坞图纸（一次性）',
    moduleId: 'mod-wh-g-hangar',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 21_000 },
      { itemId: 'min-mexallon', count: 4_400 },
      { itemId: 'min-starcore', count: 700 },
      { itemId: 'min-nocxium', count: 1_200 },
      { itemId: 'min-voidcrystal', count: 100 },
    ],
    buildSeconds: 4800,
    buildCostIsk: 0,
    priceIsk: 6_360_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '亡军蜂巢坞，机位容量全系最大。',
  },
  {
    id: 'bp-wh-g-fcs',
    name: '亡军火控图纸（一次性）',
    moduleId: 'mod-wh-g-fcs',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 15_000 },
      { itemId: 'min-mexallon', count: 3_400 },
      { itemId: 'min-starcore', count: 600 },
      { itemId: 'min-nocxium', count: 900 },
      { itemId: 'min-voidcrystal', count: 80 },
    ],
    buildSeconds: 3800,
    buildCostIsk: 0,
    priceIsk: 4_978_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '亡军火控，命中与伤害同时小幅提高。',
  },
  {
    id: 'bp-wh-g-ballistic',
    name: '幽灵弹道校正器图纸（一次性）',
    moduleId: 'mod-wh-g-ballistic',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 14_000 },
      { itemId: 'min-mexallon', count: 3_200 },
      { itemId: 'min-starcore', count: 550 },
      { itemId: 'min-nocxium', count: 850 },
      { itemId: 'min-voidcrystal', count: 75 },
    ],
    buildSeconds: 3600,
    buildCostIsk: 0,
    priceIsk: 4_642_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '幽灵弹道校正器，提高动能武器的伤害与射程。',
  },
  {
    id: 'bp-wh-g-hull',
    name: '鱿蜂结构层图纸（一次性）',
    moduleId: 'mod-wh-g-hull',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 24_000 },
      { itemId: 'min-mexallon', count: 4_600 },
      { itemId: 'min-starcore', count: 750 },
      { itemId: 'min-nocxium', count: 1_100 },
      { itemId: 'min-voidcrystal', count: 105 },
    ],
    buildSeconds: 4800,
    buildCostIsk: 0,
    priceIsk: 6_718_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '鱿蜂结构层，三系抗性与结构强度提高，并让机上无人机更耐打。',
  },
  {
    id: 'bp-wh-g-turret',
    name: '亡军残炮图纸（一次性）',
    moduleId: 'mod-wh-g-turret',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 22_000 },
      { itemId: 'min-mexallon', count: 4_600 },
      { itemId: 'min-starcore', count: 700 },
      { itemId: 'min-nocxium', count: 1_000 },
      { itemId: 'min-voidcrystal', count: 100 },
    ],
    buildSeconds: 5200,
    buildCostIsk: 0,
    priceIsk: 6_306_500, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '亡军残炮，单发最重的爆炸炮，射程与射速居中。',
  },
  {
    id: 'bp-wh-g-prop',
    name: '幽灵推进器图纸（一次性）',
    moduleId: 'mod-wh-g-prop',
    singleUse: true,
    materials: [
      { itemId: 'min-tritanium', count: 15_000 },
      { itemId: 'min-mexallon', count: 3_400 },
      { itemId: 'min-starcore', count: 550 },
      { itemId: 'min-nocxium', count: 900 },
      { itemId: 'min-voidcrystal', count: 70 },
    ],
    buildSeconds: 3800,
    buildCostIsk: 0,
    priceIsk: 4_709_000, // 2026-09-14：设为市场行同值（专属 ×4 口径；契约「书价＝市场行」守）
    description: '幽灵推进器，大幅提升航速。',
  },

  /* ══════════════ 专属无人机的**一次性图纸**（2026-09-14 船长：「无人机也出蓝图，专属无人机出一次性蓝图
   * （专属无人机的一次性蓝图，每次制造50架）」）══════════════
   * 口径（五条）：
   * ① `singleUse: true` ⇒ **造一批吃掉一张**（与虫洞一次性图纸同机制，`manufacturing.ts` 现成通路）；
   * ② `outputUnits: 50` ⇒ **每次开工出 50 架**——本批唯一"批量产出"的图纸（舰船图纸仍 1 艘、装备图纸仍 1 件）；
   * ③ 材料 = **全矿物**（虚空晶为主 + 族特色矿物），工期按档 30/60/90 分；
   * ④ **渠道 = 各自走原渠道**（船长裁定「甲」）：`bp-wh-c-drone` / `bp-wh-e-drone` 随 **C/E 族专属池**
   *    （id 前缀 `-wh-<族>-` ⇒ `wormholeFamilyPoolOf` 自动收进池，安全货柜 100% 族池）；
   *    `bp-lair-g-drone`（鱿蜂）随 **G 族窝点高级箱**（`FOE_LAIR_GEAR` + `rollRareBoxExtra` 的图纸分支）；
   * ⑤ 价 = 材料 ÷ 0.45 ×4（**专属 ×4 口径**，与市场行同值；市场行只收不卖）。
   * ⚠ 无人机线此前**没有制式图纸**（制式 4 型只能市场买）——这一批是无人机第一次有图纸。 */
  {
    id: 'bp-lair-g-drone',
    name: '鱿蜂无人机图纸（一次性）',
    itemId: 'drone-exile-bee',
    outputUnits: 50,
    singleUse: true,
            materials: [
      { itemId: 'min-tritanium', count: 20_000 },
      { itemId: 'min-pyerite', count: 6_000 },
      { itemId: 'min-mexallon', count: 5_000 },
      { itemId: 'min-voidcrystal', count: 115 },
    ],
    buildSeconds: 180, // 2026-09-14 船长「制造时间可以缩短到10%」：1800 → 180 秒（3 分钟/50 架） // 2026-09-14 船长「制造时间可以缩短到10%」：1800 → 180 秒（3 分钟/50 架）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1_200_000, // = 材料 539,000 ÷ 0.45 = 产物价（鱿蜂 24,000 ×50）：**材料按产品价 45% 定**（2026-09-14 船长口径） // = 材料 145,600 ÷ 0.45 ×4（专属 ×4 · 与市场行同值）
    description: '一次开工出 50 架鱿蜂无人机：单发威力是制式侦察机的两倍，机体最飘。',
  },
  {
    id: 'bp-wh-c-drone',
    name: '巢卫无人机图纸（一次性）',
    itemId: 'drone-wh-c-heavy',
    outputUnits: 50,
    singleUse: true,
            materials: [
      { itemId: 'min-tritanium', count: 40_000 },
      { itemId: 'min-pyerite', count: 12_000 },
      { itemId: 'min-mexallon', count: 10_000 },
      { itemId: 'min-voidcrystal', count: 230 },
    ],
    buildSeconds: 360, // 2026-09-14：3600 → 360 秒（6 分钟/50 架） // 2026-09-14：3600 → 360 秒（6 分钟/50 架）
    buildCostIsk: 0,
    priceIsk: 2_400_000, // = 材料 1,078,000 ÷ 0.45 = 产物价（巢卫 48,000 ×50） // = 材料 225,600 ÷ 0.45 ×4
    description: '一次开工出 50 架巢卫攻坚无人机：孢子爆裂弹头拆甲，三层血比制式攻坚机更厚。',
  },
  {
    id: 'bp-wh-e-drone',
    name: '构件无人机图纸（一次性）',
    itemId: 'drone-wh-e-sentry',
    outputUnits: 50,
    singleUse: true,
            materials: [
      { itemId: 'min-tritanium', count: 70_000 },
      { itemId: 'min-pyerite', count: 22_000 },
      { itemId: 'min-mexallon', count: 18_000 },
      { itemId: 'min-voidcrystal', count: 440 },
    ],
    buildSeconds: 540, // 2026-09-14：5400 → 540 秒（9 分钟/50 架） // 2026-09-14：5400 → 540 秒（9 分钟/50 架）
    buildCostIsk: 0,
    priceIsk: 4_400_000, // = 材料 1,976,000 ÷ 0.45 = 产物价（构件 88,000 ×50） // = 材料 315,000 ÷ 0.45 ×4
    description: '一次开工出 50 架构件哨戒无人机：动能长针拆盾，航程与命中都比制式哨戒机更远更高。',
  },
]


/** 构建"蓝图 id → 定义"目录 */
export function buildBlueprintCatalog(): ReadonlyMap<string, BlueprintDef> {
  return new Map(BLUEPRINTS.map((bp) => [bp.id, bp]))
}
