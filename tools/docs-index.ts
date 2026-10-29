/**
 * 非归档文档索引（`npm run docs:index`），只写`docs/INDEX.md`。
 * 读取之前排除archive目录，不扫描源码语料；历史禁读规则见AGENTS.md。
 *
 * 口径：
 * - **标题** = 文档第一个 `# ` 行；**状态** = 头部 15 行里 `状态：…` 那段（归一成 5 类，见下）；
 *   **日期** = 文件名里的 `YYYYMMDD`（没有就留空，不猜 mtime）。
 * - **被引** = 其他非归档文档提到本篇文件名的次数，不据此判断是否有效或可删除。
 * - 全表**确定性**输出：同一份仓库状态跑两次逐字一致（不带生成时间戳，`--check` 才可用）。
 *
 * 用法：
 *   npm run docs:index            # 生成/刷新 docs/INDEX.md
 *   npm run docs:index -- --check  # 只校验（索引过期即退出码 1，留给体检/CI 用）
 *   npm run docs:index -- --stats  # 只在终端打统计，不写文件
 *
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, basename, dirname, sep } from 'node:path'

const ROOT = process.cwd()
const DOCS = join(ROOT, 'docs')
const OUT = join(DOCS, 'INDEX.md')

/** 状态归一：键 = 索引里显示的类，值 = 命中判据（按顺序匹配，先命中先算） */
const STATUS_RULES: readonly [string, RegExp][] = [
  ['进行中', /进行中|分卷/],
  ['待裁定', /待(船长|审|定|裁决|确认|批)/],
  ['已确认/已实现', /已(确认|实现|落地|合入|批准|交付|收尾|完成)|已获船长/],
  ['历史留档', /历史|依据|作废/],
]
const STATUS_NONE = '未标注'

interface DocRow {
  /** 相对仓库根的路径（POSIX 分隔符） */
  rel: string
  /** 第一个 `# ` 行（去掉 # 与前后的 *`） */
  title: string
  /** 头部 `状态：…` 的原文（截断 24 字），没有则空 */
  statusRaw: string
  /** 归一后的状态类 */
  status: string
  /** 文件名里的日期 `YYYY-MM-DD`，没有则空 */
  date: string
  kb: number
  lines: number
  /** 被别的文档引用次数 */
  refDocs: number
}

const posix = (p: string): string => p.split(sep).join('/')

/** archive在遍历前排除；索引本身不参与引用统计。 */
function collectMarkdown(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'archive' || name === 'node_modules' || name === '.git' || name === 'dist' || name === 'out') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) collectMarkdown(p, out)
    else if (name.endsWith('.md') && p !== OUT) out.push(p)
  }
  return out
}

function firstHeading(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('# ')) return line.slice(2).replace(/[*`]/g, '').trim()
  }
  return '(无一级标题)'
}

function statusOf(head: string): { raw: string; bucket: string } {
  const m = /状态[：:]\s*\**([^\n]{0,60})/.exec(head)
  if (!m) return { raw: '', bucket: STATUS_NONE }
  // 只取第一个分句（到 （(，,；;。 为止）——原文常常一写一大串，索引里要短而可读
  const raw = m[1]!
    .replace(/[*`]/g, '')
    .split(/[（(，,；;。]/)[0]!
    .replace(/[\s·、)）」]+$/, '')
    .trim()
    .slice(0, 18)
  for (const [bucket, re] of STATUS_RULES) if (re.test(raw)) return { raw, bucket }
  return { raw, bucket: STATUS_NONE }
}

