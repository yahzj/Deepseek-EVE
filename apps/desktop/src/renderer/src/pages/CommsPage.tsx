import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { type CommsEntryView } from '@whale/core'
import { Panel } from '@whale/ui'
import { CommsDeviceFrame, CommsEave, CommsScreen } from '../panels/CommsReader'
import { Glyph } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import type { PageProps } from './common'
import { cmdText, tr } from '../i18n/locale'
import { commsBriefText, commsClockText, commsEntrySubjectText, commsSenderText } from '../ui/commsText'
import { WeekendSummaryView } from '../panels/WeekendSummary'
import { PlugExchangeModal } from '../panels/PlugExchange'
import { sessionPick, setSessionPick, useSessionScroll } from '../ui/sessionView'
import { fmtDuration } from '../i18n/fmt'
import { WreckFitPanel } from '../panels/WreckFitPanel'


export function CommsPage({
  engine,
  onToast,
  onGoto,
  onOpenPlugExchange,
  focus,
}: PageProps & {
  onGoto: (page: string, tab?: string, shipTab?: string, taskTab?: string, skillBranch?: string) => void
  onOpenPlugExchange?: () => void
  focus?: { id: string; seq: number } | null
}): ReactNode {
  const state = engine.state
  const [view, setView] = useState<'inbox' | 'wreck'>('inbox')
  const wrecks = useMemo(() => engine.wreckLogView(), [state, state.gameMs, engine])
  const inbox = useMemo(() => engine.commsInboxView(), [state, state.gameMs, engine])
  const unread = inbox.filter((e) => !e.read).length

  const [sel, setSel] = useState<string | null>(() => sessionPick('comms.sel'))
  useEffect(() => {
    setSessionPick('comms.sel', sel)
  }, [sel])
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('comms.list.scroll', listScrollRef)
  const [showSummary, setShowSummary] = useState(false)
  const [showPlugExchange, setShowPlugExchange] = useState(false)
  const focusSeq = focus?.seq ?? -1
  const lastFocusSeq = useRef(-1)
  useEffect(() => {
    if (focusSeq < 0 || focusSeq === lastFocusSeq.current) return
    lastFocusSeq.current = focusSeq
    if (focus?.id) setSel(focus.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])
  const current: CommsEntryView | null = inbox.find((e) => e.id === sel) ?? inbox[0] ?? null

  useEffect(() => {
    if (!current || current.read) return
    const r = engine.markCommsReadAt(current.id)
    if (!r.ok) onToast(cmdText(r) || tr('ui.CommsPage.012'), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.read])

  function markAll(): void {
    const n = engine.markAllCommsReadNow()
    onToast(n > 0 ? tr("ui.CommsPage.001", { n: n }) : tr("ui.CommsPage.002"))
  }


  return (
    <div className="page-stack page-fill">
      <Panel
        className="is-fill win-fixed-body"
        title={tr("ui.App.009")}
      hint={
        <HintIcon tip={tr("ui.CommsPage.003")} />
      }
        right={
          <>
            <span className="app-dim" title={tr("ui.CommsPage.004")}>
              {inbox.length} {tr("ui.CommsPage.005")} {unread}
            </span>
            <button
              className="app-btn is-small"
              disabled={unread === 0}
              title={unread === 0 ? tr("ui.CommsPage.006") : tr("ui.CommsPage.007")}
              onClick={markAll}
            >
              {tr("ui.CommsPage.008")}
            </button>
          </>
        }
      >
        <div className="app-win-body app-comms-body">
          {/* 分类切换（2026-09-27）：收件箱 / 沉船记录 —— 复用同页既有按钮族 */}
          <div className="app-tasktabs" role="tablist" style={{ marginBottom: 'var(--wui-sp-5)' }}>
            <button
              role="tab"
              aria-selected={view === 'inbox'}
              className={`app-tasktab${view === 'inbox' ? ' is-active' : ''}`}
              onClick={() => setView('inbox')}
            >
              {tr('ui.WreckLog.002')}
            </button>
            <button
              role="tab"
              aria-selected={view === 'wreck'}
              className={`app-tasktab${view === 'wreck' ? ' is-active' : ''}`}
              onClick={() => setView('wreck')}
            >
              {tr('ui.WreckLog.001')}
            </button>
          </div>
          {view === 'wreck' ? (
            <WreckLogPane engine={engine} rows={wrecks} />
          ) : inbox.length === 0 ? (
            <div className="app-dim app-exp-idle">{tr("ui.CommsPage.009")}</div>
          ) : (
            <div className="app-comms-grid">
              {/* 左列：消息列表（内部滚动；右侧屏幕也各自滚） */}
              <div className="app-comms-list" role="list" ref={listScrollRef}>
                {inbox.map((e) => (
                  <button
                    key={e.id}
                    role="listitem"
                    className={`app-comms-item${current && e.id === current.id ? ' is-sel' : ''}${e.read ? '' : ' is-unread'}`}
                    onClick={() => setSel(e.id)}
                    title={e.fromBrief ? `${commsBriefText(e.fromBrief)}（${e.read ? tr("ui.CommsPage.010") : tr("ui.CommsPage.011")}）` : e.read ? tr("ui.CommsPage.010") : tr("ui.CommsPage.011")}
                  >
                    <span className="app-comms-item-top">
                      {e.read ? null : <i className="app-comms-dot" />}
                      {e.glyph ? (
                        <span className="app-ico">
                          <Glyph name={e.glyph} size={18} color={e.tone || undefined} />
                        </span>
                      ) : null}
                      {/* ⚠ 发件人/时间/主题都是数据侧中文 ⇒ 过 `ui/commsText.ts` 单点映射（2026-09-22 通讯本地化批） */}
                      <span className="app-comms-from">{commsSenderText(e.from)}</span>
                      <span className="app-comms-time">{commsClockText(e.deliveredAtGameMs)}</span>
                    </span>
                    {/* ⚠ 发件人/时间/主题都是数据侧中文 ⇒ 过 `ui/commsText.ts` 单点映射（2026-09-22 通讯本地化批）
                        ⚠ 2026-09-30 批 5：**实例通讯**（带 `subjectId` 的，如周末入侵警告）必须走
                        `commsEntrySubjectText` —— 它的主题是"模板 ＋ 参数"，静态 id 表里查不到。 */}
                    <span className="app-comms-subject">{commsEntrySubjectText(e, (id) => engine.ctx.items.get(id)?.name ?? id)}</span>
                  </button>
                ))}
              </div>

              {/* 右列：通讯器（机身 + 内嵌屏幕 + 屏幕下方通栏「前往」）
                  —— 屏幕与檐口来自公共件 `panels/CommsReader.tsx`，与送达弹窗**同源** */}
              <div className="app-comms-device">
                <CommsDeviceFrame />
                <div className="app-comms-body-col">
                  {current ? (
                    <CommsScreen entry={current} itemNameOf={(id) => engine.ctx.items.get(id)?.name ?? id} />
                  ) : (
                    <div className="app-comms-screen" />
                  )}
                  {current ? (
                    <CommsEave
                      entry={current}
                      onGoto={onGoto}
                      /** 实例通讯的"弹面板"出口（2026-09-25）：入侵结算信 → 本场战果面板；
                       *  **2026-09-26 船长令**「**通讯内跳转**」⇒ 首匣那封信直达章鱼人兑换窗口 */
                      onAction={(a) => {
                        if (a === 'weekendSummary') setShowSummary(true)
                        if (a === 'plug-exchange') (onOpenPlugExchange ?? (() => setShowPlugExchange(true)))()
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>
      {/**
       * **入侵结算面板**（2026-09-25 船长令：结算通讯的跳转「点击后弹出类似虫洞撤离的结算界面」）。
       * 弹层结构复用全仓既有的 `.app-modal-*` 族（不自造窗口观感）。
       */}
      {showSummary && state.weekendLastResult !== undefined ? (
        <div className="app-modal-mask" onClick={() => setShowSummary(false)}>
          <div className="app-modal app-modal-wide app-weekend-sum" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{tr('ui.weekend.030')}</span>
              <button className="app-btn is-small" onClick={() => setShowSummary(false)}>
                {tr('ui.App.086')}
              </button>
            </div>
            <div className="app-modal-body">
              <WeekendSummaryView engine={engine} onClose={() => setShowSummary(false)} />
            </div>
          </div>
        </div>
      ) : null}
      {/**
       * **旧「章鱼人兑换」弹层**（2026-09-26 船长令立；**2026-09-27 甲案**撤入口）。
       * 首匣那封信的「前往」现在走 `onOpenPlugExchange`（App 层：切到星图页 · 常驻悬赏 ·
       * 「声望商店」子页）⇒ 本层**只在没有该回调时**才可能亮（保留待删，见 `App.tsx` 同处注释）。
       */}
      {showPlugExchange ? (
        <PlugExchangeModal engine={engine} onToast={onToast} onClose={() => setShowPlugExchange(false)} />
      ) : null}
    </div>
  )
}

function WreckLogPane({ engine, rows }: { engine: PageProps['engine']; rows: ReturnType<PageProps['engine']['wreckLogView']> }): ReactNode {
  const engineCtx = engine
  const [sel, setSel] = useState<string | null>(null)
  if (rows.length === 0) return <div className="app-dim app-exp-idle">{tr('ui.WreckLog.003')}</div>
  const cur = rows.find((r) => String(r.entry.seq) === sel) ?? rows[0]!
  const e = cur.entry
  const shipName = (id: string | undefined): string =>
    id === undefined ? '—' : (engineCtx.ctx.ships.get(id)?.name ?? id)
  const clock = (ms: number): string => fmtDuration(Math.max(0, ms))
  const cause = tr(
    e.cause === 'ai-lost'
      ? 'ui.WreckLog.017'
      : e.cause === 'wormhole-sunk'
        ? 'ui.WreckLog.018'
        : e.cause === 'wormhole-lost'
          ? 'ui.WreckLog.019'
          : e.cause === 'encounter-lost'
            ? 'ui.WreckLog.021'
            : 'ui.WreckLog.016',
  )
  const where =
    e.wormholeDepth !== undefined
      ? tr('ui.WreckLog.015', { p1: e.wormholeDepth })
      : (engineCtx.ctx.galaxies.get(e.galaxyId ?? '')?.name ?? e.galaxyId ?? '—')
  const wreckText =
    cur.wreck === 'salvageable'
      ? tr('ui.WreckLog.011', { p1: clock(cur.leftMs ?? 0) })
      : cur.wreck === 'recovered'
        ? tr('ui.WreckLog.012')
        : cur.wreck === 'expired'
          ? tr('ui.WreckLog.013')
          : tr('ui.WreckLog.014')
  return (
    <div className="app-comms-grid">
      <div className="app-comms-list" role="list">
        {rows.map((r) => (
          <button
            key={r.entry.seq}
            role="listitem"
            className={`app-comms-item${String(r.entry.seq) === String(cur.entry.seq) ? ' is-sel' : ''}`}
            onClick={() => setSel(String(r.entry.seq))}
          >
            <span className="app-comms-item-top">
              <span className="app-comms-from">{r.entry.shipName}</span>
              <span className="app-comms-time">{clock(Math.max(0, engineCtx.state.gameMs - r.entry.atGameMs))}</span>
            </span>
            <span className="app-comms-subject">{shipName(r.entry.defId)}</span>
          </button>
        ))}
      </div>
      <div className="app-comms-device">
        <div className="app-comms-body-col">
          <div className="app-comms-screen">
            <div className="app-dim" style={{ marginBottom: 'var(--wui-sp-4)' }}>{tr('ui.WreckLog.007')}</div>
            <div className="app-kv"><span>{tr('ui.WreckLog.020')}</span><span>{shipName(e.defId)}</span></div>
            <div className="app-kv"><span>{tr('ui.WreckLog.004')}</span><span>{cause}</span></div>
            <div className="app-kv"><span>{tr('ui.WreckLog.005')}</span><span>{where}</span></div>
            <div className="app-kv"><span>{tr('ui.WreckLog.010')}</span><span>{wreckText}</span></div>
            <WreckFitPanel key={e.seq} engine={engine} entry={e} />
          </div>
        </div>
      </div>
    </div>
  )
}

