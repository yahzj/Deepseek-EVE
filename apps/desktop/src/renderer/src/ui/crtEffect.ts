import { readLayoutPref } from './layoutPreference'

export type CrtEffect = 'off' | 'on'

export const CRT_KEY = 'whale-idle:ui-crt'
export const CRT_KEY_MODERN = 'whale-idle:ui-crt-modern'
export const CRT_KEY_CLASSIC = 'whale-idle:ui-crt-classic'

function crtStorageKey(isModern: boolean): string {
  return isModern ? CRT_KEY_MODERN : CRT_KEY_CLASSIC
}

export function readCrtEffect(): CrtEffect {
  try {
    if (typeof localStorage === 'undefined') return 'off'
    const isModern = readLayoutPref() === 'modern'
    const key = crtStorageKey(isModern)
    const stored = localStorage.getItem(key)
    if (stored === 'on') return 'on'
    if (stored === 'off') return 'off'

    return 'off'
  } catch {
    return 'off'
  }
}

export function saveCrtEffect(effect: CrtEffect): void {
  try {
    if (typeof localStorage === 'undefined') return
    const isModern = readLayoutPref() === 'modern'
    const key = crtStorageKey(isModern)
    localStorage.setItem(key, effect)
    localStorage.setItem(CRT_KEY, effect)
  } catch {
  }
}

export const CRT_WARP_FILTER_ID = 'whale-crt-warp'

let cachedBarrelMapDataUrl: string | null = null

function getBarrelDisplacementDataUrl(): string {
  if (cachedBarrelMapDataUrl !== null) return cachedBarrelMapDataUrl
  try {
    if (typeof document === 'undefined') return ''
    const size = 256
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    const imgData = ctx.createImageData(size, size)
    const d = imgData.data
    const deadzone = 0.58
    const maxR = 1.414
    const range = maxR - deadzone
    for (let y = 0; y < size; y++) {
      const ny = (y / (size - 1)) * 2 - 1
      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1
        const r = Math.sqrt(nx * nx + ny * ny)
        let factor = 0
        if (r > deadzone) {
          const t = (r - deadzone) / range
          factor = t * t * 0.42
        }
        const dx = nx * factor
        const dy = ny * factor
        const rVal = Math.min(255, Math.max(0, Math.round(128 + dx * 127)))
        const gVal = Math.min(255, Math.max(0, Math.round(128 + dy * 127)))
        const idx = (y * size + x) * 4
        d[idx] = rVal
        d[idx + 1] = gVal
        d[idx + 2] = 128
        d[idx + 3] = 255
      }
    }
    ctx.putImageData(imgData, 0, 0)
    cachedBarrelMapDataUrl = canvas.toDataURL('image/png')
    return cachedBarrelMapDataUrl
  } catch {
    return ''
  }
}

function ensureWarpFilterDef(): void {
  try {
    if (document.getElementById(CRT_WARP_FILTER_ID) !== null) return
    const mapHref = getBarrelDisplacementDataUrl()
    if (!mapHref) return

    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    svg.style.overflow = 'hidden'
    const filter = document.createElementNS(NS, 'filter')
    filter.setAttribute('id', CRT_WARP_FILTER_ID)
    filter.setAttribute('x', '-6%')
    filter.setAttribute('y', '-6%')
    filter.setAttribute('width', '112%')
    filter.setAttribute('height', '112%')
    filter.setAttribute('color-interpolation-filters', 'sRGB')

    const bmap = document.createElementNS(NS, 'feImage')
    bmap.setAttribute('id', 'whale-crt-barrel-map')
    bmap.setAttribute('result', 'barrelMap')
    bmap.setAttribute('preserveAspectRatio', 'none')
    bmap.setAttribute('href', mapHref)

    const warp = document.createElementNS(NS, 'feDisplacementMap')
    warp.setAttribute('in', 'SourceGraphic')
    warp.setAttribute('in2', 'barrelMap')
    warp.setAttribute('scale', '24')
    warp.setAttribute('xChannelSelector', 'R')
    warp.setAttribute('yChannelSelector', 'G')
    warp.setAttribute('result', 'warped')

    const sat = document.createElementNS(NS, 'feColorMatrix')
    sat.setAttribute('in', 'warped')
    sat.setAttribute('type', 'matrix')
    sat.setAttribute('values', '1.04 0 0 0 0  0 1.05 0 0 0  0 0 1.08 0 0  0 0 0 1 0')

    filter.append(bmap, warp, sat)
    svg.appendChild(filter)
    document.body.appendChild(svg)
  } catch {
  }
}

