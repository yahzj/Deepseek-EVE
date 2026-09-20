/**
 * 临时探针（用完即删）：用 TS 的 AST 逐条列出**未译**位置——判据与 `tools/l10n-check.ts` 完全一致：
 *   ① 含中日韩的字符串字面量 / 无插值模板串；
 *   ② JSX **文本节点**（trim 后非空且含中日韩）；
 *   ③ 纯 JSX 元素 `<span>{…}</span>` 里的中文**不**计（与体检器同）。
 * 另标注该中文是否已在唯一表里有条目（有 ⇒ 复用该 id，不用新译）。
 *
 * 用法：node tools/_l10n-ast.js panels/Wormhole.tsx
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.join('apps', 'desktop', 'src', 'renderer', 'src')
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

const table = fs.readFileSync('packages/data/src/l10n/table.ts', 'utf8')
const byZh = new Map()
for (const m of table.matchAll(/^ {2}"([^"]+)": \{ zh: "((?:[^"\\]|\\.)*)", en: /gm)) {
  if (!byZh.has(m[2])) byZh.set(m[2], m[1])
}

const rel = process.argv[2]
const file = path.join(ROOT, rel)
const src = fs.readFileSync(file, 'utf8')
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

let n = 0
const visit = (node) => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (CJK.test(node.text)) {
      const wrapped = node.parent && ts.isCallExpression(node.parent)
        && ts.isIdentifier(node.parent.expression)
        && (node.parent.expression.text === 'tr' || node.parent.expression.text === 't')
      if (!wrapped) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
        const id = byZh.get(node.text)
        n++
        console.log(`${line + 1}: ${id ? `[复用 ${id}]` : '[新造]    '} ${JSON.stringify(node.text)}`)
      }
    }
  } else if (ts.isJsxText(node)) {
    const t = node.text.trim()
    if (t !== '' && CJK.test(t)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      const id = byZh.get(t)
      n++
      console.log(`${line + 1}: ${id ? `[复用 ${id}]` : '[新造]    '} [JSX文本] ${JSON.stringify(t)}`)
    }
  }
  ts.forEachChild(node, visit)
}
visit(sf)
console.log(`\n共 ${n} 条（${rel}）`)
