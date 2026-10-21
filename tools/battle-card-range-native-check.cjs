/** 按卡距离原生操作检查：先npm run build，再node tools/battle-card-range-native-check.cjs。
 * 独立合成档、隐藏Electron、临时userData，取消/改距确认及IPC重载；不读取个人档。
 * v0.1.0 / 存档v31 / 2026-10-21。 */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const { injectBattleCardRangeFixture } = require('./battle-card-range-fixture.ts')
const root = path.resolve(__dirname, '..'), prefix = 'whale-battle-range-'
const output = path.join(root, 'tools/_ui-artifacts/battle-card-range')
if (!process.argv.includes('--child')) {
  fs.mkdirSync(output, { recursive: true })
  const reports = []
  for (const locale of ['zh', 'en']) for (const action of ['cancel', 'confirm']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    try {
      const state = core.createInitialState({ nowWallMs: Date.now() })
      injectBattleCardRangeFixture(state)
      const initial = structuredClone(state)
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now() + 120000), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, BATTLE_RANGE_LOCALE: locale, BATTLE_RANGE_ACTION: action }
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
      const electron = process.argv.find(arg => arg.startsWith('--electron='))?.slice(11) ?? require('electron')
      const run = spawnSync(electron, [__filename, '--child'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.equal(saved.pendingBattleRange, undefined)
      if (action === 'cancel') {
        assert.equal(saved.expedition.battle, null)
        assert.deepEqual(saved.battleRangeByCard, initial.battleRangeByCard)
        assert.equal(saved.warehouse.items['ammo-plasma-l'], initial.warehouse.items['ammo-plasma-l'])
      } else {
        assert.equal(saved.battleRangeByCard['ink-harass'].desireM, 1700)
        assert.equal(saved.battleRangeByCard['ink-harass'].maxRangeM, initial.pendingBattleRange.maxRangeM)
      }
      reports.push({ locale, action, IPCSaved: true, reload: true })
    } finally {
      const target = path.resolve(profile)
      assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(prefix))
      fs.rmSync(target, { recursive: true, force: true })
    }
  }
  fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify({ ok: true, reports }, null, 2), 'utf8')
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0], locale = process.env.BATTLE_RANGE_LOCALE, action = process.env.BATTLE_RANGE_ACTION, mobile = locale === 'en'
    win.setContentSize(1366, 768)
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
    const errors = []
    win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:layout',${JSON.stringify(mobile ? 'modern' : 'classic')});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})` })
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, screenWidth: 390, screenHeight: 740, screenOrientation: { type: 'portraitPrimary', angle: 0 }, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    await page.send('Page.reload')
    await page.wait('!!document.querySelector("[aria-labelledby=battle-range-title]")')
    const bounds = await page.js(`(()=>{const e=document.querySelector('[aria-labelledby=battle-range-title]');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,overflow:e.scrollWidth>e.clientWidth+1}})()`)
    assert(bounds.x >= -1 && bounds.y >= -1 && bounds.right <= bounds.w + 1 && bounds.bottom <= bounds.h + 1 && !bounds.overflow, JSON.stringify(bounds))
    assert.equal(await page.js('document.querySelector("[aria-labelledby=battle-range-title] input").value'), '2500')
    assert.equal(await page.js('document.activeElement?.textContent'), data.L10N['ui.blackMarket.011'][locale])
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, `${locale}-${action}.png`), Buffer.from(screenshot.data, 'base64'))
    if (action === 'confirm') {
      await page.number('[aria-labelledby=battle-range-title] input', 1700)
      await page.text('[aria-labelledby=battle-range-title]', data.L10N['ui.whExpedition.103'][locale])
    } else await page.text('[aria-labelledby=battle-range-title]', data.L10N['ui.blackMarket.011'][locale])
    await page.wait('!document.querySelector("[aria-labelledby=battle-range-title]")')
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(600)
    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await sleep(300)
    assert.equal(await page.js('!!document.querySelector("[aria-labelledby=battle-range-title]")'), false)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ locale, action, mobile, bounds: true, focus: true, runtimeErrors: 0, pid: process.pid }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
