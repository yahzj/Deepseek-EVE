/** 本批合成入侵档的隐藏原生窗口检查；不读取个人档。
 * 用法：npm run build后，node tools/alien-invasion-ui-check.cjs。
 * 游戏v0.1.0 / 存档v31，2026-10-08；--summon-only只检查召唤后的成虫。
 * 截图和报告在tools/_ui-artifacts/alien-invasion；读数不是观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, sleep, settingsScript, JourneyPage, staticServer, stopOwned, removeProfile } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/alien-invasion')

function fixture(scenario) {
  require('tsx/cjs')
  const { buildSimContext } = require('../packages/data/src/context.ts')
  const { alienFixture } = require('./alien-invasion-fixture.ts')
  const { startFleetBattleFor, advanceBattleFor } = require('../packages/core/src/combat.ts')
  const { serializeSaveFile } = require('../packages/core/src/save.ts')
  const ctx = buildSimContext()
  const { state, ships } = alienFixture(ctx, 'heavy', 611, 4)
  state.onboarding = { ...state.onboarding, step: 99 }
  state.modeChosen = true
  if (scenario === 'summon') for (const uid of ships) state.fleet[uid].fitted.high = []
  const id = scenario === 'main' ? 'alien-main' : 'alien-broodmother'
  const battle = startFleetBattleFor(state, ctx, ships, id, 0, 200)
  assert(battle)
  for (const [tag, unit] of Object.entries(battle.units)) if (unit.side === 'foe') delete battle.units[tag]
  delete battle.foeDronePools
  battle.waveIdx = scenario === 'main' ? 1 : 3
  state.gameMs = 100
  advanceBattleFor(state, ctx, battle, state.shipId, id)
  // 隔离窗口冻结心跳；先用真实引擎走完入场，避免把屏幕外飞入起点当作阵形越界。
  state.gameMs = 3000
  advanceBattleFor(state, ctx, battle, state.shipId, id)
  if (scenario === 'summon') {
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe' && unit.foeShipId !== 'foe-alien-broodmother') unit.hp = { s: 0, a: 0, h: 0 }
    for (let time = 3100; time <= 35000; time += 100) {
      state.gameMs = time
      advanceBattleFor(state, ctx, battle, state.shipId, id)
    }
    const adults = Object.values(battle.units).filter(unit => unit.tag.startsWith('sup') && unit.foeShipId === 'foe-alien-starcore-adult')
    assert.equal(adults.length, 3, '真实召唤数量不等于三架')
    assert(adults.every(unit => Math.abs(unit.hpMax.s + unit.hpMax.a + unit.hpMax.h - 936) < 1e-7), '成虫倍率不等于原旗舰战成虫')
    assert.equal(battle.ended, null, '召唤检查点已结束')
  }
  battle.alienCorrosion = .15
  state.expedition = { ...state.expedition, active: true, phase: 'battle', shipId: ships[0], galaxyId: 'galaxy-kor', foeGalaxyId: 'galaxy-kor', anomalyId: id, battle }
  return { save: serializeSaveFile(state), announcement: require('../packages/data/src/announcements.ts').ANNOUNCEMENTS[0]?.id ?? 'synthetic' }
}

async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const reports = []
  for (const scenario of process.argv.includes('--summon-only') ? ['summon'] : ['main', 'boss', 'summon']) for (const layout of ['classic', 'modern']) {
    const input = fixture(scenario)
    const prefix = 'whale-alien-ui-'
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const init = settingsScript(input.announcement, undefined, { debug: true, test: true, layout })
    let server
    let child
    let timer
    try {
      const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), { initialize: init })
      server = served.server
      const url = served.url
      await fs.writeFile(path.join(profile, 'save.json'), input.save)
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: url, ALIEN_UI_SCENARIO: scenario, ALIEN_UI_LAYOUT: layout }
      delete env.ELECTRON_RUN_AS_NODE
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
      console.log(`隔离窗口 ${scenario}/${layout} PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 90_000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
      reports.push(JSON.parse(await fs.readFile(path.join(OUT, `ui-${scenario}-${layout}.json`), 'utf8')))
    } finally {
      clearTimeout(timer)
      await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, prefix)
    }
  }
  await fs.writeFile(path.join(OUT, process.argv.includes('--summon-only') ? 'ui-summon-report.json' : 'ui-report.json'), JSON.stringify({ reports, scope: '隐藏原生窗口几何、非空截图与真实合成战斗；不代表观感验收。' }, null, 2))
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setMinimumSize(200, 200)
  const errors = []
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable')
  await page.wait('!!document.querySelector(".app-root")')
  await page.wait('!!document.querySelector(".app-battle-float") || !!document.querySelector(".app-battle-screen")')
  if (await page.js('!!document.querySelector(".app-battle-float")')) await page.tap('.app-battle-float')
  const rows = []
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    win.setContentSize(width, height)
    if (width === 390) {
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      await page.reload()
      await page.wait('!!document.querySelector(".app-battle-screen")')
      await page.wait('!!document.querySelector(".app-root.is-mobile-rot")')
    }
    await sleep(500)
    const geometry = await page.js(`(()=>{const screen=document.querySelector('.app-battle-screen');const units=[...screen.querySelectorAll('.app-bts-unit')];return {w:innerWidth,h:innerHeight,mobile:document.querySelector('.app-root').classList.contains('is-mobile-rot'),screen:screen.getBoundingClientRect().toJSON(),unitCount:units.length,svgs:units.map(u=>({tag:u.dataset.tag,paths:u.querySelectorAll('svg path').length,box:u.getBoundingClientRect().toJSON()})),text:screen.textContent.slice(-2500)}})()`)
    await fs.writeFile(path.join(OUT, `ui-diagnostic-${process.env.ALIEN_UI_SCENARIO}-${process.env.ALIEN_UI_LAYOUT}-${width}.json`), JSON.stringify(geometry, null, 2))
    const diagnostic = await win.webContents.capturePage(undefined, { stayHidden: true })
    await fs.writeFile(path.join(OUT, `ui-diagnostic-${process.env.ALIEN_UI_SCENARIO}-${process.env.ALIEN_UI_LAYOUT}-${width}.png`), diagnostic.toPNG())
    assert(geometry.unitCount >= 4, '真实编队未显示')
    if (process.env.ALIEN_UI_SCENARIO === 'summon') {
      const adults = await page.js(`Array.from(document.querySelectorAll('.app-bts-unit[data-tag^=sup]'),e=>({tag:e.dataset.tag,text:e.textContent,paths:e.querySelectorAll('svg path').length,adultArt:[...e.querySelectorAll('svg path')].some(p=>p.getAttribute('d')?.includes('M84 48 Q92 62 84 86'))}))`)
      assert.equal(adults.length, 3, '召唤成虫舰影未完整渲染')
      assert(adults.every(unit => unit.text.includes('星髓成虫') && unit.paths > 0 && unit.adultArt), '召唤成虫名称或独立舰影缺失')
      geometry.summoned = adults
    }
    assert.equal(geometry.w, width, '实际视口宽度不得被原生最小尺寸钳制')
    assert.equal(geometry.h, height, '实际视口高度与请求不符')
    assert(geometry.svgs.every(s => s.paths > 0 && s.box.width > 0 && s.box.height > 0), '舰影空白或尺寸归零')
    assert(geometry.svgs.every(s => s.box.left >= -1 && s.box.top >= -1 && s.box.right <= width + 1 && s.box.bottom <= height + 1), '舰影超出实际视口')
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    assert(!image.isEmpty())
    const bitmap = image.toBitmap()
    const colors = new Set()
    for (let i = 0; i + 4 <= bitmap.length; i += 128) colors.add(bitmap.readUInt32LE(i))
    assert(colors.size > 12, '窗口截图空白')
    await fs.writeFile(path.join(OUT, `ui-${process.env.ALIEN_UI_SCENARIO}-${process.env.ALIEN_UI_LAYOUT}-${width}.png`), image.toPNG())
    rows.push(geometry)
  }
  assert.equal(errors.length, 0, '渲染运行错误')
  await fs.writeFile(path.join(OUT, `ui-${process.env.ALIEN_UI_SCENARIO}-${process.env.ALIEN_UI_LAYOUT}.json`), JSON.stringify({ pid: process.pid, rows, errors }, null, 2))
  win.webContents.debugger.detach()
  app.quit()
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
