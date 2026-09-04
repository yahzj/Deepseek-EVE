/**
 * 进度条：显示训练/作业进度。
 */
interface ProgressBarProps {
  /** 进度百分比 0~100（内部会截断到合法范围） */
  value: number
  /** 条上方的说明文字，可省略 */
  label?: string
  /** 配色：normal 正常（青绿），warn 警告（琥珀），danger 危险（红） */
  tone?: 'normal' | 'warn' | 'danger'
}

export function ProgressBar({ value, label, tone = 'normal' }: ProgressBarProps) {
  const percent = Math.min(100, Math.max(0, value))
  return (
    <div className={`wui-progress is-${tone}`}>
      {label != null ? <div className="wui-progress-label">{label}</div> : null}
      <div
        className="wui-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div className="wui-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
