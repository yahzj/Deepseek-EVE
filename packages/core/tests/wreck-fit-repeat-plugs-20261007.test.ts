import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState, type WreckLogEntry, type ShipFitPreset } from '../src/state'
import { addShipToFleet, loseShip } from '../src/shipyard'
import { cpuBudgetOf, repairDeprecatedModules } from '../src/equipment'
import { installPlug, plugModulesOf, shipSlotsWithPlugsOf } from '../src/plugs'
import { createPlayerSpec } from '../src/playerSpec'
import { cleanPlugIds, PLUG_LIST_MAX } from '../src/saveBattleClean'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { applyFitPreset, fitPresetDetailOf, overwriteFitPreset, saveFitPreset, saveWreckFitPreset, wreckFitDetailOf, FIT_PRESET_MAX } from '../src/fitPresets'
import { noteWreckLog, trySalvagePlayerWreckOf } from '../src/shipWrecks'
import { injectWreckFitTestState } from '../../../tools/wreck-fit-test-fixture'

const ctx = buildSimContext()
function world(defId = 'sh-wh-a-frigate') {
  const state = createInitialState({ nowWallMs: 0, seed: 7, prologue: true })
  const uid = addShipToFleet(state, defId)
  state.shipId = uid
  return { state, uid }
}
/** 旧规则下合法保存的九中槽舰船；直接还原历史档，不走当前限装入口。 */
function legacyNineMidWorld() {
  const { state, uid } = world()
  const ship = state.fleet[uid]!
  const slots = ctx.ships.get(ship.defId!)!.slots!
  ship.plugs = Array(5).fill('plug-mid-bay')
  ship.fitted = { high: Array(slots.high).fill(null), mid: Array(slots.mid + 5).fill(null), low: Array(slots.low).fill(null) }
  ship.fitted.mid[8] = 'mod-shield-kin-1'
  return { state, uid }
}
function record(overrides: Partial<WreckLogEntry> = {}): WreckLogEntry {
  return { seq: 1, shipId: 'lost-ship', shipName: '沉船测试', defId: 'sh-hammerhead', cause: 'wormhole-sunk', atGameMs: 0,
    fitted: { high: ['mod-turret-kin-1', null, 'mod-gone'], mid: ['mod-shield-kin-1'], low: [] },
    plugs: ['plug-mid-bay', 'plug-mid-bay'], droneLoad: { 'drone-scout': 2 }, ...overrides }
}

