/** 战斗周期读秒定位与装置换行原生验收 v3，2026-10-08；游戏 v0.1.0 / 存档 v31。
 * 输入：当前 core/data、apps/desktop/out 构建；仅使用合成四艘 T4 战列舰档。
 * 用法：父侧 npm run build 后 node tools/battle-cycles-native-check.cjs。
 * 可选：--case=classic-zh-desktop（classic/modern x zh/en x desktop/mobile）、
 * --self-test（只跑合法配装、真实四波推进及工具隔离检查，不启动 Electron）、--help。
 * 输出：tools/_ui-artifacts/battle-cycles/timer-wrap-20261008 的截图、DOM/CSS 读数与隔离清理报告。
 * 旧 report.json 只读，启动时将带 SHA256 的几何基线快照写入修订目录。
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
const BASELINE = path.join(ROOT, 'tools/_ui-artifacts/battle-cycles/report.json')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/battle-cycles/timer-wrap-20261008')
const OWNER_FILE = '.battle-cycles-owner.json'
const SEL = {
  trigger: '[data-battle-weapons-trigger]', popup: '[data-battle-weapons-popup]', weapons: '[data-battle-weapons-popup] [data-cycle-id]',
  devices: '.app-bc-device-scroll [data-cycle-id]', deviceScroll: '.app-bc-device-scroll',
  screen: '.app-battle-screen', web: '[data-web-from="ally-1"]',
}

function validateWeaponGroups(view, fleet, label) {
  assert.equal(new Set(view.weapons.map(row => row.id)).size, view.weapons.length, `${label} 武器组键重复`)
  const owners = fleet.map(row => row.tag)
  assert.deepEqual([...new Set(view.weapons.map(row => row.ownerTag))].sort(), owners.slice().sort(), `${label} 漏舰或跨舰合并`)
  for (const row of view.weapons) {
    assert.equal(row.shipId, fleet.find(ship => ship.tag === row.ownerTag)?.shipId, `${label} 舰归属错误：${row.id}`)
    assert(Number.isInteger(row.count) && row.count > 0, `${label} 数量非法：${row.id}`)
    for (const key of ['minM', 'maxM', 'cycleMs', 'remainingMs', 'percent']) assert(Number.isFinite(row[key]) && row[key] >= 0, `${label} 缺少有效 ${key}：${row.id}`)
    assert(row.minM <= row.maxM && row.percent <= 100, `${label} 射程或进度非法：${row.id}`)
    if (row.src === 'drone') assert(Number.isInteger(row.aliveCount) && row.aliveCount >= 0 && row.aliveCount <= row.count, `${label} 存活架数非法：${row.id}`)
  }
  return fleet.map(ship => {
    const rows = view.weapons.filter(row => row.ownerTag === ship.tag)
    return { owner: ship.tag, shipId: ship.shipId, rows: rows.length,
      weapons: rows.filter(row => row.src !== 'drone').reduce((n, row) => n + row.count, 0),
      drones: rows.filter(row => row.src === 'drone').reduce((n, row) => n + row.count, 0) }
  })
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
  const initialCounts = validateWeaponGroups(opening, initial.expedition.battle.myFleet, '开场')
  assert(opening.weapons.some(row => row.src !== 'drone' && row.count > 1), '同舰同型炮未合并')
  assert(opening.weapons.every(row => row.state === 'reload' && row.remainingMs > 0), '新战斗并非全组初始装填')
  for (const [index, count] of initialCounts.entries()) {
    assert.equal(count.weapons, index === 0 ? 5 : 4, '基础炮、近防炮与实装激光炮数量不守恒')
    assert.equal(count.drones, 2, '合法载机数量不守恒')
  }
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
  const finalCounts = validateWeaponGroups(finalView, final.expedition.battle.myFleet, '末波')
  assert.deepEqual(finalCounts.map(({ rows, ...count }) => count), initialCounts.map(({ rows, ...count }) => count), '推进后武器安装件或机群总数变化')
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
      counts: { initial: initialCounts, final: finalCounts,
        total: initialCounts.reduce((n, row) => n + row.weapons + row.drones, 0),
        legacyDisplayRows: initialCounts.reduce((n, row) => n + row.weapons + 1, 0) },
      initialWeapons: opening.weapons, initialDevices: opening.devices,
      finalWeapons: finalView.weapons, finalDevices: finalView.devices,
      inputPath: 'startFleetBattleFor -> advanceBattleFor (100ms); no wave/hp/weapon state writes',
      rendererStep: 'command(step,[0]) only notifies/persists; battle progress is from precomputed core checkpoints' } }
}

async function writeJson(file, value) { await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8') }

function baselineReadings(report) {
  assert(report.ok, '旧几何报告未通过，不能用作紧凑修订基线')
  return report.reports.flatMap(row => row.readings.filter(reading => reading.viewport && reading.boxes?.dock).map(reading => {
    const { boxes, root, rotated } = reading
    const dockHeight = boxes.dock.offsetHeight ?? boxes.dock.clientHeight
    // 旧版未记录 stage；只回推同轴剩余预算，明确不是旧 stage 实测。
    const headerHeight = rotated ? boxes.dock.rect.left / (reading.viewport.height / root.width) : boxes.dock.rect.top - boxes.screen.rect.top
    const stageHeight = boxes.stage?.offsetHeight ?? boxes.screen.clientHeight - headerHeight - dockHeight - boxes.controls.clientHeight
    return { id: row.id, requested: reading.requested ?? reading.viewport, root, rotated,
      dockHeight, stageHeight, stageSource: boxes.stage ? 'measured' : 'inferred-remaining-budget', headerHeight,
      boxes: { dock: boxes.dock, stage: boxes.stage ?? null, screen: boxes.screen, controls: boxes.controls } }
  }))
}

async function captureBaseline() {
  const bytes = await fs.readFile(BASELINE)
  const report = JSON.parse(bytes.toString('utf8'))
  const readings = baselineReadings(report)
  assert.equal(new Set(readings.map(row => row.id)).size, CASES.length, '旧报告未覆盖8组合')
  assert(readings.every(row => row.dockHeight > 0 && row.stageHeight > 0), '旧几何基线无效')
  return { source: BASELINE, sha256: createHash('sha256').update(bytes).digest('hex'),
    sourceStartedAt: report.startedAt, sourceFinishedAt: report.finishedAt, capturedAt: new Date().toISOString(), readings }
}

function geometryComparison(reading, options, baseline) {
  const before = baseline.readings.find(row => row.id === options.id && row.requested.width === reading.requested.width && row.requested.height === reading.requested.height)
  assert(before, `缺少旧几何基线：${options.id}/${JSON.stringify(reading.requested)}`)
  const dockHeight = reading.boxes.dock.offsetHeight, stageHeight = reading.boxes.stage.offsetHeight
  const delta = { dockHeight: dockHeight - before.dockHeight, stageHeight: stageHeight - before.stageHeight }
  assert(delta.dockHeight <= -40, 'dock 占高未明显减少')
  assert(delta.stageHeight >= 40, '战场剩余预算未明显增加')
  assert(reading.boxes.controls.offsetHeight >= before.boxes.controls.clientHeight - 2, '底部操作被缩小以挤出空间')
  return { before, after: { dockHeight, stageHeight }, delta }
}

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
  for (const key of ['app-bc-trigger', 'app-bc-popup', 'app-bts-reload-name', 'data-cycle-count', 'data-cycle-ms',
    'data-remaining-ms', 'data-min-m', 'data-max-m', 'data-owner-tag', 'data-cycle-id', 'data-web-from', 'app-bts-web-status']) {
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
  assert(!path.relative(path.dirname(BASELINE), OUT).startsWith('..') && path.dirname(BASELINE) !== OUT, '修订报告必须隔离旧基线目录')
  const baseline = await captureBaseline()
  const fixture = makeFixture()
  assert.equal(fixture.evidence.counts.legacyDisplayRows, 21, '旧21展示行的安装件/机群口径不守恒')
  const { data } = dependencies()
  for (const locale of ['zh', 'en']) for (const weapon of [true, false]) {
    const expected = fixture.evidence[weapon ? 'finalWeapons' : 'finalDevices']
    const rows = expected.map(want => {
      const state = data.L10N[`ui.battleCycles.${STATE_IDS[want.state]}`][locale]
      const timed = want.state === 'reload' || want.state === 'cooldown' && (want.cycleMs > 0 || want.remainingMs > 0) || want.state === 'active' && want.remainingMs > 0
      return { id: want.id, owner: want.ownerTag, ship: want.shipId, kind: want.kind, state: want.state,
        target: want.targetTag, count: want.count, cycleMs: want.cycleMs, remainingMs: want.remainingMs,
        minM: want.minM, maxM: want.maxM, compact: true, label: `${want.label} \u00d7${want.count}`,
        timer: timed ? seconds(want.remainingMs) : state, timerInTrack: true, range: weapon ? `${want.minM.toLocaleString('en')}~${want.maxM.toLocaleString('en')}m` : '',
        countText: `\u00d7${want.count}`,
        alive: want.aliveCount === undefined ? undefined : `${want.aliveCount}/${want.count}`,
        progress: want.cycleMs > 0 && ['reload', 'cooldown', 'ready', 'active'].includes(want.state) && (want.state !== 'active' || want.remainingMs > 0) ? Math.round(want.percent) : null,
        stateText: timed ? `${state} \u00b7 ${seconds(want.remainingMs)}` : state,
        title: [`#${['player', 'ally-1', 'ally-2', 'ally-3'].indexOf(want.ownerTag) + 1}`, want.ownerName, state, seconds(want.cycleMs), want.targetName, want.effectPct].join(' '), text: want.label }
    })
    assertCycleRows(rows, expected, weapon, locale, data)
    for (const key of ['owner', 'ship', 'state', 'count', 'cycleMs', 'remainingMs', 'timerInTrack', ...(weapon ? ['minM', 'maxM', 'range'] : [])]) {
      const bad = structuredClone(rows)
      bad[0][key] = typeof bad[0][key] === 'number' ? bad[0][key] + 1 : typeof bad[0][key] === 'boolean' ? false : 'invalid'
      assert.throws(() => assertCycleRows(bad, expected, weapon, locale, data), `工具放过错误 ${key}`)
    }
    assert.throws(() => assertCycleRows(rows.slice(1), expected, weapon, locale, data), '工具放过缺行')
    assert.throws(() => assertCycleRows([rows[0], ...rows], expected, weapon, locale, data), '工具放过重复行')
  }
  for (const before of baseline.readings) {
    const reading = { requested: before.requested, boxes: { dock: { offsetHeight: 100 }, stage: { offsetHeight: before.stageHeight + before.dockHeight - 100 }, controls: { offsetHeight: before.boxes.controls.clientHeight } } }
    geometryComparison(reading, before, baseline)
    assert.throws(() => geometryComparison({ ...reading, boxes: { ...reading.boxes, stage: { offsetHeight: before.stageHeight } } }, before, baseline), '工具放过无战场空间收益')
  }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX)), token = randomUUID()
  await writeJson(path.join(profile, OWNER_FILE), { profile: path.resolve(profile), token, parentPid: process.pid })
  try { await assert.rejects(verifyOwner(profile, 'wrong-token', process.pid)) }
  finally { await removeOwnedProfile(profile, token) }
  const summary = { ok: true, electronLaunched: false, cases: 8, ships: fixture.evidence.fittings,
    waves: fixture.evidence.waves, finalGameMs: fixture.evidence.finalGameMs, link: fixture.evidence.link,
    weaponRows: fixture.evidence.initialWeapons.length, counts: fixture.evidence.counts, deviceRows: fixture.evidence.initialDevices.length,
    kinds: fixture.evidence.kinds, assertionSelfTests: ['row-missing/duplicate', 'owner/ship/state/count/cycle/remaining', 'min/max/visible-range', 'stage-budget-gain'],
    baseline: { source: baseline.source, sha256: baseline.sha256, readings: baseline.readings.length },
    cleanup: { absolute: profile, removed: true } }
  console.log(JSON.stringify(summary, null, 2))
  return summary
}

async function parent() {
  const cases = selectedCases(process.argv.slice(2))
  await fs.mkdir(OUT, { recursive: true })
  const baseline = await captureBaseline(), build = await buildEvidence(), fixture = makeFixture()
  const { core } = dependencies()
  await writeJson(path.join(OUT, 'fixture.json'), fixture.evidence)
  await writeJson(path.join(OUT, 'baseline.json'), baseline)
  const report = { startedAt: new Date().toISOString(), build, baseline, selected: cases.map(row => row.id), reports: [],
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
        await writeJson(path.join(profile, 'baseline.json'), baseline)
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
  assert(report.ok, '原生验收未全通过；见 battle-cycles/timer-wrap-20261008 下结构化报告')
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
    const selectors=${JSON.stringify({ screen: SEL.screen, trigger: SEL.trigger, popup: SEL.popup, devices: SEL.deviceScroll, controls: '.app-battle-controls', dock: '.app-bts-topdock', header: '.app-battle-screen-top', stage: '.app-bts-stage', fit: '.app-bts-stage-fit', legends: '.app-bts-topdock .app-bts-legends', cycles: '[data-battle-cycles]', speed: '.app-bts-speedx' })};
    const logical=e=>{let top=0,left=0;for(let n=e;n&&n!==document.querySelector(selectors.screen);n=n.offsetParent){top+=n.offsetTop;left+=n.offsetLeft}return {top,left,bottom:top+e.offsetHeight,right:left+e.offsetWidth}};
    const measure=e=>{const s=getComputedStyle(e);return {rect:e.getBoundingClientRect().toJSON(),logical:logical(e),offsetWidth:e.offsetWidth,offsetHeight:e.offsetHeight,clientWidth:e.clientWidth,clientHeight:e.clientHeight,scrollWidth:e.scrollWidth,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,scrollLeft:e.scrollLeft,overflowX:s.overflowX,overflowY:s.overflowY,position:s.position,display:s.display,zIndex:s.zIndex,transform:s.transform,flexWrap:s.flexWrap}};
    const boxes=Object.fromEntries(Object.entries(selectors).map(([key,selector])=>{const e=document.querySelector(selector);return [key,e?measure(e):null]}));
    const root=document.querySelector('.app-root');
    const rows=[...document.querySelectorAll('[data-cycle-id]')].map(e=>({id:e.dataset.cycleId,owner:e.dataset.ownerTag,kind:e.dataset.deviceKind,state:e.dataset.cycleState,compact:e.classList.contains('app-bts-reload'),logical:logical(e),height:e.offsetHeight,text:e.textContent}));
    const dockRows=[...document.querySelector('.app-bts-topdock > .app-bts-dock').children].filter(e=>getComputedStyle(e).display!=='none'&&!e.classList.contains('app-bts-speedx')).map(e=>({class:e.className,...measure(e)}));
    const controls=[...document.querySelectorAll('.app-battle-controls button,.app-battle-controls input')].map(e=>({tag:e.tagName,disabled:e.disabled,...measure(e)}));
    return {viewport:{width:innerWidth,height:innerHeight},rotated:root.classList.contains('is-mobile-rot'),layout:root.classList.contains('is-layout-modern')?'modern':'classic',layoutStyles:document.querySelector('#whale-layout-style')?.getAttribute('href'),root:{width:root.offsetWidth,height:root.offsetHeight,transform:getComputedStyle(root).transform},boxes,rows,dockRows,controls,document:{width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},focus:document.activeElement?.className,invalidText:/NaN|Infinity/.test(document.querySelector(selectors.screen).textContent),deviceGroups:document.querySelectorAll('.app-bc-device-scroll [data-device-owner],.app-bc-device-heading').length,oldColumns:document.querySelectorAll('.app-bc-columns').length}
  })()`)
}

function assertGeometry(reading, options) {
  const { boxes, viewport, document: doc } = reading
  assert.equal(reading.rotated, options.mobile, '手机没有进入实际旋转口径')
  assert.equal(reading.layout, options.layout, '界面布局与验收组合不一致')
  assert(reading.layoutStyles?.includes(`styles-${options.layout}-`), '没有加载本组合的布局样式')
  assert(reading.rows.every(row => row.compact && row.height <= 44), '周期行未恢复旧式单行紧凑条')
  assert.equal(reading.deviceGroups, 0, '外部装置仍有逐舰大组标题或独立标题')
  assert.equal(reading.oldColumns, 0, '武器列表仍有大表头')
  assert.equal(reading.invalidText, false, '战斗读数出现 NaN/Infinity')
  assert(doc.scrollWidth <= doc.width + 1 && doc.scrollHeight <= doc.height + 1, '一级页面产生溢出')
  for (const key of ['screen', 'trigger', 'popup', 'devices', 'controls', 'dock', 'stage']) {
    const box = boxes[key]
    assert(box && box.clientWidth > 0 && box.clientHeight > 0, `控件没有可用尺寸：${key}`)
    const b = box.rect
    assert(b.left >= -2 && b.top >= -2 && b.right <= viewport.width + 2 && b.bottom <= viewport.height + 2,
      `控件越出实际视口：${key}/${JSON.stringify(b)}`)
  }
  assert(['auto', 'scroll'].includes(boxes.popup.overflowY), '武器列表没有内部滚动')
  assert(['auto', 'scroll'].includes(boxes.devices.overflowY), '超出预算的装置没有竖向内部滚动')
  assert.equal(boxes.devices.flexWrap, 'wrap', '装置区没有自动换行')
  assert(boxes.devices.scrollWidth <= boxes.devices.clientWidth + 1 && boxes.devices.scrollLeft === 0, '装置区仍需横向滑动')
  assert(new Set(reading.rows.filter(row => row.kind).map(row => row.logical.top)).size > 1, '四舰装置没有实际换行')
  assert(boxes.devices.offsetHeight <= (options.mobile ? 116 : 110), '装置区超过顶部预算')
  assert.equal(boxes.popup.position, 'absolute', '武器弹层不应挤占战场高度')
  assert.equal(reading.dockRows.length, 2, 'dock 常驻内容不是敌情/补给与武器/装置两行')
  assert(boxes.dock.offsetHeight - (boxes.speed?.offsetHeight ?? 0) <= 224, '基本 dock 超过换行预算224逻辑px')
  assert(boxes.legends.scrollHeight <= boxes.legends.clientHeight + 1, '敌情/补给行纵向增长')
  assert(boxes.cycles.offsetHeight <= Math.max(boxes.trigger.offsetHeight, boxes.devices.offsetHeight) + 1, '武器入口与装置换行容器高度异常')
  assert(boxes.stage.logical.top >= boxes.dock.logical.bottom - 2 && boxes.stage.logical.bottom <= boxes.controls.logical.top + 2, 'stage 与顶部或底部重叠')
  for (const key of ['dock', 'controls', 'screen']) assert.equal(boxes[key].transform, 'none', `操作区被二次缩放：${key}`)
  for (const control of reading.controls) {
    const b = control.rect
    assert(b.width > 0 && b.height > 0 && b.left >= -2 && b.top >= -2 && b.right <= viewport.width + 2 && b.bottom <= viewport.height + 2, '底部控制被截断')
    assert(control.logical.bottom <= boxes.controls.logical.bottom + 1, '底部控制溢出容器')
  }
}

function readCycleRows(selector) {
  return Array.from(document.querySelectorAll(selector), e => {
    const label = e.querySelector('.app-bts-reload-name'), timer = e.querySelector('.app-bts-reload-ms')
    const bar = e.querySelector('[role=progressbar]'), range = e.querySelector('.app-bc-range')
    const track = e.querySelector('.app-bts-reload-track')
    const t = timer?.getBoundingClientRect(), b = track?.getBoundingClientRect()
    const number = key => e.dataset[key] === undefined || e.dataset[key] === '' ? null : Number(e.dataset[key])
    return { id: e.dataset.cycleId, owner: e.dataset.ownerTag, ship: e.dataset.shipId, kind: e.dataset.deviceKind,
      state: e.dataset.cycleState, target: e.dataset.targetTag, count: number('cycleCount'), cycleMs: number('cycleMs'),
      remainingMs: number('remainingMs'), minM: number('minM'), maxM: number('maxM'), compact: e.classList.contains('app-bts-reload'),
      label: label?.textContent, timer: timer?.textContent, range: range?.textContent,
      timerInTrack: !!timer && timer.parentElement === track,
      timerFits: !!t && !!b && t.left >= b.left - 1 && t.top >= b.top - 1 && t.right <= b.right + 1 && t.bottom <= b.bottom + 1 && timer.scrollWidth <= timer.clientWidth + 1 && timer.scrollHeight <= timer.clientHeight + 1,
      alive: e.querySelector('.app-bc-alive')?.textContent, countText: e.querySelector('.app-bc-count')?.textContent,
      progress: bar ? Number(bar.getAttribute('aria-valuenow')) : null,
      stateText: bar?.getAttribute('aria-valuetext'), title: [e.title, ...Array.from(e.querySelectorAll('[title]'), n => n.title)].filter(Boolean).join('\n'), text: e.textContent }
  })
}

const STATE_IDS = { ready: '006', reload: '007', 'no-ammo': '008', lost: '009', down: '010', active: '011',
  cooldown: '012', waiting: '013', 'no-stock': '014', stopped: '015', used: '016' }
const seconds = ms => `${(Math.ceil(ms / 100) / 10).toFixed(1)}s`

function assertCycleRows(rows, expected, weapon, locale, data) {
  assert.equal(rows.length, expected.length, `${weapon ? '武器' : '装置'}行数与 core 不一致`)
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, '周期行键重复')
  assert.deepEqual(rows.map(row => row.id).sort(), expected.map(row => row.id).sort(), '周期组漏行或键不匹配')
  for (const want of expected) {
    const row = rows.find(candidate => candidate.id === want.id)
    assert(row.compact, `未复用旧装填条：${want.id}`)
    assert.equal(row.timerInTrack, true, `读秒仍位于最右侧独立尾列：${want.id}`)
    if (row.timerFits !== undefined) assert.equal(row.timerFits, true, `条内读秒或状态被挤压：${want.id}`)
    for (const [key, field] of [['owner', 'ownerTag'], ['ship', 'shipId'], ['state', 'state'], ['count', 'count'], ['cycleMs', 'cycleMs'], ['remainingMs', 'remainingMs']]) {
      assert.equal(row[key], want[field], `${key} 与 core 不一致：${want.id}`)
    }
    const state = data.L10N[`ui.battleCycles.${STATE_IDS[want.state]}`][locale]
    const timed = want.cycleMs > 0 && ['reload', 'cooldown'].includes(want.state) || want.state === 'active' && want.remainingMs > 0
    const hasTrack = want.cycleMs > 0 && ['reload', 'active', 'cooldown', 'ready'].includes(want.state) && (weapon || want.state !== 'active' || want.remainingMs > 0)
    assert.equal(row.timer?.trim(), timed ? `${hasTrack ? '' : `${state} \u00b7 `}${seconds(want.remainingMs)}` : state, `可见倒计时/状态不一致：${want.id}`)
    // core fixture uses the default Chinese context even for the English renderer;
    // the owner mark is the locale-independent ownership anchor in that case.
    const ownerMark = ['player', 'ally-1', 'ally-2', 'ally-3'].indexOf(want.ownerTag) + 1
    assert(locale === 'zh' ? row.title.includes(want.ownerName) : row.title.includes(`#${ownerMark}`), `详情缺少完整所属舰名：${want.id}`)
    assert(row.title.includes(state), `详情缺少真实状态：${want.id}`)
    if (want.cycleMs > 0) assert(row.title.includes(seconds(want.cycleMs)), `详情缺少实际周期：${want.id}`)
    assert.equal(row.progress !== null, hasTrack, `进度条与真实周期/状态不一致：${want.id}`)
    if (hasTrack) {
      const progressing = ['reload', 'active', 'cooldown', 'ready'].includes(want.state)
      assert.equal(row.progress, progressing ? Math.round(want.percent) : 0, `进度不一致：${want.id}`)
      assert.equal(row.stateText, timed ? `${state} \u00b7 ${seconds(want.remainingMs)}` : state, `无障碍状态不一致：${want.id}`)
    }
    assert(!/NaN|Infinity/.test(row.title + row.text), `非法可见数值：${want.id}`)
    if (weapon) {
      for (const key of ['minM', 'maxM']) assert.equal(row[key], want[key], `真实射程不一致：${want.id}/${key}`)
      const match = row.range?.replaceAll(',', '').match(/([\d.]+)\s*[~\uFF5E\u2013-]\s*([\d.]+)\s*m/)
      assert(match, `缺少行内有效射程：${want.id}`)
      assert(Math.abs(Number(match[1]) - want.minM) <= 0.00051, `可见最小射程不一致：${want.id}`)
      assert(Math.abs(Number(match[2]) - want.maxM) <= 0.00051, `可见最大射程不一致：${want.id}`)
      if (want.src === 'drone') {
        const alive = row.alive ?? row.countText ?? row.label
        assert(alive?.includes(`${want.aliveCount}/${want.count}`), `无人机存活/总数不一致：${want.id}`)
      } else if (want.count > 1) assert((row.countText ?? row.label)?.includes(`\u00d7${want.count}`), `同舰同型数量未显示：${want.id}`)
    } else {
      assert.equal(row.kind, want.kind, `装置种类不一致：${want.id}`)
      assert.equal(row.target, want.targetTag, `装置目标不一致：${want.id}`)
      if (want.targetTag) assert(row.title.includes(want.targetName || want.targetTag), `装置目标详情不可读：${want.id}`)
      if (want.kind === 'web' && want.effectPct !== undefined) assert(row.title.includes(`${Math.round(want.effectPct * 10) / 10}`), `捕获网效果详情丢失：${want.id}`)
      if (want.cycleMs === 0) assert.equal(row.progress, null, `无真实循环的装置制造了进度条：${want.id}`)
    }
  }
}

async function compareRows(page, expected, weapon, locale, data) {
  const selector = weapon ? SEL.weapons : SEL.devices
  const rows = await page.js(`(${readCycleRows.toString()})(${JSON.stringify(selector)})`)
  assertCycleRows(rows, expected, weapon, locale, data)
  if (weapon) {
    const groups = await page.js(`Array.from(document.querySelectorAll('[data-weapon-owner]'),e=>e.dataset.weaponOwner)`)
    assert.deepEqual(groups.sort(), [...new Set(expected.map(row => row.ownerTag))].sort(), '武器逐舰标题不匹配')
  }
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.trigger)}).textContent.trim()`), data.L10N['ui.battleCycles.001'][locale])
  assert.equal(await page.js(`document.querySelector(${JSON.stringify(SEL.deviceScroll)}).getAttribute('aria-label')`), data.L10N['ui.battleCycles.002'][locale])
  return rows
}

async function timerLabelReadings(page, locale, data) {
  const labels = Object.values(STATE_IDS).map(id => data.L10N[`ui.battleCycles.${id}`][locale])
  const readings = await page.js(`(()=>{
    const labels=${JSON.stringify([...labels, '9999.9s'])};
    return ${JSON.stringify([SEL.weapons, SEL.devices])}.flatMap(selector=>{
      const row=document.querySelector(selector),original=row.querySelector('.app-bts-reload-ms'),track=original.parentElement;
      const clone=original.cloneNode(false);clone.style.visibility='hidden';track.appendChild(clone);
      try{return labels.map(text=>{clone.textContent=text;const range=document.createRange();range.selectNodeContents(clone);const r=range.getBoundingClientRect();return {selector,text,width:clone.clientWidth,height:clone.clientHeight,textWidth:r.width,textHeight:r.height,fits:clone.scrollWidth<=clone.clientWidth+1&&clone.scrollHeight<=clone.clientHeight+1}})}finally{clone.remove()}
    })
  })()`)
  assert(readings.every(row => row.fits), `状态词超出条内区域：${JSON.stringify(readings.filter(row => !row.fits))}`)
  return readings
}

async function visitRows(page, selector, scroller, axis) {
  const ids = await page.js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),e=>e.dataset.cycleId)`)
  const readings = []
  for (const id of ids) {
    const row = `${selector}[data-cycle-id=${JSON.stringify(id)}]`
    const visible = await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(row)}),list=document.querySelector(${JSON.stringify(scroller)});e.scrollIntoView({block:${JSON.stringify(axis === 'y' ? 'center' : 'nearest')},inline:${JSON.stringify(axis === 'x' ? 'center' : 'nearest')},behavior:'instant'});const b=e.getBoundingClientRect(),l=list.getBoundingClientRect();const left=Math.max(0,b.left,l.left),right=Math.min(innerWidth,b.right,l.right),top=Math.max(0,b.top,l.top),bottom=Math.min(innerHeight,b.bottom,l.bottom);const x=(left+right)/2,y=(top+bottom)/2,hit=document.elementFromPoint(x,y);return {id:${JSON.stringify(id)},reachable:right>left&&bottom>top&&!!hit&&(hit===e||e.contains(hit)),scrollTop:list.scrollTop,scrollLeft:list.scrollLeft}})()`)
    assert(visible.reachable, `周期行滚动后被遮挡：${id}`)
    readings.push(visible)
  }
  const overflow = await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(scroller)});return ${axis === 'x' ? 'e.scrollWidth-e.clientWidth' : 'e.scrollHeight-e.clientHeight'}})()`)
  if (overflow > 1) assert(readings.some(row => row[axis === 'x' ? 'scrollLeft' : 'scrollTop'] > 0), '有溢出但未实际滚动到远端行')
  if (axis === 'x') assert(readings.every(row => row.scrollTop === 0), '装置横滚带出了竖滚')
  return readings
}

async function nativeScroll(page, selector, axis, mobile) {
  const setup = await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollTo({left:0,top:0,behavior:'instant'});e.focus({preventScroll:true});const b=e.getBoundingClientRect(),m=new DOMMatrix(getComputedStyle(document.querySelector('.app-root')).transform);window.__battleCyclesScrollEvents=[];const probe=event=>window.__battleCyclesScrollEvents.push({type:event.type,trusted:event.isTrusted});e.addEventListener('wheel',probe,{once:true,passive:true});e.addEventListener('touchmove',probe,{once:true,passive:true});return {left:Math.max(0,b.left),right:Math.min(innerWidth,b.right),top:Math.max(0,b.top),bottom:Math.min(innerHeight,b.bottom),overflow:${axis === 'x' ? 'e.scrollWidth-e.clientWidth' : 'e.scrollHeight-e.clientHeight'},vector:${axis === 'x' ? '{x:m.a,y:m.b}' : '{x:m.c,y:m.d}'}}})()`)
  if (setup.overflow <= 1) return { axis, overflow: setup.overflow, required: false, reason: 'all-rows-fit' }
  const center = { x: (setup.left + setup.right) / 2, y: (setup.top + setup.bottom) / 2 }
  if (mobile) {
    const magnitude = Math.hypot(setup.vector.x, setup.vector.y)
    assert(magnitude > 0, '触摸滚动轴变换无效')
    const vector = { x: setup.vector.x / magnitude, y: setup.vector.y / magnitude }
    const room = Math.abs(vector.x) > 0.5 ? setup.right - setup.left : setup.bottom - setup.top
    const distance = Math.min(180, room * 0.65)
    assert(distance > 12, '滚动触区过窄')
    const start = { x: center.x + vector.x * distance / 2, y: center.y + vector.y * distance / 2 }
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] })
    for (let step = 1; step <= 12; step++) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - vector.x * distance * step / 12, y: start.y - vector.y * distance * step / 12, id: 1 }] })
      await sleep(18)
    }
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...center, deltaX: 0, deltaY: 260 })
  }
  await page.wait(`document.querySelector(${JSON.stringify(selector)}).${axis === 'x' ? 'scrollLeft' : 'scrollTop'}>1`, 5000)
  await sleep(350)
  const result = await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {scrollLeft:e.scrollLeft,scrollTop:e.scrollTop,events:window.__battleCyclesScrollEvents}})()`)
  assert(result.events.some(event => event.trusted && event.type === (mobile ? 'touchmove' : 'wheel')), '未收到真实原生滚动事件')
  if (axis === 'x') assert.equal(result.scrollTop, 0, '真实横向滑动导致装置竖滚')
  return { axis, overflow: setup.overflow, method: mobile ? 'cdp-touch-swipe' : 'cdp-wheel', ...result }
}

async function keyboardScroll(page) {
  await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(SEL.deviceScroll)});e.scrollTo({left:0,top:0,behavior:'instant'});e.focus({preventScroll:true})})()`)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 })
  await page.wait(`document.querySelector(${JSON.stringify(SEL.deviceScroll)}).scrollTop>0`, 5000)
  return page.js(`(()=>{const e=document.querySelector(${JSON.stringify(SEL.deviceScroll)});return {focused:document.activeElement===e,scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}})()`)
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
  const baseline = JSON.parse(await fs.readFile(path.join(profile, 'baseline.json'), 'utf8'))
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
    assert(await page.js(`!!document.querySelector(${JSON.stringify(SEL.deviceScroll)})`), '装置条不常驻')
    await page.tap(SEL.trigger)
    await page.wait(`!document.querySelector(${JSON.stringify(SEL.popup)}).hidden`)
    report.interactions.push(options.mobile ? 'real-touch-start/end-opens' : 'mouse-click-pins')
    await compareRows(page, fixture.initialWeapons, true, options.locale, data)
    await compareRows(page, fixture.initialDevices, false, options.locale, data)
    report.readings.push({ timerLabels: await timerLabelReadings(page, options.locale, data) })
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
      let reading = await geometry(page)
      reading.requested = { width, height }
      assert.equal(reading.viewport.width, width)
      assert.equal(reading.viewport.height, height)
      report.readings.push(reading)
      if (await page.js(closed)) { await page.tap(SEL.trigger); await page.wait(opened) }
      const openedReading = await geometry(page)
      openedReading.requested = { width, height }
      report.readings.push(openedReading)
      reading = openedReading
      assertGeometry(reading, options)
      reading.comparison = geometryComparison(reading, options, baseline)
      await compareRows(page, fixture.finalWeapons, true, options.locale, data)
      await compareRows(page, fixture.finalDevices, false, options.locale, data)
      if (await page.js(closed)) { await page.tap(SEL.trigger); await page.wait(opened) }
      report.interactions.push({ weaponNativeScroll: await nativeScroll(page, SEL.popup, 'y', options.mobile), viewport: [width, height] })
      report.interactions.push({ weaponRowsReachable: await visitRows(page, SEL.weapons, SEL.popup, 'y'), viewport: [width, height] })
      // 下拉窗口覆盖下方装置属正常叠层；收起后逐行验证常驻区可达。
      await escape(page)
      await page.wait(closed)
      report.interactions.push({ deviceNativeScroll: await nativeScroll(page, SEL.deviceScroll, 'y', options.mobile), viewport: [width, height] })
      const keyboard = await keyboardScroll(page)
      assert(keyboard.focused && keyboard.scrollTop > 0 && keyboard.scrollLeft === 0, '装置键盘竖滚不可达')
      report.interactions.push({ deviceKeyboardScroll: keyboard, deviceRowsReachable: await visitRows(page, SEL.devices, SEL.deviceScroll, 'y'), viewport: [width, height] })
      const closedReading = await geometry(page)
      const stable = [closedReading]
      for (let sample = 0; sample < 3; sample++) { await sleep(120); stable.push(await geometry(page)) }
      for (const sample of stable) for (const key of ['dock', 'stage', 'controls']) {
        assert(Math.abs(sample.boxes[key].offsetHeight - reading.boxes[key].offsetHeight) <= 1, `展开/收起或空闲刷新改变${key}高度`)
      }
      assert.equal(new Set(stable.map(sample => sample.boxes.fit.transform)).size, 1, '战场缩放发生振荡')
      report.readings.push({ requested: { width, height }, closedGeometry: closedReading,
        stability: stable.map(sample => ({ dock: sample.boxes.dock.offsetHeight, stage: sample.boxes.stage.offsetHeight, controls: sample.boxes.controls.offsetHeight, fit: sample.boxes.fit.transform })) })
      const webSelector = `${SEL.devices}[data-owner-tag="ally-1"][data-device-kind="web"]`
      await page.js(`document.querySelector(${JSON.stringify(webSelector)}).scrollIntoView({block:'nearest',inline:'center',behavior:'instant'})`)
      const link = fixture.link
      const webEvidence = await page.js(`(()=>{const row=document.querySelector(${JSON.stringify(webSelector)}),line=document.querySelector(${JSON.stringify(`[data-web-from="ally-1"][data-web-to=${JSON.stringify(link.to)}]`)}),badge=document.querySelector(${JSON.stringify(`.app-bts-unit[data-tag=${JSON.stringify(link.to)}] .app-bts-web-status`)});return {row:{owner:row.dataset.ownerTag,state:row.dataset.cycleState,target:row.dataset.targetTag??row.querySelector('[data-target-tag]')?.dataset.targetTag,text:row.textContent},line:line?{from:line.dataset.webFrom,to:line.dataset.webTo,bar:line.querySelector('.app-bts-web-bar').getBoundingClientRect().toJSON(),title:line.title}:null,badge:badge?{text:badge.textContent,rect:badge.getBoundingClientRect().toJSON()}:null}})()`)
      assert.equal(webEvidence.row.owner, 'ally-1')
      assert.equal(webEvidence.row.state, 'active')
      assert.equal(webEvidence.row.target, link.to)
      assert(webEvidence.line && webEvidence.line.bar.width > 0 && webEvidence.line.bar.height > 0, '僚舰网链接没有渲染')
      assert(webEvidence.badge && webEvidence.badge.rect.width > 0, '被网敌舰缺少 badge')
      assert.equal(webEvidence.badge.text, data.L10N['ui.battleCycles.022'][options.locale])
      assert(webEvidence.line.title.includes(fixture.link.fromName) && webEvidence.line.title.includes(fixture.link.toName), '捕获网线详情丢失舰归属')
      const badgeSelector = `.app-bts-unit[data-tag=${JSON.stringify(link.to)}] .app-bts-web-status`
      const badgeReachable = await page.js(`(()=>{const e=document.querySelector(${JSON.stringify(badgeSelector)}),b=e.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {reachable:!!hit&&(hit===e||e.contains(hit)),rect:b.toJSON()}})()`)
      assert(badgeReachable.reachable, '被网敌舰 badge 被遮挡或不可达')
      if (options.mobile) await page.tap(badgeSelector)
      else await move(page, badgeSelector)
      await page.wait(`Array.from(document.querySelectorAll('.app-tip'),e=>e.textContent).some(text=>text.includes(${JSON.stringify(fixture.link.fromName)})&&text.includes(${JSON.stringify(fixture.link.toName)}))`)
      report.interactions.push({ webBadgeReachable: badgeReachable, viewport: [width, height] })
      report.readings.push({ requested: { width, height }, web: webEvidence })
      report.screenshots.push(await screenshot(win, path.join(OUT, `${options.id}-${width}x${height}-final.png`)))
      console.log(`${options.id} ${width}x${height} 条内读秒/换行/僚舰网/几何通过 dock=${reading.boxes.dock.offsetHeight} stage=${reading.boxes.stage.offsetHeight} delta=${reading.comparison.delta.stageHeight}`)
      if (await page.js(opened)) { await page.tap(SEL.trigger); await page.wait(closed) }
    }
    if (await page.js(closed)) { await page.tap(SEL.trigger); await page.wait(opened) }
    await page.tap('.app-bts-topdock .app-bts-legends')
    await page.wait(closed)
    assert(await page.js(`!!document.querySelector(${JSON.stringify(SEL.deviceScroll)})`), '关闭武器列表连带隐藏装置')
    report.interactions.push('outside-closes-devices-stay')
    await page.tap(SEL.trigger)
    await page.wait(opened)
    await page.tap(SEL.popup)
    if (options.mobile) await page.js(`document.querySelector(${JSON.stringify(SEL.popup)}).focus()`)
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

module.exports = { selectedCases, checkedProfile, makeFixture, selfTest, baselineReadings, geometryComparison, assertCycleRows }
if (process.argv.includes('--child')) {
  const { app } = require('electron')
  const profile = checkedProfile(process.env.WHALE_PERF_USERDATA)
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  child().catch(error => { console.error(error); app.exit(1) })
} else if (require.main === module) {
  if (process.argv.includes('--help')) console.log('父侧先 build；node tools/battle-cycles-native-check.cjs [--case=classic-zh-desktop] [--self-test]；只读旧基线，输出 tools/_ui-artifacts/battle-cycles/timer-wrap-20261008；8 组合：' + CASES.map(row => row.id).join(', '))
  else if (process.argv.includes('--self-test')) selfTest().catch(error => { console.error(error); process.exitCode = 1 })
  else parent().catch(error => { console.error(error); process.exitCode = 1 })
}
