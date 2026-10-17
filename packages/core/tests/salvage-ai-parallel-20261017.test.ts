import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { L10N } from '@whale/data'
import { assignAiSalvage, advanceAi, idleAiShipIds } from '../src/ai'
import { createInitialState } from '../src/state'
import { advanceSalvageOp, startSalvageOp } from '../src/salvaging'
import { anomaly, galaxy, makeTestCtx, moduleDef, ship } from './helpers'
import { ROOT } from './helpers/save-shell'

type UiNode = { type: unknown; props: Record<string, any>; children: unknown[] }

function nodes(value: unknown): UiNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object' || !('children' in value)) return []
  const node = value as UiNode
  return [node, ...node.children.flatMap(nodes)]
}

function assignmentJsx(): string {
  const path = resolve(ROOT, 'apps/desktop/src/renderer/src/pages/MapPage.tsx')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const card = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'WreckCard')
  if (!card) throw new Error('残骸卡组件不存在')
  let block: ts.JsxElement | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attr =>
      ts.isJsxAttribute(attr) && attr.name.getText(source) === 'className'
      && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text === 'app-belt-ai',
    )) block = node
    ts.forEachChild(node, visit)
  }
  visit(card)
  if (!block) throw new Error('残骸卡副船指派条不存在')
  return block.getText(source)
}

const jsx = assignmentJsx()

function assignmentButton(locale: 'zh' | 'en', bindings: Record<string, unknown>): UiNode {
  const scope = {
    result: undefined,
    React: { createElement: (type: unknown, props: object | null, ...children: unknown[]) => ({ type, props: props ?? {}, children }) },
    tr: (id: string) => L10N[id]?.[locale] ?? id,
    shipDisplayName: () => '副船', aiCoreText: () => 'AI', aiEfficiency: () => 0.4,
    state: {}, engine: { ctx: {} },
    setAiShipId: vi.fn(), setAiCoreSel: vi.fn(),
    ...bindings,
  }
  runInNewContext(ts.transpileModule(`globalThis.result = (${jsx})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText, scope)
  return nodes(scope.result).find(node => node.type === 'button')!
}

function setup() {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const ctx = makeTestCtx({
    ships: [ship('sandcat', { cargo: 800 }), ship('sandcat2', { cargo: 800 })],
    galaxies: [{ ...galaxy('galaxy-scrap', '废场'), security: 1 }],
    edges: [{ from: 'galaxy-hub', to: 'galaxy-scrap', travelMinutes: 2 }],
    anomalies: [anomaly('ano-scrap', 'galaxy-scrap', { threat: 8 })],
    modules: [moduleDef('mod-salvager-1', 'salvager', 0, { salvageCycleMs: 1000 })],
  })
  state.debugQuick = true
  state.skills.trained['ai-expert'] = 1
  state.aiCores.basic = 1
  state.exploredGalaxies.push('galaxy-scrap')
  state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
  state.fleet['sandcat2'] = {
    durability: 1, cargo: {}, fitted: { high: ['mod-salvager-1'], mid: [], low: [] },
  }
  state.galaxyWrecks['galaxy-scrap'] = { density: 20, rare: 0 }
  expect(startSalvageOp(state, 'galaxy-scrap', ctx).ok).toBe(true)
  return { state, ctx }
}

describe('残骸卡副船指派不受主控打捞忙态影响', () => {
  it.each(['zh', 'en'] as const)('%s：同星系、异星系及主控返航时按钮可用，指派不改变主控作业', locale => {
    for (const target of ['galaxy-scrap', 'galaxy-hub']) {
      for (const phase of ['salvaging', 'returning'] as const) {
        const { state, ctx } = setup()
        state.salvaging.phase = phase
        const pilotBefore = structuredClone(state.salvaging)
        const onAiAssign = vi.fn((galaxyId: string, shipId: string, coreType: 'basic') =>
          assignAiSalvage(state, shipId, coreType, galaxyId, ctx),
        )
        const button = assignmentButton(locale, {
          state, engine: { state, ctx }, g: { id: target }, activeAnywhere: state.salvaging.active,
          idleShips: idleAiShipIds(state), aiShipId: 'sandcat2', effCore: 'basic', usableCores: ['basic'], onAiAssign,
        })
        expect(button.props.disabled).toBe(false)
        expect(button.props.title).toBe(L10N['ui.MapPage.075']![locale])
        button.props.onClick()
        expect(onAiAssign).toHaveBeenCalledWith(target, 'sandcat2', 'basic')
        expect(onAiAssign.mock.results[0]!.value).toEqual({ ok: true })
        expect(state.salvaging).toEqual(pilotBefore)
        expect(state.aiAssignments['sandcat2']!.task).toMatchObject({ kind: 'salvage', galaxyId: target })
        expect(state.aiCores.basic).toBe(0)
      }
    }
  })

  it.each(['zh', 'en'] as const)('%s：未选船或无可用核心仍禁用并给出对应提示', locale => {
    for (const [aiShipId, usableCores, tipId] of [
      ['', ['basic'], 'ui.MapPage.047'],
      ['sandcat2', [], 'ui.MapPage.045'],
    ] as const) {
      const button = assignmentButton(locale, {
        g: { id: 'galaxy-scrap' }, activeAnywhere: true, idleShips: ['sandcat2'],
        aiShipId, usableCores, effCore: 'basic',
      })
      expect(button.props.disabled).toBe(true)
      expect(button.props.title).toBe(L10N[tipId]![locale])
    }
  })

  it('真实主控与副船指令可在同星系并行结算，分别把残骸装入各自货仓', () => {
    const { state, ctx } = setup()
    expect(assignAiSalvage(state, 'sandcat2', 'basic', 'galaxy-scrap', ctx).ok).toBe(true)
    advanceSalvageOp(state, 1000, ctx)
    advanceAi(state, 10_000, ctx)
    expect(state.salvaging.active).toBe(true)
    expect(state.salvaging.tripM3).toBeGreaterThan(0)
    const task = state.aiAssignments['sandcat2']!.task
    expect(task.kind).toBe('salvage')
    if (task.kind !== 'salvage') throw new Error('副船任务类型错误')
    expect(task.tripM3).toBeGreaterThan(0)
    expect(Object.values(state.fleet[state.shipId]!.cargo).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    expect(Object.values(state.fleet['sandcat2']!.cargo).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })
})
