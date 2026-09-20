/**
 * **日志结构体检（甲案 · 2026-09-20）**：把 core 产出的每条日志按渲染层的口径复算一遍。
 *
 * 为什么要有它（船长 2026-09-20 报障）：「随机事件的事件日志出现了重复文本，且数值显示为 `+{p1}`」。
 * 病根不在文案、也不在渲染层，而在 **core 侧挂参数的命名空间用错了**：
 * 外壳 `core.events.001` 原文是 `✦ {p1}`（第 2 槽的 `{p2}` 当时根本没写）、而 `core.events.002`
 * 是 `（+{p1} 信用点）`。`logEvent` 把附注挂成 `p2Id`（＝**段链的第 2 段**）而不是**段内子段**
 * （应为 `p2Id` + `p2p1`）⇒ 渲染层 `composeParts` 把附注顶进 `{p1}` 当正文（正文被吞），
 * 又当第 2 段渲一遍（**重复文本**），而第 2 段的段内命名空间是 `p2*` ⇒ 它自己的 `{p1}`
 * 无人供给、**原样漏出**。
 *
 * 本用例不去逐个点名模板，而是**遍历本次跑出来的所有日志**做结构复核——这类错配只有
 * "参数集 vs 模板占位符集"逐条对齐才查得出来，靠人眼审 3,000+ 条不现实：
 * ① `textId` / `p{n}Id` 形态合法，且 id 都真在唯一表里；
 * ② 每段的**占位符集合**必须被该段命名空间**完全覆盖**（缺一个 ⇒ 界面上漏 `{pN}`）；
 * ③ 按 `en` 列复算整句，不得残留 `{`，正文必须在、附注不许重复；
 * ④ 中文兜底串（`text`）与按 `zh` 列复算的结果一致。
 *
 * 渲染层真身是 `apps/desktop/src/renderer/src/i18n/locale.tsx` 的 `composeParts`，它的分段规则
 * 与本文件 `renderEn` 逐条对齐（段号 `p{n}`、段内参数 `p{n}p{k}`、链 `p{n}Id`）；`apps/desktop`
 * 没有测试框架，所以这条口径在 core 侧落地（先例：`industry.test.ts` 精炼炉用例）。
 */
import { describe, expect, it } from 'vitest'
import { L10N } from '@whale/data'
import { advanceGame } from '../src/engine'
import type { LogEntry } from '../src/state'
import { createInitialState } from '../src/state'
import { makeTestCtx } from './helpers'

/**
 * 模板插值（与渲染层 `locale.tsx` 的 `interpolate` 同口径：**键不存在时保留占位符**）。
 * 这条"保留"行为正是 `✦ {p1}` 会漏出 `{p1}` 的原因，测试里必须照抄，否则查不出漏参数。
 */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m))
}

/** 渲染层口径复算：按列取文本 + 段链拼接（不用空格连接——段自带标点） */
function render(entry: Pick<LogEntry, 'text' | 'textId' | 'textParams'>, locale: 'zh' | 'en'): string {
  if (entry.textId === undefined) return entry.text
  const all = { ...(entry.textParams ?? {}) }
  /**
   * 第 i 段（0 = 首段）的命名空间：首段用顶层键、`p{n}p{k}` 归下一层；第 n 段用 `p{n}*`。
   * 返回值附带"被槽译文代回覆盖的槽名"——**占位符覆盖判定**要用它（否则 `{p1}` 会被误报成缺参数）。
   */
  const paramsFor = (i: number): { ns: Record<string, string | number>; covered: Set<string> } => {
    const out: Record<string, string | number> = {}
    if (i === 0) {
      for (const [k, v] of Object.entries(all)) {
        if (/^p\d+p\d+$/.test(k) || /^p\d+Id$/.test(k)) continue
        out[k] = v
      }
      /** 槽译文代回（与 `locale.tsx` 同步）：`p{n}Id` ＝ 首段 `{pN}` 这一槽那句话的 id */
      const covered = new Set<string>()
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
          else if (Object.prototype.hasOwnProperty.call(all, name)) deep[name] = all[name]!
        }
        delete out[slot] // 有槽译文 ⇒ 首段不再持有原始值（否则会盖掉译文）
        out[slot] = interpolate(tpl[locale], deep)
        covered.add(slot)
      }
      return { ns: out, covered }
    }
    const prefix = `p${i}`
    const ns: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(all)) {
      if (k.startsWith(prefix) && k.length > prefix.length && !k.endsWith('Id')) ns[k.slice(prefix.length)] = v
    }
    return { ns, covered: new Set<string>() }
  }
  const rawParts = (all as { parts?: unknown }).parts
  const parts = Array.isArray(rawParts) ? rawParts.filter((x): x is string => typeof x === 'string' && x !== '').slice(0, 7) : []
  const segIds = [entry.textId, ...parts]
  let out = ''
  for (let i = 0; i < segIds.length; i++) {
    const { ns } = paramsFor(i)
    out += (L10N[segIds[i]!]?.[locale] ?? `「缺 ${segIds[i]!}」`).replace(/\{(\w+)\}/g, (m, k: string) =>
      Object.prototype.hasOwnProperty.call(ns, k) ? String(ns[k]) : m,
    )
  }
  return out
}

