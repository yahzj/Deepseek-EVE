import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import * as core from '../src/index'

type Node = { type: unknown; props: Record<string, any>; children: unknown[] }
const ctx = buildSimContext()
function nodes(value: unknown): Node[] {
  const out: Node[] = []
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return }
    if (!v || typeof v !== 'object' || !('children' in v)) return
    const node = v as Node
    out.push(node); node.children.forEach(visit)
  }
  visit(value); return out
}
function text(v: unknown): string {
  if (Array.isArray(v)) return v.map(text).join('')
  if (v && typeof v === 'object' && 'children' in v) return text((v as Node).children)
  return v == null || typeof v === 'boolean' ? '' : String(v)
}
function harness(name: string, language: 'zh' | 'en' = 'zh', storage = new Map<string, string>()) {
  const path = 'apps/desktop/src/renderer/src/panels/WormholeExpedition.tsx'
  const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const body = ast.statements.filter((node) => !ts.isImportDeclaration(node)).map((node) => node.getText(ast)).join('\n')
  const state = core.createInitialState({ nowWallMs: 0, seed: 7 })
  const ship = core.addShipToFleet(state, 'sh-thresher')
  state.shipId = ship
  state.fleet[ship]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  const values: any[] = []
  const refs: Array<{ current: unknown }> = []
  let cursor = 0
  let refCursor = 0
  const tr = (id: string, params?: Record<string, unknown>) => (L10N[id]?.[language] ?? id).replace(/\{(\w+)\}/g, (m, key) => String(params?.[key] ?? m))
  const scope: Record<string, any> = { ...core, exports: {}, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    tr, currentLocale: () => language, itemIconOf: () => 'cargo', Glyph: 'Glyph', document: { activeElement: null },
    useState: (initial: unknown) => { const at = cursor++; if (!(at in values)) values[at] = typeof initial === 'function' ? (initial as Function)() : initial; return [values[at], (value: unknown) => { values[at] = typeof value === 'function' ? (value as Function)(values[at]) : value }] },
    useRef: (value: unknown) => { const at = refCursor++; return refs[at] ??= { current: value } }, useId: () => 'input', useEffect: () => {},
    React: { createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
  }
  runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  const engine = { state, ctx,
    wormholeEventView: () => core.wormholeEventView(state, ctx),
    wormholeAlertView: () => core.wormholeAlertView(state),
    wormholeEncounterView: (key: string) => core.wormholeEncounterView(state, ctx, key),
    wormholeResolveEvent: (action: core.WormholeEventAction, preview?: core.WormholeEventPreview) => core.wormholeResolveEvent(state, ctx, action, preview),
    wormholePrepare: (picked: string[], request: core.WormholePreparationRequest) => core.wormholePreparationPlan(state, ctx, picked, request),
    wormholePrepareFill: (picked: string[], request: core.WormholePreparationRequest) => core.wormholePreparationFillPlan(state, ctx, picked, request),
    wormholePrepareFromTemplate: (picked: string[], request: core.WormholePreparationRequest, id: string) => { const template = state.wormholePreparationTemplates?.find(t => t.id === id); return template ? core.wormholeTemplateFillPlan(state, ctx, picked, request, template) : null },
    wormholeSaveTemplate: async (name: string, targets: Record<string, number>, id?: string) => ({ ...core.wormholeSavePreparationTemplate(state, name, targets, id), saved: true }),
    wormholeRenameTemplate: async (id: string, name: string) => ({ ...core.wormholeRenamePreparationTemplate(state, id, name), saved: true }),
    wormholeDeleteTemplate: async (id: string) => ({ ...core.wormholeDeletePreparationTemplate(state, id), saved: true }),
    wormholeEntryGate: () => null,
    wormholeExtractionPreview: (request: core.WormholeExtractionRequest) => core.wormholeExtractionPlan(state, ctx, request),
    wormholeExtractConfirmed: (plan: core.WormholeExtractionPlan) => core.wormholeConfirmExtraction(state, ctx, plan),
  }
  const fn = scope.exports[name]
  const render = (props: object) => { cursor = 0; refCursor = 0; return nodes(fn({ engine, ...props })) }
  return { state, ship, engine, render, values, tr, storage }
}

describe('虫洞整备组件 · 真实预览与模板', () => {
  it.each(['zh', 'en'] as const)('%s 多模板选择不执行、末尾补齐按总量写入，现役与备用分开', async (language) => {
    const view = harness('WhPreparation', language)
    const fleet = Array.from({ length: 4 }, () => core.addShipToFleet(view.state, 'sh-nautilus'))
    view.state.shipId = fleet[0]!
    view.state.warehouse.items['drone-scout'] = 100
    for (const uid of fleet) expect(core.adjustDroneLoad(view.state, ctx, 'drone-scout', 8, uid).ok).toBe(true)
    const received: core.WormholePreparationPlan[] = []
    const props = { picked: fleet, stockId: 'hole', onEnter: (plan: core.WormholePreparationPlan) => received.push(plan) }
    const click = (id: string) => view.render(props).find(n => n.type === 'button' && text(n.children) === view.tr(id))!.props.onClick()
    const input = () => view.render(props).find(n => n.type === 'input' && n.props.id === 'input-drone-scout')!
    const before = structuredClone(view.state)
    expect(input().props.value).toBe(0)
    expect(view.render(props).find(n => n.props['data-wh-template-fill'])!.props.disabled).toBe(true)
    expect(view.render(props).some(n => n.props['data-wh-goal'])).toBe(false)
    input().props.onChange({ target: { value: '32' } })
    click('ui.whExpedition.012')
    view.render(props).find(n => n.props['data-wh-template-name'])!.props.onChange({ target: { value: '无人机备用' } })
    click('ui.whExpedition.120')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.state.wormholePreparationTemplates).toHaveLength(1)
    input().props.onChange({ target: { value: '0' } })
    input().props.onBlur({ target: { value: '0' } })
    view.render(props).find(n => n.props['data-wh-template-select'])!.props.onChange({ target: { value: 'manifest-1' } })
    expect(input().props.value).toBe(0)
    click('ui.whExpedition.011')
    expect(input().props.value).toBe(32)
    expect(view.render(props).find(n => n.props['data-wh-deployed'] === 'drone-scout')!.children.map(text).join('')).toBe(`${view.tr('ui.FitPage.010')} 32`)
    const row = view.render(props).find(n => n.props['data-wh-manifest-item'] === 'drone-scout')!
    expect(text(row.children)).toContain(view.tr('ui.whExpedition.021'))
    expect(view.state.warehouse).toEqual(before.warehouse)
    expect(view.state.fleet).toEqual(before.fleet)
    click('ui.whExpedition.011')
    expect(input().props.value).toBe(32)
    click('ui.whExpedition.014')
    expect(received).toHaveLength(0)
    click('ui.whExpedition.014')
    expect(received).toHaveLength(1)
    expect(received[0]!.items['drone-scout']).toBe(32)
    expect(view.state.warehouse).toEqual(before.warehouse)
    input().props.onChange({ target: { value: '0' } })
    click('ui.whExpedition.012')
    view.render(props).find(n => n.props['data-wh-template-name'])!.props.onChange({ target: { value: '不带备用' } })
    click('ui.whExpedition.120')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.state.wormholePreparationTemplates).toHaveLength(2)
    input().props.onChange({ target: { value: '12' } })
    click('ui.whExpedition.011')
    expect(input().props.value).toBe(0)
    const tools = view.render(props).find(n => n.props.className === 'app-wh-manifest-tools app-wh-template-tools')!
    expect(nodes(tools).filter(n => n.type === 'button').at(-1)!.props['data-wh-template-fill']).toBe(true)
  })

  it('按钮补齐缺货/超容保持目标，确认失败不扣物资', () => {
    const view = harness('WhPreparation')
    view.state.fleet[view.ship]!.droneLoad = { 'drone-scout': 4 }
    view.state.warehouse.items = { 'drone-scout': 1, 'repairkit-mil': 2500 }
    core.wormholeSavePreparationTemplate(view.state, '不足与超容', { 'drone-scout': 4, 'repairkit-mil': 2500 })
    const received: core.WormholePreparationPlan[] = []
    const props = { picked: [view.ship], stockId: 'hole', onEnter: (plan: core.WormholePreparationPlan) => received.push(plan) }
    const click = (id: string) => view.render(props).find(n => n.type === 'button' && text(n.children) === view.tr(id))!.props.onClick()
    const before = structuredClone(view.state)
    view.render(props).find(n => n.props['data-wh-template-select'])!.props.onChange({ target: { value: 'manifest-1' } })
    click('ui.whExpedition.011')
    const field = view.render(props).find(n => n.type === 'input' && n.props.id === 'input-drone-scout')!
    expect(field.props.value).toBe(4)
    expect(field.props['aria-invalid']).toBe(true)
    expect(view.render(props).some(n => n.type === 'a' && text(n.children).includes(view.tr('ui.whExpedition.006', { p1: 3 })))).toBe(true)
    click('ui.whExpedition.014')
    expect(received).toEqual([])
    expect(view.state).toEqual(before)
    view.state.warehouse.items['drone-scout'] = 10
    view.render(props).find(n => n.type === 'input' && n.props.id === 'input-repairkit-mil')!.props.onChange({ target: { value: '2500' } })
    click('ui.whExpedition.011')
    expect(view.render(props).some(n => n.type === 'p' && text(n.children) === view.tr('ui.whExpedition.017'))).toBe(true)
    click('ui.whExpedition.014')
    expect(received).toEqual([])
    expect(view.state.warehouse.items['repairkit-mil']).toBe(2500)
  })

  it.each(['zh', 'en'] as const)('%s 缺额保留目标，保存/覆盖/删除可取消，双确认才入场', async (language) => {
    const view = harness('WhPreparation', language)
    const BASE = 'ammo-kinetic-l'
    view.state.warehouse.items[BASE] = 5
    const received: core.WormholePreparationPlan[] = []
    const props = { picked: [view.ship], stockId: 'hole', onEnter: (plan: core.WormholePreparationPlan) => received.push(plan) }
    const input = () => view.render(props).find((node) => node.type === 'input' && node.props.id === `input-${BASE}`)!
    const click = (id: string) => view.render(props).find((node) => node.type === 'button' && text(node.children) === view.tr(id))!.props.onClick()
    input().props.onChange({ target: { value: '20' } })
    input().props.onBlur({ target: { value: '20' } })
    expect(input().props.value).toBe(20)
    expect(view.render(props).some((node) => text(node.children).includes(view.tr('ui.whExpedition.006', { p1: 15 })))).toBe(true)
    click('ui.whExpedition.011'); click('ui.whExpedition.014')
    expect(received).toHaveLength(0)
    expect(view.state.warehouse.items[BASE]).toBe(5)
    click('ui.whExpedition.012')
    click('ui.whExpedition.120')
    await new Promise(resolve => setTimeout(resolve, 0))
    input().props.onChange({ target: { value: '3' } })
    const byData = (key: string) => view.render(props).find(n => n.props[key])!
    byData('data-wh-template-manage').props.onClick()
    byData('data-wh-template-overwrite').props.onClick()
    expect(view.state.wormholePreparationTemplates![0]!.targets[BASE]).toBe(20)
    byData('data-wh-template-cancel').props.onClick()
    byData('data-wh-template-delete').props.onClick()
    byData('data-wh-template-cancel').props.onClick()
    expect(view.state.wormholePreparationTemplates).toHaveLength(1)
    click('ui.whExpedition.011')
    expect(input().props.value).toBe(20)
    view.state.warehouse.items[BASE] = 100
    click('ui.whExpedition.014')
    expect(received).toHaveLength(0)
    click('ui.whExpedition.014')
    expect(received).toHaveLength(1)
    expect(received[0]!.items[BASE]).toBe(20)
    expect(view.state.warehouse.items[BASE]).toBe(100)
  })

  it('旧舰载模块卸港时不遗留无效数量，不把删除界面草稿当删除实物', () => {
    const view = harness('WhPreparation')
    view.state.fleet[view.ship]!.cargo['mod-turret-kin-1'] = 2
    const props = { picked: [view.ship], stockId: 'hole', onEnter: () => {} }
    const before = structuredClone(view.state)
    const checkbox = view.render(props).find((node) => node.type === 'input' && node.props.type === 'checkbox')!
    checkbox.props.onChange({ target: { checked: true } })
    expect(view.engine.wormholePrepare([view.ship], view.values[0]).ok).toBe(true)
    expect(view.state).toEqual(before)
  })

  it('恢复草稿重新核对库存，损坏模板不导致崩溃或改变实物', () => {
    const storage = new Map<string, string>()
    const view = harness('WhPreparation', 'zh', storage)
    const BASE = 'ammo-kinetic-l'
    storage.set(`whale-idle:wh-manifest:${view.state.character.name}:hole`, JSON.stringify({ picked: [view.ship], request: { targets: { [BASE]: 50 }, unload: [] } }))
    view.state.warehouse.items[BASE] = 2
    const props = { picked: [view.ship], stockId: 'hole', onEnter: () => {} }
    const rendered = view.render(props)
    expect(rendered.find((n) => n.type === 'input' && n.props.type === 'number' && n.props.id === `input-${BASE}`)!.props.value).toBe(50)
    expect(rendered.some((n) => n.type === 'a' && text(n.children).includes(view.tr('ui.whExpedition.006', { p1: 48 })))).toBe(true)
    storage.set('whale-idle:wh-manifest-template', '{bad')
    const before = structuredClone(view.state)
    rendered.find(n => n.props['data-wh-template-manage'])!.props.onClick()
    expect(view.render(props).some(n => n.props['data-wh-template-import'])).toBe(false)
    expect(view.state).toEqual(before)
    expect(view.values[0].targets[BASE]).toBe(50)
  })

  it('旧模板只有手动导入后进当前角色，不改变清单或实物', async () => {
    const storage = new Map([['whale-idle:wh-manifest-template', JSON.stringify({ picked: [], request: { targets: { 'drone-scout': 0, 'ammo-kinetic-l': 80 }, unload: [] } })]])
    const view = harness('WhPreparation', 'zh', storage)
    const props = { picked: [view.ship], stockId: 'hole', onEnter: () => {} }
    const find = (key: string) => view.render(props).find(n => n.props[key])!
    const before = structuredClone(view.state)
    expect(view.state.wormholePreparationTemplates).toBeUndefined()
    find('data-wh-template-manage').props.onClick()
    find('data-wh-template-import').props.onClick()
    expect(view.state.wormholePreparationTemplates).toBeUndefined()
    find('data-wh-template-confirm').props.onClick()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.state.wormholePreparationTemplates![0]!.targets).toEqual({ 'drone-scout': 0, 'ammo-kinetic-l': 80 })
    expect(view.values[0].targets).toEqual({})
    expect(view.state.warehouse).toEqual(before.warehouse)
    expect(view.state.fleet).toEqual(before.fleet)
  })

  it('模板写盘失败不冒称已保存，忙碌期间双击不新增两套', async () => {
    const view = harness('WhPreparation')
    const props = { picked: [view.ship], stockId: 'hole', onEnter: () => {} }
    let finish: (() => void) | undefined
    view.engine.wormholeSaveTemplate = async (name, targets, id) => {
      const result = core.wormholeSavePreparationTemplate(view.state, name, targets, id)
      await new Promise<void>(resolve => { finish = resolve })
      return { ...result, saved: false }
    }
    const find = (key: string) => view.render(props).find(n => n.props[key])!
    find('data-wh-template-save').props.onClick()
    const confirm = find('data-wh-template-confirm')
    confirm.props.onClick(); confirm.props.onClick()
    expect(view.state.wormholePreparationTemplates).toHaveLength(1)
    expect(find('data-wh-enter-prepared').props.disabled).toBe(true)
    finish!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(view.render(props).some(n => text(n.children) === view.tr('ui.whExpedition.127'))).toBe(true)
    expect(view.render(props).some(n => text(n.children) === view.tr('ui.whExpedition.128'))).toBe(false)
  })

  it('已有40发时允许先清空再输入45，失焦才归一化，实物不动', () => {
    const view = harness('WhPreparation')
    view.state.fleet[view.ship]!.cargo['ammo-kinetic-l'] = 40
    const props = { picked: [view.ship], stockId: 'hole', onEnter: () => {} }
    const input = () => view.render(props).find(n => n.props.id === 'input-ammo-kinetic-l')!
    const before = structuredClone(view.state)
    input().props.onChange({ target: { value: '' } })
    expect(input().props.value).toBe('')
    expect(view.values[0].targets['ammo-kinetic-l']).toBe(40)
    input().props.onChange({ target: { value: '4' } })
    expect(input().props.value).toBe('4')
    input().props.onChange({ target: { value: '45' } })
    input().props.onBlur({ target: { value: '45' } })
    expect(input().props.value).toBe(45)
    expect(view.values[0].targets['ammo-kinetic-l']).toBe(45)
    input().props.onChange({ target: { value: '0' } })
    expect(input().props.value).toBe('0')
    input().props.onBlur({ target: { value: '0' } })
    expect(input().props.value).toBe(40)
    expect(view.state).toEqual(before)
  })
})

