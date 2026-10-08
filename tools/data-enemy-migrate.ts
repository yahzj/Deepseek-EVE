/** 一次性敌人源数字迁移：只替换AST数值叶子，保留引用/表达式/注释。已迁移文件拒绝重写。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { FOE_SHIPS, FOE_DRONES, ANOMALIES } from '@whale/data'
import { FOE_MOUNTS } from '@whale/core'
import type { EnemyDataTable, DataDocument, DataRow } from './data-editor-contract'

const root = resolve(process.cwd())
const out = resolve(root, 'packages/data/src/static')
const baseline = resolve(root, 'packages/core/tests/fixtures/enemy-parameters-20261006.json')
if (process.argv.includes('--baseline')) {
  mkdirSync(resolve(baseline, '..'), { recursive: true })
  writeFileSync(baseline, JSON.stringify({ ships: FOE_SHIPS, drones: FOE_DRONES, cards: ANOMALIES, mounts: FOE_MOUNTS }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  process.exit(0)
}
type Field = { key: string; sourcePath: string; expression: string; source: string }
type Meta = { id: string; name: string; category: string; source: string; fields: Field[] }
const meta: Partial<Record<EnemyDataTable, Meta[]>> = {}
const documents: Partial<Record<EnemyDataTable, DataDocument>> = {}
const sourceFiles = new Map<string, string>()
const configs = [
  { file: 'packages/data/src/foe-ships.ts', table: 'foeShips' as const, type: 'FoeShipDef' },
  { file: 'packages/data/src/foe-drones.ts', table: 'foeDrones' as const, type: 'FoeDroneDef' },
  { file: 'packages/data/src/anomalies.ts', table: 'bounties' as const, array: 'ANOMALIES_BASE' },
  { file: 'packages/data/src/wormholeFoes.ts', table: 'wormholeFleets' as const },
  { file: 'packages/core/src/foeMounts.ts', table: 'foeMounts' as const, array: 'FOE_MOUNTS' },
]
const mountIds = Object.fromEntries(Object.entries(FOE_MOUNTS).map(([id, item]) => [id, item]))
const mountKeys = new Map<string, string>()
const mountsAst = ts.createSourceFile('foeMounts.ts', readFileSync(resolve(root, 'packages/core/src/foeMounts.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
for (const stmt of mountsAst.statements.filter(ts.isVariableStatement)) for (const decl of stmt.declarationList.declarations) {
  if (decl.name.getText(mountsAst) !== 'FOE_MOUNT_IDS' || !decl.initializer) continue
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) mountKeys.set(node.name.getText(mountsAst), node.initializer.text)
    ts.forEachChild(node, visit)
  }; visit(decl.initializer)
}
const document = (table: EnemyDataTable): DataDocument => documents[table] ??= { format: 'whale-static-data', version: 1, table, groups: { parameters: [] } }
for (const config of configs) {
  const absolute = resolve(root, config.file), text = readFileSync(absolute, 'utf8')
  if (text.includes('enemyParameterOf(')) throw new Error(`已迁移，拒绝覆盖：${config.file}`)
  const ast = ts.createSourceFile(config.file, text, ts.ScriptTarget.Latest, true)
  const edits: Array<{ start: number; end: number; text: string }> = []
  const tables = new Set<EnemyDataTable>()
  const fieldText = (object: ts.ObjectLiteralExpression, key: string): string | undefined => {
    const property = object.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(ast) === key)
    return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : undefined
  }
  const collect = (object: ts.ObjectLiteralExpression, table: EnemyDataTable, id: string, name: string, category: string): void => {
    const row: DataRow = { id }
    const info: Meta = { id, name, category, source: config.file, fields: [] }
    const walk = (node: ts.Node, path: string, expression?: ts.Expression): void => {
      if (ts.isPropertyAssignment(node)) {
        const key = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : node.name.getText(ast)
        if (['id', 'name', 'description', 'note', 'en', 'ship', 'drone'].includes(key)) return
        walk(node.initializer, path ? `${path}.${key}` : key, node.initializer); return
      }
      if (ts.isObjectLiteralExpression(node)) { node.properties.forEach(p => walk(p, path)); return }
      if (ts.isArrayLiteralExpression(node)) { node.elements.forEach((p, i) => walk(p, `${path}.${i}`)); return }
      if (ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
        const value = Number(node.getText(ast).replace(/_/g, ''))
        const existing = info.fields.filter(f => f.sourcePath === path)
        const direct = expression === node
        const key = path.replace(/[^a-zA-Z0-9_]/g, '_') + (direct ? '' : `_input${existing.length}`)
        if (key in row) throw new Error(`重复源参数：${id}/${key}`)
        row[key] = value
        info.fields.push({ key, sourcePath: path, expression: expression?.getText(ast) ?? node.getText(ast), source: config.file })
        const call = `enemyParameterOf(${table}Parameters, ${JSON.stringify(id)}, ${JSON.stringify(key)})`
        edits.push({ start: node.getStart(ast), end: node.end, text: path === 'hullClassTier' ? `(${call} as 1 | 2 | 3 | 4 | 5)` : call })
        return
      }
      ts.forEachChild(node, child => walk(child, path, expression))
    }
    object.properties.forEach(p => walk(p, ''))
    if (!info.fields.length) return
    document(table).groups.parameters!.push(row)
    ;(meta[table] ??= []).push(info)
    tables.add(table)
  }
  for (const stmt of ast.statements.filter(ts.isVariableStatement)) for (const decl of stmt.declarationList.declarations) {
    if (!decl.initializer || !ts.isIdentifier(decl.name)) continue
    const name = decl.name.text
    let initializer: ts.Expression = decl.initializer
    while (ts.isAsExpression(initializer) || ts.isParenthesizedExpression(initializer)) initializer = initializer.expression
    if (config.type && decl.type?.getText(ast) === config.type && ts.isObjectLiteralExpression(initializer)) {
      const id = fieldText(initializer, 'id')!
      collect(initializer, config.table, id, fieldText(initializer, 'name') ?? id, fieldText(initializer, 'family') ?? '')
    }
    if (config.array === 'ANOMALIES_BASE' && name === config.array && ts.isArrayLiteralExpression(initializer)) {
      for (const row of initializer.elements) if (ts.isObjectLiteralExpression(row)) {
        const id = fieldText(row, 'id')!
        collect(row, config.table, id, fieldText(row, 'name') ?? id, fieldText(row, 'foeFamily') ?? '')
      }
    }
    if (config.file.endsWith('wormholeFoes.ts') && name === 'WORMHOLE_FOE_CARDS' && ts.isArrayLiteralExpression(initializer)) {
      for (const row of initializer.elements) if (ts.isObjectLiteralExpression(row)) {
        const id = fieldText(row, 'id')!
        collect(row, config.table, id, fieldText(row, 'name') ?? id, fieldText(row, 'foeFamily') ?? '')
      }
    }
    if (config.file.endsWith('wormholeFoes.ts') && decl.type?.getText(ast) === 'AnomalyDef' && ts.isObjectLiteralExpression(initializer)) {
      const id = fieldText(initializer, 'id')!
      collect(initializer, 'invasionFleets', id, fieldText(initializer, 'name') ?? id, fieldText(initializer, 'foeFamily') ?? '')
    }
    if (config.array === 'FOE_MOUNTS' && name === config.array && ts.isObjectLiteralExpression(initializer)) {
      for (const row of initializer.properties) if (ts.isPropertyAssignment(row) && ts.isObjectLiteralExpression(row.initializer)) {
        const id = ts.isStringLiteralLike(row.name) ? row.name.text : mountKeys.get(row.name.getText(ast).replace(/^\[FOE_MOUNT_IDS\.|\]$/g, ''))!
        if (!id || !mountIds[id]) throw new Error(`未知挂载键：${row.name.getText(ast)}`)
        collect(row.initializer, config.table, id, fieldText(row.initializer, 'name') ?? id, '挂载件')
      }
    }
    if (config.table === 'foeShips' && name === 'C_FAMILY_RESISTS' && ts.isObjectLiteralExpression(initializer)) collect(initializer, config.table, 'c-family-resists', '异形共用抗性', 'C')
    if (config.table === 'foeDrones' && name === 'FOE_DRONE_G_BEE' && ts.isArrowFunction(initializer)) {
      let body: ts.Expression = initializer.body as ts.Expression
      while (ts.isParenthesizedExpression(body)) body = body.expression
      if (ts.isObjectLiteralExpression(body)) collect(body, config.table, 'g-bee-shared', '蜂群机共用参数', 'G')
    }
  }
  if (config.table === 'wormholeFleets') {
    // 锚点原属模板共同输入；不复制十五份默认值。
    const decl = ast.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).find(d => d.name.getText(ast) === 'ANCHOR_THREAT')!
    const row = { id: 'wormhole-anchor', threat: Number(decl.initializer!.getText(ast)) }
    document('wormholeFleets').groups.parameters!.push(row)
    meta.wormholeFleets!.push({ id: row.id, name: '探索模板共用锚点', category: '共用', source: config.file, fields: [{ key: 'threat', sourcePath: 'threat', expression: decl.initializer!.getText(ast), source: config.file }] })
    edits.push({ start: decl.initializer!.getStart(ast), end: decl.initializer!.end, text: 'enemyParameterOf(wormholeFleetsParameters, "wormhole-anchor", "threat")' })
  }
  let next = text
  for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
  const imports = [...tables].map(table => `import ${table}Parameters from '${config.table === 'foeMounts' ? './static/' : './static/'}${table}.json'`).join('\n')
  const firstImport = ast.statements.find(ts.isImportDeclaration)!.getStart(ast)
  next = next.slice(0, firstImport) + imports + `\nimport { enemyParameterOf } from '${config.table === 'foeMounts' ? './enemyParameters' : '@whale/core'}'\n` + next.slice(firstImport)
  sourceFiles.set(absolute, next)
}
for (const [file, text] of sourceFiles) writeFileSync(file, text, 'utf8')
mkdirSync(out, { recursive: true })
mkdirSync(resolve(root, 'packages/core/src/static'), { recursive: true })
for (const [table, doc] of Object.entries(documents)) {
  const path = table === 'foeMounts' ? resolve(root, 'packages/core/src/static/foeMounts.json') : resolve(out, `${table}.json`)
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
}
writeFileSync(resolve(out, 'enemyFields.json'), JSON.stringify(meta, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
console.log(Object.entries(documents).map(([table, doc]) => `${table}：${Object.values(doc.groups).flat().length}条`).join('\n'))
