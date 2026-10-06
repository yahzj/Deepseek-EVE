import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as model from './model'
import type { DataEditorApi, EditorPlan, EditorProject } from './model'
import type { useEditor } from './useEditor'

const row: model.EditorRow = { table: 'ships', id: 'A', name: 'A', category: '武装舰', group: 'ships', values: { cpu: 10 }, fields: [{ path: 'cpu', label: 'CPU', group: '装配', unit: '', min: 0, integer: true, writable: true }] }
const project: EditorProject = { root: 'H:/大鲸鱼/Deepseek-EVE-zero', branch: 'zero', head: 'head', fingerprint: 'base', writable: true, rows: [row], warnings: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

// 仅执行 renderer hook 与契约替身，不启动游戏或调用真实写入桥。
function harness(overrides: Partial<DataEditorApi> = {}) {
  const api: DataEditorApi = {
    chooseProject: vi.fn(async () => null),
    openProject: vi.fn(async () => structuredClone(project)),
    preview: vi.fn(async (_root: string, _fingerprint: string, edits: model.NumericEdit[]) => ({ token: 'latest', changes: edits.map((edit) => ({ ...edit, file: 'ships.json', before: 10 })), issues: [], warnings: [] })),
    save: vi.fn(async () => ({ ok: true, message: '已写入', project: { ...structuredClone(project), fingerprint: 'saved' } })),
    restore: vi.fn(async () => ({ ok: false, message: '未恢复' })),
    check: vi.fn(async () => ({ ok: true, message: '已检查' })),
    build: vi.fn(async () => ({ ok: true, message: '已构建' })),
    exportChanges: vi.fn(async () => true), setDirty: vi.fn(), ...overrides,
  }
  const values: unknown[] = [], refs: Array<{ current: unknown }> = []
  let stateCursor = 0, refCursor = 0
  const hooks = {
    useState: (initial: unknown) => {
      const index = stateCursor++
      if (!(index in values)) values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      return [values[index], (next: unknown) => { values[index] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(values[index]) : next }]
    },
    useRef: (initial: unknown) => refs[refCursor++] ??= { current: initial },
    useCallback: (fn: unknown) => fn,
    useEffect: () => {},
  }
  const source = readFileSync(new URL('./useEditor.ts', import.meta.url), 'utf8')
  const scope = { exports: {}, require: (name: string) => name === 'react' ? hooks : model, window: { confirm: vi.fn(() => true), setTimeout, clearTimeout } }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, scope)
  const fn = (scope.exports as { useEditor: typeof useEditor }).useEditor
  const render = (demo = false) => { stateCursor = 0; refCursor = 0; return fn(api, demo) }
  return { api, render, confirm: scope.window.confirm }
}

