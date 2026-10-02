/**
 * **黑匣与「舰船插件」解锁**（**2026-09-26 船长令**）。
 *
 * 船长原话（照抄）：「**玩家获取第一个黑匣后，才解锁组装机的插件选项，并且弹出相关通讯，
 * 通讯内跳转。**」
 *
 * ## 一句话
 * 玩家**第一次拿到黑匣**那一刻 ⇒ 置位随档标记 `blackboxSeen` ⇒
 * ① 组装机的「舰船插件」门类解锁；② 章鱼人发一封通讯（带「前往」直达兑换窗口）。
 * （**2026-10-02 起黑匣按族各一件**：H 墨潮 / R 光环 —— 见下面 `blackBoxItemIdOfFamily`。）
 *
 * ## 三条口径
 * 1. **置位点 = 黑匣入库的唯一入口**（`inventory.addItem` / `inventory.addWare` 里各调一次
 *    `noteBlackboxObtained`）⇒ 两条入库路（入侵旗舰掉落走货仓、残骸插件换回走物品仓库）都覆盖，
 *    不需要在每个发放点抄一遍；
 * 2. **标记三态**：`true` = 拿到过 · `false` = 本功能之后开的新档、还没拿到 · `undefined` = 老档
 *    ⇒ 读档时按"仓库/货仓里到底有没有黑匣"回填（`blackboxSeenOf`），免得老玩家被锁在门外；
 * 3. **判定单点** `plugCraftUnlockedOf(state)`：组装机 UI 与用例都读它，别各写一份。
 */
import type { GameState } from './state'

/**
 * **落款黑匣物品 id** = H 族（墨潮旗舰黑匣）：**该族那一件**，同时兼两件事的兜底 ——
 * ① 老快照/老配方里没写族时按它取（历史读数与配方数据一字不改）；
 * ② 某族的匣在内容表里缺失时退回落款（`blackBoxItemIdForFamily`）。
 */
export const PLUG_BLACKBOX_ITEM_ID = 'blackbox-h'

/**
 * **族 → 该族旗舰黑匣的物品 id**（约定 `blackbox-<族小写>`；**2026-10-02 船长令「甲」**）。
 *
 * 起因 = 玩家报障「**光环入侵结束给的黑匣还是墨潮的**」：原先 `weekendBattle.weekendGrantRewards`
 * **写死**发 `blackbox-h` ⇒ R 族（光环科技）玩家打完自家旗舰拿到的却是墨潮那件（名字、卖价、料值
 * 全是 H 的）。现在**按族取**：发放侧（击沉那一拍 / 结算补发 / 对账补发）与结算快照、结算信
 * 都读这一个函数，**不再各自拼 id**。
 *
 * ⚠ 与 `data/items.ts` 的登记**成对**：每个 BOSS 族都必须有 `blackbox-<族小写>` 这件物品 ——
 * 由 `content:check` 的「每族黑匣契约」按 `WEEKEND_BOSS_FAMILIES` 逐个核对（缺了即报红）。
 */
export function blackBoxItemIdOfFamily(family: string): string {
  return `blackbox-${family.toLowerCase()}`
}

/**
 * **取"这一族该发哪一件匣"**（发放侧的唯一取数口）。
 *
 * `hasItem` 给了（发放侧手上有 `ctx.items`）⇒ 先探一下该族那件**在不在内容表里**：
 * 不在（内容包破损 / 新族还没配匣）就退回落款 `blackbox-h` —— 宁可发一件**同价同用途**的族匣，
 * 也不让这一枚发不出去（发不出去 ⇒ `weekendGrantRewards` 返回 0 ⇒「已结清」永远置不上，
 * 结算/对账两条入口会一拍一拍地重试）。
 *
 * ⚠ 正常路径**永远走族匣**：契约（上一条注释）保证每族都有；回落只兜内容破损。
 */
export function blackBoxItemIdForFamily(family: string, hasItem?: (itemId: string) => boolean): string {
  const id = blackBoxItemIdOfFamily(family)
  return hasItem === undefined || hasItem(id) ? id : PLUG_BLACKBOX_ITEM_ID
}

/** 该物品算不算黑匣（判据 = id 前缀 ⇒ **加族零改动**：物品 id 按 `blackbox-<族小写>` 取） */
export function isBlackboxItem(itemId: string): boolean {
  return itemId.startsWith('blackbox-')
}

/**
 * 黑匣物品 id 列表（回填与"手上有实物吗"的展示用）：**全部 `blackbox-*` 成品**
 * —— 两件族匣（墨潮 H / 光环 R）＋ 声望换的通用黑匣（它同样置位"见过黑匣"、同样能下料）。
 */
export const BLACKBOX_ITEM_IDS: readonly string[] = [
  PLUG_BLACKBOX_ITEM_ID,
  blackBoxItemIdOfFamily('R'),
  'blackbox-universal',
]

/**
 * **记下"玩家拿到了黑匣"**（幂等；**唯一置位点**，由库存入库路径调用）。
 * 已经置位过 ⇒ 一个字节不动（不改状态、不推日志）。
 */
export function noteBlackboxObtained(state: GameState): void {
  if (state.blackboxSeen === true) return
  state.blackboxSeen = true
}

/**
 * **见过黑匣没有**（组装机解锁与通讯触发的**唯一读点**）。
 *
 * - 显式 `true` / `false` ⇒ 直接返回；
 * - `undefined`（老档）⇒ **回填**：仓库或任一舰队货仓里有黑匣就算见过（写回状态，跨会话稳定）。
 */
export function blackboxSeenOf(state: GameState): boolean {
  if (state.blackboxSeen === true) return true
  if (state.blackboxSeen === false) return false
  let has = false
  for (const id of BLACKBOX_ITEM_IDS) {
    if ((state.warehouse.items[id] ?? 0) > 0) has = true
  }
  if (!has) {
    for (const ship of Object.values(state.fleet)) {
      for (const id of BLACKBOX_ITEM_IDS) if ((ship?.cargo?.[id] ?? 0) > 0) has = true
    }
  }
  state.blackboxSeen = has
  return has
}

/** **组装机的「舰船插件」门类解锁了没有**（= 见过黑匣；UI 与用例的唯一判据） */
export function plugCraftUnlockedOf(state: GameState): boolean {
  return blackboxSeenOf(state)
}

/** 锁着时给界面用的拒因（**结构化**：`textId` 走本地化表；解锁后返回 null） */
export interface PlugCraftLock {
  textId: string
  text: string
}

/** 界面文案用：锁着时显示的原因（解锁后返回 null） */
export function plugCraftLockReasonOf(state: GameState): PlugCraftLock | null {
  if (plugCraftUnlockedOf(state)) return null
  /**
   * ⚠ **2026-10-02 两处修**（⟪文案调整 2026-10-02⟫）：
   * ① `textId` 原先写的是 `ui.IndustryPage.090` —— 表里那一条是**精炼炉的"本炉料余"**，
   *    与本句无关（真界面的插件锁行读的是 `ui.IndustryPage.116`）⇒ 改指 116；
   * ② 文案由「取得第一个**墨潮旗舰**黑匣后解锁」泛化为「取得第一个**黑匣**后解锁」
   *    （**船长 2026-10-02 令「甲」**：一件族一件匣，光环那件同样解锁插件）。
   */
  return { textId: 'ui.IndustryPage.116', text: '取得第一个黑匣后解锁' }
}
