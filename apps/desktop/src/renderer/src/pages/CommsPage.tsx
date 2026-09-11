/**
 * 通讯页（2026-09-11 船长定；设计稿 `docs/design/comms-20260911.md`）。
 *
 * 六条已定决策的落点：
 * - ① 消息来自数据表 + 触发条件（core `advanceComms` 送达，本页只读）；
 * - ② **合并**：T9 建站剧本也进这一页（收件箱条目 `source: 'dialogue'`），本页是玩家侧唯一的 NPC 通信记录；
 * - ③ 消息里的任务**只给提示 + 跳转**（`hint` → 「前往」按钮切到对应页面，不在本页接取/完成）；
 * - ④ 未读：点开即已读（`markCommsReadAt`），导航图标由 App 侧按未读条数闪烁 + 挂数字徽标；
 * - ⑤ 版式：**双列**——左列消息列表（**唯一滚动区**），右列通讯器造型正文；一级页整页不滚；
 * - ⑥ 回复选项**接口预留但未启用**（`COMMS_REPLIES_ENABLED = false` ⇒ 玩家侧不出现任何回复控件）。
 *
 * 视觉纪律：通讯器的不规则边框是 **SVG 线稿**（`preserveAspectRatio="none"` + `vector-effect` 保证
 * 任意尺寸下描边恒为细线），不用 CSS 拼形状（约定第六/九章）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { COMMS_REPLIES_ENABLED, commsGameClock } from '@whale/core'
import type { CommsEntryView } from '@whale/core'
import { Panel } from '@whale/ui'
import type { PageProps } from './common'

/** 通讯器外框线稿（viewBox 0..100 两轴各自拉伸；顶点刻意不完全对齐 ⇒ 不规则的"手作设备"轮廓） */
const FRAME_PATH =
  'M3.2 9.4 L9.6 3.1 L52 2.3 L73.5 3.5 L90.4 2.6 L96.9 10.2 L98.3 44 L97 88.6 L90.2 96.7 L56.5 97.5 L32.5 96.2 L10.6 97.1 L3.6 89.8 L2.1 41.5 Z'

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
                    title={e.read ? '已读' : '未读'}
                  >
                    <span className="app-comms-item-top">
                      {e.read ? null : <i className="app-comms-dot" />}
                      <span className="app-comms-from">{e.from}</span>
                      <span className="app-comms-time">{commsGameClock(e.deliveredAtGameMs)}</span>
                    </span>
                    <span className="app-comms-subject">{e.subject}</span>
                  </button>
                ))}
              </div>

              {/* 右列：通讯器造型正文 */}
              <div className="app-comms-device">
                <svg
                  className="app-comms-frame"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d={FRAME_PATH} vectorEffect="non-scaling-stroke" />
                  {/* 顶栏装饰：左侧信号短线 + 右侧指示灯（同一线稿语言，不填色块） */}
                  <g vectorEffect="non-scaling-stroke">
                    <path d="M6.4 13.2 L16.6 13.2" />
                    <path d="M6.4 16.6 L12.4 16.6" />
                    <path d="M85.6 13.4 L92.6 13.4" />
                  </g>
                </svg>
                <div className="app-comms-detail">
                  {current ? (
                    <>
                      <div className="app-comms-head">
                        <span className="app-comms-head-from">{current.from}</span>
                        <span className="app-comms-head-time">{commsGameClock(current.deliveredAtGameMs)} 送达</span>
                      </div>
                      <div className="app-comms-title">{current.subject}</div>
                      <div className="app-comms-lines">
                        {current.paragraphs.map((p, i) => (
                          <p key={i} className="app-comms-text">
                            {p}
                          </p>
                        ))}
                      </div>
                      {current.hint ? (
                        <div className="app-comms-hint">
                          <span className="app-dim">{current.hint.text}</span>
                          <button
                            className="app-btn is-small is-primary"
                            onClick={() => onGoto(current.hint!.page, current.hint!.tab)}
                          >
                            前往
                          </button>
                        </div>
                      ) : null}
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
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  )
}
