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
  onImportedChange?: (holding: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [imported, setImported] = useState(false)

  const chooseStandard = async (): Promise<void> => {
    setBusy(true)
    await engine.chooseStandardMode()
    setBusy(false)
    onDone()
  }

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

  const doImport = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    setOk('')
    const r = await engine.importSaveFromFile()
    setBusy(false)
    if (r.canceled) {
      setErr(tr('ui.SaveManager.031'))
      return
    }
    if (!r.ok) {
      setErr(cmdText(r) || tr('ui.SaveManager.029'))
      return
    }
    setOk(tr('ui.SaveManager.032'))
    setImported(true)
    onImportedChange?.(true)
  }

  const finishing = imported && !engine.modeChoiceNeeded()

  return (
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
