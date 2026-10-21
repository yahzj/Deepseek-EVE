import { useEffect, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'

export function BattleRangeConfirm({ engine }: { engine: GameEngine }) {
  const view = engine.battleRangePending()
  const [distance, setDistance] = useState(view?.desireM ?? engine.ctx.balance.battle.minDistanceM)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancel.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); engine.cancelBattleRange() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])
      const index = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus() }
  }, [engine])
  if (!view) return null
  return <div className="app-modal-mask" style={{ zIndex: 1300 }} onClick={() => engine.cancelBattleRange()}>
    <div ref={dialog} className="app-modal" role="dialog" aria-modal="true" aria-labelledby="battle-range-title"
      tabIndex={-1} style={{ width: 520, maxWidth: '95%', maxHeight: '95%', overflow: 'auto' }} onClick={event => event.stopPropagation()}>
      <div className="app-modal-head"><strong id="battle-range-title">{tr('ui.weekend.062')}</strong></div>
      <div className="app-modal-body">
        <div className="app-bay-title" style={{ overflowWrap: 'anywhere' }}>{view.name}</div>
        <div className="app-warn" style={{ padding: '12px 0', overflowWrap: 'anywhere' }}>
          {tr('ui.shipInfo.163', { p1: '' })}: {view.previousRangeM.toLocaleString()} m {'→'} {view.maxRangeM.toLocaleString()} m
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{tr('ui.BattleScreen.072')}</span>
          <input className="app-input" type="number" min={view.minM} max={view.limitM} step={1} value={distance}
            style={{ width: 150, maxWidth: '100%' }} onChange={event => setDistance(Number(event.target.value))} /> m
        </label>
        {error ? <div className="app-warn" role="alert">{error}</div> : null}
        <div className="app-save-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button ref={cancel} className="app-btn" onClick={() => engine.cancelBattleRange()}>{tr('ui.blackMarket.011')}</button>
          <button className="app-btn is-primary" disabled={!Number.isFinite(distance) || distance < view.minM} onClick={() => {
            const result = engine.confirmBattleRange(distance)
            if (!result.ok && !result.rangeConfirmation) setError(cmdText(result) || tr('ui.engine.027'))
          }}>{tr('ui.whExpedition.103')}</button>
        </div>
      </div>
    </div>
  </div>
}
