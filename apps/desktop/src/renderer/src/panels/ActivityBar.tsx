import { activityOverview, scanAwaitingView, scanStatus, SYNAPTIC_ACCELERANT_MUL } from '@whale/core'
import type { ActivityView } from '@whale/core'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { AiWorkFx } from '../ui/aiWorkFx'
import { tr, isEn } from '../i18n/locale'
import { goFor } from '../ui/activityGo'
import { stopLabel, doStop } from './activityStopLabel'
import { fmtDuration } from '../i18n/fmt'
import { explorationActivityText } from '../ui/explorationActivityText'
import { createExchangeClient } from '../features/exchange/factory'
import { jumpExchangePage } from '../features/exchange/viewPrefs'
import { CLOUD_SESSION_CHANGE_EVENT } from '../features/cloud/preferences'
import type { BondPosition, FundPosition } from '../features/exchange/client'
import { money, pct } from '../features/exchange/format'
import { useExchangeAvailable } from '../features/exchange/availability'
import '../styles-activity-invasion.css'

const KIND_ICON: Record<string, string> = {
  train: 'nav-skills',
  mining: 'nav-mine',
  scan: 'ico-scan',
  salvage: 'nav-salvage',
  manufacture: 'nav-industry',
  refine: 'nav-industry',
  expedition: 'nav-bounty',
  ai: 'nav-ai',
  return: 'nav-ship',
  transit: 'ico-home',
  loop: 'ico-loop',
  'invasion-loop': 'ico-loop',
  courier: 'nav-task',
  hauling: 'nav-haul',
  wormhole: 'nav-wormhole',
  whscan: 'nav-wormhole',
  whauto: 'nav-wormhole',
  lab: 'nav-industry',
}

function ActivityBarIdle({
  text,
  onClick,
}: {
  text: string
  onClick?: () => void
}) {
  const clean = text.replace(/。$/, '')
  const splitIdx = clean.search(/——|—/)
  let status = clean
  let tip = ''
  if (splitIdx !== -1) {
    status = clean.slice(0, splitIdx).trim()
    tip = clean.slice(splitIdx).replace(/^(——|—)\s*/, '').trim()
  }

  return (
    <div
      className={`app-activitybar-idle${onClick ? ' is-clickable' : ''}`}
      title={text}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="app-activitybar-idle-status">
        <span className="app-activitybar-idle-dot" />
        <span className="app-activitybar-idle-title">{status}</span>
      </div>
      {tip ? <div className="app-activitybar-idle-tip">{tip}</div> : null}
    </div>
  )
}

function SmoothFill({
  percent,
  className,
  as: Tag = 'span',
  style,
}: {
  percent: number
  className?: string
  as?: 'span' | 'i'
  style?: React.CSSProperties
}) {
  const clamped = Math.min(100, Math.max(0, percent))
  const prevRef = useRef(clamped)
  const isReset = clamped < prevRef.current

  useEffect(() => {
    prevRef.current = clamped
  })

  const defaultClass = Tag === 'span' ? 'app-activitybar-fill' : undefined
  const finalClass = className !== undefined ? className : defaultClass

  return (
    <Tag
      className={finalClass}
      style={{
        ...style,
        width: `${clamped}%`,
        ...(isReset ? { transition: 'none' } : undefined),
      }}
    />
  )
}


