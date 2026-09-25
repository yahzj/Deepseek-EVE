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

/**
 * **外壳族**：这些选择器在本轮被改写（新版是"底栏 + 左列活动栏 + 右侧日志浮层"），
 * 旧版必须**整族改回 main 的值**（新版是"左竖栏 + 主列顶部活动条 + 流内右栏日志"）。
 *
 * ⚠ **漏一族 = 旧版长得像新版**，本轮已被船长抓到三处：
 *   · 活动栏（`.app-activitybar*`）：新版左列 150px，旧版是主列顶部一条（`width:100%` + `max-height:230px`）
 *     ⇒「旧版顶部的活动窗口不见了」；
 *   · 日志坞（`.app-log-*`）：新版 `position: fixed` 浮层，旧版是**流内右栏**
 *     ⇒「事件日志也是采用新版的弹出覆盖的样式」；
 *   · 导航族（`.app-nav-side*`）：新版是底栏（row/100%），旧版是 168px 左竖栏。
 *   ⇒ **新增外壳取值时，务必回头把这几个族逐条核对一遍**（工具会回读自检，漏了会直接报错）。
 */
const SHELL_SELECTORS = [
  '.app-root.is-mobile-rot .app-nav-side',
  '.app-root.is-mobile-rot .app-nav-side .app-nav-item:not(.is-featured)',
  '.app-workspace',
  '.app-page-main',
  // 导航族（含舰船窗 / 矮窗紧凑款）
  '.app-nav-side',
  '.app-nav-side .app-nav-item',
  '.app-nav-side .app-nav-item.is-featured',
  '.app-nav-side .app-nav-item.is-featured .app-nav-icon',
  '.app-nav-side .app-nav-item.is-featured:hover',
  '.app-nav-side .app-nav-item.is-featured.is-active',
  '.app-nav-side .app-nav-icon',
  '.app-nav-side .app-shipwin',
  '.app-nav-item',
  // 日志族（旧版是流内右栏，新版是右侧浮层）
  '.app-log-dock',
  '.app-log-side',
  '.app-log-side .wui-panel',
  '.app-log-side.is-collapsed',
  '.app-log-wrap',
  '.app-log-wrap .wui-panel',
  '.app-log-handle',
  '.app-log-handle:hover',
  // 活动栏族（旧版是主列顶部一条，新版是左侧竖列）
  '.app-activitybar',
  '.app-activitybar-item',
  '.app-activitybar-line',
  '.app-activitybar-track',
  '.app-activitybar-scan',
  '.app-activitybar-tuning',
  '.app-activitybar-tuning-time',
]

/**
 * **旧版需要"抹掉"的新构件**：本轮为横向布局新加的包裹层，main 原文里没有。
 * `.app-workspace-body`（"右体"：信息带 + 主区 + 日志坞）在旧版里会让 `.app-workspace`
 * 的第三个直接子块变成它 ⇒ 日志坞那支插槽落不进右栏。
 * 用 `display: contents` 让这层**不产生盒子** ⇒ 子元素直接参与 `.app-workspace` 的 flex 排布，
 * 效果等同 main 的"三个直接子块"结构。
 */
const CLASSIC_TRANSPARENT_LAYERS = ['.app-workspace-body']

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
/**
 * 当前 `styles.css` 的规则表（**一份**：下面「窗口模块族」筛选与 `--debug` 读数都用它）。
 *
 * ⚠ 2026-09-25 补：`807637f1`（窗口模块化）在 L223 用了 `curRules` 却没定义 ⇒
 * `npm run ui:layout-css:check` 直接 ReferenceError（主树与 d2 都跑不起来）；
 * 而且 `npm run typecheck` 只跑 4 个 workspace、**不覆盖 `tools/`** ⇒ 四道闸门都拦不住。
 * 这里顺手把原先那句重复的 `parseRules(current)` 也收敛到同一份。
 */
const curRules = parseRules(current)
if (process.argv.includes('--debug')) {
  console.log(`  [debug] 基准规则 ${baseRules.length} 条 · 当前规则 ${curRules.length} 条`)
  for (const sel of SHELL_SELECTORS) {
    const hits = baseRules.filter((r) => r.sel === sel)
    console.log(`  [debug] ${hits.length} × «${sel}»${hits.length === 0 ? '   ⚠ 基准里没有这条选择器' : ''}`)
  }
}

// ── 旧版外壳覆盖：从冻结基准里取那一族的**全部**实例 ──
const shellOverrides: string[] = []
for (const sel of SHELL_SELECTORS) {
  const hits = baseRules.filter((r) => r.sel === sel)
  if (hits.length === 0) throw new Error(`外壳覆盖清单里的 «${sel}» 在 _baseline-main.css 里找不到`)
  for (const r of hits) shellOverrides.push(`.app-root.is-layout-classic ${r.raw}`)
}

