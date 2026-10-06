/** JSON参数仓库服务。多文件rename不是整体原子操作，恢复依赖已刷盘日志和逐文件哈希。 */
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import ts from 'typescript'
import type {
  DataDocument, DataEditorApi, DataTable, EditorChange, EditorIssue, EditorPlan, EditorProject, EditorResult, NumericEdit,
} from './data-editor-contract'
import { TABLE_FILES, planDocuments, rowsOf, validateDocument } from './data-editor-schema'

const gitExec = promisify(execFile)
const TABLES: DataTable[] = ['ships', 'modules', 'plugs', 'items', 'market']
const TEXT_FILES: Record<DataTable, string> = {
  ships: 'packages/data/src/ships.ts', modules: 'packages/data/src/modules.ts', plugs: 'packages/data/src/plugs.ts',
  items: 'packages/data/src/items.ts', market: 'packages/data/src/marketCatalog.ts',
}
const BLUEPRINT_TEXT_FILES = ['packages/data/src/blueprints.ts', 'packages/data/src/shipBlueprints.ts'] as const
const TRUSTED_REPOSITORY = 'H:/大鲸鱼/Deepseek-EVE-zero'
const AREA = 'tools/_data-editor'
const MAX_BYTES = 32 * 1024 * 1024
const active = new Set<string>()
type Mode = 'check' | 'build'
type State = 'prepared' | 'writing' | 'committed' | 'rolling-back' | 'rolled-back' | 'restoring' | 'restored' | 'blocked'
type FaultPoint = 'afterBackup' | 'afterJournal' | 'beforeWrite' | 'afterWrite' | 'beforeCommit' | 'afterRestoreWrite'
export interface RepositoryCheckRequest { root: string; mode: Mode; documents: Record<DataTable, DataDocument> }
export interface DataEditorRuntimeOptions { execPath: string; electronRunAsNode?: boolean }
export interface DataEditorRepositoryOptions {
  /** 仅由Electron main配置可信本机仓库，不从渲染端接收。默认固定为零号。 */
  trustedRepository?: string
  runtime?: DataEditorRuntimeOptions
  /** 单测专用；生产构造拒绝任何checker/fault注入。 */
  checker?: (request: RepositoryCheckRequest) => Promise<EditorResult | void>
  fault?: (point: FaultPoint, file?: string) => void | 'crash' | Promise<void | 'crash'>
}
interface Identity { root: string; common: string; head: string; branch: string; primary: string; trusted: string; writable: boolean }
interface Snapshot {
  identity: Identity
  documents: Record<DataTable, DataDocument>
  raw: Map<string, Buffer>
  fingerprint: string
  project: EditorProject
}
interface Plan { root: string; fingerprint: string; expires: number; documents: Record<DataTable, DataDocument>; changes: EditorChange[] }
interface Entry { file: string; before: string; after: string; mode: number }
interface Journal { version: 1; id: string; root: string; head: string; created: string; state: State; files: Entry[] }
class SimulatedCrash extends Error {}
class RepositoryError extends Error {
  constructor(message: string, readonly issues?: EditorIssue[]) { super(message) }
}
const hash = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
const failure = (error: unknown): EditorResult => ({ ok: false, message: error instanceof Error ? error.message : String(error),
  ...(error instanceof RepositoryError && error.issues?.length ? { issues: error.issues } : {}),
})

