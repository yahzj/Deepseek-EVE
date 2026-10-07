import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { notePreparationSquad, preparationSquadOf, PREPARATION_SQUAD_KINDS } from '../src/preparationSquads'
import type { PreparationSquadKind } from '../src/preparationSquads'
import type { GameState } from '../src/state'

const root = new URL('../../../', import.meta.url)
function hooks(state: GameState) {
  const source = readFileSync(new URL('apps/desktop/src/renderer/src/ui/usePreparationSquad.ts', root), 'utf8')
  const ast = ts.createSourceFile('usePreparationSquad.ts', source, ts.ScriptTarget.Latest, true)
  const body = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n')
  const values: unknown[] = [], refs: Array<{ current: unknown }> = [], effects: Array<() => void> = []
  let cursor = 0, refCursor = 0, saves = 0
  const engine = { state,
    preparationSquad: (kind: PreparationSquadKind, fallback: string[]) => preparationSquadOf(engine.state, kind, fallback),
    rememberPreparationSquad: (kind: PreparationSquadKind, squad: string[]) => { if (notePreparationSquad(engine.state, kind, squad)) saves++ },
  }
  const scope: Record<string, any> = { exports: {},
    useState: (initial: unknown) => { const index = cursor++; if (!(index in values)) values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial; return [values[index], (value: unknown) => { values[index] = typeof value === 'function' ? (value as (v: unknown) => unknown)(values[index]) : value }] },
    useRef: (value: unknown) => refs[refCursor++] ??= { current: value },
    useEffect: (effect: () => void) => effects.push(effect),
  }
  runInNewContext(ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, scope)
  const render = (kind: PreparationSquadKind, fallback: string[] = []) => {
    cursor = 0; refCursor = 0
    const result = scope.exports.usePreparationSquad(engine, kind, () => fallback) as [string[], (value: string[] | ((v: string[]) => string[])) => void]
    effects.splice(0).forEach(effect => effect())
    return result
  }
  return { engine, render, saves: () => saves }
}

describe('准备阵容统一选择hook', () => {
  it.each(PREPARATION_SQUAD_KINDS)('%s默认重绘不写，改选/清空写入，重挂恢复', kind => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ship = addShipToFleet(state, 'sh-thresher')
    const view = hooks(state)
    expect(view.render(kind, [state.shipId])[0]).toEqual([state.shipId])
    view.render(kind, [state.shipId])
    expect(view.saves()).toBe(0)
    view.render(kind)[1]([ship, state.shipId])
    view.render(kind)
    expect(view.saves()).toBe(1)
    expect(hooks(state).render(kind)[0]).toEqual([ship, state.shipId])
    view.render(kind)[1]([])
    view.render(kind)
    expect(hooks(state).render(kind, [state.shipId])[0]).toEqual([])
    expect(view.saves()).toBe(2)
  })

  it('切换准备类型或加载新存档，不把旧组件选择写入新分类/角色', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const ship = addShipToFleet(state, 'sh-thresher')
    notePreparationSquad(state, 'signal-auto', [ship])
    notePreparationSquad(state, 'wormhole-auto', [])
    const view = hooks(state)
    view.render('signal-auto')
    view.render('wormhole-auto')
    expect(view.render('wormhole-auto')[0]).toEqual([])
    expect(state.preparationSquads?.['wormhole-auto']).toEqual([])
    const other = createInitialState({ nowWallMs: 0, seed: 2 })
    view.engine.state = other
    view.render('signal-auto', [other.shipId])
    expect(view.render('signal-auto', [other.shipId])[0]).toEqual([other.shipId])
    expect(other.preparationSquads).toBeUndefined()
  })

  it('两准备页只让实际主控选择影响整队门禁，忙碌已选船仍可取消', () => {
    for (const name of ['SignalSpace', 'Wormhole']) {
      const source = readFileSync(new URL(`apps/desktop/src/renderer/src/panels/${name}.tsx`, root), 'utf8')
      const ast = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      let initializer: ts.Expression | undefined
      const visit = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'autoGate') initializer = node.initializer
        ts.forEachChild(node, visit)
      }
      visit(ast)
      expect(initializer).toBeDefined()
      const code = 'result=' + initializer!.getText(ast)
      const refusal = { errorId: 'core.wormholeAuto.016' }
      const scope = { autoMainPicked: false, autoMainReason: refusal, autoBlock: null, result: undefined }
      runInNewContext(code, scope)
      expect(scope.result).toBeNull()
      scope.autoMainPicked = true
      runInNewContext(code, scope)
      expect(scope.result).toBe(refusal)
      expect(source).toContain('disabled={!canPick && !on}')
      expect(source).toContain(`usePreparationSquad(engine, auto ? '${name === 'SignalSpace' ? 'signal' : 'wormhole'}-auto'`)
    }
    expect(readFileSync(new URL('apps/desktop/src/renderer/src/panels/WeekendFlagshipPrep.tsx', root), 'utf8'))
      .toContain("usePreparationSquad(engine, 'weekend'")
  })
})
