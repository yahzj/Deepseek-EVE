/**
 * 存档持久化适配层（双端同源）：
 * - Electron 桌面端：window.whale（主进程读写 %APPDATA% 文件 + IPC）；
 * - 纯浏览器（GitHub Pages 网页版）：无 window.whale 时自动降级为 localStorage——
 *   主档一个键 + 时间戳命名的浏览器内备份（备份/恢复面板与桌面同一套体验）。
 * 引擎与界面一律经 saveBridge 访问，两端零分支差异。
 */
import { tr } from '../i18n/locale'

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
  pickImportSave: () => window.whale.pickImportSave(),
  exportSaveToFile: (text) => window.whale.exportSaveToFile(text),
  deleteBackup: (name) => window.whale.deleteBackup(name),
  ironmanLedger: () => window.whale.ironmanLedger(),
  ironmanNoteRescue: () => window.whale.ironmanNoteRescue(),
}

/* ───────── 浏览器分支：localStorage（键空间：1 主档 + N 备份） ───────── */

const SAVE_KEY = 'whale:idle:save'
const BP_PREFIX = 'whale:idle:backup:'
/** 铁人账本键（**与存档分开**；重置档案不清它） */
const LEDGER_KEY = 'whale:idle:ironman-ledger'
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

/** 网页分支：把存档文本里的代次推到账本（与桌面端 `save:save` 同口径：只增不减） */
function webBumpLedgerFromSave(data: string): void {
  try {
    const raw = JSON.parse(data) as { state?: { ironman?: { seq?: unknown } } }
    const seqRaw = raw.state?.ironman?.seq
    const seq = typeof seqRaw === 'number' && Number.isFinite(seqRaw) ? Math.max(0, Math.floor(seqRaw)) : 0
    if (seq <= 0) return
    const cur = JSON.parse(ls().getItem(LEDGER_KEY) ?? '{"seq":0,"rescues":0}') as { seq?: unknown; rescues?: unknown }
    const curSeq = typeof cur.seq === 'number' && Number.isFinite(cur.seq) ? Math.max(0, Math.floor(cur.seq)) : 0
    if (seq <= curSeq) return
    const curRescues = typeof cur.rescues === 'number' && Number.isFinite(cur.rescues) ? Math.max(0, Math.floor(cur.rescues)) : 0
    ls().setItem(LEDGER_KEY, JSON.stringify({ seq, rescues: curRescues }))
  } catch {
    // 账本更新失败不阻断游戏（闸门退化为"只看当前档代次"）
  }
}
const localStorageBridge: WhaleApi = {
  async load(): Promise<string | null> {
    return ls().getItem(SAVE_KEY)
  },
  async save(data: string): Promise<boolean> {
    if (!setWithBudget(SAVE_KEY, data)) return false
    // 与桌面端同口径：落盘后把这份档的代次推到账本（只增不减；普通档代次恒 0 ⇒ 不动）
    webBumpLedgerFromSave(data)
    return true
  },
  async backup(): Promise<{ ok: boolean; name?: string; error?: string }> {
    const text = ls().getItem(SAVE_KEY)
    if (text === null) return { ok: false, error: tr("ui.storage.001") }
    const now = new Date()
    let name = stampOf(now)
    for (let n = 1; ls().getItem(BP_PREFIX + name) !== null; n += 1) {
      name = stampOf(new Date(now.getTime() + n))
    }
    if (!setWithBudget(BP_PREFIX + name, text)) return { ok: false, error: tr("ui.storage.002") }
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
    if (text === null) return { ok: false, error: tr("ui.storage.003") }
    return { ok: true, text }
  },
  async restore(name: string): Promise<{ ok: boolean; error?: string }> {
    const key = backupKeyOf(name)
    const text = key === null ? null : ls().getItem(key)
    if (text === null) return { ok: false, error: tr("ui.storage.003") }
    /**
     * ⚠ **2026-09-17 船长**：「**导入或者恢复存档时，不要备份现有存档**」⇒ 这里**不再**为当前档补一份备份
     * （桌面主进程那条同款，一起删）。要留退路请先点「备份当前档」——手动备份与备份列表照旧。
     */
    if (!setWithBudget(SAVE_KEY, text)) return { ok: false, error: tr("ui.storage.004") }
    return { ok: true }
  },
  /** 删除某份浏览器内备份（只删备份键，不影响主档键） */
  async deleteBackup(name: string): Promise<{ ok: boolean; error?: string }> {
    const key = backupKeyOf(name)
    if (key === null) return { ok: false, error: tr("ui.storage.005") }
    if (ls().getItem(key) === null) return { ok: false, error: tr("ui.storage.003") }
    ls().removeItem(key)
    return { ok: true }
  },
  /**
   * **铁人账本（网页分支）**：桌面端账本落在 `%APPDATA%` 的独立文件里；网页版没有文件系统，
   * 用 localStorage 的一个独立键作等价物（口径一致：**与存档分开存**、只增不减、重置档案不清）。
   */
  async ironmanLedger(): Promise<{ ok: boolean; seq: number; rescues: number; error?: string }> {
    try {
      const raw = ls().getItem(LEDGER_KEY)
      if (!raw) return { ok: true, seq: 0, rescues: 0 }
      const o = JSON.parse(raw) as { seq?: unknown; rescues?: unknown }
      const seq = typeof o.seq === 'number' && Number.isFinite(o.seq) ? Math.max(0, Math.floor(o.seq)) : 0
      const rescues = typeof o.rescues === 'number' && Number.isFinite(o.rescues) ? Math.max(0, Math.floor(o.rescues)) : 0
      return { ok: true, seq, rescues }
    } catch (err) {
      return { ok: false, seq: 0, rescues: 0, error: String(err) }
    }
  },
  /** 救援装载记账（网页分支：只累加计数；**玩家侧不显示**） */
  async ironmanNoteRescue(): Promise<{ ok: boolean; error?: string }> {
    try {
      const cur = await localStorageBridge.ironmanLedger()
      ls().setItem(LEDGER_KEY, JSON.stringify({ seq: cur.seq, rescues: cur.rescues + 1 }))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },
  /** 导入 = 系统文件选择器（桌面浏览器/手机网页都可用），读取 .json 文本返回 */
  async pickImportSave(): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      let done = false
      const finish = (r: { ok: boolean; text?: string; canceled?: boolean; error?: string }): void => {
        if (done) return
        done = true
        input.remove()
        window.removeEventListener('focus', onFocusBack)
        resolve(r)
      }
      /**
       * 兼容兜底：部分浏览器不派发 `cancel` —— 对话框关闭后焦点回来、且仍没选到文件时视为取消。
       *
       * ⚠ **2026-09-22 船长报障修**（玩家 · Win10 · Edge 153：「**无法导入存档，导入后没反应**」）：
       * 原实现是"focus 回来 → **硬等 300ms** → 仍没文件就 `finish(取消)`"，而 `finish` 一旦调用就**永久锁定**
       * （`done = true`）。Edge/Win10 上系统文件对话框关掉后，`change` 事件可能**晚于 `focus` 几百毫秒**
       * （文件被杀软/Defender 扫描时尤其明显）⇒ **玩家明明选了文件，却在 change 到达前被判成"取消"**，
       * 之后真正的 change 被 `done` 挡掉 ⇒ 界面上就是"导入没反应/没动静"。
       * 修法：① 改成**轮询**，宽限 ~2 秒；② 期间一旦有文件就交给 `change` 处理；③ 只有整段宽限都没文件才判取消。
       */
      const onFocusBack = (): void => {
        let tries = 0
        const poll = (): void => {
          if (done) return
          if ((input.files?.length ?? 0) > 0) return // 已经选到文件 ⇒ 等 change 接手
          if (++tries >= 7) {
            finish({ ok: false, canceled: true })
            return
          }
          setTimeout(poll, 300)
        }
        setTimeout(poll, 300)
      }
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          finish({ ok: false, canceled: true })
          return
        }
        if (file.size > 10 * 1024 * 1024) {
          finish({ ok: false, error: tr("ui.storage.006") })
          return
        }
        const reader = new FileReader()
        reader.onload = (): void => {
          /**
           * ⚠ 去掉 UTF-8 BOM（2026-09-22 同批加固）：玩家常把存档用记事本另存一次
           * （Windows 记事本会加 BOM）⇒ `JSON.parse('\uFEFF{…}')` 直接抛错。剥一层更稳。
           */
          finish({ ok: true, text: String(reader.result ?? '').replace(/^\uFEFF/, '') })
        }
        reader.onerror = (): void => finish({ ok: false, error: tr("ui.storage.007") })
        reader.readAsText(file, 'utf-8')
      })
      input.addEventListener('cancel', () => finish({ ok: false, canceled: true }))
      window.addEventListener('focus', onFocusBack)
      input.click()
    })
  },
  /** 导出 = **优先系统分享**，不支持/被拒时回落浏览器下载（2026-09-13 船长反馈「手机网页点了没反应」后加）：
   *  - 手机网页里下载常被拦：QQ/微信等 App 内置浏览器直接吞掉 `<a download>`，
   *    iOS 也只在"下载/分享"里给一条提示 —— 玩家看到的就是"点了没反应"；
   *  - 系统分享（`navigator.share` 带文件）在手机上弹「存储到文件 / 发给自己的聊天」，
   *    **在多数内置浏览器里同样放行**，是手机端最可靠的导出通道；
   *  - 兜底仍是浏览器下载（手机/桌面保存到下载目录；iOS 可在分享里选「存储到文件」）。
   *  ⚠ 分享/下载都必须在**用户手势内**发起：本函数内不做任何前置 await（调用方也不要先 await 别的东西）。 */
  async exportSaveToFile(text: string): Promise<{ ok: boolean; shared?: boolean; canceled?: boolean; error?: string }> {
    const name = `${stampOf(new Date())}.json`
    // ① 系统分享（浏览器需支持"分享文件"；不支持则直接跳过）
    try {
      const share = navigator as Navigator & {
        share?: (data: ShareData) => Promise<void>
        canShare?: (data: ShareData) => boolean
      }
      const file = new File([text], name, { type: 'application/json' })
      if (typeof share.share === 'function' && (typeof share.canShare !== 'function' || share.canShare({ files: [file] }))) {
        await share.share({ files: [file], title: name })
        return { ok: true, shared: true }
      }
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return { ok: false, canceled: true } // 玩家取消分享
      // 其它失败（如该浏览器不支持带文件分享）→ 不报错，走下面的下载兜底
    }
    // ② 浏览器下载兜底
    try {
      const blob = new Blob([text], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: tr("ui.storage.008", { p1: String(err) }) }
    }
  },
}

/** 引擎使用的持久化桥：桌面有 window.whale → IPC；纯浏览器 → localStorage */
export const saveBridge: WhaleApi =
  typeof window !== 'undefined' && window.whale !== undefined ? electronBridge : localStorageBridge
