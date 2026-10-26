import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import type { CommandResult } from '../src/engine'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { advanceAutoLoopBounty, advanceAutoLoopInvasion, startExpedition } from '../src/expedition'
import { confirmBattleRange as coreConfirmBattleRange } from '../src/battleRangeConfirm'
import { cancelBattleRange as coreCancelBattleRange } from '../src/battleRangeMemory'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { gameSaveMethods } from './helpers/save-shell'

const ctx = buildSimContext()
const NOW = new Date(2026, 9, 26, 12).getTime()
type Probe = {
  autoSortie: boolean
  confirmBattleRange(distance: number): CommandResult
  cancelBattleRange(): void
  autoSortieNow(): boolean
}

function world(kind: 'bounty' | 'invasion' | 'manual' | 'manual-invasion') {
  const state = createInitialState({ nowWallMs: NOW, seed: 7 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.fleet[uid]!.fitted = { high: ['mod-laser-2'], mid: [], low: [] }
  state.warehouse.items['ammo-plasma-l'] = 100000
  state.wallMs = NOW
  state.weekendEvent = { seq: 1, startedAtWallMs: NOW, family: 'H', coreId: 'galaxy-kor',
    peripheryIds: ['galaxy-redring'], contributed: {} }
  // 真实规格仍由入口预检，只将这几张卡的历史射程置为旧值。
  state.battleRangeByCard = Object.fromEntries(['ano-training', 'ink-harass', 'ink-raid'].map(id =>
    [id, { desireM: 2500, maxRangeM: 1 }]))
  if (kind === 'bounty') {
    state.autoLoopAnomalyId = 'ano-training'
    advanceAutoLoopBounty(state, ctx)
  } else if (kind === 'invasion') {
    state.weekendEvent.autoLoopGalaxyId = 'galaxy-redring'
    advanceAutoLoopInvasion(state, ctx, NOW)
  } else if (kind === 'manual-invasion') {
    expect(startExpedition(state, 'ink-harass', ctx, { foeGalaxyId: 'galaxy-redring' }).rangeConfirmation).toBe(true)
  } else {
    expect(startExpedition(state, 'ano-training', ctx).rangeConfirmation).toBe(true)
  }
  expect(state.pendingBattleRange?.intent.kind).toBe('expedition')
  expect(state.expedition.battle).toBeNull()
  return state
}

function shell(state: GameState, flag = false) {
  const engine = gameSaveMethods(['confirmBattleRange', 'cancelBattleRange', 'autoSortieNow'], {
    confirmBattleRange: coreConfirmBattleRange,
    cancelBattleRange: coreCancelBattleRange,
  }) as unknown as Probe
  const observed: boolean[] = []
  const persist = vi.fn(() => Promise.resolve())
  const notify = vi.fn(() => { observed.push(engine.autoSortieNow()) })
  Object.assign(engine, { state, ctx, autoSortie: flag, wallNowOf: () => NOW, notify, persist })
  return { engine, observed, persist, notify }
}

describe('连续战斗距离确认的真实引擎外壳', () => {
  it.each(['bounty', 'invasion'] as const)('%s确认成功在通知界面前恢复自动出击，距离与循环保留', kind => {
    const state = world(kind), { engine, observed, persist } = shell(state)
    expect(state.pendingBattleRange!.intent).toMatchObject({ kind: 'expedition', autoRepair: true })
    expect(engine.confirmBattleRange(1700).ok).toBe(true)
    expect(engine.autoSortieNow()).toBe(true)
    expect(observed).toEqual([true])
    expect(persist).toHaveBeenCalledTimes(1)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).toBe(1700)
    if (kind === 'bounty') expect(state.autoLoopAnomalyId).toBe('ano-training')
    else expect(state.weekendEvent!.autoLoopGalaxyId).toBe('galaxy-redring')
  })

  it.each(['bounty', 'invasion'] as const)('%s待确认存读后仍按原连续出击来源恢复', kind => {
    const state = loadSaveFile(serializeSaveFile(world(kind), NOW)).state
    const { engine, observed } = shell(state)
    expect(engine.confirmBattleRange(1700).ok).toBe(true)
    expect(observed).toEqual([true])
  })

  it.each(['manual', 'manual-invasion'] as const)('%s即使残留自动标记也恢复手动展开口径', kind => {
    const state = world(kind), { engine, observed } = shell(state, true)
    expect(engine.confirmBattleRange(1700).ok).toBe(true)
    expect(observed).toEqual([false])
  })

  it.each([false, true])('配置再次变化重新确认不改变旧自动标记%s', flag => {
    const state = world('bounty'), { engine, observed } = shell(state, flag)
    state.fleet[state.shipId]!.fitted.high = ['mod-laser-3']
    expect(engine.confirmBattleRange(1700).rangeConfirmation).toBe(true)
    expect(state.expedition.battle).toBeNull()
    expect(state.pendingBattleRange).toBeDefined()
    expect(observed).toEqual([flag])
    expect(engine.confirmBattleRange(1700).ok).toBe(true)
    expect(observed).toEqual([flag, true])
  })

  it.each([false, true])('确认失败不改变旧自动标记%s，取消仍只沿原停止流程', flag => {
    const state = world('bounty'), { engine, observed } = shell(state, flag)
    expect(engine.confirmBattleRange(Number.NaN).ok).toBe(false)
    expect(observed).toEqual([flag])
    expect(state.pendingBattleRange).toBeDefined()
    engine.cancelBattleRange()
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle).toBeNull()
    expect(state.autoLoopAnomalyId).toBeNull()
    expect(observed).toEqual([flag, flag])
  })

  it('失效的入侵场次确认失败不会被标为自动开战', () => {
    const state = world('invasion'), { engine, observed } = shell(state)
    state.weekendEvent!.seq += 1
    expect(engine.confirmBattleRange(1700).ok).toBe(false)
    expect(state.expedition.battle).toBeNull()
    expect(observed).toEqual([false])
  })
})

