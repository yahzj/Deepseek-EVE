/**
 * **网页版「绑定本地存档文件」**（2026-09-25 船长令：「存档能否除了浏览器默认存档，**优先保存到本地**？
 * 就跟我本地运行一样」⇒ 裁定「按你推荐来」＝ 做，冲突时按档内 `savedAtWallMs` **取较新**）。
 *
 * 为什么需要它：网页版的存档原本只在**浏览器存储**里（`localStorage`），
 * macOS/Safari 与"磁盘紧张时清理站点数据"都会把它抹掉（玩家报障：MacBook 玩一下午，晚上存档没了）。
 * 桌面版之所以稳，是因为它写的是**真文件**（`%APPDATA%\whale-idle\save.json`）。
 * 本模块让网页版也能写一个**玩家自己选的本地文件**，之后每次落盘**静默写进同一个文件**
 * —— 首次必须玩家点一下（浏览器安全要求，网页不能自己建文件）。
 *
 * 机制与边界：
 * - 底层 = **File System Access API**（`showSaveFilePicker` + `createWritable`）——**Chromium 系才有**；
 *   Safari/Firefox 没有 ⇒ `supported: false`，界面按既有「浏览器存储 ＋ 告警」走。
 * - 句柄存 **IndexedDB**（句柄不能进 localStorage；`FileSystemFileHandle` 可结构化克隆）。
 * - **权限会被浏览器在重启后收回**（`queryPermission('readwrite')` 变 `prompt`）⇒
 *   `connected: false`，由界面上的一次「重新连接」按钮（玩家手势）重新要权限。
 * - 启动取较新沿既有口径；重连独立进入保护态，选择完成后才恢复文件写入。
 */
import { tr } from '../i18n/locale'
import { createSaveQueue } from '../../../shared/saveQueue'

const DB_NAME = 'whale-idle'
const DB_VERSION = 1
const STORE = 'save-file'
const KEY = 'bound'

/** 默认建议文件名（对话框里玩家可改；位置由玩家选，建议「文稿/文档」目录） */
export const SAVE_FILE_NAME = '大鲸鱼-深空放置-save.json'

/** 缓存的句柄（首次用时从 IndexedDB 恢复） */
let handle: FileSystemFileHandle | null = null
let restored = false
let restoring: Promise<FileSystemFileHandle | null> | null = null
let writable = false
let generation = 0
const PAUSED_KEY = 'whale:idle:file-paused'
const fileOperations = createSaveQueue()

export function saveFileWriteToken(): number { return generation }
export function pauseBoundFile(): void { pauseFile() }
function pauseFile(): void {
  writable = false
  generation++
  window.localStorage.setItem(PAUSED_KEY, '1')
}
function enableFile(): void {
  window.localStorage.removeItem(PAUSED_KEY)
  generation++
  writable = true
}

/** 本浏览器是否支持直接写本地文件 */
export function saveFileSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/* ───────── IndexedDB 只存那一个句柄 ───────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('indexedDB get failed'))
  })
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'))
  })
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB delete failed'))
  })
}

/* ───────── 句柄取用与权限 ───────── */

/** 从 IndexedDB 恢复句柄（只做一次；不申请权限） */
async function loadHandle(): Promise<FileSystemFileHandle | null> {
  if (restoring) return restoring
  if (restored) return handle
  const token = generation
  restoring = (async () => {
    try {
      const saved = await idbGet<FileSystemFileHandle>(KEY)
      if (token === generation || !restored) handle = saved
    } catch { if (!restored) handle = null }
    restored = true
    restoring = null
    return handle
  })()
  return restoring
}

