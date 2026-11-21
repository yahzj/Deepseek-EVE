import { useState } from 'react'
import { GraduationCap, Pause, Play, Plus, X } from 'lucide-react'
import type { StationQualification, StationTrainingAction, stationTrainingView } from '../../../../../../../packages/core/src/playerStation/index'
import type { PlayerStationText } from './PlayerStationPanel'
import { STATION_NUMBER as NUMBER } from './PlayerStationDetails'

interface TrainingPanelProps {
  view: ReturnType<typeof stationTrainingView>
  text: PlayerStationText
  onCommand(action: StationTrainingAction): void
}

// 主信息为受训人/进度与单席位，队列次之；沿用站点表格、按钮和进度令牌。
export function PlayerStationTrainingPanel({ view, text, onCommand }: TrainingPanelProps) {
  const [course, setCourse] = useState<StationQualification>('engineer')
  const active = view.active
  const status = active?.paused ? 'ui.playerStation.paused' : active?.blocked ? `ui.playerStation.training.wait.${active.blocked}` : 'ui.playerStation.training.running'
  return <section className="app-player-station app-player-station-training" aria-label={text('ui.playerStation.training.title')}>
    <header className="app-player-station-head">
      <h3 className="app-player-station-title"><GraduationCap size={17} aria-hidden="true" />{text('ui.playerStation.training.title')}</h3>
      <span>{text('ui.playerStation.training.seat', { p1: view.seatUsed, p2: view.seatCount })}</span>
    </header>
    <dl className="app-player-station-stats">
      {(['ordinary', 'engineers', 'researchers'] as const).map(key => <div key={key}><dt>{text(`ui.playerStation.training.${key}`)}</dt><dd>{view[key]}</dd></div>)}
      <div><dt>{text('ui.playerStation.duration')}</dt><dd>{text('ui.playerStation.minutes', { p1: NUMBER.format(view.durationMs / 60_000) })}</dd></div>
    </dl>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">{text('ui.playerStation.training.course')}
        <select aria-label={text('ui.playerStation.training.course')} value={course} onChange={event => setCourse(event.target.value as StationQualification)}>
          {(['engineer', 'researcher'] as const).map(kind => <option key={kind} value={kind}>{text(`ui.playerStation.training.course.${kind}`)}</option>)}
        </select>
      </label>
      <button type="button" className="app-btn" disabled={!view.canEnqueue} onClick={() => onCommand({ kind: 'enqueue', course })}>
        <Plus size={15} aria-hidden="true" />{text('ui.playerStation.training.enqueue')}
      </button>
    </div>
    {active && <div className="app-player-station-project" data-training-person={active.personIndex}>
      <div className="app-player-station-project-head">
        <h4 className="app-player-station-label">{text(`ui.playerStation.training.course.${active.course}`)}</h4>
        <span className={active.blocked ? 'is-missing' : 'app-dim'} data-training-status>{text(status)}</span>
      </div>
      <div className="app-player-station-project-head">
        <span>{text('ui.playerStation.populationNumber', { p1: active.personIndex + 1 })}</span>
        <span>{text('ui.playerStation.progressValue', { p1: NUMBER.format(active.progressMs / 60_000), p2: NUMBER.format(view.durationMs / 60_000) })}</span>
      </div>
      <progress value={active.progressMs} max={view.durationMs} aria-label={text('ui.playerStation.training.progress')} />
      <div className="app-player-station-actions">
        <button type="button" className="app-btn" onClick={() => onCommand({ kind: active.paused ? 'resume' : 'pause' })}>
          {active.paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          {text(active.paused ? 'ui.playerStation.resume' : 'ui.playerStation.pause')}
        </button>
      </div>
    </div>}
    {view.wait && <p className="app-player-station-notice app-dim" data-training-wait>{text(`ui.playerStation.training.wait.${view.wait}`)}</p>}
    <div className="app-player-station-training-queue">
      <h4 className="app-player-station-label">{text('ui.playerStation.training.queue', { p1: view.queue.length })}</h4>
      {view.queue.length === 0 ? <span className="app-dim">{text('ui.playerStation.training.emptyQueue')}</span> : <ol>
        {view.queue.map((kind, index) => <li key={index} data-training-queue-index={index}>
          <span>{index + 1}. {text(`ui.playerStation.training.course.${kind}`)}</span>
          <button type="button" className="app-btn app-player-station-training-remove"
            title={text('ui.playerStation.training.remove', { p1: index + 1 })} aria-label={text('ui.playerStation.training.remove', { p1: index + 1 })}
            onClick={() => onCommand({ kind: 'remove', index })}><X size={16} aria-hidden="true" /></button>
        </li>)}
      </ol>}
    </div>
  </section>
}
