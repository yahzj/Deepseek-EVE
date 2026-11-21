import { useState } from 'react'
import { ArrowUp, BookOpen, Pause, Play, Users, X } from 'lucide-react'
import type { StationCrewAction, stationCrewView } from '../../packages/core/src/playerStation/crew'
import { CREW_DEV_ZH, CREW_CHOICE_EVENTS } from '../../packages/core/src/playerStation/crewContent'
import type { CrewCourse } from '../../packages/core/src/playerStation/crewContent'
import { stageLabel } from './stageTwoText'

export function StageCrewPanel({ view, ships, onCommand }: {
  view: ReturnType<typeof stationCrewView>
  ships: readonly { id: string; name: string; tier: number; available: boolean }[]
  onCommand(action: StationCrewAction): void
}) {
  const [shipId, setShip] = useState(ships[0]?.id ?? '')
  const [name, setName] = useState('第一舰员队')
  const [course, setCourse] = useState<CrewCourse>('fire-control')
  const [binding, setBinding] = useState('')
  const contentText = (id: string) => CREW_DEV_ZH[id] ?? id
  return <section className="app-player-station" aria-label="舰员团队与培养">
    <header className="app-player-station-head"><h3 className="app-player-station-title"><Users size={17} />舰员团队与培养</h3>
      <span className="app-dim">培训席位 {view.seatUsed} / {view.seatCount}</span></header>
    <div className="app-player-station-actions">
      <label className="app-player-station-field">团队呼号<input aria-label="团队呼号" maxLength={48} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="app-player-station-field">目标舰船<select aria-label="舰员目标舰船" value={shipId} onChange={event => setShip(event.target.value)}>
        {ships.map(ship => <option key={ship.id} value={ship.id} disabled={!ship.available}>{ship.name} · 资格{ship.tier} · {ship.available ? '可用' : '已占用'}</option>)}
      </select></label>
      <button type="button" className="app-btn" disabled={!shipId || !name.trim() || view.teams.some(team => team.shipId === shipId)}
        onClick={() => onCommand({ kind: 'create', shipId, name })}><Users size={14} />组建团队</button>
    </div>
    <div className="stage-team-grid">{view.teams.map(team => {
      const event = team.pending && CREW_CHOICE_EVENTS.find(event => event.id === team.pending!.eventId)
      const busy = team.activity === 'mission' || team.activity === 'guard'
      return <div className="stage-team" key={team.id} data-crew-team={team.id}>
        <div className="app-player-station-project-head"><strong>{team.name}</strong><span>{stageLabel(team.activity)}{team.paused ? ' · 已暂停' : ''}</span></div>
        <span className="app-dim">{ships.find(ship => ship.id === team.shipId)?.name} · 成员{team.members.map(index => index + 1).join('、')} · 资格{team.tier}</span>
        <dl className="app-player-station-stats">{Object.entries(team.attributes).map(([id, amount]) => <div key={id}><dt>{stageLabel(id)}</dt><dd>{amount}</dd></div>)}</dl>
        <span>普通成长 {team.growth} / {team.potential} · 技能点 {team.pointsAvailable} / 累计{team.earnedPoints}</span>
        <span className="app-dim">团队增量：火力 +{Math.round(team.bonuses.damagePct * 1000) / 10}% · 防护 +{Math.round(team.bonuses.defensePct * 1000) / 10}%</span>
        <progress value={team.activity === 'qualifying' ? team.qualificationMs : team.progressMs} max={team.activity === 'qualifying' ? 30 * 60_000 : 10 * 60_000} />
        {team.blocked && <span className="app-dim">{({ training: '等待培训中心、空闲席位或供电', seat: '等待培训席位', facilities: '等待生活保障', paused: '已暂停，人员保留', busy: '团队正承担任务' } as Record<string, string>)[team.blocked] ?? stageLabel(team.blocked)}</span>}
        <div className="app-player-station-actions">
          <label className="app-player-station-field">长期课程<select aria-label={`${team.name}长期课程`} value={course} onChange={event => setCourse(event.target.value as CrewCourse)}>
            {view.courses.map(entry => <option key={entry.id} value={entry.id}>{stageLabel(entry.id)}</option>)}
          </select></label>
          <button type="button" className="app-btn" disabled={busy || team.activity === 'qualifying'} onClick={() => onCommand({ kind: 'plan', teamId: team.id, course })}><Play size={14} />安排模拟训练</button>
          <button type="button" className="app-btn" disabled={busy} onClick={() => onCommand({ kind: team.paused ? 'resume' : 'pause', teamId: team.id })}>{team.paused ? <Play size={14} /> : <Pause size={14} />}{team.paused ? '恢复培养' : '暂停培养'}</button>
          <button type="button" className="app-btn" disabled={busy || team.activity === 'qualifying'} onClick={() => onCommand({ kind: 'idle', teamId: team.id })}>转为待命</button>
          <button type="button" className="app-btn" disabled={team.activity !== 'idle' || team.tier === 3} onClick={() => onCommand({ kind: 'promote', teamId: team.id })}><ArrowUp size={14} />资格进修</button>
          <button type="button" className="app-btn is-warn" disabled={busy} onClick={() => {
            if (window.confirm(`解散${team.name}？成员返回待命，团队培养记录将清除。`)) onCommand({ kind: 'disband', teamId: team.id })
          }}><X size={14} />解散团队</button>
        </div>
        <div className="app-player-station-actions"><select aria-label={`${team.name}换船`} value={binding} onChange={event => setBinding(event.target.value)}>
          <option value="">选择换配舰船</option>{ships.filter(ship => ship.tier <= team.tier).map(ship => <option key={ship.id} value={ship.id} disabled={!ship.available}>{ship.name}</option>)}
        </select><button type="button" className="app-btn" disabled={!binding || team.activity !== 'idle'} onClick={() => onCommand({ kind: 'bind', teamId: team.id, shipId: binding })}>换配舰船</button></div>
        <h4 className="app-player-station-label">学习机会</h4>
        {team.opportunities.length === 0 && <span className="app-dim">尚无新的学习机会</span>}
        {team.opportunities.map(id => {
          const skill = view.skills.find(skill => skill.id === id)!
          const discount = team.traits.reduce((sum, id) => sum + (view.traits.find(trait => trait.id === id)?.learningDiscount ?? 0), 0)
          const cost = Math.max(1, skill.cost - discount)
          return <div key={id} className="app-player-station-project-head"><span title={contentText(skill.descId)}>{contentText(skill.nameId)} · {cost}点</span>
            <button type="button" className="app-btn" disabled={!team.learnable.includes(id)} onClick={() => onCommand({ kind: 'learn', teamId: team.id, skillId: id })}><BookOpen size={14} />学习</button>
            <span className="app-dim">{Object.entries(skill.requires).map(([key, n]) => `${stageLabel(key)}≥${n}`).join(' · ')}</span></div>
        })}
        <span className="app-dim">已学：{team.skills.map(id => contentText(view.skills.find(skill => skill.id === id)!.nameId)).join('、') || '无'}</span>
        <span className="app-dim">永久特性：{team.traits.map(id => contentText(view.traits.find(trait => trait.id === id)!.nameId)).join('、') || '无'}</span>
        {team.pending && event && <section className="stage-choice" data-crew-choice={team.id}>
          <strong>{contentText(event.nameId)}</strong><p>{contentText(event.descId)}</p>
          <div className="app-player-station-actions">{team.pending.options.map((reward, index) => {
            const item = reward.kind === 'skill' ? view.skills.find(skill => skill.id === reward.id)! : view.traits.find(trait => trait.id === reward.id)!
            return <button key={index} type="button" className="app-btn" title={contentText(item.descId)} onClick={() => onCommand({ kind: 'reply', teamId: team.id, choice: index as 0 | 1 })}>{contentText(item.nameId)}</button>
          })}</div>
        </section>}
      </div>
    })}</div>
  </section>
}
