import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import type { UnitSpec } from '../src/combat/model'
import { createBattleState } from '../src/combat/foes/state'
import { createFoeSpecs, flagshipBattleLedger } from '../src/combat/foes/catalog'
import { applyFoeOverride } from '../src/combat/cards'
import { enemyFormationCard } from '../src/combat/formation'
import { foeShipHpMulOf } from '../src/combat/foePower'
import { stepBattle } from '../src/combat/step'
import { startFleetBattleFor } from '../src/combat/startFleet'
import { advanceBattleFor } from '../src/combat/advance'
import { steadyPreview, bountyDamageForecast } from '../src/combat/preview'
import { passiveShieldRateOf, passiveShieldBreakSeconds, passiveArmorBreakSeconds } from '../src/combat/passiveRecovery'
import { cleanBattle } from '../src/combat/save/clean'
import { ceilFinalQuantity } from '../src/quantity'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { weekendApplyBattleOutcome } from '../src/invasion/battle/outcome'
import { weekendStartFlagshipBattle } from '../src/weekendLaunch'
import { flagshipRawLeftOf, weekendBossPoolView, weekendFlagshipLayersOf, weekendFlagshipSharesOf, weekendFlagshipSlotOf,
  weekendNoteFlagshipDamage, weekendOctopusTick } from '../src/invasion/event/boss'
import { WEEKEND_FLAGSHIP_POOL_HP } from '../src/invasion/event/constants'
import { signalAutoCombatRatio } from '../src/signalAuto/combat'
import { createPlayerSpec } from '../src/combat/player/create'
import type { SimContext } from '../src/types'
import { setCardDistance } from './helpers/battle-card-memory'

const ctx = buildSimContext()
const now = new Date(2026, 10, 4, 20).getTime()
const bal = { ...ctx.balance.battle, shieldRegenPerSec: .012 }

function unit(tag: string, side: 'me' | 'foe'): UnitSpec {
  return { tag, side, name: tag, foeTactic: 'orbit', hp: { s: 1000, a: 100, h: 100 }, resists: {},
    evasion: 0, hitBonus: 0, signatureM: 100, scanResMm: 100, speedMps: 0, agility: 0,
    weapons: [{ label: '', kind: 'fixed', shotDmg: 0, minRangeM: 0, maxRangeM: 10000,
      hitRate: 0, falloff: 1, reloadMs: 1e9 }] }
}

function world() {
  const state = createInitialState({ nowWallMs: now, seed: 17 })
  const me = unit('player', 'me'), foe = unit('foe-0', 'foe')
  const battle = createBattleState(me, [foe], 0, 1000)
  battle.distanceM = 1000
  for (const rt of Object.values(battle.units)) rt.weapons.fill(1e9)
  return { state, me, foe, battle }
}

describe('敌舰被动回盾每拍与解析公式', () => {
  it.each([[800, 809.6], [500, 506], [100, 106], [0, 0], [1000, 1000], [999, 1000]])('当前盾%s一秒后为%s', (current, expected) => {
    const w = world()
    w.battle.units[w.foe.tag]!.hp.s = current
    stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, bal, 1000)
    expect(w.battle.units[w.foe.tag]!.hp.s).toBeCloseTo(expected, 10)
  })

  it('100ms小数持续累计、敌机不恢复，费率0同时关闭敌我回盾', () => {
    const w = world(), rt = w.battle.units[w.foe.tag]!
    rt.hp.s = 100
    w.battle.units.player!.hp.s = 100
    w.battle.foeDronePools = { [w.foe.tag]: [{ s: 10, a: 2, h: 2, maxS: 100, alive: true, evasion: 0 }] }
    const pools = structuredClone(w.battle.foeDronePools)
    for (let i = 0; i < 10; i++) stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, bal, 100)
    expect(rt.hp.s).toBeCloseTo(106, 10)
    expect(w.battle.foeDronePools).toEqual(pools)
    const before = [rt.hp.s, w.battle.units.player!.hp.s]
    stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, { ...bal, shieldRegenPerSec: 0 }, 1000)
    expect([rt.hp.s, w.battle.units.player!.hp.s]).toEqual(before)
  })

  it.each([{ s: 0, a: 0, h: 0 }, { s: 10, a: 0, h: 0 }])('阵亡或甲结构均空不恢复：%j', hp => {
    const w = world()
    w.battle.units[w.foe.tag]!.hp = { ...hp }
    stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, bal, 1000)
    expect(w.battle.units[w.foe.tag]!.hp).toEqual(hp)
  })

  it('C零甲活船按hpMax自愈、维持旧镀层账、无修复输出额外倍率、满甲封顶、死亡停修', () => {
    const w = world(), rt = w.battle.units.player!
    w.me.armorRegenPerSec = .006
    w.me.repairOutputBonusPct = 10
    rt.hp = { s: 0, a: 0, h: 1, coating: { armor: 0, maxArmor: 80 } }
    stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, bal, 100)
    expect(rt.hp.a).toBeCloseTo(.06)
    expect(rt.hp.coating!.armor).toBeCloseTo(.06)
    rt.hp.a = 99.99
    stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, bal, 1000)
    expect(rt.hp.a).toBe(100)
    rt.hp = { s: 0, a: 0, h: 0 }
    stepBattle(w.state, w.battle, [w.me], [w.foe], 1000, 1000, bal, 1000)
    expect(rt.hp.a).toBe(0)
  })

  it('解析分段、托底、零盾、关闭、装甲自愈均使用同一费率', () => {
    expect(passiveShieldRateOf(800, 1000, .012)).toBeCloseTo(9.6)
    expect(passiveShieldRateOf(100, 1000, .012)).toBe(6)
    expect(passiveShieldRateOf(100, 1000, 0)).toBe(0)
    expect(passiveShieldBreakSeconds(100, 1000, 10, .012)).toBe(25)
    expect(passiveShieldBreakSeconds(1000, 1000, 12, .012)).toBe(Infinity)
    expect(passiveShieldBreakSeconds(0, 1000, 10)).toBe(0)
    expect(passiveShieldBreakSeconds(100, 1000, 10, 0)).toBe(10)
    expect(passiveArmorBreakSeconds(100, 100, 1, .006)).toBe(250)
    expect(passiveArmorBreakSeconds(100, 100, .6, .006)).toBe(Infinity)
  })
})

