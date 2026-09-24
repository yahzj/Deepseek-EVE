import type { ReactNode } from 'react'
/**
 * 日志流：游戏里滚动的文字事件（EVE 本地频道那种味道）。
 * 最新的在最上面；kind 决定颜色（T6 语义）：system=紫、levelup=金、warn=红（左竖条）、
 * queue=淡青、info=蓝灰、trade=绿、**event=琥珀橙（随机事件：左竖条 + 底色 + 加粗，2026-09-14 新增）**；色值见 index.css（与 App 开关色点同步）。
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
  /**
   * **列表末尾附加的一行**（2026-09-24 船长：周末入侵活动行「放在事件日志的底部，和现有事件日志同级」）。
   * 渲染在**同一个 `<ul>` 的最后一条** ⇒ 观感与普通日志完全同级（日志新的在上，故最后一条就是底部）。
   */
  footer?: ReactNode
}

export function LogList({ logs, limit = 120, footer }: LogListProps) {
  if (logs.length === 0 && footer === undefined) return <div className="wui-log-empty">（暂无事件，航线静悄悄）</div>
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
