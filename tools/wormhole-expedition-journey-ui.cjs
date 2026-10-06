/** 浏览器真实虫洞1至10层UI旅程；2026-10-06，游戏v0.1.0 / 档v31。
 * 用法：npm run build --prefix web，然后node tools/wormhole-expedition-journey-ui.cjs。
 * 输入固定A族19种子四鹦鹉螺fixture.before，仅自建localhost与临时Chrome profile。
 * 输出tools/_ui-artifacts/wormhole-expedition-journey-browser.json和截图；退出仅自建PID。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const {
  ROOT, SAVE_KEY, sleep, dependencies, createFixture, settingsScript,
  CdpConnection, JourneyPage, runJourney, staticServer, stopOwned, removeProfile,
} = require('./wormhole-expedition-journey-shared.cjs')

async function main() {
  const input = createFixture()
  const { server, url } = await staticServer(path.join(ROOT, 'web', 'dist'))
  const prefix = 'whale-whexpedition-journey-browser-'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  let chrome
  let socket
  try {
    const binary = process.env.WH_JOURNEY_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    chrome = spawn(binary, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    chrome.on('error', error => console.error(error))
    console.log(`自建Chrome PID ${chrome.pid};隔离入口 ${url}`)
    let debug
    for (let attempt = 0; attempt < 100; attempt++) {
      if (chrome.exitCode !== null) throw new Error('自建Chrome提前退出')
      try { debug = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'); break } catch { await sleep(100) }
    }
    assert(debug, '自建Chrome调试端口未就绪')
    const cdp = `http://127.0.0.1:${debug.split('\n')[0]}`
    if (process.argv.includes('--matrix-only')) {
      await require('./wormhole-expedition-journey-matrix.cjs').runEventMatrix(cdp, url)
      return
    }
    const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', () => reject(new Error('自建CDP连接失败')), { once: true })
    })
    const connection = new CdpConnection(socket)
    const page = new JourneyPage(connection.send.bind(connection))
    await page.send('Page.enable')
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, mobile: false, deviceScaleFactor: 1 })
    const injection = await page.send('Page.addScriptToEvaluateOnNewDocument', { source: settingsScript(input.announcement, input.initialSave) })
    await page.send('Page.navigate', { url })
    await page.wait('!!document.querySelector(".app-root")')
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier })
    const { core } = dependencies()
    await runJourney(page, input, {
      target: 'browser', pid: chrome.pid, errors: connection.errors,
      verifySaved: async state => {
        const raw = await page.js(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`)
        assert(raw, '隔离浏览器没有真实保存')
        const saved = core.loadSaveFile(raw).state
        assert.deepEqual(saved.wormhole.run, core.loadSaveFile(core.serializeSaveFile(state, 0)).state.wormhole.run)
        assert.deepEqual(saved.wormhole.lastSettle, core.loadSaveFile(core.serializeSaveFile(state, 0)).state.wormhole.lastSettle)
      },
    })
  } finally {
    socket?.close()
    await stopOwned(chrome)
    await new Promise(resolve => server.close(resolve))
    await removeProfile(profile, prefix)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
