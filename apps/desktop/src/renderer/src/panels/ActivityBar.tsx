/**
 * T1 顶部活动窗口：常驻显示「玩家活动」与「技能训练」两个分区（各带待机文案），
 * 提供统一终止入口；AI 活动不逐条显示，用两枚小图标徽标（副船 / 工业，各自跳转）。
 * 布局：垂直排布，固定高度上限，内容多时内部滚动（船长 2026-09-05）。
 *
 * **星系扫描条**（船长 2026-09-15）：「玩家扫描星系将不再占用玩家的主控活动（也不显示在主控活动里，
 * 而是在 AI 活动的图标右侧显示一个进度条，当扫描完成后这个进度条依旧存在并高亮，直到玩家进入星图
 * 界面查看后才移除）」⇒ 扫描不再是"玩家活动"行，改为头部 AI 徽标右侧一条常驻进度条
 * （进行中 = 进度 + 剩余；完成待查看 = 满格金色高亮，进「星图」或点它即收）。
 */
import { activityOverview, scanAwaitingView, scanStatus, SYNAPTIC_ACCELERANT_MUL } from '@whale/core'
import type { ActivityView } from '@whale/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { AiWorkFx } from '../ui/aiWorkFx'
import { tr } from '../i18n/locale'
// 活动行「点击去哪」的跳转单点（2026-09-27 建：原先两套外壳各一份，快递那档跳到了已删除的星图页签 ⇒ 空白页）
import { goFor } from '../ui/activityGo'
// 活动栏「停止/取消」按钮文案 = 单点（两套外壳共用，见文件头注）
import { stopLabel, doStop } from './activityStopLabel'
import { fmtDuration } from '../i18n/fmt'
import { explorationActivityText } from '../ui/explorationActivityText'
import { createExchangeClient } from '../features/exchange/factory'
import type { BondPosition, FundPosition } from '../features/exchange/client'
import { money, pct } from '../features/exchange/format'
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
  // 虫洞探索（船长 2026-09-13「活动栏显示」）：图标 = 虫洞专属「空间裂隙」（同日船长定案），
  // 与星图·行动区的虫洞入口行同一枚，不再借 ico-flag / ico-scan
  wormhole: 'nav-wormhole',
  /** 主控活动「扫描虫洞」（2026-09-14）：与洞内活动同一个图标，色调用其自身色调 */
  whscan: 'nav-wormhole',
  whauto: 'nav-wormhole',
  /**
   * 实验室产线（**2026-10-01 接入**）：与精炼炉/制造线**同一枚 `nav-industry`**
   * （**船长 2026-10-01 令**：「**实验室和工业的其他页面没有本质区别，所以 AI 和活动栏图标都使用
   * 一样的机制**」）——它只是工业的又一条产线，不另立视觉符号。
   */
  lab: 'nav-industry',
}

/**
 * 待机微面板组件：在 150px 窄列内对待机状态进行结构化展示，
 * 避免长句在破折号和标点处发生难看生硬的字符折断。
 */
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

/**
 * 进度条平滑补间填充微组件：
 * 当百分比递增时，遵循 CSS 声明的 0.25s linear 硬件加速过渡；
 * 当百分比回退或循环重置时（percent < prevPercent），设置 transition: 'none' 瞬回归零，
 * 避免反向缩回倒放的非物理视觉瑕疵。
 */
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

