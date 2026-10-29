import { type MaterialNeed } from '@whale/core'
import { SUB_ALL, type ManuTabKey } from '../../ui/itemSubs'

export type HudTab = 'refine' | 'craft' | 'shipyard' | 'lab'

/**
 * **书架一级门类五档**（**2026-10-01 船长令**：「建议参考旧版的组装机筛选」⇒ 按你确认的裁定补齐）——
 * 键与顺序照旧版组装机的 `MANU_TABS_CRAFT`（插件档排末位），文案 id 复用既有条目、不新造同义串。
 * `plug` 档在**取得第一个黑匣前不出现**（判据 = core `plugCraftUnlockedOf`，与旧页同一条令）。
 */
export type HudShelfKind = ManuTabKey | typeof SUB_ALL

export const SHELF_KIND_TABS: ReadonlyArray<{ key: HudShelfKind; id: string }> = [
  { key: SUB_ALL, id: 'ui.hud.106' },
  { key: 'equip', id: 'ui.hud.102' },
  { key: 'part', id: 'ui.itemSubs.036' },
  { key: 'supply', id: 'ui.itemSubs.037' },
  { key: 'plug', id: 'ui.itemSubs.042' },
]

/** 精炼炉投料的一级档（与现有工业页 `FURNACE_TABS` 同口径：全部 / 可精炼资源 / 残骸回收 / 货柜拆解） */
export type FeedTab = 'all' | 'ore' | 'wreck' | 'box'

/** 一级档的图标与文案 id（文案复用现有工业页那四条 id，不新造同义串） */
export const FEED_TABS: ReadonlyArray<{ k: FeedTab; glyph: string; id: string }> = [
  { k: 'all', glyph: 'ico-feed', id: 'ui.IndustryPage.001' },
  { k: 'ore', glyph: 'ore', id: 'ui.IndustryPage.002' },
  { k: 'wreck', glyph: 'wreck', id: 'ui.IndustryPage.003' },
  { k: 'box', glyph: 'container', id: 'ui.IndustryPage.004' },
]

/** 环的一个分段（`key` 与构成表行一一对应；`isk` = 该资源产值/h） */
export interface ShareSeg {
  key: string
  label: string
  isk: number
  detail: string
}

/** 组装机书架的一行（只留 HUD 表要用的字段；判据全部走既有单点） */
export interface HudShelfRow {
  id: string
  /** 图纸名 */
  name: string
  /** 产物显示名 */
  product: string
  /** 产物图标用的类别键（交给 `RowGlyph`） */
  glyph: string
  /**
   * 一级门类（**2026-10-01 船长令**：补齐为五档，与旧工业页 `MANU_TABS_CRAFT` 同一套键）·
   * 二级子类键（装备=产物功能组 / 消耗品=产物大类 / 零件=基础·高级）·
   * 学会与一次性 —— 三样都由**全仓单点** `bpFilterKeysOf` 现算（不再本页自算）。
   */
  keys: { tab: HudShelfKind; subKey: string; singleUse: boolean }
  /** core `sortManuRows` 认的口径键（内容层联合 key，渲染处不显示） */
  kindLabel: string
  /** core `sortManuRows` 认的产物唯一键（同产物的一次性图纸紧随原图纸） */
  productKey: string
  /** core `sortManuRows` 认的书价（市场目录基准价；0 = 沉底） */
  bookPrice: number
  /** 一次性图纸（sortManuRows 的排序口径要它：同产物的原图纸与一次性图纸相邻；分档判据另走 keys.singleUse） */
  singleUse: boolean
  materials: readonly MaterialNeed[]
  buildSeconds: number
}
