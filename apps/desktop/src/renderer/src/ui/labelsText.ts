/**
 * **core 侧"内容名"的本地化单点**（2026-09-21 船长报障：「各个子标签页和筛选似乎并没有本地化」· 第二批）。
 *
 * 病根：core 里有一族**中文名表/函数**（`ITEM_KIND_LABELS` · `DRONE_CLASS_LABELS` ·
 * `SHIP_ROLE_LABELS` · `itemKindText` · `aiCoreName` · `shipCategoryLabelOf`），theme 是"给中文界面用的
 * 现成字符串" ⇒ 渲染层直接拿去显示，英文界面下就**漏出中文**。实测命中处：
 * 市场筛选行与商品行的类型 chips、舰船页角色 chips、工业页「AI 核心（NN%）」下拉、物品/货仓/手册的类型名。
 *
 * 口径（与 `ui/itemSubs.ts` 的 `subText` 同一条）：**渲染层不显示 core 的中文串**，
 * 而是把 core 的**枚举键**（kind / droneClass / role / aicore 档）映射到一个 **l10n id**，再按当前语言取词。
 * core 侧一个字节不动（它继续给中文兜底，工具/模拟读数照旧）。
 *
 * 命名前缀说明：本模块的 id 落 `ui.labelsText.*`（与 `ui.itemSubs.*` 同族：都是"渲染层自己的文案表"）。
 * 表中的**大多数**条目其实是**复用既有 id**（`ui.IndustryPage.005` 原矿 / `ui.Handbook.004` 无人机 …），
 * 只有 core 独有的少数几个（零件 / 蓝图碎片 / 无人机机型 / AI 核心四档 / 键值连接符）才新登记。
 */
import type { AiCoreType, DroneClass, ItemKind, ModuleSlot, ShipRole, WormholeArchetype, WormholePlace } from '@whale/core'
import { tr } from '../i18n/locale'
// 槽类名复用市场/手册那份**已本地化**的槽位表（`RACK_SUBS` · `subText`）——**不另存第二份文案**
// （`rackText` 就建在它上面；`itemSubs.ts` 不 import 本文件 ⇒ 无环）
import { RACK_SUBS, subText } from './itemSubs'

/** 物品大类 → id（能复用既有 id 的一律复用，避免同中文两处登记） */
const KIND_ID: Record<ItemKind, string> = {
  ore: 'ui.IndustryPage.005', // 原矿 / Ore
  mineral: 'ui.itemSubs.006', // 原材料 / Materials
  gas: 'ui.IndustryPage.006', // 气体 / Gas
  ice: 'ui.IndustryPage.007', // 冰矿 / Ice
  ammo: 'ui.BattleScreen.003', // 弹药 / Ammo
  drone: 'ui.Handbook.004', // 无人机 / Drone
  wreck: 'ui.MarketPage.009', // 残骸 / Wreck
  container: 'ui.MarketPage.006', // 货柜 / Container
  kit: 'ui.itemSubs.001', // 修理组件 / Repair Kit
  luxury: 'ui.itemSubs.007', // 奢侈品 / Luxury goods
  aicore: 'ui.MarketPage.008', // AI 核心 / AI core
  matter: 'ui.Handbook.314', // 谜质储存器 / Enigma canisters
  essence: 'ui.MatterTechTab.005', // 虫洞谜质 / Wormhole Enigma
  // 以下 core 独有 ⇒ 新登记在 ui.labelsText.*
  part: 'ui.labelsText.001', // 零件 / Parts
  fragment: 'ui.labelsText.002', // 蓝图碎片 / Blueprint fragments
  blackbox: 'ui.labelsText.069', // 黑匣 / Black boxes（2026-09-26 独立成档：仓库/货仓/图鉴/市场同一把尺）
}

/** 无人机机型 → id（core 的 `DRONE_CLASS_LABELS` 是纯中文表） */
const DRONE_CLASS_ID: Record<DroneClass, string> = {
  scout: 'ui.labelsText.003', // 侦察机 / Scout
  combat: 'ui.labelsText.004', // 战斗机 / Combat
  assault: 'ui.labelsText.005', // 攻坚机 / Assault
  sentry: 'ui.labelsText.006', // 哨戒机 / Sentry
}

/** 舰船角色（= `shipCategoryKeyOf` 的取值域）→ id */
const ROLE_ID: Record<ShipRole, string> = {
  industrial: 'ui.Handbook.258', // 采矿 / Mining
  armed: 'ui.labelsText.007', // 武装 / Armed
  armored: 'ui.FitPage.003', // 装甲 / Armor
  hauler: 'ui.labelsText.008', // 航运 / Hauling
}

