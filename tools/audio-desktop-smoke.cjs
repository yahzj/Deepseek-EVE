/**
 * **声音系统冒烟（桌面打包产物 · Electron）** —— 2026-11-02 入库的正式工具。
 *
 * 用途：改音效相关代码或素材后，验证**发布形态**（`file://` + CSP）真的能出声：
 * 直接加载真实主进程产物（`apps/desktop/out/main/index.js`，含存档 IPC），只接管它创建的窗口：
 * ① 界面能起；② 发布门禁下 `window.__whaleSfx` 不暴露（音效台对玩家不可见）；
 * ③ `file://` 下内置音频（`<audio src>`）与 blob 音频（本机覆盖）都能起播；④ 无 console error。
 * userData 指向临时目录（ready 前 `app.setPath`），**不碰个人真档**。
 *
 * 前置：`npm run build`（本工具读 `apps/desktop/out/`）。
 * 用法：`npm run audio:smoke:desktop`
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ROOT = path.join(__dirname, '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-sfx-e2e-'))
app.setPath('userData', tmpDir)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

/** 生成 0.2s 正弦 WAV（写进产物目录，测 file:// 内置音频；测完删） */
function makeWav() {
  const rate = 8000
  const n = Math.floor(rate * 0.2)
  const bytes = Buffer.alloc(44 + n * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(36 + n * 2, 4)
  bytes.write('WAVE', 8)
  bytes.write('fmt ', 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24)
  bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) bytes.writeInt16LE(Math.round(Math.sin((i / rate) * Math.PI * 2 * 440) * 3000), 44 + i * 2)
  return bytes
}
const probeWavPath = path.join(ROOT, 'apps/desktop/out/renderer/assets/_probe-tone.wav')
fs.writeFileSync(probeWavPath, makeWav())

const consoleErrors = []
let failures = 0
function check(ok, msg) {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failures++
}

// 真实主进程：注册存档 IPC、创建窗口、加载 out/renderer/index.html（file://）
require(path.join(ROOT, 'apps/desktop/out/main/index.js'))

app.whenReady().then(async () => {
  let win = null
  for (let i = 0; i < 100 && win === null; i++) {
    win = BrowserWindow.getAllWindows()[0] ?? null
    if (win === null) await sleep(100)
  }
  if (win === null) {
    console.log('✗ 主进程没有创建窗口')
    app.exit(1)
    return
  }
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) consoleErrors.push(message)
  })
  for (let i = 0; i < 100 && win.webContents.isLoading(); i++) await sleep(100)
  await sleep(5000)

  const result = await win.webContents.executeJavaScript(
    `(async () => {
      const out = {}
      out.appRoot = !!document.querySelector('.app-root')
      out.sfxApi = typeof window.__whaleSfx

      // file:// 内置音频（<audio src>，CSP media-src 'self'）
      const a1 = new Audio('./assets/_probe-tone.wav')
      a1.volume = 0.01
      try { await a1.play(); await new Promise(r => setTimeout(r, 120)); a1.pause(); out.filePlay = 'ok' }
      catch (e) { out.filePlay = 'fail:' + (e && e.name) }

      // blob 音频（CSP media-src blob:，本机覆盖用）
      const buf = await (await fetch('./assets/_probe-tone.wav')).arrayBuffer()
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
      const a2 = new Audio(url)
      a2.volume = 0.01
      try { await a2.play(); await new Promise(r => setTimeout(r, 120)); a2.pause(); out.blobPlay = 'ok' }
      catch (e) { out.blobPlay = 'fail:' + (e && e.name) }
      finally { URL.revokeObjectURL(url) }
      return out
    })()`,
    true,
  )

  check(result.appRoot === true, '桌面打包产物界面正常上屏（file://）')
  check(result.sfxApi === 'undefined', `发布门禁下 window.__whaleSfx 不暴露（实际 ${result.sfxApi}）`)
  check(result.filePlay === 'ok', `file:// 内置音频可起播（实际 ${result.filePlay}）`)
  check(result.blobPlay === 'ok', `file:// 下 blob 音频可起播（本机覆盖用，实际 ${result.blobPlay}）`)
  check(consoleErrors.length === 0, `无 console error（实际 ${consoleErrors.length}${consoleErrors.length ? '：' + consoleErrors.slice(0, 3).join(' | ') : ''}）`)

  fs.rmSync(probeWavPath, { force: true })
  console.log(failures === 0 ? '\n✓ 桌面产物冒烟全部通过' : `\n✗ 冒烟失败 ${failures} 项`)
  app.exit(failures === 0 ? 0 : 1)
})

app.on('window-all-closed', () => app.exit(0))
