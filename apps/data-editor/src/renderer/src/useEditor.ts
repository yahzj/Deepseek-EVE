import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataEditorApi, EditorIssue, EditorPlan, EditorProject, EditorResult, InputBuffer, NumericEdit } from './model'
import { applyEdits, bufferIssues, commitBuffers, editKey, emptyDraft, isProjectWritable, previewKey, recordEdits, redoDraft, undoDraft } from './model'

interface Preview { key: string; plan: EditorPlan }
export function useEditor(api: DataEditorApi, demo: boolean) {
  const [project, setProject] = useState<EditorProject | null>(null)
  const projectRef = useRef(project)
  const [draft, setDraft] = useState(emptyDraft)
  const draftRef = useRef(draft)
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewRef = useRef<Preview | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [busy, setBusy] = useState('')
  const busyRef = useRef(false)
  const [issues, setIssues] = useState<EditorIssue[]>([])
  const [notice, setNotice] = useState('尚未加载项目')
  const [result, setResult] = useState<EditorResult | null>(null)
  const [refreshRequired, setRefreshRequired] = useState(false)
  const [focusError, setFocusError] = useState(0)
  const sequence = useRef(0)
  const alive = useRef(true)
  const dirty = draft.edits.length > 0 || Object.keys(draft.buffers).length > 0
  const writable = !!project && isProjectWritable(project, demo) && !refreshRequired

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; sequence.current++ }
  }, [])

  const invalidate = useCallback(() => {
    sequence.current++
    previewRef.current = null
    setPreview(null)
    setPreviewBusy(false)
  }, [])

  const replaceDraft = useCallback((next: typeof draft) => {
    invalidate()
    draftRef.current = next
    setDraft(next)
    api.setDirty(next.edits.length > 0 || Object.keys(next.buffers).length > 0)
    setIssues([])
    setResult(null)
  }, [api, invalidate])

  const acceptProject = useCallback((next: EditorProject) => {
    projectRef.current = next
    setProject(next)
    setRefreshRequired(false)
    replaceDraft(emptyDraft())
    setNotice(isProjectWritable(next, demo) ? '项目已加载' : '项目已加载，只读')
  }, [demo, replaceDraft])

  const fail = useCallback((message: string, nextIssues: EditorIssue[] = []) => {
    setIssues(nextIssues.length ? nextIssues : [{ message }])
    setNotice(message)
    setFocusError((value) => value + 1)
  }, [])

  async function load(root: string): Promise<void> {
    if (!root.trim() || busyRef.current) return
    if ((draftRef.current.edits.length || Object.keys(draftRef.current.buffers).length) && !window.confirm('放弃未保存草稿并重新加载项目？')) return
    busyRef.current = true
    setBusy('加载项目')
    invalidate()
    try { acceptProject(await api.openProject(root.trim())) }
    catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    finally { busyRef.current = false; if (alive.current) setBusy('') }
  }

  async function choose(): Promise<void> {
    if (busyRef.current || demo) return
    try { const root = await api.chooseProject(); if (root) await load(root) }
    catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }

  const requestPreview = useCallback(async (snapshot: EditorProject, edits: NumericEdit[]): Promise<Preview | null> => {
    const ticket = ++sequence.current
    const key = previewKey(snapshot, edits)
    setPreviewBusy(true)
    try {
      const plan = await api.preview(snapshot.root, snapshot.fingerprint, edits)
      if (!alive.current || ticket !== sequence.current || !projectRef.current || key !== previewKey(projectRef.current, draftRef.current.edits) || Object.keys(draftRef.current.buffers).length) return null
      const next = { key, plan }
      previewRef.current = next
      setPreview(next)
      setIssues(plan.issues)
      setNotice(plan.issues.length ? '预览未通过校验，草稿已保留' : `预览已更新，共 ${plan.changes.length} 项变更`)
      return next
    } catch (error) {
      if (ticket === sequence.current && alive.current) fail(error instanceof Error ? error.message : String(error))
      return null
    } finally {
      if (ticket === sequence.current && alive.current) setPreviewBusy(false)
    }
  }, [api, fail])

  useEffect(() => {
    if (!project || !writable || busy || !draft.edits.length || Object.keys(draft.buffers).length) return
    const timer = window.setTimeout(() => { void requestPreview(project, draft.edits) }, 350)
    return () => window.clearTimeout(timer)
  }, [project, draft.edits, draft.buffers, writable, busy, requestPreview])

  const canEdit = (): boolean => !!projectRef.current && isProjectWritable(projectRef.current, demo) && !busyRef.current && !refreshRequired
  function buffer(input: InputBuffer): void {
    if (!canEdit()) return
    const key = editKey({ ...input.row, path: input.field.path })
    replaceDraft({ ...draftRef.current, buffers: { ...draftRef.current.buffers, [key]: input } })
  }
  function commit(key?: string): boolean {
    if (!canEdit()) return false
    const current = draftRef.current
    const selected = key ? { ...current, buffers: current.buffers[key] ? { [key]: current.buffers[key]! } : {} } : current
    const committed = commitBuffers(projectRef.current!.rows, selected)
    if (committed.issues.length) { fail('输入未通过校验', committed.issues); return false }
    const remaining = { ...current.buffers }
    if (key) delete remaining[key]
    else for (const name of Object.keys(remaining)) delete remaining[name]
    replaceDraft({ ...committed.draft, buffers: remaining })
    return true
  }
  function cancelBuffer(key: string): void {
    if (!canEdit()) return
    const buffers = { ...draftRef.current.buffers }
    delete buffers[key]
    replaceDraft({ ...draftRef.current, buffers })
  }
  function change(edits: NumericEdit[]): void {
    if (!canEdit()) return
    replaceDraft(recordEdits(draftRef.current, applyEdits(projectRef.current!.rows, draftRef.current.edits, edits)))
  }
  function revert(key: string): void {
    if (!canEdit()) return
    replaceDraft(recordEdits(draftRef.current, draftRef.current.edits.filter((edit) => editKey(edit) !== key)))
  }
  function undo(): void { if (canEdit()) replaceDraft(undoDraft(draftRef.current)) }
  function redo(): void { if (canEdit()) replaceDraft(redoDraft(draftRef.current)) }
  function discard(): void {
    if (canEdit() && window.confirm('放弃全部未保存草稿？')) replaceDraft(emptyDraft())
  }

  async function refreshPreview(): Promise<void> {
    if (!canEdit() || !commit()) return
    await requestPreview(projectRef.current!, draftRef.current.edits)
  }
  async function save(): Promise<void> {
    if (!canEdit() || !commit() || !draftRef.current.edits.length) return
    busyRef.current = true
    setBusy('校验并保存')
    const snapshot = projectRef.current!
    try {
      // 保存再取一次最新预览，后端 token 是唯一写入依据，不用本地草稿冒充保存计划。
      const latest = await requestPreview(snapshot, draftRef.current.edits)
      if (!latest || latest.plan.issues.length || !latest.plan.token) { fail('保存未执行，请处理预览校验', latest?.plan.issues); return }
      if (latest !== previewRef.current || latest.key !== previewKey(projectRef.current!, draftRef.current.edits)) { fail('预览已过期，请重新校验'); return }
      const saved = await api.save(snapshot.root, latest.plan.token)
      if (!saved.ok) { invalidate(); setResult(saved); fail(saved.message, saved.issues); return }
      replaceDraft(emptyDraft())
      try {
        const refreshed = saved.project ?? await api.openProject(snapshot.root)
        acceptProject(refreshed)
        setResult(saved)
        setNotice(saved.message)
      } catch (error) {
        setRefreshRequired(true)
        setResult(saved)
        fail(`源码已保存，但刷新失败。重新加载后才能继续编辑：${error instanceof Error ? error.message : String(error)}`)
      }
    } catch (error) { invalidate(); fail(error instanceof Error ? error.message : String(error)) }
    finally { busyRef.current = false; if (alive.current) setBusy('') }
  }

  async function action(kind: 'check' | 'build' | 'restore'): Promise<void> {
    const snapshot = projectRef.current
    if (!snapshot || busyRef.current || demo) return
    if (kind === 'restore' && !isProjectWritable(snapshot, demo)) return
    if (kind !== 'restore' && (draftRef.current.edits.length || Object.keys(draftRef.current.buffers).length)) { fail('请先保存或放弃草稿，再检查磁盘项目'); return }
    if (kind === 'restore' && !window.confirm('恢复最近一次可恢复备份？当前草稿将丢弃，外部冲突由后端核对。')) return
    if (kind === 'build' && !window.confirm('对所选项目执行固定构建命令？将运行该项目的构建脚本。')) return
    if (kind === 'check' && !window.confirm('对所选项目执行固定校验命令？将运行该项目的校验脚本。')) return
    busyRef.current = true
    setBusy(kind === 'check' ? '检查项目' : kind === 'build' ? '构建项目' : '恢复备份')
    invalidate()
    try {
      const response = await api[kind](snapshot.root)
      setResult(response)
      if (!response.ok) { fail(response.message, response.issues); return }
      if (kind === 'restore') {
        replaceDraft(emptyDraft())
        try { acceptProject(response.project ?? await api.openProject(snapshot.root)) }
        catch (error) { setRefreshRequired(true); fail(`备份已恢复，但刷新失败：${String(error)}`); return }
      }
      setResult(response)
      setNotice(response.message)
      setIssues(response.issues ?? [])
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    finally { busyRef.current = false; if (alive.current) setBusy('') }
  }

  async function exportChanges(): Promise<void> {
    if (!previewRef.current || busyRef.current || demo) return
    try {
      const ok = await api.exportChanges(previewRef.current.plan.changes)
      setNotice(ok ? '变更记录已导出' : '未导出变更记录')
    } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  }

  const latest = project && preview?.key === previewKey(project, draft.edits) && !Object.keys(draft.buffers).length ? preview.plan : null
  return { project, draft, dirty, writable, busy, preview: latest, previewBusy, issues: [...bufferIssues(draft), ...issues].filter((issue, index, all) => all.findIndex((item) => JSON.stringify(item) === JSON.stringify(issue)) === index), notice, result, refreshRequired, focusError,
    load, choose, buffer, commit, cancelBuffer, change, revert, undo, redo, discard, refreshPreview, save, action, exportChanges, fail }
}
