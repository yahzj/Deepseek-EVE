import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { commandBudgetOf } from '../src/combat/command/rules'
import { startExpedition } from '../src/expedition/launch'
import { retreatBattle } from '../src/expedition/retreat'
import { injectCommandFleetAllShipsFixture, assertCommandFleetAllShipsFixture } from '../../../tools/command-fleet-all-ships-fixture'

const ctx = buildSimContext()
function fixture() {
  const state = createInitialState({ nowWallMs: 0, seed: 20261031 })
  injectCommandFleetAllShipsFixture(state)
  return loadSaveFile(serializeSaveFile(state, 0)).state
}

describe('满技能全舰船编队验收档', () => {
  it('全部船型、满级技能、合法装配与十二舰名单往返无损', () => {
    const state = fixture()
    assertCommandFleetAllShipsFixture(state, ctx)
    expect(Object.keys(state.fleet)).toHaveLength(51)
    expect(commandBudgetOf(state, ctx, state.preparationSquads!.combat!)).toMatchObject({ ok: true, cost: 122, capacity: 125 })
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.fleet).toEqual(state.fleet)
    expect(back.skills.trained).toEqual(state.skills.trained)
    expect(back.preparationSquads).toEqual(state.preparationSquads)
  })

  it('正式出击带齐十二舰，战中读档保留逐舰编成，可撤退', () => {
    const state = fixture()
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    expect(state.expedition.battle!.myFleet).toHaveLength(12)
    const back = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(back.expedition.sortie!.shipIds).toEqual(state.preparationSquads!.combat)
    expect(back.expedition.battle!.myFleet).toHaveLength(12)
    expect(retreatBattle(back, ctx).ok).toBe(true)
  })

  it('可改选旗舰、战列、指挥、后勤与电子舰合法混编', () => {
    const state = fixture()
    const ids = ['sh-dunkleosteus', 'sh-megalodon', 'sh-wh-d-destroyer', 'sh-wh-g-destroyer', 'sh-wh-a-frigate']
    expect(commandBudgetOf(state, ctx, ids)).toMatchObject({ ok: true, cost: 124, capacity: 125 })
    state.shipId = ids[0]!
    state.preparationSquads = { combat: ids }
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    expect(state.expedition.battle!.myFleet).toHaveLength(5)
  })
})
