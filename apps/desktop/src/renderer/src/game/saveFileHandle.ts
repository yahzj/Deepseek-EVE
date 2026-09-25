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
 * - 本模块只做"文件那一半"：跟浏览器存储的**取舍**在 `storage.ts` 里（`savedAtWallMs` 取较新）。
 */
import { tr } from '../i18n/locale'

const DB_NAME = 'whale-idle'
const DB_VERSION = 1
const STORE = 'save-file'
const KEY = 'bound'

/** 默认建议文件名（对话框里玩家可改；位置由玩家选，建议「文稿/文档」目录） */
export const SAVE_FILE_NAME = '大鲸鱼-深空放置-save.json'

/** 缓存的句柄（首次用时从 IndexedDB 恢复） */
let handle: FileSystemFileHandle | null = null
let restored = false

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
  if (restored) return handle
  restored = true
  try {
    handle = await idbGet<FileSystemFileHandle>(KEY)
  } catch {
    handle = null
  }
  return handle
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
  return { supported, bound: true, connected: await queryPermission(h), name: h.name ?? null }
}

/**
 * **绑定**（必须由玩家手势触发）：弹系统保存框 → 记句柄 → 立刻把当前存档写进去。
 * 玩家取消 ⇒ `{ ok: false, canceled: true }`。
 */
export async function bindSaveFile(currentSave: string | null): Promise<{ ok: boolean; canceled?: boolean; name?: string; error?: string }> {
  if (!saveFileSupported()) return { ok: false, error: tr('ui.saveGuard.020') }
  try {
    const picked = await window.showSaveFilePicker!({
      suggestedName: SAVE_FILE_NAME,
      types: [{ description: tr('ui.saveGuard.026'), accept: { 'application/json': ['.json'] } }],
    })
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
    if (currentSave !== null) await writeToBoundFile(currentSave)
    return { ok: true, name: picked.name ?? null }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') return { ok: false, canceled: true }
    return { ok: false, error: String(err) }
  }
}

/** **重新连接**（必须由玩家手势触发）：对已存句柄再要一次读写权限 */
export async function reconnectSaveFile(): Promise<{ ok: boolean; name?: string; error?: string }> {
  const h = await loadHandle()
  if (!h) return { ok: false, error: tr('ui.saveGuard.014') }
  try {
    if (typeof h.requestPermission === 'function') {
      const state = await h.requestPermission({ mode: 'readwrite' })
      if (state !== 'granted') return { ok: false, error: tr('ui.saveGuard.019') }
    }
    return { ok: true, name: h.name ?? null }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** 解绑：删句柄（浏览器存储那份照旧） */
export async function unbindSaveFile(): Promise<{ ok: boolean; error?: string }> {
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
export async function writeToBoundFile(text: string): Promise<boolean | null> {
  const h = await loadHandle()
  if (!h) return null
  if (!(await queryPermission(h))) return null
  try {
    const w = await h.createWritable()
    await w.write(text)
    await w.close()
    return true
  } catch {
    return false
  }
}

/** 读绑定的文件（未绑定/未连上/读失败 ⇒ null） */
export async function readFromBoundFile(): Promise<string | null> {
  const h = await loadHandle()
  if (!h) return null
  if (!(await queryPermission(h))) return null
  try {
    const file = await h.getFile()
    const text = await file.text()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

/** 探针/体检用：清掉内存与 IndexedDB 里的句柄（生产路径不调） */
export async function resetSaveFileForTest(): Promise<void> {
  handle = null
  restored = true
  try {
    await idbDel(KEY)
  } catch {
    /* 忽略 */
  }
}
