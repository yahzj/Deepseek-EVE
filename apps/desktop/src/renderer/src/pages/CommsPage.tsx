/**
 * 通讯页（2026-09-11 船长定；设计稿 `docs/design/comms-20260911.md` + `docs/design/npc-factions-20260911.md`）。
 *
 * 六条已定决策的落点：
 * - ① 消息来自数据表 + 触发条件（core `advanceComms` 送达，本页只读）；
 * - ② **合并**：T9 建站剧本也进这一页（收件箱条目 `source: 'dialogue'`），本页是玩家侧唯一的 NPC 通信记录；
 * - ③ 消息里的任务**只给提示 + 跳转**（`hint` → 「前往」按钮切到对应页面，不在本页接取/完成）；
 * - ④ 未读：点开即已读（`markCommsReadAt`），导航图标由 App 侧按未读条数闪烁 + 挂数字徽标；
 * - ⑤ 版式：**双列**——左列消息列表（**唯一滚动区**），右列通讯器造型正文；一级页整页不滚；
 * - ⑥ 回复选项**接口预留但未启用**（`COMMS_REPLIES_ENABLED = false` ⇒ 玩家侧不出现任何回复控件）。
 *
 * v2 视觉（2026-09-11 船长：按参考图**只借边框线条**、配色保持现有风格、不要avatar/未解锁占位/装饰动效）：
 * - 通讯器 = **机身式大圆角外框 + 内嵌屏幕圆角框**（双层线，SVG 线稿 + `vector-effect` 恒定细描边）；
 * - 左侧列表 = 圆角行块；屏幕内三层信息 = 大标题（右侧内容类型小片）→ 细分隔条（发件人 + 立场小片）→ 正文；
 * - 底部 = 通栏胶囊「前往」（仅带跳转提示的消息出现）；立场/内容类型小片复用全仓 `.app-chip` 家族。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { COMMS_REPLIES_ENABLED, commsGameClock } from '@whale/core'
import type { CommsEntryView } from '@whale/core'
import { Panel } from '@whale/ui'
import { Glyph } from '../ui/Glyphs'
import type { PageProps } from './common'

/**
 * 通讯器机身外框：大圆角机身 + 内嵌屏幕圆角框（参考图借来的"线条/圆角"语言）。
 * 外框与内屏都走 SVG 线稿 + `vectorEffect="non-scaling-stroke"`，任意尺寸下描边恒为细线；
 * 配色沿用现有风格（机身线 = 面板边框色，屏幕线 = 通讯青白蓝），不照搬参考图的卡带配色。
 */
