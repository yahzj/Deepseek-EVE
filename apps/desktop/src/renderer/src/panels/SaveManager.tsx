import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { HintIcon } from '../ui/Hint'
import { tr, cmdText } from '../i18n/locale'
import { localeTag } from '../i18n/fmt'

function fmtTime(wallMs: number): string {
  return new Date(wallMs).toLocaleString(localeTag(), { hour12: false })
}

type IronmanStatus = Awaited<ReturnType<GameEngine['ironmanStatus']>>

export function SaveManager({
  engine,
  onToast,
  onClose,
}: {
  engine: GameEngine
  onToast: ToastFn
  onClose: () => void
}) {
  const [backups, setBackups] = useState<SaveBackupInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [armDelete, setArmDelete] = useState<string | null>(null)
  const [im, setIm] = useState<IronmanStatus | null>(null)
  const [armIron, setArmIron] = useState<'on' | null>(null)
  const [closeAsk, setCloseAsk] = useState(false)

  async function refresh(): Promise<void> {
    setBackups(await engine.listSaveBackups())
  }

  async function refreshIronman(): Promise<void> {
    setIm(await engine.ironmanStatus())
  }

  useEffect(() => {
    void refresh()
    void refreshIronman()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  async function handleBackup(): Promise<void> {
    setBusy(true)
    const r = await engine.backupNow()
    setBusy(false)
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.027'), true)
    else {
      onToast(tr("ui.SaveManager.001", { p1: r.name ?? '' }))
      void refresh()
    }
  }

  async function handleRestore(name: string): Promise<void> {
    setBusy(true)
    const r = await engine.restoreBackup(name)
    setBusy(false)
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.028'), true)
    else {
      onToast(tr("ui.SaveManager.002", { name: name }))
      onClose()
    }
  }

  async function handleImport(): Promise<void> {
    setBusy(true)
    const r = await engine.importSaveFromFile()
    setBusy(false)
    if (r.canceled) {
      onToast(tr('ui.SaveManager.031'))
      return
    }
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.029'), true)
    else {
      onToast(tr("ui.SaveManager.003"))
      onClose()
    }
  }

  async function handleExportCurrent(): Promise<void> {
    setBusy(true)
    const r = await engine.exportSaveToFile()
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.030'), true)
    else if (r.shared) onToast(tr("ui.SaveManager.004"))
    else onToast(r.path ? tr("ui.SaveManager.005", { p1: r.path }) : tr("ui.SaveManager.006"))
  }

  async function handleExportBackup(name: string): Promise<void> {
    setBusy(true)
    const r = await engine.exportBackupToFile(name)
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.030'), true)
    else if (r.shared) onToast(tr("ui.SaveManager.007"))
    else onToast(r.path ? tr("ui.SaveManager.008", { p1: r.path }) : tr("ui.SaveManager.009"))
  }

  async function handleDeleteBackup(name: string): Promise<void> {
    if (armDelete !== name) {
      setArmDelete(name)
      return
    }
    setArmDelete(null)
    setBusy(true)
    const r = await engine.deleteSaveBackup(name)
    setBusy(false)
    if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.170'), true)
    else {
      onToast(tr("ui.SaveManager.010", { name: name }))
      void refresh()
    }
  }

  async function handleIronman(): Promise<void> {
    if (im === null) return
    if (im.on) {
      setCloseAsk(true)
      return
    }
    if (im.modeChosen) return
    if (armIron !== 'on') {
      setArmIron('on')
      return
    }
    setArmIron(null)
    setBusy(true)
    const r = await engine.enterIronmanNow()
    setBusy(false)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Ironman.019'), true)
    else {
      onToast(tr('ui.Ironman.014'))
      void refreshIronman()
    }
  }

  async function confirmCloseIronman(): Promise<void> {
    setCloseAsk(false)
    setBusy(true)
    const r = await engine.closeIronmanNow()
    setBusy(false)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Ironman.019'), true)
    else {
      onToast(tr('ui.Ironman.015'))
      void refreshIronman()
    }
  }

  function rescueReady(b: SaveBackupInfo): boolean {
    if (im === null || !im.on) return false
    const age = Date.now() - (b.savedAtWallMs ?? b.wallMs)
    return age >= im.rescueMinAgeMs
  }

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">
            {tr("ui.App.065")}
            <HintIcon tip={tr("ui.SaveManager.011")} />
          </span>
          <button className="app-btn is-small" onClick={onClose}>
            {tr("ui.App.086")}
          </button>
        </div>
        <div className="app-modal-body">
          <div className="app-save-actions">
            <button className="app-btn is-primary is-small" onClick={() => void handleBackup()} disabled={busy}>
              {tr("ui.SaveManager.012")}
            </button>
            <button className="app-btn is-small" onClick={() => void handleImport()} disabled={busy} title={tr("ui.SaveManager.013")}>
              {tr("ui.SaveManager.014")}
            </button>
            <button className="app-btn is-small" onClick={() => void handleExportCurrent()} disabled={busy} title={tr("ui.SaveManager.015")}>
              {tr("ui.SaveManager.016")}
            </button>
            {busy ? <span className="app-dim">{tr("ui.SaveManager.017")}</span> : null}
          </div>
          {/* 铁人模式（S4b）：状态/代次 ＋ 转换或关闭（两段确认）；福利走悬停说明 */}
          <div className="app-bay-title">{tr("ui.Ironman.020")}</div>
          <div className="app-save-actions">
            <span className="app-dim">
              {im === null
                ? '…'
                : im.on
                  ? tr('ui.Ironman.001', { p1: String(im.seq) })
                  : im.ever
                    ? tr('ui.Ironman.008', { p1: String(im.seq) })
                    : tr('ui.Ironman.007')}
            </span>
            {im !== null && !im.on && !im.modeChosen ? (
              <>
                <button
                  className={`app-btn is-small${armIron === 'on' ? ' is-warn' : ' is-primary'}`}
                  onClick={() => void handleIronman()}
                  disabled={busy}
                  title={armIron === 'on' ? tr('ui.Ironman.022') : tr('ui.Ironman.021')}
                >
                  {armIron === 'on' ? tr('ui.Ironman.003') : tr('ui.Ironman.002')}
                </button>
                <HintIcon tip={tr('ui.Ironman.006')} />
              </>
            ) : null}
            {/* 关闭：一次点击即弹警告弹窗（2026-09-24 船长令），真关在弹窗里确认 */}
            {im !== null && im.on ? (
              <button
                className="app-btn is-small"
                onClick={() => void handleIronman()}
                disabled={busy}
                title={tr('ui.Ironman.024')}
              >
                {tr('ui.Ironman.004')}
              </button>
            ) : null}
          </div>
          <div className="app-bay-title">{tr("ui.SaveManager.018")}{backups === null ? '…' : backups.length}）</div>
          {backups === null ? (
            <div className="app-dim app-inv-empty">{tr("ui.SaveManager.019")}</div>
          ) : backups.length === 0 ? (
            <div className="app-dim app-inv-empty">{tr("ui.SaveManager.020")}</div>
          ) : (
            <ul className="app-inv-list">
              {backups.map((b) => (
                <li key={b.name} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">{b.name}</span>
                    <span className="app-inv-count">
                      {fmtTime(b.wallMs)} · {(b.size / 1024).toFixed(1)} KB
                      {rescueReady(b) ? ` · ${tr('ui.Ironman.010')}` : ''}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button className="app-btn is-small" onClick={() => void handleExportBackup(b.name)} disabled={busy} title={tr("ui.SaveManager.021")}>
                      {tr("ui.SaveManager.022")}
                    </button>
                    <button
                      className={`app-btn is-small${armDelete === b.name ? ' is-warn' : ''}`}
                      onClick={() => void handleDeleteBackup(b.name)}
                      disabled={busy}
                      title={armDelete === b.name ? tr("ui.SaveManager.023") : tr("ui.SaveManager.024")}
                    >
                      {armDelete === b.name ? tr("ui.SaveManager.025") : tr("ui.FitPage.068")}
                    </button>
                    <button className="app-btn is-small is-primary" onClick={() => void handleRestore(b.name)} disabled={busy}>
                      {tr("ui.SaveManager.026")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/**
       * **关闭铁人模式的警告弹窗**（**2026-09-24 船长令**：「新增玩家关闭铁人模式时弹出的警告，
       * 要告诉玩家关闭后无法再开启」）。
       *
       * 与站内其它确认弹窗同一套结构（`.app-modal-mask` / `.app-modal` / `.app-modal-head` /
       * `.app-modal-body`，对齐 WormholeScan 的"放弃确认"那种写法）：点遮罩或「✕ 关闭」都等于放弃，
       * 只有点红色的「确认关闭」才真关。
       * ⚠ 它是外层存档弹窗的**兄弟层**（同样的 `position: fixed`、同 z-index，靠 DOM 顺序压在上面）⇒
       * 内层遮罩必须 `stopPropagation`，否则点击会冒泡到外层 `onClick={onClose}` 把整个存档页关掉。
       */}
      {closeAsk ? (
        <div
          className="app-modal-mask"
          onClick={(e) => {
            e.stopPropagation()
            setCloseAsk(false)
          }}
        >
          <div className="app-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{tr('ui.Ironman.039')}</span>
              <button className="app-btn is-small" onClick={() => setCloseAsk(false)}>
                {tr('ui.App.086')}
              </button>
            </div>
            <div className="app-modal-body">
              <div>{tr('ui.Ironman.040')}</div>
              <div className="app-dim" style={{ marginTop: 'var(--wui-sp-6)' }}>{tr('ui.Ironman.041')}</div>
              <div className="app-save-actions" style={{ marginTop: 'var(--wui-sp-10)' }}>
                <button className="app-btn is-small is-warn" disabled={busy} onClick={() => void confirmCloseIronman()}>
                  {tr('ui.Ironman.005')}
                </button>
                <button className="app-btn is-small" onClick={() => setCloseAsk(false)}>
                  {tr('ui.ActivityBar.004')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
