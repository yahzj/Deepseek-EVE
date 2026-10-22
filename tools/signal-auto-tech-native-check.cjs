/** 信号空间自动探索科技原生检查，游戏v0.1.0 / 档v31 / 2026-10-22。
 * 先npm run build，再node tools/signal-auto-tech-native-check.cjs [--electron=绝对路径]。
 * 隐藏Electron、隔离合成档及临时userData；两布局×0～3级，提示/收益/派队/IPC重载。
 * 输出tools/_ui-artifacts/signal-auto-tech/，不读个人档，不作为实体手机或观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts'), data = require('../packages/data/src/index.ts')
const root = path.resolve(__dirname, '..'), prefix = 'whale-signal-auto-tech-'
const output = path.join(root, 'tools/_ui-artifacts/signal-auto-tech')
const tech = 'mt-explore-signal-auto-t3'
if (!process.argv.includes('--child')) {
  fs.mkdirSync(output, { recursive: true })
  const reports = []
  for (const layout of ['classic', 'modern']) for (const level of [0, 1, 2, 3]) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    try {
      const ctx = data.buildSimContext()
      const state = core.createInitialState({ nowWallMs: Date.now(), seed: 19 })
      state.modeChosen = true
      state.onboarding.step = 99
      for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true, rewarded: true }
      state.standings.dsi = 100
      state.standingsEarned = { dsi: 100 }
      for (const card of ctx.anomalies.values()) {
        if (card.hidden || card.standingGain <= 0) continue
        state.completedBounties.push(card.id)
      }
      state.exploredGalaxies = [...ctx.galaxies.keys()]
      state.research.levels[tech] = level
      state.research.levels['mt-explore-signal-radius-t1'] = 1
      state.wormholeStock = [{ id: 'signal-tech', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0 }]
      state.warehouse.items['mat-wh-essence'] = 100
      state.wallet.isk = 100000000
      for (let i = 0; i < 4; i++) core.addShipToFleet(state, 'sh-thresher')
      const beforeCores = structuredClone(state.aiCores)
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now() + 120000), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, SIGNAL_TECH_LEVEL: String(level), SIGNAL_TECH_LAYOUT: layout }
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
      const electron = process.argv.find(a => a.startsWith('--electron='))?.slice(11) ?? require('electron')
      const run = spawnSync(electron, [__filename, '--child'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 60000 })
      console.log(run.stdout)
      if (run.error) throw run.error
      assert.equal(run.status, 0, run.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      assert.deepEqual(saved.aiCores, beforeCores)
      assert.equal(core.aiCoreUsed(saved), 0)
      if (level === 0) {
        assert.equal(saved.wormholeStock.length, 1)
        assert.equal(saved.wormholeAuto?.length ?? 0, 0)
        assert.equal(saved.research.levels[tech], 3)
        assert.equal(saved.warehouse.items['mat-wh-essence'], 40)
        assert.equal(saved.wallet.isk, 40000000)
      } else {
        assert.equal(saved.wormholeStock.length, 0)
        assert.equal(saved.wormholeAuto.length, 1)
        assert.equal(saved.wormholeAuto[0].yieldMul, [.6, .7, .8][level - 1])
      }
      reports.push({ layout, level, saved: true, aiUsed: 0 })
    } finally {
      const target = path.resolve(profile)
      assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(prefix))
      fs.rmSync(target, { recursive: true, force: true })
    }
  }
  fs.writeFileSync(path.join(output, 'readings.json'), JSON.stringify({ ok: true, reports }, null, 2), 'utf8')
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0], layout = process.env.SIGNAL_TECH_LAYOUT
    const level = Number(process.env.SIGNAL_TECH_LEVEL), mobile = layout === 'modern'
    win.setContentSize(1366, 768)
    win.webContents.setBackgroundThrottling(false)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
    const errors = []
    win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
    await page.send('Runtime.enable'); await page.send('Page.enable')
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('whale-idle:locale','zh');localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)})` })
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, screenWidth: 390, screenHeight: 740, screenOrientation: { type: 'portraitPrimary', angle: 0 }, deviceScaleFactor: 1, mobile: true })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    }
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    await sleep(400)
    await dismissOverlays(page)
    await page.text('.app-nav-side', data.L10N['ui.App.001'].zh)
    await page.text('.app-subtabs', data.L10N[core.signalSpaceTextId('ui.MapPage.007')].zh)
    await page.wait('!!document.querySelector(".app-wh-scanbar")')
    const button = `(()=>[...document.querySelectorAll('.app-page-content button')].find(b=>b.textContent.trim()===${JSON.stringify(data.L10N['ui.Wormhole.002'].zh)}))()`
    await page.js(`(()=>{const b=${button};if(!b)throw Error('未找到自动探索按钮');b.setAttribute('data-signal-tech-auto','1')})()`)
    assert.equal(await page.js('document.querySelector("[data-signal-tech-auto]").getAttribute("aria-disabled")'), level === 0 ? 'true' : null)
    if (level === 0) {
      const opacity = await page.js('getComputedStyle(document.querySelector("[data-signal-tech-auto]")).opacity')
      assert(Number(opacity) < 1)
      // 此处专测aria-disabled仍可提示，不能让通用驱动提前拒绝真实点击。
      const point = await page.js(`(()=>{const el=document.querySelector('[data-signal-tech-auto]');el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,disabled:el.disabled,visible:document.elementFromPoint(x,y)===el}})()`)
      assert.equal(point.disabled, false)
      assert.equal(point.visible, true)
      if (mobile) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] })
        await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } else {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
      }
      await page.wait(`document.body.innerText.includes(${JSON.stringify(data.L10N['core.signalAuto.001'].zh)})`)
      assert.equal(await page.js('!!document.querySelector(".app-wh-modal")'), false)
      await page.js('document.querySelector("[data-signal-tech-auto]").focus();true')
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
      assert.equal(await page.js('!!document.querySelector(".app-wh-modal")'), false)
      await page.text('.app-page-content .app-subtabs', data.L10N['ui.WormholeScan.004'].zh)
      await page.js(`(()=>{const tier=[...document.querySelectorAll('.app-mt-tier')].find(t=>t.querySelector('.app-mt-tier-tag')?.textContent==='T3'&&[...t.querySelectorAll('button')].some(b=>b.textContent.includes('信号空间探索')));if(!tier)throw Error('T3科技不可见');[...tier.querySelectorAll('button')].find(b=>b.textContent.includes('信号空间探索')).setAttribute('data-signal-tech-node','1')})()`)
      await page.tap('[data-signal-tech-node]')
      await page.wait('!!document.querySelector(".app-mt-modal")')
      for (const rank of [1, 2, 3]) {
        await page.tap('.app-mt-modal-actions button')
        await page.wait(`document.querySelector('.app-mt-modal .app-report-title')?.textContent.includes(${JSON.stringify(`${rank}/3`)})`)
      }
      await page.tap('.app-mt-modal .app-modal-head button')
      await page.text('.app-page-content .app-subtabs', data.L10N[core.signalSpaceTextId('ui.MatterTechTab.001')].zh)
      assert.equal(await page.js(`(${button}).getAttribute('aria-disabled')`), null)
    } else {
      await page.tap('[data-signal-tech-auto]')
      await page.wait('!!document.querySelector(".app-wh-modal .app-wh-triad")')
      const triad = await page.js('document.querySelector(".app-wh-modal .app-wh-triad").innerText')
      assert(triad.includes([60, 70, 80][level - 1] + '%'), triad)
      const bounds = await page.js(`(()=>{const r=document.querySelector('.app-wh-modal').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`)
      assert(bounds.left >= -2 && bounds.top >= -2 && bounds.right <= bounds.width + 2 && bounds.bottom <= bounds.height + 2, JSON.stringify(bounds))
      const text = await page.js('document.querySelector(".app-wh-modal").innerText')
      assert(!/AI\s*核心|逐格走|不保底|8 折/.test(text), text)
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(output, `${layout}-${level}-preparation.png`), Buffer.from(screenshot.data, 'base64'))
      await page.text('.app-wh-modal', data.L10N['ui.Wormhole.134'].zh)
      await page.wait('!document.querySelector(".app-wh-modal")')
    }
    const screenshot = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, `${layout}-${level}.png`), Buffer.from(screenshot.data, 'base64'))
    await page.js('window.dispatchEvent(new Event("pagehide"));true'); await sleep(500)
    await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ layout, level, mobile, IPCReload: true, runtimeErrors: 0, pid: process.pid }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
