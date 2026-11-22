import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createCommandReadyState as createInitialState } from './helpers/command-ready'
import { addShipToFleet } from '../src/fleetBook'
import { startExpedition as launchExpedition, setBattleDesire, advanceAutoLoopBounty, advanceAutoLoopInvasion } from '../src/expedition'
import { finishDeparture } from './helpers/departure-ready'
import { createPlayerSpec, startBattleFor } from '../src/combat'
import { cancelBattleRange, playerFleetMaxRangeOf } from '../src/battleRangeMemory'
import { setFleetDistance } from './helpers/fleet-range'
import { saveBattleFleetRange } from '../src/fleetRange'
import { confirmBattleRange as confirmRange } from '../src/battleRangeConfirm'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { fightEncounter, advanceEncounterWatch } from '../src/encounters'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { buildEvalState } from '../src/winEstimate'
import { wormholeEnterPrepared, wormholePreparationPlan } from '../src/wormholePreparation'
import { wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import { gridCellAt, hexDistance } from '../src/wormholeGrid'
import { wormholeResolveEvent } from '../src/wormholeExpedition'
import { simulateOffline } from '../src/simulation'
import { buildMyUnitSpecs } from '../src/combat/fleetSpecs'

const ctx = buildSimContext()
function startExpedition(...args: Parameters<typeof launchExpedition>) {
  const result = launchExpedition(...args)
  if (result.ok) finishDeparture(args[0], args[2])
  return result
}
function confirmBattleRange(...args: Parameters<typeof confirmRange>) {
  const result = confirmRange(...args)
  if (result.ok) finishDeparture(args[0], args[1])
  return result
}
const NOW = new Date(2026, 9, 21, 12).getTime()
function world() {
  const state = createInitialState({ nowWallMs: NOW, seed: 7 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standings.dsi = 100
  state.fleet[uid]!.fitted = { high: ['mod-laser-1'], mid: [], low: [] }
  state.warehouse.items['ammo-plasma-l'] = 100000
  state.weekendEvent = { seq: 1, startedAtWallMs: NOW, family: 'H', coreId: 'galaxy-kor', peripheryIds: ['galaxy-redring'], contributed: {} }
  state.debugQuick = true
  return state
}
function idle(state: ReturnType<typeof world>) {
  state.expedition.active = false
  state.expedition.battle = null
  state.expedition.anomalyId = null
  delete state.expedition.sortie
  delete state.combatEscort
  state.bountyCooldowns = {}
}
function first(state: ReturnType<typeof world>, card = 'ink-harass') {
  setFleetDistance(state, ctx, 2500)
  expect(startExpedition(state, card, ctx, { foeGalaxyId: 'galaxy-redring' }).ok).toBe(true)
  idle(state)
}
function changeRange(state: ReturnType<typeof world>) { state.fleet[state.shipId]!.fitted.high = ['mod-laser-2'] }

describe('编队距离与射程变化确认（保留旧敌卡专项文件名）', () => {
  it('编队默认跨卡跨星系共享，战中改距不保存，旧记录不迁移', () => {
    const state = world()
    state.expedition.desirePrefByGalaxy = { 'galaxy-hub': 9999, 'galaxy-redring': 9999 }
    state.battleRangeByCard = { 'ink-harass': { desireM: 9999, maxRangeM: 1 } }
    const legacy = structuredClone(state.battleRangeByCard)
    const defaultFor = (cardId: string) => startBattleFor(structuredClone(state), ctx, state.shipId, cardId, state.gameMs, null)!.myDesireM
    const defaultM = defaultFor('ink-harass')
    expect(startExpedition(state, 'ink-harass', ctx, { foeGalaxyId: 'galaxy-redring' }).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBe(defaultM)
    setBattleDesire(state, 2500, ctx)
    expect(state.fleetRange?.desireM).toBeUndefined()
    idle(state)
    startExpedition(state, 'ink-harass', ctx, { foeGalaxyId: 'galaxy-kor' })
    expect(state.expedition.battle!.myDesireM).toBe(defaultM)
    idle(state)
    setFleetDistance(state, ctx, 2500)
    const next = startExpedition(state, 'ink-raid', ctx, { foeGalaxyId: 'galaxy-kor' })
    if (next.rangeConfirmation) expect(confirmBattleRange(state, ctx, 2500, NOW).ok).toBe(true)
    else expect(next.ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBe(2500)
    expect(state.battleRangeByCard).toEqual(legacy)
    expect(state.expedition.desirePrefByGalaxy).toEqual({ 'galaxy-hub': 9999, 'galaxy-redring': 9999 })
  })
  it('首次入场建立射程，增加或缩短均拦截，取消完全不扣料不更新记录', () => {
    const state = world()
    first(state)
    const record = structuredClone(state.fleetRange)
    changeRange(state)
    const before = structuredClone(state)
    expect(startExpedition(state, 'ink-harass', ctx).rangeConfirmation).toBe(true)
    expect(state.pendingBattleRange!.previousRangeM).toBe(record!.maxRangeM)
    expect(state.pendingBattleRange!.fleetChanged).toBeUndefined()
    const { pendingBattleRange, ...after } = state
    expect(pendingBattleRange).toBeDefined()
    expect(after).toEqual(before)
    cancelBattleRange(state)
    expect(state.fleetRange).toEqual(record)
    expect(state.expedition.battle).toBeNull()
  })
  it('确认只改本场距离，成功后更新射程证据但不覆盖长期米数', () => {
    const state = world()
    first(state)
    changeRange(state)
    startExpedition(state, 'ink-harass', ctx)
    expect(confirmBattleRange(state, ctx, 1700, NOW).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).toBe(1700)
    const specs = [createPlayerSpec(state, ctx, state.shipId)!]
    expect(state.fleetRange).toEqual({ desireM: 2500, maxRangeM: playerFleetMaxRangeOf(specs), shipIds: [state.shipId] })
    idle(state)
    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBe(2500)
    idle(state)
    state.fleet[state.shipId]!.fitted.high = ['mod-laser-1']
    expect(startExpedition(state, 'ink-harass', ctx).rangeConfirmation).toBe(true)
  })
  it('更换主控不复用旧编队默认，并建立新编队射程证据', () => {
    const state = world()
    first(state)
    const previousShipId = state.shipId
    const nextShipId = addShipToFleet(state, 'sh-megalodon')
    state.fleet[nextShipId]!.fitted = structuredClone(state.fleet[previousShipId]!.fitted)
    state.shipId = nextShipId

    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.fleetRange!.shipIds).toEqual([nextShipId])
    expect(state.fleetRange!.desireM).toBeUndefined()
  })
  it('同主控增加成员且最大射程变化时，待确认信息标记编队变化', () => {
    const state = world()
    first(state)
    const previousShipId = state.shipId
    const nextShipId = addShipToFleet(state, 'sh-megalodon')
    state.fleet[nextShipId]!.fitted.high = ['mod-laser-2']
    state.preparationSquads = { combat: [previousShipId, nextShipId] }

    expect(startExpedition(state, 'ink-harass', ctx).rangeConfirmation).toBe(true)
    expect(state.pendingBattleRange!.fleetChanged).toBe(true)
    expect(state.pendingBattleRange!.shipIds).toEqual([previousShipId, nextShipId])
    expect(state.pendingBattleRange!.previousShipIds).toEqual([previousShipId])
  })
  it('旧敌卡记录没有参战名单也不触发确认或猜测迁移', () => {
    const state = world()
    state.battleRangeByCard = { 'ink-harass': { desireM: 2300, maxRangeM: 1 } }
    const before = structuredClone(state.battleRangeByCard)
    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).not.toBe(2300)
    expect(state.battleRangeByCard).toEqual(before)
  })
  it('确认期间配置再次变化必须重新确认，读档保留待办与编队证据', () => {
    const state = world()
    first(state)
    changeRange(state)
    startExpedition(state, 'ink-harass', ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(loaded.pendingBattleRange).toEqual(state.pendingBattleRange)
    expect(loaded.pendingBattleRange!.previousShipIds).toEqual(state.fleetRange!.shipIds)
    expect(loaded.fleetRange).toEqual(state.fleetRange)
    expect(loaded.pendingBattleRange!.fleetChanged).toBeUndefined()
    loaded.fleet[loaded.shipId]!.fitted.high = ['mod-laser-3']
    expect(confirmBattleRange(loaded, ctx, 2500, NOW).rangeConfirmation).toBe(true)
    expect(loaded.expedition.battle).toBeNull()
    expect(confirmBattleRange(loaded, ctx, 2500, NOW).ok).toBe(true)
  })
  it('低层预览和胜率快照不写真实记录，强制自动距离不读记忆', () => {
    const state = world()
    first(state)
    const before = structuredClone(state)
    const snapshot = buildEvalState(state, state.shipId)!
    expect(startBattleFor(snapshot.ev, ctx, snapshot.uid, 'ink-harass')!.myDesireM).toBe(2500)
    const automatic = startBattleFor(snapshot.ev, ctx, snapshot.uid, 'ink-harass', 0, null)!
    expect(automatic.myDesireM).not.toBe(2500)
    expect(automatic.rangeMemory).toBeUndefined()
    expect(state).toEqual(before)
  })
  it('启动补齐尾部空槽不视为再次换装，不强迫玩家重复确认', () => {
    const state = world()
    first(state)
    changeRange(state)
    startExpedition(state, 'ink-harass', ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    loaded.fleet[loaded.shipId]!.fitted.high.push(null, null)
    loaded.fleet[loaded.shipId]!.fitted.mid.push(null, null)
    loaded.fleet[loaded.shipId]!.fitted.low.push(null)
    expect(confirmBattleRange(loaded, ctx, 1700, NOW).ok).toBe(true)
    expect(loaded.expedition.battle!.myDesireM).toBe(1700)
  })
  it('仅换同射程武器或支援装备不触发射程变化提醒', () => {
    const state = world()
    first(state)
    state.fleet[state.shipId]!.fitted.mid = ['mod-track-1']
    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).toBe(2500)
  })
  it('已确认活动切换仍须先等射程确认，取消不提前中断活动', () => {
    const state = world()
    first(state)
    changeRange(state)
    const belt = [...ctx.belts.values()][0]!
    state.mining.active = true
    state.mining.beltId = belt.id
    const before = structuredClone(state.mining)
    expect(startExpedition(state, 'ink-harass', ctx, { confirmActivitySwitch: true }).rangeConfirmation).toBe(true)
    expect(state.mining).toEqual(before)
    cancelBattleRange(state)
    expect(state.mining).toEqual(before)
  })
  it('遭遇读取编队射程证据，确认待办不被60秒超时清掉', () => {
    const state = world()
    first(state)
    changeRange(state)
    state.encounter = { active: true, shipId: state.shipId, galaxyId: 'galaxy-redring', name: 'test', threat: 40,
      anomalyId: 'ink-harass', origin: 'test', invitedAtGameMs: state.gameMs, deadlineGameMs: state.gameMs + 60000, battle: null }
    expect(fightEncounter(state, ctx).rangeConfirmation).toBe(true)
    state.gameMs += 120000
    advanceEncounterWatch(state, ctx, 120000)
    expect(state.encounter.active).toBe(true)
    expect(confirmBattleRange(state, ctx, 2300, NOW).ok).toBe(true)
    expect(state.encounter.battle!.myDesireM).toBe(2300)
  })
  it('全队最大射程包含僚舰无人机，旗舰同样使用编队射程证据', () => {
    const state = world()
    state.weekendEvent!.contributed = { 'galaxy-kor': 1, 'galaxy-redring': 1 }
    const ally = addShipToFleet(state, 'sh-sentinel')
    state.fleet[ally]!.droneLoad = { 'drone-scout': 1 }
    state.preparationSquads = { combat: [state.shipId, ally] }
    const one = weekendStartFlagshipBattle(state, ctx, NOW, [state.shipId, ally])!
    expect(one).not.toBeNull()
    expect(state.fleetRange!.maxRangeM).toBe(playerFleetMaxRangeOf([createPlayerSpec(state, ctx, state.shipId)!, createPlayerSpec(state, ctx, ally)!]))
    expect(state.fleetRange!.shipIds).toEqual([state.shipId, ally])
    finishDeparture(state, ctx)
    state.fleet[ally]!.fitted.high = ['mod-missile-3']
    expect(weekendStartFlagshipBattle(state, ctx, NOW, [state.shipId, ally])).toBeNull()
    expect(state.pendingBattleRange!.cardId).toBe('ink-flagship')
    expect(confirmBattleRange(state, ctx, 2400, NOW).ok).toBe(true)
    expect(state.encounter.battle!.myDesireM).toBe(2400)
  })
  it('自动重复出击在射程变化前等待，不消费抽卡次数或库存', () => {
    const state = world()
    first(state)
    changeRange(state)
    state.autoLoopAnomalyId = 'ink-harass'
    advanceAutoLoopBounty(state, ctx)
    expect(state.pendingBattleRange).toBeDefined()
    const pending = structuredClone(state.pendingBattleRange)
    const ware = structuredClone(state.warehouse)
    advanceAutoLoopBounty(state, ctx)
    advanceAutoLoopInvasion(state, ctx, NOW)
    expect(state.pendingBattleRange).toEqual(pending)
    expect(state.expedition.battle).toBeNull()
    expect(state.warehouse).toEqual(ware)
  })
  it('离线重复清剿等确认，上线前不能默认同意', () => {
    const state = world()
    first(state)
    changeRange(state)
    state.autoLoopAnomalyId = 'ink-harass'
    simulateOffline(state, NOW, NOW + 300000, ctx)
    expect(state.pendingBattleRange).toBeDefined()
    expect(state.expedition.battle).toBeNull()
    expect(state.fleetRange!.maxRangeM).not.toBe(state.pendingBattleRange!.maxRangeM)
  })
  it('自动循环的战前修补也留到确认后，取消不消耗组件', () => {
    const state = world()
    first(state)
    changeRange(state)
    state.fleet[state.shipId]!.fitted.mid = ['mod-hullrep-civ']
    state.fleet[state.shipId]!.durability = 0.4
    state.fleet[state.shipId]!.armorPct = 0.4
    state.warehouse.items['repairkit-civ'] = 1000
    state.fleet[state.shipId]!.cargo['repairkit-civ'] = 1000
    state.autoLoopAnomalyId = 'ink-harass'
    const before = structuredClone(state)
    advanceAutoLoopBounty(state, ctx)
    expect(state.pendingBattleRange).toBeDefined()
    expect(state.warehouse).toEqual(before.warehouse)
    expect(state.fleet[state.shipId]).toEqual(before.fleet[state.shipId])
    cancelBattleRange(state)
    expect(state.warehouse).toEqual(before.warehouse)
  })
  it('旧在途战斗维持当前目标，手动改距不能编造默认或保存绑定', () => {
    const state = world()
    startExpedition(state, 'ink-harass', ctx)
    delete state.expedition.battle!.rangeMemory
    delete state.fleetRange
    const saved = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(saved.expedition.battle!.myDesireM).toBe(state.expedition.battle!.myDesireM)
    expect(saved.pendingBattleRange).toBeUndefined()
    setBattleDesire(saved, 2300, ctx)
    expect(saved.expedition.battle!.myDesireM).toBe(2300)
    expect(saved.fleetRange).toBeUndefined()
    expect(saveBattleFleetRange(saved, ctx, saved.expedition.battle).ok).toBe(false)
    idle(saved)
    changeRange(saved)
    expect(startExpedition(saved, 'ink-harass', ctx).ok).toBe(true)
    expect(saved.fleetRange!.maxRangeM).toBeGreaterThan(0)
    expect(saved.fleetRange!.desireM).toBeUndefined()
  })
  it('仅有编队距离时首次入场补齐配置射程，之后真实换装仍需确认', () => {
    const state = world()
    setFleetDistance(state, ctx, 2300)
    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).toBe(2300)
    const specs = [createPlayerSpec(state, ctx, state.shipId)!]
    expect(state.fleetRange).toEqual({ desireM: 2300, maxRangeM: playerFleetMaxRangeOf(specs), shipIds: [state.shipId] })
    idle(state)
    changeRange(state)
    expect(startExpedition(state, 'ink-harass', ctx).rangeConfirmation).toBe(true)
  })
  it('旧受压射程确认一次后更新为配置射程，切换入侵舰队不再重复确认', () => {
    const state = world()
    setFleetDistance(state, ctx, 2500)
    const old = startBattleFor(structuredClone(state), ctx, state.shipId, 'ink-harass')!
    expect(old.rangeEw!.meCut).toBeGreaterThan(0)
    const rawRange = playerFleetMaxRangeOf([createPlayerSpec(state, ctx, state.shipId)!])
    state.fleetRange!.maxRangeM = playerFleetMaxRangeOf(buildMyUnitSpecs(state, ctx, old, state.shipId, 'ink-harass'))
    expect(state.fleetRange!.maxRangeM).toBeLessThan(rawRange)
    expect(startExpedition(state, 'ink-main', ctx).rangeConfirmation).toBe(true)
    expect(confirmBattleRange(state, ctx, 2500, NOW).ok).toBe(true)
    expect(state.fleetRange!.maxRangeM).toBe(rawRange)
    expect(state.fleetRange!.desireM).toBe(2500)
    idle(state)
    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).toBe(2500)
  })
  it('坏记忆值被清洗且原型键不污染记录', () => {
    const state = world()
    const raw = JSON.parse(serializeSaveFile(state, NOW))
    raw.state.battleRangeByCard = JSON.parse('{"bad":{"desireM":-1,"maxRangeM":20},"wk-__proto__":{"desireM":3000,"maxRangeM":20},"valid":{"desireM":2300,"maxRangeM":4600}}')
    raw.state.pendingBattleRange = { cardId: 'bad' }
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.battleRangeByCard).toEqual({ valid: { desireM: 2300, maxRangeM: 4600 } })
    expect(loaded.pendingBattleRange).toBeUndefined()
  })
  it('待确认舰队差异从存档名单重算，不采信损坏的标记布尔值', () => {
    const state = world()
    first(state)
    const nextShipId = addShipToFleet(state, 'sh-megalodon')
    state.fleet[nextShipId]!.fitted.high = ['mod-laser-2']
    state.preparationSquads = { combat: [state.shipId, nextShipId] }
    startExpedition(state, 'ink-harass', ctx)
    const raw = JSON.parse(serializeSaveFile(state, NOW))
    raw.state.pendingBattleRange.fleetChanged = false
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.pendingBattleRange!.fleetChanged).toBe(true)
  })
  it('战中改距不覆盖后来更新的编队默认或射程证据', () => {
    const state = world()
    startExpedition(state, 'ink-harass', ctx)
    state.fleetRange = { desireM: 2700, maxRangeM: 20000, shipIds: [state.shipId] }
    setBattleDesire(state, 2300, ctx)
    expect(state.fleetRange).toEqual({ desireM: 2700, maxRangeM: 20000, shipIds: [state.shipId] })
  })
})

