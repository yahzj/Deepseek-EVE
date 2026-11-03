/** 非推进器独立速度的桌面产物检查；先npm run build，再node tools/independent-speed-native-check.cjs。
 * 隐藏Electron、独立合成档；中英各核对装备参数卡，保留推进器周期，不读取个人档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const ROOT = path.resolve(__dirname, '..'), PREFIX = 'whale-independent-speed-'
const ids = ['mod-wh-c-pulse', 'mod-wh-c-frame', 'mod-prop-2']

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
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, SPEED_LOCALE: locale }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const run = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 60000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const after = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(after.fleet[before.shipId].fitted, before.fleet[before.shipId].fitted)
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
    const win = BrowserWindow.getAllWindows()[0], locale = process.env.SPEED_LOCALE
    assert(win)
    win.webContents.setBackgroundThrottling(false)
    win.setContentSize(1366, 768)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
    const errors = []
    win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('whale-idle:layout','classic');localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})` })
    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await page.tap('[data-nav-page="fit"]')
    const ctx = data.buildSimContext(locale), readings = []
    for (const id of ids) {
      const name = ctx.modules.get(id).name
      const read = await page.js(`(()=>{const e=[...document.querySelectorAll('.app-fit-slot-icon.is-filled')].find(e=>e.querySelector('.app-fit-slot-icon-name')?.textContent===${JSON.stringify(name)});if(!e)throw Error('未找到装备');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: read.x, y: read.y })
      await page.wait(`document.querySelector('.app-tip')?.textContent.includes(${JSON.stringify(name)})`)
      const card = await page.js('document.querySelector(".app-tip").textContent')
      if (id !== 'mod-prop-2') {
        const bonus = id === 'mod-wh-c-pulse' ? '10%' : '5%'
        assert(card.includes(`战斗机动 +${bonus}`), card)
        assert(!/点火|冷却|burn|cooldown/i.test(card), card)
      } else {
        assert(/点火|burn/i.test(card), card)
        assert(/冷却|cooldown/i.test(card), card)
      }
      readings.push({ id, tooltipVerified: true })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 })
      await sleep(100)
    }
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(500)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ target: 'd2-desktop-production', locale, hidden: !win.isVisible(), pid: process.pid, readings, runtimeErrors: errors.length }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