/** AI 核心四档 → id */
const AICORE_ID: Record<AiCoreType, string> = {
  basic: 'ui.labelsText.009', // 基础 AI 核心 / Basic AI core
  gamma: 'ui.labelsText.010', // 伽马 AI 核心 / Gamma AI core
  beta: 'ui.labelsText.011', // 贝塔 AI 核心 / Beta AI core
  alpha: 'ui.labelsText.012', // 阿尔法 AI 核心 / Alpha AI core
}

/** 物品大类名（= core `itemKindLabel` 的本地化版） */
export function kindText(kind: ItemKind): string {
  const id = KIND_ID[kind]
  return id !== undefined ? tr(id) : kind
}

/**
 * 「种类」文案（= core `itemKindText` 的本地化版）：无人机带上机型（`无人机 · 侦察机`），其余就是大类名。
 * 机型的连接符走 `ui.labelsText.013`（`"{p1} · {p2}"`）⇒ 中英各自决定用不用空格与什么符号。
 */
export function kindTextOfItem(item: { kind: ItemKind; droneClass?: DroneClass }): string {
  const base = kindText(item.kind)
  if (item.kind === 'drone' && item.droneClass !== undefined) {
    const cls = DRONE_CLASS_ID[item.droneClass]
    return tr('ui.labelsText.013', { p1: base, p2: cls !== undefined ? tr(cls) : item.droneClass })
  }
  return base
}

/** 舰船角色/类别名（= core `shipCategoryLabelOf` 的本地化版；入参用 `shipCategoryKeyOf(def)` 的返回值） */
export function shipRoleText(role: ShipRole): string {
  const id = ROLE_ID[role]
  return id !== undefined ? tr(id) : role
}

/**
 * **模块槽位名**（2026-09-22 补；= core `SLOT_LABELS` 的本地化版）。
 *
 * 病根同本文件开头那族：core 的 `SLOT_LABELS` 是纯中文表，手册的装备图鉴卡副标题、槽位 chip、
 * 详情行都直接读它 ⇒ 英文界面下整片漏中文（飞船长令「先进行手册的本地化」实测：装备图鉴一页 140 处）。
 * 能复用既有条目的已复用（采集器 / 打捞器 / 推进器 / 目标锁定），其余登记在 `ui.labelsText.049~059`。
 * ⚠ 新增槽位（`labels.ts` 的 `MODULE_SLOTS` 扩容）时**同步在此加一行**，否则会回落成中文。
 * **2026-09-27**：表类型由 `Record<string, string>` 收紧为 **`Record<ModuleSlot, string>`** ——
 * 从此"core 加了新槽位、这里忘了登记"**在 typecheck 就红**，不会再靠人眼（`plug` 就是这么漏的：
 * 二号加「舰船插件」槽后，中文界面里那一档显示成英文 `plug`）。
 */
const SLOT_ID: Readonly<Record<ModuleSlot, string>> = {
  miner: 'ui.Wormhole.238', // 采集器 / Miners
  cargo: 'ui.labelsText.049', // 货舱扩展 / Cargo Expander
  turret: 'ui.labelsText.050', // 炮台 / Turret
  missile: 'ui.labelsText.051', // 导弹架 / Missile Bay
  laser: 'ui.labelsText.052', // 激光炮 / Laser
  salvager: 'ui.Wormhole.001', // 打捞器 / Salvager
  shield: 'ui.labelsText.053', // 护盾装置 / Shield Unit
  armor: 'ui.labelsText.054', // 装甲装置 / Armor Unit
  propulsion: 'ui.BattleScreen.004', // 推进器 / Thruster
  'drone-rack': 'ui.labelsText.055', // 无人机甲板扩展 / Drone Bay Extension
  'drone-tac': 'ui.labelsText.056', // 无人机战术 / Drone Tactical
  'drone-relay': 'ui.labelsText.057', // 无人机中继 / Drone Relay
  support: 'ui.labelsText.058', // 支援系统 / Support System
  cpu: 'ui.labelsText.059', // 协处理器 / Coprocessor
  'target-lock': 'ui.itemSubs.013', // 目标锁定 / Targeting
  // 2026-09-26 补（船长报障「高中低槽位数量的文本」时顺带查出的漏登记）：护盾充能力场装置那一支
  // 原先没有映射 ⇒ `slotText('shield-field')` 回落到槽位键本身（英文界面下显示 "shield-field"）
  'shield-field': 'ui.labelsText.065', // 护盾力场 / Shield Field
  // 2026-09-27 补（**船长报障「虫洞出现本地化错误，部分中文变成了英文」顺带查出的同类漏登记**）：
  // 二号 2026-09-26 加了 `plug`（舰船插件）槽，这里没跟 ⇒ 中文界面把槽位名显示成英文 `plug`。
  plug: 'ui.itemSubs.042', // 舰船插件 / Ship plugs（与市场/手册的槽位名同一份 id）
}

