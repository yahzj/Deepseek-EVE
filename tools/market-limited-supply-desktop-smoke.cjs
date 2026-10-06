/** 限额慢补货Electron真实IPC存盘，独立隐藏窗口与合成档。
 * 用法：先构建并跑market-limited-supply-audit.ts，再node tools/market-limited-supply-desktop-smoke.cjs。
 * 版本自检：游戏v0.1.0 / 存档v31 / 最后核对2026-10-06。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
if (!process.argv.includes('--smoke-child')) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-limited-supply-'))
  try {
    const fixture = JSON.parse(fs.readFileSync(path.resolve('tools/_ui-artifacts/market-limited-supply/synthetic-save.json'), 'utf8'))
    fixture.savedAtWallMs = Date.now() - 1000
    fixture.state.savedAtWallMs = fixture.savedAtWallMs
    fs.writeFileSync(path.join(profile, 'save.json'), JSON.stringify(fixture), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(require('electron'), [__filename, '--smoke-child'], { env, windowsHide: true, encoding: 'utf8', timeout: 40000 })
    console.log(run.stdout)
    if (run.error) throw run.error
    assert.equal(run.status, 0, run.stderr)
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8'))
    assert.equal(saved.state.ironman.seq, fixture.state.ironman.seq, '普通档代次应冻结')
    assert(saved.savedAtWallMs > fixture.savedAtWallMs, '保存时间未更新')
    const stock = saved.state.market.pools['min-voidcrystal'].limitedSupply
    assert.equal(stock.remaining, 0)
    assert.equal(stock.refillProgressMs, 300000)
    assert.equal(stock.lastRefillGameMs, 300000)
    console.log(JSON.stringify({ ok: true, target: path.resolve('apps/desktop/out'), IPCSaved: true, sequence: saved.state.ironman.seq }))
  } finally {
    assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && profile.includes('whale-limited-supply-'))
    fs.rmSync(profile, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.resolve('apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    assert(win)
    let ready = false
    for (let i = 0; i < 100; i++) {
      try { ready = await win.webContents.executeJavaScript('!!document.querySelector(".app-root")') } catch {}
      if (ready) break
      await sleep(100)
    }
    assert(ready, '桌面没有完成合成档加载')
    await sleep(300)
    const saveFile = path.join(process.env.WHALE_PERF_USERDATA, 'save.json')
    const before = JSON.parse(fs.readFileSync(saveFile, 'utf8')).savedAtWallMs
    await win.webContents.executeJavaScript('window.dispatchEvent(new Event("pagehide"));true')
    let after = before
    for (let i = 0; i < 50 && after <= before; i++) {
      await sleep(100)
      after = JSON.parse(fs.readFileSync(saveFile, 'utf8')).savedAtWallMs
    }
    assert(after > before, '没有确认退出前补存的新写入')
    await win.webContents.reload()
    await sleep(600)
    const saved = JSON.parse(fs.readFileSync(saveFile, 'utf8'))
    assert.equal(saved.state.market.pools['min-voidcrystal'].limitedSupply.remaining, 0)
    console.log(JSON.stringify({ ok: true, electronPid: process.pid, syntheticOnly: true }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
