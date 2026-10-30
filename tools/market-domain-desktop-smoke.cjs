/** 市场域拆分的桌面产物回归。
 * 用法：构建后node tools/market-domain-desktop-smoke.cjs。
 * 隐藏Electron与独立合成档；真实鼠标/键盘测试中英买卖、预扣撤单、锁货退款、窄屏详情与IPC重载。
 * 输入当前桌面构建；报告tools/_ui-artifacts/market-domain-desktop-smoke.json。不读个人档，不作观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, settingsScript, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
const root = path.resolve(__dirname, '..'), prefix = 'whale-market-domain-'
const KEY = 'ore-veldspar'

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
  state.modeChosen = true; state.onboarding.step = 99
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.wallet.isk = 10_000_000
  state.warehouse.items[KEY] = 1000
  core.ensureMarket(state, data.buildSimContext())
  state.market.npcBuy[KEY] = [{ price: 5, qty: 2000, expiresAtGameMs: 86400000 }]
  state.market.npcSell[KEY] = [{ price: 9, qty: 2000, expiresAtGameMs: 86400000 }]
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  let child, timer
  try {
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.WHALE_AUTOPERF
    child = spawn(require('electron'), [__filename, '--child'], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
    console.log('自建市场检查Electron PID', child.pid)
    timer = setTimeout(() => child.kill(), 120000)
    const [code] = await once(child, 'exit'); assert.equal(code, 0)
    const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(saved.orders.length, 0)
    assert.equal(saved.escrowItems[KEY] ?? 0, 0)
    assert.equal(saved.warehouse.items[KEY], 1002)
    console.log('两种语言的交易、托管退款与货物真实IPC往返一致')
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped }
    const target = path.resolve(profile)
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(prefix))
    fs.rmSync(target, { recursive: true, force: true })
  }
}

async function child() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(prefix))
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setMinimumSize(200, 200); win.setContentSize(1366, 900); win.webContents.setBackgroundThrottling(false)
  win.webContents.debugger.attach('1.3')
  const errors = [], results = []
  win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable')
  const save = path.join(profile, 'save.json'), savedState = () => core.loadSaveFile(fs.readFileSync(save, 'utf8')).state
  const persist = async () => {
    const before = JSON.parse(fs.readFileSync(save, 'utf8')).savedAtWallMs
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    for (let n = 0; n < 50 && JSON.parse(fs.readFileSync(save, 'utf8')).savedAtWallMs <= before; n++) await sleep(100)
    assert(JSON.parse(fs.readFileSync(save, 'utf8')).savedAtWallMs > before, '未确认真实IPC保存')
    return savedState()
  }
  const reload = async () => {
    const loaded = once(win.webContents, 'did-finish-load'); win.webContents.reload(); await loaded
    await page.wait('!!document.querySelector(".app-root")'); await dismissOverlays(page)
  }
  const search = async () => {
    await page.tap('.app-mkt-search-input')
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await page.send('Input.insertText', { text: KEY })
    await page.wait('document.querySelectorAll(".app-mkt-row-click").length===1')
    await page.tap('.app-mkt-row-click')
  }
  const qty = '.app-mkt-trade-row input[type=number]'
  const price = '.app-mkt-trade-row:last-child input[type=number]'
  for (const locale of ['zh', 'en']) {
    win.setContentSize(1366, 900)
    await page.wait('!!document.querySelector(".app-root")')
    await page.js(settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { locale, debug: false, test: false }))
    await reload()
    const t = id => data.L10N[id][locale]
    await page.tap('[data-nav-page="market"]')
    await search()
    await page.wait('!!document.querySelector(".app-mkt-detail")')
    const initial = await persist()
    const expectedBuy = structuredClone(initial)
    assert.equal(core.buyAtMarket(expectedBuy, data.buildSimContext(locale), KEY, 3).bought, 3)
    await page.number(qty, 3)
    await page.text('.app-mkt-actions', t('ui.MarketPage.058'))
    const bought = await persist()
    assert.equal(bought.warehouse.items[KEY], initial.warehouse.items[KEY] + 3)
    assert.equal(bought.wallet.isk, expectedBuy.wallet.isk)
    await page.text('.app-mkt-sides', t('ui.MarketPage.053'))
    await page.number(qty, 2)
    const expectedSell = structuredClone(bought)
    assert.equal(core.marketSellHolding(expectedSell, data.buildSimContext(locale), KEY, 2).sold, 2)
    await page.text('.app-mkt-actions', t('ui.CargoPage.038'))
    const sold = await persist()
    assert.equal(sold.warehouse.items[KEY], initial.warehouse.items[KEY] + 1)
    assert.equal(sold.wallet.isk, expectedSell.wallet.isk)
    // 先用明显低于供应价的买单确认预扣与撤单退款。
    await page.text('.app-mkt-sides', t('ui.MarketPage.052'))
    await page.number(qty, 4); await page.number(price, 1)
    await page.text('.app-mkt-actions', t('ui.MarketPage.055'))
    const reserved = await persist()
    assert.equal(reserved.orders.length, 1)
    assert.equal(reserved.orders[0].escrowIsk, 4)
    assert.equal(reserved.wallet.isk, sold.wallet.isk - 4)
    await page.tap('.app-mkt-tabs > button:first-child')
    await page.wait('!!document.querySelector(".app-mkt-left .is-warn")')
    await page.text('.app-mkt-left', t('ui.MarketPage.097'))
    assert.equal((await persist()).wallet.isk, sold.wallet.isk)
    // 高于收购价的卖单只锁货，撤销须完整回仓。
    await search()
    await page.text('.app-mkt-sides', t('ui.MarketPage.053'))
    await page.number(qty, 6); await page.number(price, 14)
    await page.text('.app-mkt-actions', t('ui.MarketPage.056'))
    const locked = await persist()
    assert.equal(locked.orders.length, 1)
    assert.equal(locked.escrowItems[KEY], 6)
    assert.equal(locked.warehouse.items[KEY], sold.warehouse.items[KEY] - 6)
    await page.tap('.app-mkt-tabs > button:first-child')
    await page.text('.app-mkt-left', t('ui.MarketPage.097'))
    const refunded = await persist()
    assert.equal(refunded.warehouse.items[KEY], sold.warehouse.items[KEY])
    assert.equal(refunded.orders.length, 0)
    // 只调整自建窗口宽度，不伪装实体手机；点单后浮窗与宽屏共用详情组件。
    win.setContentSize(1000, 900)
    await page.wait('!!document.querySelector(".app-mkt-detail-modal")')
    await page.text('.app-mkt-detail-modal .app-modal-head', t('ui.App.086'))
    await page.wait('!document.querySelector(".app-mkt-detail-modal")')
    await search()
    await page.wait('!!document.querySelector(".app-mkt-detail-modal")')
    assert.equal(await page.js('document.querySelectorAll(".app-mkt-right .app-mkt-detail").length'), 0)
    await page.text('.app-mkt-detail-modal .app-modal-head', t('ui.App.086'))
    await page.wait('!document.querySelector(".app-mkt-detail-modal")')
    await persist(); await reload()
    const reloaded = savedState()
    assert.equal(reloaded.wallet.isk, refunded.wallet.isk)
    assert.equal(reloaded.warehouse.items[KEY], refunded.warehouse.items[KEY])
    assert.equal(reloaded.orders.length, 0)
    results.push({ locale, marketBuySell: true, buyEscrowRefund: true, sellStockRefund: true, narrowDetail: true, reloaded: true })
    console.log('市场中英操作完成', locale)
  }
  assert.deepEqual(errors, [])
  const report = { ok: true, target: 'desktop-production', syntheticOnly: true, hidden: true, results, IPCSaved: true, runtimeErrors: 0 }
  fs.mkdirSync(path.join(root, 'tools/_ui-artifacts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools/_ui-artifacts/market-domain-desktop-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report)); app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
