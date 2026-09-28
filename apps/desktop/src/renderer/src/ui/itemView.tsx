/**
 * 物品列表「图标网格 / 列表」切换（2026-09-05 船长：与手册 Handbook 同款排版，默认图标视图）。
 * 复用手册的 app-hand-viewbar / app-hand-viewbtn / app-hand-grid / app-hand-cell 样式与
 * Glyphs 科幻线性图标 + tone 色调；偏好存 localStorage。
 *
 * ── 内部标签（供检索，船长 2026-09-05）──
 * 本文件 = 「图标/列表视图切换」样式族的唯一实现，覆盖：手册（Handbook，同款 app-hand-*）、
 * 物品页仓库 / 货仓、装配页装备列表 等一切「icon-list-view」界面。
 * 检索入口：`grep data-ui-group="icon-list-view"`（渲染层）或 grep `ItemViewBar|ItemGlyphGrid|RowGlyph`。
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Glyph, toneOf } from './Glyphs'
import { FOE_ACCENT } from './tones'
import { crestLabelOf } from './labelsText'
import { tr } from '../i18n/locale'
import { hoverTipProps } from './Tooltip'

export type ItemViewMode = 'grid' | 'list'
/**
 * **旧版共用键**（2026-09-05 起）：所有用 `useItemView` 的页面共用一把尺 ⇒ 一处切换全站联动。
 * 2026-09-27 船长令「**图标和列表的切换，不同页面进行独立，不要联动改变**」后改为**按页面分键**；
 * 本键只作**过渡回落**（老档首次读时继承玩家上次的选择）与"保持最新"的兼容写入，不再作为主存储。
 */
export const ITEM_VIEW_KEY = 'whale-idle:inv-view'
/** 分键前缀：`whale-idle:view:<页面域>` */
export const ITEM_VIEW_PREFIX = 'whale-idle:view:'
export const ICON_LIST_GROUP = 'icon-list-view'

/**
 * 视图模式的作用域（**一页一个键**）。新页面要用图标/列表切换时：
 * ① 在这里加一个域；② 在自己的页面里 `useItemView('你的域')`。
 * ⚠ 同一页内的多个子标签（如物品页的「仓库/货仓」）**共用一个域**——它们是同一页的两个并列列表，
 * 分太细会让玩家每切一次子标签都要重设一次；要再细分请先与船长确认。
 */
export type ItemViewScope = 'items' | 'cargo' | 'skills'

const scopedKey = (scope: ItemViewScope): string => `${ITEM_VIEW_PREFIX}${scope}`

function readStored(key: string): ItemViewMode | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === 'list' || raw === 'grid' ? raw : null
  } catch {
    return null // 无 localStorage 环境
  }
}

function writeStored(key: string, m: ItemViewMode): void {
  try {
    localStorage.setItem(key, m)
  } catch {
    /* 无 localStorage 环境忽略 */
  }
}

/**
 * 图标 / 列表视图切换（**按 `scope` 各自记住**；默认图标视图 · 船长 2026-09-05）。
 *
 * 2026-09-27 船长：「图标和列表的切换，不同页面进行独立，不要联动改变」⇒ 本钩子改为**按页分键**：
 * 每个 `scope` 读自己的 `whale-idle:view:<scope>`，**互不影响**；本页内切换照旧即时生效。
 * 过渡口径：本页的分键**还没写过**时，先继承旧共用键的值（老档不会因为这次改动被重置）；
 * 旧共用键**从此不再被写入**——否则 A 页切一下，B 页首次进入会被它带跑，等于换个方式联动。
 */
export function useItemView(scope: ItemViewScope): [ItemViewMode, (m: ItemViewMode) => void] {
  const key = scopedKey(scope)
  const [mode, setMode] = useState<ItemViewMode>(() => readStored(key) ?? readStored(ITEM_VIEW_KEY) ?? 'grid')
  useEffect(() => {
    writeStored(key, mode)
    /**
     * ⚠ **故意不写回旧共用键**（2026-09-27 船长令「不同页面独立、不要联动改变」）：
     * 旧键只用于"本页分键还没初始化时继承一次"，**不再被任何写入更新**——
     * 否则 A 页切一下，B 页下次进（若尚未初始化）会被它带跑，等于换了个方式联动。
     */
  }, [key, mode])
  return [mode, setMode]
}

