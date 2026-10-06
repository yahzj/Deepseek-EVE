import { describe, expect, it } from 'vitest'
import ships from '../../../packages/data/src/static/ships.json'
import modules from '../../../packages/data/src/static/modules.json'
import plugs from '../../../packages/data/src/static/plugs.json'
import items from '../../../packages/data/src/static/items.json'
import market from '../../../packages/data/src/static/market.json'
import { planDocuments, rowsOf, validateDocument } from '../../../tools/data-editor-schema'
import { staticDataGroup, staticDocumentIssues } from '../../../packages/data/src/staticData'
import type { DataDocument, DataTable } from '../../../tools/data-editor-contract'
const documents = { ships, modules, plugs, items, market } as unknown as Record<DataTable, DataDocument>

describe('静态字段契约与数值编辑计划', () => {
  it('所有迁移数据都合法，范围校验与原0值不混用', () => {
    for (const table of Object.keys(documents) as DataTable[]) expect(validateDocument(documents[table], table)).toEqual([])
    const sandcat = rowsOf('ships', documents.ships).find(row => row.id === 'sandcat')!
    expect(sandcat.values.priceIsk).toBe(0)
    expect(sandcat.fields.find(f => f.path === 'cpu')?.writable).toBe(true)
    expect(sandcat.fields.find(f => f.path === 'tier')?.writable).toBe(false)
  })
  it('类型、未知字段、重复主键、非有限/超大数和null被拒绝', () => {
    const group = Object.keys(documents.ships.groups)[0]!
    for (const value of [null, '123', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER * 2]) {
      const doc = structuredClone(documents.ships)
      doc.groups[group]![0]!.cpu = value
      expect(validateDocument(doc, 'ships').length).toBeGreaterThan(0)
    }
    const doc = structuredClone(documents.ships)
    doc.groups[group]![0]!.unknownField = 10
    doc.groups[group]!.push(doc.groups[group]![0]!)
    expect(staticDocumentIssues(doc).some(text => text.includes('主键'))).toBe(true)
    expect(staticDocumentIssues(doc).some(text => text.includes('字段不存在'))).toBe(true)
  })
  it('修改草稿不碰原数据，非法/整数/射程/只读修改不写', () => {
    const snapshot = JSON.stringify(documents)
    const result = planDocuments(documents, [{ table: 'ships', id: 'sandcat', path: 'cpu', value: 70 }])
    expect(result.issues).toEqual([])
    expect(result.changes).toHaveLength(1)
    expect(JSON.stringify(documents)).toBe(snapshot)
    for (const edit of [
      { table: 'ships', id: 'sandcat', path: 'tier', value: 3 },
      { table: 'ships', id: 'sandcat', path: 'slots.high', value: 1.2 },
      { table: 'ships', id: 'sandcat', path: 'cpu', value: -1 },
      { table: 'ships', id: 'sandcat', path: '__proto__.cpu', value: 2 },
      { table: 'market', id: 'min-voidcrystal', path: 'limitedSupplyEveryMs', value: 1 },
      { table: 'modules', id: 'mod-turret-kin-1', path: 'minRangeM', value: 100000 },
    ]) expect(planDocuments(documents, [edit as any]).issues.length).toBeGreaterThan(0)
  })
  it('价格同值显式联动，不把只收不卖船价0升版，不允许矛盾覆盖', () => {
    const ship = rowsOf('ships', documents.ships).find(row => row.id === 'burrower')!
    const original = ship.values.priceIsk as number
    const price = original + 5000
    const result = planDocuments(documents, [{ table: 'market', id: 'ship-burrower', path: 'basePrice', value: price }])
    expect(result.issues).toEqual([])
    expect(result.changes.some(c => c.table === 'ships' && c.linked && c.value === price)).toBe(true)
    expect(planDocuments(documents, [{ table: 'market', id: 'ship-burrower', path: 'basePrice', value: price }, { table: 'ships', id: 'burrower', path: 'priceIsk', value: price + 1 }]).issues.some(i => i.message.includes('冲突'))).toBe(true)
    expect(planDocuments(documents, [{ table: 'market', id: 'bp-miner-1', path: 'basePrice', value: 20000 }]).issues.some(i => i.message.includes('蓝图'))).toBe(true)
  })
  it('请求表或值伪造、重复字段请求被拒绝', () => {
    expect(planDocuments(documents, [{ table: '__proto__', id: 'x', path: 'x', value: 1 } as any]).issues).not.toEqual([])
    expect(planDocuments(documents, [{ table: 'ships', id: 'sandcat', path: 'cpu', value: Number.NaN }]).issues).not.toEqual([])
    const edit = { table: 'ships', id: 'sandcat', path: 'cpu', value: 70 } as const
    expect(planDocuments(documents, [edit, edit]).issues.some(i => i.message.includes('重复'))).toBe(true)
  })
  it('运行装配缺失绑定/条目和类型损坏不能静默运行', () => {
    expect(() => staticDataGroup(documents.ships, Object.keys(documents.ships.groups)[0]!, {})).toThrow('数量')
    const damaged = structuredClone(documents.ships)
    damaged.version = 9 as any
    expect(() => staticDataGroup(damaged, 'x', {})).toThrow('版本')
  })
})
