/**
 * 星图页「长途运输」标签（2026-09-09 船长：独立出任务中心、置于残骸打捞之后；至少建成一座副空间站解锁。定稿 + 当日改）：
 * - 任意两座「已建成」站点之间的真实航程往返运输（自动循环）；
 * - **不要求停靠在航线端点**：停靠在任意协会站点即可接单，不在端点时引擎先飞"就位段"
 *   到较近端点，再按所选航线循环；
 * - **进行中任务在对应航线卡上显示本段进度条**，卡上可直接停止（停止 = 立即返航出发站）；
 * - 任务中货仓被虚拟货物占满（见货仓页提示）。
 * - **2026-09-14 船长：「长途运输页面需要像其他同级页面那样有个内部的标题页和容器」** ⇒ 与同页
 *   「残骸打捞」「本地矿带开采」同构：外层 `<Panel className="is-fill win-fixed-body" title="长途运输">`
 *   ＋ 标题后 ⓘ（常驻说明按 2026-09-13 船长口径不再占版面）＋ 标题右一句状态读数；正文进 `.app-win-body`
 *   （列表内滚 ⇒ 守住「一级页不滚」红线）。
 */
import {
  haulFleetLoadOf,
  haulFleetPathOf,
  combatRosterOf,
  dockedHaulEndpoint,
  haulEffectiveMinutes,
  haulEndpoints,
  haulExposureAt,
  haulRewardRange,
  haulUnitRewardRange,
  shortestTravelMinutes,
  stationActivityStartBlockReason,
  shipActuallyDocked,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { useEffect, useState } from 'react'
// 公司账本：运输报酬计入星门物流的营收（docs/design/stock-gameplay-integration-20261109.md）。
import { reportCompanyFlow } from '../features/exchange/companyReporter'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { isk } from '../pages/common'
import { HintIcon } from '../ui/Hint'
import { tr, cmdText } from '../i18n/locale'
import { HaulingLoadModal, type HaulingRoute } from '../features/transport/HaulingLoadModal'
import '../features/transport/hauling.css'

interface RouteCard extends HaulingRoute {
  key: string
  aName: string
  bName: string
  aId: string | null
  bId: string | null
  /** 端点所在星系（报酬按**有效距离**算：逐跳安全档加权，2026-09-12 船长定） */
  aGalaxyId: string
  bGalaxyId: string
  minutes: number
}

function fmtMin(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const rs = s % 60
    return rs > 0 ? tr("ui.Hauling.001", { m: m, rs: rs }) : tr("ui.Hauling.002", { m: m })
  }
  return tr("ui.Hauling.003", { s: s })
}

