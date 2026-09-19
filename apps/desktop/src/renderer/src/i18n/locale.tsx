/**
 * 语言（本地化）骨架 · 2026-09-19 船长令「希望对游戏进行英语本地化处理」。
 *
 * 口径权威：`docs/glossary-en.md`（术语与专名）· 工程做法：`docs/design/l10n-en-20260919.md`。
 *
 * 三条纪律：
 * ① 文案一律**按 id 引用**（`t('ui.itemsPage.014')`），中文与英文都只写在**唯一表**
 *    `packages/data/src/l10n/table.ts`（id → `{ zh, en }`）里——换语言 = 换表，不在源码里翻文本；
 *    缺 id 时**显示 id 本身**（便于定位漏登记），未译清单由 `npm run l10n:check` 点名；
 * ② 语言存 `localStorage`（`whale-idle:locale`），**不进存档** ⇒ 存档保持语言中立；
 * ③ 默认**跟随系统**（`navigator.language`），设置面板里可随时覆盖。
 *
 * 为什么这样切（2026-09-19 船长定）：界面/内容文案共 ≈3,500 条，若用「中文源串当 key」的词典，
 * 中文原文一改 key 就死、还得靠源码里残留中文来定位；改成 id 后**源码零文本**、表是唯一真源
 * （批量接线与造 id 由 `tools/l10n-wrap.ts` 代劳，`npm run l10n:wrap`）。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { L10N } from '@whale/data'

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

/** 按 id 取文本：`locale === 'zh'` 取 `zh` 列，否则取 `en` 列；**缺 id ⇒ 返回 id 本身**（便于定位漏登记） */
export function textOf(id: string, locale: Locale): string {
  const entry = L10N[id]
  if (!entry) return id
  return locale === 'zh' ? entry.zh : entry.en
}

/** 组件外也能用的翻译（读模块级语言；组件内请用 `useL10n().t` 以获得重渲染） */
export function tr(id: string, params?: Record<string, string | number>): string {
  return interpolate(textOf(id, activeLocale), params)
}

export interface L10nApi {
  locale: Locale
  setLocale: (locale: Locale) => void
  /** 译一条界面文案（`id` = 唯一表里的键；参数 `{name}` 形式插值）；缺 id ⇒ 显示 id 本身 */
  t: (id: string, params?: Record<string, string | number>) => string
}

const Ctx = createContext<L10nApi>({
  locale: 'zh',
  setLocale: () => undefined,
  t: (id) => id,
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
    (id: string, params?: Record<string, string | number>) => interpolate(textOf(id, locale), params),
    [locale],
  )
  const api = useMemo<L10nApi>(() => ({ locale, setLocale, t }), [locale, setLocale, t])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export function useL10n(): L10nApi {
  return useContext(Ctx)
}
