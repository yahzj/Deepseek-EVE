/** 源数字参数读取；保留调用点原公式，不在此复制战斗派生。 */
export interface EnemyParameterDocument {
  format: 'whale-static-data'
  version: 1
  table: string
  groups: Record<string, Array<Record<string, unknown>>>
}

const indexes = new WeakMap<object, Map<string, Record<string, unknown>>>()
export function enemyParameterOf(input: unknown, id: string, key: 'lairLevel'): 1 | 2 | 3
export function enemyParameterOf(input: unknown, id: string, key: string): number
export function enemyParameterOf(input: unknown, id: string, key: string): number {
  if (!input || typeof input !== 'object') throw new Error('enemy-parameter-document-invalid')
  const document = input as EnemyParameterDocument
  let index = indexes.get(input)
  if (!index) {
    if (document.format !== 'whale-static-data' || document.version !== 1 || !document.groups ||
      Object.keys(document.groups).join() !== 'parameters' || !Array.isArray(document.groups.parameters)) throw new Error('enemy-parameter-document-invalid')
    index = new Map()
    for (const row of document.groups.parameters) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || index.has(row.id)) throw new Error('enemy-parameter-row-invalid')
      index.set(row.id, row)
    }
    indexes.set(input, index)
  }
  const row = index.get(id)
  const value = row?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`enemy-parameter-invalid:${document.table}:${id}:${key}`)
  }
  return value
}
