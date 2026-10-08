import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { activeFoeSpecsOf, createBattleState, foesWithSupport, resolveFoeSummon } from '../src/foeSpecs'
import { advanceBattleFor, battleArcsFor, BATTLE_STEP_MS, createPlayerSpec, foeStandbyReadyOf, startFleetBattleFor, withStandbyShield } from '../src/combat'
import { baseFoeTag, foeShipEliteOf, foeShipIdOfTag, foeShipTierOf, foeUnitNameOf } from '../src/foeCard'
import { coronaFleetRangeBonusOf, syncCoronaFleetFocus } from '../src/coronaFocus'
import { foeDroneRangeOf, foeGunMaxRangeOf, foeGunPowerFactorOf } from '../src/foeRange'
import { cleanBattle } from '../src/saveBattleClean'
import { createInitialState, type BattleState } from '../src/state'
import { addShipToFleet, loadSaveFile, serializeSaveFile } from '../src/index'
import { FOE_MOUNT_IDS } from '../src/foeMounts'
import { applyDamage } from '../src/combatMath'

const ctx = buildSimContext(), bal = ctx.balance.battle
const card = ctx.anomalies.get('corona-nexus')!
function fixture() {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  state.shipId = addShipToFleet(state, 'sh-thresher')
  const foes = activeFoeSpecsOf(card, bal, 3)
  const battle = createBattleState(createPlayerSpec(state, ctx, state.shipId)!, foes, 10_000, 9000)
  battle.waveIdx = 3
  battle.foeWaveStartMs = 10_000
  battle.distanceM = 9000
  const nexus = foes.find(f => f.foeSummonEscort)!, overlay = foes.find(f => f.foeOverlayDrive)!
  const dusk = foes.find(f => f.foeStandbyShield)!
  return { state, battle, foes, nexus, overlay, dusk }
}
function down(b: BattleState, tag: string) { b.units[tag]!.hp = { s: 0, a: 0, h: 0 } }

