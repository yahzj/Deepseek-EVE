import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  CheckCheck, ChevronDown, ChevronUp, CircleCheck, CircleHelp, Database,
  FileCheck2, FolderOpen, GitBranch, GitCompareArrows, History, Info, ListFilter, LoaderCircle,
  LockKeyhole, Package, Redo2, RefreshCw, RotateCcw, Save, Search, Settings2, ShieldCheck,
  Ship, SlidersHorizontal, SquareArrowOutUpRight, Undo2, X, TriangleAlert, Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { BatchMode, DataEditorApi, DataTable, EditorChange, EditorIssue, EditorRow, NumericField, ValueMode } from './model'
import { batchEdits, editKey, effectiveValue, fieldUnit, formatValue, inputId, parseValue, readValue, rowKey } from './model'
import { useEditor } from './useEditor'

const TABLES: { key: DataTable; label: string; icon: LucideIcon }[] = [
  { key: 'ships', label: '舰船', icon: Ship },
  { key: 'modules', label: '装备', icon: Wrench },
  { key: 'plugs', label: '舰船插件', icon: SlidersHorizontal },
  { key: 'items', label: '物品 / 无人机', icon: Package },
  { key: 'market', label: '商品', icon: Database },
]
const tableName = (table: DataTable): string => TABLES.find((item) => item.key === table)?.label ?? table
type Editor = ReturnType<typeof useEditor>

function IconButton({ icon: Icon, label, disabled, onClick, className = '' }: { icon: LucideIcon; label: string; disabled?: boolean; onClick: () => void; className?: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon size={16} aria-hidden="true" /></button>
}

function NumberField({ row, field, editor, mode, located }: { row: EditorRow; field: NumericField; editor: Editor; mode: ValueMode; located?: boolean }) {
  const key = editKey({ ...row, path: field.path })
  const id = inputId(row, field.path)
  const buffer = editor.draft.buffers[key]
  const value = effectiveValue(row, field.path, editor.draft.edits)
  const original = readValue(row.values, field.path)
  const changed = value !== original
  const inputMode = buffer?.mode ?? mode
  const issue = editor.issues.find((item) => item.table === row.table && item.id === row.id && item.path === field.path)
  const error = buffer ? parseValue(buffer.text, field, buffer.mode).error : issue?.message
  const editable = editor.writable && field.writable && !editor.busy
  const bounds = [field.min !== undefined ? `≥ ${formatValue(field.min, field, inputMode)}` : '', field.max !== undefined ? `≤ ${formatValue(field.max, field, inputMode)}` : '', field.integer ? '整数' : ''].filter(Boolean).join('，')
  return <div className={`number-field${changed ? ' is-changed' : ''}${error ? ' is-invalid' : ''}${located ? ' is-located' : ''}`}>
    <div className="field-label"><label htmlFor={id} title={field.readonlyReason}>{field.label}</label><code title={field.readonlyReason ? `${field.path}\n${field.readonlyReason}` : field.path}>{field.path}</code></div>
    <div className="field-edit">
      <div className="number-wrap">
        <input id={id} type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
          value={buffer?.text ?? (value === undefined ? '' : formatValue(value, field, inputMode))}
          placeholder={value === undefined ? '未设置' : undefined}
          readOnly={!editable} aria-invalid={!!error} aria-describedby={`${id}-meta${error ? ` ${id}-error` : ''}`}
          onChange={(event) => editor.buffer({ row, field, mode: inputMode, text: event.target.value })}
          onBlur={() => { if (buffer) editor.commit(key) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); editor.commit(key) }
            if (event.key === 'Escape') { event.preventDefault(); editor.cancelBuffer(key) }
          }} />
        <span>{fieldUnit(field, inputMode)}</span>
      </div>
      {changed ? <IconButton icon={RotateCcw} label={`还原 ${field.label}`} disabled={!editable} onClick={() => editor.revert(key)} /> : <span className="field-lock" title={field.readonlyReason ?? (field.writable ? bounds || '直接数值' : '继承或派生字段只读')}>{field.writable ? null : <LockKeyhole size={13} aria-hidden="true" />}</span>}
    </div>
    <div className="field-meta" id={`${id}-meta`}>
      {field.percent ? <span>原值 <code>{buffer && !error ? String(parseValue(buffer.text, field, buffer.mode).value) : value === undefined ? '未设置' : String(value)}</code></span> : null}
      {changed ? <span>基线 <code>{formatValue(original, field, inputMode)}{original === undefined ? '' : fieldUnit(field, inputMode)}</code></span> : null}
      {!field.writable ? <span title={field.readonlyReason}>{value === undefined ? '未设置 · 只读' : '继承 / 派生 · 只读'}</span> : bounds ? <span>{bounds}</span> : null}
    </div>
    {error ? <p id={`${id}-error`} className="field-error">{error}</p> : null}
  </div>
}

