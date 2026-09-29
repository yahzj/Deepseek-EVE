/**
 * **架构契约体检 · 取数与派生**（`npm run arch:guard` · 2026-09-27 建 · 三号 verify）
 *
 * 起因（船长原话照抄）：「**现在的开发流程挺混乱的，各种代码都是地方单独调用，我们能否商量下，进行开发流程规范？**」
 * 参照物 = `pattern-enforcement`（jagreehal/jagreehal-claude-skills）的核心口径
 * **「Documentation is a ritual. Rules are enforcement.」**——没有能让构建失败的规则，模式就只是建议。
 * 本工具照抄它的**思路**（封跨层直读 ＋ 分层方向），但用**本仓风格**实现：纯读源码文本、零新依赖、报红 exit 1
 * （与 `ui:attr-check` / `ui:subs-check` / `content:check` 同构）。**本仓不依赖 ESLint，不引入 ESLint。**
 *
 * ⚠ **与既有护栏的分工（防两套口径打架）**：`ui-subs-check.ts` 的 Check 2「本地化直读契约」已经管了
 * **"中文标签表/函数"**（`RACK_LABELS` / `SLOT_LABELS` / `shipRoleLabel` …，理由＝英文界面会漏中文）。
 * ⇒ 本工具**只管"游戏数据表"**（`SHIPS` / `ITEMS` / `MODULES` / `BLUEPRINTS` / `SKILLS` / `BELTS` …），
 * **不重复管标签类符号**；标签类请回看 `ui-subs-check`。
 *
 * 四项检查：
 *   F1 **分层边界**：渲染层不许直接读"游戏数据表"，只许清单里的文件读（`ALLOW_TABLE_READERS`，逐条写理由）。
 *      数据层本该只有一个产地 = 渲染层的 `game/engine.ts`（它建 `ctx`）；其余页面/面板要什么字段，
 *      应当**从 `ctx` 取**（必要时提出取数需求，由单点提供）。
 *   F2 **单点覆盖**：渲染层本地定义的函数名，撞上 `SINGLE_SOURCE`（`docs/single-source.md` 的机器可读副本）
 *      里已登记的单点导出名 ⇒ 报红（＝"同一件事又写了一份"）。
 *      ⚠ **已知局限（如实登记，不装成能全查）**：**"异名同义"的重复机器判不出来**
 *      （实测：26 个局部 helper 名撞 1565 个导出名，命中 0）——那部分进
 *      `docs/review/arch-guard-baseline-<日期>.md` 交船长裁，本工具不假装全知。
 *   F3 **索引自检**：索引里写的"落点文件"必须真实存在、`SINGLE_SOURCE` 里的"单点导出"必须在源码里真的导出
 *      ⇒ 悬空即红（防索引变成废纸）。
 *   F4 **取数口契约**：一级页/面板不许自己 new 引擎旁路取数（`buildSimContext(...)`）——那是 `engine.ts` 的活。
 *   F5 **跳转目标契约**：活动栏跳转表指向的页/页签必须真实存在。
 *   F6 **日期格式化本地化**（**2026-09-29 加**）：渲染层不许写死 `toLocaleDateString('zh-CN')` 这类
 *      **把语言焊死**的调用 —— 英文界面下它的输出顺序仍是中文的。走 `i18n/fmt.ts` 的
 *      `fmtDate` / `fmtDateTime`（内部取 `localeTag()`）。
 *      ⚠ **只管日期/时间**：`toLocaleString('zh-CN')` 用于**数字千分位**时在 zh/en 下逐位同值
 *      （`i18n/fmt.ts` 头注已写明）⇒ 那 ~180 处不在本检查范围内（避免大批无收益改动）。
 *
 * 用法：`npm run arch:guard`（或 `npx tsx tools/arch-guard.ts`，加 `--list` 打印全部读数）。
 * **反例实测**（每条判据都要证明它真能报红，见头注末的「自检记录」）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）
 *   - 本工具最后核对：**2026-09-29**（当日读数：F1 越层 0 处 · F2 重复 0 处 · F3 悬空 0 处 · F4 旁路 0 处
 *     · F5 跳转 0 处 · **F6 日期本地化 0 处**（F6 同日新增））
 *   - 判据：新增"游戏数据表"时**同步登记进 `DATA_TABLES`**，否则它照样能被页面直读而无人拦；
 *     新增单点时**同步登记进 `SINGLE_SOURCE` 与 `docs/single-source.md`**（两处一起，F3 会核对）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
// F5 用：直接跑真实的跳转表（纯函数、只依赖 MapTab 类型）⇒ 契约与实现同源，不抄一份
import { goFor } from '../apps/desktop/src/renderer/src/ui/activityGo'

const ROOT = process.cwd()
const RENDERER = join(ROOT, 'apps', 'desktop', 'src', 'renderer', 'src')
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', '.git'])
const LIST = process.argv.includes('--list')

/** 允许直接读「游戏数据表」的文件（逐条写理由；其余渲染层文件一律不许） */
const ALLOW_TABLE_READERS: Record<string, string> = {
  'game/engine.ts':
    '渲染层的数据产地——它读 data 表建 `ctx`（`buildSimContext`）；页面要字段应当从 ctx 取，不许自己再读表',
  'i18n/locale.tsx': '本地化单点自身（读 `L10N` 文案表，英文界面全靠它）',
  // 下面四条是 2026-09-27 首轮体检的存量登记（**只登记不红**）：都有"读它是对的"的理由，
  // 但其中前两条含玩家可见文案 ⇒ 已记进 `docs/review/arch-guard-baseline-20260927.md` 备船长裁。
  'panels/Handbook.tsx':
    '物资图鉴的卡片构造单点：读 `FACTION_CODEX`（势力档案原始表）与 `FOE_SHIPS`（敌舰原始表）来建卡片；' +
    '⚠ 这两张表是**原始中文表**，英文界面下是否漏中文待核（已登记进清单，本批不改）',
  'panels/Wormhole.tsx': '`WORMHOLE_FAMILY_CARDS` 只用来做**族 → 卡 id 的反查**（`Object.keys/values` 匹配 id），不显示文本',
  'ui/wreckFlavor.tsx': '`FRAGMENT_RECIPES` 只按 `tier` 取配方行喂回收读数（id 与数值），不显示文本；逻辑在 core 单点',
  'ui/labelsText.ts':
    '**族徽判据单点**（2026-09-27 从 `panels/Handbook.tsx` 迁入）：读 `FACTION_CODEX` 只为两件事——' +
    '① `factionOfExclusive(id)` 反查某件内容属于哪一族；② 族字母 → 势力**全称文案 id**（`nameId`）。' +
    '两条都**不显示原始中文文本**（全称经 `tr(nameId)` 按当前语言取词），且必须与图鉴同一把尺 ⇒ 只能读表',
}

