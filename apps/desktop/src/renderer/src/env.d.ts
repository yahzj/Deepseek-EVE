/**
 * 类型声明：让 TypeScript 认识 .css 导入与 window.whale（主进程提供的安全接口）。
 */

declare module '*.css'
/** 样式表按 URL 取用（两套布局各一份，见 `ui/layoutStyles.ts`） */
declare module '*.css?url' {
  const url: string
  export default url
}

declare global {
  /** 一份存档备份的元信息 */
  interface SaveBackupInfo {
    name: string
    size: number
    /** 备份创建时间（毫秒时间戳） */
    wallMs: number
    /** **档内保存时刻**（savedAtWallMs；救援判龄用——比文件 mtime 更抗复制/搬动） */
    savedAtWallMs?: number
  }

  /**
   * **网页版「绑定本地存档文件」**（2026-09-25 船长令：存档除浏览器默认存储外，
   * **优先**保存到本地文件，'跟我本地运行一样'）。只有网页分支实现；桌面端本来就是文件存档
   * ⇒ `window.whale.saveFile` 不存在（界面按 `undefined` 处理）。
   * 底层 = **File System Access API**（Chromium 系；Safari/Firefox 没有 ⇒ `supported: false`）。
   */
  interface SaveFileStatus {
    /** 本浏览器是否支持直接写本地文件（`showSaveFilePicker` 存在） */
    supported: boolean
    /** 是否已绑定过一个文件（句柄在 IndexedDB 里） */
    bound: boolean
    /** 句柄是否**已获读写权限**（浏览器重启后可能被收回 ⇒ 需要玩家点一次「重新连接」） */
    connected: boolean
    /** 绑定的文件名（未绑定 ⇒ null） */
    name: string | null
  }

  interface SaveFileApi {
    status(): Promise<SaveFileStatus>
    /** 绑定：弹系统保存框选/建一个文件，并把当前存档立刻写进去；玩家取消 ⇒ canceled */
    bind(): Promise<{ ok: boolean; canceled?: boolean; name?: string; error?: string }>
    /** 重新连接：对已存句柄再要一次读写权限（**必须在玩家手势里调**） */
    reconnect(): Promise<{ ok: boolean; name?: string; error?: string }>
    /** 解绑：删掉句柄（浏览器存储那份照旧） */
    unbind(): Promise<{ ok: boolean; error?: string }>
  }

  interface WhaleApi {
    /** 读取存档文本；从未保存过返回 null */
    load(): Promise<string | null>
    /** 写入存档文本，成功返回 true */
    save(data: string): Promise<boolean>
    /** 把当前存档复制成时间戳备份；返回备份文件名 */
    backup(): Promise<{ ok: boolean; name?: string; error?: string }>
    /** 列出备份文件（时间倒序，最多 30 份） */
    listBackups(): Promise<{ ok: boolean; backups: SaveBackupInfo[]; error?: string }>
    /** 读取某份备份的文本（恢复前校验用） */
    readBackup(name: string): Promise<{ ok: boolean; text?: string; error?: string }>
    /** 恢复备份（⚠ 2026-09-17 船长：**不再**为当前档自动备份，直接覆盖） */
    restore(name: string): Promise<{ ok: boolean; error?: string }>
  /** 铁人账本（存档之外的代次账本；只读） */
  ironmanLedger(): Promise<{ ok: boolean; seq: number; rescues: number; error?: string }>
  /** 救援装载记账（只累加计数） */
  ironmanNoteRescue(): Promise<{ ok: boolean; error?: string }>
    /** 删除某份备份（只删备份文件，不影响当前档） */
    deleteBackup(name: string): Promise<{ ok: boolean; error?: string }>
    /** 弹文件选择框读取外部 .json 存档文本（桌面 = 系统对话框；网页版 = 文件选择器；取消 → canceled） */
    pickImportSave(): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }>
    /** 把存档文本导出：桌面 = 保存对话框；手机网页 = **优先系统分享**（分享面板），不支持/被拒时回落浏览器下载；
     *  `shared` = 本次走的是系统分享；`path` = 桌面写盘位置；取消 → canceled */
    exportSaveToFile(text: string): Promise<{ ok: boolean; path?: string; shared?: boolean; canceled?: boolean; error?: string }>
    /** **网页版独有**：绑定/重连/解绑「本地存档文件」（桌面端不存在这一组） */
    saveFile?: SaveFileApi
  }

  /**
   * **File System Access API 的最小类型补充**（TS 的 `lib.dom` 只带了 `FileSystemFileHandle` 本体，
   * `showSaveFilePicker` 与权限查询/申请在不装 `@types/wicg-file-system-access` 时没有声明）。
   */
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
    /** 性能自动采集场景 JSON（仅 Electron 自动跑分注入；平时为 undefined） */
    __autoperf?: string
    /** 网页版：系统「另存为」对话框（Chromium 系；Safari/Firefox 没有） */
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
  }
}

export {}
