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

/**
 * **列表分隔符的词条 id**（zh `、` / en `, `）—— `composeParts` 拼列表槽时按当前语言取它。
 *
 * ⚠ 与 core `logParts.ts` 的 `LIST_SEP_ID` **同一个值**（渲染层刻意**不 import core**：
 * `locale.tsx` 是全渲染层最先加载的模块之一，拉整个 core 包进来不划算）。改这个 id 时两处一起改；
 * `tools/l10n-render-probe.ts` 会核对它在中英两列各是什么（防"改名后静默回落成 id 字面量"）。
 */
const LIST_SEP_ID = 'core.state.043'

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

/**
 * **按当前语言给一组「双语名对」挑一列**（2026-09-24 加）——用于**敌方挂载件名**这类
 * "文案在 core 目录里、语言在渲染层"的值（见 `core/foeMounts.ts` 的 `namePairs`）：
 * 中/英各一列，`isEn()` ⇒ 取英文那列。
 *
 * 两处输入都在**同一份快照**里（`BattleState.foeMounts` / `BattleReportRecord.foeMounts`
 * ＋ 同序的 `foeMountNamePairs`）⇒ 切换语言时这两处显示跟着变，**引擎一个字都不用改**。
 * `pairs` 缺省（老档在途战斗 / 没走双语覆盖的路径）⇒ 回退 `names`（中文名数组，与改动前逐字一致）。
 */
export function mountNamesTextOf(
  names: readonly string[] | undefined,
  pairs: ReadonlyArray<readonly [string, string]> | undefined,
): string[] {
  if (!names || names.length === 0) return []
  if (!pairs || pairs.length === 0) return [...names]
  const en = isEn()
  return names.map((n, i) => (en ? (pairs[i]?.[1] ?? n) : (pairs[i]?.[0] ?? n)))
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
  /**
   * ⚠ **只有顶层槽译文（`p{n}Id`）才在这里"两步渲染"**（**2026-09-29 修**）。
   *
   * 更深的 `p{n}p{k}Id`（参数值自己那层的译文）此前也被一并提升成 `p{n}p{k}`
   * ⇒ 顶层凭空多出一个键 `p3p1`，它会**盖掉** `composeParts` 里段模板算好的 `out['p3']`
   * （后写入者胜），于是段内容被"标签模板"顶替、槽位原样漏出（实测「精炼所得：{p1}」）。
   * 那类译文由 `composeParts` 的段内步骤处理（它认得自己的内层参数），这里不碰。
   */
  for (const [k, v] of Object.entries(params)) {
    if (!/^p\d+Id$/.test(k)) continue
    const base = k.slice(0, -2)
    const rendered = paramText(v)
    if (rendered !== '') out[base] = rendered
  }
  return out
}

/**
 * **一条 core 日志的文案字段**（`text` + 可选 `textId` / `textParams`）。
 *
 * ⚠ 值域比 core 的 `LogParams` **多一项 `readonly string[]`**：那是**段链 `parts`**
 * （本渲染层认的约定键，见 `composeParts`）。core 侧刻意不把它并进 `LogParams`
 * （并了会把全部读取点拖成联合类型），所以两边类型不同名也不同宽，**别互相照抄**。
 */
export interface LogEntryText {
  text: string
  textId?: string
  /** ⚠ 值域比 core 的 `LogParams` 宽：段链 `parts`（字符串数组）＋ **列表槽**（`p{n}List` / `p{n}ItemParams`） */
  textParams?: Readonly<
    Record<string, string | number | readonly string[] | ReadonlyArray<Readonly<Record<string, string | number>>>>
  >
}

/**
 * **多段文案收口（甲案配套 · 2026-09-20）**：把"由若干独立句子拼起来的一句日志"整体渲染。
 *
 * 约定（core 侧同款写法）：首段的 id 照常在 `textId`；后续段按顺序用 `p{n}Id` 绑定
 * （`p1Id` = 第 2 段、`p2Id` = 第 3 段 ……），其余参数按段内占位符命名。
 * 一次把"id 参数也要再翻"的链走到底 ⇒ **拼出来的每一段都是当前语言**，不会再出现半中半英。
 */
