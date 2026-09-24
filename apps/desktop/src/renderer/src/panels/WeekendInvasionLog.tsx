/**
 * **周末入侵 · 事件日志里的活动行**（2026-09-23 船长令：「干脆放在事件日志的底部，和现有事件日志同级。
 * 点击后自动跳转到星图界面」）。
 *
 * 形态：作为日志列表里的**最后一条**（与 `wui-log-item` 同级同款：走 `LogList` 的 `footer`），
 * 单行摘要 + 悬停详情；**点击 → 跳星图**（由 App 传入 `onGoto`）。只在活动存在时渲染。
 * ⚠ 入侵目前**只有调试模式可见**（core 的 `WEEKEND_DEBUG_ONLY`）⇒ 正常模式不会有这一行。
 */
import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import {
  WEEKEND_DEBUG_ONLY,
  weekendCoreProgressAt,
  weekendDebugOn,
  weekendFlagshipView,
  weekendOccupiedIds,
  weekendProgressAt,
  weekendReclaimedAt,
} from '@whale/core'
import { tr } from '../i18n/locale'

/** 倒计时（毫秒 → mm:ss） */
function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function WeekendInvasionLogRow({ engine, onGoto }: { engine: GameEngine; onGoto: () => void }) {
  const [, force] = useState(0)
  // 倒计时要每秒走：日志列表本身不会因为秒变化而重渲染 ⇒ 自己开一个 1 秒心跳（卸载即清）
  useEffect(() => {
    const t = window.setInterval(() => force((v) => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  const state = engine.state
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  if (WEEKEND_DEBUG_ONLY && !weekendDebugOn(state)) return null

  const now = Date.now()
  const occupied = weekendOccupiedIds(ev)
  const reclaimed = weekendReclaimedAt(state, ev, now)
  const perTotal = ev.peripheryIds.length
  const perDone = ev.peripheryIds.filter((id) => weekendProgressAt(state, ev, id, now) >= 1).length
  const corePct = Math.round(weekendCoreProgressAt(state, ev, now) * 100)
  const coreName = engine.ctx.galaxies.get(ev.coreId)?.name ?? ev.coreId
  const flagship = weekendFlagshipView(state, ev, now, now)
  const tail = flagship.down
    ? tr('ui.weekend.009')
    : flagship.shown
      ? flagship.deadlineWallMs !== undefined
        ? `${tr('ui.weekend.010')} ${fmtCountdown(flagship.deadlineWallMs - now)}`
        : tr('ui.weekend.010')
      : perDone < perTotal
        ? tr('ui.weekend.011')
        : tr('ui.weekend.012')

  return (
    <li
      className="wui-log-item wui-log-warn app-weekend-logrow"
      title={`${tr('ui.weekend.013')} · ${tr('ui.weekend.019')}`}
      onClick={onGoto}
    >
      <span className="app-weekend-logrow-tag">{tr('ui.weekend.005', { p1: ev.family })}</span>
      <span>{tr('ui.weekend.006', { p1: coreName })}</span>
      <span> · {tr('ui.weekend.007', { p1: String(perDone), p2: String(perTotal) })}</span>
      <span> · {tr('ui.weekend.008', { p1: String(corePct) })}</span>
      <span> · {tr('ui.weekend.014', { p1: String(reclaimed.length), p2: String(occupied.length) })}</span>
      <span> · {tail}</span>
    </li>
  )
}
