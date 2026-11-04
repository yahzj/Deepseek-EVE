/**
 * 我的舰队卡牌参考与交互核验：先 npm run build，再 node tools/fleet-ui-reference.cjs。
 * 使用独立合成档、生产构建和隐藏 Electron；输出截图供船长审核，不读取个人存档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/fleet-ui-reference')
const PREFIX = 'whale-fleet-ui-reference-'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const data = require('../packages/data/src/index.ts')
  const { injectCommandFleetAllShipsFixture } = require('./command-fleet-all-ships-fixture.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 20261031 })
  injectCommandFleetAllShipsFixture(state)
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let child, timer
  try {
    await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()), 'utf8')
    await fs.writeFile(path.join(profile, 'fixture.json'), JSON.stringify({ announcement: data.ANNOUNCEMENTS[0].id }), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_FLEET_REFERENCE: '1' }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF', 'NODE_OPTIONS']) delete env[key]
    child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
    timer = setTimeout(() => child.kill(), 60_000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    console.log(`舰队卡牌参考图已生成：${path.join(OUT, 'fleet-cards.png')}`)
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped }
    const absolute = path.resolve(profile)
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
    assert(path.basename(absolute).startsWith(PREFIX))
    await fs.rm(absolute, { recursive: true })
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  const profile = process.env.WHALE_PERF_USERDATA
  assert(profile && path.basename(profile).startsWith(PREFIX))
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1540, 940)
  win.webContents.debugger.attach('1.3')
  const page = {
    send: (method, params = {}) => win.webContents.debugger.sendCommand(method, params),
    js: async expression => {
      const result = await win.webContents.debugger.sendCommand('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    },
  }
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  for (let i = 0; i < 100; i++) {
    if (await page.js('!!document.querySelector(".app-root")')) break
    await sleep(100)
  }
  await page.js('(()=>{const b=[...document.querySelectorAll(".app-pro-mode-card")].find(x=>!x.classList.contains("is-iron"));b?.click()})()')
  for (let i = 0; i < 40; i++) {
    const close = await page.js(`(()=>{for(const selector of ['.app-comm-pop .app-comms-eave-extra button','.app-comm-mask .app-comm-foot button','.app-modal-mask .app-comms-eave-extra button','.app-ann-mask button']){if(document.querySelector(selector))return selector}return null})()`)
    if (!close) { await sleep(100); continue }
    await page.js(`document.querySelector(${JSON.stringify(close)})?.click()`)
    await sleep(120)
  }
  await sleep(300)
  await page.js('(()=>{const b=[...document.querySelectorAll(".app-nav-side button")].find(x=>x.getAttribute("data-nav-page")==="ship");b?.click()})()')
  let ready = false
  for (let i = 0; i < 80; i++) {
    ready = await page.js(`(()=>{
      const grid = document.querySelector('[data-fleet-card-grid]')
      const link = document.querySelector('#whale-layout-style')
      return !!grid && !!link?.sheet && getComputedStyle(grid).display === 'grid'
    })()`)
    if (ready) break
    await sleep(100)
  }
  assert(ready, '未加载舰队卡牌网格样式')
  await page.js('document.fonts?.ready')
  await sleep(250)
  await fs.mkdir(OUT, { recursive: true })
  const snapshot = () => page.js(`(()=>{
    const cards = [...document.querySelectorAll('[data-fleet-ship]')]
    return {
      order: cards.map(card => card.dataset.fleetShip),
      selected: cards.filter(card => card.classList.contains('is-combat-selected')).length,
      history: cards.filter(card => card.classList.contains('is-formation-history')).map(card => card.dataset.fleetShip),
      summary: document.querySelector('.app-fleet-command-summary')?.innerText,
      independentDeck: !!document.querySelector('[data-fleet-command-deck]'),
      buttons: document.querySelectorAll('[data-command-ship]').length
    }
  })()`)
  const initial = await snapshot()
  assert.equal(initial.order.length, 51)
  assert.equal(initial.buttons, 51)
  assert.equal(initial.selected, 12)
  assert.equal(initial.independentDeck, false)
  assert.deepEqual(initial.order.slice(0, 12), initial.history)

  const removable = await page.js(`(()=>{
    const button = document.querySelector('[data-command-ship][aria-pressed="true"]:not(:disabled)')
    const uid = button?.dataset.commandShip
    button?.click()
    return uid
  })()`)
  assert(removable)
  await sleep(150)
  const removed = await snapshot()
  assert.equal(removed.selected, 11)
  assert.deepEqual(removed.order, initial.order)
  assert(removed.summary.includes('115 / 125'))
  await page.js(`document.querySelector('[data-command-ship=' + CSS.escape(${JSON.stringify(removable)}) + ']')?.click()`)
  await sleep(150)
  const restored = await snapshot()
  assert.equal(restored.selected, 12)
  assert.deepEqual(restored.order, initial.order)
  assert.equal(restored.summary, initial.summary)
  await page.js('document.querySelector(\'[data-command-ship][aria-pressed="false"]:not(:disabled)\')?.click()')
  await sleep(150)
  assert.equal((await snapshot()).selected, 12, '已满编时不能继续编入')
  assert.equal(await page.js('document.querySelector(\'.is-current [data-command-ship]\').disabled'), true)
  await page.js('document.querySelector(".app-toast")?.click()')

  await page.js('document.querySelector(".is-current .app-lock-btn").click()')
  await sleep(100)
  assert.equal(await page.js('document.querySelector(".is-current .app-lock-btn").classList.contains("is-warn")'), true)
  await page.js('document.querySelector(".is-current .app-lock-btn").click()')
  await sleep(100)
  assert.equal(await page.js('document.querySelector(".is-current .app-lock-btn").classList.contains("is-warn")'), false)
  await page.js(`([...document.querySelectorAll('.is-current .app-ship-top-right button')].find(button => button.innerText.trim() === '改名')).click()`)
  await sleep(100)
  assert.equal(await page.js('!!document.querySelector(".is-current .app-rename-input")'), true)
  await page.js('document.querySelector(".is-current .app-rename-row button:last-child").click()')
  await sleep(100)
  assert.equal(await page.js('!!document.querySelector(".is-current .app-rename-input")'), false)
  await page.js('document.querySelector(".app-toast")?.click()')

  const reports = []
  for (const [name, width, height] of [['fleet-cards', 1540, 940], ['fleet-cards-narrow', 1100, 900], ['fleet-cards-mobile', 375, 812]]) {
    if (width < 600) {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height,
        deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      await page.js('window.dispatchEvent(new Event("resize"))')
    } else win.setContentSize(width, height)
    await sleep(300)
    await page.js('document.querySelector(".app-fleet-scroll").scrollTop = 0')
    const geometry = await page.js(`(()=>{
      const grid = document.querySelector('[data-fleet-card-grid]')
      const cards = [...grid.querySelectorAll('[data-fleet-ship]')]
      const escapedControls = cards.flatMap(card => [...card.querySelectorAll('button,input')].filter(button => {
        const r = button.getBoundingClientRect(), c = card.getBoundingClientRect()
        return r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1
      }).map(button => ({ uid: card.dataset.fleetShip, text: button.innerText })))
      return {
        viewport: { width: innerWidth, height: innerHeight },
        layout: document.querySelector('.app-root').className,
        cards: cards.length,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        escapedControls,
        horizontalOverflow: document.querySelector('.app-fleet-scroll').scrollWidth - document.querySelector('.app-fleet-scroll').clientWidth,
        firstCard: cards[0].innerText,
        oldSlots: document.querySelectorAll('.app-fleet-deck-slot').length
      }
    })()`)
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
    await fs.writeFile(path.join(OUT, `${name}.png`), Buffer.from(screenshot.data, 'base64'))
    if (geometry.escapedControls.length || geometry.horizontalOverflow > 1) {
      await fs.writeFile(path.join(OUT, 'geometry-failure.json'), JSON.stringify({ name, ...geometry }, null, 2))
    }
    assert.equal(geometry.escapedControls.length, 0, '卡内操作按钮溢出')
    assert(geometry.horizontalOverflow <= 1, '舰队列表发生横向溢出')
    assert.equal(geometry.oldSlots, 0)
    reports.push({ name, ...geometry })
  }
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, isolated: true,
    interaction: { initialSelected: initial.selected, removedSelected: removed.selected, restoredSelected: restored.selected,
      maxShipsGuard: true, pilotGuard: true, stableOrder: true, historyFirst: true, lockToggle: true, renameOpenCancel: true }, reports }, null, 2) + '\n', 'utf8')
  win.webContents.debugger.detach()
  app.exit(0)
}

if (process.argv.includes('--child') && process.env.WHALE_FLEET_REFERENCE === '1') child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