/**
 * 槽位名（core `SLOT_LABELS[slot]` 的本地化版；查不到原样返回，漏登记看得见）。
 * ⚠ 入参是存档里的裸字符串 ⇒ 访问处要收窄（表本身已是 `Record<ModuleSlot, string>`，漏登记由 typecheck 挡）。
 */
export function slotText(slot: string): string {
  const id = SLOT_ID[slot as ModuleSlot]
  return id !== undefined ? tr(id) : slot
}

/**
 * **槽类名（高槽 / 中槽 / 低槽）**（2026-09-26 补；= core `RACK_LABELS` 的本地化版）。
 *
 * 病根同本文件开头那族：core 的 `RACK_LABELS` 是纯中文表（`{ high: '高槽', mid: '中槽', low: '低槽' }`），
 * 而**渲染层另有一份同名的已本地化表**（`ui/itemSubs.ts` 的 `RACK_LABELS` → `ui.itemSubs.025/026/027`，
 * 市场「类型」下拉 / 手册装备图鉴 / 物品页仓库筛选都读那份）⇒ 谁读到 core 那份，英文界面下就漏中文。
 * 船长 2026-09-26 报障「**部分遗漏未本地化的文本（舰船类型，高中低槽位数量的文本）**」命中的就是这一类：
 * 船卡「槽位布局」行、装备信息「槽位 / 类型」行、装配台槽位组标题与换装托 toast 都直读了 core 那份。
 *
 * ⚠ **不另存第二份文案**：这里复用市场槽位那三条 id（`RACK_SUBS` 的键），与 `subText` 同一把尺
 * ——改槽类名只改一处；`rackText` 与 `subText(RACK_SUBS[i])` 逐字等价（契约 `ui:subs-check` 有断言）。
 */
export function rackText(rack: string): string {
  const sub = RACK_SUBS.find((s) => s.key === rack)
  return sub !== undefined ? subText(sub) : rack
}

/**
 * **窝点档名**（外围 / 核心 / 深层）（2026-09-26 补；= core `LAIR_TIER_LABELS` 的本地化版）。
 * 三档的 id 是本批新登记（`ui.labelsText.066~068`）——core 那张表是纯中文，原先被
 * `panels/Expedition.tsx` 直接渲染（窝点卡与"本日 N 席"汇总行）⇒ 英文界面下漏中文。
 */
const LAIR_TIER_ID: Record<number, string> = {
  1: 'ui.labelsText.066', // 外围 / Periphery
  2: 'ui.labelsText.067', // 核心 / Core
  3: 'ui.labelsText.068', // 深层 / Deep
}
export function lairTierText(tier: number): string {
  const id = LAIR_TIER_ID[tier]
  return id !== undefined ? tr(id) : String(tier)
}

/**
 * **虫洞地点名**（空信息地点 / 舰船墓场 / 遗迹 / 舰船信号 / 矿脉 / 虫洞谜质 / 漂浮信标）
 * （= core `WORMHOLE_PLACE_TEXT` 的本地化版）。
 *
 * 🔴 **2026-09-27 修 · 船长报障「虫洞出现本地化错误，部分中文变成了英文」**：
 * 本表原先的**键是错的**——用了「信号名」那一套（`wreck` / `signal` / `essence`），
 * 而 `WormholePlace` 的真实取值是 `empty | graveyard | ruins | ship | vein | matter | beacon`。
 * `placeText()` 又写的是"查不到就原样返回键"⇒ 地图上**4/7 个地点直接显示英文键**：
 * `graveyard` / `ship` / `matter` / `beacon`（只有 empty / ruins / vein 三个碰巧撞对）。
 * 上一版还把 id 与键错配（`wreck` ↦ 舰船墓场那条 id），所以连"错得看得见"都没做到。
 *
 * 修法两道：① 键按 core 的**真实取值域**重写；② 表类型收紧为 **`Record<WormholePlace, string>`**
 * ⇒ 以后 core 再加地点，**typecheck 就红**（不会再静默漏出一个英文键）。
 * 新增 `core.wormholePlace.004`（漂浮信标 / Drifting beacon）——此前无对应 id。
 */
const PLACE_ID: Readonly<Record<WormholePlace, string>> = {
  empty: 'ui.Wormhole.223', // 空信息 / Empty information
  graveyard: 'core.wormholePlace.001', // 舰船墓场 / Graveyard
  ruins: 'core.wormholePlace.002', // 遗迹 / Ruins
  ship: 'ui.Wormhole.221', // 舰船信号 / Ship signal
  vein: 'core.wormholePlace.003', // 矿脉 / Ore Vein
  matter: 'ui.MatterTechTab.005', // 虫洞谜质 / Wormhole Enigma
  beacon: 'core.wormholePlace.004', // 漂浮信标 / Drifting beacon
}
export function placeText(place: WormholePlace): string {
  return tr(PLACE_ID[place])
}

