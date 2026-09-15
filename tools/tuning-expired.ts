/**
 * **限时规则过期检查**（正式工具 · `npm run tuning:expired`）。
 *
 * 用途（船长 2026-09-16：「到20号之后**提醒我清理这个过期的赠送**」）：把 `TUNING_RULES`
 * （限时倍率）与 `PROMOS`（限时促销）两张表里**生效期已过**的条目列出来，明确"哪些行可以删"。
 *
 * 口径：
 * - **纯只读**：不写任何文件、不改任何状态；只读 `packages/core/src/tuning.ts` 的两张表 + 本机墙钟；
 * - **按本机本地时区**判过期（与引擎判定同源：`dayWindowEndMs`，截止日**整天有效**、次日 00:00 失效）；
 * - **不进 `content:check`**：体检与标定读数**不吃日历**（`content:check` 必须恒定），
 *   所以"过期"这件事只在需要收口时手动跑本工具；
 * - 一条都没过期 ⇒ 打印 ✅ 后正常退出（退出码 0）。
 *
 * 用法：`npm run tuning:expired`（想看明细就照常跑；待清理条目为 0 时无输出负担）
 *
 * ⚠ **版本自检**（口径同「旧读数不可靠」）：
 *   - 游戏版本 **v0.1.0**（`package.json`）· 存档结构 **v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-16**（当日读数：`TUNING_RULES` 空表 · `PROMOS` 一条
 *     `wh-bloom-20260916`（9/16~9/20）⇒ 9/21 之后本工具会把它列为待清理）
 *   - 本工具最后跑过：**2026-09-16**
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ 必须重跑核对（本工具只读两张表，表结构变更要跟着改）。
 */
import { PROMOS, TUNING_RULES, dayWindowEndMs, localDayStartMs } from '../packages/core/src/tuning'

const now = Date.now()
const nowText = new Date(now).toLocaleString('zh-CN', { hour12: false })

interface Row {
  table: string
  id: string
  window: string
  state: '已过期' | '未开始'
  untilText: string
}

const rows: Row[] = []
const fmtDay = (ms: number): string => new Date(ms).toLocaleDateString('zh-CN')

for (const r of TUNING_RULES) {
  const end = dayWindowEndMs(r.until)
  if (end === null) {
    rows.push({ table: 'TUNING_RULES', id: r.key, window: `${r.from ?? '(立即)'}~${r.until}`, state: '已过期', untilText: '日期非法' })
    continue
  }
  const from = r.from !== undefined ? localDayStartMs(r.from) : null
  if (end <= now) {
    rows.push({ table: 'TUNING_RULES', id: r.key, window: `${r.from ?? '(立即)'}~${r.until}`, state: '已过期', untilText: fmtDay(end) })
  } else if (from !== null && from > now) {
    rows.push({ table: 'TUNING_RULES', id: r.key, window: `${r.from ?? '(立即)'}~${r.until}`, state: '未开始', untilText: fmtDay(from) })
  }
}

for (const p of PROMOS) {
  const end = dayWindowEndMs(p.until)
  if (end === null) {
    rows.push({ table: 'PROMOS', id: p.id, window: `${p.from ?? '(立即)'}~${p.until}`, state: '已过期', untilText: '日期非法' })
    continue
  }
  const from = p.from !== undefined ? localDayStartMs(p.from) : null
  if (end <= now) {
    rows.push({ table: 'PROMOS', id: p.id, window: `${p.from ?? '(立即)'}~${p.until}`, state: '已过期', untilText: fmtDay(end) })
  } else if (from !== null && from > now) {
    rows.push({ table: 'PROMOS', id: p.id, window: `${p.from ?? '(立即)'}~${p.until}`, state: '未开始', untilText: fmtDay(from) })
  }
}

console.log(`限时规则过期检查 · 现在 ${nowText}（本地时区）`)
console.log(`表体量：TUNING_RULES ${TUNING_RULES.length} 条 · PROMOS ${PROMOS.length} 条`)

const expired = rows.filter((r) => r.state === '已过期')
const future = rows.filter((r) => r.state === '未开始')

if (expired.length === 0 && future.length === 0) {
  console.log('✅ 两张表都没有"已过期"或"未开始"的条目：无需清理。')
} else {
  if (expired.length > 0) {
    console.log(`\n⚠ **待清理 ${expired.length} 条（生效期已过，仍留在表里 ⇒ 可直接删行）**：`)
    for (const r of expired) {
      console.log(`  · ${r.table} · ${r.id}  （生效 ${r.window} · 已于 ${r.untilText} 00:00 失效）`)
    }
    console.log(
      '\n清理口径：从 `packages/core/src/tuning.ts` 删掉对应行即可 —— 到期后**不回收**已发出的产出/赠送，' +
        '删除只影响"以后还发不发"，不动任何已存状态（零迁移）。',
    )
  }
  if (future.length > 0) {
    console.log(`\nℹ 另有 ${future.length} 条**尚未开始**（留着即可，到点自动生效）：`)
    for (const r of future) console.log(`  · ${r.table} · ${r.id}  （${r.window} · ${r.untilText} 起生效）`)
  }
}