export function ActivityBar({
  engine,
  onToast,
  onAiCenter,
  onGoPage,
  onOpenWormhole,
}: {
  engine: GameEngine
  onToast: ToastFn
  onAiCenter?: () => void
  onGoPage?: (page: string, mapTab?: string, taskTab?: string) => void
  onOpenWormhole?: () => void
}) {
  const exchangeAvailable = useExchangeAvailable()
  const state = engine.state
  const all = activityOverview(state, engine.ctx).map(explorationActivityText)
  const boostRemainMs = engine.synapticAccelerantRemainMs()
  const boostMul = Math.round(1 / SYNAPTIC_ACCELERANT_MUL)
  const playerItems = all.filter((i) => i.kind !== 'ai' && i.kind !== 'train')
  const trainItems = all.filter((i) => i.kind === 'train')
  const aiShipItems = all.filter((i) => i.kind === 'ai' && i.aiGroup === 'ship')
  const aiProdItems = all.filter((i) => i.kind === 'ai' && i.aiGroup === 'industry')
  const scan = scanStatus(state)
  const scanAck = scanAwaitingView(state)
  const scanBar = scan.active
    ? { done: false, galaxyId: scan.galaxyId, percent: scan.percent, remainingMs: scan.remainingMs }
    : scanAck
      ? { done: true, galaxyId: scanAck.galaxyId, percent: 100, remainingMs: 0 }
      : null
  const scanName = (id: string | null): string => (id ? (engine.ctx.galaxies.get(id)?.name ?? id) : tr("ui.ActivityBar.015"))
  const [retreatAsk, setRetreatAsk] = useState(false)
  const hasRetreatActivity = playerItems.some((i) => i.stop === 'retreat-battle')
  useEffect(() => {
    if (retreatAsk && !hasRetreatActivity) setRetreatAsk(false)
  }, [retreatAsk, hasRetreatActivity])
  const [haulAsk, setHaulAsk] = useState(false)
  const hasHaulActivity = playerItems.some((i) => i.stop === 'stop-hauling')
  useEffect(() => {
    if (haulAsk && !hasHaulActivity) setHaulAsk(false)
  }, [haulAsk, hasHaulActivity])

  const [exchTick, bumpExchTick] = useState(0)
  const [exchAuthTick, bumpExchAuth] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const onChange = (): void => bumpExchAuth()
    window.addEventListener(CLOUD_SESSION_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(CLOUD_SESSION_CHANGE_EVENT, onChange)
  }, [])
  const exchBundle = useMemo(() => createExchangeClient(), [exchAuthTick])
  useEffect(() => {
    const unsub = exchBundle.client.onTick(() => bumpExchTick((t) => t + 1))
    return unsub
  }, [exchBundle.client])

  const [savingsLive, setSavingsLive] = useState<{ bonds: BondPosition; funds: FundPosition } | null>(null)
  useEffect(() => {
    if (exchBundle.error !== undefined) return undefined
    const client = exchBundle.client
    let alive = true
    const pull = (): void => {
      void Promise.all([client.getBondPosition(), client.getFundPosition()])
        .then(([bonds, funds]) => {
          if (alive) setSavingsLive({ bonds, funds })
        })
        .catch(() => undefined)
    }
    pull()
    const timer = window.setInterval(pull, 10_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [exchBundle.client, exchBundle.error])

  const exchSnap = useMemo(
    () => exchBundle.client.getSnapshot('XJZG'),
    [exchBundle.client, exchTick],
  )

  const exchSummary = useMemo(() => {
    const holdings = exchSnap.account.holdings
    const positions = exchSnap.account.positions
    let totalPnl = 0
    let totalCostOrMargin = 0
    const heldList: string[] = []

    for (const h of holdings) {
      if (h.qty > 0) {
        heldList.push(h.code)
        const q = exchSnap.stocks.find((s) => s.code === h.code)
        if (q) totalPnl += (q.price - h.avgCost) * h.qty
        totalCostOrMargin += h.avgCost * h.qty
      }
    }
    for (const p of positions) {
      heldList.push(`${p.code}(${p.leverage}x)`)
      totalPnl += p.unrealizedPnl
      totalCostOrMargin += p.margin
    }

    const bonds = savingsLive?.bonds ?? exchSnap.bonds
    const funds = savingsLive?.funds ?? exchSnap.funds
    const savings: { label: string; pnl: number }[] = []
    if (bonds.principal > 0) savings.push({ label: '债券', pnl: bonds.accrued })
    if (funds.principal > 0) savings.push({ label: '基金', pnl: funds.accrued })

    const uniqueCodes = Array.from(new Set(heldList))
    const pnlPct = totalCostOrMargin > 0 ? (totalPnl / totalCostOrMargin) * 100 : 0
    return {
      hasPositions: uniqueCodes.length > 0,
      uniqueCodes,
      totalPnl,
      pnlPct,
      bonds,
      funds,
    }
  }, [exchSnap, savingsLive])

  const stockRows = useMemo(() => {
    const rows: Array<{ key: string; code: string; tag: string; qty: string; pnl: string; up: boolean }> = []
    const priceOf = (code: string): number | null => exchSnap.stocks.find((s) => s.code === code)?.price ?? null
    for (const h of exchSnap.account.holdings) {
      if (h.qty <= 0) continue
      const price = priceOf(h.code)
      const pnl = price === null ? 0 : (price - h.avgCost) * h.qty
      rows.push({
        key: `hold-${h.code}`,
        code: h.code,
        tag: '',
        qty: isEn() ? `${h.qty} sh` : `${h.qty}股`,
        pnl: `${pnl >= 0 ? '+' : ''}${money(pnl)}`,
        up: pnl >= 0,
      })
    }
    for (const p of exchSnap.account.positions) {
      rows.push({
        key: `pos-${p.code}-${p.side}`,
        code: p.code,
        tag: `${p.side === 'short' ? (isEn() ? 'S' : '空') : (isEn() ? 'L' : '多')}${p.leverage}x`,
        qty: isEn() ? `${p.qty} sh` : `${p.qty}股`,
        pnl: `${p.unrealizedPnl >= 0 ? '+' : ''}${money(p.unrealizedPnl)}`,
        up: p.unrealizedPnl >= 0,
      })
    }
    return rows
  }, [exchSnap])

  const renderItem = (v: ActivityView) => {
    const target = goFor(v.kind)
    const handleItemClick = (): void => {
      if (v.kind === 'wormhole' && onOpenWormhole) {
        onOpenWormhole()
        return
      }
      if (onGoPage) onGoPage(target.page, target.mapTab, target.taskTab)
    }
    const goText = tr(target.labelId)
    const hasProgress = v.percent !== null
    const hasTime = v.remainingMs !== null && v.remainingMs > 0
    const hasAction = Boolean(v.stopable && v.stop)

    return (
      <div
        key={v.id}
        className={`app-activitybar-item is-${v.kind}`}
        title={v.stopReason ?? tr("ui.ActivityBar.052", { goText: goText })}
        onClick={handleItemClick}
      >
        {/* 行 1：标题与操作按键同行横向展开，左侧标题、右侧微型操作按钮 */}
        <div className="app-activitybar-head">
          <div className="app-activitybar-title-wrap">
            <span className="app-activitybar-icon">
              <Glyph name={KIND_ICON[v.kind] ?? 'fallback'} size={14} color={NAV_TONES[KIND_ICON[v.kind]] ?? ICO_TONES[KIND_ICON[v.kind]]} />
            </span>
            {v.badge === 'invasion' ? <span className="app-chip is-danger app-activitybar-badge">{tr('ui.invasionActivity.001')}</span> : null}
            <span className="app-activitybar-label-text" title={v.label}>{v.label}</span>
          </div>

          {hasAction ? (
            <div className="app-activitybar-act">
              <button
                className="app-btn is-small is-warn app-activitybar-action-btn"
                title={
                  v.stop === 'cancel-manufacture'
                    ? tr("ui.ActivityBar.017")
                    : v.stop === 'stop-refine'
                      ? tr("ui.ActivityBar.018")
                      : v.stop === 'stop-lab'
                        ? tr("ui.ActivityBar.069")
                        : v.stop === 'recall-expedition'
                        ? tr("ui.ActivityBar.019")
                        : v.stop === 'cancel-deliver-trip'
                          ? tr("ui.ActivityBar.020")
                          : v.stop === 'stop-whscan'
                          ? tr("ui.ActivityBar.034")
                          : v.stop === 'stop-scan'
                          ? tr("ui.ActivityBar.021")
                          : v.stop === 'stop-salvage'
                            ? tr("ui.ActivityBar.035")
                            : v.stop === 'remove-training'
                              ? tr("ui.ActivityBar.022")
                              : v.stop === 'retreat-battle'
                                ? tr("ui.ActivityBar.023")
                                : undefined
                }
                onClick={(e) => {
                  e.stopPropagation() // 点击"停止/移除/撤退"不触发行跳转
                  /**
                   * **长途运输：先警告、再确认**（船长 2026-09-20）——中断本趟 = 这一趟的报酬拿不到。
                   * 与下面撤退那支同款两讨伐确认（第一次点只亮警告 + 提示，第二次点才执行）。
                   */
                  if (v.stop === 'stop-hauling') {
                    if (!haulAsk) {
                      setHaulAsk(true)
                      onToast(tr('ui.Hauling.033'), true)
                      return
                    }
                    setHaulAsk(false)
                    doStop(v, engine, onToast)
                    return
                  }
                  if (v.stop !== 'retreat-battle') {
                    doStop(v, engine, onToast)
                    return
                  }
                  if (!retreatAsk) {
                    setRetreatAsk(true)
                    onToast(tr("ui.ActivityBar.053"), true)
                    return
                  }
                  setRetreatAsk(false)
                  doStop(v, engine, onToast)
                }}
              >
                {v.stop === 'stop-hauling' && haulAsk
                  ? tr('ui.Hauling.034')
                  : v.stop === 'retreat-battle' && retreatAsk
                    ? tr("ui.ActivityBar.024")
                    : stopLabel(v)}
              </button>
            </div>
          ) : null}
        </div>

        {/* 行 2：说明文案（独占整行满宽横向展示，绝不竖排折断） */}
        {v.sub ? (
          <div className="app-activitybar-sub app-dim" title={v.sub}>
            {v.sub}
          </div>
        ) : null}

        {/* 行 3：满宽科技进度条 */}
        {hasProgress ? (
          <div className="app-activitybar-progress-row">
            <span className="app-activitybar-track">
              <SmoothFill percent={v.percent ?? 0} />
            </span>
          </div>
        ) : null}

        {/* 行 4：进度与时间读数（独占整行横向展示，绝不被按钮挤压） */}
        {hasProgress || hasTime ? (
          <div className="app-activitybar-footer">
            <div className="app-activitybar-time">
              {hasProgress ? <span className="app-activitybar-pct">{Math.round(v.percent ?? 0)}%</span> : null}
              {hasTime ? (
                <span className="app-activitybar-remain">
                  {v.badge === 'invasion'
                    ? ` · ${tr('ui.boost.005', { p1: fmtDuration(v.remainingMs ?? 0) })}`
                    : ` · 剩 ${fmtDuration(v.remainingMs ?? 0)}`}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <aside className="app-activitybar">
      <div className="app-activitybar-group">
        <div className="app-activitybar-gtitle">{tr("ui.ActivityBar.028")}</div>
        {playerItems.length > 0 ? (
          playerItems.map(renderItem)
        ) : (
          <ActivityBarIdle
            text={tr("ui.ActivityBar.029")}
            onClick={() => onGoPage?.('map', 'star')}
          />
        )}
      </div>
      {/* **计时中**（2026-09-25 船长令「星系扫描条按甲做」）：扫描条独立成一组、紧接玩家活动之后。
          仅在有正在扫描或突触加速剂时展示，避免无活动时悬挂空标题。 */}
      {scanBar || boostRemainMs > 0 ? (
        <div className="app-activitybar-group">
          <div className="app-activitybar-gtitle">{tr("ui.ActivityBar.065")}</div>
          {scanBar ? (
            <button
              className={`app-activitybar-scan${scanBar.done ? ' is-done' : ''}`}
              title={
                scanBar.done
                  ? tr("ui.ActivityBar.055", { p1: scanName(scanBar.galaxyId) })
                  : tr("ui.ActivityBar.058", { p1: scanName(scanBar.galaxyId), p2: fmtDuration(scanBar.remainingMs) })
              }
              onClick={() => {
                // 完成态点一下 = 看过（收条）；进行中点一下 = 纯跳转（星图页有「终止扫描」）
                if (scanBar.done && scanAck) engine.ackScanView()
                onGoPage?.('map', 'star')
              }}
            >
              <div className="app-activitybar-scan-head">
                <span className="app-ico">
                  <Glyph name="ico-scan" size={13} color={ICO_TONES['ico-scan']} />
                </span>
                <span className="app-activitybar-scan-name">{scanName(scanBar.galaxyId)}</span>
                <span className="app-activitybar-scan-time">
                  {scanBar.done ? tr("ui.ActivityBar.036") : `${Math.round(scanBar.percent)}%`}
                </span>
              </div>
              <div className="app-activitybar-progress-row">
                <span className="app-activitybar-track">
                  <SmoothFill percent={scanBar.percent} />
                </span>
              </div>
            </button>
          ) : null}
          {/* 突触加速剂生效中（**2026-09-30 船长令**）：与扫描条同一套类名（不自造样式），不可点 */}
          {boostRemainMs > 0 ? (
            <div className="app-activitybar-scan app-activitybar-boost" title={tr('ui.ActivityBar.067', { p1: fmtDuration(boostRemainMs) })}>
              <div className="app-activitybar-scan-head">
                <span className="app-ico">
                  <Glyph name="ico-eff" size={13} color={ICO_TONES['ico-eff']} />
                </span>
                <span className="app-activitybar-scan-name">{tr('ui.ActivityBar.066', { p1: boostMul })}</span>
                <span className="app-activitybar-scan-time">{fmtDuration(boostRemainMs)}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="app-activitybar-group">
        <div className="app-activitybar-gtitle">{tr("ui.ActivityBar.030")}</div>
        {trainItems.length > 0 ? (
          trainItems.map(renderItem)
        ) : (
          <ActivityBarIdle
            text={tr("ui.ActivityBar.037")}
            onClick={() => onGoPage?.('skills')}
          />
        )}
      </div>
      {/**
       * **副AI活动**（2026-09-25 船长令：「活动页面，可以试着在**玩家活动下方**新建一个副AI活动，
       * 将所有AI的进度条和活动类型挨个列出」）
       *
       * 条目形态**照 AI 指挥中心那套精简**（船长同日追加令：「**类似AI指挥中心那样，显示一个小动画，
       * 正在干什么，和进度条，只需要这三项就足够了，不用取消按钮，玩家点击后跳转到AI指挥中心**」）
       * ⇒ 每条只有三样：① `AiWorkFx` 小动画（按 `aiWorkKind` 区分作业类型）② 正在干什么
       * ③ 进度条（`percent` 为空时不画，与主控活动同口径）。**不放取消按钮**；
       * **整条可点** ⇒ 跳到「舰船 · AI 指挥中心」（在那里才能停）。
       */}
      <div className="app-activitybar-group">
        <div className="app-activitybar-gtitle">{tr("ui.ActivityBar.062")}</div>
        {aiShipItems.length + aiProdItems.length > 0 ? (
          <div className="app-ai-act-list">
            {[...aiShipItems, ...aiProdItems].map((v) => (
              <button
                key={v.id}
                className="app-ai-act"
                title={tr("ui.ActivityBar.064", { p1: v.label, p2: v.sub })}
                onClick={() => onAiCenter?.()}
              >
                <AiWorkFx kind={v.aiWorkKind ?? 'standby'} />
                <span className="app-ai-act-main">
                  <span className="app-ai-act-label">{v.label}</span>
                  <span className="app-dim app-ai-act-sub">{v.sub}</span>
                </span>
                {v.percent !== null ? (
                  <span className="app-progress-mini" title={`${v.label} ${Math.round(v.percent)}%`}>
                    <SmoothFill percent={v.percent} as="i" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <ActivityBarIdle
            text={tr("ui.ActivityBar.063")}
            onClick={() => onAiCenter?.()}
          />
        )}
      </div>

      {/* ── 交易所活动监控（副AI活动最下方，独立展示股票、债券与基金）；
          交易所不可用（连续探测失败）时整组隐藏——「一键关闭股票系统」 ── */}
      {exchangeAvailable ? (
      <div className="app-activitybar-group app-activitybar-group-exchange">
        <div className="app-activitybar-gtitle">{isEn() ? 'Exchange' : '交易所'}</div>
        <div className="app-ai-act-list">
          {/* ① 股票条目（单独一行展示） */}
          <button
            type="button"
            className="app-ai-act app-activitybar-exch-btn"
            title={
              exchSummary.hasPositions
                ? (isEn()
                    ? `Stock holdings: ${exchSummary.uniqueCodes.join(', ')}, PnL ${exchSummary.totalPnl >= 0 ? '+' : ''}${money(exchSummary.totalPnl)} (${pct(exchSummary.pnlPct)}). Click to view`
                    : `股票持仓：${exchSummary.uniqueCodes.join('、')}，当前浮盈 ${exchSummary.totalPnl >= 0 ? '+' : ''}${money(exchSummary.totalPnl)} (${pct(exchSummary.pnlPct)})。点击直达交易所`)
                : (isEn() ? 'Deep Space Exchange: no stocks held, click to trade' : '深空证券交易所：当前未持仓股票，点击进入选股')
            }
            onClick={() => onGoPage?.('exchange')}
          >
            <span className="app-activitybar-icon">
              <Glyph name="nav-exchange" size={14} color="rgb(var(--wui-cyan))" />
            </span>
            <span className="app-ai-act-main">
              <span className="app-ai-act-label">
                {exchSummary.hasPositions ? exchSummary.uniqueCodes.join(' · ') : (isEn() ? 'Stocks' : '股票')}
              </span>
              <span
                className={`app-ai-act-sub ${
                  exchSummary.hasPositions
                    ? exchSummary.totalPnl >= 0
                      ? 'is-up'
                      : 'is-down'
                    : 'app-dim'
                }`}
              >
                {exchSummary.hasPositions
                  ? `${isEn() ? 'PnL' : '收益'} ${exchSummary.totalPnl >= 0 ? '+' : ''}${money(exchSummary.totalPnl)} (${pct(exchSummary.pnlPct)})`
                  : (isEn() ? 'No Position' : '未持仓')}
              </span>
            </span>
          </button>

          {/* ①-b 逐只持仓明细：150px 窄栏里压成一行「代码 数量 盈亏」 */}
          {stockRows.map((row) => (
            <button
              key={row.key}
              type="button"
              className="app-activitybar-exch-hold"
              title={`${row.code}：${row.qty}，${row.pnl}`}
              onClick={() => onGoPage?.('exchange')}
            >
              <span className="exh-code">{row.code}</span>
              <span className="exh-lev">{row.tag}</span>
              <span className="exh-qty">{row.qty}</span>
              <span className={`exh-pnl ${row.up ? 'is-up' : 'is-down'}`}>{row.pnl}</span>
            </button>
          ))}

          {/* ② 债券条目（仅在已购买且本金 > 0 时单独一行显示收益，没有购买不显示） */}
          {exchSummary.bonds && exchSummary.bonds.principal > 0 ? (
            <button
              type="button"
              className="app-ai-act app-activitybar-exch-btn is-bond"
              title={
                isEn()
                  ? `Bonds: Principal ${money(exchSummary.bonds.principal)}, Accrued +${money(exchSummary.bonds.accrued)}. Click to manage`
                  : `稳健型债券：本金 ${money(exchSummary.bonds.principal)}，累计计息 +${money(exchSummary.bonds.accrued)}。点击直达交易所理财`
              }
              onClick={() => {
                // 2026-11-06 船长令：左侧点债券/基金要直接落到「简单投资 · 理财与基金」
                jumpExchangePage('simple', 'finance')
                onGoPage?.('exchange')
              }}
            >
              <span className="app-activitybar-icon">
                <Glyph name="nav-market" size={14} color="rgb(var(--wui-gold))" />
              </span>
              <span className="app-ai-act-main">
                <span className="app-ai-act-label">{isEn() ? 'Bonds' : '稳健债券'}</span>
                <span className="app-ai-act-sub is-up">
                  {isEn() ? 'Interest' : '收益'} +{money(exchSummary.bonds.accrued)}
                </span>
              </span>
            </button>
          ) : null}

          {/* ③ 基金条目（仅在已购买且本金 > 0 时单独一行显示收益，没有购买不显示） */}
          {exchSummary.funds && exchSummary.funds.principal > 0 ? (
            <button
              type="button"
              className="app-ai-act app-activitybar-exch-btn is-fund"
              title={
                isEn()
                  ? `Hedge Fund: Principal ${money(exchSummary.funds.principal)}, Accrued ${exchSummary.funds.accrued >= 0 ? '+' : ''}${money(exchSummary.funds.accrued)}. Click to manage`
                  : `深空对冲基金：本金 ${money(exchSummary.funds.principal)}，累计收益 ${exchSummary.funds.accrued >= 0 ? '+' : ''}${money(exchSummary.funds.accrued)}。点击直达交易所基金`
              }
              onClick={() => {
                jumpExchangePage('simple', 'finance')
                onGoPage?.('exchange')
              }}
            >
              <span className="app-activitybar-icon">
                <Glyph name="nav-skills" size={14} color="rgb(var(--wui-purple))" />
              </span>
              <span className="app-ai-act-main">
                <span className="app-ai-act-label">{isEn() ? 'Hedge Fund' : '对冲基金'}</span>
                <span
                  className={`app-ai-act-sub ${
                    exchSummary.funds.accrued >= 0 ? 'is-up' : 'is-down'
                  }`}
                >
                  {isEn() ? 'PnL' : '收益'} {exchSummary.funds.accrued >= 0 ? '+' : ''}${money(exchSummary.funds.accrued)}
                </span>
              </span>
            </button>
          ) : null}
        </div>
      </div>
      ) : null}
    </aside>
  )
}
