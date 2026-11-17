import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ElementType, MouseEvent, ReactNode } from 'react'
import { tooltipLayout } from './tooltipGeometry'

interface TipState {
  content: ReactNode
  cx: number
  cy: number
  x: number
  y: number
  maxWidth: number
  maxHeight: number
}

export const TIP_DELAY_MS = 500

const TIP_STASH_ATTR = 'data-tip-native'

const TIP_ATTR = 'data-tip'

const TIP_HOVER_ATTR = 'data-tip-hover'

let mutedChain: Array<{ el: Element; text: string; n: number }> = []

let isMutingDom = false

function muteTitleChain(el: Element): void {
  isMutingDom = true
  try {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const t = n.getAttribute('title')
      const rec = mutedChain.find((m) => m.el === n)
      if (rec) {
        if (t !== null && t !== '') {
          rec.text = t
          n.setAttribute('title', '')
        }
        rec.n += 1
        continue
      }
      if (t !== null && t !== '') {
        mutedChain.push({ el: n, text: t, n: 1 })
        n.setAttribute('title', '')
      }
    }
  } finally {
    isMutingDom = false
  }
}

function reblankTitleChain(el: Element): void {
  isMutingDom = true
  try {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const t = n.getAttribute('title')
      if (t === null || t === '') continue
      const rec = mutedChain.find((m) => m.el === n)
      if (rec) rec.text = t
      else mutedChain.push({ el: n, text: t, n: 1 })
      n.setAttribute('title', '')
    }
  } finally {
    isMutingDom = false
  }
}

function releaseTitleChain(el: Element): void {
  isMutingDom = true
  try {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const i = mutedChain.findIndex((m) => m.el === n)
      if (i < 0) continue
      const rec = mutedChain[i]!
      rec.n -= 1
      if (rec.n > 0) continue
      mutedChain.splice(i, 1)
      if (!rec.el.isConnected) continue
      const now = rec.el.getAttribute('title')
      if (now === null || now === '') rec.el.setAttribute('title', rec.text)
    }
  } finally {
    isMutingDom = false
  }
}

const listeners = new Set<(s: TipState | null) => void>()
let current: TipState | null = null
let raf = 0

function emit(): void {
  for (const fn of listeners) fn(current)
}

interface Metrics {
  rot: boolean
  s: number
  L: number
  T: number
  bw: number
  bh: number
}

function viewMetrics(): Metrics {
  if (typeof document !== 'undefined') {
    const root = document.querySelector<HTMLElement>('.app-root.is-mobile-rot')
    if (root) {
      const cs = window.getComputedStyle(root)
      const s = parseFloat(cs.getPropertyValue('--mob-scale'))
      const L = parseFloat(cs.getPropertyValue('--mob-x'))
      const T = parseFloat(cs.getPropertyValue('--mob-y'))
      if (Number.isFinite(s) && s > 0 && Number.isFinite(L) && Number.isFinite(T)) {
        return {
          rot: true,
          s,
          L,
          T,
          bw: root.offsetWidth || 1200,
          bh: root.offsetHeight || window.innerHeight,
        }
      }
    }
  }
  return { rot: false, s: 1, L: 0, T: 0, bw: window.innerWidth, bh: window.innerHeight }
}

function toLocal(m: Metrics, x: number, y: number): { x: number; y: number } {
  if (!m.rot) return { x, y }
  return { x: (m.T - y) / m.s, y: (x - m.L) / m.s }
}

const lastPt = { x: -1, y: -1 }
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    lastPt.x = e.clientX
    lastPt.y = e.clientY
  }, { passive: true })
  window.addEventListener('pointermove', (e) => {
    lastPt.x = e.clientX
    lastPt.y = e.clientY
  }, { passive: true })
}

function place(content: ReactNode, cx: number, cy: number): void {
  const m = viewMetrics()
  let px = cx
  let py = cy
  if (px === 0 && py === 0 && lastPt.x >= 0) {
    px = lastPt.x
    py = lastPt.y
  }
  const lp = toLocal(m, px, py)
  current = { content, cx: lp.x, cy: lp.y, ...tooltipLayout(m, lp) }
  emit()
}

export function showTip(content: ReactNode, clientX: number, clientY: number): void {
  place(content, clientX, clientY)
}

let shownOwner: object | null = null
let pendingOwner: object | null = null
let pendingTimer = 0

