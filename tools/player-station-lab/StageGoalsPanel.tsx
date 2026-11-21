import { Flag, Check, Circle } from 'lucide-react'
import type { StationCampaignHost, StationCampaign } from '../../packages/core/src/playerStation/campaign'
import { stationCampaignView } from '../../packages/core/src/playerStation/campaign'

const LABELS = {
  settlement: '安置至少3名居民，生活保障正常',
  industry: '人类精炼和站内制造均有实际产出',
  research: '掌握全部六项基础科研',
  expansion: '完成首次站体扩容及保障升级',
  crew: '至少一支团队完成资格与一次有效训练',
  logistics: '完成一次实际外派护航并安全返回',
  security: '清除三处已知敌对来源',
  defense: '专用守备有效值守30分钟，或实际击退袭扰',
}
export function StageGoalsPanel({ state, host, onDeclare }: { state: StationCampaign; host: StationCampaignHost; onDeclare(): void }) {
  const view = stationCampaignView(state, host)
  return <section className="app-player-station" aria-label="第二阶段发展目标">
    <header className="app-player-station-head"><h3 className="app-player-station-title"><Flag size={17} />第二阶段发展目标</h3>
      <span className="app-dim">{view.goals.filter(goal => goal.achieved).length} / {view.goals.length}</span></header>
    <ul className="stage-goals">{view.goals.map(goal => <li key={goal.id} data-stage-goal={goal.id} data-achieved={goal.achieved}>
      {goal.achieved ? <Check size={15} aria-hidden="true" /> : <Circle size={15} aria-hidden="true" />}<span>{LABELS[goal.id]}</span>
    </li>)}</ul>
    <button type="button" className="app-btn is-primary" disabled={!view.canDeclare} onClick={onDeclare} data-declare-independence>
      <Flag size={15} />{view.independent ? '自主据点已建立' : '确认建立自主据点'}
    </button>
  </section>
}
