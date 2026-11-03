/** 势力图鉴完整性桌面检查；先npm run build，再node tools/faction-codex-native-check.cjs。
 * 输入独立合成档和当前目录；隐藏Electron核对中英七族分栏、计数与补回条目详情。
 * 输出控制台读数；不读个人档，仅删除绝对路径与前缀校验过的自建临时userData。
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
const ROOT = path.resolve(__dirname, '..'), PREFIX = 'whale-faction-codex-'

if (!process.argv.includes('--child')) {
  const { fittingRangeFixture } = require('./fitting-range-fixture.ts')
  for (const locale of ['zh', 'en']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const state = core.loadSaveFile(fittingRangeFixture()).state
      state.foeShipSeen = Object.fromEntries(data.FOE_SHIPS.map(foe => [foe.id, true]))
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, CODEX_LOCALE: locale }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const run = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const after = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(after.foeShipSeen, state.foeShipSeen)
      assert.deepEqual(after.moduleBay, state.moduleBay)
      assert.deepEqual(after.blueprintStock, state.blueprintStock)
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
    const win = BrowserWindow.getAllWindows()[0], locale = process.env.CODEX_LOCALE
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
    const text = id => data.l10nEntryText(data.L10N[id], locale)
    await page.text('.app-header', text('ui.App.028'))
    await page.wait('!!document.querySelector(".app-hand-modal")')
    await page.js(`(()=>{const b=[...document.querySelectorAll('.app-hand-navitem')].find(b=>b.querySelector('span')?.textContent===${JSON.stringify(text('ui.codex.001'))});if(!b)throw Error('没有势力页');b.setAttribute('data-codex-nav','1')})()`)
    await page.tap('[data-codex-nav]')
    const ctx = data.buildSimContext(locale)
    const cards = data.buildFactionCards(data.FOE_SHIPS, Object.fromEntries(data.FOE_SHIPS.map(foe => [foe.id, true])))
    const groupIds = { modules: 'ui.codex.011', ships: 'ui.codex.012', blueprints: 'ui.codex.013' }
    const nameOf = id => (ctx.modules.get(id) ?? ctx.items.get(id) ?? ctx.ships.get(id) ?? ctx.blueprints.get(id) ?? ctx.shipBlueprints.get(id)).name
    const readings = []
    let detailsOpened = 0
    for (const card of cards) {
      await page.js(`(()=>{document.querySelector('[data-codex-family]')?.removeAttribute('data-codex-family');const b=[...document.querySelectorAll('.app-hand-cell')].find(b=>b.querySelector('.app-hand-cell-name')?.textContent===${JSON.stringify(text(card.nameId))});if(!b)throw Error('没有势力卡');b.setAttribute('data-codex-family','1')})()`)
      await page.tap('[data-codex-family]')
      const reading = { family: card.family }
      for (const [kind, titleId] of Object.entries(groupIds)) {
        const expected = card[kind].map(nameOf)
        const result = await page.js(`(()=>{const p=[...document.querySelectorAll('.app-hand-main .wui-panel')].find(p=>p.querySelector(':scope > .wui-panel-head > .wui-panel-title')?.textContent.trim()===${JSON.stringify(text(titleId))});return p?{names:[...p.querySelectorAll('.app-hand-cell-name')].map(e=>e.textContent),count:p.querySelector(':scope > .wui-panel-head > .wui-panel-right')?.textContent}:null})()`)
        if (!result) { assert.equal(expected.length, 0, `${card.family}/${kind}没有分栏`); reading[kind] = 0; continue }
        assert.deepEqual([...result.names].sort(), [...expected].sort(), `${locale}/${card.family}/${kind}`)
        assert.equal(parseInt(result.count, 10), expected.length, `${card.family}/${kind}计数`)
        reading[kind] = result.names.length
      }
      const registered = data.FACTION_CODEX[card.family]
      const added = [...card.modules.filter(id => !registered.modules.includes(id)), ...card.blueprints.filter(id => !registered.blueprints.includes(id))]
      for (const id of added) {
        const name = nameOf(id)
        await page.js(`(()=>{document.querySelector('[data-codex-entry]')?.removeAttribute('data-codex-entry');const b=[...document.querySelectorAll('.app-hand-cell')].find(b=>b.querySelector('.app-hand-cell-name')?.textContent===${JSON.stringify(name)});if(!b)throw Error('没有补回条目');b.setAttribute('data-codex-entry','1')})()`)
        await page.tap('[data-codex-entry]')
        await page.wait(`document.querySelector('.app-detail[role="dialog"]')?.getAttribute('aria-label')===${JSON.stringify(name)}`)
        assert(await page.js('document.querySelectorAll(".app-detail .app-detail-row").length>0'), `${id}详情无参数`)
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
        await page.wait('!document.querySelector(".app-detail")')
        detailsOpened += 1
      }
      readings.push(reading)
    }
    assert.equal(detailsOpened, 15)
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    await sleep(500)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ target: 'd2-desktop-production', locale, hidden: !win.isVisible(), pid: process.pid, readings, detailsOpened, runtimeErrors: errors.length }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
