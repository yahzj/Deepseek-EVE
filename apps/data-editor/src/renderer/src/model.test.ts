import { describe, expect, it } from 'vitest'
import type { EditorProject, EditorRow, NumericField } from './model'
import { applyEdits, batchEdits, commitBuffers, editKey, effectiveValue, emptyDraft, formatValue, isProjectWritable, parseValue, previewKey, readValue, recordEdits, redoDraft, undoDraft } from './model'

const field: NumericField = { path: 'resist.kinetic', label: '动能抗性', group: '防御', unit: '%', percent: true, min: 0, max: 1, writable: true }
const row = (id: string, value?: number): EditorRow => ({ table: 'ships', id, name: id, category: '武装舰', group: 'ships', fields: [field], values: { resist: value === undefined ? {} : { kinetic: value } } })

describe('数值编辑器 · 数值与缺省语义', () => {
  it('未设置、null、文本与显式 0 分离，不读取原型继承值', () => {
    expect(readValue(row('unset').values, field.path)).toBeUndefined()
    expect(readValue(row('zero', 0).values, field.path)).toBe(0)
    expect(readValue({ value: null }, 'value')).toBeUndefined()
    expect(readValue({ value: '0' }, 'value')).toBeUndefined()
    expect(readValue(Object.create({ value: 12 }), 'value')).toBeUndefined()
    expect(formatValue(undefined)).toBe('未设置')
    expect(formatValue(0)).toBe('0')
    expect(parseValue('', field, 'raw')).toHaveProperty('error')
  })
  it('百分比显示转回原值，倍率不变，负值、范围、非有限与整数严格拒绝', () => {
    expect(formatValue(0.2, field)).toBe('20')
    expect(parseValue('20', field, 'display')).toEqual({ value: 0.2 })
    expect(parseValue('0.2', field, 'raw')).toEqual({ value: 0.2 })
    expect(parseValue('101', field, 'display').error).toBeTruthy()
    expect(parseValue('-1', field, 'display').error).toBeTruthy()
    for (const text of ['NaN', 'Infinity', '1e999', '0x10', '1foo', '+', '.']) expect(parseValue(text, field, 'raw').error, text).toBeTruthy()
    const integer = { ...field, percent: false, integer: true, max: undefined }
    expect(parseValue('1.5', integer, 'raw').error).toBeTruthy()
    expect(parseValue('9007199254740992', integer, 'raw').error).toBeTruthy()
    expect(parseValue('0', integer, 'raw')).toEqual({ value: 0 })
    expect(parseValue('1.4', { ...field, percent: false, max: undefined }, 'display')).toEqual({ value: 1.4 })
  })
  it('编辑零值不被 ?? 回落替代，设回基线移除草稿，不修改 baseline', () => {
    const original = row('A', 0.2)
    const edits = applyEdits([original], [], [{ table: 'ships', id: 'A', path: field.path, value: 0 }])
    expect(effectiveValue(original, field.path, edits)).toBe(0)
    expect(readValue(original.values, field.path)).toBe(0.2)
    expect(applyEdits([original], edits, [{ ...edits[0]!, value: 0.2 }])).toEqual([])
    const unset = row('B')
    expect(applyEdits([unset], [], [{ table: 'ships', id: 'B', path: field.path, value: 0 }])).toHaveLength(1)
  })
})

describe('数值编辑器 · 批量与历史', () => {
  it('加减用百分点，乘数用倍率，逐条比较且整批失败不部分应用', () => {
    const rows = [row('A', 0.2), row('B', 0.3)]
    expect(batchEdits(rows, [], field.path, 'add', '5', 'display').edits.map((edit) => edit.value)).toEqual([0.25, 0.35])
    expect(batchEdits(rows, [], field.path, 'subtract', '10', 'display').edits.map((edit) => edit.value)).toEqual([0.1, 0.19999999999999998])
    expect(batchEdits(rows, [], field.path, 'multiply', '2', 'display').edits.map((edit) => edit.value)).toEqual([0.4, 0.6])
    const invalid = batchEdits([row('A', 0.9), row('B', 0.2)], [], field.path, 'add', '20', 'display')
    expect(invalid.edits).toEqual([])
    expect(invalid.issues[0]).toMatchObject({ id: 'A', path: field.path })
  })
  it('缺省不能被批量算术当作零，设值允许显式零，只读与小数整数失败', () => {
    for (const mode of ['add', 'subtract', 'multiply'] as const) expect(batchEdits([row('unset')], [], field.path, mode, '1', 'raw').edits).toEqual([])
    expect(batchEdits([row('unset')], [], field.path, 'set', '0', 'raw').edits[0]!.value).toBe(0)
    const readonly = { ...row('locked', 0.2), fields: [{ ...field, writable: false }] }
    expect(batchEdits([readonly], [], field.path, 'set', '0', 'raw').issues).toHaveLength(1)
    const integer = { ...row('integer', 1), fields: [{ ...field, percent: false, max: undefined, integer: true }] }
    expect(batchEdits([integer], [], field.path, 'multiply', '1.5', 'raw').issues).toHaveLength(1)
  })
  it('输入中间态进入 dirty buffer，留空不提交，确认与历史保持原值语义', () => {
    const original = row('A', 0.2)
    const key = editKey({ ...original, path: field.path })
    const buffered = { ...emptyDraft(), buffers: { [key]: { row: original, field, text: '', mode: 'display' as const } } }
    expect(commitBuffers([original], buffered).issues).toHaveLength(1)
    expect(commitBuffers([original], buffered).draft).toBe(buffered)
    const valid = { ...buffered, buffers: { [key]: { ...buffered.buffers[key]!, text: '30' } } }
    const committed = commitBuffers([original], valid).draft
    expect(committed.edits[0]!.value).toBe(0.3)
    expect(committed.buffers).toEqual({})
    expect(undoDraft(committed).edits).toEqual([])
    expect(redoDraft(undoDraft(committed)).edits).toEqual(committed.edits)
    const undone = undoDraft(committed)
    expect(recordEdits(undone, [{ ...committed.edits[0]!, value: 0.4 }]).future).toEqual([])
    expect(undoDraft(valid).buffers).toEqual({})
  })
  it('主树与演示强制只读，预览身份绑定根、指纹、原值草稿', () => {
    const project: EditorProject = { root: 'H:/大鲸鱼/Deepseek-EVE-zero', branch: 'zero', head: 'head', fingerprint: 'one', writable: true, rows: [], warnings: [] }
    expect(isProjectWritable(project)).toBe(true)
    expect(isProjectWritable({ ...project, root: 'H:\\大鲸鱼\\Deepseek-EVE\\' })).toBe(false)
    expect(isProjectWritable(project, true)).toBe(false)
    expect(isProjectWritable({ ...project, writable: false })).toBe(false)
    const edit = { table: 'ships' as const, id: 'A', path: field.path, value: 0 }
    const key = previewKey(project, [edit])
    expect(key).not.toBe(previewKey({ ...project, fingerprint: 'two' }, [edit]))
    expect(key).not.toBe(previewKey(project, [{ ...edit, value: 1 }]))
    expect(key).not.toBe(previewKey({ ...project, root: 'elsewhere' }, [edit]))
  })
})
