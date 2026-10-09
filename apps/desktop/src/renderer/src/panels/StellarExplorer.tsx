import { useEffect, useRef, useState } from 'react'
import { Copy, Crosshair, Play, Pause, Radar, Search, Trash2, X, Factory, Globe2 } from 'lucide-react'
import { stellarCapacity, stellarCandidateCount, stellarSystemDeveloped, stellarPlanetDeveloped, stellarSystemId, parseStellarSeed,
  stellarSearchDuration, stellarPlanetCatalog, planetSurveyView, manufacturingRunViews, DEEP_SPACE_PROBE_BLUEPRINT_ID,
  type PlanetActionResult, type PlanetCatalog } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'
import { fmtDuration, fmtInt } from '../i18n/fmt'
import { pt } from '../ui/planetText'
import { StellarMap } from './StellarMap'
import { PlanetaryPanel } from './PlanetaryPanel'
import { STELLAR_KIND_IDS as kindIds, STELLAR_PLANET_KIND_IDS as planetKindIds, StellarPlanetPreview } from '../ui/stellarArt'
import '../styles-stellar-explorer.css'

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
  const [confirm, setConfirm] = useState<{ kind: 'cancel'; seq: number } | { kind: 'discard'; systemId: string } | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const returningFromSurface = useRef(false)
  const closeAction = useRef(onClose)
  const confirmState = useRef(confirm)
  confirmState.current = confirm
  closeAction.current = onClose
  const [, refresh] = useState(0)
  useEffect(() => {
    if (surface || legacy) return
    const previous = document.activeElement as HTMLElement | null
    if (returningFromSurface.current) {
      dialog.current?.querySelector<HTMLButtonElement>('[data-open-surface]')?.focus()
      returningFromSurface.current = false
    } else close.current?.focus()
    const focusRoot = () => dialog.current?.querySelector<HTMLElement>('.app-stellar-confirm') ?? dialog.current
    const focusables = () => [...focusRoot()?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') ?? []].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (confirmState.current) setConfirm(null); else closeAction.current() }
      if (e.key !== 'Tab') return
      const controls = focusables()
      const at = controls.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && at <= 0) { e.preventDefault(); controls.at(-1)?.focus() }
      else if (!e.shiftKey && (at < 0 || at === controls.length - 1)) { e.preventDefault(); controls[0]?.focus() }
    }
    const focus = (e: FocusEvent) => {
      const root = focusRoot()
      if (root && e.target instanceof Node && !root.contains(e.target)) focusables()[0]?.focus()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('focusin', focus); if (previous?.isConnected) previous.focus() }
  }, [surface, legacy])
  useEffect(() => {
    if (!confirm) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLButtonElement>('.app-stellar-confirm button:not(:disabled)')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [confirm])
  const selected = stellar?.systems[systemId] ?? systems[0]
  const selectedBody = selected?.bodies.find(b => b.planetId === bodyId)
  const planet = selectedBody ? state.planetary?.planets[selectedBody.planetId] : undefined
  const view = planet ? planetSurveyView(planet, catalog) : undefined
  const dynamicCatalog = stellarPlanetCatalog(catalog, Object.values(state.planetary?.planets ?? {}))
  const manufacture = manufacturingRunViews(state, engine.ctx).filter(run => run.blueprintId === DEEP_SPACE_PROBE_BLUEPRINT_ID)
  const bodyStates = Object.fromEntries((selected?.bodies ?? []).map(body => {
    const value = state.planetary?.planets[body.planetId]
    return [body.planetId, { survey: value?.survey ?? 0, developed: stellarPlanetDeveloped(value) }]
  }))
  const confirmValid = confirm?.kind === 'discard'
    ? !!stellar?.systems[confirm.systemId] && !stellarSystemDeveloped(state, confirm.systemId)
    : confirm?.kind === 'cancel' && stellar?.search?.seq === confirm.seq
  function command(action: string, args: unknown[]): void {
    const result = onCommand(action, args)
    setMessage(result.ok ? pt('commandOk') : reasonIds[result.reason ?? ''] ? tr(reasonIds[result.reason!]) : pt('reason.' + result.reason))
    setConfirm(null); refresh(n => n + 1)
  }
  if (surface || legacy) return <PlanetaryPanel key={surface ?? 'legacy'} engine={engine} catalog={surface ? dynamicCatalog : catalog}
    initialPlanetId={surface ?? undefined} onClose={() => { returningFromSurface.current = !!surface; setSurface(null); setLegacy(false) }} onCommand={onCommand} />
  return <div className="app-modal-mask app-stellar-mask" onClick={() => { if (!confirm) onClose() }}>
    <div ref={dialog} className="app-modal app-stellar-modal" role="dialog" aria-modal="true" aria-label={tr('ui.stellar.054')} onClick={e => e.stopPropagation()}>
      <div className="app-modal-head"><Radar size={20} aria-hidden="true" /><strong>{tr('ui.stellar.054')}</strong><select className="app-select" data-system-select aria-label={tr('ui.stellar.054')} value={selected?.id ?? ''}
        onChange={e => { setSystemId(e.target.value); setBodyId(''); setMessage('') }}>
        {!systems.length ? <option value="">{tr('ui.stellar.017')}</option> : null}
        {systems.map(s => <option key={s.id} value={s.id}>{s.seed} · {tr(kindIds[s.kind])} · {tr(stellarSystemDeveloped(state, s.id) ? 'ui.stellar.016' : 'ui.stellar.015')}</option>)}
      </select><button ref={close} className="app-btn" aria-label={pt('close')} title={pt('close')} onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
      <div className="app-stellar-systembar">
        {selected ? <><div className="app-stellar-coordinate"><span className="app-dim">{tr('ui.stellar.008')}</span><strong>{selected.seed}</strong></div>
          <span>{tr(kindIds[selected.kind])}</span><span className="app-dim">{selected.bodies.length} {tr('ui.stellar.056')}</span>
          <span className={`app-stellar-phase${stellarSystemDeveloped(state, selected.id) ? ' is-developed' : ''}`}>{tr(stellarSystemDeveloped(state, selected.id) ? 'ui.stellar.016' : 'ui.stellar.015')}</span>
          <div className="app-stellar-systemtools"><button className="app-btn app-stellar-icon" title={tr('ui.stellar.018')} aria-label={tr('ui.stellar.018')} onClick={async () => { try { await navigator.clipboard.writeText(String(selected.seed)); setMessage(tr('ui.stellar.049')) } catch { setMessage(String(selected.seed)) } }}><Copy size={17} /></button>
            <button className="app-btn app-stellar-icon" title={tr('ui.stellar.019')} aria-label={tr('ui.stellar.019')} disabled={stellarSystemDeveloped(state, selected.id)} onClick={() => setConfirm({ kind: 'discard', systemId: selected.id })}><Trash2 size={17} /></button></div></>
          : <span className="app-dim">{tr('ui.stellar.017')}</span>}
      </div>
      <div className="app-stellar-workspace">
        <div className="app-stellar-mapcolumn">{selected ? <StellarMap system={selected} selectedId={bodyId} onSelect={setBodyId} bodyStates={bodyStates} /> : <div className="app-stellar-empty"><Radar size={48} strokeWidth={1} aria-hidden="true" /><strong>{tr('ui.stellar.017')}</strong></div>}</div>
        <aside className="app-stellar-sidebar">
          <div className="app-stellar-scroll">
            <h3><Crosshair size={15} aria-hidden="true" />{tr('ui.stellarHud.002')}</h3>
            {selectedBody ? <><div className="app-stellar-target"><StellarPlanetPreview kind={selectedBody.kind} /><div><strong>{tr('ui.stellar.056')} {selectedBody.ordinal}</strong><span>{tr(planetKindIds[selectedBody.kind])}</span><span className="app-stellar-phase">{planet ? pt('survey.' + planet.survey) : tr('ui.stellar.055')}</span></div></div>
              {view ? <><dl className="app-stellar-facts"><div><dt>{pt('hazard')}</dt><dd>{view.hazard.min === view.hazard.max ? view.hazard.min : `${view.hazard.min}~${view.hazard.max}`}</dd></div><div><dt>{pt('habitability')}</dt><dd>{view.habitability.min === view.habitability.max ? view.habitability.min : `${view.habitability.min}~${view.habitability.max}`}</dd></div></dl>
                <div className="app-planet-traits">{view.traitIds.map(id => <span key={id}>{pt('trait.' + id)}</span>)}</div>{view.unknownTraits > 0 ? <div className="app-dim">{pt('unknownTraits')} {view.unknownTraits}</div> : null}</> : null}
              <div className="app-stellar-targetactions"><button className="app-btn" disabled={!planet || planet.survey >= 2} onClick={() => command('survey', [selectedBody.planetId, 2])}><Search size={16} />{tr('ui.stellar.022')}</button>
                <button className="app-btn" disabled={!planet || planet.survey >= 3} onClick={() => command('survey', [selectedBody.planetId, 3])}><Crosshair size={16} />{tr('ui.stellar.023')}</button>
                <button data-open-surface className="app-btn is-primary" disabled={!planet || planet.survey < 2 || planet.surfaceAllowed === false} onClick={() => setSurface(selectedBody.planetId)}><Globe2 size={16} />{tr('ui.stellar.020')}</button></div>
              {planet?.surfaceAllowed === false ? <div className="app-note app-dim">{tr('ui.stellar.037')}</div> : null}</>
              : <div className="app-stellar-empty"><Crosshair size={36} strokeWidth={1} aria-hidden="true" /><span>{tr('ui.stellar.048')}</span></div>}
          </div>
        </aside>
      </div>
      <div className="app-stellar-taskdock">
        <section className="app-stellar-searchtask" aria-label={tr('ui.stellarHud.001')}>
          <div className="app-stellar-taskhead"><h3><Radar size={16} />{tr('ui.stellarHud.001')}</h3><span className="app-stellar-phase">{stellar?.search?.paused ? pt('paused') : stellar?.search ? `${tr('ui.stellar.005')} ${stellar.search.seed}` : tr('ui.battleCycles.013')}</span><label className="app-check"><input type="checkbox" checked={stellar?.autoSearch ?? false} onChange={e => command('searchAuto', [e.target.checked])} />{tr('ui.stellar.014')}</label></div>
          <div className="app-stellar-taskcontrols"><div className="app-stellar-modes" role="group" aria-label={tr('ui.stellar.005')}><button className={`app-btn${mode === 'random' ? ' is-primary' : ''}`} aria-pressed={mode === 'random'} onClick={() => setMode('random')}>{tr('ui.stellar.006')}</button><button className={`app-btn${mode === 'specified' ? ' is-primary' : ''}`} aria-pressed={mode === 'specified'} onClick={() => setMode('specified')}>{tr('ui.stellar.007')}</button></div>
            <label className="app-stellar-seed"><span className="app-dim">{tr('ui.stellar.008')}</span><input data-system-seed aria-label={tr('ui.stellar.008')} className="app-input" type="text" inputMode="numeric" disabled={mode === 'random'} placeholder={mode === 'random' ? tr('ui.stellar.006') : undefined} value={seedText} maxLength={14} onChange={e => setSeedText(e.target.value)} /></label>
            {stellar?.search ? <div className="app-stellar-actions"><button className="app-btn app-stellar-icon" title={tr(stellar.search.paused ? 'ui.stellar.011' : 'ui.stellar.010')} aria-label={tr(stellar.search.paused ? 'ui.stellar.011' : 'ui.stellar.010')} onClick={() => command('searchPause', [!stellar.search!.paused])}>{stellar.search.paused ? <Play size={17} /> : <Pause size={17} />}</button><button className="app-btn app-stellar-icon" title={tr('ui.stellar.012')} aria-label={tr('ui.stellar.012')} onClick={() => setConfirm({ kind: 'cancel', seq: stellar.search!.seq })}><X size={17} /></button></div>
              : <button data-search-launch className="app-btn is-primary" disabled={mode === 'specified' && parseStellarSeed(seedText) === undefined} onClick={() => { const seed = parseStellarSeed(seedText); command('search', [mode, seedText]); if (seed !== undefined && state.planetary?.stellar?.systems[stellarSystemId(seed)]) setSystemId(stellarSystemId(seed)) }}><Radar size={16} />{tr('ui.stellar.009')}</button>}
          </div>
          <div className="app-stellar-taskmetrics"><span>{tr('ui.stellar.001')} <strong>×{fmtInt(state.warehouse.items['deep-space-probe'] ?? 0)}</strong></span><span>{tr('ui.stellar.015')} <strong>{stellarCandidateCount(state)}/{stellarCapacity(state)}</strong></span><span>{tr('ui.stellar.046')} <strong>{fmtDuration(stellar?.search ? Math.max(0, stellar.search.durationMs - stellar.search.progressMs) : stellarSearchDuration(state))}</strong></span></div>
          <progress aria-label={tr('ui.stellarHud.001')} max={stellar?.search?.durationMs ?? 1} value={stellar?.search?.progressMs ?? 0} />
        </section>
        <section className="app-stellar-production" aria-label={tr('ui.stellarHud.003')}><div className="app-stellar-taskhead"><h3><Factory size={16} />{tr('ui.stellarHud.003')}</h3><button className="app-btn app-stellar-icon" data-probe-manufacture title={tr('ui.stellar.047')} aria-label={tr('ui.stellar.047')} onClick={() => command('manufactureProbe', [])}><Factory size={17} /></button></div><div className="app-stellar-productionlist">{manufacture.length ? manufacture.map(run => <div key={run.id} data-probe-production><div className="app-stellar-productionrow"><span>{run.productName}</span><strong>{fmtDuration(run.remainingMs)}</strong></div><progress aria-label={run.productName} max={100} value={run.percent} /></div>) : <div className="app-dim">{tr('ui.battleCycles.013')}</div>}</div></section>
      </div>
      <div className="app-stellar-footer"><div className="app-stellar-feedback" role="status">{message || (stellar?.stoppedReason ? tr(reasonIds[stellar.stoppedReason]!) : '')}</div><button className="app-btn is-small" onClick={() => setLegacy(true)}>{tr('ui.stellar.038')}</button></div>
      {/* ⟪文案调整 2026-10-09⟫ 探测/坐标确认撤销复用通用取消，不误用施工取消。 */}
      {confirm ? <div className="app-stellar-confirm" role="alertdialog" aria-modal="true" aria-label={tr(confirm.kind === 'cancel' ? 'ui.stellar.012' : 'ui.stellar.019')}><div><strong>{tr(confirm.kind === 'cancel' ? 'ui.stellar.012' : 'ui.stellar.019')}</strong><p>{confirm.kind === 'cancel' ? tr('ui.stellar.013') : stellar?.systems[confirm.systemId]?.seed ?? tr('ui.stellar.044')}</p><div className="app-stellar-actions"><button className="app-btn" disabled={!confirmValid} onClick={() => { if (confirmValid) command(confirm.kind === 'cancel' ? 'searchCancel' : 'discardSystem', confirm.kind === 'cancel' ? [] : [confirm.systemId]) }}>{pt('confirm')}</button><button className="app-btn" onClick={() => setConfirm(null)}>{tr('ui.beacon.008')}</button></div></div></div> : null}
    </div>
  </div>
}
