import { useState } from 'react'
import { Flag, Play, Shield, Square, Truck } from 'lucide-react'
import type { StationSecurityAction, stationSecurityView } from '../../packages/core/src/playerStation/security'
import { stageLabel } from './stageTwoText'

export function StageSecurityPanel({ view, teams, sourceName, onCommand }: {
  view: ReturnType<typeof stationSecurityView>
  teams: readonly { id: string; name: string; available: boolean }[]
  sourceName(id: string): string
  onCommand(action: StationSecurityAction): void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [source, setSource] = useState(view.sources[0].id)
  const valid = selected.filter(id => teams.some(team => team.id === id && team.available))
  const mission = view.mission
  return <section className="app-player-station" aria-label="外派与区域安全">
    <header className="app-player-station-head"><h3 className="app-player-station-title"><Shield size={17} />外派与区域安全</h3>
      <span className="app-dim">已清除 {view.sources.filter(entry => entry.cleared).length} / {view.sources.length}</span></header>
    <div className="stage-selection">{teams.map(team => <label key={team.id}>
      <input type="checkbox" aria-label={`部署 ${team.name}`} checked={selected.includes(team.id)} disabled={!team.available}
        onChange={event => setSelected(ids => event.target.checked ? [...ids, team.id].slice(0, 4) : ids.filter(id => id !== team.id))} />{team.name}
    </label>)}</div>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">敌对来源<select aria-label="清剿来源" value={source} onChange={event => setSource(event.target.value as typeof source)}>
        {view.sources.map(entry => <option key={entry.id} value={entry.id} disabled={entry.cleared}>{sourceName(entry.id)}{entry.cleared ? ' · 已清除' : ''}</option>)}
      </select></label>
      <button type="button" className="app-btn" disabled={valid.length === 0 || !!mission || view.sources.find(entry => entry.id === source)?.cleared}
        onClick={() => onCommand({ kind: 'start', missionKind: 'clear', sourceId: source, teamIds: valid })}><Flag size={14} />清剿来源</button>
      <button type="button" className="app-btn" disabled={valid.length === 0 || !!mission}
        onClick={() => onCommand({ kind: 'start', missionKind: 'escort', teamIds: valid })}><Truck size={14} />安排补给护航</button>
      <button type="button" className="app-btn" disabled={valid.length === 0 || !!mission}
        onClick={() => onCommand({ kind: 'start', missionKind: 'patrol', sourceId: source, teamIds: valid })}><Play size={14} />有限巡逻</button>
      <button type="button" className="app-btn" disabled={valid.length === 0 || !!view.guard}
        onClick={() => onCommand({ kind: 'guard', teamIds: valid })}><Shield size={14} />预留守备编队</button>
    </div>
    {mission && <div className="app-player-station-project" data-stage-mission={mission.phase}>
      <strong>{stageLabel(mission.kind)} · {stageLabel(mission.phase)} · {mission.teamIds.map(id => teams.find(team => team.id === id)?.name).join('、')}</strong>
      <progress value={mission.progressMs} max={mission.durationMs} />
      <span className="app-dim">本阶段剩余 {Math.ceil((mission.durationMs - mission.progressMs) / 1000)} 秒{view.blocked ? ` · ${stageLabel(view.blocked)}` : ''}</span>
      <div className="app-player-station-actions">
        {mission.phase !== 'returning' && <button type="button" className="app-btn" onClick={() => onCommand({ kind: mission.paused ? 'resume' : 'pause' })}>{mission.paused ? '恢复任务' : '暂停任务'}</button>}
        <button type="button" className="app-btn is-warn" disabled={mission.stopped} onClick={() => onCommand({ kind: 'stop' })}><Square size={14} />停止并返航</button>
      </div>
    </div>}
    {view.guard && <div className="app-player-station-project" data-stage-guard>
      <strong>专用守备 · {view.guard.teamIds.map(id => teams.find(team => team.id === id)?.name).join('、')}</strong>
      <span className="app-dim">{view.raid ? '正在执行防守' : view.guard.paused ? '守备已暂停，人员与船只保留' : '守备待命'}</span>
      <div className="app-player-station-actions"><button type="button" className="app-btn" disabled={!!view.raid} onClick={() => onCommand({ kind: view.guard!.paused ? 'resume' : 'pause', target: 'guard' })}>{view.guard.paused ? '恢复守备' : '暂停守备'}</button>
        <button type="button" className="app-btn" disabled={!!view.raid} onClick={() => onCommand({ kind: 'unguard' })}>解除守备</button></div>
    </div>}
    <ul>{view.sources.map(entry => <li key={entry.id}>{sourceName(entry.id)} · {entry.cleared ? '来源已清除' : entry.remainingMs === undefined ? '无警戒情报' : `预警检查剩余 ${Math.ceil(entry.remainingMs / 60_000)} 分钟`}</li>)}</ul>
    <h4 className="app-player-station-label">行动报告</h4>
    <div className="stage-reports">{[...view.reports].reverse().slice(0, 10).map(report => <div key={report.id} data-security-report={report.id}>
      <strong>{stageLabel(report.kind)} · {report.outcome ? stageLabel(report.outcome) : report.reason ? stageLabel(report.reason) : '已归档'}</strong>
      <span className="app-dim">{report.sourceId ? sourceName(report.sourceId) : ''} · {Math.round(report.clockMs / 60_000)} 分钟</span>
    </div>)}</div>
  </section>
}