const BUSY_FLAG = 'data-ui-crt-scroll'
const WARP_OFF_FLAG = 'data-ui-crt-warp-off'
const busySources = new Set<string>()
let scrollIdleTimer: ReturnType<typeof setTimeout> | null = null
let busyWatchInstalled = false
let warpOffTimer: ReturnType<typeof setTimeout> | null = null
let warpOnRaf = 0

function clearBusyTimers(): void {
  if (warpOffTimer !== null) {
    clearTimeout(warpOffTimer)
    warpOffTimer = null
  }
  if (warpOnRaf !== 0) {
    cancelAnimationFrame(warpOnRaf)
    warpOnRaf = 0
  }
}

function syncBusyFlag(): void {
  try {
    const root = document.documentElement
    if (root.dataset.uiCrt !== 'on') {
      clearBusyTimers()
      root.removeAttribute(BUSY_FLAG)
      root.removeAttribute(WARP_OFF_FLAG)
      return
    }
    if (busySources.size > 0) {
      if (warpOnRaf !== 0) {
        cancelAnimationFrame(warpOnRaf)
        warpOnRaf = 0
      }
      if (root.getAttribute(BUSY_FLAG) !== '1') root.setAttribute(BUSY_FLAG, '1')
      if (warpOffTimer === null) {
        warpOffTimer = setTimeout(() => {
          warpOffTimer = null
          if (busySources.size > 0) document.documentElement.setAttribute(WARP_OFF_FLAG, '1')
        }, 220)
      }
      return
    }
    if (warpOffTimer !== null) {
      clearTimeout(warpOffTimer)
      warpOffTimer = null
    }
    if (root.getAttribute(WARP_OFF_FLAG) === '1') {
      root.removeAttribute(WARP_OFF_FLAG)
      if (warpOnRaf === 0) {
        warpOnRaf = requestAnimationFrame(() => {
          warpOnRaf = 0
          if (busySources.size === 0) document.documentElement.removeAttribute(BUSY_FLAG)
        })
      }
      return
    }
    if (root.getAttribute(BUSY_FLAG) === '1') root.removeAttribute(BUSY_FLAG)
  } catch {
  }
}

export function setCrtBusy(source: string, busy: boolean): void {
  if (busy) busySources.add(source)
  else busySources.delete(source)
  syncBusyFlag()
}

function installScrollDowngrade(): void {
  if (busyWatchInstalled) return
  if (typeof document === 'undefined') return
  busyWatchInstalled = true
  document.addEventListener(
    'scroll',
    () => {
      try {
        if (document.documentElement.dataset.uiCrt !== 'on') return
        setCrtBusy('scroll', true)
        if (scrollIdleTimer !== null) clearTimeout(scrollIdleTimer)
        scrollIdleTimer = setTimeout(() => {
          scrollIdleTimer = null
          setCrtBusy('scroll', false)
        }, 160)
      } catch {
      }
    },
    { capture: true, passive: true },
  )
}

export function applyCrtEffect(effect: CrtEffect): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  if (effect === 'on') {
    ensureWarpFilterDef()
    installScrollDowngrade()
    root.dataset.uiCrt = 'on'
    syncBusyFlag()
  } else {
    busySources.clear()
    clearBusyTimers()
    delete root.dataset.uiCrt
    root.removeAttribute(BUSY_FLAG)
    root.removeAttribute(WARP_OFF_FLAG)
  }
}

export function chooseCrtEffect(effect: CrtEffect): void {
  saveCrtEffect(effect)
  applyCrtEffect(effect)
}
