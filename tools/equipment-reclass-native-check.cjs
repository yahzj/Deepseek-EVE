/** 装备分类与酸蚀原生读数回归。构建后运行node tools/equipment-reclass-native-check.cjs。
 * 中文桌面、英文手机布局；独立合成档和隐藏Electron，不读取个人档，不作观感验收。
 * 复用靶场夹具与原生输入驱动，核对富卡、真实开火及IPC存盘；游戏v0.1.0，2026-10-19。
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const ROOT = path.resolve(__dirname, '..'), PREFIX = 'whale-equipment-reclass-'
const ids = ['mod-lair-laser-c', 'mod-gravekeeper-rail', 'mod-stealth-3', 'mod-lair-blink-r', 'mod-wh-a-shield']
if (!process.argv.includes('--child')) {
  const { fittingRangeFixture } = require('./fitting-range-fixture.ts')
  for (const locale of ['zh', 'en']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const state = core.loadSaveFile(fittingRangeFixture()).state, ctx = data.buildSimContext()
      state.fleet[state.shipId].fitted = { high: [], mid: [], low: [] }
      state.fleet[state.shipId].droneLoad = {}
      for (const id of ids) {
        state.moduleBay[id] = 1
        const result = core.fitModule(state, id, ctx)
        assert(result.ok, `${id}:${result.error}`)
      }
      core.repairDeprecatedModules(state, ctx)
      const before = core.loadSaveFile(core.serializeSaveFile(state)).state
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(before), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, EQUIPMENT_LOCALE: locale }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const run = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(saved.fleet[before.shipId].fitted, before.fleet[before.shipId].fitted)
      assert.deepEqual(saved.warehouse, before.warehouse, '靶场不得消耗真实库存')
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
    const win = BrowserWindow.getAllWindows()[0], locale = process.env.EQUIPMENT_LOCALE, mobile = locale === 'en'
    win.webContents.setBackgroundThrottling(false)
    win.setContentSize(1366, 768)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
    const errors = []
    win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('whale-idle:layout','classic');localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})` })
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await page.tap('[data-nav-page="fit"]')
    const ctx = data.buildSimContext(locale)
    const read = {}
    for (const id of ids) {
      const name = ctx.modules.get(id).name
      const point = await page.js(`(()=>{const e=[...document.querySelectorAll('.app-fit-slot-icon.is-filled')].find(e=>e.querySelector('.app-fit-slot-icon-name')?.textContent===${JSON.stringify(name)});if(!e)throw Error('未找到装备');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      await page.wait(`document.querySelector('.app-tip')?.textContent.includes(${JSON.stringify(name)})`)
      read[id] = await page.js('document.querySelector(".app-tip").textContent')
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      await sleep(100)
    }
    assert(read[ids[0]].includes('5%') && read[ids[0]].includes('2.5 km') && read[ids[0]].includes('3.8'))
    assert(read[ids[1]].includes('30%') && read[ids[1]].includes('10%'))
    assert(read[ids[3]].includes(data.L10N['ui.shipInfo.251'][locale]))
    assert(!read[ids[3]].includes(data.L10N['ui.shipInfo.020'][locale]))
    assert(read[ids[4]].includes('36'))
    await page.tap('[data-fitting-range]')
    await page.number('.app-range-controls input', 1000)
    await page.wait('Number(document.querySelector("[data-range-damage]")?.textContent.replaceAll(",",""))>0')
    await page.wait(`document.querySelector('.app-range-modal')?.textContent.includes(${JSON.stringify(data.L10N['ui.alienLoot.001'][locale])})`)
    const damage = await page.js('document.querySelector("[data-range-damage]").textContent')
    await page.tap('.app-range-modal .app-modal-head button')
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(500)
    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ locale, mobile, pid: process.pid, richCards: ids.length, damage, acidVisible: true, reload: true, runtimeErrors: errors.length }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