/** 体检一条日志：返回人话问题清单（空 = 通过） */
function checkEntry(l: LogEntry): string[] {
  const bad: string[] = []
  const tp = l.textParams ?? {}
  if (l.textId === undefined) return bad // 老档 / 未改造路径：按中文原串显示，甲案不管
  if (L10N[l.textId] === undefined) bad.push(`textId 不在唯一表：${l.textId}`)

  /** 段链：首段 = textId；其后每段由 core 显式声明的 `parts` 给出 */
  const rawParts = (tp as { parts?: unknown }).parts
  const parts = Array.isArray(rawParts) ? rawParts.filter((x): x is string => typeof x === 'string' && x !== '') : []
  const segIds = [l.textId, ...parts]
  for (let i = 0; i < segIds.length; i++) {
    const id = segIds[i]!
    const tpl = L10N[id]
    /** 该段的参数名集合（首段还要算上"被槽译文代回覆盖"的槽） */
    const ns = new Set<string>()
    if (i === 0) {
      for (const k of Object.keys(tp)) {
        if (/^p\d+p\d+$/.test(k) || /^p\d+Id$/.test(k)) continue
        ns.add(k)
      }
    } else {
      const prefix = `p${i}`
      for (const k of Object.keys(tp)) {
        if (k.startsWith(prefix) && k.length > prefix.length && !k.endsWith('Id')) ns.add(k.slice(prefix.length))
      }
    }
    if (tpl !== undefined) {
      const ph = new Set([...tpl.zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))
      /**
       * 槽译文代回会**提供**那些同名槽的占位符（如 `core.events.084` 的 `{p1}` ← `p1Id`）
       * ⇒ 这些槽算"已给参数"。
       */
      const coveredBySlotId = new Set(
        Object.keys(tp)
          .filter((k) => /^p\d+Id$/.test(k))
          .map((k) => k.slice(0, -2)),
      )
      const miss = [...ph].filter((p) => !ns.has(p) && !coveredBySlotId.has(p))
      if (miss.length > 0) bad.push(`${id} 的占位符没给参数：{${miss.join('} {')}}`)
      // zh / en 占位符集合必须一致（与 l10n:check 同口径，这里顺带钉住）
      const phEn = new Set([...tpl.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))
      if (ph.size !== phEn.size || [...ph].some((p) => !phEn.has(p))) bad.push(`${id} 的 zh/en 占位符不一致`)
    } else {
      bad.push(`段 ${i + 1} 的 id 不在唯一表：${id}`)
    }
  }
  const en = render(l, 'en')
  const zh = render(l, 'zh')
  if (en.includes('{') || zh.includes('{')) bad.push(`渲染后残留占位符：${en.slice(0, 80)}`)
  if (l.kind === 'event' && !en.startsWith('✦ ')) bad.push(`事件行丢了 ✦ 前缀：${en.slice(0, 40)}`)
  // 中文兜底串必须与按 zh 列复算的结果逐字一致（否则界面所见 ≠ core 记录）
  if (zh !== l.text) bad.push(`zh 复算与中文原串不一致：\n  原串 ${l.text}\n  复算 ${zh}`)
  return bad
}

