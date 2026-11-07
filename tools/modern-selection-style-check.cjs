/** node tools/modern-selection-style-check.cjs
 * 用真实两套CSS和组件同类DOM验证工业卡头及编队卡选择态；不启动游戏，不读个人档。
 * 自有无头Chrome，截图与计算样式写tools/_ui-artifacts/modern-selection-style。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { sleep, CdpConnection, JourneyPage } = require('./wormhole-expedition-journey-shared.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tools/_ui-artifacts/modern-selection-style')
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-selection-style-'))
  let child, socket, timer
  try {
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    console.log('owned Chrome PID', child.pid)
    timer = setTimeout(() => child.kill(), 120000)
    let debug
    for (let i = 0; i < 100; i++) { try { debug = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) } }
    assert(debug)
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    const connection = new CdpConnection(socket), page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable'); await page.send('Runtime.enable')
    fs.mkdirSync(output, { recursive: true })
    const tokens = fs.readFileSync(path.join(root, 'packages/ui/src/index.css'), 'utf8')
    const results = []
    for (const layout of ['classic', 'modern']) for (const width of [1366, 390]) {
      const css = fs.readFileSync(path.join(root, `apps/desktop/src/renderer/src/ui/layout-css/styles-${layout}.css`), 'utf8')
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
      const html = `<!doctype html><meta charset="utf-8"><style>${tokens}\n${css}</style>
        <style>.fixture{height:auto!important;min-height:100vh;display:block!important;padding:16px;box-sizing:border-box}.fixture-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:16px 0}.fixture .app-ship-card{min-height:168px}.fixture .app-belt-head{padding:8px}.fixture .app-wh-card{box-sizing:border-box}</style>
        <main class="app-root fixture is-layout-${layout}">
          <section class="app-industry-page"><article class="app-belt-card"><div id="industry-title" class="app-belt-head"><span class="app-belt-name">工业生产卡片</span><span class="app-chip">已学会</span></div><p>标题不额外描边，外层卡片保留。</p></article></section>
          <div id="mining-title" class="app-belt-head">矿带卡头不受影响</div>
          <div class="fixture-row">
            <button id="button-card" class="app-wh-card" aria-pressed="false"><span class="app-wh-card-art">舰影</span><span class="app-wh-card-name">手动 / 自动探索编队</span><span class="app-wh-card-tag">未编入</span></button>
            <label id="label-card" class="app-wh-card"><input type="checkbox"><span class="app-wh-card-art">舰影</span><span class="app-wh-card-name">常驻编队复选卡</span></label>
            <article id="fleet-card" class="app-ship-card is-fleet"><span class="app-ship-name">我的舰队</span><span>未编入</span></article>
          </div>
        </main>`
      await page.send('Page.setDocumentContent', { frameId: (await page.send('Page.getFrameTree')).frameTree.frame.id, html })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
      const read = () => page.js(`(()=>{const out={};for(const id of ['industry-title','mining-title','button-card','label-card','fleet-card']){const el=document.getElementById(id),s=getComputedStyle(el),r=el.getBoundingClientRect();out[id]={border:s.borderTopWidth,color:s.borderTopColor,background:s.backgroundColor,shadow:s.boxShadow,width:r.width,height:r.height}}return out})()`)
      await sleep(250)
      const plain = await read()
      await page.js(`for(const id of ['button-card','label-card'])document.getElementById(id).classList.add('is-picked');document.getElementById('button-card').setAttribute('aria-pressed','true');document.getElementById('label-card').querySelector('input').checked=true;document.getElementById('fleet-card').classList.add('is-combat-selected')`)
      await sleep(250)
      const picked = await read()
      for (const id of ['button-card', 'label-card', 'fleet-card']) {
        assert.notEqual(picked[id].background, plain[id].background, `${layout}/${id} selected background unchanged`)
        assert.notEqual(picked[id].color, plain[id].color, `${layout}/${id} selected border unchanged`)
        assert.equal(picked[id].width, plain[id].width)
        assert.equal(picked[id].height, plain[id].height)
      }
      if (layout === 'modern') {
        assert.equal(picked['industry-title'].border, '0px')
        assert.equal(picked['industry-title'].shadow, 'none')
        assert.notEqual(picked['mining-title'].border, '0px')
      }
      const point = await page.js(`(()=>{const r=document.getElementById('button-card').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`)
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }); await sleep(250)
      const hovered = await read()
      assert.equal(hovered['button-card'].background, picked['button-card'].background)
      await page.js(`document.getElementById('button-card').disabled=true`); await sleep(200)
      const disabled = await read()
      if (layout === 'modern') assert.equal(disabled['button-card'].background, picked['button-card'].background)
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${width}.png`), Buffer.from(image.data, 'base64'))
      results.push({ layout, width, plain, picked, hovered, disabled }); console.log(JSON.stringify({ layout, width, passed: true }))
    }
    assert.equal(connection.errors.length, 0)
    fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify(results, null, 2))
  } finally {
    clearTimeout(timer); socket?.close()
    if (child && child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit }
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith('whale-selection-style-'))
    fs.rmSync(profile, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
