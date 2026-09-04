/**
 * 安全桥：界面进程只能通过 window.whale 调用这些能力（读档/存档/备份/恢复），
 * 拿不到 Node.js 权限，防止界面代码出问题影响电脑安全。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('whale', {
  /** 读取存档文本；从未保存过返回 null */
  load: (): Promise<string | null> => ipcRenderer.invoke('save:load'),
  /** 写入存档文本，成功返回 true */
  save: (data: string): Promise<boolean> => ipcRenderer.invoke('save:save', data),
  /** 把当前存档复制成时间戳备份（先确保已保存最新）；返回备份文件名 */
  backup: (): Promise<{ ok: boolean; name?: string; error?: string }> => ipcRenderer.invoke('save:backup'),
  /** 列出备份文件（时间倒序） */
  listBackups: (): Promise<{ ok: boolean; backups: Array<{ name: string; size: number; wallMs: number }>; error?: string }> =>
    ipcRenderer.invoke('save:list-backups'),
  /** 读取某份备份的文本（校验用） */
  readBackup: (name: string): Promise<{ ok: boolean; text?: string; error?: string }> => ipcRenderer.invoke('save:read-backup', name),
  /** 恢复备份（覆盖前自动备份当前档） */
  restore: (name: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('save:restore', name),
})
