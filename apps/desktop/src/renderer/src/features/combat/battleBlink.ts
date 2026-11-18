
import type { DamageType } from '@whale/core'


export function ammoKey(t: DamageType): 'kin' | 'exp' | 'pla' {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}

const BLINK_FX_MS = 420

export type BlinkPillarFx = {
  key: string
  tag: string
  side: 'foe' | 'me'
  at: number
  until: number
  el?: SVGSVGElement
}

export function planBlinkPillars(
  b:
    | {
        foeBlinkQueue?: Record<string, { queuedMs: number; vanishMs: number; moveAtMs: number; appearMs: number }>
        meBlinkQueue?: Record<string, { queuedMs: number; vanishMs: number; moveAtMs: number; appearMs: number }>
        lastTickGameMs?: number
        speedX?: number
      }
    | null
    | undefined,
  seen: Set<string>,
  out: BlinkPillarFx[],
  now: number,
  roots: { foe: HTMLElement | null; me: HTMLElement | null },
): void {
  if (!b) return
  const last = b.lastTickGameMs ?? 0
  const speed = Math.max(0.01, b.speedX ?? 1)
  const toReal = (gameMs: number): number => (gameMs - last) / speed

  const membersOf = (side: 'foe' | 'me'): string[] => {
    const root = roots[side]
    if (!root) return []
    return [...root.querySelectorAll<HTMLElement>('[data-tag]')]
      .map((el) => el.dataset.tag)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
  }

  const planSide = (
    q: Record<string, { queuedMs: number; vanishMs: number; moveAtMs: number; appearMs: number }> | undefined,
    side: 'foe' | 'me',
  ): void => {
    if (!q) return
    const members = membersOf(side)
    if (members.length === 0) return
    for (const seg of Object.values(q)) {
      for (const member of members) {
        const key = `${side}:${member}:${seg.queuedMs}`
        if (seen.has(key)) continue
        seen.add(key)
        const uniq = key.replace(/[^A-Za-z0-9_-]/g, '-')
        if (toReal(seg.moveAtMs) > 0) {
          const vanishAt = now + Math.max(0, toReal(seg.vanishMs))
          out.push({ key: `${uniq}-a`, tag: member, side, at: vanishAt, until: vanishAt + BLINK_FX_MS })
        }
        const appearDelay = toReal(seg.appearMs)
        if (appearDelay > -BLINK_FX_MS) {
          const appearAt = now + Math.max(0, appearDelay)
          out.push({ key: `${uniq}-b`, tag: member, side, at: appearAt, until: appearAt + BLINK_FX_MS })
        }
      }
    }
  }
  planSide(b.foeBlinkQueue, 'foe')
  planSide(b.meBlinkQueue, 'me')
}

export function buildBlinkPillarEl(uniq: string, size: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const w = Math.max(24, Math.round(size * 0.85))
  const h = Math.max(48, Math.round(size * 2))
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'app-bts-blink-pillar')
  svg.setAttribute('viewBox', '-50 -95 100 190')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.width = `${w}px`
  svg.style.height = `${h}px`
  svg.style.left = '50%'
  svg.style.top = '50%'
  svg.style.marginLeft = `${-Math.round(w / 2)}px`
  svg.style.marginTop = `${-Math.round(h / 2)}px`
  svg.style.overflow = 'visible'
  const defs = document.createElementNS(NS, 'defs')
  const lineGrad = document.createElementNS(NS, 'linearGradient')
  lineGrad.setAttribute('id', `blink-pillar-line-${uniq}`)
  lineGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
  lineGrad.setAttribute('x1', '0')
  lineGrad.setAttribute('y1', '-95')
  lineGrad.setAttribute('x2', '0')
  lineGrad.setAttribute('y2', '95')
  for (const [off, color] of [
    ['0%', '#1a3f9e'],
    ['42%', '#2ea8e0'],
    ['58%', '#3fe0f0'],
    ['100%', '#1a3f9e'],
  ] as const) {
    const st = document.createElementNS(NS, 'stop')
    st.setAttribute('offset', off)
    st.setAttribute('stop-color', color)
    lineGrad.appendChild(st)
  }
  const fadeGrad = document.createElementNS(NS, 'linearGradient')
  fadeGrad.setAttribute('id', `blink-pillar-fade-${uniq}`)
  fadeGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
  fadeGrad.setAttribute('x1', '0')
  fadeGrad.setAttribute('y1', '-95')
  fadeGrad.setAttribute('x2', '0')
  fadeGrad.setAttribute('y2', '95')
  for (const [off, color] of [
    ['0%', '#000'],
    ['25%', '#fff'],
    ['75%', '#fff'],
    ['100%', '#000'],
  ] as const) {
    const st = document.createElementNS(NS, 'stop')
    st.setAttribute('offset', off)
    st.setAttribute('stop-color', color)
    fadeGrad.appendChild(st)
  }
  const mask = document.createElementNS(NS, 'mask')
  mask.setAttribute('id', `blink-pillar-mask-${uniq}`)
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('x', '-50')
  mask.setAttribute('y', '-95')
  mask.setAttribute('width', '100')
  mask.setAttribute('height', '190')
  const maskRect = document.createElementNS(NS, 'rect')
  maskRect.setAttribute('x', '-50')
  maskRect.setAttribute('y', '-95')
  maskRect.setAttribute('width', '100')
  maskRect.setAttribute('height', '190')
  maskRect.setAttribute('fill', `url(#blink-pillar-fade-${uniq})`)
  mask.appendChild(maskRect)
  defs.append(lineGrad, fadeGrad, mask)
  svg.appendChild(defs)
  const g = document.createElementNS(NS, 'g')
  g.setAttribute('mask', `url(#blink-pillar-mask-${uniq})`)
  const N = 52
  for (let i = 0; i < N; i++) {
    const x = -50 + (i / (N - 1)) * 100
    const d = Math.abs(x) / 50
    const ln = document.createElementNS(NS, 'line')
    ln.setAttribute('x1', String(x))
    ln.setAttribute('y1', '-95')
    ln.setAttribute('x2', String(x))
    ln.setAttribute('y2', '95')
    ln.setAttribute('stroke', `url(#blink-pillar-line-${uniq})`)
    ln.setAttribute('stroke-width', String(0.45 + (1 - d) * 1.05))
    ln.setAttribute('opacity', String(0.12 + Math.pow(1 - d, 1.6) * 0.85))
    g.appendChild(ln)
  }
  svg.appendChild(g)
  return svg
}

export function syncBlinkPillarDom(
  fxList: BlinkPillarFx[],
  lookupRoot: HTMLElement | null,
  now: number,
  side: 'foe' | 'me',
  appendHost: HTMLElement | null = lookupRoot,
): void {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const fx = fxList[i]!
    if (fx.side !== side) continue
    if (now >= fx.until) {
      fx.el?.remove()
      fxList.splice(i, 1)
      continue
    }
    if (fx.el || now < fx.at || !lookupRoot || !appendHost) continue
    const host = lookupRoot.querySelector<HTMLElement>(`[data-tag="${CSS.escape(fx.tag)}"]`)
    if (!host) continue
    const w = host.offsetWidth || 96
    const h = host.offsetHeight || 96
    const el = buildBlinkPillarEl(fx.key, Math.max(w, h))
    el.style.left = `${host.offsetLeft + w / 2}px`
    el.style.top = `${host.offsetTop + h / 2}px`
    appendHost.appendChild(el)
    fx.el = el
  }
}