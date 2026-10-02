/**
 * **文案参数漏喂体检**（2026-09-27 入库；原临时探针 `tools/_param-miss.mts` 转正）。
 *
 * 为什么需要它（**船长 2026-09-27 报障**：「**鱿蜂结构层出现了错误文本：机群结构层 +{p1}**」）：
 * 静态体检 `l10n:check` 只查"id 存不存在、中英占位符对不对齐"，**看不见调用点喂没喂参数** ——
 * 而界面渲染时缺参数是**静默**的：`interpolate()` 找不到键就原样留着 `{p1}`，玩家会直接读到它。
 * 病根形态：一条**整句**文案（`机群结构层 +{p1}`）被当成"行名"用 —— 行名栏只放名字、
 * 数值另起一栏，于是没有第二参数可喂。正确做法是**行名另立一条**（无占位符），整句那条留给单行文案。
 *
 * 判据：`t('id')` / `tr('id')` 的第一参数是字符串字面量，且该 id 的 `zh` 模板含 `{pN}`，
 * 但该调用点没传第二参数、或传了对象却缺那个键 ⇒ 命中。
 *
 * **第二段判据（2026-09-29 加 · 槽内参数）**：core 侧 `addLog(..., textParams)` /
 * `CommandResult(errorParams)` 里若给了 `p{n}Id`（＝「第 n 槽那句话」的 id），
 * 而**那句话自己还带占位符** —— 渲染层是拿 `p{n}p{k}` 去填它的（见 `locale.tsx` 的 `paramsFor`）。
 * 只给 `p{n}Id` 不给 `p{n}p{k}` ⇒ 那一槽的 `{p{k}}` **原样漏给玩家**。
 *
 * 为什么单列这条（**2026-09-29 船长再报障实障**）：船长原话「各种事件里的参数都有问题」那批修完后，
 * 线上日志里**仍然**能读到 `（贸易税 {p1} 信用点）`「超出上限的 {p1} 未结算」——
 * 病根就是这条判据此前没人查：id 有、译有，**只有槽内那一个参数没人喂**。
 * 实证修正见 `core` 的 `market.ts`（`p4p1`）与 `simulation.ts`（`p2p1`）。
 *
 * **第四段判据（2026-10-02 加 · 内联正文 ↔ 表文对账）**：core 的日志调用点既要写**落盘正文**
 * （`text`，中文字面量）又要挂 **id**（`textId`）——而界面**按 id 优先渲染**（`locale.tsx` 的 `composeParts`）。
 * 两者若不是同一句：玩家看到的是表文那句、存档里存的是另一句；更麻烦的是**改这处时极易无声改掉玩家可见文案**
 * （用例钉的是正文、界面信的是 id，两边各说各话）。
 * 判据：`addLog(state, kind, text, id, …)` / `logEvent(state, text, amount, id, …)` 的 `text` 与 `id` 是
 * **同一次调用的两个实参**；把 `text` 模板的**静态片段**逐段在表文里按序查找，有段落找不到 ⇒ 命中。
 * 来历：船长 2026-10-02 报障「事件日志里出现 `{p1}`」修完后顺着全仓扫，扫出「换船日志正文 ≠ id」
 * 与「换星系打捞**挂错了整句 id**（玩家一直看到『找不到当前舰船，打捞作业已停止』）」——
 * 船长令「**修，可以转**」⇒ 五处正文按表文对齐 ＋ 本判据转正。
 * 局限：正文是**变量**、或模板里**嵌套反引号** ⇒ 静态判不出（跳过、不报）。
 *
 * 用法：`npx tsx tools/param-miss-check.ts`（等价 `npm run l10n:params`）· **只读**，不写文件。
 * 退出码：命中 > 0 ⇒ 1（可挂进合入前闸门）；0 ⇒ 0。
 *
 * ⚠ **误报的两种情形**（工具会点名，需人工看一眼）：
 *   ① 参数对象是**变量**（如 `tr('ui.weekend.022', params)`）——静态判不出里面有什么键；
 *   ② 参数由**包装函数**补（如 `bookProgress(...)` 返回的对象）。
 *   这两类一律**照报**（宁可多看一眼），而不是静默放过。
 *   （槽内那条同理：`{ ...params, p4Id: noteId }` 这类**展开**只做保守判断 ——
 *    对象字面量里出现过同名的 `p{n}p{k}` 就算喂了，展开里补的一律当"静态判不出"不报。）
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-10-02**（当日：渲染层 0 处明确漏喂；core 槽内参数 2 处实障已修完毕；
 *     新增第四段判据「内联正文 ↔ 表文对账」并把它扫出的 5 处正文对齐到表文 ⇒ 全段 0 命中）
 *   - 本工具最后跑过：**2026-10-02**
 *   - 判据：`interpolate()`（`apps/desktop/src/renderer/src/i18n/locale.tsx`）的"缺键行为"
 *     若从"原样留 `{pN}`"改成别的（例如留空），必须回来重定判据。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { L10N } from '../packages/data/src/l10n/table'

/** 扫描根：渲染层全量（`t` / `tr` 都在这一侧）；core 另走下面那段"槽内参数"判据 */
const ROOTS = [join(process.cwd(), 'apps', 'desktop', 'src'), join(process.cwd(), 'packages', 'ui', 'src')]

