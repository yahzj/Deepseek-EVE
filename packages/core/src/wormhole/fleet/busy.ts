import type { GameState } from '../../state'
import { busyLabel, type BusyLabel } from '../../busyLabels'
import { commandShipDeployed } from '../../combat/command/locks'

/**
 * **某艘船此刻的忙态**（进洞门槛用；`null` = 空闲）。
 *
 * ⚠ **为什么在 `wormhole.ts` 里重写一份、而不是 import `activity.shipBusyLabel`**（2026-09-13 实测）：
 * `wormhole.ts` 被 `state.ts` 顶层引用，一旦它 import `activity`，就形成
 * `state → wormhole → activity → expedition → state` 的环 —— 而 `expedition.ts` 顶层读
 * `HOME_GALAXY_ID`，首跑即 `Cannot access 'HOME_GALAXY_ID' before initialization`
 * （与 D 批 `wormhole → shipyard → hauling` 同款；两回都真踩到了）。
 * 故这里只读 `state` 上的普通字段，**不 import 任何重模块**。
 *
 * 口径与 `activity.shipBusyLabel` **一致**（那边是"给玩家看的忙态徽标"，判据同一批字段）；
 * 两边的**一致性由用例 `wormhole-entry-gate.test.ts` 钉住**（同一现场两边必须同时"忙/闲"）。
 * 已知差异（有意）：这里**不覆盖** `shipInReturn`（换船善后返航，需 import `mining`）——
 * 那一档由界面侧的 `shipBusyLabel` 拦（准备页按它置灰），core 这层只保底。
 */
export function shipBusyForWormhole(state: GameState, shipId: string): BusyLabel | null {
  if ((state.wormhole.run?.fleet ?? []).includes(shipId)) return busyLabel('wormhole')
  return shipActivityBusy(state, shipId)
}

/**
 * **该船此刻手上有别的"活动"吗**（**不含虫洞本身**）——"进洞门槛"与"返回虫洞"共用这一把尺。
 * 口径同 `activity.shipBusyLabel`，差别只在：这里**不**把"在洞里"当忙（返回虫洞时要排除自己）。
 *
 * ⚠ **2026-09-14 补齐五档**（船长报障：「进入虫洞时必须无活动。好像失效了？」）：原实现只认
 * 采矿 / 快递 / 巡逻 / 扫描星系 / 远征，**漏了后来上线的四个活动** —— **打捞**（`state.salvaging`）、
 * **长途运输**（`state.hauling`）、**扫描虫洞**（`state.wormholeScan`）与**亲自主持的炉线**
 * （`refineRuns` / `manufacturingRuns` 里 `worker === 'pilot'` 且 `active`）⇒ 那些活动在跑时主控照样能进洞。
 * 由 `tests/wormhole-activity-lock.test.ts` 逐档钉住（含与 `shipBusyLabel` 的一致性）。
 */
export function shipActivityBusy(state: GameState, shipId: string): BusyLabel | null {
  if (commandShipDeployed(state, shipId)) return busyLabel('expedition')
  if (state.shipReturns[shipId]) return busyLabel('unload')
  if ((state.planetary?.deliveries ?? []).some(d => d.shipUid === shipId)) return busyLabel('planetDelivery')
  if (shipId !== state.shipId) {
    const task = state.aiAssignments[shipId]?.task
    if (!task) return null
    // 用词与 `shipBusyLabel` 对齐（玩家在提示里看到的是这一串）
    if (task.kind === 'mining') return busyLabel('aiMining')
    if (task.kind === 'standby') return busyLabel('aiPatrol')
    return busyLabel('aiExpedition')
  }
  if (state.mining.active) return busyLabel('mining')
  if (state.salvaging.active) return busyLabel('salvage')
  if (state.hauling.active) return busyLabel('hauling')
  if (state.sideTasks.deliver !== null) return busyLabel('courier')
  if (state.standby.active) return busyLabel('patrol')
  if (state.wormholeScan?.active === true) return busyLabel('whscan')
  if (state.expedition.active) return busyLabel('expedition')
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return busyLabel('refine')
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return busyLabel('manufacture')
  /**
   * **实验室**（**2026-10-01 接入**）：主控亲自运转的那条线同样算"手上有活"——漏了它，实验室在跑时
   * 主控照样能进洞（进洞 = 主控的另一个活动 ⇒ 又是双占）。判据与 `activity.shipBusyLabel`、
   * `activityGate.mainActivityOf` 三处同源。
   */
  if ((state.labRuns ?? []).some((r) => r.active && r.worker === 'pilot')) return busyLabel('lab')
  /**
   * **建站交付**（2026-09-22 船长令纳入主控活动表）：占的是 `transit` 槽，靠 `delivery` 批次区分于
   * "换港返航"；用词与 `activity.shipBusyLabel` 对齐（两处必须成对，见 `activity-gate` / 本函数注释）。
   */
  if (state.transit.active && state.transit.delivery !== null) return busyLabel('deliver')
  return null
}
