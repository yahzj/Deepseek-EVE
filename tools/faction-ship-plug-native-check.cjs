/** 五件势力船插原生冒烟；先构建，再node tools/faction-ship-plug-native-check.cjs。
 * 独立合成档、隐藏Electron、中文桌面/英文手机仿真，真实富卡与IPC重载，不作观感验收。v31/2026-10-19。
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const { injectFactionShipPlugFixture, FACTION_PLUG_IDS } = require('./faction-ship-plug-fixture.ts')
const root = path.resolve(__dirname, '..'), prefix = 'whale-faction-plugs-'
if (!process.argv.includes('--child')) {
  for (const locale of ['zh', 'en']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    try {
      const state = core.createInitialState({ nowWallMs: Date.now() })
      injectFactionShipPlugFixture(state)
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, FACTION_PLUG_LOCALE: locale }
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
      const run = spawnSync(require('electron'), [__filename, '--child'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(saved.fleet[state.shipId].plugs, [...FACTION_PLUG_IDS])
    } finally {
      const target = path.resolve(profile)
      assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(prefix))
      fs.rmSync(target, { recursive: true, force: true })
    }
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0], locale = process.env.FACTION_PLUG_LOCALE, mobile = locale === 'en'
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
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    await sleep(500)
    if (mobile) await page.text('.app-nav-side', data.L10N['ui.App.003'][locale])
    else await page.tap('[data-nav-page="fit"]')
    await page.wait('document.querySelectorAll(".app-fit-plugslots .is-filled").length===5')
    const ctx = data.buildSimContext(locale), cards = {}
    for (const id of [...FACTION_PLUG_IDS, 'mod-drone-deck-1']) {
      const name = ctx.modules.get(id).name
      const point = await page.js(`(()=>{const e=[...document.querySelectorAll('.app-fit-slot-icon.is-filled')].find(e=>e.querySelector('.app-fit-slot-icon-name')?.textContent===${JSON.stringify(name)});if(!e)throw Error('缺少测试件');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await page.wait(`document.querySelector('.app-tip')?.textContent.includes(${JSON.stringify(name)})`)
      cards[id] = await page.js('document.querySelector(".app-tip").textContent')
      assert(!/ui\.factionPlug|\{(?:p1|hp|damage|deck)\}/.test(cards[id]))
      if (FACTION_PLUG_IDS.includes(id) && id !== 'plug-titan-compression') assert(cards[id].includes(data.L10N['ui.factionPlug.007'][locale]))
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }); await sleep(80)
    }
    assert(cards['plug-titan-compression'].includes('120') && cards['plug-titan-compression'].includes('25%'))
    assert(cards['plug-deadarmy-printing'].includes('40%') && cards['plug-deadarmy-printing'].includes('25%'))
    assert(cards['plug-gravekeeper-capacitor'].includes('50%'))
    assert(cards['mod-drone-deck-1'].includes('8.4'), '储备甲板有效周期应显示8.4秒')
    await page.js('window.dispatchEvent(new Event("pagehide"));true'); await sleep(500)
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ locale, mobile, richCards: 6, deckCycleSeconds: 8.4, reload: true, runtimeErrors: 0, pid: process.pid }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
