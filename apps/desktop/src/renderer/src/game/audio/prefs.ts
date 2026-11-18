import { useCallback, useEffect, useState } from 'react'
import { defaultSfxPrefs, parseSfxPrefs } from './rules'
import type { SfxCategory } from './cues'
import type { SfxPrefs } from './rules'

export const SFX_PREFS_KEY = 'whale-idle:sfx'
const SFX_PREFS_EVENT = 'whale-sfx-prefs-change'

let cache: SfxPrefs | null = null

export function readSfxPrefs(): SfxPrefs {
  if (cache !== null) return cache
  try {
    cache = parseSfxPrefs(localStorage.getItem(SFX_PREFS_KEY))
  } catch {
    cache = defaultSfxPrefs()
  }
  return cache
}

function notify(): void {
  try {
    window.dispatchEvent(new Event(SFX_PREFS_EVENT))
  } catch {
  }
}

export function writeSfxPrefs(next: SfxPrefs): void {
  cache = next
  try {
    localStorage.setItem(SFX_PREFS_KEY, JSON.stringify(next))
  } catch {
  }
  notify()
}

export function resetSfxPrefs(): void {
  writeSfxPrefs(defaultSfxPrefs())
}

export function subscribeSfxPrefs(fn: () => void): () => void {
  try {
    window.addEventListener(SFX_PREFS_EVENT, fn)
    return () => window.removeEventListener(SFX_PREFS_EVENT, fn)
  } catch {
    return () => {}
  }
}

export function useSfxPrefs(): {
  prefs: SfxPrefs
  setMaster: (v: number) => void
  setMuted: (muted: boolean) => void
  setCategory: (category: SfxCategory, v: number) => void
  setPitchJitter: (cents: number) => void
  reset: () => void
} {
  const [prefs, setPrefs] = useState<SfxPrefs>(() => readSfxPrefs())
  useEffect(() => {
    setPrefs(readSfxPrefs())
    return subscribeSfxPrefs(() => setPrefs(readSfxPrefs()))
  }, [])
  const setMaster = useCallback((v: number) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, master: v })
  }, [])
  const setMuted = useCallback((muted: boolean) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, muted })
  }, [])
  const setCategory = useCallback((category: SfxCategory, v: number) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, categories: { ...cur.categories, [category]: v } })
  }, [])
  const setPitchJitter = useCallback((cents: number) => {
    const cur = readSfxPrefs()
    writeSfxPrefs({ ...cur, pitchJitterCents: cents })
  }, [])
  const reset = useCallback(() => resetSfxPrefs(), [])
  return { prefs, setMaster, setMuted, setCategory, setPitchJitter, reset }
}
