import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnterPrepared, wormholePreparationPlan } from '../src/wormholePreparation'
import { wormholeEventActions, wormholeEventPreview, wormholeResolveEvent } from '../src/wormholeExpedition'
import { gridCellAt, hasLiveFoe, hexDistance, revealOf, wormholeMakeGrid, type WormholeEventKey } from '../src/wormholeGrid'
import { wormholeGroundBoard } from '../src/wormholeGround'
import { wormholeTempStowPiece, wormholeSalvageAt } from '../src/wormholeSalvage'
import { wormholeCancelPatrol, wormholePatrolAfterAction, wormholePatrolDefeated, wormholeRaiseAlert } from '../src/wormholePatrol'
import { wormholeDescend, wormholeGridScan, wormholeGridTravel } from '../src/wormhole'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { advanceWormhole, battleFoeAnomaly, wormholeStartBattle, wormholeActivateAt } from '../src/wormholeBattle'
import { battleArcsFor } from '../src/combat'
import { setBattleDesire } from '../src/expedition'

const ctx = buildSimContext()
function setup(key: WormholeEventKey = 'maintenance') {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const uid = addShipToFleet(state, 'sh-thresher')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  const targets = { 'repairkit-mil': 100, 'ammo-kinetic-l': 1000 }
  Object.assign(state.warehouse.items, targets)
  const plan = wormholePreparationPlan(state, ctx, [uid], { targets, unload: [] })
  expect(wormholeEnterPrepared(state, ctx, [uid], 19, plan, undefined, { expeditionRules: 2 }).ok).toBe(true)
  const run = state.wormhole.run!
  const cell = gridCellAt(run.grid!, run.grid!.pos)!
  cell.place = 'empty'
  cell.eventKey = key
  cell.event = { supply: { ...run.expeditionSupplyPackage }, identity: 'genuine', intelKey: run.grid!.cells.find(c => c.key !== cell.key)!.key }
  run.pendingEvent = { key, cellKey: cell.key }
  return state
}
const roundtrip = (state: ReturnType<typeof setup>) => loadSaveFile(serializeSaveFile(loadSaveFile(serializeSaveFile(state, 0)).state, 0)).state

