/** 守墓四卡完整实战及十一波距离核查；只使用既有合法配装合成夹具，不读取个人档。
 * 用法：node tools/gravekeeper-battle-check.cjs [--native]。
 * --native须先npm run build；隐藏自建Electron与隔离userData，验证读数不作观感验收。
 * 输出tools/_ui-artifacts/gravekeeper-battle-20261017/；游戏v0.1.0/档v31。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, staticServer, settingsScript, JourneyPage, stopOwned, removeProfile, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/gravekeeper-battle-20261017')
const PREFIX = 'whale-grave-battle-'

function deps() {
  require('tsx/cjs')
  return {
    core: require('../packages/core/src/index.ts'), data: require('../packages/data/src/index.ts'),
    combat: require('../packages/core/src/combat.ts'),
    fixture: require('./gravekeeper-invasion-check.ts').injectGravekeeperFixture,
  }
}
function make(id, seed = 11) {
  const { core, data, combat, fixture } = deps()
  const ctx = data.buildSimContext()
  const state = core.createInitialState({ nowWallMs: Date.now(), seed })
  fixture(state)
  state.rng = core.createInitialState({ nowWallMs: 0, seed }).rng
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  const ships = id.endsWith('flagship') ? state.weekendPrepSquad : state.weekendPrepSquad.slice(0, 1)
  const override = id.endsWith('flagship') ? {
    bossShipId: 'foe-d-invasion-eternal-tomb', bossHp: 300000, bossHpMax: 300000,
    bossHpLayers: { s: 90000, a: 120000, h: 90000 },
  } : undefined
  const card = combat.applyFoeOverride(ctx.anomalies.get(id), override)
  const battle = combat.startFleetBattleFor(state, ctx, ships, id, 0, null, undefined, override)
  assert(battle, '战斗建档失败')
  // 普通入口的覆写由战斗存档携带，避免把旗舰基础定价血量当实战共享池。
  if (override) battle.foeOverride = override
  state.encounter = { active: true, shipId: ships[0], galaxyId: 'galaxy-maw', name: card.name,
    threat: card.threat, anomalyId: id, origin: '入侵', invitedAtGameMs: 0, deadlineGameMs: 999999999, battle }
  return { state, ctx, card, battle, ships, combat, core }
}
function view(f) {
  return f.combat.battleArcsFor(f.state, f.ctx, { anomaly: f.card, battle: f.battle, leaderShipId: f.ships[0] })
}
function checkMotion(f, want) {
  const readings = []
  for (const delta of [-500, 0, 500]) {
    const state = structuredClone(f.state), b = state.encounter.battle
    const start = want + delta
    b.distanceM = start; b.myDesireM = start
    for (const u of Object.values(b.units)) { delete u.enteredAtMs; u.weapons.fill(1e9) }
    state.gameMs += 10
    f.combat.advanceBattleFor(state, f.ctx, b, f.ships[0], f.card.id)
    const shift = b.distanceM - start
    assert(delta < 0 ? shift > 0 : delta > 0 ? shift < 0 : Math.abs(shift) < 1e-6, `期望距离与移动方向不符:${f.card.id}:${b.waveIdx}:${delta}:${shift}`)
    readings.push({ start, shift })
  }
  return readings
}
function checkpoint(id, wave) {
  const f = make(id)
  for (const [tag, u] of Object.entries(f.battle.units)) if (u.side === 'foe') delete f.battle.units[tag]
  f.battle.waveIdx = wave
  f.state.gameMs = 3000
  f.combat.advanceBattleFor(f.state, f.ctx, f.battle, f.ships[0], id)
  f.state.gameMs = 6000
  f.combat.advanceBattleFor(f.state, f.ctx, f.battle, f.ships[0], id)
  const specs = f.combat.activeFoeSpecsOf(f.card, f.ctx.balance.battle, wave)
  const me = f.combat.createPlayerSpec(f.state, f.ctx, f.ships[0])
  const expected = Math.min(f.combat.battleOpenM(me, specs, f.ctx.balance.battle), f.combat.foeDesiredRange(me, specs, f.ctx.balance.battle))
  const arcs = view(f)
  assert.equal(arcs.foeDesireM, expected)
  const motion = checkMotion(f, expected)
  f.battle.distanceM = expected + 500; f.battle.myDesireM = expected + 500
  return { f, row: { id, name: f.card.name, wave: wave + 1, expected,
    head: specs[0].name, band: specs[0].foeRangeBand, tactic: specs[0].foeTactic,
    roster: specs.map(s => s.name), motion } }
}
function useNativeHost(f) {
  if (!f.card.id.endsWith('flagship')) {
    f.state.expedition = { ...f.state.expedition, active: true, phase: 'battle',
      shipId: f.ships[0], galaxyId: 'galaxy-maw', foeGalaxyId: 'galaxy-maw', anomalyId: f.card.id, battle: f.battle }
    f.state.encounter = { ...f.state.encounter, active: false, battle: null }
  }
}
async function audit() {
  const results = [], checkpoints = []
  const ids = ['gravekeeper-drift', 'gravekeeper-line', 'gravekeeper-main', 'gravekeeper-flagship']
  for (const id of ids) {
    const fresh = make(id)
    useNativeHost(fresh)
    await fs.writeFile(path.join(OUT, `${id}-start.json`), fresh.core.serializeSaveFile(fresh.state, Date.now() + 3600000))
    const count = make(id).card.waves.length
    for (let wave = 0; wave < count; wave++) {
      const { f, row } = checkpoint(id, wave)
      useNativeHost(f)
      const save = f.core.serializeSaveFile(f.state, Date.now() + 3600000)
      const file = `${id}-wave-${wave + 1}.json`
      await fs.writeFile(path.join(OUT, file), save, 'utf8')
      checkpoints.push({ ...row, file })
    }
    for (const seed of [11, 29, 47]) {
      const f = make(id, seed), waves = new Map()
      for (let t = 100; t <= 660000 && !f.battle.ended; t += 100) {
        f.state.gameMs = t
        f.combat.advanceBattleFor(f.state, f.ctx, f.battle, f.ships[0], id)
        const wi = f.battle.waveIdx ?? 0
        if (!waves.has(wi)) waves.set(wi, { wave: wi + 1, atSeconds: t / 1000, desire: view(f).foeDesireM, myDesire: f.battle.myDesireM, distance: f.battle.distanceM })
      }
      const row = { id, seed, ended: f.battle.ended, seconds: f.battle.lastTickGameMs / 1000,
        waves: [...waves.values()], foeShots: f.battle.stats.foeShots,
        boss: f.combat.flagshipBattleLedger(f.battle, ['foe-d-invasion-eternal-tomb']) }
      assert(f.battle.ended, '完整实战未在上限内结算')
      results.push(row)
      console.log(`完整实战 ${id} 种子${seed} ${row.ended} ${row.seconds}秒 抵达${waves.size}/${count}波`)
    }
  }
  await fs.writeFile(path.join(OUT, 'engine-report.json'), JSON.stringify({ results, checkpoints }, null, 2))
  console.table(checkpoints.map(({ id, wave, head, expected }) => ({ id, wave, head, expected })))
  return checkpoints
}
async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const checkpoints = await audit()
  if (!process.argv.includes('--native')) return
  const { data } = deps()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let server, child, timer
  try {
    await fs.copyFile(path.join(OUT, checkpoints[0].file), path.join(profile, 'save.json'))
    const hosted = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), { initialize: settingsScript(data.ANNOUNCEMENTS[0].id) })
    server = hosted.server
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: hosted.url }
    delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
    child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
    console.log(`逐波隔离桌面 PID=${child.pid}`)
    timer = setTimeout(() => child.kill(), 300000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
  } finally {
    clearTimeout(timer); await stopOwned(child)
    if (server) await new Promise(resolve => server.close(resolve))
    await removeProfile(profile, PREFIX)
  }
}
async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], errors = [], readings = []
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable')
  const report = JSON.parse(await fs.readFile(path.join(OUT, 'engine-report.json'), 'utf8'))
  const buildHtml = await fs.readFile(path.join(ROOT, 'apps/desktop/out/renderer/index.html'), 'utf8')
  const buildAsset = buildHtml.match(/src="([^"]+\.js)"/)[1]
  for (const item of report.checkpoints) {
    await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
    if (await page.js('!!document.querySelector(".app-battle-float")')) await page.tap('.app-battle-float')
    await page.wait('!!document.querySelector(".app-battle-screen:not(.is-report)")')
    await sleep(1000)
    const before = await page.js('window.__whalePlanetaryTest.snapshot()')
    const beforeHost = item.id.endsWith('flagship') ? before.encounter : before.expedition
    assert.equal(beforeHost.anomalyId, item.id)
    assert.equal(beforeHost.battle.waveIdx ?? 0, item.wave - 1)
    const rendered = await page.js(`(()=>{const s=document.querySelector('.app-battle-screen');return {text:s.textContent,ships:[...s.querySelectorAll('.app-bts-unit')].map(e=>({text:e.textContent,paths:e.querySelectorAll('svg path').length})),range:s.querySelector('.app-bts-desire')?.textContent}})()`)
    assert(item.roster.every(name => rendered.text.includes(name)), `缺少本波舰名:${item.id}:${item.wave}`)
    assert(rendered.ships.length >= item.roster.length && rendered.ships.every(s => s.paths > 0), `舰影没有完整渲染:${JSON.stringify(rendered.ships)}`)
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    assert(!image.isEmpty())
    await fs.writeFile(path.join(OUT, `${item.id}-${item.wave}.png`), image.toPNG())
    await page.js('window.__whalePlanetaryTest.step(100)')
    const after = await page.js('window.__whalePlanetaryTest.snapshot()')
    const afterHost = item.id.endsWith('flagship') ? after.encounter : after.expedition
    assert.equal(afterHost.battle.myDesireM, beforeHost.battle.myDesireM, '步进改写玩家期望距离')
    const moved = afterHost.battle.distanceM - beforeHost.battle.distanceM
    assert(moved < 0, `桌面战斗未朝期望距离接近:${item.id}:${item.wave}:${moved}`)
    await page.js('window.__whalePlanetaryTest.persist()')
    const saved = JSON.parse(await fs.readFile(path.join(process.env.WHALE_PERF_USERDATA, 'save.json'), 'utf8')).state
    assert.equal((item.id.endsWith('flagship') ? saved.encounter : saved.expedition).battle.distanceM, afterHost.battle.distanceM)
    readings.push({ id: item.id, wave: item.wave, expected: item.expected, moved, range: rendered.range,
      renderedShips: rendered.ships, saved: true })
    console.log(`桌面 ${item.id} 第${item.wave}波 期望${item.expected}米 位移${moved.toFixed(3)}米 IPC通过`)
    const next = report.checkpoints[readings.length]
    if (next) {
      await win.loadURL('about:blank')
      await fs.copyFile(path.join(OUT, next.file), path.join(process.env.WHALE_PERF_USERDATA, 'save.json'))
      await win.loadURL(process.env.ELECTRON_RENDERER_URL)
      await sleep(100)
    }
  }
  const fullBattles = []
  for (const id of ['gravekeeper-drift', 'gravekeeper-line', 'gravekeeper-main', 'gravekeeper-flagship']) {
    await win.loadURL('about:blank')
    await fs.copyFile(path.join(OUT, `${id}-start.json`), path.join(process.env.WHALE_PERF_USERDATA, 'save.json'))
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
    await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-battle-screen:not(.is-report)")')
    const before = await page.js('window.__whalePlanetaryTest.snapshot()')
    const hostKey = id.endsWith('flagship') ? 'encounter' : 'expedition'
    const wanted = before[hostKey].battle.myDesireM
    const waves = new Set([1])
    let final
    for (let n = 0; n < 330; n++) {
      await page.js('window.__whalePlanetaryTest.step(2000)')
      final = await page.js('window.__whalePlanetaryTest.snapshot()')
      const b = final[hostKey].battle
      if (b) waves.add((b.waveIdx ?? 0) + 1)
      if (!b || b.ended) break
      assert.equal(b.myDesireM, wanted, '自然换波改写玩家期望距离')
    }
    assert(!final[hostKey].battle || final[hostKey].battle.ended, '桌面战斗未结算')
    const verdict = final[hostKey].battle?.ended
    await page.js('window.__whalePlanetaryTest.step(5000)')
    final = await page.js('window.__whalePlanetaryTest.snapshot()')
    assert(id.endsWith('flagship') ? !final.encounter.active
      : !final.expedition.active || final.expedition.battle === null || final.expedition.phase !== 'battle', '击杀慢镜后宿主未结算')
    assert(final.gameMs > before.gameMs)
    fullBattles.push({ id, simulatedSeconds: (final.gameMs - before.gameMs) / 1000, waves: [...waves], myDesire: wanted,
      ended: verdict ?? '已由真实宿主结算并移除', settled: true, logs: final.logs.slice(-12).map(l => l.text) })
    await fs.writeFile(path.join(OUT, `${id}-completed.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    console.log(`桌面完整战斗 ${id} ${(final.gameMs - before.gameMs) / 1000}秒 抵达${[...waves].join('/')}波 已结算，玩家期望不变`)
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(OUT, 'native-report.json'), JSON.stringify({ target: 'apps/desktop/out', buildAsset,
    pid: process.pid, readings, fullBattles, errors }, null, 2))
  win.webContents.debugger.detach(); app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
