/** 异形装备Electron存盘/读档与显示读数冒烟，全新合成档、独立隐藏窗口。
 * 用法：构建后 node tools/alien-loot-desktop-smoke.cjs。
 * 版本自检：游戏v0.1.0 / 存档v31，2026-10-09核对与运行。
 * 不读取个人档，只删除自己创建的临时userData；不是观感验收。
 */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { spawnSync } = require('node:child_process')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
if (!process.argv.includes('--smoke-child')) {
  require('tsx/cjs')
  const { alienLootTestSave } = require('./alien-loot-test-fixture.ts')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-alien-loot-'))
  try {
    fs.writeFileSync(path.join(profile, 'save.json'), alienLootTestSave(), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(require('electron'), [__filename, '--smoke-child'], { encoding: 'utf8', windowsHide: true, timeout: 60000, env })
    console.log(run.stdout)
    if (run.error) throw run.error
    assert.equal(run.status, 0, run.stderr)
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state.expedition.battle
    assert(saved && Object.values(saved.foeAcidLayers ?? {}).some(rows => rows.length))
    console.log(JSON.stringify({ ok: true, target: path.resolve('apps/desktop/out'), IPCSaved: true }))
  } finally {
    const target = path.resolve(profile)
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('whale-alien-loot-'))
    fs.rmSync(target, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.resolve('apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    assert(win)
    const errors = []
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
    const js = source => win.webContents.executeJavaScript(source)
    const until = async source => {
      for (let i = 0; i < 150; i++) { try { if (await js(source)) return } catch {} await sleep(100) }
      throw new Error('等待超时：' + source)
    }
    await until('!!document.querySelector(".app-root")')
    if (await js('!!document.querySelector(".app-battle-float")')) await js('document.querySelector(".app-battle-float").click()')
    await until('!!document.querySelector(".app-battle-screen:not(.is-report)")')
    await until('[...document.querySelectorAll(".app-bts-web-status")].some(el=>el.textContent.includes("酸蚀"))')
    await js('window.dispatchEvent(new Event("pagehide")); true')
    await sleep(500)
    const before = JSON.parse(fs.readFileSync(path.join(process.env.WHALE_PERF_USERDATA, 'save.json'), 'utf8')).state.expedition.battle
    assert(before && Object.values(before.foeAcidLayers ?? {}).some(rows => rows.length))
    await win.webContents.reload()
    await until('!!document.querySelector(".app-root")')
    await sleep(500)
    await js('window.dispatchEvent(new Event("pagehide")); true')
    await sleep(500)
    const after = JSON.parse(fs.readFileSync(path.join(process.env.WHALE_PERF_USERDATA, 'save.json'), 'utf8')).state.expedition.battle
    assert(after && after.lastTickGameMs >= before.lastTickGameMs)
    for (const [tag, layers] of Object.entries(before.foeAcidLayers)) {
      for (const layer of layers) {
        if (layer.untilMs > after.lastTickGameMs) assert(after.foeAcidLayers[tag].some(row => row.untilMs === layer.untilMs && row.cutPct === layer.cutPct))
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(JSON.stringify({ ok: true, electronPid: process.pid, acidVisible: true, reloadKeepsExpiry: true, runtimeErrors: errors.length }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
