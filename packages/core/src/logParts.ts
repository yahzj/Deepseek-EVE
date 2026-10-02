/**
 * **甲案配套：多段文案的段链拼装**（2026-09-20 起）。
 *
 * core 只产出「文案 id + 参数」，而不少日志是**由若干可选句子拼起来的**（例：停炉标题 + 所得明细 +
 * 核心归还 + 退料说明）。这里把这堆段收成一条日志：
 * - 第 1 段由调用方传给 `addLog` 的 `textId`；`segs[0]` 即第 2 段（挂 `seg2Id`），依此类推
 *   （**段链走专属键空间 `seg{n}…`**，与基础模板的 `p{n}…` 分家，见 `composeLog` 头注）；
 * - 段**自带中文小词**（「额外掉落：」「无人机 … 架」）时用 `subs` 拆成更细的段：
 *   `p{n}` → 子段 `p{n}p{k}` → 再深一层 `p{n}p{k}p{j}`…
 *   与渲染层 `apps/desktop/src/renderer/src/i18n/locale.tsx` 的 `composeParts` 段内命名空间**逐层对齐**。
 *
 * 两条硬规矩（实证得来）：
 * ① **段不能空**：空段（`text === ''`）会被整段丢掉，后面挂着的段链也跟着断 ⇒ 某段可能没有时，
 *    要么让上一段留 `{pN}` 槽、要么为空态另立一个基础模板；段文本本身也必须非空（中文原串按段文本拼）；
 * ② 段内参数键必须是 `p<段号>p<序号>` 形态（段号含 `p` 时不能写成 `p11`），否则渲染层取不到。
 */
import type { LogParams } from './state'

/**
 * `logParams` / `logParamsOf` 的**入参值域**（＝ `LogParams` 之外还要认的那几类：段链 `parts` 与**列表槽**）。
 * 单点断言（`as unknown as LogParams`）只在本文件发生 —— 依据见 `state.ts` 的 `LogParams` 头注。
 */
export type LogParamsExtra = Readonly<
  Record<string, string | number | readonly string[] | ReadonlyArray<Readonly<Record<string, string | number>>>>
>

/**
 * 一条甲案日志的**一个段**：`id` + 段内参数；`subs` 是段里还嵌着的更细段（递归）。
 *
 * ✅ **三层结构现状（2026-10-02 三号核对 · 订正头注）**：原先这里记着一条"参数自己那层再挂模板 ⇒
 * 取不到值、原样漏 `{p1}`"的缺口（2026-09-29 船长报障「`{p1}` 读不到参数」）。**该缺口已随
 * 2026-09-29 那版"段链专属键空间"修完**：`walk` 对 `p{n}p{k}` / `p{n}Id` 形态的键写
 * `seg{n}p{k}` / `seg{n}p{k}Id`，渲染层 `paramsFor(i≥1)` 用 `seg{n}p{k}p{j}` 逐层取。
 * 两条钉：`tools/l10n-render-probe.ts`（**渲染层真身**的"精炼停炉·段链三层"夹具，中英各一遍）
 * 与 `tests/industry.test.ts`（`not.toMatch(/\{p\d+\}/)`）。
 * ⚠ 头注此前说"现由 `tests/industry.test.ts` 把这条缺口钉成显式断言（修完改成 `not.toMatch`）"——
 * 该用例**早已改成 `not.toMatch`**，是头注没跟上（2026-10-02 订正）。
 */
export type LogSeg = {
  text: string
  id?: string
  params?: Record<string, string | number>
  subs?: LogSeg[]
}

/** `logParamsOf` 认的**列表槽**键（`p{n}List` / `p{n}ItemId` / `p{n}ItemParams`）——只作文档与工具识别用 */
export const LIST_SLOT_KEYS = ['List', 'ItemId', 'ItemParams'] as const

/** 列表分隔符的**词条 id**（zh `、` / en `, `）；渲染层按当前语言取它 */
export const LIST_SEP_ID = 'core.state.043'

/**
 * 把"若干可选段"拼成一条甲案日志：返回中文原串 + 段 id 链。
 * 中文原串 = `lead` + 各**非空**段文本顺次相接（与改造前逐字一致）。
 *
 * `firstSegNo`：**段号起点**。基础模板自己已占用 `p1…pN` 时，段链必须从 `N+1` 起排，
 * 否则段的 `p{n}Id` 会和外层同名参数抢同一个槽（外层 `p1` 是位次、段链 `p1` 是技能名 ⇒ 张冠李戴）。
 *
 * 🔴 **段链用专属键空间 `seg…`**（**2026-09-29 定** · 船长报障「各种事件里的参数都有问题」的最终修法）：
 *
 * 段链此前借用槽号 `p{n}Id` / `p{n}p{k}` 表达，于是**键面二义**：
 * `p2Id` 既可能是"基础模板 `{p2}` 那一槽的译文"、也可能是"第 2 段的 id"——
 * 渲染层只能猜，猜哪头都会错（猜成槽译文 ⇒ 段的 `{p1}` 漏出；猜成段 id ⇒ 基础槽被段内容顶掉）。
 *
 * ⇒ 现在**两套键各归各**：
 * - **基础模板**用 `p{n}` / `p{n}Id` / `p{n}p{k}`（槽值 · 槽译文 · 槽内参数；单段日志的老写法不变）；
 * - **段链**用 `seg{n}Id` / `seg{n}p{k}` / `seg{n}p{k}p{j}`（`n` 从 **2** 起，第 1 段就是基础模板本身）。
 *
 * 两边**不可能撞号** ⇒ 渲染层按前缀分流即可，不用再猜。段号从 2 起是硬约定（见 `walk`）。
 */
