import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, type BattleState, type GameState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { wormholePreparationPlan, wormholeEnterPrepared } from '../src/wormholePreparation'
import { wormholeStartBattle, advanceWormhole } from '../src/wormholeBattle'
import { wormholeEnter } from '../src/wormhole'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { droneReviveNoteLoss, resolveDroneRevive } from '../src/droneRevive'

const ctx = buildSimContext()

function world(loads: Array<Record<string, number>>, reserve: Record<string, number> = {}, deck = false, legacy = false) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const fleet = loads.map(() => addShipToFleet(state, 'sh-thresher'))
  state.shipId = fleet[0]!
  for (const [i, uid] of fleet.entries()) {
    state.fleet[uid]!.fitted = { high: deck ? ['mod-drone-deck-3'] : [], mid: [], low: ['mod-drone-rack-3'] }
    state.fleet[uid]!.droneLoad = { ...loads[i]! }
  }
  state.warehouse.items = { 'drone-scout': 100, 'drone-assault': 100 }
  if (legacy) expect(wormholeEnter(state, ctx, fleet, 7).ok).toBe(true)
  else {
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: reserve, unload: [] })
    expect(plan.ok, JSON.stringify(plan)).toBe(true)
    expect(wormholeEnterPrepared(state, ctx, fleet, 7, plan).ok).toBe(true)
  }
  start(state)
  return { state, fleet, battle: state.wormhole.run!.battle! }
}

