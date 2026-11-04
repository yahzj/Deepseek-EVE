/**
 * 财经快讯 · 竖向播报（2026-11-04 船长：不要横向走马灯，要竖向，一分钟一行）。
 *
 * - 每 60 秒最多追加一行，首屏先显示最新一条；最多保留 4 行；
 * - 只展示玩家向信息：强度话术与影响回合已由服务端写进文案；四象/冲击基点/小盘系数不展示；
 * - 兼容历史快讯：旧文案括号里的内部元信息在前端再兜底剥掉。
 */
import { useEffect, useRef, useState } from 'react'
import { Bullhorn } from '@carbon/icons-react'
import type { NewsItem } from '../client'
import { clock } from '../format'
import { T, TF } from '../texts'

/** 历史快讯里的内部元信息兜底清理（新快讯由服务端直接输出玩家向措辞） */
const LEGACY_META = /（[^（）]*(?:强度|冲击|影响|回合|bp|×)[^（）]*）/g

function playerText(text: string): string {
  return text.replace(LEGACY_META, '').replace(/\s+/g, ' ').trim()
}

function toneLabel(tone: NewsItem['tone']): string {
  if (tone === 'good') return T.newsBull
  if (tone === 'bad' || tone === 'warn') return T.newsBear
  return T.newsNeutral
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

  // 每分钟只追加一行：即使 tick 频繁让 news 变化，也不会刷屏。
  useEffect(() => {
    const appendLatest = (): void => {
      const latest = newsRef.current[0]
      if (latest === undefined || latest.id === lastIdRef.current) return
      lastIdRef.current = latest.id
      setRows((prev) => [latest, ...prev].slice(0, 4))
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
              <span className="ex-ticker-time">{clock(item.ts)}</span>
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
              <span className="ex-ticker-body">{playerText(item.body)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
