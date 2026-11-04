/** 四族发射器与实验室筛选的隔离桌面/手机检查。
 * 用法：npm run build后 node tools/faction-beacons-ui-check.cjs。
 * 真App、合成档、隐藏Electron、自建回环服务与独立临时userData；不读取个人档。
 * 覆盖经典/现代、桌面/手机旋转下拉、筛选、正常工期制造/退料、四族点火/IPC重载。
 * 输出tools/_ui-artifacts/faction-beacons-20261017；不是实体手机或观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, staticServer, settingsScript, JourneyPage, stopOwned, removeProfile, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { clickAt } = require('./wormhole-expedition-event-ui.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/faction-beacons-20261017')
const PREFIX = 'whale-faction-beacons-'
function data() {
  require('tsx/cjs')
  return { core: require('../packages/core/src/index.ts'), content: require('../packages/data/src/index.ts') }
}
async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const { core, content } = data(), ctx = content.buildSimContext()
  const onlyLayout = process.argv.find(arg => arg.startsWith('--layout='))?.slice(9)
  for (const layout of ['classic', 'modern']) for (const mobile of [false, true]) {
    if (onlyLayout && onlyLayout !== layout) continue
    const family = layout === 'classic' ? mobile ? 'C' : 'R' : mobile ? 'D' : 'H'
    const beaconId = `invasion-beacon-${family.toLowerCase()}`
    const state = core.createInitialState({ nowWallMs: Date.now(), seed: 73 })
    state.modeChosen = true; state.onboarding.step = 99
    for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standings.dsi = 100; state.standingsEarned = { dsi: 100 }
    // 本期已结束的合成记录只屏蔽周排期自动开场；专属点火仍由真实UI触发。
    state.weekendLastResult = { seq: 0, family: 'R', coreId: 'galaxy-vault', endedAtWallMs: Date.now() + 86400000,
      flagshipOutcome: 'player', share: 0, tier: 'none', galaxies: [], isk: 0, wreck: 0, blackBox: 0 }
    for (const def of ctx.stations.values()) if (def.galaxyId !== 'galaxy-vault') state.stationSites[def.id] = { stage: def.tiers.length, delivered: {} }
    for (const row of core.INVASION_BEACON_TYPES) state.warehouse.items[row.itemId] = 2
    state.warehouse.items['synaptic-accelerant'] = 1
    state.wallet.isk = 703_000_000
    state.warehouse.items['mat-wh-essence'] = 180
    for (const id of [beaconId, 'synaptic-accelerant']) for (const material of ctx.labRecipes.get(id).materials) {
      state.warehouse.items[material.itemId] = (state.warehouse.items[material.itemId] ?? 0) + material.units * 2
    }
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
    let server, child, timer
    try {
      await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now() + 3600000))
      const hosted = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), {
        initialize: settingsScript(content.ANNOUNCEMENTS[0].id, undefined, { layout }),
      })
      server = hosted.server
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: hosted.url,
        WH_BEACON_LAYOUT: layout, WH_BEACON_MOBILE: mobile ? '1' : '0', WH_BEACON_FAMILY: family }
      delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true, env, stdio: 'inherit' })
      console.log(`发射器隔离${layout}/${mobile ? '手机' : '桌面'} PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 180000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
      const saved = core.loadSaveFile(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state
      assert.equal(saved.weekendEvent.family, family)
      assert.equal(saved.weekendEvent.coreId, 'galaxy-vault')
      for (const row of core.INVASION_BEACON_TYPES) assert.equal(saved.warehouse.items[row.itemId], 2)
      assert.equal(saved.warehouse.items['synaptic-accelerant'], 2)
    } finally {
      clearTimeout(timer); await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, PREFIX)
    }
  }
}
async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], mobile = process.env.WH_BEACON_MOBILE === '1', layout = process.env.WH_BEACON_LAYOUT
  const family = process.env.WH_BEACON_FAMILY, beaconId = `invasion-beacon-${family.toLowerCase()}`
  const errors = [], readings = []
  win.setMinimumSize(200, 200)
  win.setContentSize(mobile ? 390 : 1366, mobile ? 844 : 768)
  win.webContents.setBackgroundThrottling(false)
  win.webContents.debugger.attach('1.3')
  win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
  page.tap = async selector => {
    try {
      await page.js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`)
      await sleep(200)
      const geometry = await page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;
        const r=el.getBoundingClientRect(),points=[[.5,.5],[.25,.25],[.75,.75]].map(([x,y])=>({x:r.left+r.width*x,y:r.top+r.height*y}));
        const point=points.find(p=>{const hit=document.elementFromPoint(p.x,p.y);return hit&&(hit===el||el.contains(hit))});
        return {point,disabled:el.disabled,rect:r.toJSON()}})()`)
      assert(geometry?.point && !geometry.disabled, `控件实际命中失败:${selector}:${JSON.stringify(geometry)}`)
      await clickAt(page, geometry.point, mobile)
      await sleep(150)
    } catch (error) {
      await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}-failure.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
      throw error
    }
  }
  await page.send('Page.enable'); await page.send('Runtime.enable')
  await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  if (mobile) {
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844,
      deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await page.reload()
  }
  await page.wait('!!window.__whalePlanetaryTest && !!document.querySelector(".app-root")')
  if (mobile) await page.wait('!!document.querySelector(".app-root.is-mobile-rot")')
  if (layout === 'modern' && await page.js(`document.querySelector('.app-log-side')?.getBoundingClientRect().width > 1`)) {
    await page.tap('.app-log-head-right button')
    await page.wait('document.querySelector(".app-log-side").getBoundingClientRect().width < 1')
  }
  const { content } = data(), t = id => content.L10N[id].zh
  const loaded = await page.js('window.__whalePlanetaryTest.snapshot()')
  assert.equal(loaded.standingsEarned.dsi, 100, '合成声望在读档后必须仍满足扫描入口')
  console.log('合成建站进度', JSON.stringify(loaded.stationSites))
  await page.text('.app-nav-side', t('ui.App.006'))
  await page.js(`(()=>{const b=[...document.querySelectorAll('button[role=tab]')].find(b=>[...b.querySelectorAll('span')].some(s=>s.textContent.trim()===${JSON.stringify(t('ui.lab.001'))}));if(!b)throw Error('实验室页签缺失');b.setAttribute('data-lab-tab','1')})()`)
  await page.tap('[data-lab-tab]')
  const filters = '[role=tablist][aria-label="' + t('ui.labFilter.005') + '"]'
  await page.wait(`!!document.querySelector(${JSON.stringify(filters)})`)
  for (const [id, count] of [['ui.labFilter.003', 5], ['ui.labFilter.004', 1], ['ui.labFilter.002', 2], ['ui.labFilter.001', 8]]) {
    await page.text(filters, t(id))
    const names = await page.js(`Array.from(document.querySelectorAll('.app-lab-card'),el=>el.textContent)`)
    // 卡片本体沿矿带卡族，按实验室已显示的卡头计数。
    const actual = await page.js(`Array.from(document.querySelectorAll('.app-page-content .app-belt-card')).filter(el=>el.getBoundingClientRect().width>0).length`)
    assert.equal(actual, count, `筛选数量错误:${id}:${actual}:${names.length}`)
    readings.push({ filter: id, count: actual })
  }
  const ctx = content.buildSimContext()
  const markRecipe = async id => {
    await page.js(`(()=>{document.querySelector('[data-production-recipe]')?.removeAttribute('data-production-recipe');const e=[...document.querySelectorAll('.is-lab')].find(e=>e.querySelector('.app-belt-name')?.textContent.trim()===${JSON.stringify(ctx.labRecipes.get(id).name)});if(!e)throw Error('生产卡缺失');e.setAttribute('data-production-recipe','1')})()`)
  }
  for (const id of [beaconId, 'synaptic-accelerant']) {
    const recipe = ctx.labRecipes.get(id)
    await markRecipe(id)
    const initial = await page.js('window.__whalePlanetaryTest.snapshot()')
    await page.text('[data-production-recipe]', t('ui.lab.006'))
    const active = await page.js('window.__whalePlanetaryTest.snapshot()')
    const run = active.labRuns.find(r => r.recipeId === id)
    assert(run, `真实按钮未开工:${id}`)
    assert.equal(run.cycleMs, recipe.cycleMs)
    for (const m of recipe.materials) assert.equal(active.warehouse.items[m.itemId], initial.warehouse.items[m.itemId] - m.units)
    await page.text(filters, t('ui.labFilter.002'))
    assert.deepEqual((await page.js('window.__whalePlanetaryTest.snapshot()')).labRuns, active.labRuns, '筛选不可停止在产批次')
    await page.text(filters, t('ui.labFilter.001'))
    await markRecipe(id)
    await page.text('[data-production-recipe] .app-belt-worker', t('ui.IndustryPage.104'))
    const refunded = await page.js('window.__whalePlanetaryTest.snapshot()')
    assert.equal(refunded.labRuns.length, 0)
    assert.deepEqual(refunded.warehouse.items, initial.warehouse.items, '取消须按实际投入全部退料')
    await page.text('[data-production-recipe]', t('ui.lab.006'))
    assert.equal(await page.js(`window.__whalePlanetaryTest.step(${run.cycleMs})`), true)
    await dismissOverlays(page)
    const delivered = await page.js('window.__whalePlanetaryTest.snapshot()')
    assert.equal(delivered.labRuns.length, 0)
    assert.equal(delivered.warehouse.items[id], initial.warehouse.items[id] + 1)
    for (const m of recipe.materials) assert.equal(delivered.warehouse.items[m.itemId], initial.warehouse.items[m.itemId] - m.units)
    readings.push({ production: id, cycleMs: run.cycleMs, cancelledRefunded: true, filterKeepsRun: true, delivered: 1 })
    console.log(`${layout}/${mobile ? '手机' : '桌面'} ${id}正常工期生产/取消/交付通过`)
  }
  await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}-lab.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
  await page.text('.app-nav-side', t('ui.hud.101'))
  await page.tap('#hud-tab-lab')
  for (const [id, count] of [['ui.labFilter.003', 5], ['ui.labFilter.004', 1], ['ui.labFilter.002', 2], ['ui.labFilter.001', 8]]) {
    await page.text(filters, t(id))
    const actual = await page.js(`document.querySelectorAll('button.hud-card').length`)
    assert.equal(actual, count, `HUD筛选数量错误:${id}:${actual}`)
    readings.push({ hudFilter: id, count: actual })
  }
  await page.js(`(()=>{const b=[...document.querySelectorAll('button.hud-card')].find(e=>e.querySelector('.nm')?.textContent===${JSON.stringify(content.buildSimContext().labRecipes.get('invasion-beacon-d').name)});if(!b)throw Error('HUD缺少守墓配方');b.setAttribute('data-hud-beacon','1')})()`)
  await page.tap('[data-hud-beacon]')
  const hudBefore = await page.js('window.__whalePlanetaryTest.snapshot()')
  const materialsBefore = await page.js(`document.querySelector('.hud-grid.two .hud-grid .hud-table').textContent`)
  assert.equal(await page.js(`document.querySelector('.hud-grid.two .hud-grid .hud-kv b').textContent.trim()`), family === 'D' ? '3' : '2')
  await page.text(filters, t('ui.labFilter.002'))
  assert.equal(await page.js(`document.querySelector('.hud-grid.two .hud-grid .hud-table').textContent`), materialsBefore, '筛选不能切换投料配方')
  assert.deepEqual((await page.js('window.__whalePlanetaryTest.snapshot()')).labLoops, hudBefore.labLoops)
  await page.text(filters, t('ui.labFilter.001'))
  assert.equal(await page.js(`document.querySelector('button.hud-card.is-sel .nm').textContent`), content.buildSimContext().labRecipes.get('invasion-beacon-d').name)
  readings.push({ hudSelectionPreserved: true, selectedStock: family === 'D' ? 3 : 2 })
  const signalText = id => t(data().core.signalSpaceTextId(id))
  await page.text('.app-nav-side', t('ui.App.001'))
  await page.text('.app-subtabs', signalText('ui.MapPage.007'))
  await page.text('.app-page-content .app-subtabs', signalText('ui.WormholeScan.004'))
  const markTechnology = async tier => {
    await page.js(`(()=>{document.querySelector('[data-scan-technology]')?.removeAttribute('data-scan-technology');const e=[...document.querySelectorAll('.app-mt-node')].find(e=>e.querySelector('.app-mt-node-name')?.textContent==='信号空间探索'&&e.closest('.app-mt-tier').querySelector('.app-mt-tier-tag').textContent===${JSON.stringify('T' + tier)});if(!e)throw Error('扫描科技缺失');e.setAttribute('data-scan-technology','1')})()`)
    await page.tap('[data-scan-technology]')
  }
  await markTechnology(4)
  assert.equal(await page.js(`document.querySelector('.app-mt-modal-actions .is-primary').disabled`), true, 'T4需先研究T1')
  await page.tap('.app-mt-modal .app-modal-head button')
  for (const [tier, cost, essence] of [[1, 3_000_000, 20], [4, 700_000_000, 160]]) {
    await markTechnology(tier)
    const beforeResearch = await page.js('window.__whalePlanetaryTest.snapshot()')
    await page.tap('.app-mt-modal-actions .is-primary')
    const after = await page.js('window.__whalePlanetaryTest.snapshot()')
    assert.equal(after.research.levels[`mt-explore-signal-radius-t${tier}`], 1)
    assert.equal(after.wallet.isk, beforeResearch.wallet.isk - cost)
    assert.equal(after.warehouse.items['mat-wh-essence'] ?? 0, (beforeResearch.warehouse.items['mat-wh-essence'] ?? 0) - essence)
    assert.equal(await page.js(`document.querySelector('.app-mt-modal-actions .is-primary').disabled`), true, '科技只能研究1级')
    await page.tap('.app-mt-modal .app-modal-head button')
    readings.push({ researchTier: tier, cost, essence, maxLevel: 1 })
    console.log(`${layout}/${mobile ? '手机' : '桌面'} 扫描科技T${tier}界面研究/扣款/封顶通过`)
  }
  await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}-research.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
  await page.text('.app-nav-side', t('ui.App.001'))
  await page.text('.app-subtabs', t('ui.MapPage.002'))
  await page.wait('!!document.querySelector(".app-map-node")')
  await page.js(`(()=>{const n=[...document.querySelectorAll('.app-map-node')].find(e=>e.textContent.includes('穹顶墓园'));if(!n)throw Error('缺少目标节点');n.setAttribute('data-beacon-target','1')})()`)
  await page.tap('[data-beacon-target] .app-map-dot')
  await page.wait('!!document.querySelector("[data-beacon-select]")')
  const before = await page.js('window.__whalePlanetaryTest.snapshot()')
  const options = await page.js(`Array.from(document.querySelector('[data-beacon-select]').options,o=>({value:o.value,label:o.textContent.trim()}))`)
  assert.equal(options.length, 5)
  assert.equal(await page.js(`document.querySelector('[data-beacon-select]').value`), 'invasion-beacon')
  const intermediateId = family === 'R' ? 'invasion-beacon-c' : 'invasion-beacon-r'
  for (const id of [intermediateId, beaconId]) {
    const choice = options.find(o => o.value === id)
    if (mobile) {
      await page.tap('[data-beacon-select]')
      await page.wait('!!document.querySelector(".app-mob-sel-mask")')
      if (id === beaconId) await fs.writeFile(path.join(OUT, `${layout}-mobile-dropdown.png`), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
      await page.text('.app-mob-sel', choice.label)
      await page.wait('!document.querySelector(".app-mob-sel-mask")')
    } else {
      await page.tap('[data-beacon-select]')
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
      const index = await page.js('document.querySelector("[data-beacon-select]").selectedIndex')
      const target = options.findIndex(o => o.value === id)
      for (let i = 0; i < Math.abs(target - index); i++) {
        const key = target > index ? 'ArrowDown' : 'ArrowUp'
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
      }
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
    }
    await page.wait(`document.querySelector('[data-beacon-select]').value===${JSON.stringify(id)}`)
    assert.equal(await page.js(`Array.from(document.querySelectorAll('.app-ga-beacon button')).some(b=>b.textContent.trim()===${JSON.stringify(t('ui.ItemsPage.056'))})`), false, '切换发射器必须取消旧确认')
    if (id === intermediateId) await page.text('.app-ga-beacon', t('ui.beacon.001'))
  }
  await page.text('.app-ga-beacon', t('ui.beacon.001'))
  await page.text('.app-ga-beacon', t('ui.beacon.008'))
  const cancelled = await page.js('window.__whalePlanetaryTest.snapshot()')
  assert.deepEqual(cancelled.warehouse.items, before.warehouse.items)
  assert.equal(cancelled.weekendEvent, undefined)
  await page.text('.app-ga-beacon', t('ui.beacon.001'))
  await page.text('.app-ga-beacon', t('ui.ItemsPage.056'))
  await page.wait(`window.__whalePlanetaryTest.snapshot().weekendEvent?.family===${JSON.stringify(family)}`)
  const launched = await page.js('window.__whalePlanetaryTest.snapshot()')
  for (const row of options) assert.equal(launched.warehouse.items[row.value], before.warehouse.items[row.value] - (row.value === beaconId ? 1 : 0))
  await page.js('window.__whalePlanetaryTest.persist()')
  const image = await win.webContents.capturePage(undefined, { stayHidden: true })
  await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}.png`), image.toPNG())
  assert.equal(errors.length, 0)
  await page.reload()
  const reloaded = await page.js('window.__whalePlanetaryTest.snapshot()')
  assert.equal(reloaded.weekendEvent.family, family)
  assert.deepEqual(reloaded.warehouse.items, launched.warehouse.items)
  for (const tier of [1, 4]) assert.equal(reloaded.research.levels[`mt-explore-signal-radius-t${tier}`], 1)
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(OUT, `${layout}-${mobile ? 'mobile' : 'desktop'}.json`), JSON.stringify({ pid: process.pid, layout, mobile, options, readings, cancelledUnchanged: true, fixedFamily: family, ipcReloadUnchanged: true, errors }, null, 2))
  console.log(`${layout}/${mobile ? '手机旋转' : '桌面'}：制造/退料/交付、筛选、现有下拉、取消零消耗、固定${family}族点火及重载通过`)
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(e => { console.error(e); require('electron').app.exit(1) })
else parent().catch(e => { console.error(e); process.exitCode = 1 })
