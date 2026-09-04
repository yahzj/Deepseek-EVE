/**
 * 日志流：游戏里滚动的文字事件（EVE 本地频道那种味道）。
 * 最新的在最上面；kind 决定颜色（T6 语义）：system=紫、levelup=金、warn=红（左竖条）、
 * queue=淡青、info=蓝灰、trade=绿。色值见 index.css（与 App 开关色点同步）。
 */
export interface LogItem {
  id: number
  text: string
  /** 日志类型，同时用作 CSS 类名（wui-log-<kind>） */
  kind: string
  /** 可选：游戏内时间标签（如 "03:12"），显示在正文前 */
  timeLabel?: string
}

interface LogListProps {
  logs: LogItem[]
  /** 最多显示多少条（从最新往旧取），默认 120 */
  limit?: number
}

export function LogList({ logs, limit = 120 }: LogListProps) {
  if (logs.length === 0) return <div className="wui-log-empty">（暂无事件，航线静悄悄）</div>
  const shown = logs.slice(-limit).reverse()
  return (
    <ul className="wui-log-list">
      {shown.map((log) => (
        <li key={log.id} className={`wui-log-item wui-log-${log.kind}`}>
          {log.timeLabel != null ? <span className="wui-log-time">{log.timeLabel}</span> : null}
          {log.text}
        </li>
      ))}
    </ul>
  )
}
