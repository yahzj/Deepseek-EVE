import type { GameState, MarkKind } from '@whale/core'
import { isMarked, markedIds } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { Glyph, ICO_TONES } from './Glyphs'
import { tr } from '../i18n/locale'

export function MarkStar({
  engine,
  kind,
  id,
  size = 13,
}: {
  engine: GameEngine
  kind: MarkKind
  id: string
  size?: number
}) {
  const on = isMarked(engine.state, kind, id)
  return (
    <button
      type="button"
      className={`app-mark-btn${on ? ' is-on' : ''}`}
      data-ui-group="mark-star"
      aria-pressed={on}
      aria-label={on ? tr("ui.marks.001") : tr("ui.marks.002")}
      title={on ? tr("ui.marks.003") : tr("ui.marks.004")}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        engine.toggleMarkAt(kind, id)
      }}
      onKeyDown={(e) => {
        // 行/卡自身有 Enter/Space 键行为（如市场行选中）：拦在这里，只让星标按钮响应
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
    >
      <span className="app-ico">
        <Glyph name="ico-star" size={size} color={on ? ICO_TONES['ico-star'] : undefined} />
      </span>
    </button>
  )
}

export function pinMarked<T>(
  state: GameState,
  kind: MarkKind,
  rows: readonly T[],
  keyOf: (row: T) => string,
): T[] {
  const ids = markedIds(state, kind)
  if (ids.length === 0) return [...rows]
  const set = new Set(ids)
  const pinned: T[] = []
  const rest: T[] = []
  for (const row of rows) {
    if (set.has(keyOf(row))) pinned.push(row)
    else rest.push(row)
  }
  return [...pinned, ...rest]
}
