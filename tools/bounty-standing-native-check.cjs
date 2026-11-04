/** 每日赏金收益行：构建后node tools/bounty-standing-native-check.cjs。
 * 隐藏独立Electron、合成任务与真实产物，双布局桌面/模拟手机检查声望读数及横向溢出。
 * WHALE_ELECTRON_EXE可指定本机已有运行时；不读个人档，截图不替代观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, JourneyPage, staticServer, settingsScript, sleep, stopOwned, removeProfile } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/bounty-standing-20261030')

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const { buildSimContext } = require('../packages/data/src/context.ts')
  const { ANNOUNCEMENTS } = require('../packages/data/src/announcements.ts')
  const ctx = buildSimContext()
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 30 })
  state.modeChosen = true
  state.onboarding.step = 99
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true, delivered: 0 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  core.noteStandingEarned(state, 'dsi', 100)
  core.advanceSideTasks(state, ctx, Date.now())
  const card = [...ctx.anomalies.values()].find(a => core.isLairCandidate(a) && core.lairLevelOf(a) === 3)
  assert(card)
  state.sideTasks.bounty = [1, 2, 3].map(tier => ({ id: 900 + tier, kind: 'bounty', goodKey: '', refId: '', need: 0,
    rewardIsk: 100000, anomalyId: card.id, galaxyId: card.galaxyId, lairTier: tier, lairName: core.lairNameOf(card, tier) }))
  const reports = []
  await fs.mkdir(OUT, { recursive: true })
  for (const layout of ['classic', 'modern']) {
    const prefix = 'whale-bounty-standing-'
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    let child, server, timer
    try {
      const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), {
        initialize: settingsScript(ANNOUNCEMENTS[0]?.id, undefined, { layout, debug: false, test: false }),
      })
      server = served.server
      await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: served.url, BOUNTY_LAYOUT: layout }
      delete env.ELECTRON_RUN_AS_NODE
      child = spawn(process.env.WHALE_ELECTRON_EXE || require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
      console.log(`每日赏金${layout} 自建PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 60000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
      reports.push(JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8')))
    } finally {
      clearTimeout(timer)
      await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, prefix)
    }
  }
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(reports, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, layouts: 2, viewports: 4, rewards: [0, 1, 2], output: OUT }))
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0], rows = [], errors = []
  win.setMinimumSize(200, 200)
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable')
  const open = async () => {
    await page.wait('!!document.querySelector(".app-root")')
    await sleep(500)
    for (let n = 0; n < 25 && await page.js('!!document.querySelector(".app-comms-eave-extra button")'); n++) await page.tap('.app-comms-eave-extra button')
    await page.js(`(()=>{const button=[...document.querySelectorAll('.app-nav-item')].find(e=>e.querySelector(':scope > span:last-child')?.textContent.trim()==='任务中心');if(!button)throw Error('任务中心导航缺失');button.setAttribute('data-bounty-nav','task')})()`)
    await page.tap('[data-bounty-nav="task"]')
    await page.text('.app-task-tabs', '赏金任务')
    await page.wait('document.querySelectorAll(".app-sidetasks .app-station-card:not(.is-faction) .app-ano-reward").length===3')
  }
  for (const mobile of [false, true]) {
    if (mobile) {
      await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36' })
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
      await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844,
        deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
      page.touch = true
      await page.send('Page.reload', { ignoreCache: true })
    } else win.setContentSize(1366, 768)
    await open()
    if (mobile) await page.wait('document.querySelector(".app-root").classList.contains("is-mobile-rot")')
    const reading = await page.js(`Array.from(document.querySelectorAll('.app-sidetasks .app-station-card:not(.is-faction) .app-ano-reward'),e=>({text:e.textContent,scroll:e.scrollWidth,client:e.clientWidth,box:e.getBoundingClientRect().toJSON(),whiteSpace:getComputedStyle(e).whiteSpace,root:document.querySelector('.app-root').className}))`)
    await fs.writeFile(path.join(OUT, `${process.env.BOUNTY_LAYOUT}-${mobile ? 'mobile' : 'desktop'}.json`), JSON.stringify(reading, null, 2), 'utf8')
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    await fs.writeFile(path.join(OUT, `${process.env.BOUNTY_LAYOUT}-${mobile ? 'mobile' : 'desktop'}.png`), image.toPNG())
    assert.deepEqual(reading.map(row => Number(/声望\s*\+(\d+)/.exec(row.text)?.[1])).sort(), [0, 1, 2])
    assert(reading.every(row => row.client > 0 && row.scroll <= row.client + 1), '收益行横向溢出')
    assert(!image.isEmpty())
    rows.push({ mobile, reading })
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ pid: process.pid, rows, errors: 0 }), 'utf8')
  win.destroy()
  app.quit()
}
(process.argv.includes('--child') ? child() : parent()).catch(error => {
  console.error(error)
  if (process.argv.includes('--child')) require('electron').app.exit(1)
  else process.exitCode = 1
})
