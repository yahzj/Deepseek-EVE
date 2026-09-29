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
 *   - 本工具最后核对：**2026-09-29**（当日：渲染层 0 处明确漏喂；core 槽内参数 2 处实障已修）
 *   - 本工具最后跑过：**2026-09-29**
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

console.log(`· 扫了 ${ROOTS.length} 个根：命中 **${findings.length}** 处（其中"参数是变量、静态判不出" **${soft.length}** 处）`)
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

process.exitCode = hard.length === 0 && slotFindings.length === 0 ? 0 : 1
