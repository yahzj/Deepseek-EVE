
declare module '*.css'
declare module '*.css?url' {
  const url: string
  export default url
}

declare global {
  const __APP_VERSION__: string
  const __BUILD_SHA__: string
  const __BUILD_TIME__: string

  interface SaveBackupInfo {
    name: string
    size: number
    wallMs: number
    savedAtWallMs?: number
  }

  interface SaveFileStatus {
    supported: boolean
    bound: boolean
    connected: boolean
    name: string | null
  }

  interface SaveFileApi {
    status(): Promise<SaveFileStatus>
    bind(): Promise<{ ok: boolean; canceled?: boolean; name?: string; error?: string }>
    reconnect(): Promise<SaveFileReconnectResult>
    resume(token: number, expected: string): Promise<SaveFileReconnectResult>
    resolve(token: number, expected: string, text: string, choice: 'file' | 'current'): Promise<SaveFileResolveResult>
    unbind(): Promise<{ ok: boolean; error?: string }>
  }

  interface SaveFileReconnectResult {
    ok: boolean
    text?: string
    token?: number
    name?: string
    changed?: boolean
    error?: string
  }
  interface SaveFileResolveResult extends SaveFileReconnectResult {
    browserSaved?: boolean
    fileSaved?: boolean
  }

  interface WhaleAudioInstallResult {
    ok: boolean
    code: number | null
    output: string
  }
  interface WhaleAudioApi {
    installPack(pack: ArrayBuffer, options?: { dryRun?: boolean }): Promise<WhaleAudioInstallResult>
  }

  interface WhaleApi {
    load(): Promise<string | null>
    save(data: string): Promise<boolean>
    backup(snapshot?: string): Promise<{ ok: boolean; name?: string; error?: string }>
    listBackups(): Promise<{ ok: boolean; backups: SaveBackupInfo[]; error?: string }>
    readBackup(name: string): Promise<{ ok: boolean; text?: string; error?: string }>
    restore(name: string): Promise<{ ok: boolean; error?: string }>
  ironmanLedger(): Promise<{ ok: boolean; seq: number; rescues: number; error?: string }>
  ironmanNoteRescue(): Promise<{ ok: boolean; error?: string }>
    deleteBackup(name: string): Promise<{ ok: boolean; error?: string }>
    pickImportSave(): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }>
    exportSaveToFile(text: string): Promise<{ ok: boolean; path?: string; shared?: boolean; canceled?: boolean; error?: string }>
    saveFile?: SaveFileApi
    audio?: WhaleAudioApi
  }

  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }
  interface FileSystemFileHandle {
    queryPermission?(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission?(desc?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }
  interface SaveFilePickerOptions {
    suggestedName?: string
    types?: Array<{ description?: string; accept: Record<string, string[]> }>
  }

  interface Window {
    whale: WhaleApi
    __autoperf?: string
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
}

export {}
