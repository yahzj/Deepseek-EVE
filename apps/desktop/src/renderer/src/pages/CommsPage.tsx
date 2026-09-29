/**
 * 通讯页（2026-09-11 船长定；设计稿 `docs/design/comms-20260911.md` + `docs/design/npc-factions-20260911.md`）。
 *
 * 六条已定决策的落点：
 * - ① 消息来自数据表 + 触发条件（core `advanceComms` 送达，本页只读）；
 * - ② **合并**：T9 建站剧本也进这一页（收件箱条目 `source: 'dialogue'`），本页是玩家侧唯一的 NPC 通信记录；
 * - ③ 消息里的任务**只给提示 + 跳转**（`hint` → 「前往」按钮切到对应页面，不在本页接取/完成）；
 * - ④ 未读：点开即已读（`markCommsReadAt`），导航图标由 App 侧按未读条数闪烁 + 挂数字徽标；
 * - ⑤ 版式：**双列**——左列消息列表（内部滚动）、右列通讯器造型正文（屏幕自身滚动，长简报靠它读完）；
 *   一级页整页不滚；
 * - ⑥ 回复选项**接口预留但未启用**（`COMMS_REPLIES_ENABLED = false` ⇒ 玩家侧不出现任何回复控件）。
 *
 * v2 视觉（2026-09-11 船长：按参考图**只借边框线条**、配色保持现有风格、不要头像/未解锁占位/装饰动效）：
 * - 通讯器 = **机身式大圆角外框 + 内嵌屏幕圆角框**（双层线，SVG 线稿 + `vector-effect` 恒定细描边）；
 * - 左侧列表 = 圆角行块；屏幕内三层信息 = 大标题（右侧内容类型小片）→ 细分隔条（发件人 + 立场小片）→ 正文；
 * - 底部 = 通栏胶囊「前往」（仅带跳转提示的消息出现）；立场/内容类型小片复用全仓 `.app-chip` 家族。
 *
 * 2026-09-11 船长追加：屏幕**左上角**绘制**章鱼头 SVG**（`faction-octopus`）代表**官方章鱼人**——
 * 该头像之后都用于代表官方章鱼人（所有 NPC 势力物种皆为章鱼人，只靠色调区分，见 `data/commsFactions.ts`）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { type CommsEntryView } from '@whale/core'
import { Panel } from '@whale/ui'
import { CommsDeviceFrame, CommsEave, CommsScreen } from '../panels/CommsReader'
import { Glyph } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import type { PageProps } from './common'
import { cmdText, tr } from '../i18n/locale'
import { commsBriefText, commsClockText, commsSenderText, commsSubjectText } from '../ui/commsText'
import { WeekendSummaryView } from '../panels/WeekendSummary'
import { PlugExchangeModal } from '../panels/PlugExchange'
import { sessionPick, setSessionPick, useSessionScroll } from '../ui/sessionView'
import { fmtDuration } from '../i18n/fmt'

/**
 * ⚠ **右栏（机身 + 内嵌屏幕 + 下檐口）已抽成公共件 `panels/CommsReader.tsx`**
 * （2026-09-14 船长：「将所有的通讯弹窗的外形，改成和通讯界面内的右侧界面的相同」）——
 * 通讯页右栏与送达弹窗**同源**渲染，两处不会再各长一样。本页只负责左列列表、选中态与已读。
 */

