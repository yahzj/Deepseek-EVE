/** 国庆C07桌面集成检查：构建后 node tools/guoqing-save-native-check.cjs。
 * 隐藏自建Electron、独立临时userData、合成档；仅选择器返回路径被替换。
 * 真实引擎/IPC验证导出同快照、立即导入、恢复与旧代次启动拒绝，不读个人档。
 * 本树未安装运行时可用WHALE_ELECTRON_EXE指定本机已有的同版本可执行文件。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

if (!process.argv.includes('--child')) {
  require('tsx/cjs')
  const { createInitialState, serializeSaveFile } = require('../packages/core/src/index.ts')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-guoqing-save-'))
  try {
    const state = createInitialState({ nowWallMs: Date.now(), seed: 29 })
    state.modeChosen = true
    state.ironman = { on: true, seq: 100, sinceWallMs: Date.now() }
    fs.writeFileSync(path.join(profile, 'save.json'), serializeSaveFile(state), 'utf8')
    const env = { ...process.env, WHALE_PERF_USERDATA: profile }
    delete env.ELECTRON_RUN_AS_NODE
    const run = spawnSync(process.env.WHALE_ELECTRON_EXE || require('electron'), [__filename, '--child'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 45_000, windowsHide: true, env,
    })
    console.log(run.stdout)
    if (run.error) throw run.error
    assert.equal(run.status, 0, run.stderr)
  } finally {
    const target = path.resolve(profile)
    assert(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('whale-guoqing-save-'))
    fs.rmSync(target, { recursive: true, force: true })
  }
} else {
  const { app, BrowserWindow, dialog } = require('electron')
  const profile = process.env.WHALE_PERF_USERDATA
  const savePath = path.join(profile, 'save.json')
  const exportPath = path.join(profile, 'synthetic-export.json')
  const errors = []
  BrowserWindow.prototype.show = function () {}
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath })
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exportPath] })
  require(path.resolve('apps/desktop/out/main/index.js'))
  app.whenReady().then(async () => {
    for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await sleep(50)
    const win = BrowserWindow.getAllWindows()[0]
    assert(win && !win.isVisible())
    win.webContents.debugger.attach('1.3')
    win.webContents.debugger.on('message', (_event, method, data) => { if (method === 'Runtime.exceptionThrown') errors.push(data) })
    await win.webContents.debugger.sendCommand('Runtime.enable')
    const js = source => win.webContents.executeJavaScript(source)
    const bindEngine = async () => {
      for (let i = 0; i < 150; i++) {
        try {
          const found = await js(`(()=>{const el=document.querySelector('.app-root');if(!el)return false;
            let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
            while(f&&!f.memoizedProps?.engine)f=f.return;if(!f)return false;
            window.__guoqingEngine=f.memoizedProps.engine;window.__guoqingEngine.stop();return true})()`)
          if (found) return
        } catch {}
        await sleep(100)
      }
      throw new Error('实际引擎装载超时')
    }
    await bindEngine()
    assert.equal((await js('window.__guoqingEngine.exportSaveToFile()')).ok, true)
    const exported = fs.readFileSync(exportPath, 'utf8')
    assert.equal(exported, fs.readFileSync(savePath, 'utf8'))
    const exportedSeq = JSON.parse(exported).state.ironman.seq
    assert.equal((await js('window.__guoqingEngine.importSaveFromFile()')).ok, true)
    const importedSeq = JSON.parse(fs.readFileSync(savePath, 'utf8')).state.ironman.seq
    assert(importedSeq > exportedSeq)
    const backup = await js('window.__guoqingEngine.backupNow()')
    assert(backup.ok && /^save-\d{8}-\d{6}(-\d+)?\.json$/.test(backup.name))
    assert.equal((await js(`window.__guoqingEngine.restoreBackup(${JSON.stringify(backup.name)})`)).ok, true)
    const restoredSeq = JSON.parse(fs.readFileSync(savePath, 'utf8')).state.ironman.seq
    assert(restoredSeq > importedSeq)
    // 先退出旧页面并排空pagehide保存，再替换测试文件，避免退出保存覆盖注入的旧档。
    const originalUrl = win.webContents.getURL()
    await win.loadURL('about:blank')
    await js('window.whale.load()')
    fs.writeFileSync(savePath, exported, 'utf8')
    await win.loadURL(originalUrl)
    await bindEngine()
    assert.equal(await js('window.__guoqingEngine.saveWriteState()'), 'paused')
    assert.equal(fs.readFileSync(savePath, 'utf8'), exported)
    assert.equal(errors.length, 0, JSON.stringify(errors))
    console.log(JSON.stringify({ ok: true, pid: process.pid, target: path.resolve('apps/desktop/out'),
      synthetic: true, sameExportSnapshot: true, immediateImport: true, backupRestore: true,
      exportedSeq, importedSeq, restoredSeq, startupRollbackRejected: true, originalFilePreserved: true, errors: 0 }))
    app.exit(0)
  }).catch(error => { console.error(error); app.exit(1) })
}
