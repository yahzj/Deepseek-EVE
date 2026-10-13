/** 停靠规则原生操作验收：npm run build后node tools/station-action-native-check.cjs。
 * 经典/现代桌面，合成档、隐藏Electron、自建回环服务和临时userData；不读取个人档。
 * 实际点击黑市交易/副船卸货/维修；--pending验排队/取消/重载/到港启动，IPC存盘核对。
 * 输出tools/_ui-artifacts/station-action，不作观感结论；接续推进复用已有本机隔离测试桥。
 * v0.1.0 / 存档v31，2026-10-13。--case=classic或modern可单跑。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, staticServer, settingsScript, stopOwned, removeProfile, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { injectStationActionFixture } = require('./station-action-fixture.ts')
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(ROOT, 'tools/_ui-artifacts/station-action'), PREFIX = 'whale-station-action-'
const pendingMode = process.argv.includes('--pending')

async function parent() {
  fs.mkdirSync(OUT, { recursive: true })
  const dist = path.join(ROOT, 'apps/desktop/out/renderer')
  const built = fs.statSync(path.join(dist, 'index.html')).mtimeMs
  for (const source of ['packages/core/src/shipActionPolicy.ts', 'packages/core/src/shipyard.ts', 'packages/core/src/industry.ts',
    'packages/core/src/engine.ts', 'packages/core/src/stationActivityPending.ts', 'packages/core/src/save.ts',
    'apps/desktop/src/renderer/src/pages/IndustryPage.tsx', 'apps/desktop/src/renderer/src/panels/ActivityBar.tsx',
    'apps/desktop/src/renderer/src/panels/ActivityBarClassic.tsx',
    'apps/desktop/src/renderer/src/pages/CargoPage.tsx', 'apps/desktop/src/renderer/src/pages/ItemsPage.tsx', 'apps/desktop/src/renderer/src/pages/ShipPage.tsx']) {
    assert(fs.statSync(path.join(ROOT, source)).mtimeMs <= built, `构建陈旧:${source}`)
  }
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
  if (selected) assert(['classic', 'modern'].includes(selected))
  const reports = []
  for (const layout of ['classic', 'modern']) {
    if (selected && layout !== selected) continue
    const state = core.createInitialState({ nowWallMs: Date.now() })
    injectStationActionFixture(state)
    if (pendingMode) {
      state.fleet[state.shipId].cargo = { 'ore-veldspar': 200 }
      state.warehouse.items['ore-veldspar'] = 1000
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    let server, child, timer
    try {
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, pendingMode ? Date.now() + 120000 : Date.now()), 'utf8')
      const hosted = await staticServer(dist, { initialize: settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { layout }) })
      server = hosted.server
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: hosted.url, WH_STATION_LAYOUT: layout, WH_STATION_PENDING: pendingMode ? '1' : '0' }
      delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
      console.log('停靠专项自建Electron PID', child.pid)
      timer = setTimeout(() => child.kill(), 90000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
      const after = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.equal(after.shipId, state.shipId)
      if (pendingMode) {
        assert.equal(after.mining.active, false)
        assert.equal(after.pendingStationActivity, undefined)
        assert.equal(after.shipReturns[state.shipId], undefined)
        assert.deepEqual(after.fleet[state.shipId].cargo, {})
        assert.equal(after.refineRuns[0].worker, 'pilot')
        assert.equal(after.refineRuns[0].batchesDone, 1)
        assert.equal(after.warehouse.items['ore-veldspar'], 1200 - after.refineRuns[0].batchUnits)
        reports.push({ layout, pending: true, IPCSaved: true, queue: true, cancelKeepsReturn: true,
          reload: true, beforeArrivalNoWork: true, realArrivalStarts: true, oneBatch: true })
        continue
      }
      assert(after.mining.active)
      assert.deepEqual(after.fleet[state.shipId].cargo, state.fleet[state.shipId].cargo)
      const idle = Object.values(after.fleet).find(ship => ship.customName === '港内副船')
      assert.deepEqual(idle.cargo, {})
      assert.equal(idle.durability, 1); assert.equal(idle.armorPct, 1)
      assert(after.blackMarket.offers.some(offer => offer.sold))
      reports.push({ layout, IPCSaved: true, remoteMarket: true, busyCargoBlocked: true, idleCargo: true, idleRepair: true, miningUnchanged: true })
    } finally {
      clearTimeout(timer)
      await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, PREFIX)
    }
  }
  fs.writeFileSync(path.join(OUT, pendingMode ? 'pending-readings.json' : 'readings.json'), JSON.stringify({ ok: true, reports }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, reports }))
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  assert.equal(new URL(process.env.ELECTRON_RENDERER_URL).hostname, '127.0.0.1')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768); win.webContents.setBackgroundThrottling(false)
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  const tap = page.tap.bind(page)
  page.tap = async (selector, options) => {
    try { return await tap(selector, options) }
    catch (error) {
      const image = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT, `failure-${process.env.WH_STATION_LAYOUT}.png`), Buffer.from(image.data, 'base64'))
      console.error(await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return 'missing';const b=e.getBoundingClientRect();return {rect:{x:b.x,y:b.y,w:b.width,h:b.height},hit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML.slice(0,1000)}})()`))
      throw error
    }
  }
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
  await sleep(300)
  if (process.env.WH_STATION_LAYOUT === 'modern' && await page.js(`document.querySelector('.app-log-side')?.getBoundingClientRect().width > 1`)) {
    await page.tap('.app-log-head-right button')
    await page.wait('document.querySelector(".app-log-side").getBoundingClientRect().width < 1')
  }
  const t = id => data.L10N[id].zh
  const before = await page.snapshot()
  const idleId = Object.keys(before.fleet).find(id => before.fleet[id].customName === '港内副船')
  const repairCost = core.repairCostIsk(before, idleId, data.buildSimContext())
  const markButton = async (scope, text, attr) => {
    await page.js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('按钮缺失:'+${JSON.stringify(text)});e.setAttribute(${JSON.stringify(attr)},'1')})()`)
    return `[${attr}]`
  }
  if (process.env.WH_STATION_PENDING === '1') {
    await page.wait('!!window.__whalePlanetaryTest')
    const oreName = data.buildSimContext().items.get('ore-veldspar').name
    const openOre = async () => {
      await page.text('.app-nav-side', t('ui.App.006'))
      await page.js(`(()=>{const card=[...document.querySelectorAll('.app-belt-card')].find(e=>e.querySelector('.app-belt-name')?.textContent.includes(${JSON.stringify(oreName)}));if(!card)throw Error('精炼卡未显示');card.setAttribute('data-station-ore','1')})()`)
      return markButton('[data-station-ore] button', t('ui.IndustryPage.050'), 'data-station-start')
    }
    const pendingRow = async () => {
      await page.wait(`[...document.querySelectorAll('.app-activitybar-item')].some(e=>e.textContent.includes(${JSON.stringify(oreName)})&&e.textContent.includes(${JSON.stringify(t('core.busy.020'))}))`)
      await page.js(`(()=>{const row=[...document.querySelectorAll('.app-activitybar-item')].find(e=>e.textContent.includes(${JSON.stringify(oreName)})&&e.textContent.includes(${JSON.stringify(t('core.busy.020'))}));row.setAttribute('data-station-pending','1')})()`)
      assert.equal(await page.js(`document.querySelector('[data-station-pending] button').textContent.trim()`), t('ui.ActivityBar.004'))
    }
    await page.tap(await openOre())
    await pendingRow()
    const queued = await page.snapshot()
    assert(queued.pendingStationActivity)
    assert.equal(queued.refineRuns.length, 0)
    assert.deepEqual(queued.warehouse, before.warehouse)
    assert.equal(queued.fleet[queued.shipId].cargo['ore-veldspar'], 200)
    await page.command('persist')
    await page.send('Page.reload')
    await page.wait('!!window.__whExpeditionTest && !!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
    await pendingRow()
    const reloaded = await page.snapshot()
    assert.deepEqual(reloaded.pendingStationActivity, queued.pendingStationActivity)
    assert.deepEqual(reloaded.shipReturns, queued.shipReturns)
    await page.tap('[data-station-pending] button')
    const cancelled = await page.snapshot()
    assert.equal(cancelled.pendingStationActivity, undefined)
    assert.deepEqual(cancelled.shipReturns, queued.shipReturns)
    await page.tap(await openOre())
    assert.equal((await page.snapshot()).refineRuns.length, 0)
    await page.js('window.__whalePlanetaryTest.step(1)')
    const moving = await page.snapshot()
    const remaining = moving.shipReturns[moving.shipId].legMs - moving.shipReturns[moving.shipId].phaseAccMs
    assert(remaining > 1)
    await page.js(`window.__whalePlanetaryTest.step(${remaining - 1})`)
    const almost = await page.snapshot()
    assert.equal(almost.refineRuns.length, 0)
    assert.equal(almost.warehouse.items['ore-veldspar'], before.warehouse.items['ore-veldspar'])
    await page.js('window.__whalePlanetaryTest.step(1)')
    const arrived = await page.snapshot()
    assert.equal(arrived.pendingStationActivity, undefined)
    assert.equal(arrived.refineRuns[0].batchesDone, 0)
    assert.equal(arrived.warehouse.items['ore-veldspar'], 1200)
    await page.wait(`!document.body.textContent.includes(${JSON.stringify(t('core.busy.020'))})`)
    await page.js(`window.__whalePlanetaryTest.step(${arrived.refineRuns[0].cycleMs})`)
    const final = await page.snapshot()
    assert.equal(final.refineRuns[0].batchesDone, 1)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    await page.command('persist')
    const shot = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT, `pending-${process.env.WH_STATION_LAYOUT}.png`), Buffer.from(shot.data, 'base64'))
    console.log(JSON.stringify({ ok: true, pending: true, layout: process.env.WH_STATION_LAYOUT, electronPid: process.pid }))
    app.exit(0)
    return
  }
  await page.text('.app-nav-side', t('ui.App.004'))
  await page.tap('.app-subtabs button[role=tab]:nth-child(2)')
  const unload = await markButton('.app-cargo-head button', t('ui.CargoPage.037'), 'data-station-unload')
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(unload)}).disabled`), true)
  await page.text('.app-cargo-ships', '港内副船')
  const idleUnload = await markButton('.app-cargo-head button', t('ui.CargoPage.037'), 'data-station-idle-unload')
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(idleUnload)}).disabled`), false)
  await page.tap(idleUnload)
  await page.wait(`document.querySelector('.app-cargo-head button').disabled`)
  await page.text('.app-nav-side', t('ui.App.002'))
  await page.js(`(()=>{const card=[...document.querySelectorAll('.app-ship-card.is-fleet')].find(e=>e.textContent.includes('港内副船'));if(!card)throw Error('副船卡缺失');card.setAttribute('data-station-idle-card','1')})()`)
  const repair = await markButton('[data-station-idle-card] button', t('ui.ShipPage.024') + ' ' + repairCost.toLocaleString('zh-CN'), 'data-station-repair')
  await page.tap(repair)
  await page.wait(`![...document.querySelectorAll('[data-station-idle-card] button')].some(e=>e.textContent.trim().startsWith(${JSON.stringify(t('ui.ShipPage.024'))}))`)
  await page.text('.app-nav-side', t('ui.App.005'))
  await page.tap('.app-mkt-tabs .app-bm-entry')
  await page.wait('document.querySelectorAll(".app-bm-card").length > 0')
  await page.tap('.app-bm-card .app-bm-buy')
  await page.wait('!!document.querySelector(".app-bm-confirm")')
  await page.tap('.app-bm-confirm-actions button:last-child')
  await page.wait('!!document.querySelector(".app-bm-card.is-sold")')
  const after = await page.snapshot()
  assert.deepEqual(after.mining, before.mining)
  assert.equal(after.shipId, before.shipId)
  assert.equal(after.warehouse.items['ammo-kinetic-l'], before.warehouse.items['ammo-kinetic-l'] + 60)
  const sold = after.blackMarket.offers.find(offer => offer.sold)
  assert.equal(after.wallet.isk, before.wallet.isk - repairCost - sold.price)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  await page.command('persist')
  const image = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${process.env.WH_STATION_LAYOUT}.png`), Buffer.from(image.data, 'base64'))
  console.log(JSON.stringify({ ok: true, layout: process.env.WH_STATION_LAYOUT, electronPid: process.pid, remoteBuy: true }))
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
