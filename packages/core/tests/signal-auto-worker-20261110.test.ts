import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeSignalAuto } from '../../../apps/desktop/src/renderer/src/game/signalAutoWorker'
import { gameSaveMethods } from './helpers/save-shell'
import { signalAutoFixture } from '../../../tools/signal-auto-estimate-fixture'
import { signalAutoInputKey } from '../src/signalAuto/input'
import { signalAutoEstimateOf } from '../src/signalAuto/estimate'
import * as guard from '../src/signalAuto/guard'
import { wormholeAutoStart, wormholeAutoTechFactors, wormholeAutoHoldM3Of } from '../src/wormholeAuto'
import type { CommandResult } from '../src/engine'
import type { SignalAutoEstimate } from '../src/signalAuto/types'
import type { GameState } from '../src/state'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: { estimate?: SignalAutoEstimate; failure?: CommandResult } }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
}

function fixture() {
  const { state, ctx, roster } = signalAutoFixture('guns', true)
  vi.spyOn(guard, 'signalAutoGuardBattleOf').mockReturnValue({ cardId: 'test-guard', outcome: 'victory', durationMs: 1000 })
  const stock = state.wormholeStock![0]!
  const tech = wormholeAutoTechFactors(state, ctx, roster)
  const estimate = signalAutoEstimateOf(state, ctx, roster, { ...stock, family: stock.family!, archetype: stock.archetype! }, .8, tech, wormholeAutoHoldM3Of(tech))
  return { state, ctx, roster, stock, estimate }
}

describe('信号自动探索Worker生命周期', () => {
  it('成功、取消、超时及失败均终止自建Worker，取消后的迟到结果不再领取', async () => {
    const f = fixture()
    FakeWorker.instances = []
    vi.useFakeTimers()
    for (const mode of ['success', 'abort', 'timeout', 'error', 'message'] as const) {
      const controller = new AbortController()
      const task = computeSignalAuto(f.state, f.stock.id, f.roster, controller.signal, () => new FakeWorker())
      const worker = FakeWorker.instances.at(-1)!
      const late = worker.onmessage!
      expect(worker.postMessage).toHaveBeenCalledTimes(1)
      if (mode === 'success') worker.onmessage!({ data: { estimate: f.estimate } })
      if (mode === 'abort') controller.abort()
      if (mode === 'timeout') vi.advanceTimersByTime(60_000)
      if (mode === 'error') worker.onerror!()
      if (mode === 'message') worker.onmessageerror!()
      const expected = { abort: 'core.signalDispatch.001', timeout: 'core.signalDispatch.003', error: 'core.signalDispatch.004', message: 'core.signalDispatch.004' }
      expect(await task).toEqual(mode === 'success' ? { estimate: f.estimate } : { failure: { ok: false, errorId: expected[mode] } })
      late({ data: { estimate: f.estimate } })
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    }
    const controller = new AbortController()
    controller.abort()
    const count = FakeWorker.instances.length
    expect(await computeSignalAuto(f.state, f.stock.id, f.roster, controller.signal, () => new FakeWorker())).toEqual({ failure: { ok: false, errorId: 'core.signalDispatch.001' } })
    expect(FakeWorker.instances).toHaveLength(count)
  })

  it('Worker无法创建时不回退到主线程计算', async () => {
    const f = fixture()
    expect(await computeSignalAuto(f.state, f.stock.id, f.roster, undefined, () => { throw new Error('unavailable') })).toEqual({ failure: { ok: false, errorId: 'core.signalDispatch.002' } })
  })

  it('传回计算中的具体拒因，并为缺少结果提供原因', async () => {
    const f = fixture()
    const rejected = computeSignalAuto(f.state, f.stock.id, f.roster, undefined, () => new FakeWorker())
    FakeWorker.instances.at(-1)!.onmessage!({ data: { failure: { ok: false, errorId: 'core.command.004' } } })
    expect(await rejected).toEqual({ failure: { ok: false, errorId: 'core.command.004' } })
    const missing = computeSignalAuto(f.state, f.stock.id, f.roster, undefined, () => new FakeWorker())
    FakeWorker.instances.at(-1)!.onmessage!({ data: {} })
    expect(await missing).toEqual({ failure: { ok: false, errorId: 'core.signalDispatch.004' } })
  })
})

