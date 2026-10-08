/** 启动胜率worker实机技术验收：构建双端后 node tools/startup-win-worker-check.cjs。
 * 输入合法合成16架赤鸢舰，实际桌面file及网页HTTP加载，不读个人档，不改源码。
 * 输出tools/_ui-artifacts/startup-win-worker：worker/输入/长任务/取消及截图；非观感或手机硬件承诺。
 * 游戏v0.1.0/存档v31；2026-10-08核对，临时档令牌与PID证明归属后清理。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { once } = require('node:events')
const { ROOT, JourneyPage, staticServer, settingsScript, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/startup-win-worker')
const PREFIX = 'whale-startup-worker-'

function fixture() {
  require('tsx/cjs')
  const { serializeSaveFile } = require('../packages/core/src/index.ts')
  const { ANNOUNCEMENTS } = require('../packages/data/src/index.ts')
  const { makeExpeditionFixture } = require('./wormhole-expedition-fixture.ts')
  const state = makeExpeditionFixture('A', 19, 'drones').before
  state.onboarding.step = 1
  state.modeChosen = true
  state.logs = []
  return { save: serializeSaveFile(state), announcement: ANNOUNCEMENTS[0].id }
}
function instrumentation() {
  window.__workerProbe = { created: 0, active: 0, peak: 0, sent: [], results: [], errors: [], long: [], delays: [] }
  const info = window.__workerProbe, NativeWorker = window.Worker
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args)
      info.created++; info.active++; info.peak = Math.max(info.peak, info.active)
      this.addEventListener('message', ({ data }) => info.results.push({ kind: data.kind, id: data.id,
        generation: data.generation, runs: data.result?.runs, computeMs: data.computeMs, at: performance.now() }))
      this.addEventListener('error', event => info.errors.push(event.message))
    }
    postMessage(message, ...args) {
      info.sent.push({ kind: message.kind, id: message.id, generation: message.generation, at: performance.now() })
      return super.postMessage(message, ...args)
    }
    terminate() { if (!this.probeTerminated) { this.probeTerminated = true; info.active-- }; return super.terminate() }
  }
  new PerformanceObserver(list => info.long.push(...list.getEntries().map(entry => ({ at: entry.startTime, ms: entry.duration })))).observe({ type: 'longtask', buffered: false })
  let last = performance.now()
  setInterval(() => { const now = performance.now(); info.delays.push({ at: now, ms: now - last }); last = now }, 25)
}
async function checkedProfile(profile, token) {
  const parent = await fs.realpath(os.tmpdir()), actual = await fs.realpath(profile)
  assert.equal(path.dirname(actual), parent)
  assert(path.basename(actual).startsWith(PREFIX))
  assert.equal(path.resolve(profile), actual)
  const owner = JSON.parse(await fs.readFile(path.join(actual, 'owner.json'), 'utf8'))
  assert.equal(owner.token, token)
  return actual
}
async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const data = fixture(), report = { ok: false, cases: [] }
  for (const mode of ['desktop-file', 'web-http']) {
    const profile = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), PREFIX)), token = randomUUID()
    await fs.writeFile(path.join(profile, 'owner.json'), JSON.stringify({ token, parent: process.pid }))
    await fs.writeFile(path.join(profile, 'save.json'), data.save, 'utf8')
    let child, server, exited = false
    const row = { mode, ok: false }
    try {
      let url = ''
      if (mode === 'web-http') {
        const served = await staticServer(path.join(ROOT, 'web/dist'))
        server = served.server; url = served.url
      }
      const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_AUTOPERF: '1',
        STARTUP_WORKER_PROFILE: profile, STARTUP_WORKER_TOKEN: token, STARTUP_WORKER_MODE: mode,
        STARTUP_WORKER_URL: url, STARTUP_WORKER_ANNOUNCEMENT: data.announcement }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.ELECTRON_RENDERER_URL
      child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      row.pid = child.pid
      console.log(`${mode} 隔离PID=${child.pid}`)
      child.stdout.on('data', bytes => process.stdout.write(bytes))
      child.stderr.on('data', bytes => process.stderr.write(bytes))
      const timeout = setTimeout(() => child.kill(), 150000)
      const [code] = await once(child, 'exit')
      clearTimeout(timeout); exited = true
      const result = JSON.parse(await fs.readFile(path.join(OUT, `${mode}.json`), 'utf8'))
      Object.assign(row, result)
      assert.equal(code, 0, result.failure)
      assert(row.ok)
    } catch (error) { row.failure = String(error) }
    finally {
      if (child && !exited) {
        child.kill()
        await Promise.race([once(child, 'exit'), sleep(10000)])
        exited = child.exitCode !== null || child.signalCode !== null
      }
      if (server) await new Promise(resolve => server.close(resolve))
      if (exited) { await fs.rm(await checkedProfile(profile, token), { recursive: true, force: true }); row.removed = true }
      report.cases.push(row)
    }
  }
  report.ok = report.cases.every(row => row.ok && row.removed)
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases.map(row => ({ mode: row.mode, ok: row.ok, pid: row.pid,
    input: { maxMs: row.input?.maxMs, p95Ms: row.input?.p95Ms, longestMainTaskMs: row.input?.longestMainTaskMs },
    cards: row.evidence?.results?.length, workerPeak: row.evidence?.peak, removed: row.removed, failure: row.failure })) }))
  assert(report.ok, '启动worker验收未全部通过')
}
async function child() {
  const { app, BrowserWindow } = require('electron')
  const mode = process.env.STARTUP_WORKER_MODE
  const profile = await checkedProfile(process.env.STARTUP_WORKER_PROFILE, process.env.STARTUP_WORKER_TOKEN)
  const report = { ok: false, mode, pid: process.pid, errors: [] }
  let win
  try {
    app.setPath('userData', profile); app.setPath('sessionData', profile)
    BrowserWindow.prototype.show = function () {}
    require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
    await app.whenReady()
    for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await sleep(50)
    win = BrowserWindow.getAllWindows()[0]
    assert(win && !win.isVisible())
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve))
    win.webContents.debugger.attach('1.3')
    const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
    win.webContents.debugger.on('message', (_event, method, data) => { if (method === 'Runtime.exceptionThrown') report.errors.push(data) })
    await page.send('Runtime.enable'); await page.send('Page.enable')
    const settings = settingsScript(process.env.STARTUP_WORKER_ANNOUNCEMENT, undefined, { layout: 'classic', locale: 'zh', debug: true, test: false })
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: settings + `;(${instrumentation.toString()})();` })
    if (mode === 'web-http') await win.loadURL(process.env.STARTUP_WORKER_URL)
    else await page.send('Page.reload')
    await page.wait('!!document.querySelector(".app-root")')
    await page.js(`(()=>{const el=document.querySelector('.app-root');const key=Object.keys(el).find(k=>k.startsWith('__reactFiber$'));let f=el[key];while(f&&!f.memoizedProps?.engine)f=f.return;if(!f)throw Error('未找到实际引擎');window.__startupEngine=f.memoizedProps.engine})()`)
    await page.wait('window.__workerProbe.sent.some(row=>row.kind==="run")')
    const inputAt = await page.js(`(()=>{const input=document.createElement('input');input.id='startup-probe-input';input.style='position:fixed;top:0;left:0;z-index:99999';document.body.append(input);input.addEventListener('input',()=>window.__inputAt=performance.now());return performance.now()})()`)
    await page.tap('#startup-probe-input')
    const latencies = [], protocolTimes = []
    for (let i = 0; i < 40; i++) {
      const started = performance.now()
      await page.js('window.__inputSentAt=performance.now()')
      await page.send('Input.insertText', { text: 'x' })
      assert.equal(await page.js('document.querySelector("#startup-probe-input").value.length'), i + 1)
      latencies.push(await page.js('window.__inputAt-window.__inputSentAt'))
      protocolTimes.push(performance.now() - started)
      await sleep(75)
    }
    await page.wait('window.__workerProbe.results.filter(row=>row.kind==="result").length>=23', 90000)
    const evidence = await page.js('JSON.parse(JSON.stringify(window.__workerProbe))')
    assert.equal(evidence.peak, 1)
    assert.equal(evidence.active, 0)
    assert.equal(evidence.errors.length, 0)
    assert(evidence.results.every(row => row.kind === 'result' && row.runs === 30))
    assert(new Set(evidence.results.map(row => row.id)).size >= 23)
    const inputLongs = evidence.long.filter(row => row.at >= inputAt)
    report.evidence = evidence
    report.input = { n: latencies.length, rawMs: latencies, protocolMs: protocolTimes,
      longestMainTaskMs: Math.max(0, ...inputLongs.map(row => row.ms)) }
    assert(Math.max(0, ...inputLongs.map(row => row.ms)) < 500, '预热期间主线程仍阻塞超过500ms')
    latencies.sort((a, b) => a - b)
    assert(latencies.at(-1) < 500, '真实输入响应超过500ms')
    await page.js('window.__startupEngine.winCache.reset(); window.__startupEngine.winCache.pump()')
    await page.wait('window.__workerProbe.active===1')
    await page.js('window.__startupEngine.stop()')
    assert.equal(await page.js('window.__workerProbe.active'), 0)
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    assert(!image.isEmpty())
    await fs.writeFile(path.join(OUT, `${mode}.png`), image.toPNG())
    Object.assign(report.input, { p95Ms: latencies[Math.floor(latencies.length * .95)], maxMs: latencies.at(-1) })
    report.stopped = true
    assert.equal(report.errors.length, 0)
    report.ok = true
  } catch (error) { report.failure = error.stack; process.exitCode = 1 }
  finally {
    await fs.writeFile(path.join(OUT, `${mode}.json`), JSON.stringify(report, null, 2), 'utf8')
    if (win && !win.isDestroyed()) { win.webContents.debugger.detach(); win.destroy() }
    app.exit(report.ok ? 0 : 1)
  }
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else main().catch(error => { console.error(error); process.exitCode = 1 })
