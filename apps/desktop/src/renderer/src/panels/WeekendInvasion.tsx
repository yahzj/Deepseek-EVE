/**
 * **周末入侵 · 活动横幅**（M1-c 界面第一刀；2026-09-23/24 船长令「继续」，一批做完再汇报）。
 *
 * 只在**本场入侵存在**时显示（`state.weekendEvent` 有值且未结束）；内容：
 * 入侵族 · 核心星系 · 外围夺回进度 · 核心进度（含门禁提示）· 旗舰状态与倒计时。
 * ⚠ 目前入侵**只有调试模式可见**（`WEEKEND_DEBUG_ONLY`）⇒ 正常模式压根不会有这场活动，横幅自然不出现。
 * 全部文案走 id 映射（`ui.weekend.005~013`），中英双语。
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

/** 倒计时文本（毫秒 → mm:ss） */
function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function WeekendInvasionBanner({ engine }: { engine: GameEngine }): JSX.Element | null {
  const [, force] = useState(0)
  // 引擎 1 秒级通知不足以驱动倒计时 ⇒ 自己开一个 1 秒心跳（只在横幅挂载期间；卸载即清）
  useEffect(() => {
    const t = window.setInterval(() => force((v) => v + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  const state = engine.state
  const ev = state.weekendEvent
  if (!ev || ev.endedAtWallMs !== undefined) return null
  // 仅调试模式可见（船长令）：正常模式即便存档里有残留活动也不显示
  if (WEEKEND_DEBUG_ONLY && !weekendDebugOn(state)) return null

  const now = Date.now()
  const occupied = weekendOccupiedIds(ev)
  const reclaimed = weekendReclaimedAt(state, ev, now)
  const corePct = Math.round(weekendCoreProgressAt(state, ev, now) * 100)
  const perTotal = ev.peripheryIds.length
  const perDone = ev.peripheryIds.filter((id) => weekendProgressAt(state, ev, id, now) >= 1).length
  const coreName = engine.ctx.galaxies.get(ev.coreId)?.name ?? ev.coreId
  const flagship = weekendFlagshipView(state, ev, now, now)

  return (
    <div className="app-weekend-banner" title={tr('ui.weekend.013')}>
      <div className="app-weekend-row">
        <span className="app-weekend-tag">{tr('ui.weekend.005', { p1: ev.family })}</span>
        <span className="app-weekend-dim">{tr('ui.weekend.006', { p1: coreName })}</span>
      </div>
      <div className="app-weekend-row">
        <span className="app-weekend-dim">
          {tr('ui.weekend.007', { p1: String(perDone), p2: String(perTotal) })} · {tr('ui.weekend.008', { p1: String(corePct) })}
        </span>
      </div>
      <div className="app-weekend-row">
        {flagship.down === 'octopus' ? (
          <span className="app-weekend-warn">{tr('ui.weekend.009')}</span>
        ) : flagship.shown ? (
          <span className="app-weekend-warn">
            {tr('ui.weekend.010')}
            {flagship.deadlineWallMs !== undefined ? ` · ${fmtCountdown(flagship.deadlineWallMs - now)}` : ''}
          </span>
        ) : (
          <span className="app-weekend-dim">{perDone < perTotal ? tr('ui.weekend.011') : tr('ui.weekend.012')}</span>
        )}
      </div>
      <div className="app-weekend-dim">{tr('ui.weekend.014', { p1: String(reclaimed.length), p2: String(occupied.length) })}</div>
      {/* 被占星系清单（含各自进度）：星图视觉标记交给船长审观感后再做，这里先给"去哪打"的可读读数 */}
      <div className="app-weekend-list">
        {occupied.map((id) => {
          const pct = Math.round(weekendProgressAt(state, ev, id, now) * 100)
          const name = engine.ctx.galaxies.get(id)?.name ?? id
          const isCore = id === ev.coreId
          return (
            <span key={id} className={isCore ? 'app-weekend-chip is-core' : 'app-weekend-chip'}>
              {isCore ? `★ ${name}` : name} {pct}%
            </span>
          )
        })}
      </div>
    </div>
  )
}
