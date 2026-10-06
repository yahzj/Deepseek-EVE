/** 重复插件/沉船卡牌真实UI。先npm run build，再node tools/wreck-fit-desktop-check.cjs。
 * 从新档生成门槛，隐藏Electron/临时userData；实际鼠标/触控、富卡、保存确认及IPC重载。
 * 不访问个人档；只清理自建PID退出后的校验目录。截图读数不是物理真机观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../packages/core/src/index.ts')
const data = require('../packages/data/src/index.ts')
const { injectWreckFitTestState } = require('./wreck-fit-test-fixture.ts')
const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'tools/_ui-artifacts/wreck-fit')
const PREFIX = 'whale-wreck-fit-'
function fixture(now) {
  const state = core.createInitialState({ nowWallMs: now, seed: 7 })
  injectWreckFitTestState(state)
  return state
}
function parent() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  const built = fs.statSync(path.join(ROOT, 'apps/desktop/out/renderer/index.html')).mtimeMs
  for (const source of ['packages/core/src/fitPresets.ts', 'packages/core/src/save.ts', 'packages/core/src/plugs.ts',
    'apps/desktop/src/renderer/src/panels/WreckFitPanel.tsx', 'apps/desktop/src/renderer/src/pages/FitPage.tsx']) {
    assert(fs.statSync(path.join(ROOT, source)).mtimeMs <= built, `构建陈旧:${source}`)
  }
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
  if (selected) assert(/^(classic|modern)-(zh|en)-(desktop|portrait)$/.test(selected))
  const reports = []
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mode of ['desktop', 'portrait']) {
    if (selected && selected !== `${layout}-${locale}-${mode}`) continue
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const state = fixture(Date.now())
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, WRECK_FIT_CASE: JSON.stringify({ layout, locale, mode }) }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      delete env.WHALE_AUTOPERF
      const child = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true, env, encoding: 'utf8', timeout: 70000 })
      console.log(child.stdout)
      if (child.error) throw child.error
      assert.equal(child.status, 0, child.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      const preset = saved.fitPresets['sh-hammerhead'][0]
      assert.equal(preset.name, 'Repeat')
      assert.deepEqual(preset.fitted.high, state.wreckLog[0].fitted.high)
      assert.deepEqual(preset.plugs, ['plug-cpu-core', 'plug-cpu-core'])
      assert.deepEqual(preset.droneLoad, { 'drone-scout': 2 })
      assert.deepEqual(saved.wreckLog, state.wreckLog)
      assert.equal(saved.moduleBay['plug-cpu-core'], 2)
      assert.deepEqual(saved.fleet[state.shipId].plugs, ['plug-cpu-core', 'plug-cpu-core'])
      reports.push({ layout, locale, mode, details: true, overwriteConfirmed: true, referencePlugs: true, repeatInstalled: true, IPCSaved: true, reloadRetained: true })
    } finally {
      const resolved = path.resolve(profile)
      assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(PREFIX))
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
  fs.writeFileSync(path.join(OUTPUT, selected ? `readings-${selected}.json` : 'readings.json'), JSON.stringify({ ok: true, reports }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, cases: reports.length, out: OUTPUT }))
}
async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win)
  win.setContentSize(1366, 768)
  const options = JSON.parse(process.env.WRECK_FIT_CASE), mobile = options.mode === 'portrait'
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params), { touch: mobile })
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.wait('!!document.querySelector(".app-root")')
  await page.js(`(()=>{localStorage.setItem('whale-idle:layout',${JSON.stringify(options.layout)});localStorage.setItem('whale-idle:layout-set','1');localStorage.setItem('whale-idle:locale',${JSON.stringify(options.locale)});localStorage.setItem('whale-idle:announce-seen',${JSON.stringify(data.ANNOUNCEMENTS[0].id)});localStorage.setItem('whale-idle:debug','0')})()`)
  if (mobile) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } })
    await page.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")'); await sleep(400)
  const t = id => data.L10N[id][options.locale]
  const saved = () => core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
  await page.text('.app-nav-side', t('ui.App.009'))
  if (options.layout === 'modern' && !mobile && await page.js('document.querySelector(".app-log-side").getBoundingClientRect().width > 1')) {
    await page.tap('.app-log-head-right button'); await page.wait('document.querySelector(".app-log-side").getBoundingClientRect().width < 1')
  }
  await page.text('.app-comms-body .app-tasktabs', t('ui.WreckLog.001'))
  await page.wait('!!document.querySelector("[data-wreck-fit-save]")')
  assert.equal(await page.js('document.querySelectorAll("[data-wreck-fit-id=plug-cpu-core]").length'), 2)
  if (!mobile) {
    const rect = await page.js(`(()=>{const e=document.querySelector('[data-wreck-fit-id=mod-turret-kin-1]');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...rect })
    await page.wait('!!document.querySelector(".app-tip .app-info-table")')
  }
  for (const id of ['mod-turret-kin-1', 'plug-cpu-core', 'drone-scout']) {
    await page.tap(`[data-wreck-fit-id=${id}]`)
    await page.wait('!!document.querySelector(".app-wreck-fit-modal .app-info-table")')
    assert(String(await page.js('document.querySelector(".app-wreck-fit-modal").textContent')).includes(data.buildSimContext(options.locale).modules.get(id)?.name ?? data.buildSimContext(options.locale).items.get(id).name))
    await page.tap('.app-wreck-fit-modal .app-modal-head button')
  }
  await page.tap('[data-wreck-fit-save]')
  await page.tap('[data-wreck-fit-name]')
  await page.send('Input.insertText', { text: 'Repeat' })
  await page.tap('[data-wreck-fit-confirm]')
  await page.wait('!!document.querySelector(".app-wreck-fit-modal [role=alert]")')
  assert.deepEqual(saved().fitPresets['sh-hammerhead'][0].fitted.high, ['mod-turret-kin-2'])
  await page.text('.app-wreck-fit-modal', t('ui.blackMarket.011'))
  await page.tap('[data-wreck-fit-save]')
  await page.tap('[data-wreck-fit-confirm]')
  await page.wait('!!document.querySelector(".app-wreck-fit-modal [role=alert]")')
  await page.tap('[data-wreck-fit-confirm]')
  await page.wait('!document.querySelector(".app-wreck-fit-modal")')
  for (let i = 0; i < 50 && !saved().fitPresets['sh-hammerhead'][0].plugs; i++) await sleep(100)
  assert.equal(saved().fitPresets['sh-hammerhead'][0].plugs.length, 2)
  const geometry = await page.js(`(()=>{const rows=[...document.querySelectorAll('.app-wreck-fit-card')];return {cards:rows.length,overflow:rows.filter(e=>e.scrollWidth>e.clientWidth).length,rotated:document.querySelector('.app-root').classList.contains('is-mobile-rot')}})()`)
  assert.equal(geometry.overflow, 0)
  if (mobile) assert(geometry.rotated)
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUTPUT, `${options.layout}-${options.locale}-${options.mode}.png`), Buffer.from(shot.data, 'base64'))
  await page.text('.app-nav-side', t('ui.App.003'))
  await page.tap('.app-fit-plugslots .app-fit-slot-icon.is-empty')
  await page.wait('!!document.querySelector(".app-mkt-confirm")')
  const plugName = data.buildSimContext(options.locale).modules.get('plug-cpu-core').name
  await page.js(`(()=>{const row=[...document.querySelectorAll('.app-mkt-confirm .app-fit-preset-row')].find(e=>e.textContent.includes(${JSON.stringify(plugName)}));if(!row)throw Error('重复插件被过滤');row.setAttribute('data-wreck-fit-install','1')})()`)
  await page.text('[data-wreck-fit-install]', t('ui.FitPage.181'))
  await page.text('[data-wreck-fit-install]', t('ui.FitPage.181'))
  await page.wait('!document.querySelector(".app-mkt-confirm")')
  await page.js('window.dispatchEvent(new Event("pagehide"));true')
  for (let i = 0; i < 50 && saved().fleet[saved().shipId].plugs.length !== 2; i++) await sleep(100)
  assert.equal(saved().fleet[saved().shipId].plugs.length, 2)
  await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
  await page.text('.app-nav-side', t('ui.App.009')); await page.text('.app-comms-body .app-tasktabs', t('ui.WreckLog.001'))
  await page.wait('!!document.querySelector("[data-wreck-fit-save]")')
  assert.equal(saved().fitPresets['sh-hammerhead'][0].plugs.length, 2)
  assert.equal(errors.length, 0, JSON.stringify(errors))
  console.log(JSON.stringify({ ok: true, electronPid: process.pid, ...options, ...geometry }))
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else { try { parent() } catch (error) { console.error(error); process.exitCode = 1 } }
