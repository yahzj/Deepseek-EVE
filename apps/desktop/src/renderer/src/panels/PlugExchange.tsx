/**
 * **「章鱼人兑换」窗口**（**2026-09-26 船长令**，设计稿 `docs/design/ship-plug-20260926.md`）。
 *
 * 船长原话（照抄）：「**找章鱼人用声望兑换，玩家完成入侵后根据贡献获得一定量声望。**」
 * ＋「**声望真扣（就是意味着玩家一开始其实可以买5张）**」＋「**通讯内跳转**」。
 *
 * 入口：① 那封「拿到第一个黑匣」的通讯（`hint.action = 'plug-exchange'`）；
 * ② 组装机「舰船插件」档的空态卡（同一张窗口）。
 *
 * 版式：复用全仓 `.app-modal-*` 族与卡片家族（`app-card` / `app-chip` / `app-btn`），不自造窗口观感。
 * 读数口径全部取自 core 单点：行 = `plugExchangeRowsOf`、价 = `PLUG_BLUEPRINT_COST`、
 * 两本账 = `spendableStandingOf` / `standingOf`。
 */
import { useState } from 'react'
import {
  DSI_FACTION_ID,
  PLUG_BLUEPRINT_COST,
  exchangePlugBlueprint,
  plugExchangeRowsOf,
  spendableStandingOf,
  standingOf,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'
import { Glyph } from '../ui/Glyphs'

export function PlugExchangeModal({
  engine,
  onToast,
  onClose,
}: {
  engine: GameEngine
  onToast: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  /** 本地重算计数：兑换只改 state 两本账与图书架，窗口自身要跟着重画 */
  const [, setTick] = useState(0)
  const rows = plugExchangeRowsOf(engine.state, engine.ctx)
  const spendable = spendableStandingOf(engine.state, DSI_FACTION_ID)
  const earned = standingOf(engine.state, DSI_FACTION_ID)

  const exchange = (moduleId: string): void => {
    /** 走引擎命令（成功才落盘 ＋ 广播刷新；与 `learnBlueprintAt` 同款） */
    const r = engine.exchangePlugBlueprintAt(moduleId)
    onToast(r.ok ? tr('ui.IndustryPage.123') : (r.error ?? tr('ui.IndustryPage.121', { p1: PLUG_BLUEPRINT_COST })))
    setTick((n) => n + 1)
  }

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal app-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{tr('ui.Expedition.441')}</span>
          <span className="app-dim">{tr('ui.IndustryPage.119', { p1: spendable, p2: earned })}</span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr('ui.App.086')}
          </button>
        </div>
        <div className="app-modal-body">
          {rows.length === 0 ? (
            <div className="app-dim app-exp-idle">{tr('ui.IndustryPage.117')}</div>
          ) : (
            <div className="app-card-grid">
              {rows.map((row) => (
                <div key={row.moduleId} className="app-card">
                  <div className="app-card-head">
                    <span className="app-card-name">
                      <Glyph name="plug" size={14} /> {row.blueprintName}
                    </span>
                    <span className={`app-chip${row.learned ? '' : ' is-rare'}`}>
                      {row.learned ? tr('ui.IndustryPage.122') : `${row.cost}`}
                    </span>
                  </div>
                  <div className="app-dim">{row.name}</div>
                  <div className="app-card-foot">
                    <button
                      className="app-btn is-small"
                      disabled={row.learned || !row.affordable}
                      onClick={() => exchange(row.moduleId)}
                    >
                      {row.learned
                        ? tr('ui.IndustryPage.122')
                        : row.affordable
                          ? tr('ui.IndustryPage.120')
                          : tr('ui.IndustryPage.121', { p1: row.cost - spendable })}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
