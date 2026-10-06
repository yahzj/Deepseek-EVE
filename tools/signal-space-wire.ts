/** 按已审ID映射物化当前数据文案引用，原文本表保留历史。用法：npx tsx tools/signal-space-wire.ts。 */
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { SIGNAL_SPACE_TEXT_IDS } from '../packages/core/src/explorationText'

const files = [...['items', 'modules', 'messages', 'firstTaskMessages', 'achievements', 'marketCatalog', 'blueprints', 'shipBlueprints'].map(name => `packages/data/src/${name}.ts`), 'apps/desktop/src/renderer/src/ui/commsText.ts']
for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const changes: Array<{ start: number; end: number; value: string }> = []
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) && ts.isElementAccessExpression(node.parent) && node.parent.expression.getText(ast) === 'L10N') {
      const id = SIGNAL_SPACE_TEXT_IDS[node.text]
      if (id) changes.push({ start: node.getStart(ast), end: node.end, value: `'${id}'` })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  let updated = source
  for (const change of changes.sort((a, b) => b.start - a.start)) updated = updated.slice(0, change.start) + change.value + updated.slice(change.end)
  if (changes.length) writeFileSync(file, updated, 'utf8')
  console.log(`${file}: ${changes.length}`)
}
