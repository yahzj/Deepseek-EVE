/**
 * **本机音效覆盖层**（音效台的存储，2026-11-02）。
 *
 * 用途：船长本机「快速添加/替换音效」——拖进音效台的音频文件按语义 id 存进 **IndexedDB**
 * （Blob + 文件名 + 时间），播放时**优先于仓库内置素材**；只存在这台机器上，
 * **不进存档、不进 git、不随发布**（发布版与其它玩家看到的仍是 `assets/sfx/` 里的内置包）。
 *
 * 降级：IndexedDB 不可用（隐私模式/受限环境）⇒ 本次会话内有效（内存），音效台会如实标注。
 * 注意：object URL 只在内存里有，页面刷新后由 `initSfxOverrides()` 从 IndexedDB 重建。
 */
import { SFX_CUES } from './cues'
import type { SfxCueId } from './cues'

const DB_NAME = 'whale-idle-sfx'
const STORE = 'overrides'
const DB_VERSION = 1

export interface SfxOverrideInfo {
  cueId: string
  fileName: string
  updatedAt: number
}

interface StoredOverride {
  cueId: string
  fileName: string
  updatedAt: number
  blob: Blob
}

interface RuntimeOverride {
  fileName: string
  updatedAt: number
  url: string
  /** 保留 Blob：音效台「导出正式入库包」要读原始字节（内存模式下也没了 IndexedDB 这份） */
  blob: Blob
}

/** 导出给「正式入库包」的一条覆盖（音效台专用；含原始字节） */
export interface SfxOverrideFile {
  cueId: SfxCueId
  fileName: string
  updatedAt: number
  blob: Blob
}

const runtime = new Map<string, RuntimeOverride>()
const listeners = new Set<() => void>()
let dbPromise: Promise<IDBDatabase | null> | null = null
let storageMode: 'indexeddb' | 'memory' = 'indexeddb'
let loaded = false

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* 订阅方自己的异常不影响存储层 */
    }
  }
}

/** 订阅覆盖层变更（音效台刷新用） */
export function subscribeSfxOverrides(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function revokeRuntime(cueId: string): void {
  const prev = runtime.get(cueId)
  if (prev) {
    try {
      URL.revokeObjectURL(prev.url)
    } catch {
      /* 极端环境没有 URL API：忽略 */
    }
  }
  runtime.delete(cueId)
}

function setRuntime(cueId: string, fileName: string, updatedAt: number, blob: Blob): void {
  revokeRuntime(cueId)
  try {
    runtime.set(cueId, { fileName, updatedAt, url: URL.createObjectURL(blob), blob })
  } catch {
    runtime.delete(cueId)
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise !== null) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'cueId' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function readAll(db: IDBDatabase): Promise<StoredOverride[]> {
  return new Promise((resolve, reject) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as StoredOverride[])
      req.onerror = () => reject(req.error)
    } catch (err) {
      reject(err)
    }
  })
}

/** 启动时装载本机覆盖（幂等；失败退化为内存模式并如实上报） */
export async function initSfxOverrides(): Promise<void> {
  if (loaded) return
  loaded = true
  const db = await openDb()
  if (db === null) {
    storageMode = 'memory'
    notify()
    return
  }
  try {
    const records = await readAll(db)
    for (const rec of records) {
      if (typeof rec?.cueId !== 'string' || !(rec.blob instanceof Blob)) continue
      // 旧版本/别的分支留下的未知 id：不装载（否则 object URL 永不释放，且永远播不到）
      if (!(rec.cueId in SFX_CUES)) continue
      setRuntime(rec.cueId, typeof rec.fileName === 'string' ? rec.fileName : rec.cueId, Number(rec.updatedAt) || 0, rec.blob)
    }
    storageMode = 'indexeddb'
  } catch {
    storageMode = 'memory'
  }
  notify()
}

/** 当前覆盖层存储形态（音效台如实显示） */
export function sfxOverrideStorageMode(): 'indexeddb' | 'memory' {
  return storageMode
}

/** 某个语义 id 的本机覆盖 URL（没有覆盖 = null） */
export function getSfxOverrideUrl(cueId: SfxCueId): string | null {
  return runtime.get(cueId)?.url ?? null
}

/** 全部本机覆盖（音效台列表） */
export function listSfxOverrides(): SfxOverrideInfo[] {
  return [...runtime.entries()]
    .map(([cueId, r]) => ({ cueId, fileName: r.fileName, updatedAt: r.updatedAt }))
    .sort((a, b) => a.cueId.localeCompare(b.cueId))
}

/** 导出用的本机覆盖（含原始 Blob；音效台「导出正式入库包」唯一取数口） */
export function listSfxOverrideFiles(): SfxOverrideFile[] {
  return [...runtime.entries()]
    .map(([cueId, r]) => ({ cueId: cueId as SfxCueId, fileName: r.fileName, updatedAt: r.updatedAt, blob: r.blob }))
    .sort((a, b) => a.cueId.localeCompare(b.cueId))
}

/** 写入/替换某个事件的音效（file 来自拖拽或文件选择；未知语义 id 直接拒绝） */
export async function putSfxOverride(cueId: SfxCueId, file: File): Promise<{ ok: boolean; sessionOnly: boolean }> {
  if (!(cueId in SFX_CUES)) return { ok: false, sessionOnly: false }
  const updatedAt = Date.now()
  setRuntime(cueId, file.name, updatedAt, file)
  notify()
  const db = await openDb()
  if (db === null) {
    storageMode = 'memory'
    return { ok: true, sessionOnly: true }
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ cueId, fileName: file.name, updatedAt, blob: file } satisfies StoredOverride)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    storageMode = 'indexeddb'
    return { ok: true, sessionOnly: false }
  } catch {
    storageMode = 'memory'
    return { ok: true, sessionOnly: true }
  }
}

/** 清除某个事件的本机覆盖（回到内置/静音） */
export async function deleteSfxOverride(cueId: SfxCueId): Promise<void> {
  revokeRuntime(cueId)
  notify()
  const db = await openDb()
  if (db === null) return
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(cueId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    /* 存储不可用时只清内存那份（已经清了） */
  }
}

/** 清空全部本机覆盖 */
export async function clearSfxOverrides(): Promise<void> {
  for (const cueId of [...runtime.keys()]) revokeRuntime(cueId)
  notify()
  const db = await openDb()
  if (db === null) return
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    /* 同上 */
  }
}
