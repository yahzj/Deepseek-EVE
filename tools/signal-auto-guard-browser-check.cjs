/** 网页构建后运行 node tools/signal-auto-guard-browser-check.cjs。
 * 合成停港档、自有隐藏Chrome验证正式Worker派队、重复点击、取消与存盘；不读取个人档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { sleep, settingsScript, CdpConnection, JourneyPage, stopOwned, removeProfile, uiText } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { signalAutoFixture } = require('./signal-auto-estimate-fixture.ts')
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'web/dist')
const output = path.join(root, `tools/_ui-artifacts/signal-auto-guard-browser-${Date.now()}`)
const save = 'JSON.parse(localStorage.getItem("whale:idle:save")).state'

async function main() {
  await fs.mkdir(output, { recursive: true })
  const index = await fs.readFile(path.join(dist, 'index.html'), 'utf8')
  assert((await fs.readdir(path.join(dist, 'assets'))).some(name => name.startsWith('signalAuto.worker-')))
  assert(index.includes('/Deepseek-EVE/assets/'))
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-signal-guard-'))
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).replace(/^\/Deepseek-EVE/, '')
      const file = path.resolve(dist, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname))
      assert(file.startsWith(dist + path.sep))
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] ?? 'application/octet-stream')
      res.end(await fs.readFile(file))
    } catch { res.statusCode = 404; res.end() }
  })
  let child, socket, page
  const rows = []
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log('自有Chrome PID', child.pid)
    let debug
    for (let i = 0; i < 100; i++) { try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) } }
    assert(debug)
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const connection = new CdpConnection(socket)
    page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable'); await page.send('Runtime.enable')
    for (const layout of ['classic', 'modern']) {
      const { state, roster } = signalAutoFixture('survey', true)
      state.research.levels['mt-industry-void-drip'] = 0
      state.wormholeScan = { active: false, progressMs: 0, welcomed: true }
      state.preparationSquads = { 'signal-auto': roster }
      const text = uiText('zh', 'signal')
      const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.clear();${settingsScript(data.ANNOUNCEMENTS[0].id, core.serializeSaveFile(state, Date.now()), { layout, debug: false, test: false })}` })
      await page.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/Deepseek-EVE/` })
      await page.wait('!!document.querySelector(".app-root")')
      await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
      // 周期入侵可能在开局触发；只通过它已有的关闭按钮让出测试界面。
      for (let attempt = 0; attempt < 30; attempt++) {
        const close = await page.js(`(()=>{const buttons=[...document.querySelectorAll('.app-modal-mask button,.app-comm-mask button')].reverse();return buttons.find(button=>button.textContent.trim()==='知道了'&&button.getBoundingClientRect().width>0)?.outerHTML})()`)
        if (!close) { await sleep(100); continue }
        await page.js(`(()=>{const buttons=[...document.querySelectorAll('.app-modal-mask button,.app-comm-mask button')].reverse();buttons.find(button=>button.textContent.trim()==='知道了'&&button.getBoundingClientRect().width>0)?.click()})()`)
        await sleep(200)
      }
      await dismissOverlays(page)
      await page.text('.app-nav-side', text('ui.App.001'))
      await page.text('.app-subtabs', text('ui.MapPage.007'))
      const open = async () => {
        await page.wait('!![...document.querySelectorAll(".app-inv-row button")].find(b=>b.title.includes("自动"))')
        await page.js('[...document.querySelectorAll(".app-inv-row button")].find(b=>b.title.includes("自动")).click()')
        await page.wait('!!document.querySelector(".app-wh-modal .app-wh-enter")')
        assert.equal(await page.js('document.querySelector(".app-wh-enter").disabled'), false)
      }
      await open()
      await page.tap('.app-wh-enter')
      await page.wait('document.querySelector(".app-wh-enter")?.getAttribute("aria-busy")==="true"', 3000)
      await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
      await page.wait('!document.querySelector(".app-wh-modal")')
      await sleep(1500)
      assert.equal(await page.js(`${save}.wormholeAuto.length`), 0, '取消后不应派队')
      assert.equal(await page.js(`${save}.wormholeStock.length`), 10)
      await open()
      await page.js('window.__guardTicks=0;window.__guardTick=setInterval(()=>window.__guardTicks++,20)')
      const started = Date.now()
      await page.tap('.app-wh-enter')
      await page.wait('document.querySelector(".app-wh-enter")?.getAttribute("aria-busy")==="true"', 3000)
      assert.equal(await page.js('document.querySelector(".app-wh-enter").disabled'), true)
      await page.js('document.querySelector(".app-wh-enter").click()')
      await page.wait(`${save}.wormholeAuto.length===1`, 60000)
      await page.wait('!document.querySelector(".app-wh-modal")')
      const saved = await page.js(save)
      const run = saved.wormholeAuto[0]
      assert.equal(run.estimate.version, 2)
      assert.deepEqual(run.shipIds, roster)
      assert.equal(saved.wormholeStock.length, 9)
      assert.deepEqual(saved.warehouse.items, state.warehouse.items)
      assert.equal(run.estimate.layers[0].guardBattle.outcome, 'victory')
      for (const layer of run.estimate.layers) assert.equal(layer.combatRatio, undefined)
      const ticks = await page.js('clearInterval(window.__guardTick);window.__guardTicks')
      assert(ticks > 5, `计算期间界面心跳未推进:${ticks}`)
      await page.send('Page.reload')
      await page.wait('!!document.querySelector(".app-root")')
      const restored = await page.js(save)
      assert.deepEqual(restored.wormholeAuto[0].estimate, run.estimate)
      assert.equal(connection.errors.length, 0, JSON.stringify(connection.errors))
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      await fs.writeFile(path.join(output, `${layout}.png`), Buffer.from(image.data, 'base64'))
      const row = { layout, elapsedMs: Date.now() - started, ticks, cancelled: true, runs: 1, version: 2, layers: run.estimate.layers.length }
      rows.push(row); console.log(JSON.stringify(row))
    }
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ok: true, rows }, null, 2))
  } catch (error) {
    if (page) {
      const image = await page.send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
      if (image) await fs.writeFile(path.join(output, 'failure.png'), Buffer.from(image.data, 'base64'))
      console.error(await page.js('document.body.innerText.slice(-5000)').catch(() => ''))
    }
    throw error
  } finally {
    socket?.close()
    await stopOwned(child)
    await new Promise(resolve => server.close(resolve))
    await removeProfile(profile, 'whale-signal-guard-')
    console.log(JSON.stringify({ output }))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
