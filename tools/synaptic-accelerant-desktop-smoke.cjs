/**
 * 技能加速桌面冒烟：构建后 node tools/synaptic-accelerant-desktop-smoke.cjs。
 * 合成旧档、临时userData、隐藏自建窗口；检查启动离线续用和真实IPC保存重载，不作观感验收。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-09 · 最后跑过2026-10-09。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '..')
const HOUR = 3_600_000

if (!process.argv.includes('--smoke-child')) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-synaptic-smoke-'))
  try {
    require('tsx/cjs')
    const { createInitialState } = require(path.join(ROOT, 'packages/core/src/state.ts'))
    const { serializeSaveFile } = require(path.join(ROOT, 'packages/core/src/save.ts'))
    const { buildSimContext } = require(path.join(ROOT, 'packages/data/src/index.ts'))
    const { addShipToFleet } = require(path.join(ROOT, 'packages/core/src/fleetBook.ts'))
    const { fitModule } = require(path.join(ROOT, 'packages/core/src/equipment.ts'))
    const savedAt = Date.now() - 32 * HOUR
    const s = createInitialState({ nowWallMs: savedAt, seed: 1009 })
    s.modeChosen = true
    s.shipId = addShipToFleet(s, 'sh-hammerhead')
    s.moduleBay['mod-wh-a-frag'] = 1
    assert.equal(fitModule(s, 'mod-wh-a-frag', buildSimContext()).ok, true)
    s.warehouse.items['ammo-explosive-3'] = 1000
    s.boostAutoRenew = true
    s.skillBoostUntilMs = 300_000
    s.warehouse.items['synaptic-accelerant'] = 10
    s.skills.trained['offline-ops'] = 5
    s.skills.trained['unattended-dispatch'] = 5
    s.skills.trained['cruiser-ops'] = 4
    s.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
    delete s.skills.progressVersion
    fs.writeFileSync(path.join(profile, 'save.json'), serializeSaveFile(s, savedAt), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    delete env.WHALE_AUTOPERF
    const run = spawnSync(require('electron'), [__filename, '--smoke-child'], {
      cwd: ROOT, env, encoding: 'utf8', windowsHide: true, timeout: 40000,
    })
    console.log(run.stdout)
    if (run.error) throw run.error
    assert.equal(run.status, 0, run.stderr)
    const saved = JSON.parse(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(saved.skills.progressVersion, 1)
    assert.equal(saved.warehouse.items['synaptic-accelerant'], 8)
    assert.equal(saved.fleet[saved.shipId].ammoPref.explosive, 'ammo-explosive-3')
    console.log(JSON.stringify({ ok: true, target: path.join(ROOT, 'apps/desktop/out'), syntheticProfile: true }))
  } finally {
    const resolved = path.resolve(profile)
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('whale-synaptic-smoke-'))
    fs.rmSync(resolved, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0]
    assert(win)
    const errors = []
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) errors.push(message)
    })
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    const untilSaved = async () => {
      for (let i = 0; i < 150; i++) {
        try {
          const ready = await win.webContents.executeJavaScript(`!!document.querySelector('[data-nav-page="skills"]')`)
          if (ready) {
            const text = await win.webContents.executeJavaScript('window.whale.load()')
            const s = JSON.parse(text).state
            if (s.skills.progressVersion === 1 && s.warehouse.items['synaptic-accelerant'] === 8) return s
          }
        } catch {}
        await sleep(100)
      }
      throw new Error('技能加速外壳加载超时：' + errors.join('; '))
    }
    const first = await untilSaved()
    assert.equal(first.skills.trained['cruiser-ops'], 4)
    assert.equal(first.boostAutoRenew, true)
    assert.equal(first.skillBoostUntilMs, 300_000 + 48 * HOUR)
    assert(Math.abs(first.gameMs - 32 * HOUR) < 15_000)
    assert(Math.abs(first.skills.queue[0].progressMs - 64 * HOUR) < 30_000)
    const openFit = async () => {
      const clicked = await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('.app-nav-side button')].find(e=>e.textContent.trim()==='装配');if(!button)return false;button.click();return true})()`)
      assert(clicked, '找不到装配导航')
      for (let i = 0; i < 100; i++) {
        const ready = await win.webContents.executeJavaScript(`document.querySelectorAll('.app-fit-ammotier-row').length===1`)
        if (ready) return
        await sleep(100)
      }
      throw new Error('装配弹药档位加载超时')
    }
    await openFit()
    const ammoRows = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.app-fit-ammotier-row')].map(e=>e.textContent)`)
    assert(ammoRows[0].includes('爆破弹药') && !ammoRows[0].includes('动能弹药'))
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.app-fit-ammotier-opt').length`), 3)
    await win.webContents.executeJavaScript(`document.querySelector('.app-fit-ammotier-opt:last-child').click()`)
    for (let i = 0; i < 100; i++) {
      const text = await win.webContents.executeJavaScript('window.whale.load()')
      if (JSON.parse(text).state.fleet[first.shipId].ammoPref?.explosive === 'ammo-explosive-3') break
      await sleep(100)
    }
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve))
    win.webContents.reload()
    await loaded
    const second = await untilSaved()
    assert.equal(second.skillBoostUntilMs, first.skillBoostUntilMs)
    assert.equal(second.skills.progressVersion, 1)
    assert.equal(second.skills.trained['cruiser-ops'], 4)
    assert.equal(second.fleet[second.shipId].ammoPref.explosive, 'ammo-explosive-3')
    await openFit()
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.app-fit-ammotier-opt[aria-pressed=true]')?.textContent.trim()`), '爆破弹药 MK3')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ ok: true, electronPid: process.pid, hidden: true, migrated: true,
      offlineConsumed: 2, remainMs: second.skillBoostUntilMs - second.gameMs, reloadStock: 8, fragmentAmmoRows: ammoRows,
      explosiveMK3Saved: true, errors }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
