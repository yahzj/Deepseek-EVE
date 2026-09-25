/**
 * 游戏内更新公告（2026-09-05 船长定）——顶栏「公告」入口：
 * - 未读 = 最新公告 id 与本地已读（whale-idle:announce-seen）不一致 → 按钮红点；
 * - 启动时若存在未读（且非序章演出/教程进行中/交火中）自动弹一次；
 * - 打开即标记已读；按钮可随时回看历史公告。
 * 发布方式见 docs/development-conventions.md 第十二章 + packages/data/src/announcements.ts。
 */
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
    // 忽略（隐私模式等）
  }
}

export function AnnouncementHub({
  engine,
  onOpen,
}: {
  engine: GameEngine
  /**
   * 弹层**打开**时的通知（2026-09-21 船长令：打开详情窗/手册/设置等弹层时要收起嵌入主区的窗口）。
   * 本组件自己管开关，App 无从知晓 ⇒ 由这里回调一次；不传则什么都不做（行为与从前完全一致）。
   * ⚠ 两条打开路径都要叫：启动自动弹一次、点顶栏「公告」。
   */
  onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState<string>(() => readSeen())
  const latest = ANNOUNCEMENTS.length > 0 ? ANNOUNCEMENTS[0]! : null
  const unread = latest !== null && latest.id !== seen
  const autoShownRef = useRef(false)

  // 启动自动弹一次：非序章演出中 / 非交火中
  useEffect(() => {
    if (autoShownRef.current || !unread || !latest) return
    const s = engine.state
    // 序章演出（step 0）盖着全屏，此刻弹公告只会压在演出上；演出一结束即可弹
    // （2026-09-17 教程重做：原先还要跳过"教程步骤 1..7"，那七步已退场，只剩演出态这一档）
    if (s.onboarding.step === 0) return
    // ⚠ 2026-09-14 修：洞内战斗宿主在 `state.wormhole.run.battle`（不占 `expedition.battle`）——
    //   原先只挡远征 ⇒ 洞里鏖战时公告照样弹出来挡住战场。
    // ⚠ 2026-09-25 同款补第三个宿主（入侵旗舰战 · 承载在遭遇槽）——判据走 core 单点。
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
                    <span className="app-ann-tag">{a.tag}</span>
                    <span className="app-ann-item-title">{a.title}</span>
                    <span className="app-dim">{a.date}</span>
                    {a.id === latest?.id ? <em className="app-chip">{tr('ui.Announcements.004')}</em> : null}
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
