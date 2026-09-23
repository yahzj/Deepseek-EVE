/**
 * 主进程：窗口创建 + 存档文件读写。
 *
 * 存档安全（中文说明）：保存时先写 ".tmp" 再改名覆盖，即使中途断电/崩溃，
 * 原档也完好无损，最多丢一次保存间隔的内容。
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { L10N } from '@whale/data'

/* ───────── 主进程本地化（2026-09-20 三号：补上工具扫描盲区） ─────────
 * 口径与渲染层同源：**文案一律从唯一表 `@whale/data` 的 `L10N` 取 id**。
 * 为什么语言要由渲染层推送：语言偏好存在渲染进程的 `localStorage`（`whale-idle:locale`），
 * 主进程读不到 ⇒ 渲染层启动/切语言时 `ipcRenderer.invoke('l10n:set-locale')` 推一次。
 * 时机安全：窗口标题与系统对话框都是**运行期才建**的，推送晚到不影响（启动瞬间默认中文）。
 * ⚠ 主进程的 tsconfig 不含 DOM 类型，这里不引渲染层的 `i18n/locale`（那是 React 模块）。 */
let mainLocale: 'zh' | 'en' = 'zh'

/** 主进程取文案（缺 id ⇒ 返回 id 本身，与渲染层同口径） */
function t(id: string, params?: Record<string, string | number>): string {
  const e = L10N[id]
  const raw = e ? (mainLocale === 'zh' ? e.zh : e.en) : id
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

/** 存档文件名（放在系统用户数据目录，卸载重装游戏也不丢） */
const SAVE_FILE_NAME = 'save.json'

/** 存档完整路径 */
function savePath(): string {
  return join(app.getPath('userData'), SAVE_FILE_NAME)
}

/* ───────── 铁人模式：存档之外的代次账本（2026-09-23 船长令） ───────── */

/**
 * **为什么账本必须放在存档之外**：代次若只写存档，回滚会把代次一起带回（等于没记）。
 * 账本放 `%APPDATA%` 下、**主 + 影子双写**（读时取 max）⇒ 玩家"外面换文件回滚"也能被看见；
 * **重置档案不清账本**（船长：「玩家重置档案并不会清空这个版本号」）。
 * 位置：与 `save.json` 同目录的 `ironman-ledger.json` / `ironman-ledger.bak.json`。
 */
const LEDGER_FILE_NAME = 'ironman-ledger.json'
const LEDGER_SHADOW_NAME = 'ironman-ledger.bak.json'

interface IronmanLedger {
  /** 见过的最高代次 */
  seq: number
  /** 最后一次更新墙钟 */
  updatedAtWallMs: number
  /** 放行过的救援装载次数（只记账，玩家侧不显示——船长令） */
  rescues: number
}

const EMPTY_LEDGER: IronmanLedger = { seq: 0, updatedAtWallMs: 0, rescues: 0 }

function parseLedger(text: string): IronmanLedger | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const seq = typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? Math.max(0, Math.floor(raw.seq)) : 0
    const updatedAtWallMs =
      typeof raw.updatedAtWallMs === 'number' && Number.isFinite(raw.updatedAtWallMs)
        ? Math.max(0, Math.floor(raw.updatedAtWallMs))
        : 0
    const rescues = typeof raw.rescues === 'number' && Number.isFinite(raw.rescues) ? Math.max(0, Math.floor(raw.rescues)) : 0
    return { seq, updatedAtWallMs, rescues }
  } catch {
    return null
  }
}

