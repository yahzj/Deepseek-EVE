/**
 * 桌面后台计时回归：先npm run build，再node tools/desktop-background-pump-native-check.cjs。
 * 本树生产产物、隐藏Electron、临时合成档；不启用WHALE_AUTOPERF，不由工具覆盖节流策略。
 * 等待75秒检查真实计时与60秒自动保存，无调试器，不操作屏幕电源，不读取个人档。
 * 输出tools/_ui-artifacts/desktop-background-pump/report.json；按自有PID/目录边界清理。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/desktop-background-pump')
const PREFIX = 'whale-background-pump-'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const { injectCommandFleetAllShipsFixture } = require('./command-fleet-all-ships-fixture.ts')
  const { buildSimContext } = require('../packages/data/src/index.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 20261031 })
  injectCommandFleetAllShipsFixture(state)
  // 真实十二舰开战，隐藏期间应正常结算并继续推进，不只验证空闲时钟。
  assert(core.startExpedition(state, 'ano-training', buildSimContext()).ok)
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let child, timer
  try {
    await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_BACKGROUND_CHECK: '1' }
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF', 'ELECTRON_ENTRY', 'NODE_OPTIONS']) delete env[key]
    child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
    console.log(`后台计时检查自有Electron PID=${child.pid}；等待75秒，不操作显示器或个人档。`)
    timer = setTimeout(() => child.kill(), 110_000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, '后台计时检查失败')
    const report = JSON.parse(await fs.readFile(path.join(profile, 'report.json'), 'utf8'))
    assert(report.ok)
    await fs.mkdir(OUT, { recursive: true })
    await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
    console.log(JSON.stringify(report, null, 2))
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill(); await stopped
    }
    const absolute = path.resolve(profile)
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
    assert(path.basename(absolute).startsWith(PREFIX))
    assert.equal(await fs.realpath(absolute), absolute)
    await fs.rm(absolute, { recursive: true })
  }
}

async function child() {
  const { app, BrowserWindow } = require('electron')
  assert.equal(process.env.WHALE_AUTOPERF, undefined)
  assert.equal(process.env.ELECTRON_RENDERER_URL, undefined)
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith(PREFIX))
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  const failures = []
  const ready = new Promise((resolve, reject) => {
    app.on('browser-window-created', (_event, win) => {
      win.webContents.on('render-process-gone', (_e, details) => reject(new Error(JSON.stringify(details))))
      win.webContents.on('did-fail-load', (_e, code, message) => reject(new Error(`${code}: ${message}`)))
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) failures.push(message) })
      win.webContents.once('did-finish-load', () => resolve(win))
    })
  })
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  const win = await ready
  assert.equal(app.getPath('userData'), profile)
  assert.equal(win.isVisible(), false)
  assert.equal(win.webContents.getBackgroundThrottling(), false, '生产窗口仍在节流')
  assert.equal(win.webContents.debugger.isAttached(), false, '调试器会掩盖后台节流')
  for (let n = 0; n < 100; n++) {
    if (await win.webContents.executeJavaScript('!!document.querySelector(".app-root")')) break
    if (n === 99) throw new Error('游戏界面未就绪')
    await sleep(100)
  }
  const saveFile = path.join(profile, 'save.json')
  const before = JSON.parse(await fs.readFile(saveFile, 'utf8'))
  await win.webContents.executeJavaScript(`(() => {
    window.__backgroundTimerProbe = { start: Date.now(), ticks: 0, last: Date.now(), maxGap: 0 };
    window.__backgroundTimerProbe.interval = setInterval(() => {
      const p = window.__backgroundTimerProbe, now = Date.now();
      p.maxGap = Math.max(p.maxGap, now - p.last); p.last = now; p.ticks++;
    }, 100);
    return true;
  })()`)
  const started = Date.now()
  // 观察期不向渲染进程发指令，不能靠频繁executeJavaScript把后台唤醒。
  await sleep(75_000)
  const after = JSON.parse(await fs.readFile(saveFile, 'utf8'))
  const timer = await win.webContents.executeJavaScript(`(() => {
    const p = window.__backgroundTimerProbe; clearInterval(p.interval);
    return { ticks: p.ticks, elapsed: Date.now() - p.start, maxGap: p.maxGap, url: location.href };
  })()`)
  const elapsed = Date.now() - started
  const advanced = after.state.gameMs - before.state.gameMs
  assert(timer.ticks >= timer.elapsed / 100 * 0.8, '隐藏窗口定时器严重降频')
  assert(after.savedAtWallMs - before.savedAtWallMs >= 55_000, '后台自动存档没有按周期运行')
  assert(advanced >= 55_000, '隐藏期间游戏时间没有正常推进')
  assert.equal(after.state.expedition.battle == null, true, '后台真实战斗未完成')
  assert.equal(failures.length, 0, `渲染错误：${failures.join('\n')}`)
  const report = { ok: true, target: 'desktop-production-file-hidden', executable: process.execPath,
    electron: process.versions.electron, isolatedProfile: true, autoPerf: false, debuggerAttached: false,
    backgroundThrottling: win.webContents.getBackgroundThrottling(),
    hidden: !win.isVisible(), elapsedMs: elapsed, timer, savedGameAdvanceMs: advanced,
    autoSaveAdvanceWallMs: after.savedAtWallMs - before.savedAtWallMs, battleCompleted: true,
    errors: failures, limitation: '隐藏窗口及真实IPC保存；未物理熄屏、锁屏或系统睡眠，不作观感结论。' }
  await fs.writeFile(path.join(profile, 'report.json'), JSON.stringify(report), 'utf8')
  app.exit(0)
}

if (process.argv.includes('--child') && process.env.WHALE_BACKGROUND_CHECK === '1') child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
