/**
 * T0 数据微调定向核对（AGENTS.md §2.2 / 开发约定 §二）
 *
 * 只对照 HEAD 与工作区的 packages/data/src/static/*.json，逐条目报告数值差异，
 * 并对市场卡做三项判定：价格合法、主键/引用未被改动、下架后不产生死物品。
 *
 * 边界：**不读、不写、不重导 content-csv/**（那是船长审查用的 gitignore 派生副本）；
 * 不复跑 content:check / typecheck / l10n / ui:rot-check，全套检查留给 T1/T2。
 * 工具报 ⚠ 时改动自动升回 T1，按正常流程处理。
 *
 * 用法：npm run data:quick
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'

const ROOT = process.cwd()
const STATIC_REL = 'packages/data/src/static'
const posix = (p: string) => p.split(sep).join('/')
const git = (args: string[]): string => execFileSync('git', args, {
  cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
})

function headDoc(rel: string): Record<string, unknown> | null {
  try { return JSON.parse(git(['show', `HEAD:${rel}`])) } catch { return null }
}
function curDoc(rel: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) } catch { return null }
}

/** 收集静态表里所有 id/key/refId，用于判断引用是否仍然存在 */
function idPool(doc: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(doc)) { for (const v of doc) idPool(v, out); return out }
  if (!doc || typeof doc !== 'object') return out
  const obj = doc as Record<string, unknown>
  for (const k of ['id', 'key', 'refId']) if (typeof obj[k] === 'string') out.add(obj[k] as string)
  for (const v of Object.values(obj)) idPool(v, out)
  return out
}

/** 静态表按 groups.<数组>.key 展平 */
function rowsOf(doc: Record<string, unknown> | null): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>()
  const groups = doc?.groups
  if (!groups || typeof groups !== 'object') return m
  for (const arr of Object.values(groups as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue
    for (const it of arr) {
      if (it && typeof it === 'object' && typeof (it as Record<string, unknown>).key === 'string') {
        m.set((it as Record<string, unknown>).key as string, it as Record<string, unknown>)
      }
    }
  }
  return m
}

const changed = git(['diff', '--name-only', 'HEAD', '--', STATIC_REL])
  .trim().split('\n').filter((f) => f.endsWith('.json')).map(posix)

if (changed.length === 0) {
  console.log('data:quick · packages/data/src/static/ 无变更，无需核对')
  process.exit(0)
}

// 内容表 id 池（排除 market 自身，否则新增卡的 refId 会自证存在）
const known = new Set<string>()
for (const name of readdirSync(join(ROOT, STATIC_REL))) {
  if (!name.endsWith('.json') || name === 'market.json') continue
  for (const id of idPool(curDoc(`${STATIC_REL}/${name}`))) known.add(id)
}

const notes: string[] = []
let warn = 0
const flag = (msg: string) => { notes.push(`  ⚠ ${msg}`); warn++ }

for (const rel of changed) {
  const before = rowsOf(headDoc(rel))
  const after = rowsOf(curDoc(rel))
  notes.push(`${rel}`)
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key)
    const b = after.get(key)
    if (!a) {
      notes.push(`  + ${key} 新增条目（超出 T0 白名单）`)
      flag(`新增条目请升回 T1：${rel} / ${key}`)
      continue
    }
    if (!b) {
      notes.push(`  - ${key} 移除`)
      if (rel.endsWith('market.json') && typeof a.refId === 'string' && known.has(a.refId)) {
        flag(`下架 ${key} 会让 ${a.refId} 成为死物品（仍被内容表引用）`)
      }
      continue
    }
    const diffs: string[] = []
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (JSON.stringify(a[field]) === JSON.stringify(b[field])) continue
      diffs.push(`${field} ${JSON.stringify(a[field])} → ${JSON.stringify(b[field])}`)
      if (field === 'basePrice' && !(typeof b[field] === 'number' && Number.isFinite(b[field]) && b[field] > 0)) {
        flag(`${key}: basePrice 必须是正数`)
      }
      if (['key', 'refId', 'kind'].includes(field)) {
        flag(`${key}: 主键或引用变动超出 T0，请升回 T1`)
      }
    }
    if (diffs.length) notes.push(`  ~ ${key}  ${diffs.join('; ')}`)
  }
}

console.log(`data:quick · 对照 HEAD，${changed.length} 个静态表有变更`)
for (const line of notes.slice(0, 15)) console.log(`  ${line}`)
if (notes.length > 15) console.log(`  … 另有 ${notes.length - 15} 行（明细见 git diff）`)
console.log(`结论：${warn} 处需处理${warn ? ' → 升回 T1 或修正数据' : ' · OK'}`)
process.exit(warn ? 1 : 0)
