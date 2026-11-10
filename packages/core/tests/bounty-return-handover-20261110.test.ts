import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { changeShip, changeShipBlockReason } from '../src/shipyard'
import { startExpedition } from '../src/expedition/launch'
import { resolveBattleOutcome } from '../src/expedition/outcome'
import { advanceGame } from '../src/engine'
import { shipOperationBlockReason } from '../src/shipActionPolicy'
import { notePreparationSquad } from '../src/preparationSquads'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { finishDeparture } from './helpers/departure-ready'
import { checkAssignable, idleAiShipIds } from '../src/ai/cores'

const ctx = buildSimContext()
const reload = (state: ReturnType<typeof createInitialState>) => loadSaveFile(serializeSaveFile(state, 0)).state

function world(count: number) {
  const state = createInitialState({ nowWallMs: 0, seed: 1110 })
  state.modeChosen = true
  state.fleet = {}
  const old = Array.from({ length: count }, () => addShipToFleet(state, 'sh-shrike'))
  const next = addShipToFleet(state, 'sh-falconet')
  state.shipId = old[0]!
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  state.skills.trained = { 'fleet-command-basic': 5, 'fleet-command-coordination': 5, 'fleet-command-integration': 5 }
  notePreparationSquad(state, 'combat', old)
  expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
  finishDeparture(state, ctx)
  state.expedition.battle!.ended = 'me'
  resolveBattleOutcome(state, ctx)
  expect(state.expedition.phase).toBe('back')
  for (const [index, id] of old.entries()) state.fleet[id]!.cargo = { 'min-tritanium': index + 3 }
  state.fleet[next]!.cargo = { 'min-pyerite': 9 }
  const finishAt = state.expedition.finishAtGameMs
  return { state, old, next, finishAt }
}

