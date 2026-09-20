/**
 * **界面批·未译清单（逐条列点）** · 2026-09-20 立。
 *
 * 为什么需要它：`npm run l10n:check` 只打 Top 10 汇总，而界面批是**逐页消化**——
 * 得看到某一页到底哪几条没译、在第几行。本工具用与 `l10n-check.ts` **同一条判据**
 * （TS AST：含 CJK 的字符串字面量 / JSX 文本节点，排除 `t()`/`tr()` 的入参）逐条列出。
 *
 * 用法：
 * - `npx tsx tools/l10n-list.ts`                        → 扫全渲染层
 * - `npx tsx tools/l10n-list.ts <文件…>`                → 只看指定文件（逐页消化时用这个）
 * - `npm run l10n:list -- apps/desktop/src/renderer/src/pages/ShipPage.tsx`
 *
 * 注：`l10n-keep` 注释标记的条目（内容层联合 key 等"不是文案"的中文）仍会列出，
 * 它们是**故意保留**的——判断标准见各文件注释。
 */import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'

const CJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const ROOT = 'apps/desktop/src/renderer/src'

function listFile(file: string): Array<{ line: number; text: string; kind: string }> {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Array<{ line: number; text: string; kind: string }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CJK.test(node.text)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        out.push({ line, text: node.text, kind: 'str' })
      }
    }
    if (ts.isJsxText(node)) {
      const t = node.getText().trim()
      if (t !== '' && CJK.test(t)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        out.push({ line, text: t, kind: 'jsx' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function walkDir(dir: string): string[] {
  const out: string[] = []
  for (const e of ts.sys.readDirectory(dir, ['.ts', '.tsx'])) out.push(e)
  return out
}

const args = process.argv.slice(2)
const files = args.length > 0 ? args : walkDir(ROOT)
let total = 0
for (const f of files) {
  const rows = listFile(f)
  if (rows.length === 0) continue
  total += rows.length
  console.log(`\n── ${relative(process.cwd(), f).split('\\').join('/')}  (${rows.length})`)
  for (const r of rows) console.log(`   ${String(r.line).padStart(5)}  [${r.kind}] ${r.text.replace(/\n/g, '\\n').slice(0, 110)}`)
}
console.log(`\n合计 ${total} 条`)
