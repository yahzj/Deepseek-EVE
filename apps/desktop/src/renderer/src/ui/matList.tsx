import type { ReactNode } from 'react'
import { tr } from '../i18n/locale'

export const MATS_COLLAPSE_OVER = 2

export function MatListToggle({
  count,
  open,
  shortCount,
  running,
  listId,
  onToggle,
}: {
  count: number
  open: boolean
  shortCount: number
  running: boolean
  listId: string
  onToggle: () => void
}): ReactNode {
  return (
    <li className="app-bp-mat">
      <span
        className="app-bp-mat-act"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={listId}
        title={open ? tr('ui.Industry.164') : tr('ui.Industry.163', { n: count })}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        {open ? tr('ui.Industry.161') : tr('ui.Industry.160', { n: count })}
      </span>
      {!open && shortCount > 0 && !running ? (
        <span className="app-bp-mat is-short"> {tr('ui.Industry.162', { n: shortCount })}</span>
      ) : null}
    </li>
  )
}
