export interface LogItem {
  id: number
  text: string
  kind: string
  timeLabel?: string
}

interface LogListProps {
  logs: LogItem[]
  limit?: number
  emptyText: string
}

export function LogList({ logs, limit = 120, emptyText }: LogListProps) {
  if (logs.length === 0) return <div className="wui-log-empty">{emptyText}</div>
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