/**
 * 「游戏数据表」符号（大写导出）：渲染层只许 `ALLOW_TABLE_READERS` 里的文件读。
 * ⚠ 只收**游戏数据**；**标签/枚举/常量不算**（标签类由 `ui-subs-check` 的本地化直读契约管）。
 */
const DATA_TABLES: readonly string[] = [
  // data 侧内容表
  'SHIPS', 'MODULES', 'ITEMS', 'BLUEPRINTS', 'SHIP_BLUEPRINTS', 'SKILLS', 'BELTS', 'GALAXIES',
  'GALAXY_EDGES', 'DIALOGUES', 'ANOMALIES_FLAVORED', 'SKILL_GROUPS', 'FOE_SHIPS',
  'FACTION_CODEX', 'FRAGMENT_RECIPES', 'WORMHOLE_FAMILY_CARDS',
  // 本地化覆盖表（英文界面靠它；页面直读会绕过当前语言）
  'EN_SHIPS', 'EN_MODULES', 'EN_ITEMS_ALL', 'EN_SKILLS', 'EN_ANOMALIES', 'EN_BLUEPRINTS',
  'EN_SHIP_BLUEPRINTS', 'EN_FOE_SHIPS', 'EN_GALAXIES', 'EN_BELTS', 'EN_STATIONS', 'EN_COMMS_FACTIONS',
]

