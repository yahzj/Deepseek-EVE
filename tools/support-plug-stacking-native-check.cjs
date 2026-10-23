/** 构建后运行；隐藏Electron、隔离合成档与真实IPC保存，非观感或实体手机验收。 */
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const { injectSupportPlugStackingFixture } = require('./support-plug-stacking-fixture.ts')
const root = path.resolve(__dirname, '..'), prefix = 'whale-support-plug-stacking-'
if (!process.argv.includes('--child')) {
  for (const locale of ['zh', 'en']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    try {
      const state = core.createInitialState({ nowWallMs: Date.now() }), ctx = data.buildSimContext()
      injectSupportPlugStackingFixture(state)
      state.shipId = Object.keys(state.fleet).find(id => state.fleet[id].plugs?.[0] === 'plug-titan-compression')
      for (const id of ['mod-turret-kin-1', 'mod-wh-g-ballistic', 'mod-wh-g-ballistic']) {
        assert(core.fitModule(state, id, ctx).ok, `装配失败：${id}`)
      }
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, STACKING_LOCALE: locale }
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
      const electronArg = process.argv.find(arg => arg.startsWith('--electron='))
      const run = spawnSync(electronArg ? electronArg.slice(11) : require('electron'), [__filename, '--child'],
        { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(saved.fleet[state.shipId].plugs, state.fleet[state.shipId].plugs)
      assert.deepEqual(saved.fleet[state.shipId].fitted, state.fleet[state.shipId].fitted)
      const out = path.join(root, 'tools/_ui-artifacts/support-plug-stacking')
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, `${locale}.json`), JSON.stringify({ locale, passed: true, nativeOutput: run.stdout }, null, 2), 'utf8')
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
    const win = BrowserWindow.getAllWindows()[0], locale = process.env.STACKING_LOCALE, mobile = locale === 'en'
    win.setContentSize(1366, 768)
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
    const errors = []
    win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('whale-idle:locale',${JSON.stringify(locale)});localStorage.setItem('whale-idle:layout',${JSON.stringify(mobile ? 'modern' : 'classic')});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})` })
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, screenWidth: 390, screenHeight: 740,
        screenOrientation: { type: 'portraitPrimary', angle: 0 }, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    await sleep(500)
    if (mobile) await page.text('.app-nav-side', data.L10N['ui.App.003'][locale])
    else await page.tap('[data-nav-page="fit"]')
    await page.wait('document.querySelectorAll(".app-fit-plugslots .is-filled").length===2')
    const ctx = data.buildSimContext(locale), cards = {}
    for (const id of ['mod-wh-g-ballistic', 'plug-titan-compression']) {
      const name = ctx.modules.get(id).name
      for (const ordinal of [1, 2]) {
        const point = await page.js(`(()=>{const e=[...document.querySelectorAll('.app-fit-slot-icon.is-filled')].filter(e=>e.querySelector('.app-fit-slot-icon-name')?.textContent===${JSON.stringify(name)})[${ordinal - 1}];if(!e)throw Error('缺少测试件');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
        await page.wait(`document.querySelector('.app-tip')?.textContent.includes(${JSON.stringify(name)})`)
        const text = await page.js('document.querySelector(".app-tip").textContent')
        cards[`${id}:${ordinal}`] = text
        assert(text.includes(data.L10N['ui.shipInfo.079'][locale]))
        assert(text.includes(data.L10N['ui.shipInfo.222'][locale]))
        assert(!/ui\.[A-Za-z]|\{p\d+\}/.test(text), text)
        if (ordinal === 2) assert(text !== cards[`${id}:1`], '第二件富卡应显示不同的折权值')
        if (id === 'plug-titan-compression') assert(text.includes('m³') && text.includes('m/s'))
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }); await sleep(100)
      }
    }
    await page.js('window.dispatchEvent(new Event("pagehide"));true'); await sleep(500)
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ locale, mobile, cards, reload: true, runtimeErrors: 0, pid: process.pid }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
