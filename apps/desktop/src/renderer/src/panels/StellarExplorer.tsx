import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { stellarCapacity, stellarCandidateCount, stellarSystemDeveloped, stellarSystemId, parseStellarSeed,
  stellarSearchDuration, stellarPlanetCatalog, planetSurveyView, manufacturingRunViews, DEEP_SPACE_PROBE_BLUEPRINT_ID,
  type PlanetActionResult, type PlanetCatalog } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'
import { fmtDuration, fmtInt } from '../i18n/fmt'
import { pt } from '../ui/planetText'
import { StellarMap } from './StellarMap'
import { PlanetaryPanel } from './PlanetaryPanel'
import '../styles-stellar-explorer.css'

const kindIds = { single: 'ui.stellar.024', binary: 'ui.stellar.025', 'white-dwarf': 'ui.stellar.026', neutron: 'ui.stellar.027', 'black-hole': 'ui.stellar.028', rogue: 'ui.stellar.029' } as const
const planetKindIds = { rocky: 'ui.stellar.030', desert: 'ui.stellar.031', ice: 'ui.stellar.032', ocean: 'ui.stellar.033', lava: 'ui.stellar.034', temperate: 'ui.stellar.035', gas: 'ui.stellar.036' } as const
const reasonIds: Record<string, string> = { 'search-busy': 'ui.stellar.039', 'probe-stock': 'ui.stellar.040', capacity: 'ui.stellar.041', 'invalid-seed': 'ui.stellar.042', 'no-search': 'ui.stellar.043', 'unknown-system': 'ui.stellar.044', 'no-surface': 'ui.stellar.037' }
export function StellarExplorer({ engine, catalog, onClose, onCommand }: {
  engine: GameEngine; catalog: PlanetCatalog; onClose: () => void; onCommand: (action: string, args: unknown[]) => PlanetActionResult
}) {
  const state = engine.state, stellar = state.planetary?.stellar
  const systems = Object.values(stellar?.systems ?? {})
  const [systemId, setSystemId] = useState(() => systems[0]?.id ?? '')
  const [bodyId, setBodyId] = useState('')
  const [mode, setMode] = useState<'random' | 'specified'>('random')
  const [seedText, setSeedText] = useState('')
  const [surface, setSurface] = useState<string | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState<'cancel' | 'discard' | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const closeAction = useRef(onClose)
  closeAction.current = onClose
  const [, refresh] = useState(0)
  useEffect(() => {
    if (surface || legacy) return
    const previous = document.activeElement as HTMLElement | null
    close.current?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); closeAction.current() }
      if (e.key !== 'Tab') return
      const controls = [...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,[tabindex="0"]') ?? []]
      const at = controls.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && at <= 0) { e.preventDefault(); controls.at(-1)?.focus() }
      else if (!e.shiftKey && at === controls.length - 1) { e.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus() }
  }, [surface, legacy])
  const selected = stellar?.systems[systemId] ?? systems[0]
  const selectedBody = selected?.bodies.find(b => b.planetId === bodyId)
  const planet = selectedBody ? state.planetary?.planets[selectedBody.planetId] : undefined
  const view = planet ? planetSurveyView(planet, catalog) : undefined
  const dynamicCatalog = stellarPlanetCatalog(catalog, Object.values(state.planetary?.planets ?? {}))
  const manufacture = manufacturingRunViews(state, engine.ctx).filter(run => run.blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID)
  function command(action: string, args: unknown[]): void {
    const result = onCommand(action, args)
    setMessage(result.ok ? pt('commandOk') : reasonIds[result.reason ?? ''] ? tr(reasonIds[result.reason!]) : pt('reason.' + result.reason))
    setConfirm(null); refresh(n => n + 1)
  }
  if (surface || legacy) return <PlanetaryPanel key={surface ?? 'legacy'} engine={engine} catalog={surface ? dynamicCatalog : catalog}
    initialPlanetId={surface ?? undefined} onClose={() => { setSurface(null); setLegacy(false) }} onCommand={onCommand} />
  return <div className="app-modal-mask app-stellar-mask" onClick={onClose}>
    <div ref={dialog} className="app-modal app-stellar-modal" role="dialog" aria-modal="true" aria-label={tr('ui.stellar.054')} onClick={e => e.stopPropagation()}>
      <div className="app-modal-head"><strong>{tr('ui.stellar.054')}</strong><select className="app-select" data-system-select value={selected?.id ?? ''}
        onChange={e => { setSystemId(e.target.value); setBodyId(''); setMessage('') }}>
        {!systems.length ? <option value="">{tr('ui.stellar.017')}</option> : null}
        {systems.map(s => <option key={s.id} value={s.id}>{s.seed} · {tr(kindIds[s.kind])} · {tr(stellarSystemDeveloped(state, s.id) ? 'ui.stellar.016' : 'ui.stellar.015')}</option>)}
      </select><button ref={close} className="app-btn" aria-label={pt('close')} title={pt('close')} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      <div className="app-stellar-workspace">
        <div className="app-stellar-mapcolumn">{selected ? <StellarMap system={selected} selectedId={bodyId} onSelect={setBodyId} /> : <div className="app-note">{tr('ui.stellar.017')}</div>}</div>
        <aside className="app-stellar-sidebar">
          <div className="app-stellar-scroll">
            <h3>{tr('ui.stellar.005')}</h3>
            <div className="app-stellar-modes" role="group"><button className={`app-btn${mode === 'random' ? ' is-primary' : ''}`} aria-pressed={mode === 'random'} onClick={() => setMode('random')}>{tr('ui.stellar.006')}</button>
              <button className={`app-btn${mode === 'specified' ? ' is-primary' : ''}`} aria-pressed={mode === 'specified'} onClick={() => setMode('specified')}>{tr('ui.stellar.007')}</button></div>
            {mode === 'specified' ? <label>{tr('ui.stellar.008')}<input data-system-seed className="app-input" type="text" inputMode="numeric" value={seedText} maxLength={14} onChange={e => setSeedText(e.target.value)} /></label> : null}
            <div>{tr('ui.stellar.001')} ×{fmtInt(state.warehouse.items['deep-space-probe'] ?? 0)}</div>
            <div>{tr('ui.stellar.015')} {stellarCandidateCount(state)}/{stellarCapacity(state)}</div>
            <div>{tr('ui.stellar.046')} {fmtDuration(stellar?.search ? stellar.search.durationMs - stellar.search.progressMs : stellarSearchDuration(state))}</div>
            {stellar?.search ? <><progress max={stellar.search.durationMs} value={stellar.search.progressMs} /><div>{stellar.search.seed}</div>
              <div className="app-stellar-actions"><button className="app-btn" onClick={() => command('searchPause', [!stellar.search!.paused])}>{tr(stellar.search.paused ? 'ui.stellar.011' : 'ui.stellar.010')}</button>
                <button className="app-btn" onClick={() => setConfirm('cancel')}>{tr('ui.stellar.012')}</button></div></>
              : <button data-search-launch className="app-btn is-primary" disabled={mode === 'specified' && parseStellarSeed(seedText) === undefined} onClick={() => {
                const seed = parseStellarSeed(seedText)
                command('search', [mode, seedText])
                if (seed !== undefined && state.planetary?.stellar?.systems[stellarSystemId(seed)]) setSystemId(stellarSystemId(seed))
              }}>{tr('ui.stellar.009')}</button>}
            <label className="app-check"><input type="checkbox" checked={stellar?.autoSearch ?? false} onChange={e => command('searchAuto', [e.target.checked])} />{tr('ui.stellar.014')}</label>
            <button className="app-btn" data-probe-manufacture onClick={() => command('manufactureProbe', [])}>{tr('ui.stellar.047')}</button>
            {manufacture.map(run => <div key={run.id} data-probe-production><div>{run.productName} · {fmtDuration(run.remainingMs)}</div><progress max={100} value={run.percent} /></div>)}
            <hr />
            {selected ? <><div>{tr('ui.stellar.008')}: {selected.seed}</div><div>{tr(kindIds[selected.kind])} · {selected.bodies.length} {tr('ui.stellar.056')}</div>
              <div className="app-stellar-actions"><button className="app-btn" onClick={async () => { try { await navigator.clipboard.writeText(String(selected.seed)); setMessage(tr('ui.stellar.049')) } catch { setMessage(String(selected.seed)) } }}>{tr('ui.stellar.018')}</button>
                <button className="app-btn" disabled={stellarSystemDeveloped(state, selected.id)} onClick={() => setConfirm('discard')}>{tr('ui.stellar.019')}</button></div></> : null}
            {selectedBody ? <><h3>{tr('ui.stellar.056')} {selectedBody.ordinal}</h3><div>{tr(planetKindIds[selectedBody.kind])}</div>
              {view ? <><div>{pt('hazard')}: {view.hazard.min}~{view.hazard.max}</div><div>{pt('habitability')}: {view.habitability.min}~{view.habitability.max}</div>
                <div className="app-planet-traits">{view.traitIds.map(id => <span key={id}>{pt('trait.' + id)}</span>)}</div></> : null}
              <div className="app-stellar-actions"><button className="app-btn" disabled={!planet || planet.survey >= 2} onClick={() => command('survey', [selectedBody.planetId, 2])}>{tr('ui.stellar.022')}</button>
                <button className="app-btn" disabled={!planet || planet.survey >= 3} onClick={() => command('survey', [selectedBody.planetId, 3])}>{tr('ui.stellar.023')}</button>
                <button data-open-surface className="app-btn is-primary" disabled={!planet || planet.survey < 2 || planet.surfaceAllowed === false} onClick={() => setSurface(selectedBody.planetId)}>{tr('ui.stellar.020')}</button></div>
              {planet?.surfaceAllowed === false ? <div>{tr('ui.stellar.037')}</div> : null}</> : <div>{tr('ui.stellar.048')}</div>}
            <button className="app-btn is-small" onClick={() => setLegacy(true)}>{tr('ui.stellar.038')}</button>
            {confirm ? <div className="app-note"><div>{confirm === 'cancel' ? tr('ui.stellar.013') : tr('ui.stellar.019') + '?'}</div><button className="app-btn" onClick={() => command(confirm === 'cancel' ? 'searchCancel' : 'discardSystem', confirm === 'cancel' ? [] : [selected!.id])}>{pt('confirm')}</button>
              <button className="app-btn" onClick={() => setConfirm(null)}>{pt('cancel')}</button></div> : null}
            <div className="app-stellar-feedback" role="status">{message || (stellar?.stoppedReason ? tr(reasonIds[stellar.stoppedReason]!) : '')}</div>
          </div>
        </aside>
      </div>
    </div>
  </div>
}
