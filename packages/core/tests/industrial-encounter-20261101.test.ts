import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { advanceGame } from '../src/engine'
import { spawnIndustrialEncounter, advanceIndustrialProtection } from '../src/encounters/industrial'
import { collectExposures, rollLowSecAmbush } from '../src/encounters/presence'
import { settleEncounterBattle } from '../src/encounters/outcome'
import { retreatEncounterBattle } from '../src/encounters/commands'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { resolvedBattleAnomaly } from '../src/combat/cards'
import { createFoeSpecs } from '../src/combat/foes/catalog'
import { startHauling } from '../src/hauling'
import { startMining } from '../src/mining'
import { weekendFlagshipBattleViewOf } from '../src/weekendLaunch'
import { notePreparationSquad } from '../src/preparationSquads'
import { advanceComms } from '../src/comms'

function world() {
  const original = buildSimContext()
  const ctx = { ...original, balance: structuredClone(original.balance) }
  ctx.balance.events.enabled = false
  const state = createInitialState({ nowWallMs: 0, seed: 17 })
  state.fleet = {}
  state.shipId = addShipToFleet(state, 'sh-shrike')
  const card = [...ctx.anomalies.values()].find(row => !row.hidden && row.region !== 'inv' && (ctx.galaxies.get(row.galaxyId)?.security ?? 1) < 0)!
  state.awayGalaxy = card.galaxyId
  state.industrialProtection = { version: 1, entryRemainingMs: 0, dockedMs: 0, postBattleUntilMs: 0 }
  return { state, ctx, galaxy: card.galaxyId }
}

