import { useState } from 'react'
import { Check, Circle, Flag, Pause, Play, Shield, Square, Truck } from 'lucide-react'
import type { PlayerStationGameRuntime } from '../../../../../../../packages/core/src/playerStation/gameRuntime'
import { stationCampaignView } from '../../../../../../../packages/core/src/playerStation/campaign'
import type { PlayerStationText } from './PlayerStationPanel'
import { stationGameLabel } from './PlayerStationGameSupport'
import type { StationGameCommand } from './PlayerStationGameSupport'

interface SecurityProps { runtime: PlayerStationGameRuntime; text: PlayerStationText; onCommand: StationGameCommand }

export function PlayerStationGameSecurity({ runtime, text, onCommand }: SecurityProps) {
  const [selected, setSelected] = useState<string[]>([]), [sourceId, setSource] = useState('')
  const view = runtime.securityView(), teams = runtime.crewView().teams
  const source = view.sources.find(entry => entry.id === sourceId) ?? view.sources.find(entry => !entry.cleared) ?? view.sources[0]
  const available = (id: string) => runtime.securityHost.team(id)?.available ?? false
  const valid = selected.filter(id => available(id))
  const mission = view.mission
  const sourceName = (id: string) => runtime.ctx.anomalies.get(id)?.name ?? text('ui.playerStationGame.security.unknownSource')
  const teamNames = (ids: readonly string[]) => ids.map(id => teams.find(team => team.id === id)?.name ?? text('ui.playerStationGame.security.unknownTeam')).join(' / ')
  const materialList = (items: Record<string, number>) => Object.entries(items).map(([id, n]) => `${runtime.host.itemName(id)} × ${n}`).join(' / ') || text('ui.playerStationGame.none')
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.security.title')}>
    <header className="app-player-station-head"><h3 className="app-player-station-title"><Shield size={17} aria-hidden="true" />{text('ui.playerStationGame.security.title')}</h3>
      <span>{text('ui.playerStationGame.security.cleared', { p1: view.sources.filter(entry => entry.cleared).length, p2: view.sources.length })}</span></header>
    <fieldset style={{ margin: 0, minWidth: 0 }}><legend>{text('ui.playerStationGame.security.teams')}</legend>
      <div className="app-player-station-actions">{teams.map(team => <label key={team.id} className="app-player-station-toggle">
        <input type="checkbox" checked={selected.includes(team.id)} disabled={!available(team.id) || !selected.includes(team.id) && valid.length >= 4}
          onChange={event => setSelected(ids => event.target.checked ? [...ids.filter(id => available(id)), team.id] : ids.filter(id => id !== team.id))} />
        {team.name} · {stationGameLabel(text, team.activity)}
      </label>)}</div>
      {!teams.length && <span className="app-dim">{text('ui.playerStationGame.security.noTeams')}</span>}
    </fieldset>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStationGame.security.source')}
        <select value={source?.id ?? ''} onChange={event => setSource(event.target.value)}>{view.sources.map(entry => <option key={entry.id} value={entry.id} disabled={entry.cleared}>
          {sourceName(entry.id)}{entry.cleared && ` · ${text('ui.playerStationGame.status.cleared')}`}
        </option>)}</select></label>
      <button type="button" className="app-btn" disabled={!valid.length || !!mission || !source || source.cleared}
        onClick={() => source && onCommand('security', { kind: 'start', missionKind: 'clear', sourceId: source.id, teamIds: valid })}>
        <Flag size={14} aria-hidden="true" />{text('ui.playerStationGame.security.clear')}</button>
      <button type="button" className="app-btn" disabled={!valid.length || !!mission}
        onClick={() => onCommand('security', { kind: 'start', missionKind: 'escort', teamIds: valid })}>
        <Truck size={14} aria-hidden="true" />{text('ui.playerStationGame.security.escort')}</button>
      <button type="button" className="app-btn" disabled={!valid.length || !!mission || !source || source.cleared}
        onClick={() => source && onCommand('security', { kind: 'start', missionKind: 'patrol', sourceId: source.id, teamIds: valid })}>
        <Play size={14} aria-hidden="true" />{text('ui.playerStationGame.security.patrol')}</button>
      <button type="button" className="app-btn" disabled={!valid.length || !!view.guard}
        onClick={() => onCommand('security', { kind: 'guard', teamIds: valid })}>
        <Shield size={14} aria-hidden="true" />{text('ui.playerStationGame.security.guard')}</button>
    </div>
    {mission && <div className="app-player-station-project">
      <strong>{stationGameLabel(text, mission.kind)} · {stationGameLabel(text, mission.phase)} · {teamNames(mission.teamIds)}</strong>
      <progress value={mission.progressMs} max={mission.durationMs} aria-label={text('ui.playerStationGame.security.missionProgress')} />
      <span className="app-dim">{text('ui.playerStationGame.security.remaining', { p1: Math.ceil(Math.max(0, mission.durationMs - mission.progressMs) / 1000) })}
        {view.blocked && <> · {stationGameLabel(text, view.blocked)}</>}</span>
      <div className="app-player-station-actions">
        {mission.phase !== 'returning' && <button type="button" className="app-btn" onClick={() => onCommand('security', { kind: mission.paused ? 'resume' : 'pause' })}>
          {mission.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(mission.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}</button>}
        <button type="button" className="app-btn is-warn" disabled={mission.stopped || mission.phase === 'returning'} onClick={() => onCommand('security', { kind: 'stop' })}>
          <Square size={14} aria-hidden="true" />{text('ui.playerStationGame.security.stop')}</button>
      </div>
    </div>}
    {view.guard && <div className="app-player-station-project">
      <strong>{text('ui.playerStationGame.security.guardTitle')} · {teamNames(view.guard.teamIds)}</strong>
      <span className="app-dim">{text(view.raid ? 'ui.playerStationGame.security.defending' : view.guard.paused ? 'ui.playerStationGame.security.guardPaused' : 'ui.playerStationGame.security.guardReady')}</span>
      <div className="app-player-station-actions">
        <button type="button" className="app-btn" disabled={!!view.raid} onClick={() => onCommand('security', { kind: view.guard!.paused ? 'resume' : 'pause', target: 'guard' })}>
          {view.guard.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{text(view.guard.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}</button>
        <button type="button" className="app-btn" disabled={!!view.raid} onClick={() => onCommand('security', { kind: 'unguard' })}>
          <Square size={14} aria-hidden="true" />{text('ui.playerStationGame.security.unguard')}</button>
      </div>
    </div>}
    <ul>{view.sources.map(entry => <li key={entry.id}>{sourceName(entry.id)} · {entry.cleared ? text('ui.playerStationGame.status.cleared') : entry.remainingMs === undefined ? text('ui.playerStationGame.security.noIntel')
      : text('ui.playerStationGame.security.nextCheck', { p1: Math.ceil(entry.remainingMs / 60_000) })}</li>)}</ul>
    <h4 className="app-player-station-label">{text('ui.playerStationGame.security.reports')}</h4>
    {!view.reports.length && <span className="app-dim">{text('ui.playerStationGame.security.noReports')}</span>}
    {[...view.reports].reverse().map(report => <details key={report.id} className="app-player-station-project">
      <summary>{stationGameLabel(text, report.kind)} · {report.outcome ? stationGameLabel(text, report.outcome) : report.reason ? stationGameLabel(text, report.reason) : text('ui.playerStationGame.status.completed')}
        {' · '}{text('ui.playerStation.minutes', { p1: Math.round(report.clockMs / 60_000) })}</summary>
      {report.sourceId && <span>{sourceName(report.sourceId)}</span>}
      <span>{teamNames(report.teamIds)}</span>
      <dl className="app-player-station-recovery-list">
        <div><dt>{text('ui.playerStationGame.security.consumed')}</dt><dd>{materialList(report.ammoUsed)}</dd></div>
        <div><dt>{text('ui.playerStationGame.security.reward')}</dt><dd>{materialList(report.reward)}</dd></div>
      </dl>
    </details>)}
  </section>
}

export function PlayerStationGameGoals({ runtime, text, onCommand }: SecurityProps) {
  const view = stationCampaignView(runtime.g.campaign, runtime.campaignHost)
  const achieved = (goal: typeof view.goals[number]) => goal.achieved || goal.current
  return <section className="app-player-station" aria-label={text('ui.playerStationGame.goals.title')}>
    <header className="app-player-station-head"><h3 className="app-player-station-title"><Flag size={17} aria-hidden="true" />{text('ui.playerStationGame.goals.title')}</h3>
      <span>{view.goals.filter(achieved).length} / {view.goals.length}</span></header>
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{view.goals.map(goal => <li key={goal.id} className="app-player-station-notice">
      {achieved(goal) ? <Check size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}
      <span>{text(`ui.playerStationGame.goals.${goal.id}`)}</span><span className="app-dim">{text(achieved(goal) ? 'ui.playerStationGame.status.completed' : 'ui.playerStation.pending')}</span>
    </li>)}</ul>
    <div><button type="button" className="app-btn is-primary" disabled={!view.canDeclare} onClick={() => onCommand('declare', {})}>
      <Flag size={15} aria-hidden="true" />{text(view.independent ? 'ui.playerStationGame.goals.independent' : 'ui.playerStationGame.goals.declare')}</button></div>
  </section>
}
