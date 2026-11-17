import { useSyncExternalStore } from 'react'
import { DEFAULT_CLOUD_SERVER, FALLBACK_CLOUD_SERVER, readCloudPreferences } from '../cloud/preferences'
import { RendererTransport } from './http/RendererTransport'

const PROBE_INTERVAL_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000
const FAIL_THRESHOLD = 3

let available = true
let failures = 0
let started = false
let timer: number | null = null
const listeners = new Set<() => void>()

function setAvailable(next: boolean): void {
  if (available === next) return
  available = next
  for (const callback of listeners) callback()
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('exchange probe timeout')), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timeout)
        reject(err)
      },
    )
  })
}

async function probe(): Promise<void> {
  const prefs = readCloudPreferences()
  const configured = typeof prefs.server === 'string' ? prefs.server.trim() : ''
  const serverUrl = configured === '' ? DEFAULT_CLOUD_SERVER : configured
  try {
    const transport = new RendererTransport({
      serverUrl,
      fallbackServerUrl: FALLBACK_CLOUD_SERVER,
      allowAnonymous: true,
    })
    await withTimeout(transport.request({ method: 'GET', path: '/api/exchange/meta' }), PROBE_TIMEOUT_MS)
    failures = 0
    setAvailable(true)
  } catch {
    failures += 1
    if (failures >= FAIL_THRESHOLD) setAvailable(false)
  }
}

function ensureStarted(): void {
  if (started) return
  started = true
  void probe()
  timer = window.setInterval(() => {
    void probe()
  }, PROBE_INTERVAL_MS)
}

function subscribe(callback: () => void): () => void {
  ensureStarted()
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}

function getSnapshot(): boolean {
  return available
}

export function useExchangeAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function resetExchangeAvailabilityForTest(): void {
  available = true
  failures = 0
  started = false
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
  listeners.clear()
}
