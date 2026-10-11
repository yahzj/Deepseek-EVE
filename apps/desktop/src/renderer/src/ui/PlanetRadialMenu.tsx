import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { pt } from './planetText'
import { planetWheelPosition } from './planetWheelGeometry'

export interface PlanetWheelItem { id: string; label: string; icon: ReactNode; tone?: string; disabled?: boolean; reason?: string; action: () => void }
export function PlanetRadialMenu({ title, items, anchor, onClose, children, onBack, restoreFocus }: {
  title: string; items: PlanetWheelItem[]; anchor: { x: number; y: number }; onClose: () => void; children?: ReactNode; onBack?: () => void; restoreFocus?: () => void
}) {
  const mask = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const [page, setPage] = useState(0), [center, setCenter] = useState(anchor), [reason, setReason] = useState('')
  const pages = Math.max(1, Math.ceil(items.length / 7)), activePage = Math.min(page, pages - 1)
  const visible = items.slice(activePage * 7, activePage * 7 + 7)
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => { queueMicrotask(() => { if (restoreFocus) restoreFocus(); else if (previous?.isConnected) previous.focus() }) }
  }, [])
  useLayoutEffect(() => { dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus() }, [activePage, !!children])
  useLayoutEffect(() => {
    const element = mask.current
    if (!element) return
    const measure = () => setCenter(planetWheelPosition(anchor, element.clientWidth, element.clientHeight))
    measure(); const observer = new ResizeObserver(measure); observer.observe(element)
    return () => observer.disconnect()
  }, [anchor.x, anchor.y])
  return <div ref={mask} className="app-planet-wheel-mask" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={dialog} className={`app-planet-wheel-dialog${children ? ' is-confirm' : ''}`} role="dialog" aria-modal="true" aria-label={title}
      style={{ left: center.x, top: center.y }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], at = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(at + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); event.preventDefault()
      }}>
      {children ? <><header><strong>{title}</strong><button type="button" className="app-btn app-planet-tool" title={pt('cancel')} aria-label={pt('cancel')} onClick={onBack ?? onClose}><ArrowLeft size={18} /></button></header><div className="app-planet-wheel-confirm-scroll">{children}</div></> : <>
        <svg className="app-planet-wheel-rings" viewBox="0 0 360 360" aria-hidden="true"><circle cx="180" cy="180" r="170" /><circle cx="180" cy="180" r="82" /></svg>
        {visible.map((item, index) => {
          const angle = -Math.PI / 2 + index * Math.PI * 2 / visible.length
          return <button key={item.id} type="button" className={`app-planet-wheel-item${item.disabled ? ' is-disabled' : ''}`} data-wheel-item={item.id} aria-disabled={item.disabled || undefined}
            title={item.reason ?? item.label} aria-label={[item.label, item.reason].filter(Boolean).join(': ')} style={{ left: 180 + Math.cos(angle) * 123, top: 180 + Math.sin(angle) * 123, color: item.tone }}
            onFocus={() => setReason(item.reason ?? '')} onMouseEnter={() => setReason(item.reason ?? '')} onClick={() => { if (item.disabled) setReason(item.reason ?? pt('unavailable')); else item.action() }}>
            {item.icon}<span>{item.label}</span>
          </button>
        })}
        <div className="app-planet-wheel-center"><strong>{title}</strong>
          {reason ? <small className="app-planet-wheel-reason" role="status">{reason}</small> : null}
          <div className="app-planet-wheel-controls">
            {pages > 1 ? <button type="button" className="app-btn app-planet-tool" data-wheel-page="previous" aria-label={`${pt('building')} ${Math.max(1, activePage)}/${pages}`} title={`${Math.max(1, activePage)}/${pages}`} disabled={activePage === 0} onClick={() => { setPage(activePage - 1); setReason('') }}><ChevronLeft size={18} /></button> : null}
            <button type="button" className="app-btn app-planet-tool" title={pt('close')} aria-label={pt('close')} onClick={onClose}><X size={18} /></button>
            {pages > 1 ? <button type="button" className="app-btn app-planet-tool" data-wheel-page="next" aria-label={`${pt('building')} ${Math.min(pages, activePage + 2)}/${pages}`} title={`${Math.min(pages, activePage + 2)}/${pages}`} disabled={activePage === pages - 1} onClick={() => { setPage(activePage + 1); setReason('') }}><ChevronRight size={18} /></button> : null}
          </div>{pages > 1 ? <small>{activePage + 1}/{pages}</small> : null}
        </div>
      </>}
    </div>
  </div>
}
