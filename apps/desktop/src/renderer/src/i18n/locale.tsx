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

/* ═══════════ core 侧文案（甲案 · 2026-09-20 船长定）═══════════
 * core 不碰语言：它只产出「文案 id + 参数」（`LogEntry.textId` / `CommandResult.error`）。
 * 渲染层用下面两个函数统一收口 ⇒ **切换语言时 core 文案跟着变**，而这层之外一个字都不用改。
 * 过渡期两者都认：没有 id 的（老档日志 / 尚未改造的调用点）**原样显示中文**，行为与改动前一致。 */

/**
 * **参数收口**：把 `<键>Id` 形态的参数先渲染成文本再喂给外层文案（甲案·两步渲染）。
 * 约定：`textParams` 里出现 `p6Id: 'core.…'` ⇒ 外层文案的 `{p6}` 用它的译文；
 * 原 `p6`（中文原串）作为兜底保留 ⇒ 未改造路径与老档行为不变。
 */
function resolveParamIds(
  params: Readonly<Record<string, string | number>> | undefined,
): Record<string, string | number> | undefined {
  if (params === undefined) return undefined
  const out: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(params)) {
    if (!k.endsWith('Id')) out[k] = v
  }
  for (const [k, v] of Object.entries(params)) {
    if (!k.endsWith('Id')) continue
    const base = k.slice(0, -2)
    const rendered = paramText(v)
    if (rendered !== '') out[base] = rendered
  }
  return out
}

/** 渲染一条 core 日志：有 `textId` ⇒ 按当前语言渲染；否则回退中文正文 */
export function logText(entry: {
  text: string
  textId?: string
  textParams?: Readonly<Record<string, string | number>>
}): string {
  if (entry.textId === undefined) return entry.text
  return tr(entry.textId, resolveParamIds(entry.textParams))
}

/**
 * 渲染一条 core 指令错误：**有 `errorId` ⇒ 按当前语言**；否则回退 `error`（中文原串）。
 *
 * 入参就是 `CommandResult` 本身（结构型：只要求这三个字段，无需运行时依赖 core）——
 * **core 目前仍只产出中文串**，所以渲染层那 ≈130 处 `onToast(r.error ?? '…')` 暂不改（等价、零风险）；
 * 等某文件改造成 id 后，那个文件的调用点换成 `cmdText(r) || '…'` 即可（逐个文件推进）。
 */
export function cmdText(r: CmdTextSource): string {
  if (r.errorId !== undefined) return tr(r.errorId, resolveParamIds(r.errorParams))
  return r.error ?? ''
}

/** `CommandResult` 里与文案相关的那三个字段（结构型，避免渲染层为类型反向依赖 core） */
export interface CmdTextSource {
  readonly error?: string
  readonly errorId?: string
  readonly errorParams?: Readonly<Record<string, string | number>>
}

/**
 * **两步渲染：取一个"自带 id 的派生串"，作为参数喂给外层文案。**
 *
 * 用法（core 侧同样两步）：
 * ```ts
 * // core
 * addLog(state, 'info', 中文整句, 'core.x.001', { p1: 派生中文, p1Id: 'core.x.002' })
 * // 渲染层
 * logText(entry)  // ⇒ tr('core.x.001', { …entry.textParams, p1: entry.textParams?.p1Id ? paramText(entry.textParams.p1Id) : entry.textParams?.p1 })
 * ```
 * 为什么需要它：`{p1}` 的内容本身也是一句要翻译的话（如「已勾选本次返航卸货后停止」），
 * 而参数值**不会再被翻译**——所以按约定给它配一个 `p1Id`，由这里先渲染好再喂进去。
 */
export function paramText(idOrRaw: string | number | undefined): string {
  if (idOrRaw === undefined) return ''
  if (typeof idOrRaw === 'number') return String(idOrRaw)
  return idOrRaw.startsWith('core.') ? tr(idOrRaw) : idOrRaw
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
