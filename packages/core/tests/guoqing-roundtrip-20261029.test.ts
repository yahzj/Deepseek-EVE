import { describe, expect, it } from 'vitest'
import { runSaveModule } from './helpers/save-shell'

const { compareSaveValues } = runSaveModule<{
  compareSaveValues(a: unknown, b: unknown): Array<{ path: string; kind: string }>
}>('tools/save-roundtrip-compare.ts', {})

describe('C10 存档审计反例必须报出变形位置', () => {
  it('第二个数组元素丢字段不能被第一个元素掩盖', () => {
    expect(compareSaveValues([{ paid: true }, { paid: true }], [{ paid: true }, {}]))
      .toEqual([{ path: '[1].paid', kind: 'missing' }])
  })
  it('价格截半必须报长度，原值改写同时报值', () => {
    expect(compareSaveValues({ prices: [100, 101, 102, 103] }, { prices: [102, 103] }))
      .toContainEqual({ path: 'prices', kind: 'length' })
    expect(compareSaveValues({ quantity: 0.9 }, { quantity: 0 }))
      .toEqual([{ path: 'quantity', kind: 'value' }])
  })
  it('首读丢新字段、类型改变、新增字段均可定位', () => {
    expect(compareSaveValues({ next: { paid: true }, qty: 1 }, { qty: '1', extra: true }))
      .toEqual([{ path: 'next', kind: 'missing' }, { path: 'qty', kind: 'type' }, { path: 'extra', kind: 'added' }])
  })
  it('对象键顺序不影响比较，数组值和嵌套对象逐元素保持', () => {
    expect(compareSaveValues({ a: [1, { x: 2 }], b: null }, { b: null, a: [1, { x: 2 }] })).toEqual([])
    expect(compareSaveValues({ a: [1, { x: 2 }] }, { a: [1, { x: 3 }] }))
      .toEqual([{ path: 'a[1].x', kind: 'value' }])
  })
})
