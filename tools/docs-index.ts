/**
 * 文档索引生成器（`npm run docs:index`）——扫全仓文档，产出 **`docs/INDEX.md`**。
 *
 * 为什么要有它：
 * - `docs/` 下已有 **300+ 份 md**（设计稿 275 · 评审 12 · 测试档 75 · 根 6），
 *   而**唯一的路由入口**一直只有 `AGENTS.md` 里那张"按任务类型指路"的表——它只覆盖常读的几份，
 *   剩下两百多份设计稿"存在但找不到"（2026-09-15 起指路表迁到 `docs/catalog.md`，本工具与其分工：
 *   catalog 手写指路"该读哪份"，本工具生成全仓清册"有哪些文档"）。
 * - 手工维护索引必漂（这份表的每一行都能从文件名/首行自动推出来）⇒ **一律机器生成、禁止手改**。
 *
 * 口径（三号 2026-09-15 定，随"文档索引"批落地）：
 * - **只读**：本工具**不改任何既有文档**，只写 `docs/INDEX.md`（`--check` 模式下连它也不写）。
 * - **标题** = 文档第一个 `# ` 行；**状态** = 头部 15 行里 `状态：…` 那段（归一成 5 类，见下）；
 *   **日期** = 文件名里的 `YYYYMMDD`（没有就留空，不猜 mtime）。
 * - **被引** = 别的文档 + 源码注释里提到本篇文件名的次数（0 = 孤儿，索引里单列一节）。
 * - 全表**确定性**输出：同一份仓库状态跑两次逐字一致（不带生成时间戳，`--check` 才可用）。
 *
 * 用法：
 *   npm run docs:index            # 生成/刷新 docs/INDEX.md
 *   npm run docs:index -- --check  # 只校验（索引过期即退出码 1，留给体检/CI 用）
 *   npm run docs:index -- --stats  # 只在终端打统计，不写文件
 *
 * 版本自检（`tools-audit` 认这三条）：
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-19**（行尾归一：kb / lines / 引用计数改按 LF 归一后计算——
 *     背景：主树 LF 与其余工作树 CRLF 的内容逐字相同却生成不同索引，`--check` 在其中一棵恒红；
 *     归一只影响本工具读到的文本，索引输出仍 CRLF；改后两树生成逐字一致）
 *   - 本工具最后跑过：**2026-09-19**（271→273 份文档、`--check` 双树各验一次）
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
  /** 被源码注释引用次数 */
  refCode: number
}

const posix = (p: string): string => p.split(sep).join('/')

/** 递归收集 .md（跳过 node_modules / .git / dist 等，**并跳过索引自己**——否则它会给每篇文档记一次"被引"） */
function collectMarkdown(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'out') continue
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
function countRefs(files: readonly { rel: string; text: string }[], extraCorpus: string) {
  const names = files.map((f) => basename(f.rel))
  const pattern = new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g')
  const tally = (corpus: string, selfRel?: string): Map<string, number> => {
    const map = new Map<string, number>()
    for (const m of corpus.matchAll(pattern)) {
      const hit = m[0]
      map.set(hit, (map.get(hit) ?? 0) + 1)
    }
    if (selfRel) {
      // 自己提到自己不算引用
      const self = basename(selfRel)
      map.set(self, Math.max(0, (map.get(self) ?? 0) - 1))
    }
    return map
  }
  // 文档语料：逐篇单独统计（这样"自己提自己"能精确扣掉）
  const perDoc = new Map<string, number>()
  for (const f of files) {
    for (const [k, v] of tally(f.text)) if (!(k === basename(f.rel))) perDoc.set(k, (perDoc.get(k) ?? 0) + v)
  }
  const codeRefs = tally(extraCorpus)
  return { perDoc, codeRefs }
}

/** 源码语料（只看注释里提到的文档名；排除 tools/_ 临时件与产物目录） */
function sourceCorpus(): string {
  const exts = ['.ts', '.tsx', '.css', '.mjs', '.cjs', '.json']
  const parts: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'out' || name.startsWith('_')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (exts.some((e) => name.endsWith(e)) && st.size < 2_000_000) parts.push(readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
    }
  }
  for (const d of ['packages', 'apps', 'tools', 'web']) {
    try {
      walk(join(ROOT, d))
    } catch {
      /* 目录不存在就跳过 */
    }
  }
  return parts.join('\n')
}

