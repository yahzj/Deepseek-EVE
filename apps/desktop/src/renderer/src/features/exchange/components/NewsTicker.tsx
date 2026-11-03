/**
 * 财经快讯走马灯。
 *
 * 优化（对齐玩家吐槽 1）：
 * - 每条快讯标「利多/利空/中性 + 标的代码 + 影响百分比」彩色徽标；
 * - 复制一份做无缝循环，悬停暂停；`prefers-reduced-motion` 时退回横向滚动。
 */
import { Bullhorn } from '@carbon/icons-react'
import type { NewsItem } from '../client'
import { clock } from '../format'
import { T, TF } from '../texts'

/** 根据快讯 id 与 tone 生成确定性的影响幅度与方向描述 */
function getNewsImpact(item: NewsItem): {
  dirText: string
  pctText: string
  isUp: boolean | null
  primaryCode?: string
} {
  // 简易哈希保证同一条快讯读数稳定
  let hash = 0
  for (let i = 0; i < item.id.length; i++) {
    hash = (hash * 31 + item.id.charCodeAt(i)) & 0xffffffff
  }
  const pctVal = 2.0 + Math.abs(hash % 45) / 10 // 2.0% ~ 6.4%
  const primaryCode = item.codes.length > 0 ? item.codes[0] : undefined

  if (item.tone === 'good') {
    return {
      dirText: T.newsBull,
      pctText: `+${pctVal.toFixed(1)}%`,
      isUp: true,
      primaryCode,
    }
  }
  if (item.tone === 'bad') {
    return {
      dirText: T.newsBear,
      pctText: `-${pctVal.toFixed(1)}%`,
      isUp: false,
      primaryCode,
    }
  }
  if (item.tone === 'warn') {
    return {
      dirText: T.newsBear,
      pctText: `-${(pctVal * 0.6).toFixed(1)}%`,
      isUp: false,
      primaryCode,
    }
  }
  return {
    dirText: T.newsNeutral,
    pctText: `±0.5%`,
    isUp: null,
    primaryCode,
  }
}

export function NewsTicker({ news }: { news: NewsItem[] }) {
  if (news.length === 0) {
    return (
      <div className="ex-ticker ex-ticker-empty" role="status">
        <span className="ex-ticker-tag"><Bullhorn size={13} /> {T.newFlash}</span>
        <span className="ex-ticker-text">{T.noNews}</span>
      </div>
    )
  }
  const loop = news.slice(0, 8)
  return (
    <div className="ex-ticker" role="status" aria-live="off">
      <span className="ex-ticker-tag"><Bullhorn size={13} /> {T.newFlash}</span>
      <div className="ex-ticker-viewport">
        <div className="ex-ticker-track">
          {[0, 1].map((copy) => (
            <div className="ex-ticker-group" key={copy} aria-hidden={copy === 1}>
              {loop.map((item) => {
                const impact = getNewsImpact(item)
                const impactTag = TF.newsImpactTag(impact.dirText, impact.pctText, impact.primaryCode)
                const toneClass =
                  impact.isUp === true ? 'is-bull' : impact.isUp === false ? 'is-bear' : 'is-neutral'

                return (
                  <span className={`ex-ticker-item is-${item.tone}`} key={`${copy}-${item.id}`}>
                    <span className={`ex-ticker-impact ${toneClass}`}>{impactTag}</span>
                    <span className="ex-ticker-time">{clock(item.ts)}</span>
                    <b className="ex-ticker-title">{item.title}</b>
                    <span className="ex-ticker-sep">：</span>
                    <span className="ex-ticker-body">{item.body}</span>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
