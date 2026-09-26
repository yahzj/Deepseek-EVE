/**
 * **舰船插件**（**2026-09-26 船长令**，设计稿 `docs/design/ship-plug-20260926.md`）。
 *
 * 船长原话（照抄）：「**在工业-组装机的门类筛选中，添加舰船插件的新分类，打算依靠黑匣来生产舰船插件。
 * 舰船插件是一种类似装备的东西，同样装备在舰船上，但是不可拆卸，不可替换。装有插件的舰船无法放入舰船仓库。
 * 玩家打捞自己的舰船残骸时，总能回收舰船插件。**」
 *
 * ## 定性与槽位
 * - **就是装备**（同一套 `ModuleDef`），只是**不可拆、不可替换** ⇒ 走 `slot: 'plug'`，
 *   **不进高/中/低三类槽位数组**（那三类是 `FittedModules`，插件走 `FleetShipState.plugs`）；
 * - 插件槽**绑船型**：`ShipDef.plugSlots`，**越低级的船越多**（T1=5 / T2=4 / T3=3 / T4=2 / T5=1）；
 * - **唯一失去途径 = 船被打沉**（随 `fleet` 条目一起消失）。
 *
 * ## 数值口径（船长逐条定）
 * - **三条加血是固定值**（船长：「**最大护盾/装甲/结构的增加为固定值，不是百分比**」）；
 * - **装甲插板带速度代价**（船长：「**装甲固定值+80，但是减少20m/s的速度**」）——
 *   与既有窝点件「陵寝装甲层」的"装甲 +110% 换速度 −25%"**同一先例**，只是这里的代价是绝对值；
 * - **两条选靶权重**（船长：「**增加被选中的权重**」/「**减少被攻击的权重的插件**」，
 *   并明确「**没有闪避插件**」）⇒ 与闪避无关，落在敌方选靶单点；
 * - **不吃多件递减**（船长：「**③不吃**」）⇒ 装 5 件就是 5 件全额。
 *
 * ⚠ **图纸与产量**：每件**消耗黑匣 ×1**（`blackbox-h`）由组装机生产；图纸**找章鱼人用声望兑换**；
 * 插件与图纸**当前不上市场**（市场卡已做但挂 `unreleased` 并备注，日后要开只删标记）。
 */
import type { ModuleDef } from '@whale/core'

/** 插件模块 id 常量（数据/用例引用它，写错当场编译不过） */
export const PLUG_IDS = {
  shieldPlate: 'plug-shield-plate',
  armorPlate: 'plug-armor-plate',
  hullPlate: 'plug-hull-plate',
  midBay: 'plug-mid-bay',
  lowBay: 'plug-low-bay',
  cpuCore: 'plug-cpu-core',
  firepower: 'plug-firepower',
  sight: 'plug-sight',
  thruster: 'plug-thruster',
  rangefinder: 'plug-rangefinder',
  targetBeacon: 'plug-target-beacon',
  concealment: 'plug-concealment',
} as const

/**
 * 13 件插件（**首批 12 类效果**；船长明确**不做闪避插件**）。
 *
 * 格式说明：① **每件都占 CPU**（合同「每件都占 CPU」照守；只有 `plug-cpu-core` 因为是"加预算"的件才为 0）；
 * ② `rack: 'low'` —— 插件槽**没有进 `RackSlot` 体系**（那套是"高/中/低三数组"，见工作文档「已知取舍」），
 *    这里给的是**显式归属声明**以满足体检契约；插件实际装在 `FleetShipState.plugs` 里，与这套数组无关。
 * 描述文案守 §十三：只写"是什么 / 起作用是多少"，**不用括号做解释**（船长 2026-09-26 令）。
 */
export const SHIP_PLUGS: readonly ModuleDef[] = [
  // ── ① 三条固定值加血（船长逐条给数） ──
  {
    id: PLUG_IDS.shieldPlate,
    name: '护盾强化插板',
    slot: 'plug',
    rack: 'low',
    shieldHpAdd: 40,
    cpuUse: 25,
    description: '舰体内部加装的护盾发生层：护盾上限 +40。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.armorPlate,
    name: '装甲强化插板',
    slot: 'plug',
    rack: 'low',
    armorHpAdd: 80,
    speedPenaltyMps: 20,
    cpuUse: 30,
    description: '整块焊入舰体的复合装甲：装甲上限 +80，代价是最大速度 −20 m/s。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.hullPlate,
    name: '结构强化插板',
    slot: 'plug',
    rack: 'low',
    hullHpAdd: 60,
    cpuUse: 28,
    description: '贯穿主梁的加强件：结构上限 +60。装上后无法拆下。',
  },
  // ── ② 两条扩槽 ──
  {
    id: PLUG_IDS.midBay,
    name: '中层舱段插件',
    slot: 'plug',
    rack: 'low',
    midSlotsAdd: 1,
    cpuUse: 40,
    description: '在中层加开一段标准挂点：中槽 +1。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.lowBay,
    name: '下层舱段插件',
    slot: 'plug',
    rack: 'low',
    lowSlotsAdd: 1,
    cpuUse: 35,
    description: '在底层加开一段标准挂点：低槽 +1。装上后无法拆下。',
  },
  // ── ③ 预算与火力 ──
  {
    id: PLUG_IDS.cpuCore,
    name: '协处理插件',
    slot: 'plug',
    rack: 'low',
    cpuBonus: 80,
    cpuUse: 0,
    description: '并联的运算单元：装配 CPU 上限 +80。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.firepower,
    name: '火力强化插件',
    slot: 'plug',
    rack: 'low',
    damageBonusPct: 0.12,
    cpuUse: 35,
    description: '直连武器总线的超载模块：武器单发伤害 +12%。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.sight,
    name: '瞄具插件',
    slot: 'plug',
    rack: 'low',
    hitBonusPct: 0.12,
    cpuUse: 30,
    description: '与火控并联的测距组件：武器命中 +12%。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.rangefinder,
    name: '射程插件',
    slot: 'plug',
    rack: 'low',
    /**
     * 射程 +25% ⇒ 走既有 `rangeCutPct`（"全武器射程 ×(1 − 本值)"）**取负值**即加成。
     * ⚠ 该字段的既定口径是"多件只取最重一件"，而船长对本批的裁决是**不吃递减** ⇒
     * 插件**不进那条合成**：`combat.createPlayerSpec` 里插件是**单独一段**
     * （`plugRangeCut` → `rangeOf` 的独立倍率），所以这里读到的就是"每一件全额 +25%"。
     */
    rangeCutPct: -0.25,
    cpuUse: 35,
    description: '沿舰体加装的加速导轨：武器射程 +25%。装上后无法拆下。',
  },
  // ── ④ 机动与选靶 ──
  {
    id: PLUG_IDS.thruster,
    name: '推进插件',
    slot: 'plug',
    rack: 'low',
    speedAddMps: 40,
    cpuUse: 28,
    description: '舰尾加装的辅助喷口：最大速度 +40 m/s。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.targetBeacon,
    name: '靶标插件',
    slot: 'plug',
    rack: 'low',
    targetWeightMul: 2,
    cpuUse: 20,
    description: '全功率辐射的诱饵信标：敌方更倾向于选中本舰。装上后无法拆下。',
  },
  {
    id: PLUG_IDS.concealment,
    name: '隐匿插件',
    slot: 'plug',
    rack: 'low',
    targetWeightMul: 0.4,
    cpuUse: 20,
    description: '压平信号特征的外壳：敌方更少选中本舰。装上后无法拆下。',
  },
]
