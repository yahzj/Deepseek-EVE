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
  cargoCapacityM3Of,
  dockedHaulEndpoint,
  haulEffectiveMinutes,
  haulEndpoints,
  haulExposureAt,
  haulLegMinutesOf,
  haulRewardRange,
  shortestTravelMinutes,
  travelMinutesEff,
  shipDisplayName,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { isk } from '../pages/common'
import { HintIcon } from '../ui/Hint'
import { tr, cmdText } from '../i18n/locale'

interface RouteCard {
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
  const busy = state.transit.active
  const haulingActive = state.hauling.active
  const h = state.hauling
  /**
   * **中断确认**（**2026-09-20 船长令**）：本页的「停止运输」与活动栏那颗同款两讨伐确认——
   * 第一下只警告（**本趟报酬到站才结，中断就拿不到**），第二下才真停。
   */
  const [stopAsk, setStopAsk] = useState(false)
  const dockedOk = state.awayGalaxy === null // 停在任意空间站（母港或已建成副站）即可接单
  const docked = dockedHaulEndpoint(state)

  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  const shipName = shipDisplayName(state, ctx, state.shipId)

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
        aName: a.name,
        bName: b.name,
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

  function startTo(aId: string | null, bId: string | null): void {
    const r = engine.startHaulingAt(aId, bId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Hauling.030'), true)
    else if (dockedOk && (docked === aId || docked === bId))
      onToast(tr("ui.Hauling.004"))
    else onToast(tr("ui.Hauling.005"))
  }

  function stopNow(): void {
    const r = engine.stopHaulingNow()
    if (!r.ok) onToast(cmdText(r) || tr('ui.Hauling.031'), true)
    else onToast(tr("ui.ActivityBar.050"))
  }

  /** 标题右的状态读数（与同级「残骸打捞」同款：一句，不长篇） */
  const haulStateText = haulingActive
    ? tr("ui.Hauling.026", { p1: h.toSiteId === null ? tr("ui.Expedition.007") : ctx.stations.get(h.toSiteId)?.name ?? tr('ui.Hauling.032') })
    : dockedOk
      ? tr("ui.Hauling.006")
      : tr("ui.Hauling.007")

  return (
    <Panel
      className="is-fill win-fixed-body"
      title={tr("ui.MapPage.006")}
      hint={
        <HintIcon tip={tr("ui.Hauling.008")} />
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
              const legMin = haulLegMinutesOf(rt.minutes)
              const effMin = Math.max(1, travelMinutesEff(state, ctx, legMin))
              // 面板**只显示区间**（船长 2026-09-11：不预告本趟实际掷值）；基准用**有效距离**
              // （逐跳安全档加权，2026-09-12 船长定；面板不显示档位与系数，只让金额变）
              const range = haulRewardRange(ctx, cap, haulEffectiveMinutes(ctx, rt.aGalaxyId, rt.bGalaxyId))
              const hourlyMin = Math.round((range.min / effMin) * 60)
              const hourlyMax = Math.round((range.max / effMin) * 60)
              // 会遇袭标注（2026-09-13 船长「会遇袭的运输任务需要特意标注出该情况」）：
              // 任一端点在低安 ⇒ 那一段从低安出发、会被计为"当地停留"暴露；另外停靠站不在端点时，
              // 「就位段」从当前停靠星系出发 ⇒ 停靠站在低安也算。
              const dockGalaxyId = endpoints.find((e) => e.siteId === docked)?.galaxyId
              const positional = docked !== rt.aId && docked !== rt.bId
              const exposed =
                haulExposureAt(ctx, rt.aGalaxyId) ||
                haulExposureAt(ctx, rt.bGalaxyId) ||
                (positional && dockGalaxyId !== undefined && haulExposureAt(ctx, dockGalaxyId))
              const canStart = dockedOk && !busy && !haulingActive
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
                          title={tr("ui.Hauling.013")}
                        >
                          {tr("ui.Hauling.014")}
                        </span>
                      ) : null}
                      {isActive ? <span className="app-chip app-haul-running">{tr("ui.Hauling.015")}</span> : null}
                    </span>
                    <span className="app-dim">{tr("ui.Hauling.016")} {effMin} {tr("ui.Hauling.017")}</span>
                  </div>
                  <div className="app-haul-line app-dim">
                    {shipName}{tr("ui.Hauling.018")} {cap.toLocaleString('zh-CN')} {tr("ui.Hauling.019")} {isk(range.min)} ~ {isk(range.max)} {tr('ui.FirstTasks.003')}
                    {tr('ui.Hauling.029', { a: `${isk(range.min * 2)} ~ ${isk(range.max * 2)}`, b: `${isk(hourlyMin)} ~ ${isk(hourlyMax)}` })}{" "}
                    {tr("ui.Hauling.020")}
                  </div>
                  {isActive ? (
                    <div className="app-haul-line">
                      <ProgressBar
                        value={h.legMs > 0 ? Math.min(100, (h.phaseAccMs / h.legMs) * 100) : 0}
                        tone="warn"
                        label={tr("ui.Hauling.027", { p1: h.toSiteId === null ? tr("ui.Expedition.007") : ctx.stations.get(h.toSiteId!)?.name ?? tr('ui.Hauling.032'), p2: fmtMin(Math.max(0, h.legMs - h.phaseAccMs)) })}
                      />
                      <button
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
                        title={stopAsk ? tr('ui.Hauling.035') : tr("ui.Hauling.021")}
                      >
                        {stopAsk ? tr('ui.Hauling.034') : tr("ui.ActivityBar.014")}
                      </button>
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
                          onClick={() => startTo(rt.aId, rt.bId)}
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
  )
}
