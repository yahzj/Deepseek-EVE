/** 初次迁移生成字段形状，不冻结数值；新字段须按类型约定扩展，不能每次加载坏数据后重生成。 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DataDocument, DataRow, DataTable } from './data-editor-contract'
const shapes: Record<string, Record<string, string>> = {}
for (const table of ['ships', 'modules', 'plugs', 'items', 'market'] as DataTable[]) {
  const document = JSON.parse(readFileSync(resolve(`packages/data/src/static/${table}.json`), 'utf8')) as DataDocument
  const types: Record<string, string> = {}
  const walk = (value: unknown, path: string): void => {
    const type = Array.isArray(value) ? 'array' : typeof value
    if (types[path] && types[path] !== type) throw new Error(`字段类型不一致：${table}/${path}`)
    types[path] = type
    if (Array.isArray(value)) value.forEach(item => walk(item, `${path}[]`))
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value as DataRow)) walk(child, path ? `${path}.${key}` : key)
  }
  for (const rows of Object.values(document.groups)) for (const row of rows) walk(row, '')
  shapes[table] = types
}
writeFileSync(resolve('packages/data/src/staticFieldTypes.json'), JSON.stringify(shapes, null, 2) + '\n', 'utf8')
