import { readFileSync, existsSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import * as core from '../src/index'
import { gameSaveMethods } from './helpers/save-shell'
import { finishDeparture } from './helpers/departure-ready'

type Node = { type: string; props: Record<string, any>; children: unknown[] }
const file = '../../../apps/desktop/src/renderer/src/features/combat/FlagshipFleetActions.tsx'
const source = readFileSync(new URL(file, import.meta.url), 'utf8')
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (value && typeof value === 'object' && 'children' in value) {
    const node = value as Node
    return [node, ...node.children.flatMap(nodes)]
  }
  return []
}
function view() {
  const ctx = buildSimContext(), state = core.createInitialState({ nowWallMs: 0 })
  state.fleetPresets = [{ id: 'fleet-1', name: 'Alpha', leaderShipId: state.shipId, shipIds: [state.shipId] }]
  const engine = { state, ctx, fleetPresetApply: vi.fn((_id: string) => ({ ok: true } as core.CommandResult)),
    challengeWeekendFlagship: vi.fn(() => ({ ok: true } as core.CommandResult)) }
  const values: unknown[] = []
  let cursor = 0
  const tr = (id: string, params?: Record<string, string | number>) => l10nEntryText(L10N[id]!, 'zh')
    .replace(/\{(\w+)\}/g, (slot, key: string) => String(params?.[key] ?? slot))
  const scope = { ...core, exports: {}, tr, cmdText: (r: core.CommandResult) => r.errorId ? tr(r.errorId, r.errorParams) : r.error ?? '',
    React: { createElement: (type: string, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    useState: (initial: unknown) => { const at = cursor++; if (!(at in values)) values[at] = initial; return [values[at], (next: unknown) => { values[at] = next }] },
  }
  const ast = ts.createSourceFile('FlagshipFleetActions.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const code = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, scope)
  const component = (scope.exports as { FlagshipFleetActions: (props: unknown) => unknown }).FlagshipFleetActions
  const onStarted = vi.fn()
  const render = () => { cursor = 0; return nodes(component({ engine, onStarted })) }
  return { engine, render, onStarted }
}

describe('旗舰当前编队与预设切换入口', () => {
  it('三个宿主直接使用同一操作件，不再引用旧准备弹层', () => {
    for (const path of ['App.tsx', 'panels/WeekendInvasionLog.tsx', 'panels/StarMap.tsx']) {
      const text = readFileSync(new URL(`../../../apps/desktop/src/renderer/src/${path}`, import.meta.url), 'utf8')
      expect(text).toContain('<FlagshipFleetActions engine={engine}')
      expect(text).not.toMatch(/WeekendFlagshipPrepModal|setPrepOpen/)
    }
    expect(existsSync(new URL('../../../apps/desktop/src/renderer/src/panels/WeekendFlagshipPrep.tsx', import.meta.url))).toBe(false)
  })

  it('选择预设不立即换船，明确切换只调用正式预设命令，不自动挑战', () => {
    const ui = view()
    let tree = ui.render()
    const switchButton = () => tree.find(n => n.type === 'button' && n.children.includes(L10N['ui.flagshipFleet.003']!.zh))!
    expect(switchButton().props.disabled).toBe(true)
    tree.find(n => n.type === 'select')!.props.onChange({ target: { value: 'fleet-1' } })
    expect(ui.engine.fleetPresetApply).not.toHaveBeenCalled()
    tree = ui.render()
    expect(switchButton().props.disabled).toBe(false)
    switchButton().props.onClick()
    expect(ui.engine.fleetPresetApply).toHaveBeenCalledWith('fleet-1')
    expect(ui.engine.challengeWeekendFlagship).not.toHaveBeenCalled()
    expect(ui.render().some(n => n.props.role === 'status')).toBe(true)
  })

  it('切换失败显示原因；挑战不携带旧阵容，成功才通知宿主关闭', () => {
    const ui = view()
    ui.engine.fleetPresetApply.mockReturnValue({ ok: false, errorId: 'core.fleetPreset.001' })
    let tree = ui.render()
    tree.find(n => n.type === 'select')!.props.onChange({ target: { value: 'fleet-1' } })
    tree = ui.render()
    tree.find(n => n.type === 'button' && n.children.includes(L10N['ui.flagshipFleet.003']!.zh))!.props.onClick()
    expect(ui.render().some(n => n.props.role === 'alert' && n.children.includes(L10N['core.fleetPreset.001']!.zh))).toBe(true)
    ui.engine.challengeWeekendFlagship.mockReturnValue({ ok: false, error: 'ammo warning' })
    const challenge = () => ui.render().find(n => n.type === 'button' && n.children.includes(L10N['ui.weekend.074']!.zh))!
    challenge().props.onClick()
    expect(ui.engine.challengeWeekendFlagship).toHaveBeenLastCalledWith()
    expect(ui.onStarted).not.toHaveBeenCalled()
    ui.engine.challengeWeekendFlagship.mockReturnValue({ ok: true })
    challenge().props.onClick()
    expect(ui.onStarted).toHaveBeenCalledOnce()
  })

  it('胶水层弹药预检与真实挑战冻结同一当前名单', () => {
    const state = core.createInitialState({ nowWallMs: 0 })
    let consent: (() => core.CommandResult) | undefined
    const ready = vi.fn(() => ({ ok: true }))
    const preview = vi.fn((..._args: unknown[]) => ({}))
    const methods = gameSaveMethods(['challengeWeekendFlagship'], { combatRosterOf: () => ['current', 'wing'],
      weekendStartFlagshipBattle: preview, Date: { now: () => 1 } })
    Object.assign(methods, { state, ctx: buildSimContext(), challengeWeekendFlagshipReady: ready,
      withBattleAmmoWarning: (_key: string, ids: string[], next: () => core.CommandResult, _unused: unknown, check: (s: core.GameState) => unknown) => {
        expect(ids).toEqual(['current', 'wing']); consent = next; check(state); return { ok: false }
      } })
    ;(methods.challengeWeekendFlagship as () => unknown)()
    state.shipId = 'other'
    consent!()
    expect(ready).toHaveBeenCalledWith(['current', 'wing'])
    expect(preview.mock.calls[0]![3]).toEqual(['current', 'wing'])
  })

  it('核心收复通知中的预设切换使用真实命令，返航旧队不占新旗舰阵容', () => {
    const ui = view(), { state, ctx } = ui.engine
    const now = 1794974400000
    state.fleet = {}
    const old = [core.addShipToFleet(state, 'sh-shrike'), core.addShipToFleet(state, 'sh-shrike')]
    const next = [core.addShipToFleet(state, 'sh-falconet'), core.addShipToFleet(state, 'sh-falconet')]
    state.shipId = old[0]!
    state.modeChosen = true
    state.standingsEarned = { dsi: 100 }
    state.skills.trained = { 'fleet-command-basic': 5, 'fleet-command-coordination': 5, 'fleet-command-integration': 5 }
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
    state.preparationSquads = { combat: [...old] }
    state.fleetPresets = [{ id: 'fleet-1', name: '接替队', leaderShipId: next[0]!, shipIds: [...next] }]
    expect(core.startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.expedition.battle!.ended = 'me'
    core.resolveBattleOutcome(state, ctx)
    expect(state.expedition.phase).toBe('back')
    state.weekendEvent = { seq: 7, startedAtWallMs: now, coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], family: 'H', contributed: {} }
    core.weekendNoteContribution(state.weekendEvent, 'galaxy-redring', 1)
    core.weekendNoteContribution(state.weekendEvent, 'galaxy-kor', 1)
    expect(core.weekendTick(state, ctx, now, now).flagshipAnchored).toBe(true)
    ui.engine.fleetPresetApply.mockImplementation(id => core.applyFleetPreset(state, ctx, id))
    const ready = vi.fn((squad: string[]) => {
      const battle = core.weekendStartFlagshipBattle(state, ctx, now, squad)
      expect(battle?.myFleet?.map(row => row.shipId)).toEqual(next)
      return { ok: !!battle }
    })
    const methods = gameSaveMethods(['challengeWeekendFlagship'], { combatRosterOf: core.combatRosterOf,
      weekendStartFlagshipBattle: core.weekendStartFlagshipBattle, Date: { now: () => now } })
    Object.assign(methods, { state, ctx, challengeWeekendFlagshipReady: ready,
      withBattleAmmoWarning: (_key: string, _ids: string[], launch: () => core.CommandResult) => launch() })
    ui.engine.challengeWeekendFlagship.mockImplementation(() => (methods.challengeWeekendFlagship as () => core.CommandResult)())
    ui.render().find(node => node.type === 'select')!.props.onChange({ target: { value: 'fleet-1' } })
    ui.render().find(node => node.type === 'button' && node.children.includes(L10N['ui.flagshipFleet.003']!.zh))!.props.onClick()
    expect(core.combatRosterOf(state)).toEqual(next)
    expect(ui.render().some(node => node.props.role === 'status')).toBe(true)
    const returns = structuredClone(state.shipReturns)
    for (const id of old) expect(returns[id]).toBeDefined()
    ui.render().find(node => node.type === 'button' && node.children.includes(L10N['ui.weekend.074']!.zh))!.props.onClick()
    expect(ready).toHaveBeenCalledWith(next)
    expect(ui.onStarted).toHaveBeenCalledOnce()
    expect(state.shipReturns).toEqual(returns)
  })
})