function build(): { rows: DocRow[]; text: string } {
  const files = collectMarkdown(DOCS).concat([join(ROOT, 'AGENTS.md')].filter((p) => { try { return statSync(p).isFile() } catch { return false } }))
  // 2026-09-19：读取即把 CRLF 归一为 LF —— 本索引的 kb / lines / 引用计数**只该随内容变、不该随行尾变**。
  // 背景：两棵工作树（主树 LF / 其余 CRLF）内容逐字相同却因行尾差 1 字节/行 ⇒ 生成的 INDEX 不同、
  // `--check` 在其中一棵恒红。归一只影响本工具读到的文本，索引自身输出仍是 CRLF（见文件尾）。
  const loaded = files.map((p) => ({ rel: posix(relative(ROOT, p)), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }))
  const { perDoc, codeRefs } = countRefs(loaded, sourceCorpus())

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
      refCode: codeRefs.get(name) ?? 0,
    }
  })

  // ── 分组 ──
  const AUTHORITY = ['AGENTS.md', 'docs/catalog.md', 'docs/development-conventions.md', 'docs/architecture.md', 'docs/glossary.md', 'docs/roadmap.md', 'docs/content-workbench.md', 'docs/development-conventions-changelog.md']
  const groupOf = (rel: string): string => {
    if (AUTHORITY.includes(rel)) return '一、权威文档（开工必读）'
    if (rel.startsWith('docs/archive/')) return '九、封存卷（archive · 冻结件，只读不改）'
    if (rel.startsWith('docs/design/archive/')) return '四、已归档设计稿（design/archive）'
    if (rel.startsWith('docs/design/battle-data/')) return '五、专题：战斗数据（design/battle-data）'
    if (rel.startsWith('docs/design/ship-battle-art/')) return '六、专题：舰船美术（design/ship-battle-art）'
    if (rel.startsWith('docs/review/')) return '七、评审与体检（review）'
    if (rel.startsWith('docs/test-saves/')) return '八、测试档说明（test-saves）'
    if (rel.startsWith('docs/design/')) return '三、现行设计稿（design）'
    return '二、其它（docs 根目录）'
  }
  const byGroup = new Map<string, DocRow[]>()
  for (const r of rows) {
    const g = groupOf(r.rel)
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g)!.push(r)
  }
  const order = (a: DocRow, b: DocRow): number => (b.date || '0000-00-00').localeCompare(a.date || '0000-00-00') || a.rel.localeCompare(b.rel)

  const orphans = rows.filter((r) => r.refDocs === 0 && r.refCode === 0).sort(order)
  const unmarked = rows.filter((r) => r.status === STATUS_NONE).sort(order)
  const stats = new Map<string, number>()
  for (const r of rows) stats.set(r.status, (stats.get(r.status) ?? 0) + 1)

  const L: string[] = []
  L.push('# 文档索引（`docs/` 全量目录）')
  L.push('')
  L.push('> **本表由 `npm run docs:index`（`tools/docs-index.ts`）自动生成，禁止手改**——改文档后重跑即刷新。')
  L.push('> **只读**：生成器不改任何既有文档，只覆写本文件；`--check` 模式只校验不写。')
  L.push('>')
  L.push('> **怎么用**：① 按任务找入口看 **`docs/catalog.md`（文档目录 · 指路）**；')
  L.push('> ② 找"某功能当时怎么定的"看下面「现行设计稿」段（按日期倒序，新的在上）；')
  L.push('> ③ 拿不准某份文档还作不作数，看它的**状态**列（`未标注` = 头部没写状态，值得补）。')
  L.push('>')
  L.push(`> **口径**：标题 = 文档一级标题 · 状态 = 头部 \`状态：…\` 归一成 5 类 · 日期 = 文件名里的 \`YYYYMMDD\`（没有就留空）·`)
  L.push('> 被引 = 别的文档 + 源码注释里提到本篇文件名的次数（`0/0` = 孤儿文档，见最后一节）。')
  L.push('')
  L.push('## 统计')
  L.push('')
  L.push(`- 文档总数 **${rows.length}** 份（本表收录 \`docs/**/*.md\` + 根 \`AGENTS.md\`）· 合计 **${rows.reduce((s, r) => s + r.kb, 0)}** KB · **${rows.reduce((s, r) => s + r.lines, 0)}** 行`)
  L.push(`- 状态分布：${[...stats.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `**${k}** ${v}`).join(' · ')}`)
  L.push(`- 孤儿文档（0 引用）**${orphans.length}** 份 · 状态未标注 **${unmarked.length}** 份`)
  for (const g of [...byGroup.keys()].sort()) L.push(`- ${g}：**${byGroup.get(g)!.length}** 份`)
  L.push('')

  const table = (list: DocRow[]): void => {
    L.push('| 文档 | 标题 | 状态 | 日期 | 体量 | 被引（文档/代码） |')
    L.push('|---|---|---|---|---|---|')
    for (const r of list) {
      const st = r.statusRaw ? `${r.status}（${r.statusRaw}）` : r.status
      L.push(`| \`${r.rel}\` | ${r.title.replace(/\|/g, '/')} | ${st.replace(/\|/g, '/')} | ${r.date || '—'} | ${r.kb} KB / ${r.lines} 行 | ${r.refDocs} / ${r.refCode} |`)
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
  L.push('> 谁都没引用 = 要么是**历史快照**（可以进 `archive/`），要么是**该被引用却没接上**（该补链接）。归档时逐份过一遍。')
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
  console.log(`孤儿 ${rows.filter((r) => r.refDocs === 0 && r.refCode === 0).length} 份 · 未标注 ${rows.filter((r) => r.status === STATUS_NONE).length} 份`)
}
