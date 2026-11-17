import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron'
import { spawn } from 'node:child_process'
import { constants, existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { L10N, l10nEntryText } from '@whale/data'
import { createSaveQueue } from '../shared/saveQueue'
import { atomicSaveWrite } from './atomicSaveWrite'

const saveOperations = createSaveQueue()

let mainLocale: 'zh' | 'en' = 'zh'

function t(id: string, params?: Record<string, string | number>): string {
  const e = L10N[id]
  const raw = e ? l10nEntryText(e, mainLocale) : id
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m))
}

const SAVE_FILE_NAME = 'save.json'

function savePath(): string {
  return join(app.getPath('userData'), SAVE_FILE_NAME)
}

import { ironmanLedgerStore, ironmanInfoOfSaveText as readIronmanInfoOfSaveText } from './ironmanLedger'

const ledger = ironmanLedgerStore(() => app.getPath('userData'))
const ironmanInfoOfSaveText = readIronmanInfoOfSaveText


function backupStamp(): string {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `save-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const BACKUP_FILE_RE = /^save-\d{8}-\d{6}(-\d+)?\.json$/

async function backupCurrentSave(snapshot?: string): Promise<string | null> {
  const src = savePath()
  if (snapshot === undefined) {
    try {
      await fs.access(src)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
  const dir = app.getPath('userData')
  const stamp = backupStamp()
  for (let i = 0; ; i++) {
    const name = `${stamp}${i === 0 ? '' : `-${i}`}.json`
    try {
      if (snapshot === undefined) await fs.copyFile(src, join(dir, name), constants.COPYFILE_EXCL)
      else await atomicSaveWrite(join(dir, name), snapshot, true)
      return name
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
  }
}

function registerSaveHandlers(): void {
  ipcMain.handle('save:load', () => saveOperations(async () => {
    try {
      return await fs.readFile(savePath(), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }))

  ipcMain.handle('save:save', async (_event, data: unknown) => {
    if (typeof data !== 'string' || data.length > 10 * 1024 * 1024) return false
    return saveOperations(async () => {
      await atomicSaveWrite(savePath(), data)
      const info = ironmanInfoOfSaveText(data)
      if (info && info.seq > 0) await ledger.bumpLedger(info.seq)
      return true
    })
  })

  ipcMain.handle('ironman:ledger', () => saveOperations(async () => {
    try {
      const l = await ledger.readLedger()
      return { ok: true, seq: l.seq, rescues: l.rescues }
    } catch (err) {
      return { ok: false, seq: 0, rescues: 0, error: String(err) }
    }
  }))

  ipcMain.handle('ironman:note-rescue', () => saveOperations(async () => {
    try {
      await ledger.bumpLedger(0, true)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  }))

  ipcMain.handle('save:backup', async (_event, snapshot: unknown) => {
    if (snapshot !== undefined && (typeof snapshot !== 'string' || snapshot.length > 10 * 1024 * 1024)) {
      return { ok: false, error: t('ui.main.007') }
    }
    try {
      const name = await saveOperations(() => backupCurrentSave(snapshot))
      return { ok: name !== null, name }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('save:list-backups', () => saveOperations(async () => {
    try {
      const dir = app.getPath('userData')
      const names = await fs.readdir(dir)
      const backups: Array<{ name: string; size: number; wallMs: number; savedAtWallMs: number }> = []
      for (const f of names) {
        if (!BACKUP_FILE_RE.test(f)) continue
        try {
          const st = await fs.stat(join(dir, f))
          backups.push({ name: f, size: st.size, wallMs: st.mtimeMs, savedAtWallMs: await ledger.savedAtOfBackup(f) })
        } catch {
        }
      }
      backups.sort((a, b) => b.wallMs - a.wallMs)
      return { ok: true, backups: backups.slice(0, 30) }
    } catch (err) {
      return { ok: false, error: String(err), backups: [] }
    }
  }))

  ipcMain.handle('save:read-backup', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: t('ui.main.011') }
    return saveOperations(async () => {
      try {
        const text = await fs.readFile(join(app.getPath('userData'), name), 'utf8')
        return { ok: true, text }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
  })

  ipcMain.handle('save:restore', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: t('ui.main.011') }
    return saveOperations(async () => {
      try {
        const text = await fs.readFile(join(app.getPath('userData'), name), 'utf8')
        await atomicSaveWrite(savePath(), text)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
  })

  ipcMain.handle('save:delete-backup', async (_event, name: unknown) => {
    if (typeof name !== 'string' || !BACKUP_FILE_RE.test(name)) return { ok: false, error: t('ui.main.011') }
    return saveOperations(async () => {
      try {
        await fs.unlink(join(app.getPath('userData'), name))
        return { ok: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    })
  })


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
      const file = r.filePath
      await saveOperations(() => atomicSaveWrite(file, data))
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: t('ui.main.010', { p1: String(err) }) }
    }
  })

  ipcMain.handle('l10n:set-locale', (_event, locale: unknown) => {
    if (locale === 'zh' || locale === 'en') mainLocale = locale
    return true
  })
}


function findRepoRoot(): string | null {
  let dir = app.getAppPath()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'tools/audio-install.ts')) && existsSync(join(dir, 'package.json'))) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

interface InstallerResult {
  readonly ok: boolean
  readonly code: number | null
  readonly output: string
}

function runSfxInstaller(packPath: string, dryRun: boolean): Promise<InstallerResult> {
  return new Promise((resolve) => {
    const root = findRepoRoot()
    if (root === null) {
      resolve({ ok: false, code: null, output: '找不到仓库根（缺少 tools/audio-install.ts）：请在仓库里运行桌面开发版' })
      return
    }
    const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    if (!existsSync(tsxCli)) {
      resolve({ ok: false, code: null, output: `找不到 tsx：${tsxCli}（先在仓库根 npm install）` })
      return
    }
    const args = [tsxCli, join(root, 'tools', 'audio-install.ts'), packPath, '--json']
    if (dryRun) args.push('--dry-run')
    let output = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (code: number | null, extra = ''): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve({ ok: code === 0, code, output: (output + extra).slice(0, 20_000) })
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.platform === 'win32' ? 'node.exe' : 'node', args, { cwd: root, windowsHide: true })
    } catch (err) {
      finish(null, `\n启动安装器失败：${err instanceof Error ? err.message : String(err)}`)
      return
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      output += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output += String(chunk)
    })
    child.on('error', (err) => finish(null, `\n启动安装器失败：${err.message}`))
    child.on('close', (code) => finish(code))
    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
      }
      finish(null, '\n安装器超时（30 秒）')
    }, 30_000)
  })
}

function registerAudioHandlers(): void {
  ipcMain.handle('audio:install-pack', async (_event, pack: unknown, options: unknown) => {
    const dryRun = typeof options === 'object' && options !== null && (options as { dryRun?: unknown }).dryRun === true
    let bytes: Uint8Array | null = null
    try {
      if (pack instanceof ArrayBuffer) bytes = new Uint8Array(pack)
      else if (ArrayBuffer.isView(pack)) bytes = new Uint8Array(pack.buffer, pack.byteOffset, pack.byteLength)
    } catch {
      bytes = null
    }
    if (bytes === null || bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024) {
      return { ok: false, code: null, output: '入库包数据不合法（需 ArrayBuffer，且 1B–64MB）' }
    }
    let tempDir: string | null = null
    try {
      tempDir = await fs.mkdtemp(join(app.getPath('temp'), 'whale-sfx-'))
      const packPath = join(tempDir, 'pack.zip')
      await fs.writeFile(packPath, bytes)
      return await runSfxInstaller(packPath, dryRun)
    } catch (err) {
      return { ok: false, code: null, output: `写入临时入库包失败：${err instanceof Error ? err.message : String(err)}` }
    } finally {
      if (tempDir !== null) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch {
        }
      }
    }
  })
}

function createWindow(): void {
  const { workAreaSize } = screen.getPrimaryDisplay()
  const win = new BrowserWindow({
    width: Math.min(1540, workAreaSize.width),
    height: Math.min(940, workAreaSize.height),
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05080d',
    title: t('ui.App.056'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key.toLowerCase() === 'f12') {
      win.webContents.toggleDevTools()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.setName('whale-idle')

if (process.env.WHALE_PERF_USERDATA) {
  app.setPath('userData', process.env.WHALE_PERF_USERDATA)
}
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

app.whenReady().then(() => {
  registerSaveHandlers()
  registerAudioHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
