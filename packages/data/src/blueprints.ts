/**
 * 蓝图表（M2 + V10）：ISK 购买蓝图书学习后永久可造；每次制造扣矿物材料 + 时间
 * （制造费 2026-09-08 船长定取消；buildCostIsk 字段保留为历史遗留数据）。
 *
 * V10 新增：民用档 ×3（平价常驻、新手入门）与 MK3 攻坚档 ×3（市场稀有、材料含同位聚晶/星髓晶；
 * MK3 蓝图学习需协会声望 4）。材料全部来自精炼产物（挖矿 → 精炼 → 制造闭环）。
 *
 * **2026-09-11 船长：「调整所有蓝图到合适价格」→ 裁决「甲」**：装备/物品蓝图书价一律按
 * **档位系数**定——`民用/基础/MK1 ×2 · MK2 ×2.5 · MK3 ×3`（乘**产物现货价**，取整到 500 ISK）；
 * 单点实现 = `blueprintTierCoefOf()`（下方），`tools/content-check.ts` 的「蓝图价格口径契约」据此校验。
 * 背景：2026-09-10「MK2/MK3 装备价对齐同级武器价」那次只改了成品价、**书价没跟**，
 * 导致 91 张里 56 张的「书价 ÷ 产物价」漂移到 0.18~1.88（武器线与新件是合规的 2/2.5/3）。
 */

import type { BlueprintDef } from '@whale/core'

/**
 * 装备/物品蓝图的**档位系数**（2026-09-11 船长裁决「甲」）：按蓝图 id 后缀判档——
 * `-3` = MK3（×3）· `-2` = MK2（×2.5）· 其余（民用/基础/MK1）= ×2。
 * **书价 = 产物现货价 × 本系数**（取整到 500 ISK）；改系数只改这一处。
 */
export function blueprintTierCoefOf(bpId: string): { tier: 1 | 2 | 3; coef: number; label: string } {
  if (/-3$/.test(bpId)) return { tier: 3, coef: 3, label: 'MK3' }
  if (/-2$/.test(bpId)) return { tier: 2, coef: 2.5, label: 'MK2' }
  return { tier: 1, coef: 2, label: '民用/基础/MK1' }
}

/** 书价取整粒度（船长口径：合适价格取整到 500 ISK） */
export const BLUEPRINT_PRICE_STEP = 500