// ── 旧版"透明化"新构件（本轮新增的包裹层，main 原文里没有）──
for (const sel of CLASSIC_TRANSPARENT_LAYERS) {
  shellOverrides.push(`.app-root.is-layout-classic ${sel} { display: contents; }`)
}

/**
 * **撤销新版加上去、而 main 原文没有的属性**。
 * ⚠ 这一块是必须的（船长报障两条的真因）：
 *   ① `.app-log-dock`：基线规则只写了 `display/flex-shrink/min-height`，
 *      **它不会取消新版那套 `position: fixed; right/top/bottom; z-index; pointer-events`**
 *      ⇒ 日志坞仍是浮层（船长：「事件日志也是采用新版的弹出覆盖的样式」）；
 *   ② `.app-nav-side` 的 `box-sizing`：新版底栏那条写了 `border-box`，而 **box-sizing 会继承**
 *      ⇒ 左栏里每个子元素都被压窄 21px（实测 `.app-shipwin` 168→147、`.app-wallet` 150→129），
 *      于是钱包的可用宽度从 150 掉到 129、"信用点"三个字放不下被 `MoneyFit` 降档去掉
 *      （船长：「旧版的钱包只显示数字，信用点几个子不见了」）。
 *      main 原文没写 `box-sizing` ⇒ 用默认的 `content-box`，这里显式写回去。
 */
const CLASSIC_RESETS = `
/* 日志坞：新版是右侧浮层（fixed + inset + z-index + 不吃点击），旧版是**流内右栏** ⇒ 全部复位 */
.app-root.is-layout-classic .app-log-dock {
  position: static;
  inset: auto;
  z-index: auto;
  align-items: normal;
  pointer-events: auto;
}
/* 左栏：新版的底栏规则带 border-box，会**继承**下去把子元素压窄 21px ⇒ 改回 main 的 content-box */
.app-root.is-layout-classic .app-nav-side {
  box-sizing: content-box;
}
/* 主区：新版写了 width:100%（配合"右体"那一层），在旧版的三块平铺结构里会让主区**不收缩**
   ⇒ 日志坞被挤出视口（实测主区 1260、日志坞 x=1493）。改回 main 的 flex: 1。 */
.app-root.is-layout-classic .app-page-main {
  flex: 1;
  width: auto;
}
/* 活动栏：新版是左列里的定宽竖列，旧版是主列顶部一条 ⇒ 清掉新版的宽高约束 */
.app-root.is-layout-classic .app-activitybar {
  flex: 0 0 auto;
  min-height: 0;
  margin: 0 0 var(--wui-sp-6);
}
`

// ── ① modern 份 = 本分支 styles.css 原样 ──
const modernCss =
  '/* 新版（modern）应用级样式 —— 由 `tools/layout-css-split.ts` 从 `styles.css` 原样复制。\n' +
  '   **不要手改本文件**：改样式请改 `apps/desktop/src/renderer/src/styles.css`，然后跑\n' +
  '   `npm run ui:layout-css` 重新生成（两套布局不能同时加载，故必须分成两份）。 */\r\n\r\n' +
  current

/**
 * **三块"窗口模块"的样式族**（船长 2026-09-25 令：「不能将各个窗口模块化吗，新版的活动窗口
 * 和旧版（昨天）的活动窗口」⇒ 裁定**甲：只把窗口模块化，两套外壳先保留**；
 * 并指定「**旧版建议你从昨天的版本中 git 下来进行拆解**」）。
 *
 * 三块窗口 = ① 活动栏（`ActivityBar`）② 主控活动窗口（`ActivityScreen`）③ 事件日志坞。
 * **活动栏已按船长指的路子拆开**：旧版用从昨天那版取来的 `ActivityBarClassic.tsx`（冻结件），
 * 它的观感**整族走冻结基准**（`_baseline-main.css` 里的 `.app-activitybar*` / `.app-ai-*`），
 * 所以这里**不再**把新版活动栏那一族搬给旧版（搬了反而会盖掉旧版样式）。
 * 剩下两块组件共用、样式也共用，故把它们的族复制进 classic 份。
 */
const WINDOW_MODULE_PREFIXES = [
  '.app-actwin', // ② 主控活动窗口（窗口壳 / 标题 / 读数 / 操作）
  '.app-act-', // 活动窗口内部件（进度条 / 读数 / 按钮）
  '.app-log-', // ③ 事件日志坞内部件（筛选 / 列表 / 收起把手）
  '.app-log-dock',
]
const isWindowModuleFamily = (sel: string): boolean => WINDOW_MODULE_PREFIXES.some((p) => sel.startsWith(p))
const windowModuleRules = curRules.filter((r) => isWindowModuleFamily(r.sel))
if (windowModuleRules.length === 0) throw new Error('三块窗口模块在 styles.css 里一条都没找到')

