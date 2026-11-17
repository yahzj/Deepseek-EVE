import { tr } from '../i18n/locale'
import type { AiTaskView } from '@whale/core'
import { fmtDuration } from '../i18n/fmt'

export function AiTaskBar({ view }: { view: AiTaskView | null }) {
  if (!view) return null
  const label = view.labelId !== undefined ? tr(view.labelId) : view.label
  const showEta = view.remainingMs !== null && view.remainingMs > 0
  if (!showEta && view.percent === null) return null
  return (
    <span className="app-ai-taskbar">
      {showEta ? (
        <span className="app-dim">
          {label}{tr('ui.aiProgress.001', { d: fmtDuration(view.remainingMs ?? 0) })}
        </span>
      ) : (
        <span className="app-dim">{label}</span>
      )}
      {view.percent !== null ? (
        <span className="app-progress-mini" title={`${label} ${view.percent}%`}>
          <i style={{ width: `${view.percent}%` }} />
        </span>
      ) : null}
    </span>
  )
}
