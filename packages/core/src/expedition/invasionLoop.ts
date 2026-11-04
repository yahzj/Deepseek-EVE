/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { weekendClockOf, weekendProgressAt } from '../weekendEvent'
import { autoLoopInvasionGalaxy, autoLoopWaitLabel, stopAutoLoopInvasion } from './loopState'
import { weekendZoneLiveAt, weekendAssaultDrawOf, weekendNoteAssaultDispatch } from '../weekendBounty'
import { bountyCooldownRemainingMs, bountyCooldownMsFor } from './cooldown'
import { manualSlotOf } from '../activityGate'
import type { CommandResult } from '../engine'
import { cargoUnitM3 } from '../inventory'
import { startLoopBattle } from './loop'

/** 只读预览下一次实际出击；活动栏与在线/离线驱动共用，不消费抽签。 */
export function autoLoopInvasionPlanOf(
  state: GameState,
  ctx: SimContext,
  nowWallMs: number = weekendClockOf(state),
  requestedGalaxyId: string | null = autoLoopInvasionGalaxy(state),
) {
  const ev = state.weekendEvent
  if (requestedGalaxyId === null) return { status: 'off' as const, galaxyId: null }
  if (!ev || ev.endedAtWallMs !== undefined) return { status: 'ended' as const, galaxyId: null }
  if (!weekendZoneLiveAt(state, requestedGalaxyId, nowWallMs)) return { status: 'invalid' as const, galaxyId: null }
  const remaining = ev.peripheryIds.filter(id => weekendProgressAt(state, ev, id, nowWallMs) < 1)
  const galaxyId = remaining.length > 0
    ? remaining.includes(requestedGalaxyId) ? requestedGalaxyId : remaining[0]!
    : weekendProgressAt(state, ev, ev.coreId, nowWallMs) < 1 ? ev.coreId : null
  if (galaxyId === null) return { status: 'complete' as const, galaxyId: null }
  const dispatch = weekendAssaultDrawOf(state, ctx, galaxyId, nowWallMs)
  if (!dispatch) return { status: 'invalid' as const, galaxyId: null }
  const remainingMs = bountyCooldownRemainingMs(state, dispatch.cardId)
  const totalMs = Math.max(1, bountyCooldownMsFor(state, ctx))
  return {
    status: 'ready' as const,
    galaxyId,
    dispatch,
    remainingMs,
    percent: remainingMs > 0 ? Math.min(100, Math.max(0, Math.round((1 - remainingMs / totalMs) * 100))) : null,
    waitFor: autoLoopWaitLabel(state) ?? (manualSlotOf(state) === 'lab' ? '实验室作业' : null),
  }
}

/**
 * 开关：`galaxyId = null` ⇒ 停；否则要求该星系**当前仍被入侵**（活动未结束）。
 * 开启时**清掉常驻悬赏那条环**——两者都要占主控，同一时间只跑一条。
 */
export function setAutoLoopInvasion(state: GameState, ctx: SimContext, galaxyId: string | null, nowWallMs = weekendClockOf(state)): CommandResult {
  const ev = state.weekendEvent
  if (galaxyId === null) {
    if (ev) delete ev.autoLoopGalaxyId
    addLog(state, 'combat', '重复出击已停止。', 'core.weekend.034')
    return { ok: true }
  }
  if (!ev || ev.endedAtWallMs !== undefined) {
    return { ok: false, error: '入侵活动已结束。', errorId: 'core.weekend.030' }
  }
  if (!weekendZoneLiveAt(state, galaxyId, nowWallMs)) {
    return { ok: false, error: '该星系当前没有被入侵。', errorId: 'core.weekend.031' }
  }
  const plan = autoLoopInvasionPlanOf(state, ctx, nowWallMs, galaxyId)
  if (plan.status === 'complete') return { ok: false, error: '外围与核心星系均已收复，旗舰需手动挑战。', errorId: 'core.invasionLoop.007' }
  if (plan.status !== 'ready') return { ok: false, error: '该星系当前没有被入侵。', errorId: 'core.weekend.031' }
  if (state.autoLoopAnomalyId !== null) {
    state.autoLoopAnomalyId = null
    state.autoLoopDroneFloor = null
    addLog(state, 'combat', '已停止常驻悬赏的重复清剿——改跑入侵重复出击。', 'core.weekend.032')
  }
  ev.autoLoopGalaxyId = plan.galaxyId
  const name = ctx.galaxies.get(plan.galaxyId)?.name ?? plan.galaxyId
  addLog(
    state,
    'combat',
    // ⟪文案调整 2026-10-08⟫ 收复后自动切换外围和核心，不自动挑战旗舰。
    `重复出击已开启，从「${name}」开始；收复后自动切换，先外围、后核心，不自动挑战旗舰。`,
    'core.weekend.033',
    { p1: name },
  )
  return { ok: true }
}

/**
 * 推进（在线心跳调用）。返回 `null` = 继续等待/已再出发；否则 = 停止原因。
 * 顺序与常驻悬赏那条一致：活动/占领态 → 等待表 → 冷却 → 两道门槛 → 出发。
 */
