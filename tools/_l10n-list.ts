/**
 * 临时探针：按 `tools/l10n-check.ts` 的**同一条判据**列出"未译条目"的精确行号与文本。
 * 为什么需要：`l10n:check` 只打 Top 10 汇总，逐页消化界面批时得看到**每一条**。
 * 一次性工具，用完即删（`_` 前缀 = 仓库口径的临时探针）。
 *
 * 用法：`npx tsx tools/_l10n-list.ts <文件相对路径…>`（不给参数则扫全渲染层）
 */
import { readFileSync } from 'node:fs'
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
