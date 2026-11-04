import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const root = resolve(__dirname, '../../..')
interface Node { type: unknown; props: Record<string, any> }

function page(authenticated = true, overrides: Record<string, unknown> = {}) {
  const effects: Array<() => void> = []
  const scroll = { scrollTop: 0, scrollHeight: 1000, clientHeight: 200 }
  const form = { requestSubmit: vi.fn() }
  let refIndex = 0
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props })
  const chat = {
    authenticated, activate: vi.fn(), channel: 'zh', onlineCount: 2, historyLoaded: true,
    historyLoading: false, olderLoading: false, hasMore: false, messages: [], locale: 'zh',
    draft: '草稿', send: vi.fn(() => true), setDraft: vi.fn(), selectChannel: vi.fn(),
    loadOlder: vi.fn(async () => {}), retry: vi.fn(), dismiss: vi.fn(), ...overrides,
  }
  const hooks = {
    useEffect: (callback: () => void) => { effects.push(callback) },
    useState: (initial: unknown) => [initial, vi.fn()],
    useRef: () => ({ current: refIndex++ === 0 ? scroll : form }),
  }
  const module = { exports: {} as { OnlineChatPage: (props: unknown) => Node } }
  const source = readFileSync(resolve(root, 'apps/desktop/src/renderer/src/pages/OnlineChatPage.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  runInNewContext(code, {
    exports: module.exports, module, Date,
    require: (id: string) => {
      if (id === 'react') return hooks
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@whale/ui') return { Panel: 'Panel' }
      if (id === '../i18n/locale') return { useL10n: () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }) }
      if (id === 'lucide-react') return Object.fromEntries(['ArrowDown', 'ArrowUp', 'Clock3', 'Send', 'X'].map((name) => [name, name]))
      throw new Error(`unexpected dependency: ${id}`)
    },
  })
  const onToast = vi.fn(), onOpenSettings = vi.fn()
  const tree = module.exports.OnlineChatPage({ chat, onToast, onOpenSettings })
  const nodes: Node[] = []
  function visit(node: any): void {
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (!node || typeof node !== 'object' || !node.props) return
    nodes.push(node)
    visit(node.props.children)
    visit(node.props.right)
  }
  visit(tree)
  return { tree, nodes, effects, chat, form, scroll, onToast, onOpenSettings }
}

describe('independent online chat page', () => {
  it('keeps guest login as an explicit settings action and activates only the application controller', () => {
    const p = page(false)
    expect(p.nodes.some((node) => node.type === 'textarea')).toBe(false)
    const login = p.nodes.find((node) => node.type === 'button')!
    login.props.onClick()
    expect(p.onOpenSettings).toHaveBeenCalledOnce()
    p.effects[0]!()
    expect(p.chat.activate).toHaveBeenCalledOnce()
  })

  it('renders message text literally with only a total online count, not a roster or presence log', () => {
    const p = page(true, { messages: [{ id: 7, text: '<img src=x onerror=alert(1)>', nickname: 'Pilot', ts: 1, own: false }] })
    const paragraph = p.nodes.find((node) => node.type === 'p')!
    expect(paragraph.props.children).toBe('<img src=x onerror=alert(1)>')
    expect(p.nodes.some((node) => node.props.dangerouslySetInnerHTML)).toBe(false)
    expect(p.nodes.filter((node) => node.props.className === 'app-online-chat-count')).toHaveLength(1)
    expect(p.nodes.some((node) => /roster|connection-status|presence-list/.test(node.props.className ?? ''))).toBe(false)
  })

  it('does not submit while the Chinese input method is composing', () => {
    const p = page()
    const input = p.nodes.find((node) => node.type === 'textarea')!
    const preventDefault = vi.fn()
    input.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, keyCode: 13, preventDefault })
    input.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, keyCode: 229, preventDefault })
    input.props.onKeyDown({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false }, keyCode: 13, preventDefault })
    expect(p.form.requestSubmit).not.toHaveBeenCalled()
    input.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, keyCode: 13, preventDefault })
    expect(p.form.requestSubmit).toHaveBeenCalledOnce()
  })

  it('reports a rejected submit without clearing the original draft', () => {
    const send = vi.fn(() => false)
    const p = page(true, { send })
    const form = p.nodes.find((node) => node.type === 'form')!
    form.props.onSubmit({ preventDefault: vi.fn() })
    expect(send).toHaveBeenCalledWith('草稿')
    expect(p.chat.setDraft).not.toHaveBeenCalled()
    expect(p.onToast).toHaveBeenCalledWith('ui.chat.015', true)
  })
})