/** 跑一段真实推进（覆盖面：事件 / 市场 / 精炼 / 训练 / 采集等） */
function smokeLogs(): LogEntry[] {
  const ctx = makeTestCtx()
  const state = createInitialState({ nowWallMs: 0, seed: 20_260_920 })
  advanceGame(state, 3 * 60 * 60_000, ctx) // 3 游戏小时：够出事件、市场窗、精炼批、训练完成
  return state.logs
}

describe('日志结构体检（甲案 · 2026-09-20 船长报障回归）', () => {
  it('全部已产日志：占位符必须全给、段 id 必须在表里、渲染后不得残留 {}', () => {
    const logs = smokeLogs()
    expect(logs.length, '推进 3 小时后至少应有日志').toBeGreaterThan(0)
    const withId = logs.filter((l) => l.textId !== undefined)
    expect(withId.length, '甲案改造后绝大多数日志应带 textId').toBeGreaterThan(0)
    const problems: string[] = []
    for (const l of withId) problems.push(...checkEntry(l).map((p) => `[${l.textId}] ${p}`))
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('**链段专项**：core 显式声明 `parts` ⇒ 按序拼接、各段用自己的命名空间', () => {
    /**
     * 合成一条"两段"日志（真实链段见 `industry.ts` 的 `composeLog`、`market.ts` 的 `p5Id`）：
     * 首段用顶层键、第 2 段用 `p1*` 命名空间 —— 两者**不许串味**。
     */
    const entry: LogEntry = {
      id: 1,
      kind: 'trade',
      atGameMs: 0,
      text: '市价售出 商品×2（税后入账 300 信用点，1 笔），贸易税 15 信用点。',
      textId: 'core.market.040', // 市价售出 {p1}×{p2}（税后入账 {p3} 信用点，{p4} 笔）{p5}。
      textParams: {
        p1: '商品',
        p2: '2',
        p3: '300',
        p4: '1',
        p5: '',
        p5Id: 'core.market.037', // ，贸易税 {p1} 信用点
        p5p1: '15',
      },
    }
    expect(checkEntry(entry)).toEqual([])
    const zh = render(entry, 'zh')
    expect(zh).toBe('市价售出 商品×2（税后入账 300 信用点，1 笔），贸易税 15 信用点。')
    const en = render(entry, 'en')
    expect(en).toBe('Sold 商品×2 at market (300 credits after tax, 1 fills), trading tax 15 credits.')
    expect(en).not.toContain('{')
  })

  it('**事件行专项**：正文与金额附注各出现一次（重复文本 / `+{p1}` 回归）', () => {
    const evs = smokeLogs().filter((l) => l.kind === 'event' && l.textId !== undefined)
    expect(evs.length, '这一段推进里应出过随机事件').toBeGreaterThan(0)
    for (const l of evs) {
      const en = render(l, 'en')
      const bodyId = String((l.textParams ?? {}).p1Id ?? '')
      // 正文模板可能自带槽（`core.events.084` 的 `{p1}` = 商品名）⇒ 先代入再比
      const deep: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(l.textParams ?? {})) {
        if (!k.startsWith('p1') || k === 'p1Id' || k === 'p1') continue
        deep[k.slice(2)] = v
      }
      if (Object.prototype.hasOwnProperty.call(l.textParams ?? {}, 'p1')) deep.p1 = (l.textParams as Record<string, string | number>).p1!
      const bodyEn = interpolate(L10N[bodyId]?.en ?? '', deep)
      if (bodyEn !== '') expect(en, `[${l.textId}] 正文必须真的在`).toContain(bodyEn)
      if (l.text.includes('（+')) {
        expect(en.split('credits').length - 1, `[${l.textId}] 金额附注只许出现一次`).toBe(1)
        expect(en, `[${l.textId}] 金额附注必须是子段 p2Id+p2p1`).toContain('credits')
      }
    }
  })
})
