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
  weekendBossPoolView,
  weekendFlagshipView,
  weekendOccupiedIds,
  weekendProgressAt,
  weekendReclaimedAt,
} from '@whale/core'
import { tr } from '../i18n/locale'
import { WeekendFlagshipPrepModal } from './WeekendFlagshipPrep'

/** 倒计时（毫秒 → mm:ss） */
function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function WeekendInvasionLogRow({ engine, onGoto }: { engine: GameEngine; onGoto: () => void }) {
  const [, force] = useState(0)
  /** 战前准备弹层开合（2026-09-25 船长令：入侵窗口里点「发现敌方旗舰」进来） */
  const [prepOpen, setPrepOpen] = useState(false)
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
  /**
   * **旗舰 BOSS 的池子读数**（2026-09-24 第二轮令）：非 BOSS 族 / 还没接战 ⇒ `null`（这一行不出现）。
   * 显示两条独立进度：玩家磨掉多少、章鱼人削了多少。
   */
  const pool = weekendBossPoolView(state, ev)
  const bossText =
    pool === null
      ? ''
      : `${tr('ui.weekend.020', { p1: String(Math.round(pool.playerFrac * 100)) })} · ${tr('ui.weekend.021', {
          p1: String(Math.round(pool.octopusFrac * 100)),
        })}`
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
    <div
      className="app-weekend-box"
      title={`${tr('ui.weekend.013')} · ${tr('ui.weekend.019')}`}
      onClick={onGoto}
    >
      <div className="app-weekend-box-row">
        <span className="app-weekend-box-tag">{tr('ui.weekend.005', { p1: ev.family })}</span>
        <span className="app-weekend-box-dim">{tr('ui.weekend.006', { p1: coreName })}</span>
      </div>
      <div className="app-weekend-box-row app-weekend-box-dim">
        <span>{tr('ui.weekend.007', { p1: String(perDone), p2: String(perTotal) })}</span>
        <span>· {tr('ui.weekend.008', { p1: String(corePct) })}</span>
        <span>· {tr('ui.weekend.014', { p1: String(reclaimed.length), p2: String(occupied.length) })}</span>
      </div>
      <div className="app-weekend-box-row">
        <span className={flagship.shown || flagship.down ? 'app-weekend-box-warn' : 'app-weekend-box-dim'}>{tail}</span>
      </div>
      {bossText !== '' && (
        <div className="app-weekend-box-row app-weekend-box-dim">
          <span>{bossText}</span>
        </div>
      )}
      {/**
       * **旗舰战入口**（2026-09-25 船长令：「玩家完成核心区域的收复后，在入侵窗口内显示发现敌方旗舰，
       * 点击后进入战前准备界面」）。只在旗舰现身且未落定局时出现；按钮 `stopPropagation`
       * ——整块活动行本身是"点击跳星图"的，别让点按钮顺带跳走。
       */}
      {flagship.shown && !flagship.down ? (
        <div className="app-weekend-box-row">
          <span className="app-weekend-box-warn">{tr('ui.weekend.060')}</span>
          <button
            className="app-btn is-small is-primary"
            onClick={(e) => {
              e.stopPropagation()
              setPrepOpen(true)
            }}
          >
            {tr('ui.weekend.062')}
          </button>
        </div>
      ) : null}
      {prepOpen ? <WeekendFlagshipPrepModal engine={engine} onClose={() => setPrepOpen(false)} /> : null}
    </div>
  )
}
