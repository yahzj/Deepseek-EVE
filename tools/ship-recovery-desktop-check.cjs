/** 整船回收/战损真实UI：先npm run build，再node tools/ship-recovery-desktop-check.cjs。
 * 使用合成档、隐藏Electron、自建userData，实际鼠标/触控；不访问个人档。
 * --case=classic-zh-desktop可单跑。截图用于几何读数，不是观感验收。
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
const { injectShipRecoveryTestState } = require('./ship-recovery-test-fixture.ts')
const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'tools/_ui-artifacts/ship-recovery')
const PREFIX = 'whale-ship-recovery-'
function parent() {
  fs.mkdirSync(OUTPUT, { recursive: true })
  const built = fs.statSync(path.join(ROOT, 'apps/desktop/out/renderer/index.html')).mtimeMs
  for (const rel of ['packages/core/src/shipWrecks.ts', 'packages/core/src/save.ts', 'packages/core/src/salvaging.ts',
    'apps/desktop/src/renderer/src/ui/ShipDamageMods.tsx', 'apps/desktop/src/renderer/src/pages/MapPage.tsx']) assert(fs.statSync(path.join(ROOT, rel)).mtimeMs <= built, `构建陈旧:${rel}`)
  const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
  if (selected) assert(/^(classic|modern)-(zh|en)-(desktop|portrait)$/.test(selected))
  const reports = []
  for (const layout of ['classic', 'modern']) for (const locale of ['zh', 'en']) for (const mode of ['desktop', 'portrait']) {
    if (selected && selected !== `${layout}-${locale}-${mode}`) continue
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX))
    try {
      const state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
      injectShipRecoveryTestState(state)
      fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state), 'utf8')
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, SHIP_RECOVERY_CASE: JSON.stringify({ layout, locale, mode }) }
      delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL; delete env.WHALE_AUTOPERF
      const child = spawnSync(require('electron'), [__filename, '--child'], { cwd: ROOT, windowsHide: true, env, encoding: 'utf8', timeout: 90000 })
      console.log(child.stdout)
      if (child.error) throw child.error
      assert.equal(child.status, 0, child.stderr)
      const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
      const restored = Object.values(saved.fleet).find(s => s.customName === '回收目标')
      assert(restored); assert.equal(restored.durability, 1); assert.equal(restored.armorPct, 1)
      assert.deepEqual(restored.plugs, ['plug-cpu-core', 'plug-cpu-core'])
      assert(restored.damagePlugs.includes('speed')); assert.equal(saved.shipId, state.shipId)
      assert.equal(Object.keys(saved.shipWrecks ?? {}).length, 0)
      reports.push({ layout, locale, mode, wholeShip: true, repairedButDamaged: true, detailsThreeViews: true, skills: true, reload: true })
    } finally {
      const resolved = path.resolve(profile)
      assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith(PREFIX))
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
  fs.writeFileSync(path.join(OUTPUT, selected ? `readings-${selected}.json` : 'readings.json'), JSON.stringify({ ok: true, reports }, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: true, cases: reports.length, output: OUTPUT }))
}
async function child() {
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(PREFIX))
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(1366, 768)
  const options = JSON.parse(process.env.SHIP_RECOVERY_CASE), mobile = options.mode === 'portrait'
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
  if (options.layout === 'modern' && !mobile && await page.js('document.querySelector(".app-log-side").getBoundingClientRect().width > 1')) {
    await page.tap('.app-log-head-right button')
    await page.wait('document.querySelector(".app-log-side").getBoundingClientRect().width < 1')
  }
  const identify = async (scope, text, attribute) => page.js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.textContent.includes(${JSON.stringify(text)}));if(!e)throw Error('控件缺失');e.setAttribute(${JSON.stringify(attribute)},'1');return true})()`)
  const detail = async scope => {
    await page.tap(`${scope} [data-damage-kind]`)
    await page.wait(`!!document.querySelector(${JSON.stringify(`${scope} details[open] .app-info-note`)})`)
    const text = String(await page.js(`document.querySelector(${JSON.stringify(`${scope} details[open]`)}).textContent`))
    assert(text.includes('15%')); assert(text.includes(t('ui.shipDamage.014')))
  }
  await page.text('.app-nav-side', t('ui.App.001'))
  await page.text('.app-subtabs', t('ui.MapPage.005'))
  await page.wait('!!document.querySelector(".is-shipwreck")')
  assert(String(await page.js('document.querySelector(".is-shipwreck").textContent')).includes('70%'))
  await page.text('[data-card-id=galaxy-hub]', t('ui.MapPage.071'))
  await page.wait('!document.querySelector(".is-shipwreck")')
  await page.js('window.dispatchEvent(new Event("pagehide"));true')
  for (let i = 0; i < 160 && !Object.values(saved().fleet).some(s => s.customName === '回收目标'); i++) await sleep(200)
  assert(Object.values(saved().fleet).some(s => s.customName === '回收目标'))
  await page.text('.app-nav-side', t('ui.App.002'))
  await identify('.app-ship-card.is-fleet', '回收目标', 'data-recovered-card')
  await detail('[data-recovered-card]')
  await identify('[data-recovered-card] button', t('ui.ShipPage.024'), 'data-repair-recovered')
  await page.tap('[data-repair-recovered]')
  await page.wait('!document.querySelector("[data-recovered-card] .app-dur-text.is-bad")')
  await page.text('[data-recovered-card]', t('ui.App.003'))
  await page.wait('!!document.querySelector(".app-ship-damage")')
  await detail('.app-ship-damage')
  await page.text('.app-nav-side', t('ui.App.009'))
  await page.text('.app-comms-body .app-tasktabs', t('ui.WreckLog.001'))
  await page.wait('!!document.querySelector(".app-wreck-fit [data-ship-damage]")')
  await detail('.app-wreck-fit')
  await page.text('.app-nav-side', t('ui.App.007'))
  await page.text('.app-tasktabs', t('ui.labelsText.022'))
  await page.text('.app-skilltree-books', t('ui.shipRecovery.001'))
  assert(String(await page.js('document.body.textContent')).includes(data.buildSimContext(options.locale).skills.get('wreck-equipment-preservation').name))
  await page.js('window.dispatchEvent(new Event("pagehide"));true'); await sleep(300)
  await page.send('Page.reload'); await page.wait('!!document.querySelector(".app-root")')
  await page.text('.app-nav-side', t('ui.App.002'))
  await identify('.app-ship-card.is-fleet', '回收目标', 'data-recovered-card')
  await detail('[data-recovered-card]')
  const overflow = await page.js(`(()=>{const box=document.querySelector('[data-recovered-card]');return [...box.querySelectorAll('.app-ship-damage-detail,.app-info-note')].filter(e=>e.scrollWidth>e.clientWidth+1).length})()`)
  assert.equal(overflow, 0); assert.equal(errors.length, 0, JSON.stringify(errors))
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUTPUT, `${options.layout}-${options.locale}-${options.mode}.png`), Buffer.from(shot.data, 'base64'))
  console.log(JSON.stringify({ ok: true, electronPid: process.pid, ...options, overflow }))
  app.exit(0)
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else { try { parent() } catch (error) { console.error(error); process.exitCode = 1 } }
