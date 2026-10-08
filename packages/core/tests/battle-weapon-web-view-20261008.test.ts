import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { battleWeaponCyclesOf } from '../src/battleWeaponView'
import { activeFoeSpecsOf, seedUnit } from '../src/foeSpecs'
import { startFleetBattleFor, advanceBattleFor, battleArcsFor, applyFoeWebDebuff, advanceMyCaptureWebs, createPlayerSpec } from '../src/combat'
import { alienFixture } from '../../../tools/alien-invasion-fixture'
import { cleanBattle } from '../src/saveBattleClean'
import { applyMeJammerDebuff, meJammerNetOf } from '../src/foeRange'

const ctx = buildSimContext()
function fleet() {
  const { state, ships } = alienFixture(ctx, 'heavy', 611, 4)
  for (const uid of ships) state.fleet[uid]!.fitted = { high: [], mid: ['mod-lair-web-h'], low: [] }
  const original = ctx.anomalies.get('alien-broodmother')!
  const card = { ...original, ships: original.ships!.filter(s => s.wave === 3).map(s => ({ ...s, wave: 0, desireRangeM: 4000 })), waves: undefined }
  const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card) }
  const battle = startFleetBattleFor(state, local, ships, card.id, 0, 2500)!
  battle.distanceM = 2500
  for (const u of Object.values(battle.units)) u.hp = { s: 1e8, a: 1e8, h: 1e8 }
  return { state, ships, battle, card, local }
}
describe('全编队装填视图与捕获网', () => {
  it('每舰同型炮合并数量，不跨舰、不新增冷却；无人机按机型一行', () => {
    const { state, ships, battle } = fleet()
    const units = ships.map((shipId, i) => {
      state.fleet[shipId]!.fitted = { high: ['mod-laser-3', 'mod-laser-3'], mid: [], low: [] }
      const spec = createPlayerSpec(state, ctx, shipId)!
      spec.tag = i === 0 ? 'player' : `ally-${i}`
      battle.units[spec.tag]!.weapons = spec.weapons.map(w => w.reloadMs / 2)
      return { spec, shipId, name: spec.tag }
    })
    battle.ammo.pla = 100
    const before = structuredClone(battle), rows = battleWeaponCyclesOf(battle, units)
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map(r => r.id)).size).toBe(8)
    expect(rows.filter(r => r.src === 'laser')).toHaveLength(4)
    expect(rows.filter(r => r.src === 'laser').every(r => r.count === 2)).toBe(true)
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(12)
    expect(rows.every(r => r.percent === 50)).toBe(true)
    for (const unit of units) {
      const gun = unit.spec.weapons.find(w => w.src === 'laser')!
      expect(rows.find(r => r.ownerTag === unit.spec.tag && r.src === 'laser'))
        .toMatchObject({ minM: gun.minRangeM, maxM: gun.maxRangeM, cycleMs: gun.reloadMs })
    }
    expect(battle).toEqual(before)
    const drone = { ...units[0]!.spec.weapons[0]!, src: 'drone' as const, artId: 'drone-scout', label: 'Drone', kind: 'fixed' as const, count: undefined }
    units[0]!.spec.weapons = [drone, { ...drone }]
    battle.dronePools = { 'player:0': { alive: false, s: 0, a: 0, h: 0, evasion: 0 }, 'player:1': { alive: true, s: 1, a: 1, h: 1, evasion: 0 } }
    const wing = battleWeaponCyclesOf(battle, units.slice(0, 1))[0]!
    expect(wing.count).toBe(2); expect(wing.aliveCount).toBe(1); expect(wing.state).toBe('reload')
  })
  it('同舰相同独立条目只在实际计时和射程相同时合并，不同型号、周期、状态不合并', () => {
    const { state, ships, battle } = fleet()
    state.fleet[ships[0]!]!.fitted.high = ['mod-laser-3']
    const spec = createPlayerSpec(state, ctx, ships[0]!)!
    const laser = spec.weapons.find(w => w.src === 'laser')!
    spec.weapons = [{ ...laser }, { ...laser }, { ...laser, moduleId: 'mod-laser-2' },
      { ...laser, maxRangeM: laser.maxRangeM + 100 }, { ...laser, reloadMs: laser.reloadMs + 100 }]
    battle.units.player!.weapons = spec.weapons.map(() => 50)
    battle.ammo.pla = 100
    const units = [{ spec, shipId: ships[0]!, name: 'Lead' }]
    const rows = battleWeaponCyclesOf(battle, units, ctx)
    expect(rows).toHaveLength(4)
    expect(rows[0]!.count).toBe(2)
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(5)
    battle.units.player!.weapons[1] = 0
    expect(battleWeaponCyclesOf(battle, units, ctx)).toHaveLength(5)
    expect(battleWeaponCyclesOf(battle, units, ctx)[1]!.state).toBe('ready')
  })
  it('武器列表读取各舰真实射程，包含战损、当前波干扰和解除，不借主控数据', () => {
    const { state, ships } = fleet()
    for (const [index, uid] of ships.entries()) {
      state.fleet[uid]!.fitted = { high: [index % 2 ? 'mod-laser-3' : 'mod-turret-kin-3'], mid: [], low: [] }
    }
    state.fleet[ships[1]!]!.damagePlugs = ['range']
    state.warehouse.items['ammo-kinetic-l'] = 10_000
    state.warehouse.items['ammo-plasma-l'] = 10_000
    const card = { ...ctx.anomalies.get('ink-main')!, id: 'compact-range-test', waves: undefined,
      ships: [{ ship: ctx.foeShips!.get('foe-h-ink-jammer')!, count: 1 }] }
    const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, card) }
    const battle = startFleetBattleFor(state, local, ships, card.id, 0)!
    const foes = activeFoeSpecsOf(card, local.balance.battle, 0)
    const net = meJammerNetOf(battle, foes)
    expect(net).toBeGreaterThan(0)
    const view = () => battleArcsFor(state, local, { battle, anomaly: card, leaderShipId: ships[0]! })!
    const before = structuredClone(battle)
    for (const [index, uid] of ships.entries()) {
      const refs = { weaponRanges: [] as Array<{ baseM: number; bonusMul: number }> }
      const raw = createPlayerSpec(state, local, uid, undefined, refs)!
      applyMeJammerDebuff(raw, net, refs.weaponRanges)
      const owner = index ? `ally-${index}` : 'player'
      expect(view().weapons.filter(row => row.ownerTag === owner).map(row => [row.minM, row.maxM]))
        .toEqual(raw.weapons.map(w => [w.minRangeM, w.maxRangeM]))
    }
    expect(view().weapons.find(r => r.ownerTag === 'ally-1' && r.src === 'laser')!.maxM)
      .toBeLessThan(view().weapons.find(r => r.ownerTag === 'ally-3' && r.src === 'laser')!.maxM)
    expect(battle).toEqual(before)
    const suppressed = view().weapons.find(r => r.ownerTag === 'player' && r.src === 'turret')!.maxM
    for (const f of foes) battle.units[f.tag]!.hp = { s: 0, a: 0, h: 0 }
    expect(view().weapons.find(r => r.ownerTag === 'player' && r.src === 'turret')!.maxM).toBeGreaterThan(suppressed)
  })
  it('动态叠光／连发周期和无弹、全损、沉没有真实状态', () => {
    const { state, ships, battle } = fleet(), spec = createPlayerSpec(state, ctx, ships[0]!)!
    spec.weapons = [{ ...spec.weapons[0]!, label: 'Laser', kind: 'beam', src: 'laser', fixedType: 'plasma', reloadMs: 4000, burst: { shots: 3, gapMs: 100 } }]
    const units = [{ spec, shipId: ships[0]!, name: 'Lead' }]
    battle.units.player!.weapons = [50]; battle.ammo.pla = 100; battle.meBurstFired = { 'player#0': 1 }
    expect(battleWeaponCyclesOf(battle, units)[0]).toMatchObject({ cycleMs: 100, remainingMs: 50, percent: 50 })
    delete battle.meBurstFired; battle.meOverlayReload = { 'player#0': { r: 2000, f: 2 } }
    expect(battleWeaponCyclesOf(battle, units)[0]!.cycleMs).toBe(2000)
    battle.ammo.pla = 0; expect(battleWeaponCyclesOf(battle, units)[0]!.state).toBe('no-ammo')
    battle.units.player!.hp = { s: 0, a: 0, h: 0 }; expect(battleWeaponCyclesOf(battle, units)[0]!.state).toBe('down')
  })
  it('四舰投网：长步小步一致，不会累减至速度地板，僚舰来源明确', () => {
    const { state, battle, local, card } = fleet(), other = structuredClone(state), short = structuredClone(battle)
    state.gameMs = 1000; advanceBattleFor(state, local, battle, state.shipId, card.id)
    for (let t = 100; t <= 1000; t += 100) { other.gameMs = t; advanceBattleFor(other, local, short, other.shipId, card.id) }
    expect(battle.foeSpeedMps).toBe(short.foeSpeedMps)
    expect(battle.foeSpeedMps).toBeGreaterThan(100)
    const view = battleArcsFor(state, local, { battle, anomaly: card, leaderShipId: state.shipId })!
    expect(view.webLinks).toHaveLength(4)
    expect(view.webLinks!.filter(l => l.from.startsWith('ally-'))).toHaveLength(3)
    expect(view.webLinks!.every(l => l.fromName && l.toName && l.slowPct === .5)).toBe(true)
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))!.foeWebDebuffs).toEqual(battle.foeWebDebuffs)
  })
  it('只有僚舰带网仍有链接和周期，断网、目标／施放舰死亡不留链接', () => {
    const { state, ships, battle, local, card } = fleet()
    for (const uid of [ships[0]!, ships[2]!, ships[3]!]) state.fleet[uid]!.fitted.mid = []
    state.gameMs = 100; advanceBattleFor(state, local, battle, state.shipId, card.id)
    const view = () => battleArcsFor(state, local, { battle, anomaly: card, leaderShipId: state.shipId })!
    expect(view().webLinks?.[0]!.from).toBe('ally-1')
    expect(view().devices.find(d => d.kind === 'web')).toMatchObject({ ownerTag: 'ally-1', state: 'active' })
    battle.distanceM = 5000; state.gameMs = 200; advanceBattleFor(state, local, battle, state.shipId, card.id)
    expect(view().webLinks).toBeUndefined(); expect(view().devices.find(d => d.kind === 'web')!.state).toBe('cooldown')
    battle.foeWebDebuffs = { 'foe-0': { byTag: 'ally-1', slowMul: .5, noThruster: true, noEvasion: true, atMs: 100 } }
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }; expect(view().webLinks).toBeUndefined()
  })
  it('复用规格的网解除后恢复基础值，巢母单舰无网不会低于240', () => {
    const { state, ships, battle, local, card } = fleet(), foes = activeFoeSpecsOf(card, ctx.balance.battle, 0)
    const spec = createPlayerSpec(state, ctx, ships[0]!)!
    const mother = foes[0]!, base = mother.speedMps
    applyFoeWebDebuff(mother, { byTag: 'player', slowMul: .5, noThruster: true, noEvasion: true, atMs: 0 })
    battle.myWebs = { player: { cooldownUntilMs: 1e9 } }; delete battle.foeWebDebuffs
    advanceMyCaptureWebs(state, battle, [spec], foes)
    expect(mother.speedMps).toBe(base)
    for (const uid of ships) state.fleet[uid]!.fitted.mid = []
    for (const f of foes) seedUnit(battle, f)
    for (const [tag, u] of Object.entries(battle.units)) if (u.side === 'foe' && tag !== mother.tag) u.hp = { s: 0, a: 0, h: 0 }
    state.gameMs = 1000; advanceBattleFor(state, local, battle, state.shipId, card.id)
    expect(battle.foeSpeedMps).toBeGreaterThanOrEqual(240)
    expect(cleanBattle(JSON.parse(JSON.stringify(battle)))!.units[mother.tag]!.foeShipId).toBe('foe-alien-broodmother')
  })
})