export function advanceAutoLoopInvasion(state: GameState, ctx: SimContext, nowWallMs = weekendClockOf(state)): string | null {
  const currentGalaxyId = autoLoopInvasionGalaxy(state)
  if (currentGalaxyId === null) return null
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) {
    stopAutoLoopInvasion(state, '入侵活动已结束。', 'core.weekend.030')
    return '入侵活动已结束'
  }
  // 别的作业占着主控 ⇒ 等（判据单点与常驻悬赏那条同源）
  if (autoLoopWaitLabel(state) !== null) return null
  const plan = autoLoopInvasionPlanOf(state, ctx, nowWallMs)
  if (plan.status === 'complete') {
    delete ev.autoLoopGalaxyId
    const text = '外围与核心星系均已收复，重复出击已停止；旗舰需手动挑战。'
    addLog(state, 'combat', text, 'core.invasionLoop.002')
    state.autoLoopStopNotice = text
    return text
  }
  if (plan.status !== 'ready') {
    stopAutoLoopInvasion(state, '该星系当前没有被入侵。', 'core.weekend.031')
    return '该星系当前没有被入侵'
  }
  if (plan.waitFor !== null) return null
  const { galaxyId, dispatch } = plan
  if (galaxyId !== currentGalaxyId) {
    ev.autoLoopGalaxyId = galaxyId
    const from = ctx.galaxies.get(currentGalaxyId)?.name ?? currentGalaxyId
    const to = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
    const reclaimed = weekendProgressAt(state, ev, currentGalaxyId, nowWallMs) >= 1
    addLog(state, 'combat', reclaimed
      ? `「${from}」已收复，重复出击目标改为「${to}」。`
      : `重复出击先收复外围，目标改为「${to}」。`,
    reclaimed ? 'core.invasionLoop.001' : 'core.invasionLoop.003', reclaimed ? { p1: from, p2: to } : { p1: to })
  }
  /**
   * **冷却与缴获体积都按「这一场真正要打的那张卡」判**（**2026-10-02 甲案 · 船长报障修复**）。
   *
   * 出发用的是 `weekendAssaultDrawOf` 的**当场重抽卡**（抽签盐 = 10000 ＋ `assaultDraws`），
   * 而 T8 冷却表是**按卡 id** 记的（结算处 `setBountyCooldown(anomaly.id)`）⇒ 判据必须与出发同源。
   *
   * ⚠ **改前判的是板面驻留卡**（`weekendBountyCardsOf` 换出来的那张，抽签盐 0）——与重抽卡是**两张
   * 不同的 id** ⇒ 既**漏判**又**误等**：
   * - 漏判（就是玩家报障）：重抽到的卡仍在冷却、板面卡不在 ⇒ 守卫放行 ⇒ `startExpedition` 被
   *   `expeditionPreflight` 的冷却判据拒 ⇒ 走到 `stopAutoLoopInvasion` ⇒ **整条重复出击被取消**。
   *   开跃迁燃料后本趟返航腿 120s → **12s**，比这张卡的冷却（`10000 × √(500 ÷ 扫描分辨率)`，
   *   重舰 12.3~13.4s）还短 ⇒ 只要连续两场抽到同一张卡就撞上（**只差 1 秒也照杀**）。
   * - 误等：板面卡在冷却、重抽卡不在 ⇒ 本来能出发却被拦着。
   */
  const drawn = ctx.anomalies.get(dispatch.cardId)
  /** **冷却中 ⇒ 等**（不是停环）：差的那点时间通常只有 1~2 秒（燃料把返航腿压到 12s） */
  if (plan.remainingMs > 0) return null
  const lootM3 = (drawn?.loot ?? []).reduce((sum, row) => {
    const def = ctx.items.get(row.itemId)
    return sum + row.units * (def ? cargoUnitM3(state, def) : 0)
  }, 0)
  // 出发：星系覆写（与 `engine.startExpeditionAt` 同一条路；卡已在上面的 `dispatch` 抽定）
  const r = startLoopBattle(state, dispatch.cardId, ctx, lootM3, {
    foeGalaxyId: galaxyId,
    ...(dispatch.rewardIsk > 0 ? { rewardIskOverride: dispatch.rewardIsk } : {}),
  })
  if (r.loopBlock) {
    const pre = r.loopBlock
    stopAutoLoopInvasion(state, pre.notice, pre.noticeId, pre.noticeParams)
    return pre.reason
  }
  if (!r.ok) {
    if (r.rangeConfirmation) return null
    /**
     * **冷却类失败也当「等」**（双保险，不引入新错误码）：`startExpedition` 内部那道冷却判据与这里
     * 同源、只是取值时刻不同 ⇒ 失败时再查一次冷却：仍 >0 就等，**绝不因为"差几秒"把整条循环杀掉**。
     */
    if (bountyCooldownRemainingMs(state, dispatch.cardId) > 0) return null
    stopAutoLoopInvasion(state, r.error ?? '无法再出发。', r.errorId, r.errorParams)
    return r.error ?? '无法再出发'
  }
  weekendNoteAssaultDispatch(state) // 抽过才计数 ⇒ 下一场换一支
  return null
}
