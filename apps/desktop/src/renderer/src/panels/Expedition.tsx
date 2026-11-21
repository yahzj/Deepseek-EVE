import { useEffect, useRef, useState } from 'react'
import type { AnomalyDef } from '@whale/core'
import {
  DSI_FACTION_ID,
  expeditionStatus,
  isExplored,
  originGalaxyOf,
  scanStatus,
  weekendZoneLiveAt,
  shortestTravelMinutes,
  standingOf,
  spendableStandingOf,
  transitStatus,
} from '@whale/core'
import { Panel } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'
import type { ToastFn } from '../pages/common'
import { FirstTasks } from './FirstTasks'
import { bountyComparatorOf } from './bountySort'
import { MilestoneTasks } from './MilestoneTasks'
import { ImportantTasks } from './ImportantTasks'
import { PlugExchangeBody } from './PlugExchange'
import { Glyph, NAV_TONES, ICO_TONES } from '../ui/Glyphs'
import { sessionPick, setSessionPick, useSessionScroll } from '../ui/sessionView'
import { fmtDuration } from '../i18n/fmt'
import { StarMap, useFoeArtFit } from './StarMap'
import { AnomalyCard, BountyTasksArea, SideTasksArea, StationCard } from './ExpeditionCards'
export { Communicator } from '../ui/communicator'

export function ExpeditionPanel({
  engine,
  onToast,
  onOpenWormhole,
}: {
  engine: GameEngine
  onToast: ToastFn
  onOpenWormhole?: () => void
}) {
  const state = engine.state
  const view = expeditionStatus(state, engine.ctx)
  const scan = scanStatus(state)
  const tv = transitStatus(state, engine.ctx)

  return (
    <Panel
      className="is-fill app-exp-panel"
      title={tr("ui.Expedition.187")}
    >
      {/* T1：远征作业状态与停止入口已收敛到顶部活动窗口；**星系扫描不再占主控**（船长 2026-09-15）
          ⇒ 顶部没有它的"玩家活动"行了，这里补一条读数 + 「终止扫描」（扫描艇只有一艘，要换目标得先召回） */}
      {scan.active || view.active || state.transit.active ? (
        <div className="app-dim app-exp-idle">
          {state.transit.active
            ? (
              <>
                <span className="app-ico">
                  <Glyph name="ico-home" size={12} color={ICO_TONES['ico-home']} />
                </span>
                {tv.trip === 'deliver-to-site' || tv.trip === 'deliver-to-station'
                  ? tr("ui.Expedition.126", { p1: tv.siteName ?? '', p2: fmtDuration(Math.max(0, state.transit.finishAtGameMs - state.gameMs)) })
                  : tr("ui.Expedition.244", { p1: fmtDuration(Math.max(0, state.transit.finishAtGameMs - state.gameMs)) })}
              </>
            )
            : ''}
          {state.transit.active && (scan.active || view.active) ? ' ｜ ' : ''}
          {scan.active ? (
            <>
              <span className="app-ico">
                <Glyph name="ico-scan" size={12} color={ICO_TONES['ico-scan']} />
              </span>
              {tr("ui.Expedition.127", { p1: fmtDuration(scan.remainingMs) })}
              <button
                className="app-btn is-small is-warn"
                style={{ marginLeft: 'var(--wui-sp-6)' }}
                title={tr("ui.Expedition.069")}
                onClick={() => {
                  const r = engine.stopScanNow()
                  if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.378'), true)
                  else onToast(tr("ui.Expedition.070"))
                }}
              >
                {tr("ui.Expedition.245")}
              </button>
            </>
          ) : (
            ''
          )}
          {scan.active && view.active ? ' ｜ ' : ''}
          {view.active
            ? view.phase === 'combat'
              ? (
                <>
                  <span className="app-ico">
                    <Glyph name="nav-bounty" size={13} color={NAV_TONES['nav-bounty']} />
                  </span>
                  {tr("ui.Expedition.071")}{view.anomalyName}{tr('ui.Expedition.379')} {view.power} {tr("ui.Expedition.008")} {view.threat}{tr("ui.Expedition.009")}
                </>
              )
              : tr("ui.Expedition.010", { p1: view.anomalyName, p2: view.galaxyName, p3: view.phaseLabel, p4: fmtDuration(view.remainingMs) })
            : ''}
        </div>
      ) : state.dockedSite !== null ? (
        <div className="app-dim app-exp-idle">
          {tr("ui.Expedition.011")}{engine.ctx.stations.get(state.dockedSite)?.name ?? state.dockedSite}{tr("ui.Expedition.012")}
        </div>
      ) : state.awayGalaxy !== null ? (
        /* 2026-09-06：野外停留来源 = 掩护巡逻驻留（悬赏胜利/扫描完成已改为自动返航，不再停留）——远征/扫描/采矿均可即时出发，或显式返航 */
        <div className="app-exp-idle app-idle-field">
          <span>
            <span className="app-ico">
              <Glyph name="ico-flag" size={13} color={ICO_TONES['ico-flag']} />
            </span>
            {tr("ui.Expedition.246")}{engine.ctx.galaxies.get(state.awayGalaxy)?.name ?? state.awayGalaxy}{tr('ui.Expedition.380')}
          </span>
          <button
            className="app-btn is-small"
            title={tr("ui.Expedition.188")}
            onClick={() => {
              const r = engine.flyHomeNow()
              if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.381'), true)
            }}
          >
            <span className="app-ico">
              <Glyph name="ico-home" size={13} color={ICO_TONES['ico-home']} />
            </span>
            {tr("ui.Expedition.247")}
          </button>
        </div>
      ) : (
        <div className="app-dim app-exp-idle">
          {tr("ui.Expedition.013")}
        </div>
      )}
      <StarMap engine={engine} onToast={onToast} onOpenWormhole={onOpenWormhole} />
    </Panel>
  )
}

