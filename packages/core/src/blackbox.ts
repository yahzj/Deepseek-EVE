/**
 * **黑匣与「舰船插件」解锁**（**2026-09-26 船长令**）。
 *
 * 船长原话（照抄）：「**玩家获取第一个黑匣后，才解锁组装机的插件选项，并且弹出相关通讯，
 * 通讯内跳转。**」
 *
 * ## 一句话
 * 玩家**第一次拿到墨潮旗舰黑匣**那一刻 ⇒ 置位随档标记 `blackboxSeen` ⇒
 * ① 组装机的「舰船插件」门类解锁；② 章鱼人发一封通讯（带「前往」直达兑换窗口）。
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
import { PLUG_BLACKBOX_ITEM_ID } from './plugs'

/** 该物品算不算黑匣（判据 = id 前缀；目前只有 `blackbox-h`，日后加族只改这一处） */
export function isBlackboxItem(itemId: string): boolean {
  return itemId.startsWith('blackbox-')
}

/** 黑匣物品 id 列表（回填与展示用；与 `plugs.PLUG_BLACKBOX_ITEM_ID` 同一件） */
export const BLACKBOX_ITEM_IDS: readonly string[] = [PLUG_BLACKBOX_ITEM_ID]

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
  return { textId: 'ui.IndustryPage.090', text: '取得第一个墨潮旗舰黑匣后解锁' }
}
