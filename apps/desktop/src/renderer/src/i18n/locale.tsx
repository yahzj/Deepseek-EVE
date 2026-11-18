import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { L10N, l10nEntryText } from '@whale/data'
import { signalSpaceTextId } from '@whale/core'

export type Locale = 'zh' | 'en'

const LOCALE_KEY = 'whale-idle:locale'

const LIST_SEP_ID = 'core.state.043'

export function detectSystemLocale(): Locale {
  try {
    const list = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]
    for (const raw of list) {
      const low = String(raw ?? '').toLowerCase()
      if (low.startsWith('zh')) return 'zh'
      if (low.startsWith('en')) return 'en'
    }
  } catch {
  }
  return 'zh'
}

export function loadLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
  }
  return detectSystemLocale()
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
  }
}

export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m))
}

let activeLocale: Locale = loadLocale()

export function currentLocale(): Locale {
  return activeLocale
}

export function isEn(): boolean {
  return activeLocale === 'en'
}

export function textOf(id: string, locale: Locale): string {
  const entry = L10N[id]
  if (!entry) return id
  return l10nEntryText(entry, locale)
}

export function futureTr(id: string, params?: Record<string, string | number>): string {
  return interpolate(textOf(id, activeLocale), params)
}

export function tr(id: string, params?: Record<string, string | number>): string {
  return futureTr(signalSpaceTextId(id), params)
}

export function mountNamesTextOf(
  names: readonly string[] | undefined,
  pairs: ReadonlyArray<readonly [string, string]> | undefined,
): string[] {
  if (!names || names.length === 0) return []
  if (!pairs || pairs.length === 0) return [...names]
  const en = isEn()
  return names.map((n, i) => (en ? (pairs[i]?.[1] ?? n) : (pairs[i]?.[0] ?? n)))
}


function resolveParamIds(
  params: Readonly<Record<string, string | number>> | undefined,
  expeditionRules?: number,
): Record<string, string | number> | undefined {
  if (params === undefined) return undefined
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(params)) {
    if (!k.endsWith('Id')) out[k] = v
  }
  for (const [k, v] of Object.entries(params)) {
    if (!/^p\d+Id$/.test(k)) continue
    const base = k.slice(0, -2)
    const rendered = paramText(v, expeditionRules)
    if (rendered !== '') out[base] = rendered
  }
  return out
}

export interface LogEntryText {
  text: string
  textId?: string
  textParams?: Readonly<
    Record<string, string | number | readonly string[] | ReadonlyArray<Readonly<Record<string, string | number>>>>
  >
}

