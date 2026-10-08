import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { BountyWinCache, type BountyWinSource } from '../../../apps/desktop/src/renderer/src/game/bountyWinCache'
import { createBountyWinTask } from '../../../apps/desktop/src/renderer/src/game/bountyWinTask'
import type { BountyWinDiagnostic, BountyWinRequest, BountyWinResponse, BountyWinWorker } from '../../../apps/desktop/src/renderer/src/game/bountyWinProtocol'
import { createInitialState } from '../src/state'
import { BATTLE_STEP_MS } from '../src/combat'
import { buildEvalState, estimateBountyWinOn } from '../src/winEstimate'
import { anomaly, makeTestCtx } from './helpers'
import { gameSaveMethods, runSaveModule } from './helpers/save-shell'

const ctx = makeTestCtx({ anomalies: [anomaly('one', 'galaxy-hub', { threat: 1 }), anomaly('two', 'galaxy-hub', { threat: 2 })] })
const result = { winRate: 1, worstWinRate: 1, armorLoss: 0, hullLoss: 0, runs: 30,
  points: [{ desireM: 1000, winRate: 1, runs: 30 }], recorded: true }
class FakeWorker implements BountyWinWorker {
  onmessage: BountyWinWorker['onmessage'] = null
  onerror: BountyWinWorker['onerror'] = null
  onmessageerror: BountyWinWorker['onmessageerror'] = null
  sent: BountyWinRequest[] = []
  terminate = vi.fn()
  postMessage(request: BountyWinRequest) { this.sent.push(structuredClone(request)) }
  finish() {
    const run = this.sent.at(-1) as Extract<BountyWinRequest, { kind: 'run' }>
    this.onmessage?.({ data: { kind: 'result', generation: run.generation, id: run.id, result, computeMs: 2000 } })
  }
}
function fixture() {
  let state = createInitialState({ nowWallMs: 0, seed: 19 })
  let fingerprint = 'one', paused = false, context = ctx, ids = ['one', 'two']
  const workers: FakeWorker[] = []
  const changed = vi.fn(), error = vi.fn(), diagnostics: BountyWinDiagnostic[] = []
  const source = (): BountyWinSource => ({ state, ctx: context, fingerprint, locale: 'zh', ids })
  const cache = new BountyWinCache({ source, paused: () => paused, createWorker: () => {
    const worker = new FakeWorker(); workers.push(worker); return worker
  }, changed, error, diagnostic: event => diagnostics.push(event), now: () => 0 })
  return { cache, workers, changed, error, diagnostics, source,
    pause: (value: boolean) => { paused = value }, change: () => { fingerprint += 'x' },
    replaceState: () => { state = structuredClone(state) }, replaceContext: () => { context = { ...context } },
    board: () => { ids = ['two'] } }
}

