export type DataTable = 'ships' | 'modules' | 'plugs' | 'items' | 'market'
export type DataRow = Record<string, unknown>
export interface DataDocument {
  format: 'whale-static-data'
  version: 1
  table: DataTable
  groups: Record<string, DataRow[]>
}
export interface NumericField {
  path: string
  label: string
  group: string
  unit: string
  min?: number
  max?: number
  integer?: boolean
  percent?: boolean
  writable: boolean
  readonlyReason?: string
}
export interface EditorRow {
  id: string
  name: string
  category: string
  tier?: number
  table: DataTable
  group: string
  values: DataRow
  fields: NumericField[]
}
export interface EditorProject {
  root: string
  branch: string
  head: string
  writable: boolean
  fingerprint: string
  rows: EditorRow[]
  warnings: string[]
}
export interface NumericEdit { table: DataTable; id: string; path: string; value: number }
export interface EditorIssue { message: string; table?: DataTable; id?: string; path?: string }
export interface EditorChange extends NumericEdit { before?: number; linked?: boolean; file: string }
export interface EditorPlan {
  token: string
  changes: EditorChange[]
  issues: EditorIssue[]
  warnings: string[]
}
export interface EditorResult { ok: boolean; message: string; backup?: string; output?: string; issues?: EditorIssue[]; project?: EditorProject }
export interface DataEditorApi {
  chooseProject(): Promise<string | null>
  openProject(root: string): Promise<EditorProject>
  preview(root: string, fingerprint: string, edits: NumericEdit[]): Promise<EditorPlan>
  save(root: string, token: string): Promise<EditorResult>
  restore(root: string): Promise<EditorResult>
  check(root: string): Promise<EditorResult>
  build(root: string): Promise<EditorResult>
  exportChanges(changes: EditorChange[]): Promise<boolean>
  setDirty(dirty: boolean): void
}
