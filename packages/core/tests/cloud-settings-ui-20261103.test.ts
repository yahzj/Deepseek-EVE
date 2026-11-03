import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudApiError, normalizeCloudServerURL } from '../../../apps/desktop/src/renderer/src/features/cloud/api'
import {
  CloudRequestScope, cloudDownloadPreview, cloudErrorNotice, matchesCloudTarget,
  pendingRecoveryCode, rememberRecoveryCode, cloudRetryDelay,
} from '../../../apps/desktop/src/renderer/src/features/cloud/cloudState'
import { L10N, l10nEntryText } from '../../data/src/l10n/table'
import { createInitialState } from '../src/state'
import { serializeSaveFile } from '../src/save'
import { runSaveModule } from './helpers/save-shell'
import type { CloudApi } from '../../../apps/desktop/src/renderer/src/features/cloud/api'
import type { CloudPreferences } from '../../../apps/desktop/src/renderer/src/features/cloud/preferences'
import { DEFAULT_CLOUD_SERVER } from '../../../apps/desktop/src/renderer/src/features/cloud/preferences'
import * as cloudState from '../../../apps/desktop/src/renderer/src/features/cloud/cloudState'

const root = resolve(__dirname, '../../..')
const feature = 'apps/desktop/src/renderer/src/features/cloud/'
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')
const target = { server: 'https://one.example', playerId: 7 }
const owner = { playerId: 7, username: 'pilot', nickname: 'Pilot' }

afterEach(() => { vi.restoreAllMocks(); rememberRecoveryCode(target.server, owner, null); rememberRecoveryCode(target.server, { ...owner, playerId: 8 }, null) })

