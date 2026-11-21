import { Ban, Play, Users } from 'lucide-react'
import { useState } from 'react'
import type { PopulationAction, stationPopulationView, stationTrainingView } from '../../../../../../../packages/core/src/playerStation/index'
import type { PlayerStationText } from './PlayerStationPanel'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'

export interface StationPopulationPanelProps {
  view: ReturnType<typeof stationPopulationView>
  training?: ReturnType<typeof stationTrainingView>
  construction?: readonly { engineerIndex?: number; cellIndex?: number }[]
  refining?: readonly { personIndex?: number; cellIndex: number }[]
  mining?: readonly { personIndex: number; phase: string }[]
  research?: { personIndex: number; cellIndex: number }
  additionalOccupations?: readonly { personIndex: number; label: string }[]
  ships: readonly { id: string; name: string; available: boolean; freeM3: number; location: 'home' | 'source' | 'elsewhere' }[]
  text: PlayerStationText
  onCommand(action: PopulationAction): void
}

export function PlayerStationPopulationPanel({ view, training, construction = [], refining = [], mining = [], research, additionalOccupations = [], ships, text, onCommand }: StationPopulationPanelProps) {
  const [shipId, setShipId] = useState(ships[0]?.id ?? '')
  const [count, setCount] = useState(1)
  const trip = view.trip
  const selectedShip = ships.find(ship => ship.id === shipId)
  const remaining = view.dormant + view.protected
  return <section className="app-player-station app-player-station-population" aria-label={text('ui.playerStation.populationTitle')}>
    <header className="app-player-station-head">
      <h3 className="app-player-station-title"><Users size={17} aria-hidden="true" />{text('ui.playerStation.populationTitle')}</h3>
      <span className="app-dim">{text(view.sourceKnown ? 'ui.playerStation.sourceKnown' : 'ui.playerStation.sourceUnknown')}</span>
    </header>
    <dl className="app-player-station-stats">
      {(['residents', 'reserved', 'dormant', 'protected', 'capacity'] as const).map(key => <div key={key}>
        <dt>{text(`ui.playerStation.population.${key}`)}</dt><dd>{view[key]}</dd>
      </div>)}
    </dl>
    {selectedShip && <span className="app-dim">{selectedShip.name} · {text(`ui.playerStation.shipLocation.${selectedShip.location}`)} · {text(selectedShip.available ? 'ui.playerStation.shipIdle' : 'ui.playerStation.shipOccupied')}</span>}
    {!view.plan ? <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStation.transferShip')}
        <select aria-label={text('ui.playerStation.transferShip')} value={shipId} onChange={event => setShipId(event.target.value)}>
          {ships.map(ship => <option key={ship.id} value={ship.id}>{ship.name} · {NUMBER.format(ship.freeM3)} m³</option>)}
        </select>
      </label>
      <label className="app-player-station-field">{text('ui.playerStation.transferCount')}
        <input type="number" min={1} max={Math.max(1, remaining)} step={1} value={count}
          aria-label={text('ui.playerStation.transferCount')} onChange={event => {
            const next = event.target.valueAsNumber
            if (Number.isInteger(next) && next >= 1 && next <= 6) setCount(next)
          }} />
      </label>
      <button type="button" className="app-btn is-primary" disabled={!view.sourceKnown || remaining === 0 || !shipId}
        onClick={() => onCommand({ kind: 'start', shipId, count: Math.min(count, remaining) })}>
        <Play size={15} aria-hidden="true" />{text('ui.playerStation.startTransfer')}
      </button>
    </div> : <>
      <div className="app-player-station-project-head">
        <span>{text('ui.playerStation.transferRemaining', { p1: view.plan.remaining })}</span>
        <button type="button" className="app-btn is-warn" disabled={view.plan.stopped} onClick={() => onCommand({ kind: 'stop' })}>
          <Ban size={15} aria-hidden="true" />{text('ui.playerStation.stopTransfer')}
        </button>
      </div>
      {trip ? <div className="app-player-station-project" data-population-phase={trip.phase}>
        <div className="app-player-station-project-head">
          <strong>{text(`ui.playerStation.transferPhase.${trip.phase}`)}</strong>
          <span>{text('ui.playerStation.transferPhaseRemaining', { p1: NUMBER.format(trip.remainingMs / 60_000) })}</span>
        </div>
        <span className="app-dim">{text('ui.playerStation.transferLoad', { p1: trip.slots, p2: trip.slots * 100 })}</span>
      </div> : <p className="app-player-station-notice app-dim">{text(`ui.playerStation.transferWait.${view.wait ?? 'facilities'}`)}</p>}
      {view.plan.stopped && <p className="app-player-station-notice is-missing">{text('ui.playerStation.transferStopping')}</p>}
      {trip?.safety && <p className="app-player-station-notice is-missing">{text('ui.playerStation.transferSafety')}</p>}
    </>}
    {view.sourceKnown && <table className="app-player-station-bill app-player-station-people">
      <thead><tr><th scope="col">{text('ui.playerStation.populationUnit')}</th><th scope="col">{text('ui.playerStation.populationStatus')}</th></tr></thead>
      <tbody>{view.people.map((person, index) => <tr key={index}><th scope="row">{text('ui.playerStation.populationNumber', { p1: index + 1 })}</th>
        <td data-person-status={person.status} data-person-qualification={training?.qualifications[index] ?? undefined}>
          {person.status === 'resident' && additionalOccupations.some(entry => entry.personIndex === index)
            ? additionalOccupations.find(entry => entry.personIndex === index)!.label
            : person.status === 'resident' && research?.personIndex === index
            ? text('ui.playerStation.science.personOccupied', { p1: research.cellIndex + 1 })
            : person.status === 'resident' && construction.some(project => project.engineerIndex === index)
            ? text('ui.playerStation.constructionOccupied', { p1: construction.find(project => project.engineerIndex === index)!.cellIndex! + 1 })
            : person.status === 'resident' && mining.some(run => run.personIndex === index)
              ? text(mining.find(run => run.personIndex === index)!.phase === 'returning' ? 'ui.playerStation.mining.personReturning' : 'ui.playerStation.mining.personOccupied')
            : person.status === 'resident' && refining.some(run => run.personIndex === index)
              ? text('ui.playerStation.refining.personOccupied', { p1: refining.find(run => run.personIndex === index)!.cellIndex + 1 })
            : person.status === 'resident' && training?.active?.personIndex === index
            ? text(training.active.paused ? 'ui.playerStation.training.personPaused' : 'ui.playerStation.training.personBusy')
            : person.status === 'resident' && training?.qualifications[index]
              ? text(`ui.playerStation.training.qualified.${training.qualifications[index]}`)
              : text(`ui.playerStation.personStatus.${person.status}`)}
        </td></tr>)}</tbody>
    </table>}
    <table className="app-player-station-bill app-player-station-revival-bill">
      <caption>{text('ui.playerStation.revivalBill')}</caption>
      <thead><tr><th scope="col">{text('ui.playerStation.material')}</th><th scope="col">{text('ui.playerStation.need')}</th>
        <th scope="col">{text('ui.playerStation.available')}</th><th scope="col">{text('ui.playerStation.sourceMaterials')}</th></tr></thead>
      <tbody>{view.revivalBill.map(row => <tr key={row.itemId}><th scope="row">{row.itemName}</th><td>{NUMBER.format(row.need)}</td>
        <td>{NUMBER.format(row.available)}</td><td>{NUMBER.format(row.sourceAvailable)}</td></tr>)}</tbody>
    </table>
  </section>
}
