import { useState } from 'react'
import { ArrowUp, BookOpen, Pause, Play, Square, Users, X } from 'lucide-react'
import { CREW_QUALIFICATION_MS, CREW_TICK_MS } from '../../../../../../../packages/core/src/playerStation/crew'
import type { CrewCourse } from '../../../../../../../packages/core/src/playerStation/crew'
import { CREW_CHOICE_EVENTS } from '../../../../../../../packages/core/src/playerStation/crewContent'
import type { PlayerStationGameRuntime } from '../../../../../../../packages/core/src/playerStation/gameRuntime'
import type { PlayerStationText } from './PlayerStationPanel'
import { stationGameLabel } from './PlayerStationGameSupport'
import type { StationGameCommand } from './PlayerStationGameSupport'

interface CrewProps { runtime: PlayerStationGameRuntime; text: PlayerStationText; onCommand: StationGameCommand }
type CrewTeamView = ReturnType<PlayerStationGameRuntime['crewView']>['teams'][number]

function CrewTeam({ team, runtime, text, onCommand }: CrewProps & { team: CrewTeamView }) {
  const [course, setCourse] = useState<CrewCourse>(team.course)
  const [binding, setBinding] = useState('')
  const view = runtime.crewView(), ships = runtime.shipsView()
  const event = team.pending && CREW_CHOICE_EVENTS.find(entry => entry.id === team.pending!.eventId)
  const busy = team.activity === 'mission' || team.activity === 'guard'
  const canTrain = !busy && team.activity !== 'qualifying'
  const bindingShips = ships.filter(ship => ship.id !== team.shipId && (runtime.crewHost.ship(ship.id)?.tier ?? 4) <= team.tier)
  const selectedShip = bindingShips.find(ship => ship.id === binding)
  const canBind = !!selectedShip?.available && selectedShip.location === 'home'
    && !view.teams.some(other => other.id !== team.id && other.shipId === selectedShip.id)
    && (team.activity === 'idle' || team.activity === 'qualifying')
  const shipName = team.shipId ? ships.find(ship => ship.id === team.shipId)?.name ?? team.shipId : text('ui.playerStationGame.crew.unbound')
  const canPromote = runtime.trainingHost.residents().some(index => runtime.crewHost.personAvailable(index)
    && !view.teams.some(other => other.members.includes(index)))
  const discount = team.traits.reduce((sum, id) => sum + (view.traits.find(trait => trait.id === id)?.learningDiscount ?? 0), 0)
  return <article className="app-player-station-project" aria-label={team.name}>
    <header className="app-player-station-project-head"><h4 className="app-player-station-label">{team.name}</h4>
      <span>{stationGameLabel(text, team.activity)}{team.paused && <> · {text('ui.playerStation.paused')}</>}</span>
    </header>
    <span className="app-dim">{text('ui.playerStationGame.crew.members', { p1: shipName,
      p2: team.members.map(index => index + 1).join(' / '), p3: team.tier })}</span>
    <dl className="app-player-station-stats">{Object.entries(team.attributes).map(([key, amount]) => <div key={key}>
      <dt>{stationGameLabel(text, key)}</dt><dd>{amount}</dd>
    </div>)}</dl>
    <span>{text('ui.playerStationGame.crew.growth', { p1: team.growth, p2: team.potential, p3: team.pointsAvailable, p4: team.earnedPoints })}</span>
    <span className="app-dim">{text('ui.playerStationGame.crew.bonuses', { p1: Math.round(team.bonuses.damagePct * 1000) / 10, p2: Math.round(team.bonuses.defensePct * 1000) / 10 })}</span>
    <progress value={team.activity === 'qualifying' ? team.qualificationMs : team.progressMs}
      max={team.activity === 'qualifying' ? CREW_QUALIFICATION_MS : CREW_TICK_MS} aria-label={text('ui.playerStationGame.crew.progress')} />
    {team.blocked && <span className="app-dim">{text(`ui.playerStationGame.crew.blocked.${team.blocked}`)}</span>}
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStationGame.crew.course')}
        <select value={course} onChange={event => setCourse(event.target.value as CrewCourse)}>
          {view.courses.map(entry => <option key={entry.id} value={entry.id}>{stationGameLabel(text, entry.id)}</option>)}
        </select></label>
      <button type="button" className="app-btn" disabled={!canTrain || !!runtime.g.academy.active} onClick={() => onCommand('crew', { kind: 'plan', teamId: team.id, course })}>
        <Play size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.plan')}</button>
      <button type="button" className="app-btn" disabled={busy} onClick={() => onCommand('crew', { kind: team.paused ? 'resume' : 'pause', teamId: team.id })}>
        {team.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(team.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}</button>
      <button type="button" className="app-btn" disabled={!canTrain} onClick={() => onCommand('crew', { kind: 'idle', teamId: team.id })}>
        <Square size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.idle')}</button>
      <button type="button" className="app-btn" disabled={team.activity !== 'idle' || team.tier === 3 || !canPromote} onClick={() => onCommand('crew', { kind: 'promote', teamId: team.id })}>
        <ArrowUp size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.promote')}</button>
      <button type="button" className="app-btn is-warn" disabled={busy} onClick={() => {
        if (window.confirm(text('ui.playerStationGame.crew.disbandConfirm', { p1: team.name }))) onCommand('crew', { kind: 'disband', teamId: team.id })
      }}><X size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.disband')}</button>
    </div>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStationGame.crew.bindShip')}
        <select value={binding} onChange={event => setBinding(event.target.value)}>
          <option value="">{text('ui.playerStationGame.crew.selectShip')}</option>
          {bindingShips.map(ship => <option key={ship.id} value={ship.id}
            disabled={!ship.available || ship.location !== 'home' || view.teams.some(other => other.id !== team.id && other.shipId === ship.id)}>{ship.name}</option>)}
        </select></label>
      <button type="button" className="app-btn" disabled={!canBind}
        onClick={() => onCommand('crew', { kind: 'bind', teamId: team.id, shipId: binding })}><Users size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.bind')}</button>
    </div>
    <h4 className="app-player-station-label">{text('ui.playerStationGame.crew.opportunities')}</h4>
    {!team.opportunities.length && <span className="app-dim">{text('ui.playerStationGame.crew.noOpportunity')}</span>}
    {team.opportunities.map(skillId => {
      const skill = view.skills.find(entry => entry.id === skillId)
      if (!skill) return null
      return <div key={skillId} className="app-player-station-project-head">
        <span title={text(skill.descId)}>{text(skill.nameId)} · {text('ui.playerStationGame.crew.cost', { p1: Math.max(1, skill.cost - discount) })}</span>
        <span className="app-dim">{Object.entries(skill.requires).map(([key, n]) => `${stationGameLabel(text, key)} ≥ ${n}`).join(' / ')}</span>
        <button type="button" className="app-btn" disabled={!team.learnable.includes(skillId)} onClick={() => onCommand('crew', { kind: 'learn', teamId: team.id, skillId })}>
          <BookOpen size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.learn')}</button>
      </div>
    })}
    <h4 className="app-player-station-label">{text('ui.playerStationGame.crew.learned')}</h4>
    <div className="app-player-station-actions">{team.skills.length ? team.skills.map(skillId => {
      const skill = view.skills.find(entry => entry.id === skillId)
      return skill && <span key={skillId} title={text(skill.descId)}>{text(skill.nameId)}</span>
    }) : <span className="app-dim">{text('ui.playerStationGame.none')}</span>}</div>
    <h4 className="app-player-station-label">{text('ui.playerStationGame.crew.traits')}</h4>
    <div className="app-player-station-actions">{team.traits.length ? team.traits.map(traitId => {
      const trait = view.traits.find(entry => entry.id === traitId)
      return trait && <span key={traitId} title={text(trait.descId)}>{text(trait.nameId)}</span>
    }) : <span className="app-dim">{text('ui.playerStationGame.none')}</span>}</div>
    {team.pending && event && <div>
      <strong>{text(event.nameId)}</strong><p className="app-player-station-notice">{text(event.descId)}</p>
      <div className="app-player-station-actions">{team.pending.options.map((reward, index) => {
        const item = reward.kind === 'skill' ? view.skills.find(entry => entry.id === reward.id) : view.traits.find(entry => entry.id === reward.id)
        return item && <button key={index} type="button" className="app-btn" title={text(item.descId)}
          onClick={() => onCommand('crew', { kind: 'reply', teamId: team.id, choice: index as 0 | 1 })}>{text(item.nameId)}</button>
      })}</div>
    </div>}
  </article>
}

export function PlayerStationGameCrew({ runtime, text, onCommand }: CrewProps) {
  const [shipId, setShipId] = useState(''), [name, setName] = useState('')
  const ships = runtime.shipsView(), view = runtime.crewView()
  const eligibleShips = ships.filter(entry => !!runtime.crewHost.ship(entry.id))
  const ship = eligibleShips.find(entry => entry.id === shipId) ?? eligibleShips.find(entry => entry.available && !view.teams.some(team => team.shipId === entry.id))
  const people = runtime.trainingHost.residents().filter(index => runtime.crewHost.personAvailable(index) && !view.teams.some(team => team.members.includes(index)))
  const canCreate = !!ship?.available && ship.location === 'home' && people.length >= ship.tier && !view.teams.some(team => team.shipId === ship.id)
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.crew.title')}>
    <header className="app-player-station-head"><h3 className="app-player-station-title"><Users size={17} aria-hidden="true" />{text('ui.playerStationGame.crew.title')}</h3>
      <span>{text('ui.playerStationGame.crew.seats', { p1: view.seatUsed, p2: view.seatCount })}</span></header>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStationGame.crew.name')}
        <input maxLength={48} value={name} onChange={event => setName(event.target.value)} placeholder={text('ui.playerStationGame.crew.defaultName')} /></label>
      <label className="app-player-station-field">{text('ui.playerStationGame.crew.targetShip')}
        <select value={ship?.id ?? ''} onChange={event => setShipId(event.target.value)}>
          {!eligibleShips.length && <option value="">{text('ui.playerStationGame.noShip')}</option>}
          {eligibleShips.map(entry => <option key={entry.id} value={entry.id} disabled={!entry.available || entry.location !== 'home' || view.teams.some(team => team.shipId === entry.id)}>
            {entry.name} · {text('ui.playerStationGame.crew.shipTier', { p1: entry.tier })} · {text(entry.available ? 'ui.playerStation.shipIdle' : 'ui.playerStation.shipOccupied')}
          </option>)}
        </select></label>
      <button type="button" className="app-btn" disabled={!canCreate} onClick={() => ship && onCommand('crew', { kind: 'create', shipId: ship.id, name: name.trim() || text('ui.playerStationGame.crew.defaultName') })}>
        <Users size={14} aria-hidden="true" />{text('ui.playerStationGame.crew.create')}</button>
    </div>
    {!view.teams.length && <p className="app-dim app-player-station-notice">{text('ui.playerStationGame.crew.empty')}</p>}
    {view.teams.map(team => <CrewTeam key={team.id} team={team} runtime={runtime} text={text} onCommand={onCommand} />)}
  </section>
}
