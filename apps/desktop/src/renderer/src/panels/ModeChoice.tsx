/**
 * **模式选择框**（**2026-09-24 船长令**：「**对至今未选择的旧档进行模式选择弹窗**」＋
 * 「**进游戏后要二选一**」）。
 *
 * ## 为什么要有它
 * 「普通 / 铁人」这次选择原本**只有新档的序章**问过一次（2026-09-23 立），于是三类人从来没被问过：
 * ① 铁人模式上线（09-23）之前就存在的老档 ② 序章右上角点了「跳过」的档 ③ 中途导入的档。
 * 本框就是补问那一次。
 *
 * ## 判据（唯一）
 * `engine.ironmanStatus().modeChosen`（core 的 `ironmanModeChosen`：曾开过铁人 **或** 已选过普通）。
 * ⇒ 由 `App.tsx` 在**序章结束之后**（`onboarding.step !== 0`）挂载；选完即卸载，不再出现。
 *
 * ## 三条口径（船长同一批令）
 * - **进游戏后弹、必须二选一**：不设关闭键、点遮罩不关、没有"稍后再说"；
 * - **两张卡复用序章那一对**（同一批类名 `.app-pro-mode-card` 与同一批文案 id，§6 同级复刻）；
 * - **一次机会**：选普通 ⇒ `chooseStandardMode()` 落 `state.modeChosen`；选铁人 ⇒
 *   `enterIronmanNow()`（它的 `sinceWallMs` 本身就是记录）。两条路都让本框此后不再出现，
 *   而存档页的「开启铁人模式」入口也随之撤除（`SaveManager` 按同一判据隐藏）。
 *
 * ⚠ 「跳过序章」**不算做过选择**（不写 `modeChosen`）⇒ 跳过者照样会被本框问一次 —— 那正是它
 * 唯一一次机会（若把跳过也算作"已选普通"，这批玩家将永久失去转铁人的可能）。
 */
import { useState } from 'react'
import type { GameEngine } from '../game/engine'
import { tr, cmdText } from '../i18n/locale'

export function ModeChoice({ engine, onDone }: { engine: GameEngine; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  /** 选普通：落一次"已选择"记账，然后放行 */
  const chooseStandard = async (): Promise<void> => {
    setBusy(true)
    await engine.chooseStandardMode()
    setBusy(false)
    onDone()
  }

  /**
   * 选铁人：走既有的 `enterIronmanNow`（代次接账本高度）。
   * ⚠ 入模失败（如该档已关闭过铁人）**不静默放行** —— 本框是强制二选一，得让玩家看见理由再改选普通。
   */
  const chooseIronman = async (): Promise<void> => {
    setBusy(true)
    const r = await engine.enterIronmanNow()
    setBusy(false)
    if (!r.ok) {
      setErr(cmdText(r) || tr('ui.Ironman.019'))
      return
    }
    onDone()
  }

  return (
    /* 无 onClick ⇒ 点遮罩不关、无关闭键 ⇒ 强制二选一 */
    <div className="app-modal-mask">
      {/* 宽度 760 = 让两张 330px 模式卡**并排**（与序章同观感）；窄窗口由 .app-pro-mode 的 wrap 兜底 */}
      <div className="app-modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{tr('ui.Ironman.042')}</span>
        </div>
        <div className="app-modal-body">
          <div className="app-dim" style={{ marginBottom: 10 }}>{tr('ui.Ironman.043')}</div>
          <div className="app-pro-mode">
            <button className="app-pro-mode-card" disabled={busy} onClick={() => void chooseStandard()}>
              <span className="app-pro-mode-title">{tr('ui.Ironman.026')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.027')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.028')}</span>
            </button>
            <button className="app-pro-mode-card is-iron" disabled={busy} onClick={() => void chooseIronman()}>
              <span className="app-pro-mode-title">{tr('ui.Ironman.029')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.030')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.031')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.032')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.033')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.034')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.035')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.036')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.037')}</span>
              <span className="app-pro-mode-li">{tr('ui.Ironman.038')}</span>
            </button>
          </div>
          {err ? (
            <div className="app-dim" style={{ marginTop: 8 }}>{err}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