/** core 扫描根（第二段判据：`addLog` 的 textParams / `CommandResult` 的 errorParams） */
const CORE_ROOTS = [join(process.cwd(), 'packages', 'core', 'src'), join(process.cwd(), 'packages', 'data', 'src')]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

interface Finding {
  at: string
  id: string
  missing: string[]
  snippet: string
  /** 参数是变量/函数调用（静态判不出键）⇒ 误报嫌疑，报告里单独分组 */
  opaqueArg: boolean
}

const findings: Finding[] = []

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        (node.expression.text === 'tr' || node.expression.text === 't')
      ) {
        const arg0 = node.arguments[0]
        if (arg0 && ts.isStringLiteral(arg0)) {
          const id = arg0.text
          const entry = L10N[id]
          if (entry !== undefined) {
            const need = [...entry.zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
            if (need.length > 0) {
              const arg1 = node.arguments[1]
              const supplied = new Set<string>()
              let opaqueArg = false
              if (arg1 !== undefined) {
                if (ts.isObjectLiteralExpression(arg1)) {
                  for (const prop of arg1.properties) {
                    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
                      const n = prop.name
                      if (ts.isIdentifier(n) || ts.isStringLiteral(n)) supplied.add(n.text)
                    }
                  }
                } else {
                  opaqueArg = true
                }
              }
              const missing = arg1 === undefined ? need : opaqueArg ? [] : need.filter((k) => !supplied.has(k))
              /** ⚠ `opaqueArg` 也要进报告（它是"静态判不出"的那一类，不是"没问题"） */
              const suspicious = arg1 === undefined || opaqueArg || missing.length > 0
              if (suspicious) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
                findings.push({
                  at: `${relative(process.cwd(), file).split('\\').join('/')}:${line}`,
                  id,
                  missing,
                  snippet: node.getText(sf).replace(/\s+/g, ' ').slice(0, 110),
                  opaqueArg,
                })
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

const hard = findings.filter((f) => !f.opaqueArg)
const soft = findings.filter((f) => f.opaqueArg)

/* ═══════════ 第二段判据：core 侧「槽译文给了 id、槽内参数没喂」 ═══════════ */
interface SlotFinding {
  at: string
  slotId: string
  innerId: string
  missing: string[]
  snippet: string
}
const slotFindings: SlotFinding[] = []

/**
 * **已核实的误报清单**（逐条写理由；命中这里的不算失败，但**照打印**，免得变成"静默豁免"）。
 *
 * 为什么会有误报：本判据只用"槽模板自己的占位符"去量 `p{n}p{k}`，而**段链**把「这一槽」交给
 * 段模板渲染（段模板的 `{p2}` 填的是**下一个段**，或段链允许**故意空槽**）——那类写法天然不该有
 * `p{n}p{k}`。逐条核实过渲染结果，确认玩家看到的句子是完整的（`industry.test.ts` 有键形用例守着）。
 */
const SLOT_KNOWN_OK: Record<string, string> = {
  'packages/core/src/industry.ts|p1Id|core.industry.044':
    '段链写法：`.044` 的 `{p1}` 由 `p1p1` 供，`{p2}` 是**段模板**拿去填「等N种」那一槽的（不是本槽的内部值）',
  'packages/core/src/industry.ts|p2Id|core.industry.048':
    '同一处：未截断时 `p2` 故意传空串（该槽整个空着），`p2p1` 只在截断时才喂 ⇒ 非漏喂',
}

for (const root of CORE_ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    /** 取对象字面量里的键名（含展开语法：`...params` 记成 `<spread>`，判不定 ⇒ 保守不报） */
    const keysOf = (obj: ts.ObjectLiteralExpression): { keys: Set<string>; spread: boolean } => {
      const keys = new Set<string>()
      let spread = false
      for (const prop of obj.properties) {
        if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
          const n = prop.name
          if (ts.isIdentifier(n) || ts.isStringLiteral(n)) keys.add(n.text)
        } else if (ts.isSpreadAssignment(prop)) spread = true
      }
      return { keys, spread }
    }
    const check = (obj: ts.ObjectLiteralExpression): void => {
      const { keys, spread } = keysOf(obj)
      for (const k of keys) {
        /**
         * ⚠ **段链的键不在这条判据里**（`seg{n}…` 专属键空间，2026-09-29 定）：
         * 段内占位符是按 `seg{n}p{k}p{j}` 取的，段模板的槽值允许**故意为空**
         * （例：`industry.ts` 的 `p2` = 空串 ⇒ 「等 N 种」那槽整个空着），
         * 拿基础槽的 `p{n}p{k}` 去量它会**误报**（实测 industry 两条）。
         */
        if (k.startsWith('seg')) continue
        const m = /^(p\d+)Id$/.exec(k)
        if (m === null) continue
        const slot = m[1]!
        const innerId = (() => {
          const prop = obj.properties.find(
            (pr) =>
              (ts.isPropertyAssignment(pr) || ts.isShorthandPropertyAssignment(pr)) &&
              ((ts.isIdentifier(pr.name) && pr.name.text === k) || (ts.isStringLiteral(pr.name) && pr.name.text === k)),
          )
          if (prop === undefined || !ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.initializer)) return undefined
          return prop.initializer.text
        })()
        if (innerId === undefined) continue // id 是变量/三元 ⇒ 静态判不出，不报（soft 类）
        const inner = L10N[innerId]
        if (inner === undefined) continue
        const need = [...inner.zh.matchAll(/\{(\w+)\}/g)].map((mm) => mm[1]!)
        // 渲染层取参 = `${slot}${name}`（`p4` + `p1` ⇒ `p4p1`）
        const missing = need.filter((name) => !keys.has(`${slot}${name}`))
        if (missing.length === 0 || spread) continue // 展开里可能补了 ⇒ 保守不报
        const line = sf.getLineAndCharacterOfPosition(obj.getStart(sf)).line + 1
        const at = `${relative(process.cwd(), file).split('\\').join('/')}:${line}`
        const rel = relative(process.cwd(), file).split('\\').join('/')
        if (SLOT_KNOWN_OK[`${rel}|${k}|${innerId}`] !== undefined) continue
        slotFindings.push({
          at,
          slotId: k,
          innerId,
          missing: missing.map((name) => `${slot}${name}`),
          snippet: obj.getText(sf).replace(/\s+/g, ' ').slice(0, 110),
        })
      }
    }
    /**
     * ⚠ **为什么扫"所有对象字面量"而不是只扫 `addLog` 的参数位**（2026-09-29 踩坑）：
     * 槽译文常常写在**三元/展开**里（`...(overflowMs > 0 ? { p2Id, p2p1 } : {})`），
     * 那种对象**不是**调用的直接实参 ⇒ 只在实参位找会**整条漏掉**（实测：加了判据仍报 0 处）。
     * 改成"凡对象字面量里有 `p{n}Id` 就查"最直白，也正好只命中真写文案的那些对象。
     */
    const visitCore = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) check(node)
      ts.forEachChild(node, visitCore)
    }
    visitCore(sf)
  }
}

