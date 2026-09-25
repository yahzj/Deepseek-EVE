/**
 * **两套布局的样式拆分**（2026-09-25 · ui-redesign-2 随批落成正式工具）
 *
 * ## 为什么要有这个工具
 * 船长令：「新旧界面能否允许玩家在设置内切换？」⇒ 裁定**甲：两套 DOM 并存**；
 * 随后又令：「**默认旧档采用旧界面**」「**旧版 = main 上当前使用的界面**」；
 * 再后：「**旧版的设置界面依旧有出框的情况，要和新版的设置同步**」＋「**设置内采用新版的样式**」。
 *
 * ⚠ **两套外壳共用同一批类名**（`.app-nav-side` / `.app-workspace` / `.app-page-main` /
 * `.app-log-dock` …），而本轮为"底栏 + 左列活动栏"改写了这些规则 ⇒ 无论怎么卡特异度，
 * 两套规则都会互相串味（实测：modern 底栏被压成 168px 侧栏、classic 主区塌成 4px 宽）。
 * **⇒ 结论：两份样式表、按布局只加载一份**（`ui/layoutStyles.ts` 换 `<link>` 的 href）。
 *
 * ## 版式（不依赖 `git show main`，结果只取决于本仓两份文件）
 * · `styles-modern.css`  = 本分支 `styles.css` **原样**；
 * · `styles-classic.css` = 本分支 `styles.css` **原样**（⇒ 设置弹层等新件天然与新版同步）
 *   ＋ 末尾追加**旧版外壳覆盖**：`_baseline-main.css` 里那 18 个"外壳族"选择器
 *   （= 合并前 main 的原文），每条加 `.app-root.is-layout-classic` 限定 ⇒ 特异性更高、
 *   只可能命中旧版 ⇒ 外壳恢复成 main 的样子，其余全部跟随新版。
 *
 * ⚠ **为什么基准要冻结成文件**（`_baseline-main.css`）：起初用 `git show main:styles.css` 取基准，
 *   结果**合并进 main 之后"基准 = 自己"**，生成不出旧版该有的样子。
 *   ⇒ 把合并前那份 main 样式冻结入库，结果才稳定、可复现。
 * ⚠ 产物与基准都**必须入库**：不入库则任何人克隆后构建都会因找不到样式而失败。
 *   **改完 `styles.css` 后务必重跑 `npm run ui:layout-css`。**
 *
 * 用法：`npm run ui:layout-css`（`-- --check` 只校验不写盘）
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'apps/desktop/src/renderer/src/styles.css')
const OUT_DIR = join(ROOT, 'apps/desktop/src/renderer/src/ui/layout-css')
const BASELINE = join(OUT_DIR, '_baseline-main.css')
const CHECK = process.argv.includes('--check')

/** **外壳族**：这些选择器在第 1 份样式里被本轮改写，旧版必须改回 main 的值 */
const SHELL_SELECTORS = [
  '.app-root.is-mobile-rot .app-nav-side',
  '.app-root.is-mobile-rot .app-nav-side .app-nav-item:not(.is-featured)',
  '.app-workspace',
  '.app-page-main',
  '.app-nav-side',
  '.app-nav-side .app-nav-item',
  '.app-nav-side .app-nav-item.is-featured',
  '.app-nav-side .app-nav-icon',
  '.app-nav-item',
  '.app-log-dock',
  '.app-activitybar',
  '.app-activitybar-item',
  '.app-activitybar-line',
  '.app-activitybar-track',
  '.app-activitybar-scan',
  '.app-activitybar-tuning',
  '.app-activitybar-tuning-time',
]

interface Rule {
  sel: string
  raw: string
  body: string
}

/**
 * 解析 CSS 成规则表。
 * ⚠ 选择器里**必须先剥掉块注释**：本仓习惯把大段说明写在规则之前，
 *   不剥就会把注释算进选择器（当初踩过：命中数全是 0）。
 * ⚠ `selStart` 要**跳过前导空白**：否则会把 `\r\n\r\n` 算进区间，替换时吃掉换行。
 */