describe('旗舰卡面回盾基准与共享池跨场恢复', () => {
  it('派生卡放入ctx且开战不传覆写时，仍按规格基准回盾并封顶共享池容量', () => {
    const state = createInitialState({ nowWallMs: now, seed: 17 })
    const base = ctx.anomalies.get('ink-flagship')!, slot = weekendFlagshipSlotOf(base)!
    const ship = { ...slot.ship, mounts: [], drones: [], hp: 2000, split: { s: .3, a: .4, h: .3 } }
    const card = { ...base, id: 'passive-derived-regression', ships: [{ ship, hpMul: 2.5 }], waves: undefined, foeFormation: undefined }
    const cardMax = createFoeSpecs(card, bal)[0]!.hp.s
    const derived = applyFoeOverride(card, { bossShipId: ship.id, bossHp: 7300,
      bossHpLayers: { s: 300, a: 4000, h: 3000 }, bossMaxLayers: { s: 3000, a: 4000, h: 3000 } })
    const local = { ...ctx, anomalies: new Map(ctx.anomalies).set(card.id, derived), balance: { ...ctx.balance, battle: bal } }
    const battle = startFleetBattleFor(state, local, [state.shipId], card.id)!
    expect(battle.foeOverride).toBeUndefined()
    const rt = Object.values(battle.units).find(unit => unit.foeShipId === ship.id)!
    expect(rt.hpMax!.s).toBe(300)
    for (const unit of Object.values(battle.units)) unit.weapons.fill(1e9)
    const advance = () => {
      state.gameMs += 1000
      advanceBattleFor(state, local, battle, state.shipId, card.id)
    }
    advance()
    expect(rt.hp.s).toBeCloseTo(300 + cardMax * .006)
    rt.hp.s = 2999.99
    advance()
    expect(rt.hp.s).toBe(3000)
    rt.hp.s = 0
    advance()
    expect(rt.hp.s).toBe(0)
  })

  it.each(['raw', 'fixed'] as const)('%s卡覆写前保留含卡倍率、族容量、统一容量倍率的护盾', mode => {
    const base = ctx.anomalies.get('alien-hivemother') ?? ctx.anomalies.get('ink-flagship')!
    const slot = weekendFlagshipSlotOf(base)!
    const ship = { ...slot.ship, family: 'C' as const, hp: 2000, split: { s: .3, a: .4, h: .3 } }
    const original = { ...base, ships: [{ ship, hpMul: 2.5 }], waves: undefined, foeFormation: undefined }
    const card = mode === 'fixed' ? enemyFormationCard(original, bal, { counts: [1], boostSlots: [0], hpMul: 1.2 }) : original
    const cardMax = createFoeSpecs(card, bal)[0]!.hp.s
    expect(cardMax).toBe(ceilFinalQuantity(2000 * 2.5 * .3 * foeShipHpMulOf('C') * (mode === 'fixed' ? 1.2 : 1)))
    const override = { bossShipId: ship.id, bossHp: 7300, bossHpLayers: { s: 300, a: 4000, h: 3000 }, bossMaxLayers: { s: 3000, a: 4000, h: 3000 } }
    const foe = createFoeSpecs(applyFoeOverride(card, override), bal)[0]!
    expect(foe.shieldRegenMax).toBe(cardMax)
    const w = world()
    const battle = createBattleState(w.me, [foe], 0, 1000)
    battle.distanceM = 1000
    battle.foeOverride = override
    for (const rt of Object.values(battle.units)) rt.weapons.fill(1e9)
    stepBattle(w.state, battle, [w.me], [foe], 1000, 1000, bal, 1000)
    expect(battle.units[foe.tag]!.hp.s).toBeCloseTo(300 + cardMax * .006)
    expect(battle.units[foe.tag]!.hpMax!.s).toBe(300)
    battle.units[foe.tag]!.hp.s = 2999.99
    stepBattle(w.state, battle, [w.me], [foe], 1000, 1000, bal, 1000)
    expect(battle.units[foe.tag]!.hp.s).toBe(3000)
    battle.units[foe.tag]!.hp.s = 0
    stepBattle(w.state, battle, [w.me], [foe], 1000, 1000, bal, 1000)
    expect(battle.units[foe.tag]!.hp.s).toBe(0)
  })

  it('负净损失经真实outcome入池、读档与跨场保留小数、原贡献不变，旧场重复结算幂等', () => {
    const w = world(), state = w.state
    const card = ctx.anomalies.get('ink-flagship')!, boss = weekendFlagshipSlotOf(card)!
    state.exploredGalaxies = [...ctx.galaxies.keys()]
    state.standings.dsi = 100
    state.standingsEarned = { dsi: 100 }
    state.weekendEvent = { seq: 1, startedAtWallMs: now, coreId: 'galaxy-maw', peripheryIds: [], family: 'H',
      contributed: { 'galaxy-maw': 1 }, flagshipHpMax: WEEKEND_FLAGSHIP_POOL_HP, flagshipHpDone: 100, octopusHpDone: 200 }
    const ev = state.weekendEvent, shares = weekendFlagshipSharesOf(ev)
    const caps = { s: WEEKEND_FLAGSHIP_POOL_HP * .2, a: WEEKEND_FLAGSHIP_POOL_HP * .55, h: WEEKEND_FLAGSHIP_POOL_HP * .25 }
    const layers = weekendFlagshipLayersOf(WEEKEND_FLAGSHIP_POOL_HP - 300, caps)
    const foe = { ...w.foe, foeShipId: boss.ship.id, hp: { ...layers } }
    const battle = createBattleState(w.me, [foe], 111, 1000)
    battle.distanceM = 1000
    battle.foeOverride = { bossHp: WEEKEND_FLAGSHIP_POOL_HP - 300, bossShipId: boss.ship.id, bossMaxLayers: caps }
    battle.units[foe.tag]!.hp.s += 75.125
    expect(flagshipBattleLedger(battle, [boss.ship.id]).rawDmg).toBe(-75.125)
    weekendApplyBattleOutcome(state, ctx, card.id, false, now, battle, { kind: 'flagship', galaxyId: ev.coreId })
    expect(ev.flagshipHpRecovered).toBe(75.125)
    expect(flagshipRawLeftOf(ev)).toBe(WEEKEND_FLAGSHIP_POOL_HP - 224.875)
    expect(weekendBossPoolView(state, ev)!.hpLeft).toBe(flagshipRawLeftOf(ev))
    expect(weekendFlagshipSharesOf(ev)).toEqual(shares)
    state.encounter = { ...state.encounter, active: true, battle, anomalyId: card.id, galaxyId: ev.coreId, shipId: state.shipId }
    const saved = loadSaveFile(serializeSaveFile(state, now)).state
    expect(saved.weekendEvent!.flagshipHpRecovered).toBe(75.125)
    weekendApplyBattleOutcome(saved, ctx, card.id, false, now, saved.encounter.battle!, { kind: 'flagship', galaxyId: ev.coreId })
    expect(saved.weekendEvent!.flagshipHpRecovered).toBe(75.125)
    weekendNoteFlagshipDamage(saved.weekendEvent!, 10, 222)
    weekendNoteFlagshipDamage(saved.weekendEvent!, -75.125, 111)
    expect(saved.weekendEvent!.flagshipHpRecovered).toBe(75.125)
    expect(saved.weekendEvent!.flagshipHpDone).toBe(110)
    saved.encounter.active = false
    saved.encounter.battle = null
    const next = weekendStartFlagshipBattle(saved, ctx, now, [saved.shipId])!
    expect(next).toBeTruthy()
    expect(next.foeOverride!.bossHp).toBe(flagshipRawLeftOf(saved.weekendEvent))
    expect(next.foeOverride!.bossHpLayers!.s).toBeCloseTo(caps.s - 234.875)
    next.distanceM = 1000
    next.droneCommandVolumeM3 = 12.5
    const cleaned = cleanBattle(next)!
    expect(cleaned.foeOverride!.bossHp).toBe(next.foeOverride!.bossHp)
    expect(cleaned.droneCommandVolumeM3).toBe(12.5)
    const before = flagshipRawLeftOf(saved.weekendEvent)
    weekendOctopusTick(saved, saved.weekendEvent!, 1000, false)
    expect(flagshipRawLeftOf(saved.weekendEvent)).toBeLessThan(before)
  })

  it('恢复不超过原始池容量，恢复后的池仍可由章鱼完整削空', () => {
    const w = world()
    const ev = { seq: 1, startedAtWallMs: now, coreId: 'galaxy-maw', peripheryIds: [], family: 'H',
      contributed: {}, flagshipHpMax: 1000, flagshipHpDone: 0, octopusHpDone: 500 }
    weekendNoteFlagshipDamage(ev, -1000, 1)
    expect(flagshipRawLeftOf(ev)).toBe(1000)
    expect(weekendOctopusTick(w.state, ev, 24 * 3600_000, false)).toBe(true)
    expect(flagshipRawLeftOf(ev)).toBe(0)
  })
})

