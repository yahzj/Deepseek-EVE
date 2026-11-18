import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, type BattleState } from '../src/state'
import type { CommandResult } from '../src/engine'
import { startBattleFor } from '../src/combat'
import { gameSaveMethods } from './helpers/save-shell'
import type { saveBattleFleetRange } from '../src/fleetRange'

const ctx = buildSimContext()
function shell() {
  const state = createInitialState({ nowWallMs: 0, seed: 1118 })
  const battle = startBattleFor(structuredClone(state), ctx, state.shipId, 'ano-training')!
  const save = vi.fn((..._args: Parameters<typeof saveBattleFleetRange>): CommandResult => ({ ok: true }))
  const notify = vi.fn(), persist = vi.fn(() => Promise.resolve())
  const engine = gameSaveMethods(['battleFleetRangeSave'], { saveBattleFleetRange: save }) as unknown as {
    battleFleetRangeSave(battle: BattleState | null | undefined): CommandResult
  }
  Object.assign(engine, { state, ctx, notify, persist })
  return { state, battle, save, notify, persist, engine }
}

describe('界面保存编队距离绑定实际活动宿主', () => {
  it.each(['expedition', 'encounter', 'wormhole'] as const)('%s只保存传入的实际对象，不另选其他同时存在的战斗', host => {
    const { state, battle, save, engine, notify, persist } = shell()
    state.expedition.active = true
    state.expedition.battle = host === 'expedition' ? battle : structuredClone(battle)
    state.encounter.active = true
    state.encounter.battle = host === 'encounter' ? battle : structuredClone(battle)
    state.wormhole.run = { battle: host === 'wormhole' ? battle : structuredClone(battle) } as NonNullable<typeof state.wormhole.run>
    expect(engine.battleFleetRangeSave(battle).ok).toBe(true)
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(state, ctx, battle)
    expect(save.mock.calls[0]![2]).toBe(battle)
    expect(notify).toHaveBeenCalledOnce()
    expect(persist).toHaveBeenCalledOnce()
  })

  it.each(['undefined', 'null', 'clone', 'replaced', 'ended', 'expedition-inactive', 'encounter-inactive', 'wormhole-removed'] as const)('%s对象拒绝，不调用core、不通知或保存', kind => {
    const { state, battle, save, engine, notify, persist } = shell()
    state.expedition.active = true
    state.expedition.battle = battle
    let argument: BattleState | null | undefined = battle
    if (kind === 'undefined') argument = undefined
    if (kind === 'null') argument = null
    if (kind === 'clone') argument = structuredClone(battle)
    if (kind === 'replaced') state.expedition.battle = structuredClone(battle)
    if (kind === 'ended') battle.ended = 'me'
    if (kind === 'expedition-inactive') state.expedition.active = false
    if (kind === 'encounter-inactive') {
      state.expedition.battle = null
      state.encounter.battle = battle
      state.encounter.active = false
    }
    if (kind === 'wormhole-removed') state.expedition.battle = null
    const before = structuredClone(state)
    expect(engine.battleFleetRangeSave(argument)).toMatchObject({ ok: false, errorId: 'core.fleetRange.002' })
    expect(save).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    expect(state).toEqual(before)
  })

  it('实际宿主有效但core绑定拒绝时，不报告保存成功', () => {
    const { state, battle, save, engine, notify, persist } = shell()
    state.encounter.active = true
    state.encounter.battle = battle
    save.mockReturnValue({ ok: false, errorId: 'core.fleetRange.002' })
    expect(engine.battleFleetRangeSave(battle).ok).toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
  })
})
