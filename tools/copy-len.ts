/**
 * **说明文案口径单点**（船长 2026-09-17 立）——给 `content:check` 的「说明文案长度契约」与
 * 基线生成器 `tools/copy-len-baseline.ts` 共用，**不许各写一份**。
 *
 * 船长原话：「**新增文案相关规则，不要在任何说明文案内写入原因解释（特别是使用括号进行解释的这种）。
 * 文案要保证在30个字以内。**」；三问三答裁定：**存量一起改** · **计数 = 汉字/字母/数字各 1 字、标点不计** ·
 * **括号只许放规格**。
 *
 * 口径细节：
 * - `copyLen()` **只数汉字、拉丁字母、数字**；标点、空格、数学符号（`+ - × ÷ % / ~ = ·`）、
 *   破折号/省略号与成对括号**一律不计**（船长裁定"标点不计"）。
 * - `REASON_HINTS` 是「**括号里的原因解释**」这一支的**机械可查判据**（因果/目的连词）——
 *   "不写原因解释"整条无法机械化，其余靠人工审查（口径见约定 §十三）。
 */
export const COPY_LEN_MAX = 30

/** 计数：汉字 / 拉丁字母 / 数字各算 1 字，其余（标点、空格、符号）不计 */
export function copyLen(text: string): number {
  return (text.match(/[\p{Script=Han}A-Za-z0-9]/gu) ?? []).length
}

/** 括号内的因果 / 目的连词（命中即视为"用括号写原因解释"，报红） */
export const REASON_HINTS: readonly string[] = [
  '否则',
  '因为',
  '以免',
  '避免',
  '防止',
  '免得',
  '所以',
  '从而',
  '才不',
  '才能',
  '就会',
  '就藏不住',
  '暴露',
  '为了',
]

/** 取出说明里所有括号内容（中英文括号都算）——供原因解释判据扫 */
export function parenSpans(text: string): string[] {
  return [...text.matchAll(/[（(]([^）)]*)[）)]/g)].map((m) => m[1] ?? '')
}

/** 说明文案的五类来源（**单一枚举点**：基线生成器与 `content:check` 都走它，键 = `<key>:<id>` 两边一致） */
export const COPY_KINDS = [
  { key: 'module', label: '装备' },
  { key: 'item', label: '物品' },
  { key: 'ship', label: '舰船' },
  { key: 'blueprint', label: '蓝图' },
  { key: 'anomaly', label: '敌卡' },
] as const

/** 说明文案条目（`key` 供基线比对、`label` 供打印） */
export interface CopyEntry {
  key: string
  label: string
  id: string
  text: string
}

/** 从 sim 上下文枚举全部说明文案——**唯一入口**（改口径只改这里；两边各写一份必然漂移，实测踩过） */
export function copyEntriesOf(ctx: {
  modules: ReadonlyMap<string, { id: string; description?: string }>
  items: ReadonlyMap<string, { id: string; description?: string }>
  ships: ReadonlyMap<string, { id: string; description?: string }>
  blueprints: ReadonlyMap<string, unknown>
  anomalies: ReadonlyMap<string, { id: string; description?: string }>
}): CopyEntry[] {
  const out: CopyEntry[] = []
  const push = (key: string, label: string, id: string, text: string | undefined): void => {
    if (text) out.push({ key: `${key}:${id}`, label, id, text })
  }
  for (const m of ctx.modules.values()) push('module', '装备', m.id, m.description)
  for (const i of ctx.items.values()) push('item', '物品', i.id, i.description)
  for (const s of ctx.ships.values()) push('ship', '舰船', s.id, s.description)
  for (const b of ctx.blueprints.values()) {
    const bp = b as { id?: string; description?: string }
    if (bp.id) push('blueprint', '蓝图', bp.id, bp.description)
  }
  for (const a of ctx.anomalies.values()) push('anomaly', '敌卡', a.id, a.description)
  return out
}