function BatchPanel({ rows, editor, mode }: { rows: EditorRow[]; editor: Editor; mode: ValueMode }) {
  const fields = rows[0]?.fields.filter((field) => field.writable && rows.every((row) => row.fields.some((item) => item.path === field.path && item.writable))) ?? []
  const [path, setPath] = useState('')
  const [operation, setOperation] = useState<BatchMode>('set')
  const [operand, setOperand] = useState('')
  const [shown, setShown] = useState(false)
  const [batchMode, setBatchMode] = useState(mode)
  const chosen = fields.find((field) => field.path === path) ?? fields[0]
  const signature = rows.map(rowKey).join('|')
  useEffect(() => { setShown(false) }, [signature, path, operation, operand, batchMode, editor.draft.edits])
  const planned = chosen ? batchEdits(rows, editor.draft.edits, chosen.path, operation, operand, batchMode) : { edits: [], issues: [] }
  const locked = !editor.writable || !!editor.busy || !!Object.keys(editor.draft.buffers).length
  return <section className="batch-panel" aria-label="批量调整">
    <header><Settings2 size={15} aria-hidden="true" /><h3>批量调整</h3><span>{rows.length} 个条目</span></header>
    <div className="batch-controls">
      <label>字段<select value={chosen?.path ?? ''} disabled={locked || !fields.length} onChange={(event) => setPath(event.target.value)}>{fields.map((field) => <option key={field.path} value={field.path}>{field.label} · {field.path}</option>)}</select></label>
      <label>操作<select value={operation} disabled={locked} onChange={(event) => setOperation(event.target.value as BatchMode)}><option value="set">设为</option><option value="add">增加</option><option value="subtract">减少</option><option value="multiply">乘倍率</option></select></label>
      <label>{operation === 'multiply' ? '倍率' : '数值'}<div className="number-wrap"><input type="text" inputMode="decimal" value={operand} disabled={locked || !chosen} onChange={(event) => setOperand(event.target.value)} /><span>{operation === 'multiply' ? '倍' : chosen ? fieldUnit(chosen, batchMode) : ''}</span></div></label>
    </div>
    <div className="batch-actions">
      {chosen?.percent && operation !== 'multiply' ? <div className="segmented" role="group" aria-label="批量数值单位"><button type="button" aria-pressed={batchMode === 'display'} disabled={locked} onClick={() => setBatchMode('display')}>%</button><button type="button" aria-pressed={batchMode === 'raw'} disabled={locked} onClick={() => setBatchMode('raw')}>原值</button></div> : <span />}
      <button type="button" className="button" disabled={locked || !chosen || !operand.trim()} onClick={() => setShown(true)}><ListFilter size={14} aria-hidden="true" />预览批量</button>
      <button type="button" className="button primary" disabled={locked || !shown || !!planned.issues.length || !planned.edits.length} onClick={() => { editor.change(planned.edits); setShown(false) }}><CheckCheck size={14} aria-hidden="true" />应用草稿</button>
    </div>
    {shown ? planned.issues.length ? <div className="batch-errors" role="alert">{planned.issues.map((issue, index) => <p key={index}>{rows.find((row) => row.id === issue.id)?.name}：{issue.message}</p>)}</div> : <div className="batch-preview"><table><thead><tr><th>条目</th><th>当前原值</th><th>拟改原值</th></tr></thead><tbody>{planned.edits.map((edit) => {
      const row = rows.find((item) => item.id === edit.id)!
      return <tr key={rowKey(row)}><td>{row.name}</td><td>{formatValue(effectiveValue(row, edit.path, editor.draft.edits))}</td><td>{edit.value}</td></tr>
    })}</tbody></table></div> : null}
  </section>
}

