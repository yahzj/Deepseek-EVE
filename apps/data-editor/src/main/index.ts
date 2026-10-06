import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createDataEditorRepository } from '../../../../tools/data-editor-repository'
import type { EditorChange, NumericEdit } from '../../../../tools/data-editor-contract'

app.setName('whale-data-editor')
if (process.env.WHALE_DATA_EDITOR_USERDATA) app.setPath('userData', resolve(process.env.WHALE_DATA_EDITOR_USERDATA))
let window: BrowserWindow | null = null
let dirty = false
const repository = createDataEditorRepository({ runtime: { execPath: process.execPath, electronRunAsNode: true } })
const roots = new Set<string>()
function selectedRoot(root: unknown): string {
  if (typeof root !== 'string' || !roots.has(root)) throw new Error('请先打开已验证的项目目录')
  return root
}
function origin(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('拒绝未知窗口请求')
}
function route(method: string, fn: (...args: any[]) => Promise<unknown>): void {
  ipcMain.handle(`data-editor:${method}`, (event, ...args) => { origin(event); return fn(...args) })
}
app.whenReady().then(async () => {
  route('chooseProject', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择游戏源码工作区', properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  route('openProject', async (root: string) => {
    const project = await repository.openProject(root)
    roots.add(project.root)
    return project
  })
  route('preview', (root: string, fingerprint: string, edits: NumericEdit[]) => repository.preview(selectedRoot(root), fingerprint, edits))
  route('save', (root: string, token: string) => repository.save(selectedRoot(root), token))
  route('restore', (root: string) => repository.restore(selectedRoot(root)))
  route('check', (root: string) => repository.check(selectedRoot(root)))
  route('build', (root: string) => repository.build(selectedRoot(root)))
  route('exportChanges', async (changes: EditorChange[]) => {
    if (!Array.isArray(changes) || changes.length > 10_000) throw new Error('导出清单无效')
    const result = await dialog.showSaveDialog(window!, { title: '导出本次数值调整', defaultPath: 'data-changes.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, JSON.stringify({ format: 'whale-data-changes', version: 1, changes }, null, 2) + '\n', 'utf8')
    return true
  })
  ipcMain.on('data-editor:dirty', (event, value) => { origin(event); dirty = value === true })
  window = new BrowserWindow({ width: 1320, height: 860, minWidth: 760, minHeight: 480, show: false, title: '大鲸鱼数据编辑器',
    webPreferences: { preload: resolve(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
  window.removeMenu()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== window?.webContents.getURL()) event.preventDefault() })
  window.on('close', event => {
    if (!dirty) return
    event.preventDefault()
    dialog.showMessageBox(window!, { type: 'warning', title: '未保存的数值草稿', message: '关闭将丢弃未保存草稿。', buttons: ['返回编辑', '丢弃并关闭'], defaultId: 0, cancelId: 0 }).then(result => { if (result.response === 1) { dirty = false; window?.close() } })
  })
  window.once('ready-to-show', () => { if (process.env.WHALE_DATA_EDITOR_HIDDEN !== '1') window?.show() })
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(resolve(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
