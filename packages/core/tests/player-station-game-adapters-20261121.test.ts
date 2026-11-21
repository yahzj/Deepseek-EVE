import { describe, expect, it } from 'vitest'
import { advanceGame } from '../src/engine'
import { buildSimContext } from '../../data/src/context'
import { createInitialState, type GameState } from '../src/state'
import type { SimContext } from '../src/types'
import { addShipToFleet } from '../src/fleetBook'
import { addModule, fitModule, adjustDroneLoad } from '../src/equipment'
import { cargoCapacityM3Of } from '../src/inventory'
import { startRefineRun } from '../src/industry/refining/start'
import { refineBatchOutputOf } from '../src/industry/refining/params'
import { startManufacturing } from '../src/industry/manufacturing/start'
import { advanceMining, getMiningParams, oneLegMs, oneOutboundLegMs } from '../src/mining'
import { scaledReturnMs } from '../src/trips'
import { departureDurationMs } from '../src/departure'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { advanceBattleFor } from '../src/combat/advance'
import { refundBattleAmmo } from '../src/combat/combatAmmo'
import { refundRepairKitsAll } from '../src/combat/combatRepair'
import { waveGapTotalMs } from '../src/combat/combatMath'
import { refiningRecipe, refiningOutput, manufacturingRecipe, miningParams, miningCycle, miningReturnMs,
  STATION_GAME_ORIGIN } from '../src/playerStation/gameRecipes'
import { stationShipAvailable, stationCrewShip, stationSecurityResolve } from '../src/playerStation/gameShips'
import { STATION_SECURITY_SOURCES } from '../src/playerStation/security'
import type { StationMiningRun } from '../src/playerStation/mining'
import type { PlayerStationGame } from '../src/playerStation/gameTypes'
import { createPlayerStationGame } from '../src/playerStation/gameSave'

const ctx = buildSimContext()
const stateOf = () => createInitialState({ nowWallMs: 0, seed: 20261121 })
function skillProfile(state: GameState, level: number) {
  for (const skill of ctx.skills.values()) state.skills.trained[skill.id] = level
}
function fit(state: GameState, uid: string, ids: readonly string[]) {
  for (const id of ids) {
    addModule(state, id, 1)
    expect(fitModule(state, id, ctx, { shipId: uid }).ok).toBe(true)
  }
}
function miningRun(shipId: string, beltId: string, cargo: Record<string, number> = {}): StationMiningRun {
  return { shipId, beltId, cargo, personIndex: 0, phase: 'mining', progressMs: 0, durationMs: 1,
    stopping: false, paused: false, cyclesDone: 0, tripsDone: 0, rvLeft: 0, rng: { seed: 19, count: 0 } }
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeTree(child)
  }
  return value
}
function directBattle(state: GameState, ids: readonly string[], source: string, context: SimContext = ctx) {
  const sim = structuredClone(state)
  sim.shipId = ids[0]!
  sim.gameMs = 0
  sim.resupplyFromWarehouse = true
  sim.expedition.lairTier = undefined
  sim.expedition.factionActive = undefined
  sim.wormhole.run = null
  const battle = startFleetBattleFor(sim, context, ids, source, 0)!
  const limit = context.balance.battle.maxBattleMs + waveGapTotalMs(context.anomalies.get(source), context.balance.battle) + 60_000
  while (!battle.ended && sim.gameMs < limit) {
    sim.gameMs = Math.min(limit, sim.gameMs + 1000)
    advanceBattleFor(sim, context, battle, sim.shipId, source)
  }
  refundBattleAmmo(sim, battle)
  refundRepairKitsAll(sim, battle)
  const ammoUsed: Record<string, number> = {}
  for (const [id, n] of Object.entries(state.warehouse.items)) {
    const used = n - (sim.warehouse.items[id] ?? 0)
    if (used > 0) ammoUsed[id] = used
  }
  return { battle, sim, ammoUsed }
}

