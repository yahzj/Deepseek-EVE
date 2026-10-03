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
 * ⚠ **图纸与产量**：每件**消耗黑匣 ×1**（配方里写 `blackbox-h`；**H 墨潮 / R 光环 / 通用三件互为替代**，
 * 见 `core/manufacturing.ts` 的 `MATERIAL_GROUPS`）由组装机生产；图纸**找章鱼人用声望兑换**；
 * 插件与图纸**当前不上市场**（市场卡已做但挂 `unreleased` 并备注，日后要开只删标记）。
 *
 * ⟪文案调整 2026-09-27⟫ **11 件插件的数值由船长在工作台里改过**（护盾/装甲/结构固定值、CPU 占用、
 * 伤害与命中百分比、射程、两条选靶权重），描述里的高亮数值随之同步（zh 在本文件、en 在 `l10n.ts` 的
 * `EN_MODULES`）；"原 → 新"逐条见 `docs/design/plug-blackbox-20260927.md` 的「文案调整台账」。
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
    shieldHpAdd: 80,
    cpuUse: 0,
    description: '舰体内部加装的护盾发生层：护盾上限 +80。',
  },
  {
    id: PLUG_IDS.armorPlate,
    name: '装甲强化插板',
    slot: 'plug',
    rack: 'low',
    armorHpAdd: 140,
    speedPenaltyMps: 20,
    cpuUse: 0,
    description: '整块焊入舰体的复合装甲：装甲上限 +140，代价是最大速度 −20 m/s。',
  },
  {
    id: PLUG_IDS.hullPlate,
    name: '结构强化插板',
    slot: 'plug',
    rack: 'low',
    hullHpAdd: 80,
    cpuUse: 0,
    description: '贯穿主梁的加强件：结构上限 +80。',
  },
  // ── ② 两条扩槽 ──
  {
    id: PLUG_IDS.midBay,
    name: '中层舱段插件',
    slot: 'plug',
    rack: 'low',
    midSlotsAdd: 1,
    cpuUse: 0,
    description: '在中层加开一段标准挂点：中槽 +1。',
  },
  {
    id: PLUG_IDS.lowBay,
    name: '下层舱段插件',
    slot: 'plug',
    rack: 'low',
    lowSlotsAdd: 1,
    cpuUse: 0,
    description: '在底层加开一段标准挂点：低槽 +1。',
  },
  // ── ③ 预算与火力 ──
  {
    id: PLUG_IDS.cpuCore,
    name: '协处理插件',
    slot: 'plug',
    rack: 'low',
    cpuBonus: 80,
    cpuUse: 0,
    description: '并联的运算单元：装配 CPU 上限 +80。',
  },
  {
    id: PLUG_IDS.firepower,
    name: '火力强化插件',
    slot: 'plug',
    rack: 'low',
    damageBonusPct: 0.15,
    cpuUse: 0,
    description: '直连武器总线的超载模块：武器单发伤害 +15%。',
  },
  {
    id: PLUG_IDS.sight,
    name: '瞄具插件',
    slot: 'plug',
    rack: 'low',
    hitBonusPct: 0.15,
    cpuUse: 0,
    description: '与火控并联的测距组件：武器命中 +15%。',
  },
  {
    id: PLUG_IDS.rangefinder,
    name: '射程插件',
    slot: 'plug',
    rack: 'low',
    /**
     * 射程 +20% ⇒ **正向字段** `plugRangeBonusPct`（**2026-09-27 船长令**：原先借 `rangeCutPct` 写负值，
     * 船长问「射程加成为什么负值才是加成」后按乙案改为写正数）。
     * ⚠ 与 `rangeCutPct` 的口径**互不替代**：后者是"代价件"的削减（多件取最重一件）；
     * 本字段**多件加算、不吃递减**（船长对插件批的裁决「③不吃」）——建档侧插件是**单独一段**，
     * 直接并进"战前射程加成池"（与装备按系加成同池加算）。
     */
    plugRangeBonusPct: 0.2,
    cpuUse: 0,
    description: '沿舰体加装的加速导轨：武器射程 +20%。',
  },
  // ── ④ 机动与选靶 ──
  {
    id: PLUG_IDS.thruster,
    name: '推进插件',
    slot: 'plug',
    rack: 'low',
    speedAddMps: 40,
    cpuUse: 0,
    description: '舰尾加装的辅助喷口：最大速度 +40 m/s。',
  },
  {
    id: PLUG_IDS.targetBeacon,
    name: '靶标插件',
    slot: 'plug',
    rack: 'low',
    targetWeightMul: 3,
    cpuUse: 0,
    description: '全功率辐射的诱饵信标：敌方更倾向于选中本舰。',
  },
  {
    id: PLUG_IDS.concealment,
    name: '隐匿插件',
    slot: 'plug',
    rack: 'low',
    targetWeightMul: 0.7,
    cpuUse: 0,
    description: '压平信号特征的外壳：敌方更少选中本舰。',
  },
]
