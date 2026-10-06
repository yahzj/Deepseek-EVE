/** 隐藏Electron实际窗口几何与capturePage，独立于保存测试，不访问游戏个人档。 */
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { JourneyPage, sleep } = require('./wormhole-expedition-journey-shared.cjs')
const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'tools/_ui-artifacts')
async function child() {
  const { app, BrowserWindow } = require('electron')
  BrowserWindow.prototype.show = function () {}
  require(path.join(ROOT, 'apps/data-editor/out/main/index.js'))
  await app.whenReady()
  const win = BrowserWindow.getAllWindows()[0]
  win.webContents.debugger.attach('1.3')
  const page = new JourneyPage((method, params = {}) => win.webContents.debugger.sendCommand(method, params))
  const errors = []
  win.webContents.debugger.on('message', (_event, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params) })
  await page.send('Runtime.enable')
  await page.wait('!!document.querySelector(".editor-shell")')
  await page.tap('#project-root')
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2, commands: ['selectAll'] })
  await page.send('Input.insertText', { text: ROOT })
  await page.text('.project-bar', '加载')
  await page.wait('!!document.querySelector(".project-meta")', 30000)
  const blueprintsOnly = process.argv.includes('--blueprints-only')
  if (blueprintsOnly) {
    await page.tap('.table-sidebar nav button:nth-child(5)')
    await page.tap('.list-filters select:first-of-type')
    for (const key of ['Home', 'ArrowDown', 'ArrowDown', 'Enter']) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key })
    }
    await page.wait('document.querySelector(".list-filters select").value==="blueprint"')
    await page.wait('document.querySelector(".record-name")?.textContent.includes("蓝图")')
  }
  await page.tap('.records tbody tr')
  const rows = []
  for (const [width, height] of [[1320, 860], [1040, 700], [800, 520]]) {
    win.setContentSize(width, height)
    await sleep(300)
    const geometry = await page.js(`(()=>{const fixed=['.app-toolbar','.project-bar','.table-sidebar','.record-pane','.inspector','.bottom-panel','.status-bar'];return {w:innerWidth,h:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth+2||document.documentElement.scrollHeight>innerHeight+2,boxes:fixed.map(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return {selector,left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height}})}})()`)
    assert.equal(geometry.overflow, false)
    for (const box of geometry.boxes) assert(box.width > 10 && box.height > 10 && box.left >= -1 && box.top >= -1 && box.right <= geometry.w + 1 && box.bottom <= geometry.h + 1)
    const image = await win.webContents.capturePage(undefined, { stayHidden: true })
    assert(!image.isEmpty(), '编辑器实际窗口截图为空')
    const bitmap = image.toBitmap()
    const colors = new Set()
    for (let i = 0; i < bitmap.length; i += 128) colors.add(bitmap.readUInt32LE(i))
    assert(colors.size > 12, '编辑器窗口为空白')
    const file = `data-editor${blueprintsOnly ? '-blueprints' : ''}-window-${width}-${height}.png`
    await fs.writeFile(path.join(OUT, file), image.toPNG())
    rows.push({ width, height, geometry, file, colors: colors.size })
  }
  assert.equal(errors.length, 0)
  await fs.writeFile(path.join(OUT, `data-editor${blueprintsOnly ? '-blueprints' : ''}-visual-check.json`), JSON.stringify({ success: true, pid: process.pid, rows, errors }, null, 2) + '\n')
  console.log(JSON.stringify({ success: true, pid: process.pid, viewports: rows.length }))
  win.webContents.debugger.detach()
  app.quit()
}
async function main() {
  await fs.mkdir(OUT, { recursive: true })
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'whale-data-editor-visual-'))
  const env = { ...process.env, WHALE_DATA_EDITOR_HIDDEN: '1', WHALE_DATA_EDITOR_USERDATA: profile }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [__filename, '--child', ...process.argv.slice(2)], { env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] })
  console.log(`自有布局核对Electron PID ${child.pid}`)
  const timeout = setTimeout(() => child.kill(), 90000)
  await new Promise((accept, reject) => { child.on('error', reject); child.on('close', code => { clearTimeout(timeout); code === 0 ? accept() : reject(new Error(`布局核对退出${code}`)) }) })
}
if (process.argv.includes('--child')) child().catch(error => { console.error(error); require('electron').app.exit(1) })
else main().catch(error => { console.error(error); process.exitCode = 1 })
