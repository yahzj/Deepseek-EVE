/** 真实Electron/便携EXE隔离操作验证，不接触个人存档或正式数据。 */
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { execFileSync, spawn } = require('node:child_process')
const { JourneyPage, CdpConnection, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..')
const FIXTURE = path.join(ROOT, 'tools', '_data-editor', 'ui-fixture')
const OUT = path.join(ROOT, 'tools', '_ui-artifacts')
const JSON_FILE = 'packages/data/src/static/market.json'
async function copyFixture() {
  assert(FIXTURE.startsWith(path.join(ROOT, 'tools', '_data-editor') + path.sep))
  try { await fs.stat(path.join(FIXTURE, '.git')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    await fs.mkdir(path.dirname(FIXTURE), { recursive: true })
    const branch = `dsh/data-editor-check-${Date.now()}`
    execFileSync('git', ['worktree', 'add', '-b', branch, FIXTURE, 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
  }
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean)
  for (const file of files) {
    if (/^(tools\/_|docs\/exports|content-csv|docs\/test-saves\/(?!test-save-))/.test(file) || /(^|\/)(node_modules|out|dist|release)\//.test(file)) continue
    try { await fs.mkdir(path.dirname(path.join(FIXTURE, file)), { recursive: true }); await fs.copyFile(path.join(ROOT, file), path.join(FIXTURE, file)) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  try { await fs.symlink(path.join(ROOT, 'node_modules'), path.join(FIXTURE, 'node_modules'), 'junction') }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
async function enter(page, selector, value) {
  await page.tap(selector)
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 })
  await page.send('Input.insertText', { text: String(value) })
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' })
}
async function field(page, name) {
  await page.wait(`!![...document.querySelectorAll('.number-field')].find(el=>el.querySelector('code')?.textContent===${JSON.stringify(name)})`)
  return page.js(`(()=>{const el=[...document.querySelectorAll('.number-field')].find(el=>el.querySelector('code')?.textContent===${JSON.stringify(name)});return '#'+CSS.escape(el.querySelector('input').id)})()`)
}
async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false })
  await fs.writeFile(path.join(OUT, name), Buffer.from(result.data, 'base64'))
}
async function blueprintChecks(page, target) {
  require('tsx/cjs')
  const { BLUEPRINTS, SHIP_BLUEPRINTS } = require('../packages/data/src/index.ts')
  const names = new Map([...BLUEPRINTS, ...SHIP_BLUEPRINTS].map(row => [row.id, row.name]))
  const raw = await fs.readFile(path.join(ROOT, JSON_FILE))
  const expected = Object.values(JSON.parse(raw).groups).flat().filter(row => row.kind === 'blueprint')
  await page.wait('!!document.querySelector(".editor-shell")')
  assert(await page.js('!!window.dataEditor'), '真实preload桥未连接')
  await enter(page, '#project-root', ROOT)
  await page.text('.project-bar', '加载')
  await page.wait('!!document.querySelector(".project-meta")', 30000)
  await page.tap('.table-sidebar nav button:nth-child(5)')
  const category = '.list-filters select:first-of-type'
  await page.tap(category)
  for (const key of ['Home', 'ArrowDown', 'ArrowDown', 'Enter']) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
  }
  await page.wait(`document.querySelector(${JSON.stringify(category)})?.value==='blueprint'`)
  await page.wait(`document.querySelectorAll('.records tbody tr').length===${expected.length}`)
  const displayed = await page.js(`([...document.querySelectorAll('.records tbody tr')].map(row=>({id:row.querySelector('td>code').textContent,name:row.querySelector('.record-name').textContent})))`)
  const byKey = new Map(expected.map(row => [row.key, names.get(row.refId)]))
  for (const row of displayed) assert.equal(row.name, byKey.get(row.id), `蓝图未正确命名：${row.id}`)
  const samples = []
  for (const id of ['bp-miner-1', 'sbp-pioneer', 'sbp-manatee']) {
    const record = expected.find(row => row.refId === id)
    assert(record, `缺少验收蓝图：${id}`)
    const name = names.get(id)
    const selector = await page.js(`'#'+CSS.escape(${JSON.stringify(`row-${encodeURIComponent(JSON.stringify(['market', record.key]))}`)})`)
    for (const query of [name, record.key]) {
      await enter(page, 'input[aria-label="搜索名称、ID 或类别"]', query)
      await page.wait(`!!document.querySelector(${JSON.stringify(selector)})`)
      await page.tap(selector)
      assert.equal(await page.js('document.querySelector("#inspector-heading")?.textContent'), name)
      samples.push({ id: record.key, query, name })
    }
  }
  assert.deepEqual(await fs.readFile(path.join(ROOT, JSON_FILE)), raw, '名称检查不应改商品参数')
  return { target, blueprintRows: expected.length, namedRows: displayed.length, categoryFiltered: true, samples, dataUnchanged: true }
}
async function workflow(page, target) {
  const before = await fs.readFile(path.join(FIXTURE, JSON_FILE))
  await page.wait('!!document.querySelector(".editor-shell")')
  assert(await page.js('!!window.dataEditor'), '真实preload桥未连接')
  await enter(page, '#project-root', FIXTURE)
  await page.text('.project-bar', '加载')
  await page.wait('document.querySelector(".project-meta")?.textContent.includes("可编辑")', 30000)
  await page.js('window.__evidence=[]; for(const kind of ["input","click"])document.addEventListener(kind,e=>window.__evidence.push({kind,trusted:e.isTrusted}),true)')
  await page.tap('.table-sidebar nav button:nth-child(5)')
  await enter(page, 'input[aria-label="搜索名称、ID 或类别"]', 'mod-miner-civ')
  await page.wait('document.querySelectorAll(".records tbody tr").length===1')
  await page.tap('.records tbody tr')
  let selector = await field(page, 'demandMultiplier')
  await enter(page, selector, '0.61')
  await page.wait('document.querySelector(".bottom-panel")?.textContent.includes("0.61")')
  await page.tap('[aria-label="撤销草稿"]')
  await page.wait('document.querySelector(".status-bar")?.textContent.includes("无未保存更改")')
  await page.tap('[aria-label="重做草稿"]')
  await page.wait('document.querySelector(".bottom-panel")?.textContent.includes("0.61")')
  await page.wait('!![...document.querySelectorAll(".toolbar-actions button")].find(b=>b.textContent.includes("保存")&&!b.disabled)')
  await page.tap('.toolbar-actions button.primary')
  console.log(JSON.stringify({ target, stage: 'real-save-checking' }))
  await page.wait('document.querySelector(".status-bar")?.textContent.includes("JSON参数已保存")||!!document.querySelector(".error-summary")', 600000)
  assert.equal(await page.js('!!document.querySelector(".error-summary")'), false, await page.js('document.querySelector(".error-summary")?.innerText??""'))
  const saved = JSON.parse(await fs.readFile(path.join(FIXTURE, JSON_FILE), 'utf8'))
  assert.equal(Object.values(saved.groups).flat().find(row => row.key === 'mod-miner-civ').demandMultiplier, 0.61)
  for (const [width, height, scale] of [[1320, 860, 1], [1040, 700, 1], [800, 520, 1.5]]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
    await sleep(150)
    const geometry = await page.js(`(()=>{const root=document.querySelector('.editor-shell'),box=root.getBoundingClientRect();return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+2||document.documentElement.scrollHeight>innerHeight+2,box:{width:box.width,height:box.height}}})()`)
    assert.equal(geometry.overflow, false, '页面发生整体溢出')
    if (!process.argv.includes('--no-screenshots')) await screenshot(page, `data-editor-${target}-${width}-${height}.png`)
  }
  selector = await field(page, 'basePrice')
  await enter(page, selector, '-10')
  await page.wait('document.querySelector(".error-summary")?.textContent.includes("不得小于")')
  assert.equal(await page.js('document.querySelector(".toolbar-actions button.primary").disabled'), true)
  await enter(page, selector, '9000')
  await page.wait('!document.querySelector(".error-summary")')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 860, deviceScaleFactor: 1, mobile: false })
  await page.text('.table-sidebar', '恢复最近备份')
  await page.wait('document.querySelector(".status-bar")?.textContent.includes("已恢复本次保存前")', 30000)
  assert.deepEqual(await fs.readFile(path.join(FIXTURE, JSON_FILE)), before, '恢复未逐字返回原文')
  const evidence = await page.js('window.__evidence')
  assert(evidence.filter(event => event.kind === 'input' && event.trusted).length >= 2)
  return { target, bridge: true, save: true, restoredBytes: true, inputTrusted: true, negativeBlocked: true, viewports: 3 }
}
async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const blueprintsOnly = process.argv.includes('--blueprints-only')
  if (!blueprintsOnly) await copyFixture()
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-data-editor-ui-'))
  const packaged = process.argv.includes('--portable')
  const exe = packaged ? path.join(ROOT, 'apps/data-editor/release/大鲸鱼数据编辑器-0.1.0-x64.exe') : require('electron')
  const socketServer = net.createServer()
  await new Promise(resolve => socketServer.listen(0, '127.0.0.1', resolve))
  const port = socketServer.address().port
  await new Promise(resolve => socketServer.close(resolve))
  const args = packaged ? [`--remote-debugging-port=${port}`] : [__filename, '--child', `--remote-debugging-port=${port}`]
  const env = { ...process.env, WHALE_DATA_EDITOR_HIDDEN: '1', WHALE_DATA_EDITOR_USERDATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env })
  let log = '', connection, ws
  child.stdout.on('data', data => { log = (log + data).slice(-12000) }); child.stderr.on('data', data => { log = (log + data).slice(-12000) })
  console.log(`自有编辑器启动PID ${child.pid}`)
  const report = { success: false, launcherPid: child.pid, target: packaged ? 'portable' : 'native' }
  try {
    let targets
    for (let retry = 0; retry < 300; retry++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break } catch {}; await sleep(100) }
    const target = targets?.find(t => t.type === 'page')
    assert(target, `编辑器未启动:${log}`)
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
    connection = new CdpConnection(ws)
    const send = (method, params) => connection.send(method, params)
    const page = new JourneyPage(send)
    await send('Runtime.enable'); await send('Page.enable')
    connection.ws.addEventListener('message', event => { const message = JSON.parse(String(event.data)); if (message.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true }) })
    report.workflow = blueprintsOnly ? await blueprintChecks(page, report.target) : await workflow(page, report.target)
    report.errors = connection.errors
    assert.equal(report.errors.length, 0)
    report.success = true
  } catch (error) {
    report.failure = error.stack; report.log = log
    if (connection) await screenshot(new JourneyPage((method, params) => connection.send(method, params)), `data-editor-${report.target}-failure.png`).catch(() => {})
    console.error(error); process.exitCode = 1
  }
  finally {
    if (connection) { await connection.send('Browser.close').catch(() => {}) }
    ws?.close()
    for (let i = 0; i < 100 && child.exitCode === null; i++) await sleep(100)
    if (child.exitCode === null) child.kill()
    report.exited = child.exitCode !== null
    await fs.writeFile(path.join(OUT, `data-editor-${report.target}${blueprintsOnly ? '-blueprints' : ''}-check.json`), JSON.stringify(report, null, 2) + '\n')
  }
  console.log(JSON.stringify(report))
}
async function child() {
  const { BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/data-editor/out/main/index.js'))
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else main().catch(error => { console.error(error); process.exitCode = 1 })