describe('解析预估消费敌盾与C自愈', () => {
  it('敌盾拉长击破时间，旋钮0关闭回盾；零盾卡没有延长', () => {
    const state = createInitialState({ nowWallMs: now, seed: 3 })
    const base = ctx.anomalies.get('ink-flagship')!, slot = weekendFlagshipSlotOf(base)!
    const ship = { ...slot.ship, hp: 200, mounts: [], drones: [], split: { s: .2, a: .5, h: .3 }, shotDmg: 10 }
    const card = { ...base, ships: [{ ship }], waves: undefined, foeFormation: undefined }
    setCardDistance(state, ctx, card.id, 500)
    const local = { ...ctx, balance: { ...ctx.balance, battle: { ...bal, shieldRegenPerSec: 0 } } }
    const off = steadyPreview(state, local, card, state.shipId, 1, 1)!
    const on = steadyPreview(state, { ...local, balance: { ...local.balance, battle: bal } }, card, state.shipId, 1, 1)!
    expect(on.meDps).toBeGreaterThan(0)
    expect(on.ttrFoe).toBeGreaterThan(off.ttrFoe)
    const zero = { ...card, ships: [{ ship: { ...ship, split: { s: 0, a: .7, h: .3 } } }] }
    const zeroPreview = steadyPreview(state, ctx, zero, state.shipId, 1, 1)!
    expect(zeroPreview.ttrFoe).toBeCloseTo(zeroPreview.foeHpTotal / zeroPreview.meDps)
  })

  it('C自愈延长我方破甲时间并进入自动探索支援预算', () => {
    const state = createInitialState({ nowWallMs: now, seed: 3 })
    state.shipId = addShipToFleet(state, 'sh-nautilus')
    state.fleet[state.shipId]!.fitted = { high: ['mod-laser-3', 'mod-laser-3', 'mod-laser-3'], mid: [], low: [] }
    const plug = ctx.modules.get('plug-alien-nanobiomass')!
    state.fleet[state.shipId]!.plugs = [plug.id]
    const off: SimContext = { ...ctx, modules: new Map(ctx.modules).set(plug.id, { ...plug, armorRegenPerSec: 0 }) }
    const card = ctx.anomalies.get('ink-flagship')!
    const withC = steadyPreview(state, ctx, card, state.shipId, 1, 1)!
    const withoutC = steadyPreview(state, off, card, state.shipId, 1, 1)!
    expect(createPlayerSpec(state, ctx, state.shipId)!.armorRegenPerSec).toBe(.006)
    expect(withC.ttrMe).toBeGreaterThan(withoutC.ttrMe)
    const forecast = bountyDamageForecast(state, ctx, card)
    expect(Number.isNaN(forecast.armorLoss)).toBe(false)
    const ratio = signalAutoCombatRatio(state, ctx, [state.shipId], 'A', 1)
    expect(ratio).toBeGreaterThan(signalAutoCombatRatio(state, off, [state.shipId], 'A', 1))
  })
})
