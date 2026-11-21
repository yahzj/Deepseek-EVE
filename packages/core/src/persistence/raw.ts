import type { RawState } from '../save'

export function asRaw(value: unknown): RawState {
  return typeof value === 'object' && value !== null ? (value as RawState) : {}
}

export function cleanPosNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

export function cleanCountMap(raw: unknown): Record<string, number> | undefined {
  const r = asRaw(raw)
  let out: Record<string, number> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const n = cleanPosNum(v)
    if (n === undefined) continue
    if (!out) out = {}
    out[k] = Math.floor(n)
  }
  return out
}

export function cleanCountMapBy(raw: unknown, preserveEmpty = false): Record<string, Record<string, number>> | undefined {
  const r = asRaw(raw)
  let out: Record<string, Record<string, number>> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const inner = cleanCountMap(v)
    const emptyRecord = v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0
    if (!inner && !(preserveEmpty && emptyRecord)) continue
    if (!out) out = {}
    out[k] = inner ?? {}
  }
  return out
}

export function cleanLedgerMap<T>(
  raw: unknown,
  cleanOne: (v: unknown) => T | undefined,
): Record<string, T> | undefined {
  const r = asRaw(raw)
  let out: Record<string, T> | undefined
  for (const [tag, v] of Object.entries(r)) {
    if (tag.length === 0) continue
    const one = cleanOne(v)
    if (one === undefined) continue
    if (!out) out = {}
    out[tag] = one
  }
  return out
}

export const PLUG_LIST_MAX = 8

export const RACK_MAX = 7 + PLUG_LIST_MAX

export function cleanPlugIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const x of raw) {
    if (typeof x !== 'string') continue
    const id = x.trim()
    if (id.length === 0) continue
    out.push(id)
    if (out.length >= PLUG_LIST_MAX) break
  }
  return out.length > 0 ? out : undefined
}

export function cleanAmmoIdMap(raw: unknown): Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined {
  const r = asRaw(raw)
  let out: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const v = r[t]
    if (typeof v === 'string' && v.length > 0) {
      if (!out) out = {}
      out[t] = v
    }
  }
  return out
}
