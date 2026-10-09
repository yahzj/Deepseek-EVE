import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crosshair, Pause, Play, RotateCcw, X } from 'lucide-react'
import { advanceFittingRange, createFittingRange, fittingRangeStats, RANGE_DURATION_MS, RANGE_MAX_DISTANCE_M, type RangeLayer } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { BattleScreen } from './BattleScreen'
import { tr } from '../i18n/locale'
import { fmtInt } from '../i18n/fmt'
import './fittingRange.css'

export function FittingRange({ engine, shipId, onClose }: { engine: GameEngine; shipId: string; onClose: () => void }) {
  const [distance, setDistance] = useState(5000)
  const [layer, setLayer] = useState<RangeLayer>('s')
  const [range, setRange] = useState(() => createFittingRange(engine.state, engine.ctx, shipId, tr('ui.fittingRange.002')))
  const [generation, setGeneration] = useState(0)
  const [, update] = useState(0)
  const session = useRef(range)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const closeAction = useRef(onClose)
  closeAction.current = onClose
  session.current = range
  useEffect(() => {
    session.current = range
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeAction.current() }
      if (event.key !== 'Tab') return
      const controls = [...panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? []].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      const at = controls.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && at <= 0) { event.preventDefault(); controls.at(-1)?.focus() }
      if (!event.shiftKey && at === controls.length - 1) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', key)
    let last = performance.now()
    const interval = window.setInterval(() => {
      const now = performance.now(), current = session.current
      if (current) { advanceFittingRange(current, Math.min(250, now - last)); update(n => n + 1) }
      last = now
    }, 50)
    return () => { clearInterval(interval); document.removeEventListener('keydown', key); session.current = null; if (previous?.isConnected) previous.focus() }
  }, [])
  const stats = range ? fittingRangeStats(range) : null
  const facade = range ? {
    state: range.state, ctx: range.ctx,
    wormholeSpeedActive: () => 1, wormholeSpeedOptions: () => [], setWormholeSpeed: () => {},
    battleSetDesireAt: () => ({ ok: true }), retreatNow: () => ({ ok: true }),
  } satisfies Pick<GameEngine, 'state' | 'ctx' | 'wormholeSpeedActive' | 'wormholeSpeedOptions' | 'setWormholeSpeed' | 'battleSetDesireAt' | 'retreatNow'> : null
  function reset() {
    setRange(createFittingRange(engine.state, engine.ctx, shipId, tr('ui.fittingRange.002'), distance, layer))
    setGeneration(n => n + 1)
  }
  function changeDistance(value: number) {
    const next = Math.max(0, Math.min(RANGE_MAX_DISTANCE_M, Number.isFinite(value) ? value : 5000))
    setDistance(next)
    if (range) { range.distanceM = next; range.battle.distanceM = next }
  }
  function changeLayer(value: RangeLayer) {
    setLayer(value)
    if (range) {
      range.layer = value
      for (const unit of Object.values(range.battle.units)) if (unit.side === 'foe') unit.hp = { s: value === 's' ? 10000 : 0, a: value === 'a' ? 10000 : 0, h: value === 'h' ? 10000 : 0 }
    }
  }
  return createPortal(<div className="app-modal-mask app-range-mask">
    <div className="app-range-modal" ref={panel} role="dialog" aria-modal="true" aria-label={tr('ui.fittingRange.001')}>
      <header className="app-modal-head"><Crosshair size={20} /><strong>{tr('ui.fittingRange.001')}</strong><span className="app-dim">{tr('ui.fittingRange.008')}</span><button className="app-btn" ref={close} onClick={onClose} title={tr('ui.planet.002')} aria-label={tr('ui.planet.002')}><X size={18} /></button></header>
      <div className="app-range-controls"><label>{tr('ui.fittingRange.003')}<input className="app-input" type="number" value={distance} min={0} max={RANGE_MAX_DISTANCE_M} step={100} onChange={event => changeDistance(event.target.valueAsNumber)} />m</label><label>{tr('ui.fittingRange.004')}<select className="app-select" value={layer} onChange={event => changeLayer(event.target.value as RangeLayer)}><option value="s">{tr('ui.FitPage.001')}</option><option value="a">{tr('ui.FitPage.003')}</option><option value="h">{tr('ui.ShipPage.023')}</option></select></label>
        <button className="app-btn" data-range-pause disabled={!range || !!stats && stats.elapsedMs >= RANGE_DURATION_MS} onClick={() => { if (range) { range.paused = !range.paused; update(n => n + 1) } }} title={tr(range?.paused ? 'ui.stellar.011' : 'ui.stellar.010')} aria-label={tr(range?.paused ? 'ui.stellar.011' : 'ui.stellar.010')}>{range?.paused ? <Play size={18} /> : <Pause size={18} />}</button><button className="app-btn" data-range-reset onClick={reset} title={tr('ui.fittingRange.010')} aria-label={tr('ui.fittingRange.010')}><RotateCcw size={18} /></button>
        <span className="app-dim">{((stats?.elapsedMs ?? 0) / 1000).toFixed(1)} / 60s</span>
      </div>
      <div className="app-range-workspace"><div className="app-range-scene">{facade ? <BattleScreen key={generation} engine={facade} onToast={() => {}} onClose={onClose} rangeMode simulationPaused={range?.paused} /> : <div className="app-note">{tr('ui.planet.218')}</div>}</div>
        <aside className="app-range-results"><dl><dt>{tr('ui.fittingRange.005')}</dt><dd data-range-damage>{fmtInt(stats?.damage ?? 0)}</dd><dt>{tr('ui.fittingRange.006')}</dt><dd data-range-dps>{(stats?.dps ?? 0).toFixed(2)}</dd><dt>{tr('ui.fittingRange.007')}</dt><dd>{stats?.hits ?? 0} / {stats?.shots ?? 0}</dd></dl>
          <div className="app-range-weapons">{stats?.weapons.map(row => <div key={row.index}><strong>{row.label}</strong><span>{fmtInt(row.damage)}</span><small>{row.hits} / {row.shots}</small></div>)}</div>
        </aside></div>
    </div>
  </div>, document.querySelector('.app-root') ?? document.body)
}
