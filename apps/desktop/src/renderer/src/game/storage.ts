/**
 * 存档持久化适配层（双端同源）：
 * - Electron 桌面端：window.whale（主进程读写 %APPDATA% 文件 + IPC）；
 * - 纯浏览器（GitHub Pages 网页版）：无 window.whale 时自动降级为 localStorage——
 *   主档一个键 + 时间戳命名的浏览器内备份（备份/恢复面板与桌面同一套体验）。
 * 引擎与界面一律经 saveBridge 访问，两端零分支差异。
 */
import { tr } from '../i18n/locale'
import { noteSaveWriteFailed } from './saveGuard'
import { bindSaveFile, readFromBoundFile, reconnectSaveFile, saveFileStatus, unbindSaveFile, writeToBoundFile } from './saveFileHandle'

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

/** 取存档文本里的**档内保存时刻**（`savedAtWallMs`）；读不出/没这个字段 ⇒ 0（视为最旧） */
function savedAtOf(text: string | null): number {
  if (text === null) return 0
  try {
    const raw = JSON.parse(text) as { savedAtWallMs?: unknown }
    const v = raw.savedAtWallMs
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  } catch {
    return 0
  }
}

/**
 * **触屏/手机环境**（2026-09-30）：判定只用两个**标准**信号（无 UA 嗅探）——
 * `navigator.maxTouchPoints > 0` 或 `matchMedia('(hover: none)')`。
 * 用途只有一个：文件选择器的**取消宽限**放宽（手机从"文件"App/云盘里翻文件比桌面慢得多）。
 */
function touchLike(): boolean {
  try {
    if ((navigator.maxTouchPoints ?? 0) > 0) return true
    return typeof window.matchMedia === 'function' && window.matchMedia('(hover: none)').matches
  } catch {
    return false
  }
}

/**
 * **两份存档取较新**（2026-09-25 船长令裁定「甲案」）：本地文件 vs 浏览器存储。
 * 判据 = 档内 `savedAtWallMs`（比文件 mtime 更抗复制/搬动）；读不出时刻的那份视为最旧；
 * 两份都读不出 ⇒ 返回非 null 的那份（优先文件）。
 */
