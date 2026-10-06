import type { DataDocument, DataRow } from '../../../tools/data-editor-contract'
import fieldTypes from './staticFieldTypes.json'

export function staticDocumentIssues(document: unknown): string[] {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return ['静态数据必须为对象']
  const doc = document as DataDocument
  const shape = (fieldTypes as Record<string, Record<string, string>>)[doc.table]
  if (!shape || doc.format !== 'whale-static-data' || doc.version !== 1 || !doc.groups || typeof doc.groups !== 'object' || Array.isArray(doc.groups)) return ['静态数据格式或版本不支持']
  const issues: string[] = [], ids = new Set<string>()
  const required: Record<string, string[]> = {
    ships: ['id', 'tier', 'role', 'cargoM3', 'cycleSeconds', 'oreUnitsPerCycle', 'priceIsk', 'agility'],
    modules: ['id', 'slot'], plugs: ['id', 'slot'], items: ['id', 'kind', 'unitM3', 'baseSellPriceIsk'], market: ['key', 'kind', 'refId', 'rarity', 'basePrice'],
  }
  if (Object.keys(doc).some(key => !['format', 'version', 'table', 'groups'].includes(key))) issues.push('数据文档存在未知根字段')
  for (const [group, rows] of Object.entries(doc.groups)) {
    if (!Array.isArray(rows)) { issues.push(`分组${group}必须为数组`); continue }
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) { issues.push(`分组${group}存在非对象条目`); continue }
      const id = row.id ?? row.key
      for (const key of required[doc.table]!) if (!Object.prototype.hasOwnProperty.call(row, key)) issues.push(`${String(id)}/${key}：缺少必要字段`)
      if (typeof id !== 'string' || !id || ids.has(id)) issues.push(`无效或重复主键：${String(id)}`)
      else ids.add(id)
      const walk = (value: unknown, path: string): void => {
        const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
        if (shape[path] !== actual) { issues.push(`${String(id)}/${path}：字段不存在或类型不符`); return }
        if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) issues.push(`${String(id)}/${path}：数值超出安全范围`)
        if (Array.isArray(value)) value.forEach(child => walk(child, `${path}[]`))
        else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) { issues.push('不允许的字段名'); continue }
          walk(child, path ? `${path}.${key}` : key)
        }
      }
      walk(row, '')
    }
  }
  return issues
}

/** 文本与派生字段仍由代码绑定；JSON只提供唯一的静态参数。 */
export function staticDataGroup<T>(document: DataDocument, group: string, bindings: Record<string, DataRow>): T[] {
  const issues = staticDocumentIssues(document)
  if (issues.length) throw new Error(issues.slice(0, 8).join('；'))
  const rows = document.groups[group]
  if (!Array.isArray(rows)) throw new Error(`静态数据缺少分组：${group}`)
  if (rows.length !== Object.keys(bindings).length) throw new Error(`静态数据条目与文本绑定数量不一致：${group}`)
  const ids = new Set<string>()
  return rows.map(row => {
    const id = String(row.id ?? row.key ?? '')
    if (!id || ids.has(id) || !bindings[id]) throw new Error(`静态数据主键或文本绑定错误：${id}`)
    if (Object.keys(row).some(key => Object.prototype.hasOwnProperty.call(bindings[id], key))) throw new Error(`静态参数与代码绑定重复：${id}`)
    ids.add(id)
    return { ...row, ...bindings[id] } as T
  })
}