export function CommsPage({
  engine,
  onToast,
  onGoto,
  onOpenPlugExchange,
  focus,
}: PageProps & {
/** 跳转出口（App 提供）：消息提示 → 对应一级页（可带星图标签 `tab`、任务中心内层标签 `taskTab`、舰船标签 `shipTab`） */
  onGoto: (page: string, tab?: string, shipTab?: string, taskTab?: string) => void
  /** 「前往章鱼人兑换」出口（**2026-09-26 船长令**：首匣那封信的跳转要直达**章鱼人声望商店**）。
   *  走 App 的**唯一开窗入口**（它同时把组装机切到「舰船插件」档）⇒ 三条入口行为一致。 */
  onOpenPlugExchange?: () => void
  /** 定位请求（2026-09-11 教程融入通讯）：顶部引导条「看详情」→ 选中指定那封（seq 变化即重新选中） */
  focus?: { id: string; seq: number } | null
}): ReactNode {
  const state = engine.state
  /**
   * **通讯分类**（**2026-09-27 船长令**：「在通讯内新增一个用于记录玩家损失的舰船和舰船上有什么装配」）：
   * 收件箱 / 沉船记录。左列切换，右列各看各的详情。
   */
  const [view, setView] = useState<'inbox' | 'wreck'>('inbox')
  const wrecks = useMemo(() => engine.wreckLogView(), [state, state.gameMs, engine])
  const inbox = useMemo(() => engine.commsInboxView(), [state, state.gameMs, engine])
  const unread = inbox.filter((e) => !e.read).length

  /**
   * 选中项：默认最新一封；列表变化（新消息到达）后若原先选中的还在就保持不变。
   * **2026-09-26 船长令**：选中哪封 ＋ 列表滚动位置都做**会话级记忆** ⇒ 切走再回来还是那一封、那一处
   * （记忆只在本进程内有效，见 `ui/sessionView.ts`；不在列表里的旧 id 自然落回"最新一封"）。
   */
  const [sel, setSel] = useState<string | null>(() => sessionPick('comms.sel'))
  /** 会话级写回：玩家每次换信都记一笔（外部定位进来的选中也走这里） */
  useEffect(() => {
    setSessionPick('comms.sel', sel)
  }, [sel])
  /** 信件列表的滚动位置（"只记主要列表那一条"） */
  const listScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('comms.list.scroll', listScrollRef)
  /** 入侵结算面板开合（2026-09-25；由实例通讯的跳转按钮触发） */
  const [showSummary, setShowSummary] = useState(false)
  /** 章鱼人兑换窗口（2026-09-26 船长令：首匣那封信的「前往」直达这里） */
  const [showPlugExchange, setShowPlugExchange] = useState(false)
  // 外部定位请求（教程「看详情」）：seq 变化时覆盖当前选中项
  const focusSeq = focus?.seq ?? -1
  const lastFocusSeq = useRef(-1)
  useEffect(() => {
    if (focusSeq < 0 || focusSeq === lastFocusSeq.current) return
    lastFocusSeq.current = focusSeq
    if (focus?.id) setSel(focus.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])
  const current: CommsEntryView | null = inbox.find((e) => e.id === sel) ?? inbox[0] ?? null

  // ⑤ 点开即已读（含默认展开的那一封）
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
                    <span className="app-comms-subject">{commsSubjectText(e.id, e.subject)}</span>
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

  /**
 * **沉船记录面板**（2026-09-27 船长令）：左列沉船清单、右列一条的明细。
 * 只用既有 `.app-comms-*` 族类名（与收件箱同观感），不新造样式。
 */
function WreckLogPane({ engine, rows }: { engine: PageProps['engine']; rows: ReturnType<PageProps['engine']['wreckLogView']> }): ReactNode {
  const engineCtx = engine
  const [sel, setSel] = useState<string | null>(null)
  if (rows.length === 0) return <div className="app-dim app-exp-idle">{tr('ui.WreckLog.003')}</div>
  const cur = rows.find((r) => String(r.entry.seq) === sel) ?? rows[0]!
  const e = cur.entry
  const modName = (id: string): string => engineCtx.ctx.modules.get(id)?.name ?? id
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
  const racks: Array<[string, Array<string | null>]> = [
    ['H', e.fitted?.high ?? []],
    ['M', e.fitted?.mid ?? []],
    ['L', e.fitted?.low ?? []],
  ]
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
            {racks.map(([label, list]) => (
              <div className="app-kv" key={label}>
                <span>{label}</span>
                <span>{list.filter((x): x is string => x !== null).map(modName).join(' · ') || '—'}</span>
              </div>
            ))}
            {(e.plugs?.length ?? 0) > 0 ? (
              <div className="app-kv">
                <span>{tr('ui.WreckLog.008')}</span>
                <span>{e.plugs!.map(modName).join(' · ')}</span>
              </div>
            ) : null}
            {Object.keys(e.droneLoad ?? {}).length > 0 ? (
              <div className="app-kv">
                <span>{tr('ui.WreckLog.009')}</span>
                <span>
                  {Object.entries(e.droneLoad!)
                    .map(([id, n]) => `${engineCtx.ctx.items.get(id)?.name ?? id}×${n}`)
                    .join(' · ')}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
