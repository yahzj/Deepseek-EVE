import type { GameState } from './state'

export const PLUG_BLACKBOX_ITEM_ID = 'blackbox-h'

export function blackBoxItemIdOfFamily(family: string): string {
  return `blackbox-${family.toLowerCase()}`
}

export function blackBoxItemIdForFamily(family: string, hasItem?: (itemId: string) => boolean): string {
  const id = blackBoxItemIdOfFamily(family)
  return hasItem === undefined || hasItem(id) ? id : PLUG_BLACKBOX_ITEM_ID
}

export function isBlackboxItem(itemId: string): boolean {
  return itemId.startsWith('blackbox-')
}

export const BLACKBOX_ITEM_IDS: readonly string[] = [
  PLUG_BLACKBOX_ITEM_ID,
  blackBoxItemIdOfFamily('R'),
  blackBoxItemIdOfFamily('C'),
  blackBoxItemIdOfFamily('D'),
  'blackbox-universal',
]

export function noteBlackboxObtained(state: GameState): void {
  if (state.blackboxSeen === true) return
  state.blackboxSeen = true
}

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

export function plugCraftUnlockedOf(state: GameState): boolean {
  return blackboxSeenOf(state)
}

export interface PlugCraftLock {
  textId: string
  text: string
}

export function plugCraftLockReasonOf(state: GameState): PlugCraftLock | null {
  if (plugCraftUnlockedOf(state)) return null
  return { textId: 'ui.IndustryPage.116', text: '取得第一个黑匣后解锁' }
}
