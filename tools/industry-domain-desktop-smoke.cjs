/** 工业域拆分的桌面产物回归。
 * 用法：构建后node tools/industry-domain-desktop-smoke.cjs。
 * 隐藏Electron、回环静态服务、独立合成档；鼠标/键盘测试经典页与HUD，中英保存重载。
 * 输入当前构建，输出tools/_ui-artifacts/industry-domain-desktop-smoke.json；不读个人档，不作观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, settingsScript, staticServer, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
const root = path.resolve(__dirname, '..'), prefix = 'whale-industry-domain-'

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
  const ctx = data.buildSimContext(), state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
  state.modeChosen = true; state.onboarding.step = 99; state.labOpened = true
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  const station = [...ctx.stations.values()].find(d => d.galaxyId !== 'galaxy-vault')
  state.stationSites[station.id] = { stage: station.tiers.length, delivered: {} }
  state.learnedRecipes.push('bp-turret-1')
  state.blueprintStock['bp-turret-1'] = 2
  for (const material of ctx.blueprints.get('bp-turret-1').materials) state.warehouse.items[material.itemId] = material.count * 10
  for (const material of ctx.labRecipes.get('jump-fuel').materials) state.warehouse.items[material.itemId] = (state.warehouse.items[material.itemId] ?? 0) + material.units * 10
  state.warehouse.items['ore-veldspar'] = 1000
  state.warehouse.items['box-valuables'] = 2
  state.aiCores.basic = 3
  state.skills.trained[ctx.balance.aiCore.skillId] = 5
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  let child, server, timer
  try {
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()))
    const hosted = await staticServer(path.join(root, 'apps/desktop/out/renderer'), {
      initialize: settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { debug: true, test: false }),
    })
    server = hosted.server
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: hosted.url }
    delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
    child = spawn(require('electron'), [__filename, '--child'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    console.log('自建工业检查Electron PID', child.pid)
    timer = setTimeout(() => child.kill(), 150000)
    const [code] = await once(child, 'exit'); assert.equal(code, 0)
    const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(saved.manufacturingRuns.length, 0)
    assert.equal(saved.labRuns?.length ?? 0, 0)
    assert.equal(saved.refineRuns.length, 0)
    assert.equal(saved.aiCores.basic, 3)
    assert.equal(saved.blueprintStock['bp-turret-1'], 2)
    assert.equal(saved.manufacturingLoops['bp-turret-1'].goal, 7)
    assert.equal(saved.labLoops['jump-fuel'].goal, 9)
    for (const material of ctx.blueprints.get('bp-turret-1').materials) assert.equal(saved.warehouse.items[material.itemId], state.warehouse.items[material.itemId])
    console.log('实际投料/退料、核心归还、循环目标真实IPC往返一致')
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped }
    if (server) await new Promise(resolve => server.close(resolve))
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
  assert.equal(new URL(process.env.ELECTRON_RENDERER_URL).hostname, '127.0.0.1')
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768); win.webContents.setBackgroundThrottling(false)
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
    assert(JSON.parse(fs.readFileSync(save, 'utf8')).savedAtWallMs > before)
  }
  const input = async (selector, value) => {
    await page.tap(selector)
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await page.send('Input.insertText', { text: value })
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
  }
  const markCard = async (name, attr = 'data-industry-card') => {
    await page.wait(`!![...document.querySelectorAll('.ind-pane:not(.is-off) .app-belt-card')].find(e=>e.querySelector('.app-belt-name')?.textContent.includes(${JSON.stringify(name)}))`)
    await page.js(`(()=>{document.querySelector('[${attr}]')?.removeAttribute('${attr}');const e=[...document.querySelectorAll('.ind-pane:not(.is-off) .app-belt-card')].find(e=>e.querySelector('.app-belt-name')?.textContent.includes(${JSON.stringify(name)}));e.setAttribute('${attr}','1')})()`)
    return `[${attr}]`
  }
  const tab = index => page.tap(`.page-stack > .app-subtabs > button:nth-child(${index})`)
  for (const locale of ['zh', 'en']) {
    await page.wait('!!document.querySelector(".app-root")')
    await page.js(settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { locale, debug: true, test: false }))
    const loaded = once(win.webContents, 'did-finish-load'); win.webContents.reload(); await loaded
    await page.wait('!!document.querySelector(".app-root")'); await dismissOverlays(page)
    const ctx = data.buildSimContext(locale), t = id => data.L10N[id][locale]
    await page.tap('[data-nav-page="industry"]')
    await page.wait('!!document.querySelector(".ind-pane:not(.is-off)")')
    await input('.ind-pane:not(.is-off) .app-head-search', ctx.items.get('box-valuables').name)
    let card = await markCard(ctx.items.get('box-valuables').name)
    await page.text(card, t('ui.IndustryPage.048'))
    await page.wait(`!!document.querySelector('${card} .app-belt-worker')`)
    await page.text(card + ' .app-belt-worker', t('ui.IndustryPage.104'))
    await tab(2)
    await input('.ind-pane:not(.is-off) .app-head-search', ctx.modules.get('mod-turret-kin-1').name)
    card = await markCard(ctx.blueprints.get('bp-turret-1').name)
    await persist(); const before = savedState()
    await page.text(card, t('ui.Industry.071'))
    await page.wait(`!!document.querySelector('${card} .app-mf-run') || !!document.querySelector('${card} .app-progress-mini')`)
    await persist()
    assert.equal(savedState().manufacturingRuns.length, 1)
    for (const m of ctx.blueprints.get('bp-turret-1').materials) assert.equal(savedState().warehouse.items[m.itemId], before.warehouse.items[m.itemId] - core.matNeedCount(before, m.count, 'bp-turret-1'))
    await page.text(card, t('ui.Industry.070'))
    await persist()
    for (const m of ctx.blueprints.get('bp-turret-1').materials) assert.equal(savedState().warehouse.items[m.itemId], before.warehouse.items[m.itemId])
    if (locale === 'zh') await page.tap(card + ' .app-toggle')
    await page.number(card + ' .app-mf-goal-input', 7)
    await tab(3)
    await page.wait('!!document.querySelector(".ind-pane:not(.is-off) .app-head-search")')
    await tab(4)
    await page.wait('!!document.querySelector(".ind-pane:not(.is-off) .is-lab")')
    card = await markCard(ctx.labRecipes.get('jump-fuel').name)
    await page.text(card, t('ui.lab.006'))
    await page.wait(`!!document.querySelector('${card} .app-belt-worker')`)
    await page.text(card + ' .app-belt-worker', t('ui.IndustryPage.104'))
    await tab(5)
    await page.wait('document.querySelectorAll(".ind-pane:not(.is-off) .app-shelf-card").length>0')
    await page.tap('[data-nav-page="industryHud"]')
    await page.wait('!!document.querySelector("#hud-tab-refine")')
    await page.tap('.hud-panel-head button')
    assert.equal(await page.js('!!document.querySelector("#hud-station-body")'), false)
    await page.tap('.hud-panel-head button')
    await page.tap('#hud-tab-craft')
    await input('.hud-panel-head .app-head-search', ctx.modules.get('mod-turret-kin-1').name)
    await page.wait('document.querySelectorAll(".hud-table.is-queue tbody tr").length===1')
    await page.tap('.hud-table.is-queue tbody tr .act button')
    await page.wait('document.querySelectorAll(".hud-card .nm").length===1')
    await page.tap('.hud-card button')
    await page.wait('document.querySelectorAll(".hud-card .nm").length===0')
    await page.tap('#hud-tab-shipyard')
    await page.wait('!!document.querySelector(".hud-table tbody tr")')
    await page.tap('#hud-tab-lab')
    await page.js(`(()=>{const b=[...document.querySelectorAll('button.hud-card')].find(e=>e.querySelector('.nm')?.textContent===${JSON.stringify(ctx.labRecipes.get('jump-fuel').name)});b.setAttribute('data-hud-recipe','1')})()`)
    await page.tap('[data-hud-recipe]')
    if (locale === 'zh') await page.tap('.hud-sw')
    await page.number('.hud-sw-row .hud-search', 9)
    const recipeMaterials = await page.js('document.querySelector(".hud-grid.two .hud-grid .hud-table").textContent')
    await page.tap('#hud-tab-craft'); await page.tap('#hud-tab-lab')
    assert.equal(await page.js('document.querySelector(".hud-grid.two .hud-grid .hud-table").textContent'), recipeMaterials)
    await persist()
    assert.equal(savedState().manufacturingLoops['bp-turret-1'].goal, 7)
    assert.equal(savedState().labLoops['jump-fuel'].goal, 9)
    results.push({ locale, classicFiveTabs: true, unbox: true, manufacturingRefund: true, lab: true, hudFourTabs: true, hudManufacturingRefund: true, loopDrafts: true })
  }
  assert.deepEqual(errors, [])
  const report = { ok: true, target: 'desktop-production-loopback', syntheticOnly: true, hidden: true, results, IPCSaved: true, reloaded: true, runtimeErrors: 0 }
  fs.mkdirSync(path.join(root, 'tools/_ui-artifacts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools/_ui-artifacts/industry-domain-desktop-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report)); app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
