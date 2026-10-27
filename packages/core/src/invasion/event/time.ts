/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameState } from '../../state'
import { WEEKEND_DEBUG_TIME_DIVISOR, WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS, WEEKEND_FLAGSHIP_DEADLINE_MS, WEEKEND_START_WEEKDAY, WEEKEND_START_HOUR, WEEKEND_WINDOW_MS } from './constants'

/** 调试模式判定（与全仓同口径：`state.debugQuick`） */
export function weekendDebugOn(state: Pick<GameState, 'debugQuick'>): boolean {
  return state.debugQuick === true
}

/**
 * **入侵用的"现在"＝游戏自己的墙钟账**（2026-09-25 修船长报障「打开调试模式，快进后不会刷新入侵」）。
 *
 * 病根：入侵的三条时间线（**开局面 / NPC 铺底 / 旗舰倒计时**）原先一律读 `Date.now()`（真实墙钟），
 * 而"快进"推进的是**游戏自己的模拟墙钟** `state.savedAtWallMs`（`simulateOffline` 的 `wallBase + ms`）
 * ⇒ 两者不同源，快进对入侵完全无效（既不开新场，铺底也不动）。
 *
 * 口径：**取两者较大的那个** ——
 * - 正常在线：`savedAtWallMs` ≈ 上次落盘时刻 ≤ 现在 ⇒ 恒等于真实墙钟，**行为逐字不变**；
 * - 快进/离线段：模拟墙钟已经走到未来 ⇒ 入侵跟着走到未来（而不倒回去）。
 *
 * ⚠ 只给入侵用；其它系统各自的口径不动（赏金日板等仍按各自既有来源）。
 */
export function weekendClockOf(
  state: Pick<GameState, 'savedAtWallMs'>,
  realNowMs: number = Date.now(),
): number {
  const ledger = Number.isFinite(state.savedAtWallMs) ? state.savedAtWallMs : 0
  return Math.max(realNowMs, ledger > 0 ? ledger : 0)
}

/** NPC 时间轴的实际时长（调试模式 ÷60，Q6） */
export function weekendNpcTimelineMs(state: Pick<GameState, 'debugQuick'>, baseMs: number): number {
  return weekendDebugOn(state) ? Math.max(1, Math.round(baseMs / WEEKEND_DEBUG_TIME_DIVISOR)) : baseMs
}

/** 本档的削血窗口（调试 = 10 分钟；正常 = **24 小时**）——四处同源的单点 */
export function weekendFlagshipWindowMs(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS : WEEKEND_FLAGSHIP_DEADLINE_MS
}

/** 某一时刻所在"周"的 T0（正常模式：该时刻之前最近的周五 20:00 本地墙钟） */
export function weekendT0Of(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  const day = d.getDay()
  let back = (day - WEEKEND_START_WEEKDAY + 7) % 7
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), WEEKEND_START_HOUR, 0, 0, 0).getTime()
  if (back === 0 && nowWallMs < at) back = 7 // 本周五 20:00 还没到 ⇒ 用上一周
  return at - back * 86_400_000
}

/** 窗口是否还开着（T0 ~ T0+96h） */
export function weekendWindowOpen(nowWallMs: number, t0: number): boolean {
  return nowWallMs >= t0 && nowWallMs < t0 + WEEKEND_WINDOW_MS
}

/** 活动总时长（正常 = 96h；调试模式按 NPC 压缩口径无固定上限，取 96h÷60 供测试参考） */
export function weekendWindowMsOf(state: Pick<GameState, 'debugQuick'>): number {
  return weekendDebugOn(state) ? Math.round(WEEKEND_WINDOW_MS / WEEKEND_DEBUG_TIME_DIVISOR) : WEEKEND_WINDOW_MS
}
