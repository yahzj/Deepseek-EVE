import { type MaterialNeed } from '@whale/core'
import { SUB_ALL, type ManuTabKey } from '../../ui/itemSubs'

export type HudTab = 'refine' | 'craft' | 'shipyard' | 'lab'

export type HudShelfKind = ManuTabKey | typeof SUB_ALL

export const SHELF_KIND_TABS: ReadonlyArray<{ key: HudShelfKind; id: string }> = [
  { key: SUB_ALL, id: 'ui.hud.106' },
  { key: 'equip', id: 'ui.hud.102' },
  { key: 'part', id: 'ui.itemSubs.036' },
  { key: 'supply', id: 'ui.itemSubs.037' },
  { key: 'plug', id: 'ui.itemSubs.042' },
]

export type FeedTab = 'all' | 'ore' | 'wreck' | 'box'

export const FEED_TABS: ReadonlyArray<{ k: FeedTab; glyph: string; id: string }> = [
  { k: 'all', glyph: 'ico-feed', id: 'ui.IndustryPage.001' },
  { k: 'ore', glyph: 'ore', id: 'ui.IndustryPage.002' },
  { k: 'wreck', glyph: 'wreck', id: 'ui.IndustryPage.003' },
  { k: 'box', glyph: 'container', id: 'ui.IndustryPage.004' },
]

export interface ShareSeg {
  key: string
  label: string
  isk: number
  detail: string
}

export interface HudShelfRow {
  id: string
  name: string
  product: string
  glyph: string
  keys: { tab: HudShelfKind; subKey: string; singleUse: boolean }
  kindLabel: string
  productKey: string
  bookPrice: number
  singleUse: boolean
  materials: readonly MaterialNeed[]
  buildSeconds: number
}