describe('中枢固定叠光召唤', () => {
  it('仅中枢挂件，首次入场满60秒，不借原空槽的舰型', () => {
    const { state, battle, foes, nexus, overlay, dusk } = fixture()
    expect(nexus.foeSummonEscort).toEqual({ everyMs: 60_000, count: 1, shipId: overlay.foeShipId, formationSlots: true })
    expect(foes.filter(f => f.foeSummonEscort)).toHaveLength(1)
    battle.units[nexus.tag]!.enteredAtMs = 20_000
    down(battle, dusk.tag)
    resolveFoeSummon(state, battle, foes, bal, 79_999)
    expect(battle.foeReviveCount).toBeUndefined()
    resolveFoeSummon(state, battle, foes, bal, 80_000)
    const support = foesWithSupport(battle, foes).find(f => f.tag.startsWith('sup'))!
    expect(baseFoeTag(support.tag)).toBe(dusk.tag)
    expect(support.foeShipId).toBe(overlay.foeShipId)
    expect(support.weapons).toEqual(overlay.weapons)
    expect(support.foeOverlayDrive).toEqual(overlay.foeOverlayDrive)
    expect(support.foeBlink).toEqual(overlay.foeBlink)
    expect(support.foeStandbyShield).toBeUndefined()
    expect(battle.units[support.tag]).toMatchObject({ hp: overlay.hp, hpMax: overlay.hp, enteredAtMs: 80_000 })
    expect(battle.units[support.tag]!.weapons[0]).toBeGreaterThanOrEqual(4_500)
    expect(battle.foeOverlayReload?.[support.tag]).toBeUndefined()
    expect(battle.notices?.at(-1)).toMatchObject({ textId: 'core.combat.001', textParams: { p1: support.name, p2: 1 } })
    expect(foeShipIdOfTag(card, support.tag)).toBe(overlay.foeShipId)
    expect(foeUnitNameOf(card, support.tag)).toBe(overlay.name)
    expect(foeShipTierOf(card, support.tag)).toBe(3)
    expect(foeShipEliteOf(card, support.tag)).toBe(false)
  })
  it('满员跳过不积攒，多空位只补一艘，同槽可反复补，中枢死后停', () => {
    const { state, battle, foes, nexus, dusk } = fixture()
    resolveFoeSummon(state, battle, foes, bal, 70_000)
    expect(battle.foeReviveCount).toBeUndefined()
    expect(battle.foeSummonAtMs![nexus.tag]).toBe(130_000)
    for (const f of foes) if (f !== nexus) down(battle, f.tag)
    resolveFoeSummon(state, battle, foes, bal, 70_001)
    expect(battle.foeReviveCount).toBeUndefined()
    resolveFoeSummon(state, battle, foes, bal, 130_000)
    expect(battle.foeReviveCount).toBe(1)
    resolveFoeSummon(state, battle, foes, bal, 190_000)
    resolveFoeSummon(state, battle, foes, bal, 250_000)
    expect(battle.foeReviveCount).toBe(3)
    resolveFoeSummon(state, battle, foes, bal, 310_000)
    expect(battle.foeReviveCount).toBe(3)
    const sup = foesWithSupport(battle, foes).find(f => f.tag.startsWith('sup') && baseFoeTag(f.tag) === dusk.tag)!
    down(battle, sup.tag)
    resolveFoeSummon(state, battle, foes, bal, 370_000)
    expect(battle.foeReviveCount).toBe(4)
    expect(foesWithSupport(battle, foes).filter(f => battle.units[f.tag]!.hp.h > 0)).toHaveLength(4)
    down(battle, nexus.tag)
    for (const f of foesWithSupport(battle, foes)) down(battle, f.tag)
    resolveFoeSummon(state, battle, foes, bal, 430_000)
    expect(battle.foeReviveCount).toBe(4)
  })
  it('完整存档往返保留型号、空槽、计时；换波不把旧支援算进来', () => {
    const { state, battle, foes, nexus, dusk } = fixture()
    down(battle, dusk.tag)
    resolveFoeSummon(state, battle, foes, bal, 70_000)
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = card.id
    state.expedition.battle = battle
    const loaded = loadSaveFile(serializeSaveFile(state, 0)).state.expedition.battle!
    expect(loaded.foeSummonAtMs).toEqual(battle.foeSummonAtMs)
    expect(loaded.foeReviveCount).toBe(1)
    const support = foesWithSupport(loaded, foes).find(f => f.tag.startsWith('sup'))!
    expect(support.foeShipId).toBe('foe-r-corona-overlay')
    expect(loaded.units[support.tag]!.hp).toEqual(battle.units[support.tag]!.hp)
    resolveFoeSummon(state, loaded, foes, bal, 129_999)
    expect(loaded.foeReviveCount).toBe(1)
    expect(loaded.foeSummonAtMs![nexus.tag]).toBe(130_000)
    expect(foesWithSupport(loaded, activeFoeSpecsOf(card, bal, 2)).some(f => f.tag === support.tag)).toBe(false)
  })
  it('开关关闭和无件战斗不创建召唤账本', () => {
    const f = fixture()
    resolveFoeSummon(f.state, f.battle, f.foes, { ...bal, foeReviveEnabled: false }, 999_999)
    expect(f.battle.foeSummonAtMs).toBeUndefined()
    resolveFoeSummon(f.state, f.battle, f.foes.map(foe => ({ ...foe, foeSummonEscort: undefined })), bal, 999_999)
    expect(f.battle.foeSummonAtMs).toBeUndefined()
  })
  it('按实时小段与一次离线推进，同样在60秒和120秒补舰', () => {
    const build = () => {
      const { state } = fixture()
      const single = { ...card, waves: undefined, ships: card.ships!.filter(s => s.wave === 3).map(s => ({ ...s, wave: 0 })) }
      const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, single) }
      const battle = startFleetBattleFor(state, local, [state.shipId], single.id, 0, 5000)!
      for (const u of Object.values(battle.units)) u.hp = { s: 1e8, a: 1e8, h: 1e8 }
      const foes = activeFoeSpecsOf(single, bal, 0)
      down(battle, foes.find(f => f.foeStandbyShield)!.tag)
      down(battle, foes.find(f => f.foeFlashOverload)!.tag)
      return { state, local, battle }
    }
    const online = build(), offline = build()
    for (let time = 100; time <= 125_000; time += 100) {
      online.state.gameMs = time
      advanceBattleFor(online.state, online.local, online.battle, online.state.shipId, card.id)
    }
    offline.state.gameMs = 125_000
    advanceBattleFor(offline.state, offline.local, offline.battle, offline.state.shipId, card.id)
    for (const f of [online, offline]) {
      expect(f.battle.foeReviveCount).toBe(2)
      expect(Object.values(f.battle.units).filter(u => u.tag.startsWith('sup')).map(u => u.enteredAtMs)).toEqual([60_000, 120_000])
    }
    expect(offline.battle.foeSummonAtMs).toEqual(online.battle.foeSummonAtMs)
    expect(offline.battle.units).toEqual(online.battle.units)
    expect(offline.state.rng).toEqual(online.state.rng)
  })
})

