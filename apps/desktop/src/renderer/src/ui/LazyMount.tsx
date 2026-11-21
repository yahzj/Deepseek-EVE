import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export const ASSEMBLER_CARD_MIN_H = 523

const NEAR_MARGIN = '100% 0px 100% 0px'

export function LazyMount({
  eager = false,
  minHeight,
  children,
}: {
  eager?: boolean
  minHeight: number
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(eager)

  useEffect(() => {
    if (eager) setShown(true)
  }, [eager])

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (el === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { rootMargin: NEAR_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  return (
    <div
      ref={ref}
      style={shown ? { display: 'contents' } : { minHeight }}
      aria-hidden={shown ? undefined : true}
    >
      {shown ? children : null}
    </div>
  )
}

export function useIdleChunk(size: number, delayMs = 300): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    if (typeof ric === 'function') {
      const id = ric(() => setN(size))
      const cancel = (globalThis as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback
      return () => {
        if (typeof cancel === 'function') cancel(id)
      }
    }
    const t = globalThis.setTimeout(() => setN(size), delayMs)
    return () => globalThis.clearTimeout(t)
  }, [size, delayMs])
  return n
}
