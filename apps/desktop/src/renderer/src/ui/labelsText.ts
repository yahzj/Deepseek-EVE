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
import type { AiCoreType, DroneClass, ItemKind, ShipRole } from '@whale/core'
import { tr } from '../i18n/locale'

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
