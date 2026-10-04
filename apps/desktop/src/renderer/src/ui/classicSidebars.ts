import { useEffect, useLayoutEffect, useState } from 'react'

export const CLASSIC_NAV_PREFS_KEY = 'whale-idle:classic-nav-prefs'
export const CLASSIC_LOG_FADE_MS = 140
interface NavPrefs { desktop: boolean; mobile: boolean }

export function readClassicNavPrefs(): NavPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(CLASSIC_NAV_PREFS_KEY) ?? 'null') as Partial<NavPrefs> | null
    return { desktop: raw?.desktop === true, mobile: raw?.mobile === true }
  } catch {
    return { desktop: false, mobile: false }
  }
}

export function useClassicNavCollapse(enabled: boolean, mobile: boolean) {
  const [prefs, setPrefs] = useState(readClassicNavPrefs)
  useEffect(() => {
    if (!enabled) return
    try { localStorage.setItem(CLASSIC_NAV_PREFS_KEY, JSON.stringify(prefs)) } catch { /* 隐私模式仍可在本次启动使用 */ }
  }, [enabled, prefs])
  const key = mobile ? 'mobile' : 'desktop'
  return { collapsed: prefs[key], toggle: () => setPrefs((old) => ({ ...old, [key]: !old[key] })) }
}

/** 占位只在淡出结束后切换；取消定时器/帧回调可中断快速反向操作。 */
export function useClassicLogVisibility(closed: boolean, enabled: boolean) {
  const [phase, setPhase] = useState({ closed, faded: closed })
  const [instant, setInstant] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('no-fx'))
  useEffect(() => {
    if (!enabled) return
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setInstant(media.matches || document.body.classList.contains('no-fx'))
    const observer = new MutationObserver(update)
    media.addEventListener('change', update)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    update()
    return () => { media.removeEventListener('change', update); observer.disconnect() }
  }, [enabled])
  useLayoutEffect(() => {
    if (!enabled || instant) { setPhase({ closed, faded: closed }); return }
    let timer = 0, frame = 0, secondFrame = 0
    if (closed) {
      if (!phase.closed) {
        setPhase({ closed: false, faded: true })
        timer = window.setTimeout(() => setPhase({ closed: true, faded: true }), CLASSIC_LOG_FADE_MS)
      }
    } else if (phase.closed) {
      setPhase({ closed: false, faded: true })
      frame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => setPhase({ closed: false, faded: false }))
      })
    } else setPhase({ closed: false, faded: false })
    return () => { window.clearTimeout(timer); window.cancelAnimationFrame(frame); window.cancelAnimationFrame(secondFrame) }
    // phase 是上次已显示的状态，不作为触发器，避免计时途中重启。
  }, [closed, enabled, instant])
  return enabled && !instant ? phase : { closed, faded: closed }
}