describe('cloud settings controls', () => {
  it('has no player URL input, server label or apply action', () => {
    const panel = source(feature + 'CloudSavePanel.tsx')
    const ast = ts.createSourceFile('CloudSavePanel.tsx', panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const inputs: ts.JsxSelfClosingElement[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'input') inputs.push(node)
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect(inputs.length).toBeGreaterThan(0)
    for (const input of inputs) expect(input.getText(ast)).not.toMatch(/serverInput|inputMode="url"|autoComplete="url"|https?:/)
    expect(panel).not.toContain('ui.cloud.003')
    expect(panel).not.toContain('ui.cloud.004')
    expect(panel).not.toContain('applyServer')
  })

  it('mounts only at the end of the save fragment without a new settings tab', () => {
    const settings = source('apps/desktop/src/renderer/src/panels/appSettings.tsx')
    const save = settings.indexOf("{settingsPage === 'save' ? <>")
    const panel = settings.indexOf('<CloudSavePanel engine={engine} onApplyingChange={setCloudApplying} />')
    expect(panel).toBeGreaterThan(save)
    expect(settings.indexOf('onReset()', save)).toBeLessThan(panel)
    expect(settings.slice(panel)).toMatch(/^<CloudSavePanel engine=\{engine\} onApplyingChange=\{setCloudApplying\} \/>\s*<\/> : null\}/)
    expect(settings.match(/<CloudSavePanel /g)).toHaveLength(1)
    expect(settings).not.toContain("id: 'cloud'")
  })

  it('registers every literal cloud ID, defers English, and uses unique meanings for status IDs', () => {
    const files = ['CloudSavePanel.tsx', 'useCloudAccount.ts', 'cloudState.ts']
    for (const file of files) {
      for (const [, id] of source(feature + file).matchAll(/['"](ui\.cloud\.\d+)['"]/g)) {
        expect(L10N[id!], id).toBeDefined()
        expect(L10N[id!]!.enDeferred, id).toBe(true)
        expect(l10nEntryText(L10N[id!]!, 'en'), id).toBe(L10N[id!]!.zh)
      }
    }
    expect(cloudErrorNotice(new CloudApiError(401, 'invalid_token', 'private'))).toEqual({ id: 'ui.cloud.102' })
    expect(L10N['ui.cloud.042']!.zh).not.toBe(L10N['ui.cloud.102']!.zh)
  })

  it('retains recovery codes in memory across component instances and isolates servers', () => {
    rememberRecoveryCode(target.server, owner, 'secret-recovery')
    expect(pendingRecoveryCode(target.server, 7)).toEqual({ owner, code: 'secret-recovery' })
    expect(pendingRecoveryCode(target.server, 8)).toBeNull()
    rememberRecoveryCode(target.server, { ...owner, playerId: 8 }, 'other-recovery')
    expect(pendingRecoveryCode(target.server, 7)?.code).toBe('secret-recovery')
    expect(pendingRecoveryCode('https://two.example')).toBeNull()
    rememberRecoveryCode(target.server, owner, null)
    expect(pendingRecoveryCode(target.server, 7)).toBeNull()
  })

  it('invalidates confirmation for either a server or an account change', () => {
    expect(matchesCloudTarget(target, target.server, 7)).toBe(true)
    expect(matchesCloudTarget(target, 'https://two.example', 7)).toBe(false)
    expect(matchesCloudTarget(target, target.server, 8)).toBe(false)
    expect(matchesCloudTarget(target, target.server, undefined)).toBe(false)
  })
})

describe('settings local-commit close protection', () => {
  const ast = ts.createSourceFile('appSettings.tsx', source('apps/desktop/src/renderer/src/panels/appSettings.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const settings = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'SettingsPanel')!
  const elements: Array<ts.JsxOpeningElement | ts.JsxSelfClosingElement> = []
  const declarations: ts.FunctionDeclaration[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node)
    if (ts.isFunctionDeclaration(node)) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  visit(settings)
  const attribute = (node: typeof elements[number], name: string): ts.Expression => {
    const attr = node.attributes.properties.find((item): item is ts.JsxAttribute => ts.isJsxAttribute(item) && item.name.getText(ast) === name)!
    if (attr.initializer && ts.isJsxExpression(attr.initializer)) return attr.initializer.expression!
    return attr.initializer as ts.Expression
  }
  const evaluate = (expression: ts.Node, bindings: Record<string, unknown>): unknown => {
    const js = ts.transpileModule(`(${expression.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    return runInNewContext(js, bindings)
  }
  const roleTab = elements.find(node => node.tagName.getText(ast) === 'button' && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(ast) === 'role' && attr.initializer?.getText(ast) === '"tab"'))!
  const foot = elements.find(node => node.tagName.getText(ast) === 'div' && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.initializer?.getText(ast) === '"app-settings-foot"'))!
  const footButtons = elements.filter(node => node.tagName.getText(ast) === 'button' && node.pos > foot.pos && node.end < foot.parent.end)
  const done = footButtons.at(-1)!
  const reset = footButtons.at(-2)!
  const mask = elements.find(node => node.tagName.getText(ast) === 'div' && node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.initializer?.getText(ast) === '"app-modal-mask"'))!
  const close = declarations.find(node => node.name?.text === 'onClose')!

  it.each([true, false])('runs actual mask, completion and navigation handlers with applying=%s', cloudApplying => {
    const onRequestClose = vi.fn()
    const bindings = {
      cloudApplying, onRequestClose, persist: vi.fn(), setSettingsPage: vi.fn(),
      page: { id: 'sound' }, setZoom: vi.fn(), setFs: vi.fn(), selectFont: vi.fn(),
      visibleSettingsPages: [{ id: 'save' }, { id: 'sound' }], index: 0,
      document: { getElementById: vi.fn(() => ({ focus: vi.fn() })) },
      onClose: undefined as unknown,
    }
    bindings.onClose = evaluate(close, bindings)
    ;(evaluate(attribute(mask, 'onClick'), bindings) as () => void)()
    ;(evaluate(attribute(done, 'onClick'), bindings) as () => void)()
    ;(evaluate(attribute(roleTab, 'onClick'), bindings) as () => void)()
    ;(evaluate(attribute(roleTab, 'onKeyDown'), bindings) as (event: unknown) => void)({ key: 'ArrowRight', preventDefault: vi.fn() })
    ;(evaluate(attribute(reset, 'onClick'), bindings) as () => void)()
    expect(onRequestClose).toHaveBeenCalledTimes(cloudApplying ? 0 : 2)
    expect(bindings.persist).toHaveBeenCalledTimes(cloudApplying ? 0 : 1)
    expect(bindings.setSettingsPage).toHaveBeenCalledTimes(cloudApplying ? 0 : 2)
    expect(bindings.selectFont).toHaveBeenCalledTimes(cloudApplying ? 0 : 1)
    for (const button of [done, reset, roleTab]) expect(evaluate(attribute(button, 'disabled'), bindings)).toBe(cloudApplying)
  })

  it('notifies the parent from the actual panel effect only with applying, not network busy', () => {
    const panelAst = ts.createSourceFile('CloudSavePanel.tsx', source(feature + 'CloudSavePanel.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let effect: ts.ArrowFunction | undefined
    const findEffect = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(panelAst) === 'useEffect' && node.getText(panelAst).includes('onApplyingChange')) effect = node.arguments[0] as ts.ArrowFunction
      ts.forEachChild(node, findEffect)
    }
    findEffect(panelAst)
    const onApplyingChange = vi.fn()
    for (const applying of [false, true, false]) {
      const js = ts.transpileModule(`(${effect!.getText(panelAst)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
      const callback = runInNewContext(js, { onApplyingChange, cloud: { applying, busy: true } }) as () => void
      callback()
    }
    expect(onApplyingChange.mock.calls).toEqual([[false], [true], [false]])
  })
})

describe('cloud settings cancellation', () => {
  it('aborts every request and prevents late work after service switch or unmount', async () => {
    const scope = new CloudRequestScope()
    const first = scope.begin()
    const second = scope.begin()
    const commit = vi.fn()
    let resolveRequest!: () => void
    const transport = new Promise<void>(resolve => { resolveRequest = resolve })
    const pending = transport.then(() => { if (first.current()) commit() })
    scope.cancel()
    resolveRequest()
    await pending
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(commit).not.toHaveBeenCalled()
    const next = scope.begin()
    expect(next.current()).toBe(true)
    expect(next.signal.aborted).toBe(false)
    scope.cancel()
  })

  it('cancels an obsolete username check without invalidating other work', () => {
    const scope = new CloudRequestScope()
    const precheck = scope.begin()
    const current = scope.begin()
    precheck.abort()
    expect(precheck.current()).toBe(false)
    expect(current.current()).toBe(true)
    current.finish()
    scope.cancel()
    expect(current.current()).toBe(false)
  })
})

describe('cloud error mapping', () => {
  it('uses bounded server retry timing with safe fallbacks', () => {
    expect(cloudRetryDelay(new CloudApiError(429, 'rate_limited', '', { retryAfterMs: 2500 }))).toBe(2500)
    for (const retryAfterMs of [NaN, Infinity, -1, 0, 2 ** 31, Number.MAX_SAFE_INTEGER, '2500']) {
      expect(cloudRetryDelay(new CloudApiError(429, 'rate_limited', '', { retryAfterMs }))).toBe(60_000)
      expect(cloudRetryDelay(new CloudApiError(429, 'login_locked', '', { retryAfterMs }))).toBe(600_000)
    }
  })
  it.each([
    ['rate_limited', 400, '107'], ['login_locked', 400, '108'], ['unknown', 429, '107'],
  ])('always supplies retry seconds for %s with HTTP %s', (code, status, suffix) => {
    expect(cloudErrorNotice(new CloudApiError(status, code, '', { retryAfterMs: 2500 })))
      .toEqual({ id: `ui.cloud.${suffix}`, params: { p1: 3 } })
  })
  it.each([
    ['bad_credentials', 401, '101'], ['missing_token', 401, '102'], ['token_expired', 401, '102'],
    ['username_taken', 409, '016'], ['nickname_taken', 409, '016'], ['bad_username', 400, '103'],
    ['bad_password', 400, '104'], ['bad_recovery_code', 400, '105'], ['recovery_not_found', 404, '105'],
    ['rate_limited', 429, '107'], ['login_locked', 429, '108'], ['invalid_server', 0, '109'],
    ['network_error', 0, '110'], ['timeout', 0, '111'], ['save_conflict', 409, '112'],
    ['save_too_large', 413, '113'], ['response_too_large', 200, '113'], ['malformed_response', 200, '114'],
    ['invalid_base_version', 0, '115'], ['version_not_found', 404, '116'], ['internal_error', 500, '117'],
  ])('maps %s to a stable ID without displaying code or remote message', (code, status, suffix) => {
    expect(cloudErrorNotice(new CloudApiError(status as number, code as string, 'DO NOT DISPLAY')))
      .toEqual({ id: `ui.cloud.${suffix}`, ...(status === 429 ? { params: { p1: code === 'login_locked' ? 600 : 60 } } : {}) })
  })

  it('uses a generic fallback and reports uncertain writes without retrying', () => {
    expect(cloudErrorNotice(new Error('secret'))).toEqual({ id: 'ui.cloud.117' })
    expect(cloudErrorNotice(new CloudApiError(500, 'unknown', 'secret'))).toEqual({ id: 'ui.cloud.117' })
    expect(cloudErrorNotice(new CloudApiError(401, 'unknown', 'secret'))).toEqual({ id: 'ui.cloud.102' })
    expect(cloudErrorNotice(new CloudApiError(429, 'unknown', 'secret'))).toEqual({ id: 'ui.cloud.107', params: { p1: 60 } })
    expect(cloudErrorNotice(new CloudApiError(0, 'timeout', ''), true)).toEqual({ id: 'ui.cloud.119' })
    expect(cloudErrorNotice(new CloudApiError(0, 'network_error', ''), true)).toEqual({ id: 'ui.cloud.119' })
  })
})

describe('download candidate preflight', () => {
  it.each([false, true])('reads the actual pilot, timestamp and ironman flag (%s) without applying', ironman => {
    const state = createInitialState({ nowWallMs: 1000, seed: 42 })
    state.character.name = 'CloudPilot'
    state.ironman = { on: ironman, seq: 4 }
    const text = serializeSaveFile(state, 2000)
    const candidate = cloudDownloadPreview({ version: 3, data: text }, target)
    expect(candidate).toMatchObject({ ...target, version: 3, pilot: 'CloudPilot', savedAt: 2000, ironman, text })
    expect(state.character.name).toBe('CloudPilot')
  })

  it('rejects missing data, malformed JSON, wrong format, unsupported version, and >10MB', () => {
    expect(() => cloudDownloadPreview({ version: 0, data: null }, target)).toThrow(CloudApiError)
    expect(() => cloudDownloadPreview({ version: 1, data: '{' }, target)).toThrow()
    expect(() => cloudDownloadPreview({ version: 1, data: '{}' }, target)).toThrow()
    const text = serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 1 }), 1)
    const future = JSON.parse(text)
    future.version = 1_000_000
    expect(() => cloudDownloadPreview({ version: 1, data: JSON.stringify(future) }, target)).toThrow()
    expect(() => cloudDownloadPreview({ version: 1, data: 'a'.repeat(10 * 1024 * 1024 + 1) }, target)).toThrow(CloudApiError)
  })
})

// 运行真实 hook；仅替换 React 调度器、网络、偏好及引擎边界，不另写业务流程。
interface HookView {
  profile: typeof owner | null
  uploadConfirm: { baseVersion: number } | null
  status: { id: string; params?: Record<string, string | number> } | null
  serverConfigured: boolean
  username: string
  applying: boolean
  localExitOffered: boolean
  freshRecoveryCode: { owner: typeof owner; code: string } | null
  previewUpload(): void
  confirmUpload(): void
  setUsername(value: string): void
  setMode(value: string): void
  setPassword(value: string): void
  submitAuth(): void
  previewDownload(version?: number): void
  confirmDownload(): void
  refresh(): void
  logout(): void
  localLogout(): void
}

function hookFixture(stored = true, server = target.server) {
  type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void }
  const slots: Slot[] = []
  let index = 0
  let dirty = false
  let effects: Array<() => void> = []
  const sameDeps = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, at) => Object.is(value, b[at]))
  const hooks = {
    useState(initial: unknown) {
      const at = index++
      if (!slots[at]) slots[at] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[at]!.value, (next: unknown) => {
        const value = typeof next === 'function' ? next(slots[at]!.value) : next
        if (!Object.is(value, slots[at]!.value)) { slots[at]!.value = value; dirty = true }
      }]
    },
    useRef(value: unknown) {
      const at = index++
      if (!slots[at]) slots[at] = { value: { current: value } }
      return slots[at]!.value
    },
    useCallback(callback: unknown, deps: unknown[]) {
      const at = index++
      if (!slots[at] || !sameDeps(slots[at]!.deps, deps)) slots[at] = { value: callback, deps }
      return slots[at]!.value
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const at = index++
      if (slots[at] && sameDeps(slots[at]!.deps, deps)) return
      const old = slots[at]
      slots[at] = { deps }
      effects.push(() => { old?.cleanup?.(); slots[at]!.cleanup = effect() })
    },
  }
  const profile = { playerId: 7, username: 'pilot', nickname: 'Pilot' }
  let preferences: CloudPreferences = { server, session: stored ? { ...profile, token: 'old-token' } : null }
  const saveSession = vi.fn((server: string, session: CloudPreferences['session']) => { preferences = { server, session } })
  const api = {
    profile: vi.fn(async () => profile),
    usernameAvailable: vi.fn(async () => ({ available: true })),
    login: vi.fn(async () => ({ ...profile, token: 'new-token' })),
    signup: vi.fn(async () => ({ ...profile, token: 'new-token', recoveryCode: 'memory-secret' })),
    redeemRecovery: vi.fn(async () => ({ ...profile, token: 'recovery-token' })),
    logout: vi.fn(async () => {}),
    saveLatest: vi.fn(async (_signal?: AbortSignal): Promise<{ version: number; data: string | null }> => ({ version: 0, data: null })),
    saveVersions: vi.fn(async () => []),
    saveVersion: vi.fn(), uploadSave: vi.fn(async () => ({ version: 1, size: 100 })), rotateRecovery: vi.fn(),
  } satisfies CloudApi
  const factory = vi.fn(() => api)
  const engine = {
    state: { character: { name: 'LocalPilot' } }, saveWriteState: vi.fn(() => 'ok'),
    subscribe: vi.fn(() => () => {}),
    exportCloudSave: vi.fn(async () => ({ ok: true, text: 'exact-snapshot' })),
    importCloudSave: vi.fn(async () => ({ ok: true })),
  }
  const module = runSaveModule<{ useCloudAccount: (engine: unknown) => HookView }>(feature + 'useCloudAccount.ts', {
    react: hooks, './api': { CloudApiError, createCloudApi: factory, normalizeCloudServerURL }, './cloudState': cloudState,
    './preferences': {
      readCloudPreferences: () => preferences,
      saveCloudSession: saveSession,
      saveCloudServer: (server: string) => { preferences = { server, session: null } },
    },
  }, { AbortController, URL, setTimeout, clearTimeout })
  let view!: HookView
  function render() {
    index = 0; dirty = false; effects = []
    view = module.useCloudAccount(engine as never)
    for (const effect of effects) effect()
  }
  async function flush() {
    for (let tick = 0; tick < 20; tick++) { await Promise.resolve(); if (dirty) render() }
  }
  render()
  return { api, engine, factory, saveSession, flush, render, view: () => view,
    unmount: () => { for (const slot of slots) slot.cleanup?.() } }
}