/**
 * 单点注册表（机器可读副本；人读版 = `docs/single-source.md`，两处必须同时登记，F3 会核对）。
 * `exported: false` = 该单点是**模块内私有实现**（如 `crestFamOf`）——F3 只校验"声明在不在"，
 * 其余文件出现同名定义照样按 F2 报红。
 */
const SINGLE_SOURCE: readonly { concept: string; symbol: string; file: string; exported: boolean }[] = [
  { concept: '仿真上下文（页面取数的唯一入口）', symbol: 'buildSimContext', file: 'packages/data/src/context.ts', exported: true },
  { concept: '渲染层引擎（ctx 的产地，页面取数都从它来）', symbol: 'GameEngine', file: 'apps/desktop/src/renderer/src/game/engine.ts', exported: true },
  { concept: '玩家可见文案唯一表（id → 各语言）', symbol: 'L10N', file: 'packages/data/src/l10n/table.ts', exported: true },
  { concept: '标签取词单点（槽类/槽位/舰级/地点/机型…）', symbol: 'kindText', file: 'apps/desktop/src/renderer/src/ui/labelsText.ts', exported: true },
  { concept: '族徽判据收窄（判"有没有族"只走它）＋族徽可读名', symbol: 'crestFamOf', file: 'apps/desktop/src/renderer/src/ui/labelsText.ts', exported: true },
  { concept: '取色跨表兜底（TONES → ICO_TONES → NAV_TONES）', symbol: 'toneOfAny', file: 'apps/desktop/src/renderer/src/ui/tones.ts', exported: true },
  { concept: '图鉴卡片构造（模块/舰船/物品/蓝图同源）', symbol: 'itemCellOf', file: 'apps/desktop/src/renderer/src/panels/Handbook.tsx', exported: false },
  { concept: '悬停提示接管层（全站唯一延迟与优先级）', symbol: 'TIP_DELAY_MS', file: 'apps/desktop/src/renderer/src/ui/Tooltip.tsx', exported: true },
  { concept: '视口懒挂载（大列表流式加载）', symbol: 'LazyMount', file: 'apps/desktop/src/renderer/src/ui/LazyMount.tsx', exported: true },
  { concept: '势力族色（星图族标签 / 战场敌舰 / 图鉴族徽同源）', symbol: 'FOE_ACCENT', file: 'apps/desktop/src/renderer/src/ui/tones.ts', exported: true },
  { concept: '物品稀有度分档', symbol: 'itemRarityTierOf', file: 'packages/data/src/rarityTier.ts', exported: true },
  { concept: '装备归属档（高/中/低/舰船插件）', symbol: 'rackDimKeyOf', file: 'apps/desktop/src/renderer/src/ui/itemSubs.ts', exported: true },
  { concept: '技能取消级联基线（只报"因本次取消才失效"的项）', symbol: 'preexistingUnmet', file: 'packages/core/src/engine.ts', exported: false },
  { concept: '存档清洗白名单（新增随档字段必须两处落笔）', symbol: 'normalizeState', file: 'packages/core/src/save.ts', exported: false },
  { concept: '活动栏「停止/取消」按钮文案（两套外壳共用）', symbol: 'stopLabel', file: 'apps/desktop/src/renderer/src/panels/activityStopLabel.ts', exported: true },
  { concept: '活动栏行「点击去哪」的跳转表（两套外壳共用）', symbol: 'goFor', file: 'apps/desktop/src/renderer/src/ui/activityGo.ts', exported: true },
]

