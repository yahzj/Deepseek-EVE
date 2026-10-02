/**
 * AI 任务进度条（2026-09-08 船长：所有 AI 副船任务展示与主控同款——剩余约 + 进度条；
 * 顶部活动栏维持现有 AI 小图标不受影响）。
 * 数据同源：core aiTaskView（与引擎推进同一套公式）。
 */
import { tr } from '../i18n/locale'
import type { AiTaskView } from '@whale/core'
import { fmtDuration } from '../i18n/fmt'

export function AiTaskBar({ view }: { view: AiTaskView | null }) {
  if (!view) return null
  /** 阶段标签按当前语言取（core 给 `labelId`；缺省回落中文原串 `label`） */
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
