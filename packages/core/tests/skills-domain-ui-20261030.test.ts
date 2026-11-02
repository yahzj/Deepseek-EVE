import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext, L10N, SKILL_GROUPS } from '@whale/data'
import * as data from '@whale/data'
import * as core from '../src/index'
import { ROOT } from './helpers/save-shell'

type Props = Record<string, unknown>
type Tree = { type: unknown; props: Props; children?: unknown[] }
type Component = (props: Props) => unknown
const renderer = resolve(ROOT, 'apps/desktop/src/renderer/src')
const nodes = (value: unknown): Tree[] => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' && 'type' in value
  ? [value as Tree, ...nodes((value as Tree).children)] : []
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' && 'children' in value
  ? text((value as Tree).children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''

function harness(locale: 'zh' | 'en') {
  const ctx = buildSimContext(locale), state = core.createInitialState({ nowWallMs: 0, seed: 7 })
  state.wallet.isk = 10_000_000
  state.warehouse.items['synaptic-accelerant'] = 2
  const calls = { purchase: vi.fn((id: string) => core.buySkillLicense(state, ctx.skills, id)), train: vi.fn((id: string) => {
    const target = (state.skills.trained[id] ?? 0) + state.skills.queue.filter(q => q.skillId === id).length + 1
    return core.enqueueSkill(state, id, target, ctx.skills)
  }), prereqs: vi.fn(() => ({ ok: true, added: 1 })), useBoost: vi.fn(() => core.useSynapticAccelerant(state)) }
  const engine = { state, ctx, groups: [...SKILL_GROUPS], skills: [...ctx.skills.values()],
    purchaseSkillLicense: calls.purchase, trainNextLevel: calls.train, enqueuePrereqChain: calls.prereqs,
    synapticAccelerantRemainMs: () => Math.max(0, (state.skillBoostUntilMs ?? 0) - state.gameMs),
    boostAutoRenewOn: () => state.boostAutoRenew === true,
    setBoostAutoRenewNow: (on: boolean) => { state.boostAutoRenew = on; return { ok: true } },
    useSynapticAccelerantNow: calls.useBoost, moveQueueAt: (from: number, to: number) => core.moveQueueItem(state, from, to, ctx.skills),
    skillCancelImpactAt: (at: number) => core.skillCancelImpact(state, ctx.skills, at),
    dequeueAt: (at: number) => core.removeQueueAt(state, at, ctx.skills),
  }
  const session = new Map<string, string>(), slots = new Map<string, unknown[]>(), effects = new Map<string, unknown[]>()
  const pending: Array<() => void> = []
  let owner = '', cursor = 0
  const useState = (initial: unknown) => {
    const list = slots.get(owner) ?? []; slots.set(owner, list)
    const at = cursor++
    if (!(at in list)) list[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [list[at], (value: unknown) => { list[at] = typeof value === 'function' ? (value as (v: unknown) => unknown)(list[at]) : value }]
  }
  const jsx = (type: unknown, props: Props) => ({ type, props })
  const format = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[locale] ?? id).replace(/\{(\w+)\}/g, (whole, key: string) => String(params?.[key] ?? whole))
  const hookReact = { useState, useMemo: (fn: () => unknown) => fn(), useRef: (current: unknown) => ({ current }), useEffect: (fn: () => void, deps: unknown[]) => {
    const key = `${owner}:${cursor++}`, before = effects.get(key)
    if (!before || deps.some((v, i) => v !== before[i])) { effects.set(key, deps); pending.push(fn) }
  } }
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  function load(file: string): Record<string, unknown> {
    const known = cache.get(file); if (known) return known.exports
    const module = { exports: {} }; cache.set(file, module)
    const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    runInNewContext(output, { module, exports: module.exports, require: (id: string): unknown => {
      if (id === 'react') return hookReact
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
      if (id === '@whale/core') return core
      if (id === '@whale/data') return data
      if (id === '@whale/ui') return { Panel: ({ children, right, title, ...props }: Props) => jsx('Panel', { ...props, children: [title, right, children] }) }
      const target = resolve(dirname(file), id)
      if (target === resolve(renderer, 'i18n/locale')) return { tr: format, cmdText: (r: core.CommandResult) => r.errorId ? format(r.errorId, r.errorParams) : r.error ?? '' }
      if (target === resolve(renderer, 'i18n/fmt')) return { fmtDuration: (ms: number) => `${Math.round(ms)}ms` }
      if (target === resolve(renderer, 'ui/Glyphs')) return { Glyph: 'Glyph', toneOf: () => 'currentColor', itemGlyphName: String }
      if (target === resolve(renderer, 'ui/labelsText')) return { skillBranchText: String, skillGroupText: String }
      if (target === resolve(renderer, 'ui/sessionView')) return { sessionPick: (key: string) => session.get(key) ?? null,
        setSessionPick: (key: string, value: string) => session.set(key, value), useSessionScroll: () => {} }
      if (target === resolve(renderer, 'ui/itemView')) return { RowGlyph: 'Glyph', useItemView: () => useState('grid'),
        ItemViewBar: ({ onChange }: { onChange: (mode: string) => void }) => jsx('button', { 'data-view-switch': true, onClick: () => onChange('list') }) }
      if (!target.startsWith(renderer + sep)) throw Error('组件读取越界')
      const source = [target + '.tsx', target + '.ts'].find(existsSync)
      if (!source) throw Error('组件依赖缺失：' + target)
      return load(source)
    } }, { timeout: 2000 })
    return module.exports
  }
  function expand(value: unknown, at: string): unknown {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, `${at}/${i}`))
    if (!value || typeof value !== 'object' || !('type' in value)) return value
    const node = value as Tree
    if (typeof node.type === 'function') {
      const prior = owner, priorCursor = cursor
      owner = `${at}/${node.type.name}`; cursor = 0
      const result = (node.type as Component)(node.props)
      owner = prior; cursor = priorCursor
      return expand(result, `${at}/body`)
    }
    return { ...node, children: expand(node.props.children, `${at}/children`) }
  }
  const entry = load(resolve(renderer, 'pages/SkillsTreePage.tsx'))
  const actual = load(resolve(renderer, 'features/skills/SkillsTreePage.tsx'))
  expect(entry.SkillsTreePage).toBe(actual.SkillsTreePage)
  let focusGroup: { group: string; branch?: string; seq: number } | null = null
  const render = () => {
    let tree: unknown
    for (let n = 0; n < 3; n++) {
      tree = expand(jsx(entry.SkillsTreePage, { engine, onToast: () => {}, focusGroup }), 'root')
      if (pending.length === 0) break
      pending.splice(0).forEach(fn => fn())
    }
    return nodes(tree)
  }
  const click = (node: Tree) => (node.props.onClick as (e: unknown) => void)({ stopPropagation() {} })
  const button = (all: Tree[], label: string) => all.find(n => n.type === 'button' && (text(n.children) === label
    || n.props.role === 'tab' && text(n.children).endsWith(label)))!
  return { state, ctx, calls, render, click, button, format, focus: (group: string, branch?: string) => { focusGroup = { group, branch, seq: (focusGroup?.seq ?? 0) + 1 } } }
}