function CommsDeviceFrame(): ReactNode {
  return (
    <svg className="app-comms-frame" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {/* 机身 */}
      <rect x="1.1" y="1.1" width="97.8" height="97.8" rx="5" vectorEffect="non-scaling-stroke" />
      {/* 内嵌屏幕（与外框同语言的双层线） */}
      <rect x="5.2" y="7.4" width="89.6" height="85.2" rx="3" vectorEffect="non-scaling-stroke" />
      {/* 左侧两颗实体键（参考图侧键的抽象化，只留短线） */}
      <path d="M2.4 34 L2.4 42" vectorEffect="non-scaling-stroke" />
      <path d="M2.4 52 L2.4 58" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function CommsPage({
  engine,
  onToast,
  onGoto,
}: PageProps & {
  /** 跳转出口（App 提供）：消息提示 → 对应一级页（可带页面内标签） */
  onGoto: (page: string, tab?: string) => void
}): ReactNode {
  const state = engine.state
  const inbox = useMemo(() => engine.commsInboxView(), [state, state.gameMs, engine])
  const unread = inbox.filter((e) => !e.read).length

  // 选中项：默认最新一封；列表变化（新消息到达）后若原先选中的还在就保持不变
  const [sel, setSel] = useState<string | null>(null)
  const current: CommsEntryView | null = inbox.find((e) => e.id === sel) ?? inbox[0] ?? null

  // ⑤ 点开即已读（含默认展开的那一封）
  useEffect(() => {
    if (!current || current.read) return
    const r = engine.markCommsReadAt(current.id)
    if (!r.ok && r.error) onToast(r.error, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.read])

  function markAll(): void {
    const n = engine.markAllCommsReadNow()
    onToast(n > 0 ? `已把 ${n} 封通讯标为已读。` : '收件箱里没有未读通讯。')
  }

  return (
    <div className="page-stack page-fill">
      <Panel
        className="is-fill win-fixed-body"
        title="通讯"
        right={
          <>
            <span className="app-dim" title="收件箱永久保留历史记录；剧本通话（建站介绍与并网通报）也会归入这里">
              {inbox.length} 封 · 未读 {unread}
            </span>
            <button
              className="app-btn is-small"
              disabled={unread === 0}
              title={unread === 0 ? '没有未读通讯' : '把收件箱里的未读通讯一次全部标为已读'}
              onClick={markAll}
            >
              全部标记已读
            </button>
          </>
        }
      >
        <div className="app-dim app-note">
          协会各部门与合作方有事会直接发到这里。带「前往」的通讯只是提示你该去哪儿，具体事务仍要在对应页面上办。
        </div>
        <div className="app-win-body app-comms-body">
          {inbox.length === 0 ? (
            <div className="app-dim app-exp-idle">收件箱是空的——有新的消息会先让导航栏的「通讯」图标闪起来。</div>
          ) : (
            <div className="app-comms-grid">
              {/* 左列：消息列表（本页唯一滚动区） */}
              <div className="app-comms-list" role="list">
                {inbox.map((e) => (
                  <button
                    key={e.id}
                    role="listitem"
                    className={`app-comms-item${current && e.id === current.id ? ' is-sel' : ''}${e.read ? '' : ' is-unread'}`}
                    onClick={() => setSel(e.id)}
                    title={e.fromBrief ? `${e.fromBrief}（${e.read ? '已读' : '未读'}）` : e.read ? '已读' : '未读'}
                  >
                    <span className="app-comms-item-top">
                      {e.read ? null : <i className="app-comms-dot" />}
                      {e.glyph ? (
                        <span className="app-ico">
                          <Glyph name={e.glyph} size={12} color={e.tone || undefined} />
                        </span>
                      ) : null}
                      <span className="app-comms-from">{e.from}</span>
                      <span className="app-comms-time">{commsGameClock(e.deliveredAtGameMs)}</span>
                    </span>
                    <span className="app-comms-subject">{e.subject}</span>
                  </button>
                ))}
              </div>

              {/* 右列：通讯器（机身 + 内嵌屏幕 + 屏幕下方通栏「前往」） */}
              <div className="app-comms-device">
                <CommsDeviceFrame />
                <div className="app-comms-body-col">
                  <div className="app-comms-screen">
                    {current ? (
                      <>
                        {/* 屏幕第一层：大标题 + 右侧内容类型小片 */}
                        <div className="app-comms-title-row">
                          <span className="app-comms-title">{current.subject}</span>
                          {current.kind ? (
                            <span
                              className="app-chip app-comms-kind"
                              style={current.tone ? { color: current.tone, borderColor: current.tone } : undefined}
                              title="这封通讯的性质：提示只是指个方向，委托才是协会派下来的活"
                            >
                              {current.kind}
                            </span>
                          ) : null}
                        </div>
                        {/* 屏幕第二层：细分隔条（发件人 + 立场小片 + 送达时间） */}
                        <div className="app-comms-head">
                          <span className="app-comms-head-from" style={current.tone ? { color: current.tone } : undefined}>
                            {current.from}
                          </span>
                          {current.alignment ? (
                            <span
                              className="app-chip app-comms-align"
                              style={current.tone ? { color: current.tone, borderColor: current.tone } : undefined}
                              title={current.fromBrief}
                            >
                              {current.alignment}
                            </span>
                          ) : null}
                          <span className="app-comms-head-time">{commsGameClock(current.deliveredAtGameMs)} 送达</span>
                        </div>
                        {/* 屏幕第三层：正文 */}
                        <div className="app-comms-lines">
                          {current.paragraphs.map((p, i) => (
                            <p key={i} className="app-comms-text">
                              {p}
                            </p>
                          ))}
                        </div>
                        {/* ⑥ 回复选项：接口保留、本期不启用（COMMS_REPLIES_ENABLED = false → 不渲染任何控件） */}
                        {COMMS_REPLIES_ENABLED && current.replies && current.replies.length > 0 ? (
                          <div className="app-comms-replies">
                            {current.replies.map((r) => (
                              <button key={r.id} className="app-btn is-small" disabled>
                                {r.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {/* 屏幕下方：通栏胶囊「前往」（没有跳转提示的消息不出现） */}
                  {current?.hint ? (
                    <button
                      className="app-btn is-primary app-comms-goto"
                      title={current.hint.text}
                      onClick={() => onGoto(current.hint!.page, current.hint!.tab)}
                    >
                      <span className="app-comms-goto-text">{current.hint.text}</span>
                      <span className="app-comms-goto-label">前往</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
