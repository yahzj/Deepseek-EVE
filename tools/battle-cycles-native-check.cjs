/** 战斗周期原生验收 v1，2026-10-08；游戏 v0.1.0 / 存档 v31。
 * 输入：当前 core/data、apps/desktop/out 构建；仅使用合成四艘 T4 战列舰档。
 * 用法：父侧 npm run build 后 node tools/battle-cycles-native-check.cjs。
 * 可选：--case=classic-zh-desktop（classic/modern x zh/en x desktop/mobile）、
 * --self-test（只跑合法配装、真实四波推进及工具隔离检查，不启动 Electron）、--help。
 * 输出：tools/_ui-artifacts/battle-cycles 的截图、DOM/CSS 读数与隔离清理报告。
 * 不读个人档、不构建、不改业务文件、不提交；截图及像素仅证实渲染，不作观感结论。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { createHash, randomUUID } = require('node:crypto')
const { ROOT, JourneyPage, settingsScript, staticServer, sleep } = require('./wormhole-expedition-journey-shared.cjs')

const PREFIX = 'whale-battle-cycles-'
const OUT = path.join(ROOT, 'tools/_ui-artifacts/battle-cycles')
const OWNER_FILE = '.battle-cycles-owner.json'
const SEL = {
  trigger: '.app-bc-trigger', popup: '.app-bc-popup', weapons: '.app-bc-popup [data-cycle-id]',
  devices: '.app-bc-device-scroll [data-cycle-id]', deviceScroll: '.app-bc-device-scroll',
  screen: '.app-battle-screen', web: '[data-web-from="ally-1"]',
}
const CASES = ['classic', 'modern'].flatMap(layout => ['zh', 'en'].flatMap(locale =>
  [false, true].map(mobile => ({ layout, locale, mobile, id: `${layout}-${locale}-${mobile ? 'mobile' : 'desktop'}` }))))

function dependencies() {
  require('tsx/cjs')
  return {
    core: require('../packages/core/src/index.ts'), data: require('../packages/data/src/index.ts'),
    combat: require('../packages/core/src/combat.ts'), equipment: require('../packages/core/src/equipment.ts'),
    moduleAllowedOnShip: require('../packages/core/src/shipFitting.ts').moduleAllowedOnShip,
  }
}

function selectedCases(args) {
  let selected
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--case') { assert(selected === undefined, '重复 --case'); selected = args[++i]; assert(selected, '--case 缺少值') }
    else if (args[i].startsWith('--case=')) { assert(selected === undefined, '重复 --case'); selected = args[i].slice(7) }
    else assert(['--self-test', '--help'].includes(args[i]), `未知参数：${args[i]}`)
  }
  const result = selected === undefined ? CASES : CASES.filter(row => row.id === selected)
  assert(result.length, `未知组合：${selected}；可用 ${CASES.map(row => row.id).join(', ')}`)
  return result
}

function checkedProfile(profile) {
  assert(typeof profile === 'string' && path.isAbsolute(profile), '隔离目录必须是绝对路径')
  const absolute = path.resolve(profile), temporary = path.resolve(os.tmpdir())
  const relative = path.relative(temporary, absolute)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), '隔离目录越出临时目录')
  assert.equal(path.dirname(absolute), temporary, '隔离目录必须是临时目录的直接子目录')
  assert(path.basename(absolute).startsWith(PREFIX), '隔离目录前缀不匹配')
  return absolute
}

async function verifyOwner(profile, token, parentPid) {
  const absolute = checkedProfile(profile)
  const stat = await fs.lstat(absolute)
  assert(stat.isDirectory() && !stat.isSymbolicLink(), '隔离目录不是普通目录')
  assert.equal(await fs.realpath(absolute), absolute, '隔离目录含重解析路径，拒绝使用或清理')
  const owner = JSON.parse(await fs.readFile(path.join(absolute, OWNER_FILE), 'utf8'))
  assert.equal(owner.token, token, '隔离目录归属令牌不匹配')
  assert.equal(owner.parentPid, parentPid, '隔离目录归属 PID 不匹配')
  assert.equal(owner.profile, absolute, '隔离目录归属绝对路径不匹配')
  return absolute
}

async function removeOwnedProfile(profile, token) {
  const absolute = await verifyOwner(profile, token, process.pid)
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fs.rm(absolute, { recursive: true, force: false })
      assert.equal(await fs.access(absolute).then(() => true, () => false), false, '隔离目录清理未完成')
      return { absolute, removed: true }
    } catch (error) {
      if (attempt === 19) throw error
      await sleep(250)
    }
  }
}

async function stopOwned(child) {
  if (!child || !Number.isInteger(child.pid)) return
  if (child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  child.kill()
  await Promise.race([exit, sleep(5000)])
  assert(child.exitCode !== null || child.signalCode !== null, `自建 PID ${child.pid} 尚未退出；不清理仍在使用的档`)
}

function viewOf(state, ctx, combat) {
  const battle = state.expedition.battle
  const base = combat.battleAnomalyOf(ctx, state.expedition.anomalyId)
  const anomaly = combat.applyFoeOverride(base, battle.foeOverride)
  return combat.battleArcsFor(state, ctx, { battle, anomaly, leaderShipId: state.shipId })
}

function validateFleet(state, ctx, ships, equipment, moduleAllowedOnShip) {
  return ships.map((shipId, index) => {
    const ship = state.fleet[shipId], def = ctx.ships.get('sh-megalodon')
    assert.equal(def.tier, 4, '夹具必须使用实际 T4 船体')
    for (const rack of ['high', 'mid', 'low']) {
      assert(ship.fitted[rack].length <= def.slots[rack], `槽位超限：${shipId}/${rack}`)
      for (const id of ship.fitted[rack].filter(Boolean)) {
        const mod = ctx.modules.get(id)
        assert(mod && mod.rack === rack && moduleAllowedOnShip(def, mod), `非法模块：${shipId}/${id}`)
      }
    }
    const used = equipment.fittedCpuUsed(ship.fitted, ctx, def) + equipment.droneCpuUsed(ship.droneLoad, ctx)
    const budget = equipment.cpuBudgetOf(state, ctx, shipId)
    const volume = Object.entries(ship.droneLoad).reduce((n, [id, count]) => n + ctx.items.get(id).unitM3 * count, 0)
    const capacity = equipment.droneBayTotalM3(def, ship.fitted, ctx)
    assert(used <= budget, `算力超载：${shipId}/${used}/${budget}`)
    assert(volume <= capacity, `无人机舱超载：${shipId}/${volume}/${capacity}`)
    assert.equal(ship.fitted.high.includes('mod-lair-web-h'), index > 0, '只有僚舰装网，主控无网')
    return { shipId, defId: def.id, tier: def.tier, fitted: ship.fitted, drones: ship.droneLoad, used, budget, volume, capacity }
  })
}

function makeFixture() {
  const { core, data, combat, equipment, moduleAllowedOnShip } = dependencies()
  const ctx = data.buildSimContext()
  const state = core.createInitialState({ seed: 1008611, nowWallMs: Date.now() })
  state.wallet.isk = 1e9
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  state.resupplyFromWarehouse = true
  for (const id of ctx.skills.keys()) state.skills.trained[id] = 5
  const ships = Array.from({ length: 4 }, () => core.addShipToFleet(state, 'sh-megalodon'))
  state.shipId = ships[0]
  for (const [index, uid] of ships.entries()) {
    const gear = ['mod-cpu-3', 'mod-dc-3', 'mod-armor-plate-2',
      'mod-laser-3', 'mod-laser-3', index ? 'mod-lair-web-h' : 'mod-laser-3',
      'mod-pd-e-3', 'mod-shieldfield-2', 'mod-drone-deck-2',
      'mod-hullrep-2', 'mod-shieldchg-2', 'mod-prop-2', 'mod-shield-kin-2', 'mod-shield-pla-2']
    for (const id of gear) {
      core.addModule(state, id)
      const result = core.fitModule(state, id, ctx, { shipId: uid })
      assert(result.ok, `真实装配失败：${uid}/${id}/${result.error}`)
    }
    state.warehouse.items['drone-scout'] = (state.warehouse.items['drone-scout'] ?? 0) + 12
    const loaded = core.adjustDroneLoad(state, ctx, 'drone-scout', 2, uid)
    assert(loaded.ok, `真实载机失败：${loaded.error}`)
  }
  for (const id of ['ammo-kinetic-l', 'ammo-plasma-l', 'ammo-explosive-l', 'repairkit-mil', 'repairkit-dc']) state.warehouse.items[id] = 100000
  const fittings = validateFleet(state, ctx, ships, equipment, moduleAllowedOnShip)
  const anomalyId = 'alien-broodmother'
  // 通过已有旗舰开战覆写口设验收预算；不改舰级/挂载件，不写运行态血量或波次。
  const override = { strengthMul: 0.12, keepCardWaves: true, bossShipId: 'foe-alien-broodmother', bossHp: 2000000, bossHpMax: 2000000 }
  const battle = combat.startFleetBattleFor(state, ctx, ships, anomalyId, state.gameMs, 2500, undefined, override)
  assert(battle && battle.myFleet.length === 4, '真实多舰建战失败')
  state.expedition = { ...state.expedition, active: true, phase: 'battle', shipId: ships[0],
    galaxyId: ctx.anomalies.get(anomalyId).galaxyId, foeGalaxyId: ctx.anomalies.get(anomalyId).galaxyId, anomalyId, battle }
  const initial = core.loadSaveFile(core.serializeSaveFile(state)).state
  const opening = viewOf(initial, ctx, combat)
  assert(opening.weapons.length > 16, '四舰武器列表没有足够滚动内容')
  assert(opening.weapons.every(row => row.state === 'reload' && row.remainingMs > 0), '新战斗并非逐件初始装填')
  const kinds = [...new Set(opening.devices.map(row => row.kind))]
  for (const kind of ['repair', 'shield-charge', 'shield-field', 'drone-deck', 'thruster', 'web']) assert(kinds.includes(kind), `缺少实际装置：${kind}`)
  assert(!opening.devices.some(row => row.kind === 'web' && row.ownerTag === 'player'), '主控不应出现捕获网')
  const waves = [0], steps = []
  let final
  for (let tick = 0; tick < 9000 && !battle.ended; tick++) {
    state.gameMs += 100
    combat.advanceBattleFor(state, ctx, battle, state.shipId, anomalyId)
    if (!waves.includes(battle.waveIdx ?? 0)) waves.push(battle.waveIdx)
    if (tick % 100 === 0) steps.push({ gameMs: state.gameMs, wave: battle.waveIdx ?? 0, shots: battle.stats.meShots })
    if (battle.waveIdx === 3 && state.gameMs >= (battle.foeWaveStartMs ?? 0) + 2500) {
      const arcs = viewOf(state, ctx, combat)
      if (arcs.webLinks?.some(link => link.from === 'ally-1') && arcs.myUnits.every(unit => unit.alive)) {
        final = core.loadSaveFile(core.serializeSaveFile(state)).state
        break
      }
    }
  }
  assert(final, `真实推进未到末波投网：${JSON.stringify({ waves, ended: battle.ended, gameMs: state.gameMs, steps })}`)
  assert.deepEqual(waves, [0, 1, 2, 3], '没有连续实际走过全部四波')
  const finalView = viewOf(final, ctx, combat)
  const link = finalView.webLinks.find(row => row.from === 'ally-1')
  const web = finalView.devices.find(row => row.kind === 'web' && row.ownerTag === 'ally-1')
  assert.equal(web.state, 'active')
  assert.equal(web.targetTag, link.to)
  const boss = Object.values(final.expedition.battle.units).find(unit => unit.foeShipId === override.bossShipId && unit.hp.s + unit.hp.a + unit.hp.h > 0)
  assert(boss && boss.hp.s + boss.hp.a + boss.hp.h > 1000000, '末波旗舰厚血不足')
  const frames = []
  for (let i = 0; i < 4; i++) {
    state.gameMs += 100
    combat.advanceBattleFor(state, ctx, battle, state.shipId, anomalyId)
    assert(!battle.ended, '刷新检查点不能结束战斗')
    frames.push(core.loadSaveFile(core.serializeSaveFile(state)).state)
  }
  return { initial, final, frames, ctx, announcement: data.ANNOUNCEMENTS[0].id,
    evidence: { seed: 1008611, fittings, override, waves, steps, finalGameMs: final.gameMs,
      bossHp: boss.hp, bossHpMax: boss.hpMax, link, kinds,
      initialWeapons: opening.weapons, initialDevices: opening.devices,
      finalWeapons: finalView.weapons, finalDevices: finalView.devices,
      inputPath: 'startFleetBattleFor -> advanceBattleFor (100ms); no wave/hp/weapon state writes',
      rendererStep: 'command(step,[0]) only notifies/persists; battle progress is from precomputed core checkpoints' } }
}

async function writeJson(file, value) { await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8') }

async function buildEvidence() {
  const directory = path.join(ROOT, 'apps/desktop/out/renderer')
  const index = path.join(directory, 'index.html')
  const main = path.join(ROOT, 'apps/desktop/out/main/index.js')
  const preload = path.join(ROOT, 'apps/desktop/out/preload/index.js')
  for (const file of [index, main, preload]) await fs.access(file)
  const assets = (await fs.readdir(path.join(directory, 'assets'))).filter(name => /\.(js|css)$/.test(name))
  assert(assets.length, '构建 assets 为空；请父侧先 build')
  const bundles = await Promise.all(assets.map(name => fs.readFile(path.join(directory, 'assets', name), 'utf8')))
  const joined = bundles.join('\n')
  for (const key of ['app-bc-trigger', 'app-bc-popup', 'data-owner-tag', 'data-cycle-id', 'data-web-from', 'app-bts-web-status']) {
    assert(joined.includes(key), `构建缺少 ${key}；请父侧完成本批 build 后再跑`)
  }
  const builtAt = Math.max(...await Promise.all(assets.map(name => fs.stat(path.join(directory, 'assets', name)).then(s => s.mtimeMs))))
  for (const relative of ['apps/desktop/src/renderer/src/panels/BattleCycles.tsx', 'apps/desktop/src/renderer/src/panels/BattleScreen.tsx',
    'apps/desktop/src/renderer/src/styles-battle-cycles.css', 'packages/core/src/combat.ts', 'packages/core/src/foeSpecs.ts',
    'packages/core/src/battleDeviceView.ts', 'packages/core/src/battleWeaponView.ts', 'packages/data/src/l10n/table.ts']) {
    assert((await fs.stat(path.join(ROOT, relative))).mtimeMs <= builtAt + 1000, `构建早于源文件 ${relative}；请父侧重新 build`)
  }
  return { directory, builtAt: new Date(builtAt).toISOString(),
    assets: assets.map((name, i) => ({ name, sha256: createHash('sha256').update(bundles[i]).digest('hex') })) }
}

async function selfTest() {
  assert.equal(selectedCases([]).length, 8)
  assert.deepEqual(selectedCases(['--case=classic-zh-desktop']).map(row => row.id), ['classic-zh-desktop'])
  assert.throws(() => selectedCases(['--case=missing']))
  assert.throws(() => checkedProfile(os.tmpdir()))
  assert.throws(() => checkedProfile(path.join(ROOT, PREFIX + 'bad')))
  assert.throws(() => checkedProfile(path.join(os.tmpdir(), PREFIX + 'parent', 'child')))
  const fixture = makeFixture()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX)), token = randomUUID()
  await writeJson(path.join(profile, OWNER_FILE), { profile: path.resolve(profile), token, parentPid: process.pid })
  try { await assert.rejects(verifyOwner(profile, 'wrong-token', process.pid)) }
  finally { await removeOwnedProfile(profile, token) }
  const summary = { ok: true, electronLaunched: false, cases: 8, ships: fixture.evidence.fittings,
    waves: fixture.evidence.waves, finalGameMs: fixture.evidence.finalGameMs, link: fixture.evidence.link,
    weaponRows: fixture.evidence.initialWeapons.length, deviceRows: fixture.evidence.initialDevices.length,
    kinds: fixture.evidence.kinds, cleanup: { absolute: profile, removed: true } }
  console.log(JSON.stringify(summary, null, 2))
  return summary
}

async function parent() {
  const cases = selectedCases(process.argv.slice(2))
  await fs.mkdir(OUT, { recursive: true })
  const build = await buildEvidence(), fixture = makeFixture()
  const { core } = dependencies()
  await writeJson(path.join(OUT, 'fixture.json'), fixture.evidence)
  const report = { startedAt: new Date().toISOString(), build, selected: cases.map(row => row.id), reports: [],
    scope: '隐藏隔离原生窗口，真实四舰/四波/僚舰捕获网、鼠标与触屏交互和 DOM/CSS 像素读数；不是观感结论。' }
  try {
    for (const options of cases) {
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX)), token = randomUUID()
      const file = path.join(OUT, `${options.id}.json`)
      let server, child, timer, row = { id: options.id, ok: false }, processStopped = false
      await writeJson(path.join(profile, OWNER_FILE), { profile: path.resolve(profile), token, parentPid: process.pid })
      try {
        await fs.rm(file, { force: true })
        await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(fixture.initial), 'utf8')
        await fs.writeFile(path.join(profile, 'final.save.json'), core.serializeSaveFile(fixture.final), 'utf8')
        for (const [i, frame] of fixture.frames.entries()) await fs.writeFile(path.join(profile, `frame-${i}.save.json`), core.serializeSaveFile(frame), 'utf8')
        await writeJson(path.join(profile, 'fixture.json'), fixture.evidence)
        const served = await staticServer(build.directory, { initialize: settingsScript(fixture.announcement, undefined, { layout: options.layout, locale: options.locale, debug: true, test: true }) })
        server = served.server
        const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_AUTOPERF: '1', ELECTRON_RENDERER_URL: served.url,
          BATTLE_CYCLES_CASE: JSON.stringify(options), BATTLE_CYCLES_TOKEN: token, BATTLE_CYCLES_PARENT: String(process.pid) }
        delete env.ELECTRON_RUN_AS_NODE
        child = spawn(require('electron'), [`--user-data-dir=${profile}`, __filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        row.pid = child.pid
        row.profile = profile
        console.log(`战斗周期隔离窗口 ${options.id} PID=${child.pid}`)
        let stderr = '', timedOut = false
        child.stdout.on('data', bytes => process.stdout.write(bytes))
        child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16000); process.stderr.write(bytes) })
        timer = setTimeout(() => { timedOut = true; child.kill() }, 180000)
        const [code, signal] = await once(child, 'exit')
        row = { ...row, ...await fs.readFile(file, 'utf8').then(JSON.parse, () => ({})), exitCode: code, signal, timedOut }
        assert.equal(code, 0, `${options.id} 未通过：${row.failure ?? stderr}`)
        assert(row.ok, `${options.id} 未产生通过报告`)
      } catch (error) { row.ok = false; row.failure ??= error.message }
      finally {
        clearTimeout(timer)
        try { await stopOwned(child); processStopped = true; row.processStopped = true }
        catch (error) { row.ok = false; row.cleanupFailure = error.message }
        if (server) await new Promise(resolve => server.close(resolve))
        if (processStopped) {
          try { row.cleanup = await removeOwnedProfile(profile, token) }
          catch (error) { row.ok = false; row.cleanupFailure = error.message }
        }
        await writeJson(file, row)
        report.reports.push(row)
      }
    }
  } finally {
    report.finishedAt = new Date().toISOString()
    report.ok = report.reports.length === cases.length && report.reports.every(row => row.ok && row.cleanup?.removed)
    await writeJson(path.join(OUT, cases.length === 1 ? `report-${cases[0].id}.json` : 'report.json'), report)
  }
  console.log(JSON.stringify({ ok: report.ok, cases: report.reports.map(row => ({ id: row.id, ok: row.ok, pid: row.pid, cleanup: row.cleanup, failure: row.failure })) }))
  assert(report.ok, '原生验收未全通过；见 battle-cycles 下结构化报告')
}

async function rect(page, selector) {
  return page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('缺少控件');return e.getBoundingClientRect().toJSON()})()`)
}

async function move(page, selector) {
  const box = await rect(page, selector), x = box.x + box.width / 2, y = box.y + box.height / 2
  assert(x >= 0 && y >= 0, '鼠标目标越界')
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

async function escape(page) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
}

async function geometry(page) {
  return page.js(`(()=>{
    const selectors=${JSON.stringify({ screen: SEL.screen, trigger: SEL.trigger, popup: SEL.popup, devices: SEL.deviceScroll, controls: '.app-battle-controls', dock: '.app-bts-topdock' })};
    const boxes=Object.fromEntries(Object.entries(selectors).map(([key,selector])=>{const e=document.querySelector(selector);if(!e)return [key,null];const s=getComputedStyle(e);return [key,{rect:e.getBoundingClientRect().toJSON(),clientWidth:e.clientWidth,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,overflowX:s.overflowX,overflowY:s.overflowY,position:s.position,display:s.display,zIndex:s.zIndex}]}));
    const root=document.querySelector('.app-root');
    const rows=[...document.querySelectorAll('[data-cycle-id]')].map(e=>({id:e.dataset.cycleId,owner:e.dataset.ownerTag,kind:e.dataset.deviceKind,state:e.dataset.cycleState,target:e.dataset.targetTag??e.querySelector('[data-target-tag]')?.dataset.targetTag,label:e.querySelector('.app-bc-label')?.textContent,color:getComputedStyle(e.querySelector('.app-bc-label')).color,progress:e.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'),times:[...e.querySelectorAll('.app-bc-time')].map(t=>t.textContent),text:e.textContent}));
    return {viewport:{width:innerWidth,height:innerHeight},rotated:root.classList.contains('is-mobile-rot'),layout:root.classList.contains('is-layout-modern')?'modern':'classic',layoutStyles:document.querySelector('#whale-layout-style')?.getAttribute('href'),root:{width:root.offsetWidth,height:root.offsetHeight,transform:getComputedStyle(root).transform},boxes,rows,document:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},focus:document.activeElement?.className,legacy:document.querySelectorAll('.app-bts-reload').length}
  })()`)
}

function assertGeometry(reading, options) {
  const { boxes, viewport, document: doc } = reading
  assert.equal(reading.rotated, options.mobile, '手机没有进入实际旋转口径')
  assert.equal(reading.layout, options.layout, '界面布局与验收组合不一致')
  assert(reading.layoutStyles?.includes(`styles-${options.layout}-`), '没有加载本组合的布局样式')
  assert.equal(reading.legacy, 0, '旧平铺装填没有移除')
  assert(doc.scrollWidth <= doc.width + 1 && doc.scrollHeight <= doc.height + 1, '一级页面产生溢出')
  for (const key of ['screen', 'trigger', 'popup', 'devices', 'controls']) {
    const box = boxes[key]
    assert(box && box.clientWidth > 0 && box.clientHeight > 0, `控件没有可用尺寸：${key}`)
    const b = box.rect
    assert(b.left >= -2 && b.top >= -2 && b.right <= viewport.width + 2 && b.bottom <= viewport.height + 2,
      `控件越出实际视口：${key}/${JSON.stringify(b)}`)
  }
  assert(['auto', 'scroll'].includes(boxes.popup.overflowY), '武器列表没有内部滚动')
  assert(boxes.popup.scrollHeight > boxes.popup.clientHeight, '四舰武器未形成滚动列表')
  assert(['auto', 'scroll'].includes(boxes.devices.overflowY), '装置区没有内部滚动')
  assert(boxes.devices.scrollHeight > boxes.devices.clientHeight, '四舰装置未形成内部滚动')
  assert.equal(boxes.popup.position, 'absolute', '武器弹层不应挤占战场高度')
}

async function compareRows(page, expected, weapon, locale, data) {
  const selector = weapon ? SEL.weapons : SEL.devices
  const rows = await page.js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),e=>({id:e.dataset.cycleId,owner:e.dataset.ownerTag,ship:e.dataset.shipId,kind:e.dataset.deviceKind,state:e.dataset.cycleState,target:e.dataset.targetTag??e.querySelector('[data-target-tag]')?.dataset.targetTag,label:e.querySelector('.app-bc-label')?.textContent,times:Array.from(e.querySelectorAll('.app-bc-time'),t=>t.textContent),progress:Number(e.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')),text:e.textContent}))`)
  assert.equal(rows.length, expected.length, `${weapon ? '武器' : '装置'}行数与 core 不一致`)
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, '周期行键重复')
  assert.deepEqual(rows.map(row => row.id).sort(), expected.map(row => row.id).sort(), '漏行或重复安装件被合并')
  for (const want of expected) {
    const row = rows.find(candidate => candidate.id === want.id)
    assert.equal(row.owner, want.ownerTag, `归属不一致：${want.id}`)
    assert.equal(row.ship, want.shipId, `舰船不一致：${want.id}`)
    assert.equal(row.state, want.state, `状态不一致：${want.id}`)
    assert.equal(row.progress, Math.round(want.percent), `进度不一致：${want.id}`)
    assert.equal(row.times[0], want.cycleMs > 0 ? `${(Math.ceil(want.cycleMs / 100) / 10).toFixed(1)}s` : '-', `周期不一致：${want.id}`)
    if (!weapon) { assert.equal(row.kind, want.kind); assert.equal(row.target, want.targetTag) }
    if (weapon && want.state === 'reload') assert.equal(row.times[1], `${(Math.ceil(want.remainingMs / 100) / 10).toFixed(1)}s`)
    // 重复型号逐安装件一行；不能只靠总行数碰巧相等。
    if (weapon && want.src !== 'drone') assert.equal(row.label.includes('×'), false, '非无人机型号仍合并显示')
  }
  const groups = await page.js(`Array.from(document.querySelectorAll(${JSON.stringify(weapon ? '[data-weapon-owner]' : '[data-device-owner]')}),e=>e.getAttribute(${JSON.stringify(weapon ? 'data-weapon-owner' : 'data-device-owner')}))`)
  assert.deepEqual(groups.sort(), [...new Set(expected.map(row => row.ownerTag))].sort())
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.trigger)}).textContent.trim()`), data.L10N['ui.battleCycles.001'][locale])
  assert.equal(await page.js(`document.querySelector('.app-bc-device-heading').textContent.trim()`), data.L10N['ui.battleCycles.002'][locale])
  return rows
}

async function visitRows(page, selector, scroller) {
  const ids = await page.js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),e=>e.dataset.cycleId)`)
  const readings = []
  for (const id of ids) {
    const row = `${selector}[data-cycle-id=${JSON.stringify(id)}]`
    const visible = await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(row)}),list=document.querySelector(${JSON.stringify(scroller)});e.scrollIntoView({block:'center',inline:'nearest'});const b=e.getBoundingClientRect(),l=list.getBoundingClientRect();const x=Math.max(b.left,l.left)+(Math.min(b.right,l.right)-Math.max(b.left,l.left))/2,y=Math.max(b.top,l.top)+(Math.min(b.bottom,l.bottom)-Math.max(b.top,l.top))/2;const hit=document.elementFromPoint(x,y);return {id:${JSON.stringify(id)},reachable:!!hit&&(hit===e||e.contains(hit)),scrollTop:list.scrollTop}})()`)
    assert(visible.reachable, `周期行滚动后被遮挡：${id}`)
    readings.push(visible)
  }
  assert(readings.some(row => row.scrollTop > 0), '没有实际滚到列表底部')
  return readings
}

async function screenshot(win, file) {
  const image = await win.webContents.capturePage(undefined, { stayHidden: true })
  assert(!image.isEmpty(), '原生截图为空')
  const bitmap = image.toBitmap(), colors = new Set()
  for (let i = 0; i + 4 <= bitmap.length; i += 128) colors.add(bitmap.readUInt32LE(i))
  assert(colors.size > 12, '原生截图像素不足，可能空白')
  await fs.writeFile(file, image.toPNG())
  return { file, pixels: image.getSize(), sampledColors: colors.size }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  const options = JSON.parse(process.env.BATTLE_CYCLES_CASE)
  assert(CASES.some(row => row.id === options.id), '非法子进程组合')
  const profile = await verifyOwner(process.env.WHALE_PERF_USERDATA, process.env.BATTLE_CYCLES_TOKEN, Number(process.env.BATTLE_CYCLES_PARENT))
  const { core, data, combat } = dependencies(), ctx = data.buildSimContext()
  const fixture = JSON.parse(await fs.readFile(path.join(profile, 'fixture.json'), 'utf8'))
  const report = { ...options, pid: process.pid, profile, ok: false, interactions: [], screenshots: [], readings: [], errors: [] }
  let win, page
  try {
    console.log(`隔离子入口 ${options.id} PID=${process.pid}`)
    app.setPath('userData', profile)
    app.setPath('sessionData', profile)
    BrowserWindow.prototype.show = function () {}
    BrowserWindow.prototype.showInactive = function () {}
    require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
    await app.whenReady()
    assert.equal(path.resolve(app.getPath('userData')), profile, '原生 userData 隔离失败')
    assert.equal(path.resolve(app.getPath('sessionData')), profile, '原生 sessionData 隔离失败')
    for (let attempt = 0; attempt < 100 && !BrowserWindow.getAllWindows().length; attempt++) await sleep(50)
    assert.equal(BrowserWindow.getAllWindows().length, 1, '隔离运行必须只有一个游戏窗口')
    win = BrowserWindow.getAllWindows()[0]
    win.setMinimumSize(200, 200)
    win.setContentSize(1366, 768)
    win.webContents.debugger.attach('1.3')
    win.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') report.errors.push(params)
    })
    page = new JourneyPage((method, params = {}) => {
      let timer
      return Promise.race([
        win.webContents.debugger.sendCommand(method, params),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`调试协议超时：${method}`)), 15000); timer.unref() }),
      ]).finally(() => clearTimeout(timer))
    }, { touch: options.mobile })
    await page.send('Runtime.enable')
    await page.send('Page.enable')
    if (options.mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, screenWidth: 390, screenHeight: 740,
        deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    const openBattle = async () => {
      await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-root")')
      await page.wait('!!document.querySelector(".app-battle-float") || !!document.querySelector(".app-battle-screen")')
      if (await page.js('!!document.querySelector(".app-battle-float")')) await page.tap('.app-battle-float')
      await page.wait(`!!document.querySelector(${JSON.stringify(SEL.trigger)})`)
      await sleep(300)
      assert.equal(win.isVisible(), false, '隔离窗口意外显示')
    }
    await page.reload()
    await openBattle()
    console.log(`${options.id} 开场窗口已就绪`)
    const initialSnap = await page.snapshot()
    assert.equal(initialSnap.gameMs, 0, '开场在渲染前已推进')
    await sleep(400)
    assert.equal((await page.snapshot()).gameMs, initialSnap.gameMs, '测试心跳未冻结')
    assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.popup)}).hidden`), true, '武器列表初始应收起')
    assert(await page.js('!!document.querySelector(".app-bc-device-heading")'), '装置区不常驻')
    await page.tap(SEL.trigger)
    await page.wait(`!document.querySelector(${JSON.stringify(SEL.popup)}).hidden`)
    report.interactions.push(options.mobile ? 'real-touch-start/end-opens' : 'mouse-click-pins')
    await compareRows(page, fixture.initialWeapons, true, options.locale, data)
    await compareRows(page, fixture.initialDevices, false, options.locale, data)
    assert((await page.snapshot()).expedition.battle.stats.meShots === 0, '开场初始装填已经开火')
    report.screenshots.push(await screenshot(win, path.join(OUT, `${options.id}-opening.png`)))
    await escape(page)
    await page.wait(`document.querySelector(${JSON.stringify(SEL.popup)}).hidden`)
    report.interactions.push('escape-closes')

    // 检查点来自真实 core；同一 PID/窗口重载，不向页面暴露状态写入能力。
    const loadCheckpoint = async name => {
      assert(['final.save.json', 'frame-0.save.json', 'frame-1.save.json', 'frame-2.save.json', 'frame-3.save.json'].includes(name))
      const save = await fs.readFile(path.join(profile, name), 'utf8')
      await win.loadURL('about:blank')
      // 旧页 pagehide 最后一笔保存先入主进程队列，再写合成检查点。
      await sleep(250)
      await fs.writeFile(path.join(profile, 'save.json'), save, 'utf8')
      await win.loadURL(new URL('/', process.env.ELECTRON_RENDERER_URL).href)
      await openBattle()
    }
    await loadCheckpoint('final.save.json')
    console.log(`${options.id} 末波窗口已就绪`)
    const finalSnapshot = await page.snapshot()
    assert.equal(finalSnapshot.expedition.battle.waveIdx, 3)
    assert.equal(finalSnapshot.gameMs, fixture.finalGameMs)
    assert(!finalSnapshot.expedition.battle.ended, '末波战斗已结束')
    report.interactions.push('core-four-waves-final-checkpoint')

    const opened = `!document.querySelector(${JSON.stringify(SEL.popup)}).hidden`
    const closed = `document.querySelector(${JSON.stringify(SEL.popup)}).hidden`
    if (!options.mobile) {
      await move(page, SEL.trigger)
      await page.wait(opened)
      assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.trigger)}).getAttribute('aria-pressed')`), 'false', 'hover 意外固定')
      const before = await rect(page, '.app-bts-topdock'), trigger = await rect(page, SEL.trigger), popup = await rect(page, SEL.popup)
      assert(popup.top >= trigger.bottom - 1, '武器列表不是向下展开')
      const pointerProbe = await page.js(`(()=>{const p=document.querySelector(${JSON.stringify(SEL.popup)}),b=p.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;return {rect:b.toJSON(),center:{x,y},hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,500),stack:document.elementsFromPoint(x,y).slice(0,8).map(e=>({class:e.className,zIndex:getComputedStyle(e).zIndex,position:getComputedStyle(e).position,contain:getComputedStyle(e).contain,containerType:getComputedStyle(e).containerType})),scope:document.querySelector('.app-bc-weapons').getBoundingClientRect().toJSON()}})()`)
      report.readings.push({ hoverPointer: pointerProbe })
      console.log(JSON.stringify({ id: options.id, hoverPointer: pointerProbe }))
      await move(page, SEL.popup)
      await sleep(400)
      assert(await page.js(opened), '移入武器列表关闭了窗口')
      const after = await rect(page, '.app-bts-topdock')
      assert(Math.abs(before.height - after.height) <= 1, '悬停展开挤压战场')
      report.interactions.push('hover-downward-and-pointer-enters-stays-open')
      await page.tap(SEL.trigger)
      assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.trigger)}).getAttribute('aria-pressed')`), 'true')
      await move(page, '.app-battle-controls')
      await sleep(200)
      assert(await page.js(opened), '固定列表离开后关闭')
      report.interactions.push('click-pins-after-hover')
    } else {
      assert.equal(await page.js(`matchMedia('(any-hover: hover)').matches`), false, '触屏仿真仍支持鼠标 hover')
      await page.tap(SEL.trigger)
      await page.wait(opened)
      report.interactions.push('mobile-tap-pins-final-list')
    }
    const widths = options.mobile ? [[390, 740]] : [[1366, 768], [1200, 500]]
    for (const [width, height] of widths) {
      if (!options.mobile) win.setContentSize(width, height)
      await sleep(250)
      const reading = await geometry(page)
      reading.requested = { width, height }
      assert.equal(reading.viewport.width, width)
      assert.equal(reading.viewport.height, height)
      report.readings.push(reading)
      assertGeometry(reading, options)
      await compareRows(page, fixture.finalWeapons, true, options.locale, data)
      await compareRows(page, fixture.finalDevices, false, options.locale, data)
      if (await page.js(closed)) { await page.tap(SEL.trigger); await page.wait(opened) }
      report.interactions.push({ weaponRowsReachable: await visitRows(page, SEL.weapons, SEL.popup), viewport: [width, height] })
      // 下拉窗口覆盖下方装置属正常叠层；收起后逐行验证常驻区可达。
      await escape(page)
      await page.wait(closed)
      report.interactions.push({ deviceRowsReachable: await visitRows(page, SEL.devices, SEL.deviceScroll), viewport: [width, height] })
      const webSelector = `${SEL.devices}[data-owner-tag="ally-1"][data-device-kind="web"]`
      await page.js(`document.querySelector(${JSON.stringify(webSelector)}).scrollIntoView({block:'nearest'})`)
      const link = fixture.link
      const webEvidence = await page.js(`(()=>{const row=document.querySelector(${JSON.stringify(webSelector)}),line=document.querySelector(${JSON.stringify(`[data-web-from="ally-1"][data-web-to=${JSON.stringify(link.to)}]`)}),badge=document.querySelector(${JSON.stringify(`.app-bts-unit[data-tag=${JSON.stringify(link.to)}] .app-bts-web-status`)});return {row:{owner:row.dataset.ownerTag,state:row.dataset.cycleState,target:row.dataset.targetTag??row.querySelector('[data-target-tag]')?.dataset.targetTag,text:row.textContent},line:line?{from:line.dataset.webFrom,to:line.dataset.webTo,bar:line.querySelector('.app-bts-web-bar').getBoundingClientRect().toJSON(),title:line.title}:null,badge:badge?{text:badge.textContent,rect:badge.getBoundingClientRect().toJSON()}:null}})()`)
      assert.equal(webEvidence.row.owner, 'ally-1')
      assert.equal(webEvidence.row.state, 'active')
      assert.equal(webEvidence.row.target, link.to)
      assert(webEvidence.line && webEvidence.line.bar.width > 0 && webEvidence.line.bar.height > 0, '僚舰网链接没有渲染')
      assert(webEvidence.badge && webEvidence.badge.rect.width > 0, '被网敌舰缺少 badge')
      assert.equal(webEvidence.badge.text, data.L10N['ui.battleCycles.022'][options.locale])
      report.readings.push({ requested: { width, height }, web: webEvidence })
      report.screenshots.push(await screenshot(win, path.join(OUT, `${options.id}-${width}x${height}-final.png`)))
      console.log(`${options.id} ${width}x${height} 周期行/僚舰网/几何通过`)
      await page.tap(SEL.trigger)
      await page.wait(opened)
    }
    await page.tap('.app-bts-topdock .app-bts-legends')
    await page.wait(closed)
    assert(await page.js('!!document.querySelector(".app-bc-device-heading")'), '关闭武器列表连带隐藏装置')
    report.interactions.push('outside-closes-devices-stay')
    await page.tap(SEL.trigger)
    await page.wait(opened)
    await page.tap(SEL.popup)
    assert(await page.js(`document.activeElement===document.querySelector(${JSON.stringify(SEL.popup)})`), '可滚动武器列表没有获得焦点')
    const scroll = await page.js(`document.querySelector(${JSON.stringify(SEL.popup)}).scrollTop`)
    const ids = await page.js(`Array.from(document.querySelectorAll(${JSON.stringify(SEL.weapons)}),e=>e.dataset.cycleId)`)
    const foeTarget = `.app-bts-unit[data-tag=${JSON.stringify(fixture.link.to)}]`
    if (!options.mobile) await move(page, foeTarget)
    for (let index = 0; index < 4; index++) {
      const before = await page.snapshot()
      const command = await page.command('step', [0])
      assert(command?.ok, '真实 step 命令失败')
      assert.equal((await page.snapshot()).gameMs, before.gameMs, '零步通知意外推进')
      assert(await page.js(opened), '目标 hover / 状态刷新关闭武器列表')
      assert(await page.js(`document.activeElement===document.querySelector(${JSON.stringify(SEL.popup)})`), '状态刷新抢走列表焦点')
      assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.popup)}).scrollTop`), scroll, '刷新改变滚动位置')
      assert.deepEqual(await page.js(`Array.from(document.querySelectorAll(${JSON.stringify(SEL.weapons)}),e=>e.dataset.cycleId)`), ids)
    }
    report.interactions.push('target-hover-notify-keeps-open-focus-scroll-and-row-ids')
    await escape(page)
    await page.wait(closed)
    assert(await page.js(`document.activeElement===document.querySelector(${JSON.stringify(SEL.trigger)})`), 'Escape 未将列表焦点返回入口')
    report.interactions.push('escape-restores-trigger-focus')
    for (const [key, code, keyCode] of [['Enter', 'Enter', 13], [' ', 'Space', 32]]) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode })
      await page.wait(opened)
      await escape(page)
      await page.wait(closed)
    }
    report.interactions.push('enter-and-space-open-escape-closes')

    // 正时步进只用已有桥；普通多舰宿主的帧来自 core，不能假称此命令推进了远征。
    for (const name of ['frame-0.save.json', 'frame-3.save.json']) {
      await loadCheckpoint(name)
      await page.tap(SEL.trigger)
      const snapshot = await page.snapshot(), actual = viewOf(snapshot, ctx, combat)
      await compareRows(page, actual.weapons, true, options.locale, data)
      await compareRows(page, actual.devices, false, options.locale, data)
      report.readings.push({ checkpoint: name, gameMs: snapshot.gameMs, weapons: actual.weapons, devices: actual.devices })
    }
    assert.equal(report.errors.length, 0, '渲染运行异常')
    assert.equal(win.isVisible(), false)
    report.ok = true
  } catch (error) {
    report.failure = error.stack ?? String(error)
    if (page) report.failureDom = await geometry(page).catch(() => null)
    if (win) await screenshot(win, path.join(OUT, `${options.id}-failure.png`)).then(row => report.screenshots.push(row)).catch(() => {})
  } finally {
    await writeJson(path.join(OUT, `${options.id}.json`), report)
    if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    console.log(JSON.stringify({ id: options.id, pid: process.pid, ok: report.ok, failure: report.failure, screenshots: report.screenshots.length }))
    app.exit(report.ok ? 0 : 1)
  }
}

module.exports = { selectedCases, checkedProfile, makeFixture, selfTest }
if (process.argv.includes('--child')) {
  const { app } = require('electron')
  const profile = checkedProfile(process.env.WHALE_PERF_USERDATA)
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  child().catch(error => { console.error(error); app.exit(1) })
} else if (require.main === module) {
  if (process.argv.includes('--help')) console.log('父侧先 build；node tools/battle-cycles-native-check.cjs [--case=classic-zh-desktop] [--self-test]；8 组合：' + CASES.map(row => row.id).join(', '))
  else if (process.argv.includes('--self-test')) selfTest().catch(error => { console.error(error); process.exitCode = 1 })
  else parent().catch(error => { console.error(error); process.exitCode = 1 })
}
