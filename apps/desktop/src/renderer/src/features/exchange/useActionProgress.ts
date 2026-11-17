import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ExchangeClient } from './client'

export interface ActionProgress {
  pct: number
  active: boolean
  start: () => void
  finish: (success?: boolean) => Promise<void>
}

const TICK_MS = 120
const CEIL = 90

export function useActionProgress(client?: ExchangeClient): ActionProgress {
  const [pct, setPct] = useState(0)
  const [active, setActive] = useState(false)
  const timerRef = useRef<number | null>(null)
  const doneTimerRef = useRef<number | null>(null)
  const releaseRef = useRef<(() => void) | null>(null)
  const generationRef = useRef(0)

  const clear = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (doneTimerRef.current !== null) {
      window.clearTimeout(doneTimerRef.current)
      doneTimerRef.current = null
    }
  }

  const start = useCallback(() => {
    generationRef.current += 1
    clear()
    releaseRef.current?.()
    releaseRef.current = client?.holdAccountUpdates?.() ?? null
    setActive(true)
    setPct(6)
    timerRef.current = window.setInterval(() => {
      setPct((p) => (p >= CEIL ? CEIL : p + Math.max(1, Math.round((CEIL - p) * 0.08))))
    }, TICK_MS)
  }, [client])

  const finish = useCallback(async (success = true) => {
    const generation = generationRef.current
    clear()
    setPct(success ? 100 : 0)
    if (success) await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
    if (generation !== generationRef.current) return
    releaseRef.current?.()
    releaseRef.current = null
    if (!success) {
      setActive(false)
      return
    }
    doneTimerRef.current = window.setTimeout(() => {
      setActive(false)
      setPct(0)
    }, 320)
  }, [])

  useEffect(() => () => {
    generationRef.current += 1
    clear()
    releaseRef.current?.()
    releaseRef.current = null
  }, [])

  return { pct, active, start, finish }
}

export function progressStyle(progress: ActionProgress): CSSProperties | undefined {
  if (!progress.active) return undefined
  return {
    '--ex-progress': `${progress.pct}%`,
  } as CSSProperties
}
