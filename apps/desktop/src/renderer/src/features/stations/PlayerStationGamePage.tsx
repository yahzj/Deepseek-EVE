import { useId, useReducer, useState } from 'react'
import { Factory, FlaskConical, Hammer, Power, Shield, Truck, Undo2, Users, UsersRound } from 'lucide-react'
import { PlayerStationGameRuntime } from '../../../../../../../packages/core/src/playerStation/gameRuntime'
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { stationText as text, trReason } from './PlayerStationGameSupport'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'
import { PlayerStationPanel } from './PlayerStationPanel'
import { PlayerStationPopulationPanel } from './PlayerStationPopulationPanel'
import { PlayerStationTrainingPanel } from './PlayerStationTrainingPanel'
import { PlayerStationRefiningPanel } from './PlayerStationRefiningPanel'
import { PlayerStationMiningPanel } from './PlayerStationMiningPanel'
import { PlayerStationResearchPanel } from './PlayerStationResearchPanel'
import { PlayerStationGameAcademy, PlayerStationGameDevelopment, PlayerStationGameManufacturing, PlayerStationGameWarning } from './PlayerStationGameOperations'
import { PlayerStationGameCrew } from './PlayerStationGameCrew'
import { PlayerStationGameGoals, PlayerStationGameSecurity } from './PlayerStationGameSecurity'

const TABS = [
  { id: 'construction', Icon: Hammer }, { id: 'population', Icon: Users },
  { id: 'production', Icon: Factory }, { id: 'research', Icon: FlaskConical },
  { id: 'crew', Icon: UsersRound }, { id: 'security', Icon: Shield },
] as const
type StationTab = typeof TABS[number]['id']

export interface PlayerStationGamePageProps {
  engine: GameEngine
  onToast?: ToastFn
}