function composeParts(
  entry: LogEntryText,
  text: (id: string, params?: Record<string, string | number>) => string,
): string {
  if (entry.textId === undefined) return entry.text
  /**
   * 收窄成"字符串/数值"的工作副本：`parts`（数组）在下面单独取，**不进插值表**。
   * 这一步也是上面 `LogEntryText` 值域写全的原因——收窄只在这一个地方发生。
   */
  const all: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(entry.textParams ?? {})) {
    if (typeof v === 'string' || typeof v === 'number') all[k] = v
  }
  /**
   * **列表槽**（**2026-10-02 加 · 船长「按你建议来修」**）—— core 侧的契约见 `core/logParts.ts`
   * 的 `logParamsOf` 头注：
   * - `p{n}List` ＝ 逐项值（数组）· `p{n}ItemId` ＝ 逐项模板（可选）· `p{n}ItemParams` ＝ 逐项参数（可选）；
   * - **分隔符按当前语言取**（`LIST_SEP_ID`：zh `、` / en `, `）⇒ core 不再把中文顿号焊进参数值，
   *   英文界面里的名单/明细不再是「A、B」。
   * - 逐项模板的 `{p1}` 缺省 = 该项的值；`{p2}`… 由该项的 `ItemParams[i]` 供（索引对齐）。
   *
   * ⚠ 数组值不会进 `all`（上面只收字符串/数值）⇒ 这里读**原始入参** `entry.textParams`。
   */
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
        return interpolate(tpl[activeLocale], inner)
      })
      .join(textOf(LIST_SEP_ID, activeLocale))
  }
  /**
   * **参数命名空间（两套，前缀分流 · 2026-09-29 定）**：
   * - `paramsFor(0)` ＝ **基础模板**那份：顶层 `p{k}` ＋ **槽译文**（`p{n}Id` ⇒ 把 `{pN}` 换成该句）；
   * - `paramsFor(i≥1)` ＝ **第 i+1 段**那份：core 侧段链用**专属键空间** `seg{n}…`
   *   （`parts[0]` = 第 2 段 ⇒ 前缀 `seg{i+1}`）。
   *
   * 为什么必须分家（船长 2026-09-29 报障「各种事件里的参数都有问题」的根因）：
   * 段链原先借用 `p{n}Id`/`p{n}p{k}`，于是 `p2Id` **二义**（槽译文 还是 段 id？）——
   * 渲染层只能猜，猜哪头都错：当成槽译文 ⇒ 段的 `{p1}` 漏出；当成段 id ⇒ 基础槽被段内容顶掉。
   * 现在两边前缀不同（`p…` / `seg…`），**不需要猜**。
   */
  const paramsFor = (i: number): Record<string, string | number> => {
    if (i === 0) {
      const out: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(all)) {
        if (k.startsWith('seg')) continue // 段链专属键空间（不属基础模板）
        if (/^p\d+p\d+$/.test(k) || /^p\d+Id$/.test(k)) continue // 槽内参数 / 槽译文（下一轮处理）
        out[k] = v
      }
      /**
       * **槽位 id 代回（2026-09-20 实障修正）**：`p{n}Id` ＝ 首段 `{pN}` 这一槽那句话的 id。
       *
       * 此前它被当成"**整条链的第 n+1 段**"（链指针），于是船长报的实障出现：正文被换成槽译文、
       * 又被当链段渲一遍（重复），且第 n 段的段内命名空间是 `p{n}*` ⇒ 它自己的 `{p1}` 无人供给、
       * 原样漏出（`+{p1}`）。**链段现在由 core 用 `parts` 显式声明**，`p{n}Id` 只表示槽译文。
       *
       * 取参：该模板的占位符按"**槽号 + 占位符名**"（`p{n}p{k}`）取；取不全就保持原槽值
       * （宁可少译，不许改中文——中文侧恒等于 core 记录的中文原串）。
       */
      for (const [k, v] of Object.entries(all)) {
        if (!/^p\d+Id$/.test(k)) continue
        const tpl = typeof v === 'string' ? L10N[v] : undefined
        if (tpl === undefined) continue
        const slot = k.slice(0, -2)
        const deep: Record<string, string | number> = {}
        for (const p of tpl.zh.matchAll(/\{(\w+)\}/g)) {
          const name = p[1]!
          /**
           * 先取"槽号 + 占位符名"（`p{n}p{k}`）；没有再回落顶层同名（`{p1}` 这类与槽同名的写法）。
           *
           * ⚠ **回落要看"顶层那名是不是本槽的"**（2026-09-27 实障修正）：顶层同名的
           * `p1` 只有在该值确实是本槽预留的（配了 `p1Id` 槽译文）时才许回落 ——
           * 否则会把**与本槽同号的顶层参数**（例：统一日志的 `{p1}` ＝ 活动名）填进本槽的
           * `{p1}` 占位符里（张冠李戴）。既有写法 `p1` + `p1Id` 因此照旧工作，
           * 而"只给了顶层参数、没给槽译文"的新写法会老实留空，由体检用例点名。
           */
          const scoped = all[`${slot}${name}`]
          if (scoped !== undefined) deep[name] = scoped
          else if (/^p\d+$/.test(slot) && Object.prototype.hasOwnProperty.call(all, `${name}Id`)) deep[name] = all[name]!
        }
        /**
         * **段内参数位自己也能配 id**（2026-09-27 补）：段里的一句读数可能**整段都是参数**
         * （例：进洞停机读数的「开采」档——矿带名与矿石名都在参数位上，而参数不会被翻译）。
         * 约定与顶层同款：`p{n}p{k}Id` ⇒ 该槽第一步先换成它的当前语言译文。
         * 用**声明过的占位符名**去查（`{p1}` → `p4p1Id`），不让槽内键串味。
         *
         * ⚠ **段链的同类键在 `seg{n}p{k}Id` 上**（**2026-09-29 定** · 段链专属键空间，见 `paramsFor` 头注）：
         * 这一轮也要认它，否则段模板的 `{p1}`（那一槽挂了清单层模板）会整套漏出
         * （实测「精炼所得：{p1}」）。取参顺序：段内层 `seg{n}p{k}p{j}` → 段槽值 `seg{n}p{k}`。
         */
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
        /**
         * 该槽**有槽译文** ⇒ 从首段参数里移出：译文已含必要的值，若还留着原始值，
         * 它会覆盖掉刚算好的译文（后写入者胜）。取不全时也移出——宁可漏 `{pN}`
         * （体检用例会点名），也不许悄悄改掉中文。
         */
        delete out[slot]
        out[slot] = interpolate(tpl[activeLocale], deep)
      }
      /** **列表槽**（`p{n}List` ⇒ 按语言分隔符拼接；见上面 `listTextOf` 头注）—— 放在槽译文之后，后写者胜 */
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
    /**
     * **链段那份**：读**专属键空间** `seg{n}…`（`n` = 段号，`parts[0]` = 第 2 段）。
     * 产出给段模板用的命名空间：`p{k}`（段内参数）、`p{k}p{j}`（参数那层的内部值）。
     * ⚠ 与基础模板**不同前缀** ⇒ 不可能互相覆盖（这正是这一版的核心）。
     */
    const prefix = `seg${i + 1}`
    const out: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(prefix) || k.length <= prefix.length) continue
      if (k.endsWith('Id')) continue
      out[k.slice(prefix.length)] = v
    }
    /** **段内也能挂列表槽**（`seg{n}p{k}List` ＋ `…ItemId` / `…ItemParams`）——同一套规则，键面多一层段前缀 */
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
  /**
   * 段链：core 用 `parts` **显式声明**第 2 段起的 id（缺席即单段）。
   * 单段外壳（`✦ {p1}{p2}` 那类"正文 + 可选附注"）**不走段链**——附注是外壳的第二个槽。
   *
   * ⚠ 取的是**原始入参**（不是上面收窄过的 `all`）：`parts` 是数组，收窄时已被滤掉。
   */
  const rawParts = entry.textParams?.parts
  const parts = Array.isArray(rawParts) ? rawParts.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, 7) : []
  let out = ''
  if (parts.length === 0) return text(entry.textId, paramsFor(0))
  out += text(entry.textId, paramsFor(0))
  for (let i = 0; i < parts.length; i++) out += text(parts[i]!, paramsFor(i + 1))
  return out
}

