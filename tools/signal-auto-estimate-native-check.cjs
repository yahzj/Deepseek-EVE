/** 最新桌面产物离线返航冒烟；仅独立合成档和自有进程。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const ROOT = path.resolve(__dirname, '..')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const { signalAutoFixture } = require('./signal-auto-estimate-fixture.ts')
  const { wormholeAutoStart } = require('../packages/core/src/wormholeAuto.ts')
  const { serializeSaveFile } = require('../packages/core/src/save.ts')
  const { state, ctx, roster } = signalAutoFixture('mixed', true)
  // 只隔离无关的被动母矿产线，仓库增量必须完全来自本趟探索。
  state.research.levels['mt-industry-void-drip'] = 0
  assert(wormholeAutoStart(state, ctx, state.wormholeStock[0].id, roster).ok)
  const expected = { estimate: state.wormholeAuto[0].estimate, warehouse: structuredClone(state.warehouse.items), cores: structuredClone(state.aiCores) }
  state.savedAtWallMs = Date.now() - 360000
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-signal-estimate-'))
  const out = path.join(ROOT, 'tools/_ui-artifacts', `signal-auto-native-${Date.now()}`)
  await fs.mkdir(out)
  await fs.writeFile(path.join(out, 'expected.json'), JSON.stringify(expected), 'utf8')
  await fs.writeFile(path.join(profile, 'save.json'), serializeSaveFile(state, state.savedAtWallMs), 'utf8')
  const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_SIGNAL_CHECK_OUT: out }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'WHALE_AUTOPERF']) delete env[key]
  const child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
  console.log(`信号自动估算桌面核验，自有PID=${child.pid}`)
  const timer = setTimeout(() => child.kill(), 90000)
  try { const [code] = await once(child, 'exit'); assert.equal(code, 0) }
  finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith('whale-signal-estimate-'))
    assert.equal(await fs.realpath(profile), profile)
    await fs.rm(profile, { recursive: true })
  }
  console.log(JSON.stringify({ output: out }))
}

async function child() {
  const electron = require('electron'), { app, BrowserWindow } = electron
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  const out = path.resolve(process.env.WHALE_SIGNAL_CHECK_OUT)
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith('whale-signal-estimate-'))
  assert.equal(path.dirname(out), path.join(ROOT, 'tools/_ui-artifacts'))
  app.setPath('userData', profile); app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  class Hidden extends BrowserWindow {
    constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }) }
  }
  const Module = require('node:module'), original = Module._load
  Module._load = function (request, parent, isMain) {
    return request === 'electron' ? new Proxy(electron, { get: (target, key) => key === 'BrowserWindow' ? Hidden : target[key] }) : original.call(this, request, parent, isMain)
  }
  const errors = []
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
    win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) errors.push(text) })
    win.webContents.once('did-finish-load', () => resolve(win))
  }))
  try { require(path.join(ROOT, 'apps/desktop/out/main/index.js')) } finally { Module._load = original }
  const win = await ready, js = code => win.webContents.executeJavaScript(code)
  for (let i = 0; i < 120 && !await js('!!document.querySelector(".app-report-card")'); i++) await sleep(100)
  assert(await js('!!document.querySelector(".app-report-card")'), '未出现离线简报')
  const expected = JSON.parse(await fs.readFile(path.join(out, 'expected.json'), 'utf8'))
  let saved
  for (let i = 0; i < 120; i++) {
    saved = JSON.parse(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state
    if (saved.wormholeAutoReports?.length === 1 && saved.wormholeAuto?.length === 0) break
    await sleep(500)
  }
  assert.equal(saved.wormholeAutoReports.length, 1)
  assert.equal(saved.wormholeAuto.length, 0)
  const report = saved.wormholeAutoReports[0]
  await fs.writeFile(path.join(out, 'settled-state.json'), JSON.stringify(saved), 'utf8')
  assert.deepEqual(report.gains, expected.estimate.gains)
  assert.equal(report.depth, expected.estimate.depthReached)
  assert.deepEqual(report.cores ?? [], expected.estimate.cores)
  for (const gain of report.gains) assert.equal(saved.warehouse.items[gain.itemId], (expected.warehouse[gain.itemId] ?? 0) + gain.units)
  for (const type of ['gamma', 'beta', 'alpha']) {
    const gained = expected.estimate.cores.filter(core => core.type === type).reduce((sum, core) => sum + core.n, 0)
    assert.equal(saved.aiCores[type], expected.cores[type] + gained)
  }
  assert.equal(saved.wormhole.run, null)
  assert.equal(saved.encounter.active, false)
  await fs.writeFile(path.join(out, 'offline-return.png'), (await win.webContents.capturePage()).toPNG())
  assert.equal(errors.length, 0, errors.join('\n'))
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ ok: true, target: 'd2-production-hidden-isolated', hidden: !win.isVisible(),
    depth: report.depth, gains: report.gains, cores: report.cores ?? [], tasksRemaining: saved.wormholeAuto.length, errors,
    limitation: '独立合成任务回拨保存时间以触发真实离线入口，只验证生产客户端结算和存盘，不代表观感或整体经济验收。' }, null, 2), 'utf8')
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