/** 图标/列表切换条（手册同款 viewbar） */
export function ItemViewBar({ mode, onChange }: { mode: ItemViewMode; onChange: (m: ItemViewMode) => void }) {
  return (
    <div className="app-hand-viewbar" data-ui-group={ICON_LIST_GROUP}>
      <button className={`app-hand-viewbtn${mode === 'grid' ? ' is-active' : ''}`} onClick={() => onChange('grid')}>
        {tr("ui.Handbook.015")}
      </button>
      <button className={`app-hand-viewbtn${mode === 'list' ? ' is-active' : ''}`} onClick={() => onChange('list')}>
        {tr("ui.Handbook.016")}
      </button>
    </div>
  )
}

export interface ItemGridCell {
  key: string
  /** Glyphs 图标名（物品 = kind；装备 = slot） */
  glyph: string
  name: string
  sub?: string
  /** **纯文本**提示（单行；有 `hover` 时以 `hover` 为准——两者不许并存，见 `ui/Tooltip.tsx`） */
  title?: string
  /**
   * **富内容悬停卡**（`itemHoverContent` / `moduleHoverContent` 的产物）——2026-09-19 船长报障
   * 「悬停不是显示富文本详细，又改回简易介绍了」：
   * 图标模式的卡片原先一律只挂 `title={desc}`（简易介绍），与**同页列表模式**（`ItemHover`/`ModuleHover`
   * 富卡）不一致；现由本字段带富卡内容，`ItemGlyphGrid` 统一用 `hoverTipProps` 接线
   * （与全站富卡同一条路：同一延迟、同一单例层；⚠ 同一个元素**禁** `title` + `hoverTipProps` 并存）。
   */
  hover?: ReactNode
  /**
   * 图标色覆盖（缺省 = `toneOf(glyph)`）。
   * 用途只有一个：货仓页 / 物品页仓库给**稀有残骸**上稀有金（船长 2026-09-19）；
   * 其余调用方不传 ⇒ 与改动前逐字一致（手册 / 装配 / 货仓的装备卡都不受影响）。
   */
  tone?: string
  /**
   * **稀有度档**（1~5；`undefined` = 不显示标签）。
   *
   * 2026-09-20 船长：「希望给每个物品的图标模式右上角添加物品稀有度展示的小标签
   * （采用 R1 表示 1 级稀有度，并以此类推）」。
   *
   * 由**调用方**传（`itemRarityTierOf(id)` 查一次），本组件不自查 ⇒ 装配页那类"自建候选卡"
   * 也能照常不传；查不到档的物品（既非市场行也不在市场外档表里）**不显示标签**，不硬塞 R1。
   */
  rarity?: number
  /**
   * **族徽角标（左上角）** ——值 = 势力族字母（`'A' | 'C' | 'D' | 'E' | 'G' | 'H'`），缺省 = 不标。
   *
   * **2026-09-26 船长令**：「**给所有位置势力专属的舰船和装备的图标卡片的左上角标注势力族徽**」；
   * **2026-09-27 船长报障**：「**物品仓库内的势力装备，左上角没有角标，能否将所有功能相同的同类型的
   * 图标规则进行统一下**」⇒ 本组件（物品页仓库 / 货仓 / 一切用 `ItemGlyphGrid` 的图标卡）
   * 与手册图鉴的 `IconGrid` 从此**同一套角标规则**（同位置、同大小、同取色、同可读名）。
   *
   * ⚠ 判据**不在这里**：调用方一律走单点 `crestFamOf(id)`（`ui/labelsText.ts`，把 `null`/`undefined`
   * 收窄成一种"没有"）。本组件只认 `crest != null` 再画（**最后一层兜底**：`null` 漏进来会
   * `toLowerCase` 崩整页 —— 2026-09-27 船长报障过的那次）。
   */
  crest?: string
}

/** 分类补充说明（仓库/货仓列表与图标模式共用；2026-09-08 船长反馈弹药/无人机存放含义） */
export function kindExtraNote(kind: string): string | null {
  if (kind === 'drone') {
    return tr("ui.itemView.001")
  }
  if (kind === 'ammo') {
    return tr("ui.itemView.002")
  }
  // 2026-09-19 玩家报障修（「回收残骸集齐了 25 个蓝图碎片，但是找不到在哪换成蓝图」）：碎片这一组必须写清去处
  if (kind === 'fragment') {
    return tr("ui.itemView.003")
  }
  return null
}

