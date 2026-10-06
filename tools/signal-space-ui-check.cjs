/** §21信号空间改名/旧入口与未来隔离专项，正式可复跑；2026-10-06。
 * 用法：主代理通知新web构建后 node tools/signal-space-ui-check.cjs。
 * --self-test：仅合成引擎/ID域/标志/compact报告自检，不读dist，不启动浏览器。
 * --legacy-only / --future-only：分别只查8组旧入口 / TEST=1短路由，不跑十层。
 * --compat-only：一组早期supplyVersion=1且无rules=2的信号空间有限货物/撤离兼容检查。
 * --locale=zh --layout=classic --viewport=1024x540 --report-tag=rename：过滤本工具8组矩阵。
 * 旧入口debug=1、TEST=0，先验future=0，再验future=1不升级无tag旧坐标。
 * 自动探索从UI派队，以隔离档墙钟后移5分钟重载，验证真实离线结算而非等五分钟。
 * 输入journey合成fixture与真core生成的旧在途/临时空间分支；从不读个人档。
 * 输出tools/_ui-artifacts/signal-space-ui-check[-tag].json与截图，成功/失败原子落盘。
 * 隐藏自建Chrome、随机端口/profile、PID归属；只读新鲜构建，不自行build，不作观感结论。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const shared = require('./wormhole-expedition-journey-shared.cjs')
const templates = require('./wormhole-expedition-template-ui.cjs')
const { reach, clickAt } = require('./wormhole-expedition-event-ui.cjs')
const {
  ROOT, OUTPUT, TEST_KEY, FUTURE_KEY, SAVE_KEY, sleep, dependencies, createFixture,
  settingsScript, uiText, atomicJson, CdpConnection, JourneyPage, staticServer, stopOwned, removeProfile, syntheticStockRules, openStockPreparation,
} = shared

const MATRIX = [
  ['zh', 'classic', 1366, 768, false], ['zh', 'classic', 1024, 540, false],
  ['zh', 'modern', 1366, 768, false], ['zh', 'modern', 390, 844, true],
  ['en', 'classic', 1366, 768, false], ['en', 'classic', 568, 320, true],
  ['en', 'modern', 1024, 540, false], ['en', 'modern', 390, 844, true],
].map(([locale, layout, width, height, mobile]) => ({ locale, layout, width, height, mobile }))
const NEW_UI = '.app-wh-manifest,.app-wh-supply-summary,.app-wh-alert,[data-wh-event],[data-wh-ground-item],[data-wh-enter-prepared]'
const savedExpression = `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).state`
const ledger = state => {
  const { core } = dependencies()
  const run = state.wormhole.run ? core.loadSaveFile(core.serializeSaveFile(state, 0)).state.wormhole.run : null
  return run ? {
    seed: run.seed, depth: run.depth, family: run.family, archetype: run.archetype,
    rules: run.expeditionRules, supplyVersion: run.supplyVersion,
    turns: [run.turnsTotal, run.turnsLeft], grid: run.grid, bag: run.bag, hold: run.hold, tempGrid: run.tempGrid,
  } : null
}

function makeFixtures(input) {
  const { core } = dependencies()
  const oldSave = JSON.parse(input.initialSave)
  syntheticStockRules(oldSave.state, false)
  const before = core.loadSaveFile(JSON.stringify(oldSave)).state
  syntheticStockRules(before, false)
  before.wormholeScan = { active: false, progressMs: 123456, welcomed: true }
  before.aiCores.gamma = Math.max(1, before.aiCores.gamma)
  before.skills.trained[input.ctx.balance.aiCore.skillId] = 5
  before.wormholeStock.push({ ...before.wormholeStock[0], id: 'rename-auto', seed: 29 })
  const cargo = structuredClone(before)
  const stock = cargo.wormholeStock[0]
  assert(core.wormholeEnter(cargo, input.ctx, input.made.fleet, stock.seed, stock).ok)
  assert(core.wormholeGridScan(cargo, input.ctx).ok)
  assert(core.wormholeTempAddShape(cargo, input.ctx, 'ai-core-gamma').ok)
  core.wormholeLeave(cargo)
  assert.equal(cargo.wormhole.run.attending, false)
  return { before, cargo }
}

function makeCompatibilityFixture(input, before) {
  const { core } = dependencies()
  const state = structuredClone(before)
  const plan = core.wormholePreparationPlan(state, input.ctx, input.made.fleet, { targets: { 'repairkit-mil': 40 }, unload: [] })
  assert(plan.ok)
  assert(core.wormholeEnterPrepared(state, input.ctx, input.made.fleet, 19, plan).ok)
  assert.equal(state.wormhole.run.expeditionRules, undefined)
  assert.equal(state.wormhole.run.supplyVersion, 1)
  assert(core.wormholeLeaveSupply(state, input.ctx, 'repairkit-mil', 10).ok)
  core.wormholeLeave(state)
  return core.loadSaveFile(core.serializeSaveFile(state, Date.now())).state
}

async function saved(page) { return page.js(savedExpression) }
async function waitSaved(page, condition) { await page.wait(`(()=>{const state=${savedExpression};return ${condition}})()`); return saved(page) }

async function assertOld(page, text) {
  assert.equal(await page.js(`!!document.querySelector(${JSON.stringify(NEW_UI)})`), false, '旧入口混入未来整备/警戒/地点物资控件')
  assert.equal(await page.js(`document.querySelector('.app-wh-modal .app-report-title')?.textContent.trim()`), text('ui.Expedition.005'), '旧窗口标题不是信号空间')
  const run = (await saved(page)).wormhole.run
  if (run) {
    assert.notEqual(run.expeditionRules, 2, '旧入口升级成新规则')
    assert.notEqual(run.supplyVersion, 1, '旧入口自动装载有限供给')
    assert.equal(run.alertLevel, undefined, '旧趟新增警戒账')
  }
}

async function openedText(page, selector, excludeExperiment = false) {
  return page.js(`(()=>{const root=document.querySelector(${JSON.stringify(selector)});if(!root)throw Error('可见区域不存在');const excluded=el=>${excludeExperiment}&&!!el.closest('[data-future-wormhole-stock]');let body=root.innerText;if(${excludeExperiment}){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const parts=[];while(walker.nextNode()){const node=walker.currentNode,el=node.parentElement;if(excluded(el)||!node.textContent.trim())continue;const range=document.createRange();range.selectNodeContents(node);if(range.getClientRects().length&&getComputedStyle(el).visibility!=='hidden')parts.push(node.textContent)}body=parts.join(' ')}return [body,...[...root.querySelectorAll('[title],[data-tip]')].filter(el=>{const r=el.getBoundingClientRect();return !excluded(el)&&r.width>0&&r.height>0}).map(el=>el.getAttribute('title')||el.getAttribute('data-tip'))].join('\\n')})()`)
}

async function noWormholeLeak(page, selector, excludeExperiment = false) {
  const content = await openedText(page, selector, excludeExperiment)
  assert(!/虫洞|wormholes?/i.test(content), `已开放区域泄露未来名称:${selector}:${content.match(/.{0,60}(?:虫洞|wormholes?).{0,60}/i)?.[0]}`)
  assert(!/\{p\d|ui\.signalSpace\./.test(content), '文案ID或参数泄露')
}

async function geometry(page, options) {
  const measured = await page.js(`(()=>{const el=document.querySelector('.app-wh-modal'),r=el.getBoundingClientRect(),body=document.scrollingElement;return {modal:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot'),bodyOverflow:body.scrollWidth>innerWidth+2||body.scrollHeight>innerHeight+2}})()`)
  const box = measured.modal
  assert(box.width > 40 && box.height > 40, '窗口被压空')
  assert(box.left >= -2 && box.top >= -2 && box.right <= options.width + 2 && box.bottom <= options.height + 2, '旧窗口越出物理视口')
  assert(!measured.bodyOverflow, '一级页面发生滚动')
  return measured
}

async function scanPage(page, text, allowExperiment = false) {
  await templates.dismissOverlays(page)
  await page.text('.app-nav-side', text('ui.App.001'))
  await page.text('.app-subtabs', text('ui.MapPage.007'))
  await page.wait('!!document.querySelector(".app-wh-scanbar")')
  await noWormholeLeak(page, '.app-page-content', allowExperiment)
  await page.text('.app-page-content .app-subtabs', text('ui.WormholeScan.004'))
  await noWormholeLeak(page, '.app-page-content')
  await page.text('.app-page-content .app-subtabs', text('ui.MatterTechTab.001'))
}

async function manualChecks(page, input, fixture, options) {
  const text = uiText(options.locale, 'signal')
  const checks = []
  await scanPage(page, text)
  assert.equal(await page.js('!!document.querySelector("[data-future-wormhole-stock]")'), false, '普通debug泄露实验库存段')
  const initial = await saved(page)
  assert.deepEqual(initial.wormholeStock, fixture.before.wormholeStock, '加载改变旧坐标')
  assert.equal(initial.wormholeScan.progressMs, fixture.before.wormholeScan.progressMs, '加载丢扫描进度')
  assert(initial.wormholeStock.every(stock => stock.expeditionRules === undefined), '旧夹具遗漏实验库存标记')
  checks.push('scan-and-matter-signal-names', 'old-coordinates-and-scan-progress')
  await openStockPreparation(page, text, 'signal')
  await assertOld(page, text)
  await noWormholeLeak(page, '.app-wh-modal')
  const measure = await geometry(page, options)
  // 同一份旧库存不因显式实验开关而升级，先退出准备页再重载验证新的选择分流。
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  await page.js(`localStorage.setItem(${JSON.stringify(FUTURE_KEY)},'1')`)
  await page.send('Page.reload', { ignoreCache: true })
  await page.wait('!!document.querySelector(".app-root")')
  await scanPage(page, text, true)
  assert.deepEqual((await saved(page)).wormholeStock, initial.wormholeStock, '开实验标志改写旧坐标')
  await openStockPreparation(page, text, 'signal')
  await assertOld(page, text)
  assert.equal(await page.js(`localStorage.getItem(${JSON.stringify(TEST_KEY)})`), '0')
  checks.push('debug-alone-old-preparation', 'future-flag-does-not-upgrade-old-stock')
  await page.text('.app-wh-modal', text('ui.Expedition.308'))
  await page.wait('!!document.querySelector(".app-wh-tabbar")')
  const entered = await waitSaved(page, '!!state.wormhole.run')
  await assertOld(page, text)
  assert.deepEqual(entered.warehouse.items, initial.warehouse.items, '旧UI入场预扣了整备物资')
  assert.equal(entered.wormholeScan.progressMs, initial.wormholeScan.progressMs)
  // 旧引擎入场种子仍由墙钟产生；这里核对所选坐标的族/原型/层与库存消费，不偷改引擎。
  const stock = fixture.before.wormholeStock[0]
  for (const key of ['family', 'archetype', 'depth']) assert.equal(entered.wormhole.run[key], stock[key])
  assert.equal(entered.wormholeStock.some(row => row.id === stock.id), false)
  assert.deepEqual(entered.wormholeStock.find(row => row.id === 'rename-auto'), fixture.before.wormholeStock[1])
  checks.push('untagged-stock-old-entry-with-future-flag', 'no-manifest-alert-or-supply-deduction', 'stock-metadata-retained')
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  const paused = await waitSaved(page, 'state.wormhole.run.attending===false')
  await page.send('Page.reload', { ignoreCache: true })
  await page.wait('!!document.querySelector(".app-root")')
  await templates.dismissOverlays(page)
  const reloaded = await saved(page)
  assert.equal(reloaded.wormhole.run.attending, false)
  assert.deepEqual(ledger(reloaded), ledger(paused), '旧趟重载改变坐标/扫描/货物账')
  const activity = await openedText(page, '.app-activitybar-item.is-wormhole')
  assert(activity.includes(text('ui.Expedition.005')) && !/虫洞|wormhole/i.test(activity), '活动名称未改信号空间')
  await page.tap('.app-activitybar-item.is-wormhole')
  await assertOld(page, text)
  const resumed = await waitSaved(page, 'state.wormhole.run.attending===true')
  assert.deepEqual(ledger(resumed), ledger(reloaded), '活动入口重新入场或丢账')
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  await scanPage(page, text, true)
  await page.text('.app-page-content', text('ui.WormholeScan.015'))
  await assertOld(page, text)
  assert.deepEqual(ledger(await saved(page)), ledger(resumed), '返回信号空间重新入场')
  checks.push('pause-reload-preserved', 'fromActivity-signal', 'return-signal')
  const screenshot = `signal-space-${options.label}-manual.png`
  await page.screenshot(screenshot)
  await page.wait('document.querySelector(".app-wh-extract")?.disabled===false')
  await page.tap('.app-wh-extract')
  await page.tap('.app-wh-extract')
  await page.wait('!!document.querySelector(".app-wh-settle")')
  const final = await waitSaved(page, 'state.wormhole.run===null')
  assert.deepEqual(final.warehouse.items, initial.warehouse.items, '无战耗/无收货的旧空趟结算改了物资')
  await page.tap('.app-wh-settle-ok')
  await page.wait('!document.querySelector(".app-wh-modal")')
  return { checks, measure, screenshot, inventoryUnchanged: true }
}

async function cargoChecks(page, input, fixture, options) {
  const { core } = dependencies()
  const text = uiText(options.locale, 'signal')
  await templates.dismissOverlays(page)
  const loaded = await saved(page)
  assert.deepEqual(ledger(loaded), ledger(core.loadSaveFile(core.serializeSaveFile(fixture.cargo, 0)).state), '旧在途合成档加载丢扫描/临时空间')
  await page.tap('.app-activitybar-item.is-wormhole')
  await assertOld(page, text)
  await page.tap('.app-wh-tab:nth-child(2)')
  await page.wait('!!document.querySelector("[data-wh-fig=temp]")')
  const before = await saved(page)
  const piece = core.wormholeTempBoard(before.wormhole.run).placements[0]
  assert(piece, '合成旧临时空间为空')
  await page.tap('[data-wh-fig=temp]')
  await page.tap('[data-wh-cell=hold][data-wh-x="0"][data-wh-y="0"]')
  const stowed = await waitSaved(page, `state.wormhole.run.hold.placements.some(row=>row.id===${JSON.stringify(piece.id)})`)
  assert.equal(core.wormholeTempBoard(stowed.wormhole.run).placements.length, 0)
  await page.tap('[data-wh-fig=hold]')
  await page.tap('[data-wh-cell=temp][data-wh-x="0"][data-wh-y="0"]')
  const returned = await waitSaved(page, `state.wormhole.run.tempGrid.placements.some(row=>row.id===${JSON.stringify(piece.id)})`)
  assert.equal(returned.wormhole.run.hold.placements.length, 0)
  for (const state of [stowed, returned]) {
    assert.deepEqual(state.wormhole.run.grid, before.wormhole.run.grid, '货仓操作移动了旧地图/扫描账')
    assert.equal(state.wormhole.run.turnsLeft, before.wormhole.run.turnsLeft)
    assert.deepEqual(state.warehouse.items, before.warehouse.items)
  }
  await page.tap('.app-wh-tab:nth-child(1)')
  await page.wait('!!document.querySelector(".app-wh-tempask")')
  await page.text('.app-wh-tempask', text('ui.Wormhole.172'))
  await page.wait('!document.querySelector(".app-wh-tempask")')
  assert.equal(core.wormholeTempBoard((await saved(page)).wormhole.run).placements.length, 0)
  const screenshot = `signal-space-${options.label}-cargo.png`
  await page.screenshot(screenshot)
  return { checks: ['old-inflight-grid-and-scan-preserved', 'temp-to-hold-and-back-trusted-input', 'leave-bag-stow-confirmation'], screenshot }
}

async function autoChecks(page, input, fixture, options) {
  const { core } = dependencies()
  const text = uiText(options.locale, 'signal')
  await scanPage(page, text)
  const initial = await saved(page)
  await page.text('.app-page-content', text('ui.Wormhole.002'))
  await assertOld(page, text)
  await page.text('.app-wh-prep', text('ui.Wormhole.134'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  const started = await waitSaved(page, '(state.wormholeAuto??[]).length===1')
  const run = started.wormholeAuto[0]
  assert.notEqual(run.expeditionRules, 2)
  assert.equal(run.expeditionSnapshot, undefined)
  assert.equal(run.finishAtGameMs - run.startedAtGameMs, core.WORMHOLE_AUTO_DURATION_MS)
  assert.equal(core.WORMHOLE_AUTO_DURATION_MS, 300000)
  assert.deepEqual(started.warehouse.items, initial.warehouse.items, '旧自动派队预扣供给')
  assert(run.shipIds.every(id => id !== started.shipId), '自动夹具意外派出主控')
  // pagehide会正常落盘；仅在下一文档读档前回拨合成档墙钟，不阻止生产保存事件。
  const rewind = core.WORMHOLE_AUTO_DURATION_MS + 1000
  const clockScript = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const save=JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}));save.savedAtWallMs=Date.now()-${rewind};save.state.savedAtWallMs=save.savedAtWallMs;localStorage.setItem(${JSON.stringify(SAVE_KEY)},JSON.stringify(save))})()` })
  await page.send('Page.reload', { ignoreCache: true })
  await page.wait('!!document.querySelector(".app-root")')
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockScript.identifier })
  const settled = await waitSaved(page, '(state.wormholeAuto??[]).length===0&&(state.wormholeAutoReports??[]).length>0')
  const report = settled.wormholeAutoReports.find(row => row.stockId === run.stockId)
  assert(report, '旧自动无对应结算报告')
  assert.notEqual(report.expeditionRules, 2)
  assert.equal(report.shipsLost?.length ?? 0, 0)
  assert.deepEqual(Object.keys(settled.fleet).sort(), Object.keys(started.fleet).sort(), '旧自动5分钟结算丢船')
  for (const id of run.shipIds) assert(settled.fleet[id].durability > 0, '旧自动结算舰船全损')
  assert.equal(settled.wormholeScan.progressMs, fixture.before.wormholeScan.progressMs)
  return { checks: ['legacy-auto-ui-dispatch', 'five-minute-real-offline-settlement', 'no-ships-lost'], durationMs: core.WORMHOLE_AUTO_DURATION_MS, shipIds: run.shipIds, clockOnlyRewindMs: rewind, clockFixturePhase: 'after-pagehide-save-before-new-document-game-load' }
}

async function compatibilityChecks(page, input, state, options) {
  const text = uiText(options.locale, 'signal')
  const amount = s => s.wormhole.run?.supplies?.items['repairkit-mil'] ?? 0
  await templates.dismissOverlays(page)
  const before = await saved(page)
  assert.equal(before.wormhole.run.expeditionRules, undefined)
  assert.equal(before.wormhole.run.supplyVersion, 1)
  await page.tap('.app-activitybar-item.is-wormhole')
  await page.wait('!!document.querySelector(".app-wh-supply-summary")')
  assert.equal(await page.js(`document.querySelector('.app-wh-modal .app-report-title')?.textContent.trim()`), text('ui.Expedition.005'), '早期有限补给趟标题未显示信号空间')
  assert.equal(await page.js('!!document.querySelector(".app-wh-alert,[data-wh-event],[data-wh-patrol],.app-wh-manifest")'), false, '早期兼容趟混入新警戒/事件/整备')
  await noWormholeLeak(page, '.app-wh-modal')
  await page.tap('.app-wh-tab:nth-child(2)')
  await page.wait('!!document.querySelector("[data-wh-ground-item=repairkit-mil] button")')
  assert.equal(amount(await saved(page)), 30)
  await page.tap('[data-wh-ground-item=repairkit-mil] button')
  await waitSaved(page, "state.wormhole.run.supplies.items['repairkit-mil']===40")
  await page.number('[data-wh-supply-item=repairkit-mil] input', 10)
  await page.tap('[data-wh-supply-item=repairkit-mil] button')
  await waitSaved(page, "state.wormhole.run.supplies.items['repairkit-mil']===30")
  await page.tap('[data-wh-ground-item=repairkit-mil] button')
  const restowed = await waitSaved(page, "state.wormhole.run.supplies.items['repairkit-mil']===40")
  assert.equal(restowed.wormhole.run.expeditionRules, undefined)
  assert.equal(restowed.wormhole.run.supplyVersion, 1)
  assert.deepEqual(restowed.warehouse.items, before.warehouse.items, '有限补给装回/留货改了母港库存')
  assert.deepEqual(restowed.wormholeStock, state.wormholeStock, '兼容趟改写库存坐标')
  await noWormholeLeak(page, '.app-wh-modal')
  const screenshot = `signal-space-${options.label}-compatibility.png`
  await page.screenshot(screenshot)
  await page.tap('.app-wh-extract')
  await page.wait('!!document.querySelector("[data-wh-extract-confirm]")')
  await page.tap('[data-wh-extract-confirm]')
  await page.wait('!!document.querySelector(".app-wh-settle")')
  const settled = await waitSaved(page, 'state.wormhole.run===null')
  assert.equal(settled.wormhole.lastSettle.suppliesReturned['repairkit-mil'], 40)
  assert.equal(settled.wormhole.lastSettle.expeditionProgress, undefined)
  assert.equal(settled.warehouse.items['repairkit-mil'], before.warehouse.items['repairkit-mil'] + 40)
  assert.equal(await page.js(`document.querySelector('.app-wh-modal .app-report-title')?.textContent.trim()`), text('ui.Wormhole.130'), '兼容结算标题未映射')
  await noWormholeLeak(page, '.app-wh-modal')
  return { checks: ['early-supply-one-rules-absent', 'signal-title-map-hold-settlement', 'no-new-alert-event-or-manifest', 'finite-supply-stow-leave-restow', 'supplies-returned-on-extraction'], screenshot, supplyVersion: 1, rulesAbsent: true, returned: 40 }
}

async function withSignalPage(cdp, url, input, state, options, action) {
  const { core } = dependencies()
  const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let page
  let connection
  try {
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', () => reject(Error('CDP连接失败')), { once: true }) })
    connection = new CdpConnection(socket)
    page = new JourneyPage(connection.send.bind(connection), { touch: options.mobile })
    const priorInputs = []
    const inputEvidence = () => page.js(`(window.__whSpecialInputs??[]).filter(row=>row.kind==='click'||row.kind==='touchstart').map(({kind,trusted})=>({kind,trusted})).slice(-20)`)
    const send = page.send.bind(page)
    page.send = async (method, params) => {
      if (method === 'Page.reload') {
        priorInputs.push(...await inputEvidence())
        if (priorInputs.length > 40) priorInputs.splice(0, priorInputs.length - 40)
      }
      return send(method, params)
    }
    // 共用真实CDP几何helpers，旋转手机仍按物理点击点，不调用HTMLElement.click。
    page.tap = async selector => {
      const measured = await reach(page, selector)
      assert.equal(measured.disabled === true, false, `控件被禁用:${selector}`)
      await clickAt(page, measured.point, options.mobile)
      await sleep(150)
    }
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: options.width, height: options.height, screenWidth: options.width, screenHeight: options.height, mobile: options.mobile, deviceScaleFactor: 1, screenOrientation: { type: options.width < options.height ? 'portraitPrimary' : 'landscapePrimary', angle: options.width < options.height ? 0 : 90 } })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: options.mobile, maxTouchPoints: 5 })
    const source = `localStorage.clear();${settingsScript(input.announcement, core.serializeSaveFile(state, Date.now()), { test: false, future: false, locale: options.locale, layout: options.layout })}`
    const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source })
    await page.send('Page.navigate', { url })
    await page.wait(`!!document.querySelector('.app-root')&&!!localStorage.getItem(${JSON.stringify(SAVE_KEY)})`)
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
    await sleep(450)
    const flags = await page.js(`({debug:localStorage.getItem('whale-idle:debug'),future:localStorage.getItem(${JSON.stringify(FUTURE_KEY)}),test:localStorage.getItem(${JSON.stringify(TEST_KEY)}),api:!!window.__whExpeditionTest})`)
    assert.deepEqual(flags, { debug: '1', future: '0', test: '0', api: false })
    await templates.installInputEvidence(page)
    const result = await action(page)
    const evidence = [...priorInputs, ...await inputEvidence()].slice(-40)
    assert(evidence.some(row => row.kind === 'click' && row.trusted), '旧入口缺少可信点击')
    if (options.mobile) assert(evidence.some(row => row.kind === 'touchstart' && row.trusted), '手机入口缺少可信触控')
    assert.equal(connection.errors.length, 0, '页面运行期异常')
    return { success: true, flags, ...result, evidence }
  } catch (error) {
    const screenshot = `signal-space-${options.label}-failure.png`
    await page?.screenshot(screenshot).catch(() => {})
    const diagnostic = page ? await templates.failureEvidence(page).catch(() => null) : null
    if (diagnostic?.inputs) diagnostic.inputs = diagnostic.inputs.slice(-20)
    return { success: false, failure: error.message, screenshot, diagnostic, runtimeErrors: connection?.errors.slice(-5) ?? [] }
  } finally {
    socket.close()
    await fetch(`${cdp}/json/close/${target.id}`).catch(() => {})
  }
}

async function futureChecks(page, input, options) {
  const text = uiText(options.locale, 'future')
  await scanPage(page, text, true)
  const stocks = (await page.snapshot()).wormholeStock
  assert(stocks.some(stock => stock.expeditionRules === 2), '未来合成库存缺少规则标记')
  assert(stocks.some(stock => stock.expeditionRules === undefined), '短route缺少混合旧库存隔离样本')
  const names = await page.js(`([...document.querySelectorAll('.app-page-content .app-inv-row .app-inv-name')].map(el=>el.textContent.trim()))`)
  assert(names.includes(text('ui.Expedition.005', 'signal')) && names.includes(text('ui.Expedition.005', 'future')), '新旧库存未分列显示各自名称')
  await openStockPreparation(page, text, 'signal')
  await assertOld(page, uiText(options.locale, 'signal'))
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015', 'signal'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  await templates.openPreparation(page, input, text)
  assert.equal(await page.js(`document.querySelector('.app-wh-modal .app-report-title')?.textContent.trim()`), text('ui.Expedition.005'), '显式实验窗口不叫虫洞')
  await page.tap('[data-wh-enter-prepared]')
  await page.tap('[data-wh-enter-prepared]')
  await page.wait('window.__whExpeditionTest.snapshot().wormhole.run?.expeditionRules===2')
  const run = (await page.snapshot()).wormhole.run
  assert.equal(run.supplyVersion, 1)
  const panelTitle = await page.js(`document.querySelector('.app-wh-modal .app-report-title')?.textContent.trim()`)
  assert.equal(panelTitle, text('ui.Expedition.005'), `未来规则入场后错误分流旧面板:rules=${run.expeditionRules},supply=${run.supplyVersion},title=${panelTitle}`)
  await page.wait('!!document.querySelector(".app-wh-supply-summary")')
  await page.text('.app-wh-modal .app-modal-head', text('ui.Wormhole.015'))
  await page.wait('!document.querySelector(".app-wh-modal")')
  const activity = await openedText(page, '.app-activitybar-item.is-wormhole')
  assert(activity.includes(text('ui.Expedition.005', 'history')) && !/信号空间|Signal Space/i.test(activity), '未来活动名称被全局映射成信号空间')
  await page.tap('.app-activitybar-item.is-wormhole')
  await page.wait('!!document.querySelector(".app-wh-supply-summary")')
  assert.equal(await page.js(`document.querySelector('.app-wh-modal .app-report-title')?.textContent.trim()`), text('ui.Expedition.005'))
  assert.deepEqual((await page.snapshot()).wormholeStock.filter(stock => stock.expeditionRules === undefined), stocks.filter(stock => stock.expeditionRules === undefined), '未来入场消费或升级了旧坐标')
  return { checks: ['scan-still-signal', 'mixed-stocks-separated', 'TEST-one-does-not-upgrade-old-stock', 'TEST-one-and-tag-two-explicit-future', 'future-title-wormhole', 'manifest-rules-two-supply-one', 'future-activity-raw-name-resume', 'legacy-stock-untouched'], rules: run.expeditionRules, supplyVersion: run.supplyVersion, scope: 'isolated-route-only-not-ten-layer-journey' }
}

async function selfTest() {
  shared.selfTest()
  templates.selfTest()
  const { core, data } = dependencies()
  for (const locale of ['zh', 'en']) for (const domain of ['signal', 'future']) {
    const text = uiText(locale, 'future')
    const nameId = domain === 'signal' ? core.signalSpaceTextId('ui.Expedition.005') : 'ui.Expedition.005'
    const labelId = domain === 'signal' ? core.signalSpaceTextId('ui.WormholeScan.018') : 'ui.WormholeScan.018'
    let marked = false
    const button = { textContent: data.L10N[labelId][locale], setAttribute: key => { assert.equal(key, 'data-wh-tool-stock-entry'); marked = true } }
    const row = { querySelector: () => ({ textContent: data.L10N[nameId][locale] }), querySelectorAll: () => [button] }
    const document = { querySelector: () => null, querySelectorAll: selector => {
      assert.equal(selector.includes('[data-future-wormhole-stock]'), domain === 'future')
      return [row]
    } }
    const evaluate = source => new Function('document', `return ${source}`)(document)
    await openStockPreparation({ wait: source => assert(evaluate(source)), js: evaluate, tap: selector => { assert.equal(selector, '[data-wh-tool-stock-entry]'); assert(marked) } }, text, domain)
  }
  await openedText({ js: source => { new Function(source); return '' } }, '.app-page-content', true)
  const input = createFixture()
  const wallFixture = JSON.parse(input.initialSave)
  wallFixture.savedAtWallMs = 600000
  wallFixture.state.savedAtWallMs = 900000
  const wallLoaded = core.loadSaveFile(JSON.stringify(wallFixture))
  assert.equal(wallLoaded.savedAtWallMs, 600000, '离线时钟应读取文件头')
  assert.equal(wallLoaded.state.savedAtWallMs, 600000, '读档应以文件头覆盖状态墙钟')
  const sourceStock = structuredClone(JSON.parse(input.initialSave).state.wormholeStock)
  assert(sourceStock.some(stock => stock.expeditionRules === 2), '未来合成来源缺少tag')
  assert.deepEqual(core.loadSaveFile(input.initialSave).state.wormholeStock, sourceStock, '读档未保留实验库存tag')
  const fixture = makeFixtures(input)
  const compatibility = makeCompatibilityFixture(input, fixture.before)
  assert.equal(compatibility.wormhole.run.supplyVersion, 1)
  assert.equal(compatibility.wormhole.run.expeditionRules, undefined)
  assert.equal(compatibility.wormhole.run.supplies.items['repairkit-mil'], 30)
  assert.equal(compatibility.wormhole.run.alertLevel, undefined)
  assert(fixture.before.wormholeStock.every(stock => !Object.hasOwn(stock, 'expeditionRules')))
  const taggedInput = structuredClone(JSON.parse(input.initialSave))
  syntheticStockRules(taggedInput.state, true)
  const tagRemoved = makeFixtures({ ...input, initialSave: JSON.stringify(taggedInput) })
  assert.deepEqual(tagRemoved.before.wormholeStock, fixture.before.wormholeStock, '旧夹具未删尽future来源tag')
  assert.deepEqual(JSON.parse(input.initialSave).state.wormholeStock, sourceStock, '旧夹具污染future来源')
  const stock = structuredClone(fixture.before.wormholeStock)
  assert.equal(fixture.cargo.wormhole.run.expeditionRules, undefined)
  assert.equal(fixture.cargo.wormhole.run.supplyVersion, undefined)
  const loaded = core.loadSaveFile(core.serializeSaveFile(fixture.cargo, 0)).state
  assert.deepEqual(ledger(loaded), ledger(core.loadSaveFile(core.serializeSaveFile(loaded, 0)).state))
  assert.equal(loaded.wormholeScan.progressMs, 123456)
  assert.deepEqual(fixture.before.wormholeStock, stock)
  const piece = core.wormholeTempBoard(loaded.wormhole.run).placements[0]
  assert(core.wormholeTempStowPiece(loaded, input.ctx, piece.id).ok)
  const auto = structuredClone(fixture.before)
  const ships = input.made.fleet.filter(id => id !== auto.shipId)
  const inventory = structuredClone(auto.warehouse.items)
  assert(core.wormholeAutoStart(auto, input.ctx, 'rename-auto', ships).ok)
  const run = auto.wormholeAuto[0]
  assert.equal(run.expeditionRules, undefined)
  assert.equal(run.finishAtGameMs - run.startedAtGameMs, 300000)
  assert.deepEqual(auto.warehouse.items, inventory)
  core.simulateOffline(auto, 0, 301000, input.ctx)
  assert.equal(auto.wormholeAuto.length, 0)
  assert.equal(auto.wormholeAutoReports.length, 1)
  assert(ships.every(id => auto.fleet[id]?.durability > 0))
  assert.equal(MATRIX.length, 8)
  for (const locale of ['zh', 'en']) for (const layout of ['classic', 'modern']) assert.equal(MATRIX.filter(row => row.locale === locale && row.layout === layout).length, 2)
  const worst = JSON.stringify({ rows: MATRIX.map(row => ({ ...row, failure: 'synthetic', steps: Array.from({ length: 60 }, () => ({ text: 'x'.repeat(600) })) })) })
  assert(Buffer.byteLength(worst) < 400000, '报告大小上界失控')
  console.log('§21工具/8组矩阵/旧自动5分钟/库存tag隔离与往返/exact ID域自检通过；未读dist、未启动浏览器，不是UI结论。')
}

async function main() {
  if (process.argv.includes('--self-test')) { await selfTest(); return }
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
  const tag = arg('report-tag') ?? new Date().toISOString().replace(/[:.]/g, '-')
  assert(/^[\w-]+$/.test(tag), 'report-tag只接受字母数字下划线横线')
  const file = path.join(OUTPUT, `signal-space-ui-check-${tag}.json`)
  const report = { scope: 'signal-rename-and-future-route-not-visual-acceptance-or-full-journey', success: false, startedAt: new Date().toISOString(), rows: [] }
  const persist = async () => { await atomicJson(file, report); await atomicJson(path.join(OUTPUT, 'signal-space-ui-check.json'), report) }
  const prefix = 'whale-signal-space-ui-'
  let profile
  let server
  let chrome
  try {
    assert(['--legacy-only', '--future-only', '--compat-only'].filter(flag => process.argv.includes(flag)).length <= 1, 'only参数互斥')
    report.build = await templates.assertFreshBuild(path.join(ROOT, 'web/dist'))
    const input = createFixture()
    const fixture = makeFixtures(input)
    const rows = MATRIX.filter(row => (!arg('locale') || row.locale === arg('locale')) && (!arg('layout') || row.layout === arg('layout')) && (!arg('viewport') || `${row.width}x${row.height}` === arg('viewport')))
    assert(rows.length || process.argv.includes('--future-only') || process.argv.includes('--compat-only'), '过滤参数未选中矩阵')
    profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const hosted = await staticServer(path.join(ROOT, 'web/dist'))
    server = hosted.server
    chrome = spawn(process.env.WH_JOURNEY_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    report.ownedPid = chrome.pid
    let spawnError
    chrome.once('error', error => { spawnError = error })
    console.log(`信号空间专项自有隐藏Chrome PID ${chrome.pid}`)
    let debug
    for (let retry = 0; retry < 100; retry++) {
      if (spawnError) throw spawnError
      assert.equal(chrome.exitCode, null, '自有Chrome提前退出')
      try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, '自有Chrome调试端口未就绪')
    const cdp = `http://127.0.0.1:${debug.split('\n')[0]}`
    if (!process.argv.includes('--future-only') && !process.argv.includes('--compat-only')) for (const row of rows) {
      const options = { ...row, label: `${row.locale}-${row.layout}-${row.width}-${row.height}-${tag}` }
      const result = { ...row }
      report.rows.push(result)
      for (const [name, state, action] of [['manual', fixture.before, manualChecks], ['cargo', fixture.cargo, cargoChecks], ['auto', fixture.before, autoChecks]]) {
        result[name] = await withSignalPage(cdp, hosted.url, input, state, { ...options, label: options.label + '-' + name }, page => action(page, input, fixture, options))
        if (!result[name].success) {
          result.success = false
          await persist()
          console.log(JSON.stringify({ locale: row.locale, layout: row.layout, viewport: `${row.width}x${row.height}`, branch: name, success: false, failure: result[name].failure }))
          throw Error(`首失败即停:${row.locale}/${row.layout}/${row.width}x${row.height}/${name}:${result[name].failure}`)
        }
      }
      result.success = [result.manual, result.cargo, result.auto].every(branch => branch.success)
      await persist()
      console.log(JSON.stringify({ locale: row.locale, layout: row.layout, viewport: `${row.width}x${row.height}`, success: result.success }))
    }
    if (!process.argv.includes('--legacy-only') && !process.argv.includes('--compat-only')) {
      const options = { locale: 'en', layout: 'modern', width: 1366, height: 768, mobile: false, label: `signal-future-route-${tag}` }
      const futureState = dependencies().core.loadSaveFile(input.initialSave).state
      assert(futureState.wormholeStock.some(stock => stock.expeditionRules === 2), '等待主代理更新合成fixture与save保留库存tag')
      futureState.wormholeStock.push({ ...fixture.before.wormholeStock[1], id: 'rename-old-retained' })
      report.future = await templates.withPage(cdp, hosted.url, input, futureState, options, page => futureChecks(page, input, options))
    }
    if (process.argv.includes('--compat-only') || !process.argv.includes('--legacy-only') && !process.argv.includes('--future-only')) {
      const options = { locale: 'en', layout: 'modern', width: 1366, height: 768, mobile: false, label: `compat-${tag}` }
      const state = makeCompatibilityFixture(input, fixture.before)
      report.compatibility = await withSignalPage(cdp, hosted.url, input, state, options, page => compatibilityChecks(page, input, state, options))
    }
    report.success = report.rows.every(row => row.success) && (!report.future || report.future.success) && (!report.compatibility || report.compatibility.success)
    assert(report.success, '信号空间改名/隔离专项有失败分支')
  } catch (error) {
    report.failure = error.message
    process.exitCode = 1
  } finally {
    try {
      await stopOwned(chrome)
      report.ownedPidExited = !chrome || !Number.isInteger(chrome.pid) || chrome.exitCode !== null || chrome.signalCode !== null
    } catch (error) { report.success = false; report.cleanupFailure = error.message; process.exitCode = 1 }
    finally {
      if (server) await new Promise(resolve => server.close(resolve))
      if (profile && report.ownedPidExited) await removeProfile(profile, prefix)
    }
    report.finishedAt = new Date().toISOString()
    await persist()
  }
  console.log(JSON.stringify({ success: report.success, groups: report.rows.length, future: report.future?.success, compatibility: report.compatibility?.success, file, failure: report.failure, ownedPidExited: report.ownedPidExited }))
}

module.exports = { MATRIX, makeFixtures, ledger, selfTest }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
