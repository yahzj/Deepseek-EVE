import { describe, expect, it, vi } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import type { CommandResult } from '../src/engine'
import { simulateOffline } from '../src/simulation'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { startRefineRun, startRecycleRun, startUnboxRun } from '../src/industry'
import { startManufacturing } from '../src/manufacturing'
import { startLabRun } from '../src/lab'
import { startHauling } from '../src/hauling'
import { startSiteDeliverTrip, stationActivityStartBlockReason, siteDeliverFreeCargoM3 } from '../src/location'
import { startMining } from '../src/mining'
import { startSalvageOp } from '../src/salvaging'
import { activityOverview } from '../src/activity'
import { cancelPendingStationActivity, cleanPendingStationActivity, pendingStationActivityView } from '../src/stationActivityPending'
import type { StationAction } from '../src/stationActivityPending'
import type { GameState } from '../src/state'
import type { LabRecipeDef, SimContext, StationSiteDef } from '../src/types'
import { blueprint, makeTestCtx, moduleDef } from './helpers'

const lab: LabRecipeDef = { id: 'lab-pending', name: '待启动实验', outputItemId: 'min-b', outputUnits: 2,
  cycleMs: 6000, materials: [{ itemId: 'min-a', units: 10 }] }
const site: StationSiteDef = { id: 'site-pending', name: '待交付前哨', galaxyId: 'galaxy-far', standingReq: 0,
  tiers: [{ name: '建成', bill: [{ itemId: 'min-a', count: 100 }] }], introDialogueId: null,
  doneDialogueId: null, description: '测试站' }
const actions: StationAction[] = [
  { kind: 'refine', itemId: 'ore-a' }, { kind: 'recycle', itemId: 'wreck-ano-a' },
  { kind: 'unbox', itemId: 'wh-box-safe' }, { kind: 'manufacturing', blueprintId: 'bp-once' },
  { kind: 'lab', recipeId: lab.id }, { kind: 'hauling', aSiteId: null, bSiteId: 'site-built' },
  { kind: 'siteDeliver', siteId: site.id },
]
function ready() {
  const ctx = makeTestCtx({ quietEvents: true, stations: [site, { ...site, id: 'site-built', name: '已建站' }],
    labRecipes: [lab], blueprints: [blueprint('bp-once', 'mod-a', [{ itemId: 'min-a', count: 10 }], { singleUse: true })],
    items: [{ id: 'wh-box-safe', name: '测试货柜', kind: 'container', unitM3: 1, baseSellPriceIsk: 0, description: '测试货柜' }] })
  const state = createInitialState({ nowWallMs: 0, seed: 27 })
  state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
  state.stationSites['site-built'] = { stage: 1, delivered: {} }
  state.warehouse.items = { 'ore-a': 100, 'ore-b': 100, 'min-a': 500, 'wreck-ano-a': 200, 'wh-box-safe': 2 }
  state.blueprintStock['bp-once'] = 1
  state.fleet[state.shipId]!.cargo = { 'ore-b': 100 }
  state.shipReturns[state.shipId] = { beltId: 'belt-a', legMs: 10000, phaseAccMs: 2000, reason: 'miningStop' }
  return { state, ctx }
}
function start(state: GameState, ctx: SimContext, action: StationAction): CommandResult {
  switch (action.kind) {
    case 'refine': return startRefineRun(state, action.itemId, 'pilot', ctx)
    case 'recycle': return startRecycleRun(state, action.itemId, 'pilot', ctx)
    case 'unbox': return startUnboxRun(state, ctx, action.itemId, 'pilot')
    case 'manufacturing': return startManufacturing(state, action.blueprintId, 'pilot', ctx)
    case 'lab': return startLabRun(state, ctx, action.recipeId, 'pilot')
    case 'hauling': return startHauling(state, action.aSiteId, action.bSiteId, ctx)
    case 'siteDeliver': return startSiteDeliverTrip(state, ctx, action.siteId)
  }
}
function active(state: GameState, action: StationAction): boolean {
  switch (action.kind) {
    case 'refine': case 'recycle': case 'unbox': return state.refineRuns.some(run => run.recipe === action.kind)
    case 'manufacturing': return state.manufacturingRuns.some(run => run.blueprintId === action.blueprintId)
    case 'lab': return (state.labRuns ?? []).some(run => run.recipeId === action.recipeId)
    case 'hauling': return state.hauling.active
    case 'siteDeliver': return state.transit.delivery?.siteId === action.siteId
  }
}

