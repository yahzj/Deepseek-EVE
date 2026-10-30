/** 入侵/声望商店验收：构建后node tools/standing-economy-native-check.cjs。
 * 独立合成59/60声望档、隐藏Electron、双布局桌面/模拟手机，检查参数、确认和真实扣款。
 * WHALE_ELECTRON_EXE可借用本机运行时；输出门槛档/截图/读数至_ui-artifacts，不读个人档。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, JourneyPage, staticServer, settingsScript, sleep, stopOwned, removeProfile } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/standing-economy-20261030')

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const { buildSimContext } = require('../packages/data/src/context.ts')
  const { ANNOUNCEMENTS } = require('../packages/data/src/announcements.ts')
  const ctx = buildSimContext(), reports = []
  await fs.mkdir(OUT, { recursive: true })
  for (const earned of [59, 60]) {
    const now = Date.now()
    const state = core.createInitialState({ nowWallMs: now, seed: 30 })
    state.modeChosen = true
    state.onboarding.step = 99
    for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true, delivered: 0 }
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    // 合法已结算场封住本期自动开场，手动点火仍由实际入口校验累计门槛。
    state.weekendEvent = { ...core.weekendRollOccupation(state, ctx, 1), seq: 1, startedAtWallMs: now - 1000,
      endedAtWallMs: now, family: 'H', contributed: {}, flagshipDown: 'player', beaconLit: true }
    core.weekendSettleAndGrant(state, ctx, now)
    state.standings.dsi = earned
    state.standingsEarned = { dsi: earned }
    for (const { itemId } of core.INVASION_BEACON_TYPES) core.addWare(state, itemId, 2)
    const save = core.serializeSaveFile(state)
    await fs.writeFile(path.join(OUT, `test-save-standing-economy-${earned}-20261030.json`), save, 'utf8')
    for (const layout of ['classic', 'modern']) {
      const prefix = 'whale-standing-economy-'
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
      let child, server, timer
      try {
        const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), {
          initialize: settingsScript(ANNOUNCEMENTS[0]?.id, undefined, { layout, debug: false, test: false }),
        })
        server = served.server
        await fs.writeFile(path.join(profile, 'save.json'), save, 'utf8')
        const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: served.url,
          STANDING_LAYOUT: layout, STANDING_EARNED: String(earned) }
        delete env.ELECTRON_RUN_AS_NODE
        child = spawn(process.env.WHALE_ELECTRON_EXE || require('electron'), [__filename, '--child'], {
          cwd: ROOT, env, windowsHide: true, stdio: 'inherit',
        })
        console.log(`声望经济${earned}/${layout} 自建PID=${child.pid}`)
        timer = setTimeout(() => child.kill(), 60000)
        const [code] = await once(child, 'exit')
        assert.equal(code, 0)
        reports.push(JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8')))
      } finally {
        clearTimeout(timer)
        await stopOwned(child)
        if (server) await new Promise(resolve => server.close(resolve))
        await removeProfile(profile, prefix)
      }
    }
  }
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(reports, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, profiles: reports.length, viewports: 8, output: OUT }))
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], rows = [], errors = []
  const earned = Number(process.env.STANDING_EARNED), layout = process.env.STANDING_LAYOUT
  win.setMinimumSize(200, 200)
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable')
  // fixed浮层已脱离祖先裁切，按真实命中点检查，不套普通滚动内容的祖先边界。
  const tapFixed = async selector => {
    const point = await page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)throw Error('浮层控件缺失');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(hit!==el&&!el.contains(hit))throw Error('浮层控件被遮挡');return {x,y}})()`)
    if (page.touch) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
    }
    await sleep(120)
  }
  const nav = async label => {
    await page.js(`(()=>{const el=[...document.querySelectorAll('.app-nav-item')].find(e=>e.querySelector(':scope > span:last-child')?.textContent.trim()===${JSON.stringify(label)});if(!el)throw Error('导航缺失');el.setAttribute('data-standing-nav','1')})()`)
    await page.tap('[data-standing-nav="1"]')
    await page.js(`document.querySelector('[data-standing-nav]')?.removeAttribute('data-standing-nav')`)
  }
  for (const mobile of [false, true]) {
    if (mobile) {
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844,
        deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      page.touch = true
      await page.send('Page.reload', { ignoreCache: true })
    } else win.setContentSize(1366, 768)
    await page.wait('!!document.querySelector(".app-root")')
    await sleep(500)
    for (let n = 0; n < 25 && await page.js('!!document.querySelector(".app-comms-eave-extra button")'); n++) await page.tap('.app-comms-eave-extra button')
    if (mobile) await page.wait('document.querySelector(".app-root").classList.contains("is-mobile-rot")')
    await nav('物品')
    await page.js(`(()=>{const name=[...document.querySelectorAll('.app-hand-cell-name')].find(e=>e.textContent.trim()==='信号发射器');if(!name)throw Error('发射器物品卡缺失');name.closest('.app-hand-cell').setAttribute('data-standing-check','item')})()`)
    await page.tap('[data-standing-check="item"]')
    await page.wait('!!document.querySelector(".app-itempick-name")')
    const spec = await page.js(`document.querySelector('.app-itempick-name').closest('.app-fit-modal').innerText`)
    assert.match(spec, /声望\s*60/)
    await tapFixed('.app-fit-modal-head button')
    await nav('点击 出港')
    await page.text('.page-stack > .app-subtabs', '星图·远征')
    await page.wait('document.querySelectorAll(".app-map-node").length>0')
    await page.js(`(()=>{const node=[...document.querySelectorAll('.app-map-node')].find(e=>e.textContent.includes('红环航道'));if(!node)throw Error('星图目标缺失');node.querySelector('.app-map-dot').setAttribute('data-standing-check','galaxy')})()`)
    await page.tap('[data-standing-check="galaxy"]')
    await page.wait('!!document.querySelector(".app-ga-beacon .is-warn")')
    const gate = await page.js(`(()=>{const el=document.querySelector('.app-ga-beacon .is-warn');return {disabled:el.getAttribute('aria-disabled'),title:el.getAttribute('title'),html:el.outerHTML}})()`)
    assert.equal(gate.disabled === 'true', earned < 60)
    if (earned < 60) assert.match(gate.title ?? gate.html, /60.*59/)
    // 达标时走到二次确认，取消以便后续商店检查保持原库存。
    if (earned >= 60) {
      await tapFixed('.app-ga-beacon .is-warn')
      await page.wait('!!document.querySelector(".app-ga-beacon .is-danger")')
      await tapFixed('.app-ga-beacon button:not(.is-danger)')
    }
    await tapFixed('.app-comm-foot button')
    await page.text('.page-stack > .app-subtabs', '常驻悬赏')
    await page.text('.app-subtabs', '声望商店')
    await page.wait('document.querySelectorAll(".app-shelf-card").length>1')
    const prices = await page.js(`Array.from(document.querySelectorAll('.app-shelf-card .app-chip.is-exotic'),e=>Number(e.textContent.trim()))`)
    assert.equal(prices[0], 60)
    assert(prices.slice(1).every(price => price === 20))
    let boxConfirm = null, bpConfirm = null
    if (earned >= 60) {
      await page.tap('.app-shelf-card:first-child button')
      boxConfirm = await page.js(`document.querySelector('.app-mkt-confirm-note').innerText`)
      assert.match(boxConfirm, /60/)
      assert.match(boxConfirm, new RegExp(String(earned - 60)))
      await tapFixed('.app-mkt-confirm-btns button:not(.is-primary)')
    } else {
      assert.equal(await page.js(`document.querySelector('.app-shelf-card:first-child button').disabled`), true)
    }
    await page.tap('.app-shelf-card:nth-child(2) button')
    bpConfirm = await page.js(`document.querySelector('.app-mkt-confirm-note').innerText`)
    assert.match(bpConfirm, /20/)
    assert.match(bpConfirm, new RegExp(String(earned - 20)))
    await tapFixed('.app-mkt-confirm-btns button:not(.is-primary)')
    const geometry = await page.js(`Array.from(document.querySelectorAll('.app-shelf-card .app-belt-head'),el=>({scroll:el.scrollWidth,client:el.clientWidth}))`)
    assert(geometry.every(row => row.client > 0 && row.scroll <= row.client + 1), '价格卡头溢出')
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    assert(!image.isEmpty())
    await fs.writeFile(path.join(OUT, `${earned}-${layout}-${mobile ? 'mobile' : 'desktop'}.png`), image.toPNG())
    rows.push({ mobile, gate, prices, boxConfirm, bpConfirm, geometry })
    if (mobile && earned >= 60) {
      await page.tap('.app-shelf-card:first-child button')
      await tapFixed('.app-mkt-confirm-btns .is-primary')
      await page.wait(`document.querySelector('.app-shelf-card:first-child button')?.disabled===true`)
      await sleep(300)
      const saved = JSON.parse(await fs.readFile(path.join(process.env.WHALE_PERF_USERDATA, 'save.json'), 'utf8')).state
      assert.equal(saved.standings.dsi, earned - 60)
      assert.equal(saved.standingsEarned.dsi, earned)
      assert.equal(saved.warehouse.items['blackbox-universal'], 1)
    }
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ pid: process.pid, earned, layout, rows, errors: 0 }), 'utf8')
  win.destroy()
  app.quit()
}
(process.argv.includes('--child') ? child() : parent()).catch(async error => {
  console.error(error)
  if (process.argv.includes('--child')) {
    const { app, BrowserWindow } = require('electron')
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      const image = await win.webContents.capturePage(undefined, { stayHidden: true })
      await fs.writeFile(path.join(OUT, `failure-${process.env.STANDING_EARNED}-${process.env.STANDING_LAYOUT}.png`), image.toPNG())
    }
    app.exit(1)
  }
  else process.exitCode = 1
})
