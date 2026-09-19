/**
 * 语言（本地化）骨架 · 2026-09-19 船长令「希望对游戏进行英语本地化处理」。
 *
 * 口径权威：`docs/glossary-en.md`（术语与专名）· 工程做法：`docs/design/l10n-en-20260919.md`。
 *
 * 三条纪律：
 * ① 词典**以中文源串为 key**（`t('装配')`）——缺 key 自动回退中文 ⇒ 可分批翻、永不白屏，
 *    并由 `npm run l10n:check` 列出未译清单；
 * ② 语言存 `localStorage`（`whale-idle:locale`），**不进存档** ⇒ 存档保持语言中立；
 * ③ 默认**跟随系统**（`navigator.language`），设置面板里可随时覆盖。
 *
 * 为什么这样切：界面字符串是内联中文（≈3,500 条），key 化重构面太大；源串 key 让调用点只多一层
 * `t(...)`，中文原文仍是唯一真源（改中文文案即改 key，死 key 由工具点名）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { EN } from './dict.en'

export type Locale = 'zh' | 'en'

/** 语言偏好键（与既有 `whale-idle:ui-zoom` / `:ui-fs` 同族） */
const LOCALE_KEY = 'whale-idle:locale'

/** 系统语言 → 本作语言：首选语言是 zh* ⇒ 中文；其余（含 ja/ru 等本作没有的语言）⇒ 英文 */
export function detectSystemLocale(): Locale {
  try {
    const list = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language]
    for (const raw of list) {
      const low = String(raw ?? '').toLowerCase()
      if (low.startsWith('zh')) return 'zh'
      if (low.startsWith('en')) return 'en'
    }
  } catch {
    /* 取不到就当中文（本作母语） */
  }
  return 'zh'
}

export function loadLocale(): Locale {
  try {
    const v = localStorage.getItem(LOCALE_KEY)
    if (v === 'zh' || v === 'en') return v
  } catch {
    /* 忽略 */
  }
  return detectSystemLocale()
}

export function saveLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    /* 忽略 */
  }
}

/** 模板插值：`interpolate('已售出 {n} 单位', { n: 12 })`；中英占位符集合由 `l10n:check` 对齐 */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m))
}

/** 模块级当前语言（供非组件代码用：格式化辅助 / 启动文案） */
let activeLocale: Locale = loadLocale()

export function currentLocale(): Locale {
  return activeLocale
}

export function isEn(): boolean {
  return activeLocale === 'en'
}

/** 组件外也能用的翻译（读模块级语言；组件内请用 `useL10n().t` 以获得重渲染） */
export function tr(zh: string, params?: Record<string, string | number>): string {
  const text = activeLocale === 'zh' ? zh : (EN[zh] ?? zh)
  return interpolate(text, params)
}

export interface L10nApi {
  locale: Locale
  setLocale: (locale: Locale) => void
  /** 译一条界面文案（参数 {name} 形式插值）；缺词条回退中文原文 */
  t: (zh: string, params?: Record<string, string | number>) => string
}

const Ctx = createContext<L10nApi>({
  locale: 'zh',
  setLocale: () => undefined,
  t: (zh) => zh,
})

export function L10nProvider({ children }: { children: ReactNode }): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(() => activeLocale)
  // 挂到 <html> 上：CSS 按 `html[data-locale='en']` 切字体栈；`lang` 供系统级排版（断行/连字）
  useEffect(() => {
    activeLocale = locale
    document.documentElement.dataset.locale = locale
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])
  const setLocale = useCallback((next: Locale) => {
    activeLocale = next
    saveLocale(next)
    setLocaleState(next)
  }, [])
  const t = useCallback(
    (zh: string, params?: Record<string, string | number>) => {
      const text = locale === 'zh' ? zh : (EN[zh] ?? zh)
      return interpolate(text, params)
    },
    [locale],
  )
  const api = useMemo<L10nApi>(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useL10n(): L10nApi {
  return useContext(Ctx)
}