function Compare({ rows, editor, mode }: { rows: EditorRow[]; editor: Editor; mode: ValueMode }) {
  const fields = [...new Map(rows.flatMap((row) => row.fields.map((field) => [field.path, field] as const))).values()]
  return <div className="comparison scroll-region" tabIndex={0} aria-label="条目对比表"><table><thead><tr><th>字段</th>{rows.map((row) => <th key={rowKey(row)}><span>{row.name}</span><code>{row.id}</code></th>)}</tr></thead><tbody>{fields.map((field) => {
    const values = rows.map((row) => effectiveValue(row, field.path, editor.draft.edits))
    const different = values.some((value) => value !== values[0])
    return <tr key={field.path} className={different ? 'is-different' : ''}><th>{field.label}<code>{field.path}</code></th>{rows.map((row, index) => {
      const own = row.fields.find((item) => item.path === field.path)
      return <td key={rowKey(row)} className={values[index] !== readValue(row.values, field.path) ? 'is-changed' : ''}>{!own ? <span className="muted">无此字段</span> : <><span>{formatValue(values[index], own, mode)}</span>{values[index] !== undefined ? <small>{fieldUnit(own, mode)}</small> : null}{own.percent && mode === 'display' && values[index] !== undefined ? <code className="raw">原值 {values[index]}</code> : null}</>}</td>
    })}</tr>
  })}</tbody></table></div>
}

function ChangeTable({ changes, project, onLocate }: { changes: EditorChange[]; project: Editor['project']; onLocate: (issue: EditorIssue) => void }) {
  return <div className="change-table scroll-region"><table><thead><tr><th>条目</th><th>字段</th><th>旧原值</th><th>新原值</th><th>来源</th><th>文件</th></tr></thead><tbody>{changes.map((change, index) => <tr key={`${editKey(change)}-${index}`}>
    <td><button type="button" className="text-link" onClick={() => onLocate({ ...change, message: '' })}>{project?.rows.find((row) => row.table === change.table && row.id === change.id)?.name ?? change.id}</button><code>{change.id}</code></td>
    <td><code>{change.path}</code></td><td>{formatValue(change.before)}</td><td className="is-changed">{change.value}</td><td>{change.linked ? <span className="linked">联动</span> : '直接'}</td><td><code title={change.file}>{change.file}</code></td>
  </tr>)}</tbody></table></div>
}

