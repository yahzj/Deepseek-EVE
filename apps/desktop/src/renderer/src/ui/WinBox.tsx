import type { ReactNode } from 'react'

export interface WinBoxProps {
  variant: string
  title: string
  open: boolean
  onMinimize: () => void
  minimizeText: string
  minimizeTitle?: string
  showMinimizeButton?: boolean
  shell?: boolean
  headLeft?: ReactNode
  headRight?: ReactNode
  children: ReactNode
}

export function WinBox({
  variant,
  title,
  open,
  onMinimize,
  minimizeText,
  minimizeTitle,
  showMinimizeButton = true,
  shell = true,
  headLeft,
  headRight,
  children,
}: WinBoxProps): ReactNode {
  if (!open) return null
  if (!shell) return <>{children}</>
  return (
    <div className={variant} role="region" aria-label={title}>
      <div className="app-winbox-head">
        {headLeft}
        <span className="app-winbox-title">{title}</span>
        <span className="app-winbox-spacer" />
        {headRight}
        {showMinimizeButton ? (
          <button className="app-btn is-small" onClick={onMinimize} title={minimizeTitle}>
            {minimizeText}
          </button>
        ) : null}
      </div>
      <div className="app-winbox-body">{children}</div>
    </div>
  )
}
