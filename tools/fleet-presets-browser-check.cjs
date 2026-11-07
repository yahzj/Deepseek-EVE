/** 先npm run build，再node tools/fleet-presets-browser-check.cjs。
 * 自有无头Chrome、全新合成档，验证两种布局与桌面/手机尺寸下的预设操作和重载。
 * 输出tools/_ui-artifacts/fleet-presets；不读个人档，不等同桌面观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { sleep, settingsScript, staticServer, CdpConnection, JourneyPage } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { blackMarketTestSave } = require('./black-market-test-fixture.ts')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tools/_ui-artifacts/fleet-presets')
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-fleet-presets-'))
  let child, hosted, socket, timer, initialization
  try {
    hosted = await staticServer(path.join(root, 'apps/desktop/out/renderer'))
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log('owned Chrome PID', child.pid)
    timer = setTimeout(() => child.kill(), 180000)
    let debug
    for (let i = 0; i < 100; i++) { try { debug = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) } }
    assert(debug)
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const connection = new CdpConnection(socket), page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable'); await page.send('Runtime.enable')
    fs.mkdirSync(output, { recursive: true })
    const readings = []
    const navigate = async () => {
      await page.wait('!!document.querySelector(".app-root")')
      await dismissOverlays(page)
      await page.js(`(document.querySelector('[data-nav-page="ship"]')??[...document.querySelectorAll('.app-nav-item')].find(b=>b.textContent.trim()==='舰船')).click()`)
      await page.wait('!!document.querySelector(".app-fleet-presets")')
    }
    const fill = async value => page.js(`(()=>{const el=document.querySelector('.app-fleet-presets input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const click = async label => page.js(`document.querySelector('.app-fleet-presets button[aria-label="${label}"]').click()`)
    for (const layout of ['classic', 'modern']) for (const [width, height] of [[1366, 768], [390, 844]]) {
      const state = core.loadSaveFile(blackMarketTestSave()).state
      state.fleet = {}
      const ids = Array.from({ length: 3 }, () => core.addShipToFleet(state, 'sh-shrike'))
      state.shipId = ids[0]
      state.onboarding.step = 99
      state.preparationSquads = { combat: [ids[0], ids[2], ids[1]] }
      for (const skill of core.COMMAND_SKILLS) state.skills.trained[skill.id] = 5
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: width < 500 })
      if (initialization) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initialization })
      initialization = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source: settingsScript(data.ANNOUNCEMENTS[0].id, core.serializeSaveFile(state), { layout, debug: false, test: false }) })).identifier
      await page.send('Page.navigate', { url: hosted.url }); await navigate()
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initialization }); initialization = null
      await fill('Alpha'); await click('保存当前编队')
      await page.wait('document.querySelectorAll(".app-fleet-preset-row").length===1')
      await click('重命名预设'); await fill('Beta'); await click('重命名预设')
      await page.wait('document.querySelector(".app-fleet-preset-detail strong")?.textContent==="Beta"')
      await click('套用编队'); await click('用当前编队覆盖')
      assert(await page.js('!!document.querySelector(".app-fleet-preset-confirm")'))
      await page.js(`document.querySelector('.app-fleet-preset-confirm button').click()`)
      await page.wait('!document.querySelector(".app-fleet-preset-confirm")')
      const geometry = await page.js(`(()=>{const el=document.querySelector('.app-fleet-presets'),r=el.getBoundingClientRect();return {width:r.width,height:r.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,rows:document.querySelectorAll('.app-ship-card').length}})()`)
      assert(geometry.scrollWidth <= geometry.clientWidth + 1, JSON.stringify(geometry))
      assert(geometry.rows >= 3, JSON.stringify(geometry))
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${width}.png`), Buffer.from(image.data, 'base64'))
      await page.send('Page.reload'); await navigate()
      await page.js(`document.querySelector('.app-fleet-presets-toolbar button').click()`)
      await page.wait('document.querySelector(".app-fleet-preset-detail strong")?.textContent==="Beta"')
      await click('删除预设')
      assert(await page.js('document.querySelectorAll(".app-fleet-preset-row").length===1'))
      await page.js(`document.querySelector('.app-fleet-preset-confirm button').click()`)
      await page.wait('document.querySelectorAll(".app-fleet-preset-row").length===0')
      for (let index = 0; index < core.FLEET_PRESET_MAX; index++) {
        await fill(`preset-${index + 1}`); await click('保存当前编队')
        await page.wait(`document.querySelectorAll('.app-fleet-preset-row').length===${index + 1}`)
      }
      assert(await page.js(`document.querySelector('.app-fleet-presets button[aria-label="保存当前编队"]').disabled`))
      const full = await page.js(`(()=>{const el=document.querySelector('.app-fleet-presets-list');el.scrollTop=el.scrollHeight;const r=el.getBoundingClientRect(),b=el.lastElementChild.querySelector('button').getBoundingClientRect();return {client:el.clientHeight,scroll:el.scrollHeight,lastReachable:b.top>=r.top&&b.bottom<=r.bottom+1}})()`)
      assert(full.scroll > full.client && full.lastReachable, JSON.stringify(full))
      const fullImage = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${width}-full.png`), Buffer.from(fullImage.data, 'base64'))
      readings.push({ layout, viewportWidth: width, viewportHeight: height, full, ...geometry }); console.log(JSON.stringify(readings.at(-1)))
    }
    assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
    fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify(readings, null, 2))
  } finally {
    clearTimeout(timer); socket?.close()
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith('whale-fleet-presets-'))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
