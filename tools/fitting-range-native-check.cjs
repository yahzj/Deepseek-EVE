/** 装配靶场原生读数验证。先构建，再node tools/fitting-range-native-check.cjs。
 * 两布局×桌面/手机逻辑旋转；合成档、隐藏Electron、独立userData，无个人档输入。
 * 输出tools/_ui-artifacts/fitting-range截图与读数；v0.1.0/存档v31，2026-10-09核对。
 * 截图仅验证渲染和几何，不作观感验收。
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..'), PREFIX = 'whale-fitting-range-', OUT = path.join(ROOT, 'tools/_ui-artifacts/fitting-range')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
if (!process.argv.includes('--child')) {
  const { fittingRangeFixture } = require('./fitting-range-fixture.ts')
  fs.mkdirSync(OUT, { recursive: true })
  let cases = 0
  for (const layout of ['modern', 'classic']) for (const mobile of [false, true]) {
    const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
    if (selected && selected !== `${layout}-${mobile ? 'mobile' : 'desktop'}`) continue
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const text = fittingRangeFixture(), before = core.loadSaveFile(text).state
      fs.writeFileSync(path.join(profile, 'save.json'), text, 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, RANGE_UI_CASE: JSON.stringify({ layout, mobile }) }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      const run = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 90000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const after = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      for (const key of ['wallet', 'fleet', 'warehouse', 'moduleBay', 'expedition', 'anomalyRecords', 'standings']) assert.deepEqual(after[key], before[key], key)
      cases++
    } finally {
      const checked = path.resolve(profile)
      assert(checked.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(checked).startsWith(PREFIX))
      fs.rmSync(checked, { recursive: true, force: true })
    }
  }
  console.log(`靶场${cases}种窗口读数与真实存盘资源守恒通过`)
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0], options = JSON.parse(process.env.RANGE_UI_CASE)
    win.webContents.setBackgroundThrottling(false)
    win.setContentSize(1366, 768)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((m, p = {}) => win.webContents.debugger.sendCommand(m, p), { touch: options.mobile })
    const tap = page.tap.bind(page)
    page.tap = async (selector, config) => {
      try { return await tap(selector, config) } catch (error) {
        const image = await page.send('Page.captureScreenshot', { format: 'png' })
        fs.writeFileSync(path.join(OUT, 'failure.png'), Buffer.from(image.data, 'base64'))
        console.error(await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return document.body.innerText.slice(-1500);const b=e.getBoundingClientRect();return {rect:{x:b.x,y:b.y,w:b.width,h:b.height},hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,1000)}})()`))
        throw error
      }
    }
    const errors = []
    win.webContents.debugger.on('message', (_e, m, p) => { if (m === 'Runtime.exceptionThrown') errors.push(p) })
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale','zh');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})` })
    if (options.mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 740, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    await sleep(500)
    if (options.layout === 'classic') await page.tap('[data-nav-page="fit"]')
    else await page.text('.app-nav-side', data.L10N['ui.App.003'].zh)
    await page.wait('!!document.querySelector("[data-fitting-range]")')
    await page.tap('[data-fitting-range]'); await page.wait('!!document.querySelector(".app-range-modal .app-bts-lane")')
    await page.wait('Number(document.querySelector("[data-range-damage]")?.textContent.replaceAll(",","")) > 0')
    await page.wait('!!document.querySelector(".app-range-modal .app-bts-pop:not(.is-miss)")')
    const popup = await page.js(`(()=>{const e=document.querySelector('.app-range-modal .app-bts-pop:not(.is-miss)'),s=getComputedStyle(e);return {size:s.fontSize,weight:s.fontWeight,duration:s.animationDuration,stroke:s.webkitTextStrokeWidth}})()`)
    assert.equal(popup.size, '22px'); assert.equal(popup.weight, '900'); assert.equal(popup.duration, '2.4s'); assert.equal(popup.stroke, '0.35px')
    await page.wait('!![...document.querySelectorAll(".app-range-modal .app-bts-pop")].find(e=>parseFloat(e.style.animationDelay)>-1000)')
    await page.tap('[data-range-pause]')
    // 隐藏手机窗口的触控送达有延迟；动画读数另以同步按钮事件取证，触控暂停仍在前一步验证。
    if (!await page.js('!!document.querySelector(".app-bts-pop")')) {
      await page.tap('[data-range-pause]')
      await page.wait('!!document.querySelector(".app-bts-pop")')
      await page.js('document.querySelector("[data-range-pause]").click(); true')
      await page.wait('!!document.querySelector("[data-range-pause] .lucide-play")')
    }
    const damage = await page.js('document.querySelector("[data-range-damage]").textContent')
    const animation = await page.js('document.querySelector(".app-bts-pop")?.style.animationDelay')
    assert(animation !== undefined, '暂停后应保留尚未到期的飘字')
    await sleep(2700)
    assert.equal(await page.js('document.querySelector("[data-range-damage]").textContent'), damage)
    assert.equal(await page.js('document.querySelector(".app-bts-pop")?.style.animationDelay'), animation)
    assert.equal(await page.js('document.querySelectorAll(".app-range-modal .app-bts-ops").length'), 0)
    const geometry = await page.js(`(()=>{const e=document.querySelector('.app-range-modal'),w=document.querySelector('.app-range-workspace'),s=document.querySelector('.app-range-scene'),b=document.querySelector('.app-range-scene .app-battle-screen');return {overflow:e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1,sceneHeight:s.offsetHeight,battleHeight:b.offsetHeight,workspaceWidth:w.offsetWidth,sceneWidth:s.offsetWidth,svg:!!document.querySelector('.app-range-modal .app-bts-col.is-foe svg')}})()`)
    assert(!geometry.overflow && geometry.svg && geometry.sceneHeight > 180, JSON.stringify(geometry))
    assert(Math.abs(geometry.sceneHeight - geometry.battleHeight) <= 1, JSON.stringify(geometry))
    const image = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, `${options.layout}-${options.mobile ? 'mobile' : 'desktop'}.png`), Buffer.from(image.data, 'base64'))
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await page.js('getComputedStyle(document.querySelector(".app-bts-pop")).animationName'), 'bts-pop-fade')
    await page.number('.app-range-controls input', 50000)
    await sleep(200)
    assert.equal(await page.js('document.querySelector(".app-range-controls input").value'), '50000')
    assert(await page.js('document.activeElement===document.querySelector(".app-range-controls select")'))
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await page.js('document.querySelector(".app-range-controls select").value'), 'a')
    await page.tap('[data-range-reset]')
    await page.wait('document.querySelector("[data-range-damage]").textContent==="0"')
    await sleep(1500)
    assert.equal(await page.js('document.querySelector("[data-range-damage]").textContent'), '0')
    await page.number('.app-range-controls input', 5000)
    await page.wait('Number(document.querySelector("[data-range-damage]").textContent.replaceAll(",",""))>0')
    await page.tap('[data-range-pause]')
    await page.tap('.app-range-modal .app-modal-head button')
    await page.wait('!document.querySelector(".app-range-modal")')
    await page.tap('[data-fitting-range]')
    assert.equal(await page.js('document.querySelector("[data-range-damage]").textContent'), '0')
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.wait('!document.querySelector(".app-range-modal")')
    await page.js('window.dispatchEvent(new Event("pagehide")); true'); await sleep(500)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ ...options, pid: process.pid, ok: true, popup, geometry }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
