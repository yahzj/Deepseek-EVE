import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { startExpedition, setBattleDesire, advanceAutoLoopBounty, advanceAutoLoopInvasion } from '../src/expedition'
import { createPlayerSpec, desiredRangeFor, startBattleFor } from '../src/combat'
import { battleCardRangeOf, cancelBattleRange, playerFleetMaxRangeOf } from '../src/battleRangeMemory'
import { confirmBattleRange } from '../src/battleRangeConfirm'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { fightEncounter, advanceEncounterWatch } from '../src/encounters'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { buildEvalState } from '../src/winEstimate'
import { wormholeEnterPrepared, wormholePreparationPlan } from '../src/wormholePreparation'
import { wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import { gridCellAt, hexDistance } from '../src/wormholeGrid'
import { wormholeResolveEvent } from '../src/wormholeExpedition'
import { simulateOffline } from '../src/simulation'

const ctx = buildSimContext()
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
  state.bountyCooldowns = {}
}
function first(state: ReturnType<typeof world>, card = 'ink-harass') {
  expect(startExpedition(state, card, ctx, { foeGalaxyId: 'galaxy-redring' }).ok).toBe(true)
  expect(setBattleDesire(state, 2500, ctx).ok).toBe(true)
  idle(state)
}
function changeRange(state: ReturnType<typeof world>) { state.fleet[state.shipId]!.fitted.high = ['mod-laser-2'] }

