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

/** 一条甲案日志的**一个段**：`id` + 段内参数；`subs` 是段里还嵌着的更细段（递归） */
export interface LogSeg {
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
 */
export function composeLog(
  lead: string,
  segs: Array<LogSeg | null | undefined>,
  firstSegNo = 1,
): { text: string; textParams: Record<string, string | number> } {
  const kept = segs.filter((s): s is LogSeg => !!s && s.text !== '')
  const textParams: Record<string, string | number> = {}
  const walk = (seg: LogSeg, prefix: string): void => {
    if (seg.id !== undefined) textParams[`p${prefix}Id`] = seg.id
    let k = 0
    for (const v of Object.values(seg.params ?? {})) textParams[`p${prefix}p${++k}`] = v
    for (const [j, sub] of (seg.subs ?? []).entries()) walk(sub, `${prefix}p${j + 1}`)
  }
  for (const [i, seg] of kept.entries()) walk(seg, String(firstSegNo + i))
  return { text: lead + kept.map((s) => s.text).join(''), textParams }
}
