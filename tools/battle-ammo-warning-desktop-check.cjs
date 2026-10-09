/**
 * 战前弹药预警与技能续时文案外壳回归：构建后node tools/battle-ammo-warning-desktop-check.cjs。
 * 合成档、隔离userData、隐藏自建Electron；两套布局/中文与待译英文回退，首次无写入、二击出战。
 * 版本自检：游戏v0.1.0 · 存档v31 · 核对/运行2026-10-09。不访问个人档，不代替观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '..')
const PREFIX = 'whale-ammo-warning-'

if (!process.argv.includes('--child')) {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const data = require('../packages/data/src/index.ts')
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const now = Date.now(), ctx = data.buildSimContext()
      const s = core.createInitialState({ nowWallMs: now, seed: 1009 })
      s.modeChosen = true
      s.shipId = core.addShipToFleet(s, 'sh-hammerhead')
      s.moduleBay['mod-wh-a-frag'] = 1
      assert(core.fitModule(s, 'mod-wh-a-frag', ctx).ok)
      for (const task of core.FIRST_TASKS) s.importantTasks[task.id] = { done: true, claimed: true }
      s.exploredGalaxies = [...ctx.galaxies.keys()]
      s.standings.dsi = 1000
      s.standingsEarned = { dsi: 1000 }
      s.warehouse.items = { 'synaptic-accelerant': 2 }
      s.commsDelivered = Object.fromEntries(data.COMMS_MESSAGES.map(m => [m.id, 1]))
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(s, now), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, AMMO_WARNING_CASE: JSON.stringify({
        layout, locale, ammoName: data.buildSimContext(locale).items.get('ammo-explosive-l').name,
        skillsName: data.L10N['ui.App.007'][locale], mapName: data.L10N['ui.App.001'][locale],
      }) }
      for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF']) delete env[key]
      const run = spawnSync(require('electron'), [__filename, '--child'], {
        cwd: ROOT, env, windowsHide: true, encoding: 'utf8', timeout: 50000,
      })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
    } finally {
      const resolved = path.resolve(profile)
      assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(PREFIX))
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    assert(win)
    const data = JSON.parse(process.env.AMMO_WARNING_CASE)
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const js = source => win.webContents.executeJavaScript(source)
    const wait = async source => {
      for (let i = 0; i < 150; i++) { try { if (await js(source)) return } catch {} await sleep(100) }
      throw new Error('界面等待超时：' + source)
    }
    const errors = []
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
    await wait('!!document.querySelector(".app-root")')
    await js(`localStorage.setItem('whale-idle:layout',${JSON.stringify(data.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(data.locale)});localStorage.setItem('whale-idle:announce-seen','ann-alien-invasion-20261007');true`)
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve))
    win.webContents.reload()
    await loaded
    await wait('!!document.querySelector(".app-nav-item")')
    const navigate = async (key, label) => {
      const clicked = await js(`(()=>{const button=document.querySelector('[data-nav-page=${key}]')??[...document.querySelectorAll('.app-nav-side .app-nav-item')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!button)return false;button.click();return true})()`)
      assert(clicked, '找不到导航：' + label)
    }
    await navigate('skills', data.skillsName)
    await wait('!!document.querySelector(".app-subtabs")')
    const boostText = data.locale === 'zh' ? '技能加速' : 'Skill Boost'
    await js(`(()=>{const tab=[...document.querySelectorAll('button[role=tab]')].find(e=>e.textContent.includes(${JSON.stringify(boostText)}));if(!tab)throw Error('boost tab missing');tab.click()})()`)
    await wait('!!document.querySelector(".app-boost-block .app-inv-btns button")')
    const hint = await js(`document.querySelector('.app-boost-block .app-inv-btns button').title`)
    assert.equal(hint, '使用：技能加速有效时间增加24小时，倍率不叠加')
    assert((await js(`document.querySelector('.app-boost-block').textContent`)).includes('可重复使用'))
    const read = async () => JSON.parse(await js('window.whale.load()')).state
    const before = await read()
    await js(`document.querySelector('.app-boost-block .app-inv-btns button').click()`)
    await wait(`document.querySelector('.app-toast')?.textContent.includes('有效时间增加24小时')`)
    await js(`document.querySelector('.app-boost-block .app-inv-btns button').click()`)
    for (let i = 0; i < 100 && (await read()).warehouse.items['synaptic-accelerant'] !== undefined; i++) await sleep(100)
    const used = await read()
    assert.equal(used.warehouse.items['synaptic-accelerant'] ?? 0, 0)
    assert(used.skillBoostUntilMs - used.gameMs > 47.99 * 3_600_000)
    await navigate('map', data.mapName)
    const bounty = data.locale === 'zh' ? '常驻悬赏' : 'Standing bounty'
    const nav = await js(`(()=>{const tab=[...document.querySelectorAll('button[role=tab]')].find(e=>e.textContent.trim()===${JSON.stringify(bounty)});if(!tab)return false;tab.click();return true})()`)
    if (!nav) throw new Error('找不到悬赏页签：' + await js(`[...document.querySelectorAll('button[role=tab]')].map(e=>e.textContent)`))
    await wait('!!document.querySelector(".app-ano-btns button.is-primary:not([disabled])")')
    const beforeFight = await read()
    await js(`document.querySelector('.app-ano-btns button.is-primary:not([disabled])').click()`)
    await wait(`document.querySelector('.app-toast')?.textContent.includes('弹药预载不足')`)
    const warning = await js(`document.querySelector('.app-toast').textContent`)
    assert(warning.includes(data.ammoName) && warning.includes('缺 ') && !warning.includes('ui.battleAmmo'), warning)
    const first = await read()
    assert.equal(first.expedition.active, false)
    assert.deepEqual(first.warehouse.items, beforeFight.warehouse.items)
    const geometry = await js(`(()=>{const e=document.querySelector('.app-toast'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {width:r.width,height:r.height,whiteSpace:s.whiteSpace,overflow:s.overflowY,windowHeight:innerHeight}})()`)
    assert.equal(geometry.whiteSpace, 'pre-line')
    assert.equal(geometry.overflow, 'auto')
    assert(geometry.height > 0 && geometry.height < geometry.windowHeight)
    await js(`document.querySelector('.app-ano-btns button.is-primary:not([disabled])').click()`)
    for (let i = 0; i < 100 && !(await read()).expedition.active; i++) await sleep(100)
    assert.equal((await read()).expedition.active, true)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, ...data, electronPid: process.pid, firstClickNoBattle: true, secondClickBattle: true,
      increased48h: true, originalStock: before.warehouse.items['synaptic-accelerant'], warning, geometry, errors }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
