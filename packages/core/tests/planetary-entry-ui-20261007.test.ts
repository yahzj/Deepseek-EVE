import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { PLANET_TEXT_IDS, createInitialState } from '../src/index'
import { L10N, buildSimContext } from '@whale/data'
import { ROOT } from './helpers/save-shell'
import { isLocalDebugOrigin } from '../src/debugGate'

function gate(protocol: string, hostname: string, debug: string, test: string) {
  const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/game/debugFlag.ts'), 'utf8').replace(/^import.*$/gm, '')
  const scope = { exports: {} as Record<string, () => boolean>, isLocalDebugOrigin,
    location: { protocol, hostname }, localStorage: { getItem: (key: string) => key === 'whale-idle:debug' ? debug : key === 'whale-idle:planetary-test' ? test : null } }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
  return scope.exports.planetaryEnabled!()
}
describe('星球本机门禁与界面双语', () => {
  it.each([
    ['http:', '127.0.0.1', '1', '1', true], ['http:', 'localhost', '1', '', false],
    ['http:', 'localhost', '', '1', false], ['https:', 'game.example.com', '1', '1', false],
    ['file:', '', '1', '1', false],
  ])('本机实验限定 %s/%s', (protocol, host, debug, test, expected) => {
    expect(gate(protocol as string, host as string, debug as string, test as string)).toBe(expected)
  })
  it('关闭时命令不改变新旧状态，未知调用无免费材料', () => {
    const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/game/planetaryCommands.ts'), 'utf8')
    const scope = { exports: {} as { runPlanetaryCommand: (state: unknown, ctx: unknown, action: string, args: unknown[]) => unknown },
      require: (name: string) => name === './debugFlag' ? { planetaryEnabled: () => false } : {} }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    const state = createInitialState({ seed: 7, nowWallMs: 0 }), before = structuredClone(state)
    expect(scope.exports.runPlanetaryCommand(state, buildSimContext(), 'discover', ['planet-prototype-small'])).toEqual({ ok: false, reason: 'entry-blocked' })
    expect(state).toEqual(before)
  })
  it('面板使用的静态语义都有唯一表译文，未接上条目不伪装成未知', () => {
    const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/panels/PlanetaryPanel.tsx'), 'utf8')
    const ast = ts.createSourceFile('PlanetaryPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const missing: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'pt'
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const id = PLANET_TEXT_IDS[node.arguments[0].text]
        if (!id || !L10N[id]?.zh || !L10N[id]?.en) missing.push(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
    expect([...new Set(missing)]).toEqual([])
    expect(source).not.toContain("tr('ui.planet.")
  })
})
