/** MK3黑市/装配真实界面回归：先npm run build，再node tools/ammo-mk3-desktop-check.cjs。
 * 全新合成档、隔离userData、隐藏Electron；两版/双语/桌面与手机触控，实际IPC交易和偏好重载。
 * 仅关闭自建PID和校验过的临时目录；输出tools/_ui-artifacts/ammo-mk3，不代替物理真机观感。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { blackMarketTestSave } = require('./black-market-test-fixture.ts')
const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'tools/_ui-artifacts/ammo-mk3')
const TYPES = ['kinetic', 'explosive', 'plasma']
const PREFIX = 'whale-ammo-mk3-'

function fixture(now) {
  const ctx = data.buildSimContext(), state = core.loadSaveFile(blackMarketTestSave(now)).state
  state.shipId = core.addShipToFleet(state, 'sh-hammerhead')
  for (const id of ['mod-turret-kin-1', 'mod-missile-1', 'mod-laser-1']) {
    state.moduleBay[id] = 1
    assert(core.fitModule(state, id, ctx).ok)
  }
  for (const type of TYPES) state.warehouse.items[`ammo-${type}-3`] = 1000
  const books = TYPES.map(type => `bp-ammo-${type}-3`)
  const narrow = { ...ctx, marketGoods: new Map(books.map(id => [id, ctx.marketGoods.get(id)])) }
  const copy = structuredClone(state)
  delete copy.blackMarket
  assert(core.ensureBlackMarket(copy, narrow, now))
  state.blackMarket.offers = [...copy.blackMarket.offers, ...state.blackMarket.offers.filter(row => !books.includes(row.goodKey))].slice(0, 9)
  assert.equal(state.blackMarket.offers.length, 9)
  return state
}

function parent() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
  if (selected) assert(/^(classic|modern)-(zh|en)-(desktop|portrait)$/.test(selected), '未知回归场景')
  const html = path.join(ROOT, 'apps/desktop/out/renderer/index.html')
  const built = fs.statSync(html).mtimeMs
  for (const source of ['packages/data/src/static/items.json', 'packages/data/src/static/market.json', 'packages/data/src/blueprints.ts',
    'packages/core/src/ammoTiers.ts', 'apps/desktop/src/renderer/src/pages/FitPage.tsx', 'apps/desktop/src/renderer/src/pages/MarketPage.tsx']) {
    assert(fs.statSync(path.join(ROOT, source)).mtimeMs <= built, `构建陈旧:${source}`)
  }
  const reports = []
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mode of ['desktop', 'portrait']) {
    if (selected && selected !== `${layout}-${locale}-${mode}`) continue
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    const now = Date.now(), state = fixture(now)
    const offer = state.blackMarket.offers[0]
    try {
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, now), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, AMMO_MK3_CASE: JSON.stringify({ layout, locale, mode }) }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      delete env.WHALE_AUTOPERF
      const child = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true, env, encoding: 'utf8', timeout: 60000 })
      console.log(child.stdout)
      if (child.error) throw child.error
      assert.equal(child.status, 0, child.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert(saved.blackMarket.offers[0].sold)
      assert.equal(saved.wallet.isk, state.wallet.isk - offer.price)
      assert.equal(saved.blueprintStock[offer.goodKey], 1)
      for (const type of TYPES) assert.equal(saved.fleet[state.shipId].ammoPref[type], `ammo-${type}-3`)
      reports.push({ layout, locale, mode, offer: offer.goodKey, total: offer.price, purchased: true, selectedMK3: true, IPCSaved: true, reloadRetained: true })
    } finally {
      const resolved = path.resolve(profile)
      assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(PREFIX))
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
  fs.writeFileSync(path.join(OUTPUT, selected ? `readings-${selected}.json` : 'readings.json'), JSON.stringify({ ok: true, target: path.join(ROOT, 'apps/desktop/out'), reports }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, cases: reports.length, out: OUTPUT }))
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win)
  win.setContentSize(1366, 768)
  const options = JSON.parse(process.env.AMMO_MK3_CASE), mobile = options.mode === 'portrait'
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.wait('!!document.querySelector(".app-root")')
  await page.js(`(()=>{localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)});localStorage.setItem('whale-idle:debug','0')})()`)
  if (mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await page.send('Page.reload')
  await page.wait('!!document.querySelector(".app-root")')
  await sleep(500)
  const text = id => data.L10N[id][options.locale]
  const saved = () => core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
  const offer = saved().blackMarket.offers[0]
  await page.text('.app-nav-side', text('ui.App.005'))
  await page.tap('.app-mkt-tabs .app-bm-entry')
  await page.wait('document.querySelectorAll(".app-bm-card").length===9')
  await page.tap('.app-bm-card .app-bm-buy')
  await page.wait('!!document.querySelector(".app-bm-confirm")')
  const ctx = data.buildSimContext(options.locale)
  assert(String(await page.js('document.querySelector(".app-bm-confirm").textContent')).includes(ctx.blueprints.get(offer.goodKey).name))
  await page.tap('.app-bm-confirm-actions button:last-child')
  await page.wait('!!document.querySelector(".app-bm-card.is-sold")')
  for (let i = 0; i < 60 && !saved().blackMarket.offers[0].sold; i++) await sleep(100)
  assert(saved().blackMarket.offers[0].sold)
  await page.text('.app-nav-side', text('ui.App.003'))
  if (options.layout === 'modern' && !mobile && await page.js(`document.querySelector('.app-log-side')?.getBoundingClientRect().width > 1`)) {
    await page.tap('.app-log-head-right button')
    await page.wait('document.querySelector(".app-log-side").getBoundingClientRect().width < 1')
  }
  await page.wait('document.querySelectorAll(".app-fit-ammotier-opt").length===9')
  for (const type of TYPES) await page.text('.app-fit-ammotier', ctx.items.get(`ammo-${type}-3`).name)
  await page.wait('document.querySelectorAll(".app-fit-ammotier-opt[aria-pressed=true]").length===3')
  const geometry = await page.js(`(()=>{const rows=[...document.querySelectorAll('.app-fit-ammotier-row')];return {rowOverflow:rows.filter(e=>e.scrollWidth>e.clientWidth).length,buttonOverflow:[...document.querySelectorAll('.app-fit-ammotier-opt')].filter(e=>e.scrollWidth>e.clientWidth).length,selected:[...document.querySelectorAll('.app-fit-ammotier-opt[aria-pressed=true]')].map(e=>e.textContent),rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot')}})()`)
  assert.equal(geometry.rowOverflow, 0)
  assert.equal(geometry.buttonOverflow, 0)
  assert(geometry.selected.every(value => value.includes('MK3')))
  if (mobile) assert(geometry.rotated)
  await page.js('window.dispatchEvent(new Event("pagehide"));true')
  for (let i = 0; i < 60 && !TYPES.every(type => saved().fleet[saved().shipId].ammoPref?.[type] === `ammo-${type}-3`); i++) await sleep(100)
  assert(TYPES.every(type => saved().fleet[saved().shipId].ammoPref?.[type] === `ammo-${type}-3`))
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUTPUT, `${options.layout}-${options.locale}-${options.mode}.png`), Buffer.from(shot.data, 'base64'))
  await page.send('Page.reload')
  await page.wait('!!document.querySelector(".app-root")')
  await page.text('.app-nav-side', text('ui.App.003'))
  await page.wait('document.querySelectorAll(".app-fit-ammotier-opt[aria-pressed=true]").length===3')
  assert.deepEqual(await page.js(`[...document.querySelectorAll('.app-fit-ammotier-opt[aria-pressed=true]')].map(e=>e.textContent)`), geometry.selected)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log(JSON.stringify({ ok: true, electronPid: process.pid, ...options, ...geometry }))
  app.exit(0)
}

if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else { try { parent() } catch (error) { console.error(error); process.exitCode = 1 } }