/** 读账本：主 + 影子各读一次，取 **seq 最大**的那份（影子补"主文件被删/被改"） */
async function readLedger(): Promise<IronmanLedger> {
  const dir = app.getPath('userData')
  const out = { ...EMPTY_LEDGER }
  for (const name of [LEDGER_FILE_NAME, LEDGER_SHADOW_NAME]) {
    try {
      const one = parseLedger(await fs.readFile(join(dir, name), 'utf8'))
      if (!one) continue
      out.seq = Math.max(out.seq, one.seq)
      out.updatedAtWallMs = Math.max(out.updatedAtWallMs, one.updatedAtWallMs)
      out.rescues = Math.max(out.rescues, one.rescues)
    } catch {
      // 缺文件/坏文件 ⇒ 跳过（另一份可能与它互为备份）
    }
  }
  return out
}

/** 写账本（**原子写 + 双写**）：只在"更高代次/更高计数"时才落盘 */
async function writeLedger(next: IronmanLedger): Promise<void> {
  const dir = app.getPath('userData')
  const text = JSON.stringify(next)
  for (const name of [LEDGER_FILE_NAME, LEDGER_SHADOW_NAME]) {
    const file = join(dir, name)
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, text, 'utf8')
    await fs.rename(tmp, file)
  }
}

/** 把账本推到"至少 seq"（落盘一次；相同或更低则不动） */
async function bumpLedger(seq: number, rescue = false): Promise<IronmanLedger> {
  const cur = await readLedger()
  const next: IronmanLedger = {
    seq: Math.max(cur.seq, Math.max(0, Math.floor(seq || 0))),
    updatedAtWallMs: Date.now(),
    rescues: cur.rescues + (rescue ? 1 : 0),
  }
  if (next.seq !== cur.seq || rescue) {
    try {
      await writeLedger(next)
    } catch {
      // 账本写失败不阻断游戏（闸门退化为"只看当前档代次"）
    }
  }
  return next
}

/** 从存档文本里取铁人信息（`{ format, version, savedAtWallMs, state }`） */
function ironmanInfoOfSaveText(text: string): { on: boolean; seq: number; savedAtWallMs: number } | null {
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const savedAtWallMs =
      typeof raw.savedAtWallMs === 'number' && Number.isFinite(raw.savedAtWallMs) ? Math.max(0, Math.floor(raw.savedAtWallMs)) : 0
    const state = (raw.state ?? {}) as Record<string, unknown>
    const im = (state.ironman ?? {}) as Record<string, unknown>
    const seq = typeof im.seq === 'number' && Number.isFinite(im.seq) ? Math.max(0, Math.floor(im.seq)) : 0
    return { on: im.on === true, seq, savedAtWallMs }
  } catch {
    return null
  }
}

/** 读备份文件头 4KB 取"存档自己的保存时刻"（救援判龄用；比文件 mtime 更抗"复制/搬动"） */
async function savedAtOfBackup(name: string): Promise<number> {
  try {
    const fh = await fs.open(join(app.getPath('userData'), name), 'r')
    try {
      const buf = Buffer.alloc(4096)
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
      const head = buf.subarray(0, bytesRead).toString('utf8')
      const m = /"savedAtWallMs"\s*:\s*(\d+)/.exec(head)
      return m ? Math.max(0, Number(m[1])) : 0
    } finally {
      await fh.close()
    }
  } catch {
    return 0
  }
}
/* ───────── 存档备份/恢复（B5） ───────── */