describe('单后台胜率预热生命周期', () => {
  it('首次只传独立快照并派发一卡，在途不重复派发，末卡完成释放', () => {
    const f = fixture(), before = structuredClone(f.source().state)
    f.cache.pump()
    const worker = f.workers[0]!
    expect(worker.sent.map(row => row.kind)).toEqual(['init', 'run'])
    f.cache.pump(); f.cache.pump()
    expect(f.workers).toHaveLength(1)
    expect(worker.sent).toHaveLength(2)
    expect(f.cache.get('one')).toBeNull()
    worker.finish()
    expect(f.cache.get('one')).toEqual(result)
    expect(f.changed).toHaveBeenCalledTimes(1)
    expect(worker.sent).toHaveLength(2)
    f.cache.pump()
    expect(worker.sent.at(-1)).toMatchObject({ kind: 'run', id: 'two' })
    worker.finish()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    f.cache.pump()
    expect(f.workers).toHaveLength(1)
    expect(f.source().state).toEqual(before)
    expect(f.diagnostics.filter(event => event.kind === 'result')).toHaveLength(2)
  })
  it.each(['change', 'replaceState', 'replaceContext', 'board'] as const)('%s取消旧代次，迟到结果不写入新缓存', change => {
    const f = fixture()
    f.cache.pump()
    const worker = f.workers[0]!, late = worker.onmessage!
    const run = worker.sent.at(-1) as Extract<BountyWinRequest, { kind: 'run' }>
    f[change]()
    expect(f.cache.get('one')).toBeNull()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    late({ data: { kind: 'result', generation: run.generation, id: run.id, result, computeMs: 2000 } })
    expect(f.changed).not.toHaveBeenCalled()
    f.cache.pump()
    expect(f.workers).toHaveLength(2)
    expect(f.workers[1]!.sent.at(-1)).toMatchObject({ id: change === 'board' ? 'two' : 'one' })
  })
  it('结果抵达时重新检查指纹，不等下个心跳才阻挡过期结果', () => {
    const f = fixture(); f.cache.pump(); f.change(); f.workers[0]!.finish()
    expect(f.cache.get('one')).toBeNull()
    expect(f.changed).not.toHaveBeenCalled()
    expect(f.workers[0]!.terminate).toHaveBeenCalledTimes(1)
  })
  it('进入实时战斗终止并回队头，恢复后重算，已完成结果保留', () => {
    const f = fixture(); f.cache.pump(); f.workers[0]!.finish(); f.cache.pump()
    f.pause(true); f.cache.sync(); f.cache.pump()
    expect(f.workers[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(f.cache.get('one')).toEqual(result)
    f.pause(false); f.cache.pump()
    expect(f.workers[1]!.sent.at(-1)).toMatchObject({ id: 'two' })
  })
  it.each(['error', 'message', 'runtime'] as const)('%s失败不回主线程计算，不反复启动同代次', failure => {
    const f = fixture(); f.cache.pump()
    const worker = f.workers[0]!, run = worker.sent.at(-1) as Extract<BountyWinRequest, { kind: 'run' }>
    if (failure === 'runtime') worker.onerror!({ message: 'failed', preventDefault: vi.fn() })
    else if (failure === 'message') worker.onmessageerror!()
    else worker.onmessage!({ data: { kind: 'error', generation: run.generation, id: run.id, message: 'failed' } })
    f.cache.pump(); f.cache.pump()
    expect(f.workers).toHaveLength(1)
    expect(f.cache.get('one')).toBeNull()
    expect(f.error).toHaveBeenCalledTimes(1)
    f.change(); f.cache.pump()
    expect(f.workers).toHaveLength(2)
  })
  it('reset释放任务和缓存，旧回调不再通知；重复reset幂等', () => {
    const f = fixture(); f.cache.pump()
    const late = f.workers[0]!.onmessage!
    f.cache.reset(); f.cache.reset()
    late({ data: { kind: 'result', generation: 1, id: 'one', result, computeMs: 1 } })
    expect(f.workers[0]!.terminate).toHaveBeenCalledTimes(1)
    expect(f.changed).not.toHaveBeenCalled()
    expect(f.cache.get('one')).toBeNull()
  })
  it('Worker构造失败只记录一次，不触发同步回退', () => {
    const f = fixture(), createWorker = vi.fn(() => { throw new Error('unsupported') })
    const cache = new BountyWinCache({ source: f.source, paused: () => false, changed: f.changed,
      diagnostic: () => {}, error: f.error, now: () => 0, createWorker })
    cache.pump(); cache.pump()
    expect(createWorker).toHaveBeenCalledTimes(1)
    expect(f.error).toHaveBeenCalledTimes(1)
    expect(cache.get('one')).toBeNull()
  })
})

describe('真实后台任务与原评估等价', () => {
  it('10ms及三点30局不变，逐卡结果与同步真引擎相同且不污染原档', () => {
    expect(BATTLE_STEP_MS).toBe(10)
    const state = createInitialState({ nowWallMs: 0, seed: 19 }), before = structuredClone(state)
    const snap = buildEvalState(state, state.shipId)!
    const worker = createBountyWinTask(() => ctx, () => 0)
    expect(worker({ kind: 'init', generation: 1, locale: 'zh', snapshot: structuredClone(snap) })).toBeNull()
    for (const id of ['one', 'two']) {
      const response = worker({ kind: 'run', generation: 1, id }) as Extract<BountyWinResponse, { kind: 'result' }>
      expect(response.kind).toBe('result')
      expect(response.result).toEqual(estimateBountyWinOn(snap.ev, ctx, ctx.anomalies.get(id)!, snap.uid))
      expect(response.result.runs).toBe(30)
      expect(response.result.points.map(row => row.runs)).toEqual([10, 10, 10])
    }
    expect(state).toEqual(before)
    expect(worker({ kind: 'run', generation: 0, id: 'one' })).toMatchObject({ kind: 'error' })
    expect(worker({ kind: 'run', generation: 1, id: 'missing' })).toMatchObject({ kind: 'error' })
  })
  it('真实引擎热路径不再同步调用评估，Worker任务不读存档或window', () => {
    const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/game/engine.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('estimateBountyWinOn(')
    expect(source).toContain("new Worker(new URL('./bountyWin.worker.ts', import.meta.url)")
    expect(source).toContain('this.winCache.sync()')
    const worker = readFileSync(new URL('../../../apps/desktop/src/renderer/src/game/bountyWin.worker.ts', import.meta.url), 'utf8')
    expect(worker).not.toMatch(/storage|window|saveBridge|localStorage/)
  })
  it('停止真实引擎清理后台任务和两个心跳', () => {
    const clearInterval = vi.fn(), removeEventListener = vi.fn(), reset = vi.fn()
    const source = readFileSync(new URL('../../../apps/desktop/src/renderer/src/game/engine.ts', import.meta.url), 'utf8')
    const ast = ts.createSourceFile('engine.ts', source, ts.ScriptTarget.Latest, true)
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GameEngine') as ts.ClassDeclaration
    const stop = cls.members.filter(node => ts.isPropertyDeclaration(node) && ['stop', 'onPageHide'].includes(node.name.getText(ast))).map(node => node.getText(ast)).join('\n')
    const scope = { window: { clearInterval, removeEventListener }, probe: undefined as any }
    runInNewContext(ts.transpileModule(`class Probe { ${stop} }; globalThis.probe = new Probe()`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText, scope)
    Object.assign(scope.probe, { winCache: { reset }, intervalId: 1, saveIntervalId: 2, pumpMs: 100 })
    scope.probe.stop()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(clearInterval.mock.calls).toEqual([[1], [2]])
    expect(scope.probe.stopped).toBe(true)
    expect(scope.probe.intervalId).toBeNull()
    expect(scope.probe.saveIntervalId).toBeNull()
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', scope.probe.onPageHide)
    const engine = gameSaveMethods(['ensurePump'], { window: { clearInterval } }) as any
    Object.assign(engine, { stopped: true })
    engine.ensurePump()
    expect(clearInterval).toHaveBeenCalledTimes(2)
  })
  it('性能快照区分主线程派发和后台耗时，取消与失败计数独立', () => {
    const module = runSaveModule<{ perfHub: { recording: boolean; recordWinPreheat(event: BountyWinDiagnostic): void; liveTotals(): any } }>(
      'apps/desktop/src/renderer/src/game/perf.ts', { '../i18n/locale': { tr: (id: string) => id }, './debugFlag': { debugEnabled: () => false } })
    const hub = module.perfHub
    hub.recordWinPreheat({ kind: 'result', ms: 1000 })
    hub.recording = true
    for (const event of [{ kind: 'dispatch', ms: 2 }, { kind: 'result', ms: 3000 },
      { kind: 'cancel', ms: 0 }, { kind: 'error', ms: 0 }] as const) hub.recordWinPreheat(event)
    expect(hub.liveTotals().winPreheat).toEqual({ dispatch: { n: 1, sumMs: 2, maxMs: 2 },
      compute: { n: 1, sumMs: 3000, maxMs: 3000 }, cancelled: 1, errors: 1 })
    expect(hub.liveTotals().long.n).toBe(0)
  })
})
