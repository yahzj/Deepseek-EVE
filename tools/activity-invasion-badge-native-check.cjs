/** 活动栏入侵标签原生显示核对，先build，再node tools/activity-invasion-badge-native-check.cjs。
 * 新旧×中英×冷却/交火/返航，桌面与模拟手机几何及截图；合成状态只用于界面，不作战斗结果证明。
 * 隐藏自建Electron、真实IPC、隔离目录/随机端口，不读写个人档，不代替船长观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, JourneyPage, staticServer, stopOwned, removeProfile, createFixture, settingsScript, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/activity-invasion-badge-20261008')

function fixture(stage) {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const input = createFixture(), state = core.loadSaveFile(input.initialSave).state, now = Date.now()
  state.weekendEvent = { seq: 901, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: {} }
  state.debugQuick = false
  state.exploredGalaxies = [...input.ctx.galaxies.keys()]
  if (stage === 'cooldown') {
    assert(core.setAutoLoopInvasion(state, input.ctx, 'galaxy-redring', now).ok)
    const plan = core.autoLoopInvasionPlanOf(state, input.ctx, now)
    assert.equal(plan.status, 'ready')
    state.bountyCooldowns[plan.dispatch.cardId] = state.gameMs + core.bountyCooldownMsFor(state, input.ctx) / 2
  } else {
    assert(core.startExpedition(state, 'alien-vanguard', input.ctx, { foeGalaxyId: 'galaxy-redring' }).ok)
    if (stage === 'back') {
      state.expedition.battle = null
      state.expedition.phase = 'back'
      state.expedition.returnReason = 'victory'
      state.expedition.returnAtGameMs = state.gameMs
      state.expedition.finishAtGameMs = state.gameMs + 120_000
    }
  }
  return { save: core.serializeSaveFile(state, now), announcement: input.announcement }
}

async function parent() {
  await fs.mkdir(OUT, { recursive: true })
  const prefix = 'whale-activity-badge-', reports = []
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const stage of ['cooldown', 'battle', 'back']) {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix)), input = fixture(stage)
    let child, server, timer
    try {
      const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), { initialize: settingsScript(input.announcement, undefined, { layout, locale, debug: true, test: true }) })
      server = served.server
      await fs.writeFile(path.join(profile, 'save.json'), input.save, 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: served.url, BADGE_CASE: JSON.stringify({ layout, locale, stage }) }
      delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
      console.log(`入侵标签 ${layout}/${locale}/${stage} 自建PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 90_000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
      reports.push(JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8')))
    } finally {
      clearTimeout(timer); await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, prefix)
    }
  }
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(reports, null, 2), 'utf8')
  console.log(`${reports.length}组、${reports.reduce((sum, row) => sum + row.rows.length, 0)}视口标签几何通过`)
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], options = JSON.parse(process.env.BADGE_CASE), errors = [], rows = []
  win.setMinimumSize(200, 200); win.setContentSize(1366, 768)
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  const dismiss = async () => {
    await sleep(650)
    for (let n = 0; n < 20 && await page.js('!!document.querySelector(".app-comms-eave-extra button")'); n++) await page.tap('.app-comms-eave-extra button')
    if (await page.js('!!document.querySelector(".app-battle-float")')) await page.tap('.app-battle-float')
    if (await page.js('!!document.querySelector(".app-battle-screen")')) {
      require('tsx/cjs')
      const label = require('../packages/data/src/index.ts').L10N['ui.BattleScreen.037'][options.locale]
      await page.text('.app-battle-screen', label)
    }
  }
  await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-activitybar-badge")')
  await dismiss()
  for (const mobile of [false, true]) {
    if (mobile) {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844,
        screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await page.reload(); await dismiss()
    }
    await sleep(500)
    const reading = await page.js(`(()=>{const badge=document.querySelector('.app-activitybar-badge'),row=badge.closest('.app-activitybar-item');const rect=e=>e.getBoundingClientRect().toJSON();return {mobile:document.querySelector('.app-root').classList.contains('is-mobile-rot'),text:row.textContent,badges:row.querySelectorAll('.app-activitybar-badge').length,badgeText:badge.textContent,badge:rect(badge),row:rect(row),scroll:row.scrollWidth,client:row.clientWidth,badgeClientHeight:badge.clientHeight,lineHeight:getComputedStyle(badge).lineHeight,sub:row.querySelector('.app-activitybar-sub').textContent}})()`)
    await fs.writeFile(path.join(OUT, `reading-${options.layout}-${options.locale}-${options.stage}-${mobile ? 'mobile' : 'desktop'}.json`), JSON.stringify(reading, null, 2), 'utf8')
    assert.equal(reading.badges, 1)
    assert.equal(reading.badgeText, options.locale === 'zh' ? '入侵' : 'Invasion')
    assert(reading.badge.width > 0 && reading.badge.height > 0)
    assert(reading.scroll <= reading.client + 1, '活动行横向溢出')
    assert(reading.badge.left >= reading.row.left - 1 && reading.badge.right <= reading.row.right + 1, '标签超出活动行')
    assert(reading.badgeClientHeight <= parseFloat(reading.lineHeight) + 10, '标签发生换行')
    assert(!/\{p\d+\}|ui\.invasionActivity/.test(reading.text))
    if (options.locale === 'en') assert(!/[\u4e00-\u9fff]/.test(reading.text), '英文入侵活动行残留中文')
    rows.push({ ...reading, simulatedMobile: mobile })
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    await fs.writeFile(path.join(OUT, `${options.layout}-${options.locale}-${options.stage}-${mobile ? 'mobile' : 'desktop'}.png`), image.toPNG())
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ ...options, rows, errors: errors.length }, null, 2), 'utf8')
  win.destroy(); app.quit()
}

(process.argv.includes('--child') ? child() : parent()).catch(error => {
  console.error(error)
  if (process.argv.includes('--child')) require('electron').app.exit(1)
  else process.exitCode = 1
})
