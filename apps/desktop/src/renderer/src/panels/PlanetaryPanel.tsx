import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Circle, CircleHelp, CirclePause, Hammer, HardHat, MoveRight, Play, Plus, PowerOff, ShieldAlert, Trash2, UserRound, UsersRound, Wrench, X, Zap, type LucideIcon } from 'lucide-react'
import {
  planetAdjacencyOf, planetBillOf, planetMoveBillOf, planetMoveCheck, planetClearanceCheck, planetColonyView, planetConstructionCheck,
  planetEnvironmentOf, planetNeighborIndices, planetSurveyView, shipDisplayName,
  type PlanetActionResult, type PlanetBill, type PlanetCatalog,
  type PlanetJob, type PlanetState, type PlanetSurveyView,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import { fmtCredits, fmtDuration, fmtInt, fmtNum } from '../i18n/fmt'
import { pt } from '../ui/planetText'
import { Glyph } from '../ui/Glyphs'
import { PLANET_BUILDING_GLYPHS, PLANET_RESOURCE_GLYPHS, planetBuildingTone, planetSurfaceCellView, type PlanetSurfaceStatus } from '../ui/planetSurfaceView'
import { PlanetTraitTags } from '../ui/PlanetTraitTags'
import { PlanetRadialMenu, type PlanetWheelItem } from '../ui/PlanetRadialMenu'
import { InfoTable, infoCardContent } from '../ui/shipInfo'
import { hoverTipProps } from '../ui/Tooltip'
import '../styles-planetary.css'

export interface PlanetaryPanelProps {
  engine: GameEngine
  catalog: PlanetCatalog
  onClose: () => void
  onCommand: (action: string, args: unknown[]) => PlanetActionResult
  initialPlanetId?: string
}

type Tab = 'candidates' | 'surface' | 'population' | 'projects'
type Sort = 'default' | 'hazard' | 'habitability' | 'size'
type ColonyView = ReturnType<typeof planetColonyView>
const TABS: readonly Tab[] = ['candidates', 'surface', 'population', 'projects']
const TAB_ICONS: Record<Tab, string> = { candidates: 'nav-map', surface: 'ico-home', population: 'nav-ai', projects: 'ico-crane' }
const RESOURCES = ['food', 'water', 'medicine', 'metal', 'parts', 'research', 'rare'] as const
const STATUS_ICONS: Record<PlanetSurfaceStatus, LucideIcon> = { unknown: CircleHelp, obstacle: ShieldAlert, empty: Circle,
  construction: HardHat, stopped: CirclePause, unpowered: PowerOff, unstaffed: UserRound, ready: Check }
const buildingName = (id: string): string => pt('building.' + id)
const resourceName = (id: string): string => pt('resource.' + id)
const traitName = (id: string): string => pt('trait.' + id)
const planetName = (id: string): string => /-p\d+$/.test(id) ? `${pt('planet')} ${id.match(/-p(\d+)$/)?.[1]}` : pt('name.' + id)
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

type WheelState = { planetId: string; index: number; sourceId?: string; sourceBuilding?: PlanetState['cells'][number]['building']; sourceFingerprint: string; jobSeq?: number; anchor: { x: number; y: number }; step: 'menu' | 'build' | 'move' | 'demolish'; target?: number }

function planetBuildingFingerprint(building?: PlanetState['cells'][number]['building']): string {
  // 持续变化的磨损与供电读数不属于操作身份，不能让日常结算打断轮盘。
  return building ? [building.id, building.status, building.staffed, building.enabled].join('|') : ''
}

function PlanetFacts({ view, size }: { view?: PlanetSurveyView; size: number }) {
  return <InfoTable lines={[
    { k: pt('size'), v: `${size} x ${size} (${size * size})` },
    { k: pt('hazard'), v: range(view?.hazard) },
    { k: pt('habitability'), v: range(view?.habitability) },
    { k: pt('survey'), v: view ? pt('survey.' + view.survey) : pt('undiscovered') },
  ]} />
}

function SurfaceStatus({ status, label, text = false }: { status: PlanetSurfaceStatus; label: string; text?: boolean }) {
  const Icon = STATUS_ICONS[status]
  return <span className={`app-planet-status is-${status}`} data-planet-status={status}>
    <Icon size={14} strokeWidth={1.7} aria-hidden="true" />{text ? <span>{label}</span> : null}
  </span>
}

export function PlanetaryPanel({ engine, catalog, onClose, onCommand, initialPlanetId }: PlanetaryPanelProps): ReactNode {
  const state = engine.state
  const ctx = engine.getCtx()
  const planets = state.planetary?.planets ?? {}
  const definitions = [...catalog.planets.values()]
  const [planetId, setPlanetId] = useState(() => initialPlanetId ?? Object.keys(planets)[0] ?? definitions[0]?.id ?? '')
  const [tab, setTab] = useState<Tab>('surface')
  const [sort, setSort] = useState<Sort>('default')
  const [compareId, setCompareId] = useState('')
  const [cellIndex, setCellIndex] = useState(0)
  const [buildingId, setBuildingId] = useState(() => [...catalog.buildings.values()].find(b => b.kind === 'base')?.id ?? '')
  const [populationCount, setPopulationCount] = useState(1)
  const [shipUid, setShipUid] = useState(() => Object.keys(state.fleet).find(uid => uid !== state.shipId) ?? '')
  const [deliveryItems, setDeliveryItems] = useState<Record<string, number>>({})
  const [deliveryCredits, setDeliveryCredits] = useState(0)
  const [deliveryHumans, setDeliveryHumans] = useState(0)
  const [eventChoice, setEventChoice] = useState('dismiss')
  const [result, setResult] = useState<PlanetActionResult | null>(null)
  const [wheel, setWheel] = useState<WheelState | null>(null)
  const [moving, setMoving] = useState<WheelState | null>(null)
  const [, refresh] = useState(0)
  const modalRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  const id = useId()
  const wheelRef = useRef(wheel)
  const movingRef = useRef(moving)
  const screenRef = useRef({ planetId, tab })
  wheelRef.current = wheel
  movingRef.current = moving
  onCloseRef.current = onClose

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = modalRef.current
    const focusRoot = () => root?.querySelector<HTMLElement>('.app-planet-wheel-dialog') ?? root
    const focusables = (): HTMLElement[] => focusRoot() ? [...focusRoot()!.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    )].filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0) : []
    closeRef.current?.focus()
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (wheelRef.current) setWheel(null)
        else if (movingRef.current) setMoving(null)
        else onCloseRef.current()
      } else if (event.key === 'Tab') {
        const list = focusables()
        const first = list[0]
        const last = list[list.length - 1]
        if (!first) { event.preventDefault(); root?.focus(); return }
        if (event.shiftKey && (document.activeElement === first || !focusRoot()?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !focusRoot()?.contains(document.activeElement))) {
          event.preventDefault(); first.focus()
        }
      }
    }
    const focusin = (event: FocusEvent) => {
      const active = focusRoot()
      if (active && event.target instanceof Node && !active.contains(event.target)) (focusables()[0] ?? active).focus()
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
  screenRef.current = { planetId: selectedId, tab }
  useEffect(() => { if (detailRef.current) detailRef.current.scrollTop = 0 }, [selectedId, cellIndex])
  const planet = planets[selectedId]
  const definition = planet ?? catalog.planets.get(selectedId)
  const view = planet ? planetSurveyView(planet, catalog) : undefined
  const colony = planet?.colony
  const colonyView = planet && view?.cells ? planetColonyView(planet, catalog) : undefined
  const cell = view?.cells?.[cellIndex]
  const building = cell?.building ? catalog.buildings.get(cell.building.id) : undefined
  const cellView = planetSurfaceCellView(cell, building)
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
  const currentJob = colony?.jobs.find(job => job.cellIndex === cellIndex || job.targetIndex === cellIndex)
  const sourceCell = wheel ? view?.cells?.[wheel.index] : undefined
  function sessionValid(session: WheelState): boolean {
    const current = engine.state.planetary?.planets[session.planetId]
    const source = current?.cells[session.index]
    const job = current?.colony?.jobs.find(value => value.cellIndex === session.index || value.targetIndex === session.index)
    return screenRef.current.planetId === session.planetId && screenRef.current.tab === 'surface'
      && !!current && !!planetSurveyView(current, catalog)?.cells?.[session.index]
      && source?.building === session.sourceBuilding && planetBuildingFingerprint(source?.building) === session.sourceFingerprint && source?.building?.id === session.sourceId && job?.seq === session.jobSeq
  }
  const wheelValid = !!wheel && sessionValid(wheel)
  const movingValid = !!moving && sessionValid(moving) && planet?.cells[moving.index]?.building?.status === 'ready'
  useEffect(() => { if (wheel && !wheelValid) setWheel(null) }, [wheelValid])
  useEffect(() => { if (moving && !movingValid) { setMoving(null); setWheel(null) } }, [movingValid])
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
    setWheel(null); setMoving(null)
  }

  function selectPlanet(nextId: string): void {
    setPlanetId(nextId)
    setCellIndex(0)
    setResult(null)
    setWheel(null); setMoving(null)
    setDeliveryItems({})
  }

  function wheelCommand(action: string, ...args: unknown[]): void {
    if (!wheel || wheelRef.current !== wheel || !sessionValid(wheel)) return
    command(action, ...args)
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
    setWheel(null)
    modalRef.current?.querySelector<HTMLButtonElement>(`[data-planet-cell="${next}"]`)?.focus()
  }

  function openCell(index: number, element: HTMLButtonElement): void {
    setCellIndex(index); setResult(null)
    const target = view?.cells?.[index]
    if (!target) return
    const modal = modalRef.current
    const offset = (el: HTMLElement) => { let x = 0, y = 0; for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) { x += node.offsetLeft; y += node.offsetTop }
      for (let node = el.parentElement; node && node !== modal; node = node.parentElement) { x -= node.scrollLeft; y -= node.scrollTop }
      return { x, y } }
    const at = offset(element), origin = modal ? offset(modal) : { x: 0, y: 0 }
    const anchor = { x: at.x - origin.x + element.offsetWidth / 2, y: at.y - origin.y + element.offsetHeight / 2 }
    if (moving) {
      if (!movingValid || !planet) { setMoving(null); setWheel(null); return }
      if (index === moving.index) return
      const allowed = planetMoveCheck(planet, catalog, moving.index, index)
      if (!allowed.ok) { setResult(allowed); return }
      setWheel({ ...moving, anchor, step: 'move', target: index }); return
    }
    const job = colony?.jobs.find(job => job.cellIndex === index || job.targetIndex === index)
    setWheel({ planetId: selectedId, index, sourceId: target.building?.id, sourceBuilding: planet?.cells[index]?.building, sourceFingerprint: planetBuildingFingerprint(target.building), jobSeq: job?.seq, anchor, step: 'menu' })
  }

  function jobRows(jobs: readonly PlanetJob[]): ReactNode {
    return jobs.length ? <div className="app-planet-jobs">{jobs.map(job => <article className="app-planet-job" key={job.seq}>
      <div className="app-planet-row"><strong>{pt('job.' + job.kind)} #{job.seq}</strong>
        <span>{job.paused ? pt('paused') : fmtDuration(job.remainingMs)}</span></div>
      <div className="app-dim">{job.buildingId ? buildingName(job.buildingId) : job.projectId ? pt('project.' + job.projectId) : ''}
        {job.cellIndex !== undefined ? ` #${job.cellIndex + 1}` : ''}{job.targetIndex !== undefined ? ` > #${job.targetIndex + 1}` : ''}</div>
      <progress aria-label={pt('progress')} max={Math.max(1, job.totalMs)} value={Math.max(0, job.totalMs - job.remainingMs)} />
      <div className="app-planet-actions">
        <button className="app-btn is-small app-planet-tool" title={pt(job.paused ? 'resume' : 'pause')} aria-label={pt(job.paused ? 'resume' : 'pause')} onClick={() => command('pause', selectedId, job.seq, !job.paused)}>{job.paused ? <Play size={16} /> : <CirclePause size={16} />}</button>
        <button className="app-btn is-small app-planet-tool" title={pt('cancel')} aria-label={pt('cancel')} onClick={() => command('cancel', selectedId, job.seq)}><X size={16} /></button>
      </div>
    </article>)}</div> : <div className="app-note app-dim">{pt('noJobs')}</div>
  }

  function summary(value?: ColonyView): ReactNode {
    return <div className="app-planet-summary">
      <div className="app-planet-summary-group">
        <span className={value && value.powerUsed > value.powerProduced ? 'app-warn' : ''}><Zap size={18} />{pt('power')} <b>{value ? `${fmtNum(value.powerProduced, 1)} / ${fmtNum(value.powerUsed, 1)}` : '-'}</b></span>
        <span><UsersRound size={18} />{pt('awake')} <b>{fmtInt(colony?.awake ?? 0)}</b></span>
        <span><Glyph name="planet-cryo" size={18} />{pt('sleeping')} <b>{fmtInt(colony?.sleeping ?? 0)}</b></span>
        <span><Glyph name="planet-housing" size={18} />{pt('housing')} <b>{value ? fmtInt(value.housing) : '-'}</b></span>
      </div>
      <div className="app-planet-summary-group">
        <span><Glyph name={PLANET_RESOURCE_GLYPHS.food!} size={18} />{resourceName('food')} <b>{fmtNum(colony?.supplies.food ?? 0, 1)}</b></span>
        <span><Glyph name={PLANET_RESOURCE_GLYPHS.water!} size={18} />{resourceName('water')} <b>{fmtNum(colony?.supplies.water ?? 0, 1)}</b></span>
        <span><Glyph name={PLANET_RESOURCE_GLYPHS.medicine!} size={18} />{resourceName('medicine')} <b>{fmtNum(colony?.supplies.medicine ?? 0, 1)}</b></span>
        <span className={`app-planet-stage${colony?.crisis && colony.crisis !== 'none' ? ' app-warn' : ''}`}><Glyph name="planet-base" size={18} />{value ? pt('stage.' + value.stage) : pt('undiscovered')}</span>
      </div>
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

  const wheelItems: PlanetWheelItem[] = []
  if (cell && wheel?.step === 'menu') {
    if (currentJob) {
      wheelItems.push({ id: 'pause', label: pt(currentJob.paused ? 'resume' : 'pause'), icon: currentJob.paused ? <Play size={24} /> : <CirclePause size={24} />, action: () => wheelCommand('pause', selectedId, currentJob.seq, !currentJob.paused) },
        { id: 'cancel', label: pt('cancel'), icon: <X size={24} />, action: () => wheelCommand('cancel', selectedId, currentJob.seq) })
    } else if (cell.obstacle) {
      wheelItems.push({ id: 'clear', label: pt('clear'), icon: <Hammer size={24} />, disabled: !planet || !colony || !planetClearanceCheck(planet, cellIndex, catalog).ok, action: () => wheelCommand('clear', selectedId, cellIndex) })
    } else if (!cell.building) {
      for (const option of catalog.buildings.values()) {
        if (option.requiredTraitId && !knownTraits.has(option.requiredTraitId)) continue
        const allowed = planet ? planetConstructionCheck(planet, cellIndex, option.id, catalog) : undefined
        const reason = !allowed?.ok ? pt('reason.' + (allowed && !allowed.ok ? allowed.reason : 'not-ready'))
          : !colony && option.kind !== 'base' ? pt('reason.base-required') : !catalog.operations?.has(option.id) ? pt('unavailable') : undefined
        wheelItems.push({ id: option.id, label: buildingName(option.id), icon: <Glyph name={PLANET_BUILDING_GLYPHS[option.id] ?? 'planet-base'} size={28} />, tone: planetBuildingTone(option.id), disabled: !!reason, reason,
          action: () => { if (wheelRef.current !== wheel || !sessionValid(wheel)) return; setBuildingId(option.id); setWheel({ ...wheel, step: 'build' }) } })
      }
    } else {
      const b = cell.building, ready = b.status === 'ready', protectedBuilding = ['base', 'cryo', 'housing'].includes(b.id)
      wheelItems.push({ id: 'repair', label: pt('repair'), icon: <Wrench size={24} />, disabled: !colony || !ready || (b.condition ?? 1) >= 1, action: () => wheelCommand('repair', selectedId, cellIndex) },
        { id: 'toggle', label: pt(b.enabled === false ? 'enable' : 'disable'), icon: b.enabled === false ? <Play size={24} /> : <PowerOff size={24} />, disabled: !ready, action: () => wheelCommand('toggle', selectedId, cellIndex, b.enabled === false) },
        { id: 'move', label: pt('move'), icon: <MoveRight size={24} />, disabled: protectedBuilding || !ready, reason: protectedBuilding ? pt('reason.protected') : undefined,
          action: () => { if (!protectedBuilding && ready && wheelRef.current === wheel && sessionValid(wheel)) { setMoving(wheel); setWheel(null) } } },
        { id: 'demolish', label: pt('demolish'), icon: <Trash2 size={24} />, tone: 'rgb(var(--wui-danger))', disabled: protectedBuilding || !ready, reason: protectedBuilding ? pt('reason.protected') : undefined,
          action: () => { if (!protectedBuilding && ready && wheelRef.current === wheel && sessionValid(wheel)) setWheel({ ...wheel, step: 'demolish' }) } })
      if (building?.worker === 'human') wheelItems.push({ id: 'staff', label: pt(b.staffed ? 'unassign' : 'assign'), icon: <UserRound size={24} />, disabled: !ready, action: () => wheelCommand('staff', selectedId, cellIndex, !b.staffed) })
    }
  }
  const moveCheck = wheel?.step === 'move' && planet && wheel.target !== undefined
    ? planetMoveCheck(planet, catalog, wheel.index, wheel.target) : undefined

  return <div className="app-modal-mask app-planet-mask" onClick={event => { if (event.target === event.currentTarget) { if (wheel) setWheel(null); else if (moving) setMoving(null); else onClose() } }}>
    <div className="app-modal app-planet-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} tabIndex={-1} ref={modalRef}>
      <div className="app-modal-head">
        <strong id={`${id}-title`} className="app-report-title">{pt('title')}</strong>
        <label className="app-planet-picker"><span className="app-dim">{pt('planet')}</span>
          <select className="app-select" value={selectedId} onChange={event => selectPlanet(event.target.value)}>
            {definitions.map(def => <option key={def.id} value={def.id}>{planetName(def.id)}</option>)}
            {Object.values(planets).filter(p => !catalog.planets.has(p.id)).map(p => <option key={p.id} value={p.id}>{planetName(p.id)}</option>)}
          </select></label>
        <button className="app-btn is-small app-planet-close" ref={closeRef} onClick={onClose} aria-label={pt('close')} title={pt('close')}><X size={18} aria-hidden="true" /></button>
      </div>
      <div className="app-subtabs app-planet-tabs" role="tablist" aria-label={pt('title')}>
        {TABS.map((name, index) => <button key={name} id={`${id}-${name}-tab`} className={`app-subtab${tab === name ? ' is-active' : ''}`}
          role="tab" aria-selected={tab === name} aria-controls={`${id}-page`} tabIndex={tab === name ? 0 : -1}
          onClick={() => { setTab(name); setWheel(null); setMoving(null) }} onKeyDown={event => {
            let next = index
            if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
            else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
            else if (event.key === 'Home') next = 0
            else if (event.key === 'End') next = TABS.length - 1
            else return
            event.preventDefault()
            setTab(TABS[next]); setWheel(null); setMoving(null)
            modalRef.current?.querySelector<HTMLButtonElement>(`[id="${id}-${TABS[next]}-tab"]`)?.focus()
          }}><Glyph name={TAB_ICONS[name]} size={18} />{pt('' + name)}</button>)}
      </div>
      <div className="app-planet-overview">
        <strong>{planetName(selectedId)}</strong><span>{definition ? `${definition.size} x ${definition.size}` : pt('unknown')}</span>
        <span className="app-planet-survey">{view ? pt('survey.' + view.survey) : pt('undiscovered')}</span>
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
            <div className="app-planet-compare-grid"><section><h3>{planetName(selectedId)}</h3><PlanetFacts view={view} size={definition.size} /><PlanetTraitTags view={view} catalog={catalog} /></section>
              {comparedDefinition && compareId !== selectedId ? <section><h3>{planetName(compareId)}</h3><PlanetFacts view={comparedView} size={comparedDefinition.size} /><PlanetTraitTags view={comparedView} catalog={catalog} /></section> : null}</div>
            <div className="app-planet-actions"><button className="app-btn" disabled={!!planet} onClick={() => command('discover', selectedId)}>{pt('discover')}</button>
              <button className="app-btn" disabled={!view || view.survey >= 2} onClick={() => command('survey', selectedId, 2)}>{pt('survey.2')}</button>
              <button className="app-btn" disabled={!view || view.survey >= 3} onClick={() => command('survey', selectedId, 3)}>{pt('survey.3')}</button></div>
          </div>
        </div> : tab === 'surface' ? <div className="app-planet-surface">
          <div className="app-planet-column">
            <div className="app-planet-grid-head"><strong>{pt('surface')}</strong><span className="app-dim">{definition.size ** 2} {pt('tiles')}</span></div>
            <div className="app-planet-scroll app-planet-grid-scroll">
              <div className="app-planet-grid" role="group" aria-label={pt('surface')} style={{ '--planet-columns': definition.size } as CSSProperties}>
                {Array.from({ length: definition.size * definition.size }, (_, index) => {
                  const tile = view?.cells?.[index]
                  const plain = !!tile && !tile.building && !tile.obstacle && !tile.deposit
                  const legal = !!tile && !tile.building && !tile.obstacle && !colony?.jobs.some(job => job.cellIndex === index || job.targetIndex === index)
                  const tileView = planetSurfaceCellView(tile, tile?.building ? catalog.buildings.get(tile.building.id) : undefined)
                  const title = [pt('tile') + ` ${index + 1}`, pt(tileView.nameKey), pt(tileView.textKey), tile?.deposit ? resourceName(tile.deposit.resource) : '', legal ? pt('build') : ''].filter(Boolean).join(' / ')
                  return <button type="button" key={index} data-planet-cell={index} aria-label={title} aria-pressed={index === cellIndex}
                    tabIndex={index === cellIndex ? 0 : -1} title={title}
                    className={`app-planet-tile${index === cellIndex ? ' is-selected' : ''}${plain ? ' is-plain' : ''}${legal ? ' is-buildable' : ''}${movingValid && planet && index !== moving!.index && planetMoveCheck(planet, catalog, moving!.index, index).ok ? ' is-move-target' : ''}${neighbors.includes(index) ? ' is-neighbor' : ''}${tile?.obstacle ? ' is-obstacle' : ''}`}
                    aria-haspopup={tile ? 'dialog' : undefined} onClick={event => openCell(index, event.currentTarget)} onKeyDown={event => gridKey(event, index)}>
                    {!plain ? <span className="app-planet-tile-index">{index + 1}</span> : null}
                    {!plain ? <Glyph name={tileView.glyph} size={32} className="app-planet-tile-art" color={tile?.building && !tile.obstacle ? planetBuildingTone(tile.building.id) : undefined} /> : legal ? <Plus size={26} className="app-planet-empty-plus" aria-hidden="true" /> : null}
                    {tile?.deposit && (tile.building || tile.obstacle) ? <span className="app-planet-tile-resource" data-planet-resource={tile.deposit.resource}><Glyph name={tileView.resourceGlyph!} size={14} /></span> : null}
                    {!plain && tileView.status !== 'empty' ? <span className="app-planet-tile-mark"><SurfaceStatus status={tileView.status} label={pt(tileView.textKey)} /></span> : null}
                  </button>
                })}
              </div>
              <PlanetTraitTags view={view} catalog={catalog} />
              {!view?.cells ? <div className="app-note">{planet && !view ? pt('reason.unsupported') : pt('reason.survey-required')}</div> : null}
              {environment ? <InfoTable lines={[
                { k: pt('hazard'), v: range(view?.hazard) }, { k: pt('habitability'), v: range(view?.habitability) },
                { k: pt('constructionMultiplier'), v: `x${fmtNum(environment.constructionMul)}` },
                { k: pt('consumptionMultiplier'), v: `x${fmtNum(environment.consumptionMul)}` },
              ]} /> : null}
            </div>
          </div>
          <aside className="app-planet-detail">
            <div className="app-planet-detail-top">
              <Glyph name={cellView.glyph} size={36} color={planetBuildingTone(cell?.building?.id)} />
              <div className="app-planet-detail-heading"><span className="app-dim">{pt('tile')} #{cellIndex + 1}</span><strong>{pt(cellView.nameKey)}</strong><SurfaceStatus status={cellView.status} label={pt(cellView.textKey)} text /></div>
            </div>
            <div className="app-planet-detail-discovery app-planet-actions">
              {!planet ? <button className="app-btn is-small" onClick={() => command('discover', selectedId)}>{pt('discover')}</button> : !view?.cells ? <button className="app-btn is-small" disabled={!view} onClick={() => command('survey', selectedId, 2)}>{pt('survey.2')}</button> : null}
            </div>
            <div className="app-planet-scroll app-planet-detail-scroll" ref={detailRef}>
              {cell ? <>
                {cell.deposit ? <InfoTable lines={[{ k: pt('resource'), v: resourceName(cell.deposit.resource) }, { k: pt('depositBonus'), v: percent(cell.deposit.bonus) }]} /> : null}
                {cell.building ? <>
                  <section className="app-planet-section app-planet-maintenance"><h3><Wrench size={16} />{pt('building')}</h3>
                  <InfoTable lines={[{ k: pt('condition'), v: percent(cell.building.condition ?? 1) },
                    { k: pt('staff'), v: building?.worker === 'human' ? pt(cell.building.staffed ? 'staffed' : 'status.unstaffed') : pt('automatic') }]} />
                  <InfoTable lines={[{ k: pt('enabled'), v: pt(cell.building.enabled === false ? 'disable' : 'enable') }]} />
                  </section>
                </> : <>
                  <section className="app-planet-section app-planet-construction"><h3><Glyph name={PLANET_BUILDING_GLYPHS[buildingId] ?? 'planet-base'} size={24} color={planetBuildingTone(buildingId)} />{selectedBuilding ? buildingName(selectedBuilding.id) : pt('building')}</h3>
                  <Bill bill={bill} itemName={itemName} />
                  {operation ? <InfoTable lines={[
                    { k: pt('power'), v: fmtNum(operation.power, 1) },
                    { k: pt('staff'), v: pt(selectedBuilding?.worker === 'human' ? 'human' : 'automatic') },
                    ...(operation.housing ? [{ k: pt('housing'), v: fmtInt(operation.housing) }] : []),
                    ...(operation.cryoCapacity ? [{ k: pt('cryoCapacity'), v: fmtInt(operation.cryoCapacity) }] : []),
                  ]} /> : null}
                  {check && !check.ok ? <div className="app-note app-warn">{pt('reason.' + check.reason)}</div> : !colony && selectedBuilding?.kind !== 'base' ? <div className="app-note app-warn">{pt('reason.base-required')}</div> : null}
                  </section>
                </>}
                <section className="app-planet-section"><h3>{pt('adjacency')}</h3>
                  <InfoTable lines={[{ k: pt('outputBonus'), v: percent(adjacency?.outputAdd ?? preview?.incoming.outputAdd ?? 0) },
                    { k: pt('wearReduction'), v: percent(adjacency?.wearCut ?? preview?.incoming.wearCut ?? 0) }]} />
                  {preview ? <div className="app-note app-dim">{pt('adjacencyPreview')}</div> : null}
                  <div className="app-planet-neighbors">{neighbors.map(index => <button className="app-btn is-small" key={index} onClick={() => { setCellIndex(index); setWheel(null) }}>#{index + 1} {view?.cells?.[index]?.building ? buildingName(view.cells[index].building!.id) : pt('empty')}</button>)}</div>
                  {preview?.outgoing.map(row => <div className="app-dim" key={row.index}>#{row.index + 1}: {pt('outputBonus')} +{percent(row.outputAdd)} / {pt('wearReduction')} +{percent(row.wearCut)}</div>)}
                </section>
                <section className="app-planet-section"><h3>{pt('jobs')}</h3>{jobRows(colony?.jobs.filter(job => job.cellIndex === cellIndex || job.targetIndex === cellIndex) ?? [])}</section>
              </> : <div className="app-note">{pt('reason.survey-required')}</div>}
            </div>
            <div className="app-planet-detail-commands">
              {moving ? <><span>{pt('moveTarget')} #{moving.index + 1}</span><button className="app-btn" onClick={() => setMoving(null)}><X size={18} />{pt('cancel')}</button></> : null}
            </div>
          </aside>
          <div className="app-planet-grid-legend app-dim">
            <span><Glyph name="planet-empty" size={16} />{pt('empty')}</span><span><Glyph name="mineral" size={16} />{pt('resource')}</span>
            <span><ShieldAlert size={14} />{pt('obstacle')}</span><span><HardHat size={14} />{pt('status.construction')}</span>
            <span><PowerOff size={14} />{pt('status.unpowered')}</span><span><UserRound size={14} />{pt('status.unstaffed')}</span>
            <span><CirclePause size={14} />{pt('status.stopped')}</span><span><Check size={14} />{pt('status.ready')}</span>
          </div>
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
          <div className="app-planet-scroll"><h3>{pt('projects')}</h3><PlanetTraitTags view={view} catalog={catalog} />
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
      {wheel && wheelValid ? <PlanetRadialMenu key={`${wheel.planetId}:${wheel.index}`} title={wheel.step === 'menu' ? `${pt('tile')} #${wheel.index + 1}` : pt(wheel.step)}
        items={wheelItems} anchor={wheel.anchor} onClose={() => setWheel(null)} restoreFocus={() => modalRef.current?.querySelector<HTMLButtonElement>(`[data-planet-cell="${wheel.index}"]`)?.focus()}
        onBack={() => { if (wheel.step === 'move') setWheel(null); else setWheel({ ...wheel, step: 'menu', target: undefined }) }}>
        {wheel.step === 'build' ? <>
          <h3><Glyph name={PLANET_BUILDING_GLYPHS[buildingId] ?? 'planet-base'} size={28} color={planetBuildingTone(buildingId)} />{buildingName(buildingId)}</h3>
          <Bill bill={bill} itemName={itemName} />
          <InfoTable lines={[{ k: pt('power'), v: operation ? fmtNum(operation.power, 1) : '-' }, { k: pt('outputBonus'), v: percent(preview?.incoming.outputAdd ?? 0) }, { k: pt('wearReduction'), v: percent(preview?.incoming.wearCut ?? 0) }]} />
          {preview?.outgoing.map(value => <div key={value.index}>#{value.index + 1} {pt('outputBonus')} +{percent(value.outputAdd)}</div>)}
          {check && !check.ok ? <div className="app-note app-warn">{pt('reason.' + check.reason)}</div> : null}
          <button type="button" className="app-btn is-primary" data-wheel-confirm="build" disabled={!check?.ok || !operation || (!colony && selectedBuilding?.kind !== 'base')} onClick={() => wheelCommand('build', wheel.planetId, wheel.index, buildingId)}><HardHat size={18} />{pt('confirm')}</button>
        </> : wheel.step === 'demolish' ? <><p>{pt('demolishConfirm')}</p><strong>{sourceCell?.building ? buildingName(sourceCell.building.id) : pt('unknown')}</strong>
          <button type="button" className="app-btn" data-wheel-confirm="demolish" disabled={!sourceCell?.building || ['base', 'cryo', 'housing'].includes(sourceCell.building.id)} onClick={() => wheelCommand('demolish', wheel.planetId, wheel.index)}><Trash2 size={18} />{pt('confirm')}</button></>
          : wheel.step === 'move' ? <><h3>{sourceCell?.building ? buildingName(sourceCell.building.id) : pt('unknown')}</h3><p>#{wheel.index + 1} <MoveRight size={16} /> #{(wheel.target ?? 0) + 1}</p>
            <Bill bill={planet ? planetMoveBillOf(planet, catalog) : undefined} itemName={itemName} />
            {!moveCheck?.ok ? <p className="app-warn">{pt('reason.' + (moveCheck && !moveCheck.ok ? moveCheck.reason : 'not-ready'))}</p> : null}
            <button type="button" className="app-btn is-primary" data-wheel-confirm="move" disabled={!moveCheck?.ok} onClick={() => { if (wheel.target !== undefined) wheelCommand('move', wheel.planetId, wheel.index, wheel.target) }}><MoveRight size={18} />{pt('confirm')}</button></> : null}
      </PlanetRadialMenu> : null}
    </div>
  </div>
}
