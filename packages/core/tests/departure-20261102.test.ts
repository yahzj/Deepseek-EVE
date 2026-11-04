import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { startMining, stopMining, advanceMining } from '../src/mining'
import { startExpedition } from '../src/expedition'
import { activityOverview } from '../src/activity'
import { associationGateMs, departureView } from '../src/departure'
import { makeTestCtx, moduleDef } from './helpers'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { startHauling, stopHauling } from '../src/hauling'
import type { StationSiteDef } from '../src/types'
import { startSalvageOp, stopSalvageOp } from '../src/salvaging'
import { startSiteDeliverTrip, cancelSiteDeliverTrip } from '../src/location'
import { startCourierDelivery } from '../src/sideTasks'
import { simulateOffline } from '../src/simulation'
import { shipOperationBlockReason } from '../src/shipActionPolicy'
import { wormholeEnter, wormholeGridScan } from '../src/wormhole'
import { recallExpedition } from '../src/expedition/recall'
import { buildSimContext } from '@whale/data'
import { L10N, l10nEntryText } from '../../data/src/l10n/table'
import { addShipToFleet } from '../src/fleetBook'
import { weekendStartFlagshipBattle, weekendFlagshipBattleActive } from '../src/weekendLaunch'

const site: StationSiteDef = { id: 'departure-site', name: '测试站', galaxyId: 'galaxy-far', standingReq: 0,
  tiers: [{ name: '建成', bill: [], unlockDesc: '' }], introDialogueId: '', doneDialogueId: null, description: '' }
function ready() {
  const state = createInitialState({ nowWallMs: 0, seed: 42 })
  const ctx = makeTestCtx({ quietEvents: true, stations: [site] })
  state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
  state.stationSites[site.id] = { stage: 1, delivered: {} }
  return { state, ctx }
}

