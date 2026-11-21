import { describe, expect, it } from 'vitest'
import { buildSimContext } from '../../data/src/context'
import { createInitialState, type GameState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { checkAssignable, idleAiShipIds } from '../src/ai/cores'
import { assignAiMining, assignAiSalvage, assignAiStandby } from '../src/ai/assign'
import { combatEscortBlock, stationShipTaskBlock } from '../src/combat/command/locks'
import { commandBudgetOf, COMMAND_SKILLS } from '../src/combat/command/rules'
import { combatRosterOf } from '../src/combat/command/roster'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { startExpedition } from '../src/expedition/launch'
import { fightEncounter } from '../src/encounters/commands'
import { applyActivityGate } from '../src/activityGate'
import { wormholeEnter, wormholeEntryBlockReason, shipActivityBusy } from '../src/wormhole'
import { wormholeAutoShipBlockReason, wormholeAutoCandidates, wormholeAutoDefaultShips,
  wormholeAutoBlockReason, wormholeAutoStart, wormholeAutoMainHandover } from '../src/wormholeAuto'
import { wormholeStockPush } from '../src/wormholeScan'
import { cleanPlayerStationGame, createPlayerStationGame, validatePlayerStationFleet } from '../src/playerStation/gameSave'
import { stationCrewCommand, CREW_QUALIFICATION_MS, type StationCrewHost } from '../src/playerStation/crew'
import { stationSecurityResolve } from '../src/playerStation/gameShips'
import { PlayerStationGameRuntime } from '../src/playerStation/gameRuntime'
import { POPULATION_RECEIVE_MS } from '../src/playerStation/population'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { storeShip, shipStorable, changeShip, loseShip } from '../src/shipyard'
import { shipSellable, sellShipAtMarket, placeShipSellOrder } from '../src/market/ships'
import { scrapShip, shipScrapPreviewOf } from '../src/scrap'
import { addModule, fitModule } from '../src/equipment'

const ctx = buildSimContext()
const errorId = 'core.playerStationGame.001'
const tasks = ['population', 'mining', 'training', 'security'] as const
function world(task?: typeof tasks[number]) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261121 })
  state.fleet = {}
  const main = addShipToFleet(state, 'sh-falconet'), locked = addShipToFleet(state, 'sh-falconet'), free = addShipToFleet(state, 'sh-falconet')
  state.shipId = main
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.standingsEarned = { dsi: 100 }
  state.aiCores.basic = 4
  state.skills.trained[ctx.balance.aiCore.skillId] = 5
  for (const skill of COMMAND_SKILLS) state.skills.trained[skill.id] = 5
  state.research = { levels: { 'mt-explore-signal-auto-t3': 3 } }
  state.playerStation = createPlayerStationGame()
  if (task) state.playerStation.shipLocks[locked] = task
  const stockId = wormholeStockPush(state, ctx)!.id
  return { state, main, locked, free, stockId }
}
function unchanged<T>(state: GameState, action: () => T): T {
  const before = structuredClone(state), result = action()
  expect(state).toEqual(before)
  return result
}
function boundWorld(activity: 'idle' | 'qualifying' = 'idle') {
  const w = world(), game = w.state.playerStation!
  game.discovered = game.active = game.station.built = true
  game.station.cells = [{ cellIndex: 0, kind: 'power', enabled: true }, { cellIndex: 1, kind: 'life-support', enabled: true },
    { cellIndex: 2, kind: 'service', enabled: true }]
  game.population.people[0] = { status: 'resident', receiveMs: POPULATION_RECEIVE_MS }
  const runtime = new PlayerStationGameRuntime(w.state, ctx)
  expect(runtime.command('crew', { kind: 'create', shipId: w.locked }).ok).toBe(true)
  const team = game.crew.teams[0]!
  team.activity = activity
  team.qualificationMs = activity === 'idle' ? CREW_QUALIFICATION_MS : 0
  return { ...w, game, runtime, team }
}

