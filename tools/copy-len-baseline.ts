/**
 * **说明文案基线生成器**（船长 2026-09-17 立的文案规则配套）：
 *
 * 规则 = 说明文案 **≤30 字**（只数汉字/字母/数字，标点不计）＋ **不写原因解释**；
 * 存量（491+ 条里的超线部分）**先只列清单、不阻断** ⇒ 超线且**文本一字未动**的老条目靠
 * `tools/copy-len-baseline.json` 宽限；**新增的或已改动的**超线条目**立即报红**（见
 * `tools/content-check.ts` 的「说明文案长度契约」）。
 *
 * **用法**：`npx tsx tools/copy-len-baseline.ts`（改写批次推进后重跑，基线随之收缩；
 * 存量全部改完 ⇒ 本文件与基线 JSON 一并删除，护栏转为全量强制）。
 */
import { writeFileSync } from 'node:fs'
import { buildSimContext } from '@whale/data'
import { COPY_LEN_MAX, copyEntriesOf, copyLen } from './copy-len'

const ctx = buildSimContext()
const rows = copyEntriesOf(ctx).map((r) => ({ ...r, len: copyLen(r.text) }))
const kinds = [...new Set(rows.map((r) => r.label))]
console.log(`=== 说明文案长度（口径：汉字/字母/数字各 1 字，标点不计；上限 ${COPY_LEN_MAX}）===`)
for (const k of kinds) {
  const a = rows.filter((r) => r.label === k)
  const over = a.filter((r) => r.len > COPY_LEN_MAX)
  const sorted = a.map((r) => r.len).sort((x, y) => x - y)
  console.log(
    `${k}：n=${a.length} 中位=${sorted[Math.floor(sorted.length / 2)]} 最长=${sorted[sorted.length - 1]} 超线=${over.length}`,
  )
}
const over = rows.filter((r) => r.len > COPY_LEN_MAX)
console.log(`合计：n=${rows.length} 超线=${over.length}`)
const longest = [...over].sort((a, b) => b.len - a.len).slice(0, 5)
console.log('最长的 5 条：' + longest.map((r) => `${r.id}(${r.len})`).join(' · '))

const baseline = {
  _doc: '说明文案长度基线（船长 2026-09-17 文案规则配套）：仅登记"规则生效时已超线且尚未改写"的存量。护栏 = tools/content-check.ts「说明文案长度契约」——基线内且文本一字未动 ⇒ 只列清单；新写/改动过的超线文案 ⇒ 报红。存量改写完成、本文件删除后，护栏转为全量强制。',
  _rule: `说明文案 ≤${COPY_LEN_MAX} 字（只数汉字/字母/数字，标点不计）· 不写原因解释（尤其括号里）`,
  _generatedBy: 'tools/copy-len-baseline.ts',
  entries: Object.fromEntries([...over].sort((a, b) => a.key.localeCompare(b.key)).map((r) => [r.key, r.text])),
}
writeFileSync('tools/copy-len-baseline.json', JSON.stringify(baseline, null, 2) + '\n', 'utf8')
console.log(`已写 tools/copy-len-baseline.json：${Object.keys(baseline.entries).length} 条宽限`)
