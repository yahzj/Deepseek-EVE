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
import { hoverTipProps } from './Tooltip'

export type ItemViewMode = 'grid' | 'list'
export const ITEM_VIEW_KEY = 'whale-idle:inv-view'
export const ICON_LIST_GROUP = 'icon-list-view'

export function useItemView(): [ItemViewMode, (m: ItemViewMode) => void] {
  const [mode, setMode] = useState<ItemViewMode>(() => {
    try {
      const raw = localStorage.getItem(ITEM_VIEW_KEY)
      return raw === 'list' ? 'list' : 'grid' // 默认图标视图（船长 2026-09-05）
    } catch {
      return 'grid'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(ITEM_VIEW_KEY, mode)
    } catch {
      /* 无 localStorage 环境忽略 */
    }
  }, [mode])
  return [mode, setMode]
}

/** 图标/列表切换条（手册同款 viewbar） */
export function ItemViewBar({ mode, onChange }: { mode: ItemViewMode; onChange: (m: ItemViewMode) => void }) {
  return (
    <div className="app-hand-viewbar" data-ui-group={ICON_LIST_GROUP}>
      <button className={`app-hand-viewbtn${mode === 'grid' ? ' is-active' : ''}`} onClick={() => onChange('grid')}>
        图标
      </button>
      <button className={`app-hand-viewbtn${mode === 'list' ? ' is-active' : ''}`} onClick={() => onChange('list')}>
        列表
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
}

/** 分类补充说明（仓库/货仓列表与图标模式共用；2026-09-08 船长反馈弹药/无人机存放含义） */
export function kindExtraNote(kind: string): string | null {
  if (kind === 'drone') {
    return '无人机需先在 装配页「无人机舱」装入清单（舱容 = 船体 + 甲板扩展；与装配共用 CPU），战斗只放飞已装入的；仓库余量不自动出战。战术导控阵列增伤。敌方点防会击落机群——被击落的无人机自清单永久损失，战斗结束会立刻按本场出发编制自动补足（先取本船货仓、再取物品仓库），两处都没存货才需要自己去买。'
  }
  if (kind === 'ammo') {
    return '弹药在战斗中自动消耗：开战时从 仓库/货仓 按需取用（货仓优先）；放仓库同样出战且不随船遗失——货仓里的弹药可随时卸回仓库更安全。'
  }
  // 2026-09-19 玩家报障修（「回收残骸集齐了 25 个蓝图碎片，但是找不到在哪换成蓝图」）：碎片这一组必须写清去处
  if (kind === 'fragment') {
    return '蓝图碎片来自残骸回收的高威胁彩头。集齐门槛后，在这一行点「逆向解锁」即可换成该装备的永久蓝图（货仓与仓库的碎片一起扣；需停靠空间站）。集齐前不会重复掉同一本书的碎片，拿到蓝图后它就不再出现。'
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
            style={{ '--tone': tone } as CSSProperties}
            title={tip === null ? c.title : undefined}
            {...(tip ?? {})}
            onClick={onPick ? () => onPick(c.key) : undefined}
          >
            <span className="app-hand-cell-icon">
              <Glyph name={c.glyph} size={30} color={tone} />
            </span>
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
