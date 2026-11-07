import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { applyFleetPreset, cleanFleetPresets, deleteFleetPreset, FLEET_PRESET_MAX, renameFleetPreset, saveFleetPreset } from '../src/fleetPresets'
import { combatRosterOf } from '../src/combat/command/roster'
import { COMMAND_SKILLS } from '../src/combat/command/rules'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
function world() {
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  state.fleet = {}
  const ids = Array.from({ length: 3 }, () => addShipToFleet(state, 'sh-shrike'))
  state.shipId = ids[0]!
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  for (const skill of COMMAND_SKILLS) state.skills.trained[skill.id] = 5
  state.preparationSquads = { combat: [ids[0]!, ids[2]!, ids[1]!], weekend: [ids[1]!] }
  return { state, ids }
}

describe('我的舰队多套预设', () => {
  it('保存主控与实例顺序，套用不更改装配、无人机、货仓和其他准备队伍', () => {
    const { state, ids } = world()
    const ships = structuredClone(state.fleet)
    expect(saveFleetPreset(state, ctx, 'Alpha').ok).toBe(true)
    expect(state.fleetPresets![0]!.shipIds).toEqual([ids[0], ids[2], ids[1]])
    state.shipId = ids[1]!
    state.preparationSquads!.combat = [ids[1]!]
    expect(applyFleetPreset(state, ctx, 'fleet-1').ok).toBe(true)
    expect(state.shipId).toBe(ids[0])
    expect(combatRosterOf(state)).toEqual([ids[0], ids[2], ids[1]])
    expect(state.fleet).toEqual(ships)
    expect(state.preparationSquads!.weekend).toEqual([ids[1]])
  })

  it('上限10套、名称去空白、重名和空名拒绝；覆盖保留ID和位置', () => {
    const { state, ids } = world()
    for (let i = 0; i < FLEET_PRESET_MAX; i++) expect(saveFleetPreset(state, ctx, `  preset-${i} `).ok).toBe(true)
    expect(saveFleetPreset(state, ctx, 'extra').ok).toBe(false)
    expect(saveFleetPreset(state, ctx, 'preset-0').ok).toBe(false)
    expect(saveFleetPreset(state, ctx, ' ').ok).toBe(false)
    state.preparationSquads!.combat = [ids[0]!]
    expect(saveFleetPreset(state, ctx, 'renamed', 'fleet-1').ok).toBe(true)
    expect(state.fleetPresets).toHaveLength(10)
    expect(state.fleetPresets![0]).toEqual({ id: 'fleet-1', name: 'renamed', leaderShipId: ids[0], shipIds: [ids[0]] })
    expect(saveFleetPreset(state, ctx, 'bad', 'missing').ok).toBe(false)
  })

  it('重命名不改变预设内容，删除最后一套后省略字段', () => {
    const { state } = world()
    saveFleetPreset(state, ctx, 'one')
    saveFleetPreset(state, ctx, 'two')
    const ids = [...state.fleetPresets![0]!.shipIds]
    expect(renameFleetPreset(state, 'fleet-1', 'two').ok).toBe(false)
    expect(renameFleetPreset(state, 'fleet-1', ' ').ok).toBe(false)
    expect(renameFleetPreset(state, 'fleet-1', 'new').ok).toBe(true)
    expect(state.fleetPresets![0]!.shipIds).toEqual(ids)
    expect(deleteFleetPreset(state, 'none').ok).toBe(false)
    expect(deleteFleetPreset(state, 'fleet-1').ok).toBe(true)
    expect(deleteFleetPreset(state, 'fleet-2').ok).toBe(true)
    expect(state.fleetPresets).toBeUndefined()
  })

  it('出勤期间不能新增或覆盖预设，已有预设与编队不变', () => {
    const { state } = world()
    expect(saveFleetPreset(state, ctx, 'one').ok).toBe(true)
    state.mining.active = true
    const before = structuredClone(state)
    expect(saveFleetPreset(state, ctx, 'two').ok).toBe(false)
    expect(saveFleetPreset(state, ctx, 'one', 'fleet-1').ok).toBe(false)
    expect(state).toEqual(before)
  })

  it.each(['missing', 'ai', 'returning', 'budget', 'standing', 'active', 'away', 'departure', 'scan'] as const)('%s拒绝时整份状态不变，不换主控、不召回AI、不缩编', reason => {
    const { state, ids } = world()
    saveFleetPreset(state, ctx, 'one')
    state.shipId = ids[1]!
    state.preparationSquads!.combat = [ids[1]!]
    if (reason === 'missing') delete state.fleet[ids[2]!]
    if (reason === 'ai') state.aiAssignments[ids[0]!] = { coreType: 'basic', startedAtGameMs: 0, task: { kind: 'standby', galaxyId: 'galaxy-hub', phase: 'stand', finishAtGameMs: 0, outMs: 1 } }
    if (reason === 'returning') state.shipReturns[ids[2]!] = { beltId: null, legMs: 1000, phaseAccMs: 0, reason: 'expedition' }
    if (reason === 'budget') { state.skills.trained = {}; for (const uid of ids) state.fleet[uid]!.defId = 'sh-megalodon' }
    if (reason === 'standing') { state.standings.dsi = 0; state.standingsEarned = {} }
    if (reason === 'active') state.mining.active = true
    if (reason === 'away') state.awayGalaxy = 'galaxy-kor'
    if (reason === 'departure') state.departure = { shipId: state.shipId, undockMs: 1000, progressMs: 0 } as NonNullable<typeof state.departure>
    if (reason === 'scan') state.wormholeScan = { active: true, progressMs: 0 }
    const before = structuredClone(state)
    expect(applyFleetPreset(state, ctx, 'fleet-1').ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('保存快照不与当前编队共用数组，双轮往返保留缺失实例便于提示', () => {
    const { state, ids } = world()
    saveFleetPreset(state, ctx, 'one')
    state.preparationSquads!.combat!.pop()
    delete state.fleet[ids[2]!]
    const original = structuredClone(state.fleetPresets)
    const first = loadSaveFile(serializeSaveFile(state)).state
    const second = loadSaveFile(serializeSaveFile(first)).state
    expect(first.fleetPresets).toEqual(original)
    expect(second.fleetPresets).toEqual(original)
    const initial = createInitialState({ nowWallMs: 0 })
    expect(loadSaveFile(serializeSaveFile(initial)).state.fleetPresets).toBeUndefined()
  })

  it('清洗拒绝重复、超长、缺主控、非法成员与超员，不截出另一个编队', () => {
    const valid = { id: 'one', name: 'one', leaderShipId: 'lead', shipIds: ['lead', 'missing'] }
    expect(cleanFleetPresets([null, {}, valid, valid, { ...valid, id: 'two', name: 'two', shipIds: ['lead', 'lead'] },
      { ...valid, id: 'three', name: 'three', shipIds: Array.from({ length: 13 }, (_, i) => i ? `wing-${i}` : 'lead') },
      { ...valid, id: 'four', name: 'four', shipIds: ['wing', 'lead'] },
      { ...valid, id: 'five', name: 'five', shipIds: ['lead', null] }])).toEqual([valid])
    expect(cleanFleetPresets(Array.from({ length: 12 }, (_, i) => ({ ...valid, id: String(i), name: String(i) })))).toHaveLength(10)
  })
})
