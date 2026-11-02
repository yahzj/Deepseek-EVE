/**
 * 编队解锁通讯桌面冒烟：npm run build 后运行 node tools/fleet-command-unlock-native-check.cjs。
 * 本树生产文件、隐藏 Electron、独立合成档；验证弹窗和收件箱都跳到舰船/编队指挥。
 * 输出 tools/_ui-artifacts/fleet-command-unlock/report.json，不读取个人档，只清理自建进程与目录。
 * 加 --licenses 核对三项许可的声望差1/达标、详情与列表、真实扣款和IPC保存。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/fleet-command-unlock')
const PREFIX = 'whale-fleet-command-unlock-'
const ID = 'msg-fleet-command-unlock'
const LICENSES = [
  { id: 'fleet-command-basic', standing: 20, price: 50_000, rank: 2 },
  { id: 'fleet-command-coordination', standing: 40, price: 200_000, rank: 3 },
  { id: 'fleet-command-integration', standing: 60, price: 2_000_000, rank: 5 },
]
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent(licenseCase) {
  require('tsx/cjs')
  const core = require('../packages/core/src/index.ts')
  const data = require('../packages/data/src/index.ts')
  const state = core.createInitialState({ nowWallMs: Date.now(), seed: 20261031 })
  state.modeChosen = true
  state.onboarding.step = 99
  state.standingsEarned = { dsi: core.COMMAND_STANDING_REQUIRED }
  state.standings.dsi = 0
  for (const task of core.FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  // 已读其余消息，只保留本次需要实际触发的新信，避免无关弹层影响跳转核对。
  state.commsDelivered = Object.fromEntries(data.COMMS_MESSAGES.filter(row => row.id !== ID).map(row => [row.id, 0]))
  state.commsRead = Object.fromEntries(Object.keys(state.commsDelivered).map(id => [id, true]))
  if (licenseCase) {
    state.wallet.isk = 10_000_000
    state.standingsEarned = { dsi: licenseCase.earned }
    state.standings.dsi = licenseCase.canBuy ? 0 : 999
    state.skills.trained = {}
    const def = data.buildSimContext().skills.get(licenseCase.id)
    for (const parent of def.prereq ?? []) state.skills.trained[parent] = 3
    state.commsDelivered[ID] = 0
    state.commsRead[ID] = true
    licenseCase = { ...licenseCase, name: def.name }
  }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX))
  let child, timer
  try {
    await fs.writeFile(path.join(profile, 'save.json'), core.serializeSaveFile(state, Date.now()), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile, WHALE_FLEET_UNLOCK_CHECK: '1' }
    if (licenseCase) env.WHALE_FLEET_LICENSE_CASE = JSON.stringify(licenseCase)
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'WHALE_AUTOPERF', 'NODE_OPTIONS']) delete env[key]
    child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
    timer = setTimeout(() => child.kill(), 60_000)
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    if (licenseCase) return JSON.parse(await fs.readFile(path.join(OUT, `license-${licenseCase.id}-${licenseCase.earned}.json`), 'utf8'))
    console.log(`编队通讯桌面检查通过：${path.join(OUT, 'report.json')}`)
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
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA ?? '')
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith(PREFIX))
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  const errors = []
  const loaded = new Promise((resolve, reject) => {
    app.once('browser-window-created', (_event, win) => {
      win.webContents.on('render-process-gone', (_event, details) => reject(new Error(JSON.stringify(details))))
      win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
      win.webContents.once('did-finish-load', () => resolve(win))
    })
  })
  require(path.join(ROOT, 'apps/desktop/out/main/index.js'))
  const win = await loaded
  win.setContentSize(1540, 940)
  assert.equal(app.getPath('userData'), profile)
  assert.equal(win.isVisible(), false)
  const js = expression => win.webContents.executeJavaScript(expression)
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await js(expression)) return
      await sleep(100)
    }
    throw new Error(`界面等待失败：${expression}`)
  }
  await waitFor('!!document.querySelector(".app-root")')
  if (process.env.WHALE_FLEET_LICENSE_CASE) {
    const row = JSON.parse(process.env.WHALE_FLEET_LICENSE_CASE)
    await js('document.querySelector(".app-ann .app-ann-head button")?.click()')
    await js('document.querySelector("[data-nav-page=skills]").click()')
    await waitFor('!!document.querySelector(".app-skilltree-nav")')
    await js(`([...document.querySelectorAll('.app-skilltree-nav button')].find(button => button.innerText === '舰船')).click()`)
    await js(`([...document.querySelectorAll('.app-skilltree-books button')].find(button => button.innerText === '编队指挥')).click()`)
    await js(`([...document.querySelectorAll('.app-skilltree-hex')].find(node => node.getAttribute('data-tip').startsWith(${JSON.stringify(row.name + ' ·')}))).dispatchEvent(new MouseEvent('click', { bubbles: true }))`)
    const selector = `[data-skill-license="${row.id}"]`
    await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`)
    const readButton = () => js(`(()=>{
      const button = document.querySelector(${JSON.stringify(selector)})
      return { disabled: button.disabled, label: button.innerText, text: button.parentElement.innerText }
    })()`)
    const detail = await readButton()
    assert.equal(detail.disabled, !row.canBuy)
    assert(detail.label.includes(row.price.toLocaleString('zh-CN')))
    assert(detail.text.includes(`需协会声望 ${row.standing}（累计 ${row.earned}）`))
    assert((await js('document.querySelector(".app-skilltree-modal .app-modal-head").innerText')).includes(`难度 ${row.rank}`))
    await js('document.querySelector(".app-skilltree-modal .app-modal-head button").click()')
    await js(`([...document.querySelectorAll('.app-hand-viewbar button')].find(button => button.innerText === '列表')).click()`)
    await waitFor('!!document.querySelector(".app-skilltree-catalog")')
    const list = await readButton()
    assert.equal(list.disabled, detail.disabled)
    assert.equal(list.label, detail.label)
    win.setContentSize(1100, 900)
    await sleep(150)
    const narrow = await js(`(()=>{
      const button = document.querySelector(${JSON.stringify(selector)})
      const panel = button.closest('.wui-panel-body').getBoundingClientRect()
      const controls = button.parentElement.getBoundingClientRect()
      return { panelWidth: panel.width, controlsWidth: controls.width, left: controls.left - panel.left,
        right: controls.right - panel.right }
    })()`)
    assert(narrow.left >= -1 && narrow.right <= 1, `窄窗许可控件越界：${JSON.stringify(narrow)}`)
    win.setContentSize(1540, 940)
    await sleep(100)
    let persisted = null
    if (row.canBuy) {
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
      assert((await readButton()).label.includes('确认'))
      await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
      await waitFor(`!document.querySelector(${JSON.stringify(selector)})`)
      for (let i = 0; i < 60; i++) {
        const save = JSON.parse(await fs.readFile(path.join(profile, 'save.json'), 'utf8'))
        if (save.state.skills.licenses?.[row.id]) { persisted = save.state; break }
        await sleep(100)
      }
      assert(persisted, '许可购买未通过IPC保存')
      assert.equal(persisted.wallet.isk, 10_000_000 - row.price)
      assert.equal(persisted.standingsEarned.dsi, row.earned)
      assert.equal(persisted.standings.dsi, 0)
      assert.equal(persisted.skills.trained[row.id] ?? 0, 0)
    }
    assert.equal(errors.length, 0, errors.join('\n'))
    await fs.mkdir(OUT, { recursive: true })
    await fs.writeFile(path.join(OUT, `license-${row.id}-${row.earned}.json`), JSON.stringify({ ok: true, isolated: true,
      target: 'desktop-production-hidden', ...row, detail, list, narrow, saved: persisted ? { isk: persisted.wallet.isk,
        licensed: persisted.skills.licenses[row.id], earned: persisted.standingsEarned.dsi, spendable: persisted.standings.dsi } : null,
      errors }, null, 2) + '\n', 'utf8')
    app.exit(0)
    return
  }
  await waitFor('!!document.querySelector(".app-comm-pop .app-comms-goto")')
  await js('document.querySelector(".app-ann .app-ann-head button")?.click()')
  const popupText = await js('document.querySelector(".app-comm-pop").innerText')
  assert(popupText.includes('多舰编队权限已开放'))
  assert(popupText.includes('累计声望已达到20'))
  await js('document.querySelector(".app-comm-pop .app-comms-goto").click()')
  const skillView = async () => {
    await waitFor('document.querySelector(".app-skilltree-books button[aria-selected=true]")?.innerText === "编队指挥"')
    return js(`({
      group: document.querySelector('.app-skilltree-nav > .app-tasktabs button[aria-selected=true]')?.innerText,
      branch: document.querySelector('.app-skilltree-books button[aria-selected=true]')?.innerText,
      nodes: [...document.querySelectorAll('.app-skilltree-hex')].map(node => ({ name: node.getAttribute('data-tip'), dimmed: node.classList.contains('is-dimmed') })),
      search: document.querySelector('.app-head-search')?.value
    })`)
  }
  const fromPopup = await skillView()
  assert.equal(fromPopup.group, '舰船')
  assert.equal(fromPopup.nodes.length, 3)
  assert(fromPopup.nodes.every(node => !node.dimmed))
  assert.equal(fromPopup.search, '')
  await js('document.querySelector("[data-nav-page=comms]").click()')
  await waitFor('!!document.querySelector(".app-comms-device")')
  await js(`([...document.querySelectorAll('.app-comms-subject')].find(node => node.innerText === '多舰编队权限已开放')).closest('button').click()`)
  await js('document.querySelector(".app-comms-device .app-comms-goto").click()')
  const fromInbox = await skillView()
  assert.deepEqual(fromInbox, fromPopup)
  assert.equal(errors.length, 0, errors.join('\n'))
  await fs.mkdir(OUT, { recursive: true })
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, target: 'desktop-production-hidden',
    isolated: true, electron: process.versions.electron, fromPopup, fromInbox, errors }, null, 2) + '\n', 'utf8')
  app.exit(0)
}

if (process.argv.includes('--child') && process.env.WHALE_FLEET_UNLOCK_CHECK === '1') {
  child().catch(error => { console.error(error); require('electron').app.exit(1) })
} else (async () => {
  if (!process.argv.includes('--licenses')) return parent()
  const cases = []
  for (const row of LICENSES) for (const canBuy of [false, true]) {
    cases.push(await parent({ ...row, earned: row.standing - (canBuy ? 0 : 1), canBuy }))
  }
  await fs.writeFile(path.join(OUT, 'license-report.json'), JSON.stringify({ ok: true, cases }, null, 2) + '\n', 'utf8')
  console.log(`六组编队许可桌面检查通过：${path.join(OUT, 'license-report.json')}`)
})().catch(error => { console.error(error); process.exitCode = 1 })