/** 运行App真实战场显隐回调，读写ref与状态；不另写一份业务判据。 */
function battleScreenState(automatic: boolean, previouslyOpen: boolean) {
  const source = ts.createSourceFile('App.tsx', readFileSync(new URL(
    '../../../apps/desktop/src/renderer/src/App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect: ts.CallExpression | undefined
  let report: ts.ArrowFunction | undefined
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ['useEffect', 'useLayoutEffect'].includes(node.expression.getText(source)) &&
      node.arguments[0]?.getText(source).includes('prevInBattleRef.current')) effect = node
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'onReport' &&
      node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression &&
      ts.isArrowFunction(node.initializer.expression) && node.initializer.expression.getText(source).includes('battleWatchedRef')) {
      report = node.initializer.expression
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(effect).toBeDefined()
  expect(report).toBeDefined()
  expect(effect!.expression.getText(source)).toBe('useLayoutEffect')
  const view = { open: previouslyOpen, mounted: false, automatic }
  const scope = {
    inBattle: true,
    prevInBattleRef: { current: false }, battleWatchedRef: { current: true },
    engine: { autoSortieNow: () => view.automatic },
    setBattleOpen: (open: boolean) => { view.open = open },
    setBattleMounted: (mounted: boolean) => { view.mounted = mounted },
    useLayoutEffect: (run: () => void) => { scope.run = run },
    run: undefined as unknown as () => void,
    report: undefined as unknown as () => boolean,
  }
  runInNewContext(ts.transpileModule(`${effect!.getText(source)};globalThis.report=${report!.getText(source)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, scope)
  return { view, scope }
}

describe('新战场绘制前显隐与原观看规则', () => {
  it.each([false, true])('连续出击不继承上一场展开状态%s，仍挂载供结算收尾', oldOpen => {
    const { view, scope } = battleScreenState(true, oldOpen)
    scope.run()
    expect(view).toMatchObject({ open: false, mounted: true })
    expect(scope.battleWatchedRef.current).toBe(false)
    expect(scope.report()).toBe(false)
    expect(view.open).toBe(false)
  })

  it('手动战斗默认展开，同场主动还原不被后续重渲染收起，已观看战报仍唤回', () => {
    const manual = battleScreenState(false, false)
    manual.scope.run()
    expect(manual.view.open).toBe(true)
    const automatic = battleScreenState(true, true)
    automatic.scope.run()
    automatic.view.open = true
    automatic.scope.battleWatchedRef.current = true
    automatic.scope.run()
    expect(automatic.view.open).toBe(true)
    automatic.view.open = false
    expect(automatic.scope.report()).toBe(true)
    expect(automatic.view.open).toBe(true)
  })
})
