import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { cleanPreparationSquads, notePreparationSquad, preparationSquadOf, PREPARATION_SQUAD_KINDS } from '../src/preparationSquads'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendPrepSquadOf } from '../src/weekendLaunch'
import { wormholeAutoStart, wormholeAutoMainHandover } from '../src/wormholeAuto'
import { wormholePreparationPlan } from '../src/wormholePreparation'

const ctx = buildSimContext()
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const ships = Array.from({ length: 5 }, () => addShipToFleet(state, 'sh-thresher'))
  state.skills.trained['ai-expert'] = 2
  state.wormholeStock = [{ id: 'auto-memory', seed: 19, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0 }]
  return { state, ships }
}

describe('五类准备阵容随档记忆', () => {
  it('各类独立保留实例及顺序，去重并截上限，更新不启动任务或改主控', () => {
    const { state, ships } = world()
    const before = structuredClone(state)
    for (const [index, kind] of PREPARATION_SQUAD_KINDS.entries()) {
      const ordered = [ships[index]!, ...ships.filter(id => id !== ships[index])]
      expect(notePreparationSquad(state, kind, [ordered[0]!, ...ordered])).toBe(true)
      expect(preparationSquadOf(state, kind)).toEqual(ordered.slice(0, 4))
      expect(notePreparationSquad(state, kind, ordered.slice(0, 4))).toBe(false)
    }
    const { preparationSquads: _memory, ...rest } = state
    expect(rest).toEqual(before)
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.preparationSquads).toEqual(state.preparationSquads)
    expect(loadSaveFile(serializeSaveFile(loaded, 0)).state.preparationSquads).toEqual(state.preparationSquads)
  })

  it('明确空不走默认，缺船全失效也不自动补位，忙船不丢', () => {
    const { state, ships } = world()
    expect(preparationSquadOf(state, 'signal-auto', ships)).toEqual(ships.slice(0, 4))
    notePreparationSquad(state, 'signal-auto', [])
    expect(preparationSquadOf(state, 'signal-auto', ships)).toEqual([])
    expect(loadSaveFile(serializeSaveFile(state, 0)).state.preparationSquads?.['signal-auto']).toEqual([])
    notePreparationSquad(state, 'wormhole-auto', [state.shipId, ships[0]!])
    state.standby = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: 1000, legMs: 0 }
    expect(preparationSquadOf(state, 'wormhole-auto', ships)).toEqual([state.shipId, ships[0]!])
    delete state.fleet[ships[0]!]
    expect(preparationSquadOf(state, 'wormhole-auto', ships)).toEqual([state.shipId])
    delete state.fleet[state.shipId]
    expect(preparationSquadOf(state, 'wormhole-auto', ships)).toEqual([])
  })

  it('清洗拒绝假空和未知类型，合法空数组往返，旧档无字段不新增', () => {
    expect(cleanPreparationSquads({ 'signal-auto': [], 'wormhole-auto': [null, '', 3], weekend: ['a', 'a', 'b'], other: ['c'] }))
      .toEqual({ 'signal-auto': [], weekend: ['a', 'b'] })
    for (const value of [null, 3, [], { weekend: 'x' }, { weekend: [null] }]) expect(cleanPreparationSquads(value)).toBeUndefined()
    const { state } = world()
    expect(loadSaveFile(serializeSaveFile(state, 0)).state).not.toHaveProperty('preparationSquads')
  })

  it('旧旗舰阵容仍默认恢复，新分类记忆优先且空不被旧值覆盖', () => {
    const { state, ships } = world()
    state.weekendPrepSquad = [ships[1]!, ships[0]!]
    expect(weekendPrepSquadOf(state)).toEqual(state.weekendPrepSquad)
    notePreparationSquad(state, 'weekend', [ships[2]!])
    expect(weekendPrepSquadOf(state)).toEqual([ships[2]!])
    notePreparationSquad(state, 'weekend', [])
    expect(weekendPrepSquadOf(state)).toEqual([])
  })
})

describe('主控工作时自动队伍出发', () => {
  it.each(['legacy', 'prepared'] as const)('%s只派副船时主控忙态和主控身份不变', mode => {
    const { state, ships } = world()
    state.standby = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: 1000, legMs: 0 }
    const pilot = state.shipId
    const activity = structuredClone(state.standby)
    const fleet = ships.slice(0, 2)
    expect(wormholeAutoMainHandover(state, ctx, fleet)).toEqual({ needed: false })
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: {}, unload: [] }, { automatic: true })
    expect(wormholeAutoStart(state, ctx, 'auto-memory', fleet,
      mode === 'prepared' ? { prepared: plan, confirmLossRisk: true } : undefined).ok).toBe(true)
    expect(state.standby).toEqual(activity)
    expect(state.shipId).toBe(pilot)
    expect(state.wormhole.run).toBeNull()
    expect(state.wormholeAuto![0]!.shipIds).toEqual(fleet)
  })

  it('忙碌主控真加入时仍拒绝，不消费通道和物资', () => {
    const { state, ships } = world()
    state.standby = { active: true, galaxyId: 'galaxy-hub', finishAtGameMs: 1000, legMs: 0 }
    const fleet = [state.shipId, ships[0]!]
    const plan = wormholePreparationPlan(state, ctx, fleet, { targets: {}, unload: [] }, { automatic: true })
    const before = structuredClone(state)
    expect(wormholeAutoStart(state, ctx, 'auto-memory', fleet, { prepared: plan, confirmLossRisk: true }).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('自动预览忽略未参队主控作业进度，真实舰船/库存变化仍拒绝旧预览', () => {
    for (const change of ['pilot-progress', 'cargo', 'warehouse'] as const) {
      const { state, ships } = world()
      const fleet = ships.slice(0, 2)
      state.mining.active = true
      state.mining.cycleAccMs = 10
      const request = { targets: {}, unload: [] }
      const plan = wormholePreparationPlan(state, ctx, fleet, request, { automatic: true })
      const manual = wormholePreparationPlan(state, ctx, fleet, request)
      state.mining.cycleAccMs = 11
      if (change === 'cargo') state.fleet[fleet[0]!]!.cargo['ore-olivine'] = 1
      if (change === 'warehouse') state.warehouse.items['ore-olivine'] = 1
      expect(wormholePreparationPlan(state, ctx, fleet, request).fingerprint).not.toBe(manual.fingerprint)
      const before = structuredClone(state)
      const result = wormholeAutoStart(state, ctx, 'auto-memory', fleet, { prepared: plan, confirmLossRisk: true })
      expect(result.ok).toBe(change === 'pilot-progress')
      if (!result.ok) expect(state).toEqual(before)
      else expect(state.mining).toEqual(before.mining)
    }
  })
})
