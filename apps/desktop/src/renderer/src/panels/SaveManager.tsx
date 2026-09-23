/**
 * 存档管理（B5）：备份当前档 / 列出备份 / 一键恢复。
 * ⚠ **2026-09-17 船长**：「**导入或者恢复存档时，不要备份现有存档**」⇒ 恢复与导入**都不再**自动备份原档
 * （桌面主进程、网页分支、导入三条路径一起删）；要留退路只能用「备份当前档」手动备。
 */
import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { HintIcon } from '../ui/Hint'
import { tr, cmdText } from '../i18n/locale'

function fmtTime(wallMs: number): string {
  return new Date(wallMs).toLocaleString('zh-CN', { hour12: false })
}

/** 铁人模式读数（S4b）：代次/开关/救援门槛，全部由引擎现取 */
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
  /** 删除二次确认：记住正在等待确认的备份名（再点一次才真删） */
  const [armDelete, setArmDelete] = useState<string | null>(null)
  /** 铁人开启/关闭的二次确认（同删除那一套：第一次点只进确认态） */
  const [im, setIm] = useState<IronmanStatus | null>(null)
  const [armIron, setArmIron] = useState<'on' | 'off' | null>(null)

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

  /** 导入：系统文件选择（桌面/手机网页通用）→ 校验 → 覆盖当前档（⚠ **不备份**原档，2026-09-17 船长） */
  async function handleImport(): Promise<void> {
    setBusy(true)
    const r = await engine.importSaveFromFile()
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.029'), true)
    else {
      onToast(tr("ui.SaveManager.003"))
      onClose()
    }
  }

  /** 导出当前档：桌面 = 系统对话框选文件夹/文件名；网页/手机 = 优先系统分享，不支持时触发下载 */
  async function handleExportCurrent(): Promise<void> {
    setBusy(true)
    const r = await engine.exportSaveToFile()
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.030'), true)
    else if (r.shared) onToast(tr("ui.SaveManager.004"))
    else onToast(r.path ? tr("ui.SaveManager.005", { p1: r.path }) : tr("ui.SaveManager.006"))
  }

  /** 导出指定备份：同上（桌面选位置；网页/手机优先分享、回落下载） */
  async function handleExportBackup(name: string): Promise<void> {
    setBusy(true)
    const r = await engine.exportBackupToFile(name)
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(cmdText(r) || tr('ui.SaveManager.030'), true)
    else if (r.shared) onToast(tr("ui.SaveManager.007"))
    else onToast(r.path ? tr("ui.SaveManager.008", { p1: r.path }) : tr("ui.SaveManager.009"))
  }

  /** 删除备份（两讨伐确认；只删备份文件，不影响当前档） */
  async function handleDeleteBackup(name: string): Promise<void> {
    if (armDelete !== name) {
      setArmDelete(name) // 第一次点：进入确认态
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

  /** 开启（旧档一次性转换）/ 关闭铁人模式：两段确认，第二次点才真做 */
  async function handleIronman(): Promise<void> {
    if (im === null) return
    if (im.on) {
      if (armIron !== 'off') {
        setArmIron('off')
        return
      }
      setArmIron(null)
      setBusy(true)
      const r = await engine.closeIronmanNow()
      setBusy(false)
      if (!r.ok) onToast(cmdText(r) || tr('ui.Ironman.019'), true)
      else {
        onToast(tr('ui.Ironman.015'))
        void refreshIronman()
      }
      return
    }
    if (im.ever) return // 单向门：关闭过就没有入口（引擎也会拒）
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

  /** 该备份能不能当救援档：铁人档 ＋ 档龄 ≥ 两天（按档内保存时刻，缺则退回文件时间） */
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
            {im !== null && !im.on && !im.ever ? (
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
            {im !== null && im.on ? (
              <button
                className={`app-btn is-small${armIron === 'off' ? ' is-warn' : ''}`}
                onClick={() => void handleIronman()}
                disabled={busy}
                title={armIron === 'off' ? tr('ui.Ironman.023') : tr('ui.Ironman.024')}
              >
                {armIron === 'off' ? tr('ui.Ironman.005') : tr('ui.Ironman.004')}
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
    </div>
  )
}