/**
 * 活动项 → 跳转目标页面（可带星图二级标签）——船长 2026-09-05 点击跳转。
 *
 * 【注意】扩展约定（新增活动时务必同步）：以后若新增活动项目 / 新增页面，
 * 必须在本函数补充对应 `case`（kind → { page, mapTab? }），否则新活动点下去
 * 会回退到默认 `{ page: 'map' }`（星图页），跳转失效。
 * 映射关系建议遵循：采矿→星图·矿带开采；扫描/远征/返航/待命→星图·远征；
 * 制造/精炼→工业；训练→技能页。跳转实现经 App 传入的 onGoPage（setPage + setMapTab）。
 */

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
  /**
   * **虫洞那条直接开面板**（船长 2026-09-13：「活动栏直接开面板」）：
   * 光跳星图页不够——星图要**先选中一个星系**才渲染「前往星系 · 行动」区，
   * 而人已经进洞时星图默认没有选中星系 ⇒ 那一行里的「进入虫洞」可能根本不出现。
   */
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const all = activityOverview(state, engine.ctx).map(explorationActivityText)
  // 船长 2026-09-05：活动窗口垂直排布；「玩家活动」「技能训练」两个常驻分区，各自待机文案；AI 用徽标
  // 2026-09-08：AI 徽标计数 = AI 副船 + AI 核心驱动的生产线/精炼炉（后者不再占用"玩家活动"行）
  // 2026-09-10 船长：徽标**拆成两枚**——「副船」与「工业」各一枚（图标与配色不同，便于辨识）；
  //   数字取 core 单点（与 AI 指挥中心标题行同源），不再从活动列表反推
  /**
   * **突触加速剂读数**（**2026-09-30 船长令**：「'生效中'倒计时读数放入活动窗口内，和 AI 核心一样，
   * 用一个图标表示。最好图标能展示技能加速的倍率」）—— 归到「计时中」那一组（与扫描条同组），
   * 图标 ＋ **倍率**＋ 剩余时间；倍率由 core 的乘区反算（`1 / SYNAPTIC_ACCELERANT_MUL`）⇒ 改数值不会说两套话。
   */
  const boostRemainMs = engine.synapticAccelerantRemainMs()
  const boostMul = Math.round(1 / SYNAPTIC_ACCELERANT_MUL)
  const playerItems = all.filter((i) => i.kind !== 'ai' && i.kind !== 'train')
  const trainItems = all.filter((i) => i.kind === 'train')
  const aiShipItems = all.filter((i) => i.kind === 'ai' && i.aiGroup === 'ship')
  const aiProdItems = all.filter((i) => i.kind === 'ai' && i.aiGroup === 'industry')
  /**
   * 星系扫描条读数（见文件头注释）：**进行中优先**——正在扫就显示这条扫描的进度；
   * 扫完（且玩家还没看过）才显示"已完成"高亮格。两条都靠 core 单点：
   * `scanStatus`（进行中）/ `scanAwaitingView`（完成待查看）。
   */
  const scan = scanStatus(state)
  const scanAck = scanAwaitingView(state)
  const scanBar = scan.active
    ? { done: false, galaxyId: scan.galaxyId, percent: scan.percent, remainingMs: scan.remainingMs }
    : scanAck
      ? { done: true, galaxyId: scanAck.galaxyId, percent: 100, remainingMs: 0 }
      : null
  const scanName = (id: string | null): string => (id ? (engine.ctx.galaxies.get(id)?.name ?? id) : tr("ui.ActivityBar.015"))
  // 撤退需二次确认（轻损但有代价）。
  // 2026-09-11 修复（真 BUG：点「开始教程」后白屏，React #185「Maximum update depth exceeded」）：
  // 原先写成**渲染期派生状态**（`if (retreatAsk && !playerItems.some(...)) setRetreatAsk(false)`）——
  // React 只允许"该组件自己触发的、立即收敛的"渲染期更新；撤退活动消失（如委派 AI 后）时这里每次渲染都会
  // 调一次 setState，生产版在同一提交里累积到阈值就把整棵树卸载（白屏）。搬到 effect：**提交后清理**，语义相同、不参与渲染。
  const [retreatAsk, setRetreatAsk] = useState(false)
  const hasRetreatActivity = playerItems.some((i) => i.stop === 'retreat-battle')
  useEffect(() => {
    if (retreatAsk && !hasRetreatActivity) setRetreatAsk(false)
  }, [retreatAsk, hasRetreatActivity])
  /**
   * **长途运输的中断确认**（**2026-09-20 船长令**：「当玩家在跑长途运输，要切换其他主控活动打断长途运输时，
   * 弹出一个警告，告诉玩家中断当前长途运输将无法获得本趟的报酬之类的」）：
   * 与撤退同款两讨伐确认——第一下只警告（**本趟报酬到站才结，中断就拿不到**），再点一次才真停。
   * 活动条目消失（运输已结束）时按同款 effect 复位，避免"状态卡在待确认"。
   */
  const [haulAsk, setHaulAsk] = useState(false)
  const hasHaulActivity = playerItems.some((i) => i.stop === 'stop-hauling')
  useEffect(() => {
    if (haulAsk && !hasHaulActivity) setHaulAsk(false)
  }, [haulAsk, hasHaulActivity])

  // ── 深空证券交易所监控（副AI活动最下方，船长 2026-11-03 令） ──
  const [exchTick, bumpExchTick] = useState(0)
  const exchBundle = useMemo(() => createExchangeClient(), [])
  useEffect(() => {
    const unsub = exchBundle.client.onTick(() => bumpExchTick((t) => t + 1))
    return unsub
  }, [exchBundle.client])

  // 保底产品收益常驻刷新：交易所页只在打开时轮询，离开后快照会冻住，
  // 左侧卡片就会一直显示旧收益。这里独立拉 bond/fund（两个轻量 GET），
  // 10 秒一次，与交易所页的行情节奏一致（2026-11-04 船长：左侧要能看到收益）。
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
    () => exchBundle.client.getSnapshot('SMHI'),
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

    // 保底产品收益：只有真的申购过（本金 > 0）才展示，空仓隐藏；
    // 优先用活动栏自己的 10 秒拉取结果，交易所页打开时再回落到页面快照。
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

  const renderItem = (v: ActivityView) => {
    const target = goFor(v.kind)
    const handleItemClick = (): void => {
      // 虫洞走"直接开面板"那条（见 props 注释）；其余照旧跳页
      if (v.kind === 'wormhole' && onOpenWormhole) {
        onOpenWormhole()
        return
      }
      if (onGoPage) onGoPage(target.page, target.mapTab, target.taskTab)
    }
    /** 目的地名直接取跳转单点给的 id（原先按 mapTab 反推，嗅探的正是那个已删除的 'task' ⇒ 空白页） */
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

      {/* ── 交易所活动监控（副AI活动最下方，独立展示股票、债券与基金） ── */}
      <div className="app-activitybar-group app-activitybar-group-exchange">
        <div className="app-activitybar-gtitle">{isEn() ? 'Exchange' : '深空证券交易所'}</div>
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
              onClick={() => onGoPage?.('exchange')}
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
              onClick={() => onGoPage?.('exchange')}
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
    </aside>
  )
}
