import { tr } from '../i18n/locale'

const PROBE_KEY = 'whale:idle:storage-probe'

export interface SaveStorageProbe {
  kind: 'file' | 'browser'
  ok: boolean
  persisted: boolean | null
}

let probe: SaveStorageProbe | null = null
let warnedUnavailable = false
let warnedWriteFailed = false
const listeners = new Set<(msg: string) => void>()

export function subscribeSaveAlert(cb: (msg: string) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit(msg: string): void {
  for (const cb of listeners) cb(msg)
}

export async function probeSaveStorage(): Promise<SaveStorageProbe> {
  const desktop = typeof window !== 'undefined' && window.whale !== undefined
  if (desktop) {
    let ok = false
    try {
      const r = await window.whale.listBackups()
      ok = r.ok
    } catch {
      ok = false
    }
    probe = { kind: 'file', ok, persisted: true }
    return probe
  }

  let ok = false
  try {
    const ls = window.localStorage
    ls.setItem(PROBE_KEY, '1')
    ok = ls.getItem(PROBE_KEY) === '1'
    ls.removeItem(PROBE_KEY)
  } catch {
    ok = false
  }
  probe = { kind: 'browser', ok, persisted: await readPersisted() }
  if (ok) void requestPersistentStorage()
  return probe
}

async function readPersisted(): Promise<boolean | null> {
  try {
    const s = navigator.storage
    if (!s || typeof s.persisted !== 'function') return null
    return await s.persisted()
  } catch {
    return null
  }
}

export function saveStorageProbe(): SaveStorageProbe | null {
  return probe
}

export async function requestPersistentStorage(): Promise<void> {
  if (typeof window === 'undefined' || window.whale !== undefined) return
  try {
    const s = navigator.storage
    if (!s || typeof s.persist !== 'function') return
    if (probe && probe.persisted !== true) {
      await s.persist()
      probe = { ...probe, persisted: await readPersisted() }
    }
  } catch {
  }
}

export function noteStorageUnavailable(): void {
  if (warnedUnavailable) return
  warnedUnavailable = true
  emit(tr('ui.saveGuard.008'))
}

export function noteSaveWriteFailed(): void {
  if (warnedWriteFailed) return
  warnedWriteFailed = true
  emit(tr('ui.saveGuard.009'))
}
