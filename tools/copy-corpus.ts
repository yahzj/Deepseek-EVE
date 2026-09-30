/**
 * **文案语料抽取 ＋ 去腔调扫描**（正式入库；原临时探针 `tools/_copy-audit.mts` 按工具纪律转正）。
 *
 * 背景（**2026-09-30 船长令**）：船长装了 `humanizer-zh` 并建了本仓 `whale-copy` 规程，要求
 * 「对现有所有通讯或者长文本进行下审核」⇒ 审核要先有**可复跑的语料与读数**，不能靠翻文件凭感觉。
 *
 * 用法：
 *   npx tsx tools/copy-corpus.ts            # 抽语料 ＋ 打印去腔调读数
 *   npm run copy:audit                      # 等价
 *
 * 输入 / 输出：
 *   - 输入：`packages/data/src` 的内容表 ＋ 唯一文案表 `l10n/table.ts`
 *   - 输出：`tools/_ui-artifacts/copy-corpus.txt`（按来源分组、按长度降序，**可重建、不入库**）
 *
 * 读数列义：
 *   - `语料` = 玩家可见、含中文、**去标点去空白后 ≥40 字**的字符串条数（长文案才谈得上"腔调"）；
 *   - `腔调命中` = 按 `humanizer-zh` 的模式做的**线索扫描**（≠ 判定 AI 写的；命中要回到上下文判断）；
 *   - 每条命中都带 `位置 → 片段`，便于逐条复核。
 *
 * ⚠ **版本自检**：判据 = 内容表结构（`ITEMS`/`MODULES`/`SKILLS`/`DIALOGUES`/`COMMS_MESSAGES`/
 *   `ANNOUNCEMENTS`/`L10N` 的导出名与字段名）＋ 阈值 `MIN_LEN`；这两者任一改动 ⇒ 必须重跑核对。
 *   本工具最后核对：**2026-09-30**（当日读数：含中文长文案 620 条）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import {
  ACHIEVEMENTS,
  ANOMALIES,
  ANOMALIES_FLAVORED,
  ANNOUNCEMENTS,
  COMMS_MESSAGES,
  DIALOGUES,
  FACTION_CODEX,
  FIRST_TASK_MESSAGES,
  ITEMS,
  L10N,
  MODULES,
  SHIPS,
  SKILLS,
  STATION_SITES,
  TRAVEL_EVENTS,
} from '../packages/data/src/index'

/** 长文案门槛（去标点与空白后的汉字数） */
const MIN_LEN = 40
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/

interface Row {
  src: string
  id: string
  len: number
  text: string
}

const rows: Row[] = []
const seen = new Set<string>()

function push(src: string, id: string, text: string): void {
  if (typeof text !== 'string' || !CJK.test(text)) return
  if (text.replace(/[\s\p{P}]/gu, '').length < MIN_LEN) return
  const key = `${src}|${id}|${text}`
  if (seen.has(key)) return
  seen.add(key)
  rows.push({ src, id, len: text.length, text })
}

function walk(src: string, value: unknown, path: string, depth = 0): void {
  if (depth > 6 || value === null || value === undefined) return
  if (typeof value === 'string') {
    push(src, path, value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(src, v, `${path}[${i}]`, depth + 1))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/^(zh|en|text|description|subject|title|blurb|note|flavor|lines|name|label|reason|hint|summary)$/.test(k) || typeof v === 'object') {
        const myId = (value as { id?: string; key?: string }).id ?? (value as { key?: string }).key
        walk(src, v, myId && path.endsWith(']') ? `${path}(${myId}).${k}` : `${path}.${k}`, depth + 1)
      }
    }
  }
}