describe('actual cloud hook workflow', () => {
  it('starts blank and makes no unauthenticated default-loopback requests or pilot-name edits', async () => {
    const f = hookFixture(false, DEFAULT_CLOUD_SERVER); await f.flush()
    expect(f.view().username).toBe('')
    f.view().setUsername('TypedLogin'); await f.flush()
    f.view().setMode('signup'); await f.flush()
    expect(f.view().username).toBe('')
    f.view().setMode('login'); await f.flush()
    f.view().setMode('signup'); await f.flush()
    expect(f.view().username).toBe('')
    expect(f.factory).not.toHaveBeenCalled()
    expect(f.view()).not.toHaveProperty('serverInput')
    expect(f.view()).not.toHaveProperty('applyServer')
    expect(f.view()).not.toHaveProperty('server')
    expect(f.view().serverConfigured).toBe(true)
    f.view().setUsername('IndependentAccount'); await f.flush()
    f.view().setPassword('password-123'); await f.flush()
    f.view().submitAuth(); await f.flush()
    expect(f.api.signup).toHaveBeenCalledWith('IndependentAccount', 'password-123', expect.any(AbortSignal))
    expect(f.engine.state.character.name).toBe('LocalPilot')
    f.unmount()
    rememberRecoveryCode(DEFAULT_CLOUD_SERVER, owner, null)
  })
  it.each([
    ['200', 'ui.cloud.131'], ['401', 'ui.cloud.121'], ['network', 'ui.cloud.122'],
  ])('verifies the same token after logout: profile %s clears only local persistence and reports accurately', async (result, noticeId) => {
    const f = hookFixture(); await f.flush()
    const factoryCalls = f.factory.mock.calls.length
    f.saveSession.mockClear()
    if (result === '401') f.api.profile.mockRejectedValueOnce(new CloudApiError(401, 'invalid_token', ''))
    if (result === 'network') f.api.profile.mockRejectedValueOnce(new CloudApiError(0, 'network_error', ''))
    f.view().logout(); await f.flush()
    expect(f.api.logout).toHaveBeenCalledTimes(1)
    expect(f.api.profile).toHaveBeenCalledTimes(2)
    expect(f.factory.mock.calls.length).toBe(factoryCalls + 1)
    expect(f.factory).toHaveBeenLastCalledWith({ server: target.server, token: 'old-token' })
    expect(f.view().status?.id).toBe(noticeId)
    expect(f.view().profile).toBeNull()
    expect(f.saveSession.mock.calls).toEqual([[target.server, null]])
    f.unmount()
  })

  it('retains the explicit local exit option when logout itself fails', async () => {
    const f = hookFixture(); await f.flush()
    f.saveSession.mockClear()
    f.api.logout.mockRejectedValueOnce(new CloudApiError(0, 'network_error', ''))
    f.view().logout(); await f.flush()
    expect(f.api.profile).toHaveBeenCalledTimes(1)
    expect(f.view().profile).not.toBeNull()
    expect(f.view().localExitOffered).toBe(true)
    expect(f.saveSession).not.toHaveBeenCalled()
    f.view().localLogout(); await f.flush()
    expect(f.saveSession).toHaveBeenLastCalledWith(target.server, null)
    expect(f.view().status?.id).toBe('ui.cloud.122')
    f.unmount()
  })

  it('verifies a stored token once without any automatic cloud read or write', async () => {
    const f = hookFixture()
    await f.flush()
    expect(f.api.profile).toHaveBeenCalledTimes(1)
    expect(f.api.saveLatest).not.toHaveBeenCalled()
    expect(f.api.saveVersions).not.toHaveBeenCalled()
    expect(f.engine.exportCloudSave).not.toHaveBeenCalled()
    expect(f.view().profile?.nickname).toBe('Pilot')
    f.render(); await f.flush()
    expect(f.api.profile).toHaveBeenCalledTimes(1)
    f.unmount()
  })

  it('can confirm a first upload with baseVersion 0 and the exact persisted snapshot', async () => {
    const f = hookFixture(); await f.flush()
    f.view().previewUpload(); await f.flush()
    expect(f.view().uploadConfirm?.baseVersion).toBe(0)
    expect(f.api.uploadSave).not.toHaveBeenCalled()
    f.view().confirmUpload(); await f.flush()
    expect(f.api.uploadSave).toHaveBeenCalledWith('exact-snapshot', 0, expect.any(AbortSignal))
    expect(f.view().uploadConfirm).toBeNull()
    expect(f.view().status?.id).toBe('ui.cloud.125')
    f.unmount()
  })

  it('does not PUT after unmounting a configured-server panel while its snapshot is pending', async () => {
    const f = hookFixture(); await f.flush()
    f.view().previewUpload(); await f.flush()
    let finish!: (value: { ok: boolean; text: string }) => void
    f.engine.exportCloudSave.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.view().confirmUpload(); await f.flush()
    f.unmount()
    finish({ ok: true, text: 'old-server-snapshot' }); await f.flush()
    expect(f.api.uploadSave).not.toHaveBeenCalled()
    expect(f.view().uploadConfirm).toBeNull()
  })

  it('drops confirmations on 409 and refreshes metadata without retrying the write', async () => {
    const f = hookFixture(); await f.flush()
    f.view().previewUpload(); await f.flush()
    f.api.uploadSave.mockRejectedValueOnce(new CloudApiError(409, 'save_conflict', ''))
    f.view().confirmUpload(); await f.flush()
    expect(f.api.uploadSave).toHaveBeenCalledTimes(1)
    expect(f.api.saveLatest).toHaveBeenCalledTimes(2)
    expect(f.view().uploadConfirm).toBeNull()
    expect(f.view().status?.id).toBe('ui.cloud.112')
    f.unmount()
  })

  it('reports uncertain upload without a retry', async () => {
    const f = hookFixture(); await f.flush()
    f.view().previewUpload(); await f.flush()
    f.api.uploadSave.mockRejectedValueOnce(new CloudApiError(0, 'timeout', ''))
    f.view().confirmUpload(); await f.flush()
    expect(f.api.uploadSave).toHaveBeenCalledTimes(1)
    expect(f.view().status?.id).toBe('ui.cloud.119')
    f.unmount()
  })

  it('preserves signup recovery in memory when profile fails, without persisting auth payload', async () => {
    const f = hookFixture(false); await f.flush()
    f.view().setMode('signup'); await f.flush()
    expect(f.view().username).toBe('')
    f.view().setUsername('IndependentAccount'); await f.flush()
    f.view().setPassword('password-123'); await f.flush()
    f.api.profile.mockRejectedValueOnce(new CloudApiError(0, 'network_error', ''))
    f.view().submitAuth(); await f.flush()
    expect(f.view().freshRecoveryCode).toEqual({ owner, code: 'memory-secret' })
    expect(f.saveSession).not.toHaveBeenCalled()
    expect(pendingRecoveryCode(target.server, 7)?.code).toBe('memory-secret')
    f.unmount()
  })

  it('ignores a late profile after unmount and blocks writes when storage is unavailable', async () => {
    const f = hookFixture(); await f.flush()
    f.engine.saveWriteState.mockReturnValue('unavailable')
    f.view().previewUpload(); await f.flush()
    expect(f.api.saveLatest).not.toHaveBeenCalled()
    f.api.saveLatest.mockImplementationOnce(() => new Promise(() => {}))
    f.view().refresh(); await f.flush()
    const signal = f.api.saveLatest.mock.calls[0]?.[0]
    f.unmount()
    expect(signal?.aborted).toBe(true)
    expect(f.api.uploadSave).not.toHaveBeenCalled()
  })

  it('resets applying in finally without exposing server configuration actions', async () => {
    const f = hookFixture(); await f.flush()
    const text = serializeSaveFile(createInitialState({ nowWallMs: 0, seed: 3 }), 1)
    f.api.saveLatest.mockResolvedValueOnce({ version: 1, data: text })
    f.view().previewDownload(); await f.flush()
    let finish!: (value: { ok: boolean }) => void
    f.engine.importCloudSave.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    f.view().confirmDownload(); await f.flush()
    expect(f.view().applying).toBe(true)
    expect(f.view()).not.toHaveProperty('setServerInput')
    expect(f.view()).not.toHaveProperty('applyServer')
    expect(f.view()).not.toHaveProperty('server')
    expect(f.view().serverConfigured).toBe(true)
    finish({ ok: true }); await f.flush()
    expect(f.view().applying).toBe(false)
    expect(f.view().status?.id).toBe('ui.cloud.126')
    f.unmount()
  })
})
