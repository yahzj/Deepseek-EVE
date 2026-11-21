import { useState, type ReactNode } from 'react'
import { Glyph } from './Glyphs'
import { tr } from '../i18n/locale'

export function SellQtyModal({
  name,
  glyph,
  max,
  unit,
  priceText,
  note,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  name: string
  glyph: string
  max: number
  unit: string
  priceText?: ReactNode
  note?: ReactNode
  confirmLabel?: string
  onConfirm: (qty: number) => void
  onClose: () => void
}) {
  const [qty, setQty] = useState<number>(max)
  const clamped = Math.max(1, Math.min(max, Math.floor(qty) || 0))
  return (
    <div className="app-fit-overlay" onClick={onClose}>
      <div className="app-fit-modal is-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="app-fit-modal-head">
          <span>{tr("ui.SellQtyModal.001")} {name}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr("ui.FitPage.055")}
          </button>
        </div>
        <div className="app-itempick-head">
          <span className="app-itempick-icon">
            <Glyph name={glyph} size={36} />
          </span>
          <div className="app-itempick-info">
            <div className="app-itempick-name">{name}</div>
            <div className="app-dim">
              {tr("ui.SellQtyModal.002")} {max.toLocaleString('zh-CN')} {unit}
              {priceText ? ` · ${priceText}` : ''}
            </div>
          </div>
        </div>
        <div className="app-sellqty-row">
          <input
            className="app-input"
            type="number"
            min={1}
            max={max}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            onFocus={(e) => e.target.select()}
          />
          <span className="app-dim">{unit}</span>
          <button className="app-btn is-small" onClick={() => setQty(max)}>
            {tr("ui.IndustryPage.001")}
          </button>
        </div>
        {note ? <div className="app-dim app-itempick-note">{note}</div> : null}
        <div className="app-itempick-actions">
          <button
            className="app-btn is-primary is-small"
            disabled={max <= 0 || clamped <= 0}
            onClick={() => onConfirm(clamped)}
          >
            {confirmLabel ?? tr("ui.SellQtyModal.003")} {clamped.toLocaleString('zh-CN')} {unit}
          </button>
        </div>
      </div>
    </div>
  )
}
