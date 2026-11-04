/** 存档审计共用比较器：逐元素比较JSON投影，返回全部变形路径，不修改任一输入。 */
export interface SaveDifference {
  path: string
  kind: 'missing' | 'added' | 'type' | 'length' | 'value'
}

export function compareSaveValues(before: unknown, after: unknown, path = ''): SaveDifference[] {
  const kindOf = (v: unknown) => Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
  if (kindOf(before) !== kindOf(after)) return [{ path, kind: 'type' }]
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes: SaveDifference[] = []
    if (before.length !== after.length) changes.push({ path, kind: 'length' })
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      changes.push(...compareSaveValues(before[i], after[i], `${path}[${i}]`))
    }
    return changes
  }
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object') {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>
    const changes: SaveDifference[] = []
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const field = path ? `${path}.${key}` : key
      if (!Object.hasOwn(b, key)) changes.push({ path: field, kind: 'missing' })
      else if (!Object.hasOwn(a, key)) changes.push({ path: field, kind: 'added' })
      else changes.push(...compareSaveValues(a[key], b[key], field))
    }
    return changes
  }
  return Object.is(before, after) ? [] : [{ path, kind: 'value' }]
}
