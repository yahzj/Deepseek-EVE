/**
 * 财经快讯 · 竖向播报（2026-11-04 船长：不要横向走马灯，要竖向，一分钟一行）。
 *
 * - 每 60 秒最多追加一行，首屏先显示最新一条；最多保留 2 行（2026-11-04 船长指令：快讯最多显示两行，释放垂直视野）；
 * - 只展示玩家向信息：强度话术与影响回合已由服务端写进文案；四象/冲击基点/小盘系数不展示；
 * - 兼容历史快讯：旧文案括号里的内部元信息在前端再兜底剥掉。
 */
import { useEffect, useRef, useState } from 'react'
import { Bullhorn } from '@carbon/icons-react'
import type { NewsItem } from '../client'
import { T, TF } from '../texts'

/** 历史快讯里的内部元信息兜底清理（新快讯由服务端直接输出玩家向措辞） */
const LEGACY_META = /（[^（）]*(?:强度|冲击|影响|回合|bp|×)[^（）]*）/g

/** 人格相关的专有名词与开发原型/AI味标记清洗（2026-11-04 船长令：无AI味新闻稿风格） */
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

/** 判断是否属于纯人格行为快讯（需整条过滤，不展示给玩家） */
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

/** 快讯正文上限：船长令「文字太长显示不全，文案做短」，超出截断并靠悬停看全文 */
const BODY_MAX = 36

function shortText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 每条快讯一个稳定的伪随机秒（01-59）：船长令「秒数在 60 秒里选一个随机数」 */
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
  onSelectCode,
}: {
  news: NewsItem[]
  onSelectCode?: (code: string) => void
}) {
  const newsRef = useRef(news)
  newsRef.current = news
  const [rows, setRows] = useState<NewsItem[]>([])
  const lastIdRef = useRef('')

  // 每分钟只追加一行：即使 tick 频繁让 news 变化，也不会刷屏（最多保留两行，彻底过滤人格快讯）。
  useEffect(() => {
    const appendLatest = (): void => {
      // 过滤掉所有人格行为与提及人格的快讯
      const filtered = newsRef.current.filter((item) => !isPersonalityNews(item))
      const latest = filtered[0]
      if (latest === undefined || latest.id === lastIdRef.current) return
      lastIdRef.current = latest.id
      // 时间早的在上方：新行追加到底部，超出两行时丢掉最上面那条
      setRows((prev) => [...prev.filter((p) => !isPersonalityNews(p)), latest].slice(-2))
    }
    appendLatest()
    const timer = window.setInterval(appendLatest, 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (rows.length === 0) {
    return (
      <div className="ex-ticker ex-ticker-empty" role="status">
        <span className="ex-ticker-tag">
          <Bullhorn size={13} /> {T.newFlash}
        </span>
        <span className="ex-ticker-text">{T.noNews}</span>
      </div>
    )
  }

  return (
    <div className="ex-ticker ex-ticker-feed" role="status" aria-live="polite">
      <span className="ex-ticker-tag">
        <Bullhorn size={13} /> {T.newFlash}
      </span>
      <div className="ex-ticker-feed-list">
        {rows.map((item) => {
          const toneClass =
            item.tone === 'good' ? 'is-bull' : item.tone === 'bad' || item.tone === 'warn' ? 'is-bear' : 'is-neutral'
          const code = item.codes.length > 0 ? item.codes[0] : null
          return (
            <div className={`ex-ticker-feed-row is-${item.tone}`} key={item.id}>
              <span className={`ex-ticker-impact ${toneClass}`}>{toneLabel(item.tone)}</span>
              <span className="ex-ticker-time">{newsClock(item.ts, item.id)}</span>
              <b className="ex-ticker-title">{playerText(item.title)}</b>
              {code !== null ? (
                <button
                  type="button"
                  className="ex-ticker-code-btn"
                  title={TF.newsSwitchSymbol(code)}
                  aria-label={TF.newsSwitchSymbol(code)}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectCode?.(code)
                  }}
                >
                  {code}
                </button>
              ) : null}
              <span className="ex-ticker-sep">：</span>
              <span className="ex-ticker-body" title={playerText(item.body)}>
                {shortText(playerText(item.body), BODY_MAX)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