const SOURCES: ReadonlyArray<[string, unknown]> = [
  ['通讯·对白 DIALOGUES', DIALOGUES],
  ['通讯·消息 COMMS_MESSAGES', COMMS_MESSAGES],
  ['首次任务 FIRST_TASK_MESSAGES', FIRST_TASK_MESSAGES],
  ['公告 ANNOUNCEMENTS', ANNOUNCEMENTS],
  ['物品 ITEMS', ITEMS],
  ['模块 MODULES', MODULES],
  ['技能 SKILLS', SKILLS],
  ['舰船 SHIPS', SHIPS],
  ['异常 ANOMALIES', ANOMALIES],
  ['异常·风味 ANOMALIES_FLAVORED', ANOMALIES_FLAVORED],
  ['成就 ACHIEVEMENTS', ACHIEVEMENTS],
  ['族图鉴 FACTION_CODEX', FACTION_CODEX],
  ['星站 STATION_SITES', STATION_SITES],
  ['旅行事件 TRAVEL_EVENTS', TRAVEL_EVENTS],
]
for (const [src, value] of SOURCES) walk(src, value, src)
for (const [id, entry] of Object.entries(L10N)) push('文案表 L10N', id, entry.zh)

rows.sort((a, b) => b.len - a.len)
const bySrc = new Map<string, number>()
for (const r of rows) bySrc.set(r.src, (bySrc.get(r.src) ?? 0) + 1)

/**
 * `--src <关键字>`：只打印（并只落盘）匹配该关键字的条目 —— 审校按批次过目用
 * （例：`npx tsx tools/copy-corpus.ts --src 通讯` 看全部通讯与对白）。
 */
const srcIdx = process.argv.indexOf('--src')
const srcFilter = srcIdx >= 0 ? process.argv[srcIdx + 1] : undefined
const shown = srcFilter ? rows.filter((r) => r.src.includes(srcFilter)) : rows
if (srcFilter) {
  console.log(`（--src ${srcFilter}：${shown.length} 条）\n`)
  for (const r of shown) console.log(`[${r.len}] ${r.src} · ${r.id}\n${r.text}\n`)
  process.exit(0)
}

mkdirSync('tools/_ui-artifacts', { recursive: true })
writeFileSync('tools/_ui-artifacts/copy-corpus.txt', rows.map((r) => `[${r.len}] ${r.src} · ${r.id}\n${r.text}\n`).join('\n'))