describe('聚焦全队射程', () => {
  it.each([0, 60_000, 120_000])('时长%i，全队同进度，僚舰仍保留原衰减', elapsed => {
    const { battle, foes, overlay } = fixture()
    battle.lastTickGameMs = 10_000 + elapsed
    const bonus = 2 * Math.min(1, elapsed / 120_000)
    for (const f of foes) expect(foeGunMaxRangeOf(battle, f, f.weapons[0]!)).toBe(Math.round(f.weapons[0]!.maxRangeM * (1 + bonus)))
    const w = overlay.weapons[0]!
    const max = foeGunMaxRangeOf(battle, overlay, w)
    expect(foeGunPowerFactorOf(battle, overlay, w, max)).toBeCloseTo(w.falloff)
    expect(foeDroneRangeOf(battle, { ...w, src: 'drone' })).toBe(Math.round(w.maxRangeM * (1 + bonus)))
    battle.meFoeRangeDebuff = 0.6
    expect(foeGunMaxRangeOf(battle, overlay, w)).toBe(Math.round(w.maxRangeM * (1 + bonus - 0.6)))
  })
  it('新召立即获当前增程，中枢被毁立即失效，多个来源取最高', () => {
    const { state, battle, foes, nexus, overlay, dusk } = fixture()
    battle.lastTickGameMs = 130_000
    down(battle, dusk.tag)
    resolveFoeSummon(state, battle, foes, bal, 130_000)
    const supported = foesWithSupport(battle, foes), support = supported.at(-1)!
    expect(foeGunMaxRangeOf(battle, support, support.weapons[0]!)).toBe(33_000)
    syncCoronaFleetFocus(battle, [...supported, { ...overlay, foeFocusArray: { rampMs: 120_000, rangeBonusPct: 1 } }])
    expect(coronaFleetRangeBonusOf(battle)).toBe(2)
    down(battle, nexus.tag)
    expect(coronaFleetRangeBonusOf(battle)).toBe(1)
    syncCoronaFleetFocus(battle, supported)
    expect(foeGunMaxRangeOf(battle, support, support.weapons[0]!)).toBe(11_000)
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    expect(loaded.foeFocusArrays).toBeUndefined()
    syncCoronaFleetFocus(loaded, supported)
    expect(coronaFleetRangeBonusOf(loaded)).toBe(0)
    battle.foeWaveStartMs = battle.lastTickGameMs
    expect(coronaFleetRangeBonusOf(battle)).toBe(0)
  })
})