function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}
function lexical(root: string, file: string): string {
  if (!file || isAbsolute(file) || /[\\:\0]/.test(file) || file.split('/').some(p => p === '..' || p === '.' || p === '')) {
    throw new Error(`拒绝非白名单相对路径：${file}`)
  }
  const path = resolve(root, file)
  if (!contained(root, path)) throw new Error(`路径逸出：${file}`)
  return path
}
async function regular(root: string, file: string): Promise<string> {
  const path = lexical(root, file)
  const stat = await fs.lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || !samePath(await fs.realpath(path), path)) throw new Error(`拒绝符号链接或非普通文件：${file}`)
  if (stat.size > MAX_BYTES) throw new Error(`文件超过读取上限：${file}`)
  return path
}
async function read(root: string, file: string): Promise<Buffer> {
  const path = await regular(root, file)
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try { return await handle.readFile() } finally { await handle.close() }
}
async function directory(root: string, file: string): Promise<string> {
  const path = lexical(root, file)
  const parts = file.split('/')
  let cursor = root
  for (const part of parts) {
    cursor = join(cursor, part)
    try { await fs.mkdir(cursor) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
    const stat = await fs.lstat(cursor)
    if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await fs.realpath(cursor), cursor)) throw new Error(`拒绝链接目录：${file}`)
  }
  return path
}
function utf8(bytes: Buffer, file: string): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new Error(`文件不是严格UTF-8：${file}`) }
}
function json(bytes: Buffer, file: string): unknown {
  const text = utf8(bytes, file).replace(/^\uFEFF/, '')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error(`JSON格式错误：${file}`) }
  const ast = ts.parseJsonText(file, text)
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set<string>()
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) throw new Error(`JSON对象格式错误：${file}`)
        const key = property.name.text
        if (seen.has(key)) throw new Error(`JSON重复键：${file} / ${key}`)
        seen.add(key)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return value
}
function format(document: DataDocument, original: Buffer): Buffer {
  const source = utf8(original, document.table)
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : ''
  const crlf = source.includes('\r\n')
  const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? (source.includes('\n') ? '  ' : '')
  const ending = source.endsWith('\r\n') ? '\r\n' : source.endsWith('\n') ? '\n' : ''
  let text = JSON.stringify(document, null, indent)
  if (crlf) text = text.replace(/\n/g, '\r\n')
  return Buffer.from(bom + text + ending, 'utf8')
}
async function git(root: string, args: string[]): Promise<string> {
  const result = await gitExec('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000, maxBuffer: MAX_BYTES,
  })
  return result.stdout
}
interface TextBinding { name?: string; numbers: Map<string, number>; codePaths: Set<string> }
function localizedNames(bytes: Buffer): Map<string, string> {
  const ast = ts.createSourceFile('table.ts', utf8(bytes, 'l10n/table.ts'), ts.ScriptTarget.Latest, true)
  const result = new Map<string, string>()
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isObjectLiteralExpression(node.initializer)) {
      const zh = node.initializer.properties.find((field): field is ts.PropertyAssignment => ts.isPropertyAssignment(field) && field.name.getText(ast) === 'zh')
      if (zh && ts.isStringLiteralLike(zh.initializer)) result.set(node.name.text, zh.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return result
}
function names(bytes: Buffer, file: string, localized = new Map<string, string>()): Map<string, TextBinding> {
  const ast = ts.createSourceFile(file, utf8(bytes, file), ts.ScriptTarget.Latest, true)
  const result = new Map<string, TextBinding>()
  const unwrap = (expression: ts.Expression): ts.Expression => {
    while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression
    return expression
  }
  const numeric = (expression: ts.Expression, depth = 0): number | undefined => {
    if (depth > 20) return undefined
    expression = unwrap(expression)
    let value: number | undefined
    if (ts.isNumericLiteral(expression)) value = Number(expression.text.replace(/_/g, ''))
    else if (ts.isPrefixUnaryExpression(expression)) {
      const operand = numeric(expression.operand, depth + 1)
      if (operand !== undefined && expression.operator === ts.SyntaxKind.MinusToken) value = -operand
      if (operand !== undefined && expression.operator === ts.SyntaxKind.PlusToken) value = operand
    } else if (ts.isBinaryExpression(expression)) {
      const left = numeric(expression.left, depth + 1), right = numeric(expression.right, depth + 1)
      if (left === undefined || right === undefined) return undefined
      switch (expression.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: value = left + right; break
        case ts.SyntaxKind.MinusToken: value = left - right; break
        case ts.SyntaxKind.AsteriskToken: value = left * right; break
        case ts.SyntaxKind.SlashToken: value = left / right; break
        case ts.SyntaxKind.PercentToken: value = left % right; break
        case ts.SyntaxKind.AsteriskAsteriskToken: value = left ** right; break
      }
    }
    return value !== undefined && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : undefined
  }
  const propertyName = (name: ts.PropertyName): string | undefined => ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
  const collect = (object: ts.ObjectLiteralExpression, binding: TextBinding, prefix = ''): void => {
    for (const field of object.properties) {
      if (!ts.isPropertyAssignment(field)) continue
      const key = propertyName(field.name)
      if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) continue
      const path = prefix + key, label = unwrap(field.initializer)
      if (!prefix && key === 'name' && (ts.isStringLiteral(label) || ts.isNoSubstitutionTemplateLiteral(label))) binding.name = label.text
      else if (!prefix && key === 'name' && ts.isPropertyAccessExpression(label) && label.name.text === 'zh') {
        const access = unwrap(label.expression)
        if (ts.isElementAccessExpression(access) && ts.isIdentifier(access.expression) && access.expression.text === 'L10N' && ts.isStringLiteralLike(access.argumentExpression)) binding.name = localized.get(access.argumentExpression.text)
      }
      else if (ts.isObjectLiteralExpression(label)) collect(label, binding, `${path}.`)
      else {
        binding.codePaths.add(path)
        const value = numeric(label)
        if (value !== undefined) binding.numbers.set(path, value)
      }
    }
  }
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
      const object = unwrap(decl.initializer)
      if (['BLUEPRINTS', 'SHIP_BLUEPRINTS'].includes(decl.name.text) && ts.isArrayLiteralExpression(object)) {
        for (const entry of object.elements) {
          if (!ts.isObjectLiteralExpression(entry)) continue
          const id = entry.properties.find((field): field is ts.PropertyAssignment => ts.isPropertyAssignment(field) && propertyName(field.name) === 'id')
          if (!id || !ts.isStringLiteralLike(unwrap(id.initializer))) continue
          const binding: TextBinding = { numbers: new Map(), codePaths: new Set() }
          collect(entry, binding)
          result.set((unwrap(id.initializer) as ts.StringLiteralLike).text, binding)
        }
        continue
      }
      if (!decl.name.text.endsWith('_TEXT_BINDINGS')) continue
      if (!ts.isObjectLiteralExpression(object)) continue
      for (const property of object.properties) {
        if (!ts.isPropertyAssignment(property) || (!ts.isStringLiteral(property.name) && !ts.isIdentifier(property.name))) continue
        const value = unwrap(property.initializer)
        if (!ts.isObjectLiteralExpression(value)) continue
        const binding: TextBinding = { numbers: new Map(), codePaths: new Set() }
        collect(value, binding)
        result.set(property.name.text, binding)
      }
    }
  }
  return result
}
async function syncDirectory(path: string): Promise<void> {
  let handle: fs.FileHandle | undefined
  try { handle = await fs.open(path, 'r'); await handle.sync() }
  catch (e) { if (!['EINVAL', 'EPERM', 'EISDIR', 'EACCES', 'ENOTSUP'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e }
  finally { await handle?.close() }
}
async function durable(path: string, bytes: Buffer, mode = 0o600): Promise<void> {
  const handle = await fs.open(path, 'wx', mode)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
async function replace(root: string, file: string, bytes: Buffer, expected: string, mode: number): Promise<void> {
  const target = await regular(root, file)
  const temp = `${target}.data-editor-${randomUUID()}.tmp`
  try {
    await durable(temp, bytes, mode & 0o777)
    if (hash(await read(root, file)) !== expected) throw new Error(`外部修改冲突，停止写入：${file}`)
    await fs.rename(temp, target)
    await syncDirectory(dirname(target))
  } finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e }) }
}

