
const PREFIX = 'whale-idle:exch-'

export const EXCH_PREF = {
  viewMode: `${PREFIX}view-mode`,
  code: `${PREFIX}code`,
  proSide: `${PREFIX}pro-side`,
  proOrder: `${PREFIX}pro-order`,
  simpleSide: `${PREFIX}simple-side`,
  chartPeriod: `${PREFIX}chart-period`,
  chartToggles: `${PREFIX}chart-toggles`,
} as const

function readRaw(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key)
    return value !== null && value !== '' ? value : null
  } catch {
    return null
  }
}

export const EXCHANGE_PREF_EVENT = 'whale-exchange-pref-change'

export function jumpExchangePage(view: 'simple' | 'pro', side?: string): void {
  writeExchangePref(EXCH_PREF.viewMode, view)
  if (view === 'simple' && side) writeExchangePref(EXCH_PREF.simpleSide, side)
  if (view === 'pro' && side) writeExchangePref(EXCH_PREF.proSide, side)
  try {
    window.dispatchEvent(new Event(EXCHANGE_PREF_EVENT))
  } catch {
  }
}

export function writeExchangePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
  }
}

export function readExchangeChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const saved = readRaw(key)
  return saved !== null && (allowed as readonly string[]).includes(saved) ? (saved as T) : fallback
}

export function readExchangeCode(fallback: string): string {
  return readRaw(EXCH_PREF.code) ?? fallback
}

export function readExchangeToggles<T extends Record<string, boolean>>(fallback: T): T {
  const saved = readRaw(EXCH_PREF.chartToggles)
  if (saved === null) return fallback
  try {
    const parsed = JSON.parse(saved) as Record<string, unknown>
    const next: Record<string, boolean> = { ...fallback }
    for (const key of Object.keys(fallback)) {
      const value = parsed[key]
      if (typeof value === 'boolean') next[key] = value
    }
    return next as T
  } catch {
    return fallback
  }
}

export function writeExchangeToggles(toggles: Record<string, boolean>): void {
  try {
    writeExchangePref(EXCH_PREF.chartToggles, JSON.stringify(toggles))
  } catch {
  }
}
