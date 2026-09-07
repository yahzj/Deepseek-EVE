/**
 * AI 任务进度条（2026-09-08 船长：所有 AI 副船任务展示与主控同款——剩余约 + 进度条；
 * 顶部活动栏维持现有 AI 小图标不受影响）。
 * 数据同源：core aiTaskView（与引擎推进同一套公式）。
 */
import { formatDurationMs } from '@whale/core'
import type { AiTaskView } from '@whale/core'

export function AiTaskBar({ view }: { view: AiTaskView | null }) {
  if (!view) return null
  const showEta = view.remainingMs !== null && view.remainingMs > 0
  if (!showEta && view.percent === null) return null
  return (
    <span className="app-ai-taskbar">
      {showEta ? (
        <span className="app-dim">
          {view.label} · 剩余约 {formatDurationMs(view.remainingMs ?? 0)}
        </span>
      ) : (
        <span className="app-dim">{view.label}</span>
      )}
      {view.percent !== null ? (
        <span className="app-progress-mini" title={`${view.label} ${view.percent}%`}>
          <i style={{ width: `${view.percent}%` }} />
        </span>
      ) : null}
    </span>
  )
}
