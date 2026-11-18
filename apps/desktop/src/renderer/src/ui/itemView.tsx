import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Glyph, toneOf } from './Glyphs'
import { FOE_ACCENT } from './tones'
import { crestLabelOf } from './labelsText'
import { tr } from '../i18n/locale'
import { hoverTipProps } from './Tooltip'

export type ItemViewMode = 'grid' | 'list'
export const ITEM_VIEW_KEY = 'whale-idle:inv-view'
export const ITEM_VIEW_PREFIX = 'whale-idle:view:'
export const ICON_LIST_GROUP = 'icon-list-view'

export type ItemViewScope = 'items' | 'cargo' | 'skills'

const scopedKey = (scope: ItemViewScope): string => `${ITEM_VIEW_PREFIX}${scope}`

function readStored(key: string): ItemViewMode | null {
  try {
    const raw = localStorage.getItem(key)
    return raw === 'list' || raw === 'grid' ? raw : null
  } catch {
    return null
  }
}

function writeStored(key: string, m: ItemViewMode): void {
  try {
    localStorage.setItem(key, m)
  } catch {
  }
}

export function useItemView(scope: ItemViewScope): [ItemViewMode, (m: ItemViewMode) => void] {
  const key = scopedKey(scope)
  const [mode, setMode] = useState<ItemViewMode>(() => readStored(key) ?? readStored(ITEM_VIEW_KEY) ?? 'grid')
  useEffect(() => {
    writeStored(key, mode)
  }, [key, mode])
  return [mode, setMode]
}

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
  glyph: string
  name: string
  sub?: string
  title?: string
  hover?: ReactNode
  tone?: string
  rarity?: number
  crest?: string
}

export function kindExtraNote(kind: string): string | null {
  if (kind === 'drone') {
    return tr("ui.itemView.004")
  }
  if (kind === 'ammo') {
    return tr("ui.itemView.002")
  }
  if (kind === 'fragment') {
    return tr("ui.itemView.003")
  }
  return null
}

export function RowGlyph({ glyph, tone }: { glyph: string; tone?: string }) {
  return (
    <span className="app-hand-row-glyph" style={{ color: tone ?? toneOf(glyph) }}>
      <Glyph name={glyph} size={15} color="currentColor" />
    </span>
  )
}

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
              <span className={`app-hand-cell-rarity is-r${c.rarity}`} aria-label={tr('ui.itemView.001', { p1: c.rarity })}>
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
