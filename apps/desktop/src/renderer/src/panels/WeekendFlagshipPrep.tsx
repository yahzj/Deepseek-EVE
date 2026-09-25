/**
 * **旗舰战 · 战前准备界面**（2026-09-25 船长令：「旗舰战入口和准备界面也要做一下，玩家完成核心区域的收复后，
 * 在入侵窗口内显示发现敌方旗舰，点击后进入战前准备界面，和进入虫洞类似的舰船选取界面。」）
 *
 * 版式按约定第六章：**先复刻同级相似项** ——
 * - 弹层用全仓既有的 `.app-modal-*` 族（与存档管理/手册/结算面板同一套窗口观感）；
 * - 编队选取沿用**虫洞准备页**的语言：`app-wh-prep` / `app-wh-ship` 那一族类名 ＋ 同样的
 *   "上限 4 / 未满给软提醒 / 准入问题摆出来不拦人"的读法；
 * - 敌情与血池读数复用活动框那两行已有的 id（`ui.weekend.075` = **共享血条剩余**）＋ 本批新增的 `ui.weekend.060~079`。
 *   ⚠ 2026-09-25 船长令「章鱼人 = 真实削减血量所以并不需要显示章鱼人削减进度和倒计时」⇒
 *   「章鱼人已削 N%」（原 `ui.weekend.021`，已删）与「击毁时限」（原 `ui.weekend.078`，已删）两格**已撤**。
 *
 * 判定与读数全在 core（`weekendFlagshipPrepView` / `weekendPrepIssuesOf`）——本组件只做渲染与选择。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { WEEKEND_FLAGSHIP_MAX_SHIPS, weekendBestFlagshipSquad, weekendFamilyNameId, type WeekendPrepIssue } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'
import { ShipSprite } from '../ui/ShipSprite'
import { Glyph } from '../ui/Glyphs'
import { ICO_TONES } from '../ui/tones'
import { pinMarked } from '../ui/marks'

/** 缺口标记 → 文案 id（与准备面板同源；加新缺口时两处一起加） */
const ISSUE_ID: Record<WeekendPrepIssue, string> = {
  'no-weapon': 'ui.weekend.068',
  'no-ammo': 'ui.weekend.069',
  'low-armor': 'ui.weekend.070',
  'low-hull': 'ui.weekend.071',
}

const n = (v: number): string => Math.round(v).toLocaleString()

/**
 * 战前准备弹层（自包含：`engine` 给数据、`onClose` 收起来）。
 * 宿主（入侵窗口 / 星图的星系详细）各挂一份，开合状态各管各的。
 */
