import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { createInitialState } from '../src/state'
import { fitModule } from '../src/equipment'
import { advanceBattleFor, ammoLoadTotals, battleArcsFor, createPlayerSpec, startBattleFor } from '../src/combat'
import { battleWeaponAmmoCost, consumeBattleWeaponAmmo, refundAmmo, settleWormholeBattleAmmo, weaponNominalAmmoForMs } from '../src/combatAmmo'
import { cleanBattle, BATTLE_PERSIST_KEYS } from '../src/saveBattleClean'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import type { BattleFx } from '../src/state'
import type { FoeShipDef } from '../src/types'

function world(count = 1, stock = 10000, moduleId = 'mod-lair-turret-a') {
  const base = buildSimContext()
  const ships = new Map(base.ships)
  const ship = ships.get('sh-hammerhead')!
  ships.set(ship.id, { ...ship, shieldHp: 0, armorHp: 0, hullHp: 1e9, hullResist: {}, evasion: 0 })
  const foe: FoeShipDef = { id: 'ammo-foe', name: '弹药测试靶', family: 'A', hullClassTier: 3, speedRatio: 0,
    hp: 1e9, split: { s: 0, a: 0, h: 1 }, shotDmg: 0, hitRate: 0, reloadMs: 1000,
    rangeMinM: 1, rangeMaxM: 20000, falloff: 1, tactic: 'orbit', desireRangeM: 1000, evasion: 0 }
  const card = { id: 'ammo-card', name: '弹药测试', galaxyId: 'galaxy-hub', threat: 20,
    standingReq: 0, standingGain: 0, rewardIsk: 0, loot: [], combatSeconds: 120, description: '', ships: [{ ship: foe, count: 1 }] }
  const ctx = { ...base, ships, anomalies: new Map(base.anomalies).set(card.id, card),
    balance: { ...base.balance, battle: { ...base.balance.battle, shieldRegenPerSec: 0, hitMin: 1, hitMax: 1 } } }
  const state = createInitialState({ nowWallMs: 0, seed: 42, prologue: true })
  state.shipId = addShipToFleet(state, ship.id)
  state.moduleBay[moduleId] = count
  for (let i = 0; i < count; i++) expect(fitModule(state, moduleId, ctx).ok).toBe(true)
  state.warehouse.items['ammo-kinetic-l'] = stock
  const battle = startBattleFor(state, ctx, state.shipId, card.id, 0)!
  const spec = createPlayerSpec(state, ctx, state.shipId)!
  const wi = spec.weapons.findIndex(w => w.src === 'turret')
  return { state, ctx, card, battle, spec, wi, weapon: spec.weapons[wi]! }
}
function advance(run: ReturnType<typeof world>, from: number, to: number): BattleFx[] {
  const events: BattleFx[] = []
  for (let at = from + 100; at <= to; at += 100) {
    const seq = run.battle.fxSeq
    run.battle.distanceM = 1000
    run.battle.myDesireM = 1000
    run.state.gameMs = at
    advanceBattleFor(run.state, run.ctx, run.battle, run.state.shipId, run.card.id)
    events.push(...run.battle.fx.filter(f => f.seq >= seq && f.side === 'me' && f.src === 'turret'))
  }
  return events
}