type TaskSort = 'danger' | 'distance' | 'galaxy' | 'reward' | 'standing'
const TASK_SORT_KEY = 'whale-idle:task-sort'
const TASK_SORT_LABEL: Record<TaskSort, string> = {
  get danger() { return tr("ui.MapPage.008") },
  get distance() { return tr("ui.Expedition.248") },
  get galaxy() { return tr("ui.MapPage.009") },
  get reward() { return tr("ui.Expedition.072") },
  get standing() { return tr("ui.Expedition.073") },
}

type TaskTabKey = 'important' | 'milestone' | 'resource' | 'courier' | 'bounty'
const TASK_TABS: Array<{ key: TaskTabKey; label: string }> = [
  { key: 'important', get label() { return tr("ui.Expedition.302") } },
  { key: 'milestone', get label() { return tr('ui.Expedition.424') } },
  { key: 'resource', get label() { return tr("ui.Expedition.249") } },
  { key: 'courier', get label() { return tr("ui.Expedition.128") } },
  { key: 'bounty', get label() { return tr("ui.Expedition.250") } },
]
const TASK_TAB_SESSION_KEY = 'task.tab'
const TASK_TAB_VALUES: readonly string[] = ['important', 'milestone', 'resource', 'courier', 'bounty']


export function TaskPanel({
  engine,
  onToast,
  focusTab = null,
  onOpenComms,
  onJump,
}: {
  engine: GameEngine
  onToast: ToastFn
  focusTab?: { tab: string; seq: number } | null
  onOpenComms?: (messageId: string) => void
  onJump?: (t: { page: string; mapTab?: string; shipTab?: string; industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard' }) => void
}) {
  const [tab, setTab] = useState<TaskTabKey>(() => {
    const v = sessionPick(TASK_TAB_SESSION_KEY)
    return v !== null && TASK_TAB_VALUES.includes(v) ? (v as TaskTabKey) : 'important'
  })
  const lastFocusSeq = useRef(-1)
  useEffect(() => {
    const req = focusTab
    if (!req || req.seq === lastFocusSeq.current) return
    lastFocusSeq.current = req.seq
    if (TASK_TAB_VALUES.includes(req.tab)) {
      setTab(req.tab as TaskTabKey)
      setSessionPick(TASK_TAB_SESSION_KEY, req.tab)
    }
  }, [focusTab?.seq])

  const taskScrollRef = useRef<HTMLDivElement | null>(null)
  useSessionScroll('task.list.scroll', taskScrollRef)

  const state = engine.state
  const visStationIds = [...engine.ctx.stations.values()]
    .filter((site) => {
      const g = engine.ctx.galaxies.get(site.galaxyId)
      return !!g && isExplored(state, g.id)
    })
    .map((site) => site.id)
  const stationCount = visStationIds.length
  const unbuiltStationIds = visStationIds.filter((id) => {
    const site = engine.ctx.stations.get(id)
    const prog = state.stationSites[id]
    return !!site && (prog?.stage ?? 0) < site.tiers.length
  })

  function changeTab(next: TaskTabKey): void {
    setTab(next)
    setSessionPick(TASK_TAB_SESSION_KEY, next)
  }

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.App.008")}
      right={<span className="app-dim">{tr("ui.Expedition.129")} {stationCount}{tr('ui.Expedition.365')}</span>}
    >
      {/* 子标签固定（固定头+下滚）：重要/资源/快递/赏金任务 常显，下方任务内容独立内滚 */}
      <div className="app-task-tabs" role="tablist">
        {TASK_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="app-win-body" ref={taskScrollRef}>
      {tab === 'important' ? (
        <div>
          {/* 2026-09-17 教程重做：重要任务＝「第一次」系列；**2026-09-20 起顺序解锁、一次只出一条**
              （玩家反馈"一次性太多"），完成后的里程碑（次数）链搬到「里程碑任务」页。
              2026-09-20 第三道令：「寻找人类」**置于顶部**（完成第 11 条后它与末段两条一起显示）
              ⇒ `ImportantTasks`（贯穿任务卡）画在「第一次」列表**之上** */}
          <ImportantTasks engine={engine} />
          <FirstTasks engine={engine} onToast={onToast} onOpenComms={onOpenComms} onJump={onJump} />
          {stationCount > 0 && unbuiltStationIds.length > 0 ? (
            <>
              <div className="app-dim app-exp-idle">{tr("ui.Expedition.303")}</div>
              <div className="app-station-list">
                <StationCard engine={engine} onToast={onToast} siteIds={unbuiltStationIds} />
              </div>
            </>
          ) : stationCount > 0 ? (
            // 已建成的副站卡不再占位（船长 2026-09-10：已完成的重要任务一律隐藏）
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.074")}</div>
          ) : (
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.189")}</div>
          )}
        </div>
      ) : tab === 'milestone' ? (
        /* 2026-09-20 船长（玩家反馈）：里程碑（次数）链单开一页；恒显，一条都没解锁时页内给提示 */
        <div>
          <MilestoneTasks engine={engine} onToast={onToast} />
        </div>
      ) : tab === 'resource' ? (
        <div>
          {/* v24：资源时效任务（每 20 分钟补给周期整板刷新，仓库足量交付即结；原 StationCard 建站内容保留在下方） */}
          <SideTasksArea engine={engine} onToast={onToast} kind="resource" />
          {stationCount > 0 && unbuiltStationIds.length > 0 ? (
            <>
              <div className="app-task-family">{tr("ui.Expedition.130")}</div>
              <div className="app-station-list">
                <StationCard engine={engine} onToast={onToast} siteIds={unbuiltStationIds} />
              </div>
            </>
          ) : stationCount > 0 ? (
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.074")}</div>
          ) : (
            <div className="app-dim app-exp-idle">{tr("ui.Expedition.189")}</div>
          )}
        </div>
      ) : tab === 'courier' ? (
        <div>
          {/* v24：快递时效任务（建成任一副空间站后解锁；未解锁时给建设提示） */}
          <SideTasksArea engine={engine} onToast={onToast} kind="courier" />
        </div>
      ) : tab === 'bounty' ? (
        <div>
          {/* 2026-09-10：赏金任务——限时高难「敌人窝点」目标，与资源/快递同周期整板刷新 */}
          <BountyTasksArea engine={engine} onToast={onToast} />
        </div>
      ) : null}
      </div>
    </Panel>
  )
}

export function BountyPanel({
  engine,
  onToast,
  focusShopSeq = 0,
}: {
  engine: GameEngine
  onToast: ToastFn
  focusShopSeq?: number
}) {
  const state = engine.state
  const [sec, setSec] = useState<'bounty' | 'shop'>('bounty')
  useEffect(() => {
    if (focusShopSeq > 0) setSec('shop')
  }, [focusShopSeq])
  const [sort, setSort] = useState<TaskSort>(() => {
    try {
      const v = localStorage.getItem(TASK_SORT_KEY)
      return v === 'danger' || v === 'distance' || v === 'galaxy' || v === 'reward' || v === 'standing' ? v : 'danger'
    } catch {
      return 'danger'
    }
  })

  function changeSort(next: TaskSort): void {
    setSort(next)
    try {
      localStorage.setItem(TASK_SORT_KEY, next)
    } catch {
    }
  }

  const listRef = useRef<HTMLDivElement | null>(null)
  const showFoeArt = useFoeArtFit(listRef)

  const listed = engine.anomalies.filter((a) => {
    const g = engine.ctx.galaxies.get(a.galaxyId)
    return g ? isExplored(state, g.id) : true
  })

  const galaxySecOf = (a: AnomalyDef): number => engine.ctx.galaxies.get(a.galaxyId)?.security ?? 1
  const items = listed.map((a) => {
    const galaxy = engine.ctx.galaxies.get(a.galaxyId)
    const mins = shortestTravelMinutes(engine.ctx, originGalaxyOf(state, engine.ctx), a.galaxyId)
    return {
      a,
      id: a.id,
      name: a.name,
      security: galaxySecOf(a),
      galaxyName: galaxy?.name ?? a.galaxyId,
      dist: Number.isFinite(mins) ? mins : Number.POSITIVE_INFINITY,
      rewardIsk: a.rewardIsk,
      standingGain: a.standingGain,
    }
  })
  const pinnedIds = new Set(listed.filter((a) => weekendZoneLiveAt(state, a.galaxyId, Date.now())).map((a) => a.id))
  const sorted = [...items].sort(
    bountyComparatorOf(sort, pinnedIds),
  )

  return (
    <Panel
      className="is-fill"
      title={tr("ui.MapPage.004")}
      right={
        sec === 'shop' ? (
          <span className="app-dim">
            {tr("ui.IndustryPage.119", { p1: spendableStandingOf(state, DSI_FACTION_ID), p2: standingOf(state, DSI_FACTION_ID) })}
          </span>
        ) : (
          <span className="app-dim">{tr("ui.Expedition.131")} {listed.length} {tr("ui.Expedition.132")}</span>
        )
      }
    >
      {/* **子页标签**（船长 2026-09-27 令）：常驻悬赏（老内容）/ 声望商店（章鱼人兑换）——
          结构与 `.app-subtabs` 写法照抄 `panels/WormholeScan.tsx` 那两个子页。 */}
      <div className="app-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={sec === 'bounty'}
          className={`app-subtab${sec === 'bounty' ? ' is-active' : ''}`}
          onClick={() => setSec('bounty')}
        >
          {tr("ui.MapPage.004")}
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shop'}
          className={`app-subtab${sec === 'shop' ? ' is-active' : ''}`}
          onClick={() => setSec('shop')}
        >
          {tr("ui.Expedition.446")}
        </button>
      </div>
      {sec === 'shop' ? <PlugExchangeBody engine={engine} onToast={onToast} /> : null}
      {/* ───── 以下 = 「常驻悬赏」子页（原内容，一字未动） ───── */}
      <div className={`app-subpage${sec === 'bounty' ? '' : ' is-hidden'}`}>
      <div className="app-task-sortrow">
        <span className="app-dim">{tr("ui.Expedition.133")}</span>
        <select className="app-select" value={sort} onChange={(e) => changeSort(e.target.value as TaskSort)}>
          {(Object.keys(TASK_SORT_LABEL) as TaskSort[]).map((k) => (
            <option key={k} value={k}>
              {TASK_SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="app-ano-list" ref={listRef}>
        {sorted.length === 0 ? (
          <div className="app-dim app-exp-idle">
            {tr("ui.Expedition.134")}
          </div>
        ) : null}
        {sorted.map((item) => (
          <AnomalyCard key={item.a.id} engine={engine} anomaly={item.a} onToast={onToast} showFoeArt={showFoeArt} />
        ))}
      </div>
      </div>
    </Panel>
  )
}
