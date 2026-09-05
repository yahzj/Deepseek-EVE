/**
 * 游戏内更新公告（2026-09-05 船长定）——顶栏「公告」入口：
 * - 未读 = 最新公告 id 与本地已读（whale-idle:announce-seen）不一致 → 按钮红点；
 * - 启动时若存在未读（且非序章演出/教程进行中/交火中）自动弹一次；
 * - 打开即标记已读；按钮可随时回看历史公告。
 * 发布方式见 docs/development-conventions.md 第十二章 + packages/data/src/announcements.ts。
 */
import { useEffect, useRef, useState } from 'react'
import { ANNOUNCEMENTS } from '@whale/data'
import type { GameEngine } from '../game/engine'

const SEEN_KEY = 'whale-idle:announce-seen'

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, id)
  } catch {
    // 忽略（隐私模式等）
  }
}

export function AnnouncementHub({ engine }: { engine: GameEngine }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string>(() => readSeen())
  const latest = ANNOUNCEMENTS.length > 0 ? ANNOUNCEMENTS[0]! : null
  const unread = latest !== null && latest.id !== seen
  const autoShownRef = useRef(false)

  // 启动自动弹一次：非序章演出 / 非教程步骤 1..7 / 非交火中
  useEffect(() => {
    if (autoShownRef.current || !unread || !latest) return
    const s = engine.state
    const tut = s.onboarding.step
    if (tut === 0 || (tut >= 1 && tut <= 7)) return
    if (s.expedition.battle) return
    autoShownRef.current = true
    setOpen(true)
    writeSeen(latest.id)
    setSeen(latest.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread])

  const openAndMark = (): void => {
    if (latest) {
      writeSeen(latest.id)
      setSeen(latest.id)
    }
    setOpen(true)
  }

  return (
    <>
      <button className="app-btn" onClick={openAndMark} title="游戏更新公告">
        公告{unread ? <i className="app-ann-dot" aria-label="有未读公告" /> : null}
      </button>
      {open ? (
        <div className="app-ann-mask" onClick={() => setOpen(false)}>
          <div className="app-ann" onClick={(e) => e.stopPropagation()}>
            <div className="app-ann-head">
              <span className="app-ann-title">📣 更新公告</span>
              <button className="app-btn is-small" onClick={() => setOpen(false)}>
                知道了
              </button>
            </div>
            <div className="app-ann-list">
              {ANNOUNCEMENTS.map((a) => (
                <div key={a.id} className={`app-ann-item${a.id === latest?.id ? ' is-new' : ''}`}>
                  <div className="app-ann-item-head">
                    <span className="app-ann-tag">{a.tag}</span>
                    <span className="app-ann-item-title">{a.title}</span>
                    <span className="app-dim">{a.date}</span>
                    {a.id === latest?.id ? <em className="app-chip">新</em> : null}
                  </div>
                  <ul className="app-ann-bullets">
                    {a.bullets.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