describe('主控实际离港与星门', () => {
  it('距离为同星系5秒，远程封顶20秒', () => {
    const { ctx } = ready()
    expect(associationGateMs(ctx, 'galaxy-hub', 'galaxy-hub')).toBe(5000)
    const far = { ...ctx, galaxyEdges: [{ from: 'galaxy-hub', to: 'galaxy-far', travelMinutes: 50 }] }
    expect(associationGateMs(far, 'galaxy-hub', 'galaxy-far')).toBe(20000)
  })
  it('采矿先离港10秒再星门5秒，不能提前产矿或重启绕过', () => {
    const { state, ctx } = ready()
    expect(startMining(state, 'belt-a', ctx).ok).toBe(true)
    advanceGame(state, 5000, ctx)
    expect(activityOverview(state, ctx).find(row => row.kind === 'mining')).toMatchObject({ subId: 'core.departure.001', percent: 50, remainingMs: 5000 })
    expect(state.mining.cycleAccMs).toBe(0)
    expect(startMining(state, 'belt-a', ctx).ok).toBe(false)
    advanceGame(state, 5000, ctx)
    expect(departureView(state)).toMatchObject({ textId: 'core.departure.002', remainingMs: 5000 })
    advanceGame(state, 5000, ctx)
    expect(state.departure).toBeUndefined()
    expect(state.mining.cycleAccMs).toBe(0)
    advanceGame(state, 1000, ctx)
    expect(state.mining.cycleAccMs).toBe(1000)
  })
  it('离港中停止留在原港，不凭空安排返航', () => {
    const { state, ctx } = ready()
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 3000, ctx)
    expect(stopMining(state, ctx)).toBe(true)
    expect(state.departure).toBeUndefined()
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(state.awayGalaxy).toBeNull()
  })
  it('等待中存读档保留进度', () => {
    const { state, ctx } = ready()
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 12000, ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, 100)).state
    expect(loaded.departure).toEqual(state.departure)
    advanceGame(loaded, 3000, ctx)
    expect(loaded.departure).toBeUndefined()
    expect(loaded.mining.cycleAccMs).toBe(0)
  })
  it('悬赏到达后才开战', () => {
    const { state, ctx } = ready()
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.expedition.phase).toBe('out')
    expect(state.expedition.battle).toBeNull()
    advanceGame(state, 14999, ctx)
    expect(state.expedition.battle).toBeNull()
    advanceGame(state, 1, ctx)
    expect(state.expedition.battle).not.toBeNull()
    expect(state.expedition.battle!.startedAtGameMs).toBe(15000)
  })
  it('运输只离港，原航段不提前累计；离港中可取消', () => {
    const { state, ctx } = ready()
    state.debugQuick = true
    expect(startHauling(state, null, site.id, ctx, 100).ok).toBe(true)
    advanceGame(state, 9999, ctx)
    expect(state.hauling.phaseAccMs).toBe(0)
    expect(state.departure?.gateMs).toBe(0)
    expect(stopHauling(state, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
  })
  it('打捞等待期间不产货，副站取消留在原泊位且不播报抵达', () => {
    const { state, ctx } = ready()
    ctx.modules = new Map(ctx.modules).set('departure-salvager', moduleDef('departure-salvager', 'salvager', 0, { salvageCycleMs: 1000 }))
    state.fleet[state.shipId]!.fitted.high = ['departure-salvager']
    state.dockedSite = site.id
    expect(startSalvageOp(state, 'galaxy-far', ctx).ok).toBe(true)
    advanceGame(state, 4000, ctx)
    expect(state.salvaging.tripM3).toBe(0)
    expect(state.salvaging.cycleAccMs).toBe(0)
    expect(shipOperationBlockReason(state, ctx, state.shipId, 'configure')).not.toBeNull()
    expect(stopSalvageOp(state, ctx)).toBe(true)
    expect(state.dockedSite).toBe(site.id)
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    expect(state.logs.some(row => row.textId === 'core.salvaging.015')).toBe(false)
  })
  it('野外转战不再离港且不留下会提前卸货的旧返航账本', () => {
    const { state, ctx } = ready()
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 27000, ctx)
    const cargo = structuredClone(state.fleet[state.shipId]!.cargo)
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.departure).toMatchObject({ undockMs: 0, gateMs: 5000 })
    expect(state.shipReturns[state.shipId]).toBeUndefined()
    advanceGame(state, 4999, ctx)
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    expect(state.expedition.battle).toBeNull()
  })
  it('自动返港后的下一趟重新离港，单次大推进与逐秒推进的采集一致', () => {
    const { state, ctx } = ready()
    state.debugQuick = true
    startMining(state, 'belt-a', ctx)
    advanceGame(state, 15000, ctx)
    state.fleet[state.shipId]!.cargo = { 'ore-a': 800 }
    state.mining.phase = 'returning'
    state.mining.phaseAccMs = 0
    advanceMining(state, 2000, ctx)
    expect(state.departure).toMatchObject({ kind: 'mining', progressMs: 0, undockMs: 10000, gateMs: 5000 })
    const batch = structuredClone(state), slices = structuredClone(state)
    advanceGame(batch, 30000, ctx)
    for (let i = 0; i < 30; i++) advanceGame(slices, 1000, ctx)
    expect(batch.mining).toEqual(slices.mining)
    expect(batch.fleet[batch.shipId]!.cargo).toEqual(slices.fleet[slices.shipId]!.cargo)
  })
  it('建站交付只离港，装载不会在离港完成前交付，取消不丢材料', () => {
    const { state, ctx } = ready()
    const construction = { ...site, id: 'departure-construction', tiers: [{ name: '建成', bill: [{ itemId: 'min-a', count: 100 }] }] }
    ctx.stations = new Map(ctx.stations).set(construction.id, construction)
    state.warehouse.items['min-a'] = 50
    expect(startSiteDeliverTrip(state, ctx, construction.id).ok).toBe(true)
    expect(state.departure).toMatchObject({ kind: 'siteDeliver', undockMs: 10000, gateMs: 0 })
    advanceGame(state, 9999, ctx)
    expect(state.stationSites[construction.id]?.stage ?? 0).toBe(0)
    expect(cancelSiteDeliverTrip(state, ctx).ok).toBe(true)
    expect(state.warehouse.items['min-a']).toBe(50)
    expect(state.departure).toBeUndefined()
    expect(state.dockedSite).toBeNull()
  })
  it('快递航程和截止从离港完成起算，离线跨过等待只结算一单', () => {
    const { state, ctx } = ready()
    state.debugQuick = true
    state.sideTasks.accepted = [{ id: 42, kind: 'courier', goodKey: '', refId: '', need: 0, rewardIsk: 123,
      volumeM3: 1, stationId: site.id, galaxyId: site.galaxyId, level: 1, timed: true, warpReqAus: 0, timeLimitMs: 1000 }]
    expect(startCourierDelivery(state, ctx, 42).ok).toBe(true)
    expect(state.sideTasks.deliver).toMatchObject({ departAtGameMs: 10000, arriveAtGameMs: 11000, deadlineAtGameMs: 11000 })
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    const wallet = restored.wallet.isk
    simulateOffline(restored, 0, 10999, ctx)
    expect(restored.sideTasks.deliver).not.toBeNull()
    expect(restored.wallet.isk).toBe(wallet)
    advanceGame(restored, 1, ctx)
    expect(restored.sideTasks.deliver).toBeNull()
    expect(restored.wallet.isk).toBe(wallet + 123)
    advanceGame(restored, 1, ctx)
    expect(restored.wallet.isk).toBe(wallet + 123)
  })
  it('主控探索只离港，期间不能扫描或深入操作，读档后如期解锁', () => {
    const { state, ctx } = ready()
    expect(wormholeEnter(state, ctx, [state.shipId], 19).ok).toBe(true)
    expect(state.departure).toMatchObject({ kind: 'wormhole', gateMs: 0 })
    expect(wormholeGridScan(state, ctx).ok).toBe(false)
    advanceGame(state, 9000, ctx)
    const restored = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(restored.departure?.progressMs).toBe(9000)
    advanceGame(restored, 1000, ctx)
    expect(restored.departure).toBeUndefined()
  })
  it('胜利返港文案与循环停止权限并存；三条阶段中文与英文回退均一致', () => {
    const { state, ctx } = ready()
    state.expedition.active = true
    state.expedition.anomalyId = 'ano-a'
    state.expedition.phase = 'back'
    state.expedition.returnReason = 'victory'
    state.expedition.finishAtGameMs = 120000
    state.autoLoopAnomalyId = 'ano-a'
    expect(activityOverview(state, ctx).find(row => row.id === 'expedition')).toMatchObject({ subId: 'core.departure.003', stop: 'stop-loop' })
    expect(recallExpedition(state, ctx).ok).toBe(false)
    for (const [id, text] of [['core.departure.001', '正在离港'], ['core.departure.002', '正在使用协会跃迁星门前往目的地'], ['core.departure.003', '正在返港进行补给']]) {
      expect(l10nEntryText(L10N[id!]!, 'zh')).toBe(text)
      expect(l10nEntryText(L10N[id!]!, 'en')).toBe(text)
    }
    expect(buildSimContext().galaxies.size).toBeGreaterThan(0)
  })
  it('旗舰挑战离港期间不推进战斗且不显示战场，存读档后如期交战', () => {
    const ctx = buildSimContext(), now = Date.UTC(2026, 9, 21, 4)
    ctx.balance = structuredClone(ctx.balance)
    ctx.balance.events.enabled = false
    const state = createInitialState({ nowWallMs: now, seed: 19 })
    state.shipId = addShipToFleet(state, 'sh-megalodon')
    state.weekendEvent = { seq: 1, startedAtWallMs: now, family: 'H', coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'],
      contributed: { 'galaxy-kor': 1, 'galaxy-redring': 1 } }
    const battle = weekendStartFlagshipBattle(state, ctx, now, [state.shipId])!
    expect(battle).not.toBeNull()
    state.encounter = { active: true, shipId: state.shipId, galaxyId: 'galaxy-kor', name: '测试旗舰', threat: 120,
      anomalyId: 'ink-flagship', origin: 'test', invitedAtGameMs: 0, deadlineGameMs: 60000, battle }
    expect(weekendFlagshipBattleActive(state)).toBe(false)
    expect(activityOverview(state, ctx).find(row => row.id === 'flagship-departure')).toMatchObject({ subId: 'core.departure.001' })
    const restored = loadSaveFile(serializeSaveFile(state, now)).state
    advanceGame(restored, 9999, ctx)
    expect(restored.encounter.battle!.lastTickGameMs).toBe(10000)
    advanceGame(restored, 1, ctx)
    expect(restored.departure).toBeUndefined()
    expect(weekendFlagshipBattleActive(restored)).toBe(true)
  })
})
