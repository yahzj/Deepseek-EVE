import type { AgentView } from '../client'
import { amount, money } from '../format'
import { periodIndex } from '../format'
import { T, TF } from '../texts'

const ROLE_KEY: Record<string, keyof typeof T> = {
  market_maker: 'agentRoleMaker',
  momentum: 'agentRoleMomentum',
  value: 'agentRoleValue',
  short: 'agentRoleShort',
  herd: 'agentRoleHerd',
  whale: 'agentRoleWhale',
}

const MOOD_KEY: Record<string, keyof typeof T> = {
  calm: 'agentMoodCalm',
  greedy: 'agentMoodGreedy',
  fearful: 'agentMoodFearful',
  euphoric: 'agentMoodEuphoric',
}

function roleLabel(role: string): string {
  const key = ROLE_KEY[role]
  return key !== undefined ? T[key] : role
}

function moodLabel(mood: string): string {
  const key = MOOD_KEY[mood]
  return key !== undefined ? T[key] : mood
}

export function AgentRoster({ agents }: { agents: AgentView[] }) {
  if (agents.length === 0) {
    return (
      <div className="ex-agents-empty" role="status">
        {T.agentsEmpty}
      </div>
    )
  }

  return (
    <div className="ex-agents" aria-label={T.agentsTab}>
      {agents.map((agent) => {
        const isUp = agent.pnl >= 0
        const action = agent.recentActions[0]
        const holdingCount = agent.holdings.length
        return (
          <div className="ex-agent-row" key={agent.persona}>
            <div className="ex-agent-head">
              <span className="ex-agent-name" title={agent.persona}>
                {agent.name}
              </span>
              <span className="ex-agent-tag">{roleLabel(agent.role)}</span>
              <span className={`ex-agent-tag is-mood-${agent.mood}`}>{moodLabel(agent.mood)}</span>
              <b className={`ex-num ex-agent-pnl ${isUp ? 'is-up' : 'is-down'}`}>
                {money(agent.pnl)}
              </b>
            </div>
            <div className="ex-agent-meta">
              <span className="ex-dim">
                {T.agentsHoldings} <b className="ex-num">{holdingCount}</b>
              </span>
              <span className="ex-dim">
                {T.agentsCash} <b className="ex-num">{money(agent.cash)}</b>
              </span>
              <span className="ex-dim">
                {T.agentsEquity} <b className="ex-num">{money(agent.equity)}</b>
              </span>
            </div>
            <div className="ex-agent-action">
              {action !== undefined ? (
                <>
                  <span className={`ex-agent-side ${action.side === 'buy' ? 'is-up' : 'is-down'}`}>
                    {action.side === 'buy' ? T.agentsBuy : T.agentsSell}
                  </span>
                  <b className="ex-num">{action.code}</b>
                  <span className="ex-num">{amount(action.qty)}</span>
                  <span className="ex-dim">
                    {action.price > 0 ? `@${money(action.price)}` : ''} {TF.myOrdersRound(periodIndex(action.roundNo))}
                  </span>
                </>
              ) : (
                <span className="ex-dim">{T.agentsNoAction}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
