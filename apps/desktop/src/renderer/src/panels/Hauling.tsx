/**
 * 任务中心 · 运输任务（2026-09-09 船长定稿 + 当日改）：
 * - 任意两座「已建成」站点之间的真实航程往返运输（自动循环）；
 * - **不要求停靠在航线端点**：停靠在任意协会站点即可接单，不在端点时引擎先飞"就位段"
 *   到较近端点，再按所选航线循环；
 * - **进行中任务在对应航线卡上显示本段进度条**，卡上可直接停止（停止 = 立即返航出发站）；
 * - 任务中货仓被虚拟货物占满（见货仓页提示）。
 */
import {
  cargoCapacityM3Of,
  dockedHaulEndpoint,
  haulEndpoints,
  haulLegReward,
  shortestTravelMinutes,
  travelMinutesEff,
  shipDisplayName,
} from '@whale/core'
import { ProgressBar } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { isk } from '../pages/common'

interface RouteCard {
  key: string
  aName: string
  bName: string
  aId: string | null
  bId: string | null
  minutes: number
}

function fmtMin(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const rs = s % 60
    return rs > 0 ? `${m} 分 ${rs} 秒` : `${m} 分钟`
  }
  return `${s} 秒`
}

export function HaulingPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const ctx = engine.ctx
  const endpoints = haulEndpoints(state, ctx)
  const busy =
    state.mining.active ||
    state.salvaging.active ||
    state.expedition.active ||
    state.scanning.active ||
    state.standby.active ||
    state.transit.active
  const haulingActive = state.hauling.active
  const h = state.hauling
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
    if (!r.ok) onToast(r.error ?? '无法开始运输。', true)
    else if (dockedOk && (docked === aId || docked === bId))
      onToast('运输任务开始：虚拟货物占满货仓，往返航行中……')
    else onToast('运输任务开始：先飞就位段到较近端点，随后自动往返（虚拟货物占满货仓）。')
  }

  function stopNow(): void {
    const r = engine.stopHaulingNow()
    if (!r.ok) onToast(r.error ?? '停止失败。', true)
    else onToast('运输任务已停止：舰船已即时返港停靠出发站（无惩罚）。')
  }

  return (
    <div>
      <div className="app-dim app-exp-idle">
        在任意已建成站点（母港或副空间站）停靠即可接单：任选两座站点之间的航线往返运输，每段按
        「货仓容量 × 费率 × 航程」结算报酬；不在航线端点时会先飞「就位段」到较近端点，再自动循环。
        随时可停止（活动栏或航线卡「停止运输」= 即时返港，无需返程时间）。
      </div>

      {endpoints.length < 2 ? (
        <div className="app-dim app-exp-idle">
          暂无可行航线——先完成一座副空间站的建设（任务中心「重要任务/资源任务」有建站指引），建成后即可在两站间跑运输。
        </div>
      ) : (
        <div className="app-haul-list">
          {routes.map((rt) => {
            const isActive = rt.key === activeKey
            const effMin = Math.max(1, travelMinutesEff(state, ctx, rt.minutes))
            const perLeg = haulLegReward(cap, rt.minutes)
            const perRound = perLeg * 2
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
                    {isActive ? <span className="app-chip app-haul-running">运输中</span> : null}
                  </span>
                  <span className="app-dim">单程约 {effMin} 分钟（按当前航行技能）</span>
                </div>
                <div className="app-haul-line app-dim">
                  {shipName}（货仓 {cap.toLocaleString('zh-CN')} m³）· 单段约 {isk(perLeg)} ISK · 往返一趟约 {isk(perRound)} ISK ·
                  时薪约 {isk(Math.round((perLeg / effMin) * 60))} ISK（按当前航行技能）
                </div>
                {isActive ? (
                  <div className="app-haul-line">
                    <ProgressBar
                      value={h.legMs > 0 ? Math.min(100, (h.phaseAccMs / h.legMs) * 100) : 0}
                      tone="warn"
                      label={`本段驶往「${h.toSiteId === null ? '母港' : ctx.stations.get(h.toSiteId!)?.name ?? '空间站'}」· 剩余约 ${fmtMin(Math.max(0, h.legMs - h.phaseAccMs))}`}
                    />
                    <button className="app-btn is-small" onClick={stopNow} title="立即停止：即时返港停靠出发站，无需返程时间（无惩罚）">
                      停止运输
                    </button>
                  </div>
                ) : (
                  <div className="app-haul-actions">
                    {haulingActive ? (
                      <span className="app-dim">运输任务进行中（见上方航线卡）——先停止才能换线。</span>
                    ) : !dockedOk ? (
                      <span className="app-dim">先返航停靠到任意空间站即可开始（不要求是航线端点）。</span>
                    ) : null}
                    {canStart ? (
                      <button
                        className="app-btn is-small is-primary"
                        title={`开始往返运输：${rt.aName} ⇄ ${rt.bName}（不在端点时先就位飞行）`}
                        onClick={() => startTo(rt.aId, rt.bId)}
                      >
                        开始运输
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
  )
}
