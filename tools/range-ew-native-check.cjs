/** 射程电子战桌面冒烟：先npm run build，再node tools/range-ew-native-check.cjs。
 * 隐藏Electron、生产产物、独立合成档；输出截图和report.json，不读个人档。
 * 战内夹具延后开火，仅核对读数与几何，不作为战斗平衡结论。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/range-ew')
const PREFIX = 'whale-range-ew-'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const combat = require('../packages/core/src/combat.ts')
  const { injectCommandFleetAllShipsFixture } = require('./command-fleet-all-ships-fixture.ts')
  const { syncRangeEw } = require('../packages/core/src/combat/rangeEw.ts')
  const { seedUnit, initFoeDronePools } = require('../packages/core/src/combat/foes/state.ts')
  const { buildSimContext, COMMS_MESSAGES } = require('../packages/data/src/index.ts')
  const ctx = buildSimContext(), reports = []
  await fs.mkdir(OUT, { recursive: true })
  for (const mode of ['battle', 'fleet', 'preview']) {
    const state = core.createInitialState({ nowWallMs: Date.now(), seed: 20261101 })
    injectCommandFleetAllShipsFixture(state)
    state.commsDelivered = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, 0]))
    state.commsRead = Object.fromEntries(COMMS_MESSAGES.map(row => [row.id, true]))
    state.commsPopups = []
    const electronic = 'sh-wh-d-frigate'
    const rack = ctx.modules.get('mod-lair-ecm-h').rack
    assert(core.unfitAt(state, rack, 0, electronic, ctx), '电子舰卸下对应槽位设备失败')
    const fitted = core.fitModule(state, 'mod-lair-ecm-h', ctx, { shipId: electronic })
    assert(fitted.ok, fitted.error ?? fitted.errorId ?? '电子舱装配失败')
    const roster = core.combatRosterOf(state)
    if (mode === 'battle') {
      const battle = combat.startFleetBattleFor(state, ctx, roster, 'ink-flagship')
      assert(battle)
      for (const [tag, unit] of Object.entries(battle.units)) if (unit.side === 'foe') delete battle.units[tag]
      battle.waveIdx = 3
      const foes = combat.activeFoeSpecsOf(ctx.anomalies.get('ink-flagship'), ctx.balance.battle, 3)
      for (const foe of foes) seedUnit(battle, foe)
      initFoeDronePools(battle, foes)
      for (const unit of Object.values(battle.units)) unit.weapons.fill(600000)
      syncRangeEw(state, ctx, battle, foes)
      state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ink-flagship',
        foeGalaxyId: ctx.anomalies.get('ink-flagship').galaxyId, battle }
    }
    const expected = mode === 'battle' ? state.expedition.battle.rangeEw
      : { meStrength: core.playerRangeEwOf(state, ctx, roster).reduce((sum, row) => sum + row.total, 0) }
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
    let child, timer
    try {
      await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_RANGE_EW_CHECK: mode,
        WHALE_RANGE_EW_EXPECTED: JSON.stringify(expected) }
      for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF', 'NODE_OPTIONS']) delete env[key]
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
      console.log(`电子战桌面检查 ${mode}，自有PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 60000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0, `${mode}桌面检查失败`)
      reports.push(JSON.parse(await fs.readFile(path.join(OUT, `${mode}.json`), 'utf8')))
    } finally {
      clearTimeout(timer)
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited
      }
      const absolute = path.resolve(profile)
      assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
      assert(path.basename(absolute).startsWith(PREFIX))
      assert.equal(await fs.realpath(absolute), absolute)
      await fs.rm(absolute, { recursive: true })
    }
  }
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, reports }, null, 2), 'utf8')
  console.log(`PASS ${path.join(OUT, 'report.json')}`)
}

async function child() {
  const electron = require('electron')
  const { app, BrowserWindow } = electron
  const mode = process.env.WHALE_RANGE_EW_CHECK
  const expected = JSON.parse(process.env.WHALE_RANGE_EW_EXPECTED)
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith(PREFIX))
  app.setPath('userData', profile); app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  let paints = 0, lastFrame
  class OffscreenWindow extends BrowserWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } })
      this.webContents.setFrameRate(60)
      this.webContents.on('paint', (_event, _rect, image) => { paints++; lastFrame = image })
    }
  }
  const Module = require('node:module'), originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    return request === 'electron' ? new Proxy(electron, { get: (target, key) => key === 'BrowserWindow' ? OffscreenWindow : target[key] })
      : originalLoad.call(this, request, parent, isMain)
  }
  const errors = []
  const ready = new Promise((resolve, reject) => app.once('browser-window-created', (_event, win) => {
    win.webContents.on('render-process-gone', (_e, info) => reject(new Error(JSON.stringify(info))))
    win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) errors.push(text) })
    win.webContents.once('did-finish-load', () => resolve(win))
  }))
  try { require(path.join(ROOT, 'apps/desktop/out/main/index.js')) } finally { Module._load = originalLoad }
  const win = await ready
  win.setMinimumSize(200, 200)
  win.setContentSize(1540, 940)
  const js = expression => win.webContents.executeJavaScript(expression)
  const wait = async expression => {
    for (let i = 0; i < 100; i++) { if (await js(expression)) return; await sleep(100) }
    throw new Error(`等待失败:${expression}`)
  }
  await wait('!!document.querySelector(".app-root")')
  await js('document.querySelector(".app-ann .app-ann-head button")?.click()')
  const dismissComms = async () => {
    for (let i = 0; i < 20; i++) {
      const found = await js('!!document.querySelector(".app-comm-pop .app-comms-eave-extra button")')
      if (!found) return
      await js('document.querySelector(".app-comm-pop .app-comms-eave-extra button").click()')
      await sleep(100)
    }
    throw new Error('合成档通讯弹层未清空')
  }
  await dismissComms()
  if (mode === 'fleet') {
    await js('document.querySelector("[data-nav-page=ship]").click()')
    await wait('!!document.querySelector(".app-ew-fleet")')
    await js('document.querySelector(".app-ew-fleet summary").click()')
  } else if (mode === 'preview') {
    await js('document.querySelector("[data-nav-page=map]").click()')
    await wait('!![...document.querySelectorAll(".app-subtabs button")].find(button => button.textContent.includes("常驻悬赏"))')
    await js('[...document.querySelectorAll(".app-subtabs button")].find(button => button.textContent.includes("常驻悬赏")).click()')
    await wait('!!document.querySelector(".app-ew-preview > button")')
    await js('document.querySelector(".app-ew-preview > button").click()')
    await wait('!!document.querySelector(".app-ew-preview [data-range-ew] > button")')
    await js('document.querySelector(".app-ew-preview [data-range-ew] > button").click()')
    await wait('!!document.querySelector(".app-ew-detail")')
  } else {
    await wait('!!document.querySelector("[data-range-ew] > button")')
    await js('document.querySelector("[data-range-ew] > button").click()')
    await wait('!!document.querySelector(".app-ew-detail")')
  }
  const selector = mode === 'fleet' ? '.app-ew-fleet' : '.app-ew-detail'
  const text = await js(`document.querySelector(${JSON.stringify(mode === 'fleet' ? selector : '[data-range-ew]')}).innerText`)
  assert(text.includes(expected.meStrength.toLocaleString('en-US')), text)
  if (mode === 'battle') {
    assert(text.includes(expected.foeStrength.toLocaleString('en-US')), text)
    assert(text.includes('电子战前') && text.includes('当前射程'), text)
    assert((await js('document.querySelectorAll(".app-ew-sides section:last-child li").length')) === 7)
    assert((await js('document.querySelectorAll(".app-ew-ranges > div").length')) > 10)
  }
  if (mode === 'preview') assert(text.includes('电子战前') && text.includes('预计射程'), text)
  const geometry = []
  for (const [width, height] of [[1540, 940], [1100, 900], [760, 700]]) {
    win.setContentSize(width, height)
    await sleep(200)
    await dismissComms()
    await sleep(800)
    await dismissComms()
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`)
    await sleep(100)
    const row = await js(`(() => {
      const el=document.querySelector(${JSON.stringify(selector)}), r=el.getBoundingClientRect();
      const hit=document.elementFromPoint(r.left+Math.min(50,r.width/2),r.top+Math.min(50,r.height/2));
      const ancestors=[];for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);ancestors.push({tag:p.tagName,cls:p.className,overflow:s.overflow,z:s.zIndex,position:s.position,transform:s.transform,rect:p.getBoundingClientRect().toJSON()})}
      return {viewport:[innerWidth,innerHeight],left:r.left,right:r.right,top:r.top,bottom:r.bottom,
        visibleHit:el.contains(hit),hit:hit?.className,ancestors,
        clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight};
    })()`)
    geometry.push(row)
    const frame = paints
    win.webContents.invalidate()
    for (let i = 0; i < 30 && paints <= frame; i++) await sleep(50)
    assert(paints > frame, '离屏窗口未生成新画面')
    const image = lastFrame
    await fs.writeFile(path.join(OUT, `${mode}-${width}.png`), image.toPNG())
    await fs.writeFile(path.join(OUT, `${mode}-geometry.json`), JSON.stringify(geometry, null, 2), 'utf8')
    assert(row.visibleHit, `详情被遮挡：${JSON.stringify(row)}`)
    assert(row.left >= -1 && row.right <= row.viewport[0] + 1, JSON.stringify(row))
    assert(row.scrollWidth <= row.clientWidth + 1, JSON.stringify(row))
    assert(row.top >= -1 && row.bottom <= row.viewport[1] + 1, JSON.stringify(row))
  }
  if (mode === 'battle') {
    await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))')
    await wait('!document.querySelector(".app-ew-detail")')
    assert.equal(await js('document.activeElement.matches(".app-ew-trigger")'), true)
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  const report = { ok: true, mode, target: 'desktop-production-file-hidden', electron: process.versions.electron,
    hidden: !win.isVisible(), offscreen: true, paints, isolatedProfile: app.getPath('userData') === profile, geometry, text, errors,
    limitation: '合成档与延后开火夹具，仅验证桌面功能和几何，不代表观感或战斗平衡验收。' }
  await fs.writeFile(path.join(OUT, `${mode}.json`), JSON.stringify(report, null, 2), 'utf8')
  app.exit(0)
}

if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