function parseRules(text: string): Rule[] {
  const out: Rule[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const rawSel = text.slice(i, open)
    const sel = rawSel.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ')
    let depth = 0
    let j = open
    while (j < text.length) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) break
      }
      j++
    }
    let ss = i
    const lead = /^\s*/.exec(rawSel)
    if (lead) ss = i + lead[0].length
    if (sel) out.push({ sel, raw: text.slice(ss, j + 1), body: text.slice(open + 1, j) })
    i = j + 1
  }
  return out
}

const current = readFileSync(SRC, 'utf8')
const baseline = readFileSync(BASELINE, 'utf8')
const baseRules = parseRules(baseline)

// ── 旧版外壳覆盖：从冻结基准里取那一族的**全部**实例 ──
const shellOverrides: string[] = []
for (const sel of SHELL_SELECTORS) {
  const hits = baseRules.filter((r) => r.sel === sel)
  if (hits.length === 0) throw new Error(`外壳覆盖清单里的 «${sel}» 在 _baseline-main.css 里找不到`)
  for (const r of hits) shellOverrides.push(`.app-root.is-layout-classic ${r.raw}`)
}

// ── ① modern 份 = 本分支 styles.css 原样 ──
const modernCss =
  '/* 新版（modern）应用级样式 —— 由 `tools/layout-css-split.ts` 从 `styles.css` 原样复制。\n' +
  '   **不要手改本文件**：改样式请改 `apps/desktop/src/renderer/src/styles.css`，然后跑\n' +
  '   `npm run ui:layout-css` 重新生成（两套布局不能同时加载，故必须分成两份）。 */\r\n\r\n' +
  current

// ── ② classic 份 = 本分支 styles.css（= 设置弹层等新件与新版同步）+ 旧版外壳覆盖 ──
const classicCss =
  '/* 旧版（classic）应用级样式 —— 由 `tools/layout-css-split.ts` 生成，**不要手改本文件**。\n' +
  '   一 = 本分支 `styles.css` 原样（⇒ 设置弹层等新件与新版**同步**，船长令「设置内采用新版的样式」）；\n' +
  '   二 = **旧版外壳覆盖**：合并前 main 的外壳族原文 + `.app-root.is-layout-classic` 限定\n' +
  '        ⇒ 外壳（顶栏/左竖栏/主区/日志坞/活动栏）恢复成 main 的样子，其余跟随新版。\n' +
  '   基准冻结在 `_baseline-main.css`（**不要删**：删了就无法复现旧版外壳）。 */\r\n\r\n' +
  '/* ══════════ 一、本分支 styles.css 原样 ══════════ */\r\n\r\n' +
  current +
  '\r\n\r\n/* ══════════ 二、旧版外壳覆盖（取合并前 main 原文 + 旧版限定）══════════ */\r\n\r\n' +
  shellOverrides.join('\r\n') +
  '\r\n'

// ── 自检 ──
const bal = (t: string): number => (t.match(/\{/g) ?? []).length - (t.match(/\}/g) ?? []).length
for (const [name, text] of [
  ['modern 份', modernCss],
  ['classic 份', classicCss],
] as const) {
  const d = bal(text)
  console.log(`  ${d === 0 ? '✅' : '❌'} ${name}：花括号差 ${d} · ${Math.round(text.length / 1024)} KB`)
  if (d !== 0) throw new Error(`${name} 花括号不配平 —— 拒绝写盘`)
}
console.log(
  `  · 外壳覆盖 ${SHELL_SELECTORS.length} 个选择器 / ${shellOverrides.length} 条规则` +
    ` · 基准 _baseline-main.css ${Math.round(baseline.length / 1024)} KB`,
)

if (CHECK) {
  console.log('\n[check] 未写盘')
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  const write = (name: string, text: string): void => writeFileSync(join(OUT_DIR, name), text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8')
  write('styles-modern.css', modernCss)
  write('styles-classic.css', classicCss)
  console.log('\n  ✅ 已写 ui/layout-css/styles-modern.css 与 styles-classic.css')
}
void execFileSync