function dateOf(name: string): string {
  const m = /(20\d{2})(\d{2})(\d{2})/.exec(name)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

/** 一次性把所有文档拼成语料，再用"文件名交替正则"单趟数引用（避免 N×M 全量扫） */
function countRefs(files: readonly { rel: string; text: string }[]) {
  const names = files.map((f) => basename(f.rel))
  const pattern = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g')
  const tally = (corpus: string): Map<string, number> => {
    const map = new Map<string, number>()
    for (const m of corpus.matchAll(pattern)) {
      const hit = m[0]
      map.set(hit, (map.get(hit) ?? 0) + 1)
    }
    return map
  }
  // 文档语料：逐篇单独统计（这样"自己提自己"能精确扣掉）
  const perDoc = new Map<string, number>()
  for (const f of files) {
    for (const [k, v] of tally(f.text)) if (!(k === basename(f.rel))) perDoc.set(k, (perDoc.get(k) ?? 0) + v)
  }
  return perDoc
}

function build(): { rows: DocRow[]; text: string } {
  const files = collectMarkdown(DOCS).concat([join(ROOT, 'AGENTS.md')].filter((p) => { try { return statSync(p).isFile() } catch { return false } }))
  // 体量与引用计数按LF归一，避免工作树行尾不同使索引漂移。
  const loaded = files.map((p) => ({ rel: posix(relative(ROOT, p)), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }))
  const perDoc = countRefs(loaded)

  const rows: DocRow[] = loaded.map((f) => {
    const head = f.text.split(/\r?\n/).slice(0, 15).join('\n')
    const st = statusOf(head)
    const name = basename(f.rel)
    return {
      rel: f.rel,
      title: firstHeading(f.text),
      statusRaw: st.raw,
      status: st.bucket,
      date: dateOf(name),
      kb: Math.max(1, Math.round(Buffer.byteLength(f.text, 'utf8') / 1024)),
      lines: f.text.split(/\r?\n/).length,
      refDocs: perDoc.get(name) ?? 0,
    }
  })

  // ── 分组 ──
  const AUTHORITY = ['AGENTS.md', 'docs/catalog.md', 'docs/development-conventions.md', 'docs/architecture.md', 'docs/glossary.md', 'docs/glossary-en.md', 'docs/roadmap.md', 'docs/content-workbench.md', 'docs/data-map.md', 'docs/data-editor.md', 'docs/single-source.md']
  const groupOf = (rel: string): string => {
    if (AUTHORITY.includes(rel)) return '一、常用文档（按任务查阅）'
    if (rel.startsWith('docs/design/battle-data/')) return '五、专题：战斗数据（design/battle-data）'
    if (rel.startsWith('docs/design/ship-battle-art/')) return '六、专题：舰船美术（design/ship-battle-art）'
    if (rel.startsWith('docs/review/')) return '七、评审与体检（review）'
    if (rel.startsWith('docs/test-saves/')) return '八、测试档说明（test-saves）'
    if (rel.startsWith('docs/design/')) return '三、设计与工作文档（需核实状态）'
    return '二、其它（docs 根目录）'
  }
  const byGroup = new Map<string, DocRow[]>()
  for (const r of rows) {
    const g = groupOf(r.rel)
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(r)
  }
  const order = (a: DocRow, b: DocRow): number => (b.date || '0000-00-00').localeCompare(a.date || '0000-00-00') || a.rel.localeCompare(b.rel)

  const orphans = rows.filter((r) => r.refDocs === 0).sort(order)
  const unmarked = rows.filter((r) => r.status === STATUS_NONE).sort(order)
  const stats = new Map<string, number>()
  for (const r of rows) stats.set(r.status, (stats.get(r.status) ?? 0) + 1)

  const L: string[] = []
  L.push('# 文档索引（非归档文档）')
  L.push('')
  L.push('> **本表由 `npm run docs:index`（`tools/docs-index.ts`）自动生成，禁止手改**——改文档后重跑即刷新。')
  L.push('> **只读**：生成器不改任何既有文档，只覆写本文件；`--check` 模式只校验不写。')
  L.push('>')
  L.push('> **怎么用**：① 按任务找入口看 **`docs/catalog.md`（文档目录 · 指路）**；')
  L.push('> ② 设计与工作文档须核对状态及当前实现；日期、被引数和已实现标记不授予实施权限。')
  L.push('> ③ 没有船长明确查阅要求，禁止阅读、检索或自动载入旧记录，也不得绕查Git历史。')
  L.push('> 本工具在遍历前跳过全部archive目录，不读取或收录其正文，不扫描全仓源码。')
  L.push('>')
  L.push(`> **口径**：标题 = 文档一级标题 · 状态 = 头部 \`状态：…\` 归一成 5 类 · 日期 = 文件名里的 \`YYYYMMDD\`（没有就留空）·`)
  L.push('> 被引 = 其他非归档文档提到本篇文件名的次数；零引用只提示导航缺口，不决定有效性。')
  L.push('')
  L.push('## 统计')
  L.push('')
  L.push(`- 非归档文档 **${rows.length}** 份（docs下排除archive目录及本索引，另含根AGENTS.md）· 合计 **${rows.reduce((s, r) => s + r.kb, 0)}** KB · **${rows.reduce((s, r) => s + r.lines, 0)}** 行`)
  L.push(`- 状态分布：${[...stats.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `**${k}** ${v}`).join(' · ')}`)
  L.push(`- 孤儿文档（0 引用）**${orphans.length}** 份 · 状态未标注 **${unmarked.length}** 份`)
  for (const g of [...byGroup.keys()].sort()) L.push(`- ${g}：**${byGroup.get(g)!.length}** 份`)
  L.push('')

  const table = (list: DocRow[]): void => {
    L.push('| 文档 | 标题 | 状态 | 日期 | 体量 | 被引（文档） |')
    L.push('|---|---|---|---|---|---|')
    for (const r of list) {
      const st = r.statusRaw ? `${r.status}（${r.statusRaw}）` : r.status
      L.push(`| \`${r.rel}\` | ${r.title.replace(/\|/g, '/')} | ${st.replace(/\|/g, '/')} | ${r.date || '—'} | ${r.kb} KB / ${r.lines} 行 | ${r.refDocs} |`)
    }
    L.push('')
  }

  for (const g of [...byGroup.keys()].sort()) {
    const list = byGroup.get(g)!.sort(order)
    L.push(`## ${g} —— ${list.length} 份`)
    L.push('')
    table(list)
  }

  L.push(`## 附：孤儿文档（0 引用，${orphans.length} 份）`)
  L.push('')
  L.push('> 仅表示没有其他收录文档提到本文件名，不能据此删除、归档或批准阅读历史。')
  L.push('')
  if (orphans.length === 0) L.push('（无）')
  else for (const r of orphans) L.push(`- \`${r.rel}\`（${r.date || '无日期'} · ${r.kb} KB）—— ${r.title}`)
  L.push('')

  L.push(`## 附：状态未标注（${unmarked.length} 份，待补一行 \`状态：…\`）`)
  L.push('')
  if (unmarked.length === 0) L.push('（无）')
  else for (const r of unmarked) L.push(`- \`${r.rel}\`（${r.date || '无日期'}）—— ${r.title}`)
  L.push('')

  // 行尾一律 CRLF（与仓库既有文档一致；`--check` 比较时会把 CRLF 归一）
  return { rows, text: L.join('\r\n') + '\r\n' }
}

const { rows, text } = build()
const mode = process.argv.includes('--check') ? 'check' : process.argv.includes('--stats') ? 'stats' : 'write'

if (mode === 'write') {
  writeFileSync(OUT, text, 'utf8')
  console.log(`✅ 已写 docs/INDEX.md：${rows.length} 份文档 · ${text.split(/\r?\n/).length} 行`)
} else if (mode === 'check') {
  let prev = ''
  try {
    prev = readFileSync(OUT, 'utf8')
  } catch {
    console.error('❌ docs/INDEX.md 不存在 —— 跑 `npm run docs:index` 生成')
    process.exit(1)
  }
  const norm = (s: string): string => s.replace(/\r\n/g, '\n')
  if (norm(prev) !== norm(text)) {
    console.error('❌ docs/INDEX.md 已过期（文档有增删改）—— 跑 `npm run docs:index` 刷新')
    process.exit(1)
  }
  console.log(`✅ docs/INDEX.md 是最新的（${rows.length} 份文档）`)
} else {
  const byGroup = new Map<string, number>()
  for (const r of rows) byGroup.set(dirname(r.rel), (byGroup.get(dirname(r.rel)) ?? 0) + 1)
  console.log(`文档 ${rows.length} 份 · ${rows.reduce((s, r) => s + r.kb, 0)} KB`)
  for (const [k, v] of [...byGroup.entries()].sort()) console.log(`  ${k.padEnd(34)} ${String(v).padStart(4)}`)
  console.log(`零文档引用 ${rows.filter((r) => r.refDocs === 0).length} 份 · 未标注 ${rows.filter((r) => r.status === STATUS_NONE).length} 份`)
}
