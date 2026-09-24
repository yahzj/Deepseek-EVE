/**
 * 面板：EVE 风格界面里最常见的"一块带标题的框"。
 * 用法：<Panel title="训练队列" right={额外内容}>…内容…</Panel>
 * className：附加到 section.wui-panel（2026-09-08：二级窗布局用它标记"吸满"等状态类）。
 * hint（2026-09-13 船长）：标题文字**后面**挂一个提示标记（如圆形感叹号）——常驻说明不再占版面，
 *   悬停/点一下才看。传入的是节点（本包不认识渲染层组件，故不写死具体图标）。
 */
import type { ReactNode } from 'react'

interface PanelProps {
  /** 面板标题 */
  title: string
  /** 标题文字后面的提示标记（可省略；不传时与旧版逐像素一致） */
  hint?: ReactNode
  /** 标题行右侧的附加内容（按钮/数字等），可省略 */
  right?: ReactNode
  /** 附加类名（如 is-fill 让面板在弹性列里吸满剩余高度） */
  className?: string
  /** 面板主体内容 */
  children: ReactNode
  /**
   * **面板底部固定槽**（2026-09-24 船长按截图指定：周末入侵活动框「放在事件日志的底部」）——
   * 渲染在 body **之后**、**不随 body 滚动** ⇒ 常驻面板底部；不传 ⇒ 与旧版逐像素一致。
   */
  footer?: ReactNode
}

export function Panel({ title, hint, right, children, className, footer }: PanelProps) {
  return (
    <section className={`wui-panel${className ? ` ${className}` : ''}`}>
      <header className="wui-panel-head">
        <h2 className="wui-panel-title">
          {title}
          {hint ?? null}
        </h2>
        {right != null ? <div className="wui-panel-right">{right}</div> : null}
      </header>
      <div className="wui-panel-body">{children}</div>
      {footer != null ? <div className="wui-panel-foot">{footer}</div> : null}
    </section>
  )
}
