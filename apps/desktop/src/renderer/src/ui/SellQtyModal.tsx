/**
 * 出售数量选择浮层（2026-09-05 船长：出售要支持"只卖一部分"）。
 * 输入 1..max（默认全量），附当前单价/预计行与「确认卖出」；复用 app-fit-overlay/modal 视觉族。
 */
import { useState, type ReactNode } from 'react'
import { Glyph } from './Glyphs'

export function SellQtyModal({
  name,
  glyph,
  max,
  unit,
  priceText,
  note,
  onConfirm,
  onClose,
}: {
  name: string
  glyph: string
  /** 可卖数量上限 */
  max: number
  /** 单位标签（如 "单位"/"m³"/"件"） */
  unit: string
  priceText?: ReactNode
  note?: ReactNode
  onConfirm: (qty: number) => void
  onClose: () => void
}) {
  const [qty, setQty] = useState<number>(max)
  const clamped = Math.max(1, Math.min(max, Math.floor(qty) || 0))
  return (
    <div className="app-fit-overlay" onClick={onClose}>
      <div className="app-fit-modal is-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="app-fit-modal-head">
          <span>出售数量 · {name}</span>
          <button className="app-btn is-small" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="app-itempick-head">
          <span className="app-itempick-icon">
            <Glyph name={glyph} size={36} />
          </span>
          <div className="app-itempick-info">
            <div className="app-itempick-name">{name}</div>
            <div className="app-dim">
              现有 {max.toLocaleString('zh-CN')} {unit}
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
            全部
          </button>
        </div>
        {note ? <div className="app-dim app-itempick-note">{note}</div> : null}
        <div className="app-itempick-actions">
          <button
            className="app-btn is-primary is-small"
            disabled={max <= 0 || clamped <= 0}
            onClick={() => onConfirm(clamped)}
          >
            按市价卖出 {clamped.toLocaleString('zh-CN')} {unit}
          </button>
        </div>
      </div>
    </div>
  )
}