describe('第二批虫洞事件原子事务', () => {
  it('不允许将维护选项用在运输事件或注入运行时非法动作', () => {
    const state = setup('transport')
    const before = structuredClone(state)
    expect(wormholeEventActions(state)).toEqual(['supply', 'container', 'bypass'])
    expect(wormholeResolveEvent(state, ctx, 'repair').error).toBe('invalid-action')
    expect(wormholeResolveEvent(state, ctx, 'missing' as 'repair').error).toBe('invalid-action')
    expect(state).toEqual(before)
  })

  it('补给包落地后不能使用，装舱一次才记发现账，已解决事件不重复领取', () => {
    const state = setup('transport')
    const run = state.wormhole.run!
    const carried = { ...run.supplies!.items }
    const preview = wormholeEventPreview(state, ctx, 'supply')
    expect(preview.rewards['ammo-kinetic-l']).toBeGreaterThan(0)
    const before = structuredClone(state)
    expect(wormholeEventPreview(state, ctx, 'supply')).toEqual(preview)
    expect(state).toEqual(before)
    expect(wormholeResolveEvent(state, ctx, 'supply', preview).ok).toBe(true)
    const current = state.wormhole.run!
    expect(current.supplies!.items).toEqual(carried)
    expect(current.supplyPackagesTaken).toBe(1)
    expect(wormholeResolveEvent(state, ctx, 'container').error).toBe('not-ready')
    const loaded = roundtrip(state)
    expect(loaded.wormhole.run!.supplyPackagesTaken).toBe(1)
    expect(loaded.wormhole.run!.groundCargo).toEqual(current.groundCargo)
    const piece = wormholeGroundBoard(current)!.placements.find(p => p.itemId === 'ammo-kinetic-l')!
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(true)
    expect(current.supplies!.found['ammo-kinetic-l']).toBe(preview.rewards['ammo-kinetic-l'])
    expect(wormholeTempStowPiece(state, ctx, piece.id).ok).toBe(false)
  })

  it('整趟最多三包，免费离开在0回合仍可达且不消耗节拍', () => {
    const state = setup()
    state.wormhole.run!.supplyPackagesTaken = 3
    expect(wormholeEventPreview(state, ctx, 'search').error).toBe('packages-exhausted')
    state.wormhole.run!.turnsLeft = 0
    const before = structuredClone(state)
    expect(wormholeResolveEvent(state, ctx, 'bypass').ok).toBe(true)
    expect(state.wormhole.run!.turnsLeft).toBe(0)
    expect(state.wormhole.run!.patrolActionSeq).toBe(before.wormhole.run!.patrolActionSeq)
    expect(gridCellAt(state.wormhole.run!.grid!, state.wormhole.run!.grid!.pos)!.eventResolved).not.toBe(true)
  })

  it('费用不足、旧预览及不在当前地点都不扣货', () => {
    const state = setup()
    const preview = wormholeEventPreview(state, ctx, 'repair')
    state.wormhole.run!.turnsLeft -= 1
    const before = structuredClone(state)
    expect(wormholeResolveEvent(state, ctx, 'repair', preview).error).toBe('stale-plan')
    expect(state).toEqual(before)
    state.wormhole.run!.supplies!.items['repairkit-mil'] = 19
    expect(wormholeResolveEvent(state, ctx, 'repair').error).toBe('insufficient-supplies')
    state.wormhole.run!.pendingEvent!.cellKey = '999,999'
    expect(wormholeResolveEvent(state, ctx, 'search').error).toBe('no-event')
  })

  it('维护修复真实残甲和结构，费用恰好20，重载不能重修', () => {
    const state = setup()
    const ship = state.fleet[state.shipId]!
    ship.armorPct = 0.5; ship.durability = 0.9
    expect(wormholeResolveEvent(state, ctx, 'repair').ok).toBe(true)
    expect(state.fleet[state.shipId]).toMatchObject({ armorPct: 0.7, durability: 1 })
    expect(state.wormhole.run!.supplies!.consumed['repairkit-mil']).toBe(20)
    expect(wormholeResolveEvent(roundtrip(state), ctx, 'repair').error).toBe('not-ready')
  })

  it('控制器调查2回合只解除关联遗迹警报和一次可选守卫支援', () => {
    const state = setup('controller')
    const run = state.wormhole.run!
    const ruins = run.grid!.cells.find(c => c.key !== `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    ruins.place = 'ruins'
    gridCellAt(run.grid!, run.grid!.pos)!.event!.ruinsKey = ruins.key
    const before = run.turnsLeft
    expect(wormholeResolveEvent(state, ctx, 'investigate').ok).toBe(true)
    expect(state.wormhole.run!.turnsLeft).toBe(before - 2)
    expect(state.wormhole.run!.guardSupportDisabled).toBe(true)
    expect(roundtrip(state).wormhole.run!.grid!.cells.find(c => c.key === ruins.key)!.alarmDisabled).toBe(true)
  })

  it('核验求援只给身份，不发补给；真假身份在两轮读档不重掷', () => {
    const state = setup('distress')
    const cell = gridCellAt(state.wormhole.run!.grid!, state.wormhole.run!.grid!.pos)!
    cell.event!.identity = 'ambush'
    const before = structuredClone(state.wormhole.run!.supplies)
    expect(wormholeEventPreview(state, ctx, 'respond').identity).toBeUndefined()
    expect(wormholeEventPreview(state, ctx, 'respond').battle).toBe('possible')
    expect(wormholeResolveEvent(state, ctx, 'verify').ok).toBe(true)
    const loaded = roundtrip(state)
    expect(wormholeEventPreview(loaded, ctx, 'respond')).toMatchObject({ identity: 'ambush', battle: 'certain' })
    expect(loaded.wormhole.run!.supplies).toEqual(before)
    expect(wormholeResolveEvent(loaded, ctx, 'reject').ok).toBe(true)
  })

  it('伪装求援和强拆真实开战，未胜不算事件完成，战斗快照随档', () => {
    for (const event of ['distress', 'controller', 'relay'] as const) {
      const state = setup(event)
      const cell = gridCellAt(state.wormhole.run!.grid!, state.wormhole.run!.grid!.pos)!
      cell.event!.identity = 'ambush'
      const action = event === 'distress' ? 'respond' : 'force'
      expect(wormholeResolveEvent(state, ctx, action).ok).toBe(true)
      const run = state.wormhole.run!
      expect(run.battle?.wormhole?.expeditionRole).toBe('event')
      expect(gridCellAt(run.grid!, run.grid!.pos)!.eventResolved).not.toBe(true)
      expect(wormholeResolveEvent(state, ctx, 'bypass').error).toBe('not-ready')
      expect(roundtrip(state).wormhole.run!.battle!.wormhole).toEqual(run.battle!.wormhole)
    }
  })

  it('星云等待/穿越互斥，风暴代价只留下一场快照', () => {
    const state = setup('storm')
    expect(wormholeEventPreview(state, ctx, 'cross')).toMatchObject({ turns: 1, alertDelta: 1, rangeMul: 0.8 })
    expect(wormholeResolveEvent(state, ctx, 'cross').ok).toBe(true)
    expect(roundtrip(state).wormhole.run!.nextBattleRangeMul).toBe(0.8)
    expect(wormholeResolveEvent(state, ctx, 'wait').error).toBe('not-ready')
    const run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = 'ship'
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(run.nextBattleRangeMul).toBeUndefined()
    expect(run.battle!.wormhole!.desireRangeMul).toBe(0.8)
    const arcs = battleArcsFor(state, ctx, { battle: run.battle!, leaderShipId: run.fleet[0]!, anomaly: battleFoeAnomaly(state, ctx)! })!
    expect(arcs.desireMaxM).toBeCloseTo(arcs.maxM * 0.8)
    expect(setBattleDesire(state, 1e9, ctx).ok).toBe(true)
    expect(run.battle!.myDesireM).toBe(Math.round(arcs.desireMaxM))
  })
})

describe('第二批巡逻和地图隔离', () => {
  it('新探索异常缺供货标记读档后仍封闭，不连接母港补弹', () => {
    const state = setup()
    const run = state.wormhole.run!
    delete run.supplyVersion
    delete run.supplies
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = 'ship'; delete cell.eventKey; delete cell.event; delete run.pendingEvent
    state.warehouse.items['ammo-kinetic-l'] = 20_000
    const loaded = roundtrip(state)
    expect(loaded.wormhole.run!.supplyVersion).toBe(1)
    expect(wormholeStartBattle(loaded, ctx, 'node').ok).toBe(true)
    expect(loaded.wormhole.run!.battle!.expeditionAmmo).toBeTruthy()
    expect(loaded.wormhole.run!.battle!.ammo.kin).toBe(0)
    expect(loaded.warehouse.items['ammo-kinetic-l']).toBe(20_000)
  })

  it('换层不继承上一层已使用名额，新的两次阈值重新预告', () => {
    const state = setup()
    const run = state.wormhole.run!
    wormholeRaiseAlert(state, 4)
    run.grid!.pos = { ...run.grid!.exit }; run.bossCleared = 1
    expect(wormholeDescend(state, 21).ok).toBe(true)
    expect(run.patrols).toEqual([])
    expect(run.patrolsSpawned).toBe(0)
    wormholeRaiseAlert(state, 4)
    expect(run.patrols).toHaveLength(2)
    expect(run.patrols!.every(p => p.status === 'warning')).toBe(true)
  })

  it('未知规则打捞/激活也拒绝；首捞警报结构化回执且每地点仅一次', () => {
    const state = setup()
    const run = state.wormhole.run!
    state.fleet[state.shipId]!.fitted = { high: ['mod-salvager-1'], mid: [], low: [] }
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = 'ruins'; cell.piles = [{ itemId: 'wreck-rare-a-wh', units: 30 }, { itemId: 'wreck-rare-a-wh', units: 30 }]
    delete cell.eventKey; delete cell.event; delete run.pendingEvent
    run.expeditionRules = 99
    const before = structuredClone(state)
    expect(wormholeSalvageAt(state, ctx).code).toBe('unsupported-rules')
    expect(wormholeActivateAt(state, ctx).code).toBe('unsupported-rules')
    expect(state).toEqual(before)
    run.expeditionRules = 2
    expect(wormholeSalvageAt(state, ctx).alarm).toEqual({ alertLevel: 1 })
    expect(wormholeSalvageAt(state, ctx).alarm).toBeUndefined()
    expect(run.alertLevel).toBe(1)
    expect(run.pendingRuinsBattle).not.toBe(true)
  })

  it('中继胜利警戒下降与取消不重复清两支，重复结算不再次获益', () => {
    const state = setup('relay')
    wormholeRaiseAlert(state, 4)
    expect(wormholeResolveEvent(state, ctx, 'force').ok).toBe(true)
    const battle = state.wormhole.run!.battle!
    battle.ended = 'me'
    state.gameMs += 60_000
    advanceWormhole(state, ctx)
    expect(state.wormhole.run!.alertLevel).toBe(2)
    expect(state.wormhole.run!.patrols!.filter(p => p.status === 'cancelled')).toHaveLength(1)
    expect(state.wormhole.run!.guardSupportDisabled).toBe(true)
    const before = structuredClone(state)
    expect(wormholeResolveEvent(state, ctx, 'force').error).toBe('not-ready')
    expect(state).toEqual(before)
  })

  it('普通已胜地点不能再次直接开战；精英不继承守卫支援解除', () => {
    const state = setup()
    const run = state.wormhole.run!
    const cell = gridCellAt(run.grid!, run.grid!.pos)!
    cell.place = 'ship'; cell.elite = true; delete cell.eventKey; delete cell.event; delete run.pendingEvent
    run.guardSupportDisabled = true
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    expect(run.battle!.wormhole!.expeditionRole).toBe('elite')
    expect(run.battle!.wormhole!.guardSupportDisabled).toBeUndefined()
    run.battle!.ended = 'me'
    state.gameMs += 60_000
    advanceWormhole(state, ctx)
    const loaded = roundtrip(state)
    expect(wormholeStartBattle(loaded, ctx, 'node').ok).toBe(false)
  })
  it('两次动作预警，只有已揭露非当前位置/出口可进场，每两拍只走相邻一格', () => {
    const state = setup()
    const run = state.wormhole.run!
    delete run.pendingEvent
    run.patrols = []
    run.patrolActionSeq = 0
    run.patrolsSpawned = 0
    run.patrolsCleared = 0
    run.alertLevel = 0
    for (const cell of run.grid!.cells) { cell.place = 'empty'; delete cell.foe }
    run.grid!.scanned = run.grid!.cells.map(c => c.key)
    wormholeRaiseAlert(state, 2)
    expect(wormholePatrolAfterAction(state).spawned).toBe(false)
    expect(wormholePatrolAfterAction(state).spawned).toBe(true)
    const old = run.grid!.cells.find(hasLiveFoe)!
    expect(old.key).not.toBe(`${run.grid!.pos.q},${run.grid!.pos.r}`)
    expect(old.key).not.toBe(`${run.grid!.exit.q},${run.grid!.exit.r}`)
    expect(wormholePatrolAfterAction(state).moved).not.toBe(true)
    expect(wormholePatrolAfterAction(state).moved).toBe(true)
    const next = run.grid!.cells.find(hasLiveFoe)!
    expect(hexDistance(old, next)).toBe(1)
  })

  it('无合法可见格保持预兆；取消/击败仍占名额，不刷第三支', () => {
    const state = setup()
    const run = state.wormhole.run!
    wormholeRaiseAlert(state, 2)
    for (let n = 0; n < 4; n++) expect(wormholePatrolAfterAction(state).spawned).toBe(false)
    expect(run.patrols![0]!.status).toBe('warning')
    expect(wormholeCancelPatrol(run)).toBe(true)
    wormholeRaiseAlert(state, -2)
    wormholeRaiseAlert(state, 4)
    expect(run.patrols).toHaveLength(2)
    wormholePatrolDefeated(run, 1)
    wormholeRaiseAlert(state, -4)
    wormholeRaiseAlert(state, 6)
    for (let n = 0; n < 6; n++) expect(wormholePatrolAfterAction(state).spawned).toBe(false)
    expect(roundtrip(state).wormhole.run!.patrols).toEqual(run.patrols)
    expect(run.patrolsSpawned).toBe(2)
  })

  it('新地图半径2/3/4，事件不占保底/出口，精英从3层最多1个，旧盘无新内容', () => {
    for (const depth of [1, 2, 3, 4, 5, 10, 12]) for (let seed = 1; seed <= 20; seed++) {
      const grid = wormholeMakeGrid(seed, depth, 0, 1, 2)
      expect(grid.radius).toBe(depth <= 2 ? 2 : depth <= 4 ? 3 : 4)
      expect(grid.cells.filter(c => c.eventKey)).toHaveLength(2)
      expect(grid.cells.filter(c => c.elite)).toHaveLength(depth >= 3 ? 1 : 0)
      expect(grid.cells.filter(c => c.place === 'ship' && !c.elite).length).toBeLessThanOrEqual(depth <= 3 ? 2 : depth <= 6 ? 3 : 4)
      expect(grid.cells.filter(c => c.eventKey).every(c => c.key !== `${grid.exit.q},${grid.exit.r}` && c.key !== `${grid.start.q},${grid.start.r}`)).toBe(true)
      if (depth >= 3) expect(grid.cells.filter(c => c.place === 'ruins').length).toBeGreaterThanOrEqual(Math.min(5, 1 + Math.floor((depth - 1) / 2)))
    }
    expect(wormholeMakeGrid(19, 10).cells.some(c => c.eventKey || c.elite)).toBe(false)
  })

  it('首扫导航信号可发现，未读取不泄露出口；已扫描事件有模糊信号', () => {
    const state = setup()
    const run = state.wormhole.run!
    expect(wormholeGridScan(state).ok).toBe(true)
    const beacon = run.grid!.cells.find(c => c.place === 'beacon')!
    expect(revealOf(run.grid!, beacon)).toMatchObject({ kind: 'signal', signal: 'beacon' })
    expect(run.grid!.exitKnown).toBe(false)
    const event = run.grid!.cells.find(c => c.eventKey && c.key !== `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    run.grid!.scanned.push(event.key)
    expect(revealOf(run.grid!, event)).toMatchObject({ kind: 'signal', signal: 'radar' })
  })

  it('深入只重置本层状态，保留整趟物资/包额度和目标，未知规则读档后拒绝', () => {
    const state = setup()
    const run = state.wormhole.run!
    run.supplyPackagesTaken = 2
    run.guardSupportDisabled = true
    run.nextBattleRangeMul = 0.8
    run.grid!.pos = { ...run.grid!.exit }; run.bossCleared = 1
    const supplies = structuredClone(run.supplies)
    expect(wormholeDescend(state, 21).ok).toBe(true)
    expect(run.guardSupportDisabled).toBeUndefined()
    expect(run.nextBattleRangeMul).toBeUndefined()
    expect(run.pendingEvent).toBeUndefined()
    expect(run.patrols).toEqual([])
    expect(run.supplyPackagesTaken).toBe(2)
    expect(run.supplies).toEqual(supplies)
    run.expeditionRules = 99
    const loaded = roundtrip(state)
    expect(loaded.wormhole.run!.expeditionRules).toBe(99)
    const before = structuredClone(loaded)
    expect(wormholeGridScan(loaded).code).toBe('unsupported-rules')
    expect(wormholeGridTravel(loaded, run.grid!.exit).code).toBe('unsupported-rules')
    expect(loaded).toEqual(before)
  })

  it('暂停和时钟推进不增加巡逻节拍', () => {
    const state = setup()
    const run = state.wormhole.run!
    wormholeRaiseAlert(state, 4)
    const before = structuredClone(run.patrols)
    state.gameMs += 60_000
    advanceWormhole(state, ctx)
    expect(run.patrols).toEqual(before)
    expect(run.patrolActionSeq).toBe(0)
  })
})
