/** 开发启动冒烟：node tools/electron-dev-smoke.cjs。
 * 使用本工作树Electron和electron-vite dev，隐藏隔离窗口，不读取个人档。
 * 输出tools/_ui-artifacts/electron-dev-smoke/report.json；结束只关闭自有进程并清理临时目录。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/electron-dev-smoke')
const PREFIX = 'whale-electron-dev-'

async function parent() {
  const executable = require('electron')
  await fs.access(executable)
  assert.equal(path.dirname(executable), path.join(ROOT, 'node_modules/electron/dist'))
  await fs.mkdir(OUT, { recursive: true })
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let child, timer
  try {
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_AUTOPERF: '1',
      WHALE_DEV_SMOKE_PROFILE: profile, ELECTRON_ENTRY: __filename }
    for (const key of ['ELECTRON_EXEC_PATH', 'ELECTRON_OVERRIDE_DIST_PATH', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL']) delete env[key]
    child = spawn(process.execPath, [path.join(ROOT, 'node_modules/electron-vite/bin/electron-vite.js'), 'dev'],
      { cwd: path.join(ROOT, 'apps/desktop'), env, windowsHide: true, stdio: 'inherit' })
    console.log(`开发启动工具 PID=${child.pid}；本树运行时=${executable}`)
    timer = setTimeout(() => {
      // 引导脚本将自有Electron PID写在本次唯一临时目录，不能按进程名批量结束。
      fs.readFile(path.join(profile, 'owner.json'), 'utf8').then(text => {
        const owner = JSON.parse(text)
        if (owner.profile === profile && Number.isInteger(owner.pid)) try { process.kill(owner.pid) } catch {}
      }).finally(() => child.kill()).catch(() => {})
    }, 90_000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, '开发启动失败')
    const report = JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.executable, executable)
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill()
      await once(child, 'exit')
    }
    const absolute = path.resolve(profile)
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
    assert(path.basename(absolute).startsWith(PREFIX))
    assert.equal(await fs.realpath(absolute), absolute)
    await fs.rm(absolute, { recursive: true })
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = process.env.WHALE_DEV_SMOKE_PROFILE
  assert(profile && profile === process.env.WHALE_PERF_USERDATA)
  assert.equal((await fs.readdir(profile)).length, 0, '验证目录必须从空目录开始')
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  await fs.writeFile(path.join(profile, 'owner.json'), JSON.stringify({ pid: process.pid, profile }), 'utf8')
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  const errors = []
  const finished = new Promise((resolve, reject) => {
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('render-process-gone', (_e, details) => reject(new Error(JSON.stringify(details))))
      win.webContents.on('did-fail-load', (_e, code, message) => reject(new Error(`${code}: ${message}`)))
      win.webContents.debugger.attach('1.3')
      win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
      win.webContents.debugger.sendCommand('Runtime.enable').catch(reject)
      win.webContents.once('did-finish-load', async () => {
        try {
          let view
          for (let n = 0; n < 100; n++) {
            view = await win.webContents.executeJavaScript(`({root:!!document.querySelector('.app-root'),ipc:typeof window.whale?.load==='function',url:location.href,title:document.title})`)
            if (view.root && view.ipc) break
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          assert(view.root && view.ipc, '游戏界面或预载通信未就绪')
          assert(view.url.startsWith('http://localhost:') || view.url.startsWith('http://127.0.0.1:'))
          const saved = await win.webContents.executeJavaScript('window.whale.load()')
          // 渲染层就绪后可能已自动保存初始状态，不能再要求IPC仍返回null。
          if (saved !== null) {
            const initial = JSON.parse(saved).state
            assert.notEqual(initial.modeChosen, true, '隔离新档不应已有模式进度')
            assert.equal(initial.onboarding.step, 0, '隔离新档不应已有教程进度')
          }
          assert.equal(errors.length, 0, '渲染进程异常')
          const report = { ok: true, executable: process.execPath, electron: process.versions.electron, pid: process.pid,
            target: 'electron-vite dev / apps/desktop', isolatedProfile: app.getPath('userData') === profile,
            hidden: !win.isVisible(), freshProfile: true, ipcLoad: true, initialAutoSaved: saved !== null, ...view, errors }
          await fs.writeFile(path.join(profile, 'report.json'), JSON.stringify(report), 'utf8')
          win.webContents.debugger.detach()
          resolve()
        } catch (error) { reject(error) }
      })
    })
    require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  })
  await finished
  app.exit(0)
}

if (process.versions.electron && process.env.WHALE_DEV_SMOKE_PROFILE) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
