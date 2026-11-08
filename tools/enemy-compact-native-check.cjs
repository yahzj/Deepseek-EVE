/** 敌舰紧凑梯形检查：npm run build后运行node tools/enemy-compact-native-check.cjs。
 * 隐藏离屏Electron、本树生产文件、独立合成档；不读个人档或Git历史。
 * 5/7舰为墨潮实际波次，9/12舰用同波正式支援规格补足；延后开火仅用于几何取证。
 * --mirage核对2/3/4艘我舰对蜃影实际5敌舰；输出独立目录，不覆盖既有证据。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

const ROOT = path.resolve(__dirname, '..')
const MIRAGE = process.argv.includes('--mirage')
const MIRROR = process.argv.includes('--mirror')
const PLAYERS = MIRAGE || MIRROR || process.argv.includes('--players')
const COUNTS = MIRAGE ? [2, 3, 4] : [5, 7, 9, 12]
const OUT = path.join(ROOT, `tools/_ui-artifacts/${MIRAGE ? 'mirage-small-fleet-20261108' : `${MIRROR ? 'mirror-trapezoid' : PLAYERS ? 'player-trapezoid' : 'enemy-compact'}-20261101`}`)
const PREFIX = 'whale-enemy-compact-'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const combat = require('../packages/core/src/combat.ts')
  const data = require('../packages/data/src/index.ts')
  const { seedUnit, initFoeDronePools } = require('../packages/core/src/combat/foes/state.ts')
  const { syncRangeEw } = require('../packages/core/src/combat/rangeEw.ts')
  const { injectCommandFleetAllShipsFixture } = require('./command-fleet-all-ships-fixture.ts')
  const ctx = data.buildSimContext()
  await fs.mkdir(OUT, { recursive: true })
  for (const count of COUNTS) {
    const state = core.createInitialState({ nowWallMs: Date.now(), seed: 20261101 })
    injectCommandFleetAllShipsFixture(state)
    const roster = core.combatRosterOf(state).slice(0, PLAYERS ? count : 12)
    core.notePreparationSquad(state, 'combat', roster)
    assert.deepEqual(core.combatRosterOf(state), roster)
    const battleId = MIRAGE ? 'ano-mirage-hijackers' : 'ink-flagship'
    const battle = combat.startFleetBattleFor(state, ctx, roster, battleId)
    assert(battle, '合成编队开战失败')
    if (!MIRAGE) {
      for (const [tag, unit] of Object.entries(battle.units)) if (unit.side === 'foe') delete battle.units[tag]
      battle.waveIdx = count === 5 ? 2 : 3
    }
    const foes = combat.activeFoeSpecsOf(ctx.anomalies.get(battleId), ctx.balance.battle, battle.waveIdx ?? 0)
    if (!MIRAGE) for (const foe of foes) seedUnit(battle, foe)
    for (let i = foes.length; !MIRAGE && i < count; i++) {
      const base = foes[i % foes.length]
      const n = (battle.foeReviveCount ?? 0) + 1
      battle.foeReviveCount = n
      seedUnit(battle, { ...structuredClone(base), tag: `sup${n}-${base.tag}` })
    }
    const all = require('../packages/core/src/combat/foes/reinforcements.ts').foesWithSupport(battle, foes)
    initFoeDronePools(battle, all)
    for (const unit of Object.values(battle.units)) unit.weapons.fill(600000)
    state.gameMs = 10000
    battle.lastTickGameMs = state.gameMs
    syncRangeEw(state, ctx, battle, all)
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: battleId, battle,
      foeGalaxyId: ctx.anomalies.get(battleId).galaxyId, sortie: { version: 1, leaderShipId: state.shipId, shipIds: roster } }
    state.commsDelivered = Object.fromEntries(data.COMMS_MESSAGES.map(row => [row.id, 0]))
    state.commsRead = Object.fromEntries(data.COMMS_MESSAGES.map(row => [row.id, true]))
    state.commsPopups = []
    await fs.writeFile(path.join(OUT, `fixture-${count}.json`), core.serializeSaveFile(state, Date.now() + 3600000), 'utf8')
  }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let child, timer
  try {
    await fs.copyFile(path.join(OUT, `fixture-${COUNTS[0]}.json`), path.join(profile, 'save.json'))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF', 'NODE_OPTIONS']) delete env[key]
    child = spawn(require('electron'), [__filename, '--child', ...(PLAYERS ? ['--players'] : []), ...(MIRROR ? ['--mirror'] : []), ...(MIRAGE ? ['--mirage'] : [])], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
    console.log(`敌舰紧凑排列检查：自有Electron PID=${child.pid}`)
    timer = setTimeout(() => child.kill(), 180000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, '敌舰紧凑排列桌面检查失败')
    console.log(`PASS ${path.join(OUT, 'report.json')}`)
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

async function child() {
  const electron = require('electron'), { app, BrowserWindow } = electron
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith(PREFIX))
  app.setPath('userData', profile); app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  let lastFrame, paints = 0
  class OffscreenWindow extends BrowserWindow {
    constructor(options) {
      super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } })
      this.webContents.setFrameRate(30)
      this.webContents.on('paint', (_event, _rect, image) => { lastFrame = image; paints++ })
    }
  }
  const Module = require('node:module'), load = Module._load
  Module._load = function (request, parent, isMain) {
    return request === 'electron' ? new Proxy(electron, { get: (target, key) => key === 'BrowserWindow' ? OffscreenWindow : target[key] })
      : load.call(this, request, parent, isMain)
  }
  const errors = []
  const ready = new Promise((resolve, reject) => app.once('browser-window-created', (_event, win) => {
    win.webContents.on('render-process-gone', (_e, info) => reject(new Error(JSON.stringify(info))))
    win.webContents.on('console-message', (_e, level, text) => { if (level >= 3) errors.push(text) })
    win.webContents.once('did-finish-load', () => resolve(win))
  }))
  try { require(path.join(ROOT, 'apps/desktop/out/main/index.js')) } finally { Module._load = load }
  const win = await ready
  win.setMinimumSize(200, 200)
  const js = source => win.webContents.executeJavaScript(source)
  const wait = async source => {
    for (let i = 0; i < 150; i++) { if (await js(source)) return; await sleep(100) }
    throw new Error(`等待失败:${source}`)
  }
  await wait('!!document.querySelector(".app-root")')
  const readings = []
  for (const layout of ['classic', 'modern']) for (const count of COUNTS) {
    const enemyCount = MIRAGE ? 5 : count
    await js(`localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:layout-set','1')`)
    await win.loadURL('about:blank')
    await sleep(100)
    await fs.copyFile(path.join(OUT, `fixture-${count}.json`), path.join(profile, 'save.json'))
    await win.loadFile(path.join(ROOT, 'apps/desktop/out/renderer/index.html'))
    await wait(`document.querySelectorAll('.app-bts-col.is-foe .app-bts-unit').length===${enemyCount}`)
    await sleep(1500)
    await js('document.querySelector(".app-ann .app-ann-head button")?.click()')
    const viewports = MIRAGE ? [[1920, 1080], [1540, 940], [1100, 900], [760, 700]] : [[1540, 940], [1100, 900], [760, 700]]
    for (const [width, height] of viewports) {
      win.setContentSize(width, height)
      await sleep(600)
      const row = await js(`(() => {
        const lane=document.querySelector('.app-bts-lane'), r=lane.getBoundingClientRect(), scale=r.width/lane.offsetWidth;
        const rect=el=>el?.getBoundingClientRect().toJSON();
        const units=[...document.querySelectorAll('.app-bts-col.is-foe .app-bts-unit')].map(el=>({tag:el.dataset.tag,
          ship:rect(el.querySelector('.app-bts-ship')),name:rect(el.querySelector('.app-bts-name')),bar:rect(el.querySelector('.app-bts-hpWrap')),
          paths:el.querySelectorAll('svg path').length,cssLeft:parseFloat(el.style.left),cssTop:parseFloat(el.style.top)}));
        const myUnits=[...document.querySelectorAll('.app-bts-col.is-me[data-tag]')].map(el=>({tag:el.dataset.tag,
          ship:rect(el.querySelector('.app-bts-ship')),name:rect(el.querySelector('.app-bts-name')),bar:rect(el.querySelector('.app-bts-hpWrap')),
          paths:el.querySelectorAll('svg path').length,cssLeft:parseFloat(el.style.left),cssTop:parseFloat(el.style.top)}))
          .sort((a,b)=>(a.tag==='player'?0:Number(a.tag.slice(5)))-(b.tag==='player'?0:Number(b.tag.slice(5))));
        return {layout:${JSON.stringify(layout)},rootClass:document.querySelector('.app-root').className,
          foeOrigin:rect(document.querySelector('.app-bts-col.is-foe')),count:${count},width:innerWidth,height:innerHeight,
          lane:r.toJSON(),logicalWidth:lane.offsetWidth,scale,units,myUnits};
      })()`)
      readings.push(row)
      assert(row.rootClass.includes(`is-layout-${layout}`), `布局未真正切换:${row.rootClass}`)
      const cols = enemyCount > 8 ? 4 : 3, rows = Math.ceil(enemyCount / cols)
      const first = row.units[0].ship
      const tolerance = Math.max(1, row.scale)
      for (const [index, unit] of row.units.entries()) {
        assert(unit.paths > 0, `${layout}/${count}/舰影为空`)
        const center = (unit.ship.left + unit.ship.right) / 2
        assert(Math.abs(unit.ship.left - row.foeOrigin.left - unit.cssLeft * row.scale) < 1.5,
          `舰体横向DOM与锚点不同源:${layout}/${count}/${index}`)
        assert(Math.abs(unit.ship.top - row.foeOrigin.top - unit.cssTop * row.scale) < 1.5,
          `舰体纵向DOM与锚点不同源:${layout}/${count}/${index}`)
        const col = Math.floor(index / rows), rank = index % rows
        const x0 = (first.left + first.right) / 2
        if (row.logicalWidth >= 1200) assert(Math.abs((center - x0) / row.scale - col * 140 - rank * 24) < 1.5, '桌面舰体与紧凑锚点不一致')
        for (const box of [unit.ship, unit.name, unit.bar]) {
          assert(box && box.left >= row.lane.left - tolerance && box.right <= row.lane.right + tolerance
            && box.top >= row.lane.top - tolerance && box.bottom <= row.lane.bottom + tolerance,
          `舰体/舰名/血条越界:${JSON.stringify({ row: [layout,count,width], unit })}`)
        }
      }
      const overlap = (a, b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1
        && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1
      for (let i = 0; i < row.units.length; i++) for (let j = i + 1; j < row.units.length; j++) {
        for (const a of [row.units[i].ship,row.units[i].name,row.units[i].bar]) {
          for (const b of [row.units[j].ship,row.units[j].name,row.units[j].bar]) assert(!overlap(a,b), `舰体或读数互压:${layout}/${count}/${width}/${i}/${j}`)
        }
      }
      if (PLAYERS) {
        assert.equal(row.myUnits.length, count)
        const myCols = count > 8 ? 4 : count > 4 ? 3 : 2, myRows = Math.ceil(count / myCols)
        const x0 = (row.myUnits[0].ship.left + row.myUnits[0].ship.right) / 2
        const enemyX0 = (row.units[0].ship.left + row.units[0].ship.right) / 2
        for (const [index, unit] of row.myUnits.entries()) {
          assert(unit.paths > 0, '玩家舰影为空')
          const center = (unit.ship.left + unit.ship.right) / 2
          assert(Math.abs(unit.ship.left - row.lane.left - unit.cssLeft * row.scale) < 1.5,
            `玩家舰体DOM与锚点偏离:${JSON.stringify({width,count,index,unit,lane:row.lane,scale:row.scale})}`)
          const enemyCenter = (row.units[index].ship.left + row.units[index].ship.right) / 2
          if (!MIRAGE) {
            assert(Math.abs(center + enemyCenter - row.lane.left - row.lane.right) < 1.5,
              `敌我舰位没有严格镜像:${layout}/${count}/${width}/${index}`)
            assert(Math.abs((center - x0) + (enemyCenter - enemyX0)) < 1.5,
              `敌我列距或后移不同源:${layout}/${count}/${width}/${index}`)
            assert(Math.abs((unit.ship.top + unit.ship.bottom) / 2
              - (row.units[index].ship.top + row.units[index].ship.bottom) / 2) < 1.5,
            `敌我行位不对称:${layout}/${count}/${width}/${index}`)
          }
          if (index + myRows < count) {
            const next = row.myUnits[index + myRows].ship
            assert((center - (next.left + next.right) / 2) / row.scale <= 141.5, '玩家列距未收紧')
          }
          if (MIRAGE && row.logicalWidth >= 1200) {
            assert(Math.abs((x0 - center) / row.scale - Math.floor(index / myRows) * 140 - index % myRows * 24) < 1.5,
              `蜃影小编队没有按紧凑锚点落画:${layout}/${count}/${width}/${index}`)
          }
          for (const box of [unit.ship,unit.name,unit.bar]) {
            assert(box && box.left >= row.lane.left - tolerance && box.right <= row.lane.right + tolerance
              && box.top >= row.lane.top - tolerance && box.bottom <= row.lane.bottom + tolerance,
            `玩家舰体/读数越界:${JSON.stringify({layout,count,width,unit})}`)
          }
        }
        for (let i = 0; i < row.myUnits.length; i++) for (let j = i + 1; j < row.myUnits.length; j++) {
          for (const a of [row.myUnits[i].ship,row.myUnits[i].name,row.myUnits[i].bar]) {
            for (const b of [row.myUnits[j].ship,row.myUnits[j].name,row.myUnits[j].bar]) assert(!overlap(a,b), `玩家舰体或读数互压:${layout}/${count}/${width}/${i}/${j}`)
          }
        }
      }
      const frame = paints
      win.webContents.invalidate()
      for (let i = 0; i < 30 && paints <= frame; i++) await sleep(50)
      assert(paints > frame, '未收到新绘制帧')
      await fs.writeFile(path.join(OUT, `${layout}-${count}-${width}.png`), lastFrame.toPNG())
      await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: false, readings, errors }, null, 2), 'utf8')
      console.log(`通过 ${layout} ${enemyCount}敌舰${MIRAGE ? `/${count}我舰` : ''} ${width}×${height}`)
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'))
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, target: 'desktop-production-file-offscreen',
    electron: process.versions.electron, hidden: !win.isVisible(), isolatedProfile: app.getPath('userData') === profile,
    readings, errors, limitation: '合成档延后开火，仅验证真实渲染几何；不代表性能、实体手机或观感验收。' }, null, 2), 'utf8')
  app.exit(0)
}

if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
