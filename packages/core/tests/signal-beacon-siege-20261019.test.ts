import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { wormholeEnter } from '../src/wormhole'
import { advanceWormhole, wormholeActivateAt, wormholeTravelTo } from '../src/wormholeBattle'
import { hasLiveFoe, spawnTargetsOf } from '../src/wormholeGrid'
import { wormholeSpawnAfterTurns } from '../src/wormholeSpawn'
import { makeHoldState } from '../src/wormholeHold'
import { wormholeCollectOreAt, wormholeEnsureArrivalPiles, wormholeSalvageAt } from '../src/wormholeSalvage'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { WormholeGridCell } from '../src/wormholeGrid'

const ctx = buildSimContext()
function world(depth: number) {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'sh-thresher')
  state.shipId = uid
  expect(wormholeEnter(state, ctx, [uid], 7).ok).toBe(true)
  const run = state.wormhole.run!
  run.depth = depth
  run.family = 'A'
  run.turnsLeft = 30
  run.turnsTotal = 30
  state.wormhole.noCommonWreckSalvage = true
  const beacon: WormholeGridCell = { key: '1,0', q: 1, r: 0, place: 'beacon', foe: { card: 'wh-pirate-scout', seq: 1 } }
  run.grid = {
    radius: 2, start: { q: 0, r: 0 }, pos: { q: 0, r: 0 }, exit: { q: 2, r: 0 }, scanRadius: 1,
    scanned: ['0,0', '1,0'], visited: ['0,0'], activated: [], spawnSeq: 1,
    cells: [{ key: '0,0', q: 0, r: 0, place: 'empty' }, beacon, { key: '2,0', q: 2, r: 0, place: 'empty' }],
  }
  return { state, run, beacon }
}

function worldWithPlace(place: WormholeGridCell['place']) {
  const made = world(7)
  made.beacon.place = place
  made.state.wormhole.noCommonWreckSalvage = false
  made.state.fleet[made.state.shipId]!.fitted = { high: ['mod-miner-1', 'mod-salvager-1'], mid: [], low: [] }
  wormholeEnsureArrivalPiles(made.state, ctx)
  return made
}

function winCoveredCell(state: ReturnType<typeof world>['state'], run: ReturnType<typeof world>['run']) {
  const travel = wormholeTravelTo(state, ctx, { q: 1, r: 0 }, { confirmIntercept: true })
  expect(travel.ok, travel.error).toBe(true)
  const battle = run.battle!
  for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
  battle.ended = 'me'
  run.attending = true
  state.gameMs = battle.lastTickGameMs + ctx.balance.battle.killcamMs + 1
  advanceWormhole(state, ctx)
  expect(run.battle).toBeFalsy()
  run.tempGrid = makeHoldState(4)
}

describe('信标围剿收口与不重刷', () => {
  it.each([7, 8])('第%s层战胜覆盖信标的围剿后，信标效果应可在本格触发', depth => {
    const { state, run, beacon } = world(depth)
    const travel = wormholeTravelTo(state, ctx, { q: 1, r: 0 }, { confirmIntercept: true })
    expect(travel.ok).toBe(true)
    expect(run.battle!.wormhole!.kind).toBe('spawn')
    expect(run.grid!.exitKnown ?? false).toBe(false)
    const battle = run.battle!
    // 胜负由夹具指定，仅排除战力；移动、战后结算及信标操作均走正式入口。
    for (const unit of Object.values(battle.units)) if (unit.side === 'foe') unit.hp = { s: 0, a: 0, h: 0 }
    battle.ended = 'me'
    run.attending = true
    state.gameMs = battle.lastTickGameMs + ctx.balance.battle.killcamMs + 1
    advanceWormhole(state, ctx)
    expect(run.battle).toBeFalsy()
    expect(hasLiveFoe(beacon)).toBe(false)
    run.tempGrid = makeHoldState(4)
    const activate = wormholeActivateAt(state, ctx)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state.wormhole.run!
    console.log('[信标核查]', { depth, cleared: beacon.foe?.cleared, activated: run.grid!.activated,
      exitKnown: run.grid!.exitKnown ?? false, activate, reloadExitKnown: back.grid!.exitKnown ?? false })
    expect(run.grid!.exitKnown, '胜利后信标自动生效，或本格激活成功后应能读出入口').toBe(true)
  })

  it('已清围剿格不再进入本层围剿候选', () => {
    const { state, run, beacon } = world(7)
    run.grid!.cells = [beacon, { key: '2,0', q: 2, r: 0, place: 'empty' }]
    run.grid!.pos = { q: 1, r: 0 }
    beacon.foe!.cleared = true
    expect(spawnTargetsOf(run.grid!)).not.toContain(beacon)
    const result = wormholeSpawnAfterTurns(state, 1)
    console.log('[围剿重占核查]', result)
    expect(result.spawned).toBe(0)
    expect(result.ambush).toBe(false)
    expect(hasLiveFoe(beacon)).toBe(false)
  })

  it.each(['vein', 'graveyard', 'ruins', 'matter', 'ship', 'empty'] as const)('其他原地点%s不复现信标死锁', place => {
    const { state, run, beacon } = worldWithPlace(place)
    winCoveredCell(state, run)
    expect(hasLiveFoe(beacon)).toBe(false)
    if (place === 'vein') {
      expect(wormholeCollectOreAt(state, ctx).ok).toBe(true)
    } else if (place === 'graveyard' || place === 'ruins') {
      expect(wormholeSalvageAt(state, ctx).ok).toBe(true)
    } else if (place === 'matter') {
      expect(wormholeActivateAt(state, ctx).ok).toBe(true)
    } else if (place === 'ship') {
      expect(wormholeActivateAt(state, ctx)).toMatchObject({ ok: true, started: 'node' })
    } else {
      expect(wormholeActivateAt(state, ctx)).toMatchObject({ ok: false })
    }
  })
})
