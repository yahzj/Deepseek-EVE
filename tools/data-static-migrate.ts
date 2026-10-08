/** 一次性迁移计划器：AST提取原始静态值，表达式和文本保留代码，禁止从运行快照倒写。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import type { DataDocument, DataRow, BaseDataTable as DataTable } from './data-editor-contract'

const TABLES: Record<DataTable, { file: string; type: string; names: string[] }> = {
  ships: { file: 'ships.ts', type: 'ShipDef', names: ['SHIPS'] },
  modules: { file: 'modules.ts', type: 'ModuleDef', names: ['MODULES'] },
  plugs: { file: 'plugs.ts', type: 'ModuleDef', names: ['SHIP_PLUGS'] },
  items: { file: 'items.ts', type: 'ItemDef', names: ['ORES', 'RELIC_CONTAINERS', 'BLUEPRINT_CONTAINERS', 'MINERALS', 'GASES', 'ICES', 'AMMO', 'DRONES', 'REPAIR_KITS', 'MATTER_DEVICES', 'WORMHOLE_ESSENCES', 'LUXURIES', 'VALUABLES_CONTAINERS', 'MILITARY_CONTAINERS', 'AI_CORE_ITEMS', 'PARTS', 'WEEKEND_TROPHIES', 'CONSUMABLES'] },
  market: { file: 'marketCatalog.ts', type: 'MarketGoodDef', names: ['MARKET_GOODS_RAW', 'MARKET_GOODS'] },
}
const unwrap = (expression: ts.Expression): ts.Expression => {
  while (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression
  return expression
}
function literal(expression: ts.Expression): unknown {
  const e = unwrap(expression)
  if (ts.isStringLiteralLike(e)) return e.text
  if (ts.isNumericLiteral(e)) return Number(e.text)
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true
  if (e.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(e.operand)) return -Number(e.operand.text)
  if (ts.isArrayLiteralExpression(e)) {
    const values = e.elements.map(item => ts.isSpreadElement(item) ? undefined : literal(item))
    if (values.some(item => item === undefined)) return undefined
    return values
  }
  if (ts.isObjectLiteralExpression(e)) {
    const result: DataRow = {}
    for (const item of e.properties) {
      if (!ts.isPropertyAssignment(item) || ts.isComputedPropertyName(item.name)) return undefined
      const value = literal(item.initializer)
      if (value === undefined) return undefined
      result[ts.isIdentifier(item.name) || ts.isStringLiteralLike(item.name) ? item.name.text : item.name.getText()] = value
    }
    return result
  }
  return undefined
}

export function migrateStaticTable(table: DataTable): void {
  const config = TABLES[table]
  const root = resolve(process.cwd())
  const path = resolve(root, 'packages/data/src', config.file)
  const source = readFileSync(path, 'utf8')
  if (source.includes("from './static/")) throw new Error(`已迁移，拒绝覆盖：${table}`)
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
  const ids = new Map<string, string>()
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
      const value = literal(declaration.initializer)
      if (typeof value === 'string') ids.set(declaration.name.text, value)
      if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, text] of Object.entries(value)) if (typeof text === 'string') ids.set(`${declaration.name.text}.${key}`, text)
    }
  }
  const document: DataDocument = { format: 'whale-static-data', version: 1, table, groups: {} }
  const edits: { start: number; end: number; text: string }[] = []
  let bindings = ''
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !config.names.includes(declaration.name.text) || !declaration.initializer || !ts.isArrayLiteralExpression(declaration.initializer)) continue
      const array = declaration.initializer
      const segments: string[] = []
      let groupSeq = 0
      let rows: DataRow[] = []
      let texts: string[] = []
      const flush = (): void => {
        if (!rows.length) return
        const group = `${declaration.name.getText(ast)}_${groupSeq++}`
        const binding = `${group}_TEXT_BINDINGS`
        document.groups[group] = rows
        bindings += `\nconst ${binding}: Record<string, Record<string, unknown>> = {\n${texts.join('\n')}\n}\n`
        segments.push(`...staticDataGroup<${config.type}>(staticDocument as unknown as DataDocument, '${group}', ${binding})`)
        rows = []; texts = []
      }
      for (const element of array.elements) {
        if (!ts.isObjectLiteralExpression(element)) { flush(); segments.push(element.getText(ast)); continue }
        const key = element.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && ['id', 'key'].includes(item.name.getText(ast)))
        if (!key) throw new Error(`缺少主键：${element.getText(ast).slice(0, 80)}`)
        const id = literal(key.initializer) ?? ids.get(key.initializer.getText(ast))
        if (typeof id !== 'string') throw new Error(`无法解析主键：${key.getText(ast)}`)
        const row: DataRow = { [key.name.getText(ast)]: id }
        const kept: string[] = []
        for (const property of element.properties) {
          if (!ts.isPropertyAssignment(property)) throw new Error('原始对象含展开或方法，需明确规则后迁移')
          const name = property.name.getText(ast)
          if (name === 'id' || name === 'key') continue
          const value = literal(property.initializer)
          if (name === 'name' || name === 'description' || value === undefined) kept.push(`    ${property.getText(ast)},`)
          else row[name] = value
        }
        rows.push(row)
        texts.push(`  ${JSON.stringify(id)}: {\n${kept.join('\n')}\n  },`)
      }
      flush()
      edits.push({ start: array.getStart(ast), end: array.end, text: `[\n  ${segments.join(',\n  ')},\n]` })
    }
  }
  if (!edits.length) throw new Error(`没有可迁移的声明：${table}`)
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  const firstImport = ast.statements.find(ts.isImportDeclaration)?.getStart(ast)
  if (firstImport === undefined) throw new Error('数据模块缺少类型导入')
  const imports = `import staticDocument from './static/${table}.json'\nimport type { DataDocument } from '../../../tools/data-editor-contract'\nimport { staticDataGroup } from './staticData'\n`
  result = result.slice(0, firstImport) + imports + bindings + '\n' + result.slice(firstImport)
  mkdirSync(resolve(root, 'packages/data/src/static'), { recursive: true })
  writeFileSync(resolve(root, 'packages/data/src/static', `${table}.json`), JSON.stringify(document, null, 2) + '\n', 'utf8')
  writeFileSync(path, result, 'utf8')
  console.log(`${table}: ${Object.values(document.groups).reduce((n, group) => n + group.length, 0)}条，文本与表达式保留`)
}

if (process.argv[1]?.endsWith('data-static-migrate.ts')) for (const table of process.argv.slice(2)) {
  if (!(table in TABLES)) throw new Error(`未知表：${table}`)
  migrateStaticTable(table as DataTable)
}
