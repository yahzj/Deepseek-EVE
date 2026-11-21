import { tr } from '../i18n/locale'
import { createSaveQueue } from '../../../shared/saveQueue'

const DB_NAME = 'whale-idle'
const DB_VERSION = 1
const STORE = 'save-file'
const KEY = 'bound'

export const SAVE_FILE_NAME = '大鲸鱼-深空放置-save.json'

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

export function saveFileSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}


function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      fn()
    }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (err) {
      reject(err)
      return
    }
    const timer = window.setTimeout(() => settle(() => reject(new Error('indexedDB open timeout'))), 5000)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => settle(() => {
      const db = req.result
      db.onversionchange = () => db.close()
      resolve(db)
    })
    req.onerror = () => settle(() => reject(req.error ?? new Error('indexedDB open failed')))
    req.onblocked = () => settle(() => reject(new Error('indexedDB open blocked')))
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

async function queryPermission(h: FileSystemFileHandle): Promise<boolean> {
  try {
    if (typeof h.queryPermission !== 'function') return false
    return (await h.queryPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

export async function saveFileStatus(): Promise<SaveFileStatus> {
  const supported = saveFileSupported()
  const h = await loadHandle()
  if (!h) return { supported, bound: false, connected: false, name: null }
  return { supported, bound: true, connected: writable && await queryPermission(h), name: h.name ?? null }
}

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
