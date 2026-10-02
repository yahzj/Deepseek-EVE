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

export function ModeChoice({
  engine,
  onDone,
  onImportedChange,
}: {
  engine: GameEngine
  onDone: () => void
  /**
   * ⟪**2026-10-02 甲案**（船长令）⟫ **导入收尾位**：导入成功那一刻 `modeChoiceNeeded()` 会翻假
   * （导入的档已选过模式）⇒ 若照旧按它卸载，玩家**只看到悬浮窗无声消失**、拿不到任何成功确认。
   * 本回调把"刚导入、等玩家点『进入游戏』"这件事告诉 `App`，由它多留这一拍不卸框。
   */
  onImportedChange?: (holding: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  /** 刚导入成功（用于切到"导入完成态"：只给交代 ＋ 「进入游戏」） */
  const [imported, setImported] = useState(false)

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

  /**
   * **导入存档**（**2026-09-28 船长令**：「**可以加入一个"导入存档"入口**」）。
   *
   * **为什么放在模式选择框上**：本框是**强制二选一**（不设关闭键、进游戏之后才弹），而"导入"原本只在
   * 游戏内的存档页 ⇒ 换设备/换浏览器来的玩家**必须先过这一关**才能碰到导入按钮；偏偏**选铁人会立刻
   * 开始抬代次**（每存一次盘 +1）⇒「先进游戏、选了铁人、再导入」这条路会把铁人档的装载闸门抬到
   * 自己那份旧档头上，导入被判成"回滚"而**拒绝**（2026-09-28 玩家实测报障）。
   * 入口挪到这里 ⇒ 玩家**先导入、再选模式**，那条坑从流程上消失。
   *
   * 导入后本框**自动重判**（`App` 按 `engine.modeChoiceNeeded()` 挂载）：新档若已选过模式 ⇒ 本框
   * 自动卸载；没选过（例如刚被重置过模式选择的那份档）⇒ 照常请他选这一次。
   * 文案与类名沿用存档页那一套（`ui.SaveManager.014/013/029/003`），不另造同义文案。
   */
  const doImport = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    setOk('')
    const r = await engine.importSaveFromFile()
    setBusy(false)
    /**
     * ⟪**2026-10-02**⟫ **取消/没弹出来不再静默**（与存档页 `SaveManager` 同一手，§2.1 同类优先补齐）：
     * 原先这里直接 `return` ⇒ 手机端玩家**关掉文件选择器后界面一个字都不说**（"点了没反应/选了也没用"都长这样）
     * ⇒ 复用存档页那条现成文案（**零新增**）：说明"没读到文件"并给出路（换系统自带浏览器）。
     */
    if (r.canceled) {
      setErr(tr('ui.SaveManager.031'))
      return
    }
    if (!r.ok) {
      setErr(cmdText(r) || tr('ui.SaveManager.029'))
      return
    }
    /** 成功后切"导入完成态"：`App` 那边同拍把本框留住（见 `onImportedChange` 的说明） */
    setOk(tr('ui.SaveManager.032'))
    setImported(true)
    onImportedChange?.(true)
  }

  /**
   * **导入完成态**：导入进来的档已选过模式 ⇒ 本框只剩"报个平安 ＋ 请玩家进游戏"。
   * （没选过模式的档 ⇒ `finishing` 为假，照旧请他选这一次 —— **"强制二选一"语义不变**。）
   */
  const finishing = imported && !engine.modeChoiceNeeded()

  return (
    /* 无 onClick ⇒ 点遮罩不关、无关闭键 ⇒ 强制二选一 */
    <div className="app-modal-mask">
      {/* 宽度 760 = 让两张 330px 模式卡**并排**（与序章同观感）；窄窗口由 .app-pro-mode 的 wrap 兜底 */}
      <div className="app-modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{tr('ui.Ironman.042')}</span>
        </div>
        <div className="app-modal-body">
          {finishing ? (
            /**
             * ⟪⟪**2026-10-02 甲案**（船长令）⟫⟫ **导入完成态**：导入进来的档**已选过模式** ⇒ 本框没事可做了。
             * 只给交代（`ui.SaveManager.032`「已导入存档」）＋ 一个「进入游戏」按钮，**玩家自己点了才关**。
             * ⚠ **不再摆那两张模式卡**：导入的档已经选过模式，再点一次会把它**改写**（换成另一种模式）。
             */
            <>
              <div className="app-dim" style={{ marginBottom: 'var(--wui-sp-10)' }}>{tr('ui.SaveManager.032')}</div>
              <div className="app-save-actions">
                <button
                  className="app-btn is-primary"
                  onClick={() => {
                    onImportedChange?.(false)
                    onDone()
                  }}
                >
                  {tr('ui.SaveManager.033')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="app-dim" style={{ marginBottom: 'var(--wui-sp-10)' }}>{tr('ui.Ironman.043')}</div>
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
              {/* 导入入口：与存档页那颗同一套类名/文案 id（§6 同级复刻），见 `doImport` 的说明 */}
              <div className="app-save-actions" style={{ marginTop: 'var(--wui-sp-10)' }}>
                <button
                  className="app-btn is-small"
                  disabled={busy}
                  onClick={() => void doImport()}
                  title={tr('ui.SaveManager.013')}
                >
                  {tr('ui.SaveManager.014')}
                </button>
                <span className="app-dim">{busy ? tr('ui.SaveManager.017') : tr('ui.Ironman.044')}</span>
              </div>
            </>
          )}
          {err ? (
            <div className="app-dim" style={{ marginTop: 'var(--wui-sp-8)' }}>{err}</div>
          ) : null}
          {ok && !finishing ? (
            <div className="app-dim" style={{ marginTop: 'var(--wui-sp-8)' }}>{ok}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