/**
 * **虫洞内容原型名**（均衡深区 / 残骸富集 / 遗迹密集 / 母矿脉 / 交火密集）（= core `WORMHOLE_ARCHETYPE_LABELS`
 * 的本地化版）。五条**全部新登记**（`core.wormholeArch.*`）。
 * ⚠ 表类型同样收紧为 `Record<WormholeArchetype, string>`（同一类漏登记在 typecheck 就红）。
 */
const ARCHETYPE_ID: Readonly<Record<WormholeArchetype, string>> = {
  balanced: 'core.wormholeArch.001', // 均衡深区 / Balanced deep zone
  wreck: 'core.wormholeArch.002', // 残骸富集 / Wreck-rich
  ruins: 'core.wormholeArch.003', // 遗迹密集 / Ruin-dense
  vein: 'core.wormholeArch.004', // 母矿脉 / Mother lode
  combat: 'core.wormholeArch.005', // 交火密集 / Combat-heavy
}
export function archetypeText(archetype: WormholeArchetype): string {
  return tr(ARCHETYPE_ID[archetype])
}


/**
 * **舰级名**（= core `shipSizeLabel(tier)` 的本地化版）。
 * 整档模板在 `ui.labelsText.014~018`（`"T{p1} 护卫舰"` / `"T{p1} Frigate"`）⇒ 档号必须由译文自己写，
 * 故这里传 `p1 = tier`（与 `ui/itemSubs.ts` 的 `SHIP_TIER_SUBS` 同一批 id，不另登记）。
 */
export function shipTierText(tier: number): string {
  const id = `ui.labelsText.0${13 + tier}`
  return tr(id, { p1: tier })
}

/** AI 核心档位名（= core `aiCoreName` 的本地化版） */
export function aiCoreText(type: AiCoreType): string {
  const id = AICORE_ID[type]
  return id !== undefined ? tr(id) : type
}

/**
 * 技能分类名（= `SKILL_GROUPS` 的本地化版）。
 * ⚠ 入参是 core/data 侧的**中文分类名**（中文即键，见 `packages/data/src/skills.ts` 的 `SKILL_GROUPS`），
 * 故这里按中文名查表；查不到就原样返回（新分类漏登记时**看得见**，不会静默变空）。
 */
const SKILL_GROUP_ID: Record<string, string> = {
  舰船: 'ui.labelsText.019',
  工业: 'ui.labelsText.020',
  战斗: 'ui.labelsText.021',
  工程: 'ui.labelsText.022',
  贸易: 'ui.labelsText.023',
  物流: 'ui.labelsText.024',
  探索: 'ui.labelsText.025',
}
export function skillGroupText(group: string): string {
  const id = SKILL_GROUP_ID[group]
  return id !== undefined ? tr(id) : group
}

/**
 * **技能书名**（技能树页的分支，**2026-09-22 船长令**「将现有的技能再进行细分」＝ 23 本）——
 * 与 `skillGroupText` 同款：数据侧只存 id（`SkillDef.branch`），名字在这里查表（中英齐）。
 * 查不到就原样返回（漏登记时**看得见**，不静默变空）。
 */
const SKILL_BRANCH_ID: Record<string, string> = {
  'b-fly': 'ui.labelsText.026',
  'b-mine': 'ui.labelsText.027',
  'b-refine': 'ui.labelsText.028',
  'b-craft': 'ui.labelsText.029',
  'b-salvage': 'ui.labelsText.030',
  'b-auto': 'ui.labelsText.031',
  'b-build': 'ui.labelsText.032',
  'b-indship': 'ui.labelsText.033',
  'b-weapon': 'ui.labelsText.034',
  'b-aim': 'ui.labelsText.035',
  'b-ammo': 'ui.labelsText.036',
  'b-drone': 'ui.labelsText.037',
  'b-warship': 'ui.labelsText.038',
  'b-protect': 'ui.labelsText.039',
  'b-repair': 'ui.labelsText.040',
  'b-shipfit': 'ui.labelsText.041',
  'b-ai': 'ui.labelsText.042',
  'b-learn': 'ui.labelsText.043',
  'b-scan': 'ui.labelsText.044',
  'b-survive': 'ui.labelsText.045',
  'b-market': 'ui.labelsText.046',
  'b-bounty': 'ui.labelsText.047',
  'b-logistics': 'ui.labelsText.048',
}
export function skillBranchText(branch: string): string {
  const id = SKILL_BRANCH_ID[branch]
  return id !== undefined ? tr(id) : branch
}