describe('数值编辑器 · renderer 桥接与草稿', () => {
  it('每次数字输入立即通知 dirty，空框不保存，撤销清除 buffer 不篡改 baseline', async () => {
    const view = harness()
    await view.render().load(project.root)
    view.render().buffer({ row, field: row.fields[0]!, text: '', mode: 'raw' })
    expect(view.api.setDirty).toHaveBeenLastCalledWith(true)
    expect(view.render().dirty).toBe(true)
    await view.render().save()
    expect(view.api.save).not.toHaveBeenCalled()
    expect(view.render().issues[0]!.path).toBe('cpu')
    view.render().undo()
    expect(view.api.setDirty).toHaveBeenLastCalledWith(false)
    expect(view.render().dirty).toBe(false)
    expect(row.values.cpu).toBe(10)
  })

  it('保存重取最新 token，成功后用返回项目刷新并清 dirty，不声称假保存', async () => {
    let counter = 0
    const view = harness({ preview: vi.fn(async () => ({ token: `plan-${++counter}`, changes: [], issues: [], warnings: [] })) })
    await view.render().load(project.root)
    view.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    await view.render().refreshPreview()
    expect(view.render().preview?.token).toBe('plan-1')
    await view.render().save()
    expect(view.api.save).toHaveBeenCalledWith(project.root, 'plan-2')
    expect(view.render().project?.fingerprint).toBe('saved')
    expect(view.render().dirty).toBe(false)
    expect(view.api.setDirty).toHaveBeenLastCalledWith(false)
  })

  it('草稿改动使旧预览及异步迟到预览失效，保存只提交当前草稿的计划', async () => {
    const pending = deferred<EditorPlan>()
    let count = 0
    const view = harness({ preview: vi.fn(async (_root: string, _fingerprint: string, edits: model.NumericEdit[]) => ++count === 1 ? pending.promise : { token: 'current', changes: edits.map((edit) => ({ ...edit, file: 'ships.json' })), issues: [], warnings: [] }) })
    await view.render().load(project.root)
    view.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    const first = view.render().refreshPreview()
    view.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 30 }])
    pending.resolve({ token: 'stale', changes: [], issues: [], warnings: [] })
    await first
    expect(view.render().preview).toBeNull()
    await view.render().save()
    expect(view.api.preview).toHaveBeenLastCalledWith(project.root, 'base', [{ table: 'ships', id: 'A', path: 'cpu', value: 30 }])
    expect(view.api.save).toHaveBeenCalledWith(project.root, 'current')
  })

  it('预览失败与保存失败均保留草稿，错误带可定位字段，空 token 不触发 save', async () => {
    const issue = { message: 'CPU 超限', table: 'ships' as const, id: 'A', path: 'cpu' }
    const view = harness({ preview: vi.fn(async () => ({ token: 'invalid', changes: [], issues: [issue], warnings: [] })) })
    await view.render().load(project.root)
    view.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    await view.render().save()
    expect(view.api.save).not.toHaveBeenCalled()
    expect(view.render().dirty).toBe(true)
    expect(view.render().issues).toContainEqual(issue)
    expect(view.render().focusError).toBeGreaterThan(0)
    view.api.preview = vi.fn(async () => ({ token: '', changes: [], issues: [], warnings: [] }))
    await view.render().save()
    expect(view.api.save).not.toHaveBeenCalled()
    view.api.preview = vi.fn(async () => ({ token: 'ok', changes: [], issues: [], warnings: [] }))
    view.api.save = vi.fn(async () => ({ ok: false, message: '外部冲突', issues: [issue] }))
    await view.render().save()
    expect(view.render().dirty).toBe(true)
    expect(view.render().preview).toBeNull()
    expect(view.render().draft.edits[0]!.value).toBe(20)
  })

  it('保存未返回项目时真实重载，刷新失败标已保存但锁编辑，不恢复成假未保存', async () => {
    let opens = 0
    const view = harness({ openProject: vi.fn(async () => { if (++opens > 1) throw new Error('读取失败'); return structuredClone(project) }), save: vi.fn(async () => ({ ok: true, message: '已写入', backup: 'backup-path' })) })
    await view.render().load(project.root)
    view.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    await view.render().save()
    expect(view.api.openProject).toHaveBeenCalledTimes(2)
    expect(view.render().dirty).toBe(false)
    expect(view.render().writable).toBe(false)
    expect(view.render().notice).toContain('源码已保存，但刷新失败')
    expect(view.render().result?.backup).toBe('backup-path')
  })

  it('主树只读与 dev mock 都拒绝草稿、保存和恢复，取消重载保留草稿', async () => {
    const view = harness({ openProject: vi.fn(async () => ({ ...structuredClone(project), root: 'H:/大鲸鱼/Deepseek-EVE' })) })
    await view.render().load(project.root)
    expect(view.render().writable).toBe(false)
    view.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    await view.render().save()
    await view.render().action('restore')
    expect(view.api.save).not.toHaveBeenCalled()
    expect(view.api.restore).not.toHaveBeenCalled()
    const demo = harness()
    await demo.render(true).load(project.root)
    demo.render(true).change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    expect(demo.render(true).dirty).toBe(false)
    const editable = harness()
    await editable.render().load(project.root)
    editable.render().change([{ table: 'ships', id: 'A', path: 'cpu', value: 20 }])
    editable.confirm.mockReturnValue(false)
    await editable.render().load('another-root')
    expect(editable.api.openProject).toHaveBeenCalledTimes(1)
    expect(editable.render().dirty).toBe(true)
  })
})
