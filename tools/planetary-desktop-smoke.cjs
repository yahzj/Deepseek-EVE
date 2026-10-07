/** 星球原型桌面保存冒烟：先npm run build，再node tools/planetary-desktop-smoke.cjs。
 * 隐藏Electron、自建临时userData、合成档；只验证启动与实际保存重载，不评价观感。
 * 版本自检：游戏v0.1.0 · 存档结构v31 · 最后核对2026-10-07 · 最后跑过2026-10-07。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const { injectPlanetaryTestState } = require('./planetary-test-fixture.ts')
const ROOT = path.resolve(__dirname, '..')
const PREFIX = 'whale-planetary-prototype-'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function parent() {
  const built = fs.statSync(path.join(ROOT, 'apps/desktop/out/renderer/index.html')).mtimeMs
  for (const source of ['save.ts', 'state.ts', 'planetSave.ts', 'planetRules.ts', 'planetGrid.ts']) assert(fs.statSync(path.join(ROOT, 'packages/core/src', source)).mtimeMs <= built, `构建过期：${source}`)
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
  try {
    const state = core.createInitialState({ name: '星球保存冒烟', seed: 7, nowWallMs: Date.now() })
    injectPlanetaryTestState(state)
    state.modeChosen = true
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.WHALE_AUTOPERF
    const result = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 60_000 })
    console.log(result.stdout)
    if (result.error) throw result.error
    assert.equal(result.status, 0, result.stderr)
    const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.deepEqual(saved.planetary, state.planetary)
    console.log('星球桌面启动、实际保存和重载通过，临时目录已隔离；玩家入口未新增。')
  } finally {
    const resolved = path.resolve(profile)
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(PREFIX))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win)
  const errors = []
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await win.webContents.debugger.sendCommand('Runtime.enable')
  const evaluate = expression => win.webContents.executeJavaScript(expression)
  for (let i = 0; i < 100; i++) {
    if (await evaluate('!!document.querySelector(".app-root")')) break
    await sleep(100)
  }
  assert(await evaluate('!!document.querySelector(".app-root")'))
  const savedPath = path.join(profile, 'save.json')
  const before = fs.readFileSync(savedPath, 'utf8')
  const original = core.loadSaveFile(before).state.planetary
  await evaluate('window.dispatchEvent(new Event("pagehide")); true')
  for (let i = 0; i < 100 && fs.readFileSync(savedPath, 'utf8') === before; i++) await sleep(100)
  assert.notEqual(fs.readFileSync(savedPath, 'utf8'), before, '实际保存没有落盘')
  assert.deepEqual(core.loadSaveFile(fs.readFileSync(savedPath, 'utf8')).state.planetary, original)
  win.webContents.reload()
  await sleep(1000)
  assert(await evaluate('!!document.querySelector(".app-root")'))
  await evaluate('window.dispatchEvent(new Event("pagehide")); true')
  await sleep(500)
  assert.deepEqual(core.loadSaveFile(fs.readFileSync(savedPath, 'utf8')).state.planetary, original)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log(JSON.stringify({ ok: true, electronPid: process.pid, planets: Object.keys(original.planets).length, errors: errors.length, saveReload: true }))
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else { try { parent() } catch (error) { console.error(error); process.exitCode = 1 } }
