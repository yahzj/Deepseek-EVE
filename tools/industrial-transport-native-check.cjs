/** 生产桌面运输功能/几何冒烟，隐藏窗口和隔离临时档，不接触个人档。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts/hauling-stop-lock-20261101')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function parent() {
  require('tsx/cjs')
  const { industrialTransportFixture } = require('./make-industrial-transport-save.ts')
  const { serializeSaveFile } = require('../packages/core/src/save.ts')
  const { state } = industrialTransportFixture()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-industrial-'))
  await fs.mkdir(OUT, { recursive: true })
  await fs.writeFile(path.join(profile, 'save.json'), serializeSaveFile(state), 'utf8')
  const env = { ...process.env, WHALE_PERF_USERDATA: profile }
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'WHALE_AUTOPERF']) delete env[name]
  const child = spawn(require('electron'), [__filename, '--child'], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true })
  console.log(`运输桌面检查，自有PID=${child.pid}`)
  const timer = setTimeout(() => child.kill(), 90000)
  try {
    const [code] = await once(child, 'exit')
    assert.equal(code, 0, '运输桌面检查失败')
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()))
    assert(path.basename(profile).startsWith('whale-industrial-'))
    assert.equal(await fs.realpath(profile), profile)
    await fs.rm(profile, { recursive: true })
  }
}

async function child() {
  const electron = require('electron')
  const { app, BrowserWindow } = electron
  const profile = path.resolve(process.env.WHALE_PERF_USERDATA)
  assert.equal(path.dirname(profile), path.resolve(os.tmpdir()))
  assert(path.basename(profile).startsWith('whale-industrial-'))
  app.setPath('userData', profile)
  app.setPath('sessionData', profile)
  BrowserWindow.prototype.show = function () {}
  BrowserWindow.prototype.showInactive = function () {}
  class HiddenWindow extends BrowserWindow {
    constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, offscreen: true, backgroundThrottling: false } }) }
  }
  const Module = require('node:module'), original = Module._load
  Module._load = function (request, parent, isMain) {
    return request === 'electron' ? new Proxy(electron, { get: (target, key) => key === 'BrowserWindow' ? HiddenWindow : target[key] }) : original.call(this, request, parent, isMain)
  }
  const errors = []
  const ready = new Promise(resolve => app.once('browser-window-created', (_event, win) => {
    win.webContents.on('console-message', (_event, level, text) => { if (level >= 3) errors.push(text) })
    win.webContents.once('did-finish-load', () => resolve(win))
  }))
  try { require(path.join(ROOT, 'apps/desktop/out/main/index.js')) } finally { Module._load = original }
  const win = await ready
  win.setMinimumSize(200, 200)
  win.setContentSize(1540, 940)
  const js = expression => win.webContents.executeJavaScript(expression)
  const wait = async expression => {
    for (let i = 0; i < 100; i++) { if (await js(expression)) return; await sleep(100) }
    throw new Error(`等待失败:${expression}`)
  }
  await wait('!!document.querySelector(".app-root")')
  await js('document.querySelector(".app-ann .app-ann-head button")?.click()')
  await js('document.querySelector("[data-nav-page=map]").click()')
  await wait('!![...document.querySelectorAll(".app-subtabs button")].find(b=>b.textContent.includes("长途运输"))')
  await js('[...document.querySelectorAll(".app-subtabs button")].find(b=>b.textContent.includes("长途运输")).click()')
  await wait('!!document.querySelector(".app-haul-actions .is-primary")')
  assert.equal(await js('!!document.querySelector(".app-win-body input[type=number]")'), false)
  const savedHaul = async () => JSON.parse(await fs.readFile(path.join(profile, 'save.json'), 'utf8')).state.hauling
  const before = await savedHaul()
  await fs.writeFile(path.join(OUT, 'route-cards.png'), (await win.webContents.capturePage()).toPNG())
  await js('document.querySelector(".app-haul-actions .is-primary").click()')
  await wait('!!document.querySelector(".app-haul-modal input")')
  assert.equal((await savedHaul()).active, false, '仅打开弹窗不能开始运输')
  assert.equal(await js('document.querySelector("[data-haul-risk]").textContent'), '无海盗威胁')
  const geometry = []
  for (const [width, height] of [[1540, 940], [1100, 900], [760, 700]]) {
    win.setContentSize(width, height)
    await sleep(350)
    const row = await js(`(() => {const el=document.querySelector('.app-haul-modal'),r=el.getBoundingClientRect(),input=el.querySelector('input'),form=el.querySelector('form');return {width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,client:form.clientWidth,scroll:form.scrollWidth,max:Number(input.max),value:Number(input.value),focused:document.activeElement===input}})()`)
    assert(row.max > 0 && row.value > 0)
    assert(row.left >= -1 && row.right <= row.width + 1 && row.top >= -1 && row.bottom <= row.height + 1 && row.scroll <= row.client + 1, JSON.stringify(row))
    geometry.push(row)
    await fs.writeFile(path.join(OUT, `transport-${width}.png`), (await win.webContents.capturePage()).toPNG())
  }
  await js('document.querySelector(".app-haul-modal .app-modal-head button").click()')
  await wait('!document.querySelector(".app-haul-modal")')
  assert.deepEqual(await savedHaul(), before, '取消不能修改任务')
  assert.equal(await js('document.activeElement===document.querySelector(".app-haul-actions .is-primary")'), true, '取消后焦点返回')
  await js('[...document.querySelectorAll(".app-haul-row")].find(row=>row.textContent.includes("母港")&&row.textContent.includes("烬火前哨站")).querySelector(".app-haul-actions .is-primary").click()')
  await wait('!!document.querySelector(".app-haul-modal input")')
  const dangerRisk = await js('document.querySelector("[data-haul-risk]").textContent')
  assert.match(dangerRisk, /^约\d+～\d+倍$/)
  await fs.writeFile(path.join(OUT, 'danger-preview.png'), (await win.webContents.capturePage()).toPNG())
  await js('document.querySelector(".app-haul-modal button[type=submit]").focus()')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
  await sleep(100)
  assert.equal(await js('document.activeElement===document.querySelector(".app-haul-modal .app-modal-head button")'), true, 'Tab循环留在弹窗')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await wait('!document.querySelector(".app-haul-modal")')
  assert.equal((await savedHaul()).active, false, 'Escape取消不能出发')
  await js('document.querySelector(".app-haul-actions .is-primary").click()')
  await wait('!!document.querySelector(".app-haul-modal input")')
  const fullReward = await js('document.querySelector(".app-haul-estimate dd").textContent')
  const setInput = async value => js(`(() => {const el=document.querySelector('.app-haul-modal input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  for (const invalid of ['', '0', '-1', '1.5', '999999999']) {
    await setInput(invalid)
    await sleep(80)
    assert.equal(await js('document.querySelector(".app-haul-modal button[type=submit]").disabled'), true, `非法值:${invalid}`)
  }
  await js('[...document.querySelectorAll(".app-haul-presets button")].find(b=>b.textContent==="25%").click()')
  const value = await js('Number(document.querySelector(".app-haul-modal input").value)')
  assert(value > 0)
  assert.notEqual(await js('document.querySelector(".app-haul-estimate dd").textContent'), fullReward, '收益随输入变化')
  assert.equal(await js('/目标威胁|频率倍率|护航降频/.test(document.querySelector(".app-haul-modal").textContent)'), false)
  await js('document.querySelector(".app-haul-modal button[type=submit]").click()')
  await wait('!!document.querySelector(".app-haul-running")')
  await sleep(500)
  const running = await savedHaul()
  assert.equal(running.fleetLeg.loadedM3, value)
  assert.equal(await js('[...document.querySelectorAll(".app-haul-row.is-active button")].some(b=>b.textContent.includes("调整承运量"))'), false)
  await js('[...document.querySelectorAll(".app-haul-row.is-active button")].find(b=>b.textContent.includes("到站后停止")).click()')
  await wait('[...document.querySelectorAll(".app-haul-row.is-active button")].some(b=>b.disabled&&b.textContent.includes("已安排"))')
  await js('[...document.querySelectorAll(".app-haul-row.is-active button")].find(b=>b.textContent.includes("停止运输")).click()')
  await js('[...document.querySelectorAll(".app-haul-row.is-active button")].find(b=>b.textContent.includes("确认中断")).click()')
  await wait('document.querySelector(".app-haul-running")?.textContent.includes("正在折返")')
  assert.equal(await js('document.querySelectorAll(".app-haul-row.is-active button").length'), 0, '折返中不再显示停止或调货按钮')
  await sleep(300)
  const returning = await savedHaul()
  assert.equal(returning.fleetLeg.returning, true)
  assert.equal(returning.fleetLeg.loadedM3, 0)
  await wait('!document.querySelector(".app-haul-running")')
  // 到港由心跳更新内存，文件由60秒自动保存更新；不将上一快照误判成重新出发。
  for (let i = 0; i < 700 && (await savedHaul()).active; i++) await sleep(100)
  assert.equal((await savedHaul()).active, false, '返港后不得自动续运')
  assert.equal(errors.length, 0, errors.join('\n'))
  await fs.writeFile(path.join(OUT, 'report.json'), JSON.stringify({ ok: true, target: 'desktop-production-hidden-isolated', hidden: !win.isVisible(), geometry, selectedM3: value, dangerRisk, keyboardChecked: true, cancelledWithoutMutation: true, invalidInputsRejected: true, inFlightLoadLocked: true, stoppedAndDocked: true, errors,
    limitation: '合成档仅验证运输操作和桌面几何，不代表船长观感或经济平衡验收。' }, null, 2), 'utf8')
  app.exit(0)
}

if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else parent().catch(error => { console.error(error); process.exitCode = 1 })
