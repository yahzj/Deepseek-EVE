/**
 * 物品列表「图标网格 / 列表」切换（2026-09-05 船长：与手册 Handbook 同款排版，默认图标视图）。
 * 复用手册的 app-hand-viewbar / app-hand-viewbtn / app-hand-grid / app-hand-cell 样式与
 * Glyphs 科幻线性图标 + tone 色调；偏好存 localStorage。
 *
 * ── 内部标签（供检索，船长 2026-09-05）──
 * 本文件 = 「图标/列表视图切换」样式族的唯一实现，覆盖：手册（Handbook，同款 app-hand-*）、
 * 物品页仓库 / 货仓、装配页装备列表 等一切「icon-list-view」界面。
 * 检索入口：`grep data-ui-group="icon-list-view"`（渲染层）或 grep `ItemViewBar|ItemGlyphGrid`。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { Glyph, toneOf } from './Glyphs'

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
  title?: string
}

/** 图标网格（手册 app-hand-grid/cell 同款；供物品/装备浏览用，可选点击回调） */
export function ItemGlyphGrid({ cells, onPick }: { cells: ItemGridCell[]; onPick?: (key: string) => void }) {
  if (cells.length === 0) return null
  return (
    <div className="app-hand-grid" data-ui-group={ICON_LIST_GROUP}>
      {cells.map((c) => {
        const tone = toneOf(c.glyph)
        return (
          <div
            key={c.key}
            className="app-hand-cell"
            style={{ '--tone': tone } as CSSProperties}
            title={c.title}
            onClick={onPick ? () => onPick(c.key) : undefined}
          >
            <span className="app-hand-cell-icon">
              <Glyph name={c.glyph} size={30} color={tone} />
            </span>
            <span className="app-hand-cell-name">{c.name}</span>
            {c.sub ? <span className="app-hand-cell-sub">{c.sub}</span> : null}
          </div>
        )
      })}
    </div>
  )
}
