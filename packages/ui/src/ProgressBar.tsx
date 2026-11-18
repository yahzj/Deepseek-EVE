interface ProgressBarProps {
  value: number
  label?: string
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
