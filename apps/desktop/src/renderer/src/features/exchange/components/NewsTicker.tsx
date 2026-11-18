import { useEffect, useMemo, useState } from 'react'
import { Bullhorn } from '@carbon/icons-react'
import type { AgentView, NewsItem } from '../client'
import { amount, money } from '../format'
import { T, TF } from '../texts'

export const AGENT_HOLD_MS = 3000
const AGENT_QUEUE_MAX = 8

export function agentRotation(rows: readonly NewsItem[], cursor: number): NewsItem | undefined {
  if (rows.length === 0) return undefined
  return rows[((cursor % rows.length) + rows.length) % rows.length]
}

const LEGACY_META = /（[^（）]*(?:强度|冲击|影响|回合|bp|×)[^（）]*）/g

const PERSONALITY_REGEX = /(?:六大|六|主力|AI|对手盘)?人格/g
const PERSONALITY_BRACKETS = /[（(【\[][^（）()【】\[\]]*(?:人格|铁砧|红隼|磐石|夜枭|群星|深潮|黑隐者|随机游走|虚拟资金)[^（）()【】\[\]]*[）)】\]]/g
const DEV_AI_FLUFF = /(?:本页为原型|虚拟资金不写入存档|行情按随机(?:走势|游走)推进[，。]?)/g

function playerText(text: string): string {
  return text
    .replace(LEGACY_META, '')
    .replace(PERSONALITY_BRACKETS, '')
    .replace(PERSONALITY_REGEX, '')
    .replace(DEV_AI_FLUFF, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isPersonalityNews(item: NewsItem): boolean {
  if (item.id.startsWith('AG-')) return true
  const raw = `${item.title} ${item.body}`
  if (/(?:六大|六|主力|AI|对手盘)?人格/.test(raw)) return true
  if (/^(?:【|\[)?(?:铁砧|红隼|磐石|夜枭|群星|深潮|黑隐者)/.test(item.title)) return true
  return false
}

function toneLabel(tone: NewsItem['tone']): string {
  if (tone === 'good') return T.newsBull
  if (tone === 'bad' || tone === 'warn') return T.newsBear
  return T.newsNeutral
}

const BODY_MAX = 36

function shortText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function newsSecond(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 1_000_003
  return (h % 59) + 1
}

function newsClock(ts: number, id: string): string {
  const d = new Date(ts)
  const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(newsSecond(id))}`
}

export function NewsTicker({
  news,
  agents,
  onSelectCode,
}: {
  news: NewsItem[]
  agents: AgentView[]
  onSelectCode?: (code: string) => void
}) {
  const eventItem = useMemo(() => news.find((item) => !isPersonalityNews(item)), [news])

  const agentQueue = useMemo(
    () => news.filter((item) => item.id.startsWith('AG-')).slice(0, AGENT_QUEUE_MAX),
    [news],
  )
  const [agentCursor, setAgentCursor] = useState(0)
  useEffect(() => {
    if (agentQueue.length < 2) return
    const timer = window.setInterval(() => setAgentCursor((c) => c + 1), AGENT_HOLD_MS)
    return () => window.clearInterval(timer)
  }, [agentQueue.length])
  const agentNews = agentRotation(agentQueue, agentCursor)

  const agentAction = useMemo(() => {
    let best: { agent: AgentView; action: AgentView['recentActions'][number] } | null = null
    for (const agent of agents) {
      for (const action of agent.recentActions) {
        if (best === null || action.createdAt > best.action.createdAt) best = { agent, action }
      }
    }
    return best
  }, [agents])

  const eventCode = eventItem !== undefined && eventItem.codes.length > 0 ? eventItem.codes[0] : null

  return (
    <div className="ex-ticker ex-ticker-feed" role="status" aria-live="polite">
      <span className="ex-ticker-tag">
        <Bullhorn size={13} /> {T.newFlash}
      </span>
      <div className="ex-ticker-feed-list">
        {eventItem !== undefined ? (
          <div className={`ex-ticker-feed-row is-${eventItem.tone}`} key={eventItem.id}>
            <span
              className={`ex-ticker-impact ${
                eventItem.tone === 'good' ? 'is-bull' : eventItem.tone === 'bad' || eventItem.tone === 'warn' ? 'is-bear' : 'is-neutral'
              }`}
            >
              {toneLabel(eventItem.tone)}
            </span>
            <span className="ex-ticker-time">{newsClock(eventItem.ts, eventItem.id)}</span>
            <b className="ex-ticker-title">{playerText(eventItem.title)}</b>
            {eventCode !== null ? (
              <button
                type="button"
                className="ex-ticker-code-btn"
                title={TF.newsSwitchSymbol(eventCode)}
                aria-label={TF.newsSwitchSymbol(eventCode)}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectCode?.(eventCode)
                }}
              >
                {eventCode}
              </button>
            ) : null}
            <span className="ex-ticker-sep">：</span>
            <span className="ex-ticker-body" title={playerText(eventItem.body)}>
              {shortText(playerText(eventItem.body), BODY_MAX)}
            </span>
          </div>
        ) : (
          <div className="ex-ticker-feed-row is-neutral">
            <span className="ex-ticker-body">{T.noNews}</span>
          </div>
        )}

        {agentNews !== undefined ? (
          <div className="ex-ticker-feed-row is-agent" key={agentNews.id}>
            <span className="ex-ticker-impact is-agent">{T.newsAgentTag}</span>
            <span className="ex-ticker-time">{newsClock(agentNews.ts, agentNews.id)}</span>
            <b className="ex-ticker-title">{playerText(agentNews.title) || T.agentsTab}</b>
            <span className="ex-ticker-sep">：</span>
            <span className="ex-ticker-body" title={playerText(agentNews.body)}>
              {shortText(playerText(agentNews.body), BODY_MAX)}
            </span>
          </div>
        ) : agentAction !== null ? (
          <div className="ex-ticker-feed-row is-agent" key={`ag-${agentAction.action.id}`}>
            <span className="ex-ticker-impact is-agent">{T.newsAgentTag}</span>
            <span className="ex-ticker-time">
              {newsClock(agentAction.action.createdAt, String(agentAction.action.id))}
            </span>
            <b className="ex-ticker-title">{agentAction.agent.name}</b>
            <span className="ex-ticker-sep">·</span>
            <span className="ex-ticker-body">
              {agentAction.action.side === 'buy' ? T.agentsBuy : T.agentsSell}{' '}
              {agentAction.action.code} {amount(agentAction.action.qty)} {T.sharesSuffix}
              {agentAction.action.price > 0 ? ` @${money(agentAction.action.price)}` : ''}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