describe('真实返航后单次接续', () => {
  it.each(actions)('$kind到港前不扣料或图纸，到港后才实际启动', action => {
    const { state, ctx } = ready()
    const before = structuredClone(state)
    expect(start(state, ctx, action)).toMatchObject({ ok: true, queued: true })
    expect(state.pendingStationActivity).toEqual({ shipId: state.shipId, action })
    expect(state.warehouse).toEqual(before.warehouse)
    expect(state.blueprintStock).toEqual(before.blueprintStock)
    expect(state.shipReturns).toEqual(before.shipReturns)
    expect(active(state, action)).toBe(false)
    advanceGame(state, 7999, ctx, { offline: true })
    expect(active(state, action)).toBe(false)
    expect(state.warehouse.items).toEqual(before.warehouse.items)
    expect(state.blueprintStock).toEqual(before.blueprintStock)
    advanceGame(state, 1, ctx, { offline: true })
    expect(state.pendingStationActivity).toBeUndefined()
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(active(state, action)).toBe(true)
    if (action.kind === 'manufacturing') expect(state.blueprintStock['bp-once'] ?? 0).toBe(0)
  })

  it('取消只移除待办，原返航继续且不再启动', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[0]!)
    const returns = structuredClone(state.shipReturns)
    expect(cancelPendingStationActivity(state)).toBe(true)
    expect(cancelPendingStationActivity(state)).toBe(false)
    expect(state.shipReturns).toEqual(returns)
    advanceGame(state, 8000, ctx)
    expect(state.refineRuns).toHaveLength(0)
    expect(state.warehouse.items['ore-b']).toBe(200)
  })

  it('替换待办不重置返航，无效新目标不抹旧待办', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[0]!)
    advanceGame(state, 500, ctx)
    const returns = structuredClone(state.shipReturns)
    expect(startManufacturing(state, 'missing', 'pilot', ctx).ok).toBe(false)
    expect(state.pendingStationActivity?.action).toEqual(actions[0])
    expect(start(state, ctx, actions[3]!)).toMatchObject({ ok: true, queued: true })
    expect(state.shipReturns).toEqual(returns)
    advanceGame(state, 7500, ctx)
    expect(state.refineRuns).toHaveLength(0)
    expect(active(state, actions[3]!)).toBe(true)
  })

  it('有效新采矿指令取消待办，不在后续返航时突然开炉', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[0]!)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.pendingStationActivity).toBeUndefined()
    advanceGame(state, 8000, ctx)
    expect(state.refineRuns).toHaveLength(0)
  })

  it('未走第一拍就恢复采矿，旧待办/占位标记不再把新矿提前卸走', () => {
    const { state, ctx } = ready()
    delete state.shipReturns[state.shipId]
    Object.assign(state.mining, { active: true, beltId: 'belt-a', phase: 'mining' })
    expect(start(state, ctx, actions[0]!)).toMatchObject({ ok: true, queued: true })
    expect(state.pendingActivityReturn).not.toBeNull()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    expect(state.pendingStationActivity).toBeUndefined()
    expect(state.pendingActivityReturn).toBeNull()
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    advanceGame(state, 1, ctx)
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(state.fleet[state.shipId]!.cargo['ore-b']).toBe(100)
  })

  it('未走第一拍就恢复打捞，旧返航标记不再将新打捞货仓提前卸走', () => {
    const { state, ctx } = ready()
    delete state.shipReturns[state.shipId]
    const working = { ...ctx, modules: new Map([...ctx.modules, ['pending-salvager', moduleDef('pending-salvager', 'salvager', 0, { salvageCycleMs: 1000 })] as const]) }
    state.fleet[state.shipId]!.fitted.high = ['pending-salvager']
    Object.assign(state.salvaging, { active: true, galaxyId: 'galaxy-hub', phase: 'salvaging' })
    expect(start(state, working, actions[0]!)).toMatchObject({ ok: true, queued: true })
    expect(startSalvageOp(state, 'galaxy-hub', working).ok).toBe(true)
    expect(state.pendingStationActivity).toBeUndefined()
    expect(state.pendingActivityReturn).toBeNull()
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    advanceGame(state, 1, working)
    expect(state.fleet[state.shipId]!.cargo['ore-b']).toBe(100)
  })

  it('满仓采矿舰可以安排到港交付，预检不卸货，到港后才装建材', () => {
    const { state, ctx } = ready()
    state.fleet[state.shipId]!.cargo = { 'ore-b': 800 }
    const beforeCargo = { ...state.fleet[state.shipId]!.cargo }
    expect(siteDeliverFreeCargoM3(state, ctx)).toBe(800)
    expect(start(state, ctx, actions[6]!)).toMatchObject({ ok: true, queued: true })
    expect(state.fleet[state.shipId]!.cargo).toEqual(beforeCargo)
    expect(state.warehouse.items['min-a']).toBe(500)
    advanceGame(state, 8000, ctx)
    expect(state.transit.delivery?.siteId).toBe(site.id)
    expect(state.warehouse.items['ore-b']).toBe(900)
    expect(state.fleet[state.shipId]!.cargo['min-a']).toBe(100)
  })

  it('野外打捞的待办真实返母港后自动开炉，途中不提前改位置', () => {
    const { state, ctx } = ready()
    state.awayGalaxy = 'galaxy-far'
    state.dockedSite = 'site-pending'
    state.shipReturns[state.shipId]!.reason = 'salvageStop'
    expect(start(state, ctx, actions[0]!)).toMatchObject({ ok: true, queued: true })
    expect(state.awayGalaxy).toBe('galaxy-far')
    advanceGame(state, 7999, ctx)
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.refineRuns).toHaveLength(0)
    advanceGame(state, 1, ctx)
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBeNull()
    expect(active(state, actions[0]!)).toBe(true)
  })

  it('采矿接续在已建成最近副站到港，不错误转去母港', () => {
    const { state, ctx } = ready()
    const local = { ...ctx, belts: new Map([...ctx.belts, ['belt-local', { ...ctx.belts.get('belt-a')!, id: 'belt-local', galaxyId: 'galaxy-far' }]]) }
    state.awayGalaxy = 'galaxy-far'
    state.shipReturns[state.shipId]!.beltId = 'belt-local'
    expect(start(state, local, actions[0]!)).toMatchObject({ ok: true, queued: true })
    advanceGame(state, 8000, local)
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBe('site-built')
    expect(active(state, actions[0]!)).toBe(true)
  })

  it('AI管理不取消待办，材料到港不足时只失败一次且不扣剩料', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[0]!)
    state.aiCores.basic = 1; state.skills.trained['ai-expert'] = 5
    expect(startRefineRun(state, 'ore-b', 'basic', ctx).ok).toBe(true)
    expect(state.pendingStationActivity?.action).toEqual(actions[0])
    state.warehouse.items['ore-a'] = 1
    advanceGame(state, 8000, ctx)
    expect(state.pendingStationActivity).toBeUndefined()
    expect(state.refineRuns.some(run => run.worker === 'pilot')).toBe(false)
    expect(state.warehouse.items['ore-a']).toBe(1)
    const warnings = state.logs.filter(log => log.textId === 'core.industry.006').length
    advanceGame(state, 1000, ctx)
    expect(state.logs.filter(log => log.textId === 'core.industry.006')).toHaveLength(warnings)
  })

  it('目标在返航期间删除，到港失败不耗材料、不重复执行', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[3]!)
    const materials = { ...state.warehouse.items }
    const removed = { ...ctx, blueprints: new Map([...ctx.blueprints].filter(([id]) => id !== 'bp-once')) }
    advanceGame(state, 8000, removed)
    expect(state.manufacturingRuns).toHaveLength(0)
    expect(state.blueprintStock['bp-once']).toBe(1)
    expect(state.warehouse.items['min-a']).toBe(materials['min-a'])
    expect(state.logs.some(log => log.textId === 'core.manufacturing.002')).toBe(true)
    expect(state.pendingStationActivity).toBeUndefined()
  })

  it('工作位后来被占用或驾驶船变化时不接管新作业', () => {
    for (const mode of ['worker', 'pilot', 'lost'] as const) {
      const { state, ctx } = ready()
      start(state, ctx, actions[0]!)
      if (mode === 'worker') state.labRuns = [{ active: true, worker: 'pilot' } as never]
      if (mode === 'pilot') state.shipId = 'sandcat2'
      if (mode === 'lost') delete state.fleet[state.shipId]
      advanceGame(state, 1, ctx)
      expect(state.pendingStationActivity).toBeUndefined()
      expect(state.refineRuns.some(run => run.worker === 'pilot')).toBe(false)
    }
  })

  it('活动视图仅一行等待目标，取消动作与剩余返航同源', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[0]!)
    const before = structuredClone(state)
    const view = pendingStationActivityView(state, ctx)!
    expect(view).toMatchObject({ label: ctx.items.get('ore-a')!.name, subId: 'core.busy.020',
      remainingMs: 8000, percent: 20, stop: 'cancel-station-pending', stopable: true })
    const rows = activityOverview(state, ctx)
    expect(rows.filter(row => row.id === view.id)).toHaveLength(1)
    expect(rows.some(row => row.id === `return-${state.shipId}`)).toBe(false)
    expect(state).toEqual(before)
  })
})