describe('玩家站正式资源适配', () => {
  it('直接加载正式engine并推进已有站点，不在模块初始化时创建工业state', () => {
    const state = stateOf()
    state.playerStation = createPlayerStationGame()
    state.playerStation.active = true
    expect(() => advanceGame(state, 1, ctx, { nowWallMs: 1 })).not.toThrow()
    expect(state.gameMs).toBe(1)
    expect(refiningRecipe(state, ctx, [...ctx.items.values()].find(item => item.refine?.length)!.id)).toBeDefined()
  })

  it('站内制造不受主控debugQuick缩时，精炼仍保持原主控同条件', () => {
    const state = stateOf(), bp = 'bp-part-armor-plate', ore = [...ctx.items.values()].find(item => item.refine?.length)!.id
    const normal = manufacturingRecipe(state, ctx, bp)
    state.debugQuick = true
    expect(manufacturingRecipe(state, ctx, bp)).toEqual(normal)
    expect(refiningRecipe(state, ctx, ore)!.cycleMs).toBe(1000)
  })

  it.each([0, 5])('精炼实时技能%s及科技参数、产出与原开炉单点一致，不要求真实库存或主控空闲', level => {
    const state = stateOf()
    skillProfile(state, level)
    state.research = { levels: {} }
    for (const node of ctx.matterTech?.values() ?? []) state.research.levels[node.id] = level > 0 ? node.maxLevel : 0
    const ores = [...ctx.items.values()].filter(item => item.refine?.length)
    expect(ores.length).toBeGreaterThan(0)
    state.mining.active = true
    state.fleet[state.shipId]!.cargo = { 'min-tritanium': 8 }
    state.warehouse.items = {}
    const before = structuredClone(state)
    freezeTree(state)
    for (const ore of ores) {
      const direct = stateOf()
      direct.skills = structuredClone(state.skills)
      direct.research = structuredClone(state.research)
      direct.warehouse.items[ore.id] = 1_000_000
      expect(startRefineRun(direct, ore.id, 'pilot', ctx).ok).toBe(true)
      const run = direct.refineRuns[0]!
      expect(refiningRecipe(state, ctx, ore.id)).toEqual({ batchUnits: run.batchUnits, cycleMs: run.cycleMs })
      expect(refiningOutput(state, ctx, ore.id, run.batchUnits)).toEqual(Object.fromEntries(
        refineBatchOutputOf(direct, ctx, ore, run.batchUnits).map(row => [row.mineralId, row.units])))
    }
    expect(state).toEqual(before)
    expect(refiningRecipe(state, ctx, 'missing')).toBeUndefined()
    expect(refiningOutput(state, ctx, 'missing', 10)).toEqual({})
  })

  it.each([0, 5])('七种开放基础零件按当前技能%s与原制造开工的扣料/周期一致', level => {
    const state = stateOf()
    skillProfile(state, level)
    const basics = [...ctx.blueprints.values()].filter(bp => bp.learnless && bp.partTier === 'basic')
    expect(basics).toHaveLength(7)
    state.warehouse.items = {}
    state.expedition.active = true
    const before = structuredClone(state)
    freezeTree(state)
    for (const bp of basics) {
      const direct = stateOf()
      direct.skills = structuredClone(state.skills)
      for (const row of bp.materials) direct.warehouse.items[row.itemId] = 1_000_000
      expect(startManufacturing(direct, bp.id, 'pilot', ctx).ok).toBe(true)
      const run = direct.manufacturingRuns[0]!
      expect(manufacturingRecipe(state, ctx, bp.id)).toEqual({ cycleMs: run.durationMs,
        input: Object.fromEntries(run.spentMaterials!.map(row => [row.itemId, row.count])), output: { [bp.itemId!]: bp.outputUnits } })
    }
    for (const bp of ctx.blueprints.values()) if (!basics.includes(bp)) expect(manufacturingRecipe(state, ctx, bp.id)).toBeUndefined()
    expect(state).toEqual(before)
  })

  it('升级技能和更换ctx立即生效，不缓存陈旧工业读数', () => {
    const state = stateOf(), bp = 'bp-part-armor-plate', ore = [...ctx.items.values()].find(item => item.refine?.length)!
    const first = manufacturingRecipe(state, ctx, bp)!, refine = refiningRecipe(state, ctx, ore.id)!
    skillProfile(state, 5)
    expect(manufacturingRecipe(state, ctx, bp)!.cycleMs).toBeLessThan(first.cycleMs)
    expect(refiningRecipe(state, ctx, ore.id)!.cycleMs).toBeLessThan(refine.cycleMs)
    const blueprints = new Map(ctx.blueprints)
    blueprints.set(bp, { ...blueprints.get(bp)!, buildSeconds: 999 })
    expect(manufacturingRecipe(state, { ...ctx, blueprints }, bp)!.cycleMs).toBeGreaterThan(first.cycleMs)
  })

  it.each([{ defId: 'sandcat', level: 0, modules: ['mod-miner-1'] },
    { defId: 'whale', level: 5, modules: ['mod-miner-2', 'mod-miner-2'] }])('真实矿船$defId、技能$level与原循环和返航单点一致', profile => {
    const state = stateOf()
    skillProfile(state, profile.level)
    const uid = addShipToFleet(state, profile.defId)
    fit(state, uid, profile.modules)
    const belts = [...ctx.belts.values()].filter(belt => belt.galaxyId === STATION_GAME_ORIGIN && !belt.outputs?.length)
    expect(belts.length).toBeGreaterThan(0)
    const before = structuredClone(state)
    freezeTree(state)
    for (const belt of belts) {
      const original = getMiningParams(state, ctx, { shipId: uid, beltId: belt.id })!
      expect(miningParams(state, ctx, uid, belt.id)).toEqual({ cycleMs: original.cycleMs, unitsPerCycle: original.unitsPerCycle,
        capacityM3: cargoCapacityM3Of(state, ctx, uid), departureMs: departureDurationMs(ctx, 'mining', STATION_GAME_ORIGIN, STATION_GAME_ORIGIN).totalMs })
      for (const cargo of [{}, { [belt.oreId]: 1_000_000 }]) {
        const run = miningRun(uid, belt.id, cargo)
        run.rvLeft = 1
        const direct = structuredClone(state)
        direct.shipId = uid
        direct.fleet[uid]!.cargo = { ...cargo }
        direct.rng = { ...run.rng }
        direct.mining = { ...direct.mining, active: true, beltId: belt.id, autoCycle: true, rvLeft: run.rvLeft,
          originGalaxy: STATION_GAME_ORIGIN }
        advanceMining(direct, original.cycleMs, ctx)
        expect(miningCycle(state, ctx, run)).toEqual({ cargo: direct.fleet[uid]!.cargo,
          rng: direct.rng, rvLeft: direct.mining.rvLeft, returning: direct.mining.phase === 'returning' })
        expect(miningReturnMs(state, ctx, run)).toBe(scaledReturnMs(oneLegMs(direct, ctx, belt.id, uid, STATION_GAME_ORIGIN)
          + oneOutboundLegMs(direct, ctx, belt.id, uid, STATION_GAME_ORIGIN), { ...direct, fleet: { ...direct.fleet, [uid]: { ...direct.fleet[uid]!, cargo } } }, ctx, uid))
      }
    }
    expect(state).toEqual(before)
    expect(miningParams(state, ctx, state.shipId, belts[0]!.id)).toBeUndefined()
    expect(miningParams(state, ctx, uid, 'missing')).toBeUndefined()
  })

  it('副船可用性拒绝主控、AI作业、返航、随行、遭遇和虫洞；只可忽略本站锁', () => {
    const base = stateOf(), uid = addShipToFleet(base, 'sh-mako')
    expect(stationShipAvailable(base, ctx, uid)).toBe(true)
    expect(stationShipAvailable(base, ctx, base.shipId)).toBe(false)
    expect(stationShipAvailable(base, ctx, 'missing')).toBe(false)
    const mutations: ((state: GameState) => void)[] = [
      state => { state.aiAssignments[uid] = { coreType: 'basic', startedAtGameMs: 0,
        task: { kind: 'standby', galaxyId: STATION_GAME_ORIGIN, finishAtGameMs: 0, outMs: 1, phase: 'stand' } } },
      state => { state.shipReturns[uid] = { beltId: null, legMs: 100, phaseAccMs: 0 } },
      state => { state.expedition.active = true; state.expedition.sortie = { leaderShipId: state.shipId, shipIds: [state.shipId, uid] } as NonNullable<GameState['expedition']['sortie']> },
      state => { state.wormhole.run = { fleet: [uid] } as unknown as NonNullable<GameState['wormhole']['run']> },
      state => { state.wormholeAuto = [{ shipIds: [uid] } as NonNullable<GameState['wormholeAuto']>[number]] },
      state => { state.encounter.active = true; state.encounter.shipId = uid },
      state => { state.departure = { kind: 'mining', shipId: uid, fromGalaxy: STATION_GAME_ORIGIN,
        fromSite: null, toGalaxy: STATION_GAME_ORIGIN, undockMs: 5000, gateMs: 0, progressMs: 0 } },
      state => { state.fleet[uid]!.durability = 0 },
    ]
    for (const mutate of mutations) {
      const state = structuredClone(base)
      mutate(state)
      const before = structuredClone(state)
      expect(stationShipAvailable(freezeTree(state), ctx, uid, true)).toBe(false)
      expect(() => stationSecurityResolve(state, ctx, [uid], STATION_SECURITY_SOURCES[0]!.id)).toThrow()
      expect(state).toEqual(before)
    }
    const station = base as GameState & { playerStation?: PlayerStationGame }
    station.playerStation = { shipLocks: { [uid]: 'training' } } as PlayerStationGame
    expect(stationShipAvailable(base, ctx, uid)).toBe(false)
    expect(stationShipAvailable(base, ctx, uid, true)).toBe(true)
  })

  it('舰员船型按正式舰种映射，维修与无人机课程来自实际装配，不凭船名赠送', () => {
    const state = stateOf()
    for (const [defId, tier] of [['sh-falconet', 1], ['sh-mako', 1], ['sh-hammerhead', 2], ['sh-megalodon', 3]] as const) {
      const def = ctx.ships.get(defId)
      expect(def).toBeDefined()
      const uid = addShipToFleet(state, defId)
      expect(stationCrewShip(state, ctx, uid)).toMatchObject({ tier, trainingTags: [], available: true, home: true })
      fit(state, uid, ['mod-turret-kin-1'])
      expect(stationCrewShip(state, ctx, uid)!.trainingTags).toEqual(['fire-control'])
    }
    const uid = addShipToFleet(state, 'sh-hammerhead')
    fit(state, uid, ['mod-turret-kin-1', 'mod-hullrep-1'])
    state.warehouse.items['drone-scout'] = 1
    expect(adjustDroneLoad(state, ctx, 'drone-scout', 1, uid).ok).toBe(true)
    expect(stationCrewShip(freezeTree(state), ctx, uid)!.trainingTags).toEqual(['fire-control', 'damage-control', 'drones'])
  })

  it('空矿船与纯采矿装配无火控资格，不因船体基础炮或舰船火力加成开放课程', () => {
    const state = stateOf(), uid = addShipToFleet(state, 'sandcat')
    expect(stationCrewShip(state, ctx, uid)!.trainingTags).toEqual([])
    fit(state, uid, ['mod-miner-1'])
    expect(stationCrewShip(state, ctx, uid)!.trainingTags).toEqual([])
  })

  it.each([0, 5])('守备技能%s、实际耐久及两艘同型不同装配与原舰队战斗完全同账，零真实战损', level => {
    const state = stateOf()
    skillProfile(state, level)
    const a = addShipToFleet(state, 'sh-hammerhead'), b = addShipToFleet(state, 'sh-hammerhead')
    fit(state, a, ['mod-turret-kin-1', 'mod-hullrep-1'])
    fit(state, b, ['mod-turret-kin-2', 'mod-turret-kin-2'])
    state.warehouse.items = { 'ammo-kinetic-l': 70, 'ammo-kinetic-2': 90, 'repairkit-mil': 8 }
    state.fleet[a]!.armorPct = 0.2
    state.fleet[a]!.durability = 0.6
    state.fleet[a]!.cargo = { 'min-tritanium': 19, 'ammo-kinetic-l': 999 }
    state.resupplyFromWarehouse = false
    const before = structuredClone(state), ids = [a, b], source = STATION_SECURITY_SOURCES[2]!.id
    const direct = directBattle(state, ids, source)
    const result = stationSecurityResolve(freezeTree(state), ctx, ids, source)
    expect(result.outcome).toBe(direct.battle.ended === 'me' ? 'victory' : 'defeat')
    expect(result.durationMs).toBe(direct.battle.lastTickGameMs - direct.battle.startedAtGameMs)
    expect(result.ammoUsed).toEqual(direct.ammoUsed)
    expect(result.ammoUsed!['repairkit-mil']).toBeGreaterThan(0)
    for (const [id, count] of Object.entries(result.ammoUsed!)) expect(count).toBeLessThanOrEqual(state.warehouse.items[id]!)
    for (const id of Object.keys(result.reward)) expect(ctx.items.has(id)).toBe(true)
    expect(stationSecurityResolve(state, ctx, ids, source)).toEqual(result)
    expect(state).toEqual(before)
  })

  it('共仓缺弹不使用船货暗补，有限弹药只报真实消耗，非法部署拒绝', () => {
    const state = stateOf(), uid = addShipToFleet(state, 'sh-falconet'), source = STATION_SECURITY_SOURCES[2]!.id
    fit(state, uid, ['mod-turret-kin-1'])
    state.fleet[uid]!.cargo = { 'ammo-kinetic-l': 10000 }
    state.warehouse.items = {}
    expect(stationSecurityResolve(state, ctx, [uid], source).ammoUsed).toEqual({})
    expect(stationSecurityResolve(state, ctx, [uid], source).outcome).toBe('defeat')
    state.warehouse.items['ammo-kinetic-l'] = 1
    expect(stationSecurityResolve(state, ctx, [uid], source).ammoUsed).toEqual({ 'ammo-kinetic-l': 1 })
    for (const ids of [[], [uid, uid], ['missing'], [state.shipId]]) expect(() => stationSecurityResolve(state, ctx, ids, source)).toThrow()
    expect(() => stationSecurityResolve(state, ctx, [uid], 'missing')).toThrow()
    expect(() => stationSecurityResolve(state, ctx, [uid], source, { [uid]: { damagePct: 1, defensePct: 0 } })).toThrow()
  })

  it('货仓弹药、维修件和备用机不流入共仓预算；主控星球/站点锁不阻断副船隔离战斗', () => {
    const state = stateOf(), uid = addShipToFleet(state, 'sh-hammerhead'), source = STATION_SECURITY_SOURCES[2]!.id
    fit(state, uid, ['mod-turret-kin-1', 'mod-hullrep-1', 'mod-drone-deck-1'])
    state.warehouse.items = { 'drone-scout': 1 }
    expect(adjustDroneLoad(state, ctx, 'drone-scout', 1, uid).ok).toBe(true)
    state.warehouse.items = { 'ammo-kinetic-l': 3, 'repairkit-mil': 1 }
    state.fleet[uid]!.durability = 0.2
    state.fleet[uid]!.armorPct = 0.1
    const expected = stationSecurityResolve(state, ctx, [uid], source)
    state.fleet[uid]!.cargo = { 'ammo-kinetic-l': 10000, 'repairkit-mil': 10000, 'drone-scout': 10000, 'min-tritanium': 9 }
    state.playerStation = createPlayerStationGame()
    state.playerStation.shipLocks[state.shipId] = 'population'
    state.playerStation.shipLocks[uid] = 'security'
    state.planetary = { planets: {}, deliveries: [{ shipUid: state.shipId } as NonNullable<NonNullable<GameState['planetary']>['deliveries']>[number]] }
    const before = structuredClone(state)
    expect(stationSecurityResolve(freezeTree(state), ctx, [uid], source)).toEqual(expected)
    expect(state).toEqual(before)
    expect(expected.ammoUsed!['ammo-kinetic-l'] ?? 0).toBeLessThanOrEqual(3)
    expect(expected.ammoUsed!['repairkit-mil'] ?? 0).toBeLessThanOrEqual(1)
    expect(expected.ammoUsed!['drone-scout'] ?? 0).toBe(0)
  })

  it('甲板战中复位按原引擎账本扣共仓备用机，不免费复位也不扣原机舱', () => {
    const state = stateOf(), uid = addShipToFleet(state, 'sh-sentinel'), source = STATION_SECURITY_SOURCES[2]!.id
    skillProfile(state, 5)
    fit(state, uid, ['mod-drone-deck-3'])
    state.warehouse.items = { 'drone-heavy': 4 }
    expect(adjustDroneLoad(state, ctx, 'drone-heavy', 4, uid).ok).toBe(true)
    state.warehouse.items = { 'drone-heavy': 3 }
    // 测试借现有高防空敌卡延长交火；正式来源表及敌卡一字不改。
    const card = ctx.anomalies.get('ink-flagship')!
    const anomalies = new Map(ctx.anomalies)
    anomalies.set(source, { ...card, id: source,
      ships: card.ships?.map(row => ({ ...row, ship: { ...row.ship, shotDmg: 0.2 } })) })
    const context = { ...ctx, anomalies }
    const direct = directBattle(state, [uid], source, context)
    const revived = Object.values(direct.battle.droneRevive ?? {}).reduce((sum, ledger) => sum + (ledger.v['drone-heavy'] ?? 0), 0)
    expect(revived).toBeGreaterThan(0)
    const before = structuredClone(state)
    const result = stationSecurityResolve(freezeTree(state), context, [uid], source)
    expect(result.ammoUsed!['drone-heavy']).toBe(revived)
    expect(revived).toBeLessThanOrEqual(3)
    expect(state).toEqual(before)
  })

  it('同型不同船员增量只作用对应实例，不修改正式表，伤害/防御参与逐拍计算', () => {
    const state = stateOf(), a = addShipToFleet(state, 'sh-falconet'), b = addShipToFleet(state, 'sh-falconet')
    fit(state, a, ['mod-turret-kin-1'])
    fit(state, b, ['mod-turret-kin-1'])
    state.warehouse.items = { 'ammo-kinetic-l': 200 }
    const source = STATION_SECURITY_SOURCES[2]!.id, before = structuredClone(state), def = structuredClone(ctx.ships.get('sh-falconet'))
    const base = stationSecurityResolve(state, ctx, [a, b], source)
    const boosted = stationSecurityResolve(state, ctx, [a, b], source, { [a]: { damagePct: 0.15, defensePct: 0.15 } })
    expect(boosted).not.toEqual(base)
    expect(state).toEqual(before)
    expect(ctx.ships.get('sh-falconet')).toEqual(def)
  })
})
