/** 成就域目录整理的桌面产物冒烟。
 * 用法：构建后node tools/achievements-desktop-smoke.cjs。
 * 独立合成档、隐藏窗口、中英切页与真实IPC保存/重载；不读个人档，不作观感验收。
 * 报告：tools/_ui-artifacts/achievements-desktop-smoke.json。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const root = path.resolve(__dirname, '..')
const prefix = 'whale-achievements-smoke-'
const { JourneyPage, settingsScript, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const data = require('../packages/data/src/index.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
  const ctx = data.buildSimContext()
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  core.advanceAchievements(state, ctx.achievements, Date.now())
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  let child
  let timer
  try {
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    delete env.WHALE_AUTOPERF
    child = spawn(require('electron'), [__filename, '--smoke-child'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    console.log('自建成就检查Electron PID', child.pid)
    timer = setTimeout(() => child.kill(), 60000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    for (const id of Object.keys(state.achievements.earned)) assert.deepEqual(saved.achievements.earned[id], state.achievements.earned[id])
    console.log('合成档成就时刻与去重账真实IPC往返一致')
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit')
      child.kill()
      await stopped
    }
    const target = path.resolve(profile)
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(prefix))
    fs.rmSync(target, { recursive: true, force: true })
  }
}

async function child() {
  require('tsx/cjs')
  const data = require('../packages/data/src/index.ts')
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(prefix))
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win)
  win.setContentSize(1366, 768)
  win.webContents.debugger.attach('1.3')
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable')
  await page.wait('!!document.querySelector(".app-root")')
  const results = []
  for (const locale of ['zh', 'en']) {
    await page.js(settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { locale, debug: false, test: false }))
    await win.webContents.reload()
    await page.wait('!!document.querySelector(".app-root")')
    await dismissOverlays(page)
    await page.text('.app-nav-side', data.L10N['ui.App.119'][locale])
    await page.wait('document.querySelectorAll(".app-ach-badge").length===81')
    const reading = await page.js(`({ total:document.querySelectorAll('.app-ach-badge').length, earned:document.querySelectorAll('.app-ach-badge.is-earned').length, names:[...document.querySelectorAll('.app-ach-name')].map(node=>node.textContent), title:document.querySelector('.page-stack .wui-panel-title')?.textContent })`)
    assert.equal(reading.total, 81)
    assert(reading.earned >= 13)
    assert.equal(reading.title, data.L10N['ui.Achievements.004'][locale])
    assert.deepEqual(reading.names, data.buildSimContext(locale).achievements.filter(def => !def.hidden).map(def => def.name))
    results.push({ locale, total: reading.total, earned: reading.earned })
  }
  const file = path.join(profile, 'save.json')
  const before = JSON.parse(fs.readFileSync(file, 'utf8')).savedAtWallMs
  await page.js('window.dispatchEvent(new Event("pagehide"));true')
  for (let n = 0; n < 50 && JSON.parse(fs.readFileSync(file, 'utf8')).savedAtWallMs <= before; n++) await sleep(100)
  assert(JSON.parse(fs.readFileSync(file, 'utf8')).savedAtWallMs > before, '未确认真实IPC保存')
  assert.equal(errors.length, 0)
  const report = { ok: true, target: 'desktop-production', syntheticOnly: true, hidden: true, results, IPCSaved: true, runtimeErrors: errors.length }
  fs.mkdirSync(path.join(root, 'tools/_ui-artifacts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools/_ui-artifacts/achievements-desktop-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  app.exit(0)
}

if (process.argv.includes('--smoke-child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
