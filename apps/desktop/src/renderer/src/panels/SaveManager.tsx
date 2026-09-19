/**
 * 存档管理（B5）：备份当前档 / 列出备份 / 一键恢复。
 * ⚠ **2026-09-17 船长**：「**导入或者恢复存档时，不要备份现有存档**」⇒ 恢复与导入**都不再**自动备份原档
 * （桌面主进程、网页分支、导入三条路径一起删）；要留退路只能用「备份当前档」手动备。
 */
import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { HintIcon } from '../ui/Hint'
import { tr } from '../i18n/locale'

function fmtTime(wallMs: number): string {
  return new Date(wallMs).toLocaleString('zh-CN', { hour12: false })
}

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

  async function refresh(): Promise<void> {
    setBackups(await engine.listSaveBackups())
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  async function handleBackup(): Promise<void> {
    setBusy(true)
    const r = await engine.backupNow()
    setBusy(false)
    if (!r.ok) onToast(r.error ?? '备份失败。', true)
    else {
      onToast(`已备份：${r.name ?? ''}`)
      void refresh()
    }
  }

  async function handleRestore(name: string): Promise<void> {
    setBusy(true)
    const r = await engine.restoreBackup(name)
    setBusy(false)
    if (!r.ok) onToast(r.error ?? '恢复失败。', true)
    else {
      onToast(`已恢复到 ${name}（未备份原档：要留退路请先点「备份当前档」）。`)
      onClose()
    }
  }

  /** 导入：系统文件选择（桌面/手机网页通用）→ 校验 → 覆盖当前档（⚠ **不备份**原档，2026-09-17 船长） */
  async function handleImport(): Promise<void> {
    setBusy(true)
    const r = await engine.importSaveFromFile()
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(r.error ?? '导入失败。', true)
    else {
      onToast('已从所选文件导入存档（未备份原档：要留退路请先点「备份当前档」）。')
      onClose()
    }
  }

  /** 导出当前档：桌面 = 系统对话框选文件夹/文件名；网页/手机 = 优先系统分享，不支持时触发下载 */
  async function handleExportCurrent(): Promise<void> {
    setBusy(true)
    const r = await engine.exportSaveToFile()
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(r.error ?? '导出失败。', true)
    else if (r.shared) onToast('存档已导出：已调起系统分享——选「存储到文件」或发给自己即可保存。')
    else onToast(r.path ? `已导出到：${r.path}` : '存档已开始下载（保存在下载目录；若点了没反应，请改用「系统浏览器」打开本页）。')
  }

  /** 导出指定备份：同上（桌面选位置；网页/手机优先分享、回落下载） */
  async function handleExportBackup(name: string): Promise<void> {
    setBusy(true)
    const r = await engine.exportBackupToFile(name)
    setBusy(false)
    if (r.canceled) return
    if (!r.ok) onToast(r.error ?? '导出失败。', true)
    else if (r.shared) onToast('备份已导出：已调起系统分享（选「存储到文件」或发给自己）。')
    else onToast(r.path ? `已导出：${r.path}` : '备份已开始下载（保存在下载目录）。')
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
    if (!r.ok) onToast(r.error ?? '删除失败。', true)
    else {
      onToast(`已删除备份：${name}`)
      void refresh()
    }
  }

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">
            存档管理
            <HintIcon tip="备份 = 把当前进度复制成时间戳文件（保存在游戏数据目录），最多 30 份。⚠ 恢复 / 导入不会自动备份原档（2026-09-17 船长定）——想留退路请先点「备份当前档」；删除 = 移除所选备份文件，不影响当前档。导入 = 从任意存档文件恢复，导入时会按文件保存时刻与现在的时间差补齐离线进度；导出 = 把当前进度存成文件（手机网页会优先弹系统分享：选「存储到文件」或发给自己；浏览器不支持分享时才改为下载到下载目录——若内置浏览器拦了下载，请用系统浏览器打开本页）。" />
          </span>
          <button className="app-btn is-small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="app-modal-body">
          <div className="app-save-actions">
            <button className="app-btn is-primary is-small" onClick={() => void handleBackup()} disabled={busy}>
              备份当前档
            </button>
            <button className="app-btn is-small" onClick={() => void handleImport()} disabled={busy} title="选择一个 .json 存档文件导入（⚠ 不备份原档；按时间差补齐离线进度）">
              导入存档…
            </button>
            <button className="app-btn is-small" onClick={() => void handleExportCurrent()} disabled={busy} title="把当前进度保存为你指定的文件">
              导出存档…
            </button>
            {busy ? <span className="app-dim">处理中……</span> : null}
          </div>
          <div className="app-bay-title">备份列表（{backups === null ? '…' : backups.length}）</div>
          {backups === null ? (
            <div className="app-dim app-inv-empty">读取中……</div>
          ) : backups.length === 0 ? (
            <div className="app-dim app-inv-empty">还没有备份——点「备份当前档」创建第一份。</div>
          ) : (
            <ul className="app-inv-list">
              {backups.map((b) => (
                <li key={b.name} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">{b.name}</span>
                    <span className="app-inv-count">
                      {fmtTime(b.wallMs)} · {(b.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button className="app-btn is-small" onClick={() => void handleExportBackup(b.name)} disabled={busy} title="把这份备份保存为你指定的文件">
                      导出
                    </button>
                    <button
                      className={`app-btn is-small${armDelete === b.name ? ' is-warn' : ''}`}
                      onClick={() => void handleDeleteBackup(b.name)}
                      disabled={busy}
                      title={armDelete === b.name ? '再点一次确认删除（只删这份备份，不影响当前档）' : '删除这份备份（两讨伐确认）'}
                    >
                      {armDelete === b.name ? '再点确认删除' : tr("ui.FitPage.068")}
                    </button>
                    <button className="app-btn is-small is-primary" onClick={() => void handleRestore(b.name)} disabled={busy}>
                      恢复
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
