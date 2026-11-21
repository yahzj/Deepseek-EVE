/** 普通 Chrome + file:// 验证，不使用服务器、不放宽浏览器文件安全策略。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { spawn } = require('node:child_process')
const { CdpConnection, JourneyPage, sleep, stopOwned, removeProfile, settingsScript } = require('../wormhole-expedition-journey-shared.cjs')
require('tsx/cjs')
const core = require('../../packages/core/src/index.ts')
const data = require('../../packages/data/src/index.ts')
const { signalAutoFixture } = require('../signal-auto-estimate-fixture.ts')

const ROOT = path.resolve(__dirname, '../..')
const OUTPUT = path.join(ROOT, `tools/_ui-artifacts/toy-${Date.now()}`)
const URL = pathToFileURL(path.join(ROOT, 'dist/toy/index.html')).href
const SAVE = 'JSON.parse(localStorage.getItem("whale:idle:save")).state'
const text = id => data.L10N[core.signalSpaceTextId(id)].zh

// 只观察正式构造函数，既不替代 Worker，也不插入游戏测试 API。
const OBSERVE = `(()=>{
  window.__toyWorkers=[];window.__toyAudio=[];window.__toyCsp=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{constructor(...args){super(...args);const row={url:String(args[0]),sent:0,received:0,error:null};window.__toyWorkers.push(row);const post=this.postMessage.bind(this);this.postMessage=(...values)=>{row.sent++;return post(...values)};this.addEventListener('message',()=>row.received++);this.addEventListener('error',event=>row.error=event.message)}};
  const NativeAudio=window.Audio;
  window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.__toyAudio.push(this)}};
  document.addEventListener('securitypolicyviolation',event=>window.__toyCsp.push({directive:event.violatedDirective,uri:event.blockedURI}));
})()`

async function main() {
  await fs.mkdir(OUTPUT, { recursive: true })
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-toy-'))
  let child, socket, page, connection
  const report = { url: URL, rows: [], localFailures: [], canceledAudio: [], consoleErrors: [] }
  try {
    child = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
      '--headless=new', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' })
    console.log('自有 Chrome PID', child.pid)
    let debug
    for (let n = 0; n < 100; n++) {
      try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, 'Chrome 调试端口未启动')
    const target = await (await fetch(`http://127.0.0.1:${debug.split('\n')[0]}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
    connection = new CdpConnection(socket)
    page = new JourneyPage(connection.send.bind(connection))
    const requests = new Map()
    socket.addEventListener('message', event => {
      const msg = JSON.parse(String(event.data)), params = msg.params
      if (msg.method === 'Network.requestWillBeSent') requests.set(params.requestId, params.request.url)
      if (msg.method === 'Network.loadingFailed' && requests.get(params.requestId)?.startsWith('file:')) {
        const url = requests.get(params.requestId)
        const canceledAudio = params.errorText === 'net::ERR_ABORTED' && url.endsWith('.mp3')
        ;(canceledAudio ? report.canceledAudio : report.localFailures).push({ url, error: params.errorText })
      }
      if (msg.method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        report.consoleErrors.push(params.args.map(arg => arg.value ?? arg.description).join(' '))
      }
    })
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Network.enable')
    // 本地内容必须在断网时可用；联网功能的网络失败另行记录。
    await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVE })
    const initial = await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { debug: false, test: false }),
    })
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false })
    await page.send('Page.navigate', { url: URL })
    await page.wait('!!document.querySelector(".app-prologue")', 30000)
    assert.equal(await page.js('location.protocol'), 'file:')
    await page.tap('.app-pro-skip')
    await page.tap('.app-pro-mode-card:not(.is-iron)')
    await page.wait('!document.querySelector(".app-prologue")')
    await page.wait('!!localStorage.getItem("whale:idle:save")')
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initial.identifier })
    await screenshot(page, 'new-game.png')
    report.rows.push({ newGame: true, offline: true, modeChosen: await page.js(`${SAVE}.modeChosen`) })

    const fixture = signalAutoFixture('survey', true)
    fixture.state.character.name = 'TOY-SMOKE'
    fixture.state.research.levels['mt-industry-void-drip'] = 0
    fixture.state.wormholeScan = { active: false, progressMs: 0, welcomed: true }
    fixture.state.preparationSquads = { 'signal-auto': fixture.roster }
    const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: settingsScript(data.ANNOUNCEMENTS[0].id, core.serializeSaveFile(fixture.state, Date.now()), { debug: false, test: false }),
    })
    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
    await dismiss(page)
    await page.text('.app-nav-side', text('ui.App.001'))
    await page.text('.app-subtabs', text('ui.MapPage.007'))
    await page.wait('!![...document.querySelectorAll(".app-inv-row button")].find(b=>b.title.includes("自动"))')
    await page.js('[...document.querySelectorAll(".app-inv-row button")].find(b=>b.title.includes("自动")).click()')
    await page.tap('.app-wh-enter')
    await page.wait(`${SAVE}.wormholeAuto.length===1`, 60000)
    await page.wait('window.__toyWorkers.some(worker=>worker.received>0)')
    await page.wait('!document.querySelector(".app-wh-modal")')
    await screenshot(page, 'signal-worker.png')
    const run = await page.js(`${SAVE}.wormholeAuto[0]`)
    assert.equal(run.estimate.version, 2)
    assert.equal(run.estimate.layers[0].guardBattle.outcome, 'victory')

    // 从正式悬赏页触发另一个后台推演，仍由界面发送请求。
    await page.text('.app-subtabs', text('ui.MapPage.004'))
    await page.wait('window.__toyWorkers.length>=2 && window.__toyWorkers.every(worker=>worker.received>0)', 60000)
    const workers = await page.js('window.__toyWorkers')
    assert(workers.every(worker => !worker.error && /^(blob:|data:)/.test(worker.url)))
    report.rows.push({ workers, signalRun: run.id, estimateVersion: run.estimate.version })
    await screenshot(page, 'bounty-worker.png')

    await page.js(`document.documentElement.dataset.uiFont='retro'`)
    const fonts = await page.js(`(async()=>{await document.fonts.load('16px "GNU Unifont"');await document.fonts.load('16px Oxanium');return [...document.fonts].map(font=>({family:font.family,status:font.status}))})()`)
    assert(fonts.some(font => font.family === 'GNU Unifont' && font.status === 'loaded'))
    assert(fonts.some(font => font.family === 'Oxanium' && font.status === 'loaded'))
    const assets = JSON.parse(await fs.readFile(path.join(ROOT, 'dist/toy-size.json'), 'utf8')).files
    const media = assets.filter(file => /\.(mp3|png|jpg)$/.test(file.name)).map(file => file.name)
    // 文件页不能 fetch 素材；以浏览器实际解码验证每一份图片和音频。
    const decoded = await page.js(`Promise.all(${JSON.stringify(media)}.map(name=>new Promise(resolve=>{const el=/\\.mp3$/.test(name)?new Audio():new Image();const done=ok=>{el.removeAttribute('src');resolve({name,ok})};el.addEventListener(/\\.mp3$/.test(name)?'loadedmetadata':'load',()=>done(true),{once:true});el.addEventListener('error',()=>done(false),{once:true});el.src='./'+name;setTimeout(()=>done(false),10000)})))`)
    assert.deepEqual(decoded.filter(row => !row.ok), [], '本地图片或音频无法解码')
    report.rows.push({ fonts, mediaDecoded: decoded.length, audioPlaying: await page.js('window.__toyAudio.some(audio=>!audio.paused&&audio.currentTime>0)') })

    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await dismiss(page)
    assert.equal(await page.js(`${SAVE}.character.name`), 'TOY-SMOKE')
    assert.equal(await page.js(`${SAVE}.wormholeAuto.length`), 1)
    await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUTPUT, eventsEnabled: true })
    await openSaveManager(page)
    await page.text('.app-save-actions', text('ui.SaveManager.012'))
    await page.text('.app-save-actions', text('ui.SaveManager.016'))
    let exported
    for (let n = 0; n < 100; n++) {
      exported = (await fs.readdir(OUTPUT)).find(name => /^save-.*\.json$/.test(name))
      if (exported) break
      await sleep(100)
    }
    assert(exported, '本地导出没有生成存档文件')
    const exportedPath = path.join(OUTPUT, exported)
    const exportedText = await fs.readFile(exportedPath, 'utf8')
    const importedState = core.loadSaveFile(exportedText).state
    assert.equal(importedState.character.name, 'TOY-SMOKE')
    importedState.character.name = 'TOY-IMPORTED'
    const importPath = path.join(OUTPUT, 'import-fixture.json')
    await fs.writeFile(importPath, core.serializeSaveFile(importedState, Date.now()))
    await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
    await page.text('.app-save-actions', text('ui.SaveManager.014'))
    await page.wait('!!document.querySelector("input[type=file]")')
    const documentNode = await page.send('DOM.getDocument')
    const input = await page.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: 'input[type=file]' })
    await page.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [importPath] })
    await page.wait('!document.querySelector("input[type=file]")')
    await page.wait('!document.querySelector(".app-save-actions button:disabled")')
    await page.wait(`${SAVE}.character.name === 'TOY-IMPORTED'`)
    report.rows.push({ reload: true, backup: true, exported, imported: true })
    await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await dismiss(page)
    const desktopUa = await page.js('navigator.userAgent')
    const mobileUa = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
    for (const layout of ['classic', 'modern']) {
      await page.js(`localStorage.setItem('whale-idle:layout',${JSON.stringify(layout)})`)
      await page.send('Emulation.setUserAgentOverride', { userAgent: desktopUa })
      await measureLayout(page, report, layout, { width: 1366, height: 768, mobile: false, touch: false, rotate: false, name: 'desktop' }, true)

      // 模拟容器视口与系统方向不一致：竖形窗口，系统仍报告横屏。
      await measureLayout(page, report, layout, { width: 1080, height: 1920, mobile: true, touch: true, rotate: true, name: 'portrait-host' })
      // 同一页切到真正横形视口；无需重载，且不能再旋转一遍。
      await measureLayout(page, report, layout, { width: 1920, height: 1080, mobile: true, touch: true, rotate: false, name: 'landscape-host' })

      // 模拟内嵌浏览器报告鼠标指针，但 UA 仍表明它是手机。
      await page.send('Emulation.setUserAgentOverride', { userAgent: mobileUa })
      await measureLayout(page, report, layout, { width: 1080, height: 1920, mobile: true, touch: false, rotate: true, name: 'portrait-fine-pointer' }, true)

      // 自动档阈值含1.5倍边界；两种布局都用同一规则。
      await measureLayout(page, report, layout, { width: 800, height: 1199, mobile: true, touch: true, rotate: false, name: 'auto-below-1_5' })
      await measureLayout(page, report, layout, { width: 800, height: 1200, mobile: true, touch: true, rotate: true, name: 'auto-at-1_5' })
      await measureLayout(page, report, layout, { width: 800, height: 1000, mobile: true, touch: true, rotate: false, name: 'manual-start' })
      assert.equal(await page.js('document.querySelector("[data-toy-orientation]").previousElementSibling.textContent.trim()'), text('ui.App.010'), '方向按钮不在设置后面')
      const buttonWidth = await page.js('document.querySelector("[data-toy-orientation]").offsetWidth')
      await page.tap('[data-toy-orientation="auto"]')
      await page.wait('!!document.querySelector("[data-toy-orientation=landscape]") && !!document.querySelector(".app-root.is-mobile-rot")')
      await screenshot(page, `${layout}-manual-landscape.png`)
      await page.send('Page.reload')
      await page.wait('!!document.querySelector("[data-toy-orientation=landscape]") && !!document.querySelector(".app-root.is-mobile-rot")')
      await dismiss(page)
      assert.equal(await page.js('localStorage.getItem("whale-idle:toy-orientation")'), 'landscape')
      await page.tap('[data-toy-orientation="landscape"]')
      await page.wait('document.querySelector("[data-toy-orientation=portrait]") && !document.querySelector(".app-root.is-mobile-rot")')
      assert.equal(await page.js('document.querySelector("[data-toy-orientation]").offsetWidth'), buttonWidth, '三档名称改变了按钮尺寸')
      await page.send('Page.reload')
      await page.wait('document.querySelector("[data-toy-orientation=portrait]") && !document.querySelector(".app-root.is-mobile-rot")')
      await dismiss(page)
      await screenshot(page, `${layout}-manual-portrait.png`)
      await page.tap('[data-toy-orientation="portrait"]')
      await page.wait('document.querySelector("[data-toy-orientation=auto]") && !document.querySelector(".app-root.is-mobile-rot")')
      await measureLayout(page, report, layout, { width: 390, height: 844, mobile: true, touch: true, rotate: true, name: 'phone-auto' })
      await page.tap('[data-toy-orientation="auto"]')
      await page.wait('!!document.querySelector("[data-toy-orientation=landscape]")')
      await page.tap('[data-toy-orientation="landscape"]')
      await page.wait('!!document.querySelector("[data-toy-orientation=portrait]") && !document.querySelector(".app-root.is-mobile-rot")')
      await screenshot(page, `${layout}-phone-portrait.png`)
      await page.tap('[data-toy-orientation="portrait"]')
      await page.wait('!!document.querySelector("[data-toy-orientation=auto]") && !!document.querySelector(".app-root.is-mobile-rot")')
      report.rows.push({ layout, orientationCycle: ['auto', 'landscape', 'portrait', 'auto'], persisted: true, thresholdRatio: 1.5, buttonAfterSettings: true })
    }
    assert.deepEqual(await page.js('window.__toyCsp'), [], '存在内容安全策略拦截')
    assert.deepEqual(report.localFailures, [])
    assert.deepEqual(report.consoleErrors, [])
    assert.deepEqual(connection.errors, [])
    report.success = true
    console.log('本地参赛包冒烟通过', JSON.stringify(report.rows))
  } catch (error) {
    report.error = String(error.stack ?? error)
    if (page) {
      report.body = await page.js('document.body.innerText').catch(() => '')
      report.csp = await page.js('window.__toyCsp').catch(() => [])
      await screenshot(page, 'failure.png').catch(() => {})
    }
    throw error
  } finally {
    await fs.writeFile(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    socket?.close()
    await stopOwned(child)
    await removeProfile(profile, 'whale-toy-')
    console.log('本地冒烟报告', path.join(OUTPUT, 'report.json'))
  }
}

async function dismiss(page) {
  for (let n = 0; n < 12; n++) {
    const dismissed = await page.js(`(()=>{const button=[...document.querySelectorAll('.app-modal-mask button,.app-comm-mask button')].reverse().find(button=>/^(知道了|关闭|稍后)$/.test(button.textContent.trim())&&button.getBoundingClientRect().width>0);button?.click();return !!button})()`)
    if (!dismissed) return
    await sleep(150)
  }
}
async function screenshot(page, name) {
  const shot = await page.send('Page.captureScreenshot', { format: 'png' })
  await fs.writeFile(path.join(OUTPUT, name), Buffer.from(shot.data, 'base64'))
}
async function measureLayout(page, report, layout, viewport, reload = false) {
  const { width, height, mobile, touch, rotate, name } = viewport
  page.touch = touch
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, screenWidth: Math.max(width, height), screenHeight: Math.min(width, height),
    deviceScaleFactor: 1, mobile, screenOrientation: { type: 'landscapePrimary', angle: 90 },
  })
  if (reload) {
    await page.send('Page.reload')
    await page.wait(`!!document.querySelector('.app-root.is-layout-${layout}')`)
    await dismiss(page)
  }
  await page.wait(`document.querySelector('.app-root')?.classList.contains('is-mobile-rot') === ${rotate}`)
  const geometry = await page.js(`(() => {
    const root = document.querySelector('.app-root'), css = getComputedStyle(root), rect = root.getBoundingClientRect();
    return {
      viewport: innerWidth, scroll: document.documentElement.scrollWidth,
      coarse: matchMedia('(pointer: coarse)').matches, orientation: screen.orientation?.type,
      root: { width: rect.width, height: rect.height }, logicalWidth: root.offsetWidth, transform: css.transform,
      layoutCss: document.getElementById('whale-layout-style').href,
    };
  })()`)
  assert(geometry.scroll <= geometry.viewport + 1, `页面横向溢出：${layout}/${name}`)
  assert(geometry.layoutCss.includes(`styles-${layout}-`), `布局样式未加载：${layout}/${name}`)
  assert.equal(geometry.coarse, touch, `${layout}/${name} 指针模拟未生效`)
  assert.equal(geometry.orientation, 'landscape-primary')
  if (rotate) {
    assert.match(geometry.transform, /^matrix\(0, -/, `${layout}/${name} 未实际旋转`)
    assert(geometry.logicalWidth > width)
    assert(Math.abs(geometry.root.width - width) < 2 && Math.abs(geometry.root.height - height) < 2)
  } else assert.equal(geometry.transform, 'none')
  await screenshot(page, `${layout}-${name}.png`)
  report.rows.push({ layout, name, width, height, rotate, geometry, reload })
}
async function openSaveManager(page) {
  await page.text('.app-header', text('ui.App.010'))
  await page.tap('#settings-tab-account')
  await page.text('#settings-panel-account', text('ui.App.065'))
  await page.wait('!!document.querySelector(".app-save-actions")')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
