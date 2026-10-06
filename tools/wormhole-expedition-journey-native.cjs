/** 原生Electron真实虫洞1至10层UI旅程；2026-10-06，游戏v0.1.0 / 档v31。
 * 用法：npm run build，然后node tools/wormhole-expedition-journey-native.cjs。
 * 固定fixture.before，自建隐藏窗口/localhost入口/临时WHALE_PERF_USERDATA；真实IPC保存。
 * 输出tools/_ui-artifacts/wormhole-expedition-journey-native.json及截图，退出仅自建PID。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const {
  ROOT, sleep, dependencies, createFixture, settingsScript,
  JourneyPage, runJourney, staticServer, stopOwned, removeProfile,
} = require('./wormhole-expedition-journey-shared.cjs')

async function parent() {
  const input = createFixture()
  const prefix = 'whale-whexpedition-journey-native-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const { server, url } = await staticServer(path.join(ROOT, 'apps', 'desktop', 'out', 'renderer'), { initialize: settingsScript(input.announcement) })
  let electron
  let timer
  try {
    await fs.writeFile(path.join(profile, 'save.json'), input.initialSave, 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: url }
    delete env.WHALE_AUTOPERF
    delete env.ELECTRON_RUN_AS_NODE
    electron = spawn(require('electron'), [__filename, '--journey-child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
    console.log(`自建Electron PID ${electron.pid};隔离入口 ${url}`)
    timer = setTimeout(() => { console.error('原生真实旅程超时'); electron.kill() }, 20 * 60_000)
    const [code] = await once(electron, 'exit')
    assert.equal(code, 0, '原生UI旅程失败')
    const { core } = dependencies()
    const saved = core.loadSaveFile(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(saved.wormhole.run, null)
    assert.equal(saved.wormhole.lastSettle?.kind, 'extract')
    assert.equal(saved.wormhole.lastSettle?.depth, 10)
    console.log(JSON.stringify({ nativeIPC: true, finalSaved: true, ownedPid: electron.pid }))
  } finally {
    clearTimeout(timer)
    await stopOwned(electron)
    await new Promise(resolve => server.close(resolve))
    await removeProfile(profile, prefix)
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('whale-whexpedition-journey-native-'), '原生userData必须是本工具隔离目录')
  assert(new URL(process.env.ELECTRON_RENDERER_URL).hostname === '127.0.0.1', '原生测试入口必须localhost')
  BrowserWindow.prototype.show = function () {}
  const errors = []
  require(path.join(ROOT, 'apps', 'desktop', 'out', 'main', 'index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win, '原生窗口未创建')
  win.setContentSize(1366, 768)
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params)
  })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  const input = createFixture()
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.wait('!!document.querySelector(".app-root")')
  await page.js(settingsScript(input.announcement))
  await page.reload()
  const { core } = dependencies()
  await runJourney(page, input, {
    target: 'native', pid: process.pid, errors,
    verifySaved: async state => {
      const expected = core.loadSaveFile(core.serializeSaveFile(state, 0)).state
      let mismatch
      for (let attempt = 0; attempt < 100; attempt++) {
        const raw = await fs.readFile(path.join(profile, 'save.json'), 'utf8')
        const saved = core.loadSaveFile(raw).state
        try {
          assert.deepEqual(saved.wormhole.run, expected.wormhole.run)
          assert.deepEqual(saved.wormhole.lastSettle, expected.wormhole.lastSettle)
          return
        } catch (error) { mismatch = error.message }
        await sleep(50)
      }
      throw new Error(`真实IPC未保存本次远征账:${mismatch}`)
    },
  })
  win.webContents.debugger.detach()
  app.quit()
}

if (process.argv.includes('--journey-child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
