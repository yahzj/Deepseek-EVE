/**
 * **周末入侵 · 结算面板**（2026-09-25 · 船长令：「通讯的跳转显示详细奖励，点击后弹出**类似虫洞撤离的
 * 结算界面**，显示玩家在各个被入侵星系的贡献和旗舰战的输出，并列出玩家获得的物品，包括旗舰战的掉落物」）。
 *
 * 骨相照 `panels/Wormhole.tsx` 的 `SettleView`（同一套 `app-wh-settle-*` 类名与"逐格淡入"节奏），
 * 按约定第六章：**先复刻同级相似项 UI，再最小差异**，不自造相似新样式。
 *
 * 数据来源 = `state.weekendLastResult`（结束那一刻的快照；下一场开局会把本场台账清掉 ⇒ 只有快照留得住）。
 * 物品名走**游戏既有物品表**（`engine.ctx.items`）⇒ 中英各自成句。
 */
import type { ReactNode } from 'react'
import { weekendFamilyNameId } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

/** 数值千分位（与虫洞结算同口径） */
const n = (v: number): string => Math.round(v).toLocaleString()

/**
 * 入侵结算面板（弹层内容；由通讯页/通讯弹窗在 `action === 'weekendSummary'` 时挂载）。
 * 没有快照（老档 / 还没打过入侵）⇒ 不渲染（调用方据此不弹）。
 */
export function WeekendSummaryView({ engine, onClose }: { engine: GameEngine; onClose: () => void }): ReactNode {
  const snap = engine.state.weekendLastResult
  if (snap === undefined) return null
  const family = tr(weekendFamilyNameId(snap.family) ?? 'core.weekend.023')
  const coreName = engine.ctx.galaxies.get(snap.coreId)?.name ?? snap.coreId
  const itemNameOf = (id: string): string => engine.ctx.items.get(id)?.name ?? id
  const heading = snap.flagshipOutcome === 'player'
    ? tr('ui.weekend.032')
    : snap.flagshipOutcome === 'octopus'
      ? tr('ui.weekend.033')
      : tr('ui.weekend.034')
  const reclaimed = snap.galaxies.filter((g) => g.reclaimed).length
  const sharePct = (snap.share * 100).toFixed(0)
  const tierText = snap.tier === 'none' ? tr('ui.weekend.052') : tr('ui.weekend.051', { p1: snap.tier })

  /** 读数格：与虫洞结算同款（`label` + `value` + `sub`；`wide` = 跨两列独占一行） */
  const cells: Array<{ label: string; value: string; sub: string; wide?: boolean }> = [
    { label: tr('ui.weekend.035'), value: `${sharePct}%`, sub: tierText },
    { label: tr('ui.weekend.036'), value: `${reclaimed} / ${snap.galaxies.length}`, sub: tr('ui.weekend.041') },
    ...(snap.flagship !== undefined
      ? [
          {
            label: tr('ui.weekend.037'),
            value: n(snap.flagship.hpDone),
            sub: `/ ${n(snap.flagship.hpMax)}`,
          },
        ]
      : []),
    { label: tr('ui.weekend.038'), value: `×${n(snap.wreck)}`, sub: itemNameOf(snap.wreckItemId ?? '') },
    { label: tr('ui.weekend.039'), value: n(snap.isk), sub: '' },
    ...(snap.blackBox > 0
      ? [{ label: tr('ui.weekend.040'), value: `×${snap.blackBox}`, sub: '', wide: true }]
      : []),
  ]

  const STEP = 90
  return (
    <div className="app-wh-settle">
      <div className="app-wh-settle-head is-pop">
        <span className={`app-wh-settle-kind${snap.flagshipOutcome === 'player' ? ' is-good' : ''}`}>
          {tr('ui.weekend.053', { p1: family })}
        </span>
        <span className="app-dim">
          {tr('ui.weekend.031', { p1: coreName, p2: heading, p3: snap.seq })}
        </span>
      </div>
      <div className="app-wh-settle-grid">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={`app-wh-settle-cell is-pop${c.wide ? ' is-wide' : ''}`}
            style={{ animationDelay: `${i * STEP}ms` }}
          >
            <span className="app-wh-settle-label">{c.label}</span>
            <span className="app-wh-settle-value">{c.value}</span>
            {c.sub !== '' ? <span className="app-dim app-wh-settle-sub">{c.sub}</span> : null}
          </div>
        ))}
      </div>
      {/* 各星系贡献（船长点名要的那一列）：星系名 · 贡献% · 是否夺回 · 该处奖励 */}
      <div className="app-wh-settle-loss is-pop" style={{ animationDelay: `${(cells.length + 1) * STEP}ms` }}>
        <div className="app-bay-title">{tr('ui.weekend.041')}</div>
        <div className="app-weekend-sum-rows">
          {snap.galaxies.map((g) => (
            <div key={g.galaxyId} className="app-weekend-sum-row">
              <span className="app-weekend-sum-name">{engine.ctx.galaxies.get(g.galaxyId)?.name ?? g.galaxyId}</span>
              <span className="app-dim">{tr('ui.weekend.050', { p1: (g.put * 100).toFixed(0) })}</span>
              <span className={g.reclaimed ? 'app-good' : 'app-dim'}>
                {g.reclaimed ? tr('ui.weekend.042') : tr('ui.weekend.043')}
              </span>
              <span className="app-dim">
                {g.wreck > 0 || g.isk > 0
                  ? tr('ui.weekend.044', { p1: n(g.wreck), p2: n(g.isk) })
                  : tr('ui.weekend.045')}
              </span>
            </div>
          ))}
        </div>
      </div>
      {snap.flagship !== undefined ? (
        <div className="app-wh-settle-total is-pop" style={{ animationDelay: `${(cells.length + 2) * STEP}ms` }}>
          <span className="app-dim">
            {tr('ui.weekend.046', {
              p1: n(snap.flagship.hpDone),
              p2: n(snap.flagship.hpMax),
              p3: tr(snap.flagship.defeated ? 'ui.weekend.047' : 'ui.weekend.048'),
            })}
          </span>
        </div>
      ) : null}
      <div className="app-wh-actions app-wh-settle-actions">
        <button className="app-btn is-primary app-wh-settle-ok" onClick={onClose}>
          {tr('ui.weekend.049')}
        </button>
      </div>
    </div>
  )
}