describe('悬赏返航换驾驶后继续出击', () => {
  it.each([1, 2, 4])('%s舰返航与新悬赏独立推进，读档不提前卸货或解锁旧舰', count => {
    const { state, old, next, finishAt } = world(count)
    const warehouse = structuredClone(state.warehouse)
    const wallet = structuredClone(state.wallet)
    const cargo = old.map(id => structuredClone(state.fleet[id]!.cargo))
    expect(changeShipBlockReason(state, next, ctx)).toBeNull()
    expect(changeShip(state, next, ctx).ok).toBe(true)
    expect(state.expedition.active).toBe(false)
    expect(state.expedition.sortie).toBeUndefined()
    for (const id of old) expect(state.shipReturns[id]).toMatchObject({ reason: 'expedition', legMs: finishAt - state.gameMs, phaseAccMs: 0 })
    expect(state.warehouse).toEqual(warehouse)
    expect(state.wallet).toEqual(wallet)
    expect(notePreparationSquad(state, 'combat', [next])).toBe(true)
    const loaded = reload(reload(state))
    const returns = structuredClone(loaded.shipReturns)
    const beforeDeparture = loaded.gameMs
    expect(startExpedition(loaded, 'ano-abandoned-platform', ctx).ok).toBe(true)
    expect(loaded.shipReturns).toEqual(returns)
    finishDeparture(loaded, ctx)
    expect(loaded.expedition.sortie?.shipIds).toEqual([next])
    for (const id of old) expect(loaded.shipReturns[id]).toEqual({
      ...returns[id], phaseAccMs: returns[id]!.phaseAccMs + loaded.gameMs - beforeDeparture,
    })
    for (const [index, id] of old.entries()) {
      expect(loaded.fleet[id]!.cargo).toEqual(cargo[index])
      for (const operation of ['configure', 'repair', 'cargo'] as const)
        expect(shipOperationBlockReason(loaded, ctx, id, operation)).not.toBeNull()
      expect(idleAiShipIds(loaded)).not.toContain(id)
      expect(checkAssignable(loaded, id, 'basic', ctx).ok).toBe(false)
      expect(changeShip(loaded, id, ctx).ok).toBe(false)
    }
    const reloaded = reload(loaded)
    const remaining = reloaded.shipReturns[old[0]!]!.legMs - reloaded.shipReturns[old[0]!]!.phaseAccMs
    advanceGame(reloaded, remaining - 1, ctx, { freezeBattle: true })
    for (const id of old) expect(reloaded.shipReturns[id]).toBeDefined()
    const liveBattle = structuredClone(reloaded.expedition.battle)
    const nextCargo = structuredClone(reloaded.fleet[next]!.cargo)
    const beforeArrivalWallet = structuredClone(reloaded.wallet)
    const beforeArrivalWins = reloaded.firstStats?.bountyWins
    advanceGame(reloaded, 1, ctx, { freezeBattle: true })
    for (const id of old) {
      expect(reloaded.shipReturns[id]).toBeUndefined()
      expect(reloaded.fleet[id]!.cargo).toEqual({})
      expect(shipOperationBlockReason(reloaded, ctx, id, 'configure')).toBeNull()
    }
    expect(reloaded.fleet[next]!.cargo).toEqual(nextCargo)
    expect(reloaded.wallet).toEqual(beforeArrivalWallet)
    expect(reloaded.firstStats?.bountyWins).toBe(beforeArrivalWins)
    expect(reloaded.expedition.sortie?.shipIds).toEqual([next])
    expect(reloaded.expedition.battle?.startedAtGameMs).toBe(liveBattle!.startedAtGameMs + 1)
    expect(reloaded.warehouse.items['min-tritanium']).toBe((warehouse.items['min-tritanium'] ?? 0) + cargo.reduce((sum, row) => sum + row['min-tritanium']!, 0))
    const after = structuredClone(reloaded.warehouse)
    advanceGame(reloaded, 1000, ctx, { freezeBattle: true })
    expect(reloaded.warehouse).toEqual(after)
  })

  it('旧档只有主舰返航账与旧sortie时，立即出击也保留整队剩余航程', () => {
    const { state, old, next, finishAt } = world(2)
    const sortie = structuredClone(state.expedition.sortie!)
    state.shipId = next
    state.shipReturns[old[0]!] = { beltId: null, reason: 'expedition', legMs: finishAt - state.gameMs, phaseAccMs: 1700 }
    state.expedition.active = false
    state.expedition.battle = null
    state.expedition.anomalyId = null
    state.expedition.phase = 'out'
    state.expedition.finishAtGameMs = 0
    state.expedition.sortie = sortie
    notePreparationSquad(state, 'combat', [next])
    const loaded = reload(reload(state))
    const before = structuredClone(loaded)
    expect(startExpedition(loaded, 'missing-target', ctx).ok).toBe(false)
    expect(loaded).toEqual(before)
    expect(startExpedition(loaded, 'ano-abandoned-platform', ctx).ok).toBe(true)
    expect(loaded.shipReturns[old[0]!]!.phaseAccMs).toBe(1700)
    expect(loaded.shipReturns[old[1]!]).toEqual(loaded.shipReturns[old[0]!])
    expect(loaded.expedition.sortie?.shipIds).toEqual([next])
  })

  it('旧档先推进一拍再换队，整队返航保持同进度且不到港不卸货', () => {
    const { state, old, next, finishAt } = world(2)
    state.shipId = next
    state.shipReturns[old[0]!] = { beltId: null, reason: 'expedition', legMs: finishAt - state.gameMs, phaseAccMs: 1700 }
    state.expedition.active = false
    state.expedition.battle = null
    state.expedition.anomalyId = null
    state.expedition.phase = 'out'
    const loaded = reload(state)
    const warehouse = structuredClone(loaded.warehouse)
    advanceGame(loaded, 1000, ctx, { offline: true })
    expect(loaded.expedition.sortie).toBeUndefined()
    for (const id of old) {
      expect(loaded.shipReturns[id]!.phaseAccMs).toBe(2700)
      expect(shipOperationBlockReason(loaded, ctx, id, 'configure')).not.toBeNull()
    }
    expect(loaded.warehouse).toEqual(warehouse)
    expect(reload(loaded).shipReturns).toEqual(loaded.shipReturns)
  })

  it('未换船仍不能重开悬赏；显式带上返航僚舰仍拒绝且不改原状态', () => {
    const { state, old, next } = world(2)
    expect(startExpedition(state, 'ano-abandoned-platform', ctx).ok).toBe(false)
    expect(changeShip(state, next, ctx).ok).toBe(true)
    notePreparationSquad(state, 'combat', [next, old[1]!])
    const before = structuredClone(state)
    expect(startExpedition(state, 'ano-abandoned-platform', ctx).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('连续两次返航换队，各队按各自时刻到港，不覆盖上一队账本', () => {
    const { state, old, next } = world(2)
    const third = addShipToFleet(state, 'sh-falconet')
    expect(changeShip(state, next, ctx).ok).toBe(true)
    notePreparationSquad(state, 'combat', [next])
    expect(startExpedition(state, 'ano-abandoned-platform', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    state.expedition.battle!.ended = 'me'
    resolveBattleOutcome(state, ctx)
    state.fleet[next]!.cargo = { 'min-pyerite': 11 }
    const firstReturns = structuredClone(state.shipReturns)
    expect(changeShip(state, third, ctx).ok).toBe(true)
    for (const id of old) expect(state.shipReturns[id]).toEqual(firstReturns[id])
    expect(state.shipReturns[next]).toMatchObject({ reason: 'expedition', phaseAccMs: 0 })
    notePreparationSquad(state, 'combat', [third])
    const loaded = reload(reload(state))
    expect(startExpedition(loaded, 'ano-redring-raiders', ctx).ok).toBe(true)
    finishDeparture(loaded, ctx)
    const warehouse = structuredClone(loaded.warehouse)
    const firstLeft = loaded.shipReturns[old[0]!]!.legMs - loaded.shipReturns[old[0]!]!.phaseAccMs
    const secondLeft = loaded.shipReturns[next]!.legMs - loaded.shipReturns[next]!.phaseAccMs
    expect(secondLeft).toBeGreaterThan(firstLeft)
    advanceGame(loaded, firstLeft, ctx, { freezeBattle: true })
    for (const id of old) expect(loaded.shipReturns[id]).toBeUndefined()
    expect(loaded.shipReturns[next]).toBeDefined()
    expect(loaded.fleet[next]!.cargo).toEqual({ 'min-pyerite': 11 })
    expect(loaded.warehouse.items['min-tritanium']).toBe((warehouse.items['min-tritanium'] ?? 0) + 7)
    advanceGame(loaded, secondLeft - firstLeft, ctx, { freezeBattle: true })
    expect(loaded.shipReturns[next]).toBeUndefined()
    expect(loaded.fleet[next]!.cargo).toEqual({})
    expect(loaded.warehouse.items['min-pyerite']).toBe((warehouse.items['min-pyerite'] ?? 0) + 11)
    expect(loaded.expedition.sortie?.shipIds).toEqual([third])
    expect(loaded.expedition.battle).not.toBeNull()
  })

  it('原主舰沉没后幸存舰接任返航，换驾驶仍能派另一队且不重建沉船', () => {
    const { state, old, next } = world(3)
    delete state.fleet[old[0]!]
    state.shipId = old[1]!
    state.expedition.sortie!.leaderShipId = old[1]!
    expect(changeShip(state, next, ctx).ok).toBe(true)
    expect(state.shipReturns[old[0]!]).toBeUndefined()
    expect(state.shipReturns[old[1]!]).toBeDefined()
    expect(state.shipReturns[old[2]!]).toEqual(state.shipReturns[old[1]!])
    expect(state.expedition.sortie).toBeUndefined()
    notePreparationSquad(state, 'combat', [next])
    const loaded = reload(state)
    expect(startExpedition(loaded, 'ano-abandoned-platform', ctx).ok).toBe(true)
    expect(loaded.fleet[old[0]!]).toBeUndefined()
    expect(loaded.shipReturns[old[0]!]).toBeUndefined()
  })
})
