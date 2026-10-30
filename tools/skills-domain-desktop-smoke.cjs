/** 技能域拆分的桌面产物回归。
 * 用法：构建后node tools/skills-domain-desktop-smoke.cjs。
 * 隐藏自建窗口与独立合成档；真实鼠标/键盘测试中英技能树、许可、队列和加速，检查IPC保存重载。
 * 输入：当前桌面构建；报告：tools/_ui-artifacts/skills-domain-desktop-smoke.json。不读个人档，不作观感验收。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { JourneyPage, settingsScript, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const { dismissOverlays } = require('./wormhole-expedition-template-ui.cjs')
const root = path.resolve(__dirname, '..')
const prefix = 'whale-skills-domain-smoke-'

async function parent() {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 7 })
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.modeChosen = true
  state.onboarding = { ...state.onboarding, step: 99 }
  state.wallet.isk = 10_000_000
  state.warehouse.items['synaptic-accelerant'] = 3
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  let child, timer
  try {
    fs.writeFileSync(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()))
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ELECTRON_RENDERER_URL
    delete env.WHALE_AUTOPERF
    child = spawn(require('electron'), [__filename, '--smoke-child'], { cwd: root, env, stdio: 'inherit', windowsHide: true })
    console.log('自建技能检查Electron PID', child.pid)
    timer = setTimeout(() => child.kill(), 90000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    const saved = core.loadSaveFile(fs.readFileSync(path.join(profile, 'save.json'), 'utf8')).state
    assert.equal(saved.skills.licenses['accelerated-learning'], true)
    assert.deepEqual(saved.skills.queue.map(q => [q.skillId, q.targetLevel]), [['accelerated-learning', 1]])
    assert.equal(saved.warehouse.items['synaptic-accelerant'], 2)
    assert.equal(saved.boostAutoRenew, true)
    assert(saved.skillBoostUntilMs > saved.gameMs)
    console.log('合成档许可、队列、加速库存与续用开关真实IPC往返一致')
  } finally {
    clearTimeout(timer)
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill(); await stopped
    }
    const target = path.resolve(profile)
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith(prefix))
    fs.rmSync(target, { recursive: true, force: true })
  }
}

async function child() {
  require('tsx/cjs')
  const data = require('../packages/data/src/index.ts')
  const core = require('../packages/core/src/index.ts')
  const { app, BrowserWindow } = require('electron')
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert(profile.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(profile).startsWith(prefix))
  BrowserWindow.prototype.show = function () {}
  require(path.join(root, 'apps/desktop/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  assert(win)
  win.setContentSize(1366, 768)
  win.webContents.debugger.attach('1.3')
  const errors = []
  win.webContents.debugger.on('message', (_e, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  await page.send('Runtime.enable')
  const saveFile = path.join(profile, 'save.json')
  const savedState = () => core.loadSaveFile(fs.readFileSync(saveFile, 'utf8')).state
  const persist = async () => {
    const before = JSON.parse(fs.readFileSync(saveFile, 'utf8')).savedAtWallMs
    await page.js('window.dispatchEvent(new Event("pagehide"));true')
    for (let n = 0; n < 50 && JSON.parse(fs.readFileSync(saveFile, 'utf8')).savedAtWallMs <= before; n++) await sleep(100)
    assert(JSON.parse(fs.readFileSync(saveFile, 'utf8')).savedAtWallMs > before, '未确认真实IPC保存')
  }
  const reload = async () => {
    const loaded = once(win.webContents, 'did-finish-load')
    win.webContents.reload(); await loaded
    await page.wait('!!document.querySelector(".app-root")')
    await dismissOverlays(page)
  }
  const input = async value => {
    await page.tap('.app-head-search')
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
    await page.send('Input.insertText', { text: value })
    await page.wait(`document.querySelector('.app-head-search').value===${JSON.stringify(value)}`)
  }
  const results = []
  for (const locale of ['zh', 'en']) {
    const ctx = data.buildSimContext(locale)
    const skill = ctx.skills.get('accelerated-learning')
    const t = (id, params = {}) => data.L10N[id][locale].replace(/\{(\w+)\}/g, (whole, key) => String(params[key] ?? whole))
    await page.wait('!!document.querySelector(".app-root")')
    await page.js(settingsScript(data.ANNOUNCEMENTS[0].id, undefined, { locale, debug: false, test: false }))
    await reload()
    await page.tap('[data-nav-page="skills"]')
    await page.wait('!!document.querySelector(".app-skilltree-canvas")')
    // 组和分支标签读现有按钮，避免复制英文映射或依赖屏幕坐标。
    await page.js(`(()=>{const buttons=[...document.querySelectorAll('.app-skilltree-nav .app-tasktabs button')];buttons[${data.SKILL_GROUPS.indexOf('工程')}].setAttribute('data-skills-group','1')})()`)
    await page.tap('[data-skills-group]')
    const count = await page.js('document.querySelectorAll(".app-skilltree-hex").length')
    assert.equal(count, [...ctx.skills.values()].filter(s => s.group === '工程').length)
    await input('__no_skill__')
    await page.wait(`document.querySelectorAll('.app-skilltree-hex.is-dimmed').length===${count}`)
    await input(skill.name)
    await page.wait('document.querySelectorAll(".app-skilltree-hex:not(.is-dimmed)").length===1')
    await page.text('.app-hand-viewbar', t('ui.Handbook.016'))
    await page.wait('document.querySelectorAll(".app-skill-row").length===1')
    await page.text('.app-skilltree-catalog', skill.name)
    await page.wait('!!document.querySelector(".app-skilltree-modal")')
    if (locale === 'zh') {
      const price = core.skillLicensePriceOf(skill).toLocaleString('zh-CN')
      await persist()
      const wallet = savedState().wallet.isk
      await page.text('.app-skilltree-modal', t('ui.SkillTree.023', { p1: price }))
      await persist()
      assert.equal(savedState().wallet.isk, wallet)
      assert.notEqual(savedState().skills.licenses?.[skill.id], true)
      await page.text('.app-skilltree-modal', t('ui.SkillTree.026', { p1: price }))
      await page.text('.app-skilltree-modal', t('ui.SkillsPage.035', { p1: 1 }))
      await page.text('.app-modal-head', t('ui.App.086'))
      await page.text('.app-hand-viewbar', t('ui.Handbook.015'))
      await input(skill.name)
      await page.tap('.app-skilltree-hex:not(.is-dimmed)')
      await page.wait('!!document.querySelector(".app-skilltree-modal")')
      await page.text('.app-skilltree-modal', t('ui.SkillsPage.034', { p1: 2 }))
      await page.text('.app-modal-head', t('ui.App.086'))
      await page.tap('.page-stack > .app-subtabs > button:nth-child(2)')
      await page.wait('document.querySelectorAll(".app-train-chip").length===2')
      await page.tap('.app-train-chip:not(.is-head) .app-train-x')
      await page.wait('document.querySelectorAll(".app-train-chip").length===1')
      await page.tap('.page-stack > .app-subtabs > button:nth-child(3)')
      await page.text('.app-boost-block', t('ui.ItemsPage.056'))
      await page.wait('!!document.querySelector(".app-boost-now.is-on")')
      await page.text('.app-boost-block', t('ui.boost.011'))
    } else {
      assert.equal(await page.js(`document.querySelector('.app-skilltree-modal .app-report-title').firstChild.textContent`), skill.name)
      await page.text('.app-modal-head', t('ui.App.086'))
      await page.tap('.page-stack > .app-subtabs > button:nth-child(2)')
      await page.wait('document.querySelectorAll(".app-train-chip").length===1')
      assert((await page.js('document.querySelector(".app-train-name").textContent')).includes(skill.name))
      await page.tap('.page-stack > .app-subtabs > button:nth-child(3)')
      await page.wait('document.querySelector(".app-boost-now button").getAttribute("aria-pressed")==="true"')
    }
    await persist()
    assert.equal(savedState().wallet.isk, 10_000_000 - core.skillLicensePriceOf(skill))
    assert.equal(savedState().warehouse.items['synaptic-accelerant'], 2)
    results.push({ locale, engineeringNodes: count, search: true, list: true, detail: true, queue: true, boost: true })
  }
  assert.deepEqual(errors, [])
  const report = { ok: true, target: 'desktop-production', syntheticOnly: true, hidden: true, results, IPCSaved: true, reloaded: true, runtimeErrors: 0 }
  fs.mkdirSync(path.join(root, 'tools/_ui-artifacts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tools/_ui-artifacts/skills-domain-desktop-smoke.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  app.exit(0)
}

if (process.argv.includes('--smoke-child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
