/** 统一编队原生压力验收。先npm run build，再node tools/battle-command-native-check.cjs。
 * 独立合成合法12护卫编队；敌方用现有机群卡及其支援规格扩至12舰，仅夹具加血延长压力。
 * 隐藏自建Electron、独立临时userData；不读取个人档或历史报告。输出本批截图/帧率/几何JSON。
 * COMMAND_UI_ONLY=1只跑四组准备交互；WHALE_ELECTRON_EXE可指定已有Electron。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, staticServer, settingsScript, JourneyPage, stopOwned, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/battle-command-20261030')
const PREFIX = 'whale-command-battle-'
function deps() {
  require('tsx/cjs')
  return { core: require('../packages/core/src/index.ts'), data: require('../packages/data/src/index.ts'),
    combat: require('../packages/core/src/combat.ts'), foes: require('../packages/core/src/combat/foes/state.ts') }
}
function fixture(count, drones, carriers = false) {
  const { core, data, combat, foes } = deps(), ctx = data.buildSimContext()
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 20261030 })
  state.fleet = {}; state.modeChosen = true; state.onboarding = { ...state.onboarding, step: 99 }
  state.wallet.isk = 1e9; state.standingsEarned = { dsi: 100 }; state.standings.dsi = 100
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 5]))
  const ships = Array.from({ length: count }, (_, index) => core.addShipToFleet(state, carriers ? index < 3 ? 'sh-swarm' : 'sh-falconet' : 'sh-shrike'))
  state.shipId = ships[0]
  for (const id of ['ammo-kinetic-l', 'drone-scout']) state.warehouse.items[id] = 1000000
  for (const uid of ships) {
    for (const id of ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-prop-2']) {
      core.addModule(state, id)
      const fitted = core.fitModule(state, id, ctx, { shipId: uid })
      assert(fitted.ok, `非法装配:${uid}/${id}/${fitted.error}`)
    }
    if (drones) for (let n = 0; n < (carriers ? 60 : 1); n++) if (!core.adjustDroneLoad(state, ctx, 'drone-scout', 1, uid).ok) break
  }
  core.notePreparationSquad(state, 'combat', ships)
  assert(core.commandBudgetOf(state, ctx, ships).ok)
  const cardId = drones ? 'ano-auro-raiders' : 'ano-training'
  const battle = combat.startFleetBattleFor(state, ctx, ships, cardId, state.gameMs, 1000)
  assert(battle)
  const card = ctx.anomalies.get(cardId), base = combat.activeFoeSpecsOf(card, ctx.balance.battle, 0)
  // 用正式支援建档和参战解析补足压力目标，不添加生产敌卡或任意写入桥。
  for (let i = Object.values(battle.units).filter(u => u.side === 'foe').length; i < count; i++) {
    const n = (battle.foeReviveCount ?? 0) + 1
    battle.foeReviveCount = n
    const spec = { ...structuredClone(base[i % base.length]), tag: `sup${n}-${base[i % base.length].tag}` }
    foes.seedUnit(battle, spec)
    foes.initFoeDronePools(battle, [spec])
  }
  for (const unit of Object.values(battle.units)) { unit.hp = { s: 1e8, a: 1e8, h: 1e8 }; unit.hpMax = { ...unit.hp } }
  battle.distanceM = 1000
  battle.myDesireM = 1000
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: cardId, battle,
    sortie: { version: 1, leaderShipId: ships[0], shipIds: ships }, outMs: 120000 }
  return { state, announcement: data.ANNOUNCEMENTS[0].id }
}
async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const { core } = deps()
  const profiles = []
  for (const { count, drones, carriers } of [{ count: 4, drones: false }, { count: 4, drones: true }, { count: 12, drones: false }, { count: 12, drones: true }, { count: 12, drones: true, carriers: true }]) {
    const made = fixture(count, drones, carriers)
    const label = carriers ? 'carriers' : drones ? 'drones' : 'guns'
    const file = `test-save-command-${count}-${label}-20261030.json`
    await fs.writeFile(path.join(OUT, file), core.serializeSaveFile(made.state, Date.now() + 3600000), 'utf8')
    profiles.push({ count, drones, carriers: !!carriers, label, file, announcement: made.announcement })
  }
  const parked = fixture(12, true)
  parked.state.expedition = { ...core.createInitialState({ nowWallMs: Date.now(), seed: 1 }).expedition }
  parked.state.logs = []
  await fs.writeFile(path.join(OUT, 'test-save-command-preparation-20261030.json'), core.serializeSaveFile(parked.state, Date.now() + 3600000), 'utf8')
  await fs.writeFile(path.join(OUT, 'fixtures.json'), JSON.stringify(profiles, null, 2))
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let server, child, timer
  try {
    await fs.copyFile(path.join(OUT, profiles[0].file), path.join(profile, 'save.json'))
    const hosted = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), {
      initialize: settingsScript(profiles[0].announcement, undefined, { debug: true, test: true }) + ";localStorage.setItem('whale-idle:layout',new URLSearchParams(location.search).get('layout')||'classic')" })
    server = hosted.server
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_AUTOPERF: '1', ELECTRON_RENDERER_URL: hosted.url }
    delete env.ELECTRON_RUN_AS_NODE
    const executable = process.env.WHALE_ELECTRON_EXE ?? path.resolve(ROOT, '../Deepseek-EVE/node_modules/electron/dist/electron.exe')
    await fs.access(executable)
    child = spawn(executable, [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
    console.log(`编队压力隔离窗口 PID=${child.pid}`)
    timer = setTimeout(() => child.kill(), 360000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
  } finally {
    clearTimeout(timer); await stopOwned(child)
    if (server) await new Promise(resolve => server.close(resolve))
    const absolute = path.resolve(profile), temporary = path.resolve(os.tmpdir())
    assert.equal(path.dirname(absolute), temporary)
    assert(path.basename(absolute).startsWith(PREFIX))
    if (await fs.realpath(absolute) === absolute) await fs.rm(absolute, { recursive: true })
  }
}
async function child() {
  const electron = require('electron')
  const { app, BrowserWindow } = electron
  app.setPath('userData', process.env.WHALE_PERF_USERDATA)
  app.setPath('sessionData', process.env.WHALE_PERF_USERDATA)
  BrowserWindow.prototype.show = function () {}; BrowserWindow.prototype.showInactive = function () {}
  let ownWindow
  class OffscreenWindow extends BrowserWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } })
      this.webContents.setFrameRate(60)
      this.webContents.on('paint', () => {})
      ownWindow = this
    }
  }
  const Module = require('node:module'), originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    return request === 'electron' ? new Proxy(electron, { get: (target, key) => key === 'BrowserWindow' ? OffscreenWindow : target[key] }) : originalLoad.call(this, request, parent, isMain)
  }
  try { require(path.join(ROOT, 'apps/desktop/out/main/index.js')) } finally { Module._load = originalLoad }
  await app.whenReady()
  for (let attempt = 0; attempt < 100 && !ownWindow; attempt++) await sleep(50)
  const win = ownWindow, errors = [], readings = []
  assert(win, '隔离窗口未创建')
  assert.equal(path.resolve(app.getPath('userData')), path.resolve(process.env.WHALE_PERF_USERDATA))
  win.setMinimumSize(200, 200)
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable')
  await page.send('Page.enable')
  await page.wait('!!document.querySelector(".app-root")')
  const profiles = JSON.parse(await fs.readFile(path.join(OUT, 'fixtures.json'), 'utf8'))
  for (const layout of ['classic', 'modern']) for (const mobile of [false, true]) for (const item of process.env.COMMAND_UI_ONLY === '1' ? [] : profiles) {
    const id = `${layout}-${mobile ? 'mobile' : 'desktop'}-${item.count}-${item.label}`
    await win.loadURL('about:blank')
    await fs.copyFile(path.join(OUT, item.file), path.join(process.env.WHALE_PERF_USERDATA, 'save.json'))
    await page.send('Emulation.clearDeviceMetricsOverride')
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
    win.setContentSize(1366, 900)
    win.webContents.setBackgroundThrottling(false)
    await page.send('Emulation.setUserAgentOverride', { userAgent: mobile
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' })
    if (mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844,
      deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    try { await win.loadURL(process.env.ELECTRON_RENDERER_URL + '?layout=' + layout) }
    catch (error) { if (error.code !== 'ERR_ABORTED') throw error }
    await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-battle-screen:not(.is-report)")')
    await sleep(1800)
    await page.js(`(()=>{window.__commandFrames=[];window.__commandTasks=[];let last=performance.now();window.__commandRaf=0;const tick=t=>{window.__commandFrames.push(t-last);last=t;window.__commandRaf=requestAnimationFrame(tick)};window.__commandRaf=requestAnimationFrame(tick);window.__commandObserver=new PerformanceObserver(list=>window.__commandTasks.push(...list.getEntries().map(e=>e.duration)));window.__commandObserver.observe({type:'longtask',buffered:false})})()`)
    for (let n = 0; n < (item.carriers ? 100 : 40); n++) { await page.js('window.__whalePlanetaryTest.step(100)'); await sleep(100) }
    const reading = await page.js(`(()=>{
      cancelAnimationFrame(window.__commandRaf);window.__commandObserver.disconnect();
      const q=(a,p)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))]??0;
      const s=document.querySelector('.app-battle-screen'), root=document.querySelector('.app-root'), stage=document.querySelector('.app-bts-lane');
      const units=[...s.querySelectorAll('.app-bts-unit,.app-bts-col.is-me')].map(e=>{const r=e.getBoundingClientRect(),hp=e.querySelector('.app-bts-hpWrap')?.getBoundingClientRect();return {tag:e.dataset.tag,rect:r.toJSON(),hp:hp?.toJSON(),svg:e.querySelectorAll('svg path').length,name:e.querySelector('.app-bts-name')?.textContent}});
      const b=window.__whalePlanetaryTest.snapshot().expedition.battle;
      return {id:${JSON.stringify(id)},count:${item.count},drones:${item.drones},layout:${JSON.stringify(layout)},mobile:${mobile},
        viewport:{w:innerWidth,h:innerHeight},rotated:root.classList.contains('is-mobile-rot'),screen:s.getBoundingClientRect().toJSON(),stage:stage?.getBoundingClientRect().toJSON(),fit:document.querySelector('.app-bts-stage-fit')?.dataset.btsK,units,
        frames:{samples:window.__commandFrames.length,p50:q(window.__commandFrames,.5),p95:q(window.__commandFrames,.95),max:Math.max(...window.__commandFrames),over50:window.__commandFrames.filter(n=>n>50).length},
        longTasks:window.__commandTasks,memory:performance.memory?.usedJSHeapSize,dom:s.querySelectorAll('*').length,paths:s.querySelectorAll('svg path').length,
        playerDrones:Object.keys(b.dronePools??{}).length,droneNodes:s.querySelectorAll('.app-bts-drones span').length,shots:{me:b.stats.meShots,foe:b.stats.foeShots},player:Object.values(b.units).filter(u=>u.side==='me').length,enemy:Object.values(b.units).filter(u=>u.side==='foe'&&u.hp.s+u.hp.a+u.hp.h>0).length,
        invalid:/NaN|Infinity/.test(s.textContent),overflow:document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1};
    })()`)
    await fs.writeFile(path.join(OUT, `${id}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    readings.push(reading)
    await fs.writeFile(path.join(OUT, 'native-report.json'), JSON.stringify({ target: 'apps/desktop/out', syntheticPressureHp: true, pid: process.pid, readings, errors }, null, 2))
    assert.equal(reading.player, item.count); assert.equal(reading.enemy, item.count)
    assert.equal(reading.invalid, false); assert.equal(reading.overflow, false)
    assert.equal(reading.rotated, mobile)
    assert(reading.units.every(u=>u.svg>0), '舰影空白')
    assert.equal(reading.units.length, item.count * 2)
    if (item.count === 12) for (const unit of reading.units) for (const box of [unit.rect, unit.hp]) {
      assert(box && box.left >= reading.stage.left - 2 && box.right <= reading.stage.right + 2 && box.top >= reading.stage.top - 2 && box.bottom <= reading.stage.bottom + 2, `舰体或血条越界:${id}/${unit.tag}`)
    }
    assert(reading.frames.samples >= 100 && reading.frames.p95 < 50, '帧采样不足或95分位超50毫秒')
    await page.tap('[data-battle-weapons-trigger]')
    assert.equal(await page.js('document.querySelectorAll("[data-weapon-owner]").length'), item.count)
    await page.tap('[data-battle-weapons-trigger]')
    const minimize = await page.js(`(()=>{const e=[...document.querySelectorAll('.app-battle-screen button')].find(e=>e.textContent.includes('最小化'));e.dataset.commandMinimize='1';return true})()`)
    assert(minimize)
    await page.tap('[data-command-minimize]')
    await page.wait('!document.querySelector(".app-battle-screen") && !!document.querySelector(".app-battle-float")')
    await page.tap('.app-battle-float')
    await page.wait('!!document.querySelector(".app-battle-screen")')
    await page.js('window.__whalePlanetaryTest.persist()')
    console.log(`${id} 帧P95=${reading.frames.p95.toFixed(1)}ms 长任务=${reading.longTasks.length} 节点=${reading.dom}`)
  }
  const interactions = []
  for (const layout of ['classic', 'modern']) for (const mobile of [false, true]) {
    await win.loadURL('about:blank')
    await fs.copyFile(path.join(OUT, 'test-save-command-preparation-20261030.json'), path.join(process.env.WHALE_PERF_USERDATA, 'save.json'))
    await page.send('Emulation.clearDeviceMetricsOverride')
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
    if (mobile) await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    try { await win.loadURL(process.env.ELECTRON_RENDERER_URL + '?layout=' + layout) }
    catch (error) { if (error.code !== 'ERR_ABORTED') throw error }
    await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-nav-side")')
    await page.js(`(()=>{const e=[...document.querySelectorAll('.app-nav-side button')].find(e=>e.textContent.trim()==='舰船');if(!e)throw Error('缺少舰船导航');e.dataset.commandFleetNav='1'})()`)
    await page.tap('[data-command-fleet-nav]')
    await page.tap('[data-command-squad-trigger]')
    await page.wait('!!document.querySelector(".app-command-modal")')
    await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}-preparation-before.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}-preparation-geometry.json`), JSON.stringify(await page.js(`(()=>{const el=document.querySelector('.app-command-modal input:not(:disabled)'),r=el.getBoundingClientRect();const ancestors=[];for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);ancestors.push({class:p.className,rect:p.getBoundingClientRect().toJSON(),overflow:s.overflow,position:s.position,transform:s.transform})}return {viewport:{width:innerWidth,height:innerHeight},ancestors,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML}})()`), null, 2))
    const firstAlly = await page.js(`document.querySelector('.app-command-modal input:not(:disabled)').dataset.commandShip`)
    await tapDialogInput(page, firstAlly, mobile)
    assert.equal((await page.js('window.__whalePlanetaryTest.snapshot().preparationSquads.combat')).length, 11)
    await tapDialogInput(page, firstAlly, mobile)
    assert.equal((await page.js('window.__whalePlanetaryTest.snapshot().preparationSquads.combat')).length, 12)
    const modal = await page.js(`(()=>{const e=document.querySelector('.app-command-modal'),r=e.getBoundingClientRect();return {rect:r.toJSON(),text:e.textContent,body:e.querySelector('.app-modal-body').getBoundingClientRect().toJSON(),cards:e.querySelectorAll('input').length,invalid:/NaN|Infinity/.test(e.textContent)}})()`)
    assert.equal(modal.cards, 12); assert.equal(modal.invalid, false)
    assert(modal.rect.left >= -2 && modal.rect.top >= -2 && modal.rect.right <= (await page.js('innerWidth')) + 2 && modal.rect.bottom <= (await page.js('innerHeight')) + 2, '编队弹层越界')
    await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}-preparation.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.wait('!document.querySelector(".app-command-modal")')
    await page.js('window.__whalePlanetaryTest.persist()')
    interactions.push({ layout, mobile, modal, toggled: true, escapeClosed: true, persisted: true })
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(OUT, process.env.COMMAND_UI_ONLY === '1' ? 'ui-report.json' : 'native-report.json'), JSON.stringify({ target: 'apps/desktop/out', offscreen: true, syntheticPressureHp: true, pid: process.pid, readings, interactions, errors, ok: true }, null, 2))
  win.webContents.debugger.detach(); app.exit(0)
}
/** fixed弹层不被非包含块的页面滚动祖先裁切；实测弹层边界与elementFromPoint后发真实输入。 */
async function tapDialogInput(page, shipId, mobile) {
  const point = await page.js(`(()=>{const e=document.querySelector('[data-command-ship='+CSS.escape(${JSON.stringify(shipId)})+']');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect(),body=e.closest('.app-modal-body').getBoundingClientRect(),dialog=e.closest('[role=dialog]').getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(e.disabled||hit!==e||x<body.left||x>body.right||y<body.top||y>body.bottom||x<dialog.left||y<dialog.top||x>=innerWidth||y>=innerHeight)throw Error('勾选框实际不可命中:'+JSON.stringify({r,body,dialog,hit:hit?.outerHTML}));return {x,y}})()`)
  if (mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  }
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
