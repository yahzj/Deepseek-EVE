/**
 * 财经快讯走马灯。
 *
 * 为什么用「内容复制一遍 + CSS 平移」而不是逐条轮播：原型要的是"随时有东西在动"的交易所氛围，
 * 复制一份做无缝循环成本最低，也不会因为定时切条与 1 秒行情 tick 抢渲染。
 * 悬停暂停；`prefers-reduced-motion` 时退回可横向滚动的静态列表。
 */
import type { NewsItem } from '../client'
import { clock } from '../format'
import { T } from '../texts'

function flashText(item: NewsItem): string {
  return `${clock(item.ts)} ${item.title}：${item.body}`
}

export function NewsTicker({ news }: { news: NewsItem[] }) {
  if (news.length === 0) {
    return (
      <div className="ex-ticker ex-ticker-empty" role="status">
        <span className="ex-ticker-tag">{T.newFlash}</span>
        <span className="ex-ticker-text">{T.noNews}</span>
      </div>
    )
  }
  const loop = news.slice(0, 8)
  return (
    <div className="ex-ticker" role="status" aria-live="off">
      <span className="ex-ticker-tag">{T.newFlash}</span>
      <div className="ex-ticker-viewport">
        <div className="ex-ticker-track">
          {[0, 1].map((copy) => (
            <div className="ex-ticker-group" key={copy} aria-hidden={copy === 1}>
              {loop.map((item) => (
                <span className={`ex-ticker-item is-${item.tone}`} key={`${copy}-${item.id}`}>
                  {flashText(item)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