function newerSaveText(fileText: string | null, lsText: string | null): string | null {
  if (fileText === null) return lsText
  if (lsText === null) return fileText
  return savedAtOf(fileText) >= savedAtOf(lsText) ? fileText : lsText
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
  /* ───────── 存档「本地文件」优先（2026-09-25 船长令：像本地运行一样） ─────────
   * 只影响**网页分支**：桌面端本来就是文件（`window.whale` 走 IPC）。
   * 取舍口径（船长裁定）：文件与浏览器存储都读，**按档内 `savedAtWallMs` 取较新**。 */
  async load(): Promise<string | null> {
    const fileText = await readFromBoundFile().catch(() => null)
    const lsText = ls().getItem(SAVE_KEY)
    return newerSaveText(fileText, lsText)
  },
  async save(data: string): Promise<boolean> {
    // ① 优先写绑定的本地文件（未绑定/权限被收回 ⇒ 返回 null，不算失败）
    const fileRes = await writeToBoundFile(data).catch(() => false)
    if (fileRes === false) noteSaveWriteFailed() // 已绑上却写不进去：让玩家看见（浏览器那份仍会写）
    // ② 浏览器存储（保底）
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
  /**
   * 导入 = 系统文件选择器（桌面浏览器/手机网页都可用），读取 .json 文本返回。
   *
   * ⚠ **2026-09-30 船长转玩家报障修**（手机 UC 浏览器：「**只能导出存档，不能导入**」）——
   * 三条根因都是现场读数（探针挂钩 `HTMLInputElement.prototype.click` 实测）：
   * ① **input 从来没挂进文档**（实测 `isConnected = false` / `parentElement = null`）：桌面 Chromium
   *    肯为游离节点弹选择器，**Android 的 UC / QQ / 微信这类内置内核普遍不肯** ⇒ 玩家点了什么也不发生；
   *    现在挂到 `<body>`（`position:fixed; left:-9999px; 1×1px; opacity:0`）再点，`finish` 时移除。
   * ② **`accept` 太窄**（原 `.json,application/json`）：安卓选择器常按 **MIME** 过滤，而手机保存下来的
   *    存档 MIME 往往是 `application/octet-stream` 或空 ⇒ 文件在选择器里**灰掉**、选不中
   *    ⇒ 末尾补一条通配（星号 斜杠 星号；见下面 `input.accept` 那行）兜底。
   * ③ **取消宽限对手机太短**：2026-09-22 为 Edge/Win10 加的「focus 回来 ＋ 2.1 秒轮询」在手机上不够
   *    （从"文件"App 翻目录、走云盘常超 2 秒；`done` 一旦置位，真 `change` 就被挡掉 ⇒ 选了也白选）
   *    ⇒ **触屏环境放宽到 8 秒**，且**等页面回到可见之后**才开始计时（选择器开着时不该计时）。
   */
  async pickImportSave(): Promise<{ ok: boolean; text?: string; canceled?: boolean; error?: string }> {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      /** 见上②：显式类型 ＋ 末尾通配兜底（手机按 MIME 过滤时不至于把存档灰掉） */
      input.accept = '.json,application/json,text/plain,application/octet-stream,*/*'
      /* 见上①：**必须挂进文档**——"看不见但确实在文档里"（不用 `display:none`：个别内核把 display:none
         的 input 也当不可交互；这组样式既不动布局，也仍可被点击与聚焦） */
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      input.style.top = '0'
      input.style.width = '1px'
      input.style.height = '1px'
      input.style.opacity = '0'
      input.tabIndex = -1
      input.setAttribute('aria-hidden', 'true')
      document.body.appendChild(input)
      let done = false
      let polling = false
      /** 看门狗句柄（见下）：`finish` 里统一清掉，免得收尾后还留着计时器 */
      let watchdog = 0
      /** ⟪2026-10-02⟫ "有没有离开前台"的状态轮询句柄（同上，收尾时清掉） */
      let fgProbe = 0
      const finish = (r: { ok: boolean; text?: string; canceled?: boolean; error?: string }): void => {
        if (done) return
        done = true
        if (watchdog !== 0) window.clearTimeout(watchdog)
        if (fgProbe !== 0) window.clearInterval(fgProbe)
        input.remove()
        window.removeEventListener('focus', onFocusBack)
        window.removeEventListener('blur', onBlur)
        document.removeEventListener('visibilitychange', onVisibleBack)
        document.removeEventListener('visibilitychange', onHiddenAny)
        resolve(r)
      }
      /**
       * **读一个已选中的文件**（`change` 与"轮询接手"两条路共用）。
       * `finish` 自身幂等（`done`）⇒ 两条路先后都到也不会重复读、不会重复 resolve。
       */
      const readPicked = (file: File): void => {
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
      }
      /**
       * 兼容兜底：部分浏览器不派发 `cancel` —— 对话框关闭后（焦点/可见性回来）且仍没选到文件时视为取消。
       * ⚠ **2026-09-22 船长报障修**（玩家 · Win10 · Edge 153：「无法导入存档，导入后没反应」）：原实现是
       * "focus 回来 → 硬等 300ms → 仍没文件就判取消"，而 `finish` 一旦调用就**永久锁定**（`done = true`）；
       * Edge/Win10 上 `change` 可能晚于 `focus` 几百毫秒（文件被杀软扫描时更明显）⇒ 玩家明明选了文件却
       * 被判成"取消"。修法＝**轮询 ＋ 宽限**。⚠ **2026-09-30 再把宽限按环境分开**（见上③）：触屏 8 秒。
       */
      const graceMs = touchLike() ? 8000 : 2100
      const startPoll = (): void => {
        if (polling || done) return
        polling = true
        let waited = 0
        const poll = (): void => {
          if (done) return
          /**
           * ⚠ ⟪**2026-10-02**⟫ **有文件就自己接手读**（不再"等 `change` 接手"）：
           * 个别内核（**手机 Firefox** 等）选完文件后**不派发 `change`**，而原写法一见 `files` 非空就
           * **停止轮询又不等结果** ⇒ 既不 resolve 也不再重试 ⇒ 界面**永久 busy**，玩家看到的就是
           * 「选了文件、什么都没发生」（对应报障「小米手机 · 火狐浏览器无法导入存档」）。
           */
          const picked = input.files?.[0]
          if (picked !== undefined) {
            readPicked(picked)
            return
          }
          waited += 300
          if (waited >= graceMs) {
            finish({ ok: false, canceled: true })
            return
          }
          setTimeout(poll, 300)
        }
        setTimeout(poll, 300)
      }
      const onFocusBack = (): void => startPoll()
      const onVisibleBack = (): void => {
        if (document.visibilityState === 'visible') startPoll()
      }
      /**
       * **看门狗：选择器压根没弹出来时也要有个交代**（**2026-09-30 补**，起因＝手机 UC 报障
       * 「只能导出不能导入」）——判"取消"原先**只挂在 `focus`/可见性回来**上：选择器真弹了、关掉后
       * 焦点会回来 ✓；可要是**浏览器根本不肯弹**（游离 input 那类问题就是这样），这两个事件一个都不来
       * ⇒ 计时器永远不启动、promise 永远不 resolve、界面一直 busy ⇒ 玩家看到的就是**彻底没动静**。
       *
       * 判据：点下去之后 `WATCHDOG_MS` 内**页面既没失焦也没隐藏**（＝浏览器没为选择器让出前台；
       * 正常弹选择器时窗口必然 blur / 页面必然 hidden）⇒ 判"没弹出来"，按取消返回（界面会给可见提示）。
       * ⚠ **判据取多长见下面的 `WATCHDOG_MS`** —— ⟪2026-10-02⟫ 触屏已由 3.5 秒放宽到 **12 秒**
       * （手机 Firefox 这类内核"选择器确实弹了、页面却不 blur / 不报 hidden"，3.5 秒会被误判成"没弹出来"）。
       */
      const WATCHDOG_MS = touchLike() ? 12000 : 3500
      let leftForeground = false
      const onBlur = (): void => {
        leftForeground = true
      }
      const onHiddenAny = (): void => {
        if (document.visibilityState === 'hidden') leftForeground = true
      }
      watchdog = window.setTimeout(() => {
        if (done || leftForeground) return
        finish({ ok: false, canceled: true })
      }, WATCHDOG_MS)
      /**
       * ⟪**2026-10-02**⟫ **触屏看门狗 3.5 s → 12 s**（原值只适合桌面）：手机 **Firefox** 这类内核
       * 打开选择器时**页面既不 `blur` 也不报 `hidden`**（或报得很慢）⇒ 3.5 秒就被判成"没弹出来"，
       * 而 `finish` 一调用就**永久锁死 `done`** ⇒ 玩家随后选中的文件被**静默丢弃**、
       * 界面回到"什么都没发生"（与「关掉选择器后毫无反应」同一种观感）⇒ 报障「无法导入存档」。
       *
       * 同时补一条**状态轮询**（只读 `document.hidden`，不碰 `hasFocus()`）：
       * 有的内核**改了可见性却不派发 `visibilitychange`**，只靠事件会漏判"已经离开前台"。
       */
      fgProbe = window.setInterval(() => {
        if (document.hidden) leftForeground = true
      }, 300)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onHiddenAny)
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          finish({ ok: false, canceled: true })
          return
        }
        readPicked(file)
      })
      input.addEventListener('cancel', () => finish({ ok: false, canceled: true }))
      window.addEventListener('focus', onFocusBack)
      document.addEventListener('visibilitychange', onVisibleBack)
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
  /**
   * **网页版独有：绑定 / 重连 / 解绑「本地存档文件」**（2026-09-25 船长令）。
   * 桌面端不实现这一组（它本来就是文件存档）⇒ 界面按 `window.whale.saveFile === undefined` 走"本机文件"那支。
   */
  saveFile: {
    status: () => saveFileStatus(),
    /** 绑定：选/建文件后**立刻把当前存档写进去**（否则玩家会以为绑了个空文件） */
    bind: async () => await bindSaveFile(ls().getItem(SAVE_KEY)),
    reconnect: () => reconnectSaveFile(),
    unbind: () => unbindSaveFile(),
  },
}

/** 引擎使用的持久化桥：桌面有 window.whale → IPC；纯浏览器 → localStorage */
export const saveBridge: WhaleApi =
  typeof window !== 'undefined' && window.whale !== undefined ? electronBridge : localStorageBridge
