/** 首次迁移工厂生成的异形入侵参数；只移数字，不改公式或编队结构。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { WEEKEND_ALIEN_CARDS } from '../packages/data/src/wormholeFoes'
import type { DataDocument } from './data-editor-contract'
import type { EnemySourceRow } from './data-editor-enemy-schema'
const file = 'packages/data/src/wormholeFoes.ts'
const source = readFileSync(resolve(file), 'utf8')
const jsonFile = resolve('packages/data/src/static/invasionFleets.json')
const metadataFile = resolve('packages/data/src/static/enemyFields.json')
const document = JSON.parse(readFileSync(jsonFile, 'utf8')) as DataDocument
const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as { invasionFleets: EnemySourceRow[] }
if (document.groups.parameters.some(row => row.id === 'alien-common')) throw new Error('异形参数已迁移，拒绝重复覆盖')
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
const patches: Array<{ start: number; end: number; text: string }> = []
const common: Record<string, unknown> = { id: 'alien-common' }
const commonMeta: EnemySourceRow = { id: 'alien-common', name: '异形入侵共用参数', category: 'C', source: file, fields: [] }
const record = (node: ts.NumericLiteral, row: Record<string, unknown>, meta: EnemySourceRow, key: string, sourcePath: string): void => {
  row[key] = Number(node.text.replace(/_/g, ''))
  meta.fields.push({ key, sourcePath, source: file, expression: node.getText(ast) })
  patches.push({ start: node.getStart(ast), end: node.end, text: `enemyParameterOf(invasionFleetsParameters, ${JSON.stringify(row.id)}, ${JSON.stringify(key)})` })
}
const visit = (node: ts.Node): void => {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'alienInvasionCard' && ts.isStringLiteral(node.arguments[0]!)) {
    const id = (node.arguments[0] as ts.StringLiteral).text
    const row: Record<string, unknown> = { id }
    const meta: EnemySourceRow = { id, name: WEEKEND_ALIEN_CARDS.find(card => card.id === id)!.name, category: 'C', source: file, fields: [] }
    record(node.arguments[2] as ts.NumericLiteral, row, meta, 'scale', 'scale')
    record(node.arguments[3] as ts.NumericLiteral, row, meta, 'wreckThreat', 'wreckThreat')
    let index = 0
    const scan = (item: ts.Node): void => {
      if (ts.isNumericLiteral(item)) { record(item, row, meta, `ships_${index}_count`, `ships.${index}.count`); index++ }
      else ts.forEachChild(item, scan)
    }
    scan(node.arguments[4]!)
    document.groups.parameters.push(row); metadata.invasionFleets.push(meta)
    return
  }
  ts.forEachChild(node, visit)
}
visit(ast)
const fn = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'alienInvasionCard')!
const shared = (node: ts.Node): void => {
  if (ts.isNumericLiteral(node)) {
    const text = node.getText(ast)
    const parent = node.parent
    let key: string | undefined
    if (ts.isPropertyAssignment(parent) && ts.isStringLiteral(parent.name) && parent.name.text.startsWith('alien-')) {
      const row = document.groups.parameters.find(row => row.id === parent.name.getText(ast).slice(1, -1))!
      const meta = metadata.invasionFleets.find(meta => meta.id === row.id)!
      record(node, row, meta, 'threat', 'threat'); return
    }
    if (ts.isPropertyAssignment(parent) && ['foeTargetingChance', 'combatSeconds'].includes(parent.name.getText(ast))) key = parent.name.getText(ast)
    if (ts.isConditionalExpression(parent) && text === '20') key = 'motherHpMul'
    if (text === '228') key = 'hivebackFirepowerAnchor'
    if (text === '558') key = 'motherFirepowerAnchor'
    if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent) && ts.isPropertyAssignment(parent.parent.parent) && parent.parent.parent.name.getText(ast) === 'dmgMix') key = 'dmgMix_' + parent.name.getText(ast)
    if (key) record(node, common, commonMeta, key, key.replace('dmgMix_', 'dmgMix.'))
  } else ts.forEachChild(node, shared)
}
shared(fn)
document.groups.parameters.push(common); metadata.invasionFleets.push(commonMeta)
let next = source
for (const patch of patches.sort((a, b) => b.start - a.start)) next = next.slice(0, patch.start) + patch.text + next.slice(patch.end)
writeFileSync(resolve(file), next, 'utf8')
writeFileSync(jsonFile, JSON.stringify(document, null, 2) + '\n', 'utf8')
writeFileSync(metadataFile, JSON.stringify(metadata, null, 2) + '\n', 'utf8')
console.log(`四张异形入侵卡和共用参数迁移，共${patches.length}个数字；编队结构不变。`)
