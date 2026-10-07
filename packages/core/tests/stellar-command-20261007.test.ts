import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as core from '../src/index'
import { buildSimContext } from '@whale/data'
import { ROOT } from './helpers/save-shell'

function command(state: core.GameState, action: string, args: unknown[]) {
  const source = readFileSync(resolve(ROOT, 'apps/desktop/src/renderer/src/game/planetaryCommands.ts'), 'utf8')
  const scope = { exports: {} as { runPlanetaryCommand: (s: core.GameState, ctx: core.SimContext, action: string, args: unknown[]) => core.PlanetActionResult },
    require: (name: string) => name === './debugFlag' ? { planetaryEnabled: () => true } : core }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
  return scope.exports.runPlanetaryCommand(state, buildSimContext(), action, args)
}

describe('隐藏星系命令失败与版本保护', () => {
  it.each([['search', ['specified', '-1']], ['manufactureProbe', []], ['discover', ['missing']]])('新档失败%s不附带开启运行世界', (action, args) => {
    const state = core.createInitialState({ seed: 7, nowWallMs: 0 }), before = structuredClone(state)
    expect(command(state, action as string, args as unknown[]).ok).toBe(false)
    expect(state).toEqual(before)
  })
  it('未来版本调查不得提前返回或改变快照', () => {
    const state = core.createInitialState({ seed: 7, nowWallMs: 0 }), g = core.generateStellarSystem(7)
    g.system.generationVersion = 99 as 1
    state.planetary = { runtimeVersion: 1, planets: Object.fromEntries(g.planets.map(p => [p.id, p])),
      stellar: { systems: { [g.system.id]: g.system }, searchSeq: 0, autoSearch: false } }
    const before = structuredClone(state)
    expect(command(state, 'survey', [g.planets[0]!.id, 3])).toEqual({ ok: false, reason: 'unsupported' })
    expect(state).toEqual(before)
  })
  it('失败建造不留下空殖民对象，显式整备不减候选数', () => {
    const state = core.createInitialState({ seed: 7, nowWallMs: 0 }), g = core.generateStellarSystem(7)
    state.planetary = { runtimeVersion: 1, planets: Object.fromEntries(g.planets.map(p => [p.id, p])),
      stellar: { systems: { [g.system.id]: g.system }, searchSeq: 0, autoSearch: false } }
    const p = g.planets[0]!
    p.survey = 3
    const index = p.cells.find(c => !c.obstacle)!.index, before = structuredClone(state)
    expect(command(state, 'build', [p.id, index, 'base']).ok).toBe(false)
    expect(state).toEqual(before)
    expect(command(state, 'prepare', [p.id]).ok).toBe(true)
    expect(core.stellarCandidateCount(state)).toBe(1)
  })
})
