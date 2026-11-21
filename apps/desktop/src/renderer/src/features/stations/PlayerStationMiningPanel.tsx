import { useState } from 'react'
import { Ban, Pause, Pickaxe, Play } from 'lucide-react'
import type { StationMiningAction, stationMiningView } from '../../../../../../../packages/core/src/playerStation/index'
import type { PlayerStationText } from './PlayerStationPanel'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'

interface MiningPanelProps {
  view: ReturnType<typeof stationMiningView>
  ships: readonly { id: string; name: string; available: boolean; capacityM3: number }[]
  people: readonly { index: number; available: boolean }[]
  belts: readonly { id: string; name: string }[]
  text: PlayerStationText
  itemName(id: string): string
  onCommand(action: StationMiningAction): void
}

// 船只/人员/采集点为明确派工输入，货物始终标明在船或已卸货，不把在途量当仓库量。
export function PlayerStationMiningPanel({ view, ships, people, belts, text, itemName, onCommand }: MiningPanelProps) {
  const [shipId, setShipId] = useState(ships[0]?.id ?? '')
  const [personIndex, setPersonIndex] = useState(0)
  const [beltId, setBeltId] = useState(belts[0]?.id ?? '')
  const ship = ships.find(entry => entry.id === shipId) ?? ships[0]
  const person = people.find(entry => entry.index === personIndex) ?? people[0]
  const belt = belts.find(entry => entry.id === beltId) ?? belts[0]
  return <section className="app-player-station app-player-station-mining" aria-label={text('ui.playerStation.mining.title')}>
    <header className="app-player-station-head">
      <h3 className="app-player-station-title"><Pickaxe size={17} aria-hidden="true" />{text('ui.playerStation.mining.title')}</h3>
      <span className="app-dim">{text('ui.playerStation.mining.tasks', { p1: view.runs.length })}</span>
    </header>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStation.mining.ship')}
        <select aria-label={text('ui.playerStation.mining.ship')} value={ship?.id ?? ''} onChange={event => setShipId(event.target.value)}>
          {ships.map(entry => <option key={entry.id} value={entry.id} disabled={!entry.available}>
            {entry.name} · {NUMBER.format(entry.capacityM3)} m³{entry.available ? '' : ` · ${text('ui.playerStation.refining.occupied')}`}
          </option>)}
        </select>
      </label>
      <label className="app-player-station-field">{text('ui.playerStation.mining.person')}
        <select aria-label={text('ui.playerStation.mining.person')} value={person?.index ?? ''} onChange={event => setPersonIndex(Number(event.target.value))}>
          {people.length === 0 && <option value="">{text('ui.playerStation.refining.noPerson')}</option>}
          {people.map(entry => <option key={entry.index} value={entry.index} disabled={!entry.available}>
            {text('ui.playerStation.populationNumber', { p1: entry.index + 1 })}{entry.available ? '' : ` · ${text('ui.playerStation.refining.occupied')}`}
          </option>)}
        </select>
      </label>
      <label className="app-player-station-field">{text('ui.playerStation.mining.belt')}
        <select aria-label={text('ui.playerStation.mining.belt')} value={belt?.id ?? ''} onChange={event => setBeltId(event.target.value)}>
          {belts.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
      </label>
      <button type="button" className="app-btn is-primary" disabled={!ship?.available || !person?.available || !belt}
        onClick={() => ship && person && belt && onCommand({ kind: 'assign', shipId: ship.id, personIndex: person.index, beltId: belt.id })}>
        <Play size={14} aria-hidden="true" />{text('ui.playerStation.mining.assign')}
      </button>
    </div>
    {view.runs.map(run => <div key={run.shipId} className="app-player-station-project" data-mining-ship={run.shipId}>
      <div className="app-player-station-project-head">
        <strong>{ships.find(entry => entry.id === run.shipId)?.name ?? run.shipId} · {belts.find(entry => entry.id === run.beltId)?.name ?? run.beltId}</strong>
        <span data-mining-phase={run.phase} className={run.blocked ? 'is-missing' : 'app-dim'}>
          {text(run.blocked ? `ui.playerStation.mining.blocked.${run.blocked}` : `ui.playerStation.mining.phase.${run.phase}`)}
        </span>
      </div>
      <div className="app-player-station-project-head">
        <span>{text('ui.playerStation.populationNumber', { p1: run.personIndex + 1 })}</span>
        <span>{text('ui.playerStation.mining.remaining', { p1: NUMBER.format(run.remainingMs / 1000) })}</span>
      </div>
      <progress value={run.progressMs} max={run.durationMs} aria-label={text('ui.playerStation.mining.progress')} />
      {run.params && <p className="app-player-station-notice app-dim">{text('ui.playerStation.mining.cycle', {
        p1: run.params.unitsPerCycle, p2: NUMBER.format(run.params.cycleMs / 1000), p3: run.tripsDone,
      })}</p>}
      <h4 className="app-player-station-label">{text('ui.playerStation.mining.cargo')}</h4>
      {Object.keys(run.cargo).length > 0 ? <dl className="app-player-station-stats">
        {Object.entries(run.cargo).map(([id, n]) => <div key={id}><dt>{itemName(id)}</dt><dd>{NUMBER.format(n)}</dd></div>)}
      </dl> : <span className="app-dim">{text('ui.playerStation.mining.emptyCargo')}</span>}
      {run.stopping && <p className="app-player-station-notice is-missing">{text('ui.playerStation.mining.stopping')}</p>}
      <div className="app-player-station-actions">
        {run.phase !== 'returning' && <button type="button" className="app-btn" onClick={() => onCommand({ kind: run.paused ? 'resume' : 'pause', shipId: run.shipId })}>
          {run.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(run.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}
        </button>}
        <button type="button" className="app-btn is-warn" disabled={run.stopping} onClick={() => onCommand({ kind: 'stop', shipId: run.shipId })}>
          <Ban size={14} aria-hidden="true" />{text('ui.playerStation.mining.stop')}
        </button>
      </div>
    </div>)}
  </section>
}
