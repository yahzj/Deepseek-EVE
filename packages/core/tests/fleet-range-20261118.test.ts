import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createCommandReadyState } from './helpers/command-ready'
import { finishDeparture } from './helpers/departure-ready'
import { setFleetDistance } from './helpers/fleet-range'
import { addShipToFleet } from '../src/fleetBook'
import { applyFleetPreset, cleanFleetPresets, deleteFleetPreset, saveFleetPreset } from '../src/fleetPresets'
import { cleanFleetRangePreference, cleanFleetRangeSettings, saveBattleFleetRange, setFleetRange } from '../src/fleetRange'
import { cleanCombatSortie } from '../src/combat/command/roster'
import { startBattleFor, startFleetBattleFor } from '../src/combat'
import { startExpedition, setBattleDesire, battleTacticDesire } from '../src/expedition'
import { confirmBattleRange } from '../src/battleRangeConfirm'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()
const NOW = 1794974400000
function world() {
  const state = createCommandReadyState({ nowWallMs: NOW, seed: 1118 })
  state.modeChosen = true
  state.fleet = {}
  state.shipId = addShipToFleet(state, 'sh-megalodon')
  state.fleet[state.shipId]!.fitted = { high: ['mod-laser-1'], mid: [], low: [] }
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  state.warehouse.items['ammo-plasma-l'] = 100000
  state.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  return state
}
function presets() {
  const state = world()
  setFleetDistance(state, ctx, 2500)
  state.fleetRange!.maxRangeM = 6000
  expect(saveFleetPreset(state, ctx, '近距').ok).toBe(true)
  const near = state.fleetPresets![0]!.id
  setFleetDistance(state, ctx, 3500)
  expect(saveFleetPreset(state, ctx, '远距').ok).toBe(true)
  const far = state.fleetPresets![1]!.id
  expect(applyFleetPreset(state, ctx, near).ok).toBe(true)
  // 去掉合成的证据；入场必须自己计算真实射程。
  delete state.fleetRange!.maxRangeM
  delete state.fleetPresets![0]!.range!.maxRangeM
  return { state, near, far }
}