// ── ② classic 份 = 本分支 styles.css（= 设置弹层等新件与新版同步）+ 旧版外壳覆盖 ──
const classicCss =
  '/* 旧版（classic）应用级样式 —— 由 `tools/layout-css-split.ts` 生成，**不要手改本文件**。\n' +
  '   一 = 本分支 `styles.css` 原样（⇒ 设置弹层等新件与新版**同步**，船长令「设置内采用新版的样式」）；\n' +
  '   二 = **旧版外壳覆盖**：合并前 main 的外壳族原文 + `.app-root.is-layout-classic` 限定\n' +
  '        ⇒ 外壳（顶栏/左竖栏/主区）恢复成 main 的样子；\n' +
  '   三 = **撤销新版新增、main 没有的属性**（定位/层级/box-sizing 这类，部分覆盖取消不掉）；\n' +
  '   四 = **三块窗口模块的样式族**（活动栏 / 主控活动窗口 / 事件日志坞，船长令「把窗口模块化」）。\n' +
  '   基准冻结在 `_baseline-main.css`（**不要删**：删了就无法复现旧版外壳）。 */\r\n\r\n' +
  '/* ══════════ 一、本分支 styles.css 原样 ══════════ */\r\n\r\n' +
  current +
  '\r\n\r\n/* ══════════ 二、旧版外壳覆盖（取合并前 main 原文 + 旧版限定）══════════ */\r\n\r\n' +
  shellOverrides.join('\r\n') +
  '\r\n\r\n/* ══════════ 三、撤销新版加上去、而 main 原文没有的属性 ══════════ */\r\n' +
  CLASSIC_RESETS +
  '\r\n\r\n/* ══════════ 四、三块窗口模块（活动栏 / 主控活动窗口 / 事件日志坞）══════════\r\n' +
  '   船长 2026-09-25 令：「不能将各个窗口模块化吗」⇒ 窗口的**观感**随组件走、**位置**随外壳走。\r\n' +
  '   下面这三族整族从当前样式取来（带旧版限定便于阅读）；位置/尺寸由第二节的外壳覆盖接管。 */\r\n\r\n' +
  windowModuleRules.map((r) => `.app-root.is-layout-classic ${r.raw}`).join('\r\n') +
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
  /**
   * **真比对**（2026-09-25 补）：把"刚生成的两份"与磁盘上的**入库产物**逐字节比（先统一行尾）。
   *
   * ⚠ 为什么补这一步：原先 `--check` 只做花括号配平与体积打印，**从不与磁盘产物比**
   * ⇒ 是一道"永远绿"的假闸门。实证：`807637f1`（窗口模块化）改了本生成器却没重新生成产物，
   * 这道闸门照样全绿，而**入库的 classic 产物缺了 §三 撤销属性 + §四 三块窗口模块样式族**（280 行）
   * ——旧版（默认）外壳因此拿不到那批样式。补上比对后，这类"改了生成器忘了跑生成"当场变红。
   */
  const norm = (t: string): string => t.replace(/\r\n/g, '\n')
  let diffCount = 0
  for (const [name, text] of [
    ['styles-modern.css', modernCss],
    ['styles-classic.css', classicCss],
  ] as const) {
    let disk: string
    try {
      disk = readFileSync(join(OUT_DIR, name), 'utf8')
    } catch {
      console.log(`  ❌ ${name} 读不到（入库产物丢了？）`)
      diffCount++
      continue
    }
    if (norm(disk) === norm(text)) console.log(`  ✅ ${name} 与源码一致`)
    else {
      console.log(`  ❌ ${name} 与源码**不一致** —— 请跑「npm run ui:layout-css」重新生成并入库`)
      diffCount++
    }
  }
  console.log(diffCount === 0 ? '\n[check] 未写盘（两份都与源码一致）' : `\n[check] ${diffCount} 份有差异`)
  if (diffCount > 0) process.exitCode = 1
} else {
  mkdirSync(OUT_DIR, { recursive: true })
  const write = (name: string, text: string): void =>
    writeFileSync(join(OUT_DIR, name), text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8')
  write('styles-modern.css', modernCss)
  write('styles-classic.css', classicCss)
  // **写盘后回读自检**：用解析器按"选择器"核对，**别按字符串含空格**（基准里有压缩成一行的规则，
  // 按字符串匹配会误报"没写进去"——本轮吃过这个亏）。
  const backRules = parseRules(readFileSync(join(OUT_DIR, 'styles-classic.css'), 'utf8'))
  const haveSel = new Set(backRules.map((r) => r.sel))
  const missing = SHELL_SELECTORS.filter((sel) => !haveSel.has(`.app-root.is-layout-classic ${sel}`))
  console.log(`\n  ✅ 已写 ui/layout-css/styles-modern.css 与 styles-classic.css`)
  console.log(`  ${missing.length === 0 ? '✅' : '❌'} 回读自检：${SHELL_SELECTORS.length - missing.length} / ${SHELL_SELECTORS.length} 个外壳覆盖已在文件里`)
  if (missing.length > 0) throw new Error('这些外壳覆盖没写进文件：' + missing.join(' | '))
}
void execFileSync
