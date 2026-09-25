/**
 * **周末入侵 · 事件日志里的活动行**（2026-09-23 船长令：「干脆放在事件日志的底部，和现有事件日志同级。
 * 点击后自动跳转到星图界面」）。
 *
 * 形态：作为日志列表里的**最后一条**（与 `wui-log-item` 同级同款：走 `LogList` 的 `footer`），
 * 单行摘要 + 悬停详情；**点击 → 跳星图**（由 App 传入 `onGoto`）。只在活动存在时渲染。
 * ✅ **2026-09-25 船长解除"仅调试模式可见"**（`WEEKEND_DEBUG_ONLY = false`）⇒ 正常模式也会有这一行；
 * 调试档的限制由 `WEEKEND_DEBUG_ONLY` 单点判据决定（改回 true 即恢复"只在调试模式显示"）。
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
  weekendPeripheryAverageOf,
  weekendPeripheryLeadOf,
  weekendProgressAt,
  weekendReclaimedAt,
} from '@whale/core'
import { tr } from '../i18n/locale'
import { WeekendFlagshipPrepModal } from './WeekendFlagshipPrep'

export function WeekendInvasionLogRow({ engine, onGoto }: { engine: GameEngine; onGoto: () => void }) {
  const [, force] = useState(0)
  /** 战前准备弹层开合（2026-09-25 船长令：入侵窗口里点「发现敌方旗舰」进来） */
  const [prepOpen, setPrepOpen] = useState(false)
  /**
   * 血条/进度每秒都在动（章鱼人也在削）⇒ 自己开一个 1 秒心跳刷新读数（卸载即清）。
   * ⚠ 原先这条心跳是给"旗舰倒计时"走的；倒计时撤了，但**入侵进度条**同样需要它。
   */
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
  /**
   * **外围进度最高的一处**（**2026-09-25 船长批「乙」**）：上面那两块读数（外围夺回 X/Y · 核心 %）
   * 都是"满 100% 才 +1"的计数、核心那格还被门禁锁死 ⇒ 玩家连清同一处时**一个会动的数都没有**
   * （真档实测：暗星坟场 23% → 33% → 43% → 53%，这一行三块一动不动）⇒ 补上这条随单场胜利增长的读数。
   */
  const lead = weekendPeripheryLeadOf(state, ev, now)
  const leadName = lead === null ? '' : engine.ctx.galaxies.get(lead.galaxyId)?.name ?? lead.galaxyId
  const flagship = weekendFlagshipView(state, ev, now, now)
  /**
   * **母舰血条读数**（2026-09-25 船长令：「**章鱼人 = 真实削减血量所以并不需要显示章鱼人削减进度和
   * 倒计时。（因为削到 0% 就代表母舰被章鱼人摧毁。）**」）。
   *
   * ⇒ 玩家那份与章鱼那份**加在同一条血上**，界面只报"这条血还剩多少"：
   * `pool.hpLeft / pool.hpMax`。**不再分两行报**（原先那行"旗舰已磨掉 N% · 章鱼人已削 M%"已撤）。
   */
  const pool = weekendBossPoolView(state, ev)
  const bossText =
    pool === null ? '' : tr('ui.weekend.020', { p1: String(Math.round((pool.hpLeft / pool.hpMax) * 100)) })
  /**
   * ⚠ **倒计时随章鱼进度一起撤**（同上一条船长令）：旗舰现身时只报状态，
   * 不再显示"还剩多久被削空"（血条本身就是那个读数）。
   */
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
        <span className="app-weekend-box-tag">{tr('ui.weekend.005', { p1: ev.family })}</span>
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