describe('虫洞撤离组件 · 冻结确认清单', () => {
  it('预览与取消不扣货，过期确认拒绝并重新生成清单', () => {
    const view = harness('WhExtraction')
    view.state.warehouse.items['repairkit-mil'] = 3000
    const enter = core.wormholePreparationPlan(view.state, ctx, [view.ship], { targets: { 'repairkit-mil': 1000 }, unload: [] })
    expect(core.wormholeEnterPrepared(view.state, ctx, [view.ship], 7, enter).ok).toBe(true)
    const run = view.state.wormhole.run!
    let cancelled = 0
    const props = { onCancel: () => cancelled++ }
    const before = structuredClone(view.state)
    const click = (id: string) => view.render(props).find((node) => node.type === 'button' && text(node.children) === view.tr(id))!.props.onClick()
    view.render(props)
    expect(view.state).toEqual(before)
    click('ui.ActivityBar.004')
    expect(cancelled).toBe(1)
    expect(view.state).toEqual(before)
    run.supplies!.items['repairkit-mil'] = 900
    click('ui.whExpedition.035')
    expect(view.state.wormhole.run).toBe(run)
    expect(view.values[2]).toBe(view.tr('ui.whExpedition.036'))
    click('ui.whExpedition.035')
    expect(view.state.wormhole.run).toBeNull()
    expect(view.state.warehouse.items['repairkit-mil']).toBe(2900)
  })
})