/** F4：渲染层一级页/面板不许自己建仿真上下文（那是 `engine.ts` 的活） */
const CONTEXT_BUILDERS: readonly string[] = ['buildSimContext']

type Hit = { check: string; file: string; line: number; detail: string; fix: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 去掉注释（块注释 + 行注释），避免"注释里提到符号名"被误判（口径同 ui-subs-check） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
}

/** 本文件从 @whale/core|data **具名导入**的符号（`import type` 只取类型的场合另判） */
function importsFromCoreData(src: string): { symbol: string; line: number; typeOnly: boolean }[] {
  const out: { symbol: string; line: number; typeOnly: boolean }[] = []
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]@whale\/(?:core|data)['"]/g
  for (const m of src.matchAll(re)) {
    const typeOnly = m[1] !== undefined
    const line = src.slice(0, m.index ?? 0).split('\n').length
    for (const raw of m[2].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0]?.trim()
      if (name) out.push({ symbol: name, line, typeOnly })
    }
  }
  return out
}

/** 模块作用域声明（`export` 可为无）：`const NAME` / `function NAME` */
function localDeclarations(src: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  const re = /^[ \t]*(?:export\s+)?(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm
  for (const m of src.matchAll(re)) {
    out.push({ name: m[1], line: src.slice(0, m.index ?? 0).split('\n').length })
  }
  return out
}

const hits: Hit[] = []
const rendererFiles = walk(RENDERER)
const relOf = (p: string): string => relative(RENDERER, p).replace(/\\/g, '/')

/* ═══════════ F1 · 分层边界：渲染层不许直读游戏数据表 ═══════════ */
for (const file of rendererFiles) {
  const rel = relOf(file)
  if (ALLOW_TABLE_READERS[rel] !== undefined) continue
  const src = readFileSync(file, 'utf8')
  for (const imp of importsFromCoreData(src)) {
    if (imp.typeOnly) continue // `import type` 不读值，放行
    if (!DATA_TABLES.includes(imp.symbol)) continue
    hits.push({
      check: 'F1',
      file: rel,
      line: imp.line,
      detail: `直读游戏数据表 \`${imp.symbol}\``,
      fix: `改从 ctx 取（页面拿到的 \`ctx\` 已按当前语言覆盖）；缺字段就提取数需求给单点，别在页面里读表`,
    })
  }
}

/* ═══════════ F2 · 单点覆盖：已有单点的事，别处又写一份（同名判据） ═══════════ */
const registered = new Map(SINGLE_SOURCE.map((s) => [s.symbol, s]))
for (const file of rendererFiles) {
  const rel = relOf(file)
  const src = stripComments(readFileSync(file, 'utf8'))
  for (const decl of localDeclarations(src)) {
    const reg = registered.get(decl.name)
    if (reg === undefined) continue
    if (reg.file.endsWith(rel)) continue // 单点自己的实现
    hits.push({
      check: 'F2',
      file: rel,
      line: decl.line,
      detail: `本地又定义了一份 \`${decl.name}\`（单点 = ${reg.file}）`,
      fix: `删掉本地实现，改从单点导入：${reg.concept}`,
    })
  }
}

/* ═══════════ F3 · 索引自检：索引写的落点必须真实存在 ═══════════ */
const allSources = new Map<string, string>() // 路径 → 源码（懒加载）
const sourceOf = (p: string): string => {
  const cached = allSources.get(p)
  if (cached !== undefined) return cached
  const abs = join(ROOT, p)
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  allSources.set(p, text)
  return text
}
for (const s of SINGLE_SOURCE) {
  if (!existsSync(join(ROOT, s.file))) {
    hits.push({
      check: 'F3',
      file: s.file,
      line: 1,
      detail: `单点索引指向的文件不存在（关注点：${s.concept}）`,
      fix: '修正 `SINGLE_SOURCE` 与 `docs/single-source.md` 里的落点路径',
    })
    continue
  }
  const src = sourceOf(s.file)
  const declared = s.exported
    ? new RegExp(`export\\s+(?:const|function|class|interface|type|enum)\\s+${s.symbol}\\b`).test(src)
    : new RegExp(`(?:^|\\n)[ \\t]*(?:export\\s+)?(?:const|function|class)\\s+${s.symbol}\\b`).test(src)
  if (!declared) {
    hits.push({
      check: 'F3',
      file: s.file,
      line: 1,
      detail: `单点索引里的 \`${s.symbol}\` 在 ${s.file} 里找不到${s.exported ? '导出' : '声明'}（关注点：${s.concept}）`,
      fix: '改名/搬家后必须同步索引（两处一起改：本文件 + docs/single-source.md）',
    })
  }
}

/* ═══════════ F4 · 取数口契约：页面/面板不许自己建仿真上下文 ═══════════ */
for (const file of rendererFiles) {
  const rel = relOf(file)
  if (rel === 'game/engine.ts') continue
  if (!/^(pages|panels)\//.test(rel)) continue
  const src = stripComments(readFileSync(file, 'utf8'))
  src.split('\n').forEach((line, i) => {
    for (const fn of CONTEXT_BUILDERS) {
      if (new RegExp(`\\b${fn}\\s*\\(`).test(line)) {
        hits.push({
          check: 'F4',
          file: rel,
          line: i + 1,
          detail: `页面旁路取数：自己调 \`${fn}()\``,
          fix: '取数走引擎给的那一份 ctx，不要在页面里重建上下文',
        })
      }
    }
  })
}

/* ═══════════ F5 · 跳转目标契约：活动栏「点击去哪」必须落在真实存在的页/页签上 ═══════════
 * 起因（船长 2026-09-27 报障）：「**送快递时，点击活动栏玩家的活动，跳转到空页面**」——
 * 跳转表里还写着 `mapTab: 'task'`，而「任务中心」2026-09-14 已从星图页搬成独立一级页
 * ⇒ `setMapTab('task')` 之后星图页六个页签的条件渲染全落空 = 空白页。
 * 本检查把"跳转目标"变成契约：**页签必须是 `MAP_TABS` 里真实存在的键** ＋ **目的地名 id 必须在唯一表里**。
 */
{
  const mapTabsSrc = sourceOf('apps/desktop/src/renderer/src/pages/MapPage.tsx')
  const realTabs = new Set([...mapTabsSrc.matchAll(/\{\s*key:\s*'([a-z]+)'/g)].map((m) => m[1]))
  const l10nSrc = sourceOf('packages/data/src/l10n/table.ts')
  const kinds = [
    'mining', 'scan', 'salvage', 'expedition', 'return', 'transit', 'standby', 'wormhole',
    'courier', 'hauling', 'loop', 'manufacture', 'refine', 'train',
  ]
  if (realTabs.size === 0) {
    hits.push({
      check: 'F5',
      file: 'apps/desktop/src/renderer/src/pages/MapPage.tsx',
      line: 1,
      detail: '读不出 `MAP_TABS` 的页签键（判据失效）',
      fix: 'MAP_TABS 的写法变了 ⇒ 同步更新 arch-guard 的 F5 判据（必须继续读真实的 key 字面量）',
    })
  }
  for (const k of kinds) {
    const t = goFor(k)
    if (t.mapTab !== undefined && realTabs.size > 0 && !realTabs.has(t.mapTab)) {
      hits.push({
        check: 'F5',
        file: 'apps/desktop/src/renderer/src/ui/activityGo.ts',
        line: 1,
        detail: `活动 \`${k}\` 跳的星图页签 \`${t.mapTab}\` 在 MAP_TABS 里不存在（会落到空白页）`,
        fix: `改跳真实页签（现有：${[...realTabs].join(' / ')}），或改跳它真正所属的一级页`,
      })
    }
    if (!l10nSrc.includes(`"${t.labelId}"`)) {
      hits.push({
        check: 'F5',
        file: 'apps/desktop/src/renderer/src/ui/activityGo.ts',
        line: 1,
        detail: `活动 \`${k}\` 的目的地名 id \`${t.labelId}\` 不在 l10n 唯一表里`,
        fix: '在 packages/data/src/l10n/table.ts 补这条 id（zh + en），或改用已有的 id',
      })
    }
  }
}

/* ═══════════ F6 · 日期格式化本地化：渲染层不许把语言焊死 ═══════════
 * 起因（**2026-09-29 船长令**：英文界面残留中文清理 · 甲案）：`toLocaleDateString('zh-CN')` 这类写法
 * 在英文界面下照样按中文顺序出日期。走 `i18n/fmt.ts` 的 `fmtDate` / `fmtDateTime` 即可。
 * ⚠ 只管**日期/时间**：`toLocaleString('zh-CN')` 用于数字千分位时 zh/en 逐位同值 ⇒ 不报。
 */
{
  const DATE_LOCALE = /toLocale(Date|Time)String\s*\(\s*['"]zh-CN['"]/g
  for (const file of rendererFiles) {
    const rel = relOf(file)
    if (rel === 'i18n/fmt.ts') continue // 本地化封装自家（它有 localeTag() 那条）
    const src = stripComments(readFileSync(file, 'utf8'))
    src.split('\n').forEach((line, i) => {
      if (!DATE_LOCALE.test(line)) return
      DATE_LOCALE.lastIndex = 0
      hits.push({
        check: 'F6',
        file: rel,
        line: i + 1,
        detail: '把语言焊死的日期格式化（`toLocaleDateString(\'zh-CN\')`）',
        fix: '改走 `i18n/fmt.ts` 的 `fmtDate` / `fmtDateTime`（内部取 `localeTag()`）',
      })
    })
  }
}

/* ═══════════ 输出 ═══════════ */
const byCheck = new Map<string, Hit[]>()
for (const h of hits) {
  const arr = byCheck.get(h.check) ?? []
  arr.push(h)
  byCheck.set(h.check, arr)
}

console.log(
  `架构契约体检：渲染层扫了 ${rendererFiles.length} 个文件 · 游戏数据表 ${DATA_TABLES.length} 个 · ` +
    `单点登记 ${SINGLE_SOURCE.length} 条`,
)
if (LIST) {
  console.log('  允许直读数据表的文件：' + Object.keys(ALLOW_TABLE_READERS).join(' · '))
  console.log('  单点清单：' + SINGLE_SOURCE.map((s) => s.symbol).join(' · '))
}

const LABEL: Record<string, string> = {
  F1: 'F1 分层边界（页面直读数据表）',
  F2: 'F2 单点覆盖（同一件事又写一份）',
  F3: 'F3 索引自检（索引与代码不一致）',
  F4: 'F4 取数口契约（页面旁路建上下文）',
  F5: 'F5 跳转目标契约（活动栏点击落在不存在的页/页签）',
  F6: 'F6 日期格式化本地化（把语言焊死）',
}
for (const key of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']) {
  const list = byCheck.get(key) ?? []
  if (list.length === 0) {
    console.log(`✅ ${LABEL[key]}：0 处`)
    continue
  }
  console.log(`❌ ${LABEL[key]}：${list.length} 处`)
  for (const h of list) {
    console.log(`  · ${h.file}:${h.line}  ${h.detail}`)
    console.log(`      修法：${h.fix}`)
  }
}

if (hits.length > 0) {
  console.log(`\n共 ${hits.length} 处。规范见 docs/development-conventions.md「取数与派生纪律」；单点索引见 docs/single-source.md。`)
}
process.exit(hits.length === 0 ? 0 : 1)
