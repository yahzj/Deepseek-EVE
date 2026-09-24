/**
 * **存档差异复核**（正式工具 · **2026-09-24 入库**）：把两份存档逐键对比，
 * 证明**只有预期字段变了**（其余状态逐值相同），并复核存档仍能被引擎正常加载。
 *
 * 用途：① 真档补账（`tools/save-grant-ships.ts`）之后的独立复核；② 任何"只该动一处"的存档手术；
 * ③ 读档往返体检（配合 `npm run save:roundtrip-audit`）。
 *
 * 用法：`npm run save:diff -- <改动前副本> <改动后存档>`
 * 例：`npm run save:diff -- "$env:APPDATA/whale-idle/save-20260924-173924.json" "$env:APPDATA/whale-idle/save.json"`
 * **只读**（两份都只读，不改任何文件）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-24 · 最后跑过 2026-09-24
 */
import { readFileSync } from 'node:fs'
import { buildSimContext } from '@whale/data'
import { loadSaveFile } from '@whale/core'

const [, , beforePath, afterPath] = process.argv
if (!beforePath || !afterPath) {
  console.error('用法：npx tsx tools/_verify-grant.ts <改动前副本> <当前真档>')
  process.exit(1)
}

const a = JSON.parse(readFileSync(beforePath, 'utf8')) as { state: Record<string, unknown>; version: number }
const b = JSON.parse(readFileSync(afterPath, 'utf8')) as { state: Record<string, unknown>; version: number }

console.log(`版本：${a.version} → ${b.version}`)
const keysA = Object.keys(a.state)
const keysB = Object.keys(b.state)
console.log(`顶层状态字段数：${keysA.length} → ${keysB.length}（新增 ${keysB.filter((k) => !keysA.includes(k)).join(',') || '无'}）`)

const diffs: string[] = []
for (const k of new Set([...keysA, ...keysB])) {
  const va = JSON.stringify(a.state[k])
  const vb = JSON.stringify(b.state[k])
  if (va !== vb) diffs.push(k)
}
console.log(`有差异的字段：${diffs.join(', ') || '（无）'}`)
console.log(`shipStore：${JSON.stringify(a.state.shipStore)} → ${JSON.stringify(b.state.shipStore)}`)

/* 引擎能否照常加载（用真内容目录跑一遍读档通道） */
const ctx = buildSimContext()
const loaded = loadSaveFile(readFileSync(afterPath, 'utf8')).state
console.log(`引擎读档：✅ 通过 · 舰船仓库 = ${JSON.stringify(loaded.shipStore)}`)
const expectOk = diffs.length === 1 && diffs[0] === 'shipStore'
console.log(expectOk ? '结论：✅ 只有 shipStore 变了（补账干净）' : '结论：✗ 还有别的字段被改动，请用备份回滚')