describe('玩家站实际船锁与原任务准入互斥', () => {
  it.each(['idle', 'qualifying'] as const)('%s绑定船真实战沉后仅解除绑定，人员与培养记录随档保留并可改绑', activity => {
    const { state, locked, free, runtime, game, team } = boundWorld(activity)
    const before = structuredClone(team)
    loseShip(state, locked, ctx, '测试战沉', 'galaxy-vault', { cause: 'expedition-lost' })
    expect(team).toEqual({ ...before, shipId: undefined, planned: false })
    expect(state.wreckLog?.some(entry => entry.shipId === locked)).toBe(true)
    expect(() => runtime.advance(1)).not.toThrow()
    expect(runtime.crewView().teams[0]).toMatchObject({ shipAvailable: false, blocked: 'ship' })
    expect(runtime.command('security', { kind: 'guard', teamIds: [team.id] }).ok).toBe(false)
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
    expect(runtime.command('crew', { kind: 'bind', teamId: team.id, shipId: free }).ok).toBe(true)
    expect(team.shipId).toBe(free)
    expect(team.qualificationMs).toBe(before.qualificationMs)
    expect(team.members).toEqual(before.members)
  })

  it('无战沉结算的缺失非空UID仍拒读，不静默删团队或实际任务锁', () => {
    const { state, locked, runtime } = boundWorld()
    delete state.fleet[locked]
    expect(() => runtime.validateContext()).toThrow()
    expect(() => loadSaveFile(serializeSaveFile(state, 0))).toThrow()
  })

  it.each(tasks)('%s锁从空闲AI过滤，所有开放AI指派均拒绝且不扣核心/货物', task => {
    const { state, locked, free } = world(task)
    expect(unchanged(state, () => idleAiShipIds(state))).not.toContain(locked)
    expect(idleAiShipIds(state)).toContain(free)
    expect(unchanged(state, () => checkAssignable(state, locked, 'basic', ctx))).toMatchObject({ ok: false, errorId })
    const belt = [...ctx.belts.values()].find(entry => entry.galaxyId === 'galaxy-hub')!
    const commands = [() => assignAiMining(state, locked, 'basic', belt.id, ctx),
      () => assignAiSalvage(state, locked, 'basic', 'galaxy-hub', ctx),
      () => assignAiStandby(state, locked, 'basic', 'galaxy-hub', ctx)]
    for (const command of commands) expect(unchanged(state, command)).toMatchObject({ ok: false, errorId })
    expect(checkAssignable(state, free, 'basic', ctx).ok).toBe(true)
  })

  it.each(tasks)('%s锁拒绝单舰/多舰/特殊编队预算、出征、遭遇和随行，不静默缩编', task => {
    const { state, main, locked } = world(task)
    state.preparationSquads = { combat: [main, locked] }
    expect(combatRosterOf(state)).toEqual([main, locked])
    for (const ids of [[locked], [main, locked]]) {
      expect(unchanged(state, () => combatEscortBlock(state, ids))).toMatchObject({ errorId })
      for (const special of [false, true]) expect(unchanged(state, () => commandBudgetOf(state, ctx, ids, special)))
        .toMatchObject({ ok: false, errorId })
      expect(unchanged(state, () => startFleetBattleFor(state, ctx, ids, 'ano-training'))).toBeNull()
    }
    expect(unchanged(state, () => startExpedition(state, 'ano-training', ctx))).toMatchObject({ ok: false, errorId })
    expect(unchanged(state, () => applyActivityGate(state, 'mining', ctx))).toMatchObject({ ok: false, errorId })
    state.encounter = { ...state.encounter, active: true, shipId: locked, anomalyId: 'ano-training' }
    expect(unchanged(state, () => fightEncounter(state, ctx))).toMatchObject({ ok: false, errorId })
  })

  it.each(tasks)('%s锁覆盖手动虫洞、自动候选与自动派遣，失败保留信号/主控/库存', task => {
    const { state, locked, free, stockId } = world(task)
    expect(unchanged(state, () => shipActivityBusy(state, locked))).toMatchObject({ errorId })
    expect(unchanged(state, () => wormholeEntryBlockReason(state, ctx, [locked]))).not.toBeNull()
    expect(unchanged(state, () => wormholeEnter(state, ctx, [locked], 10))).toMatchObject({ ok: false, errorId })
    expect(unchanged(state, () => wormholeAutoShipBlockReason(state, locked))).toMatchObject({ errorId })
    expect(unchanged(state, () => wormholeAutoCandidates(state, ctx)).find(row => row.shipId === locked))
      .toMatchObject({ picked: false, blocked: { errorId } })
    expect(wormholeAutoDefaultShips(state, ctx)).not.toContain(locked)
    expect(wormholeAutoDefaultShips(state, ctx)).toContain(free)
    expect(unchanged(state, () => wormholeAutoBlockReason(state, ctx, stockId, [locked])))
      .toMatchObject({ errorId })
    expect(unchanged(state, () => wormholeAutoStart(state, ctx, stockId, [locked])))
      .toMatchObject({ ok: false, errorId })
  })

  it('自动队主控交接跳过已锁接任船，无接任者时不偷用锁船', () => {
    const { state, main, locked, free } = world('population')
    state.fleet[locked]!.fitted.high = ['mod-turret-kin-1']
    expect(unchanged(state, () => wormholeAutoMainHandover(state, ctx, [main])).toId).toBe(free)
    state.playerStation!.shipLocks[free] = 'training'
    expect(unchanged(state, () => wormholeAutoMainHandover(state, ctx, [main])).reasonId).toBe('core.wormholeAuto.018')
  })

  it('解除实际任务锁立即恢复AI、预算、虫洞资格，不修改记忆编队', () => {
    const { state, main, locked, stockId } = world('mining')
    state.preparationSquads = { combat: [main, locked] }
    delete state.playerStation!.shipLocks[locked]
    const before = structuredClone(state)
    expect(stationShipTaskBlock(state, locked)).toBeNull()
    expect(idleAiShipIds(state)).toContain(locked)
    expect(checkAssignable(state, locked, 'basic', ctx).ok).toBe(true)
    expect(combatEscortBlock(state, [main, locked])).toBeNull()
    expect(commandBudgetOf(state, ctx, [main, locked]).ok).toBe(true)
    expect(wormholeEntryBlockReason(state, ctx, [locked])).toBeNull()
    expect(wormholeAutoBlockReason(state, ctx, stockId, [locked])).toBeNull()
    expect(state).toEqual(before)
    expect(assignAiStandby(state, locked, 'basic', 'galaxy-hub', ctx).ok).toBe(true)
  })

  it('仅绑定待命舰员而没有shipLocks时不锁船；旧档缺玩家站时保持原准入', () => {
    const { state, locked, stockId } = world()
    const host: StationCrewHost = { residents: () => [0], personAvailable: () => true,
      ship: () => ({ tier: 1, available: true, home: true, trainingTags: ['fire-control'] }),
      claimShip: () => true, releaseShip: () => {}, ready: () => true, trainingReady: () => true, teamAvailable: () => true }
    expect(stationCrewCommand(state.playerStation!.crew, host, { kind: 'create', shipId: locked }).ok).toBe(true)
    state.playerStation!.crew.teams[0]!.activity = 'idle'
    expect(state.playerStation!.shipLocks).toEqual({})
    expect(idleAiShipIds(state)).toContain(locked)
    expect(checkAssignable(state, locked, 'basic', ctx).ok).toBe(true)
    expect(commandBudgetOf(state, ctx, [locked]).ok).toBe(true)
    expect(wormholeAutoBlockReason(state, ctx, stockId, [locked])).toBeNull()
    delete state.playerStation
    expect(stationShipTaskBlock(state, locked)).toBeNull()
    expect(checkAssignable(state, locked, 'basic', ctx).ok).toBe(true)
  })

  it('本站守备隔离模拟仍可使用归自己持有的security锁，不阻断已确认规则', () => {
    const { state, locked } = world('security'), before = structuredClone(state)
    expect(stationSecurityResolve(state, ctx, [locked], 'ano-harbor-escort').durationMs).toBeGreaterThan(0)
    expect(state).toEqual(before)
  })

  it.each(['idle', 'qualifying'] as const)('%s绑定船可执行真实AI任务，站内显示不可用，存档往返和runtime推进不崩', activity => {
    const { state, locked, runtime, game } = boundWorld(activity)
    const belt = [...ctx.belts.values()].find(entry => entry.galaxyId === 'galaxy-hub')!
    expect(assignAiMining(state, locked, 'basic', belt.id, ctx).ok).toBe(true)
    expect(game.shipLocks).toEqual({})
    expect(() => runtime.validateContext()).not.toThrow()
    expect(runtime.shipsView().find(ship => ship.id === locked)).toMatchObject({ available: false, location: 'elsewhere' })
    expect(runtime.crewView().teams[0]).toMatchObject({ shipId: locked, shipAvailable: false, blocked: 'ship' })
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.playerStation).toEqual(game)
    expect(back.aiAssignments[locked]).toEqual(state.aiAssignments[locked])
    expect(() => new PlayerStationGameRuntime(back, ctx).advance(1)).not.toThrow()
  })

  it.each(['idle', 'qualifying'] as const)('%s绑定船可换为主控，保留绑定且不可用于站内派遣，切回后恢复', activity => {
    const { state, main, locked, runtime, game } = boundWorld(activity)
    expect(changeShip(state, locked, ctx).ok).toBe(true)
    expect(runtime.shipsView().find(ship => ship.id === locked)).toMatchObject({ available: false, auxiliary: false, location: 'elsewhere' })
    expect(runtime.crewView().teams[0]).toMatchObject({ shipAvailable: false, blocked: 'ship' })
    expect(() => runtime.advance(1)).not.toThrow()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
    expect(changeShip(state, main, ctx).ok).toBe(true)
    expect(runtime.shipsView().find(ship => ship.id === locked)).toMatchObject({ available: true, auxiliary: true, location: 'home' })
    expect(runtime.crewView().teams[0]!.shipAvailable).toBe(true)
  })

  it.each(['idle', 'qualifying'] as const)('%s绑定不阻断站内真实delivery借船，clean不将绑定算作第二次占用', activity => {
    const { state, locked, runtime, game } = boundWorld(activity)
    game.station.recoveryMaterials = { 'part-frame': 1 }
    expect(runtime.command('recover', { shipId: locked }).ok).toBe(true)
    expect(game.shipLocks[locked]).toBe('population')
    expect(game.crew.teams[0]!.shipId).toBe(locked)
    expect(cleanPlayerStationGame(game)).toEqual(game)
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
    expect(() => runtime.advance(1)).not.toThrow()
  })

  it.each(['idle', 'qualifying'] as const)('%s绑定不阻断站内真实采矿借船，clean只核对mining活动锁', activity => {
    const { state, locked, runtime, game } = boundWorld(activity)
    game.population.people[1] = { status: 'resident', receiveMs: POPULATION_RECEIVE_MS }
    const belt = [...ctx.belts.values()].find(entry => entry.galaxyId === 'galaxy-vault' && !entry.outputs?.length)!
    expect(runtime.command('mining', { kind: 'assign', shipId: locked, beltId: belt.id, personIndex: 1 }).ok).toBe(true)
    expect(game.shipLocks[locked]).toBe('mining')
    expect(cleanPlayerStationGame(game)).toEqual(game)
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
  })

  it('训练实际持锁时仍拒绝与主控/原AI双占，不因放宽绑定而放宽活动锁', () => {
    const { state, locked, runtime, game, team } = boundWorld()
    addModule(state, 'mod-turret-kin-1', 1)
    expect(fitModule(state, 'mod-turret-kin-1', ctx, { shipId: locked }).ok).toBe(true)
    team.activity = 'training'; team.planned = true
    game.shipLocks[locked] = 'training'
    expect(() => runtime.validateContext()).not.toThrow()
    state.aiAssignments[locked] = { coreType: 'basic', startedAtGameMs: 0,
      task: { kind: 'standby', galaxyId: 'galaxy-hub', phase: 'stand', outMs: 1, finishAtGameMs: 0 } }
    expect(() => runtime.validateContext()).toThrow()
    expect(() => validatePlayerStationFleet(game, state.fleet, state.shipId, new Set([locked]))).toThrow()
    delete state.aiAssignments[locked]
    state.shipId = locked
    expect(() => runtime.validateContext()).toThrow()
  })

  it('人口待发计划不占船，可被外部使用或切为主控，但仍须保留真实UID', () => {
    const { state, locked, main, runtime, game } = boundWorld()
    game.crew.teams = []; game.crew.sequence = 0
    game.population.plan = { shipId: locked, remaining: 1, stopped: false }
    expect(assignAiStandby(state, locked, 'basic', 'galaxy-hub', ctx).ok).toBe(true)
    expect(() => runtime.validateContext()).not.toThrow()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
    delete state.aiAssignments[locked]
    state.shipId = locked
    expect(() => runtime.advance(1)).not.toThrow()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
    state.shipId = main
    delete state.fleet[locked]
    expect(() => runtime.validateContext()).toThrow()
    expect(() => validatePlayerStationFleet(game, state.fleet, main, new Set())).toThrow()
  })

  it('绑定/待发计划引用船不可入仓、挂卖或拆解；解散/停止计划后恢复且拒绝无副作用', () => {
    const { state, locked, game, runtime, team } = boundWorld()
    const bindingId = 'core.playerStationGame.002'
    expect(unchanged(state, () => shipStorable(state, locked))).toMatchObject({ ok: false, reasonId: bindingId })
    expect(unchanged(state, () => storeShip(state, locked, ctx))).toMatchObject({ ok: false, errorId: bindingId })
    expect(unchanged(state, () => shipSellable(state, locked))).toMatchObject({ ok: false, errorId: bindingId })
    expect(unchanged(state, () => sellShipAtMarket(state, ctx, locked))).toMatchObject({ ok: false, errorId: bindingId })
    expect(unchanged(state, () => placeShipSellOrder(state, ctx, locked, 100))).toBeNull()
    expect(unchanged(state, () => shipScrapPreviewOf(state, ctx, locked))).toMatchObject({ ok: false, blockId: bindingId })
    expect(unchanged(state, () => scrapShip(state, ctx, locked))).toMatchObject({ ok: false, errorId: bindingId })
    expect(runtime.command('crew', { kind: 'disband', teamId: team.id }).ok).toBe(true)
    game.population.plan = { shipId: locked, remaining: 1, stopped: false }
    expect(unchanged(state, () => storeShip(state, locked, ctx))).toMatchObject({ ok: false, errorId: bindingId })
    delete game.population.plan
    expect(storeShip(state, locked, ctx).ok).toBe(true)
    expect(state.fleet[locked]).toBeUndefined()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.playerStation).toEqual(game)
  })
})
