/**
 * 存档管理（B5）：备份当前档 / 列出备份 / 一键恢复（恢复前自动备份当前档）。
 */
import { useEffect, useState } from 'react'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

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
      onToast(`已恢复到 ${name}（恢复前已自动备份当前档）。`)
      onClose()
    }
  }

  return (
    <div className="app-modal-mask" onClick={onClose}>
      <div className="app-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">存档管理</span>
          <button className="app-btn is-small" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="app-modal-body">
          <div className="app-dim app-note">
            备份 = 把当前进度复制成时间戳文件（保存在游戏数据目录）；恢复 = 载入所选备份并立即生效，
            操作前会自动为当前档再做一次备份以防误操作。
          </div>
          <div className="app-save-actions">
            <button className="app-btn is-primary is-small" onClick={() => void handleBackup()} disabled={busy}>
              备份当前档
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