describe('编队距离预设与保存', () => {
  it('保存、覆盖、套用均携带距离与射程证据，同船不同预设互不覆盖', () => {
    const { state, near, far } = presets()
    expect(state.fleetPresets!.map(p => p.shipIds)).toEqual([[state.shipId], [state.shipId]])
    expect(state.fleetPresets!.map(p => p.range?.desireM)).toEqual([2500, 3500])
    expect(applyFleetPreset(state, ctx, far).ok).toBe(true)
    expect(state.fleetRange).toEqual({ desireM: 3500, maxRangeM: 6000, shipIds: [state.shipId], presetId: far })
    expect(setFleetRange(state, ctx, 2800, near).ok).toBe(true)
    expect(state.fleetRange!.desireM).toBe(3500)
    expect(applyFleetPreset(state, ctx, near).ok).toBe(true)
    expect(state.fleetRange!.desireM).toBe(2800)
    state.fleetRange!.maxRangeM = 7000
    expect(saveFleetPreset(state, ctx, '近距改', near).ok).toBe(true)
    expect(state.fleetPresets![0]!.range).toEqual({ desireM: 2800, maxRangeM: 7000 })
    expect(state.fleetPresets![1]!.range).toEqual({ desireM: 3500, maxRangeM: 6000 })
  })

  it('无距离的旧预设与null均为自动，不推测旧敌卡或星系记录', () => {
    const state = world()
    state.fleetPresets = [{ id: 'old', name: '旧编队', leaderShipId: state.shipId, shipIds: [state.shipId] }]
    state.battleRangeByCard = { 'ano-training': { desireM: 2300, maxRangeM: 1 } }
    state.expedition.desirePrefByGalaxy = { 'galaxy-hub': 2300 }
    const legacy = structuredClone(state.battleRangeByCard)
    const auto = startBattleFor(structuredClone(state), ctx, state.shipId, 'ano-training', 0, null)!
    expect(applyFleetPreset(state, ctx, 'old').ok).toBe(true)
    expect(state.fleetRange).toEqual({ shipIds: [state.shipId], presetId: 'old' })
    expect(startBattleFor(state, ctx, state.shipId, 'ano-training')!.myDesireM).toBe(auto.myDesireM)
    expect(setFleetRange(state, ctx, 2500, 'old').ok).toBe(true)
    expect(setFleetRange(state, ctx, null, 'old').ok).toBe(true)
    expect(state.fleetPresets![0]!.range?.desireM).toBeUndefined()
    expect(state.fleetRange!.desireM).toBeUndefined()
    expect(state.battleRangeByCard).toEqual(legacy)
  })

  it.each([NaN, Infinity, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])('非法默认%s拒绝且整档不变', value => {
    const { state, near } = presets()
    const before = structuredClone(state)
    expect(setFleetRange(state, ctx, value).ok).toBe(false)
    expect(setFleetRange(state, ctx, value, near).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('目标预设不存在时拒绝；自动档保留射程证据', () => {
    const state = world()
    state.fleetRange = { shipIds: [state.shipId], desireM: 2500, maxRangeM: 6000 }
    const before = structuredClone(state)
    expect(setFleetRange(state, ctx, 2500, 'missing').ok).toBe(false)
    expect(state).toEqual(before)
    expect(setFleetRange(state, ctx, null).ok).toBe(true)
    expect(state.fleetRange).toEqual({ shipIds: [state.shipId], maxRangeM: 6000 })
  })

  it('显式null的单舰和编队自动计算均不读写玩家默认', () => {
    const state = world()
    setFleetDistance(state, ctx, 2300)
    const before = structuredClone(state)
    const single = startBattleFor(state, ctx, state.shipId, 'ano-training', 0, null)!
    const fleet = startFleetBattleFor(state, ctx, [state.shipId], 'ano-training', 0, null)!
    for (const battle of [single, fleet]) {
      expect(battle.myDesireM).not.toBe(2300)
      expect(battle.rangeMemory).toBeUndefined()
    }
    expect(state.fleetRange).toEqual(before.fleetRange)
    expect(state.fleetPresets).toEqual(before.fleetPresets)
  })

  it('战中拖动与战术只改本场，显式保存只写出发绑定的预设', () => {
    const { state, near, far } = presets()
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    finishDeparture(state, ctx)
    const battle = state.expedition.battle!
    expect(battle.rangeMemory).toMatchObject({ sourceVersion: 1, fleetPresetId: near, shipIds: [state.shipId] })
    const preference = structuredClone(state.fleetPresets)
    const current = structuredClone(state.fleetRange)
    expect(setBattleDesire(state, battleTacticDesire(state, ctx, 'kite'), ctx).ok).toBe(true)
    expect(setBattleDesire(state, 1700, ctx).ok).toBe(true)
    expect(state.fleetPresets).toEqual(preference)
    expect(state.fleetRange).toEqual(current)
    expect(setFleetRange(state, ctx, 3900, far).ok).toBe(true)
    expect(saveBattleFleetRange(state, ctx, battle).ok).toBe(true)
    expect(state.fleetPresets!.find(p => p.id === near)!.range).toEqual({ desireM: 1700, maxRangeM: battle.rangeMemory!.maxRangeM })
    expect(state.fleetPresets!.find(p => p.id === far)!.range!.desireM).toBe(3900)
  })

  it.each(['missing', 'version', 'unbound', 'roster', 'order', 'deleted'] as const)('%s绑定无效时显式保存拒绝且不部分写入', reason => {
    const { state, near } = presets()
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-training')!
    if (reason === 'missing') delete battle.rangeMemory
    if (reason === 'version') delete battle.rangeMemory!.sourceVersion
    if (reason === 'unbound') delete battle.rangeMemory!.fleetPresetId
    if (reason === 'roster' || reason === 'order') {
      const ally = addShipToFleet(state, 'sh-shrike')
      state.fleetPresets![0]!.shipIds = reason === 'roster' ? [state.shipId, ally] : [ally, state.shipId]
    }
    if (reason === 'deleted') expect(deleteFleetPreset(state, near).ok).toBe(true)
    const before = structuredClone(state)
    expect(saveBattleFleetRange(state, ctx, battle).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('手动改默认保留旧射程和原名单，不能绕过装备或成员变化确认', () => {
    const state = world()
    state.fleetRange = { desireM: 2500, maxRangeM: 1, shipIds: [state.shipId] }
    const ally = addShipToFleet(state, 'sh-shrike')
    state.preparationSquads = { combat: [state.shipId, ally] }
    state.fleet[state.shipId]!.fitted.high = ['mod-laser-2']
    setFleetDistance(state, ctx, 1700)
    expect(state.fleetRange).toMatchObject({ desireM: 1700, maxRangeM: 1, shipIds: [state.shipId] })
    expect(startExpedition(state, 'ano-training', ctx).rangeConfirmation).toBe(true)
    expect(state.pendingBattleRange).toMatchObject({ previousRangeM: 1, previousShipIds: [state.shipId], shipIds: [state.shipId, ally], fleetChanged: true })
  })

  it('删除后同名单重建不复用战斗引用ID，旧战斗不能把距离写给新预设', () => {
    const { state, near } = presets()
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-training')!
    // 旧遭遇记录仍在槽中，但活动已结束，允许在港保存新编队。
    battle.ended = 'me'
    state.encounter.battle = battle
    expect(deleteFleetPreset(state, near).ok).toBe(true)
    expect(saveFleetPreset(state, ctx, '重建').ok).toBe(true)
    const replacement = state.fleetPresets!.at(-1)!
    expect(replacement.shipIds).toEqual(battle.rangeMemory!.shipIds)
    expect(replacement.id).not.toBe(near)
    const before = structuredClone(state)
    expect(saveBattleFleetRange(state, ctx, battle).ok).toBe(false)
    expect(state).toEqual(before)
  })

  it('同射程换成员仍确认，接受后才更新编队名单证据', () => {
    const state = world()
    const ally = addShipToFleet(state, 'sh-shrike')
    const initial = startBattleFor(structuredClone(state), ctx, state.shipId, 'ano-training')!
    state.fleetRange = { desireM: 2500, shipIds: [state.shipId], maxRangeM: initial.rangeMemory!.maxRangeM }
    state.preparationSquads = { combat: [state.shipId, ally] }
    const before = structuredClone(state.fleetRange)
    expect(startExpedition(state, 'ano-training', ctx).rangeConfirmation).toBe(true)
    expect(state.pendingBattleRange!.maxRangeM).toBe(before.maxRangeM)
    expect(state.pendingBattleRange!.fleetChanged).toBe(true)
    expect(state.fleetRange).toEqual(before)
    expect(confirmBattleRange(state, ctx, 1700, NOW).ok).toBe(true)
    expect(state.fleetRange!.shipIds).toEqual([state.shipId, ally])
    expect(state.fleetRange!.desireM).toBe(2500)
    finishDeparture(state, ctx)
    expect(state.expedition.battle!.myDesireM).toBe(1700)
  })

  it.each(['same-range', 'no-evidence', 'default'] as const)('确认期间%s偏好变化使旧同意失效，须重新确认', change => {
    const { state, near, far } = presets()
    state.fleetRange!.maxRangeM = 1
    expect(startExpedition(state, 'ano-training', ctx).rangeConfirmation).toBe(true)
    const signature = state.pendingBattleRange!.signature
    if (change === 'default') expect(setFleetRange(state, ctx, 2900, near).ok).toBe(true)
    else {
      if (change === 'no-evidence') delete state.fleetPresets![1]!.range!.maxRangeM
      else state.fleetPresets![1]!.range!.maxRangeM = state.pendingBattleRange!.maxRangeM
      expect(applyFleetPreset(state, ctx, far).ok).toBe(true)
    }
    const before = structuredClone(state)
    expect(confirmBattleRange(state, ctx, 1700, NOW).rangeConfirmation).toBe(true)
    expect(state.pendingBattleRange!.signature).not.toBe(signature)
    expect(state.pendingBattleRange!.fleetPresetId).toBe(change === 'default' ? near : far)
    expect(state.expedition.battle).toBeNull()
    expect(state.departure).toBeUndefined()
    expect(state.fleetRange).toEqual(before.fleetRange)
    expect(state.warehouse).toEqual(before.warehouse)
    expect(confirmBattleRange(state, ctx, 1700, NOW).ok).toBe(true)
    finishDeparture(state, ctx)
    expect(state.expedition.battle!.myDesireM).toBe(1700)
    expect(state.expedition.battle!.rangeMemory!.fleetPresetId).toBe(change === 'default' ? near : far)
  })
})

describe('出发距离快照与清洗往返', () => {
  it.each(['default', 'same-ships-preset', 'explicit', 'confirmed'] as const)('%s出发后更改当前默认，存读到达仍使用旧距离和绑定', kind => {
    const { state, near, far } = presets()
    const selected = structuredClone(state)
    expect(applyFleetPreset(selected, ctx, far).ok).toBe(true)
    if (kind === 'confirmed') state.fleetRange!.maxRangeM = 1
    const result = startExpedition(state, 'ano-training', ctx, kind === 'explicit' ? { desireM: 1700 } : undefined)
    if (kind === 'confirmed') {
      expect(result.rangeConfirmation).toBe(true)
      expect(confirmBattleRange(state, ctx, 1700, NOW).ok).toBe(true)
    } else expect(result.ok).toBe(true)
    const distance = kind === 'explicit' || kind === 'confirmed' ? 1700 : 2500
    expect(state.expedition.battle).toBeNull()
    expect(state.expedition.sortie!.range).toMatchObject({ desireM: distance, presetId: near, shipIds: [state.shipId] })
    const departure = structuredClone(state.expedition.sortie)
    if (kind === 'same-ships-preset') {
      // 只注入空闲副本正式套用后的偏好，不绕过在途编队操作门禁。
      state.fleetRange = structuredClone(selected.fleetRange)
    } else setFleetDistance(state, ctx, 3500)
    expect(state.expedition.sortie).toEqual(departure)
    const loaded = loadSaveFile(serializeSaveFile(state, NOW)).state
    expect(loaded.expedition.sortie).toEqual(departure)
    finishDeparture(loaded, ctx)
    expect(loaded.expedition.battle!.myDesireM).toBe(distance)
    expect(loaded.expedition.battle!.rangeMemory).toMatchObject({ sourceVersion: 1, fleetPresetId: near, shipIds: [state.shipId] })
    const again = loadSaveFile(serializeSaveFile(loaded, NOW)).state
    expect(again.expedition.battle!.rangeMemory).toEqual(loaded.expedition.battle!.rangeMemory)
    expect(again.expedition.battle!.myDesireM).toBe(distance)
  })

  it('清洗距离只保留合法整数和白名单字段，旧预设默认自动', () => {
    expect(cleanFleetRangePreference({ desireM: 2500, maxRangeM: 0, ignored: true })).toEqual({ desireM: 2500, maxRangeM: 0 })
    expect(cleanFleetRangePreference({ desireM: -1, maxRangeM: 1.2 })).toBeUndefined()
    expect(cleanFleetRangePreference({ desireM: NaN, maxRangeM: Infinity })).toBeUndefined()
    const row = { id: 'one', name: '一队', leaderShipId: 'a', shipIds: ['a'] }
    expect(cleanFleetPresets([{ ...row, range: { desireM: 2300, maxRangeM: 6000, ignored: 1 } }])[0]!.range).toEqual({ desireM: 2300, maxRangeM: 6000 })
    expect(cleanFleetPresets([row])[0]!.range).toBeUndefined()
  })

  it.each([[], ['a', 'a'], [''], Array.from({ length: 13 }, (_, i) => `s${i}`)])('坏名单%j不截断为另一支编队', shipIds => {
    expect(cleanFleetRangeSettings({ shipIds, desireM: 2500 })).toBeUndefined()
  })

  it('sortie距离名单必须顺序精确匹配，坏距离丢弃而出发名单保留', () => {
    const row = { version: 1, leaderShipId: 'a', shipIds: ['a', 'b'] }
    for (const ids of [['b', 'a'], ['a'], ['a', 'a']]) {
      expect(cleanCombatSortie({ ...row, range: { shipIds: ids, desireM: 2500 } })).toEqual(row)
    }
    expect(cleanCombatSortie({ ...row, range: { shipIds: ['a', 'b'], desireM: 2500, presetId: 'one' } })!.range).toEqual({ shipIds: ['a', 'b'], desireM: 2500, presetId: 'one' })
  })

  it('整档往返保存预设、当前默认及出发绑定，未知键与坏字段不透传', () => {
    const { state, near } = presets()
    expect(startExpedition(state, 'ano-training', ctx).ok).toBe(true)
    const raw = JSON.parse(serializeSaveFile(state, NOW))
    raw.state.fleetRange.ignored = 'bad'
    raw.state.fleetPresets[0].range.ignored = 'bad'
    raw.state.expedition.sortie.range.ignored = 'bad'
    const loaded = loadSaveFile(JSON.stringify(raw)).state
    expect(loaded.fleetRange).toEqual(state.fleetRange)
    expect(loaded.fleetPresets).toEqual(state.fleetPresets)
    expect(loaded.expedition.sortie!.range!.presetId).toBe(near)
    expect(loaded.expedition.sortie).toEqual(state.expedition.sortie)
    raw.state.fleetRange = { shipIds: [state.shipId, state.shipId], desireM: 2500 }
    raw.state.fleetPresets[0].range = { desireM: -1, maxRangeM: -2 }
    raw.state.expedition.sortie.range.shipIds = ['other']
    const repaired = loadSaveFile(JSON.stringify(raw)).state
    expect(repaired.fleetRange).toBeUndefined()
    expect(repaired.fleetPresets![0]!.range).toBeUndefined()
    expect(repaired.expedition.sortie!.range).toBeUndefined()
    expect(repaired.expedition.sortie!.shipIds).toEqual([state.shipId])
  })
})
