/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameEngine } from '../../game/engine'
import { type ToastFn, MONEY_GLYPH } from '../../pages/common'
import { useL10n, tr, cmdText } from '../../i18n/locale'
import { COURIER_BOARD_PERIOD_MS, type SideTask, type SideTaskBoardView, type SimContext } from '@whale/core'
import { fmtDayClock, fmtSideClock } from '../../i18n/fmt'
import { useState } from 'react'

/** 时效任务排序（2026-10-02 批次 4q 从 Expedition.tsx 迁来） */
export type SideTaskSort = 'level' | 'value'

export const SIDE_TASK_SORT_KEY = 'whale-idle:sidetask-sort'

/** mm:ss（向上取整到秒；与市场页下次补给同口径）
 * （2026-10-02 批次 4p 迁到 i18n/fmt：StarMap 与 Expedition 共用，留本文件会造回环） */

/** h:mm:ss（日板倒计时：赏金一轮 24 小时，mm:ss 不够看）
 * （2026-10-02 批次 4p 迁到 i18n/fmt） */

/** 时效任务区：资源 = 限时收购（协会收商品，仓库足量直接交付）；快递 = 副站真实航行投送
 *  （需建成一座副站解锁；两步：出发投送 → 到站自动结算） */
export function SideTasksArea({ engine, onToast, kind }: { engine: GameEngine; onToast: ToastFn; kind: 'resource' | 'courier' }) {
  const state = engine.state
  useL10n()
  const view = engine.sideTasksView()
  const isCourier = kind === 'courier'
  /**
   * **两族节奏不同，各自算各自的**（**2026-09-24 船长报障**：「快递任务现在是 2 小时刷新周期，但是卡片上和
   * 快递任务页面写的还是 20 分钟」）：资源仍跟市场「补给刷新」（`orderLifeMs.common`，20 分钟）；
   * 快递按 `COURIER_BOARD_PERIOD_MS`（120 分钟，2026-09-24 船长令）——**倒计时与"每 N 分钟一轮"文案
   * 都取本族的常量**，别再拿资源那 20 分钟套在快递头上。
   */
  const periodMin = Math.max(
    1,
    Math.round((isCourier ? COURIER_BOARD_PERIOD_MS : engine.ctx.balance.market.orderLifeMs.common) / 60_000),
  )
  /** 本族本批的剩余（快递 = 到下一个 120 分钟整点；资源 = 到下一个 20 分钟整点） */
  const remainMs = isCourier ? view.courierRemainingMs : view.remainingMs
  /** 倒计时格式：快递一轮两小时 ⇒ 用 h:mm:ss（`mm:ss` 会写出「118:23」那种分钟数） */
  const clock = isCourier ? fmtDayClock : fmtSideClock
  /**
   * **任务排序**（船长 2026-09-19：「添加个默认排序（从低到高）和价值排序（从高到低）」；
   * 追问三答：默认排序 = **按任务级别 L1→L5** · 价值排序 = **按奖励从高到低** ·
   * **两者只在「资源任务」「快递任务」两个子页出现**（重要/赏金没有 L1~L5，故那一页不渲染本行）。
   * 选择随档存本地（与悬赏排序同一个 `whale-idle:*` 家族）；默认 = 「默认排序」。
   */
  const [sort, setSort] = useState<SideTaskSort>(() => {
    try {
      return localStorage.getItem(SIDE_TASK_SORT_KEY) === 'value' ? 'value' : 'level'
    } catch {
      return 'level'
    }
  })
  function changeSort(next: SideTaskSort): void {
    setSort(next)
    try {
      localStorage.setItem(SIDE_TASK_SORT_KEY, next)
    } catch {
      /* 忽略 */
    }
  }
  // 快递：**已接单的排在前面**（跨刷新保留；出发/放弃才离场），随后是本批板上的订单
  // ⚠ 排序键只作用于**同一组之内**（已接单组 / 本批板组各自排），免得"已接单"被级别混到后面去
  const bySort = (arr: readonly SideTask[]): SideTask[] =>
    [...arr].sort((a, b) =>
      sort === 'value' ? (b.rewardIsk ?? 0) - (a.rewardIsk ?? 0) : (a.level ?? 0) - (b.level ?? 0),
    )
  const tasks = isCourier ? [...bySort(view.accepted), ...bySort(view.courier)] : bySort(view.resource)
  // 快递：本批某单是否就是当前在途投送（仍在板上）；整板刷新后原单被换下 → 由顶部横幅继续提示
  const deliverNowId = view.deliver?.taskId ?? null
  // 在途单不在本批板上（整板刷新后）：横幅 + 本批其余订单都显示
  const inflightOffBoard = isCourier && deliverNowId !== null && !tasks.some((t) => t.id === deliverNowId)

  const act = (id: number): void => {
    if (isCourier) {
      const r = engine.startCourierDeliveryAt(id)
      if (r.ok) onToast(tr("ui.Expedition.158"))
      else onToast(cmdText(r) || tr('ui.Expedition.396'), true)
      return
    }
    const r = engine.completeSideTaskAt('resource', id)
    if (r.ok) onToast(tr("ui.Expedition.049"))
    else onToast(cmdText(r) || tr('ui.Expedition.397'), true)
  }

  const headText = isCourier
    ? view.courierUnlocked
      ? tr("ui.Expedition.103")
      : tr("ui.Expedition.104")
    : tr("ui.Expedition.105")

  return (
    <div className="app-sidetasks">
      <div className="app-sidetasks-head">
        <span>{headText}</span>
        {!isCourier || view.courierUnlocked ? (
          view.opened || tasks.length > 0 ? (
            <span
              className="app-st-time"
              title={isCourier ? tr('ui.Expedition.434', { periodMin: periodMin }) : tr("ui.Expedition.221", { periodMin: periodMin })}
            >
              {tr("ui.Expedition.281")} {clock(remainMs)}{tr('ui.Expedition.420')}{periodMin} {tr("ui.Expedition.106")}
            </span>
          ) : (
            <span className="app-dim">{tr("ui.Expedition.326")} {periodMin} {tr("ui.Expedition.107")}</span>
          )
        ) : null}
      </div>
      {isCourier && !view.courierUnlocked ? (
        <div className="app-dim app-exp-idle">
          {tr("ui.Expedition.159")}
        </div>
      ) : (
        <>
          {/* 排序行（船长 2026-09-19）：结构逐字复刻「常驻悬赏」那条（`app-task-sortrow` + `app-select`） */}
          <div className="app-task-sortrow">
            <span className="app-dim">{tr('ui.Expedition.377')}</span>
            <select
              className="app-select"
              value={sort}
              onChange={(e) => changeSort(e.target.value as SideTaskSort)}
              title={tr('ui.Expedition.372')}
            >
              <option value="level">{tr('ui.Expedition.373')}</option>
              <option value="value">{tr('ui.Expedition.374')}</option>
            </select>
          </div>
          {tasks.length === 0 ? (
        isCourier && inflightOffBoard ? (
          // 整板刷新把在途单换下：投送不受影响，横幅持续显示到到站结算
          <CourierInFlightBanner view={view} ctx={engine.ctx} />
        ) : view.opened ? (
          <div className="app-dim app-exp-idle">
            {isCourier
              ? tr("ui.Expedition.435", { periodMin: periodMin })
              : tr("ui.Expedition.223")}
          </div>
        ) : (
          <div className="app-dim app-exp-idle">
            {isCourier
              ? tr("ui.Expedition.108")
              : tr("ui.Expedition.224")}
          </div>
        )
      ) : (
        <>
          {isCourier && inflightOffBoard ? <CourierInFlightBanner view={view} ctx={engine.ctx} /> : null}
          {tasks.map((t) => {
            const name = engine.ctx.items.get(t.refId)?.name ?? t.refId
            const have = state.warehouse.items[t.refId] ?? 0
            const short = Math.max(0, t.need - have)
            if (isCourier) {
              // —— 快递卡（2026-09-18 虚拟货物版）：接单 / 出发投送 / 投送中 ——
              const siteId = t.stationId
              const siteName = siteId ? engine.ctx.stations.get(siteId)?.name ?? siteId : undefined
              const galaxyName = t.galaxyId ? engine.ctx.galaxies.get(t.galaxyId)?.name ?? t.galaxyId : undefined
              const isThisInFlight = view.deliver !== null && view.deliver.taskId === t.id
              const otherInFlight = view.deliver !== null && !isThisInFlight
              const expired = remainMs <= 0
              const vol = t.volumeM3 ?? 0
              const cap = engine.cargoCapacityM3()
              const warp = engine.warpSpeedOfCurrent()
              const warpShort = t.timed === true && t.warpReqAus !== undefined && warp + 1e-9 < t.warpReqAus
              const cargoShort = vol > cap
              const accepted = view.accepted.some((a) => a.id === t.id)
              const limitMin = t.timeLimitMs !== undefined ? Math.max(1, Math.round(t.timeLimitMs / 60_000)) : null
              const lockedTxt = cargoShort
                ? tr("ui.Expedition.282", { p1: vol.toLocaleString('zh-CN'), p2: cap.toLocaleString('zh-CN') })
                : warpShort
                  ? tr("ui.Expedition.327", { p1: t.warpReqAus ?? 0, p2: warp.toFixed(2) })
                  : expired && !accepted
                    ? tr("ui.Expedition.225")
                    : otherInFlight
                      ? tr("ui.Expedition.160")
                      : undefined
              return (
                <div key={t.id} className="app-station-card">
                  <div className="app-station-head">
                    <span className="app-station-name">
                      {tr("ui.Expedition.050")}{t.level ?? 1}：{vol.toLocaleString('zh-CN')} m³
                      <em className="app-chip">{t.timed === true ? tr("ui.Expedition.328", { p1: t.warpReqAus ?? 0 }) : tr("ui.Expedition.226")}</em>
                    </span>
                    <span className="app-dim">{accepted ? tr("ui.Expedition.161") : tr("ui.Expedition.109", { p1: clock(remainMs) })}</span>
                  </div>
                  <div className="app-station-mats">
                    {tr("ui.Expedition.283")}{siteName ?? tr("ui.Expedition.329")}」{galaxyName ? `（${galaxyName}）` : ''}{tr('ui.Expedition.421')}
                    {vol.toLocaleString('zh-CN')}{tr('ui.Expedition.422')}
                    {t.timed === true && limitMin !== null
                      ? ` 限时快递：需在 ${limitMin} 分钟内抵达，超时无报酬（本舰跃迁 ${warp.toFixed(2)} AU/s，门槛 ${t.warpReqAus} AU/s）。`
                      : ''}
                  </div>
                  {/* 奖励独立成行 + 金色 */}
                  <div className="app-task-reward">
                    <span className="app-dim">{t.timed === true ? tr("ui.Expedition.330") : tr("ui.Expedition.331")}</span>
                    {MONEY_GLYPH} {t.rewardIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                  </div>
                  <div className="app-station-deliver">
                    <span className="app-dim">
                      {tr("ui.Expedition.227")} {cap.toLocaleString('zh-CN')} m³{accepted ? tr("ui.Expedition.357") : ''}
                    </span>
                    {isThisInFlight ? (
                      <span className="app-btn is-small is-primary" aria-disabled title={tr("ui.Expedition.284")}>
                        {tr("ui.Expedition.162")} {fmtSideClock(view.deliver!.remainingMs)}
                      </span>
                    ) : (
                      <>
                        {accepted ? (
                          <button
                            className="app-btn is-small"
                            title={tr("ui.Expedition.228")}
                            onClick={() => {
                              const r = engine.abandonAcceptedCourierAt(t.id)
                              onToast(r.ok ? tr("ui.Expedition.163") : cmdText(r) || tr('ui.Expedition.401'), !r.ok)
                            }}
                          >
                            {tr("ui.Expedition.006")}
                          </button>
                        ) : (
                          <button
                            className="app-btn is-small"
                            disabled={otherInFlight}
                            title={tr("ui.Expedition.164")}
                            onClick={() => {
                              const r = engine.acceptCourierAt(t.id)
                              onToast(r.ok ? tr("ui.Expedition.165") : cmdText(r) || tr('ui.Expedition.402'), !r.ok)
                            }}
                          >
                            {tr("ui.Expedition.166")}
                          </button>
                        )}
                        <button
                          className="app-btn is-small is-primary"
                          disabled={cargoShort || warpShort || (expired && !accepted) || otherInFlight}
                          title={lockedTxt ?? tr("ui.Expedition.110", { p1: vol.toLocaleString('zh-CN'), p2: siteName ?? tr('ui.Expedition.403'), p3: t.rewardIsk.toLocaleString('zh-CN') })}
                          onClick={() => {
                            const r = engine.startCourierDeliveryAt(t.id)
                            onToast(
                              r.ok
                                ? t.timed === true
                                  ? tr("ui.Expedition.111")
                                  : tr("ui.Expedition.112")
                                : cmdText(r) || tr('ui.Expedition.396'),
                              !r.ok,
                            )
                          }}
                        >
                          {tr("ui.Expedition.113")}{vol.toLocaleString('zh-CN')} m³）
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            }
            // —— 资源卡：仓库足量即时交付（级别越高，收购量与奖励越大）——
            const canFinish = have >= t.need && view.remainingMs > 0
            const lockedTxt = short > 0
              ? tr("ui.Expedition.229", { name: name, p2: short.toLocaleString('zh-CN'), p3: t.need.toLocaleString('zh-CN'), p4: have.toLocaleString('zh-CN') })
              : tr("ui.Expedition.230")
            return (
              <div key={t.id} className="app-station-card">
                <div className="app-station-head">
                  <span className="app-station-name">
                    {tr("ui.Expedition.051")}{t.level ?? 1}：{name} × {t.need.toLocaleString('zh-CN')}
                    <em className="app-chip">{tr("ui.Expedition.231")}</em>
                  </span>
                  <span className="app-dim">{tr("ui.Expedition.114")} {fmtSideClock(view.remainingMs)}</span>
                </div>
                <div className="app-station-mats">
                  {tr("ui.Expedition.115")} {name}×{t.need.toLocaleString('zh-CN')}（L{t.level ?? 1}{tr('ui.Expedition.423')}
                </div>
                {/* 奖励独立成行 + 金色（船长 2026-09-18：「所有任务卡片都有的问题，奖励不明显」） */}
                <div className="app-task-reward">
                  <span className="app-dim">{tr("ui.Expedition.004")} </span>
                  {MONEY_GLYPH} {t.rewardIsk.toLocaleString('zh-CN')} {tr("ui.FirstTasks.003")}
                  {/**
                   * **均价**（船长 2026-09-19：「资源任务，在报酬后面用**普通颜色**的字体显示
                   * **平均每单位资源的价格**」）：`奖励 ÷ 收购量`，四舍五入到整数信用点。
                   *
                   * 为什么要它：资源单之间**只有"总价"可比**，而同一档的收购量不同 ⇒ 总价高的单
                   * 未必单价高（换货/买入交付时，单价才是真正决定赚不赚的数）。
                   * 颜色：外层 `.app-task-reward` 是金色（奖励专用）⇒ 这里显式用**普通正文色**
                   * （`.app-unit-price`），与"奖励"从观感上分开——船长要的就是这个对比。
                   */}
                  <span
                    className="app-unit-price"
                    title={tr('ui.Expedition.375', {
                      isk: t.rewardIsk.toLocaleString('zh-CN'),
                      need: t.need.toLocaleString('zh-CN'),
                    })}
                  >
                    {tr('ui.Expedition.376', { n: Math.round(t.rewardIsk / Math.max(1, t.need)).toLocaleString('zh-CN') })}
                  </span>
                </div>
                <div className="app-station-deliver">
                  <span className="app-dim">
                    {tr("ui.Expedition.052")} {have.toLocaleString('zh-CN')} {tr("ui.Expedition.102")}{short > 0 ? tr("ui.Expedition.332", { p1: short.toLocaleString('zh-CN') }) : ''}
                  </span>
                  <button
                    className="app-btn is-small is-primary"
                    disabled={!canFinish}
                    title={canFinish ? tr("ui.Expedition.053", { name: name, p2: t.need.toLocaleString('zh-CN'), p3: t.rewardIsk.toLocaleString('zh-CN') }) : lockedTxt}
                    onClick={() => act(t.id)}
                  >
                    {tr("ui.Expedition.116")}{Math.min(have, t.need).toLocaleString('zh-CN')}/{t.need.toLocaleString('zh-CN')}）
                  </button>
                </div>
              </div>
            )
          })}
        </>
      )}
        </>
      )}
    </div>
  )
}

/** 快递投送在途横幅（2026-09-18 虚拟货物版）：体积/级别/限时与截止倒计时；到站自动结算不可取消 */
export function CourierInFlightBanner({ view, ctx }: { view: SideTaskBoardView; ctx: SimContext }) {
  const d = view.deliver
  if (!d) return null
  const legacyName = d.refId.length > 0 ? ctx.items.get(d.refId)?.name ?? d.refId : ''
  const head =
    d.volumeM3 > 0
      ? `投送中：虚拟货物 ${d.volumeM3.toLocaleString('zh-CN')} m³（L${d.level}${d.timed ? tr("ui.Expedition.358") : ''}）→ 「${d.stationName}」（${d.galaxyName}）`
      : tr("ui.Expedition.178", { legacyName: legacyName, p2: d.need.toLocaleString('zh-CN'), p3: d.stationName, p4: d.galaxyName })
  return (
    <div className="app-station-card is-built">
      <div className="app-station-head">
        <span className="app-station-name">
          ⌁ {head}
          <em className="app-chip">{d.remainingMs > 0 ? tr("ui.Expedition.122") : tr("ui.Expedition.123")}</em>
        </span>
        <span className="app-dim">
          {d.remainingMs > 0 ? tr("ui.Expedition.341", { p1: fmtSideClock(d.remainingMs) }) : tr("ui.Expedition.124")}
          {d.deadlineRemainingMs !== null
            ? d.deadlineRemainingMs >= 0
              ? tr("ui.Expedition.359", { p1: fmtSideClock(d.deadlineRemainingMs) })
              : tr("ui.Expedition.360")
            : ''}
        </span>
      </div>
      <div className="app-station-mats">
        {tr('ui.Expedition.411')}
      </div>
    </div>
  )
}
