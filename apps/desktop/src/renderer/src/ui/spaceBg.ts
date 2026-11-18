/// <reference types="vite/client" />
import { tr } from '../i18n/locale'
const TILES = import.meta.glob('../assets/space/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<
  string,
  string
>

const TILE_KEYS: readonly string[] = Object.keys(TILES).sort()

const TILE_URLS: readonly string[] = TILE_KEYS.map((k) => TILES[k]!).filter(
  (u): u is string => typeof u === 'string' && u.length > 0,
)

const TILE_SETS: ReadonlyArray<{ prefix: string; text: string }> = [
  { prefix: 'nebula-blue', get text() { return tr("ui.spaceBg.001") } },
  { prefix: 'nebula-green', get text() { return tr("ui.spaceBg.002") } },
  { prefix: 'nebula-purple', get text() { return tr("ui.spaceBg.003") } },
  { prefix: 'starfield', get text() { return tr("ui.spaceBg.004") } },
]

function shortNameOf(key: string, index: number): string {
  const base = key.split('/').pop() ?? ''
  for (const s of TILE_SETS) {
    if (base.startsWith(`${s.prefix}-`)) return `${s.text} ${base.slice(s.prefix.length + 1).replace(/\.jpg$/i, '')}`
  }
  return tr("ui.spaceBg.005", { p1: index + 1 })
}

export interface SpaceBgInfo {
  url: string
  label: string
  index: number
  total: number
}

let currentIndex: number | null = null

function pickIndex(exclude?: number): number {
  const n = TILE_URLS.length
  if (n <= 1) return 0
  let i = Math.floor(Math.random() * n)
  if (exclude !== undefined && i === exclude) {
    let guard = 0
    while (i === exclude && guard < 32) {
      i = Math.floor(Math.random() * n)
      guard++
    }
    if (i === exclude) i = (exclude + 1) % n
  }
  return i
}

export function spaceBgUrlAt(index: number): string | null {
  const i = Math.floor(index)
  return i >= 0 && i < TILE_URLS.length ? TILE_URLS[i]! : null
}
export function currentSpaceBg(): SpaceBgInfo | null {
  if (currentIndex === null || TILE_URLS.length === 0) return null
  const index = currentIndex
  return {
    url: TILE_URLS[index]!,
    label: shortNameOf(TILE_KEYS[index] ?? '', index),
    index,
    total: TILE_URLS.length,
  }
}

export function applySpaceBg(index?: number): SpaceBgInfo | null {
  if (TILE_URLS.length === 0) return null
  currentIndex = index ?? pickIndex()
  const info = currentSpaceBg()!
  document.documentElement.style.setProperty('--space-bg', `url("${info.url}")`)
  return info
}

export function rerollSpaceBg(): SpaceBgInfo | null {
  if (TILE_URLS.length === 0) return null
  return applySpaceBg(pickIndex(currentIndex ?? undefined))
}
