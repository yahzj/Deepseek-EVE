/**
 * 主进程：窗口创建 + 存档文件读写。
 *
 * 存档安全（中文说明）：保存时先写 ".tmp" 再改名覆盖，即使中途断电/崩溃，
 * 原档也完好无损，最多丢一次保存间隔的内容。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** 存档文件名（放在系统用户数据目录，卸载重装游戏也不丢） */
const SAVE_FILE_NAME = 'save.json'

/** 存档完整路径 */
function savePath(): string {
  return join(app.getPath('userData'), SAVE_FILE_NAME)
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
    return true
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
      const backups: Array<{ name: string; size: number; wallMs: number }> = []
      for (const f of names) {
        if (!BACKUP_FILE_RE.test(f)) continue
        try {
          const st = await fs.stat(join(dir, f))
          backups.push({ name: f, size: st.size, wallMs: st.mtimeMs })
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
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: '非法的备份文件名。' }
    try {
      const text = await fs.readFile(join(app.getPath('userData'), name), 'utf8')
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // 恢复：先把当前档自动备份一份（防误操作），再用目标备份原子覆盖
  ipcMain.handle('save:restore', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: '非法的备份文件名。' }
    try {
      const dir = app.getPath('userData')
      await backupCurrentSave() // 自动防误操作
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
    title: '大鲸鱼 · 深空工业',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
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
