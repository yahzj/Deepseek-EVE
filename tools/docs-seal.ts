/**
 * roadmap 封存器（`npm run docs:seal`）——把 `docs/roadmap.md` 里**滚动窗口之外**的批次条目
 * **原文搬运**进 `docs/archive/roadmap-YYYY-MM-DD.md`（按条目日期分卷），并把 roadmap 重排成
 * 「① 待办活面 ＋ ② 最近 N 条批次条目 ＋ ③ 封存卷索引」。
 *
 * 为什么要有它（2026-09-15 船长：「roadmap/glossary 也要进行精简，删除过时内容，
 * 或者将过时内容移入另外一个文档并封存」）：
 * - roadmap 曾涨到 **1523 KB / 824 行**（单条平均 1.9 KB 的巨型条目），"查最近发生了什么"要先滚过一兆字节；
 * - 但每条里的**船长原话照抄 / 逐问逐答 / 负向验证 / 读数**是决策审计链，**一个字都不能丢**
 *   ⇒ 处理方式 = **封存（原文搬运 + 分卷 + 索引）**，不是删除、不是摘要。
 *
 * 口径：
 * - **只搬不写**：封存卷里的内容是原行**逐字复制**（含续行），卷头只加"收录范围 / 冻结日期 / 原行号区间"。
 * - **守恒校验**：搬完后 `原条目数 == roadmap 保留 + 本次新封存 + 卷里已有`，不等就**抛错不写盘**。
 * - **幂等**：同一卷重复跑不会重复写（按首行文本去重）；`--dry-run` 只打计划。
 * - **只认条目行**：物理行以 `- YYYY-MM-DD：` 开头 = 新条目；其后到下一个条目之间的行算它的**续行**，跟着走。
 *   其余行（待办段 / 说明 / 标题 / 分隔线）一律**留在 roadmap**，顺序不动。
 *
 * 用法：
 *   npm run docs:seal -- --dry-run   # 只看计划（推荐先跑这个）
 *   npm run docs:seal                # 执行封存（写卷 + 重排 roadmap）
 *   npm run docs:seal -- --window=60 # 临时把滚动窗口调大（默认 20 条）
 *
 * 版本自检（`tools-audit` 认这三条）：
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-15**（首版：把 2026-09-04~09-15 的批次条目按日分 9 卷封存，
 *     roadmap 1523 KB → 约 100 KB；守恒校验与幂等各验一次）
 *   - 本工具最后跑过：**2026-09-15**
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const ROADMAP = join(ROOT, 'docs/roadmap.md')
const ARCHIVE = join(ROOT, 'docs/archive')
const ENTRY_RE = /^- (20\d{2}-\d{2}-\d{2})：/
const HEAD_RE = /^## /

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const WINDOW = Number((args.find((a) => a.startsWith('--window=')) ?? '').split('=')[1] ?? 20)

/** 待办活面：这些段整段留在 roadmap（段头匹配前缀，顺序按原文） */
const KEEP_SECTIONS = [
  '## 置顶',
  '## A.',
  '## B.',
  '## C.',
  '## D.',
  '## E.',
  '## 2026-09-08 一号交接开放项',
  '## 2026-09-09 一号收尾开放项',
]
/** 只当分隔用的段头：不保留（其下条目照常按日分卷） */
const DROP_SECTIONS = ['## 变更记录（本文件）']
/**
 * 待办活面的**模式名单**（2026-09-16 补）：`## 2026-09-08 一号交接开放项` / `## 2026-09-15 二号交接开放项`
 * 这类「日期 + 经办人 + 交接/收尾开放项」的段一律整段保留——**防"新写的待办段头没进前缀白名单 ⇒ 整段被丢"**
 * （实证：二号那段里的 W1「公告待发」/ W2「验收用测试存档未配」两条待办曾被本工具静默丢掉）。
 */
