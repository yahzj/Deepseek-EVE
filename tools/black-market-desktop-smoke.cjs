/** 黑市Electron外壳冒烟。用法：构建后node tools/black-market-desktop-smoke.cjs。
 * 只读合成验收档，临时userData，隐藏自建窗口；真实IPC购买/存盘/读档校验。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!process.argv.includes('--smoke-child')) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-blackmarket-desktop-'))
  try {
    fs.copyFileSync(path.resolve('docs/test-saves/test-save-black-market-20261004.json'), path.join(profile, 'save.json'))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(require('electron'), [__filename, '--smoke-child'], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true, timeout: 40000,
      env,
    })
    console.log(run.stdout)
    if (run.error) throw run.error
    assert.equal(run.status, 0, run.stderr)
    const state = JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(state.blackMarket.offers[0].sold, true)
    console.log(JSON.stringify({ ok: true, target: path.resolve('apps/desktop/out'), syntheticIPCWrite: true }))
  } finally {
    assert(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep) && profile.includes('whale-blackmarket-desktop-'))
    fs.rmSync(profile, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.resolve('apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    assert(win)
    const js = (s) => win.webContents.executeJavaScript(s)
    const until = async (s) => {
      for (let i = 0; i < 100; i++) { try { if (await js(s)) return } catch {} await sleep(100) }
      throw new Error('外壳等待超时：' + s)
    }
    await until(`!!document.querySelector('[data-nav-page="market"]')`)
    await js(`document.querySelector('[data-nav-page="market"]').click()`)
    await until(`!!document.querySelector('.app-mkt-tabs .app-bm-entry')`)
    await js(`document.querySelector('.app-mkt-tabs .app-bm-entry').click()`)
    await until(`document.querySelectorAll('.app-bm-card').length===9`)
    await js(`document.querySelector('.app-bm-card > .app-btn').click()`)
    await until(`!!document.querySelector('.app-bm-confirm')`)
    await js(`document.querySelector('.app-bm-confirm-actions button:last-child').click()`)
    await until(`!!document.querySelector('.app-bm-card.is-sold')`)
    let saved
    for (let i = 0; i < 100; i++) {
      saved = JSON.parse(fs.readFileSync(path.join(process.env.WHALE_PERF_USERDATA, 'save.json'), 'utf8'))
      if (saved.state.blackMarket.offers[0].sold) break
      await sleep(100)
    }
    assert(saved.state.blackMarket.offers[0].sold)
    await win.webContents.reload()
    await until(`!!document.querySelector('[data-nav-page="market"]')`)
    await sleep(300)
    await js(`document.querySelector('[data-nav-page="market"]').click()`)
    await until(`!!document.querySelector('.app-mkt-tabs .app-bm-entry')`)
    await js(`document.querySelector('.app-mkt-tabs .app-bm-entry').click()`)
    await until(`!!document.querySelector('.app-bm-card.is-sold')`)
    console.log(JSON.stringify({ ok: true, electronPid: process.pid, nineOffers: true, purchased: true, IPCSaved: true, reloadSold: true }))
    app.exit(0)
  }).catch((e) => { console.error(e); app.exit(1) })
}
