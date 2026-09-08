/**
 * 类型声明：让 TypeScript 认识 .css 导入与 window.whale（主进程提供的安全接口）。
 */

declare module '*.css'

declare global {
  /** 一份存档备份的元信息 */
  interface SaveBackupInfo {
    name: string
    size: number
    /** 备份创建时间（毫秒时间戳） */
    wallMs: number
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
    /** 恢复备份（覆盖前自动备份当前档） */
    restore(name: string): Promise<{ ok: boolean; error?: string }>
    /** 删除某份备份（只删备份文件，不影响当前档） */
    deleteBackup(name: string): Promise<{ ok: boolean; error?: string }>
    /** 弹文件选择框读取外部 .json 存档文本（桌面 = 系统对话框；网页版 = 文件选择器；取消 → canceled） */
    pickImportSave(): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }>
    /** 把存档文本导出到用户指定位置（桌面 = 保存对话框；网页版 = 触发下载；取消 → canceled） */
    exportSaveToFile(text: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  }

  interface Window {
    whale: WhaleApi
    /** 性能自动采集场景 JSON（仅 Electron 自动跑分注入；平时为 undefined） */
    __autoperf?: string
  }
}

export {}