describe('重复插件安装/效果/库存/快照', () => {
  it.each(['plug-shield-plate', 'plug-cpu-core', 'plug-firepower', 'plug-sight', 'plug-concealment'])('%s重复安装保留件数，滿槽/缺库存拒绝不扣料', id => {
    const { state, uid } = world()
    const capacity = ctx.ships.get(state.fleet[uid]!.defId!)!.plugSlots!
    state.moduleBay[id] = capacity
    for (let n = 1; n <= capacity; n++) {
      expect(installPlug(state, ctx, id, uid).ok).toBe(true)
      expect(state.fleet[uid]!.plugs).toEqual(Array(n).fill(id))
      expect(state.moduleBay[id] ?? 0).toBe(capacity - n)
    }
    expect(plugModulesOf(state, ctx, uid)).toHaveLength(capacity)
    const before = JSON.stringify(state)
    expect(installPlug(state, ctx, id, uid).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.fleet[uid]!.plugs).toEqual(state.fleet[uid]!.plugs)
  })
  it.each([
    ['plug-mid-bay', 'plug-low-bay'],
    ['plug-low-bay', 'plug-mid-bay'],
  ])('%s只装一件，重复拒绝不扣料，与%s可并存', (id, otherId) => {
    const { state, uid } = world()
    const base = shipSlotsWithPlugsOf(state, ctx, uid)
    state.moduleBay[id] = 2
    state.moduleBay[otherId] = 1
    expect(installPlug(state, ctx, id, uid).ok).toBe(true)
    expect(state.fleet[uid]!.plugs).toEqual([id])
    expect(state.moduleBay[id]).toBe(1)
    const before = JSON.stringify(state)
    expect(installPlug(state, ctx, id, uid)).toMatchObject({ ok: false, errorId: 'core.plug.014' })
    expect(JSON.stringify(state)).toBe(before)
    expect(installPlug(state, ctx, otherId, uid).ok).toBe(true)
    expect(state.fleet[uid]!.plugs).toEqual([id, otherId])
    expect(state.moduleBay[otherId] ?? 0).toBe(0)
    expect(shipSlotsWithPlugsOf(state, ctx, uid)).toEqual({ high: base.high, mid: base.mid + 1, low: base.low + 1 })
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.fleet[uid]!.plugs).toEqual([id, otherId])
    expect(back.moduleBay).toEqual(state.moduleBay)
  })
  it('护盾/CPU固定值逐件加，命中/选靶沿用乘算，未知和空插件仍清洗', () => {
    const { state, uid } = world()
    const before = createPlayerSpec(state, ctx, uid)!
    const cpu = cpuBudgetOf(state, ctx, uid)
    state.moduleBay['plug-shield-plate'] = 2
    state.moduleBay['plug-cpu-core'] = 2
    for (const id of ['plug-shield-plate', 'plug-shield-plate', 'plug-cpu-core', 'plug-cpu-core']) expect(installPlug(state, ctx, id, uid).ok).toBe(true)
    expect(createPlayerSpec(state, ctx, uid)!.hp.s - before.hp.s).toBeCloseTo(2 * ctx.modules.get('plug-shield-plate')!.shieldHpAdd!, 8)
    expect(cpuBudgetOf(state, ctx, uid) - cpu).toBe(2 * ctx.modules.get('plug-cpu-core')!.cpuBonus!)
    state.fleet[uid]!.plugs = ['plug-concealment', 'plug-concealment']
    expect(createPlayerSpec(state, ctx, uid)!.targetWeightMul).toBeCloseTo(ctx.modules.get('plug-concealment')!.targetWeightMul! ** 2, 8)
    expect(cleanPlugIds([' p ', 'p', '', 1, null])).toEqual(['p', 'p'])
    expect(cleanPlugIds(Array(30).fill('p'))).toHaveLength(PLUG_LIST_MAX)
  })
  it('进洞锁定时安装拒绝，不扣库存和已有重复插件', () => {
    const { state, uid } = world()
    state.moduleBay['plug-cpu-core'] = 1
    state.fleet[uid]!.plugs = ['plug-cpu-core']
    state.wormhole.run = { fleet: [uid] } as never
    const before = JSON.stringify(state)
    expect(installPlug(state, ctx, 'plug-cpu-core', uid).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
  })
  it('旧档九中槽舰队/方案原样往返，整理只留首件扩槽并退回四插件和尾装备，历史方案不改', () => {
    const { state, uid } = legacyNineMidWorld()
    expect(shipSlotsWithPlugsOf(state, ctx, uid).mid).toBe(9)
    expect(saveFitPreset(state, ctx, uid, '九槽')).toEqual({ ok: true })
    const presets = structuredClone(state.fitPresets)
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.fleet[uid]!.fitted).toEqual(state.fleet[uid]!.fitted)
    expect(back.fleet[uid]!.plugs).toEqual(Array(5).fill('plug-mid-bay'))
    expect(back.fitPresets).toEqual(presets)
    const modules = structuredClone(back.moduleBay)
    const unchanged = structuredClone({ wallet: back.wallet, warehouse: back.warehouse, rng: back.rng })
    repairDeprecatedModules(back, ctx)
    expect(back.fleet[uid]!.plugs).toEqual(['plug-mid-bay'])
    expect(shipSlotsWithPlugsOf(back, ctx, uid).mid).toBe(5)
    expect(back.fleet[uid]!.fitted.mid).toEqual(Array(5).fill(null))
    expect(back.moduleBay).toEqual({ ...modules,
      'plug-mid-bay': (modules['plug-mid-bay'] ?? 0) + 4,
      'mod-shield-kin-1': (modules['mod-shield-kin-1'] ?? 0) + 1,
    })
    expect({ wallet: back.wallet, warehouse: back.warehouse, rng: back.rng }).toEqual(unchanged)
    expect(back.fitPresets).toEqual(presets)
    expect(back.fitPresets![back.fleet[uid]!.defId!]![0]!.fitted.mid[8]).toBe('mod-shield-kin-1')
    expect(back.fitPresets![back.fleet[uid]!.defId!]![0]!.plugs).toEqual(Array(5).fill('plug-mid-bay'))
    const repaired = loadSaveFile(serializeSaveFile(back)).state
    expect(repaired.fleet[uid]!.fitted).toEqual(back.fleet[uid]!.fitted)
    expect(repaired.fleet[uid]!.plugs).toEqual(['plug-mid-bay'])
    expect(repaired.moduleBay).toEqual(back.moduleBay)
    expect(repaired.fitPresets).toEqual(presets)
  })
  it('未整理历史沉船的九格快照/方案与五重复插件完整往返，打捞仅换五黑匣', () => {
    const { state, uid } = legacyNineMidWorld()
    const fitted = { high: [], mid: [...state.fleet[uid]!.fitted.mid], low: [] }
    expect(saveFitPreset(state, ctx, uid, '九槽')).toEqual({ ok: true })
    loseShip(state, uid, ctx, '测试损失', 'galaxy-hub')
    const sunk = loadSaveFile(serializeSaveFile(state)).state
    expect(sunk.shipWrecks![uid]!.fitted).toEqual(fitted)
    expect(sunk.wreckLog![0]!.fitted).toEqual(fitted)
    expect(sunk.shipWrecks![uid]!.plugs).toEqual(Array(5).fill('plug-mid-bay'))
    expect(sunk.wreckLog![0]!.plugs).toEqual(Array(5).fill('plug-mid-bay'))
    const historical = structuredClone({ wrecks: sunk.shipWrecks, log: sunk.wreckLog, presets: sunk.fitPresets, modules: sunk.moduleBay })
    repairDeprecatedModules(sunk, ctx)
    expect({ wrecks: sunk.shipWrecks, log: sunk.wreckLog, presets: sunk.fitPresets, modules: sunk.moduleBay }).toEqual(historical)
    expect(trySalvagePlayerWreckOf(sunk, ctx, 'galaxy-hub')).toEqual({ kind: 'plugs', blackBoxes: 5 })
    expect(sunk.shipWrecks![uid]!.plugs).toEqual([])
    expect(trySalvagePlayerWreckOf(sunk, ctx, 'galaxy-hub')).toEqual({ kind: 'item', itemId: 'mod-shield-kin-1', units: 1, isModule: true })
    expect(trySalvagePlayerWreckOf(sunk, ctx, 'galaxy-hub')).toEqual({ kind: 'none' })
    expect(sunk.wreckLog![0]!.fitted).toEqual(fitted)
    expect(sunk.wreckLog![0]!.plugs).toEqual(Array(5).fill('plug-mid-bay'))
    expect(sunk.fitPresets).toEqual(historical.presets)
    expect(sunk.moduleBay).toEqual(historical.modules)
  })
})