/** 按系数算出的**应有书价**（产物价 × 档位系数，取整到 500 ISK） */
export function blueprintBookPriceOf(bpId: string, productPrice: number): number {
  return Math.round((productPrice * blueprintTierCoefOf(bpId).coef) / BLUEPRINT_PRICE_STEP) * BLUEPRINT_PRICE_STEP
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
    buildSeconds: 100, // ×6 提速（原 10*60=600s）
    buildCostIsk: 10_000,
    priceIsk: 58500,
    description: '货舱改造图纸，需要类晶体胶体做密封衬层。',
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
    description: '谐振钻头图纸：类晶体胶体谐振环 + 类银散热栅，中期工业的里程碑。',
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
    buildSeconds: 200, // ×6 提速（原 20*60=1200s）
    buildCostIsk: 20_000,
    priceIsk: 106000,
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
    buildSeconds: 1000, // ×6 提速（原 100*60=6000s）
    buildCostIsk: 150_000,
    priceIsk: 962500,
    description: '重型动能炮：远程 5.7 km，全船通用、远程压制首选。深渊之门卫队也会忌惮你。',
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
    buildSeconds: 70, // ×6 提速（原 7*60=420s）
    buildCostIsk: 1_400,
    priceIsk: 16000,
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
    buildSeconds: 80, // ×6 提速（2026-09-09 船长定：制造速度 ×6；原 8*60=480s）
    buildCostIsk: 1_800,
    priceIsk: 24000,
    description: '自警队制式舰炮图纸：让新手矿船也敢正眼看海盗。',
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
    description: '精密采集器 MK3 图纸：同位聚晶谐振腔 + 星髓晶轴承（学习需声望 4）。',
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
    buildSeconds: 4200, // ×6 提速（原 420*60=25200s）
    buildCostIsk: 480_000,
    priceIsk: 5748000,
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
    priceIsk: 1500,
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
    priceIsk: 2000,
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
    priceIsk: 2000,
    description: '能量弹药生产线图纸：类晶体胶体充能电池组（120 发/批，对护盾 ×1.25）。',
  },
  /* ═══ 弹药 MK2 蓝图（2026-09-09 船长拍板：三族高级弹稀有书可造；材料≈市价 55% 锚沿用） ═══ */
  {
    id: 'bp-ammo-kinetic-2',
    name: '动能弹 MK2 生产线蓝图',
    itemId: 'ammo-kinetic-2',
    outputUnits: 120,
    materials: [{ itemId: 'min-nocxium', count: 33 }], // 2,970 ISK ≈ 5,400×0.55
    buildSeconds: 10,
    buildCostIsk: 90,
    priceIsk: 13500, // 书价 = 产物 5,400 × 2.5（2026-09-11 甲：统一档位系数，原「×1.5 补给线上浮」作废）
    description: '动能弹 MK2 生产线图纸：超噬合金弹芯轧制（120 发/批，对护盾 ×1.5）。',
  },
  {
    id: 'bp-ammo-explosive-2',
    name: '爆破导弹 MK2 生产线蓝图',
    itemId: 'ammo-explosive-2',
    outputUnits: 120,
    materials: [{ itemId: 'min-isotope', count: 72 }], // 3,960 ISK ≈ 7,200×0.55
    buildSeconds: 10,
    buildCostIsk: 120,
    priceIsk: 18000, // 书价 = 产物 7,200 × 2.5（2026-09-11 甲：统一档位系数，原「×1.5 补给线上浮」作废）
    description: '爆破导弹 MK2 生产线图纸：同位聚晶双级装药弹头（120 发/批，对装甲 ×1.5）。',
  },
  {
    id: 'bp-ammo-plasma-2',
    name: '能量弹药 MK2 生产线蓝图',
    itemId: 'ammo-plasma-2',
    outputUnits: 120,
    materials: [{ itemId: 'min-starcore', count: 22 }], // 5,390 ISK ≈ 9,600×0.56
    buildSeconds: 10,
    buildCostIsk: 160,
    priceIsk: 24000, // 书价 = 产物 9,600 × 2.5（2026-09-11 甲：统一档位系数，原「×1.5 补给线上浮」作废）
    description: '能量弹药 MK2 生产线图纸：星髓晶高密充能电池组（120 发/批，对护盾 ×1.25）。',
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
    priceIsk: 33000,
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
    priceIsk: 138500,
    description: '军用修理组件蓝图：高密度纳米修复剂封装（3 个/批；基础 70 HP×容量增幅）。',
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
    description: '「轻型激光炮 MK1」的完整制造工艺。能量束聚焦谐振腔的装配图纸——透镜镀层与散热栅决定光束纯度。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「重型激光炮 MK2」的完整制造工艺。能量束聚焦谐振腔的装配图纸——透镜镀层与散热栅决定光束纯度。加固量产版式——关键应力点做双层冗余。',
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
    description: '「攻坚激光炮 MK3」的完整制造工艺。能量束聚焦谐振腔的装配图纸——透镜镀层与散热栅决定光束纯度。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「轻型导弹架 MK1」的完整制造工艺。导弹弹巢与发射滑轨的结构图纸——制导片装夹由组装机自动完成。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「重型导弹架 MK2」的完整制造工艺。导弹弹巢与发射滑轨的结构图纸——制导片装夹由组装机自动完成。加固量产版式——关键应力点做双层冗余。',
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
    description: '「巡航导弹架 MK3」的完整制造工艺。导弹弹巢与发射滑轨的结构图纸——制导片装夹由组装机自动完成。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「无人机甲板扩展 MK1」的完整制造工艺。无人机甲板扩展舱段的焊接工艺图——挂架、回收网与供电母线一应俱全。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「无人机甲板扩展 MK2」的完整制造工艺。无人机甲板扩展舱段的焊接工艺图——挂架、回收网与供电母线一应俱全。加固量产版式——关键应力点做双层冗余。',
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
    description: '「无人机甲板扩展 MK3」的完整制造工艺。无人机甲板扩展舱段的焊接工艺图——挂架、回收网与供电母线一应俱全。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「战术导控阵列 MK1」的完整制造工艺。战术导控阵列的相控计算单元图纸——火控数据链路压铸成型。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「战术导控阵列 MK2」的完整制造工艺。战术导控阵列的相控计算单元图纸——火控数据链路压铸成型。加固量产版式——关键应力点做双层冗余。',
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
    description: '「战术导控阵列 MK3」的完整制造工艺。战术导控阵列的相控计算单元图纸——火控数据链路压铸成型。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
  {
    id: 'bp-drone-relay-1',
    name: '无人机中继天线 MK1蓝图',
    moduleId: 'mod-drone-relay-1',
    materials: [
      { itemId: 'min-tritanium', count: 400 }, // 3,200 ISK
      { itemId: 'min-pyerite', count: 130 }, // 1,560 ISK
      { itemId: 'min-mexallon', count: 80 }, // 1,600 ISK
    ], // 6,360 ≈ 15,000×0.42
    buildSeconds: 180, // 无人机中继天线 MK1（2026-09-10；材料≈产物价×0.42、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 30000,
    description: '「无人机中继天线 MK1」的完整制造工艺。制导中继天线的信号转发单元图纸——无人机指令链路中继放大。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
  },
  {
    id: 'bp-drone-relay-2',
    name: '无人机中继天线 MK2蓝图',
    moduleId: 'mod-drone-relay-2',
    materials: [
      { itemId: 'min-tritanium', count: 8_350 }, // 20,800 ISK
      { itemId: 'min-pyerite', count: 2_550 }, // 9,480 ISK
      { itemId: 'min-mexallon', count: 1_200 }, // 7,500 ISK
      { itemId: 'min-nocxium', count: 900 }, // 25,200 ISK
    ], // 62,980 ≈ 150,000×0.42
    buildSeconds: 900, // 无人机中继天线 MK2（2026-09-10；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1122500,
    description: '「无人机中继天线 MK2」的完整制造工艺。制导中继天线的信号转发单元图纸——双频段中继与抗干扰滤波。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-drone-relay-3',
    name: '无人机中继天线 MK3蓝图',
    moduleId: 'mod-drone-relay-3',
    materials: [
      { itemId: 'min-tritanium', count: 30_000 }, // 43,680 ISK
      { itemId: 'min-pyerite', count: 9_550 }, // 20,820 ISK
      { itemId: 'min-mexallon', count: 5_700 }, // 20,800 ISK
      { itemId: 'min-nocxium', count: 4_950 }, // 81,000 ISK
    ], // 166,300 ≈ 400,000×0.42
    buildSeconds: 2000, // 无人机中继天线 MK3（2026-09-10；材料≈产物价×0.42、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 6090000,
    description: '「无人机中继天线 MK3」的完整制造工艺。制导中继天线的信号转发单元图纸——远程相位阵与星间链路。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「护盾增强器 MK1·动能型」的完整制造工艺。护盾发生器线圈图（动能频段调谐）——磁场包覆层按弹道冲击标定。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「护盾增强器 MK1·高爆型」的完整制造工艺。护盾发生器线圈图（高爆频段调谐）——冲击波前被偏转场的相位差撕裂。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「护盾增强器 MK1·能量型」的完整制造工艺。护盾发生器线圈图（能量频段调谐）——高能光束在极性层上被折射散焦。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「护盾增强器 MK2·动能型」的完整制造工艺。护盾发生器线圈图（动能频段调谐）——磁场包覆层按弹道冲击标定。加固量产版式——关键应力点做双层冗余。',
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
    description: '「护盾增强器 MK2·高爆型」的完整制造工艺。护盾发生器线圈图（高爆频段调谐）——冲击波前被偏转场的相位差撕裂。加固量产版式——关键应力点做双层冗余。',
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
    description: '「护盾增强器 MK2·能量型」的完整制造工艺。护盾发生器线圈图（能量频段调谐）——高能光束在极性层上被折射散焦。加固量产版式——关键应力点做双层冗余。',
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
    description: '「护盾增强器 MK3·动能型」的完整制造工艺。护盾发生器线圈图（动能频段调谐）——磁场包覆层按弹道冲击标定。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「护盾增强器 MK3·高爆型」的完整制造工艺。护盾发生器线圈图（高爆频段调谐）——冲击波前被偏转场的相位差撕裂。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「护盾增强器 MK3·能量型」的完整制造工艺。护盾发生器线圈图（能量频段调谐）——高能光束在极性层上被折射散焦。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「护盾扩展器 MK1」的完整制造工艺。护盾电容扩展舱图纸——额外储能单元并联进发生器组。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「护盾扩展器 MK2」的完整制造工艺。护盾电容扩展舱图纸——额外储能单元并联进发生器组。加固量产版式——关键应力点做双层冗余。',
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
    description: '「护盾扩展器 MK3」的完整制造工艺。护盾电容扩展舱图纸——额外储能单元并联进发生器组。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「装甲镀层 MK1·动能型」的完整制造工艺。装甲镀层配方与热压工艺图（抗动能）——叠层陶瓷夹板化解穿甲弹头。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「装甲镀层 MK1·高爆型」的完整制造工艺。装甲镀层配方与热压工艺图（抗高爆）——蜂窝背板把爆压导向船体外侧。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「装甲镀层 MK1·能量型」的完整制造工艺。装甲镀层配方与热压工艺图（抗能量）——烧蚀涂层用自身汽化带走光束热量。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「装甲镀层 MK2·动能型」的完整制造工艺。装甲镀层配方与热压工艺图（抗动能）——叠层陶瓷夹板化解穿甲弹头。加固量产版式——关键应力点做双层冗余。',
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
    description: '「装甲镀层 MK2·高爆型」的完整制造工艺。装甲镀层配方与热压工艺图（抗高爆）——蜂窝背板把爆压导向船体外侧。加固量产版式——关键应力点做双层冗余。',
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
    description: '「装甲镀层 MK2·能量型」的完整制造工艺。装甲镀层配方与热压工艺图（抗能量）——烧蚀涂层用自身汽化带走光束热量。加固量产版式——关键应力点做双层冗余。',
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
    description: '「装甲镀层 MK3·动能型」的完整制造工艺。装甲镀层配方与热压工艺图（抗动能）——叠层陶瓷夹板化解穿甲弹头。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「装甲镀层 MK3·高爆型」的完整制造工艺。装甲镀层配方与热压工艺图（抗高爆）——蜂窝背板把爆压导向船体外侧。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「装甲镀层 MK3·能量型」的完整制造工艺。装甲镀层配方与热压工艺图（抗能量）——烧蚀涂层用自身汽化带走光束热量。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「装甲增厚板 MK1」的完整制造工艺。复合装甲厚板的锻造图——龙骨级板材，牺牲舱容换生存。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「装甲增厚板 MK2」的完整制造工艺。复合装甲厚板的锻造图——龙骨级板材，牺牲舱容换生存。加固量产版式——关键应力点做双层冗余。',
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
    description: '「装甲增厚板 MK3」的完整制造工艺。复合装甲厚板的锻造图——龙骨级板材，牺牲舱容换生存。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「矢量推进器 MK1」的完整制造工艺。矢量喷口与姿态调节机构的图纸——机动转向不再只靠船体姿态轮。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「矢量推进器 MK2」的完整制造工艺。矢量喷口与姿态调节机构的图纸——机动转向不再只靠船体姿态轮。加固量产版式——关键应力点做双层冗余。',
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
    description: '「矢量推进器 MK3」的完整制造工艺。矢量喷口与姿态调节机构的图纸——机动转向不再只靠船体姿态轮。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「动能稳定器 MK1」的完整制造工艺。炮台制退与后坐补偿机构图（动能系）——连续射击的散布被压到最小。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「动能稳定器 MK2」的完整制造工艺。炮台制退与后坐补偿机构图（动能系）——连续射击的散布被压到最小。加固量产版式——关键应力点做双层冗余。',
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
    description: '「动能稳定器 MK3」的完整制造工艺。炮台制退与后坐补偿机构图（动能系）——连续射击的散布被压到最小。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「高爆稳定器 MK1」的完整制造工艺。炮台制退与后坐补偿机构图（高爆系）——弹巢齐射的扭矩被平衡配重吸收。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「高爆稳定器 MK2」的完整制造工艺。炮台制退与后坐补偿机构图（高爆系）——弹巢齐射的扭矩被平衡配重吸收。加固量产版式——关键应力点做双层冗余。',
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
    description: '「高爆稳定器 MK3」的完整制造工艺。炮台制退与后坐补偿机构图（高爆系）——弹巢齐射的扭矩被平衡配重吸收。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「等离子稳定器 MK1」的完整制造工艺。炮台制退与后坐补偿机构图（能量系）——电容脉冲放电的回路震荡被阻尼。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「等离子稳定器 MK2」的完整制造工艺。炮台制退与后坐补偿机构图（能量系）——电容脉冲放电的回路震荡被阻尼。加固量产版式——关键应力点做双层冗余。',
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
    description: '「等离子稳定器 MK3」的完整制造工艺。炮台制退与后坐补偿机构图（能量系）——电容脉冲放电的回路震荡被阻尼。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「射速计算机 MK1」的完整制造工艺。装填机械臂凸轮时序图纸——循环上弹的节拍比人手快得多。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「射速计算机 MK2」的完整制造工艺。装填机械臂凸轮时序图纸——循环上弹的节拍比人手快得多。加固量产版式——关键应力点做双层冗余。',
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
    description: '「射速计算机 MK3」的完整制造工艺。装填机械臂凸轮时序图纸——循环上弹的节拍比人手快得多。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「索敌阵列 MK1」的完整制造工艺。传感器阵列与信号处理板图纸——锁定的目标在火控屏上不再甩脱。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「索敌阵列 MK2」的完整制造工艺。传感器阵列与信号处理板图纸——锁定的目标在火控屏上不再甩脱。加固量产版式——关键应力点做双层冗余。',
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
    description: '「索敌阵列 MK3」的完整制造工艺。传感器阵列与信号处理板图纸——锁定的目标在火控屏上不再甩脱。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「姿态陀螺 MK1」的完整制造工艺。惯性平台与万向环结构图——姿态基准漂移被陀螺稳定在毫弧级。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「姿态陀螺 MK2」的完整制造工艺。惯性平台与万向环结构图——姿态基准漂移被陀螺稳定在毫弧级。加固量产版式——关键应力点做双层冗余。',
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
    description: '「姿态陀螺 MK3」的完整制造工艺。惯性平台与万向环结构图——姿态基准漂移被陀螺稳定在毫弧级。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
  // ══════════ 协处理器（2026-09-11 船长新增：低槽 CPU 预算扩容件） ══════════
  // 口径：材料 ≈ 产物价 × 0.45（与全仓配方锚一致）、蓝图书价按档位系数（MK1 产物价 × 2、MK2 × 2.5）；
  // **MK3 无蓝图**（船长定：MK3 稀有度 4 走奇货现货，只能买不能造）。
  {
    id: 'bp-cpu-1',
    name: '协处理器 MK1 蓝图',
    moduleId: 'mod-cpu-1',
    materials: [
      { itemId: 'min-tritanium', count: 13_000 }, // 104,000 ISK
      { itemId: 'min-pyerite', count: 4_000 }, // 48,000 ISK
      { itemId: 'min-mexallon', count: 1_100 }, // 22,000 ISK
    ],
    buildSeconds: 900, // 协处理器 MK1（材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0,
    priceIsk: 776000,
    description: '低槽算力扩展卡的完整制造工艺：布线图与时序表——把闲置的机柜空间变成可用算力。学会即可在组装机量产。',
  },
  {
    id: 'bp-cpu-2',
    name: '协处理器 MK2 蓝图',
    moduleId: 'mod-cpu-2',
    materials: [
      { itemId: 'min-tritanium', count: 47_500 }, // 380,000 ISK
      { itemId: 'min-pyerite', count: 13_500 }, // 162,000 ISK
      { itemId: 'min-mexallon', count: 8_200 }, // 164,000 ISK
      { itemId: 'min-nocxium', count: 1_850 }, // 166,500 ISK
    ],
    buildSeconds: 1900, // 协处理器 MK2（材料≈产物价×0.45、蓝图=产物×2.5）
    buildCostIsk: 0,
    priceIsk: 4850000,
    description: '双路算力扩展卡的完整制造工艺：堆叠工艺与散热规范——算力翻倍而机柜不增。学会即可在组装机量产。',
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
    description: '「打捞器 MK1」的完整制造工艺。残骸抓取钳与解构刀具的图纸——把废铁拆成可回收原料。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「打捞器 MK2」的完整制造工艺。残骸抓取钳与解构刀具的图纸——把废铁拆成可回收原料。加固量产版式——关键应力点做双层冗余。',
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
    description: '「打捞器 MK3」的完整制造工艺。残骸抓取钳与解构刀具的图纸——把废铁拆成可回收原料。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「民用船体维修装置」的完整制造工艺。纳米维修臂与组件注入管路图纸——战斗中让装甲与结构自行愈合。协会民用认证版式——入门者的第一课。',
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
    description: '「船体维修装置 MK1」的完整制造工艺。纳米维修臂与组件注入管路图纸——战斗中让装甲与结构自行愈合。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「船体维修装置 MK2」的完整制造工艺。纳米维修臂与组件注入管路图纸——战斗中让装甲与结构自行愈合。顶配工艺版式——高级材料与精密加工在此交汇。',
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
    description: '「目标锁定阵列 MK1」的完整制造工艺。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
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
    description: '「目标锁定阵列 MK2」的完整制造工艺。加固量产版式——关键应力点做双层冗余。',
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
    description: '「目标锁定阵列 MK3」的完整制造工艺。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
]


/** 构建"蓝图 id → 定义"目录 */
export function buildBlueprintCatalog(): ReadonlyMap<string, BlueprintDef> {
  return new Map(BLUEPRINTS.map((bp) => [bp.id, bp]))
}
