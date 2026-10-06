import type { EditorIssue, EditorProject, EditorRow, NumericEdit, NumericField } from '../../../../../tools/data-editor-contract'

export type { DataEditorApi, DataTable, EditorChange, EditorIssue, EditorPlan, EditorProject, EditorResult, EditorRow, NumericEdit, NumericField } from '../../../../../tools/data-editor-contract'
export type BatchMode = 'set' | 'add' | 'subtract' | 'multiply'
export type ValueMode = 'display' | 'raw'
export interface InputBuffer { row: EditorRow; field: NumericField; text: string; mode: ValueMode }
export interface Draft {
  past: NumericEdit[][]
  edits: NumericEdit[]
  future: NumericEdit[][]
  buffers: Record<string, InputBuffer>
}
export const emptyDraft = (): Draft => ({ past: [], edits: [], future: [], buffers: {} })
export const rowKey = (row: Pick<EditorRow, 'table' | 'id'>): string => JSON.stringify([row.table, row.id])
export const editKey = (edit: Pick<NumericEdit, 'table' | 'id' | 'path'>): string => JSON.stringify([edit.table, edit.id, edit.path])
export const inputId = (row: EditorRow, path: string): string => `value-${encodeURIComponent(editKey({ ...row, path }))}`

export function readValue(values: Record<string, unknown>, path: string): number | undefined {
  let current: unknown = values
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined
}

export function effectiveValue(row: EditorRow, path: string, edits: NumericEdit[]): number | undefined {
  return edits.find((edit) => edit.table === row.table && edit.id === row.id && edit.path === path)?.value ?? readValue(row.values, path)
}

export function formatValue(value: number | undefined, field?: NumericField, mode: ValueMode = 'display'): string {
  if (value === undefined) return '未设置'
  if (field?.percent && mode === 'display') return String(Number((value * 100).toPrecision(15)))
  return String(value)
}

export function fieldUnit(field: NumericField, mode: ValueMode): string {
  return field.percent ? mode === 'display' ? '%' : '原值' : field.unit
}

export function validateValue(value: number, field: NumericField): string | undefined {
  if (!Number.isFinite(value)) return '数值必须是有限数字'
  if (field.integer && !Number.isSafeInteger(value)) return '原值必须是安全整数，不自动取整'
  if (field.min !== undefined && value < field.min) return `原值不得小于 ${field.min}`
  if (field.max !== undefined && value > field.max) return `原值不得大于 ${field.max}`
  if (!field.writable) return '继承或派生字段只读'
  return undefined
}

export function parseValue(text: string, field: NumericField, mode: ValueMode): { value?: number; error?: string } {
  if (!text.trim()) return { error: '请输入数值；留空不会删除字段或写入 0' }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim())) return { error: '请输入完整数字' }
  const entered = Number(text)
  const value = field.percent && mode === 'display' ? entered / 100 : entered
  const error = validateValue(value, field)
  return error ? { error } : { value }
}

export function applyEdits(rows: EditorRow[], edits: NumericEdit[], incoming: NumericEdit[]): NumericEdit[] {
  const next = new Map(edits.map((edit) => [editKey(edit), edit]))
  const byId = new Map(rows.map((row) => [rowKey(row), row]))
  for (const edit of incoming) {
    const row = byId.get(rowKey(edit))
    if (!row) continue
    if (readValue(row.values, edit.path) === edit.value) next.delete(editKey(edit))
    else next.set(editKey(edit), edit)
  }
  return [...next.values()]
}

export function recordEdits(draft: Draft, edits: NumericEdit[]): Draft {
  if (JSON.stringify(edits) === JSON.stringify(draft.edits)) return draft
  return { ...draft, past: [...draft.past, draft.edits].slice(-200), edits, future: [] }
}

export function undoDraft(draft: Draft): Draft {
  if (Object.keys(draft.buffers).length) return { ...draft, buffers: {} }
  if (!draft.past.length) return draft
  return { ...draft, past: draft.past.slice(0, -1), edits: draft.past[draft.past.length - 1]!, future: [draft.edits, ...draft.future] }
}

export function redoDraft(draft: Draft): Draft {
  if (!draft.future.length || Object.keys(draft.buffers).length) return draft
  return { ...draft, past: [...draft.past, draft.edits], edits: draft.future[0]!, future: draft.future.slice(1) }
}

export function bufferIssues(draft: Draft): EditorIssue[] {
  return Object.values(draft.buffers).flatMap(({ row, field, text, mode }) => {
    const error = parseValue(text, field, mode).error
    return error ? [{ table: row.table, id: row.id, path: field.path, message: error }] : []
  })
}

export function commitBuffers(rows: EditorRow[], draft: Draft): { draft: Draft; issues: EditorIssue[] } {
  const issues = bufferIssues(draft)
  if (issues.length) return { draft, issues }
  const edits = Object.values(draft.buffers).map(({ row, field, text, mode }) => ({
    table: row.table, id: row.id, path: field.path, value: parseValue(text, field, mode).value!,
  }))
  return { draft: { ...recordEdits(draft, applyEdits(rows, draft.edits, edits)), buffers: {} }, issues: [] }
}

export function batchEdits(rows: EditorRow[], draft: NumericEdit[], path: string, operation: BatchMode, text: string, mode: ValueMode): { edits: NumericEdit[]; issues: EditorIssue[] } {
  const edits: NumericEdit[] = []
  const issues: EditorIssue[] = []
  for (const row of rows) {
    const field = row.fields.find((item) => item.path === path)
    const issue = (message: string): void => { issues.push({ table: row.table, id: row.id, path, message }) }
    if (!field?.writable) { issue('该条目没有可写的同名字段'); continue }
    const parsed = parseValue(text, { ...field, min: undefined, max: undefined, integer: false, percent: operation === 'multiply' ? false : field.percent }, mode)
    if (parsed.error) { issue(parsed.error); continue }
    const current = effectiveValue(row, path, draft)
    if (operation !== 'set' && current === undefined) { issue('未设置的字段不能参与算术，请先设值'); continue }
    const operand = parsed.value!
    const value = operation === 'set' ? operand : operation === 'add' ? current! + operand : operation === 'subtract' ? current! - operand : current! * operand
    const error = validateValue(value, field)
    if (error) issue(error)
    else edits.push({ table: row.table, id: row.id, path, value })
  }
  return { edits: issues.length ? [] : edits, issues }
}

export function isProjectWritable(project: EditorProject, demo = false): boolean {
  const path = project.root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const main = path === 'h:/大鲸鱼/deepseek-eve' || path.endsWith('/deepseek-eve')
  return project.writable && !main && !demo
}

// 预览绑定根目录、原始指纹与完整草稿；编辑或重载后旧 token 不可用于保存。
export function previewKey(project: EditorProject, edits: NumericEdit[]): string {
  return JSON.stringify([project.root, project.fingerprint, edits])
}