describe('技能域真实组件接线', () => {
  it.each([
    ['fleet-command-basic', 20, 50_000],
    ['fleet-command-coordination', 40, 200_000],
    ['fleet-command-integration', 60, 2_000_000],
  ] as const)('%s详情和列表共用声望门槛、二次确认和价格', (id, standing, price) => {
    const h = harness('zh')
    const def = h.ctx.skills.get(id)!
    for (const parent of def.prereq ?? []) h.state.skills.trained[parent] = 3
    h.state.standingsEarned = { dsi: standing - 1 }
    h.state.standings.dsi = 999
    h.focus('舰船', 'b-command')
    let tree = h.render()
    h.click(tree.find(n => n.type === 'g' && String(n.props['data-tip']).startsWith(def.name + ' ·'))!)
    tree = h.render()
    expect(tree.find(n => n.props['data-skill-license'] === id)!.props.disabled).toBe(true)
    expect(tree.some(n => text(n.children) === h.format('ui.Expedition.336', { p1: standing, standing: standing - 1 }))).toBe(true)
    h.click(tree.find(n => n.props['data-skill-license'] === id)!)
    expect(h.calls.purchase).not.toHaveBeenCalled()
    h.click(h.button(tree, h.format('ui.App.086')))
    tree = h.render()
    h.click(tree.find(n => n.props['data-view-switch'])!)
    tree = h.render()
    expect(tree.find(n => n.props['data-skill-license'] === id)!.props.disabled).toBe(true)
    h.state.standingsEarned.dsi = standing
    h.state.standings.dsi = 0
    tree = h.render()
    const buy = tree.find(n => n.props['data-skill-license'] === id)!
    expect(buy.props.disabled).toBe(false)
    expect(text(buy.children)).toBe(h.format('ui.SkillTree.023', { p1: price.toLocaleString('zh-CN') }))
    h.click(buy)
    expect(h.calls.purchase).not.toHaveBeenCalled()
    tree = h.render()
    expect(text(tree.find(n => n.props['data-skill-license'] === id)!.children)).toBe(h.format('ui.SkillTree.026', { p1: price.toLocaleString('zh-CN') }))
    h.state.standingsEarned.dsi = standing - 1
    h.click(tree.find(n => n.props['data-skill-license'] === id)!)
    expect(h.calls.purchase).not.toHaveBeenCalled()
    h.state.standingsEarned.dsi = standing
    tree = h.render()
    h.click(tree.find(n => n.props['data-skill-license'] === id)!)
    tree = h.render()
    h.click(tree.find(n => n.props['data-skill-license'] === id)!)
    expect(h.calls.purchase).toHaveBeenCalledWith(id)
    expect(h.state.wallet.isk).toBe(10_000_000 - price)
    expect(h.state.standingsEarned.dsi).toBe(standing)
    expect(h.state.standings.dsi).toBe(0)
    tree = h.render()
    const row = tree.find(n => String(n.props.className).startsWith('app-skill-row') && text(n.children).includes(def.name))!
    const train = nodes(row.children).find(n => n.type === 'button' && text(n.children) === h.format('ui.SkillsPage.035', { p1: 1 }))!
    h.click(train)
    expect(h.state.skills.queue.some(item => item.skillId === id && item.targetLevel === 1)).toBe(true)
  })

  it.each(['zh', 'en'] as const)('%s编队通讯定位技能书并清掉搜索和状态筛选', locale => {
    const h = harness(locale)
    h.focus('工程')
    let tree = h.render()
    h.click(tree.find(n => n.type === 'button' && String(n.props.className).startsWith('app-skilltree-key is-max'))!)
    ;(tree.find(n => n.type === 'input')!.props.onChange as (event: unknown) => void)({ target: { value: '__no_skill__' } })
    h.focus('舰船', 'b-command')
    tree = h.render()
    expect(tree.find(n => n.type === 'input')!.props.value).toBe('')
    const nodes = tree.filter(n => n.type === 'g' && n.props.role === 'listitem')
    expect(nodes).toHaveLength(3)
    expect(nodes.every(n => !String(n.props.className).includes('is-dimmed'))).toBe(true)
    for (const id of ['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration']) {
      expect(nodes.some(n => String(n.props['data-tip']).startsWith(h.ctx.skills.get(id)!.name + ' ·'))).toBe(true)
    }
    h.focus('舰船')
    tree = h.render()
    expect(tree.filter(n => n.type === 'g' && n.props.role === 'listitem')).toHaveLength(16)
  })

  it.each(['zh', 'en'] as const)('%s搜索、状态筛选、图标列表与外部定位保持同一页状态', locale => {
    const h = harness(locale)
    h.focus('工程')
    let tree = h.render()
    const count = tree.filter(n => n.type === 'g' && n.props.role === 'listitem').length
    expect(count).toBe(h.ctx.skills.size > 0 ? [...h.ctx.skills.values()].filter(s => s.group === '工程').length : 0)
    const locked = tree.filter(n => n.type === 'g' && String(n.props.className).includes('is-locked')).length
    h.click(tree.find(n => n.type === 'button' && String(n.props.className).startsWith('app-skilltree-key is-locked'))!)
    tree = h.render()
    expect(tree.filter(n => n.type === 'g' && String(n.props.className).includes('is-dimmed'))).toHaveLength(count - locked)
    h.click(tree.find(n => n.type === 'button' && String(n.props.className).startsWith('app-skilltree-key is-locked'))!)
    tree = h.render()
    const search = tree.find(n => n.type === 'input')!
    ;(search.props.onChange as (e: unknown) => void)({ target: { value: '__no_skill__' } })
    tree = h.render()
    expect(tree.filter(n => n.type === 'g' && n.props.role === 'listitem')).toHaveLength(count)
    expect(tree.filter(n => n.type === 'g' && String(n.props.className).includes('is-dimmed'))).toHaveLength(count)
    h.focus('贸易'); tree = h.render()
    expect(tree.find(n => n.type === 'input')!.props.value).toBe('')
    h.click(tree.find(n => n.props['data-view-switch'])!); tree = h.render()
    expect(tree.some(n => n.props.className === 'app-skilltree-catalog')).toBe(true)
    expect(tree.some(n => n.props.className === 'app-skilltree-canvas')).toBe(false)
  })

  it.each(['zh', 'en'] as const)('%s许可二次确认、训练入队、详情跨子页和加速使用保持', locale => {
    const h = harness(locale)
    h.focus('工程')
    let tree = h.render()
    const skill = h.ctx.skills.get('accelerated-learning')!
    const node = tree.find(n => n.type === 'g' && String(n.props['data-tip']).startsWith(skill.name + ' ·'))!
    h.click(node); tree = h.render()
    expect(tree.some(n => n.props.className === 'app-modal app-skilltree-modal')).toBe(true)
    const price = core.skillLicensePriceOf(skill)!.toLocaleString('zh-CN')
    h.click(h.button(tree, h.format('ui.SkillTree.023', { p1: price })))
    expect(h.calls.purchase).not.toHaveBeenCalled()
    tree = h.render()
    h.click(h.button(tree, h.format('ui.SkillTree.026', { p1: price })))
    expect(h.calls.purchase).toHaveBeenCalledTimes(1)
    expect(h.calls.purchase).toHaveBeenCalledWith(skill.id)
    tree = h.render()
    h.click(h.button(tree, h.format('ui.SkillsPage.035', { p1: 1 })))
    expect(h.state.skills.queue).toEqual([{ skillId: skill.id, targetLevel: 1, progressMs: 0 }])
    tree = h.render(); h.click(h.button(tree, h.format('ui.SkillsPage.001')))
    tree = h.render()
    expect(tree.some(n => n.props.className === 'app-modal app-skilltree-modal')).toBe(true)
    expect(tree.some(n => n.props.className === 'app-train-pending')).toBe(true)
    h.click(h.button(tree, h.format('ui.App.086')))
    tree = h.render(); h.click(h.button(tree, h.format('ui.boost.001')))
    tree = h.render()
    expect(tree.some(n => n.props.className === 'app-boost-now is-on')).toBe(false)
    h.click(h.button(tree, h.format('ui.ItemsPage.056')))
    expect(h.calls.useBoost).toHaveBeenCalledOnce()
    expect(h.state.warehouse.items['synaptic-accelerant']).toBe(1)
    tree = h.render()
    expect(tree.filter(n => n.props.role === 'status')).toHaveLength(1)
    h.click(h.button(tree, h.format('ui.boost.011')))
    expect(h.state.boostAutoRenew).toBe(true)
  })
})
