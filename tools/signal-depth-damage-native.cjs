/** 重复战损真实桌面检查：构建后node tools/signal-depth-damage-native.cjs。
 * 隔离合成档；经典中文桌面、现代英文竖屏；只验证DOM/真实输入/存盘，不作观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { injectShipRecoveryTestState } = require('./ship-recovery-test-fixture.ts')
const ROOT = path.resolve(__dirname, '..')
const PREFIX = 'whale-depth-damage-'
const OUT = path.join(ROOT, 'tools/_ui-artifacts/signal-depth-damage-20261019')
const damage = Array.from({ length: 24 }, (_, i) => i % 3 === 0 ? 'cargo' : 'range')
if (!process.argv.includes('--child')) {
  fs.mkdirSync(OUT, { recursive: true })
  for (const options of [{ layout: 'classic', locale: 'zh', mobile: false }, { layout: 'modern', locale: 'en', mobile: true }]) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
      injectShipRecoveryTestState(state)
      state.weekendEvent = undefined
      state.standings.dsi = 0
      state.standingsEarned = { dsi: 0 }
      state.commsPopups = []
      state.pendingDialogue = null
      const ship = Object.values(state.fleet).find(s => s.customName === '战损演示舰')
      ship.damagePlugs = damage
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, WH_DAMAGE_CASE: JSON.stringify(options) }
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
      const run = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true, env, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(Object.values(saved.fleet).find(s => s.customName === '战损演示舰').damagePlugs, damage)
    } finally {
      const target = path.resolve(profile)
      assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(PREFIX))
      fs.rmSync(target, { recursive: true, force: true })
    }
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1366, 768)
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    const errors = []
    win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
    const options = JSON.parse(process.env.WH_DAMAGE_CASE)
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: options.mobile })
    await page.send('Runtime.enable')
    await page.wait('!!document.querySelector(".app-root")')
    await page.js(`(()=>{localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)});localStorage.setItem('whale-idle:debug','0')})()`)
    if (options.mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    const navigate = async () => {
      await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")'); await sleep(500)
      await page.text('.app-nav-side', data.L10N['ui.App.002'][options.locale])
      await page.js(`(()=>{const e=[...document.querySelectorAll('.app-ship-card.is-fleet')].find(e=>e.textContent.includes('战损演示舰'));if(!e)throw Error('缺少测试舰');e.setAttribute('data-stack-test','1');[...e.querySelectorAll('[data-ship-damage]')].forEach((card,i)=>card.setAttribute('data-stack-index',String(i)));return true})()`)
      assert.equal(await page.js('document.querySelectorAll("[data-stack-test] [data-ship-damage]").length'), damage.length)
      assert(await page.js('[...document.querySelectorAll("[data-stack-test] [data-ship-damage]")].every(e=>e.textContent.includes("-5%"))'))
    }
    await navigate()
    for (const index of [0, 1, damage.length - 1]) {
      await page.js(`document.querySelector('[data-stack-index="${index}"]').scrollIntoView({block:'center'});true`)
      await sleep(350)
      await page.tap(`[data-stack-index="${index}"]`)
      await page.wait('!!document.querySelector(".app-ship-damage-modal")')
      assert.equal(await page.js('document.querySelectorAll("[data-stack-test] [aria-expanded=true]").length'), 1)
      assert(await page.js('document.querySelector(".app-ship-damage-modal").textContent.includes("5%")'))
      await page.tap('.app-ship-damage-modal .app-modal-head button')
      await page.wait('!document.querySelector(".app-ship-damage-modal")')
    }
    await page.js('window.dispatchEvent(new Event("pagehide"));true'); await sleep(500)
    await navigate()
    assert.equal(errors.length, 0, JSON.stringify(errors))
    const report = { ...options, pid: process.pid, cards: damage.length, reload: true, reachableLastCard: true, errors: 0 }
    fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}.json`), JSON.stringify(report, null, 2), 'utf8')
    console.log(JSON.stringify(report))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
