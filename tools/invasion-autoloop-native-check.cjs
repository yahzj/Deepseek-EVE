/** 入侵循环冷却行的原生接线验收；先build，再node tools/invasion-autoloop-native-check.cjs。
 * 隐藏Electron、隔离合成档、随机端口，覆盖新旧界面和中英文的冷却条、跳转、停止及真实保存。
 * 不读个人档，不截屏，不代替观感验收；只清理由本工具创建的临时目录和PID。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, JourneyPage, staticServer, stopOwned, removeProfile, createFixture, settingsScript } = require('./wormhole-expedition-journey-shared.cjs')

function fixture() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const input = createFixture(), state = core.loadSaveFile(input.initialSave).state
  const now = Date.now()
  state.debugQuick = false
  state.weekendEvent = { seq: 901, family: 'C', startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: {}, autoLoopGalaxyId: 'galaxy-redring' }
  const plan = core.autoLoopInvasionPlanOf(state, input.ctx, now)
  assert.equal(plan.status, 'ready')
  state.bountyCooldowns[plan.dispatch.cardId] = state.gameMs + core.bountyCooldownMsFor(state, input.ctx) + 300_000
  return { save: core.serializeSaveFile(state, now), announcement: input.announcement }
}

async function parent() {
  const prefix = 'whale-invasion-autoloop-', reports = []
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
    const input = fixture()
    let child, server, timer
    try {
      const served = await staticServer(path.join(ROOT, 'apps/desktop/out/renderer'), { initialize: settingsScript(input.announcement, undefined, { debug: true, test: true, layout, locale }) })
      server = served.server
      await fs.writeFile(path.join(profile, 'save.json'), input.save, 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: served.url }
      delete env.ELECTRON_RUN_AS_NODE; delete env.WHALE_AUTOPERF
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: 'inherit' })
      console.log(`入侵循环原生检查 ${layout}/${locale}，自建PID=${child.pid}`)
      timer = setTimeout(() => child.kill(), 90_000)
      const [code] = await once(child, 'exit')
      assert.equal(code, 0)
      const saved = JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8'))
      require('tsx/cjs')
      const restored = require('../packages/core/src/save.ts').loadSaveFile(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state
      assert.equal(restored.weekendEvent.autoLoopGalaxyId, undefined)
      reports.push({ layout, locale, ...saved })
    } finally {
      clearTimeout(timer); await stopOwned(child)
      if (server) await new Promise(resolve => server.close(resolve))
      await removeProfile(profile, prefix)
    }
  }
  const out = path.join(ROOT, 'tools/_ui-artifacts/invasion-autoloop-20261008')
  await fs.mkdir(out, { recursive: true })
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(reports, null, 2), 'utf8')
  console.log('四组原生冷却条、停止、跳转及真实IPC保存通过')
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768); win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.wait('!!window.__whExpeditionTest && !!document.querySelector(".app-activitybar-item.is-invasion-loop")')
  const readings = await page.js(`(()=>{const e=document.querySelector('.app-activitybar-item.is-invasion-loop');const fill=e.querySelector('.app-activitybar-fill');return {text:e.textContent,progress:fill?.style.width,remaining:e.querySelector('.app-activitybar-time')?.textContent}})()`)
  assert(readings.progress && readings.remaining, '未渲染冷却条和剩余时间')
  assert(!/\{p\d+\}|ui\.invasionLoop/.test(readings.text), '有漏出的文案id或参数')
  await page.js(`document.querySelector('.app-activitybar-item.is-invasion-loop').click()`)
  await page.wait('!!document.querySelector(".app-map-viewbar")')
  await page.js(`document.querySelector('.app-activitybar-item.is-invasion-loop button').click()`)
  await page.wait('!document.querySelector(".app-activitybar-item.is-invasion-loop")')
  const state = await page.snapshot()
  assert.equal(state.weekendEvent.autoLoopGalaxyId, undefined)
  assert.equal(state.expedition.active, false)
  await page.command('persist')
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(process.env.WHALE_PERF_USERDATA, 'report.json'), JSON.stringify({ ...readings, stopped: true, errors: 0 }), 'utf8')
  win.destroy(); app.quit()
}

(process.argv.includes('--child') ? child() : parent()).catch(error => {
  console.error(error)
  if (process.argv.includes('--child')) require('electron').app.exit(1)
  else process.exitCode = 1
})
