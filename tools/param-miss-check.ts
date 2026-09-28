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
 * 用法：`npx tsx tools/param-miss-check.ts`（等价 `npm run l10n:params`）· **只读**，不写文件。
 * 退出码：命中 > 0 ⇒ 1（可挂进合入前闸门）；0 ⇒ 0。
 *
 * ⚠ **误报的两种情形**（工具会点名，需人工看一眼）：
 *   ① 参数对象是**变量**（如 `tr('ui.weekend.022', params)`）——静态判不出里面有什么键；
 *   ② 参数由**包装函数**补（如 `bookProgress(...)` 返回的对象）。
 *   这两类一律**照报**（宁可多看一眼），而不是静默放过。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v31**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-27**（当日核对：全仓 4 处命中，逐条看过——3 处是上面那两种误报，
 *     1 处是船长报障的真错，已修）
 *   - 本工具最后跑过：**2026-09-27**
 *   - 判据：`interpolate()`（`apps/desktop/src/renderer/src/i18n/locale.tsx`）的"缺键行为"
 *     若从"原样留 `{pN}`"改成别的（例如留空），必须回来重定判据。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { L10N } from '../packages/data/src/l10n/table'

/** 扫描根：渲染层全量（`t` / `tr` 都在这一侧）；core 走 `textParams` 的另一套判据 */
const ROOTS = [join(process.cwd(), 'apps', 'desktop', 'src'), join(process.cwd(), 'packages', 'ui', 'src')]

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

process.exitCode = hard.length === 0 ? 0 : 1