describe('按实际卡ID记忆距离并确认射程变化', () => {
  it('同卡跨星系共享，不同卡不共享，旧星系设置不迁移', () => {
    const state = world()
    state.expedition.desirePrefByGalaxy = { 'galaxy-hub': 9999, 'galaxy-redring': 9999 }
    const defaultM = desiredRangeFor(createPlayerSpec(state, ctx, state.shipId)!, 'mid', ctx.balance.battle)
    expect(startExpedition(state, 'ink-harass', ctx, { foeGalaxyId: 'galaxy-redring' }).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBe(defaultM)
    setBattleDesire(state, 2500, ctx)
    idle(state)
    startExpedition(state, 'ink-harass', ctx, { foeGalaxyId: 'galaxy-kor' })
    expect(state.expedition.battle!.myDesireM).toBe(2500)
    idle(state)
    startExpedition(state, 'ink-raid', ctx, { foeGalaxyId: 'galaxy-kor' })
    expect(state.expedition.battle!.myDesireM).toBe(defaultM)
    expect(state.expedition.desirePrefByGalaxy).toEqual({ 'galaxy-hub': 9999, 'galaxy-redring': 9999 })
  })
  it('首次入场建立射程，增加或缩短均拦截，取消完全不扣料不更新记录', () => {
    const state = world()
    first(state)
    const record = structuredClone(state.battleRangeByCard)
    changeRange(state)
    const before = structuredClone(state)
    expect(startExpedition(state, 'ink-harass', ctx).rangeConfirmation).toBe(true)
    expect(state.pendingBattleRange!.previousRangeM).toBe(record!['ink-harass']!.maxRangeM)
    const { pendingBattleRange, ...after } = state
    expect(pendingBattleRange).toBeDefined()
    expect(after).toEqual(before)
    cancelBattleRange(state)
    expect(state.battleRangeByCard).toEqual(record)
    expect(state.expedition.battle).toBeNull()
  })
  it('确认可改距离，仅成功开战更新记录，下一场同射程不再弹', () => {
    const state = world()
    first(state)
    changeRange(state)
    startExpedition(state, 'ink-harass', ctx)
    expect(confirmBattleRange(state, ctx, 1700, NOW).ok).toBe(true)
    expect(state.pendingBattleRange).toBeUndefined()
    expect(state.expedition.battle!.myDesireM).toBe(1700)
    expect(battleCardRangeOf(state, 'ink-harass')).toEqual({ desireM: 1700, maxRangeM: playerFleetMaxRangeOf([createPlayerSpec(state, ctx, state.shipId)!]) })
    idle(state)
    expect(startExpedition(state, 'ink-harass', ctx).ok).toBe(true)
    idle(state)
    state.fleet[state.shipId]!.fitted.high = ['mod-laser-1']
    expect(startExpedition(state, 'ink-harass', ctx).rangeConfirmation).toBe(true)
  })
  it('确认期间配置再次变化必须重新确认，读档保留待办与按卡记录', () => {
    const state = world()
    first(state)
    changeRange(state)
    startExpedition(state, 'ink-harass', ctx)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(loaded.pendingBattleRange).toEqual(state.pendingBattleRange)
    expect(loaded.battleRangeByCard).toEqual(state.battleRangeByCard)
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
  it('遭遇读实际卡而不是母港，射程确认待办不被60秒超时清掉', () => {
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
  it('全队最大射程包含僚舰无人机，旗舰卡按本身记录且不复用主动卡', () => {
    const state = world()
    state.weekendEvent!.contributed = { 'galaxy-kor': 1, 'galaxy-redring': 1 }
    const ally = addShipToFleet(state, 'sh-sentinel')
    state.fleet[ally]!.droneLoad = { 'drone-scout': 1 }
    const one = weekendStartFlagshipBattle(state, ctx, NOW, [state.shipId, ally])!
    expect(one).not.toBeNull()
    expect(state.battleRangeByCard!['ink-flagship']!.maxRangeM).toBe(playerFleetMaxRangeOf([createPlayerSpec(state, ctx, state.shipId)!, createPlayerSpec(state, ctx, ally)!]))
    expect(state.battleRangeByCard!['ink-harass']).toBeUndefined()
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
    expect(battleCardRangeOf(state, 'ink-harass')!.maxRangeM).not.toBe(state.pendingBattleRange!.maxRangeM)
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
  it('旧在途战斗维持当前目标，手动改距后可记录但不编造历史射程', () => {
    const state = world()
    startExpedition(state, 'ink-harass', ctx)
    delete state.expedition.battle!.rangeMemory
    delete state.battleRangeByCard
    const saved = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(saved.expedition.battle!.myDesireM).toBe(state.expedition.battle!.myDesireM)
    expect(saved.pendingBattleRange).toBeUndefined()
    setBattleDesire(saved, 2300, ctx)
    expect(battleCardRangeOf(saved, 'ink-harass')).toEqual({ desireM: 2300 })
    idle(saved)
    changeRange(saved)
    expect(startExpedition(saved, 'ink-harass', ctx).ok).toBe(true)
    expect(saved.battleRangeByCard!['ink-harass']!.maxRangeM).toBeGreaterThan(0)
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
  it('较早的同卡战斗改距不覆盖后来入场记录的最大射程', () => {
    const state = world()
    startExpedition(state, 'ink-harass', ctx)
    state.battleRangeByCard!['ink-harass']!.maxRangeM = 20000
    setBattleDesire(state, 2300, ctx)
    expect(battleCardRangeOf(state, 'ink-harass')).toEqual({ desireM: 2300, maxRangeM: 20000 })
  })
})

function space() {
  const state = world()
  const targets = { 'ammo-plasma-l': 1000 }
  const plan = wormholePreparationPlan(state, ctx, [state.shipId], { targets, unload: [] })
  expect(wormholeEnterPrepared(state, ctx, [state.shipId], 19, plan, undefined, { expeditionRules: 2 }).ok).toBe(true)
  const run = state.wormhole.run!
  const here = gridCellAt(run.grid!, run.grid!.pos)!
  here.place = 'ship'
  delete here.eventKey
  delete here.event
  delete run.pendingEvent
  return state
}
describe('信号空间手动与派队自动距离隔离', () => {
  it('手动按实际卡建立记忆，自动计算不读写也不阻塞', () => {
    const state = space()
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    const cardId = state.wormhole.run!.battle!.rangeMemory!.cardId
    setBattleDesire(state, 2300, ctx)
    const old = structuredClone(state.battleRangeByCard)
    state.wormhole.run!.battle = null
    state.wormhole.run!.automaticBattleRanges = true
    changeRange(state)
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(state.wormhole.run!.battle!.rangeMemory).toBeUndefined()
    expect(state.wormhole.run!.battle!.myDesireM).not.toBe(old![cardId]!.desireM)
    expect(state.battleRangeByCard).toEqual(old)
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
    state.battleRangeByCard = { [cardId]: { desireM: 2300, maxRangeM: 1 } }
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
    state.battleRangeByCard = { [cardId]: { desireM: 2300, maxRangeM: 1 } }
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
