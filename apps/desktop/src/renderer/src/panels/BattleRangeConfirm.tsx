import { useEffect, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'

export function BattleRangeConfirm({ engine }: { engine: GameEngine }) {
  const view = engine.battleRangePending()
  const [distanceInput, setDistanceInput] = useState(() => String(view ? Math.min(view.limitM, Math.max(view.minM, view.desireM)) : engine.ctx.balance.battle.minDistanceM))
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (view) setDistanceInput(String(Math.min(view.limitM, Math.max(view.minM, view.desireM))))
  }, [view?.signature, view?.desireM])
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
  const distance = Number(distanceInput)
  const distanceValid = distanceInput.trim() !== '' && Number.isFinite(distance)
  const distanceOf = (value: number): number => Number.isFinite(value)
    ? Math.max(view.minM, Math.min(view.limitM, value))
    : value
  const sliderValue = view.limitM > view.minM && distanceValid
    ? Math.round((view.limitM - Math.min(view.limitM, Math.max(view.minM, distance))) / (view.limitM - view.minM) * 1000)
    : 0
  const distanceAtSlider = (value: number): number => Math.round(view.limitM - value / 1000 * (view.limitM - view.minM))
  return <div className="app-modal-mask" style={{ zIndex: 1300 }} onClick={() => engine.cancelBattleRange()}>
    <div ref={dialog} className="app-modal" role="dialog" aria-modal="true" aria-labelledby="battle-range-title"
      tabIndex={-1} style={{ width: 520, maxWidth: '95%', maxHeight: '95%', overflow: 'auto' }} onClick={event => event.stopPropagation()}>
      <div className="app-modal-head"><strong id="battle-range-title">{tr('ui.weekend.062')}</strong></div>
      <div className="app-modal-body">
        <div className="app-bay-title" style={{ overflowWrap: 'anywhere' }}>{view.name}</div>
        {/* ⟪文案调整 2026-10-23⟫ 船长：「只写了一个射程太过含糊」 */}
        <div className="app-wh-tab-warn" role="alert" style={{ padding: '12px 0 4px', overflowWrap: 'anywhere' }}>
          {view.fleetChanged ? <div>{tr('ui.battleRangeConfirm.001')}</div> : null}
          <div>{tr('ui.battleRangeConfirm.002', {
            p1: view.previousRangeM.toLocaleString(),
            p2: view.maxRangeM.toLocaleString(),
          })}</div>
        </div>
        <div className="app-bts-ruler-head" style={{ marginTop: 8 }}>
          <span className="app-dim">{tr('ui.BattleScreen.053')} {Math.round(view.limitM).toLocaleString()}m）</span>
          <span className="app-dim">{tr('ui.BattleScreen.054')} {Math.round(view.minM).toLocaleString()}m）▶</span>
        </div>
        <div className="app-bts-axisTrack" style={{ margin: '22px 0 12px' }}>
          <div className="app-bts-scale" role="img" aria-label={tr('ui.BattleScreen.112', {
            p1: distanceValid ? Math.round(distance).toLocaleString() : '--',
            p2: Math.round(view.limitM).toLocaleString(),
            p3: Math.round(view.minM).toLocaleString(),
          })}>
            <i className="app-bts-tick" style={{ left: '25%' }} />
            <i className="app-bts-tick" style={{ left: '50%' }} />
            <i className="app-bts-tick" style={{ left: '75%' }} />
            <i className="app-bts-cursor" style={{ left: `${sliderValue / 10}%` }} />
            <span className="app-bts-cur-chip" style={{ left: `${sliderValue / 10}%` }}>
              {distanceValid ? Math.round(distance).toLocaleString() : '--'}m
            </span>
          </div>
          <input className="app-battle-range app-bts-range app-bts-knob" type="range" min={0} max={1000} step={1}
            value={sliderValue} aria-label={tr('ui.BattleScreen.072')}
            aria-valuetext={`${distanceValid ? Math.round(distance).toLocaleString() : '--'} m`}
            title={tr('ui.BattleScreen.069')} onChange={event => setDistanceInput(String(distanceOf(distanceAtSlider(Number(event.target.value)))))} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{tr('ui.BattleScreen.072')}</span>
          <input className="app-input" type="number" min={view.minM} max={view.limitM} step={1} value={distanceInput}
            style={{ width: 150, maxWidth: '100%' }} onChange={event => setDistanceInput(event.target.value)} /> m
        </label>
        {error ? <div className="app-warn" role="alert">{error}</div> : null}
        <div className="app-save-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button ref={cancel} className="app-btn" onClick={() => engine.cancelBattleRange()}>{tr('ui.blackMarket.011')}</button>
          <button className="app-btn is-primary" disabled={!distanceValid || distance < view.minM || distance > view.limitM} onClick={() => {
            const result = engine.confirmBattleRange(distance)
            if (!result.ok && !result.rangeConfirmation) setError(cmdText(result) || tr('ui.engine.027'))
          }}>{tr('ui.whExpedition.103')}</button>
        </div>
      </div>
    </div>
  </div>
}