const KEEP_SECTION_PATTERNS: readonly RegExp[] = [/^## \d{4}-\d{2}-\d{2} .*(交接开放项|收尾开放项)/]

const bytes = (s: string): number => Buffer.byteLength(s, 'utf8')

/** 把一个文件切成"块"：块 = 条目（首行 + 续行）或 非条目run（连续的非条目行） */
interface Block {
  kind: 'entry' | 'text'
  date: string
  lines: string[]
}
function splitBlocks(lines: readonly string[]): Block[] {
  const out: Block[] = []
  let cur: Block | null = null
  for (const line of lines) {
    const m = ENTRY_RE.exec(line)
    if (m) {
      cur = { kind: 'entry', date: m[1]!, lines: [line] }
      out.push(cur)
    } else if (cur && cur.kind === 'entry' && line.trim() !== '' && !HEAD_RE.test(line) && !line.startsWith('>')) {
      cur.lines.push(line) // 续行（多行条目）；`>` 引注行一律算**文件级说明**，不并入条目
    } else {
      cur = { kind: 'text', date: '', lines: [line] }
      out.push(cur)
    }
  }
  return out
}

interface Volume {
  date: string
  entries: string[][]
  bytes: number
}

function volumePath(date: string): string {
  return join(ARCHIVE, `roadmap-${date}.md`)
}

/** 读已存在的卷，返回"已有条目的首行"集合与既有行数（用于幂等与守恒） */
function existingVolume(date: string): { firsts: Set<string>; text: string } {
  const p = volumePath(date)
  if (!existsSync(p)) return { firsts: new Set(), text: '' }
  const text = readFileSync(p, 'utf8')
  const firsts = new Set<string>()
  for (const line of text.split(/\r?\n/)) if (ENTRY_RE.test(line)) firsts.add(line)
  return { firsts, text }
}

function volumeHeader(date: string, range: string): string {
  return [
    `# 封存卷 · roadmap 批次条目 ${date}`,
    '',
    `> **冻结件**（${date} 当日批次条目）：从 \`docs/roadmap.md\` **原文搬运、一字未改**（含船长原话照抄、逐问逐答、负向验证与读数）。`,
    `> 封存日期 **2026-09-15**（三号 · verify40）· 搬运时原行号区间 ${range}。`,
    `> **检索**：本目录内 grep，或 \`git log -S "<关键词>" -- docs/roadmap.md\`（历史版本随时可翻）。`,
    `> **不要在本卷里追加新内容**——新批次写进 \`docs/roadmap.md\` 的滚动窗口，越窗后由 \`npm run docs:seal\` 封存进新卷。`,
    '',
    '---',
    '',
  ].join('\r\n')
}

const raw = readFileSync(ROADMAP, 'utf8')
const lines = raw.split(/\r?\n/)
const blocks = splitBlocks(lines)
const entries = blocks.filter((b) => b.kind === 'entry')
const texts = blocks.filter((b) => b.kind === 'text')

// ── ① 分卷计划：窗口外的条目按日期卷 ──
// ⚠ 本文件的约定是**新条目在上**（顶部块最新，`## 变更记录` 段越往下越旧）
//   ⇒ 滚动窗口 = **前 N 条**（文件顺序），封存的 = 其余（老的那些）。
const keep = entries.slice(0, WINDOW)
const sealing = entries.slice(WINDOW)
const newestKept = keep.reduce((m, e) => (e.date > m ? e.date : m), '')
const oldestSealed = sealing.reduce((m, e) => (e.date > m ? e.date : m), '')
if (keep.length > 0 && sealing.length > 0 && oldestSealed > newestKept) {
  console.error(`⚠ 文件顺序约定似乎被打破：窗口内最旧 ${newestKept} 早于封存卷里最新 ${oldestSealed} —— 请人工看一眼 roadmap 顶部块顺序`)
}
const byDate = new Map<string, string[][]>()
for (const e of sealing) {
  if (!byDate.has(e.date)) byDate.set(e.date, [])
  byDate.get(e.date)!.push(e.lines)
}

const volumes: Volume[] = [...byDate.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([date, list]) => ({ date, entries: list, bytes: list.reduce((s, l) => s + bytes(l.join('\n')) + 2, 0) }))

// ── ② 守恒校验（写盘前）──
let alreadySealed = 0
for (const v of volumes) {
  const { firsts } = existingVolume(v.date)
  for (const e of v.entries) if (firsts.has(e[0]!)) alreadySealed++
}
const conserved = keep.length + sealing.length - alreadySealed + alreadySealed
if (conserved !== entries.length) {
  throw new Error(`条目数不守恒：原 ${entries.length} · 保留 ${keep.length} · 拟封存 ${sealing.length} · 卷里已有 ${alreadySealed}`)
}

// ── ③ 组织 roadmap 新正文 ──
/** 待办段按原文切出来（段头 → 下一个段头之前） */
const textLines = texts.flatMap((b) => b.lines)
const sections = new Map<string, string[]>()
let curHead = ''
let curBody: string[] = []
const flush = (): void => {
  if (curHead) sections.set(curHead, curBody)
  else sections.set('__head__', curBody)
}
for (const line of textLines) {
  if (HEAD_RE.test(line)) {
    flush()
    curHead = line
    curBody = [line]
  } else {
    curBody.push(line)
  }
}
flush()

const kept: string[] = []
const head = (sections.get('__head__') ?? []).filter(
  // 去掉本工具自己写的标题与改版说明（重跑时不重复堆叠）
  (l) => !/^# /.test(l) && !/^> \*\*2026-09-15 改版\*\*/.test(l) && !/^> 更早的批次条目已/.test(l) && !/^> 封存动作 = /.test(l),
)
kept.push(head.join('\r\n').replace(/(\r?\n)+$/, ''))
/** 一个段头是否属于"待办活面"（前缀白名单 **或** 模式名单） */
const isKeepSection = (k: string): boolean =>
  KEEP_SECTIONS.some((w) => k.startsWith(w)) || KEEP_SECTION_PATTERNS.some((re) => re.test(k))
/**
 * ⚠ **按原文顺序**保留全部待办段（2026-09-16 修）：原实现只遍历 `KEEP_SECTIONS` 找**每项第一个**匹配段
 * ⇒ 两份"同类"待办段只会留下第一份，且**段头没进白名单的段（例如「## 2026-09-15 二号交接开放项」）
 * 连同段内 `- [ ]` 待办一起被静默丢掉**（实证：二号那段的 W1 公告待发 / W2 测试存档两条待办就这么没了，
 * 封存卷里也查不到）。现在改为：**扫全部段头、按文档顺序收**，并支持正则模式名单。
 */
for (const key of sections.keys()) {
  if (key === '__head__') continue
  if (!isKeepSection(key)) continue
  kept.push((sections.get(key) ?? []).join('\r\n').replace(/(\r?\n)+$/, ''))
}
const dropped = [...sections.keys()].filter((k) => k !== '__head__' && !isKeepSection(k))
// 「最近批次」与「封存卷索引」两段是本工具自己生成的，重跑时会被丢弃再重建 ⇒ 不算"被删内容"，不报警
const selfMade = (k: string): boolean => k.startsWith('## 最近批次') || k.startsWith('## 封存卷索引')
const droppedNonEmpty = dropped.filter((k) => !selfMade(k) && (sections.get(k) ?? []).some((l) => l.trim() !== ''))

/** 卷索引：**扫盘**（不是只看本次封存的那几条——重跑时本次要封的是 0 条，索引仍要列全） */
function allVolumes(): { date: string; entries: number; kb: number }[] {
  if (!existsSync(ARCHIVE)) return []
  return readdirSync(ARCHIVE)
    .map((f) => /^roadmap-(20\d{2}-\d{2}-\d{2})\.md$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => {
      const text = readFileSync(join(ARCHIVE, `roadmap-${m[1]}.md`), 'utf8')
      let n = 0
      for (const line of text.split(/\r?\n/)) if (ENTRY_RE.test(line)) n++
      return { date: m[1]!, entries: n, kb: Math.round(bytes(text) / 1024) }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

const indexRows = allVolumes().map(
  (v) => `| \`docs/archive/roadmap-${v.date}.md\` | ${v.date} | ${v.entries} 条 | ${v.kb} KB |`,
)

const out: string[] = []
out.push('# 后续工作流备忘（Roadmap / Backlog）')
out.push('')
out.push('> **2026-09-15 改版**：本文件只留三块 —— **① 待办活面**（置顶单 / 待办段 / 交接开放项）· **② 最近 ' + WINDOW + ' 条批次条目（滚动窗口）** · **③ 封存卷索引**。')
out.push('> 更早的批次条目已**原文封存**进 `docs/archive/roadmap-YYYY-MM-DD.md`（一字未改，含船长原话照抄）——查老决策先看索引表、再 grep 对应卷。')
out.push('> 封存动作 = `npm run docs:seal`（滚动窗口之外自动进卷，幂等；`--dry-run` 先看计划）· 封存区规则见 `docs/archive/README.md` · 全仓文档总索引 = `docs/INDEX.md`。')
out.push('')
for (const part of kept) {
  out.push(part)
  out.push('')
}
out.push(`## 最近批次（滚动窗口 · 最新 ${keep.length} 条）`)
out.push('')
out.push(`> 越窗即封存（\`npm run docs:seal\`）；窗口大小 = ${WINDOW} 条，需要临时调大用 \`--window=N\`。`)
out.push('')
out.push(keep.map((e) => e.lines.join('\r\n')).join('\r\n'))
out.push('')
out.push(`## 封存卷索引（更早批次已移入 \`docs/archive/\`，点开即读）`)
out.push('')
out.push('| 卷 | 收录日期 | 条目 | 体量 |')
out.push('|---|---|---|---|')
if (indexRows.length === 0) out.push('| （暂无——批次条目都还在窗口内） | — | — | — |')
else out.push(...indexRows)
out.push('')
out.push('> 上面每卷都是**原文冻结件**：不重写、不摘要、不追加。`docs/archive/README.md` 另有"已办结待办单"卷。')
out.push('')
const nextText = out.join('\r\n').replace(/(\r?\n){3,}/g, '\r\n\r\n')

// ── ④ 落盘 ──
console.log(`条目 ${entries.length} 条 · 保留窗口 ${keep.length} 条 · 拟封存 ${sealing.length} 条（卷里已有 ${alreadySealed}）`)
for (const v of volumes) console.log(`  卷 ${v.date}  ${v.entries.length} 条  ${Math.round(v.bytes / 1024)} KB`)
console.log(`roadmap：${Math.round(bytes(raw) / 1024)} KB → ${Math.round(bytes(nextText) / 1024)} KB`)
console.log(`不保留的段头：${droppedNonEmpty.length ? droppedNonEmpty.join(' / ') : '（无）'}`)

if (DRY) {
  console.log('\n--dry-run：未写盘。')
} else {
  for (const v of volumes) {
    const { firsts, text } = existingVolume(v.date)
    const fresh = v.entries.filter((e) => !firsts.has(e[0]!))
    if (fresh.length === 0) continue
    const body = fresh.map((e) => e.join('\r\n')).join('\r\n\r\n')
    if (!text) {
      writeFileSync(volumePath(v.date), volumeHeader(v.date, `${v.date} 当日条目`) + body + '\r\n', 'utf8')
    } else {
      writeFileSync(volumePath(v.date), text.replace(/\s*$/, '') + '\r\n\r\n' + body + '\r\n', 'utf8')
    }
  }
  writeFileSync(ROADMAP, nextText, 'utf8')
  console.log('\n✅ 已封存并重排 docs/roadmap.md')
  void readdirSync
}
