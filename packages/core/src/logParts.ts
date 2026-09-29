/**
 * **甲案配套：多段文案的段链拼装**（2026-09-20 起）。
 *
 * core 只产出「文案 id + 参数」，而不少日志是**由若干可选句子拼起来的**（例：停炉标题 + 所得明细 +
 * 核心归还 + 退料说明）。这里把这堆段收成一条日志：
 * - 第 1 段由调用方传给 `addLog` 的 `textId`；`segs[0]` 即第 2 段（挂 `p1Id`），依此类推；
 * - 段**自带中文小词**（「额外掉落：」「无人机 … 架」）时用 `subs` 拆成更细的段：
 *   `p{n}` → 子段 `p{n}p{k}` → 再深一层 `p{n}p{k}p{j}`…
 *   与渲染层 `apps/desktop/src/renderer/src/i18n/locale.tsx` 的 `composeParts` 段内命名空间**逐层对齐**。
 *
 * 两条硬规矩（实证得来）：
 * ① **段不能空**：空段（`text === ''`）会被整段丢掉，后面挂着的段链也跟着断 ⇒ 某段可能没有时，
 *    要么让上一段留 `{pN}` 槽、要么为空态另立一个基础模板；段文本本身也必须非空（中文原串按段文本拼）；
 * ② 段内参数键必须是 `p<段号>p<序号>` 形态（段号含 `p` 时不能写成 `p11`），否则渲染层取不到。
 */

/**
 * 一条甲案日志的**一个段**：`id` + 段内参数；`subs` 是段里还嵌着的更细段（递归）。
 *
 * 🔴 **已知缺口（2026-09-29 · 船长报障「{p1} 读不到参数」· 未修完）**：
 * 参数**自己那一层**还能再挂模板（「清单值 → `.044`（`{p1}{p2}`）→ 清单本体」这种三层结构），
 * 渲染层要按 `p{n}p{k}p{j}` 取内层值。`walk` 现在只按**平铺位次**写 `p{n}p{k}`，
 * 三层那一路因此取不到值、原样漏 `{p1}`（实测「精炼所得：{p1}」）。
 *
 * **修法（下一批）**：把参数位写成**有序三段式**
 * `{ p<k>…值, p<k>…内部值, p<k>Id…那层模板 }`（插入序即层级序），`walk` 据此同时写
 * `p{n}p{k}` 与 `p{n}p{k}p{j}`；渲染层的内层插值（已就位）即可逐层取到。
 * 现由 `tests/industry.test.ts` 把这条缺口**钉成显式断言**（修完改成 `not.toMatch`）。
 */
export type LogSeg = {
  text: string
  id?: string
  params?: Record<string, string | number>
  subs?: LogSeg[]
}

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
 * **`composeLog` 的产物 → `addLog` 的参数**（**2026-09-29 加**）。
 *
 * 为什么要这一层收口：段链键 `parts`（字符串数组）**不在 `LogParams` 的值域里**
 * （见 `state.LogParams` 头注：并进去会砸 11 处读取点）⇒ 按该头注的指示"**需要它时在写入点收口**"，
 * 全仓**只有本函数**做这一次断言；各调用点写 `...logParamsOf(composed)` 即可，不必各自转一次类型。
 */
export function logParamsOf(composed: { textParams: Record<string, string | number>; parts: string[] }): Record<string, string | number> {
  return { ...composed.textParams, ...(composed.parts.length > 0 ? { parts: composed.parts } : {}) } as Record<
    string,
    string | number
  >
}