/* ═══════════ 第三段判据（2026-10-01 加 · 船长报障「通讯主题显示成 {p1} ×{p2}」）═══════════
 *
 * **病根**：一条**带参数的模板**被"**不会喂参数**的渲染点"用掉了 —— `interpolate()` 找不到键就
 * **原样保留** `{pN}`，玩家直接读到占位符（静默失败）。上面的两段判据都看不见它：
 * ① 第一段只扫 `t('字面量')`，而"映射表的值"（`tr(l10nId)`）不是字面量；
 * ② 第二段只管 core 的"槽内参数"。
 *
 * 实测两处（都已修，本判据即它们的回归钉）：
 * - `commsText.ts` 的 `COMMS_SUBJECT_ID['msg-blackbox-plug-unlock'] = 'ui.comms.072'`，
 *   而 `ui.comms.072` 是奖励清单的模板（`{p1} ×{p2}`，由 `commsRewardText` 喂参）⇒ 主题行漏出占位符；
 * - `plugs.ts` 的 `addLog(..., 'core.plug.001', { p1 })`，而该模板要 `p1/p2` ⇒ 日志漏出 `{p2}`。
 *
 * **A 判据（映射表）**：`const X: Record<string, string> = { '键': 'id' }` 的表，其值若命中
 * 一条 `zh` 带 `{pN}` 的条目 ⇒ **红**（表的值多半在无参渲染点被 `tr(值)` 用掉）。
 * **B 判据（core 日志调用）**：`addLog` / `logEvent` 的 id 是**字符串字面量**、且参数对象是**对象字面量**
 * 时，若表里要的某个 `pN` 在该对象里**既没键、也不是靠展开补的** ⇒ **红**。
 * ⚠ 参数是变量 / 含展开语法的写法**一律不报**（那些位置静态判不出，见本文件开头对误报的两条口径）。
 */
