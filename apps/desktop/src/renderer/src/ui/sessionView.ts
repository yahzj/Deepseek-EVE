import { useLayoutEffect, useRef, type RefObject } from 'react'

const PICK = new Map<string, string>()
const SCROLL = new Map<string, number>()

export function sessionPick(key: string): string | null {
  const v = PICK.get(key)
  return v === undefined ? null : v
}

export function setSessionPick(key: string, value: string | null): void {
  if (value === null) PICK.delete(key)
  else PICK.set(key, value)
}

export function sessionScroll(key: string): number | null {
  const v = SCROLL.get(key)
  return v === undefined ? null : v
}

export function setSessionScroll(key: string, top: number | null): void {
  if (top === null) SCROLL.delete(key)
  else SCROLL.set(key, Math.max(0, Math.round(top)))
}

export function useSessionScroll(
  key: string,
  ref: RefObject<HTMLElement | null>,
  active = true,
): void {
  const restoreTo = useRef<number | null>(sessionScroll(key))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const want = restoreTo.current
    if (want !== null && want > 0) el.scrollTop = want
    const save = (): void => setSessionScroll(key, el.scrollTop)
    el.addEventListener('scroll', save, { passive: true })
    return () => {
      el.removeEventListener('scroll', save)
      save()
    }
  }, [key, ref, active])
}

function scrollableIn(el: HTMLElement): HTMLElement | null {
  const oy = getComputedStyle(el).overflowY
  if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1) return el
  return null
}

export function useSessionScrollFrom(key: string, ref: RefObject<HTMLElement | null>): void {
  const target = useRef<HTMLElement | null>(null)
  const restoreTo = useRef<number | null>(sessionScroll(key))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let t = scrollableIn(el)
    const ancestor = el.closest('.wui-panel-body, .app-win-body') as HTMLElement | null
    if (!t && ancestor) t = scrollableIn(ancestor) ?? ancestor
    if (!t) t = Array.from(el.querySelectorAll<HTMLElement>('*')).find((n) => scrollableIn(n) !== null) ?? null
    if (!t) return
    target.current = t
    const want = restoreTo.current
    if (want !== null && want > 0) t.scrollTop = want
    const save = (): void => setSessionScroll(key, t.scrollTop)
    t.addEventListener('scroll', save, { passive: true })
    return () => {
      t.removeEventListener('scroll', save)
      save()
    }
  }, [key, ref])
}