function cancelPending(): void {
  if (pendingTimer !== 0) {
    window.clearTimeout(pendingTimer)
    pendingTimer = 0
  }
  pendingOwner = null
}

type HoverEnterEvent = MouseEvent<Element>

function deeperOwnerWins(e: HoverEnterEvent): boolean {
  const cur = e.currentTarget
  let n: Element | null = (e.target as Element | null) ?? null
  while (n && n !== cur && n.nodeType === 1) {
    if (n.hasAttribute('title') || n.hasAttribute(TIP_ATTR) || n.hasAttribute(TIP_HOVER_ATTR)) return true
    n = n.parentElement
  }
  return false
}

export function hoverTipProps(content: ReactNode): {
  'data-tip-hover': string
  onMouseEnter: (e: HoverEnterEvent) => void
  onMouseMove: (e: HoverEnterEvent) => void
  onMouseLeave: () => void
} {
  const me = {}
  let last: { x: number; y: number } = { x: 0, y: 0 }
  let mutedEl: Element | null = null
  return {
    [TIP_HOVER_ATTR]: '1',
    onMouseEnter: (e: HoverEnterEvent) => {
      if (deeperOwnerWins(e)) return
      const el = e.currentTarget as unknown as Element | null
      if (el && typeof el.closest === 'function' && mutedEl === null) {
        muteTitleChain(el)
        mutedEl = el
      }
      last = { x: e.clientX, y: e.clientY }
      if (shownOwner === me) return
      cancelPending()
      pendingOwner = me
      pendingTimer = window.setTimeout(() => {
        pendingTimer = 0
        if (pendingOwner !== me) return
        pendingOwner = null
        shownOwner = me
        showTip(content, last.x, last.y)
      }, TIP_DELAY_MS)
    },
    onMouseMove: (e: HoverEnterEvent) => {
      last = { x: e.clientX, y: e.clientY }
      if (shownOwner === me) moveTip(content, last.x, last.y)
    },
    onMouseLeave: () => {
      if (mutedEl !== null) {
        releaseTitleChain(mutedEl)
        mutedEl = null
      }
      if (pendingOwner === me) cancelPending()
      if (shownOwner === me) {
        shownOwner = null
        hideTip()
      }
    },
  }
}

export function moveTip(content: ReactNode, clientX: number, clientY: number): void {
  if (raf !== 0) return
  raf = requestAnimationFrame(() => {
    raf = 0
    place(content, clientX, clientY)
  })
}

export function hideTip(): void {
  if (raf !== 0) {
    cancelAnimationFrame(raf)
    raf = 0
  }
  if (current !== null) {
    current = null
    emit()
  }
}

