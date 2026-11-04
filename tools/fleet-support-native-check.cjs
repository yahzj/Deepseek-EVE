/** 最新生产产物、隐藏Electron、独立合成档；只核验自建目录和自有PID。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/fleet-support-final-20261101')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const { fleetSupportFixture } = require('./fleet-support-fixture.ts')
  const { serializeSaveFile, loadSaveFile } = require('../packages/core/src/save.ts')
  const { startHauling } = require('../packages/core/src/hauling.ts')
  const { spawnIndustrialEncounter } = require('../packages/core/src/encounters/industrial.ts')
  const { state, ctx } = fleetSupportFixture()
  assert(startHauling(state, null, 'site-cinder', ctx, 100).ok)
  assert(spawnIndustrialEncounter(state, ctx, { galaxyId: 'galaxy-cinder', shipId: state.shipId, kind: '停留' }))
  // 只在隔离界面夹具预置已胜状态，核验离线收口和简报；不据此声称战斗胜率。
  state.encounter.battle.ended = 'me'
  state.hauling.fleetLeg.stopAtArrival = true
  state.savedAtWallMs = Date.now() - 180000
  const text = serializeSaveFile(state, state.savedAtWallMs)
  assert(loadSaveFile(text).state.encounter.battle)
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-support-'))
  await fs.mkdir(OUT, { recursive: true })
  await fs.writeFile(path.join(profile, 'save.json'), text, 'utf8')
  const env = { ...process.env, WHALE_PERF_USERDATA: profile }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'WHALE_AUTOPERF']) delete env[key]
  const child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
  console.log(`编队支援桌面核验，自有PID=${child.pid}`)
  const timer = setTimeout(() => child.kill(), 90000)
  try { const [code] = await once(child, 'exit'); assert.equal(code, 0) }
  finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith('whale-support-'))
    assert.equal(await fs.realpath(profile), profile)
    await fs.rm(profile, { recursive: true })
  }
}

async function child() {
  const electron = require('electron')
  const { app, BrowserWindow } = electron
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith('whale-support-'))
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
  const win = await ready
  win.setMinimumSize(200, 200)
  const js = code => win.webContents.executeJavaScript(code)
  for (let i = 0; i < 120 && !await js('!!document.querySelector(".app-report-card")'); i++) await sleep(100)
  const text = await js('document.querySelector(".app-report-card")?.textContent ?? ""')
  assert.match(text, /遇袭1次.*击退1次/)
  assert.match(text, /弹药0发、修理组件0个/)
  assert.match(text, /运输交付0段/)
  assert.match(text, /运输状态：运输中/)
  assert(!/录像|逐场回看|回放/.test(text))
  const geometry = []
  for (const [width, height] of [[1540, 940], [1100, 900], [760, 700]]) {
    win.setContentSize(width, height)
    await sleep(300)
    const row = await js(`(() => {const el=document.querySelector('.app-report-card'),r=el.getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:el.clientWidth,scroll:el.scrollWidth}})()`)
    assert(row.left >= -1 && row.right <= row.width + 1 && row.bottom <= row.height + 1 && row.scroll <= row.client + 1, JSON.stringify(row))
    geometry.push(row)
    await fs.writeFile(path.join(OUT, `brief-${width}.png`), (await win.webContents.capturePage()).toPNG())
  }
  await js('document.querySelector(".app-report-head button").click()')
  assert.equal(await js('!!document.querySelector(".app-report-card")'), false)
  const saved = JSON.parse(await fs.readFile(path.join(profile, 'save.json'), 'utf8'))
  assert.equal(saved.state.hauling.active, true)
  assert.equal(saved.state.encounter.active, false)
  assert(!Object.hasOwn(saved.state, 'combatLines'))
  assert.equal(errors.length, 0, errors.join('\n'))
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, target: 'd2-production-hidden-isolated', hidden: !win.isVisible(), text, geometry, errors,
    limitation: '合成已胜场景仅验证离线收口、统计接线及桌面几何，不代表胜率、实体手机或观感验收。' }, null, 2), 'utf8')
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
