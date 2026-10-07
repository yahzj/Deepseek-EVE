/** 五类准备阵容记忆与主控忙态原生UI回归；游戏v0.1.0 / 档v31，2026-10-07。
 * 用法：npm run build后，node tools/preparation-squad-native-check.cjs。
 * 真实构建、真实IPC与合成档，隐藏Electron窗口，不读写个人档；仅关闭自建PID。
 * 覆盖五类关闭/重开/重载、忙船移出、手动自动隔离及主控采矿时旧新自动队出发。
 * 输出tools/_ui-artifacts/preparation-squad-20261007；事实读数不代表观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, sleep, settingsScript, JourneyPage, staticServer, stopOwned, removeProfile, createFixture, uiText } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/preparation-squad-20261007')

function fixture() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const made = createFixture()
  const state = core.loadSaveFile(made.initialSave).state
  const ctx = made.ctx
  for (const [index, uid] of made.made.fleet.entries()) state.fleet[uid].customName = `准备舰${index + 1}`
  const miner = core.addShipToFleet(state, 'sandcat')
  state.shipId = miner
  state.skills.trained['ai-expert'] = 5
  state.aiCores.gamma = 5
  const belt = [...ctx.belts.values()].find(b => !b.standingReq && ctx.items.get(b.oreId)?.kind === 'ore')
  assert(core.startMining(state, belt.id, ctx).ok)
  core.notePreparationSquad(state, 'signal-auto', [miner])
  state.wormholeStock = ['signal-manual', 'signal-auto', 'wormhole-manual', 'wormhole-auto'].map((id, index) => ({
    id, seed: 19 + index, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0,
    ...(id.startsWith('wormhole') ? { expeditionRules: 2 } : {}),
  }))
  const now = Date.now()
  state.weekendEvent = { seq: 99, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: [], contributed: { 'galaxy-kor': 1 }, flagshipAtWallMs: now, flagshipHpMax: 150000, flagshipHpDone: 0 }
  return { save: core.serializeSaveFile(state, now), fleet: made.made.fleet, pilot: miner, mining: state.mining, announcement: made.announcement }
}

async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const prefix = 'whale-preparation-squad-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const input = fixture()
  let child, server, timer
  try {
    const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), { initialize: settingsScript(input.announcement, undefined, { debug: true, test: true, future: true }) })
    server = served.server
    await fs.writeFile(path.join(profile, 'save.json'), input.save, 'utf8')
    await fs.writeFile(path.join(profile, 'fixture.json'), JSON.stringify(input), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: served.url }
    delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
    child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
    console.log(`自建准备界面Electron PID=${child.pid}`)
    timer = setTimeout(() => child.kill(), 180000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    console.log('五类记忆、忙态自动派队及真实IPC保存通过')
  } finally {
    clearTimeout(timer); await stopOwned(child)
    if (server) await new Promise(resolve => server.close(resolve))
    await removeProfile(profile, prefix)
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768)
  const profile = process.env.WHALE_PERF_USERDATA
  const input = JSON.parse(await fs.readFile(path.join(profile, 'fixture.json'), 'utf8'))
  const errors = []
  const text = uiText('zh', 'signal')
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
  const dismiss = async () => {
    if (await page.js('!!document.querySelector(".app-pro-mode-card:not(.is-iron)")')) await page.tap('.app-pro-mode-card:not(.is-iron)')
    for (let i = 0; i < 20 && await page.js('!!document.querySelector(".app-modal-mask .app-comms-eave-extra button")'); i++) await page.tap('.app-modal-mask .app-comms-eave-extra button')
  }
  await dismiss()
  await page.text('.app-nav-side', text('ui.App.001'))
  await page.text('.app-subtabs', text('ui.MapPage.007'))
  const rows = []
  async function open(kind) {
    if (kind === 'weekend') {
      await page.text('.app-weekend-box', text('ui.weekend.062'))
      await page.wait('!!document.querySelector(".app-wh-prep-modal")'); return
    }
    const future = kind.startsWith('wormhole')
    const automatic = kind.endsWith('auto')
    await page.js(`(()=>{const stock=${JSON.stringify(kind)};const future=${future};const rows=[...document.querySelectorAll('.app-page-content .app-inv-list .app-inv-row')].filter(e=>!!e.closest('[data-future-wormhole-stock]')===future);const row=rows[${automatic ? 1 : 0}];if(!row)throw Error('库存行缺失:'+stock);const button=row.querySelectorAll('.app-inv-btns button')[${automatic ? 1 : 0}];if(!button)throw Error('准备入口缺失');button.click()})()`)
    await page.wait('!!document.querySelector(".app-wh-modal")')
    await sleep(100)
  }
  const picked = () => page.js(`(()=>{const root=document.querySelector('.app-wh-modal,.app-wh-prep-modal');return [...root.querySelectorAll('.app-wh-card.is-picked')].map(b=>b.querySelector('.app-wh-card-name').textContent)})()`)
  const close = async () => { await page.js(`(()=>{const root=document.querySelector('.app-wh-modal,.app-wh-prep-modal');const buttons=[...root.querySelectorAll('.app-modal-head button')];const b=buttons.find(e=>e.textContent.includes('关闭'));if(!b)throw Error('关闭按钮缺失');b.click()})()`); await sleep(120) }
  // 以合成自定义名识别同型实例，再用随档uid校验，避免只验证船型。
  for (const [index, kind] of ['signal-manual', 'signal-auto', 'wormhole-manual', 'wormhole-auto', 'weekend'].entries()) {
    await open(kind)
    if (kind === 'signal-auto') {
      assert.equal(await page.js('document.querySelector(".app-wh-enter").disabled'), true)
      const rememberedBusy = await page.js(`(()=>{const card=document.querySelector('.app-wh-modal .app-wh-card.is-picked.is-locked');return !!card&&!card.disabled})()`)
      assert(rememberedBusy, '记忆中的忙主控无法取消选择')
    }
    await page.js(`(()=>{const root=document.querySelector('.app-wh-modal,.app-wh-prep-modal');for(const b of root.querySelectorAll('.app-wh-card.is-picked'))b.click()})()`)
    await sleep(80)
    if (index !== 2) {
      await page.js(`(()=>{const root=document.querySelector('.app-wh-modal,.app-wh-prep-modal');const b=[...root.querySelectorAll('.app-wh-card')].find(e=>!e.disabled&&e.querySelector('.app-wh-card-name').textContent===${JSON.stringify(`准备舰${index % 4 + 1}`)});if(!b)throw Error('可派舰卡缺失');b.click()})()`)
      await sleep(120)
    }
    const before = await page.snapshot()
    const memory = before.preparationSquads?.[kind]
    assert(Array.isArray(memory)); assert.equal(memory.length, index === 2 ? 0 : 1)
    if (memory.length) assert.equal(memory[0], input.fleet[index % 4])
    if (kind === 'signal-auto') assert.equal(await page.js('document.querySelector(".app-wh-enter").disabled'), false)
    await close(); await open(kind)
    assert.equal((await picked()).length, memory.length)
    await close()
    rows.push({ kind, memory })
    console.log(`${kind}: 关闭重开恢复${memory.length}舰`)
  }
  await page.command('persist')
  await page.reload(); await dismiss()
  const restored = await page.snapshot()
  for (const row of rows) assert.deepEqual(restored.preparationSquads[row.kind], row.memory)
  assert.equal(restored.shipId, input.pilot); assert.deepEqual(restored.mining, input.mining)
  await page.text('.app-nav-side', text('ui.App.001'))
  await page.text('.app-subtabs', text('ui.MapPage.007'))
  for (const row of rows) {
    await open(row.kind)
    assert.equal((await picked()).length, row.memory.length)
    await close()
  }
  // 新版先派出，保留另一条旧通道供随后验证。
  for (const kind of ['wormhole-auto', 'signal-auto']) {
    await open(kind)
    await page.js(`(()=>{const root=document.querySelector('.app-wh-modal');for(const b of root.querySelectorAll('.app-wh-card.is-picked'))b.click()})()`)
    await sleep(80)
    await page.js(`(()=>{const b=[...document.querySelectorAll('.app-wh-modal .app-wh-card')].find(e=>!e.disabled&&e.querySelector('.app-wh-card-name').textContent.startsWith('准备舰'));if(!b)throw Error('空闲副船缺失');b.click()})()`)
    await sleep(120)
    await page.tap('.app-wh-enter')
    if (kind === 'wormhole-auto') {
      await page.wait('!!document.querySelector(".app-wh-manifest")')
      await page.tap('[data-wh-auto-risk]')
      await page.tap('[data-wh-enter-prepared]'); await page.tap('[data-wh-enter-prepared]')
    }
    await page.wait('!document.querySelector(".app-wh-modal")')
    const state = await page.snapshot()
    assert.equal(state.shipId, input.pilot); assert.deepEqual(state.mining, input.mining)
    assert(state.wormholeAuto.some(run => run.stockId === kind))
    console.log(`${kind}: 主控采矿不变，副船实际出发`)
  }
  await page.command('persist')
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const disk = core.loadSaveFile(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state
  assert(disk.preparationSquads); assert.equal(disk.wormholeAuto.length, 2)
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ rows, reloaded: true, nativeIPC: true, autoRuns: 2, pilotUnchanged: true, errors }, null, 2))
  win.webContents.debugger.detach(); app.quit()
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