describe('工业遇袭接线与时间账本', () => {
  it('独立AI不提供暴露，主控在港不受影响', () => {
    const { state, ctx, galaxy } = world()
    const aiShip = addShipToFleet(state, 'sh-shrike')
    state.aiAssignments[aiShip] = { coreType: 'basic', startedAtGameMs: 0, task: { kind: 'standby', galaxyId: galaxy, phase: 'stand', finishAtGameMs: 0, outMs: 1 } }
    state.awayGalaxy = null
    expect(collectExposures(state, ctx)).toEqual([])
    expect(rollLowSecAmbush(state, ctx)).toBe(false)
  })

  it('遭遇立即真开战，完整敌方配置不依赖目录且存读档不重抽', () => {
    const { state, ctx, galaxy } = world()
    expect(spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })).toBe(true)
    expect(state.encounter.battle).not.toBeNull()
    expect(state.encounter.pirate!.card.ships!.every(row => row.ship.family === 'A')).toBe(true)
    const before = createFoeSpecs(state.encounter.pirate!.card, ctx.balance.battle)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    expect(loaded.encounter.pirate).toEqual(state.encounter.pirate)
    const card = resolvedBattleAnomaly(ctx, loaded.encounter.battle!, loaded.encounter.anomalyId)
    expect(card).toBeDefined()
    expect(createFoeSpecs(card!, ctx.balance.battle)).toEqual(before)
    const seed = loaded.encounter.pirate!.seed
    advanceGame(loaded, 100, ctx)
    expect(loaded.encounter.pirate?.seed).toBe(seed)
  })

  it('运输遇袭冻结航程，手动撤退终止承运并真实返港', () => {
    const { state, ctx, galaxy } = world()
    state.awayGalaxy = null
    const site = [...ctx.stations.values()].find(row => row.galaxyId !== 'galaxy-hub')!
    state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    expect(startHauling(state, null, site.id, ctx, 100).ok).toBe(true)
    const progress = state.hauling.phaseAccMs
    expect(spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })).toBe(true)
    advanceGame(state, 100, ctx)
    expect(state.hauling.phaseAccMs).toBe(progress)
    expect(retreatEncounterBattle(state, ctx).ok).toBe(true)
    expect(state.hauling.active).toBe(false)
    expect(state.hauling.fleetLeg).toBeUndefined()
    expect(state.encounter.active).toBe(false)
    expect(state.transit.active).toBe(true)
    expect(state.industrialProtection!.postBattleUntilMs - state.gameMs).toBe(300_000)
  })

  it('胜利不重复结算，保留5分钟战后保护', () => {
    const { state, ctx, galaxy } = world()
    spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })
    const enc = state.encounter
    enc.battle!.ended = 'me'
    settleEncounterBattle(state, ctx, enc)
    const wallet = state.wallet.isk
    expect(state.encounter.active).toBe(false)
    expect(state.industrialProtection!.postBattleUntilMs).toBe(300_000)
    advanceGame(state, 100, ctx)
    expect(state.wallet.isk).toBe(wallet)
  })

  it('入场2+3分钟累计，短暂靠站不刷新，连续停靠15分钟恢复', () => {
    const { state, ctx } = world()
    state.industrialProtection!.entryRemainingMs = 300_000
    advanceIndustrialProtection(state, ctx, 120_000, true)
    expect(state.industrialProtection!.entryRemainingMs).toBe(180_000)
    state.awayGalaxy = null
    advanceIndustrialProtection(state, ctx, 899_999, false)
    expect(state.industrialProtection!.entryRemainingMs).toBe(180_000)
    advanceIndustrialProtection(state, ctx, 1, false)
    expect(state.industrialProtection!.entryRemainingMs).toBe(300_000)
    state.awayGalaxy = 'galaxy-redring'
    state.industrialProtection!.postBattleUntilMs = 900_000
    advanceIndustrialProtection(state, ctx, 300_000, true)
    expect(state.industrialProtection!.entryRemainingMs).toBe(0)
  })

  it('普通后台遭遇观战复用同一战斗，不另建敌群', () => {
    const { state, ctx, galaxy } = world()
    spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })
    const seed = state.encounter.pirate!.seed
    const view = weekendFlagshipBattleViewOf(state, ctx)
    expect(view?.battle).toBe(state.encounter.battle)
    expect(view?.anomaly).toEqual(state.encounter.pirate!.card)
    expect(state.encounter.pirate!.seed).toBe(seed)
  })

  it('运输胜利且完整存活接续原货量，沉船则取消整段不发运费', () => {
    const { state, ctx, galaxy } = world()
    state.awayGalaxy = null
    const site = [...ctx.stations.values()][0]!
    state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
    startHauling(state, null, site.id, ctx, 100)
    spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })
    state.encounter.battle!.ended = 'me'
    settleEncounterBattle(state, ctx, state.encounter)
    expect(state.hauling.active).toBe(true)
    expect(state.hauling.fleetLeg!.loadedM3).toBe(100)
    const wallet = state.wallet.isk
    spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })
    state.encounter.battle!.units.player!.hp = { s: 0, a: 0, h: 0 }
    state.encounter.battle!.ended = 'foe'
    settleEncounterBattle(state, ctx, state.encounter)
    expect(state.hauling.active).toBe(false)
    expect(state.hauling.fleetLeg).toBeUndefined()
    expect(state.wallet.isk).toBe(wallet)
  })

  it('损坏新快照不退回旧运输或文字抽签', () => {
    const { state, ctx, galaxy } = world()
    spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })
    const raw = JSON.parse(serializeSaveFile(state))
    raw.state.encounter.pirate.card.ships = [null]
    const restored = loadSaveFile(JSON.stringify(raw)).state
    expect(restored.encounter.active).toBe(false)
  })

  it('相同输入在线与离线推进真实战斗一致', () => {
    const { state, ctx, galaxy } = world()
    spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '停留' })
    for (const unit of Object.values(state.encounter.battle!.units)) unit.weapons.fill(120_000)
    const online = structuredClone(state), offline = structuredClone(state)
    for (let i = 0; i < 20; i++) advanceGame(online, 1000, ctx)
    advanceGame(offline, 20_000, ctx, { offline: true })
    expect(offline.encounter.battle!.units).toEqual(online.encounter.battle!.units)
    expect(offline.encounter.battle!.lastTickGameMs).toBe(online.encounter.battle!.lastTickGameMs)
    expect(offline.encounter.pirate).toEqual(online.encounter.pirate)
  })

  it('事件到点在实际时刻触发，在线和离线不把战斗时间计入运输', () => {
    const { state, ctx, galaxy } = world()
    ctx.balance.events.enabled = true
    ctx.balance.events.minGapMs = 10_000
    ctx.balance.events.maxGapMs = 10_000
    ctx.balance.encounter.ambushChanceAtZero = 1
    ctx.balance.encounter.ambushChancePerSec = 0
    ctx.balance.encounter.industrial.frequency.maximumChance = 1
    state.events.nextAtGameMs = 10_000
    state.awayGalaxy = galaxy
    const online = structuredClone(state), offline = structuredClone(state)
    for (let i = 0; i < 60; i++) advanceGame(online, 1000, ctx, { offline: true })
    advanceGame(offline, 60_000, ctx, { offline: true })
    expect(offline.encounter.invitedAtGameMs).toBe(online.encounter.invitedAtGameMs)
    expect(offline.encounter.pirate).toEqual(online.encounter.pirate)
    expect(offline.encounter.battle?.units).toEqual(online.encounter.battle?.units)
    expect(offline.industrialProtection).toEqual(online.industrialProtection)
    expect(offline.transit).toEqual(online.transit)
  })

  it('采矿遇袭时不产矿，胜利后恢复原进度', () => {
    const { state, ctx, galaxy } = world()
    state.awayGalaxy = null
    state.shipId = addShipToFleet(state, [...ctx.ships.values()].find(ship => ship.role === 'industrial')!.id)
    const belt = [...ctx.belts.values()].find(row => (row.standingReq ?? 0) === 0)!
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    expect(startMining(state, belt.id, ctx).ok).toBe(true)
    expect(spawnIndustrialEncounter(state, ctx, { galaxyId: galaxy, shipId: state.shipId, kind: '采矿' })).toBe(true)
    for (const unit of Object.values(state.encounter.battle!.units)) unit.weapons.fill(120_000)
    const m = structuredClone(state.mining), cargo = structuredClone(state.fleet[state.shipId]!.cargo)
    advanceGame(state, 30_000, ctx)
    expect(state.mining).toEqual(m)
    expect(state.fleet[state.shipId]!.cargo).toEqual(cargo)
    state.encounter.battle!.ended = 'me'
    settleEncounterBattle(state, ctx, state.encounter)
    expect(state.mining.active).toBe(true)
    expect(state.mining.cycleAccMs).toBe(m.cycleAccMs)
  })

  it('首次多矿船立即记忆，移出后仍待送且随档只发一次', () => {
    const { state, ctx } = world()
    state.awayGalaxy = null
    const miner = [...ctx.ships.values()].find(ship => ship.role === 'industrial')!.id
    const ids = [addShipToFleet(state, miner), addShipToFleet(state, miner)]
    expect(notePreparationSquad(state, 'combat', ids, ctx)).toBe(true)
    expect(state.industrialFleetRiskSeen).toBe(true)
    notePreparationSquad(state, 'combat', [], ctx)
    const loaded = loadSaveFile(serializeSaveFile(state)).state
    advanceComms(loaded, ctx)
    expect(loaded.commsDelivered?.['msg-industrial-fleet-risk']).toBeDefined()
    const value = loaded.commsDelivered?.['msg-industrial-fleet-risk']
    loaded.gameMs += 1000
    advanceComms(loaded, ctx)
    expect(loaded.commsDelivered?.['msg-industrial-fleet-risk']).toBe(value)
  })
})
