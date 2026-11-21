
import type { RngState } from './state'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(text: string): number {
  let h = (1779033703 ^ text.length) >>> 0
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353) >>> 0
  }
  h = Math.imul(h ^ (h >>> 13), 3864292196) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

export function nextRandom(rng: RngState): number {
  rng.count += 1
  return mulberry32((rng.seed + rng.count * 0x9e3779b9) >>> 0)()
}

export function nextInt(rng: RngState, max: number): number {
  return Math.floor(nextRandom(rng) * max)
}

export function pickOne<T>(rng: RngState, items: readonly T[]): T | undefined {
  return items[nextInt(rng, items.length)]
}

export function pickWeighted<T>(
  rng: RngState,
  items: readonly T[],
  weightOf: (item: T) => number,
  opts?: { bound?: 'lt' | 'lte' },
): T | undefined {
  const roll = nextRandom(rng)
  let total = 0
  for (const it of items) total += Math.max(0, weightOf(it))
  if (items.length === 0 || total <= 0) return undefined
  const r = roll * total
  const inclusive = opts?.bound === 'lte'
  let acc = 0
  for (const it of items) {
    acc += Math.max(0, weightOf(it))
    if (inclusive ? r <= acc : r < acc) return it
  }
  return undefined
}