export default function App({ api, demo }: { api: DataEditorApi; demo: boolean }) {
  const editor = useEditor(api, demo)
  const [root, setRoot] = useState('H:/大鲸鱼/Deepseek-EVE-zero')
  const [table, setTable] = useState<DataTable>('ships')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [tier, setTier] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [selection, setSelection] = useState<string[]>([])
  const [active, setActive] = useState('')
  const [anchor, setAnchor] = useState('')
  const [view, setView] = useState<'edit' | 'compare'>('edit')
  const [mode, setMode] = useState<ValueMode>('display')
  const [bottomTab, setBottomTab] = useState<'changes' | 'validation'>('changes')
  const [bottomOpen, setBottomOpen] = useState(true)
  const [located, setLocated] = useState<EditorIssue | null>(null)
  const issueRef = useRef<HTMLDivElement>(null)
  const allRef = useRef<HTMLInputElement>(null)
  const demoLoaded = useRef(false)
  const rows = editor.project?.rows ?? []
  const tableRows = useMemo(() => rows.filter((row) => row.table === table), [rows, table])
  const categories = [...new Set(tableRows.map((row) => row.category))].sort()
  const tiers = [...new Set(tableRows.map((row) => row.tier).filter((value): value is number => value !== undefined))].sort((a, b) => a - b)
  const editedKeys = useMemo(() => new Set([...editor.draft.edits.map(rowKey), ...Object.values(editor.draft.buffers).map((buffer) => rowKey(buffer.row))]), [editor.draft])
  const filtered = useMemo(() => tableRows.filter((row) => (!query.trim() || `${row.name} ${row.id} ${row.category}`.toLowerCase().includes(query.trim().toLowerCase())) && (!category || row.category === category) && (!tier || (tier === 'unset' ? row.tier === undefined : row.tier === Number(tier))) && (!changedOnly || editedKeys.has(rowKey(row)))), [tableRows, query, category, tier, changedOnly, editedKeys])
  const selected = tableRows.filter((row) => selection.includes(rowKey(row)))
  const focused = tableRows.find((row) => rowKey(row) === active) ?? selected[0]
  const groups = focused ? [...new Set(focused.fields.map((field) => field.group))] : []
  const allChecked = filtered.length > 0 && filtered.every((row) => selection.includes(rowKey(row)))
  const hiddenSelected = selected.filter((row) => !filtered.includes(row)).length
  const allow = editor.writable && !editor.busy
  const readyToSave = allow && !!editor.draft.edits.length && !Object.keys(editor.draft.buffers).length && !!editor.preview?.token && !editor.previewBusy && !editor.issues.length

  useEffect(() => {
    if (demo && !demoLoaded.current) { demoLoaded.current = true; void editor.load('mock://readonly') }
  }, [demo, editor.load])
  useEffect(() => { if (editor.project) setRoot(editor.project.root) }, [editor.project?.root])
  useEffect(() => {
    setSelection((previous) => previous.filter((key) => rows.some((row) => rowKey(row) === key)))
  }, [editor.project])
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = !allChecked && filtered.some((row) => selection.includes(rowKey(row)))
  }, [filtered, selection, allChecked])
  useEffect(() => {
    if (!editor.focusError) return
    setBottomTab('validation')
    setBottomOpen(true)
    requestAnimationFrame(() => issueRef.current?.focus())
  }, [editor.focusError])
  useEffect(() => {
    if (!located || !focused || located.id !== focused.id) return
    requestAnimationFrame(() => {
      const target = located.path ? document.getElementById(inputId(focused, located.path)) : document.getElementById('inspector-heading')
      target?.scrollIntoView({ block: 'nearest' })
      target?.focus()
    })
  }, [located, focused, view])
  useEffect(() => {
    if (!demo) return
    const close = (event: BeforeUnloadEvent): void => { if (editor.dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', close)
    return () => window.removeEventListener('beforeunload', close)
  }, [editor.dirty, demo])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void editor.save(); return }
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable=true]')) return
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? editor.redo() : editor.undo() }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo() }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [editor.save, editor.undo, editor.redo])

  function switchTable(next: DataTable): void { setTable(next); setCategory(''); setTier(''); setSelection([]); setActive(''); setAnchor(''); setLocated(null) }
  function locate(issue: EditorIssue): void {
    const row = rows.find((item) => item.table === issue.table && item.id === issue.id)
    if (!row) { issueRef.current?.focus(); return }
    setTable(row.table); setCategory(''); setTier(''); setQuery(''); setChangedOnly(false)
    setSelection([rowKey(row)]); setActive(rowKey(row)); setView('edit'); setLocated({ ...issue })
  }
  function pick(row: EditorRow, multi: boolean, range: boolean): void {
    const key = rowKey(row)
    if (range && anchor) {
      const start = filtered.findIndex((item) => rowKey(item) === anchor)
      const end = filtered.indexOf(row)
      if (start >= 0 && end >= 0) {
        setSelection((previous) => [...new Set([...previous, ...filtered.slice(Math.min(start, end), Math.max(start, end) + 1).map(rowKey)])])
        setActive(key); return
      }
    }
    setSelection((previous) => multi ? previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key] : [key])
    setActive(key); setAnchor(key); setLocated(null)
  }
  function selectAll(): void { setSelection((previous) => allChecked ? previous.filter((key) => !filtered.some((row) => rowKey(row) === key)) : [...new Set([...previous, ...filtered.map(rowKey)])]); if (!active && filtered[0]) setActive(rowKey(filtered[0])) }
  function rowKeyboard(event: ReactKeyboardEvent<HTMLTableRowElement>, row: EditorRow): void {
    if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); pick(row, event.ctrlKey || event.metaKey || event.key === ' ', event.shiftKey) }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const target = filtered[filtered.indexOf(row) + (event.key === 'ArrowDown' ? 1 : -1)]
      if (target) { pick(target, false, event.shiftKey); document.getElementById(`row-${encodeURIComponent(rowKey(target))}`)?.focus() }
    }
  }
  const load = (event: FormEvent): void => { event.preventDefault(); void editor.load(root) }
  const issues = editor.issues
  const warnings = [...new Set([...(editor.project?.warnings ?? []), ...(editor.preview?.warnings ?? [])])]
  const localChanges: EditorChange[] = editor.draft.edits.map((edit) => ({ ...edit, before: readValue(rows.find((row) => row.table === edit.table && row.id === edit.id)?.values ?? {}, edit.path), file: '待后端预览' }))
  const changes = editor.preview?.changes ?? localChanges

  return <div className={`editor-shell${bottomOpen ? '' : ' is-bottom-collapsed'}`}>
    <header className="app-toolbar">
      <div className="brand"><Database size={22} aria-hidden="true" /><div><strong>大鲸鱼 · 数据编辑器</strong><span>静态参数</span></div></div>
      <div className="history-tools"><IconButton icon={Undo2} label="撤销草稿" disabled={!allow || (!editor.draft.past.length && !Object.keys(editor.draft.buffers).length)} onClick={editor.undo} /><IconButton icon={Redo2} label="重做草稿" disabled={!allow || !editor.draft.future.length || !!Object.keys(editor.draft.buffers).length} onClick={editor.redo} /><span className="toolbar-divider" /><IconButton icon={RotateCcw} label="放弃全部草稿" disabled={!allow || !editor.dirty} onClick={editor.discard} /></div>
      <div className="toolbar-actions"><button type="button" className="button" disabled={!editor.project || !!editor.busy || demo || editor.dirty} onClick={() => void editor.action('check')}><FileCheck2 size={15} aria-hidden="true" />检查项目</button><button type="button" className="button" disabled={!editor.project || !!editor.busy || demo || editor.dirty} onClick={() => void editor.action('build')}><Wrench size={15} aria-hidden="true" />构建</button><button type="button" className="button primary" disabled={!readyToSave} onClick={() => void editor.save()}><Save size={15} aria-hidden="true" />保存{editor.draft.edits.length ? ` (${editor.draft.edits.length})` : ''}</button></div>
    </header>
    <div className="project-bar">
      <form onSubmit={load}><FolderOpen size={16} aria-hidden="true" /><label className="sr-only" htmlFor="project-root">项目绝对路径</label><input id="project-root" value={root} disabled={!!editor.busy || demo} onChange={(event) => setRoot(event.target.value)} /><IconButton icon={FolderOpen} label="选择项目文件夹" disabled={!!editor.busy || demo} onClick={() => void editor.choose()} /><button type="submit" className="button" disabled={!root.trim() || !!editor.busy || demo}>加载</button></form>
      {editor.project ? <div className="project-meta"><span title={`分支 ${editor.project.branch}`}><GitBranch size={13} aria-hidden="true" />{editor.project.branch}</span><code title={editor.project.head}>{editor.project.head.slice(0, 8)}</code><span className={editor.writable ? 'writable' : 'readonly'}>{editor.writable ? <ShieldCheck size={13} aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}{editor.writable ? '可编辑' : '只读'}</span><IconButton icon={RefreshCw} label="重新加载磁盘数据" disabled={!!editor.busy || demo} onClick={() => void editor.load(editor.project!.root)} /></div> : null}
    </div>
    <aside className="table-sidebar" aria-label="数据表与检索">
      <label className="search-box"><Search size={15} aria-hidden="true" /><input aria-label="搜索名称、ID 或类别" placeholder="搜索名称 / ID" value={query} onChange={(event) => setQuery(event.target.value)} />{query ? <button type="button" aria-label="清空搜索" title="清空搜索" onClick={() => setQuery('')}><X size={13} aria-hidden="true" /></button> : null}</label>
      <div className="sidebar-label">数据表</div>
      <nav>{TABLES.map(({ key, label, icon: Icon }) => <button type="button" key={key} className={table === key ? 'is-active' : ''} aria-current={table === key ? 'page' : undefined} onClick={() => switchTable(key)}><Icon size={17} aria-hidden="true" /><span>{label}</span><small>{rows.filter((row) => row.table === key).length}</small></button>)}</nav>
      <div className="sidebar-section"><label className="check-label"><input type="checkbox" checked={changedOnly} onChange={(event) => setChangedOnly(event.target.checked)} />仅显示草稿变更<span>{editedKeys.size}</span></label></div>
      <div className="sidebar-foot"><span><Database size={14} aria-hidden="true" />JSON 权威参数</span><span>{demo ? '开发演示 · 无写入桥接' : editor.project ? editor.writable ? '已连接项目' : '只读项目' : '等待选择项目'}</span><button type="button" className="text-link" disabled={!editor.writable || !!editor.busy || demo} onClick={() => void editor.action('restore')}><History size={14} aria-hidden="true" />恢复最近备份</button></div>
    </aside>
    <section className="record-pane" aria-label="条目列表">
      <header className="pane-heading"><h2>{tableName(table)}</h2><span>{filtered.length} / {tableRows.length}</span></header>
      <div className="list-filters"><label><span className="sr-only">类别筛选</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部类别</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="sr-only">档位筛选</span><select value={tier} onChange={(event) => setTier(event.target.value)}><option value="">全部档位</option>{tiers.map((item) => <option key={item} value={item}>T{item}</option>)}{tableRows.some((row) => row.tier === undefined) ? <option value="unset">未设置档位</option> : null}</select></label></div>
      <div className="selection-bar"><span>已选 <b>{selected.length}</b>{hiddenSelected ? ` · 筛选外 ${hiddenSelected}` : ''}</span><button type="button" className="text-link" disabled={!selected.length} onClick={() => { setSelection([]); setActive('') }}>清空</button></div>
      <div className="records-scroll scroll-region"><table className="records"><thead><tr><th className="select-column"><input ref={allRef} type="checkbox" checked={allChecked} aria-label="选择当前筛选全部条目" onChange={selectAll} /></th><th>名称 / ID</th><th>类别</th><th>档</th></tr></thead><tbody>{filtered.map((row) => {
        const key = rowKey(row), chosen = selection.includes(key)
        return <tr id={`row-${encodeURIComponent(key)}`} key={key} tabIndex={0} aria-selected={chosen} className={`${chosen ? 'is-selected' : ''}${active === key ? ' is-focused' : ''}`} onClick={(event) => pick(row, event.ctrlKey || event.metaKey, event.shiftKey)} onKeyDown={(event) => rowKeyboard(event, row)}>
          <td className="select-column" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={chosen} aria-label={`选择 ${row.name}`} onChange={() => pick(row, true, false)} /></td>
          <td><span className="record-name">{row.name}{editedKeys.has(key) ? <span className="draft-dot" aria-label="有草稿变更" title="有草稿变更" /> : null}</span><code>{row.id}</code></td><td><span className="category" title={row.category}>{row.category}</span></td><td>{row.tier === undefined ? <span className="muted">未设</span> : `T${row.tier}`}</td>
        </tr>
      })}</tbody></table>{!filtered.length ? <div className="empty-state"><Search size={24} aria-hidden="true" /><strong>{editor.project ? '没有匹配条目' : '未加载项目'}</strong>{editor.project ? <button type="button" className="text-link" onClick={() => { setQuery(''); setCategory(''); setTier(''); setChangedOnly(false) }}>清除筛选</button> : <button type="button" className="button" disabled={!!editor.busy} onClick={() => void editor.choose()}><FolderOpen size={15} aria-hidden="true" />选择项目</button>}</div> : null}</div>
    </section>
    <main className="inspector" aria-label="数值属性">
      <header className="inspector-toolbar"><div className="segmented" role="tablist" aria-label="属性视图"><button type="button" role="tab" aria-selected={view === 'edit'} onClick={() => setView('edit')}><Settings2 size={14} aria-hidden="true" />属性</button><button type="button" role="tab" aria-selected={view === 'compare'} disabled={selected.length < 2} onClick={() => setView('compare')}><GitCompareArrows size={14} aria-hidden="true" />对比 ({selected.length})</button></div><div className="segmented" role="group" aria-label="百分比显示单位"><button type="button" aria-pressed={mode === 'display'} onClick={() => setMode('display')}>%</button><button type="button" aria-pressed={mode === 'raw'} onClick={() => setMode('raw')}>原值</button></div></header>
      {issues.length ? <div className="error-summary" role="alert" tabIndex={-1} ref={issueRef} aria-labelledby="error-title"><h3 id="error-title"><TriangleAlert size={15} aria-hidden="true" />校验未通过 · {issues.length} 项</h3><ul>{issues.slice(0, 4).map((issue, index) => <li key={index}><button type="button" onClick={() => locate(issue)}>{issue.id ? `${issue.id} · ` : ''}{issue.message}</button></li>)}</ul>{issues.length > 4 ? <button type="button" className="text-link" onClick={() => { setBottomOpen(true); setBottomTab('validation') }}>查看全部 {issues.length} 项</button> : null}</div> : null}
      <div className="inspector-scroll scroll-region">
        {focused ? <>
          <div className="record-heading"><div><span>{focused.category}{focused.tier === undefined ? '' : ` · T${focused.tier}`}</span><h2 id="inspector-heading" tabIndex={-1}>{focused.name}</h2><code>{focused.id}</code></div><span className="source-tag"><Info size={13} aria-hidden="true" />{focused.group}</span></div>
          {selected.length > 1 ? <BatchPanel rows={selected} editor={editor} mode={mode} /> : null}
          {view === 'compare' && selected.length > 1 ? <Compare rows={selected} editor={editor} mode={mode} /> : groups.length ? groups.map((group) => <section className="field-group" key={group}><h3>{group}<span>{focused.fields.filter((field) => field.group === group).length}</span></h3><div>{focused.fields.filter((field) => field.group === group).map((field) => <NumberField key={field.path} row={focused} field={field} editor={editor} mode={mode} located={located?.path === field.path && located.id === focused.id} />)}</div></section>) : <div className="empty-state"><LockKeyhole size={22} aria-hidden="true" /><strong>该条目没有可编辑数值</strong></div>}
        </> : <div className="empty-state"><Settings2 size={28} aria-hidden="true" /><strong>未选中条目</strong><span>{editor.project ? `${tableName(table)} · ${tableRows.length} 个条目` : '等待加载项目'}</span></div>}
      </div>
    </main>
    <section className="bottom-panel" aria-label="变更与校验">
      <header><div className="bottom-tabs" role="tablist" aria-label="结果视图"><button type="button" role="tab" aria-selected={bottomTab === 'changes'} onClick={() => { setBottomTab('changes'); setBottomOpen(true) }}><GitCompareArrows size={14} aria-hidden="true" />变更 <span>{changes.length}</span></button><button type="button" role="tab" aria-selected={bottomTab === 'validation'} onClick={() => { setBottomTab('validation'); setBottomOpen(true) }}><ShieldCheck size={14} aria-hidden="true" />校验 <span className={issues.length ? 'error-count' : ''}>{issues.length}</span></button></div><div className="bottom-tools"><span>{editor.previewBusy ? '更新预览中' : editor.preview ? '最新联动预览' : editor.dirty ? '草稿未预览' : '无草稿变更'}</span><IconButton icon={RefreshCw} label="更新联动预览" disabled={!allow || !editor.dirty || !!editor.busy || editor.previewBusy} onClick={() => void editor.refreshPreview()} /><IconButton icon={SquareArrowOutUpRight} label="导出最新变更记录" disabled={!editor.preview || editor.previewBusy || !!editor.busy || demo} onClick={() => void editor.exportChanges()} /><IconButton icon={bottomOpen ? ChevronDown : ChevronUp} label={bottomOpen ? '收起结果面板' : '展开结果面板'} onClick={() => setBottomOpen((value) => !value)} /></div></header>
      {bottomOpen ? bottomTab === 'changes' ? changes.length ? <ChangeTable changes={changes} project={editor.project} onLocate={locate} /> : <div className="bottom-empty"><CircleCheck size={17} aria-hidden="true" />无草稿变更</div> : <div className="validation-list scroll-region">{issues.map((issue, index) => <button type="button" key={index} className="validation-row error" onClick={() => locate(issue)}><TriangleAlert size={15} aria-hidden="true" /><span><strong>{issue.message}</strong><code>{[issue.table, issue.id, issue.path].filter(Boolean).join(' · ')}</code></span><SquareArrowOutUpRight size={13} aria-hidden="true" /></button>)}{warnings.map((warning) => <div className="validation-row warning" key={warning}><CircleHelp size={15} aria-hidden="true" /><span>{warning}</span></div>)}{editor.result ? <div className={`validation-row ${editor.result.ok ? 'success' : 'error'}`}><FileCheck2 size={15} aria-hidden="true" /><span>{editor.result.message}{editor.result.backup ? <code>备份：{editor.result.backup}</code> : null}</span></div> : null}{!issues.length && !warnings.length && !editor.result ? <div className="bottom-empty"><CircleCheck size={17} aria-hidden="true" />{editor.preview ? '预览校验通过' : '尚未运行项目检查'}</div> : null}</div> : null}
    </section>
    <footer className="status-bar"><span role="status">{editor.busy || editor.previewBusy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : issues.length ? <TriangleAlert size={13} aria-hidden="true" /> : <CircleCheck size={13} aria-hidden="true" />}{editor.busy || editor.notice}</span><span>{editor.dirty ? `${editor.draft.edits.length} 项草稿${Object.keys(editor.draft.buffers).length ? ` · ${Object.keys(editor.draft.buffers).length} 项待确认输入` : ''}` : '无未保存更改'}<span className="status-divider" />{editor.writable ? '写入源码' : '只读'}{demo ? ' · 演示数据' : ''}</span></footer>
  </div>
}