/** 查权限（不弹框）。`FileSystemFileHandle` 没实现权限方法时按"没连上"处理 */
async function queryPermission(h: FileSystemFileHandle): Promise<boolean> {
  try {
    if (typeof h.queryPermission !== 'function') return false
    return (await h.queryPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

/** 状态（界面用）：是否支持 / 是否绑定 / 是否已连上 / 文件名 */
export async function saveFileStatus(): Promise<SaveFileStatus> {
  const supported = saveFileSupported()
  const h = await loadHandle()
  if (!h) return { supported, bound: false, connected: false, name: null }
  return { supported, bound: true, connected: writable && await queryPermission(h), name: h.name ?? null }
}

/**
 * **绑定**（必须由玩家手势触发）：弹系统保存框 → 记句柄 → 立刻把当前存档写进去。
 * 玩家取消 ⇒ `{ ok: false, canceled: true }`。
 */
export async function bindSaveFile(currentSave: string | null): Promise<{ ok: boolean; canceled?: boolean; name?: string; error?: string }> {
  if (!saveFileSupported()) return { ok: false, error: tr('ui.saveGuard.020') }
  try {
    pauseFile()
    const token = generation
    const picked = await window.showSaveFilePicker!({
      suggestedName: SAVE_FILE_NAME,
      types: [{ description: tr('ui.saveGuard.026'), accept: { 'application/json': ['.json'] } }],
    })
    if (token !== generation) return { ok: false, error: tr('ui.saveReconnect.009') }
    handle = picked
    restored = true
    await idbPut(KEY, picked)
    if (typeof picked.requestPermission === 'function') {
      try {
        await picked.requestPermission({ mode: 'readwrite' })
      } catch {
        /* 有些实现（含 OPFS 句柄）不需要申请：写的时候自然成功 */
      }
    }
    await fileOperations(async () => {
      if (token !== generation || picked !== handle) throw new Error(tr('ui.saveReconnect.009'))
      if (currentSave !== null) await writeHandle(picked, currentSave)
      if (token !== generation || picked !== handle) throw new Error(tr('ui.saveReconnect.009'))
      enableFile()
    })
    return { ok: true, name: picked.name ?? null }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') return { ok: false, canceled: true }
    return { ok: false, error: String(err) }
  }
}

/** **重新连接**（必须由玩家手势触发）：对已存句柄再要一次读写权限 */
export async function reconnectSaveFile(): Promise<SaveFileReconnectResult> {
  try {
    pauseFile()
    const token = generation
    const h = await loadHandle()
    if (!h) return { ok: false, error: tr('ui.saveGuard.014') }
    if (typeof h.requestPermission === 'function') {
      const state = await h.requestPermission({ mode: 'readwrite' })
      if (state !== 'granted') return { ok: false, error: tr('ui.saveGuard.019') }
    }
    const text = await fileOperations(() => readHandle(h))
    if (token !== generation || h !== handle) return { ok: false }
    return { ok: true, name: h.name, text, token }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 解绑：删句柄（浏览器存储那份照旧） */
export async function unbindSaveFile(): Promise<{ ok: boolean; error?: string }> {
  writable = false
  generation++
  handle = null
  restored = true
  try {
    await idbDel(KEY)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 把存档文本写进绑定的文件（未绑定/未连上 ⇒ 返回 null 表示"没写、也不算失败"） */
export async function writeToBoundFile(text: string, token = generation): Promise<boolean | null> {
  const h = await loadHandle()
  if (!h) return null
  if (!writable || token !== generation) return null
  const permitted = await queryPermission(h)
  if (token !== generation || h !== handle) return null
  if (!permitted) { pauseFile(); return null }
  return fileOperations(async () => {
    if (!writable || token !== generation || h !== handle) return null
    try { await writeHandle(h, text); return true } catch {
      if (token === generation && h === handle) pauseFile()
      return false
    }
  })
}

async function writeHandle(h: FileSystemFileHandle, text: string, token = generation): Promise<void> {
  const w = await h.createWritable()
  if (token !== generation || h !== handle) {
    await w.abort().catch(() => {})
    throw new Error(tr('ui.saveReconnect.009'))
  }
  try {
    await w.write(text)
    if (h !== handle) throw new Error(tr('ui.saveReconnect.009'))
    await w.close()
  } catch (err) {
    await w.abort().catch(() => {})
    throw err
  }
}
async function readHandle(h: FileSystemFileHandle): Promise<string> {
  const file = await h.getFile()
  if (file.size > 10 * 1024 * 1024) throw new Error(tr('ui.storage.006'))
  return (await file.text()).replace(/^\uFEFF/, '')
}

/** 候选读取与提交都在文件队列内，确认前重读；旧会话或换绑不能使用过期确认。 */
export async function checkReconnectFile(token: number, expected: string, replacement?: string): Promise<SaveFileReconnectResult> {
  return fileOperations(async () => {
    if (token !== generation || !handle) return { ok: false }
    const target = handle
    try {
      if (!(await queryPermission(target))) return { ok: false, error: tr('ui.saveGuard.019') }
      const text = await readHandle(target)
      if (token !== generation || target !== handle) return { ok: false, error: tr('ui.saveReconnect.009') }
      if (text !== expected) return { ok: false, changed: true, text, token, name: target.name }
      if (replacement !== undefined) {
        await writeHandle(target, replacement, token)
        if (token !== generation || target !== handle) return { ok: false, error: tr('ui.saveReconnect.009') }
        enableFile()
      }
      return { ok: true, text, token, name: target.name }
    } catch (err) { return { ok: false, error: String(err) } }
  })
}
export async function resumeEquivalentFile(token: number, expected: string): Promise<SaveFileReconnectResult> {
  return fileOperations(async () => {
    if (token !== generation || !handle) return { ok: false }
    const target = handle
    try {
      if (!(await queryPermission(target))) return { ok: false, error: tr('ui.saveGuard.019') }
      const text = await readHandle(target)
      if (token !== generation || target !== handle) return { ok: false, error: tr('ui.saveReconnect.009') }
      if (text !== expected) return { ok: false, changed: true, text, token, name: target.name }
      enableFile()
      return { ok: true }
    } catch (err) { return { ok: false, error: String(err) } }
  })
}

/** 读绑定的文件（未绑定/未连上/读失败 ⇒ null） */
export async function readFromBoundFile(): Promise<string | null> {
  const token = generation
  const h = await loadHandle()
  if (!h) return null
  if (window.localStorage.getItem(PAUSED_KEY) === '1') return null
  if (!(await queryPermission(h))) return null
  try {
    const text = await fileOperations(() => readHandle(h))
    if (token !== generation || h !== handle) return null
    writable = true
    return text.length > 0 ? text : null
  } catch {
    pauseFile()
    return null
  }
}

/** 探针/体检用：清掉内存与 IndexedDB 里的句柄（生产路径不调） */
export async function resetSaveFileForTest(): Promise<void> {
  handle = null
  restored = true
  writable = false
  generation++
  try {
    await idbDel(KEY)
  } catch {
    /* 忽略 */
  }
}
