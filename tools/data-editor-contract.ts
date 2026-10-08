export type BaseDataTable = 'ships' | 'modules' | 'plugs' | 'items' | 'market'
export type EnemyDataTable = 'foeShips' | 'foeDrones' | 'foeMounts' | 'bounties' | 'invasionFleets' | 'wormholeFleets'
export type DataTable = BaseDataTable | EnemyDataTable
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
  references?: Array<{ table: EnemyDataTable; id: string; name: string }>
  notes?: string[]
}
export interface EnemyPreviewRequest { table: EnemyDataTable; id: string; mode: 'base' | 'assault' | 'ambush' | 'flagship' | 'signal' | 'wormhole'; depth: number; role: 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'; kind?: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn' }
export interface EnemyPreviewRow { name: string; wave: number; units: number; hp: number; dps: number; speed: string; range: string }
export interface EnemyPreviewResult { ok: boolean; message: string; rows: EnemyPreviewRow[]; notes: string[]; references: Array<{ table: EnemyDataTable; id: string; name: string }>; entries?: Array<{ name: string; source: string; values: string }> }
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
  enemyPreview?(root: string, fingerprint: string, edits: NumericEdit[], request: EnemyPreviewRequest): Promise<EnemyPreviewResult>
}
