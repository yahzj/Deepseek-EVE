import { useState } from 'react'
import { Ban, Factory, Pause, Play } from 'lucide-react'
import type { StationRefiningAction, stationRefiningView } from '../../../../../../../packages/core/src/playerStation/index'
import type { PlayerStationText } from './PlayerStationPanel'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'

interface RefiningPanelProps {
  view: ReturnType<typeof stationRefiningView>
  facilities: readonly number[]
  people: readonly { index: number; available: boolean }[]
  recipes: readonly { id: string; name: string; batchUnits: number; cycleMs: number }[]
  text: PlayerStationText
  itemName(id: string): string
  onCommand(action: StationRefiningAction): void
}

// 设备/人员/原料是派工输入，运行账与阻塞原因优先展示；沿用站点令牌与进度样式。
export function PlayerStationRefiningPanel({ view, facilities, people, recipes, text, itemName, onCommand }: RefiningPanelProps) {
  const [cell, setCell] = useState(3)
  const [person, setPerson] = useState(0)
  const [itemId, setItemId] = useState('ore-veldspar')
  const selectedCell = facilities.includes(cell) ? cell : facilities[0]
  const selectedPerson = people.some(entry => entry.index === person) ? person : people[0]?.index
  const recipe = recipes.find(entry => entry.id === itemId) ?? recipes[0]
  const selectedRun = view.runs.find(run => run.cellIndex === selectedCell)
  return <section className="app-player-station app-player-station-refining" aria-label={text('ui.playerStation.refining.title')}>
    <header className="app-player-station-head">
      <h3 className="app-player-station-title"><Factory size={17} aria-hidden="true" />{text('ui.playerStation.refining.title')}</h3>
      <span className="app-dim">{text('ui.playerStation.refining.facilityCount', { p1: facilities.length })}</span>
    </header>
    {facilities.length === 0 ? <p className="app-player-station-notice app-dim">{text('ui.playerStation.refining.noFacility')}</p> : <>
      <div className="app-player-station-actions">
        <label className="app-player-station-field">{text('ui.playerStation.refining.facility')}
          <select aria-label={text('ui.playerStation.refining.facility')} value={selectedCell} onChange={event => setCell(Number(event.target.value))}>
            {facilities.map(index => <option key={index} value={index}>{text('ui.playerStation.cell', { p1: index + 1 })}</option>)}
          </select>
        </label>
        <label className="app-player-station-field">{text('ui.playerStation.refining.person')}
          <select aria-label={text('ui.playerStation.refining.person')} value={selectedPerson ?? ''} onChange={event => setPerson(Number(event.target.value))}>
            {people.length === 0 && <option value="">{text('ui.playerStation.refining.noPerson')}</option>}
            {people.map(entry => <option key={entry.index} value={entry.index} disabled={!entry.available}>
              {text('ui.playerStation.populationNumber', { p1: entry.index + 1 })}{entry.available ? '' : ` · ${text('ui.playerStation.refining.occupied')}`}
            </option>)}
          </select>
        </label>
        <label className="app-player-station-field">{text('ui.playerStation.refining.material')}
          <select aria-label={text('ui.playerStation.refining.material')} value={recipe?.id ?? ''} onChange={event => setItemId(event.target.value)}>
            {recipes.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <button type="button" className="app-btn is-primary" disabled={selectedCell === undefined || selectedPerson === undefined || !recipe
          || !people.find(entry => entry.index === selectedPerson)?.available || selectedRun?.personIndex !== undefined}
          onClick={() => selectedCell !== undefined && selectedPerson !== undefined && recipe && onCommand({ kind: 'assign', cellIndex: selectedCell, personIndex: selectedPerson, itemId: recipe.id })}>
          <Play size={14} aria-hidden="true" />{text('ui.playerStation.refining.assign')}
        </button>
      </div>
      {recipe && <p className="app-dim app-player-station-notice">{text('ui.playerStation.refining.batchSpec', {
        p1: recipe.batchUnits, p2: NUMBER.format(recipe.cycleMs / 1000),
      })}</p>}
    </>}
    {view.runs.map(run => <div key={run.cellIndex} className="app-player-station-project" data-refining-cell={run.cellIndex}>
      <div className="app-player-station-project-head">
        <strong>{text('ui.playerStation.cell', { p1: run.cellIndex + 1 })} · {itemName(run.itemId)}</strong>
        <span data-refining-status className={run.blocked && run.personIndex !== undefined ? 'is-missing' : 'app-dim'}>
          {text(`ui.playerStation.refining.status.${run.blocked ?? 'running'}`)}
        </span>
      </div>
      <div className="app-player-station-project-head">
        <span>{run.personIndex === undefined ? text('ui.playerStation.refining.unassigned') : text('ui.playerStation.populationNumber', { p1: run.personIndex + 1 })}</span>
        <span>{text('ui.playerStation.refining.batches', { p1: run.batchesDone })}</span>
      </div>
      <progress value={run.progressMs} max={run.cycleMs} aria-label={text('ui.playerStation.refining.progress')} />
      <div className="app-player-station-project-head app-dim">
        <span>{text('ui.playerStation.refining.input', { p1: NUMBER.format(run.available), p2: run.batchUnits })}</span>
        <span>{text('ui.playerStation.refining.secondsRemaining', { p1: NUMBER.format(run.remainingMs / 1000) })}</span>
      </div>
      <dl className="app-player-station-stats">{Object.entries(run.output).map(([id, n]) => <div key={id}><dt>{itemName(id)}</dt><dd>+{NUMBER.format(n)}</dd></div>)}</dl>
      {run.personIndex !== undefined && <div className="app-player-station-actions">
        <button type="button" className="app-btn" onClick={() => onCommand({ kind: run.paused ? 'resume' : 'pause', cellIndex: run.cellIndex })}>
          {run.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(run.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}
        </button>
        <button type="button" className="app-btn is-warn" onClick={() => onCommand({ kind: 'stop', cellIndex: run.cellIndex })}>
          <Ban size={14} aria-hidden="true" />{text('ui.playerStation.refining.stop')}
        </button>
      </div>}
    </div>)}
  </section>
}