/**
 * 列表视图行首小图标（手册图鉴同款：`<RowGlyph glyph={…} /> 名称`）。
 * 2026-09-10 船长：物品页仓库与货仓的**列表模式**照手册图鉴在名字前加对应图标。
 * 键口径与图鉴一致——物品取 `def.kind`、装备取 `def.slot`（同一个 Glyphs 图标库 + toneOf 色调）。
 * 本组件 = 该行首图标的唯一实现（手册/物品页/货仓共用），样式沿用图鉴行样式 `.app-hand-row-glyph`。
 *
 * `tone` 可选：只有货仓页 / 物品页仓库给**稀有残骸**传稀有金（船长 2026-09-19），
 * 缺省仍走 `toneOf(glyph)` ⇒ 手册、装配等既有调用零变化。
 */
export function RowGlyph({ glyph, tone }: { glyph: string; tone?: string }) {
  return (
    <span className="app-hand-row-glyph" style={{ color: tone ?? toneOf(glyph) }}>
      <Glyph name={glyph} size={15} color="currentColor" />
    </span>
  )
}

/**
 * 图标网格（手册 app-hand-grid/cell 同款；供物品/装备浏览用，可选点击回调）。
 *
 * ⚠ **悬停**（2026-09-19 船长报障）：格子带 `hover`（富卡内容）时走 `hoverTipProps`——与列表模式的
 * `ItemHover`/`ModuleHover` 同一条路、同一延迟；只有没给 `hover` 的调用方（如装配页自建的候选卡）
 * 才退回纯文本 `title`。**两者不许并存**（会互顶，见 `ui/Tooltip.tsx`）。
 */
export function ItemGlyphGrid({ cells, onPick }: { cells: ItemGridCell[]; onPick?: (key: string) => void }) {
  if (cells.length === 0) return null
  return (
    <div className="app-hand-grid" data-ui-group={ICON_LIST_GROUP}>
      {cells.map((c) => {
        const tone = c.tone ?? toneOf(c.glyph)
        const tip = c.hover !== undefined ? hoverTipProps(c.hover) : null
        return (
          <div
            key={c.key}
            className="app-hand-cell"
            /* `position: relative`：两枚角标（左上族徽 / 右上稀有度）都绝对定位 */
            style={{ '--tone': tone, position: 'relative' } as CSSProperties}
            title={tip === null ? c.title : undefined}
            {...(tip ?? {})}
            onClick={onPick ? () => onPick(c.key) : undefined}
          >
            <span className="app-hand-cell-icon">
              <Glyph name={c.glyph} size={30} color={tone} />
            </span>
            {/**
             * **族徽角标（左上角）** —— 与手册图鉴 `IconGrid` **同一套语言**（同 `left: 3px`、
             * 同 `zIndex`、同 13px 线稿族徽、同 `FOE_ACCENT` 族色、同"可读名 = 势力全称"）。
             * ⚠ 判据用 `!= null` 同时挡掉 `null` 与 `undefined`（见 `crest` 字段的说明）。
             */}
            {c.crest != null ? (
              <span
                className={`app-map-famchip is-fam-${c.crest}`}
                aria-label={crestLabelOf(c.crest)}
                style={{ position: 'absolute', top: 3, left: 3, zIndex: 1, color: FOE_ACCENT[c.crest] ?? tone, pointerEvents: 'none' }}
              >
                <Glyph name={`fam-${c.crest.toLowerCase()}`} size={13} color="currentColor" />
              </span>
            ) : null}
            {/* 稀有度小标签（2026-09-20 船长）：钉在格子右上角；查不到档就不渲染 */}
            {c.rarity !== undefined ? (
              <span className={`app-hand-cell-rarity is-r${c.rarity}`} aria-label={`稀有度 R${c.rarity}`}>
                R{c.rarity}
              </span>
            ) : null}
            <span className="app-hand-cell-name">{c.name}</span>
            {c.sub ? <span className="app-hand-cell-sub">{c.sub}</span> : null}
          </div>
        )
      })}
    </div>
  )
}