function start(state: GameState) {
  const run = state.wormhole.run!
  const cell = run.grid!.cells.find(c => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
  cell.place = 'ship'
  expect(wormholeStartBattle(state, ctx, 'node', state.gameMs).ok).toBe(true)
}

function loss(state: GameState, battle: BattleState, owner: string, id: string, n: number, atMs = 0) {
  const pools = Object.entries(battle.dronePools!).filter(([key, p]) => key.startsWith(`${owner}:`) && p.artId === id && p.alive)
  expect(pools.length).toBeGreaterThanOrEqual(n)
  for (const [key, p] of pools.slice(0, n)) {
    p.alive = false
    p.s = p.a = p.h = 0
    battle.droneLost ??= {}
    battle.droneLost[id] = (battle.droneLost[id] ?? 0) + 1
    battle.droneLostBy ??= {}
    const row = battle.droneLostBy[owner] ??= {}
    row[id] = (row[id] ?? 0) + 1
    droneReviveNoteLoss(state, battle, key, atMs)
  }
}

function finish(state: GameState, won = true) {
  const battle = state.wormhole.run!.battle!
  for (const unit of Object.values(battle.units)) if (unit.side === (won ? 'foe' : 'me')) unit.hp = { s: 0, a: 0, h: 0 }
  battle.ended = won ? 'me' : 'foe'
  state.gameMs += 60_000
  advanceWormhole(state, ctx)
}

describe('虫洞全队无人机战损报告', () => {
  it('首舰无损、僚舰损坏4回收1，战报和明细报告净损失3且实物扣账不变', () => {
    const { state, fleet, battle } = world([{}, { 'drone-scout': 4 }])
    const warehouse = structuredClone(state.warehouse.items)
    loss(state, battle, 'ally-1', 'drone-scout', 4)
    finish(state)
    expect(state.fleet[fleet[1]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
    expect(state.warehouse.items).toEqual(warehouse)
    expect(state.droneLossReport).toMatchObject({ total: 4, recovered: 1, gone: 3, rate: .2,
      battleStartedAtGameMs: battle.startedAtGameMs, rows: [{ id: 'drone-scout', lost: 4, back: 1, gone: 3 }] })
    expect(state.battleReport!.dronesGone).toBe(3)
    expect(state.logs.filter(log => log.textId === 'core.whExpedition.001').map(log => log.textParams))
      .toEqual([{ p1: 4, p2: 1, p3: 3 }])
    const after = structuredClone({ fleet: state.fleet, supplies: state.wormhole.run!.supplies, report: state.droneLossReport })
    advanceWormhole(state, ctx)
    expect({ fleet: state.fleet, supplies: state.wormhole.run!.supplies, report: state.droneLossReport }).toEqual(after)
  })

  it('多舰同型相加并混合机型按价值排序；回收名额仍逐舰计算', () => {
    const { state, fleet, battle } = world([{ 'drone-scout': 3, 'drone-assault': 1 }, { 'drone-scout': 4 }])
    loss(state, battle, 'player', 'drone-scout', 3)
    loss(state, battle, 'player', 'drone-assault', 1)
    loss(state, battle, 'ally-1', 'drone-scout', 4)
    finish(state)
    expect(state.droneLossReport).toMatchObject({ total: 8, recovered: 2, gone: 6, survivors: 2 })
    expect(state.droneLossReport!.rows).toEqual([
      expect.objectContaining({ id: 'drone-assault', lost: 1, back: 1, gone: 0 }),
      expect.objectContaining({ id: 'drone-scout', lost: 7, back: 1, gone: 6 }),
    ])
    expect(state.fleet[fleet[0]!]!.droneLoad).toEqual({ 'drone-assault': 1 })
    expect(state.fleet[fleet[1]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
    expect(state.battleReport!.dronesGone).toBe(6)
  })

  it('三舰各损坏1架逐舰向上取整回收，汇总只相加不再取整', () => {
    const { state, fleet, battle } = world(Array.from({ length: 3 }, () => ({ 'drone-scout': 1 })))
    for (const tag of ['player', 'ally-1', 'ally-2']) loss(state, battle, tag, 'drone-scout', 1)
    finish(state)
    expect(state.droneLossReport).toMatchObject({ total: 3, recovered: 3, gone: 0 })
    for (const uid of fleet) expect(state.fleet[uid]!.droneLoad?.['drone-scout'] ?? 0).toBe(1)
    expect(state.battleReport!.dronesGone).toBe(0)
  })

  it('僚舰备用复位后再次损坏，重载与不中断收场的报告及库存一致', () => {
    const { state, fleet, battle } = world([{}, { 'drone-scout': 1 }], { 'drone-scout': 2 }, true)
    loss(state, battle, 'ally-1', 'drone-scout', 1)
    resolveDroneRevive(state, ctx, battle, 9000)
    loss(state, battle, 'ally-1', 'drone-scout', 1, 10000)
    expect(battle.droneRevive!['ally-1']!.v['drone-scout']).toBe(1)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    for (const current of [state, loaded]) {
      finish(current)
      expect(current.droneLossReport).toMatchObject({ total: 2, recovered: 1, gone: 1, revived: 1 })
      expect(current.battleReport!.dronesGone).toBe(1)
      expect(current.fleet[fleet[1]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
      expect(current.wormhole.run!.supplies!.items['drone-scout'] ?? 0).toBe(1)
      expect(current.warehouse.items['drone-scout']).toBe(98)
    }
    expect(loaded.droneLossReport).toEqual(state.droneLossReport)
    expect(loaded.wormhole.run!.supplies).toEqual(state.wormhole.run!.supplies)
  })

  it('当前驾驶船不在虫洞编队里，旧趟僚舰损失也能进入本场报告', () => {
    const { state, fleet, battle } = world([{}, { 'drone-scout': 4 }], {}, false, true)
    state.shipId = 'sandcat'
    loss(state, battle, 'ally-1', 'drone-scout', 4)
    finish(state)
    expect(state.droneLossReport).toMatchObject({ total: 4, recovered: 1, gone: 3 })
    expect(state.battleReport!.dronesGone).toBe(3)
    expect(state.fleet[fleet[1]!]!.droneLoad).toEqual({ 'drone-scout': 4 })
    expect(state.warehouse.items['drone-scout']).toBe(97)
  })

  it('下一场无损与全损场不复用旧报告，不给战败补回库存', () => {
    const { state, battle } = world([{}, { 'drone-scout': 4 }])
    loss(state, battle, 'ally-1', 'drone-scout', 4)
    finish(state)
    expect(state.droneLossReport!.gone).toBe(3)
    start(state)
    // 同时刻旧报告也不应被无损收口沿用。
    state.droneLossReport!.battleStartedAtGameMs = state.wormhole.run!.battle!.startedAtGameMs
    finish(state)
    expect(state.droneLossReport).toBeNull()
    expect(state.battleReport!.dronesGone).toBe(0)
    start(state)
    const warehouse = structuredClone(state.warehouse.items)
    finish(state, false)
    expect(state.wormhole.run).toBeNull()
    expect(state.warehouse.items).toEqual(warehouse)
    expect(state.droneLossReport).toBeNull()
  })

  it('首舰沉没、僚舰存活仍汇总僚舰损失，沉舰机体不回收到本趟库存', () => {
    const { state, fleet, battle } = world([{ 'drone-scout': 4 }, { 'drone-scout': 4 }])
    loss(state, battle, 'player', 'drone-scout', 4)
    loss(state, battle, 'ally-1', 'drone-scout', 4)
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }
    finish(state)
    expect(state.fleet[fleet[0]!]).toBeUndefined()
    expect(state.wormhole.run!.fleet).toEqual([fleet[1]])
    expect(state.fleet[fleet[1]!]!.droneLoad).toEqual({ 'drone-scout': 1 })
    expect(state.wormhole.run!.supplies!.items['drone-scout'] ?? 0).toBe(0)
    expect(state.droneLossReport).toMatchObject({ total: 4, recovered: 1, gone: 3 })
    expect(state.battleReport!.dronesGone).toBe(3)
  })

  it('旧战斗只有无人机合计账，仍仅按首舰结算一次并报告', () => {
    const { state, fleet, battle } = world([{ 'drone-scout': 4 }, {}], {}, false, true)
    loss(state, battle, 'player', 'drone-scout', 4)
    delete battle.droneLostBy
    finish(state)
    expect(state.droneLossReport).toMatchObject({ total: 4, recovered: 1, gone: 3 })
    expect(state.battleReport!.dronesGone).toBe(3)
    expect(state.fleet[fleet[0]!]!.droneLoad).toEqual({ 'drone-scout': 4 })
    expect(state.warehouse.items['drone-scout']).toBe(97)
    expect(state.logs.filter(log => log.text.includes('机群战损'))).toHaveLength(1)
  })
})