describe('转管炮已付弹药份额', () => {
  it.each([1, 2, 3, 5])('%s门两轮累计每门耗1发，预载与名义耗弹保持整数', count => {
    const run = world(count)
    expect(run.weapon.ammoPerShot).toBe(0.5)
    const before = run.battle.ammo.kin
    const firstCost = battleWeaponAmmoCost(run.battle, 'player', run.wi, 'kinetic', run.weapon)
    expect(firstCost).toBe(Math.ceil(count / 2))
    expect(consumeBattleWeaponAmmo(run.battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    expect(run.battle.ammo.kin).toBe(before - firstCost)
    expect(consumeBattleWeaponAmmo(run.battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    expect(run.battle.ammo.kin).toBe(before - count)
    expect(run.battle.ammoCreditByWeapon).toBeUndefined()
    const full = { ...run.weapon, ammoPerShot: 1 }
    expect(weaponNominalAmmoForMs(run.weapon, 1000)).toBe(count)
    expect(weaponNominalAmmoForMs(run.weapon, 500)).toBe(Math.ceil(count / 2))
    expect(weaponNominalAmmoForMs(run.weapon, 12000)).toBe(weaponNominalAmmoForMs(full, 12000) / 2)
    const wanted = ammoLoadTotals(run.spec, run.ctx.balance.battle, run.state).kinetic!
    const fullWanted = ammoLoadTotals({ ...run.spec, weapons: run.spec.weapons.map((w, i) => i === run.wi ? full : w) }, run.ctx.balance.battle, run.state).kinetic!
    expect(wanted).toBe(fullWanted / 2)
    expect(Number.isSafeInteger(wanted)).toBe(true)
  })
  it('48发实战支持96次转管炮射击，伤害/命中/节拍不变', () => {
    const run = world(1, 48)
    const events = advance(run, 0, 60000)
    expect(events).toHaveLength(96)
    expect(events.every(f => f.hit)).toBe(true)
    expect(run.battle.ammo.kin).toBe(0)
    expect(run.battle.ammoCreditByWeapon).toBeUndefined()
    expect(new Set(events.slice(1).map((e, i) => e.atMs - events[i]!.atMs))).toEqual(new Set([600]))
    expect(events.reduce((sum, e) => sum + (e.dmg ?? 0), 0)).toBe(run.weapon.shotsByType!.kinetic! * 96)
    expect(advance(run, 60000, 61000)).toHaveLength(0)
  })
  it('最后整发已付半发仍可开下一炮，视图不误报无弹；再下一炮停火', () => {
    const run = world(1, 1)
    expect(advance(run, 0, 600)).toHaveLength(1)
    expect(run.battle.ammo.kin).toBe(0)
    const arcs = battleArcsFor(run.state, run.ctx, { battle: run.battle, anomaly: run.card, leaderShipId: run.state.shipId })!
    expect(arcs.me.find(w => w.src === 'turret')!.type).toBe('kinetic')
    expect(advance(run, 600, 1200)).toHaveLength(1)
    expect(run.battle.ammoCreditByWeapon).toBeUndefined()
    expect(advance(run, 1200, 1800)).toHaveLength(0)
  })
  it('不足完整奇数齐射不扣弹或额度，MISS仍消耗已付份额', () => {
    const run = world(5, 2)
    const before = JSON.stringify(run.battle)
    expect(consumeBattleWeaponAmmo(run.battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(false)
    expect(JSON.stringify(run.battle)).toBe(before)
    const miss = world(1, 1)
    miss.ctx.balance.battle.hitMin = 0
    miss.ctx.balance.battle.hitMax = 0
    const events = advance(miss, 0, 1300)
    expect(events).toHaveLength(2)
    expect(events.every(e => !e.hit)).toBe(true)
    expect(miss.battle.ammo.kin).toBe(0)
  })
  it('已付份额不跨舰/武器组/弹种借用，新战斗也不继承', () => {
    const run = world(1, 1)
    expect(consumeBattleWeaponAmmo(run.battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    for (const [tag, wi, type] of [['ally-1', run.wi, 'kinetic'], ['player', run.wi + 1, 'kinetic'], ['player', run.wi, 'explosive']] as const) {
      expect(consumeBattleWeaponAmmo(run.battle, tag, wi, type, run.weapon)).toBe(false)
    }
    const next = startBattleFor(run.state, run.ctx, run.state.shipId, run.card.id, 0)!
    expect(next.ammoCreditByWeapon).toBeUndefined()
    expect(consumeBattleWeaponAmmo(next, 'player', run.wi, 'kinetic', run.weapon)).toBe(false)
  })
  it('中途读档保留半发；整发退回，未用半发不会变出库存', () => {
    const run = world(1, 3)
    advance(run, 0, 600)
    run.state.expedition.active = true
    run.state.expedition.phase = 'battle'
    run.state.expedition.anomalyId = run.card.id
    run.state.expedition.battle = run.battle
    expect(BATTLE_PERSIST_KEYS).toContain('ammoCreditByWeapon')
    const state = loadSaveFile(serializeSaveFile(run.state)).state
    const battle = state.expedition.battle!
    expect(battle.ammoCreditByWeapon).toEqual(run.battle.ammoCreditByWeapon)
    const before = battle.ammo.kin
    expect(consumeBattleWeaponAmmo(battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    expect(battle.ammo.kin).toBe(before)
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items['ammo-kinetic-l']).toBe(2)
  })
  it('旧档不造免费额度，清洗拒绝越界/非我方/不存在炮位/危险键', () => {
    const run = world()
    expect(cleanBattle(run.battle)!.ammoCreditByWeapon).toBeUndefined()
    const key = `player#${run.wi}:kinetic`
    const raw = { ...run.battle, ammoCreditByWeapon: { [key]: 0.5, 'player#0:explosive': 0,
      'player#1:plasma': 1, 'foe-0#0:kinetic': 0.5, 'ghost#1:kinetic': 0.5, 'player#999:kinetic': 0.5,
      'player#-1:kinetic': 0.5, 'player#1:bad': 0.5, '__proto__': 0.5 } }
    expect(cleanBattle(raw)!.ammoCreditByWeapon).toEqual({ [key]: 0.5 })
  })
  it.each(['mod-turret-kin-1', 'mod-wh-d-turret'])('%s整数耗弹与缺弹判定不变', id => {
    const run = world(2, 20, id)
    const cost = 2 * (run.ctx.modules.get(id)!.ammoPerShot ?? 1)
    const before = run.battle.ammo.kin
    for (let i = 0; i < 2; i++) expect(consumeBattleWeaponAmmo(run.battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    expect(run.battle.ammo.kin).toBe(before - 2 * cost)
    expect(run.battle.ammoCreditByWeapon).toBeUndefined()
  })
  it('有限物资逐舰池保持整发，战后退还与消耗账守恒', () => {
    const run = world(1, 2)
    const battle = run.battle
    battle.expeditionAmmo = { stock: { 'ammo-kinetic-l': 2 }, loaded: { 'ammo-kinetic-l': 2 }, idsByTag: { player: { kinetic: 'ammo-kinetic-l' } } }
    battle.wormhole = { cardId: run.card.id, depth: 1, kind: 'node', waves: 1 }
    const supplies = { items: {}, carried: {}, consumed: {}, deployed: {}, recovered: {}, leftBehind: {}, found: {} }
    run.state.wormhole.run = { supplyVersion: 1, supplies } as never
    expect(consumeBattleWeaponAmmo(battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    expect(battle.expeditionAmmo.stock['ammo-kinetic-l']).toBe(1)
    expect(consumeBattleWeaponAmmo(battle, 'player', run.wi, 'kinetic', run.weapon)).toBe(true)
    expect(battle.expeditionAmmo.stock['ammo-kinetic-l']).toBe(1)
    settleWormholeBattleAmmo(run.state, battle, 0)
    expect(supplies.items).toEqual({ 'ammo-kinetic-l': 1 })
    expect(supplies.consumed).toEqual({ 'ammo-kinetic-l': 1 })
  })
})
