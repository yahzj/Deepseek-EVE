import type { ReactNode } from 'react'
import { Glyph } from './Glyphs'
import { RowGlyph } from './itemView'
import { tr } from '../i18n/locale'

export function IconBtn({
  glyph,
  label,
  title,
  primary,
  disabled,
  onClick,
  ariaLabel,
  ariaExpanded,
  ariaControls,
}: {
  glyph: string
  label?: string
  title: string
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  ariaLabel?: string
  ariaExpanded?: boolean
  ariaControls?: string
}): ReactNode {
  return (
    <button
      className={`hud-btn${primary ? ' is-primary' : ''}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaExpanded !== undefined ? ariaControls : undefined}
    >
      <Glyph name={glyph} size={14} color="currentColor" />
      {label !== undefined ? <span style={{ marginLeft: 6 }}>{label}</span> : null}
    </button>
  )
}

export function Readout({ glyph, value, title }: { glyph: string; value: ReactNode; title: string }): ReactNode {
  return (
    <span className="hud-row" style={{ gap: 6 }} title={title}>
      <Glyph name={glyph} size={13} color="currentColor" />
      <b>{value}</b>
    </span>
  )
}


export interface HudIoLine {
  glyph?: string
  name?: ReactNode
  qty?: ReactNode
  ok?: boolean
  short?: ReactNode
}

function IoLine({ line }: { line: HudIoLine }): ReactNode {
  if (line.glyph === undefined) return <div className="hud-io-num">{line.name}</div>
  return (
    <>
      <div className={`hud-io-row${line.ok === false ? ' is-short' : ''}`}>
        <RowGlyph glyph={line.glyph} />
        <span>{line.name}</span>
        {line.qty !== undefined ? <b className="hud-io-num">{line.qty}</b> : null}
      </div>
      {line.short !== undefined ? <div className="hud-io-short">{line.short}</div> : null}
    </>
  )
}

export function HudHoverCard({
  title,
  input,
  output,
  note,
  emptyOutput,
}: {
  title: ReactNode
  input: readonly HudIoLine[]
  output: readonly HudIoLine[]
  note?: ReactNode
  emptyOutput?: ReactNode
}): ReactNode {
  return (
    <>
      <span className="app-ship-hover-title">{title}</span>
      <div className="hud-io">
        <div className="hud-io-col">
          <div className="hud-tiny">{tr('ui.hud.116')}</div>
          {input.map((l, i) => (
            <IoLine key={i} line={l} />
          ))}
        </div>
        <div className="hud-io-col">
          <div className="hud-tiny">{tr('ui.hud.120')}</div>
          {output.length === 0 ? (
            <div className="hud-io-num">{emptyOutput ?? tr('ui.hud.122')}</div>
          ) : (
            output.map((l, i) => <IoLine key={i} line={l} />)
          )}
        </div>
      </div>
      {note !== undefined ? <div className="app-info-note">{note}</div> : null}
    </>
  )
}
