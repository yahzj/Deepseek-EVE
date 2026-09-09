/**
 * 任务中心 · 运输任务（2026-09-09 船长定稿）：
 * 驾驶船在两座「已建成」站点间做真实航程的往返运输（自动循环，可到站即停）。
 * 展示全部可行航线（当前船容量 → 单段/往返报酬预估），停靠在端点站即可开始；
 * 任务中货仓被虚拟货物占满（见货仓页），此处给进行中状态与停止指引。
 */
import {
  HAUL_RATE_PER_M3_MIN,
  cargoCapacityM3Of,
  dockedHaulEndpoint,
  haulEndpoints,
  haulLegReward,
  shortestTravelMinutes,
  shipDisplayName,
} from '@whale/core'
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

export function HaulingPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const ctx = engine.ctx
  const endpoints = haulEndpoints(state, ctx)
  const busy =
    state.hauling.active ||
    state.mining.active ||
    state.salvaging.active ||
    state.expedition.active ||
    state.scanning.active ||
    state.standby.active ||
    state.transit.active
  const docked = dockedHaulEndpoint(state) // null 表示在野外；此处兼作"母港停靠"端点 id
  const dockedOk = state.awayGalaxy === null

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

  function startTo(target: string | null): void {
    const r = engine.startHaulingAt(target)
    if (!r.ok) onToast(r.error ?? '无法开始运输。', true)
    else onToast('运输任务开始：虚拟货物已占满货仓，航行中……到站自动结算报酬。')
  }

  return (
    <div>
      <div className="app-dim app-exp-idle">
        在任一已建成站点（母港或副空间站）停靠即可接单：在另一座已建成站点之间往返运输协会物资，
        每段按「货仓容量 × 费率 × 航程」结算报酬——任务循环自动续跑，可随时到站即停（顶部活动栏「停止运输」）。
      </div>

      {state.hauling.active ? (
        <div className="app-haul-active">
          <div className="app-dim">
            {shipName} 正在运输中：{state.hauling.toSiteId === null ? '母港' : ctx.stations.get(state.hauling.toSiteId!)?.name ?? '空间站'} 方向 ·
            本段航程约 {Math.max(1, Math.round(state.hauling.legMinutes))} 分钟 · 到站结算后自动续跑
            {state.hauling.stopNext ? '（已安排在到站后停止）' : ''}。
          </div>
          <div className="app-dim">查看/停止：顶部活动栏「运输任务」条目；货仓页会显示虚拟货物占满货仓。</div>
        </div>
      ) : null}

      {endpoints.length < 2 ? (
        <div className="app-dim app-exp-idle">
          暂无可行航线——先完成一座副空间站的建设（任务中心「重要任务/资源任务」有建站指引），建成后即可在两站间跑运输。
        </div>
      ) : (
        <div className="app-haul-list">
          {routes.map((rt) => {
            const perLeg = haulLegReward(cap, rt.minutes)
            const perRound = perLeg * 2
            const atThisDock = dockedOk && (docked === rt.aId || docked === rt.bId)
            const target = docked === rt.aId ? rt.bId : rt.aId
            return (
              <div key={rt.key} className="app-haul-row">
                <div className="app-haul-line">
                  <span className="app-haul-route">
                    {rt.aName} ⇄ {rt.bName}
                  </span>
                  <span className="app-dim">单程约 {rt.minutes} 分钟</span>
                </div>
                <div className="app-haul-line app-dim">
                  {shipName}（货仓 {cap.toLocaleString('zh-CN')} m³）· 单段约 {isk(perLeg)} ISK · 往返一趟约 {isk(perRound)} ISK ·
                  满速时薪约 {isk(Math.round(cap * HAUL_RATE_PER_M3_MIN * 60))} ISK
                </div>
                <div className="app-haul-actions">
                  {!atThisDock ? <span className="app-dim">先返航并停靠在「{rt.aName}」或「{rt.bName}」即可开始</span> : null}
                  {atThisDock ? (
                    <button
                      className="app-btn is-small is-primary"
                      disabled={busy && !state.hauling.active}
                      title={
                        busy && !state.hauling.active
                          ? '有作业进行中：先结束当前作业（顶部活动栏）再接运输'
                          : `开始往返运输：${rt.aName} ⇄ ${rt.bName}`
                      }
                      onClick={() => startTo(target)}
                    >
                      {state.hauling.active ? '换线运输' : '开始运输'}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