/** 备份文件名时间戳：save-YYYYMMDD-HHmmss(.json)；同秒冲突自动加 -n */
function backupStamp(): string {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 合法备份文件名（同时天然防路径穿越：只允许这个模式） */
const BACKUP_FILE_RE = /^save-\d{8}-\d{6}(-\d+)?\.json$/

/** 把当前存档复制成一份带时间戳的备份；没有存档或失败返回 null */
async function backupCurrentSave(): Promise<string | null> {
  const src = savePath()
  try {
    await fs.access(src)
  } catch {
    return null
  }
  const dir = app.getPath('userData')
  let name = `${backupStamp()}.json`
  for (let i = 1; ; i++) {
    try {
      await fs.access(join(dir, name))
      name = `${backupStamp()}-${i}.json`
    } catch {
      break
    }
  }
  await fs.copyFile(src, join(dir, name))
  return name
}

/** 注册"读档 / 存档 / 备份 / 恢复"界面可调用的能力 */
function registerSaveHandlers(): void {
  // 读档：文件不存在返回 null（表示"没有存档"），其余错误照常抛出
  ipcMain.handle('save:load', async () => {
    try {
      return await fs.readFile(savePath(), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  })

  // 存档：只接受字符串文本且限制大小（防界面被攻破时写入奇怪数据）
  ipcMain.handle('save:save', async (_event, data: unknown) => {
    if (typeof data !== 'string' || data.length > 10 * 1024 * 1024) return false
    const file = savePath()
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, data, 'utf8')
    await fs.rename(tmp, file)
    // 铁人模式：把这份档的代次推到**账本**（只增不减；普通档代次恒 0 ⇒ 账本不动）
    const info = ironmanInfoOfSaveText(data)
    if (info && info.seq > 0) void bumpLedger(info.seq)
    return true
  })

  // 铁人账本只读（渲染层装载前判闸门用；写一律由 save:save 顺带完成）
  ipcMain.handle('ironman:ledger', async () => {
    try {
      const l = await readLedger()
      return { ok: true, seq: l.seq, rescues: l.rescues }
    } catch (err) {
      return { ok: false, seq: 0, rescues: 0, error: String(err) }
    }
  })

  // 救援记账：渲染层判定为"救援装载"后回报一次（只累加计数；**玩家侧不显示**——船长令）
  ipcMain.handle('ironman:note-rescue', async () => {
    try {
      await bumpLedger(0, true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 备份：把当前存档复制成带时间戳的文件
  ipcMain.handle('save:backup', async () => {
    try {
      const name = await backupCurrentSave()
      return { ok: name !== null, name }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 列出所有备份（按时间倒序）
  ipcMain.handle('save:list-backups', async () => {
    try {
      const dir = app.getPath('userData')
      const names = await fs.readdir(dir)
      const backups: Array<{ name: string; size: number; wallMs: number; savedAtWallMs: number }> = []
      for (const f of names) {
        if (!BACKUP_FILE_RE.test(f)) continue
        try {
          const st = await fs.stat(join(dir, f))
          backups.push({ name: f, size: st.size, wallMs: st.mtimeMs, savedAtWallMs: await savedAtOfBackup(f) })
        } catch {
          // 个别文件不可读则跳过
        }
      }
      backups.sort((a, b) => b.wallMs - a.wallMs)
      return { ok: true, backups: backups.slice(0, 30) }
    } catch (err) {
      return { ok: false, error: String(err), backups: [] }
    }
  })

  // 读取某份备份的内容（界面先校验"能解析"再决定恢复）
  ipcMain.handle('save:read-backup', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: t('ui.main.011') }
    try {
      const text = await fs.readFile(join(app.getPath('userData'), name), 'utf8')
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 恢复：用目标备份原子覆盖当前档（⚠ 2026-09-17 船长：「导入或者恢复存档时，不要备份现有存档」
  // ⇒ 这里**不再**自动 `backupCurrentSave()`；要留退路请先手动点「备份当前档」）
  ipcMain.handle('save:restore', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: t('ui.main.011') }
    try {
      const dir = app.getPath('userData')
      const text = await fs.readFile(join(dir, name), 'utf8')
      const file = savePath()
      const tmp = `${file}.tmp`
      await fs.writeFile(tmp, text, 'utf8')
      await fs.rename(tmp, file)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 删除某份备份（2026-09-08 船长定：玩家可清理备份；只删备份文件，不影响当前档）
  ipcMain.handle('save:delete-backup', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: t('ui.main.011') }
    try {
      await fs.unlink(join(app.getPath('userData'), name))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  /* ───────── 导入 / 导出（外部文件；2026-09-08 船长定：桌面系统对话框） ───────── */

  /** 弹出文件选择框 → 读取所选 .json 存档文本（解析/校验由界面层做） */
  ipcMain.handle('save:pick-import', async () => {
    const opts: Electron.OpenDialogOptions = {
      title: t('ui.main.012'),
      buttonLabel: t('ui.main.013'),
      filters: [{ name: t('ui.main.014'), extensions: ['json'] }],
      properties: ['openFile'],
    }
    const win = BrowserWindow.getAllWindows()[0]
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || r.filePaths.length === 0) return { ok: false, canceled: true }
    try {
      const text = await fs.readFile(r.filePaths[0]!, 'utf8')
      if (text.length > 10 * 1024 * 1024) return { ok: false, error: t('ui.main.005') }
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: t('ui.main.006', { p1: String(err) }) }
    }
  })

  /** 弹出保存对话框 → 把存档文本写到用户指定位置（原子写：tmp + 改名） */
  ipcMain.handle('save:export-to-file', async (_event, data: unknown) => {
    if (typeof data !== 'string' || data.length > 10 * 1024 * 1024) {
      return { ok: false, error: t('ui.main.007') }
    }
    const opts: Electron.SaveDialogOptions = {
      title: t('ui.main.008'),
      buttonLabel: t('ui.main.009'),
      defaultPath: join(app.getPath('userData'), `${backupStamp()}.json`),
      filters: [{ name: t('ui.main.014'), extensions: ['json'] }],
    }
    const win = BrowserWindow.getAllWindows()[0]
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, canceled: true }
    try {
      const tmp = `${r.filePath}.tmp`
      await fs.writeFile(tmp, data, 'utf8')
      await fs.rename(tmp, r.filePath)
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: t('ui.main.010', { p1: String(err) }) }
    }
  })

  /** 语言由渲染层推送（偏好存在渲染进程的 localStorage，主进程读不到）。
   *  只收 'zh' | 'en'，其余一律忽略；推送时机见 `i18n/locale.tsx` 的 `L10nProvider`。 */
  ipcMain.handle('l10n:set-locale', (_event, locale: unknown) => {
    if (locale === 'zh' || locale === 'en') mainLocale = locale
    return true
  })
}

/** 创建主窗口 */
function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    show: false, // 等页面就绪再显示，避免白屏闪烁
    autoHideMenuBar: true,
    backgroundColor: '#05080d',
    // 窗口标题 = 游戏名（2026-09-11 船长：「将游戏的名称改为大鲸鱼-深空放置」）
    title: t('ui.App.056'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      // 性能自动采集（诊断工具）：窗口无交互桌面/被遮挡时 Chromium 会节流定时器到 1/分钟，
      // 使测量失真——自动跑分时关闭节流
      backgroundThrottling: !process.env.WHALE_AUTOPERF,
    },
  })

  win.on('ready-to-show', () => win.show())
  // 界面里任何"开新窗口/外链"请求一律拒绝
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 开发工具：无菜单栏（autoHideMenuBar）时默认 F12 快捷键不生效，这里手动注册开关 DevTools
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'f12') {
      win.webContents.toggleDevTools()
    }
  })

  // 开发模式加载 Vite 本地服务（支持热更新）；生产模式加载打包产物
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.setName('whale-idle')

// 性能自动采集（2026-09-08 诊断工具）：把存档目录隔离到临时目录，绝不碰真实存档
if (process.env.WHALE_PERF_USERDATA) {
  app.setPath('userData', process.env.WHALE_PERF_USERDATA)
}
// 自动跑分时关闭 Chromium 的后台/遮挡节流（见 createWindow），保证定时器与渲染按真实节奏跑
if (process.env.WHALE_AUTOPERF) {
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

app.whenReady().then(() => {
  registerSaveHandlers()
  createWindow()

  // macOS 惯例：点 Dock 图标且没有窗口时重新开窗
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 除 macOS 外，关掉所有窗口即退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
