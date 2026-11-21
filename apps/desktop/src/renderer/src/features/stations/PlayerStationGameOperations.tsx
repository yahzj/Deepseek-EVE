import { useState } from 'react'
import { Factory, GraduationCap, Hammer, Pause, Play, Radar, X } from 'lucide-react'
import type { PlayerStationGameRuntime } from '../../../../../../../packages/core/src/playerStation/gameRuntime'
import { STATION_COURSE_MS } from '../../../../../../../packages/core/src/playerStation/training'
import type { StationQualification } from '../../../../../../../packages/core/src/playerStation/training'
import { developmentPower } from '../../../../../../../packages/core/src/playerStation/development'
import type { PlayerStationText } from './PlayerStationPanel'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'
import { stationGameLabel } from './PlayerStationGameSupport'
import type { StationGameCommand } from './PlayerStationGameSupport'

interface OperationsProps { runtime: PlayerStationGameRuntime; text: PlayerStationText; onCommand: StationGameCommand }

export function PlayerStationGameDevelopment({ runtime, text, onCommand }: OperationsProps) {
  const view = runtime.developmentView()
  const constructionDemand = developmentPower(runtime.g.development, runtime.developmentHost).demand
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.development.title')}>
    <h3 className="app-player-station-title"><Hammer size={17} aria-hidden="true" />{text('ui.playerStationGame.development.title')}</h3>
    <span className="app-dim">{text('ui.playerStationGame.development.summary', { p1: runtime.view().cellCount, p2: view.availableEngineers.length })}</span>
    {view.options.map(option => {
      const spec = option.spec
      const occupied = view.projects.some(project => option.kind === 'expand' ? project.kind === 'expand' : project.cellIndex === option.cellIndex)
      const blocked = !runtime.g.station.built ? 'body-required' : occupied ? 'busy'
        : option.kind.endsWith('upgrade') && runtime.g.development.damaged.includes(option.cellIndex!) ? 'facility'
        : spec?.technology && !runtime.developmentHost.technology(spec.technology) ? 'research'
        : spec && (view.availableEngineers.length < spec.engineers || spec.engineers > 0 && !runtime.developmentHost.ready()) ? 'engineer'
        : spec && runtime.developmentHost.availablePower() - constructionDemand < spec.power ? 'power'
        : Object.entries(option.bill ?? {}).some(([id, n]) => runtime.host.available(id) < n) ? 'materials' : undefined
      return <div className="app-player-station-project" key={`${option.kind}-${option.cellIndex}`}>
      <div className="app-player-station-project-head"><strong>{text(`ui.playerStationGame.development.${option.kind}`)}
        {option.cellIndex !== undefined && <> · {text('ui.playerStation.cell', { p1: option.cellIndex + 1 })}</>}</strong>
        <button type="button" className="app-btn" disabled={!!blocked || !spec}
          onClick={() => onCommand('development', option.kind === 'expand' ? { kind: 'expand' } : { kind: option.kind, cellIndex: option.cellIndex! })}>
          <Hammer size={14} aria-hidden="true" />{text('ui.playerStationGame.development.start')}</button>
      </div>
      {blocked && <span className="app-dim">{stationGameLabel(text, blocked)}</span>}
      {option.spec && <span className="app-dim">{text('ui.playerStationGame.development.spec', { p1: option.spec.durationMs / 60_000, p2: option.spec.engineers, p3: option.spec.power })}</span>}
      <dl className="app-player-station-recovery-list">{Object.entries(option.bill ?? {}).map(([itemId, amount]) => <div key={itemId}>
        <dt>{runtime.host.itemName(itemId)}</dt><dd>{text('ui.playerStationGame.materialAvailable', { p1: NUMBER.format(amount), p2: NUMBER.format(runtime.host.available(itemId)) })}</dd>
      </div>)}</dl>
    </div>})}
    {view.projects.map((project, index) => <div className="app-player-station-project" key={`${project.kind}-${project.cellIndex}`}>
      <strong>{text(`ui.playerStationGame.development.${project.kind}`)}{project.cellIndex !== undefined && <> · {text('ui.playerStation.cell', { p1: project.cellIndex + 1 })}</>}
        {' · '}{text(project.paused ? 'ui.playerStation.paused' : view.running.includes(index) ? 'ui.playerStation.building' : 'ui.playerStationGame.development.waiting')}</strong>
      <span className="app-dim">{text('ui.playerStationGame.development.engineers', { p1: project.engineerIndices.map(person => person + 1).join(' / ') || text('ui.playerStationGame.none') })}</span>
      <span>{text('ui.playerStation.progressValue', { p1: NUMBER.format(project.progressMs / 60_000), p2: project.durationMs / 60_000 })}</span>
      <progress value={project.progressMs} max={project.durationMs} aria-label={text('ui.playerStation.progressLabel')} />
      <div className="app-player-station-actions">
        <button type="button" className="app-btn" onClick={() => onCommand('development', { kind: project.paused ? 'resume' : 'pause', projectIndex: index })}>
          {project.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(project.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}</button>
        <button type="button" className="app-btn is-warn" onClick={() => onCommand('development', { kind: 'cancel', projectIndex: index })}>
          <X size={14} aria-hidden="true" />{text('ui.playerStationGame.development.cancel')}</button>
      </div>
    </div>)}
    {view.options.length === 0 && view.projects.length === 0 && <span className="app-dim">{text('ui.playerStationGame.development.empty')}</span>}
  </section>
}

export function PlayerStationGameManufacturing({ runtime, text, onCommand }: OperationsProps) {
  const [person, setPerson] = useState(-1), [factory, setFactory] = useState(0), [blueprint, setBlueprint] = useState('')
  const [batches, setBatches] = useState(1)
  const view = runtime.manufacturingView(), items = runtime.manufacturingItems()
  const factories = runtime.view().cells.filter(cell => cell.kind === 'manufacturing')
  const factoryIndex = factories.find(cell => cell.cellIndex === factory)?.cellIndex ?? factories[0]?.cellIndex
  const residents = runtime.trainingHost.residents()
  const personIndex = residents.includes(person) ? person : residents.find(index => runtime.manufacturingHost.personAvailable(index)) ?? residents[0]
  const recipe = items.find(item => item.blueprintId === blueprint) ?? items[0]
  const occupied = view.runs.some(run => run.cellIndex === factoryIndex && run.personIndex !== undefined)
  const available = personIndex !== undefined && runtime.manufacturingHost.personAvailable(personIndex)
  const validBatches = Number.isSafeInteger(batches) && batches >= 1 && batches <= 1000
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.manufacturing.title')}>
    <h3 className="app-player-station-title"><Factory size={17} aria-hidden="true" />{text('ui.playerStationGame.manufacturing.title')}</h3>
    {!factories.length ? <span className="app-dim">{text('ui.playerStationGame.manufacturing.noFacility')}</span> : <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStationGame.person')}
        <select value={personIndex ?? ''} onChange={event => setPerson(Number(event.target.value))}>
          {!residents.length && <option value="">{text('ui.playerStation.refining.noPerson')}</option>}
          {residents.map(index => <option key={index} value={index} disabled={!runtime.manufacturingHost.personAvailable(index)}>{text('ui.playerStation.populationNumber', { p1: index + 1 })}</option>)}
        </select></label>
      <label className="app-player-station-field">{text('ui.playerStationGame.manufacturing.facility')}
        <select value={factoryIndex ?? ''} onChange={event => setFactory(Number(event.target.value))}>{factories.map(cell => <option key={cell.cellIndex} value={cell.cellIndex}>{text('ui.playerStation.cell', { p1: cell.cellIndex + 1 })}</option>)}</select></label>
      <label className="app-player-station-field">{text('ui.playerStationGame.manufacturing.recipe')}
        <select value={recipe?.blueprintId ?? ''} onChange={event => setBlueprint(event.target.value)}>
          {!items.length && <option value="">{text('ui.playerStationGame.status.recipe')}</option>}
          {items.map(item => <option key={item.blueprintId} value={item.blueprintId}>{item.name}</option>)}
        </select></label>
      <label className="app-player-station-field">{text('ui.playerStationGame.manufacturing.batches')}
        <input type="number" min={1} max={1000} step={1} value={Number.isNaN(batches) ? '' : batches} onChange={event => setBatches(event.target.valueAsNumber)} /></label>
      <button type="button" className="app-btn" disabled={!available || factoryIndex === undefined || !recipe || !validBatches || occupied}
        onClick={() => recipe && personIndex !== undefined && factoryIndex !== undefined && onCommand('manufacturing', { kind: 'assign', cellIndex: factoryIndex, personIndex, blueprintId: recipe.blueprintId, batches })}>
        <Play size={14} aria-hidden="true" />{text('ui.playerStationGame.manufacturing.assign')}</button>
    </div>}
    {recipe && (() => {
      const spec = runtime.manufacturingHost.recipe(recipe.blueprintId)
      return spec && <div className="app-dim">
        <span>{text('ui.playerStationGame.manufacturing.cycle', { p1: NUMBER.format(spec.cycleMs / 1000) })}</span>
        <dl className="app-player-station-recovery-list">{Object.entries(spec.input).map(([itemId, amount]) => <div key={itemId}>
          <dt>{runtime.host.itemName(itemId)}</dt><dd>{text('ui.playerStationGame.materialAvailable', { p1: NUMBER.format(amount), p2: NUMBER.format(runtime.host.available(itemId)) })}</dd>
        </div>)}</dl>
      </div>
    })()}
    {view.runs.map(run => <div className="app-player-station-project" key={run.cellIndex}>
      <strong>{text('ui.playerStation.cell', { p1: run.cellIndex + 1 })} · {items.find(item => item.blueprintId === run.blueprintId)?.name ?? text('ui.playerStationGame.manufacturing.title')}</strong>
      <span>{text('ui.playerStationGame.manufacturing.progress', { p1: run.batchesDone, p2: run.batches })} · {run.blocked ? stationGameLabel(text, run.blocked) : text('ui.playerStationGame.manufacturing.running')}</span>
      {run.personIndex !== undefined && <span className="app-dim">{text('ui.playerStation.populationNumber', { p1: run.personIndex + 1 })}</span>}
      <progress value={run.progressMs} max={run.cycleMs} aria-label={text('ui.playerStationGame.manufacturing.title')} />
      {run.personIndex !== undefined && <div className="app-player-station-actions">
        <button type="button" className="app-btn" onClick={() => onCommand('manufacturing', { kind: run.paused ? 'resume' : 'pause', cellIndex: run.cellIndex })}>
          {run.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(run.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}</button>
        <button type="button" className="app-btn" onClick={() => onCommand('manufacturing', { kind: 'stop', cellIndex: run.cellIndex })}>
          <X size={14} aria-hidden="true" />{text('ui.playerStationGame.manufacturing.stop')}</button>
      </div>}
    </div>)}
  </section>
}

export function PlayerStationGameAcademy({ runtime, text, onCommand }: OperationsProps) {
  const [person, setPerson] = useState(-1), [center, setCenter] = useState(0)
  const [course, setCourse] = useState<StationQualification>('engineer')
  const view = runtime.academyView(), active = view.active
  const centers = runtime.view().cells.filter(cell => cell.kind === 'training')
  const centerIndex = centers.find(cell => cell.cellIndex === center)?.cellIndex ?? centers[0]?.cellIndex
  const residents = runtime.trainingHost.residents()
  const personIndex = residents.includes(person) ? person : residents.find(index => runtime.academyHost.candidate(index)) ?? residents[0]
  const crewSeatBusy = runtime.g.crew.teams.some(team => team.activity === 'training' || team.activity === 'qualifying')
  const coursePlansFull = runtime.g.training.qualifications.filter(Boolean).length + runtime.g.training.queue.length
    + (runtime.g.training.active ? 1 : 0) >= runtime.g.population.people.length
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.academy.title')}>
    <h3 className="app-player-station-title"><GraduationCap size={17} aria-hidden="true" />{text('ui.playerStationGame.academy.title')}</h3>
    {!centers.length ? <span className="app-dim">{text('ui.playerStationGame.academy.noFacility')}</span> : active ? <>
      <strong>{text('ui.playerStation.populationNumber', { p1: active.personIndex + 1 })} · {text(`ui.playerStation.training.course.${active.course}`)}</strong>
      <span className="app-dim">{view.blocked ? stationGameLabel(text, view.blocked) : text('ui.playerStation.training.running')}</span>
      <progress value={active.progressMs} max={STATION_COURSE_MS} aria-label={text('ui.playerStation.training.progress')} />
      <span>{text('ui.playerStation.progressValue', { p1: NUMBER.format(active.progressMs / 60_000), p2: STATION_COURSE_MS / 60_000 })}</span>
      <div className="app-player-station-actions">
        <button type="button" className="app-btn" onClick={() => onCommand('academy', { kind: active.paused ? 'resume' : 'pause' })}>
          {active.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(active.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}</button>
        <button type="button" className="app-btn" onClick={() => onCommand('academy', { kind: 'release' })}><X size={14} aria-hidden="true" />{text('ui.playerStationGame.academy.release')}</button>
      </div>
    </> : <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStationGame.person')}
        <select value={personIndex ?? ''} onChange={event => setPerson(Number(event.target.value))}>
          {!residents.length && <option value="">{text('ui.playerStation.refining.noPerson')}</option>}
          {residents.map(index => <option key={index} value={index} disabled={!runtime.academyHost.candidate(index)}>{text('ui.playerStation.populationNumber', { p1: index + 1 })}</option>)}
        </select></label>
      <label className="app-player-station-field">{text('ui.playerStationGame.academy.center')}
        <select value={centerIndex ?? ''} onChange={event => setCenter(Number(event.target.value))}>{centers.map(cell => <option key={cell.cellIndex} value={cell.cellIndex}>{text('ui.playerStation.cell', { p1: cell.cellIndex + 1 })}</option>)}</select></label>
      <label className="app-player-station-field">{text('ui.playerStation.training.course')}
        <select value={course} onChange={event => setCourse(event.target.value as StationQualification)}>{(['engineer', 'researcher'] as const).map(key => <option key={key} value={key}>{text(`ui.playerStation.training.course.${key}`)}</option>)}</select></label>
      <button type="button" className="app-btn" disabled={personIndex === undefined || centerIndex === undefined || !runtime.academyHost.candidate(personIndex) || crewSeatBusy || coursePlansFull}
        onClick={() => personIndex !== undefined && centerIndex !== undefined && onCommand('academy', { kind: 'assign', cellIndex: centerIndex, personIndex, course })}>
        <Play size={14} aria-hidden="true" />{text('ui.playerStationGame.academy.assign')}</button>
    </div>}
  </section>
}

export function PlayerStationGameWarning({ runtime, text }: Pick<OperationsProps, 'runtime' | 'text'>) {
  const warning = runtime.warningView()
  const arrivals = [
    ...(runtime.g.population.trip && ['inbound', 'empty-home'].includes(runtime.g.population.trip.phase)
      ? [{ shipId: runtime.g.population.trip.shipId, remainingMs: runtime.g.population.trip.positionMs }] : []),
    ...runtime.miningView().runs.filter(run => run.phase === 'returning').map(run => ({ shipId: run.shipId, remainingMs: run.remainingMs })),
    ...(runtime.g.security.mission?.phase === 'returning' ? runtime.g.security.mission.shipIds.map(shipId => ({ shipId, remainingMs: runtime.g.security.mission!.durationMs - runtime.g.security.mission!.progressMs })) : []),
    ...(runtime.g.delivery ? [{ shipId: runtime.g.delivery.shipId, remainingMs: runtime.g.delivery.durationMs - runtime.g.delivery.progressMs }] : []),
  ]
  const ships = runtime.shipsView()
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.warning.title')}>
    <h3 className="app-player-station-title"><Radar size={17} aria-hidden="true" />{text('ui.playerStationGame.warning.title')}</h3>
    <span className="app-dim">{text(!warning.online ? 'ui.playerStationGame.warning.offline' : arrivals.length ? 'ui.playerStationGame.warning.detected' : 'ui.playerStationGame.warning.empty')}</span>
    {warning.online && arrivals.map(arrival => <span key={arrival.shipId}>{text('ui.playerStationGame.warning.arrival', { p1: ships.find(ship => ship.id === arrival.shipId)?.name ?? arrival.shipId, p2: NUMBER.format(arrival.remainingMs / 1000) })}</span>)}
  </section>
}