export function HaulingPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const ctx = engine.ctx
  const endpoints = haulEndpoints(state, ctx)
  /**
   * ⚠ **2026-09-21 船长令改口径**（「统一为能够直接切换（自动取消当前活动）」）：开工门槛**不再**看
   * 「开采 / 打捞 / 远征 / 掩护巡逻在跑」——这些由 core 的统一判据裁决（可自动停的会先停掉再开工、
   * 远征直接拒）。界面只保留**位置**：
   * ① `awayGalaxy === null`（停在空间站才能接单）；② 已在运输中（要先停本趟）。
   */
  const haulingActive = state.hauling.active
  const h = state.hauling
  /**
   * **中断确认**（**2026-09-20 船长令**）：本页的「停止运输」与活动栏那颗同款两讨伐确认——
   * 第一下只警告（**本趟报酬到站才结，中断就拿不到**），第二下才真停。
   */
  const [stopAsk, setStopAsk] = useState(false)
  const [loadAsk, setLoadAsk] = useState<RouteCard | null>(null)
  /**
   * 公司账本：运输报酬计入星门物流（物流）的营收。
   * core 在每趟到站结算时会写一条 `core.industrial.004` 日志（p3 = 报酬），
   * 这里按日志 id 游标增量扫描并上报；游标存 localStorage，离线段完成后回港打开本页补报。
   */
  useEffect(() => {
    let cursor = 0
    try {
      cursor = Number(window.localStorage.getItem('exchange.haulLogCursor') ?? '0') || 0
    } catch {
      /* ignore */
    }
    const pump = (): void => {
      let maxId = cursor
      for (const entry of engine.state.logs) {
        if (entry.id <= cursor) continue
        if (entry.id > maxId) maxId = entry.id
        if (entry.textId !== 'core.industrial.004') continue
        const raw = entry.textParams?.p3
        const reward = typeof raw === 'number' ? raw : Number(raw)
        if (Number.isFinite(reward) && reward > 0) reportCompanyFlow('haul-service', 'buy', reward)
      }
      if (maxId !== cursor) {
        cursor = maxId
        try {
          window.localStorage.setItem('exchange.haulLogCursor', String(cursor))
        } catch {
          /* ignore */
        }
      }
    }
    pump()
    const timer = window.setInterval(pump, 5000)
    return () => {
      pump()
      window.clearInterval(timer)
    }
  }, [engine])
  const startBlock = stationActivityStartBlockReason(state, ctx, 'hauling')
  const dockedOk = shipActuallyDocked(state, ctx)
  const docked = dockedHaulEndpoint(state)

  const ids = h.fleetLeg?.shipIds ?? combatRosterOf(state)
  const load = haulFleetLoadOf(state, ctx, ids.filter(id => !!state.fleet[id]), 0)
  const capacity = load.capacityM3

  // 可行航线：任意两端点（跳过同星系零航程与同点）
  const routes: RouteCard[] = []
  for (let i = 0; i < endpoints.length; i += 1) {
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const a = endpoints[i]!
      const b = endpoints[j]!
      const minutes = shortestTravelMinutes(ctx, a.galaxyId, b.galaxyId)
      if (!Number.isFinite(minutes) || minutes <= 0) continue
      routes.push({
        key: `${a.siteId ?? 'home'}<>${b.siteId ?? 'home'}`,
        aName: a.siteId === null ? tr('ui.Expedition.007') : a.name,
        bName: b.siteId === null ? tr('ui.Expedition.007') : b.name,
        aId: a.siteId,
        bId: b.siteId,
        aGalaxyId: a.galaxyId,
        bGalaxyId: b.galaxyId,
        minutes: Math.round(minutes),
      })
    }
  }

  // 进行中任务对应的航线卡（routeA/routeB 为该航线两端）
  const activeKey =
    haulingActive && h.routeA !== undefined && h.routeB !== undefined
      ? `${h.routeA ?? 'home'}<>${h.routeB ?? 'home'}`
      : null

  function startTo(aId: string | null, bId: string | null, amount: number): void {
    const r = engine.startHaulingAt(aId, bId, amount)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Hauling.030'), true)
    else {
      setLoadAsk(null)
      if (r.queued) onToast(tr('core.busy.020'))
      else if (dockedOk && (docked === aId || docked === bId)) onToast(tr('ui.Hauling.004'))
      else onToast(tr('ui.Hauling.005'))
    }
  }

  function stopNow(): void {
    const r = engine.stopHaulingNow()
    if (!r.ok) onToast(cmdText(r) || tr('ui.Hauling.031'), true)
    else onToast(state.encounter.active ? tr('ui.industrial.008') : tr('core.hauling.019', { p1: h.fromSiteId ? ctx.stations.get(h.fromSiteId)?.name ?? h.fromSiteId : tr('ui.Expedition.007') }))
  }

  /** 标题右的状态读数（与同级「残骸打捞」同款：一句，不长篇） */
  const haulStateText = haulingActive
    ? tr("ui.Hauling.026", { p1: h.toSiteId === null ? tr("ui.Expedition.007") : ctx.stations.get(h.toSiteId)?.name ?? tr('ui.Hauling.032') })
    : dockedOk
      ? tr("ui.Hauling.006")
      : tr("ui.Hauling.007")

  return (
    <><Panel
      className="is-fill win-fixed-body"
      title={tr("ui.MapPage.006")}
      hint={
        <HintIcon tip={tr('ui.industrial.011')} />
      }
      right={
        <span className="app-dim">
          {tr("ui.Hauling.009")} {endpoints.length} {tr("ui.Hauling.010")} {routes.length} {tr("ui.Hauling.011")} {haulStateText}
        </span>
      }
    >
      <div className="app-win-body">
        {endpoints.length < 2 ? (
          <div className="app-dim app-inv-empty">
            {tr("ui.Hauling.012")}
          </div>
        ) : (
          <div className="app-haul-list">
            {routes.map((rt) => {
              const isActive = rt.key === activeKey
              // 航段分钟走 core 同一处口径（×HAUL_LEG_TIME_MUL，船长 2026-09-11）；报酬按「有效距离 × 距离指数 1.5 × 每趟行情 5~10 倍」
              const routePath = haulFleetPathOf(state, ctx, ids.filter(id => !!state.fleet[id]), rt.aGalaxyId, rt.bGalaxyId)
              const effMin = Math.max(1, Math.ceil(routePath.reduce((sum, row) => sum + row.durationMs, 0) / 60_000))
              // 面板**只显示区间**（船长 2026-09-11：不预告本趟实际掷值）；基准用**有效距离**
              // （逐跳安全档加权，2026-09-12 船长定；面板不显示档位与系数，只让金额变）
              const effective = haulEffectiveMinutes(ctx, rt.aGalaxyId, rt.bGalaxyId)
              const range = haulRewardRange(ctx, capacity, effective)
              const unitRange = haulUnitRewardRange(ctx, effective)
              const durationMs = routePath.reduce((sum, row) => sum + row.durationMs, 0)
              const hourlyMin = durationMs > 0 ? Math.round(range.min * 3_600_000 / durationMs) : 0
              const hourlyMax = durationMs > 0 ? Math.round(range.max * 3_600_000 / durationMs) : 0
              // 会遇袭标注（2026-09-13 船长「会遇袭的运输任务需要特意标注出该情况」）：
              // 任一端点在低安 ⇒ 那一段从低安出发、会被计为"当地停留"暴露；另外停靠站不在端点时，
              // 「就位段」从当前停靠星系出发 ⇒ 停靠站在低安也算。
              const dockGalaxyId = endpoints.find((e) => e.siteId === docked)?.galaxyId
              const positional = docked !== rt.aId && docked !== rt.bId
              const exposed =
                routePath.some(row => haulExposureAt(ctx, row.galaxyId)) ||
                haulExposureAt(ctx, rt.aGalaxyId) ||
                haulExposureAt(ctx, rt.bGalaxyId) ||
                (positional && dockGalaxyId !== undefined && haulExposureAt(ctx, dockGalaxyId))
              const canStart = startBlock === null && !haulingActive && capacity > 0
              return (
                <div
                  key={rt.key}
                  className={`app-haul-row${isActive ? ' is-active' : ''}`}
                  style={isActive ? { borderColor: 'rgba(79,216,196,0.55)' } : undefined}
                >
                  <div className="app-haul-line">
                    <span className="app-haul-route">
                      {rt.aName} ⇄ {rt.bName}
                      {exposed ? (
                        <span
                          className="app-chip is-warn"
                          title={tr('ui.industrial.012')}
                        >
                          {tr("ui.Hauling.014")}
                        </span>
                      ) : null}
                      {isActive ? <span className="app-chip app-haul-running">{tr(h.fleetLeg?.returning ? 'ui.industrial.007' : 'ui.Hauling.015')}</span> : null}
                    </span>
                    <span className="app-dim">{tr("ui.Hauling.016")} {effMin} {tr("ui.Hauling.017")}</span>
                  </div>
                  {/* ⟪文案调整 2026-11-01⟫ 航线卡仅显示全队满载及单位费率，输入移入确认弹窗。 */}
                  <dl className="app-haul-card-stats">
                    <div><dt>{tr('ui.haulLoad.003')}</dt><dd>{capacity.toLocaleString('zh-CN')} m³</dd></div>
                    <div><dt>{tr('ui.haulLoad.004')}</dt><dd>{isk(range.min)}～{isk(range.max)}</dd></div>
                    <div><dt>{tr('ui.haulLoad.005')}</dt><dd>{unitRange.min.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}～{unitRange.max.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} {tr('ui.haulLoad.022')}</dd></div>
                  </dl>
                  {/* **时薪单独一行 + 金色 + 统一格式 `XXX~XXX 信用点/h`**（**2026-09-23 船长令**：
                      「长途运输，将时薪单独列一行，并染成金色字体，改为统一格式 XXX~XXX 信用点/h」）——
                      报酬每趟按行情浮动，故给区间；金色用独立类名，不走物品色调那套。 */}
                  <div className="app-haul-line app-haul-hourly">
                    {tr('ui.haulLoad.006')} {isk(hourlyMin)}～{isk(hourlyMax)} {tr('ui.Hauling.036')}
                  </div>
                  {isActive ? (
                    <div className="app-haul-line">
                      {h.fleetLeg ? <span className="app-dim">{tr(h.fleetLeg.positioning ? 'ui.industrial.006' : h.fleetLeg.returning ? 'ui.industrial.007' : state.encounter.active ? 'ui.industrial.008' : 'ui.industrial.005', { p1: h.fleetLeg.loadedM3, p2: h.fleetLeg.targetM3 })}</span> : null}
                      <ProgressBar
                        value={h.legMs > 0 ? Math.min(100, (h.phaseAccMs / h.legMs) * 100) : 0}
                        tone="warn"
                        label={tr("ui.Hauling.027", { p1: h.toSiteId === null ? tr("ui.Expedition.007") : ctx.stations.get(h.toSiteId!)?.name ?? tr('ui.Hauling.032'), p2: fmtMin(Math.max(0, h.legMs - h.phaseAccMs)) })}
                      />
                      {h.fleetLeg && !h.fleetLeg.returning && !h.fleetLeg.abortAfterBattle ? <button className="app-btn is-small" disabled={h.fleetLeg.stopAtArrival} onClick={() => engine.stopHaulingAtArrival()}>
                        {tr(h.fleetLeg.stopAtArrival ? 'ui.industrial.004' : 'ui.industrial.003')}
                      </button> : null}
                      {h.fleetLeg && !h.fleetLeg.abortAfterBattle ? <button
                        className="app-btn is-small"
                        onClick={() => {
                          /**
                           * **中断确认**（船长 2026-09-20）：本页这颗「停止运输」与活动栏那颗同一把尺——
                           * 第一下只警告（本趟报酬到站才结、中断就拿不到），再点一次才真停。
                           */
                          if (!stopAsk) {
                            setStopAsk(true)
                            onToast(tr('ui.Hauling.033'), true)
                            return
                          }
                          setStopAsk(false)
                          stopNow()
                        }}
                        title={tr('ui.industrial.013')}
                      >
                        {stopAsk ? tr('ui.Hauling.034') : tr("ui.ActivityBar.014")}
                      </button> : null}
                    </div>
                  ) : (
                    <div className="app-haul-actions">
                      {haulingActive ? (
                        <span className="app-dim">{tr("ui.Hauling.022")}</span>
                      ) : !dockedOk ? (
                        <span className="app-dim">{tr("ui.Hauling.023")}</span>
                      ) : null}
                      {canStart ? (
                        <button
                          className="app-btn is-small is-primary"
                          title={tr("ui.Hauling.024", { p1: rt.aName, p2: rt.bName })}
                          onClick={event => { event.currentTarget.focus(); setLoadAsk(rt) }}
                        >
                          {tr("ui.Hauling.025")}
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Panel>
      {loadAsk ? <HaulingLoadModal state={state} ctx={ctx} ids={ids.filter(id => !!state.fleet[id])} route={loadAsk}
        capacity={capacity} blocked={startBlock !== null || haulingActive}
        onClose={() => setLoadAsk(null)} onConfirm={amount => startTo(loadAsk.aId, loadAsk.bId, amount)} /> : null}
    </>
  )
}
