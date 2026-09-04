/**
 * 存档持久化适配层（双端同源）：
 * - Electron 桌面端：window.whale（主进程读写 %APPDATA% 文件 + IPC）；
 * - 纯浏览器（GitHub Pages 网页版）：无 window.whale 时自动降级为 localStorage——
 *   主档一个键 + 时间戳命名的浏览器内备份（备份/恢复面板与桌面同一套体验）。
 * 引擎与界面一律经 saveBridge 访问，两端零分支差异。
 */

/** 备份文件名（与桌面主进程同构：save-YYYYMMDD-HHmmss(.json)，可选 -n 去重后缀） */
const BP_NAME_RE = /^save-\d{8}-\d{6}(-\d+)?\.json$/

function stampOf(date: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `save-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.json`
}

/** 备份创建时刻（毫秒）：由文件名时间戳还原（近似；仅用于列表排序与"删除最旧"） */
function wallMsOf(name: string): number {
  const m = /^save-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)
  if (!m) return 0
  const [, Y, Mo, D, H, Mi, S] = m.map(Number)
  return new Date(Y, Mo - 1, D, H, Mi, S).getTime()
}

/* ───────── Electron 分支：直接转发主进程桥（行为与现状完全一致） ───────── */

const electronBridge: WhaleApi = {
  load: () => window.whale.load(),
  save: (data) => window.whale.save(data),
  backup: () => window.whale.backup(),
  listBackups: () => window.whale.listBackups(),
  readBackup: (name) => window.whale.readBackup(name),
  restore: (name) => window.whale.restore(name),
}

/* ───────── 浏览器分支：localStorage（键空间：1 主档 + N 备份） ───────── */

const SAVE_KEY = 'whale:idle:save'
const BP_PREFIX = 'whale:idle:backup:'
const BP_CAP = 30 // 与桌面一致：最多保留 30 份备份（超出删最旧）

function ls(): Storage {
  return window.localStorage
}

function backupKeyOf(name: string): string | null {
  if (!BP_NAME_RE.test(name)) return null
  return BP_PREFIX + name
}

/** 空间不足时清理最旧备份一次；仍不足返回失败 */
function setWithBudget(key: string, data: string): boolean {
  try {
    ls().setItem(key, data)
    return true
  } catch {
    // 配额满：删除最旧一份备份后重试（主档不删）
    let oldest: { key: string; wall: number } | null = null
    for (let i = 0; i < ls().length; i += 1) {
      const k = ls().key(i)
      if (k !== null && k.startsWith(BP_PREFIX)) {
        const wall = wallMsOf(k.slice(BP_PREFIX.length))
        if (oldest === null || wall < oldest.wall) oldest = { key: k, wall }
      }
    }
    if (oldest) ls().removeItem(oldest.key)
    try {
      ls().setItem(key, data)
      return true
    } catch {
      return false
    }
  }
}

function collectBackups(): Array<{ name: string; text: string; wall: number }> {
  const out: Array<{ name: string; text: string; wall: number }> = []
  for (let i = 0; i < ls().length; i += 1) {
    const k = ls().key(i)
    if (k !== null && k.startsWith(BP_PREFIX)) {
      const text = ls().getItem(k)
      if (text !== null) out.push({ name: k.slice(BP_PREFIX.length), text, wall: wallMsOf(k.slice(BP_PREFIX.length)) })
    }
  }
  return out
}

const localStorageBridge: WhaleApi = {
  async load(): Promise<string | null> {
    return ls().getItem(SAVE_KEY)
  },
  async save(data: string): Promise<boolean> {
    return setWithBudget(SAVE_KEY, data)
  },
  async backup(): Promise<{ ok: boolean; name?: string; error?: string }> {
    const text = ls().getItem(SAVE_KEY)
    if (text === null) return { ok: false, error: '还没有可备份的存档。' }
    const now = new Date()
    let name = stampOf(now)
    for (let n = 1; ls().getItem(BP_PREFIX + name) !== null; n += 1) {
      name = stampOf(new Date(now.getTime() + n))
    }
    if (!setWithBudget(BP_PREFIX + name, text)) return { ok: false, error: '浏览器存储空间不足，无法备份。' }
    // 超出上限删最旧（保留最近的）
    const backups = collectBackups().sort((a, b) => b.wall - a.wall)
    for (const b of backups.slice(BP_CAP)) ls().removeItem(BP_PREFIX + b.name)
    return { ok: true, name }
  },
  async listBackups(): Promise<{ ok: boolean; backups: SaveBackupInfo[]; error?: string }> {
    const list = collectBackups()
      .sort((a, b) => b.wall - a.wall)
      .map((b) => ({ name: b.name, size: new TextEncoder().encode(b.text).length, wallMs: b.wall || Date.now() }))
    return { ok: true, backups: list.slice(0, BP_CAP) }
  },
  async readBackup(name: string): Promise<{ ok: boolean; text?: string; error?: string }> {
    const key = backupKeyOf(name)
    const text = key === null ? null : ls().getItem(key)
    if (text === null) return { ok: false, error: '找不到该备份。' }
    return { ok: true, text }
  },
  async restore(name: string): Promise<{ ok: boolean; error?: string }> {
    const key = backupKeyOf(name)
    const text = key === null ? null : ls().getItem(key)
    if (text === null) return { ok: false, error: '找不到该备份。' }
    // 与桌面一致：覆盖前先把当前档备份一份
    const current = ls().getItem(SAVE_KEY)
    if (current !== null) {
      const now = new Date()
      let bk = stampOf(now)
      for (let n = 1; ls().getItem(BP_PREFIX + bk) !== null; n += 1) bk = stampOf(new Date(now.getTime() + n))
      setWithBudget(BP_PREFIX + bk, current)
    }
    if (!setWithBudget(SAVE_KEY, text)) return { ok: false, error: '浏览器存储空间不足，恢复失败。' }
    return { ok: true }
  },
}

/** 引擎使用的持久化桥：桌面有 window.whale → IPC；纯浏览器 → localStorage */
export const saveBridge: WhaleApi =
  typeof window !== 'undefined' && window.whale !== undefined ? electronBridge : localStorageBridge