interface ThirdFinding {
  at: string
  what: string
  detail: string
}
const thirdFindings: ThirdFinding[] = []

/** A：映射表的值指向"带参数的模板" */
const MAP_TABLE_ROOTS = [join(process.cwd(), 'apps', 'desktop', 'src'), join(process.cwd(), 'packages', 'ui', 'src')]
for (const root of MAP_TABLE_ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        ts.isObjectLiteralExpression(node.initializer) &&
        /Record<\s*string\s*,\s*string\s*>/.test(node.type?.getText(sf) ?? '')
      ) {
        for (const prop of node.initializer.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.initializer)) continue
          const entry = L10N[prop.initializer.text]
          if (entry === undefined) continue
          const need = [...entry.zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
          if (need.length === 0) continue
          const line = sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1
          thirdFindings.push({
            at: `${relative(process.cwd(), file).split('\\').join('/')}:${line}`,
            what: `${node.name.getText(sf)} → ${prop.initializer.text}`,
            detail: `目标模板带 ${need.join('/')}（zh「${entry.zh}」）—— 映射表是**无参**用法`,
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

/** B：core 侧 `addLog` / `logEvent` 的 id 与参数对账（只认"能静态判死"的那一种） */
const LOG_CALL_ARGS: Record<string, { idArg: number; paramsArg: number }> = {
  addLog: { idArg: 3, paramsArg: 4 },
  logEvent: { idArg: 3, paramsArg: 4 },
}
for (const root of CORE_ROOTS) {
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const spec = LOG_CALL_ARGS[node.expression.text]
        const idNode = spec !== undefined ? node.arguments[spec.idArg] : undefined
        if (spec !== undefined && idNode !== undefined && ts.isStringLiteral(idNode)) {
          const entry = L10N[idNode.text]
          const need = entry === undefined ? [] : [...entry.zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
          const params = node.arguments[spec.paramsArg]
          const isObject = params !== undefined && ts.isObjectLiteralExpression(params)
          if (need.length > 0 && isObject) {
            const keys = new Set<string>()
            let spread = false
            for (const prop of (params as ts.ObjectLiteralExpression).properties) {
              if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) keys.add(prop.name.getText(sf))
              else if (ts.isSpreadAssignment(prop)) spread = true
            }
            /**
             * `logEvent` 的 id 不是基础模板，而是**正文槽译文**——函数内部把它挂成 `p1Id`
             * （见 `events.ts` 的 `logEvent`），所以它的占位符 `{p{k}}` 由**槽内参数** `p1p{k}`
             * 供给，而非顶层 `p{k}`。`addLog` 才是基础模板 ⇒ 仍对顶层 `p{k}`。
             */
            const isLogEvent = node.expression.text === 'logEvent'
            const missing = need.filter((k) => !keys.has(isLogEvent ? `p1${k}` : k))
            if (!spread && missing.length > 0) {
              const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
              thirdFindings.push({
                at: `${relative(process.cwd(), file).split('\\').join('/')}:${line}`,
                what: `${node.expression.text}(${idNode.text}) 要 ${need.join('/')}`,
                detail: `**缺 ${missing.join('/')}**（参数对象里只有 [${[...keys].join(' ')}]，且无展开兜底）`,
              })
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

if (thirdFindings.length > 0) {
  console.log(`\n■ 模板被"无参/漏参"使用（${thirdFindings.length} 处）——玩家会直接读到 {pN}，**必须改**：`)
  for (const f of thirdFindings) {
    console.log(`  ${f.at}  ${f.what}`)
    console.log(`      ${f.detail}`)
  }
} else {
  console.log('✅ 模板用法 0 处漏参（映射表的值必须是无参句；core 日志的 id 与参数对得上）。')
}

/* ═══════════ 第四段判据：内联正文 ↔ 它挂的 id 表文对账（2026-10-02 加 · 船长令「可以转」） ═══════════ */
interface TextIdFinding {
  at: string
  id: string
  zh: string
  inline: string
  missing: string[]
}
const textIdFindings: TextIdFinding[] = []
/** 日志函数的实参位（0 基）：`addLog(state, kind, text, id, params)` · `logEvent(state, text, amount, id, params)` */
const TEXT_ID_ARGS: Record<string, { textArg: number; idArg: number }> = {
  addLog: { textArg: 2, idArg: 3 },
  logEvent: { textArg: 1, idArg: 3 },
}
let textIdPairs = 0
for (const root of CORE_ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const spec = TEXT_ID_ARGS[node.expression.text]
        const idNode = spec !== undefined ? node.arguments[spec.idArg] : undefined
        const textNode = spec !== undefined ? node.arguments[spec.textArg] : undefined
        if (spec !== undefined && idNode !== undefined && ts.isStringLiteral(idNode) && textNode !== undefined) {
          const zh = L10N[idNode.text]?.zh
          if (typeof zh === 'string') {
            /** 取模板的**静态片段**（`${…}` 之间那几段）；嵌套模板里的表达式各自成节点 ⇒ 不会串味 */
            const segs: string[] = []
            if (ts.isNoSubstitutionTemplateLiteral(textNode)) segs.push(textNode.text)
            else if (ts.isTemplateExpression(textNode)) {
              segs.push(textNode.head.text)
              for (const span of textNode.templateSpans) segs.push(span.literal.text)
            }
            const stat = segs.map((s) => s.trim()).filter((s) => s.length >= 4)
            if (stat.length > 0) {
              textIdPairs++
              let cursor = 0
              const missing: string[] = []
              for (const s of stat) {
                const k = zh.indexOf(s, cursor)
                if (k < 0) missing.push(s)
                else cursor = k + s.length
              }
              if (missing.length > 0) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
                textIdFindings.push({
                  at: `${relative(process.cwd(), file).split('\\').join('/')}:${line}`,
                  id: idNode.text,
                  zh,
                  inline: textNode.getText(sf).replace(/\s+/g, ' ').slice(0, 120),
                  missing,
                })
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

if (textIdFindings.length > 0) {
  console.log(
    `\n■ 内联**正文**与 id **表文**对不上（${textIdFindings.length} 处）——界面按 id 渲染 ⇒ 玩家看到的是表文那句、` +
      `存档正文却是另一句（改这处时极易无声改掉玩家可见文案）：`,
  )
  for (const f of textIdFindings) {
    console.log(`  ${f.at}  ${f.id}`)
    console.log(`      表文（玩家看到的）：${f.zh}`)
    console.log(`      正文（落盘）：${f.inline}`)
    console.log(`      对不上的片段：${f.missing.map((m) => JSON.stringify(m)).join(' / ')}`)
  }
} else {
  console.log(`✅ core 日志的内联正文与 id 表文逐段一致（${textIdPairs} 处配对）。`)
}

process.exitCode = hard.length === 0 && slotFindings.length === 0 && thirdFindings.length === 0 && textIdFindings.length === 0 ? 0 : 1
if (hard.length > 0) {
  console.log('\n■ 明确漏喂（没传第二参数，或对象里缺键）——**必须改**：')
  for (const f of hard) {
    console.log(`  ${f.at}  ${f.id}  缺 ${f.missing.join('/')}`)
    console.log(`      ${f.snippet}`)
  }
}
if (soft.length > 0) {
  console.log('\n□ 误报嫌疑（参数由变量/函数提供，需人工看一眼）：')
  for (const f of soft) {
    console.log(`  ${f.at}  ${f.id}  该模板需要 ${([...((L10N[f.id]?.zh ?? '').matchAll(/\{(\w+)\}/g))].map((m) => m[1]).join('/'))}`)
    console.log(`      ${f.snippet}`)
  }
}
if (findings.length === 0) console.log('\n✅ 没有发现漏喂的参数。')
else if (hard.length === 0) console.log('\n✅ 明确漏喂 0 处（上面那些请人工确认）。')

if (slotFindings.length > 0) {
  console.log(`\n■ core **槽内参数**漏喂（${slotFindings.length} 处）——槽译文给了 id，但槽模板自己的占位符没人喂：`)
  for (const f of slotFindings) {
    console.log(`  ${f.at}  ${f.slotId} → ${f.innerId}  缺 ${f.missing.join('/')}`)
    console.log(`      ${f.snippet}`)
  }
} else {
  console.log(
    `✅ core 槽内参数 0 处漏喂（\`p{n}Id\` 的槽模板占位符都有 \`p{n}p{k}\`；` +
      `另有 **${Object.keys(SLOT_KNOWN_OK).length}** 处已核实误报，清单见 \`SLOT_KNOWN_OK\`）。`,
  )
}

process.exitCode =
  hard.length === 0 && slotFindings.length === 0 && thirdFindings.length === 0 && textIdFindings.length === 0 ? 0 : 1
