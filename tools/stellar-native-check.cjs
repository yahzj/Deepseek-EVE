/** 动态星系与战损原生验收，先build再node tools/stellar-native-check.cjs。
 * v0.1.0/存档v31，合成档、隐藏Electron、随机端口，2026-10-07。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const { injectStellarSearchTestState } = require('./stellar-search-fixture.ts')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..'), PREFIX = 'whale-stellar-native-'
const OUT = path.join(ROOT, 'tools/_ui-artifacts/stellar')
async function parent() {
  fs.mkdirSync(OUT, { recursive: true })
  const directory = path.join(ROOT, 'apps/desktop/out/renderer')
  const server = http.createServer((req, res) => {
    const target = path.resolve(directory, '.' + new URL(req.url, 'http://localhost').pathname)
    if (!target.startsWith(directory + path.sep)) { res.writeHead(403); res.end(); return }
    try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.jpg': 'image/jpeg' })[path.extname(target)] || 'application/octet-stream'); res.end(fs.readFileSync(target)) }
    catch { res.writeHead(404); res.end() }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `http://127.0.0.1:${server.address().port}/index.html`, reports = []
  try {
    for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mobile of [false, true]) {
      const selected = process.argv.find(a => a.startsWith('--case='))?.slice(7)
      if (selected && selected !== `${layout}-${locale}-${mobile ? 'mobile' : 'desktop'}`) continue
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
      try {
        const state = core.createInitialState({ seed: 7, nowWallMs: Date.now() }); injectStellarSearchTestState(state)
        fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
        const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: url, STELLAR_UI_CASE: JSON.stringify({ layout, locale, mobile }) }
        delete env.ELECTRON_RUN_AS_NODE
        const p = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        let errors = ''; p.stdout.on('data', b => process.stdout.write(b)); p.stderr.on('data', b => { errors += b; process.stderr.write(b) })
        const timer = setTimeout(() => p.kill(), 180000), [status] = await once(p, 'exit'); clearTimeout(timer)
        assert.equal(status, 0, errors)
        const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
        assert.equal(saved.planetary.stellar.systems['system-v1-7'].seed, 7)
        assert(saved.fleet[state.shipId].damagePlugs.length === 3)
        reports.push({ layout, locale, mobile, ok: true })
      } finally {
        const checked = path.resolve(profile); assert(checked.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(checked).startsWith(PREFIX))
        fs.rmSync(checked, { recursive: true, force: true })
      }
    }
    fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(reports, null, 2), 'utf8')
    console.log(JSON.stringify({ ok: true, cases: reports.length }))
  } finally { server.close(); await once(server, 'close') }
}
async function child() {
  const { app, BrowserWindow } = require('electron'), profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}; require(path.join(ROOT, 'apps/desktop/out/main/index.js')); await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], options = JSON.parse(process.env.STELLAR_UI_CASE)
  win.setContentSize(1366, 768); win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((m, p = {}) => win.webContents.debugger.sendCommand(m, p), { touch: options.mobile })
  const tap = page.tap.bind(page)
  page.tap = async (selector, config) => {
    try { return await tap(selector, config) } catch (error) {
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}-failure.png`), Buffer.from(image.data, 'base64'))
      console.error(JSON.stringify(await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return {};const b=e.getBoundingClientRect();return {rect:{x:b.x,y:b.y,w:b.width,h:b.height},hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,500)}})()`)))
      throw error
    }
  }
  const errors = []; win.webContents.debugger.on('message', (_e, m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  const init = `localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:debug','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})`
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: init })
  if (options.mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 740, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await page.send('Page.reload'); await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  await sleep(700)
  const t = id => data.L10N[id][options.locale], snap = () => page.js('window.__whalePlanetaryTest.snapshot()')
  const navigate = async (key, id) => options.layout === 'classic' ? page.tap(`[data-nav-page="${key}"]`) : page.text('.app-nav-side', t(id))
  const step = ms => page.js(`window.__whalePlanetaryTest.step(${ms})`)
  const closeDamage = async () => { await page.tap('.app-ship-damage-modal .app-modal-head button'); await page.wait('!document.querySelector(".app-ship-damage-modal")') }
  if (options.layout === 'modern' && !options.mobile) await page.tap('.app-log-head-right button')
  await navigate('ship', 'ui.App.002')
  await page.wait('!!document.querySelector(".app-ship-plug-summary [data-damage-kind]")')
  assert.equal(await page.js('document.querySelectorAll(".app-ship-plug-summary [data-damage-kind]").length'), 3)
  await page.tap('.app-ship-plug-summary [data-damage-kind="speed"]'); await page.wait('!!document.querySelector(".app-ship-damage-modal")'); await closeDamage()
  await navigate('fit', 'ui.App.003'); await page.wait('!!document.querySelector(".app-fit-plugslots [data-damage-kind]")')
  assert.equal(await page.js('document.querySelectorAll(".app-fit-plugslots [data-damage-kind]").length'), 3)
  await page.tap('.app-fit-plugslots [data-damage-kind="range"]'); await page.wait('!!document.querySelector(".app-ship-damage-modal")'); await closeDamage()
  await navigate('comms', 'ui.App.009'); await page.text('.app-comms-body .app-tasktabs', t('ui.WreckLog.001'))
  await page.wait('!!document.querySelector(".app-wreck-fit [data-damage-kind]")')
  await page.tap('.app-wreck-fit [data-damage-kind]'); await page.wait('!!document.querySelector(".app-ship-damage-modal")'); await closeDamage()
  console.log('战损三界面同区与触屏详情通过')
  const underlyingPage = await page.js('document.querySelector(".app-nav-item.is-active")?.textContent')
  await page.text('.app-nav-side', t('ui.stellar.054')); await page.wait('!!document.querySelector(".app-stellar-modal")')
  assert.equal(await page.js('document.querySelector(".app-nav-item.is-active")?.textContent'), underlyingPage)
  await page.tap('[data-probe-manufacture]'); await page.wait('!!document.querySelector("[data-probe-production]")'); await step(3600000)
  assert.equal((await snap()).warehouse.items['deep-space-probe'], 1)
  await page.text('.app-stellar-modes', t('ui.stellar.007'))
  await page.tap('[data-system-seed]')
  await page.send('Input.insertText', { text: '7' })
  await step(1000)
  assert(await page.js(`document.activeElement===document.querySelector('[data-system-seed]') && document.activeElement.value==='7'`))
  await page.tap('[data-search-launch]'); assert.equal((await snap()).warehouse.items['deep-space-probe'], 0)
  await page.text('.app-stellar-sidebar', t('ui.stellar.010'))
  const pausedAt = (await snap()).planetary.stellar.search.progressMs
  await step(60000)
  assert.equal((await snap()).planetary.stellar.search.progressMs, pausedAt)
  await page.text('.app-stellar-sidebar', t('ui.stellar.011')); await step(6 * 3600000)
  await page.wait('!!document.querySelector("[data-stellar-body]")')
  const s = (await snap()).planetary.stellar.systems['system-v1-7']
  const body = s.bodies.find(b => b.kind !== 'gas')
  await page.tap(`[data-stellar-body="${body.planetId}"]`)
  const before = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")')
  await page.tap(`.app-stellar-map-tool[title=${JSON.stringify(t('ui.stellar.050'))}]`)
  const zoomed = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'); assert.notEqual(zoomed, before)
  const center = await page.js(`(()=>{const b=document.querySelector('.app-stellar-map-svg').getBoundingClientRect();return {x:b.x+b.width*.5,y:b.y+b.height*.5,w:b.width,h:b.height}})()`)
  const selection = await page.js('document.querySelector("[data-stellar-body].is-selected").getAttribute("data-stellar-body")')
  if (options.mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: center.x, y: center.y }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: center.x + 24, y: center.y + 20 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x + 40, y: center.y + 30, buttons: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x + 40, y: center.y + 30, button: 'left', clickCount: 1 })
  }
  await sleep(100)
  const dragged = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")')
  assert.notEqual(dragged, zoomed)
  assert.equal(await page.js('document.querySelector("[data-stellar-body].is-selected").getAttribute("data-stellar-body")'), selection)
  if (options.mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: center.x, y: center.y - 35 }, { id: 2, x: center.x, y: center.y + 35 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: center.x, y: center.y - 65 }, { id: 2, x: center.x, y: center.y + 65 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ id: 1, x: center.x, y: center.y - 65 }] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY: -100 })
  await sleep(100)
  const scaled = await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'); assert.notEqual(scaled, dragged)
  await page.tap(`.app-stellar-map-tool[title=${JSON.stringify(t('ui.stellar.052'))}]`)
  assert.equal(await page.js('document.querySelector(".app-stellar-map-svg").getAttribute("viewBox")'), before)
  console.log('缩放、拖动、拖后不误选与全图恢复通过')
  await page.text('.app-stellar-sidebar', t('ui.stellar.022')); await page.tap('[data-open-surface]'); await page.wait('!!document.querySelector(".app-planet-modal")')
  assert.equal(await page.js('document.querySelectorAll("[data-planet-cell]").length'), (await snap()).planetary.planets[body.planetId].size ** 2)
  await page.tap('.app-planet-close'); await page.wait('!!document.querySelector(".app-stellar-modal")')
  await page.js('window.__whalePlanetaryTest.persist()'); await page.send('Page.reload'); await page.wait('!!window.__whalePlanetaryTest')
  assert.equal((await snap()).planetary.stellar.systems['system-v1-7'].seed, 7)
  await page.text('.app-nav-side', t('ui.stellar.054')); await page.wait('!!document.querySelector(".app-stellar-modal")')
  const geometry = await page.js(`(()=>{const e=document.querySelector('.app-stellar-modal'),s=document.querySelector('.app-stellar-sidebar'),m=document.querySelector('.app-stellar-mapcolumn');return {overflow:e.scrollWidth>e.clientWidth+1,side:s.offsetWidth,width:e.offsetWidth,map:m.offsetWidth,root:document.querySelector('.app-root').offsetWidth,bodies:document.querySelectorAll('[data-stellar-body]').length}})()`)
  assert(!geometry.overflow); assert(geometry.side >= 280); assert(geometry.width >= geometry.root * .85); assert(geometry.map >= 500)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  const image = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${options.layout}-${options.locale}-${options.mobile ? 'mobile' : 'desktop'}.png`), Buffer.from(image.data, 'base64'))
  console.log(JSON.stringify({ ...options, pid: process.pid, ok: true, geometry })); app.exit(0)
}
if (process.argv.includes('--child')) child().catch(e => { console.error(e); require('electron').app.exit(1) })
else parent().catch(e => { console.error(e); process.exitCode = 1 })