/** 渲染一条 core 日志：有 `textId` ⇒ 按当前语言渲染；否则回退中文正文 */
export function logText(entry: LogEntryText): string {
  return composeParts(entry, (id, params) => tr(id, params))
}

/**
 * 渲染一条 core 指令错误：**有 `errorId` ⇒ 按当前语言**；否则回退 `error`（中文原串）。
 *
 * 入参就是 `CommandResult` 本身（结构型：只要求这三个字段，无需运行时依赖 core）。
 * **全渲染层 105 处 toast 已于 2026-09-20 统一改成 `cmdText(r) || '…'`**：
 * 有 id 的按语言取，没 id 的回退中文原串（与改前的 `r.error ?? '…'` 等价，零风险）。
 * 新增调用点**一律写 `cmdText(r) || tr('ui.…')`**，不要再直接读 `r.error`——
 * 那样会绕过 id，把 core 侧的甲案成果白扔。
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
    /**
     * **把语言推给主进程**（2026-09-20）：窗口标题与"导入/导出"系统对话框在主进程生成，
     * 而语言偏好存在渲染进程的 `localStorage` ⇒ 主进程读不到，只能由这里推。
     * 在主进程 API 缺失时（浏览器里跑 / 单测）静默忽略。
     */
    try {
      const w = window as unknown as { whale?: { setLocale?: (l: string) => void } }
      w.whale?.setLocale?.(locale)
    } catch {
      /* 非桌面环境：忽略 */
    }
  }, [locale])
  const setLocale = useCallback((next: Locale) => {
    activeLocale = next
    saveLocale(next)
    setLocaleState(next)
  }, [])
  /**
   * **开发/探针钩子**：把语言切换暴露到 `window.__setLocale`（2026-09-20）。
   *
   * 为什么需要：桌面端切语言由设置面板调用；而**无头浏览器探针**（`tools/ui-overflow.ts` 之类）
   * 需要在"同一档存档、同一页面"上量 zh 与 en 两遍，没有面板可点 ⇒ 给一个显式入口。
   * 只在渲染进程内存里挂一个函数，不改任何玩家可见行为；不挂 `window.whale`（那是主进程桥）。
   */
  useEffect(() => {
    ;(window as unknown as { __setLocale?: (l: Locale) => void }).__setLocale = setLocale
  }, [setLocale])
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