describe('真实战斗闭环', () => {
  it('离线推进不预召，支援真开火、能受击、挡判胜，射程视图同源', () => {
    const f = fixture(), { state } = f
    const single = { ...card, waves: undefined, ships: card.ships!.filter(s => s.wave === 3).map(s => ({ ...s, wave: 0 })) }
    const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, single), balance: { ...ctx.balance, battle: { ...bal, shieldRegenPerSec: 0 } } }
    state.fleet[state.shipId]!.fitted = { high: ['mod-laser-3'], mid: [], low: [] }
    state.moduleBay['mod-laser-3'] = 1
    state.warehouse.items['ammo-plasma-l'] = 99999
    const battle = startFleetBattleFor(state, local, [state.shipId], single.id, 0, 5000)!
    const foes = activeFoeSpecsOf(single, bal, 0)
    const dusk = foes.find(f => f.foeStandbyShield)!, nexus = foes.find(f => f.foeFocusArray)!
    for (const u of Object.values(battle.units)) u.hp = { s: 1e8, a: 1e8, h: 1e8 }
    down(battle, dusk.tag)
    state.gameMs = 60_000
    advanceBattleFor(state, local, battle, state.shipId, single.id)
    expect(battle.foeReviveCount).toBeUndefined()
    state.gameMs = 60_000 + BATTLE_STEP_MS
    advanceBattleFor(state, local, battle, state.shipId, single.id)
    expect(battle.foeReviveCount).toBe(1)
    const support = foesWithSupport(battle, foes).find(f => f.tag.startsWith('sup'))!
    expect(battle.units[support.tag]!.enteredAtMs).toBe(60_000)
    for (const f of foes) down(battle, f.tag)
    battle.units[support.tag]!.hp = { s: 1e6, a: 1e6, h: 1e6 }
    const shots = battle.stats.foeShots, hits = battle.stats.meHits, dmg = battle.stats.meDmg
    state.gameMs = 75_000
    advanceBattleFor(state, local, battle, state.shipId, single.id)
    expect(battle.stats.foeShots).toBeGreaterThan(shots)
    expect(battle.stats.meHits).toBeGreaterThan(hits)
    expect(battle.stats.meDmg).toBeGreaterThan(dmg)
    expect(battle.ended).toBeNull()
    battle.units[nexus.tag]!.hp.h = 1
    battle.foeWaveStartMs = battle.lastTickGameMs - 120_000
    const arcs = battleArcsFor(state, local, { battle, anomaly: single, leaderShipId: state.shipId })!
    expect(arcs.foeBands.some(band => band.names.includes(support.name) && band.maxM === 33_000)).toBe(true)
    down(battle, nexus.tag)
    down(battle, support.tag)
    state.gameMs += 100
    advanceBattleFor(state, local, battle, state.shipId, single.id)
    expect(battle.ended).toBe('me')
  })
  it.each(['kinetic', 'explosive', 'plasma'] as const)('垂暮%s抗性只作用护盾层，窗口外无常驻', type => {
    const { battle, dusk } = fixture()
    const ready = 22_000
    const hp = { s: 10000, a: 10000, h: 10000 }
    const base = applyDamage(hp, dusk.resists, 100, type)
    battle.foeBlinks = { [dusk.tag]: ready }
    battle.lastTickGameMs = 11_000
    const current = () => foeStandbyReadyOf(battle, dusk) ? withStandbyShield(dusk.resists, dusk.foeStandbyShield!.resistPct) : dusk.resists
    const resists = current()
    expect(applyDamage(hp, resists, 100, type).dealt).toBeCloseTo(base.dealt / 2)
    expect(resists.armor).toEqual(dusk.resists.armor)
    expect(resists.hull).toEqual(dusk.resists.hull)
    battle.lastTickGameMs = ready
    expect(current()).toEqual(dusk.resists)
    delete battle.foeBlinks[dusk.tag]
    battle.lastTickGameMs += 100
    expect(current()).toEqual(dusk.resists)
  })
})

it('召唤挂载名中英齐备', () => {
  const { nexus } = fixture()
  expect(nexus.foeMountNames).toContain('叠光支援信标')
  expect(nexus.foeMountNamePairs).toContainEqual(['叠光支援信标', 'Overlay Support Beacon'])
  expect(nexus.foeMountNames).toHaveLength(3)
  expect(FOE_MOUNT_IDS.coronaOverlayBeacon).toBe('foe-mount-corona-overlay-beacon')
})
