import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { fitModule, sameKindCount, stackingOf } from '../src/equipment'
import { advanceBattleFor, createPlayerSpec, startBattleFor } from '../src/combat'
import { acidResistsOf, addFoeAcidLayer } from '../src/alienEquipment'
import { battleDeviceCyclesOf } from '../src/battleDeviceView'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
const blinkId = 'mod-lair-blink-r', acidId = 'mod-lair-laser-c'
function world(high: string[], mid: string[] = [], ship = 'sh-megalodon') {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const uid = addShipToFleet(state, ship)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high, mid, low: [] }
  state.warehouse.items['ammo-plasma-l'] = 10000
  return { state, uid }
}
describe('短距离跃迁、护盾笼与酸液喷吐器', () => {
  it('短距离跃迁归战斗支援而非推进，中槽和原数值保留，中英文目录同步且仍不可制造', () => {
    expect(ctx.modules.get(blinkId)).toMatchObject({ name: '短距离跃迁装置', slot: 'support', rack: 'mid', cpuUse: 40,
      blink: { distanceM: 2000, cooldownMs: 16000 } })
    const en = buildSimContext('en')
    expect(en.modules.get(blinkId)!.name).toBe('Short-Range Warp Device')
    expect([...ctx.blueprints.values()].some(bp => bp.moduleId === blinkId)).toBe(false)
    expect(stackingOf(ctx.modules.get(blinkId)!)).toEqual({ group: 'max', kind: 'blink' })
    expect(ctx.modules.get('mod-wh-a-shield')!.cpuUse).toBe(36)
  })
  it('普通舰可与隐秘行动共存，多装仍只一份跃迁；真正推进器仍使隐秘失效', () => {
    const { state, uid } = world(['mod-stealth-3'], [blinkId])
    const one = createPlayerSpec(state, ctx, uid)!
    expect(one.stealthMs).toBe(30000)
    state.moduleBay[blinkId] = 1
    expect(fitModule(state, blinkId, ctx, { shipId: uid, rack: 'mid' }).ok).toBe(true)
    const two = createPlayerSpec(state, ctx, uid)!
    expect(sameKindCount(state.fleet[uid]!.fitted, ctx, ctx.modules.get(blinkId)!)).toBe(2)
    expect(two.meBlink).toEqual(one.meBlink)
    expect(two.stealthMs).toBe(30000)
    const battle = startBattleFor(state, ctx, uid, 'ano-training', 0)!
    expect(battle.units.player!.stealthUntilMs).toBe(30000)
    expect(battleDeviceCyclesOf(state, ctx, battle, [{ spec: two, shipId: uid, name: 'test' }], () => ({ boosting: false, remainMs: 0, cycleMs: 0, posMs: 0 })).some(row => row.kind === 'thruster')).toBe(false)
    const prop = [...ctx.modules.values()].find(mod => mod.slot === 'propulsion')!
    state.fleet[uid]!.fitted.mid = [blinkId, prop.id]
    expect(createPlayerSpec(state, ctx, uid)!.stealthMs).toBeUndefined()
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    expect(loaded.fleet[uid]!.fitted.mid).toContain(blinkId)
  })
  it('同族候选件数同时计算同型号与其他型号，不将重复安装误标为首件', () => {
    const { state, uid } = world([])
    const hit = [...ctx.modules.values()].filter(mod => mod.hitBonusPct !== undefined)
    expect(hit.length).toBeGreaterThan(1)
    state.fleet[uid]!.fitted.mid = [hit[0]!.id, hit[0]!.id, hit[1]!.id]
    expect(sameKindCount(state.fleet[uid]!.fitted, ctx, hit[0]!)).toBe(3)
  })
  it('喷吐器基础射程2500米，巨齿鲨的20%舰船射程加成仍正常生效', () => {
    for (const [ship, range] of [['sh-hammerhead', 2500], ['sh-megalodon', 3000]] as const) {
      const { state, uid } = world([acidId], [], ship)
      expect(createPlayerSpec(state, ctx, uid)!.weapons[0]!.maxRangeM).toBe(range)
    }
  })
  it.each([1, 2])('%s门酸液真实命中逐门施加5%%/15秒，激光类型与装填保留新值', copies => {
    const { state, uid } = world(Array(copies).fill(acidId))
    const target = { ...ctx.foeShips!.get('foe-d-longship')!, hp: 1e9, split: { s: 0, a: 1, h: 0 },
      armorResist: { plasma: .4 }, mounts: [], shotDmg: 0, speedMps: 0 }
    const card = { ...ctx.anomalies.get('ano-training')!, id: 'spray-test', ships: [{ ship: target }], waves: undefined,
      foeHpOverride: undefined }
    const local: SimContext = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card) }
    const spec = createPlayerSpec(state, local, uid)!
    expect(spec.weapons[0]).toMatchObject({ kind: 'beam', fixedType: 'plasma', maxRangeM: 3000, reloadMs: 3800,
      acidOnHit: { cutPct: .05, durationMs: 15000 } })
    const b = startBattleFor(state, local, uid, card.id, 0, 1000)!
    expect(b.units['foe-0']!.hp.s).toBe(0)
    expect(b.units['foe-0']!.hp.a).toBeGreaterThan(0)
    expect(b.units['foe-0']!.hp.h).toBe(0)
    b.distanceM = 1000; b.myDesireM = 1000
    for (const u of Object.values(b.units)) { delete u.enteredAtMs; u.weapons.fill(u.side === 'me' ? 0 : 1e9) }
    state.gameMs = 10
    advanceBattleFor(state, local, b, uid, card.id)
    expect(b.foeAcidLayers?.['foe-0']).toHaveLength(copies)
    const base = { shield: { plasma: .4 }, armor: { plasma: .4 }, hull: { plasma: .4 } }
    const after = acidResistsOf(b, 'foe-0', base, b.lastTickGameMs)
    expect(after.armor!.plasma).toBeCloseTo(.4 - .05 * copies, 12)
    expect(after.shield).toBe(base.shield)
    expect(after.hull).toBe(base.hull)
    const corroded = structuredClone(b), control = structuredClone(b)
    delete control.foeAcidLayers
    for (const battle of [corroded, control]) battle.units.player!.weapons.fill(0)
    const nextState = structuredClone(state)
    nextState.gameMs = 20
    advanceBattleFor(nextState, local, corroded, uid, card.id)
    advanceBattleFor(structuredClone(nextState), local, control, uid, card.id)
    expect(corroded.stats.meDmg).toBeGreaterThan(control.stats.meDmg)
    expect(corroded.foeAcidLayers?.['foe-0']).toHaveLength(copies * 2)
    const noAmmo = structuredClone(b)
    noAmmo.ammo.pla = 0
    noAmmo.units.player!.weapons.fill(0)
    advanceBattleFor(structuredClone(nextState), local, noAmmo, uid, card.id)
    expect(noAmmo.foeAcidLayers?.['foe-0']).toHaveLength(copies)
    addFoeAcidLayer(b, 'foe-0', ctx.modules.get('mod-alien-acid-launcher')!.acidOnHit!, 1000)
    expect(acidResistsOf(b, 'foe-0', base, 1000).armor!.plasma).toBeCloseTo(.3 - .05 * copies, 12)
    expect(acidResistsOf(b, 'foe-0', base, 15010).armor!.plasma).toBeCloseTo(.3, 12)
    expect(acidResistsOf(b, 'foe-0', base, 16000)).toBe(base)
  })
  it('当前磁轨/酸蚀规格使用百分号，近盲不再写自伤原因', () => {
    for (const locale of ['zh', 'en'] as const) {
      expect(L10N['ui.gravekeeperGear.008']![locale]).toContain('%')
      expect(L10N['ui.alienLoot.002']![locale]).toContain('%')
      expect(L10N['ui.shipInfo.047']![locale]).not.toMatch(/炸到自己|damages itself/)
    }
    expect(L10N['ui.gravekeeperGear.008']!.zh).not.toContain('百分点')
  })
})
