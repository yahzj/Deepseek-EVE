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
import staticDocument from './static/plugs.json'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { staticDataGroup } from './staticData'

const SHIP_PLUGS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "plug-shield-plate": {
    name: '护盾强化插板',
    description: L10N['mod.copy.097']!.zh,
  },
  "plug-armor-plate": {
    name: '装甲强化插板',
    description: L10N['mod.copy.098']!.zh,
  },
  "plug-hull-plate": {
    name: '结构强化插板',
    description: L10N['mod.copy.099']!.zh,
  },
  "plug-mid-bay": {
    name: '中层舱段插件',
    description: L10N['mod.copy.100']!.zh,
  },
  "plug-low-bay": {
    name: '下层舱段插件',
    description: L10N['mod.copy.101']!.zh,
  },
  "plug-cpu-core": {
    name: '协处理插件',
    description: L10N['mod.copy.102']!.zh,
  },
  "plug-firepower": {
    name: '火力强化插件',
    description: L10N['mod.copy.103']!.zh,
  },
  "plug-sight": {
    name: '瞄具插件',
    description: L10N['mod.copy.104']!.zh,
  },
  "plug-rangefinder": {
    name: '射程插件',
    description: L10N['mod.copy.105']!.zh,
  },
  "plug-thruster": {
    name: '推进插件',
    description: L10N['mod.copy.106']!.zh,
  },
  "plug-target-beacon": {
    name: '靶标插件',
    description: L10N['mod.copy.107']!.zh,
  },
  "plug-concealment": {
    name: '隐匿插件',
    description: L10N['mod.copy.108']!.zh,
  },
}

import type { ModuleDef } from '@whale/core'
import { L10N } from './l10n/table'
// ⟪文案调整 2026-10-04⟫ 船长授权整批说明重写，数值与功能不变。

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
  ...staticDataGroup<ModuleDef>(staticDocument as unknown as DataDocument, 'SHIP_PLUGS_0', SHIP_PLUGS_0_TEXT_BINDINGS),
]
