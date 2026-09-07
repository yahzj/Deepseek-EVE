/**
 * 面板：EVE 风格界面里最常见的"一块带标题的框"。
 * 用法：<Panel title="训练队列" right={额外内容}>…内容…</Panel>
 */
import type { ReactNode } from 'react'

interface PanelProps {
  /** 面板标题 */
  title: string
  /** 标题行右侧的附加内容（按钮/数字等），可省略 */
  right?: ReactNode
  /** 面板主体内容 */
  children: ReactNode
}

export function Panel({ title, right, children }: PanelProps) {
  return (
    <section className="wui-panel">
      <header className="wui-panel-head">
        <h2 className="wui-panel-title">{title}</h2>
        {right != null ? <div className="wui-panel-right">{right}</div> : null}
      </header>
      <div className="wui-panel-body">{children}</div>
    </section>
  )
}
