/** 设置分类的桌面产物检查。
 * 用法：先 npm run build，再 node tools/settings-subpages-smoke.cjs。
 * 隐藏窗口和独立合成档；验证中英、两布局、分类、键盘、窄窗及原有设置写入。
 * 输出 tools/_ui-artifacts/settings-subpages/report.json；不读取个人档，不代替观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, settingsScript, staticServer, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tools/_ui-artifacts/settings-subpages')
const prefix = 'whale-settings-subpages-'
const clientVersion = JSON.parse(fs.readFileSync(path.join(root, 'apps/desktop/package.json'), 'utf8')).version

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
  state.modeChosen = true
  state.onboarding.step = 99
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  let processHandle, timer
  try {
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF']) delete env[key]
    processHandle = spawn(require('electron'), [__filename, '--child', ...process.argv.slice(2)], { cwd: root, env, windowsHide: true, stdio: 'inherit' })
    console.log('自建设置检查 Electron PID', processHandle.pid)
    let timedOut = false
    timer = setTimeout(() => { timedOut = true; processHandle.kill() }, 240_000)
    const [code] = await once(processHandle, 'exit')
    if (code !== 0) {
      const detail = fs.existsSync(path.join(profile, 'failure.txt'))
        ? fs.readFileSync(path.join(profile, 'failure.txt'), 'utf8')
        : '(子进程未写出异常记录)'
      throw new Error(`设置分类检查失败，code=${code} signal=${processHandle.signalCode} timeout=${timedOut}\n${detail}`)
    }
  } finally {
    clearTimeout(timer)
    if (processHandle && processHandle.exitCode === null && processHandle.signalCode === null) {
      const stopped = once(processHandle, 'exit')
      processHandle.kill()
      await stopped
    }
    const absolute = path.resolve(profile)
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
    assert(path.basename(absolute).startsWith(prefix))
    fs.rmSync(absolute, { recursive: true, force: true })
  }
}

async function child() {
  require('tsx/cjs')
  const data = require('../packages/data/src/index.ts')
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  const trace = message => fs.appendFileSync(path.join(profile, 'settings-subpages.trace'), `${new Date().toISOString()} ${message}\n`)
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith(prefix))
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  const hosted = await staticServer(path.join(root, 'apps/desktop/out/renderer'))
  try {
    trace(`static server ${hosted.url}`)
    process.env.ELECTRON_RENDERER_URL = hosted.url
    require(path.join(root, 'apps/desktop/out/main/index.js'))
    await app.whenReady()
    trace('electron ready')
    const win = BrowserWindow.getAllWindows()[0]
    assert(win, '没有创建游戏窗口')
    win.setMinimumSize(200, 200)
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
    const errors = [], results = []
    win.webContents.debugger.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') errors.push(params)
    })
    await page.send('Runtime.enable')
    win.webContents.on('render-process-gone', (_event, details) => {
      trace(`render-process-gone ${JSON.stringify(details)}`)
    })
    win.webContents.on('did-fail-load', (_event, code, description, url) => {
      trace(`did-fail-load ${code} ${description} ${url}`)
    })
    const select = async id => {
      await page.tap(`#settings-tab-${id}`)
      await page.wait(`!!document.querySelector('#settings-panel-${id}')`)
    }
    const geometry = () => page.js(`(() => {
      const modal = document.querySelector('.app-settings-modal'), list = modal.querySelector('.app-settings-list');
      const box = modal.getBoundingClientRect(), nav = modal.querySelector('.app-settings-tabs').getBoundingClientRect();
      const body = list.getBoundingClientRect(), foot = modal.querySelector('.app-settings-foot').getBoundingClientRect();
      const heading = modal.querySelector('.app-settings-heading').getBoundingClientRect();
      const title = modal.querySelector('.app-settings-title').getBoundingClientRect(), version = modal.querySelector('.app-settings-version').getBoundingClientRect();
      return { width: box.width, height: box.height, visible: box.top >= -1 && box.left >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1,
        separated: heading.bottom <= nav.top + 1 && (title.bottom <= version.top + 1 || title.right <= version.left + 1) && nav.bottom <= body.top + 1 && body.bottom <= foot.top + 1, horizontalOverflow: modal.scrollWidth > modal.clientWidth + 1 || list.scrollWidth > list.clientWidth + 1,
        tabOverflow: [...modal.querySelectorAll('[role=tab]')].some(el => el.scrollWidth > el.clientWidth + 1), scrollTop: list.scrollTop };
    })()`)
    const prefs = () => page.js(`JSON.stringify(['whale-idle:ui-zoom','whale-idle:ui-fs','whale-idle:ui-font','whale-idle:sfx','whale-idle:ui-theme'].map(key=>[key,localStorage.getItem(key)]))`)
    fs.mkdirSync(output, { recursive: true })
    for (const layout of (process.argv.includes('--release-only') ? [] : ['classic', 'modern'])) for (const locale of ['zh', 'en']) {
      trace(`start ${layout} ${locale}`)
      win.setContentSize(1366, 900)
      await page.wait('!!document.querySelector(".app-root")')
      await page.js(settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { locale, layout, debug: false, test: false }))
      const loaded = once(win.webContents, 'did-finish-load')
      win.webContents.reload()
      await loaded
      await page.wait('!!document.querySelector(".app-root")')
      await dismissOverlays(page)
      const t = id => data.l10nEntryText(data.L10N[id], locale)
      await page.text('.app-header', t('ui.App.010'))
      await page.wait('!!document.querySelector("#settings-panel-interface")')
      assert.equal(await page.js(`document.querySelectorAll('.app-settings-tabs [role=tab]').length`), 5)
      const initialPrefs = await prefs()
      const expected = { interface: 7, sound: 9, game: 1, save: 2, developer: 1 }
      assert.deepEqual(await page.js(`Array.from(document.querySelectorAll('#settings-panel-interface .app-settings-row'), row => row.querySelector('.app-settings-label')?.textContent.trim())`),
        ['ui.App.025', 'ui.App.146', 'ui.App.012', 'ui.App.014', 'ui.App.178', 'ui.App.127', 'ui.App.016'].map(t))
      assert.deepEqual(await page.js(`Array.from([...document.querySelectorAll('#settings-panel-interface .app-settings-row')].find(row => row.querySelector('.app-settings-label')?.textContent.trim() === ${JSON.stringify(t('ui.App.178'))}).querySelectorAll('button'), button => button.textContent.trim())`),
        ['ui.App.179', 'ui.App.195'].map(t))
      assert.deepEqual(await page.js(`Array.from([...document.querySelectorAll('#settings-panel-interface .app-settings-row')].find(row => row.querySelector('.app-settings-label')?.textContent.trim() === ${JSON.stringify(t('ui.App.127'))}).querySelectorAll('button'), button => button.textContent.trim())`),
        ['ui.App.128', 'ui.App.130', 'ui.App.134', 'ui.App.135', 'ui.App.136'].map(t))
      assert.equal(await page.js(`document.querySelector('.app-settings-version span')?.textContent.trim()`), `${t('ui.App.168')}: ${clientVersion}`)
      assert.equal(await page.js(`document.querySelector('.app-settings-version span')?.title.startsWith(${JSON.stringify(t('ui.App.170'))})`), true)
      let baseline
      for (const [id, rows] of Object.entries(expected)) {
        trace(`check category ${layout} ${locale} ${id}`)
        await select(id)
        assert.equal(await page.js('document.querySelectorAll(".app-settings-list > .app-settings-row").length'), rows, `分类行数 ${id}`)
        const box = await geometry()
        assert(box.visible && box.separated && !box.horizontalOverflow && !box.tabOverflow, JSON.stringify({ layout, locale, id, box }))
        baseline ??= box
        assert.equal(box.height, baseline.height)
        assert.equal(box.width, baseline.width)
      }
      assert.equal(await prefs(), initialPrefs, '分类切换不应修改设置')
      await page.tap('#settings-tab-interface')
      for (const [key, selected] of [['ArrowRight', 'sound'], ['End', 'developer'], ['Home', 'interface'], ['ArrowLeft', 'developer']]) {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
        await page.wait(`document.activeElement.id==='settings-tab-${selected}'&&!!document.querySelector('#settings-panel-${selected}')`)
      }
      await select('interface')
      await page.js('document.querySelector(".app-settings-list").scrollTop=9999')
      await select('sound')
      assert.equal((await geometry()).scrollTop, 0)
      const muted = await page.js('document.querySelector(".app-settings-slider").disabled')
      await page.text('.app-settings-list', t('ui.sfx.032'))
      assert.equal(await page.js('document.querySelector(".app-settings-slider").disabled'), !muted)
      await page.text('.app-settings-list', t('ui.sfx.032'))
      await select('game')
      await page.text('.app-settings-list', t('ui.App.139'))
      await select('sound')
      await select('game')
      assert.equal(await page.js(`document.querySelector('.app-settings-btns .is-primary').textContent.trim()`), t('ui.App.139'))
      await page.text('.app-settings-list', t('ui.App.138'))
      await page.text('.app-settings-version', t('ui.App.171'))
      await page.wait(`document.querySelector('.app-settings-version button')?.textContent.trim()===${JSON.stringify(t('ui.App.044'))}`)
      assert(await page.js(`!![...document.querySelectorAll('.app-settings-foot button')].find(button=>button.textContent.trim()===${JSON.stringify(t('ui.App.181'))})`))
      await page.text('.app-settings-foot', t('ui.App.181'))
      await page.wait('!!document.querySelector(".app-license-modal")')
      assert.deepEqual(await page.js(`Array.from(document.querySelectorAll('.app-license-modal .app-license-h'), heading => heading.textContent.trim())`),
        ['ui.App.184', 'ui.App.192', 'ui.App.188'].map(t))
      await page.text('.app-license-modal .app-modal-head', t('ui.App.183'))
      assert(await page.js('!!document.querySelector("#settings-panel-game")'))
      for (const [width, height] of [[600, 800], [375, 812]]) {
        win.setContentSize(width, height)
        await sleep(200)
        for (const id of ['interface', 'sound', 'save', 'developer']) {
          await select(id)
          const box = await geometry()
          assert(box.visible && box.separated && !box.horizontalOverflow && !box.tabOverflow, JSON.stringify({ layout, locale, width, id, box }))
        }
        assert(await page.js(`document.querySelector('.app-settings-heading').getBoundingClientRect().height>=document.querySelector('.app-settings-version').getBoundingClientRect().height`))
      }
      await page.text('.app-settings-foot', t('ui.App.024'))
      results.push({ layout, locale, categories: true, keyboard: true, stableModal: true, settingsRetained: true, narrow: true, license: true })
      trace(`complete ${layout} ${locale}`)
    }
    win.setContentSize(1366, 900)
    await page.wait('!!document.querySelector(".app-root")')
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { locale: 'zh', layout: 'classic', debug: true, test: false }),
    })
    const fileLoaded = once(win.webContents, 'did-finish-load')
    await win.loadFile(path.join(root, 'apps/desktop/out/renderer/index.html'))
    await fileLoaded
    await page.wait('!!document.querySelector(".app-root")')
    if (await page.js('!!document.querySelector(".app-report-card .app-report-head button")')) {
      await page.tap('.app-report-card .app-report-head button')
    }
    for (let n = 0; n < 60; n++) {
      const selector = await page.js(`(() => {
        for (const candidate of ['.app-report-card .app-report-head button', '.app-ann .app-ann-head button', '.app-comm-pop .app-comms-eave-extra button', '.app-comm-mask .app-comm-foot button', '.app-pro-mode-card:not(.is-iron)']) {
          if (document.querySelector(candidate)) return candidate;
        }
        return null;
      })()`)
      if (!selector) break
      await page.tap(selector)
    }
    trace('release startup overlays dismissed')
    fs.writeFileSync(path.join(output, 'release-state.json'), JSON.stringify(await page.js(`({ text: document.body.innerText.slice(-5000),
      overlays: [...document.querySelectorAll('.app-modal-mask,.app-pro-mask,.app-ann-mask,.app-report-card')].map(el=>({className:el.className,text:el.textContent.slice(0,500)})) })`), null, 2))
    const image = await page.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(output, 'release.png'), Buffer.from(image.data, 'base64'))
    await page.text('.app-header', data.L10N['ui.App.010'].zh)
    assert.equal(await page.js('document.querySelectorAll(".app-settings-tabs [role=tab]").length'), 4)
    assert.equal(await page.js('!!document.querySelector("#settings-tab-developer")'), false)
    assert.deepEqual(errors, [])
    const report = { ok: true, target: 'desktop-production-hidden', syntheticOnly: true, results, releaseDeveloperHidden: true, runtimeErrors: 0 }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally {
    hosted.server.closeAllConnections()
    await new Promise(resolve => hosted.server.close(resolve))
  }
  app.exit(0)
}

if (process.argv.includes('--child')) child().catch(error => {
  console.error(error)
  try {
    const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
    fs.appendFileSync(path.join(profile, 'failure.txt'), `${error?.stack ?? error}\n`)
  } catch {}
  require('electron').app.exit(1)
})
else parent().catch(error => { console.error(error); process.exitCode = 1 })