/** 正式页只取运行视图，所有写命令交回引擎。 */
export function PlayerStationGamePage({ engine, onToast }: PlayerStationGamePageProps) {
  const [tab, setTab] = useState<StationTab>('construction')
  const [deliveryShip, setDeliveryShip] = useState('')
  const [sourceShipId, setSourceShipId] = useState('')
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const [, refresh] = useReducer(value => value + 1, 0)
  const id = useId()
  const runtime = new PlayerStationGameRuntime(engine.state, engine.ctx)
  const game = runtime.g
  const command = (domain: string, action: unknown) => {
    const result = engine.playerStationGameCommand(domain, action)
    const message = result.ok ? text('ui.playerStationGame.updated') : trReason(domain, result.reason)
    setFeedback({ text: message, error: !result.ok })
    onToast?.(message, !result.ok)
    refresh()
    return result
  }
  const title = <h2 className="app-player-station-title"><Hammer size={18} aria-hidden="true" />{text('ui.playerStationGame.pageTitle')}</h2>

  if (!game.discovered) return <section className="page-stack page-fill" aria-label={text('ui.playerStationGame.pageTitle')}>
    {title}<p className="app-dim">{text('ui.playerStationGame.discoveryRequired')}</p>
  </section>
  if (!game.active) return <section className="page-stack page-fill" aria-label={text('ui.playerStationGame.pageTitle')}>
    {title}<p className="app-dim">{text('ui.playerStationGame.activationReady')}</p>
    <div><button type="button" className="app-btn is-primary" onClick={() => command('activate', {})}>
      <Power size={16} aria-hidden="true" />{text('ui.playerStationGame.activate')}
    </button></div>
    {feedback && <p role="status" className={feedback.error ? 'is-missing' : 'app-dim'}>{feedback.text}</p>}
  </section>

  const view = runtime.view(), population = runtime.populationView(), training = runtime.trainingView()
  const refining = runtime.refiningView(), mining = runtime.miningView(), research = runtime.researchView()
  const ships = runtime.shipsView()
  const deliveryShips = ships.filter(ship => ship.auxiliary)
  const selectedShip = deliveryShips.find(ship => ship.id === deliveryShip) ?? deliveryShips.find(ship => ship.available && ship.location === 'home') ?? deliveryShips[0]
  const sourceShipIds = game.sourceShips ?? []
  const populationShips = ships.filter(ship => ship.auxiliary).map(ship => {
    const populationShip = runtime.populationHost.ship(ship.id)
    return populationShip ? { ...ship, available: populationShip.available, location: populationShip.location } : ship
  })
  const sourceShips = populationShips.filter(ship => sourceShipIds.includes(ship.id))
  const selectedSourceShip = sourceShips.find(ship => ship.id === sourceShipId) ?? sourceShips.find(ship => ship.available) ?? sourceShips[0]
  const residents = runtime.trainingHost.residents()
  const cells = (kind: string) => view.cells.filter(cell => cell.kind === kind).map(cell => cell.cellIndex)
  const transport = (domain: 'delivery' | 'recover', target?: 'body' | 'source') => {
    if (selectedShip?.available && selectedShip.location === 'home') command(domain, { shipId: selectedShip.id, ...(target ? { target } : {}) })
    else {
      const message = text('ui.playerStationGame.noShip')
      setFeedback({ text: message, error: true })
      onToast?.(message, true)
    }
  }
  const deliver = (target: 'body' | 'source') => transport('delivery', target)
  const additionalOccupations = [
    ...game.development.projects.flatMap(project => project.engineerIndices.map(personIndex => ({ personIndex, label: text('ui.playerStationGame.occupation.development') }))),
    ...(game.academy.active ? [{ personIndex: game.academy.active.personIndex, label: text('ui.playerStationGame.occupation.academy') }] : []),
    ...game.manufacturing.runs.flatMap(run => run.personIndex === undefined ? [] : [{ personIndex: run.personIndex, label: text('ui.playerStationGame.occupation.manufacturing') }]),
    ...game.crew.teams.flatMap(team => team.members.map(personIndex => ({ personIndex, label: text('ui.playerStationGame.occupation.crew', { p1: team.name }) }))),
  ]

  return <section className="page-stack page-fill" style={{ minHeight: 0, overflow: 'hidden' }} aria-label={text('ui.playerStationGame.pageTitle')}>
    <header className="app-player-station-head">{title}
      <span className="app-dim">{text('ui.playerStationGame.residentSummary', { p1: population.residents, p2: population.capacity })}</span>
    </header>
    <div className="app-subtabs" role="tablist" aria-label={text('ui.playerStationGame.pageTitle')} style={{ flexShrink: 0, flexWrap: 'wrap' }}>
      {TABS.map(({ id: key, Icon }) => <button key={key} type="button" role="tab" id={`${id}-${key}-tab`}
        aria-controls={`${id}-${key}-panel`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
        className={`app-subtab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}
        onKeyDown={event => {
          const position = TABS.findIndex(entry => entry.id === key)
          const next = event.key === 'ArrowRight' ? (position + 1) % TABS.length : event.key === 'ArrowLeft' ? (position + TABS.length - 1) % TABS.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : undefined
          if (next === undefined) return
          event.preventDefault()
          setTab(TABS[next].id)
          document.getElementById(`${id}-${TABS[next].id}-tab`)?.focus()
        }}><Icon size={15} aria-hidden="true" />{text(`ui.playerStationGame.tab.${key}`)}</button>)}
    </div>
    {feedback && <div role="status" aria-live="polite" className={feedback.error ? 'is-missing' : 'app-dim'} style={{ flexShrink: 0 }}>{feedback.text}</div>}
    <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} tabIndex={0}
      style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}>
      {tab === 'construction' && <>
        <section className="app-player-station" aria-label={text('ui.playerStationGame.deliveryTitle')}>
          <h3 className="app-player-station-title"><Truck size={17} aria-hidden="true" />{text('ui.playerStationGame.deliveryTitle')}</h3>
          <div className="app-player-station-actions"><label className="app-player-station-field">{text('ui.playerStationGame.deliveryShip')}
            <select value={selectedShip?.id ?? ''} onChange={event => setDeliveryShip(event.target.value)}>
              {!deliveryShips.length && <option value="">{text('ui.playerStationGame.noShip')}</option>}
              {deliveryShips.map(ship => <option key={ship.id} value={ship.id}
                disabled={sourceShipIds.includes(ship.id) ? !runtime.populationHost.ship(ship.id)?.available : !ship.available || ship.location !== 'home'}>
                {ship.name} · {NUMBER.format(ship.freeM3)} m³ · {text(`ui.playerStation.shipLocation.${ship.location}`)} · {text(ship.available ? 'ui.playerStation.shipIdle' : 'ui.playerStation.shipOccupied')}
              </option>)}
            </select></label>
            <button type="button" className="app-btn" disabled={!selectedShip?.available || selectedShip.location !== 'home' || !!game.delivery || view.built || !view.bodyApproved || !!view.project}
              onClick={() => deliver('body')}><Truck size={14} aria-hidden="true" />{text('ui.playerStationGame.deliverBody')}</button>
            <button type="button" className="app-btn" disabled={!selectedShip?.available || selectedShip.location !== 'home' || !!game.delivery || !view.built}
              onClick={() => deliver('source')}><Truck size={14} aria-hidden="true" />{text('ui.playerStationGame.deliverSource')}</button>
          </div>
          {game.delivery && <div className="app-player-station-project">
            <span>{text('ui.playerStationGame.deliveryProgress', { p1: ships.find(ship => ship.id === game.delivery!.shipId)?.name ?? game.delivery.shipId,
              p2: text(['recovery', 'return'].includes(game.delivery.target) ? 'ui.playerStationGame.recoveryDestination' : game.delivery.target === 'body' ? 'ui.playerStationGame.bodyDestination' : 'ui.playerStationGame.sourceDestination') })}</span>
            <progress value={game.delivery.progressMs} max={game.delivery.durationMs} aria-label={text('ui.playerStationGame.deliveryTitle')} />
          </div>}
        </section>
        <PlayerStationPanel view={view} text={text} onCommand={action => command('station', action)} onDeliver={() => deliver('body')} onRecover={() => transport('recover')} />
        <PlayerStationGameDevelopment runtime={runtime} text={text} onCommand={command} />
        <PlayerStationGameGoals runtime={runtime} text={text} onCommand={command} />
      </>}
      {tab === 'population' && <>
        <div className="app-player-station-actions">
          <label className="app-player-station-field">{text('ui.playerStationGame.sourceShip')}
            <select value={selectedSourceShip?.id ?? ''} onChange={event => setSourceShipId(event.target.value)}>
              {!sourceShips.length && <option value="">{text('ui.playerStationGame.noSourceShip')}</option>}
              {sourceShips.map(ship => <option key={ship.id} value={ship.id} disabled={!ship.available}>{ship.name}</option>)}
            </select>
          </label>
          <button type="button" className="app-btn" disabled={!selectedSourceShip?.available || !!game.delivery}
            onClick={() => selectedSourceShip && command('population-return', { shipId: selectedSourceShip.id })}>
            <Undo2 size={14} aria-hidden="true" />{text('ui.playerStationGame.returnSourceShip')}</button>
          {game.delivery?.target === 'return' && <progress value={game.delivery.progressMs} max={game.delivery.durationMs}
            aria-label={text('ui.playerStationGame.returnSourceShip')} />}
        </div>
        <PlayerStationPopulationPanel view={population} training={training} construction={view.projects} refining={refining.runs} mining={mining.runs}
          research={research.assignment} additionalOccupations={additionalOccupations} ships={populationShips} text={text} onCommand={action => command('population', action)} />
        <PlayerStationTrainingPanel view={training} text={text} onCommand={action => command('training', action)} />
        <PlayerStationGameAcademy runtime={runtime} text={text} onCommand={command} />
      </>}
      {tab === 'production' && <>
        <PlayerStationRefiningPanel view={refining} facilities={cells('refinery')} recipes={runtime.refiningItems()}
          people={residents.map(index => ({ index, available: runtime.refiningHost.personAvailable(index) }))}
          text={text} itemName={itemId => runtime.host.itemName(itemId)} onCommand={action => command('refining', action)} />
        <PlayerStationMiningPanel view={mining} ships={ships.filter(ship => ship.auxiliary).map(ship => ({ ...ship, available: ship.available && ship.location === 'home', capacityM3: ship.freeM3 }))}
          people={residents.map(index => ({ index, available: runtime.miningHost.personAvailable(index) }))} belts={runtime.belts()}
          text={text} itemName={itemId => runtime.host.itemName(itemId)} onCommand={action => command('mining', action)} />
        <PlayerStationGameManufacturing runtime={runtime} text={text} onCommand={command} />
      </>}
      {tab === 'research' && <PlayerStationResearchPanel view={research} facilities={cells('research')}
        people={runtime.researchHost.researchers().map(index => ({ index, available: runtime.researchHost.personAvailable(index) }))}
        text={text} onCommand={action => command('research', action)} />}
      {tab === 'crew' && <PlayerStationGameCrew runtime={runtime} text={text} onCommand={command} />}
      {tab === 'security' && <>
        <PlayerStationGameWarning runtime={runtime} text={text} />
        <PlayerStationGameSecurity runtime={runtime} text={text} onCommand={command} />
      </>}
    </div>
  </section>
}