function space() {
  const state = world()
  const targets = { 'ammo-plasma-l': 1000 }
  const plan = wormholePreparationPlan(state, ctx, [state.shipId], { targets, unload: [] })
  expect(wormholeEnterPrepared(state, ctx, [state.shipId], 19, plan, undefined, { expeditionRules: 2 }).ok).toBe(true)
  finishDeparture(state, ctx)
  const run = state.wormhole.run!
  const here = gridCellAt(run.grid!, run.grid!.pos)!
  here.place = 'ship'
  delete here.eventKey
  delete here.event
  delete run.pendingEvent
  return state
}
describe('信号空间手动与派队自动距离隔离', () => {
  it('手动读取编队默认，自动计算不读写也不阻塞', () => {
    const state = space()
    setFleetDistance(state, ctx, 2300)
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    const old = structuredClone(state.fleetRange)
    state.wormhole.run!.battle = null
    state.wormhole.run!.automaticBattleRanges = true
    changeRange(state)
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(state.wormhole.run!.battle!.rangeMemory).toBeUndefined()
    expect(state.wormhole.run!.battle!.myDesireM).not.toBe(old!.desireM)
    expect(state.fleetRange).toEqual(old)
    expect(state.pendingBattleRange).toBeUndefined()
  })
  it('移动触战拦截后位置、回合及库存保持，确认重放原移动', () => {
    const state = space()
    const run = state.wormhole.run!
    const grid = run.grid!
    for (const cell of grid.cells) { cell.place = 'empty'; delete cell.event; delete cell.eventKey; delete cell.foe }
    run.patrols = []
    const target = grid.cells.find(cell => hexDistance(cell, grid.pos) === 1)!
    target.place = 'ship'
    grid.scanned.push(target.key)
    const preview = structuredClone(state)
    preview.wormhole.run!.automaticBattleRanges = true
    const options = { confirmUnknown: true, confirmIntercept: true }
    expect(wormholeTravelTo(preview, ctx, target, options).ok).toBe(true)
    const cardId = preview.wormhole.run!.battle!.wormhole!.cardId
    state.fleetRange = { desireM: 2300, maxRangeM: 1, shipIds: [state.shipId] }
    const before = structuredClone(state.wormhole.run)
    const ware = structuredClone(state.warehouse)
    expect(wormholeTravelTo(state, ctx, target, options).ok).toBe(false)
    expect(state.pendingBattleRange!.cardId).toBe(cardId)
    expect(state.wormhole.run).toEqual(before)
    expect(state.warehouse).toEqual(ware)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(confirmBattleRange(loaded, ctx, 2400, NOW).ok).toBe(true)
    expect(loaded.wormhole.run!.battle!.myDesireM).toBe(2400)
    expect(loaded.wormhole.run!.grid!.pos).toEqual({ q: target.q, r: target.r })
  })
  it('事件触战确认前不扣回合或补给，取消不解决事件', () => {
    const state = space()
    const run = state.wormhole.run!
    const here = gridCellAt(run.grid!, run.grid!.pos)!
    here.place = 'empty'
    here.eventKey = 'controller'
    here.event = {}
    run.pendingEvent = { key: 'controller', cellKey: here.key }
    const preview = structuredClone(state)
    preview.wormhole.run!.automaticBattleRanges = true
    expect(wormholeResolveEvent(preview, ctx, 'force').ok).toBe(true)
    const cardId = preview.wormhole.run!.battle!.wormhole!.cardId
    state.fleetRange = { desireM: 2300, maxRangeM: 1, shipIds: [state.shipId] }
    const before = structuredClone(state.wormhole.run)
    expect(wormholeResolveEvent(state, ctx, 'force').ok).toBe(false)
    expect(state.pendingBattleRange!.cardId).toBe(cardId)
    expect(state.wormhole.run).toEqual(before)
    cancelBattleRange(state)
    expect(state.wormhole.run).toEqual(before)
    expect(wormholeResolveEvent(state, ctx, 'force').ok).toBe(false)
    expect(confirmBattleRange(state, ctx, 2300, NOW).ok).toBe(true)
    expect(state.wormhole.run!.battle).toBeTruthy()
  })
})
