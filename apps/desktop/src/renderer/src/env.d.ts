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
  }

  interface Window {
    whale: WhaleApi
  }
}

export {}