describe('后台结果提交事务', () => {
  it.each(['fitting', 'ammo', 'tech', 'signal'] as const)('%s变化拒绝旧结果，不消耗信号或改主控', kind => {
    const f = fixture()
    const inputKey = signalAutoInputKey(f.state, f.ctx, f.roster, f.stock)
    if (kind === 'fitting') f.state.fleet[f.roster[0]!]!.armorPct = .5
    if (kind === 'ammo') f.state.warehouse.items['ammo-kinetic-2']!--
    if (kind === 'tech') f.state.research!.levels['mt-explore-signal-auto-t3'] = 2
    if (kind === 'signal') f.stock.seed++
    const before = structuredClone(f.state)
    expect(wormholeAutoStart(f.state, f.ctx, f.stock.id, f.roster, undefined, { inputKey, estimate: f.estimate })).toMatchObject({ ok: false, errorId: 'core.signalDispatch.010' })
    expect(f.state).toEqual(before)
  })

  it('无关挂机矿物产出不使结果失效，提交不重跑战斗且只消耗一次信号', () => {
    const f = fixture()
    const inputKey = signalAutoInputKey(f.state, f.ctx, f.roster, f.stock)
    f.state.warehouse.items['min-tritanium'] = 99
    f.state.gameMs += 5000
    vi.mocked(guard.signalAutoGuardBattleOf).mockClear()
    expect(wormholeAutoStart(f.state, f.ctx, f.stock.id, f.roster, undefined, { inputKey, estimate: f.estimate }).ok).toBe(true)
    expect(f.state.wormholeAuto![0]!.estimate).toEqual(f.estimate)
    expect(f.state.wormholeAuto![0]!.startedAtGameMs).toBe(5000)
    expect(f.state.warehouse.items['min-tritanium']).toBe(99)
    expect(guard.signalAutoGuardBattleOf).not.toHaveBeenCalled()
    const before = structuredClone(f.state)
    expect(wormholeAutoStart(f.state, f.ctx, f.stock.id, f.roster, undefined, { inputKey, estimate: f.estimate }).ok).toBe(false)
    expect(f.state).toEqual(before)
  })

  it.each(['success', 'cancel', 'replace-state', 'ammo', 'missing', 'leader', 'context', 'handover', 'stopped'] as const)('引擎%s路径在await后重新验证，不覆盖活状态', async mode => {
    const f = fixture()
    let finish!: (result: { estimate: SignalAutoEstimate } | { failure: CommandResult }) => void
    const compute = vi.fn(() => new Promise<{ estimate: SignalAutoEstimate } | { failure: CommandResult }>(resolve => { finish = resolve }))
    const handover = vi.fn<() => { needed: boolean; toId?: string }>(() => ({ needed: false }))
    const probe = gameSaveMethods(['wormholeAutoStart', 'wormholeAutoBlockReason', 'wormholeAutoMainHandover'], {
      computeSignalAuto: compute, signalAutoInputKey, wormholeAutoStart,
      wormholeAutoBlockReason: vi.fn(() => null), wormholeAutoMainHandover: handover, AbortController,
    }) as unknown as { state: GameState; ctx: typeof f.ctx; wormholeAutoStart(stock: string, ids: string[], signal?: AbortSignal): Promise<CommandResult> }
    const persist = vi.fn(), notify = vi.fn()
    Object.assign(probe, { state: f.state, ctx: f.ctx, stopped: false, signalAutoComputing: false, signalAutoController: null,
      wormholeStock: () => probe.state.wormholeStock, createSignalAutoWorker: () => new FakeWorker(), persist, notify })
    const controller = new AbortController()
    const task = probe.wormholeAutoStart(f.stock.id, f.roster, controller.signal)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(await probe.wormholeAutoStart(f.stock.id, f.roster)).toEqual({ ok: false, errorId: 'core.signalDispatch.006' })
    if (mode === 'cancel') controller.abort()
    if (mode === 'replace-state') probe.state = structuredClone(f.state)
    if (mode === 'ammo') probe.state.warehouse.items['ammo-kinetic-2']!--
    if (mode === 'leader') probe.state.shipId = f.roster[0]!
    if (mode === 'context') probe.ctx = { ...f.ctx }
    if (mode === 'handover') handover.mockReturnValue({ needed: true, toId: 'changed-handover' })
    if (mode === 'stopped') Object.assign(probe, { stopped: true })
    const before = structuredClone(probe.state)
    finish(mode === 'missing' ? { failure: { ok: false, errorId: 'core.signalDispatch.004' } } : { estimate: f.estimate })
    const result = await task
    expect(result.ok).toBe(mode === 'success')
    if (mode !== 'success') {
      const ids = { cancel: '001', 'replace-state': '008', ammo: '010', missing: '004', leader: '008', context: '008', handover: '009', stopped: '007' }
      expect(result.errorId).toBe(`core.signalDispatch.${ids[mode]}`)
      expect(probe.state).toEqual(before)
      expect(persist).not.toHaveBeenCalled()
      expect(notify).not.toHaveBeenCalled()
    } else {
      expect(probe.state.wormholeAuto).toHaveLength(1)
      expect(persist).toHaveBeenCalledTimes(1)
    }
  })
})
