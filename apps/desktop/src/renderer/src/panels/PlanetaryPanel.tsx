import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import {
  planetAdjacencyOf, planetBillOf, planetClearanceCheck, planetColonyView, planetConstructionCheck,
  planetEnvironmentOf, planetNeighborIndices, planetSurveyView, shipDisplayName,
  type PlanetActionResult, type PlanetBill, type PlanetCatalog, type PlanetGridCell,
  type PlanetJob, type PlanetState, type PlanetSurveyView,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import { fmtCredits, fmtDuration, fmtInt, fmtNum } from '../i18n/fmt'
import { pt } from '../ui/planetText'
import { Glyph } from '../ui/Glyphs'
import { InfoTable, infoCardContent } from '../ui/shipInfo'
import { hoverTipProps } from '../ui/Tooltip'
import '../styles-planetary.css'

export interface PlanetaryPanelProps {
  engine: GameEngine
  catalog: PlanetCatalog
  onClose: () => void
  onCommand: (action: string, args: unknown[]) => PlanetActionResult
}

type Tab = 'candidates' | 'surface' | 'population' | 'projects'
type Sort = 'default' | 'hazard' | 'habitability' | 'size'
type ColonyView = ReturnType<typeof planetColonyView>
const TABS: readonly Tab[] = ['candidates', 'surface', 'population', 'projects']
const TAB_ICONS: Record<Tab, string> = { candidates: 'nav-map', surface: 'ico-home', population: 'nav-ai', projects: 'ico-crane' }
const RESOURCES = ['food', 'water', 'medicine', 'metal', 'parts', 'research', 'rare'] as const
const RESOURCE_ICONS: Record<string, string> = { metal: 'mineral', water: 'ice', food: 'cargo', medicine: 'kit', research: 'nav-skills', rare: 'matter', energy: 'cpu' }
const buildingName = (id: string): string => pt('building.' + id)
const resourceName = (id: string): string => pt('resource.' + id)
const traitName = (id: string): string => pt('trait.' + id)
const planetName = (id: string): string => pt('name.' + id)
const percent = (value: number): string => `${fmtNum(value * 100, 0)}%`
const range = (value?: { min: number; max: number }): string => value
  ? value.min === value.max ? fmtInt(value.min) : `${fmtInt(value.min)} ~ ${fmtInt(value.max)}`
  : pt('unknown')

function NumberField({ label, value, onChange, min = 0, max, marker }: {
  label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; marker?: string
}) {
  return <label className="app-planet-field"><span>{label}</span><input className="app-input" type="number"
    data-planet-input={marker} min={min} max={max} step={1} value={value} onChange={e => {
      const next = e.currentTarget.valueAsNumber
      onChange(Number.isFinite(next) ? Math.max(min, Math.floor(next)) : min)
    }} /></label>
}

function Bill({ bill, itemName }: { bill?: PlanetBill; itemName: (id: string) => string }) {
  return bill ? <InfoTable lines={[
    { k: pt('cost'), v: fmtCredits(bill.credits) },
    { k: pt('duration'), v: fmtDuration(bill.durationMs) },
    ...Object.entries(bill.items).map(([id, count]) => ({ k: itemName(id), v: fmtInt(count) })),
  ]} /> : <div className="app-note app-dim">{pt('unavailable')}</div>
}

function Traits({ view }: { view?: PlanetSurveyView }) {
  return <div className="app-planet-traits">
    {view?.traitIds.map(id => <span className="app-planet-trait" key={id}>{traitName(id)}</span>)}
    {view && view.unknownTraits > 0 ? <span className="app-dim">{pt('unknownTraits')} {view.unknownTraits}</span> : null}
  </div>
}

function PlanetFacts({ view, size }: { view?: PlanetSurveyView; size: number }) {
  return <InfoTable lines={[
    { k: pt('size'), v: `${size} x ${size} (${size * size})` },
    { k: pt('hazard'), v: range(view?.hazard) },
    { k: pt('habitability'), v: range(view?.habitability) },
    { k: pt('survey'), v: view ? pt('survey.' + view.survey) : pt('undiscovered') },
  ]} />
}

function cellStatus(cell: PlanetGridCell, needsWorker: boolean): string {
  if (cell.obstacle) return pt('obstacle.' + cell.obstacle)
  const b = cell.building
  if (!b) return pt('empty')
  if (b.status !== 'ready') return pt('status.' + b.status)
  if (b.enabled === false) return pt('status.stopped')
  if (!b.powered) return pt('status.unpowered')
  if (needsWorker && !b.staffed) return pt('status.unstaffed')
  return pt('status.ready')
}

export function PlanetaryPanel({ engine, catalog, onClose, onCommand }: PlanetaryPanelProps): ReactNode {
  const state = engine.state
  const ctx = engine.getCtx()
  const planets = state.planetary?.planets ?? {}
  const definitions = [...catalog.planets.values()]
  const [planetId, setPlanetId] = useState(() => Object.keys(planets)[0] ?? definitions[0]?.id ?? '')
  const [tab, setTab] = useState<Tab>('surface')
  const [sort, setSort] = useState<Sort>('default')
  const [compareId, setCompareId] = useState('')
  const [cellIndex, setCellIndex] = useState(0)
  const [buildingId, setBuildingId] = useState(() => [...catalog.buildings.values()].find(b => b.kind === 'base')?.id ?? '')
  const [targetIndex, setTargetIndex] = useState(0)
  const [populationCount, setPopulationCount] = useState(1)
  const [shipUid, setShipUid] = useState(() => Object.keys(state.fleet).find(uid => uid !== state.shipId) ?? '')
  const [deliveryItems, setDeliveryItems] = useState<Record<string, number>>({})
  const [deliveryCredits, setDeliveryCredits] = useState(0)
  const [deliveryHumans, setDeliveryHumans] = useState(0)
  const [eventChoice, setEventChoice] = useState('dismiss')
  const [result, setResult] = useState<PlanetActionResult | null>(null)
  const [confirmation, setConfirmation] = useState<'demolish' | null>(null)
  const [, refresh] = useState(0)
  const modalRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const id = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = modalRef.current
    const focusables = (): HTMLElement[] => root ? [...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    )].filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0) : []
    closeRef.current?.focus()
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
      } else if (event.key === 'Tab') {
        const list = focusables()
        const first = list[0]
        const last = list[list.length - 1]
        if (!first) { event.preventDefault(); root?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    const focusin = (event: FocusEvent) => {
      if (root && event.target instanceof Node && !root.contains(event.target)) (focusables()[0] ?? root).focus()
    }
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('focusin', focusin)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('focusin', focusin)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  const selectedId = planets[planetId] || catalog.planets.has(planetId) ? planetId : Object.keys(planets)[0] ?? definitions[0]?.id ?? ''
  const planet = planets[selectedId]
  const definition = planet ?? catalog.planets.get(selectedId)
  const view = planet ? planetSurveyView(planet, catalog) : undefined
  const colony = planet?.colony
  const colonyView = planet && view?.cells ? planetColonyView(planet, catalog) : undefined
  const cell = view?.cells?.[cellIndex]
  const building = cell?.building ? catalog.buildings.get(cell.building.id) : undefined
  const selectedBuilding = catalog.buildings.get(buildingId)
  const operation = catalog.operations?.get(buildingId)
  const bill = planet && view?.cells && operation ? planetBillOf(planet, catalog, operation.bill) : undefined
  const check = planet && view?.cells && selectedBuilding ? planetConstructionCheck(planet, cellIndex, buildingId, catalog) : undefined
  const neighbors = definition ? planetNeighborIndices(definition.size, cellIndex) : []
  const adjacency = planet && cell?.building ? planetAdjacencyOf(planet, cellIndex, catalog) : undefined
  const environment = view && view.survey >= 2 ? planetEnvironmentOf({ traitIds: view.traitIds }, catalog) : undefined
  const itemName = (itemId: string): string => ctx.items.get(itemId)?.name ?? itemId
  const deliveryShip = state.fleet[shipUid]
  const shipmentStock = Object.entries(state.warehouse.items).filter(([key, count]) => count > 0 && ctx.items.has(key) && !ctx.items.get(key)?.holdForbidden)
  const knownTraits = new Set(view?.traitIds ?? [])
  const projects = [...(catalog.projects?.values() ?? [])].filter(project =>
    (!project.fromTraitId || knownTraits.has(project.fromTraitId)) && (!project.removeTraitId || knownTraits.has(project.removeTraitId)),
  )

  function command(action: string, ...args: unknown[]): void {
    try {
      setResult(onCommand(action, args))
    } catch {
      setResult({ ok: false, reason: 'command-failed' })
    }
    refresh(value => value + 1)
    setConfirmation(null)
  }

  function selectPlanet(nextId: string): void {
    setPlanetId(nextId)
    setCellIndex(0)
    setTargetIndex(0)
    setResult(null)
    setConfirmation(null)
    setDeliveryItems({})
  }

  function gridKey(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!definition) return
    const size = definition.size
    let next = index
    if (event.key === 'ArrowUp') next = Math.max(0, index - size)
    else if (event.key === 'ArrowDown') next = Math.min(size * size - 1, index + size)
    else if (event.key === 'ArrowLeft') next = index % size > 0 ? index - 1 : index
    else if (event.key === 'ArrowRight') next = index % size < size - 1 ? index + 1 : index
    else if (event.key === 'Home') next = event.ctrlKey ? 0 : index - index % size
    else if (event.key === 'End') next = event.ctrlKey ? size * size - 1 : index - index % size + size - 1
    else return
    event.preventDefault()
    setCellIndex(next)
    setConfirmation(null)
    modalRef.current?.querySelector<HTMLButtonElement>(`[data-planet-cell="${next}"]`)?.focus()
  }

  function jobRows(jobs: readonly PlanetJob[]): ReactNode {
    return jobs.length ? <div className="app-planet-jobs">{jobs.map(job => <article className="app-planet-job" key={job.seq}>
      <div className="app-planet-row"><strong>{pt('job.' + job.kind)} #{job.seq}</strong>
        <span>{job.paused ? pt('paused') : fmtDuration(job.remainingMs)}</span></div>
      <div className="app-dim">{job.buildingId ? buildingName(job.buildingId) : job.projectId ? pt('project.' + job.projectId) : ''}
        {job.cellIndex !== undefined ? ` #${job.cellIndex + 1}` : ''}{job.targetIndex !== undefined ? ` > #${job.targetIndex + 1}` : ''}</div>
      <progress aria-label={pt('progress')} max={Math.max(1, job.totalMs)} value={Math.max(0, job.totalMs - job.remainingMs)} />
      <div className="app-planet-actions">
        <button className="app-btn is-small" onClick={() => command('pause', selectedId, job.seq, !job.paused)}>{pt(job.paused ? 'resume' : 'pause')}</button>
        <button className="app-btn is-small" onClick={() => command('cancel', selectedId, job.seq)}>{pt('cancel')}</button>
      </div>
    </article>)}</div> : <div className="app-note app-dim">{pt('noJobs')}</div>
  }

  function summary(value?: ColonyView): ReactNode {
    return <div className="app-planet-summary">
      <span><Glyph name="cpu" size={18} />{pt('power')} <b>{value ? `${fmtNum(value.powerProduced, 1)} / ${fmtNum(value.powerUsed, 1)}` : '-'}</b></span>
      <span>{pt('awake')} <b>{fmtInt(colony?.awake ?? 0)}</b></span>
      <span>{pt('sleeping')} <b>{fmtInt(colony?.sleeping ?? 0)}</b></span>
      <span>{pt('housing')} <b>{value ? fmtInt(value.housing) : '-'}</b></span>
      <span className={colony?.crisis && colony.crisis !== 'none' ? 'app-warn' : ''}>{value ? pt('stage.' + value.stage) : pt('undiscovered')}</span>
      <span>{resourceName('food')} <b>{fmtNum(colony?.supplies.food ?? 0, 1)}</b></span>
      <span>{resourceName('water')} <b>{fmtNum(colony?.supplies.water ?? 0, 1)}</b></span>
      <span>{resourceName('medicine')} <b>{fmtNum(colony?.supplies.medicine ?? 0, 1)}</b></span>
    </div>
  }

  const rows = definitions.map(def => ({ def, view: planets[def.id] ? planetSurveyView(planets[def.id], catalog) : undefined }))
  rows.sort((a, b) => {
    if (sort === 'size') return b.def.size - a.def.size
    if (sort === 'default') return 0
    if (!a.view || !b.view) return Number(!a.view) - Number(!b.view)
    return sort === 'hazard' ? a.view.hazard.max - b.view.hazard.max : b.view.habitability.min - a.view.habitability.min
  })
  const compared = planets[compareId]
  const comparedDefinition = compared ?? catalog.planets.get(compareId)
  const comparedView = compared ? planetSurveyView(compared, catalog) : undefined

  let preview: { incoming: ReturnType<typeof planetAdjacencyOf>; outgoing: { index: number; outputAdd: number; wearCut: number }[] } | undefined
  if (planet && view?.cells && check?.ok) {
    const projected: PlanetState = { ...planet, cells: view.cells.map(c => c.index === cellIndex
      ? { ...c, building: { id: buildingId, status: 'ready', powered: true, staffed: true, enabled: true, condition: 1 } }
      : c) }
    preview = { incoming: planetAdjacencyOf(projected, cellIndex, catalog), outgoing: neighbors
      .filter(index => !!view.cells?.[index]?.building)
      .map(index => {
        const before = planetAdjacencyOf(planet, index, catalog)
        const after = planetAdjacencyOf(projected, index, catalog)
        return { index, outputAdd: after.outputAdd - before.outputAdd, wearCut: after.wearCut - before.wearCut }
      }).filter(row => row.outputAdd > 0 || row.wearCut > 0) }
  }

  return <div className="app-modal-mask app-planet-mask" onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="app-modal app-planet-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} ref={modalRef}>
      <div className="app-modal-head">
        <strong id={`${id}-title`} className="app-report-title">{pt('title')}</strong>
        <label className="app-planet-picker"><span className="app-dim">{pt('planet')}</span>
          <select className="app-select" value={selectedId} onChange={event => selectPlanet(event.target.value)}>
            {definitions.map(def => <option key={def.id} value={def.id}>{planetName(def.id)}</option>)}
            {Object.values(planets).filter(p => !catalog.planets.has(p.id)).map(p => <option key={p.id} value={p.id}>{planetName(p.id)}</option>)}
          </select></label>
        <button className="app-btn is-small app-planet-close" ref={closeRef} onClick={onClose} aria-label={pt('close')} title={pt('close')}><span aria-hidden="true">X</span></button>
      </div>
      <div className="app-subtabs app-planet-tabs" role="tablist" aria-label={pt('title')}>
        {TABS.map((name, index) => <button key={name} id={`${id}-${name}-tab`} className={`app-subtab${tab === name ? ' is-active' : ''}`}
          role="tab" aria-selected={tab === name} aria-controls={`${id}-page`} tabIndex={tab === name ? 0 : -1}
          onClick={() => setTab(name)} onKeyDown={event => {
            let next = index
            if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
            else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = TABS.length - 1
            else return
            event.preventDefault()
            setTab(TABS[next])
            modalRef.current?.querySelector<HTMLButtonElement>(`[id="${id}-${TABS[next]}-tab"]`)?.focus()
          }}><Glyph name={TAB_ICONS[name]} size={18} />{pt('' + name)}</button>)}
      </div>
      {summary(colonyView)}
      <div className={`app-planet-feedback${result && !result.ok ? ' app-warn' : ' app-dim'}`} role={result && !result.ok ? 'alert' : 'status'} aria-live="polite">
        {result ? result.ok ? pt('commandOk') : pt('reason.' + (result.reason ?? 'command-failed')) : colony && colony.crisis !== 'none' ? pt('crisis.' + colony.crisis) : ''}
      </div>
      <div className="app-modal-body app-planet-body" id={`${id}-page`} role="tabpanel" aria-labelledby={`${id}-${tab}-tab`}>
        {!definition ? <div className="app-note">{pt('noCandidates')}</div> : tab === 'candidates' ? <div className="app-planet-candidates">
          <div className="app-planet-column">
            <label className="app-planet-field app-planet-sort"><span>{pt('sort')}</span><select className="app-select" value={sort} onChange={event => setSort(event.target.value as Sort)}>
              <option value="default">{pt('defaultOrder')}</option><option value="hazard">{pt('hazard')}</option>
              <option value="habitability">{pt('habitability')}</option><option value="size">{pt('size')}</option>
            </select></label>
            <div className="app-planet-scroll app-planet-candidate-list">{rows.map(row => <button key={row.def.id}
              className={`app-planet-candidate${row.def.id === selectedId ? ' is-active' : ''}`} aria-pressed={row.def.id === selectedId}
              onClick={() => selectPlanet(row.def.id)} {...hoverTipProps(infoCardContent(planetName(row.def.id), [
                { k: pt('hazard'), v: range(row.view?.hazard) }, { k: pt('habitability'), v: range(row.view?.habitability) },
              ]))}>
              <strong>{planetName(row.def.id)}</strong><span>{row.def.size * row.def.size} {pt('tiles')}</span>
              <span>{pt('hazard')} {range(row.view?.hazard)}</span><span>{pt('habitability')} {range(row.view?.habitability)}</span>
            </button>)}</div>
          </div>
          <div className="app-planet-scroll app-planet-comparison">
            <label className="app-planet-field"><span>{pt('compare')}</span><select className="app-select" value={compareId} onChange={e => setCompareId(e.target.value)}>
              <option value="">{pt('none')}</option>{definitions.filter(def => def.id !== selectedId).map(def => <option value={def.id} key={def.id}>{planetName(def.id)}</option>)}
            </select></label>
            <div className="app-planet-compare-grid"><section><h3>{planetName(selectedId)}</h3><PlanetFacts view={view} size={definition.size} /><Traits view={view} /></section>
              {comparedDefinition && compareId !== selectedId ? <section><h3>{planetName(compareId)}</h3><PlanetFacts view={comparedView} size={comparedDefinition.size} /><Traits view={comparedView} /></section> : null}</div>
            <div className="app-planet-actions"><button className="app-btn" disabled={!!planet} onClick={() => command('discover', selectedId)}>{pt('discover')}</button>
              <button className="app-btn" disabled={!view || view.survey >= 2} onClick={() => command('survey', selectedId, 2)}>{pt('survey.2')}</button>
              <button className="app-btn" disabled={!view || view.survey >= 3} onClick={() => command('survey', selectedId, 3)}>{pt('survey.3')}</button></div>
          </div>
        </div> : tab === 'surface' ? <div className="app-planet-surface">
          <div className="app-planet-column">
            <div className="app-planet-grid-head"><strong>{planetName(selectedId)}</strong><span className="app-dim">{definition.size} x {definition.size}</span></div>
            <div className="app-planet-scroll app-planet-grid-scroll">
              <div className="app-planet-grid" role="group" aria-label={pt('surface')} style={{ '--planet-columns': definition.size } as CSSProperties}>
                {Array.from({ length: definition.size * definition.size }, (_, index) => {
                  const tile = view?.cells?.[index]
                  const legal = planet && tile && selectedBuilding ? planetConstructionCheck(planet, index, buildingId, catalog).ok : false
                  const title = tile ? [pt('tile') + ` ${index + 1}`, tile.building ? buildingName(tile.building.id) : pt('empty'),
                    cellStatus(tile, !!tile.building && catalog.buildings.get(tile.building.id)?.worker === 'human'), tile.deposit ? resourceName(tile.deposit.resource) : ''].filter(Boolean).join(' / ') : pt('unknown')
                  return <button type="button" key={index} data-planet-cell={index} aria-label={title} aria-pressed={index === cellIndex}
                    tabIndex={index === cellIndex ? 0 : -1} title={title}
                    className={`app-planet-tile${index === cellIndex ? ' is-selected' : ''}${legal ? ' is-buildable' : ''}${neighbors.includes(index) ? ' is-neighbor' : ''}${tile?.obstacle ? ' is-obstacle' : ''}`}
                    onClick={() => { setCellIndex(index); setConfirmation(null); setResult(null) }} onKeyDown={event => gridKey(event, index)}>
                    <span className="app-planet-tile-index">{index + 1}</span>
                    <Glyph name={!tile ? 'ico-scan' : tile.obstacle ? 'wreck' : tile.building ? 'ico-home' : tile.deposit ? RESOURCE_ICONS[tile.deposit.resource] : 'fallback'} size={22} />
                    <span className="app-planet-tile-mark">{!tile ? '?' : tile.building ? tile.building.status === 'construction' ? '+' : tile.building.enabled === false ? '-' : !tile.building.powered ? '!' : tile.building.staffed ? '1' : '' : tile.obstacle ? '!' : tile.deposit ? '+' : ''}</span>
                  </button>
                })}
              </div>
              <div className="app-planet-grid-legend app-dim"><span>{pt('empty')}</span><span>+ {pt('resource')}</span><span>! {pt('obstacle')}</span></div>
              <Traits view={view} />
              {!view?.cells ? <div className="app-note">{planet && !view ? pt('reason.unsupported') : pt('reason.survey-required')}</div> : null}
              {environment ? <InfoTable lines={[
                { k: pt('hazard'), v: range(view?.hazard) }, { k: pt('habitability'), v: range(view?.habitability) },
                { k: pt('constructionMultiplier'), v: `x${fmtNum(environment.constructionMul)}` },
                { k: pt('consumptionMultiplier'), v: `x${fmtNum(environment.consumptionMul)}` },
              ]} /> : null}
            </div>
          </div>
          <aside className="app-planet-detail">
            <div className="app-planet-detail-top"><strong>{pt('tile')} #{cellIndex + 1}</strong><div className="app-planet-actions">
              {!planet ? <button className="app-btn is-small" onClick={() => command('discover', selectedId)}>{pt('discover')}</button> : !view?.cells ? <button className="app-btn is-small" disabled={!view} onClick={() => command('survey', selectedId, 2)}>{pt('survey.2')}</button> : null}
              <button className="app-btn is-small" disabled={!cell?.obstacle || !planet || !colony || !planetClearanceCheck(planet, cellIndex, catalog).ok} onClick={() => command('clear', selectedId, cellIndex)}>{pt('clear')}</button>
            </div></div>
            <div className="app-planet-scroll app-planet-detail-scroll">
              {cell ? <>
                <div className="app-planet-row"><strong>{cell.building ? buildingName(cell.building.id) : pt('empty')}</strong><span className="app-dim">{cellStatus(cell, building?.worker === 'human')}</span></div>
                {cell.deposit ? <InfoTable lines={[{ k: pt('resource'), v: resourceName(cell.deposit.resource) }, { k: pt('depositBonus'), v: percent(cell.deposit.bonus) }]} /> : null}
                {cell.building ? <>
                  <InfoTable lines={[{ k: pt('condition'), v: percent(cell.building.condition ?? 1) },
                    { k: pt('staff'), v: building?.worker === 'human' ? pt(cell.building.staffed ? 'staffed' : 'status.unstaffed') : pt('automatic') }]} />
                  <div className="app-planet-actions">
                    <button className="app-btn is-small" onClick={() => command('repair', selectedId, cellIndex)} disabled={(cell.building.condition ?? 1) >= 1}>{pt('repair')}</button>
                    <label className="app-planet-check"><input type="checkbox" checked={cell.building.enabled !== false} disabled={!colony || cell.building.status === 'construction'} onChange={e => command('toggle', selectedId, cellIndex, e.target.checked)} />{pt('enabled')}</label>
                    {building?.worker === 'human' ? <label className="app-planet-check"><input type="checkbox" checked={cell.building.staffed} disabled={!colony || cell.building.status !== 'ready'} onChange={e => command('staff', selectedId, cellIndex, e.target.checked)} />{pt('staff')}</label> : null}
                  </div>
                  <label className="app-planet-field"><span>{pt('moveTarget')}</span><select className="app-select" value={targetIndex} onChange={e => setTargetIndex(Number(e.target.value))}>
                    {view?.cells?.map(c => <option value={c.index} key={c.index} disabled={c.index === cellIndex || !!c.obstacle || !!c.building}>#{c.index + 1}{c.deposit ? ` / ${resourceName(c.deposit.resource)}` : ''}</option>)}
                  </select></label>
                  <div className="app-planet-actions"><button className="app-btn is-small" disabled={!colony || targetIndex === cellIndex || !!view?.cells?.[targetIndex]?.building || !!view?.cells?.[targetIndex]?.obstacle || cell.building.status !== 'ready'} onClick={() => command('move', selectedId, cellIndex, targetIndex)}>{pt('move')}</button>
                    <button className="app-btn is-small" disabled={!colony || cell.building.status === 'construction'} onClick={() => setConfirmation('demolish')}>{pt('demolish')}</button></div>
                  {confirmation ? <div className="app-note"><div>{pt('demolishConfirm')}</div><div className="app-planet-actions">
                    <button className="app-btn is-small" onClick={() => command('demolish', selectedId, cellIndex)}>{pt('confirm')}</button>
                    <button className="app-btn is-small" onClick={() => setConfirmation(null)}>{pt('cancel')}</button></div></div> : null}
                </> : <>
                  <label className="app-planet-field"><span>{pt('building')}</span><select className="app-select" value={buildingId} onChange={e => { setBuildingId(e.target.value); setResult(null) }}>
                    {[...catalog.buildings.values()].filter(b => !b.requiredTraitId || knownTraits.has(b.requiredTraitId)).map(b => <option value={b.id} key={b.id}>{buildingName(b.id)}</option>)}
                  </select></label>
                  <Bill bill={bill} itemName={itemName} />
                  {operation ? <InfoTable lines={[
                    { k: pt('power'), v: fmtNum(operation.power, 1) },
                    { k: pt('staff'), v: pt(selectedBuilding?.worker === 'human' ? 'human' : 'automatic') },
                    ...(operation.housing ? [{ k: pt('housing'), v: fmtInt(operation.housing) }] : []),
                    ...(operation.cryoCapacity ? [{ k: pt('cryoCapacity'), v: fmtInt(operation.cryoCapacity) }] : []),
                  ]} /> : null}
                  <button className="app-btn is-primary" disabled={!check?.ok || !operation || (!colony && selectedBuilding?.kind !== 'base')} onClick={() => command('build', selectedId, cellIndex, buildingId)}>{pt('build')}</button>
                  {check && !check.ok ? <div className="app-note app-warn">{pt('reason.' + check.reason)}</div> : !colony && selectedBuilding?.kind !== 'base' ? <div className="app-note app-warn">{pt('reason.base-required')}</div> : null}
                </>}
                <section className="app-planet-section"><h3>{pt('adjacency')}</h3>
                  <InfoTable lines={[{ k: pt('outputBonus'), v: percent(adjacency?.outputAdd ?? preview?.incoming.outputAdd ?? 0) },
                    { k: pt('wearReduction'), v: percent(adjacency?.wearCut ?? preview?.incoming.wearCut ?? 0) }]} />
                  {preview ? <div className="app-note app-dim">{pt('adjacencyPreview')}</div> : null}
                  <div className="app-planet-neighbors">{neighbors.map(index => <button className="app-btn is-small" key={index} onClick={() => { setCellIndex(index); setConfirmation(null) }}>#{index + 1} {view?.cells?.[index]?.building ? buildingName(view.cells[index].building!.id) : pt('empty')}</button>)}</div>
                  {preview?.outgoing.map(row => <div className="app-dim" key={row.index}>#{row.index + 1}: {pt('outputBonus')} +{percent(row.outputAdd)} / {pt('wearReduction')} +{percent(row.wearCut)}</div>)}
                </section>
                <section className="app-planet-section"><h3>{pt('jobs')}</h3>{jobRows(colony?.jobs.filter(job => job.cellIndex === cellIndex || job.targetIndex === cellIndex) ?? [])}</section>
              </> : <div className="app-note">{pt('reason.survey-required')}</div>}
            </div>
          </aside>
        </div> : tab === 'population' ? <div className="app-planet-population">
          <div className="app-planet-scroll"><h3>{pt('population')}</h3>
            <InfoTable lines={[
              { k: pt('awake'), v: fmtInt(colony?.awake ?? 0) }, { k: pt('sleeping'), v: fmtInt(colony?.sleeping ?? 0) },
              { k: pt('housing'), v: colonyView ? fmtInt(colonyView.housing) : '-' },
              { k: pt('cryoCapacity'), v: colonyView ? fmtInt(colonyView.cryoCapacity) : '-' },
              { k: pt('readiness'), v: pt(colonyView?.ready ? 'ready' : 'notReady') },
            ]} />
            <NumberField label={pt('quantity')} value={populationCount} onChange={setPopulationCount} min={1} marker="population" />
            <div className="app-planet-actions"><button className="app-btn" disabled={!colony || populationCount > colony.sleeping} onClick={() => command('wake', selectedId, populationCount)}>{pt('wake')}</button>
              <button className="app-btn" disabled={!colony || populationCount > colony.awake} onClick={() => command('sleep', selectedId, populationCount)}>{pt('sleep')}</button>
              <button className="app-btn" disabled={!view?.cells || !!state.planetary?.humans} onClick={() => command('discoverHumans', selectedId)}>{pt('discoverHumans')}</button></div>
            {colony ? <div className={colony.crisis === 'none' ? 'app-note app-dim' : 'app-note app-warn'}>{pt('crisis.' + colony.crisis)}</div> : <div className="app-note">{pt('noColony')}</div>}
            <section className="app-planet-section"><h3>{pt('supplies')}</h3>
              <div className="app-note app-dim">{pt('perHour')}</div>
              <table className="app-planet-supply-table"><thead><tr><th>{pt('resource')}</th><th>{pt('inventory')}</th><th>{pt('production')}</th><th>{pt('consumption')}</th></tr></thead>
                <tbody>{RESOURCES.map(resource => <tr key={resource}><th scope="row">{resourceName(resource)}</th><td>{fmtNum(colony?.supplies[resource] ?? 0, 1)}</td>
                  <td>{colonyView ? fmtNum(colonyView.production[resource] ?? 0, 1) : '-'}</td><td>{colonyView ? fmtNum(colonyView.consumption[resource] ?? 0, 1) : '-'}</td></tr>)}</tbody></table>
            </section>
            <section className="app-planet-section"><h3>{pt('inventory')}</h3><InfoTable lines={[
              { k: pt('credits'), v: fmtCredits(colony?.credits ?? 0) }, ...Object.entries(colony?.items ?? {}).map(([key, count]) => ({ k: itemName(key), v: fmtInt(count) })),
            ]} /></section>
          </div>
          <div className="app-planet-scroll"><h3>{pt('delivery')}</h3>
            <div className="app-planet-actions">{['repairkit-civ', 'part-coolant', 'min-tritanium'].map(item => <button key={item} className="app-btn is-small"
              disabled={!colony || (colony.items[item] ?? 0) < 1} onClick={() => command('convert', selectedId, item, 1)}>{pt('convert')} · {itemName(item)}</button>)}</div>
            <label className="app-planet-field"><span>{pt('ship')}</span><select className="app-select" value={shipUid} onChange={e => { setShipUid(e.target.value); setDeliveryItems({}) }}>
              <option value="">{pt('none')}</option>{Object.keys(state.fleet).map(uid => <option key={uid} value={uid}>{shipDisplayName(state, ctx, uid)}</option>)}</select></label>
            <div className="app-planet-delivery-items">{shipmentStock.map(([key, count]) => <NumberField key={key}
              label={`${itemName(key)} (${fmtInt(count)})`} value={deliveryItems[key] ?? 0} max={Math.floor(count)} onChange={value => setDeliveryItems(items => ({ ...items, [key]: value }))} />)}</div>
            {!shipmentStock.length ? <div className="app-note app-dim">{pt('noMaterials')}</div> : null}
            <NumberField label={pt('credits')} value={deliveryCredits} onChange={setDeliveryCredits} max={state.wallet.isk} />
            <NumberField label={pt('humans')} value={deliveryHumans} onChange={setDeliveryHumans} max={state.planetary?.humans?.sleeping ?? 0} marker="delivery-humans" />
            <button data-delivery-submit className="app-btn is-primary" disabled={!view?.cells || !deliveryShip || (!deliveryCredits && !deliveryHumans && !Object.values(deliveryItems).some(count => count > 0))}
              onClick={() => command('delivery', selectedId, shipUid, Object.fromEntries(Object.entries(deliveryItems).filter(([, count]) => count > 0)), deliveryCredits, deliveryHumans)}>{pt('delivery')}</button>
            <section className="app-planet-section"><h3>{pt('inTransit')}</h3>
              {!(state.planetary?.deliveries ?? []).some(d => d.planetId === selectedId) ? <div className="app-note app-dim">{pt('noDeliveries')}</div> : null}
              {(state.planetary?.deliveries ?? []).filter(d => d.planetId === selectedId).map(d => <article className="app-planet-job" key={d.seq}>
                <div className="app-planet-row"><strong>{shipDisplayName(state, ctx, d.shipUid)}</strong><span>{fmtDuration(d.remainingMs)}</span></div>
                <InfoTable lines={[{ k: pt('credits'), v: fmtCredits(d.credits) }, { k: pt('humans'), v: fmtInt(d.humans) },
                  ...Object.entries(d.items).map(([key, count]) => ({ k: itemName(key), v: fmtInt(count) }))]} />
              </article>)}
            </section>
          </div>
        </div> : <div className="app-planet-projects">
          <div className="app-planet-scroll"><h3>{pt('projects')}</h3><Traits view={view} />
            {!colony ? <div className="app-note">{pt('noColony')}</div> : null}
            {!projects.length ? <div className="app-note app-dim">{pt('noProjects')}</div> : null}
            {projects.map(project => {
              const completed = planet?.projectHistory?.includes(project.id)
              const queued = colony?.jobs.some(job => job.projectId === project.id)
              return <article className="app-planet-project" key={project.id} data-project-id={project.id}>
                <h3>{pt('project.' + project.id)}</h3>
                <InfoTable lines={[{ k: pt('researchCost'), v: fmtInt(project.requiredResearch) },
                  ...(project.fromTraitId ? [{ k: pt('fromTrait'), v: traitName(project.fromTraitId) }] : []),
                  ...(project.toTraitId ? [{ k: pt('toTrait'), v: traitName(project.toTraitId) }] : []),
                  ...(project.removeTraitId ? [{ k: pt('removeTrait'), v: traitName(project.removeTraitId) }] : []),
                ]} /><Bill bill={planet && view?.cells ? planetBillOf(planet, catalog, project.bill) : undefined} itemName={itemName} />
                <button className="app-btn is-small" disabled={!colony || !view?.cells || completed || queued} onClick={() => command('project', selectedId, project.id)}>{pt(completed ? 'completed' : queued ? 'queued' : 'startProject')}</button>
              </article>
            })}
          </div>
          <div className="app-planet-scroll"><h3>{pt('jobs')}</h3>{jobRows(colony?.jobs ?? [])}
            {colony?.pauseEvents ? <button className="app-btn" onClick={() => command('resumeEvents', selectedId)}>{pt('resumeEvents')}</button> : null}
            {colony?.event ? <section className="app-planet-section"><h3>{pt('event.' + colony.event.kind)}</h3>
              {colony.event.cellIndex !== undefined ? <div className="app-note">{pt('tile')} #{colony.event.cellIndex + 1}</div> : null}
              <label className="app-planet-field"><span>{pt('events')}</span><select className="app-select" value={eventChoice} onChange={e => setEventChoice(e.target.value)}>
                {['repair', 'shelter', 'investigate', 'dismiss'].map(choice => <option key={choice} value={choice}>{pt('' + choice)}</option>)}
              </select></label>
              <button className="app-btn" onClick={() => command('event', selectedId, eventChoice)}>{pt('confirm')}</button>
            </section> : null}
          </div>
        </div>}
      </div>
    </div>
  </div>
}
