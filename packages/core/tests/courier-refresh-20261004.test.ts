import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  advanceGame, createInitialState, sideTaskBoard, acceptCourierTask, startCourierDelivery,
  simulateOffline, serializeSaveFile, loadSaveFile,
} from '../src/index'
import { advanceSideTasks, courierDeadlineMs } from '../src/sideTasks'
import type { SideTasksState, CourierDeliveryState } from '../src/state'

const MIN = 60_000
const ctx = buildSimContext()
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 20261004 })
  const site = [...ctx.stations.values()][0]!
  state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  advanceGame(state, 20 * MIN + 1000, ctx)
  expect(state.sideTasks.courier.length).toBeGreaterThan(0)
  expect(state.sideTasks.courierWindow).toBe(20 * MIN)
  return state
}
const idsOf = (state: ReturnType<typeof world>) => state.sideTasks.courier.map((t) => t.id)

describe('快递换板独立批次，真实引擎回归', () => {
  it('普通资源窗口不续期快递，120分钟整点才换批', () => {
    const state = world()
    const ids = idsOf(state)
    advanceGame(state, 80 * MIN, ctx)
    expect(idsOf(state)).toEqual(ids)
    expect(state.sideTasks.window).toBe(100 * MIN)
    expect(state.sideTasks.courierWindow).toBe(20 * MIN)
    expect(sideTaskBoard(state, ctx).courierRemainingMs).toBe(20 * MIN - 1000)
    advanceGame(state, 20 * MIN, ctx)
    expect(idsOf(state).some((id) => ids.includes(id))).toBe(false)
    expect(state.sideTasks.courierWindow).toBe(120 * MIN)
    expect(sideTaskBoard(state, ctx).courierRemainingMs).toBe(120 * MIN - 1000)
  })

  it('100到140跨界：资源只生成末窗，快递不漏刷新', () => {
    const state = world()
    advanceGame(state, 80 * MIN, ctx)
    const ids = idsOf(state), seq = state.sideTasks.seq
    advanceGame(state, 40 * MIN, ctx, { offline: true })
    expect(idsOf(state).some((id) => ids.includes(id))).toBe(false)
    expect(state.sideTasks.window).toBe(140 * MIN)
    expect(state.sideTasks.courierWindow).toBe(140 * MIN)
    expect(state.sideTasks.seq - seq).toBe(state.sideTasks.resource.length + state.sideTasks.courier.length)
    expect(sideTaskBoard(state, ctx).courierRemainingMs).toBe(100 * MIN - 1000)
    console.log('[修复] 100→140分钟跨界，新快递ID与旧批无重叠，只生成末批')
  })

  it('真实离线130分钟和连续两小时大推进每次换批，不补中间多批', () => {
    const state = world()
    const ids = idsOf(state)
    simulateOffline(state, 0, 130 * MIN, ctx)
    expect(idsOf(state).some((id) => ids.includes(id))).toBe(false)
    expect(state.sideTasks.courierWindow).toBe(140 * MIN)
    for (let i = 0; i < 4; i++) {
      const previous = idsOf(state), seq = state.sideTasks.seq
      advanceGame(state, 120 * MIN, ctx, { offline: true })
      expect(idsOf(state).some((id) => previous.includes(id))).toBe(false)
      expect(state.sideTasks.seq - seq).toBe(state.sideTasks.resource.length + state.sideTasks.courier.length)
    }
  })

  it('资源旧窗口偏移1秒不阻碍快递周期换板，资源仍保留原有步长', () => {
    const state = world()
    state.sideTasks.window += 1000
    const ids = idsOf(state)
    for (let i = 0; i < 5; i++) advanceGame(state, 20 * MIN, ctx)
    expect(idsOf(state).some((id) => ids.includes(id))).toBe(false)
    expect(state.sideTasks.window % (20 * MIN)).toBe(1000)
    const newIds = idsOf(state)
    advanceGame(state, MIN, ctx)
    expect(idsOf(state)).toEqual(newIds)
  })

  it('资源候选为空仍可生成虚拟快递；无副站不生快递', () => {
    const state = world()
    const ids = idsOf(state)
    const empty = { ...ctx, marketGoods: new Map() }
    state.gameMs = 140 * MIN
    state.market.lastTickGameMs = state.gameMs
    advanceSideTasks(state, empty, 0)
    expect(state.sideTasks.resource).toEqual([])
    expect(idsOf(state).some((id) => ids.includes(id))).toBe(false)
    expect(state.sideTasks.courier.length).toBeGreaterThan(0)
    const fresh = createInitialState({ nowWallMs: 0, seed: 7 })
    fresh.gameMs = fresh.market.lastTickGameMs = 20 * MIN
    advanceSideTasks(fresh, empty, 0)
    expect(fresh.sideTasks.courier).toEqual([])
  })

  it('空板补种、首次建站和30秒分片推进仍按既有周期生成', () => {
    const state = world()
    state.sideTasks.courier = []
    advanceGame(state, 20 * MIN, ctx)
    expect(state.sideTasks.courier.length).toBeGreaterThan(0)
    const current = idsOf(state)
    for (let i = 0; i < 160; i++) advanceGame(state, 30000, ctx, { offline: true })
    expect(idsOf(state).some((id) => current.includes(id))).toBe(false)
    const fresh = createInitialState({ nowWallMs: 0, seed: 7 })
    advanceGame(fresh, 20 * MIN + 1000, ctx)
    expect(fresh.sideTasks.courier).toEqual([])
    const site = [...ctx.stations.values()][0]!
    fresh.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    advanceGame(fresh, 20 * MIN, ctx)
    expect(fresh.sideTasks.courier.length).toBeGreaterThan(0)
    expect(fresh.sideTasks.courierWindow).toBe(40 * MIN)
  })

  it('缺失批次的旧档第一拍仅自愈未接单板，资源不额外刷新；已接单/在途保留', () => {
    const state = world()
    const accepted = structuredClone(state.sideTasks.courier[0]!)
    expect(acceptCourierTask(state, accepted.id).ok).toBe(true)
    const task = state.sideTasks.courier[0]!
    const deliver: CourierDeliveryState = {
      taskId: task.id, goodKey: '', refId: '', need: 0, stationId: task.stationId!, galaxyId: task.galaxyId!,
      departAtGameMs: state.gameMs, arriveAtGameMs: state.gameMs + 300 * MIN, rewardIsk: 123456, volumeM3: 500,
    }
    state.sideTasks.deliver = deliver
    delete state.sideTasks.courierWindow
    const resources = structuredClone(state.sideTasks.resource), old = idsOf(state)
    advanceGame(state, 1000, ctx)
    expect(idsOf(state).some((id) => old.includes(id))).toBe(false)
    expect(state.sideTasks.resource).toEqual(resources)
    expect(state.sideTasks.accepted).toEqual([accepted])
    expect(state.sideTasks.deliver).toEqual(deliver)
    const nextIds = idsOf(state)
    advanceGame(state, 1000, ctx)
    expect(idsOf(state)).toEqual(nextIds)
  })

  it('刷新不清在途，过截止到站仍结算锁定酬金，已接单不丢', () => {
    const state = world()
    const accepted = structuredClone(state.sideTasks.courier[0]!)
    expect(acceptCourierTask(state, accepted.id).ok).toBe(true)
    const task = state.sideTasks.courier[0]!
    state.sideTasks.deliver = {
      taskId: task.id, goodKey: '', refId: '', need: 0, stationId: task.stationId!, galaxyId: task.galaxyId!,
      departAtGameMs: state.gameMs, arriveAtGameMs: 150 * MIN, rewardIsk: 123456, volumeM3: 500,
    }
    const wallet = state.wallet.isk
    advanceGame(state, 120 * MIN, ctx, { offline: true })
    expect(state.sideTasks.deliver?.rewardIsk).toBe(123456)
    expect(state.sideTasks.accepted).toEqual([accepted])
    advanceGame(state, 10 * MIN, ctx)
    expect(state.sideTasks.deliver).toBeNull()
    expect(state.wallet.isk - wallet).toBe(123456)
    expect(state.sideTasks.accepted).toEqual([accepted])
  })

  it('缺少心跳的过期板不能接单或直接出发，资源窗口推进不使旧快递续期', () => {
    const state = world()
    const task = state.sideTasks.courier[0]!
    state.sideTasks.window = 140 * MIN
    state.gameMs = 141 * MIN
    expect(sideTaskBoard(state, ctx).courierRemainingMs).toBe(0)
    expect(acceptCourierTask(state, task.id).errorId).toBe('core.sideTasks.003')
    expect(startCourierDelivery(state, ctx, task.id).errorId).toBe('core.sideTasks.004')
  })

  it('往返保留独立批次，重新加载不重复刷；缺失/非法/未来值不替旧单续期', () => {
    const state = world()
    const raw = JSON.parse(serializeSaveFile(state, 0))
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.sideTasks.courierWindow).toBe(state.sideTasks.courierWindow)
    expect(back.sideTasks).toEqual(state.sideTasks)
    const ids = idsOf(back)
    advanceGame(back, 1000, ctx)
    expect(idsOf(back)).toEqual(ids)
    for (const bad of [undefined, 0, -1, '1200000', NaN, Infinity, state.gameMs + MIN]) {
      if (bad === undefined) delete raw.state.sideTasks.courierWindow
      else raw.state.sideTasks.courierWindow = bad
      const restored = loadSaveFile(JSON.stringify(raw)).state
      expect(restored.sideTasks.courierWindow).toBeUndefined()
      advanceGame(restored, 1000, ctx)
      expect(restored.sideTasks.courierWindow).toBeDefined()
      expect(idsOf(restored).some((id) => ids.includes(id))).toBe(false)
    }
  })

  it('批次时间单点契约及首批截止沿用整点', () => {
    const keys: Record<keyof SideTasksState, true> = {
      seq: true, window: true, resource: true, courier: true, courierWindow: true, accepted: true,
      bounty: true, faction: true, bountyWindow: true, factionWindow: true, bountySeenWindow: true, deliver: true,
    }
    expect(keys.courierWindow).toBe(true)
    expect(courierDeadlineMs(20 * MIN)).toBe(120 * MIN)
    expect(courierDeadlineMs(140 * MIN)).toBe(240 * MIN)
  })
})