export function WeekendFlagshipPrepModal({ engine, onClose }: { engine: GameEngine; onClose: () => void }): ReactNode {
  const prep = engine.weekendFlagshipPrep()
  /** 默认勾选 = core 给的（落盘编队优先 ⇒ 上次选过的还记得） */
  const [picked, setPicked] = useState<string[]>(() => prep?.defaultSquad ?? [])
  const [err, setErr] = useState('')
  /** 关掉（旗舰打完了 / 事件结束）⇒ 自动收起，别留一个再也点不动的面板 */
  useEffect(() => {
    if (!prep) onClose()
  }, [prep, onClose])
  const foeRows = useMemo(() => {
    if (!prep) return []
    const card = engine.ctx.anomalies.get(prep.cardId)
    const byId = new Map<string, { name: string; count: number }>()
    for (const slot of card?.ships ?? []) {
      const id = slot.ship.id
      const prev = byId.get(id)
      if (prev) prev.count += 1
      else byId.set(id, { name: slot.ship.name ?? id, count: 1 })
    }
    return [...byId.entries()].map(([id, v]) => ({ id, ...v }))
  }, [engine, prep])
  /**
   * **已标记（收藏）的船置顶**（船长 2026-09-25：「**开战准备界面没有收藏舰船置顶**」）——
   * 口径与虫洞准备页、舰队页逐字同款：`pinMarked` 只把标记项插到最前、**组内保持原顺序**（机库序），
   * 其余项不重排；本弹层没有用户可选排序键 ⇒ 恒走「默认排序」这一条（置顶只在默认排序下生效）。
   * ⚠ 只影响**显示顺序**：默认勾选（`prep.defaultSquad`）与开战编队一个字都不动。
   */
  const candidates = useMemo(
    () => (prep ? pinMarked(engine.state, 'ships', prep.candidates, (c) => c.shipId) : []),
    [engine, prep],
  )
  if (!prep) return null

  function toggle(shipId: string): void {
    setErr('')
    setPicked((prev) => {
      if (prev.includes(shipId)) return prev.filter((x) => x !== shipId)
      if (prev.length >= WEEKEND_FLAGSHIP_MAX_SHIPS) return prev
      return [...prev, shipId]
    })
  }

  function engage(): void {
    const r = engine.challengeWeekendFlagship(picked)
    if (!r.ok) {
      setErr(r.error ?? tr('ui.weekend.015'))
      return
    }
    onClose()
  }

  const short = picked.length < WEEKEND_FLAGSHIP_MAX_SHIPS
  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-modal-wide app-wh-prep-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{tr('ui.weekend.063')}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr('ui.App.086')}
          </button>
        </div>
        <div className="app-modal-body">
          <div className="app-dim app-note">
            {tr('ui.weekend.064', {
              p1: tr(weekendFamilyNameId(engine.state.weekendEvent?.family ?? 'H') ?? 'core.weekend.023'),
              p2: String(prep.threat),
              p3: String(prep.waves),
            })}
          </div>
          {/**
           * 血池读数（与活动框同两口 id）：**只报共享血条**——2026-09-25 船长令「章鱼人 = 真实削减血量
           * 所以并不需要显示章鱼人削减进度和倒计时」⇒ 撤掉"章鱼人已削 N%"与"击毁时限"两格。
           */}
          <div className="app-dim app-note">
            {tr('ui.weekend.075', {
              p1: n(prep.pool.hpLeft),
              p2: String(Math.round((prep.pool.hpLeft / prep.pool.hpMax) * 100)),
            })}
          </div>
          {/* 敌方编成（按舰种汇总；名字走卡内嵌敌舰的本地化名） */}
          <div className="app-bay-title">{tr('ui.weekend.065')}</div>
          <div className="app-weekend-box-row app-dim">
            {foeRows.map((f) => (
              <span key={f.id} className="app-dim">
                {tr('ui.weekend.066', { p1: f.name, p2: String(f.count) })}
              </span>
            ))}
          </div>
          {/* 参战编队（上限 4；不足 4 给软提醒、不拦人） */}
          <div className="app-bay-title">
            {tr('ui.weekend.067')}
            <span className="app-dim">
              {' '}
              {tr('ui.weekend.076', { p1: String(picked.length), p2: String(WEEKEND_FLAGSHIP_MAX_SHIPS) })}
            </span>
          </div>
          <ul className="app-wh-cards">
            {candidates.map((c) => {
              const on = picked.includes(c.shipId)
              return (
                <li key={c.shipId}>
                  <button
                    type="button"
                    className={`app-wh-card${on ? ' is-picked' : ''}`}
                    onClick={() => toggle(c.shipId)}
                    title={c.issues.map((i) => tr(ISSUE_ID[i])).join(' · ')}
                  >
                    <span className="app-wh-card-art" aria-hidden>
                      {/* ⚠ 不传 name（它自带绝对定位的舰名标签，会压在卡片文本上，与虫洞准备页同一处坑） */}
                      <ShipSprite shipId={c.defId} size={132} />
                    </span>
                    <span className="app-wh-card-name">{c.name}</span>
                    <span className="app-wh-card-sub">{tr('ui.weekend.077', { p1: n(c.power) })}</span>
                    <span className="app-wh-card-sub">
                      {tr('ui.weekend.080', { p1: String(Math.round(c.armorPct * 100)), p2: String(Math.round(c.hullPct * 100)) })}
                    </span>
                    {c.issues.length > 0 ? (
                      <span className="app-wh-card-tags">
                        {c.issues.map((i) => (
                          <span key={i} className="app-wh-card-tag is-on">
                            {tr(ISSUE_ID[i])}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
          {short ? <div className="app-warn app-wh-gate">{tr('ui.weekend.072', { p1: String(WEEKEND_FLAGSHIP_MAX_SHIPS) })}</div> : null}
          {err !== '' ? <div className="app-warn app-wh-gate">{err}</div> : null}
          <div className="app-wh-actions">
            <button
              className="app-btn is-small"
              onClick={() => {
                setErr('')
                setPicked(weekendBestFlagshipSquad(engine.state, engine.ctx))
              }}
            >
              {tr('ui.weekend.073')}
            </button>
            <button className="app-btn is-primary" disabled={picked.length === 0} onClick={engage}>
              {tr('ui.weekend.074')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