export function TooltipLayer(): ReactNode {
  const [state, setState] = useState<TipState | null>(null)
  const [displayState, setDisplayState] = useState<TipState | null>(null)
  const [isLeaving, setIsLeaving] = useState(false)
  const leaveTimerRef = useRef<number>(0)
  const shownRef = useRef(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])

  useEffect(() => {
    const dismiss = (): void => hideTip()
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [])

  useEffect(() => {
    if (state !== null) {
      shownRef.current = true
      if (leaveTimerRef.current !== 0) {
        window.clearTimeout(leaveTimerRef.current)
        leaveTimerRef.current = 0
      }
      setDisplayState(state)
      setIsLeaving(false)
      return
    }
    if (!shownRef.current) return
    shownRef.current = false
    setIsLeaving(true)
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = 0
      setDisplayState(null)
      setIsLeaving(false)
    }, 140)
  }, [state])

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current !== 0) {
        window.clearTimeout(leaveTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let timer = 0
    let hovered: Element | null = null
    let hoveredAt = 0
    let shown: { el: Element; text: string; svgTitle: Element | null; from: 'title' | 'tip' | 'stash' } | null = null
    let mutedSrc: TipSrc | null = null
    let obs: MutationObserver | null = null

    type TipSrc = { el: Element; text: string; svgTitle: Element | null; from: 'title' | 'tip' | 'stash' }

    const srcOf = (el: Element | null): TipSrc | null => {
      if (!el || typeof el.closest !== 'function') return null
      const attrEl = el.closest(`[title], [${TIP_ATTR}], [${TIP_STASH_ATTR}]`)
      if (attrEl) {
        if (attrEl.hasAttribute(TIP_HOVER_ATTR)) return null
        const richOwner = el.closest(`[${TIP_HOVER_ATTR}]`)
        if (richOwner && attrEl !== richOwner && attrEl.contains(richOwner)) return null
        const rawTitle = attrEl.getAttribute('title')
        const title = rawTitle !== null && rawTitle !== '' ? rawTitle : null
        const authored = attrEl.getAttribute(TIP_ATTR)
        const stashed = attrEl.getAttribute(TIP_STASH_ATTR)
        const from = title !== null ? 'title' : authored !== null ? 'tip' : 'stash'
        return { el: attrEl, text: title ?? authored ?? stashed ?? '', svgTitle: null, from }
      }
      if (el.closest('svg') !== null) {
        for (let n: Element | null = el; n && n.tagName.toLowerCase() !== 'svg'; n = n.parentElement) {
          for (let c = n.firstElementChild; c; c = c.nextElementSibling) {
            if (c.tagName.toLowerCase() === 'title') {
              return { el: n, text: (c.textContent ?? '').trim(), svgTitle: c, from: 'title' }
            }
          }
        }
      }
      return null
    }


    const muteNative = (src: TipSrc): void => {
      isMutingDom = true
      try {
        if (src.svgTitle) {
          if ((src.svgTitle.textContent ?? '') !== '') src.svgTitle.textContent = ''
        } else if (src.from === 'title') {
          src.el.setAttribute(TIP_STASH_ATTR, src.text)
        }
        const same = mutedSrc !== null && mutedSrc.el === src.el
        if (mutedSrc !== null && !same) unmuteNative()
        if (same) reblankTitleChain(src.el)
        else muteTitleChain(src.el)
        mutedSrc = src
        obs?.takeRecords()
      } finally {
        isMutingDom = false
      }
    }

    const putBack = (): void => {
      unmuteNative()
      shown = null
    }

    const unmuteNative = (): void => {
      obs?.disconnect()
      obs = null
      const s = mutedSrc
      mutedSrc = null
      isMutingDom = true
      try {
        if (s) releaseTitleChain(s.el)
        if (!s) return
        if (s.svgTitle) {
          if ((s.svgTitle.textContent ?? '') === '') s.svgTitle.textContent = s.text
          return
        }
        const stashed = s.el.getAttribute(TIP_STASH_ATTR)
        if (stashed === null) return
        s.el.removeAttribute(TIP_STASH_ATTR)
        const now = s.el.getAttribute('title')
        if (now === null || now === '') s.el.setAttribute('title', stashed)
      } finally {
        isMutingDom = false
      }
    }

    const anchorOf = (el: Element): { x: number; y: number } => {
      const r = el.getBoundingClientRect()
      return {
        x: lastPt.x >= 0 ? lastPt.x : Math.round(r.left + Math.min(r.width / 2, 160)),
        y: lastPt.y >= 0 ? lastPt.y : Math.round(r.bottom - 4),
      }
    }

    const maybeTake = (): void => {
      if (shown) return
      const el = hovered
      if (!el || !el.isConnected) return
      if (performance.now() - hoveredAt < TIP_DELAY_MS) return
      const src = srcOf(el)
      if (!src || src.text.trim() === '') return
      muteNative(src)
      const a = anchorOf(src.el)
      shown = { el: src.el, text: src.text, svgTitle: src.svgTitle, from: src.from }
      watch(el, src.svgTitle)
      showTip(src.text, a.x, a.y)
    }

    const watch = (el: Element, svgTitle: Element | null): void => {
      obs?.disconnect()
      obs = new MutationObserver(() => {
        if (isMutingDom) return
        if (!hovered || !hovered.isConnected) {
          putBack()
          hideTip()
          hovered = null
          return
        }
        if (!shown) {
          maybeTake()
          return
        }
        const src = srcOf(hovered)
        if (!src || src.el !== shown.el) return
        if (src.svgTitle) {
          if ((src.svgTitle.textContent ?? '') !== '') src.svgTitle.textContent = ''
          const fresh = src.text.trim()
          if (fresh === '' || fresh === shown.text) return
          shown.text = fresh
        } else {
          const rawTitle = src.el.getAttribute('title')
          if (rawTitle === null || rawTitle === '') return
          const fresh = src.text
          if (fresh.trim() === '') return
          muteNative(src)
          if (fresh === shown.text) return
          shown.text = fresh
        }
        const a = anchorOf(shown.el)
        showTip(shown.text, a.x, a.y)
      })
      obs.observe(el, { attributes: true, attributeFilter: ['title', TIP_ATTR] })
      if (svgTitle) obs.observe(svgTitle, { childList: true, characterData: true, subtree: true })
    }

    const ownerOf = (el: Element): Element => srcOf(el)?.el ?? el

    const armAgain = (el: Element): void => {
      hovered = el
      hoveredAt = performance.now()
      const src0 = srcOf(el)
      if (src0 && src0.text.trim() !== '') muteNative(src0)
      if (timer !== 0) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        maybeTake()
      }, TIP_DELAY_MS)
      watch(el, null)
    }

    let lastEnterTarget: Element | null = null
    let lastLeaveTarget: Element | null = null
    let lastLeaveTo: Element | null = null

    const onEnter = (e: Event): void => {
      const t = e.target as Element | null
      if (!t || typeof t.closest !== 'function') return
      if (hovered === t || lastEnterTarget === t) return
      lastEnterTarget = t
      lastLeaveTarget = null
      if (hovered && hovered.contains(t) && ownerOf(t) === ownerOf(hovered)) {
        hovered = t
        watch(t, null)
        return
      }
      putBack()
      hideTip()
      armAgain(t)
    }
    const onLeave = (e: Event): void => {
      if (!hovered) return
      const t = e.target as Element | null
      const to = (e as unknown as { relatedTarget?: Node | null }).relatedTarget ?? null
      const toEl = to !== null && to.nodeType === 1 ? (to as Element) : null
      if (lastLeaveTarget === t && lastLeaveTo === toEl) return
      lastLeaveTarget = t
      lastLeaveTo = toEl
      lastEnterTarget = null
      if (toEl !== null) {
        const owner = ownerOf(hovered)
        if (toEl === owner || owner.contains(toEl)) return
        putBack()
        hideTip()
        armAgain(toEl)
        return
      }
      if (timer !== 0) {
        window.clearTimeout(timer)
        timer = 0
      }
      putBack()
      hideTip()
      hovered = null
    }
    const onMove = (e: Event): void => {
      if (!shown || shown.text === '') return
      const me = e as unknown as { clientX: number; clientY: number }
      if (typeof me.clientX !== 'number') return
      moveTip(shown.text, me.clientX, me.clientY)
    }
    document.addEventListener('mouseover', onEnter, true)
    document.addEventListener('mouseout', onLeave, true)
    document.addEventListener('pointerover', onEnter, true)
    document.addEventListener('pointerout', onLeave, true)
    document.addEventListener('mousemove', onMove, true)
    document.addEventListener('pointermove', onMove, true)
    return () => {
      putBack()
      document.removeEventListener('mouseover', onEnter, true)
      document.removeEventListener('mouseout', onLeave, true)
      document.removeEventListener('pointerover', onEnter, true)
      document.removeEventListener('pointerout', onLeave, true)
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('pointermove', onMove, true)
    }
  }, [])

  useLayoutEffect(() => {
    if (!displayState || displayState.cx < 0) return
    const el = ref.current
    if (!el) return
    const m = viewMetrics()
    const layout = tooltipLayout(m, { x: displayState.cx, y: displayState.cy }, { width: el.offsetWidth, height: el.offsetHeight })
    setDisplayState((s) => (s && s.cx >= 0 ? { ...s, cx: -1, cy: -1, ...layout } : s))
  }, [displayState])

  if (!displayState) return null
  const isMeasuring = displayState.cx >= 0
  return (
    <div
      ref={ref}
      className={`app-tip${isLeaving ? ' is-leaving' : ''}${isMeasuring ? ' is-measuring' : ''}`}
      style={{
        left: displayState.x,
        top: displayState.y,
        maxWidth: displayState.maxWidth,
        maxHeight: displayState.maxHeight,
        visibility: isMeasuring ? 'hidden' : 'visible',
      }}
    >
      {displayState.content}
    </div>
  )
}

export function HoverTip({
  as,
  tip,
  children,
  ...rest
}: {
  as?: ElementType
  tip: string
  children: ReactNode
  [key: string]: unknown
}) {
  const Tag = (as ?? 'div') as ElementType
  if (!tip) return <Tag {...rest}>{children}</Tag>
  return (
    <Tag {...rest} {...hoverTipProps(tip)}>
      {children}
    </Tag>
  )
}