describe('待办保存与离线到港边界', () => {
  it.each(actions)('$kind待办及返航相位两次保存重载不丢', action => {
    const { state, ctx } = ready()
    start(state, ctx, action)
    const once = loadSaveFile(serializeSaveFile(state, 0)).state
    const twice = loadSaveFile(serializeSaveFile(once, 0)).state
    expect(twice.pendingStationActivity).toEqual(state.pendingStationActivity)
    expect(twice.shipReturns).toEqual(state.shipReturns)
    expect(twice.version).toBe(state.version)
    advanceGame(twice, 8000, ctx)
    expect(active(twice, action)).toBe(true)
  })

  it('旧档不新增待办，非法字段只丢待办不动资源', () => {
    const { state } = ready()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.pendingStationActivity).toBeUndefined()
    for (const raw of [null, [], { shipId: state.shipId, action: { kind: 'unknown' } },
      { shipId: state.shipId, action: { kind: 'refine', itemId: 3 } },
      { shipId: state.shipId, action: { kind: 'hauling', aSiteId: null, bSiteId: null } }]) {
      expect(cleanPendingStationActivity(raw)).toBeUndefined()
    }
    const pending = { shipId: state.shipId, action: { kind: 'refine', itemId: 'ore-a', arbitrary: 99 }, arbitrary: 99 }
    expect(cleanPendingStationActivity(pending)).toEqual({ shipId: state.shipId, action: actions[0] })
    const raw = JSON.parse(serializeSaveFile(state, 0))
    raw.state.pendingStationActivity = { shipId: 'missing', action: actions[0] }
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.pendingStationActivity).toBeUndefined()
    expect(loaded.warehouse).toEqual(state.warehouse)
  })

  it('离线只用到港后的时间生产，与分段推进材料和批数一致', () => {
    const { state, ctx } = ready()
    start(state, ctx, actions[0]!)
    const segmented = structuredClone(state)
    const one = loadSaveFile(serializeSaveFile(state, 0)).state
    simulateOffline(one, 0, 14000, ctx)
    advanceGame(segmented, 7999, ctx, { offline: true })
    expect(segmented.refineRuns).toHaveLength(0)
    advanceGame(segmented, 1, ctx, { offline: true })
    expect(segmented.refineRuns[0]!.finishAtGameMs).toBe(14000)
    expect(segmented.refineRuns[0]!.batchesDone).toBe(0)
    advanceGame(segmented, 6000, ctx, { offline: true })
    expect(one.refineRuns[0]!.batchesDone).toBe(1)
    expect(one.refineRuns).toEqual(segmented.refineRuns)
    expect(one.warehouse).toEqual(segmented.warehouse)
  })

  it('货柜到港真实开工才触发会话回调，未到港/取消时不清上一批记录', () => {
    const { state, ctx } = ready()
    const started = vi.fn()
    start(state, ctx, actions[2]!)
    advanceGame(state, 7999, ctx, { onStationActivityStarted: started })
    expect(started).not.toHaveBeenCalled()
    advanceGame(state, 1, ctx, { onStationActivityStarted: started })
    expect(started).toHaveBeenCalledTimes(1)
    expect(started).toHaveBeenCalledWith(actions[2])
    advanceGame(state, 1, ctx, { onStationActivityStarted: started })
    expect(started).toHaveBeenCalledTimes(1)
  })

  it.each(['mining', 'salvaging'] as const)('%s切手动炉保留已有返航相位，到港前不误卸货', mode => {
    const { state, ctx } = ready()
    delete state.shipReturns[state.shipId]
    if (mode === 'mining') Object.assign(state.mining, { active: true, beltId: 'belt-a', phase: 'returning', phaseAccMs: 1000 })
    else Object.assign(state.salvaging, { active: true, galaxyId: 'galaxy-far', phase: 'returning', phaseAccMs: 1000 })
    expect(stationActivityStartBlockReason(state, ctx, 'refine')).toBeNull()
    expect(start(state, ctx, actions[0]!)).toMatchObject({ ok: true, queued: true })
    advanceGame(state, 1, ctx)
    const ret = state.shipReturns[state.shipId]!
    expect(ret.phaseAccMs).toBe(1001)
    const remaining = ret.legMs - ret.phaseAccMs
    advanceGame(state, remaining - 1, ctx)
    expect(state.refineRuns).toHaveLength(0)
    expect(state.fleet[state.shipId]!.cargo['ore-b']).toBe(100)
    advanceGame(state, 1, ctx)
    expect(state.refineRuns[0]!.batchesDone).toBe(0)
  })
})
