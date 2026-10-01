/**
 * 一次性探针：**带参数模板被"无参/漏参"使用**的全仓普查（2026-10-01 · 三号）
 *
 * 起因（船长两次报障）：
 *  ① 「第一封黑匣通讯的主题显示成 `{p1} ×{p2}`」——根因：`COMMS_SUBJECT_ID`（**无参**主题映射表）
 *     里挂了一个**带参数的模板 id**（`ui.comms.072` 是奖励清单的 `{p1} ×{p2}`）⇒ `tr(id)` 不喂参 ⇒ 漏出。
 *  ② 「部分随机事件里依旧看到这个」——同上形态，需在 core 的日志路径里普查。
 *
 * 三条判据（全静态、只读）：
 *  A. **映射表判据**：源码里形如 `const X: Record<string, string> = { 'k': 'id' }` 的表，
 *     其值若是**带 `{pN}` 的模板 id** ⇒ 红（表的值多半在无参渲染点被 `tr(值)` 用掉）。
 *  B. **日志判据**：core/data 里所有"写文案"的调用（`addLog` / `logEvent` / `log` 家族），
 *     第 3 参是**字符串字面量 id** 或第 4 参是 id 字面量时，取表里那条 `zh` 的占位符，
 *     与该调用**同时给出的参数对象**（含 spread ⇒ 记"判不出"）对账。
 *  C. **通讯正文/主题联查**：`COMMS_BODY_EN` 的键（msg id）必须在数据侧存在，反之亦然（错位即红）。
 *
 * 用完即删（§十 工具纪律；若值得长期留，转正为 `npm run` 工具）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { L10N } from '../packages/data/src/l10n/table'

const ROOT = resolve(import.meta.dirname, '..')
const rel = (p: string): string => relative(ROOT, p).split('\\').join('/')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const SRC_ROOTS = [
  join(ROOT, 'apps', 'desktop', 'src'),
  join(ROOT, 'packages', 'core', 'src'),
  join(ROOT, 'packages', 'data', 'src'),
  join(ROOT, 'packages', 'ui', 'src'),
]

const placeholdersOf = (id: string): string[] => {
  const row = L10N[id]
  return row === undefined ? [] : [...row.zh.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)
}

const files = SRC_ROOTS.flatMap((r) => walk(r))
const sources = files.map((f) => ({
  file: f,
  sf: ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
}))

/* ═══════════ A. 映射表：值指向带参数的模板 id ═══════════ */
interface Hit {
  at: string
  what: string
  detail: string
}
const mapHits: Hit[] = []

for (const { file, sf } of sources) {
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined && ts.isObjectLiteralExpression(node.initializer)) {
      const typeText = node.type?.getText(sf) ?? ''
      const looksLikeTable = /Record<\s*string\s*,\s*string\s*>/.test(typeText)
      if (looksLikeTable) {
        for (const prop of node.initializer.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.initializer)) continue
          const target = prop.initializer.text
          const ph = placeholdersOf(target)
          if (ph.length > 0) {
            const line = sf.getLineAndCharacterOfPosition(prop.getStart(sf)).line + 1
            mapHits.push({
              at: `${rel(file)}:${line}`,
              what: `${node.name.getText(sf)} → ${target}`,
              detail: `模板带 ${ph.join('/')}（zh「${L10N[target]?.zh}」）`,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/* ═══════════ B. 日志调用：给了 id 但没喂槽内参数 ═══════════ */
/** 写文案的调用名 → 「id 在第几个实参」的约定（core 里都照这个排） */
const LOG_CALLS: Record<string, { idArg: number; paramsArg: number }> = {
  addLog: { idArg: 3, paramsArg: 4 },
  logEvent: { idArg: 3, paramsArg: 4 },
}
const logHits: Hit[] = []

for (const { file, sf } of sources) {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const spec = LOG_CALLS[node.expression.text]
        if (spec !== undefined) {
          const idNode = node.arguments[spec.idArg]
          if (idNode !== undefined && ts.isStringLiteral(idNode)) {
            const id = idNode.text
            const need = placeholdersOf(id)
            if (need.length > 0) {
              const pNode = node.arguments[spec.paramsArg]
              let missing: string[] = []
              let opaque = false
              let shape = '(无参数对象)'
              if (pNode === undefined) missing = need
              else if (ts.isObjectLiteralExpression(pNode)) {
                const keys = new Set<string>()
                const spreads: string[] = []
                const emptyVals: string[] = []
                for (const prop of pNode.properties) {
                  if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
                    keys.add(prop.name.getText(sf))
                    // 值是不是"恒空"（`p2: ''`）——表里要这一槽却给空串 ⇒ 等于没喂
                    if (ts.isPropertyAssignment(prop) && ts.isStringLiteral(prop.initializer) && prop.initializer.text === '') {
                      emptyVals.push(prop.name.getText(sf))
                    }
                  } else if (ts.isSpreadAssignment(prop)) spreads.push(prop.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 80))
                }
                opaque = spreads.length > 0
                missing = need.filter((k) => !keys.has(k) || emptyVals.includes(k))
                shape = `字面量键 [${[...keys].join(' ')}]${spreads.length > 0 ? ` ＋ 展开 {${spreads.join(' | ')}}` : ''}`
              } else {
                opaque = true
                shape = `参数是表达式：${pNode.getText(sf).replace(/\s+/g, ' ').slice(0, 80)}`
              }
              if (opaque || missing.length > 0) {
                const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
                logHits.push({
                  at: `${rel(file)}:${line}`,
                  what: `${node.expression.text}(${id}) 要 ${need.join('/')}`,
                  detail: opaque ? `静态判不出 —— ${shape}` : `**缺 ${missing.join('/')}** —— ${shape}`,
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

/* ═══════════ C. 通讯表键与数据侧对账 ═══════════ */
const commsTs = resolve(ROOT, 'apps/desktop/src/renderer/src/ui/commsText.ts')
const commsSrc = readFileSync(commsTs, 'utf8')
const messagesTs = resolve(ROOT, 'packages/data/src/messages.ts')
const messagesSrc = readFileSync(messagesTs, 'utf8')
const dataIds = new Set([...messagesSrc.matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]!))
const bodyKeys = (() => {
  const start = commsSrc.indexOf('const COMMS_BODY_EN')
  const end = commsSrc.indexOf('\n}', start)
  return [...commsSrc.slice(start, end).matchAll(/^\s{2}'([a-z0-9-]+)':/gm)].map((m) => m[1]!)
})()
const missingBody = bodyKeys.filter((k) => !dataIds.has(k))
const noEnglish = [...dataIds].filter((k) => !bodyKeys.includes(k))

/* ═══════════ 报告 ═══════════ */
console.log(`扫描 ${files.length} 个源码文件 · l10n 条目 ${Object.keys(L10N).length} 条\n`)

console.log(`【A】映射表（Record<string,string>）指向"带参数的模板"：${mapHits.length} 处`)
for (const h of mapHits) console.log(`  🔴 ${h.at}  ${h.what}\n      ${h.detail}`)

console.log(`\n【B】日志调用带参数模板：可疑 ${logHits.length} 处`)
for (const h of logHits) console.log(`  ⚠ ${h.at}  ${h.what}\n      ${h.detail}`)

console.log(`\n【C】通讯正文对账：正文表有、数据侧没有 = ${missingBody.length}；数据侧有、正文表没有 = ${noEnglish.length}`)
if (missingBody.length > 0) console.log(`  正文表多余键：${missingBody.join(' · ')}`)
if (noEnglish.length > 0) console.log(`  缺英文覆盖：${noEnglish.join(' · ')}`)