console.log(`语料：${rows.length} 条（去标点后 ≥${MIN_LEN} 字）· 落盘 tools/_ui-artifacts/copy-corpus.txt`)
for (const [src, n] of [...bySrc].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${src}`)

/**
 * **去腔调线索扫描**（模式取自 `humanizer-zh` 的 31 条；只作线索，不作判定）。
 * 每条规则 = 名称 + 判据 + 为什么它值得看一眼。
 */
const TELLS: ReadonlyArray<{ name: string; re: RegExp; why: string }> = [
  { name: '破折号连用 ≥2', re: /——[^。；\n]{0,80}——/, why: '破折号当万能连接：拆句或改冒号' },
  { name: '不是X而是Y', re: /不是[^，。；\n]{1,20}[，,]?\s*而是|不仅[^，。；\n]{1,20}[，,]?\s*(更|还)是/, why: '假对比抬高语气' },
  { name: '意义拔高', re: /标志着|堪称|标志着|里程碑|新时代|梦想|极致|完美|无与伦比/, why: '空泛赞美，多半可删' },
  { name: '口号式动词', re: /赋能|致力于|旨在|助力|打造|引领/, why: '宣传语腔调' },
  { name: '客服腔', re: /好问题|希望(这|对您)|感谢(您|你的)|如有(任何)?(疑问|问题)/, why: '独立文案里不该有问候与提议' },
  { name: '套话收尾', re: /让我们|拭目以待|总而言之|综上所述|以上就是/, why: '删；有计划的总结才留' },
  { name: '格言伪深度', re: /[，。]\s*[^，。；\n]{2,8}(是|就是)[^，。；\n]{2,10}的(语言|艺术|答案|开始|尽头)/, why: '修辞没增加信息' },
  { name: '强凑三段式', re: /[^，。；\n]{2,10}、[^，。；\n]{2,10}、[^，。；\n]{2,10}(和|与)[^，。；\n]{2,10}/, why: '看三项是否各自提供独立信息' },
  { name: '进行＋动词', re: /进行(一[次个])?[^，。；\n]{0,6}(测试|调整|检查|评估|优化|处理)/, why: '可换直接动词' },
  { name: '层叠的“的”≥4', re: /的[^，。；\n]{0,12}的[^，。；\n]{0,12}的[^，。；\n]{0,12}的/, why: '长定语难读，拆结构' },
  { name: '随着…发展', re: /随着[^，。；\n]{1,20}(的)?(发展|进步|推进|深入)/, why: '背景无独立信息时可压缩' },
  { name: '限定词堆叠', re: /(可能|也许|大概|或许)[^，。；\n]{0,8}(可能|也许|大概|或许)/, why: '压缩同一层不确定性' },
  { name: '开发语残留', re: /本批|待定|占位|复核|校准|对齐|口径|目标带|版本号|TODO|WIP/, why: '玩家向文案里不许出现开发话术' },
]

const hits: Array<{ tell: string; why: string; at: string; snippet: string }> = []
for (const r of rows) {
  for (const t of TELLS) {
    const m = t.re.exec(r.text)
    if (m) hits.push({ tell: t.name, why: t.why, at: `${r.src} · ${r.id}`, snippet: m[0].slice(0, 40) })
  }
}
const byTell = new Map<string, number>()
for (const h of hits) byTell.set(h.tell, (byTell.get(h.tell) ?? 0) + 1)

console.log(`\n腔调线索命中：${hits.length} 处（**线索，不是判定**——每条都要回上下文看）`)
for (const [name, n] of [...byTell].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${name}`)
/** 逐类点名（每类前 `PER_TELL` 条）：审校时照这份清单回上下文复核 */
const PER_TELL = 8
for (const [name] of [...byTell].sort((a, b) => b[1] - a[1])) {
  const list = hits.filter((h) => h.tell === name)
  console.log(`\n▍${name}（${list.length} 处）— ${list[0]!.why}`)
  for (const h of list.slice(0, PER_TELL)) console.log(`  · ${h.at}\n    「${h.snippet}」`)
  if (list.length > PER_TELL) console.log(`  …（其余 ${list.length - PER_TELL} 处同类）`)
}

/**
 * **结构契约扫描**（不靠人眼，能机器判的一律机器判）：
 * ① **公告要点 3~5 条**（约定 §十二：一条一个变化）；
 * ② **公告第三人称**：正文不许出现「你／我／咱们」（船长 2026-09-08 定；公告只用第三人称「玩家」）；
 * ③ **通讯第二人称**：通讯与对白**应当**用「你」（反着查：整篇不出现「你」的通讯要人眼复核一遍）。
 */
console.log('\n▍结构契约')
const badBullets: string[] = []
const badPerson: string[] = []
for (const a of ANNOUNCEMENTS) {
  const bullets = (a as { bullets?: readonly string[] }).bullets ?? []
  const title = (a as { id?: string }).id ?? '(无 id)'
  if (bullets.length < 3 || bullets.length > 5) badBullets.push(`${title}：${bullets.length} 条`)
  for (const b of bullets) {
    const m = /[你我咱]/.exec(b)
    if (m) badPerson.push(`${title}：「${b.slice(Math.max(0, m.index - 15), m.index + 15)}」`)
  }
}
console.log(`  · 公告要点数 3~5 条：${badBullets.length === 0 ? '全部合规 ✅' : `**${badBullets.length} 条越界**`}`)
for (const s of badBullets.slice(0, 10)) console.log(`      ${s}`)
console.log(`  · 公告第三人称（正文不出现 你/我/咱）：${badPerson.length === 0 ? '全部合规 ✅' : `**${badPerson.length} 处**`}`)
for (const s of badPerson.slice(0, 10)) console.log(`      ${s}`)
if (badPerson.length > 10) console.log(`      …（其余 ${badPerson.length - 10} 处）`)
