import type { ReactNode, Ref } from 'react'

interface PanelProps {
  title: string
  hint?: ReactNode
  right?: ReactNode
  className?: string
  children: ReactNode
  footer?: ReactNode
  bodyRef?: Ref<HTMLDivElement>
}

export function Panel({ title, hint, right, children, className, footer, bodyRef }: PanelProps) {
  return (
    <section className={`wui-panel${className ? ` ${className}` : ''}`}>
      <header className="wui-panel-head">
        <h2 className="wui-panel-title">
          {title}
          {hint ?? null}
        </h2>
        {right != null ? <div className="wui-panel-right">{right}</div> : null}
      </header>
      <div className="wui-panel-body" ref={bodyRef}>{children}</div>
      {footer != null ? <div className="wui-panel-foot">{footer}</div> : null}
    </section>
  )
}
