import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import {
  WEEKEND_DEBUG_ONLY,
  weekendCoreProgressAt,
  weekendDebugOn,
  weekendBossPoolView,
  weekendFlagshipView,
  weekendOccupiedIds,
  weekendPeripheryAverageOf,
  weekendPeripheryLeadOf,
  weekendProgressAt,
  weekendFamilyNameId,
  weekendReclaimedAt,
} from '@whale/core'
import { tr } from '../i18n/locale'
import { FlagshipFleetActions } from '../features/combat/FlagshipFleetActions'

export function WeekendInvasionLogRow({ engine, onGoto }: { engine: GameEngine; onGoto: () => void }) {
  const [, force] = useState(0)
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
  const lead = weekendPeripheryLeadOf(state, ev, now)
  const leadName = lead === null ? '' : engine.ctx.galaxies.get(lead.galaxyId)?.name ?? lead.galaxyId
  const flagship = weekendFlagshipView(state, ev, now, now)
  const pool = weekendBossPoolView(state, ev)
  const bossText =
    pool === null ? '' : tr('ui.weekend.020', { p1: String(Math.round((pool.hpLeft / pool.hpMax) * 100)) })
  const tail = flagship.down
    ? tr('ui.weekend.009')
    : flagship.shown
      ? tr('ui.weekend.010')
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
        <span className="app-weekend-box-tag">{tr('ui.weekend.005', { p1: tr(weekendFamilyNameId(ev.family) ?? 'core.weekend.025') })}</span>
        <span className="app-weekend-box-dim">{tr('ui.weekend.006', { p1: coreName })}</span>
      </div>
      <div className="app-weekend-box-row app-weekend-box-dim">
        <span>{tr('ui.weekend.007', { p1: String(perDone), p2: String(perTotal) })}</span>
        <span>· {tr('ui.weekend.008', { p1: String(corePct) })}</span>
        <span>· {tr('ui.weekend.014', { p1: String(reclaimed.length), p2: String(occupied.length) })}</span>
      </div>
      {/* 外围推进（船长批「乙」）：平均 = 任何一处前进都动；最高 = 打到哪了（清非领先处时"最高"不动，见 core 注释） */}
      {lead !== null ? (
        <div className="app-weekend-box-row app-weekend-box-dim">
          <span>{tr('ui.weekend.109', { p1: String(Math.round(weekendPeripheryAverageOf(state, ev, now) * 100)) })}</span>
          <span>· {tr('ui.weekend.108', { p1: String(Math.round(lead.progress * 100)), p2: leadName })}</span>
        </div>
      ) : null}
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
          <FlagshipFleetActions engine={engine} />
        </div>
      ) : null}
    </div>
  )
}
