import { useEffect, useRef, useState } from 'react'
import { ANNOUNCEMENTS } from '@whale/data'
import { weekendFlagshipBattleActive } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

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
  }
}

export function AnnouncementHub({
  engine,
  onOpen,
}: {
  engine: GameEngine
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string>(() => readSeen())
  const latest = ANNOUNCEMENTS.length > 0 ? ANNOUNCEMENTS[0]! : null
  const unread = latest !== null && latest.id !== seen
  const autoShownRef = useRef(false)

  useEffect(() => {
    if (autoShownRef.current || !unread || !latest) return
    const s = engine.state
    if (s.onboarding.step === 0) return
    if (s.expedition.battle || s.wormhole.run?.battle || weekendFlagshipBattleActive(s)) return
    autoShownRef.current = true
    setOpen(true)
    onOpen?.()
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
    onOpen?.()
  }

  return (
    <>
      <button className="app-btn" onClick={openAndMark} title={tr("ui.Announcements.001")}>
        {tr("ui.Announcements.002")}{unread ? <i className="app-ann-dot" aria-label={tr('ui.Announcements.005')} /> : null}
      </button>
      {open ? (
        <div className="app-ann-mask" onClick={() => setOpen(false)}>
          <div className="app-ann" onClick={(e) => e.stopPropagation()}>
            <div className="app-ann-head">
              <span className="app-ann-title">{tr("ui.Announcements.003")}</span>
              <button className="app-btn is-small" onClick={() => setOpen(false)}>
                {tr("ui.App.100")}
              </button>
            </div>
            <div className="app-ann-list">
              {ANNOUNCEMENTS.map((a) => (
                <div key={a.id} className={`app-ann-item${a.id === latest?.id ? ' is-new' : ''}`}>
                  <div className="app-ann-item-head">
                    <span className="app-ann-tag">{a.tagId ? tr(a.tagId) : a.tag}</span>
                    <span className="app-ann-item-title">{a.titleId ? tr(a.titleId) : a.title}</span>
                    <span className="app-dim">{a.date}</span>
                    {a.id === latest?.id ? <em className="app-chip">{tr('ui.Announcements.004')}</em> : null}
                  </div>
                  <ul className="app-ann-bullets">
                    {a.bullets.map((b, i) => (
                      <li key={i}>{a.bulletIds?.[i] ? tr(a.bulletIds[i]!) : b}</li>
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
