/** 虫洞§20整备Electron专项。主代理构建后node tools/wormhole-expedition-desktop-smoke.cjs。
 * --self-test仅工具夹具自检；--check-build仅核对产物；不自行build，不拿旧产物当新结论。
 * --report-tag=signal-final：独立报告/截图/导出档，保留旧失败轮。
 * 合成四鹦鹉螺机群、临时userData与本机HTTP入口；隐藏自建窗口，真实CDP输入/IPC落盘/导出/重载。
 * 输入本批ready合成档；输出tools/_ui-artifacts下JSON/截图/导出档，仅关闭自建PID。
 * 游戏版本v0.1.0 · 存档结构v31 · §20适配2026-10-06（UI待新构建实跑）。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { ROOT, OUTPUT, sleep, settingsScript, JourneyPage, staticServer, stopOwned, removeProfile, uiText, atomicJson, openStockPreparation } = require('./wormhole-expedition-journey-shared.cjs')
const { assertFreshBuild, inputText, manifest, saveNamedTemplate, selectTemplate, selfTest, dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')

async function parent() {
  if (process.argv.includes('--self-test')) { selfTest(); console.log('原生专项工具夹具自检通过；未启动Electron。'); return }
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const data = require('../packages/data/src/index.ts')
  const dist = path.join(ROOT, 'apps/desktop/out/renderer')
  const prefix = 'whale-whexpedition-desktop-'
  const tag = process.argv.find(value => value.startsWith('--report-tag='))?.slice('--report-tag='.length) ?? new Date().toISOString().replace(/[:.]/g, '-')
  assert(/^[\w-]+$/.test(tag), 'report-tag只接受字母数字下划线横线')
  const reportFile = path.join(OUTPUT, `wormhole-expedition-desktop-smoke-${tag}.json`)
  const report = { ok: false, scope: 'synthetic-native-template-smoke-not-visual-acceptance' }
  let profile
  let server
  let child
  let timer
  try {
    report.build = await assertFreshBuild(dist, true)
    if (process.argv.includes('--check-build')) { console.log(JSON.stringify(report.build)); return }
    profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    const hosted = await staticServer(dist, { initialize: settingsScript(data.ANNOUNCEMENTS[0].id) })
    server = hosted.server
    const url = hosted.url
    const state = core.loadSaveFile(fs.readFileSync(path.join(ROOT, 'docs/test-saves/test-save-whexpedition-ready-20261004.json'), 'utf8')).state
    assert(state.wormholeStock.some(stock => stock.expeditionRules === 2), '等待主代理重新生成带tag=2的ready合成档；工具不升级旧坐标')
    delete state.wormholePreparationTemplates
    const ctx = data.buildSimContext()
    const fleet = Array.from({ length: 4 }, () => core.addShipToFleet(state, 'sh-nautilus'))
    state.shipId = fleet[0]
    state.warehouse.items['drone-scout'] = 100
    for (const uid of fleet) assert(core.adjustDroneLoad(state, ctx, 'drone-scout', 8, uid).ok)
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, ELECTRON_RENDERER_URL: url, WH_SMOKE_FLEET: JSON.stringify(fleet), WH_SMOKE_TAG: tag }
    delete env.WHALE_AUTOPERF
    delete env.ELECTRON_RUN_AS_NODE
    child = spawn(require('electron'), [__filename, '--smoke-child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
    report.ownedPid = child.pid
    console.log('自建Electron PID', child.pid)
    timer = setTimeout(() => { report.failure = '自建原生模板专项超时'; console.error(report.failure); child.kill() }, 180000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(saved.warehouse.items['drone-scout'], 36)
    assert.equal(saved.wormhole.run.supplies.items['drone-scout'], 32)
    for (const uid of fleet) assert.deepEqual(saved.fleet[uid].droneLoad, { 'drone-scout': 8 })
    assert.equal(saved.wormholePreparationTemplates.length, 2)
    const exported = core.loadSaveFile(fs.readFileSync(path.join(profile, 'template-export.json'), 'utf8')).state
    assert.deepEqual(exported.wormholePreparationTemplates, saved.wormholePreparationTemplates)
    fs.mkdirSync(OUTPUT, { recursive: true })
    fs.copyFileSync(path.join(profile, 'template-export.json'), path.join(OUTPUT, `wormhole-expedition-desktop-template-export-${tag}.json`))
    Object.assign(report, { ok: true, stock: 36, reserve: 32, deployed: 32, templates: saved.wormholePreparationTemplates, IPCSaved: true, reloadRetained: true, actualExport: true })
    await atomicJson(reportFile, report)
    console.log(JSON.stringify(report))
  } catch (error) {
    report.failure ??= error.message
    throw error
  } finally {
    clearTimeout(timer)
    try {
      await stopOwned(child)
      report.ownedPidExited = !child || !Number.isInteger(child.pid) || child.exitCode !== null || child.signalCode !== null
    } catch (error) { report.ok = false; report.cleanupFailure = error.message; throw error }
    finally {
      if (server) await new Promise(resolve => server.close(resolve))
      if (profile && report.ownedPidExited) await removeProfile(profile, prefix)
      if (!process.argv.includes('--check-build') || report.failure) await atomicJson(reportFile, report)
    }
  }
}

async function child() {
  require('tsx/cjs')
  const data = require('../packages/data/src/index.ts')
  const { app, BrowserWindow, dialog } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith('whale-whexpedition-desktop-'), 'userData必须是本工具自建目录')
  assert.equal(new URL(process.env.ELECTRON_RENDERER_URL).hostname, '127.0.0.1')
  BrowserWindow.prototype.show = function () {}
  // 仅隔离实例的系统文件选择改为自建目录；实际导出仍走游戏IPC写盘。
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(profile, 'template-export.json') })
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win)
  win.setContentSize(1366, 768)
  win.webContents.debugger.attach('1.3')
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  const t = uiText('zh', 'future')
  const saved = () => JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
  const readTemplates = async () => saved().wormholePreparationTemplates ?? []
  const fleet = JSON.parse(process.env.WH_SMOKE_FLEET)
  await page.send('Runtime.enable'); await page.send('Page.enable')
  await page.wait(`!!document.querySelector('.app-root')`)
  await page.js(settingsScript(data.ANNOUNCEMENTS[0].id))
  await page.reload()
  await sleep(500)
  await dismissOverlays(page)
  await page.text('.app-nav-side', t('ui.App.001'))
  await page.wait(`!![...document.querySelectorAll('.app-subtabs button')].find(button=>button.textContent.trim()===${JSON.stringify(t('ui.MapPage.007'))})`)
  await page.text('.app-subtabs', t('ui.MapPage.007'))
  await page.wait('!!document.querySelector("[data-future-wormhole-stock]")')
  await openStockPreparation(page, t)
  for (const uid of fleet.slice(1)) await page.tap(`[data-wh-pick="${uid}"]`)
  await page.text('.app-wh-modal', t('ui.Expedition.308'))
  await page.wait(`!!document.querySelector('.app-wh-manifest')`)
  assert.equal(await page.js(`document.querySelector('[data-wh-template-fill]').disabled`),true)
  const field = '[data-wh-manifest-item="drone-scout"] input[type=number]'
  assert.equal(await page.js(`Number(document.querySelector(${JSON.stringify(field)}).value)`),0,'不得自动生成一套备用')
  const inventory = saved().warehouse.items
  await page.number(field, 32)
  const reserve = await saveNamedTemplate(page, 'Native reserve 32', readTemplates)
  await page.number(field, 0)
  const zero = await saveNamedTemplate(page, 'Native reserve zero', readTemplates)
  await page.number(field, 1)
  const selections = [await selectTemplate(page, reserve.id)]
  assert.equal((await manifest(page))['drone-scout'],1,'选择模板执行了apply')
  await page.tap('[data-wh-template-fill]')
  assert.equal((await manifest(page))['drone-scout'],32)
  selections.push(await selectTemplate(page, zero.id))
  await page.tap('[data-wh-template-fill]')
  assert.equal((await manifest(page))['drone-scout'],0)
  await page.tap('[data-wh-template-manage]')
  const templates = await readTemplates()
  for (const action of ['overwrite','delete']) {
    await page.tap(`[data-wh-template-${action}="${reserve.id}"]`)
    assert.deepEqual(await readTemplates(),templates,`${action}未确认改了IPC档`)
    await page.tap('[data-wh-template-cancel]')
    assert.deepEqual(await readTemplates(),templates,`${action}取消改了IPC档`)
  }
  await page.tap(`[data-wh-template-rename="${reserve.id}"]`)
  await inputText(page,'[data-wh-template-name]','Native reserve renamed')
  await page.tap('[data-wh-template-confirm]')
  await page.wait('!document.querySelector("[data-wh-template-confirm]")')
  assert.equal((await readTemplates()).find(t=>t.id===reserve.id).name,'Native reserve renamed')
  selections.push(await selectTemplate(page,reserve.id))
  await page.tap('[data-wh-template-fill]')
  assert.deepEqual(saved().warehouse.items,inventory,'模板预扣实物')
  assert.equal(saved().warehouse.items['drone-scout'], 68)
  await page.tap('[data-wh-enter-prepared]')
  assert.equal(saved().wormhole.run, null)
  await page.tap('[data-wh-enter-prepared]')
  await page.wait(`!!document.querySelector('.app-wh-supply-summary')`)
  await page.wait(`document.querySelector('.app-wh-extract')?.disabled===false`)
  await page.command('persist')
  assert.equal(saved().wormhole.run.supplies.items['drone-scout'], 32)
  await page.text('.app-wh-modal .app-modal-head',t('ui.Wormhole.015'))
  await page.command('persist')
  await page.text('.app-header',t('ui.App.010'))
  await page.text('.app-settings-modal',t('ui.App.065'))
  await page.text('.app-save-actions',t('ui.SaveManager.016'))
  for (let i=0;i<100&&!fs.existsSync(path.join(profile,'template-export.json'));i++) await sleep(50)
  assert(fs.existsSync(path.join(profile,'template-export.json')),'IPC未导出')
  await page.reload()
  await page.wait(`!!document.querySelector('.app-activitybar-item.is-wormhole')`)
  await page.tap('.app-activitybar-item.is-wormhole')
  await page.wait(`!!document.querySelector('.app-wh-supply-summary')`)
  assert.equal(saved().warehouse.items['drone-scout'], 36)
  assert.equal(saved().wormhole.run.supplies.items['drone-scout'], 32)
  assert.deepEqual((await page.snapshot()).wormholePreparationTemplates, await readTemplates())
  assert.equal(errors.length,0,JSON.stringify(errors))
  await page.screenshot(`wormhole-expedition-desktop-template-smoke-${process.env.WH_SMOKE_TAG}.png`)
  console.log(JSON.stringify({ ok: true, electronPid: process.pid, localDebug: true, fill: 32, deployed: 32, selections, IPCSaved: true, reloadRetained: true, actualExport: true }))
  win.webContents.debugger.detach()
  app.quit()
}

if (process.argv.includes('--smoke-child')) child().catch(e => { console.error(e); require('electron').app.exit(1) })
else parent().catch(e => { console.error(e); process.exitCode = 1 })
