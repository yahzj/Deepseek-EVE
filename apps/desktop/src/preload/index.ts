import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('whale', {
  load: (): Promise<string | null> => ipcRenderer.invoke('save:load'),
  save: (data: string): Promise<boolean> => ipcRenderer.invoke('save:save', data),
  backup: (snapshot?: string): Promise<{ ok: boolean; name?: string; error?: string }> => ipcRenderer.invoke('save:backup', snapshot),
  listBackups: (): Promise<{ ok: boolean; backups: Array<{ name: string; size: number; wallMs: number }>; error?: string }> =>
    ipcRenderer.invoke('save:list-backups'),
  readBackup: (name: string): Promise<{ ok: boolean; text?: string; error?: string }> => ipcRenderer.invoke('save:read-backup', name),
  restore: (name: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('save:restore', name),
  ironmanLedger: (): Promise<{ ok: boolean; seq: number; rescues: number; error?: string }> => ipcRenderer.invoke('ironman:ledger'),
  ironmanNoteRescue: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ironman:note-rescue'),
  deleteBackup: (name: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('save:delete-backup', name),
  pickImportSave: (): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('save:pick-import'),
  exportSaveToFile: (text: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> =>
    ipcRenderer.invoke('save:export-to-file', text),
  setLocale: (locale: 'zh' | 'en'): Promise<boolean> => ipcRenderer.invoke('l10n:set-locale', locale),
  audio: {
    installPack: (pack: ArrayBuffer, options?: { dryRun?: boolean }): Promise<{ ok: boolean; code: number | null; output: string }> =>
      ipcRenderer.invoke('audio:install-pack', pack, options),
  },
})

try {
  const spec = process.env.WHALE_AUTOPERF
  if (spec) contextBridge.exposeInMainWorld('__autoperf', spec)
} catch {
}
