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
  blob: Blob
}

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
    }
  }
}

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
      if (!(rec.cueId in SFX_CUES)) continue
      setRuntime(rec.cueId, typeof rec.fileName === 'string' ? rec.fileName : rec.cueId, Number(rec.updatedAt) || 0, rec.blob)
    }
    storageMode = 'indexeddb'
  } catch {
    storageMode = 'memory'
  }
  notify()
}

export function sfxOverrideStorageMode(): 'indexeddb' | 'memory' {
  return storageMode
}

export function getSfxOverrideUrl(cueId: SfxCueId): string | null {
  return runtime.get(cueId)?.url ?? null
}

export function listSfxOverrides(): SfxOverrideInfo[] {
  return [...runtime.entries()]
    .map(([cueId, r]) => ({ cueId, fileName: r.fileName, updatedAt: r.updatedAt }))
    .sort((a, b) => a.cueId.localeCompare(b.cueId))
}

export function listSfxOverrideFiles(): SfxOverrideFile[] {
  return [...runtime.entries()]
    .map(([cueId, r]) => ({ cueId: cueId as SfxCueId, fileName: r.fileName, updatedAt: r.updatedAt, blob: r.blob }))
    .sort((a, b) => a.cueId.localeCompare(b.cueId))
}

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
  }
}

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
  }
}
