/**
 * 物品列表「图标网格 / 列表」切换（2026-09-05 船长：与手册 Handbook 同款排版）。
 * 复用手册的 app-hand-viewbar / app-hand-viewbtn / app-hand-grid / app-hand-cell 样式与
 * Glyphs 科幻线性图标 + tone 色调；偏好存 localStorage。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { Glyph, toneOf } from './Glyphs'

export type ItemViewMode = 'grid' | 'list'
export const ITEM_VIEW_KEY = 'whale-idle:inv-view'

export function useItemView(): [ItemViewMode, (m: ItemViewMode) => void] {
  const [mode, setMode] = useState<ItemViewMode>(() => {
    try {
      return localStorage.getItem(ITEM_VIEW_KEY) === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
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
    <div className="app-hand-viewbar">
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

/** 图标网格（手册 app-hand-grid/cell 同款；供物品/装备浏览用） */
export function ItemGlyphGrid({ cells }: { cells: ItemGridCell[] }) {
  if (cells.length === 0) return null
  return (
    <div className="app-hand-grid">
      {cells.map((c) => {
        const tone = toneOf(c.glyph)
        return (
          <div
            key={c.key}
            className="app-hand-cell"
            style={{ '--tone': tone } as CSSProperties}
            title={c.title}
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