function composeParts(
  entry: LogEntryText,
  text: (id: string, params?: Record<string, string | number>) => string,
): string {
  if (entry.textId === undefined) return entry.text
  const all: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(entry.textParams ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') all[k] = v
  }
  const rawParams = entry.textParams
  const listTextOf = (keyBase: string): string | undefined => {
    const values = rawParams?.[`${keyBase}List`]
    if (!Array.isArray(values)) return undefined
    const itemId = rawParams?.[`${keyBase}ItemId`]
    const tpl = typeof itemId === 'string' ? L10N[itemId] : undefined
    const itemParams = rawParams?.[`${keyBase}ItemParams`]
    const items = values.filter((v): v is string => typeof v === 'string')
    return items
      .map((v, i) => {
        if (tpl === undefined) return v
        const extra = Array.isArray(itemParams) ? (itemParams[i] as Record<string, string | number> | undefined) : undefined
        const inner: Record<string, string | number> = { ...(extra ?? {}) }
        if (inner.p1 === undefined) inner.p1 = v
        return interpolate(l10nEntryText(tpl, activeLocale), inner)
      })
      .join(textOf(LIST_SEP_ID, activeLocale))
  }
  const paramsFor = (i: number): Record<string, string | number> => {
    if (i === 0) {
      const out: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('seg')) continue
        if (/^p\d+p\d+$/.test(k) || /^p\d+Id$/.test(k)) continue
        out[k] = v
      }
      for (const [k, v] of Object.entries(all)) {
        if (!/^p\d+Id$/.test(k)) continue
        const tpl = typeof v === 'string' ? L10N[v] : undefined
        if (tpl === undefined) continue
        const slot = k.slice(0, -2)
        const deep: Record<string, string | number> = {}
        for (const p of tpl.zh.matchAll(/\{(\w+)\}/g)) {
          const name = p[1]!
          const scoped = all[`${slot}${name}`]
          if (scoped !== undefined) deep[name] = scoped
          else if (/^p\d+$/.test(slot) && Object.prototype.hasOwnProperty.call(all, `${name}Id`)) deep[name] = all[name]!
        }
        for (const name of Object.keys(deep)) {
          const innerId = all[`${slot}${name}Id`] ?? all[`seg${slot.slice(1)}${name}Id`]
          if (typeof innerId !== 'string' || L10N[innerId] === undefined) continue
          const inner: Record<string, string | number> = {}
          for (const p of textOf(innerId, 'zh').matchAll(/\{(\w+)\}/g)) {
            const pn = p[1]!
            const segSlot = `seg${slot.slice(1)}`
            const v =
              all[`${segSlot}${name}p${pn.replace(/^p/, '')}`] ??
              all[`${segSlot}${name}${pn}`] ??
              deep[name]
            if (v !== undefined) inner[pn] = v
          }
          deep[name] = interpolate(textOf(innerId, activeLocale), inner)
        }
        delete out[slot]
        out[slot] = interpolate(l10nEntryText(tpl, activeLocale), deep)
      }
      for (const k of Object.keys(rawParams ?? {})) {
        const m = /^p(\d+)List$/.exec(k)
        if (m === null) continue
        const rendered = listTextOf(`p${m[1]}`)
        if (rendered === undefined) continue
        delete out[`p${m[1]}`]
        out[`p${m[1]}`] = rendered
      }
      return out
    }
    const prefix = `seg${i + 1}`
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(prefix) || k.length <= prefix.length) continue
      if (k.endsWith('Id')) continue
      out[k.slice(prefix.length)] = v
    }
    for (const k of Object.keys(rawParams ?? {})) {
      if (!k.startsWith(prefix)) continue
      const m = /^(p\d+)List$/.exec(k.slice(prefix.length))
      if (m === null) continue
      const rendered = listTextOf(`${prefix}${m[1]}`)
      if (rendered === undefined) continue
      out[m[1]] = rendered
    }
    return out
  }
  const rawParts = entry.textParams?.parts
  const savedCount = all.segCount
  const parts = Array.isArray(rawParts)
    ? rawParts.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, 7)
    : typeof savedCount === 'number' && Number.isSafeInteger(savedCount) && savedCount > 0
      ? Array.from({ length: Math.min(savedCount, 7) }, (_, index) => all[`seg${index + 2}Id`])
        .filter((id): id is string => typeof id === 'string' && id !== '')
      : []
  const renderSegment = (id: string, prefix: string, depth = 0): string => {
    const tpl = L10N[id]
    if (!tpl || depth > 8) return String(all[prefix] ?? '')
    const params: Record<string, string | number> = {}
    for (const match of tpl.zh.matchAll(/\{(\w+)\}/g)) {
      const name = match[1]!
      const key = `${prefix}${name}`
      const value = all[key]
      if (value !== undefined) params[name] = value
      const slotId = all[`${key}Id`]
      if (typeof slotId === 'string' && L10N[slotId]) params[name] = renderSegment(slotId, key, depth + 1)
      const list = listTextOf(key)
      if (list !== undefined) params[name] = list
    }
    const count = all[`${prefix}Subs`]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return text(id, params)
    const children: string[] = []
    for (let index = 1; index <= Math.min(count, 32); index++) {
      const childPrefix = `${prefix}p${index}`
      const childId = all[`${childPrefix}Id`]
      if (typeof childId === 'string' && L10N[childId]) children.push(renderSegment(childId, childPrefix, depth + 1))
    }
    if (!children.length) return text(id, params)
    const joined = children.join(activeLocale === 'en' ? '; ' : '；')
    return tpl.zh.includes('{p1}') ? text(id, { ...params, p1: joined }) : text(id, params) + joined
  }
  let out = ''
  if (parts.length === 0) return text(entry.textId, paramsFor(0))
  out += text(entry.textId, paramsFor(0))
  for (let i = 0; i < parts.length; i++) {
    const prefix = `seg${i + 2}`
    out += typeof all[`${prefix}Subs`] === 'number'
      ? renderSegment(parts[i]!, prefix)
      : text(parts[i]!, paramsFor(i + 1))
  }
  return out
}

export function logText(entry: LogEntryText): string {
  return composeParts(entry, (id, params) => futureTr(id, params))
}

export function cmdText(r: CmdTextSource): string {
  if (r.errorId !== undefined && r.expeditionRules === 2) return futureTr(r.errorId, resolveParamIds(r.errorParams, 2))
  if (r.errorId !== undefined) return tr(r.errorId, resolveParamIds(r.errorParams))
  return r.error ?? ''
}

export function futureCmdText(r: CmdTextSource): string {
  return cmdText({ ...r, expeditionRules: 2 })
}

export interface CmdTextSource {
  readonly expeditionRules?: number
  readonly error?: string
  readonly errorId?: string
  readonly errorParams?: Readonly<Record<string, string | number>>
}

export function paramText(idOrRaw: string | number | undefined, expeditionRules?: number): string {
  if (idOrRaw === undefined) return ''
  if (typeof idOrRaw === 'number') return String(idOrRaw)
  return Object.prototype.hasOwnProperty.call(L10N, idOrRaw) ? futureTr(signalSpaceTextId(idOrRaw, expeditionRules)) : idOrRaw
}

export interface L10nApi {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (id: string, params?: Record<string, string | number>) => string
}

const Ctx = createContext<L10nApi>({
  locale: 'zh',
  setLocale: () => undefined,
  t: (id) => id,
})

export function L10nProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(() => activeLocale)
  useEffect(() => {
    activeLocale = locale
    document.documentElement.dataset.locale = locale
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    try {
      const w = window as unknown as { whale?: { setLocale?: (l: string) => void } }
      w.whale?.setLocale?.(locale)
    } catch {
    }
  }, [locale])
  const setLocale = useCallback((next: Locale) => {
    activeLocale = next
    saveLocale(next)
    setLocaleState(next)
  }, [])
  useEffect(() => {
    ;(window as unknown as { __setLocale?: (l: Locale) => void }).__setLocale = setLocale
  }, [setLocale])
  const t = useCallback(
    (id: string, params?: Record<string, string | number>) => interpolate(textOf(signalSpaceTextId(id), locale), params),
    [locale],
  )
  const api = useMemo<L10nApi>(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useL10n(): L10nApi {
  return useContext(Ctx)
}
