/**
 * 蓝图表（M2 + V10）：ISK 购买蓝图书学习后永久可造；每次制造扣矿物材料 + 时间
 * （制造费 2026-09-08 船长定取消；buildCostIsk 字段保留为历史遗留数据）。
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
    buildSeconds: 80, // ×6 提速（2026-09-09 船长定：制造速度 ×6；原 8*60=480s）
    buildCostIsk: 8_000,
    priceIsk: 62400,
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
    priceIsk: 58400,
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
    buildSeconds: 500, // ×6 提速（原 50*60=3000s）
    buildCostIsk: 60_000,
    priceIsk: 452500,
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
    buildSeconds: 700, // ×6 提速（原 70*60=4200s）
    buildCostIsk: 80_000,
    priceIsk: 497500,
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
      { itemId: 'min-tritanium', count: 14_000 },
      { itemId: 'min-pyerite', count: 5_000 },
      { itemId: 'min-mexallon', count: 2_000 },
      { itemId: 'min-isotope', count: 900 },
      { itemId: 'min-starcore', count: 250 },
    ],
    buildSeconds: 3000, // ×6 提速（原 300*60=18000s）
    buildCostIsk: 260_000,
    priceIsk: 2973000,
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
    buildSeconds: 3600, // ×6 提速（原 360*60=21600s）
    buildCostIsk: 240_000,
    priceIsk: 3366000,
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
    priceIsk: 1350,
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
    priceIsk: 1650,
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
    priceIsk: 1950,
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
    priceIsk: 9_000, // 书价 ×1.5 与 2026-09-09 全蓝图化补给线同批
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
    priceIsk: 12_750, // 书价 ×1.5 与 2026-09-09 全蓝图化补给线同批
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
    priceIsk: 18_000, // 书价 ×1.5 与 2026-09-09 全蓝图化补给线同批
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
    priceIsk: 5400,
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
    priceIsk: 13500,
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
      { itemId: 'min-tritanium', count: 2600 },
      { itemId: 'min-pyerite', count: 790 },
      { itemId: 'min-mexallon', count: 375 },
    ],
    buildSeconds: 900, // 无人机甲板扩展 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 225000,
    description: '「无人机甲板扩展 MK2」的完整制造工艺。无人机甲板扩展舱段的焊接工艺图——挂架、回收网与供电母线一应俱全。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-drone-rack-3',
    name: '无人机甲板扩展 MK3蓝图',
    moduleId: 'mod-drone-rack-3',
    materials: [
      { itemId: 'min-tritanium', count: 5460 },
      { itemId: 'min-pyerite', count: 1735 },
      { itemId: 'min-mexallon', count: 1040 },
      { itemId: 'min-nocxium', count: 210 },
    ],
    buildSeconds: 2000, // 无人机甲板扩展 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 780000,
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
      { itemId: 'min-tritanium', count: 3530 },
      { itemId: 'min-pyerite', count: 1120 },
      { itemId: 'min-mexallon', count: 670 },
      { itemId: 'min-nocxium', count: 135 },
    ],
    buildSeconds: 900, // 战术导控阵列 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 400000,
    description: '「战术导控阵列 MK2」的完整制造工艺。战术导控阵列的相控计算单元图纸——火控数据链路压铸成型。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-drone-tac-3',
    name: '战术导控阵列 MK3蓝图',
    moduleId: 'mod-drone-tac-3',
    materials: [
      { itemId: 'min-tritanium', count: 8820 },
      { itemId: 'min-pyerite', count: 2800 },
      { itemId: 'min-mexallon', count: 1680 },
      { itemId: 'min-nocxium', count: 335 },
    ],
    buildSeconds: 2200, // 战术导控阵列 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 1260000,
    description: '「战术导控阵列 MK3」的完整制造工艺。战术导控阵列的相控计算单元图纸——火控数据链路压铸成型。顶配工艺版式——高级材料与精密加工在此交汇。',
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
      { itemId: 'min-tritanium', count: 810 },
      { itemId: 'min-pyerite', count: 245 },
      { itemId: 'min-mexallon', count: 115 },
    ],
    buildSeconds: 900, // 护盾增强器 MK2·动能型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 70000,
    description: '「护盾增强器 MK2·动能型」的完整制造工艺。护盾发生器线圈图（动能频段调谐）——磁场包覆层按弹道冲击标定。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-shield-exp-2',
    name: '护盾增强器 MK2·高爆型蓝图',
    moduleId: 'mod-shield-exp-2',
    materials: [
      { itemId: 'min-tritanium', count: 810 },
      { itemId: 'min-pyerite', count: 245 },
      { itemId: 'min-mexallon', count: 115 },
    ],
    buildSeconds: 900, // 护盾增强器 MK2·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 70000,
    description: '「护盾增强器 MK2·高爆型」的完整制造工艺。护盾发生器线圈图（高爆频段调谐）——冲击波前被偏转场的相位差撕裂。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-shield-pla-2',
    name: '护盾增强器 MK2·能量型蓝图',
    moduleId: 'mod-shield-pla-2',
    materials: [
      { itemId: 'min-tritanium', count: 810 },
      { itemId: 'min-pyerite', count: 245 },
      { itemId: 'min-mexallon', count: 115 },
    ],
    buildSeconds: 900, // 护盾增强器 MK2·能量型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 70000,
    description: '「护盾增强器 MK2·能量型」的完整制造工艺。护盾发生器线圈图（能量频段调谐）——高能光束在极性层上被折射散焦。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-shield-kin-3',
    name: '护盾增强器 MK3·动能型蓝图',
    moduleId: 'mod-shield-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 3570 },
      { itemId: 'min-pyerite', count: 1135 },
      { itemId: 'min-mexallon', count: 680 },
      { itemId: 'min-nocxium', count: 135 },
    ],
    buildSeconds: 1900, // 护盾增强器 MK3·动能型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 510000,
    description: '「护盾增强器 MK3·动能型」的完整制造工艺。护盾发生器线圈图（动能频段调谐）——磁场包覆层按弹道冲击标定。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
  {
    id: 'bp-shield-exp-3',
    name: '护盾增强器 MK3·高爆型蓝图',
    moduleId: 'mod-shield-exp-3',
    materials: [
      { itemId: 'min-tritanium', count: 3570 },
      { itemId: 'min-pyerite', count: 1135 },
      { itemId: 'min-mexallon', count: 680 },
      { itemId: 'min-nocxium', count: 135 },
    ],
    buildSeconds: 1900, // 护盾增强器 MK3·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 510000,
    description: '「护盾增强器 MK3·高爆型」的完整制造工艺。护盾发生器线圈图（高爆频段调谐）——冲击波前被偏转场的相位差撕裂。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
  {
    id: 'bp-shield-pla-3',
    name: '护盾增强器 MK3·能量型蓝图',
    moduleId: 'mod-shield-pla-3',
    materials: [
      { itemId: 'min-tritanium', count: 3570 },
      { itemId: 'min-pyerite', count: 1135 },
      { itemId: 'min-mexallon', count: 680 },
      { itemId: 'min-nocxium', count: 135 },
    ],
    buildSeconds: 1900, // 护盾增强器 MK3·能量型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 510000,
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
      { itemId: 'min-tritanium', count: 810 },
      { itemId: 'min-pyerite', count: 245 },
      { itemId: 'min-mexallon', count: 115 },
    ],
    buildSeconds: 900, // 护盾扩展器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 70000,
    description: '「护盾扩展器 MK2」的完整制造工艺。护盾电容扩展舱图纸——额外储能单元并联进发生器组。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-shield-ext-3',
    name: '护盾扩展器 MK3蓝图',
    moduleId: 'mod-shield-ext-3',
    materials: [
      { itemId: 'min-tritanium', count: 3570 },
      { itemId: 'min-pyerite', count: 1135 },
      { itemId: 'min-mexallon', count: 680 },
      { itemId: 'min-nocxium', count: 135 },
    ],
    buildSeconds: 1900, // 护盾扩展器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 510000,
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
      { itemId: 'min-tritanium', count: 980 },
      { itemId: 'min-pyerite', count: 300 },
      { itemId: 'min-mexallon', count: 140 },
    ],
    buildSeconds: 900, // 装甲镀层 MK2·动能型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 85000,
    description: '「装甲镀层 MK2·动能型」的完整制造工艺。装甲镀层配方与热压工艺图（抗动能）——叠层陶瓷夹板化解穿甲弹头。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-armor-exp-2',
    name: '装甲镀层 MK2·高爆型蓝图',
    moduleId: 'mod-armor-exp-2',
    materials: [
      { itemId: 'min-tritanium', count: 980 },
      { itemId: 'min-pyerite', count: 300 },
      { itemId: 'min-mexallon', count: 140 },
    ],
    buildSeconds: 900, // 装甲镀层 MK2·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 85000,
    description: '「装甲镀层 MK2·高爆型」的完整制造工艺。装甲镀层配方与热压工艺图（抗高爆）——蜂窝背板把爆压导向船体外侧。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-armor-pla-2',
    name: '装甲镀层 MK2·能量型蓝图',
    moduleId: 'mod-armor-pla-2',
    materials: [
      { itemId: 'min-tritanium', count: 980 },
      { itemId: 'min-pyerite', count: 300 },
      { itemId: 'min-mexallon', count: 140 },
    ],
    buildSeconds: 900, // 装甲镀层 MK2·能量型（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 85000,
    description: '「装甲镀层 MK2·能量型」的完整制造工艺。装甲镀层配方与热压工艺图（抗能量）——烧蚀涂层用自身汽化带走光束热量。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-armor-kin-3',
    name: '装甲镀层 MK3·动能型蓝图',
    moduleId: 'mod-armor-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 4640 },
      { itemId: 'min-pyerite', count: 1475 },
      { itemId: 'min-mexallon', count: 885 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 1900, // 装甲镀层 MK3·动能型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 663000,
    description: '「装甲镀层 MK3·动能型」的完整制造工艺。装甲镀层配方与热压工艺图（抗动能）——叠层陶瓷夹板化解穿甲弹头。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
  {
    id: 'bp-armor-exp-3',
    name: '装甲镀层 MK3·高爆型蓝图',
    moduleId: 'mod-armor-exp-3',
    materials: [
      { itemId: 'min-tritanium', count: 4640 },
      { itemId: 'min-pyerite', count: 1475 },
      { itemId: 'min-mexallon', count: 885 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 1900, // 装甲镀层 MK3·高爆型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 663000,
    description: '「装甲镀层 MK3·高爆型」的完整制造工艺。装甲镀层配方与热压工艺图（抗高爆）——蜂窝背板把爆压导向船体外侧。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
  {
    id: 'bp-armor-pla-3',
    name: '装甲镀层 MK3·能量型蓝图',
    moduleId: 'mod-armor-pla-3',
    materials: [
      { itemId: 'min-tritanium', count: 4640 },
      { itemId: 'min-pyerite', count: 1475 },
      { itemId: 'min-mexallon', count: 885 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 1900, // 装甲镀层 MK3·能量型（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 663000,
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
      { itemId: 'min-tritanium', count: 980 },
      { itemId: 'min-pyerite', count: 300 },
      { itemId: 'min-mexallon', count: 140 },
    ],
    buildSeconds: 900, // 装甲增厚板 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 85000,
    description: '「装甲增厚板 MK2」的完整制造工艺。复合装甲厚板的锻造图——龙骨级板材，牺牲舱容换生存。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-armor-plate-3',
    name: '装甲增厚板 MK3蓝图',
    moduleId: 'mod-armor-plate-3',
    materials: [
      { itemId: 'min-tritanium', count: 4640 },
      { itemId: 'min-pyerite', count: 1475 },
      { itemId: 'min-mexallon', count: 885 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 1900, // 装甲增厚板 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 663000,
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
      { itemId: 'min-tritanium', count: 1125 },
      { itemId: 'min-pyerite', count: 340 },
      { itemId: 'min-mexallon', count: 165 },
    ],
    buildSeconds: 900, // 矢量推进器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 97500,
    description: '「矢量推进器 MK2」的完整制造工艺。矢量喷口与姿态调节机构的图纸——机动转向不再只靠船体姿态轮。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-prop-3',
    name: '矢量推进器 MK3蓝图',
    moduleId: 'mod-prop-3',
    materials: [
      { itemId: 'min-tritanium', count: 5710 },
      { itemId: 'min-pyerite', count: 1815 },
      { itemId: 'min-mexallon', count: 1090 },
      { itemId: 'min-nocxium', count: 215 },
    ],
    buildSeconds: 2000, // 矢量推进器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 816000,
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
      { itemId: 'min-tritanium', count: 4630 },
      { itemId: 'min-pyerite', count: 1470 },
      { itemId: 'min-mexallon', count: 880 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 900, // 动能稳定器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 525000,
    description: '「动能稳定器 MK2」的完整制造工艺。炮台制退与后坐补偿机构图（动能系）——连续射击的散布被压到最小。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-stab-kin-3',
    name: '动能稳定器 MK3蓝图',
    moduleId: 'mod-stab-kin-3',
    materials: [
      { itemId: 'min-tritanium', count: 19950 },
      { itemId: 'min-pyerite', count: 5950 },
      { itemId: 'min-mexallon', count: 3360 },
      { itemId: 'min-nocxium', count: 655 },
      { itemId: 'min-isotope', count: 1145 },
    ],
    buildSeconds: 2900, // 动能稳定器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3150000,
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
      { itemId: 'min-tritanium', count: 4630 },
      { itemId: 'min-pyerite', count: 1470 },
      { itemId: 'min-mexallon', count: 880 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 900, // 高爆稳定器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 525000,
    description: '「高爆稳定器 MK2」的完整制造工艺。炮台制退与后坐补偿机构图（高爆系）——弹巢齐射的扭矩被平衡配重吸收。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-stab-exp-3',
    name: '高爆稳定器 MK3蓝图',
    moduleId: 'mod-stab-exp-3',
    materials: [
      { itemId: 'min-tritanium', count: 19950 },
      { itemId: 'min-pyerite', count: 5950 },
      { itemId: 'min-mexallon', count: 3360 },
      { itemId: 'min-nocxium', count: 655 },
      { itemId: 'min-isotope', count: 1145 },
    ],
    buildSeconds: 2900, // 高爆稳定器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3150000,
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
      { itemId: 'min-tritanium', count: 4630 },
      { itemId: 'min-pyerite', count: 1470 },
      { itemId: 'min-mexallon', count: 880 },
      { itemId: 'min-nocxium', count: 175 },
    ],
    buildSeconds: 900, // 等离子稳定器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 525000,
    description: '「等离子稳定器 MK2」的完整制造工艺。炮台制退与后坐补偿机构图（能量系）——电容脉冲放电的回路震荡被阻尼。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-stab-pla-3',
    name: '等离子稳定器 MK3蓝图',
    moduleId: 'mod-stab-pla-3',
    materials: [
      { itemId: 'min-tritanium', count: 19950 },
      { itemId: 'min-pyerite', count: 5950 },
      { itemId: 'min-mexallon', count: 3360 },
      { itemId: 'min-nocxium', count: 655 },
      { itemId: 'min-isotope', count: 1145 },
    ],
    buildSeconds: 2900, // 等离子稳定器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 3150000,
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
      { itemId: 'min-tritanium', count: 4080 },
      { itemId: 'min-pyerite', count: 1295 },
      { itemId: 'min-mexallon', count: 775 },
      { itemId: 'min-nocxium', count: 155 },
    ],
    buildSeconds: 900, // 射速计算机 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 462500,
    description: '「射速计算机 MK2」的完整制造工艺。装填机械臂凸轮时序图纸——循环上弹的节拍比人手快得多。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-rof-3',
    name: '射速计算机 MK3蓝图',
    moduleId: 'mod-rof-3',
    materials: [
      { itemId: 'min-tritanium', count: 17480 },
      { itemId: 'min-pyerite', count: 5215 },
      { itemId: 'min-mexallon', count: 2945 },
      { itemId: 'min-nocxium', count: 570 },
      { itemId: 'min-isotope', count: 1005 },
    ],
    buildSeconds: 2800, // 射速计算机 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2760000,
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
      { itemId: 'min-tritanium', count: 3530 },
      { itemId: 'min-pyerite', count: 1120 },
      { itemId: 'min-mexallon', count: 670 },
      { itemId: 'min-nocxium', count: 135 },
    ],
    buildSeconds: 900, // 索敌阵列 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 400000,
    description: '「索敌阵列 MK2」的完整制造工艺。传感器阵列与信号处理板图纸——锁定的目标在火控屏上不再甩脱。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-track-3',
    name: '索敌阵列 MK3蓝图',
    moduleId: 'mod-track-3',
    materials: [
      { itemId: 'min-tritanium', count: 15200 },
      { itemId: 'min-pyerite', count: 4535 },
      { itemId: 'min-mexallon', count: 2560 },
      { itemId: 'min-nocxium', count: 500 },
      { itemId: 'min-isotope', count: 870 },
    ],
    buildSeconds: 2600, // 索敌阵列 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2400000,
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
      { itemId: 'min-tritanium', count: 3310 },
      { itemId: 'min-pyerite', count: 1050 },
      { itemId: 'min-mexallon', count: 630 },
      { itemId: 'min-nocxium', count: 125 },
    ],
    buildSeconds: 900, // 姿态陀螺 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 375000,
    description: '「姿态陀螺 MK2」的完整制造工艺。惯性平台与万向环结构图——姿态基准漂移被陀螺稳定在毫弧级。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-gyro-3',
    name: '姿态陀螺 MK3蓝图',
    moduleId: 'mod-gyro-3',
    materials: [
      { itemId: 'min-tritanium', count: 14250 },
      { itemId: 'min-pyerite', count: 4250 },
      { itemId: 'min-mexallon', count: 2400 },
      { itemId: 'min-nocxium', count: 465 },
      { itemId: 'min-isotope', count: 820 },
    ],
    buildSeconds: 2600, // 姿态陀螺 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2250000,
    description: '「姿态陀螺 MK3」的完整制造工艺。惯性平台与万向环结构图——姿态基准漂移被陀螺稳定在毫弧级。顶配工艺版式——高级材料与精密加工在此交汇。',
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
      { itemId: 'min-tritanium', count: 2865 },
      { itemId: 'min-pyerite', count: 910 },
      { itemId: 'min-mexallon', count: 545 },
      { itemId: 'min-nocxium', count: 110 },
    ],
    buildSeconds: 900, // 打捞器 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 325000,
    description: '「打捞器 MK2」的完整制造工艺。残骸抓取钳与解构刀具的图纸——把废铁拆成可回收原料。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-salvager-3',
    name: '打捞器 MK3蓝图',
    moduleId: 'mod-salvager-3',
    materials: [
      { itemId: 'min-tritanium', count: 14820 },
      { itemId: 'min-pyerite', count: 4420 },
      { itemId: 'min-mexallon', count: 2495 },
      { itemId: 'min-nocxium', count: 485 },
      { itemId: 'min-isotope', count: 850 },
    ],
    buildSeconds: 2600, // 打捞器 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2340000,
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
      { itemId: 'min-tritanium', count: 4370 },
      { itemId: 'min-pyerite', count: 1390 },
      { itemId: 'min-mexallon', count: 835 },
      { itemId: 'min-nocxium', count: 165 },
    ],
    buildSeconds: 180, // 船体维修装置 MK1（2026-09-09 全蓝图化；材料≈产物价×0.45、蓝图=产物×2）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 370000,
    description: '「船体维修装置 MK1」的完整制造工艺。纳米维修臂与组件注入管路图纸——战斗中让装甲与结构自行愈合。制式量产版式——各船厂通用接口，学会即可在组装机量产。',
  },
  {
    id: 'bp-hullrep-2',
    name: '船体维修装置 MK2蓝图',
    moduleId: 'mod-hullrep-2',
    materials: [
      { itemId: 'min-tritanium', count: 17480 },
      { itemId: 'min-pyerite', count: 5215 },
      { itemId: 'min-mexallon', count: 2945 },
      { itemId: 'min-nocxium', count: 570 },
      { itemId: 'min-isotope', count: 1005 },
    ],
    buildSeconds: 2800, // 船体维修装置 MK2（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2760000,
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
      { itemId: 'min-tritanium', count: 3970 },
      { itemId: 'min-pyerite', count: 1260 },
      { itemId: 'min-mexallon', count: 755 },
      { itemId: 'min-nocxium', count: 150 },
    ],
    buildSeconds: 900, // 目标锁定阵列 MK2（2026-09-09 全蓝图化；材料≈产物价×0.42、蓝图=产物×2.5）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 450000,
    description: '「目标锁定阵列 MK2」的完整制造工艺。加固量产版式——关键应力点做双层冗余。',
  },
  {
    id: 'bp-lock-3',
    name: '目标锁定阵列 MK3蓝图',
    moduleId: 'mod-lock-3',
    materials: [
      { itemId: 'min-tritanium', count: 16720 },
      { itemId: 'min-pyerite', count: 4985 },
      { itemId: 'min-mexallon', count: 2815 },
      { itemId: 'min-nocxium', count: 550 },
      { itemId: 'min-isotope', count: 955 },
    ],
    buildSeconds: 2700, // 目标锁定阵列 MK3（2026-09-09 全蓝图化；材料≈产物价×0.40、蓝图=产物×3）
    buildCostIsk: 0, // 制造费已取消（字段历史遗留）
    priceIsk: 2640000,
    description: '「目标锁定阵列 MK3」的完整制造工艺。顶配工艺版式——高级材料与精密加工在此交汇。',
  },
]


/** 构建"蓝图 id → 定义"目录 */
export function buildBlueprintCatalog(): ReadonlyMap<string, BlueprintDef> {
  return new Map(BLUEPRINTS.map((bp) => [bp.id, bp]))
}