export function composeLog(
  lead: string,
  segs: Array<LogSeg | null | undefined>,
  firstSegNo = 2,
): { text: string; textParams: Record<string, string | number>; parts: string[] } {
  const start = Math.max(2, firstSegNo)
  const kept = segs.filter((s): s is LogSeg => !!s && s.text !== '')
  const textParams: Record<string, string | number> = {}
  const walk = (seg: LogSeg, prefix: string): void => {
    if (seg.id !== undefined) textParams[`seg${prefix}Id`] = seg.id
    let k = 0
    for (const [key, value] of Object.entries(seg.params ?? {})) {
      /**
       * - `${值键}p<数字>` ⇒ **该值那层模板的内部值**（如清单那层 `.044` 的 `{p1}`）；
       * - `${值键}Id` ⇒ **那层模板是谁**（渲染层认 `${段键}${值键}Id`）。
       * 两者都**不占本段的位次**（位次只由"值"决定，值写 `p<数字>` 形的键）。
       */
      if (/^p\d+p\d+$/.test(key) || /^(p\d+)Id$/.test(key)) {
        textParams[`seg${prefix}${key}`] = value
        continue
      }
      k += 1
      textParams[`seg${prefix}p${k}`] = value
    }
    for (const [j, sub] of (seg.subs ?? []).entries()) walk(sub, `${prefix}p${j + 1}`)
  }
  for (const [i, seg] of kept.entries()) walk(seg, String(start + i))
  const parts = kept.map((s) => s.id).filter((id): id is string => id !== undefined)
  return { text: lead + kept.map((s) => s.text).join(''), textParams, parts }
}

/**
 * **`composeLog` 的产物 → `addLog` 的参数**（**2026-09-29 加**；**2026-10-02 扩：列表槽**）。
 *
 * 为什么要这一层收口：段链键 `parts`（字符串数组）**不在 `LogParams` 的值域里**
 * （见 `state.LogParams` 头注：并进去会砸 11 处读取点）⇒ 按该头注的指示"**需要它时在写入点收口**"，
 * 全仓**只有本函数**做这一次断言；各调用点写 `...logParamsOf(composed)` 即可，不必各自转一次类型。
 *
 * ═══ 列表槽（**2026-10-02 · 船长「按你建议来修」**）═══
 *
 * **病根**：core 里到处是 `${names.join('、')}`（全仓 46 处）—— 中文顿号被**焊进参数值**，
 * 而参数值不会再被翻译 ⇒ **英文界面里列表用中文顿号连接**（`Ship A、Ship B`）。
 * 名字本身没问题（`ctx` 在渲染层已按语言覆盖），漏的是**分隔符**与**逐项模板**。
 *
 * **契约**（渲染层 `i18n/locale.tsx` 的 `composeParts` 实现，`tools/l10n-render-probe.ts` 是它的验收口）：
 * - `p{n}List`        ＝ 逐项**值**（`readonly string[]`；`{pN}` 那一槽按当前语言的分隔符拼起来）；
 * - `p{n}ItemId`      ＝ **可选**：逐项模板 id（给每一项套一句话；`{p1}` 缺省 = 该项的值）；
 * - `p{n}ItemParams`  ＝ **可选**：逐项参数（与 `List` **索引对齐**；填 `ItemId` 模板的 `{p2}`…）。
 *
 * 分隔符由渲染层按语言取（`core.state.043`：zh `、` / en `, `）⇒ **core 不再拼顿号**。
 * ⚠ 中英两侧的空格/标点差异（例：`A, B` 用半角逗号加空格）全在表里，core 一个字都不用知道。
 *
 * **推荐写法（键写字面量 ⇒ 静态体检 `l10n:params` 认得出）**：
 * ```ts
 * addLog(state, 'fleet', 中文原串, 'core.⟨域⟩.⟨号⟩', logParamsOf(composed, {
 *   p1List: gains.map((g) => itemNameOf(ctx, g.itemId)),      // 逐项值
 *   p1ItemId: 'core.⟨域⟩.⟨逐项模板号⟩',                        // 逐项模板（可选）
 *   p1ItemParams: gains.map((g) => ({ p2: g.units })),        // 逐项参数（可选，索引对齐）
 * }))
 * ```
 * （示例里的 id 写成 `⟨域⟩`/`⟨号⟩` 占位：`l10n:check` 会扫源码里的 `core.*` 字面量，
 *  写成假 id 会让它报"表里没有"——本文件里不放假 id。）
 * ⚠ **空列表别传 `List`**：传空数组会把该槽渲成空串（顶掉中文兜底）；"空态另有说法"时
 * 用槽译文 `p{n}Id`（例：战利品为空 ⇒ `p1Id` 指向「空手而归」那条）。
 */
export function logParamsOf(
  composed: { textParams: Record<string, string | number>; parts: string[] },
  extra?: LogParamsExtra,
): LogParams {
  return {
    ...composed.textParams,
    ...(composed.parts.length > 0 ? { parts: composed.parts } : {}),
    ...(extra ?? {}),
  } as unknown as LogParams
}

/**
 * **不走段链的单段日志**要挂列表槽时用它（`logParamsOf` 的"没有 composed"版）：
 * ```ts
 * addLog(state, 'fleet', 中文原串, 'core.⟨域⟩.⟨号⟩', logParams({ p3List: names, p1Id: 'core.⟨域⟩.⟨空态号⟩' }))
 * ```
 * 单段日志的槽位就是顶层 `p{n}` ⇒ 直接写键即可；与 `logParamsOf` 同一条"写入点收口"纪律。
 */
export function logParams(extra?: LogParamsExtra): LogParams {
  return { ...(extra ?? {}) } as unknown as LogParams
}