/** 仅由main持有，preview令牌和候选数据不从renderer回传。 */
export class DataEditorRepository implements Pick<DataEditorApi, 'openProject' | 'preview' | 'save' | 'restore' | 'check' | 'build'> {
  private readonly options: DataEditorRepositoryOptions
  private readonly plans = new Map<string, Plan>()
  constructor(options: DataEditorRepositoryOptions = {}) {
    if ((options.checker || options.fault) && process.env.VITEST !== 'true') throw new Error('生产环境禁止注入检查器或故障钩子')
    this.options = options
    for (const table of TABLES) {
      if (TABLE_FILES[table] !== `packages/data/src/static/${table}.json`) throw new Error(`不支持的JSON路径：${table}`)
    }
  }

  private async identity(input: string): Promise<Identity> {
    if (typeof input !== 'string' || !isAbsolute(input)) throw new Error('请选择项目绝对路径')
    const root = await fs.realpath(input)
    const trust = await fs.realpath(this.options.trustedRepository ?? TRUSTED_REPOSITORY)
    let top: string, common: string, trustedCommon: string
    try {
      top = await fs.realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim())
      common = await fs.realpath(resolve(root, (await git(root, ['rev-parse', '--git-common-dir'])).trim()))
      trustedCommon = await fs.realpath(resolve(trust, (await git(trust, ['rev-parse', '--git-common-dir'])).trim()))
    } catch { throw new Error('拒绝非Git项目或未知仓库') }
    if (!samePath(top, root) || !samePath(common, trustedCommon)) throw new Error('拒绝未知仓库或非工作树根目录')
    for (const [file, name] of [
      ['package.json', 'whale-eve-idle'], ['packages/core/package.json', '@whale/core'], ['packages/data/package.json', '@whale/data'],
    ]) {
      const manifest = json(await read(root, file), file) as { name?: string }
      if (!manifest || manifest.name !== name) throw new Error(`不支持的项目标识：${file}`)
    }
    const head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim()
    const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    const worktrees = await git(root, ['worktree', 'list', '--porcelain', '-z'])
    const primaryField = worktrees.split('\0').find(field => field.startsWith('worktree '))
    if (!primaryField) throw new Error('无法确定主工作树')
    const primary = await fs.realpath(primaryField.slice(9))
    return { root, common, head, branch, primary, trusted: trust, writable: !samePath(root, primary) && branch !== 'main' && branch !== 'master' && branch !== 'HEAD' }
  }

  private async snapshot(input: string): Promise<Snapshot> {
    const identity = await this.identity(input)
    const raw = new Map<string, Buffer>()
    const documents = {} as Record<DataTable, DataDocument>
    const rows: EditorProject['rows'] = []
    const issues: EditorIssue[] = []
    const bindings = new Map<DataTable, Map<string, TextBinding>>()
    const blueprintBindings = new Map<string, TextBinding>()
    let localized = new Map<string, string>()
    try {
      const text = await read(identity.root, 'packages/data/src/l10n/table.ts')
      raw.set('packages/data/src/l10n/table.ts', text)
      localized = localizedNames(text)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    for (const file of BLUEPRINT_TEXT_FILES) {
      try {
        const text = await read(identity.root, file)
        raw.set(file, text)
        for (const [id, binding] of names(text, file, localized)) blueprintBindings.set(id, binding)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    for (const table of TABLES) {
      const file = TABLE_FILES[table]
      const data = await read(identity.root, file)
      const document = json(data, file)
      issues.push(...validateDocument(document, table))
      documents[table] = document as DataDocument
      raw.set(file, data)
      const binding = await read(identity.root, TEXT_FILES[table])
      raw.set(TEXT_FILES[table], binding)
      const labels = names(binding, TEXT_FILES[table], localized)
      bindings.set(table, labels)
      if (!issues.some(issue => issue.table === table)) {
        // 只丰富展示副本，代码表达式绝不物化回权威JSON。
        const display = structuredClone(documents[table])
        for (const group of Object.values(display.groups)) for (const row of group) {
          const label = labels.get(String(row.id ?? row.key))
          for (const [path, value] of label?.numbers ?? []) {
            const parts = path.split('.')
            let object = row
            for (const key of parts.slice(0, -1)) {
              if (!object[key] || typeof object[key] !== 'object' || Array.isArray(object[key])) object[key] = {}
              object = object[key] as Record<string, unknown>
            }
            object[parts.at(-1)!] = value
          }
        }
        rows.push(...rowsOf(table, display).map(row => ({ ...row, name: labels.get(row.id)?.name ?? row.name ?? row.id,
          fields: row.fields.map(field => labels.get(row.id)?.codePaths.has(field.path)
            ? { ...field, writable: false, readonlyReason: 'readonly code expression' } : field),
        })))
      }
    }
    if (issues.length) throw new RepositoryError(`数据契约失败：${issues.map(issue => issue.message).join('；')}`, issues)
    for (const row of rows.filter(row => row.table === 'market')) {
      const ownName = bindings.get('market')?.get(row.id)?.name
      const refId = typeof row.values.refId === 'string' ? row.values.refId : row.id
      const preferred = row.values.kind === 'ship' ? 'ships' : row.values.kind === 'module' ? 'modules' : 'items'
      const label = (row.values.kind === 'blueprint' ? blueprintBindings.get(refId)?.name : undefined)
        ?? bindings.get(preferred)?.get(refId)?.name
        ?? TABLES.map(table => bindings.get(table)?.get(refId)?.name).find(name => name !== undefined)
      row.name = ownName ?? label ?? row.id
    }
    const fingerprint = hash(JSON.stringify({ head: identity.head, branch: identity.branch, files: [...raw].map(([file, bytes]) => [file, hash(bytes)]) }))
    const project: EditorProject = {
      root: identity.root, branch: identity.branch, head: identity.head, writable: identity.writable, fingerprint, rows,
      warnings: identity.writable ? [] : ['主树、main/master分支或游离HEAD只读，不能保存、恢复或运行检查构建。'],
    }
    return { identity, raw, documents, fingerprint, project }
  }

  private async locked<T>(identity: Identity, operation: () => Promise<T>): Promise<T> {
    if (!identity.writable) throw new Error('主树或main分支只读，拒绝写入')
    const key = process.platform === 'win32' ? identity.root.toLowerCase() : identity.root
    if (active.has(key)) throw new Error('该项目已有操作进行中')
    active.add(key)
    let handle: fs.FileHandle | undefined
    let owned = false
    const nonce = randomUUID()
    const file = `${AREA}/lock.json`
    try {
      await directory(identity.root, AREA)
      const path = lexical(identity.root, file)
      try { handle = await fs.open(path, 'wx', 0o600) }
      catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        const raw = await read(identity.root, file)
        const lock = json(raw, file) as { pid?: number; host?: string }
        if (!Number.isSafeInteger(lock.pid) || (lock.pid ?? 0) <= 0 || lock.host !== hostname()) throw new Error('锁来源不明，停止操作')
        try { process.kill(lock.pid!, 0); throw new Error('另一个编辑器正在操作该项目') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
        if (hash(await read(identity.root, file)) !== hash(raw)) throw new Error('锁已变化，停止操作')
        await fs.unlink(path)
        handle = await fs.open(path, 'wx', 0o600)
      }
      owned = true
      await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), nonce }))
      await handle.sync()
      await handle.close(); handle = undefined
      return await operation()
    } finally {
      await handle?.close()
      if (owned) {
        const lock = json(await read(identity.root, file), file) as { nonce?: string }
        if (lock.nonce === nonce) await fs.unlink(lexical(identity.root, file))
      }
      active.delete(key)
    }
  }

  private async fault(point: FaultPoint, file?: string): Promise<void> {
    if (await this.options.fault?.(point, file) === 'crash') throw new SimulatedCrash('模拟进程中断，等待日志恢复')
  }
  private async journalWrite(root: string, journal: Journal): Promise<void> {
    const dir = await directory(root, `${AREA}/backups/${journal.id}`)
    try { await regular(root, `${AREA}/backups/${journal.id}/journal.json`) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    const temp = join(dir, `${randomUUID()}.tmp`)
    await durable(temp, Buffer.from(JSON.stringify(journal, null, 2) + '\n'))
    try { await fs.rename(temp, join(dir, 'journal.json')); await syncDirectory(dir) }
    finally { await fs.unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e }) }
  }
  private async journals(root: string): Promise<Journal[]> {
    let entries: import('node:fs').Dirent[]
    try {
      const dir = lexical(root, `${AREA}/backups`)
      if (!samePath(await fs.realpath(dir), dir)) throw new Error('备份目录链接逸出')
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    const journals: Journal[] = []
    for (const entry of entries) {
      if (!/^[0-9a-f-]{36}$/.test(entry.name) || !entry.isDirectory()) throw new Error('备份目录含未知条目，停止恢复')
      let bytes: Buffer
      try { bytes = await read(root, `${AREA}/backups/${entry.name}/journal.json`) }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue; throw e }
      const j = json(bytes, 'journal.json') as Journal
      if (!j || j.version !== 1 || j.id !== entry.name || j.root !== root || !/^[0-9a-f]{40,64}$/.test(j.head) || !Array.isArray(j.files) || !j.files.length || j.files.length > 5 ||
          !['prepared', 'writing', 'committed', 'rolling-back', 'rolled-back', 'restoring', 'restored', 'blocked'].includes(j.state) || !Number.isFinite(Date.parse(j.created))) throw new Error('事务日志格式错误，停止恢复')
      const seen = new Set<string>()
      for (const file of j.files) {
        if (!TABLES.some(table => TABLE_FILES[table] === file.file) || seen.has(file.file) || !/^[0-9a-f]{64}$/.test(file.before) || !/^[0-9a-f]{64}$/.test(file.after) || !Number.isInteger(file.mode)) throw new Error('事务日志目标不在白名单')
        seen.add(file.file)
      }
      journals.push(j)
    }
    return journals.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
  }
  private async backupBytes(root: string, journal: Journal, entry: Entry, which: 'before' | 'after'): Promise<Buffer> {
    const index = journal.files.indexOf(entry)
    const bytes = await read(root, `${AREA}/backups/${journal.id}/${index}.${which}`)
    if (hash(bytes) !== entry[which]) throw new Error(`备份哈希不一致：${entry.file}`)
    return bytes
  }
  private async rollback(root: string, journal: Journal, restoring = false): Promise<void> {
    // 完整preflight后才开始恢复；任一外部修改阻挡整个恢复，不先回滚其他文件。
    const pending: Array<{ entry: Entry; bytes: Buffer }> = []
    for (const entry of journal.files) {
      const before = await this.backupBytes(root, journal, entry, 'before')
      await this.backupBytes(root, journal, entry, 'after')
      const current = hash(await read(root, entry.file))
      if (current !== entry.after && (restoring || current !== entry.before)) throw new Error(`恢复冲突，所有目标保持现状：${entry.file}`)
      if (current === entry.after && entry.after !== entry.before) pending.push({ entry, bytes: before })
    }
    journal.state = restoring ? 'restoring' : 'rolling-back'
    await this.journalWrite(root, journal)
    for (const { entry, bytes } of pending) {
      await replace(root, entry.file, bytes, entry.after, entry.mode)
      await this.fault('afterRestoreWrite', entry.file)
    }
    journal.state = restoring ? 'restored' : 'rolled-back'
    await this.journalWrite(root, journal)
  }
  private async recover(identity: Identity): Promise<void> {
    for (const journal of await this.journals(identity.root)) {
      if (['committed', 'restored', 'rolled-back'].includes(journal.state)) continue
      if (journal.state === 'blocked') throw new Error(`事务${journal.id}恢复冲突，停止写入；请核对外部改动与备份`)
      try { await this.rollback(identity.root, journal) }
      catch (e) { journal.state = 'blocked'; await this.journalWrite(identity.root, journal); throw e }
    }
  }

  async openProject(root: string): Promise<EditorProject> {
    const identity = await this.identity(root)
    if (identity.writable) await this.locked(identity, () => this.recover(identity))
    return (await this.snapshot(identity.root)).project
  }
  async preview(root: string, fingerprint: string, edits: NumericEdit[]): Promise<EditorPlan> {
    const snapshot = await this.snapshot(root)
    if (snapshot.fingerprint !== fingerprint) throw new Error('项目已被外部修改，请重新载入后预览')
    if (!Array.isArray(edits) || edits.length > 10_000) throw new Error('编辑请求格式错误或超过批量上限')
    for (const edit of edits) {
      if (!edit || !TABLES.includes(edit.table) || typeof edit.id !== 'string' || typeof edit.path !== 'string' || typeof edit.value !== 'number' || !Number.isFinite(edit.value)) throw new Error('只接受合法表名、主键和有限数值')
      const binding = names(snapshot.raw.get(TEXT_FILES[edit.table])!, TEXT_FILES[edit.table]).get(edit.id)
      if (binding?.codePaths.has(edit.path)) return { token: '', changes: [], warnings: [], issues: [{ message: 'readonly code expression', table: edit.table, id: edit.id, path: edit.path }] }
    }
    const plan = planDocuments(structuredClone(snapshot.documents), structuredClone(edits))
    const token = randomUUID()
    const issues = [...plan.issues]
    for (const table of TABLES) issues.push(...validateDocument(plan.documents[table], table))
    if (!snapshot.identity.writable) issues.push({ message: '项目只读，不能保存' })
    for (const [key, value] of this.plans) if (value.expires < Date.now()) this.plans.delete(key)
    if (!issues.length && plan.changes.length) this.plans.set(token, {
      root: snapshot.identity.root, fingerprint, documents: structuredClone(plan.documents), changes: structuredClone(plan.changes), expires: Date.now() + 10 * 60_000,
    })
    return { token, changes: plan.changes, issues, warnings: plan.warnings }
  }

  private async sources(root: string): Promise<Map<string, Buffer>> {
    const listed = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean)
    const result = new Map<string, Buffer>()
    for (const file of [...new Set([...listed, ...TABLES.map(table => TABLE_FILES[table])])].sort()) {
      const segments = file.split('/')
      if (segments.some(p => ['.git', 'node_modules', 'out', 'dist', 'dist-web', 'release', 'coverage', '.cache'].includes(p)) || file.startsWith(`${AREA}/`) || /^tools\/_/.test(file)) continue
      if (/^(docs\/exports|content-csv|foe-csv|steam)\//.test(file)) continue
      if (file.startsWith('docs/test-saves/') && !/^docs\/test-saves\/test-save-[^/]+\.json$/.test(file)) continue
      if (!/^(packages|apps|tools|web|docs|\.githooks)\//.test(file) && !/^(package(?:-lock)?\.json|tsconfig[^/]*\.json|postcss\.config\.js|\.gitignore|AGENTS\.md)$/.test(file)) continue
      try { result.set(file, await read(root, file)) }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    }
    return result
  }
  private async unchangedSources(root: string, source: Map<string, Buffer>): Promise<void> {
    const current = await this.sources(root)
    if (source.size !== current.size || [...source].some(([file, bytes]) => !current.has(file) || hash(current.get(file)!) !== hash(bytes))) {
      throw new Error('检查期间项目源码发生变化，拒绝过期候选')
    }
  }
  private async removeCandidate(root: string, path: string): Promise<void> {
    const parent = lexical(root, `${AREA}/candidates`)
    if (!contained(parent, path) || path === parent || !samePath(await fs.realpath(path), path)) throw new Error('临时目录清理路径不安全')
    // 先移除自身创建的junction，递归删除不能进入共享依赖。
    const unlinkLinks = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const target = join(dir, entry.name)
        const stat = await fs.lstat(target)
        if (stat.isSymbolicLink()) await fs.unlink(target)
        else if (stat.isDirectory()) await unlinkLinks(target)
      }
    }
    await unlinkLinks(path)
    await fs.rm(path, { recursive: true, force: true })
  }
  private async dependencyRoot(identity: Identity): Promise<string> {
    let modules: string
    try { modules = await fs.realpath(join(identity.root, 'node_modules')) }
    catch { throw new Error('缺少项目node_modules，拒绝检查和保存；不会自动安装依赖') }
    // trusted已按common Git目录验证；允许fixture复用零号依赖，不允许任意同名前缀目录。
    const allowed = [identity.root, identity.primary, identity.trusted].map(root => join(root, 'node_modules'))
    if (!allowed.some(path => samePath(path, modules))) throw new Error('项目依赖不在已验证的工作树依赖目录内')
    return modules
  }
  private async dependencies(identity: Identity, candidate: string): Promise<void> {
    const modules = await this.dependencyRoot(identity)
    const dest = await directory(candidate, 'node_modules')
    const link = async (from: string, to: string): Promise<void> => {
      const actual = await fs.realpath(from)
      if (!contained(modules, actual)) throw new Error(`依赖链接逸出：${basename(from)}`)
      await fs.symlink(actual, to, process.platform === 'win32' ? 'junction' : 'dir')
    }
    for (const entry of await fs.readdir(modules, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '@whale') continue
      if (entry.name.startsWith('@')) {
        const scope = join(modules, entry.name)
        if (!contained(modules, await fs.realpath(scope))) throw new Error('依赖scope链接逸出')
        await fs.mkdir(join(dest, entry.name))
        for (const child of await fs.readdir(scope)) await link(join(scope, child), join(dest, entry.name, child))
      } else if (entry.isDirectory() || entry.isSymbolicLink()) await link(join(modules, entry.name), join(dest, entry.name))
    }
    await fs.mkdir(join(dest, '@whale'))
    for (const [name, path] of Object.entries({ core: 'packages/core', data: 'packages/data', ui: 'packages/ui', desktop: 'apps/desktop', 'data-editor': 'apps/data-editor' })) {
      const source = join(candidate, path)
      await fs.symlink(source, join(dest, '@whale', name), process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
  private async candidateGit(identity: Identity, candidate: string): Promise<void> {
    await git(candidate, ['clone', '--bare', '--shared', '--no-hardlinks', '--', identity.root, join(candidate, '.git')])
    await git(candidate, ['config', '--local', 'core.bare', 'false'])
    await git(candidate, ['config', '--local', 'core.worktree', candidate])
    await git(candidate, ['config', '--local', 'core.hooksPath', join(candidate, '.git', 'disabled-hooks')])
    await git(candidate, ['config', '--local', 'core.fsmonitor', 'false'])
    await git(candidate, ['read-tree', identity.head])
  }
  private async command(identity: Identity, candidate: string, dependency: string, args: string[], cwd = candidate): Promise<void> {
    const modules = await this.dependencyRoot(identity)
    const executable = lexical(candidate, `node_modules/${dependency}`)
    const actual = await fs.realpath(executable)
    if (!contained(modules, actual) || !(await fs.stat(actual)).isFile()) throw new Error(`缺少或不可信检查依赖：${dependency}`)
    const runtime = this.options.runtime?.execPath ?? process.execPath
    if (!isAbsolute(runtime)) throw new Error('运行时必须为可信绝对路径')
    const env = { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', ELECTRON_RUN_AS_NODE: this.options.runtime?.electronRunAsNode === false ? '' : '1' }
    await new Promise<void>((accept, reject) => {
      // 保留候选依赖路径，tsx/CLI内部的workspace解析不能落回共享依赖所属的零号源码。
      const child = spawn(runtime, ['--preserve-symlinks', '--preserve-symlinks-main', executable, ...args], { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      const keep = (data: Buffer): void => { output = (output + data.toString('utf8')).slice(-20_000) }
      child.stdout.on('data', keep); child.stderr.on('data', keep)
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`检查超时：${dependency}`)) }, 10 * 60_000)
      child.once('error', e => { clearTimeout(timeout); reject(e) })
      child.once('close', code => { clearTimeout(timeout); code === 0 ? accept() : reject(new Error(`检查失败：${dependency}\n${output}`)) })
    })
  }
  private async retainBuild(snapshot: Snapshot, candidate: string): Promise<string> {
    const id = randomUUID()
    const parent = await directory(snapshot.identity.root, `${AREA}/builds`)
    const staging = join(parent, `${id}.pending`)
    const output = join(parent, id)
    await fs.mkdir(staging)
    try {
      for (const file of ['apps/desktop/out/main/index.js', 'apps/desktop/out/preload/index.js', 'apps/desktop/out/renderer/index.html', 'web/dist/index.html']) {
        await regular(candidate, file)
      }
      const files: Array<{ file: string; hash: string }> = []
      const copy = async (from: string, to: string): Promise<void> => {
        const source = lexical(candidate, from)
        if (!samePath(await fs.realpath(source), source) || !(await fs.lstat(source)).isDirectory()) throw new Error(`构建产物目录链接逸出：${from}`)
        const dest = await directory(staging, to)
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw new Error(`构建产物不接受链接：${from}/${entry.name}`)
          if (entry.isDirectory()) await copy(`${from}/${entry.name}`, `${to}/${entry.name}`)
          else {
            const data = await read(candidate, `${from}/${entry.name}`)
            await durable(lexical(staging, `${to}/${entry.name}`), data, 0o644)
            files.push({ file: `${to}/${entry.name}`, hash: hash(data) })
          }
        }
        await syncDirectory(dest)
      }
      await copy('apps/desktop/out', 'desktop/out')
      await copy('web/dist', 'web/dist')
      await durable(join(staging, 'build.json'), Buffer.from(JSON.stringify({
        format: 'whale-data-editor-build', version: 1, root: snapshot.identity.root, head: snapshot.identity.head,
        fingerprint: snapshot.fingerprint, created: new Date().toISOString(), files,
      }, null, 2) + '\n'))
      await syncDirectory(staging)
      await fs.rename(staging, output)
      await syncDirectory(parent)
      return output
    } catch (e) {
      if (!contained(parent, staging) || !samePath(await fs.realpath(staging), staging)) throw new Error('构建临时产物路径变化，停止清理')
      await fs.rm(staging, { recursive: true, force: true })
      throw e
    }
  }
  private async validateCandidate(snapshot: Snapshot, documents: Record<DataTable, DataDocument>, mode: Mode): Promise<{ source: Map<string, Buffer>; output?: string }> {
    for (const table of TABLES) {
      const issues = validateDocument(documents[table], table)
      if (issues.length) throw new RepositoryError(`候选数据契约失败：${issues.map(issue => issue.message).join('；')}`, issues)
    }
    const source = await this.sources(snapshot.identity.root)
    const base = await directory(snapshot.identity.root, `${AREA}/candidates`)
    const candidate = join(base, randomUUID())
    await fs.mkdir(candidate)
    try {
      for (const [file, bytes] of source) {
        const parent = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
        if (parent) await directory(candidate, parent)
        await fs.writeFile(lexical(candidate, file), bytes, { flag: 'wx' })
      }
      for (const table of TABLES) await fs.writeFile(lexical(candidate, TABLE_FILES[table]), format(documents[table], snapshot.raw.get(TABLE_FILES[table])!))
      if (this.options.checker) {
        const result = await this.options.checker({ root: candidate, mode, documents: structuredClone(documents) })
        if (result && !result.ok) throw new RepositoryError(result.message || '候选检查失败', result.issues)
      } else {
        await this.dependencies(snapshot.identity, candidate)
        await this.candidateGit(snapshot.identity, candidate)
        for (const path of ['packages/core', 'packages/data', 'packages/ui', 'apps/desktop', 'apps/data-editor']) {
          await this.command(snapshot.identity, candidate, 'typescript/bin/tsc', ['--noEmit', '-p', `${path}/tsconfig.json`])
        }
        await this.command(snapshot.identity, candidate, 'tsx/dist/cli.mjs', ['tools/content-check.ts'])
        await this.command(snapshot.identity, candidate, 'vitest/vitest.mjs', ['run'], join(candidate, 'packages/core'))
        if (mode === 'build') {
          await this.command(snapshot.identity, candidate, 'electron-vite/bin/electron-vite.js', ['build'], join(candidate, 'apps/desktop'))
          await this.command(snapshot.identity, candidate, 'vite/bin/vite.js', ['build'], join(candidate, 'web'))
        }
      }
      const latest = await this.snapshot(snapshot.identity.root)
      await this.unchangedSources(snapshot.identity.root, source)
      if (latest.fingerprint !== snapshot.fingerprint) {
        throw new Error('检查期间项目源码或基线发生变化，拒绝过期候选')
      }
      return { source, ...(mode === 'build' ? { output: await this.retainBuild(snapshot, candidate) } : {}) }
    } finally { await this.removeCandidate(snapshot.identity.root, candidate) }
  }

  async save(root: string, token: string): Promise<EditorResult> {
    try {
      const identity = await this.identity(root)
      return await this.locked(identity, async () => {
        await this.recover(identity)
        const snapshot = await this.snapshot(identity.root)
        if (!snapshot.identity.writable) throw new Error('项目已切到只读分支')
        const plan = this.plans.get(token)
        this.plans.delete(token)
        if (!plan || plan.root !== identity.root || plan.expires < Date.now()) throw new Error('预览令牌不存在、已消费或已过期')
        if (plan.fingerprint !== snapshot.fingerprint) throw new Error('项目已变化，拒绝保存过期计划')
        const { source: sources } = await this.validateCandidate(snapshot, plan.documents, 'check')
        const journal: Journal = { version: 1, id: randomUUID(), root: identity.root, head: identity.head, created: new Date().toISOString(), state: 'prepared', files: [] }
        const backup = await directory(identity.root, `${AREA}/backups/${journal.id}`)
        const outputs = new Map<string, Buffer>()
        for (const table of TABLES) {
          if (JSON.stringify(snapshot.documents[table]) === JSON.stringify(plan.documents[table])) continue
          const file = TABLE_FILES[table]
          const before = snapshot.raw.get(file)!
          const after = format(plan.documents[table], before)
          const index = journal.files.length
          journal.files.push({ file, before: hash(before), after: hash(after), mode: (await fs.stat(await regular(identity.root, file))).mode })
          await durable(join(backup, `${index}.before`), before)
          await durable(join(backup, `${index}.after`), after)
          outputs.set(file, after)
        }
        if (!journal.files.length) throw new Error('预览没有实际数值改动')
        await this.fault('afterBackup')
        await this.journalWrite(identity.root, journal)
        try {
          await this.fault('afterJournal')
          await this.unchangedSources(identity.root, sources)
          if ((await this.snapshot(identity.root)).fingerprint !== snapshot.fingerprint) throw new Error('备份后项目发生变化，拒绝落盘')
          journal.state = 'writing'; await this.journalWrite(identity.root, journal)
          for (const entry of journal.files) {
            await this.fault('beforeWrite', entry.file)
            await replace(identity.root, entry.file, outputs.get(entry.file)!, entry.before, entry.mode)
            await this.fault('afterWrite', entry.file)
          }
          await this.fault('beforeCommit')
          const currentIdentity = await this.identity(identity.root)
          if (currentIdentity.head !== snapshot.identity.head || currentIdentity.branch !== snapshot.identity.branch || !currentIdentity.writable) throw new Error('落盘期间Git基线或分支变化')
          for (const entry of journal.files) if (hash(await read(identity.root, entry.file)) !== entry.after) throw new Error(`落盘期间目标被外部修改：${entry.file}`)
          journal.state = 'committed'; await this.journalWrite(identity.root, journal)
        } catch (e) {
          if (e instanceof SimulatedCrash) throw e
          try { await this.rollback(identity.root, journal) }
          catch (rollbackError) {
            journal.state = 'blocked'; await this.journalWrite(identity.root, journal)
            return { ok: false, backup, message: `写入未完成且恢复冲突，已停止：${failure(rollbackError).message}` }
          }
          return { ...failure(e), backup, message: `写入未完成，已恢复本次原文：${failure(e).message}` }
        }
        return { ok: true, backup, message: '检查通过，JSON参数已保存；原有未提交内容已备份。游戏需重载或重新构建。', project: (await this.snapshot(identity.root)).project }
      })
    } catch (e) { return failure(e) }
  }
  async restore(root: string): Promise<EditorResult> {
    try {
      const identity = await this.identity(root)
      return await this.locked(identity, async () => {
        await this.recover(identity)
        const journal = (await this.journals(identity.root)).reverse().find(j => j.state === 'committed')
        if (!journal) throw new Error('没有可恢复的已保存事务')
        if (journal.head !== identity.head) throw new Error('HEAD已变化，拒绝跨基线恢复')
        await this.rollback(identity.root, journal, true)
        return { ok: true, backup: lexical(identity.root, `${AREA}/backups/${journal.id}`), message: '已恢复本次保存前的原文，包含当时未提交改动。', project: (await this.snapshot(identity.root)).project }
      })
    } catch (e) { return failure(e) }
  }
  private async run(root: string, mode: Mode): Promise<EditorResult> {
    try {
      const identity = await this.identity(root)
      return await this.locked(identity, async () => {
        await this.recover(identity)
        const snapshot = await this.snapshot(identity.root)
        const { output } = await this.validateCandidate(snapshot, snapshot.documents, mode)
        return { ok: true, ...(output ? { output } : {}), message: output
          ? `桌面与网页构建通过，产物已保留：${output}（desktop/out 与 web/dist）；未覆盖已安装游戏。`
          : '隔离源码内容、类型及完整core测试通过。', project: snapshot.project }
      })
    } catch (e) { return failure(e) }
  }
  check(root: string): Promise<EditorResult> { return this.run(root, 'check') }
  build(root: string): Promise<EditorResult> { return this.run(root, 'build') }
}

export function createDataEditorRepository(options: DataEditorRepositoryOptions = {}): DataEditorRepository {
  return new DataEditorRepository(options)
}
