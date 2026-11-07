/** 构建后node tools/black-market-title-check.cjs：合成档验证两布局/两字体/桌面手机的标题留量。
 * 只使用自有无头Chrome，不读个人档；输出tools/_ui-artifacts/black-market-title。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { sleep, settingsScript, staticServer, CdpConnection, JourneyPage } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const { blackMarketTestSave } = require('./black-market-test-fixture.ts')
const root = path.resolve(__dirname, '..'), output = path.join(root, 'tools/_ui-artifacts/black-market-title')
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-bm-title-'))
  let hosted, child, socket, timer
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
    for (const layout of ['classic', 'modern']) for (const font of ['default', 'retro']) for (const width of [1366, 390]) {
      const state = core.loadSaveFile(blackMarketTestSave()).state
      state.onboarding.step = 99
      const ctx = data.buildSimContext()
      const goods = core.blackMarketCandidateGoods(ctx).sort((a, b) => core.goodName(ctx, b.key).length - core.goodName(ctx, a.key).length).slice(0, 9)
      state.blackMarket.offers = goods.map(g => ({ goodKey: g.key, basePrice: g.basePrice, multiplier: 30, price: g.basePrice * 30, sold: false }))
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 844, screenWidth: width, screenHeight: 844, deviceScaleFactor: 1, mobile: width < 500 })
      await page.send('Emulation.setUserAgentOverride', { userAgent: width < 500 ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: width < 500 })
      const source = settingsScript(data.ANNOUNCEMENTS[0].id, core.serializeSaveFile(state), { layout, debug: false, test: false }) + `;localStorage.setItem('whale-idle:ui-font',${JSON.stringify(font)});`
      const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source })
      await page.send('Page.navigate', { url: hosted.url })
      await page.wait('!!document.querySelector(".app-root")')
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
      await page.js(`(document.querySelector('[data-nav-page="market"]')??[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='市场')).click()`)
      await page.wait('!!document.querySelector(".app-bm-entry")')
      await page.js(`document.querySelector('.app-bm-entry').click()`)
      await page.wait('document.querySelectorAll(".app-bm-name").length===9')
      await page.js(`(()=>{for(const el of document.querySelectorAll('.app-comm-pop .app-comms-eave-extra button,.app-comm-mask .app-comm-foot button'))el.click();const log=document.querySelector('.app-log-side');if(log&&!log.classList.contains('is-collapsed'))log.querySelector('.app-log-head-right button')?.click()})()`)
      await page.js('document.fonts.ready'); await sleep(300)
      const rows = await page.js(`(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');return [...document.querySelectorAll('.app-bm-select')].map(el=>{const n=el.firstElementChild,s=getComputedStyle(n),a=n.getBoundingClientRect(),b=el.getBoundingClientRect();ctx.font=s.font;const m=ctx.measureText(n.textContent);return {text:n.textContent,font:s.fontFamily,line:parseFloat(s.lineHeight),size:parseFloat(s.fontSize),padding:parseFloat(s.paddingTop),inkHeight:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent,inside:a.top>=b.top&&a.bottom<=b.bottom,titleHeight:b.height,overlap:b.bottom>el.nextElementSibling.getBoundingClientRect().top+0.5}})})()`)
      assert(rows.every(r => r.line >= r.size * 1.3 && r.padding >= 2 && r.inside && !r.overlap), JSON.stringify(rows))
      assert(rows.every(r => r.inkHeight <= r.line), JSON.stringify(rows))
      const visible = await page.js(`(()=>{const el=document.querySelector('.app-bm-name'),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return r.width>0&&r.right>0&&r.left<innerWidth&&r.top<innerHeight&&(hit===el||el.contains(hit))})()`)
      assert(visible, '首张商品名不可见或被覆盖')
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${font}-${width}.png`), Buffer.from(image.data, 'base64'))
      readings.push({ layout, font, width, rows }); console.log(JSON.stringify({ layout, font, width, titles: rows.length }))
    }
    assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
    fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify(readings, null, 2))
  } finally {
    clearTimeout(timer); socket?.close()
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    if (hosted) await new Promise(resolve => hosted.server.close(resolve))
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith('whale-bm-title-'))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
