/**
 * 面板：EVE 风格界面里最常见的"一块带标题的框"。
 * 用法：<Panel title="训练队列" right={额外内容}>…内容…</Panel>
 * className：附加到 section.wui-panel（2026-09-08：二级窗布局用它标记"吸满"等状态类）。
 */
import type { ReactNode } from 'react'

interface PanelProps {
  /** 面板标题 */
  title: string
  /** 标题行右侧的附加内容（按钮/数字等），可省略 */
  right?: ReactNode
  /** 附加类名（如 is-fill 让面板在弹性列里吸满剩余高度） */
  className?: string
  /** 面板主体内容 */
  children: ReactNode
}

export function Panel({ title, right, children, className }: PanelProps) {
  return (
    <section className={`wui-panel${className ? ` ${className}` : ''}`}>
      <header className="wui-panel-head">
        <h2 className="wui-panel-title">{title}</h2>
        {right != null ? <div className="wui-panel-right">{right}</div> : null}
      </header>
      <div className="wui-panel-body">{children}</div>
    </section>
  )
}
