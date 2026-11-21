import { useState } from 'react'
import { FlaskConical, Pause, Play, UserMinus, Plus, ArrowUp, X } from 'lucide-react'
import type { StationResearchAction, stationResearchView } from '../../../../../../../packages/core/src/playerStation/index'
import type { PlayerStationText } from './PlayerStationPanel'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'

interface ResearchPanelProps {
  view: ReturnType<typeof stationResearchView>
  facilities: readonly number[]
  people: readonly { index: number; available: boolean }[]
  text: PlayerStationText
  onCommand(action: StationResearchAction): void
}

export function PlayerStationResearchPanel({ view, facilities, people, text, onCommand }: ResearchPanelProps) {
  const [cell, setCell] = useState(4)
  const [person, setPerson] = useState(1)
  const [projectId, setProjectId] = useState(view.projectId)
  const selectedCell = facilities.includes(cell) ? cell : facilities[0]
  const selectedPerson = people.some(entry => entry.index === person) ? person : people[0]?.index
  return <section className="app-player-station app-player-station-research" aria-label={text('ui.playerStation.science.title')}>
    <header className="app-player-station-head">
      <h3 className="app-player-station-title"><FlaskConical size={17} aria-hidden="true" />{text('ui.playerStation.science.title')}</h3>
      <span data-research-status className="app-dim">{text(`ui.playerStation.science.status.${view.blocked ?? 'running'}`)}</span>
    </header>
    <strong>{text(`ui.playerStation.science.name.${view.projectId}`)}</strong>
    <p className="app-player-station-notice app-dim">{text(`ui.playerStation.science.result.${view.projectId}`)}</p>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStation.science.target')}
        <select aria-label={text('ui.playerStation.science.target')} value={projectId} onChange={event => setProjectId(event.target.value as typeof projectId)}>
          {view.catalog.map(project => <option key={project.id} value={project.id} disabled={project.completed}>
            {text(`ui.playerStation.science.name.${project.id}`)} · {project.completed ? text('ui.playerStation.science.status.completed') : `${project.durationMs / 60_000} min`}
          </option>)}
        </select>
      </label>
      <button type="button" className="app-btn" disabled={view.catalog.find(project => project.id === projectId)?.completed || projectId === view.projectId || view.queue.includes(projectId)}
        onClick={() => onCommand({ kind: 'enqueue', projectId })}><Plus size={14} aria-hidden="true" />{text('ui.playerStation.science.enqueue')}</button>
    </div>
    <progress value={view.progressMs} max={view.durationMs} aria-label={text('ui.playerStation.science.progress')} />
    <div className="app-player-station-project-head app-dim">
      <span>{text('ui.playerStation.science.minutes', { p1: NUMBER.format(view.progressMs / 60_000), p2: view.durationMs / 60_000 })}</span>
      {view.assignment && <span>{text('ui.playerStation.cell', { p1: view.assignment.cellIndex + 1 })} · {text('ui.playerStation.populationNumber', { p1: view.assignment.personIndex + 1 })}</span>}
    </div>
    {view.assignment ? <div className="app-player-station-actions">
      <button type="button" className="app-btn" onClick={() => onCommand({ kind: view.assignment!.paused ? 'resume' : 'pause' })}>
        {view.assignment.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(view.assignment.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}
      </button>
      <button type="button" className="app-btn is-warn" onClick={() => onCommand({ kind: 'release' })}>
        <UserMinus size={14} aria-hidden="true" />{text('ui.playerStation.science.release')}
      </button>
    </div> : <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStation.science.facility')}
        <select aria-label={text('ui.playerStation.science.facility')} value={selectedCell ?? ''} onChange={event => setCell(Number(event.target.value))}>
          {facilities.length === 0 && <option value="">{text('ui.playerStation.science.noFacility')}</option>}
          {facilities.map(index => <option key={index} value={index}>{text('ui.playerStation.cell', { p1: index + 1 })}</option>)}
        </select>
      </label>
      <label className="app-player-station-field">{text('ui.playerStation.science.person')}
        <select aria-label={text('ui.playerStation.science.person')} value={selectedPerson ?? ''} onChange={event => setPerson(Number(event.target.value))}>
          {people.length === 0 && <option value="">{text('ui.playerStation.science.noPerson')}</option>}
          {people.map(entry => <option key={entry.index} value={entry.index} disabled={!entry.available}>
            {text('ui.playerStation.populationNumber', { p1: entry.index + 1 })}{entry.available ? '' : ` · ${text('ui.playerStation.refining.occupied')}`}
          </option>)}
        </select>
      </label>
      <button type="button" className="app-btn is-primary" disabled={selectedCell === undefined || selectedPerson === undefined || !people.find(entry => entry.index === selectedPerson)?.available || view.catalog.find(project => project.id === projectId)?.completed}
        onClick={() => selectedCell !== undefined && selectedPerson !== undefined && onCommand({ kind: 'assign', cellIndex: selectedCell, personIndex: selectedPerson, projectId })}>
        <Play size={14} aria-hidden="true" />{text('ui.playerStation.science.assign')}
      </button>
    </div>}
    {view.queue.length > 0 && <ol>{view.queue.map((id, index) => <li key={id} className="app-player-station-project-head">
      <span>{text(`ui.playerStation.science.name.${id}`)}</span>
      <button type="button" className="app-btn" title={text('ui.playerStation.science.move')} disabled={index === 0} onClick={() => onCommand({ kind: 'move', fromIndex: index, toIndex: index - 1 })}><ArrowUp size={14} /></button>
      <button type="button" className="app-btn" title={text('ui.playerStation.science.remove')} onClick={() => onCommand({ kind: 'remove', index })}><X size={14} /></button>
    </li>)}</ol>}
    <div className="app-dim">{view.catalog.filter(project => project.completed).map(project => text(`ui.playerStation.science.name.${project.id}`)).join(' · ')}</div>
  </section>
}