describe('沉船方案保存与不可逆插件参考', () => {
  it('原船不存在、残骸过期/无残骸仍可保存，保逐位空格/未知件/重复插件，库存和记录不改', () => {
    const { state } = world()
    const entry = record()
    noteWreckLog(state, entry)
    const before = structuredClone({ inventory: state.warehouse, modules: state.moduleBay, fleet: state.fleet, rng: state.rng, wrecks: state.wreckLog })
    expect(saveWreckFitPreset(state, ctx, entry.seq, '重建')).toEqual({ ok: true })
    const preset = state.fitPresets![entry.defId!]![0]!
    expect(preset).toEqual({ name: '重建', fitted: entry.fitted, droneLoad: entry.droneLoad, plugs: entry.plugs })
    expect({ inventory: state.warehouse, modules: state.moduleBay, fleet: state.fleet, rng: state.rng, wrecks: state.wreckLog }).toEqual(before)
    preset.fitted.high[0] = 'changed'
    expect(entry.fitted!.high[0]).toBe('mod-turret-kin-1')
    preset.plugs![0] = 'changed-plug'
    expect(entry.plugs![0]).toBe('plug-mid-bay')
  })
  it('同名首次返回确认快照不覆盖，二次精确确认才覆盖；确认期间目标变更/删除拒绝', () => {
    const { state } = world()
    noteWreckLog(state, record())
    expect(saveWreckFitPreset(state, ctx, 1, '重建').ok).toBe(true)
    state.fitPresets!['sh-hammerhead']![0]!.fitted.high = ['mod-turret-kin-2']
    const old = structuredClone(state.fitPresets)
    const first = saveWreckFitPreset(state, ctx, 1, '重建')
    expect(first.errorId).toBe('core.wreckFit.003')
    expect(state.fitPresets).toEqual(old)
    expect(saveWreckFitPreset(state, ctx, 1, '重建', first.overwrite).ok).toBe(true)
    expect(state.fitPresets!['sh-hammerhead']![0]!.fitted.high).toEqual(record().fitted!.high)
    const next = saveWreckFitPreset(state, ctx, 1, '重建').overwrite!
    state.fitPresets!['sh-hammerhead']![0]!.name = '已改名'
    const changed = structuredClone(state.fitPresets)
    expect(saveWreckFitPreset(state, ctx, 1, '重建', next).errorId).toBe('core.wreckFit.004')
    expect(state.fitPresets).toEqual(changed)
  })
  it('10套限制、空快照/记录缺失/船型缺失拒绝，空名称沿用默认，旧方案读档不加字段', () => {
    const { state } = world()
    noteWreckLog(state, record())
    for (let n = 0; n < FIT_PRESET_MAX; n++) expect(saveWreckFitPreset(state, ctx, 1, `方案${n}`).ok).toBe(true)
    expect(saveWreckFitPreset(state, ctx, 1, '超限').errorId).toBe('core.fitPresets.005')
    expect(saveWreckFitPreset(state, ctx, 999).errorId).toBe('core.wreckFit.001')
    noteWreckLog(state, record({ seq: 2, defId: undefined }))
    expect(saveWreckFitPreset(state, ctx, 2).errorId).toBe('core.wreckFit.002')
    noteWreckLog(state, record({ seq: 3, fitted: undefined, droneLoad: undefined, plugs: undefined }))
    expect(saveWreckFitPreset(state, ctx, 3).errorId).toBe('core.wreckFit.005')
    const old: ShipFitPreset = { name: '旧方案', fitted: { high: ['mod-turret-kin-1'], mid: [], low: [] } }
    state.fitPresets = { 'sh-hammerhead': [old] }
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.fitPresets!['sh-hammerhead']).toEqual([old])
  })
  it('插件参考和只插件方案可保存/往返，套用不扣插件，不安装或清掉目标插件', () => {
    const { state, uid } = world('sh-hammerhead')
    noteWreckLog(state, record({ fitted: { high: ['mod-turret-kin-1'], mid: [], low: [] }, droneLoad: undefined }))
    expect(saveWreckFitPreset(state, ctx, 1, '复原').ok).toBe(true)
    state.moduleBay['mod-turret-kin-1'] = 1
    state.moduleBay['plug-mid-bay'] = 5
    state.fleet[uid]!.plugs = ['plug-cpu-core']
    const plugs = [...state.fleet[uid]!.plugs]
    expect(applyFitPreset(state, ctx, uid, 0).ok).toBe(true)
    expect(state.moduleBay['plug-mid-bay']).toBe(5)
    expect(state.fleet[uid]!.plugs).toEqual(plugs)
    noteWreckLog(state, record({ seq: 2, fitted: undefined, droneLoad: undefined }))
    expect(saveWreckFitPreset(state, ctx, 2, '插件清单').ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(back.fitPresets!['sh-hammerhead']![1]!.plugs).toEqual(record().plugs)
  })
  it('当前舰船保存/覆盖保插件参考；明细逐位重复/空位与未知型号不丢', () => {
    const { state, uid } = world('sh-hammerhead')
    state.fleet[uid]!.plugs = ['plug-cpu-core', 'plug-cpu-core']
    expect(saveFitPreset(state, ctx, uid).ok).toBe(true)
    expect(state.fitPresets!['sh-hammerhead']![0]!.plugs).toEqual(state.fleet[uid]!.plugs)
    state.fleet[uid]!.plugs = ['plug-mid-bay', 'plug-mid-bay']
    expect(overwriteFitPreset(state, ctx, uid, 0).ok).toBe(true)
    expect(state.fitPresets!['sh-hammerhead']![0]!.plugs).toEqual(state.fleet[uid]!.plugs)
    const entry = record()
    const detail = wreckFitDetailOf(ctx, entry)
    expect(detail.plugs.map(p => p.id)).toEqual(entry.plugs)
    expect(detail.slots.some(slot => slot.id === 'mod-gone' && slot.missing)).toBe(true)
    expect(detail.slots.some(slot => slot.id === null)).toBe(true)
    expect(fitPresetDetailOf(state.fitPresets!['sh-hammerhead']![0]!, ctx, ctx.ships.get('sh-hammerhead')!).plugs).toHaveLength(2)
    expect(wreckFitDetailOf(ctx, record({ defId: 'missing-ship' })).slots.some(slot => slot.id === 'mod-gone')).toBe(true)
  })
  it('注册验收门槛独立生成，真实丢船记录及重复插件往返可复现', () => {
    const { state } = world()
    const notes = injectWreckFitTestState(state)
    expect(notes).toHaveLength(3)
    const back = loadSaveFile(serializeSaveFile(state)).state
    const entry = back.wreckLog![0]!
    expect(back.fleet[entry.shipId]).toBeUndefined()
    expect(entry.plugs).toEqual(['plug-cpu-core', 'plug-cpu-core'])
    expect(back.fleet[back.shipId]!.plugs).toEqual(['plug-cpu-core'])
    expect(saveWreckFitPreset(back, ctx, entry.seq, '新方案').ok).toBe(true)
    expect(back.fitPresets!['sh-hammerhead']![1]!.droneLoad).toEqual({ 'drone-scout': 2 })
  })
})