describe('第二批事件组件 · 风险与拒因', () => {
  it.each(['zh', 'en'] as const)('%s 维护缺料可见且免费离开可操作，不通过按钮绕过费用', language => {
    const view = harness('WhEventChoices', language)
    const plan = core.wormholePreparationPlan(view.state, ctx, [view.ship], { targets: {}, unload: [] })
    expect(core.wormholeEnterPrepared(view.state, ctx, [view.ship], 19, plan, undefined, { expeditionRules: 2 }).ok).toBe(true)
    const run = view.state.wormhole.run!, cell = run.grid!.cells.find(c => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    cell.eventKey = 'maintenance'; cell.event = {}; run.pendingEvent = { key: 'maintenance', cellKey: cell.key }
    const props = { onToast: () => {} }
    const rows = view.render(props)
    expect(rows.find(n => n.props['data-wh-event-action'] === 'repair')!.props.disabled).toBe(true)
    expect(rows.some(n => n.props.role === 'status' && text(n.children).includes(view.tr('ui.whExpedition.065', { p1: `${ctx.items.get('repairkit-mil')!.name} ×20` })))).toBe(true)
    const before = structuredClone(run.supplies)
    rows.find(n => n.props['data-wh-event-action'] === 'bypass')!.props.onClick()
    expect(view.state.wormhole.run!.supplies).toEqual(before)
    expect(view.state.wormhole.run!.pendingEvent).toBeUndefined()
  })

  it('伪装求援先显示风险，第一次点击只确认，第二次才真实开战', () => {
    const view = harness('WhEventChoices')
    const plan = core.wormholePreparationPlan(view.state, ctx, [view.ship], { targets: {}, unload: [] })
    expect(core.wormholeEnterPrepared(view.state, ctx, [view.ship], 19, plan, undefined, { expeditionRules: 2 }).ok).toBe(true)
    const run = view.state.wormhole.run!, cell = run.grid!.cells.find(c => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    cell.eventKey = 'distress'; cell.event = { identity: 'ambush' }; run.pendingEvent = { key: 'distress', cellKey: cell.key }
    const props = { onToast: () => {} }
    const respond = () => view.render(props).find(n => n.props['data-wh-event-action'] === 'respond')!
    const before = structuredClone(view.state)
    respond().props.onClick()
    expect(view.state).toEqual(before)
    expect(text(respond().children)).toBe(view.tr('ui.whExpedition.103'))
    respond().props.onClick()
    expect(view.state.wormhole.run!.battle).toBeTruthy()
    expect(view.state.wormhole.run!.alertLevel).toBe(2)
  })
})
