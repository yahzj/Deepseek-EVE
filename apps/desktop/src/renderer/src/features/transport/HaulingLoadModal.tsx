import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { haulEffectiveMinutes, haulFleetPathOf, haulRewardRange, haulRiskPreviewOf, type GameState, type SimContext } from '@whale/core'
import { tr } from '../../i18n/locale'
import { isk } from '../../pages/common'
import { HintIcon } from '../../ui/Hint'

export interface HaulingRoute {
  key: string
  aName: string
  bName: string
  aId: string | null
  bId: string | null
  aGalaxyId: string
  bGalaxyId: string
}

/** 输入只留在弹窗；确认时由调用者重新检查出勤和货仓。 */
export function HaulingLoadModal({ state, ctx, ids, route, capacity, blocked, onConfirm, onClose }: {
  state: GameState; ctx: SimContext; ids: readonly string[]; route: HaulingRoute
  capacity: number; blocked: boolean
  onConfirm: (m3: number) => void; onClose: () => void
}) {
  const [input, setInput] = useState(String(capacity))
  const root = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const id = useId()
  const amount = input.trim() ? Number(input) : NaN
  const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= capacity
  const reward = valid ? haulRewardRange(ctx, amount, haulEffectiveMinutes(ctx, route.aGalaxyId, route.bGalaxyId)) : null
  const duration = haulFleetPathOf(state, ctx, ids, route.aGalaxyId, route.bGalaxyId).reduce((sum, row) => sum + row.durationMs, 0)
  const risk = valid ? haulRiskPreviewOf(state, ctx, ids, amount, route.aGalaxyId, route.bGalaxyId) : null
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    field.current?.focus()
    field.current?.select()
    const focus = () => field.current?.focus()
    const keepFocus = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) focus() }
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const elements = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
      const index = elements.indexOf(document.activeElement as HTMLElement)
      if (index < 0 || (event.shiftKey ? index === 0 : index === elements.length - 1)) {
        event.preventDefault()
        elements[event.shiftKey ? elements.length - 1 : 0]?.focus()
      }
    }
    document.addEventListener('focusin', keepFocus)
    document.addEventListener('keydown', keys, true)
    return () => {
      document.removeEventListener('focusin', keepFocus)
      document.removeEventListener('keydown', keys, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const n = (value: number) => value.toLocaleString('zh-CN')
  return createPortal(<div className="app-modal-mask" onClick={onClose}>
    <div ref={root} className="app-modal app-haul-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={event => event.stopPropagation()}>
      <div className="app-modal-head"><b id={`${id}-title`}>{tr('ui.haulLoad.001')}</b>
        <button type="button" className="app-btn is-small" aria-label={tr('ui.FitPage.055')} title={tr('ui.FitPage.055')} onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      <form className="app-modal-body app-haul-form" noValidate onSubmit={event => { event.preventDefault(); if (valid && !blocked) onConfirm(amount) }}>
        <b className="app-haul-route">{route.aName} ⇄ {route.bName}</b>
        <div className="app-dim">{tr('ui.haulLoad.002', { p1: n(capacity) })}</div>
        <label htmlFor={`${id}-volume`}>{tr('ui.industrial.001')}</label>
        <input ref={field} id={`${id}-volume`} className="app-input" type="number" inputMode="numeric" min={1} max={capacity} step={1}
          value={input} aria-invalid={!valid} aria-describedby={`${id}-error`} onChange={event => setInput(event.target.value)} />
        <div className="app-haul-presets">{[25, 50, 75, 100].map(percent => <button type="button" className="app-btn is-small" key={percent}
          disabled={capacity < 1} onClick={() => setInput(String(Math.max(1, Math.floor(capacity * percent / 100))))}>
          {percent === 100 ? tr('ui.haulLoad.014') : `${percent}%`}</button>)}</div>
        <div id={`${id}-error`} className="app-warn app-haul-error">{!valid ? tr('ui.haulLoad.011', { p1: n(capacity) }) : '\u00a0'}</div>
        <dl className="app-haul-estimate" aria-live="polite" aria-atomic="true">
          <div><dt>{tr('ui.haulLoad.007')}</dt><dd>{reward ? `${isk(reward.min)}～${isk(reward.max)}` : '—'}</dd></div>
          <div className="app-haul-hourly"><dt>{tr('ui.haulLoad.008')}</dt><dd>{reward && duration > 0 ? `${isk(Math.round(reward.min * 3_600_000 / duration))}～${isk(Math.round(reward.max * 3_600_000 / duration))}` : '—'} {tr('ui.Hauling.036')}</dd></div>
          <div><dt>{tr('ui.haulLoad.009')} <HintIcon tip={tr('ui.haulLoad.017')} /></dt><dd data-haul-risk>{!risk ? '—' : !risk.exposed ? tr('ui.haulLoad.015')
            : risk.coefficientMin === null ? tr('ui.haulLoad.016') : tr('ui.haulLoad.018', { p1: risk.coefficientMin, p2: risk.coefficientMax! })}</dd></div>
        </dl>
        <div className="app-dim">{tr('ui.haulLoad.019')}</div>
        <div className="app-haul-modal-actions"><button type="button" className="app-btn" onClick={onClose}>{tr('ui.haulLoad.012')}</button>
          <button type="submit" className="app-btn is-primary" disabled={!valid || blocked}>{tr('ui.haulLoad.013')}</button></div>
      </form>
    </div>
  </div>, document.querySelector('.app-root') ?? document.body)
}
