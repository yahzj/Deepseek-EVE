import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildSimContext, L10N, l10nEntryText } from '@whale/data'
import ships from '../../data/src/static/ships.json'
import plugs from '../../data/src/static/plugs.json'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { createPlayerSpec } from '../src/playerSpec'
import { advanceBattleFor, startBattleFor, battleZonesFor, battleArcsFor, applyFoeOverride } from '../src/combat'
import { createFoeSpecs } from '../src/foeSpecs'
import { SHIP_HP_UPLIFT_MUL, playerWeaponInRange, playerBlindDamageMul, shieldRecoveryRatio } from '../src/combatMath'
import { foeFamilyHpMulOf, foeShipHpMulOf } from '../src/foePower'
import { pulseShieldChargeFor, pulseShieldFieldFor, repairStatsFor } from '../src/combatRepair'
import { wormholeExpeditionCard } from '../src/wormholeExpeditionFoes'
import { WEEKEND_FLAGSHIP_POOL_HP } from '../src/weekendEvent'
import { cleanBattle } from '../src/saveBattleClean'
import { volleyDamageShareOf } from '../src/combatVolley'
import { beginBattleAt } from '../src/expedition'
import type { AnomalyDef, ModuleDef } from '../src/types'

const ctx = buildSimContext()
const oldShips = JSON.parse(execFileSync('git', ['show', '70ccd2bb:packages/data/src/static/ships.json'], { encoding: 'utf8' })) as typeof ships
const oldPlugs = JSON.parse(execFileSync('git', ['show', '70ccd2bb:packages/data/src/static/plugs.json'], { encoding: 'utf8' })) as typeof plugs
const oldRows = Object.values(oldShips.groups).flat()

function world(high: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: 614 })
  const uid = addShipToFleet(state, 'sh-megalodon')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high, mid: [], low: [] }
  return { state, uid }
}

describe('全舰容量与恢复基准', () => {
  it('46艘舰只改三层血，固定插件只改三个加血值', () => {
    const expected = structuredClone(oldShips)
    for (const row of Object.values(expected.groups).flat()) {
      for (const field of ['shieldHp', 'armorHp', 'hullHp'] as const) row[field] = Math.round(row[field] * SHIP_HP_UPLIFT_MUL)
    }
    expect(ships).toEqual(expected)
    const expectedPlugs = structuredClone(oldPlugs)
    const rows = Object.values(expectedPlugs.groups).flat()
    Object.assign(rows.find(r => r.id === 'plug-shield-plate')!, { shieldHpAdd: 120 })
    Object.assign(rows.find(r => r.id === 'plug-armor-plate')!, { armorHpAdd: 210 })
    Object.assign(rows.find(r => r.id === 'plug-hull-plate')!, { hullHpAdd: 120 })
    expect(plugs).toEqual(expectedPlugs)
  })

  it.each(oldRows.map(row => row.id))('%s恢复基准保留原裸容量，维修增幅不随容量提高', id => {
    const { state } = world()
    const uid = addShipToFleet(state, id)
    state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
    const spec = createPlayerSpec(state, ctx, uid)!
    const old = oldRows.find(row => row.id === id)!
    expect(spec.recoveryHp).toEqual({ s: old.shieldHp, a: old.armorHp, h: old.hullHp })
    expect(spec.repairCapacityAmp).toEqual({ a: 1, h: 1 })
  })

  it('充能、力场恢复和扣盾均使用旧基准，新容量仍可修满', () => {
    const { state, uid } = world(['mod-shieldfield-2'])
    const ally = addShipToFleet(state, 'sh-megalodon')
    const spec = createPlayerSpec(state, ctx, uid)!
    const other = { ...createPlayerSpec(state, ctx, ally)!, tag: 'ally-1' }
    const battle = startBattleFor(state, ctx, uid, 'ano-training', 0, 5000)!
    battle.units[other.tag] = { tag: other.tag, side: 'me', name: '', hp: { ...other.hp }, hpMax: { ...other.hp }, weapons: [] }
    battle.units.player!.hp.s = spec.hp.s / 2
    battle.units[other.tag]!.hp.s = 0
    const before = battle.units.player!.hp.s
    pulseShieldFieldFor(battle, [spec, other], { pct: .1 }, spec)
    expect(battle.units.player!.hp.s).toBeCloseTo(before - spec.recoveryHp!.s * .1)
    expect(battle.units[other.tag]!.hp.s).toBeCloseTo(spec.recoveryHp!.s * .1)
    battle.units.player!.hp.s = 0
    pulseShieldChargeFor(battle, spec, { streams: [{ modelId: '', pct: .2, ms: 15000 }], pulses: 0 })
    expect(battle.units.player!.hp.s).toBeCloseTo(spec.recoveryHp!.s * .2)
    battle.units.player!.hp.s = spec.hp.s - 1
    pulseShieldChargeFor(battle, spec, { streams: [{ modelId: '', pct: .2, ms: 15000 }], pulses: 0 })
    expect(battle.units.player!.hp.s).toBe(spec.hp.s)
  })

  it('维修装置固定点数和加技能结果不变', () => {
    const { state, uid } = world()
    state.fleet[uid]!.fitted.mid = ['mod-hullrep-2']
    const before = repairStatsFor(state, ctx, uid)!
    expect(before.units[0]).toMatchObject({ armorPerPulse: 18, hullPerPulse: 18 })
    state.skills.trained['hull-quick-repair'] = 5
    expect(repairStatsFor(state, ctx, uid)!.units[0]).toMatchObject({ armorPerPulse: 23, hullPerPulse: 23 })
  })

  it('插件、技能和容量件提高血量后，恢复增幅仍与提高前公式一致', () => {
    const { state, uid } = world()
    const fleet = state.fleet[uid]!
    fleet.plugs = ['plug-armor-plate', 'plug-hull-plate', 'plug-shield-plate']
    state.skills.trained['hull-upgrades'] = 5
    state.skills.trained['shield-operation'] = 5
    const spec = createPlayerSpec(state, ctx, uid)!
    const old = oldRows.find(row => row.id === 'sh-megalodon')!
    expect(spec.recoveryHp!.s).toBeCloseTo((old.shieldHp + 80) * 1.2)
    expect(spec.recoveryHp!.a).toBeCloseTo((old.armorHp + 140) * 1.2)
    expect(spec.repairCapacityAmp!.a).toBeCloseTo((old.armorHp + 140) * 1.2 / old.armorHp)
    expect(shieldRecoveryRatio(spec)).toBeCloseTo(spec.recoveryHp!.s / spec.hp.s)
  })

  it.each([0, .1, .5, .9])('剩余盾比例%s的被动恢复点数保持原公式', fraction => {
    const { state, uid } = world()
    const spec = createPlayerSpec(state, ctx, uid)!
    const battle = startBattleFor(state, ctx, uid, 'ano-training', 0, 5000)!
    for (const unit of Object.values(battle.units)) { delete unit.enteredAtMs; unit.weapons.fill(1e9) }
    const rt = battle.units.player!
    rt.hp.s = spec.hp.s * fraction
    const before = rt.hp.s
    const oldRate = fraction > 0 ? Math.max(spec.recoveryHp!.s * fraction * ctx.balance.battle.shieldRegenPerSec, spec.recoveryHp!.s * .01) : 0
    state.gameMs = 10
    advanceBattleFor(state, ctx, battle, uid, 'ano-training')
    expect(rt.hp.s - before).toBeCloseTo(oldRate * .01, 9)
  })

  it('敌舰最终加血不改变裸舰、无人机族格或输出，绝对共享池不重乘', () => {
    for (const ship of ctx.foeShips!.values()) {
      const card: AnomalyDef = { ...ctx.anomalies.get('ano-training')!, ships: [{ ship }], waves: undefined }
      const spec = createFoeSpecs(card, ctx.balance.battle)[0]!
      const old = createFoeSpecs(card, ctx.balance.battle, { beforeHpUplift: true })[0]!
      expect(spec.hp.s + spec.hp.a + spec.hp.h).toBeCloseTo(ship.hp * foeFamilyHpMulOf(ship.family) * 1.5)
      expect(spec.weapons).toEqual(old.weapons)
      expect(spec.foeRepairPulse).toEqual(old.foeRepairPulse)
      expect(spec.repairPct).toBe(old.repairPct)
      expect(spec.signatureM).toBe(old.signatureM)
      const capped = createFoeSpecs(applyFoeOverride(card, { bossShipId: ship.id, bossHp: 300000 }), ctx.balance.battle)[0]!
      expect(capped.hp.s + capped.hp.a + capped.hp.h).toBeCloseTo(300000)
      expect(capped.weapons).toEqual(spec.weapons)
    }
    expect(foeShipHpMulOf('C')).toBeCloseTo(1.95)
    expect(foeFamilyHpMulOf('C')).toBe(1.3)
    expect(WEEKEND_FLAGSHIP_POOL_HP).toBe(300000)
  })

  it.each(['A', 'C', 'D', 'E', 'G'] as const)('%s新虫洞最终血量含1.5，原预算比例和火力不被反算改动', family => {
    const card = wormholeExpeditionCard(ctx, family, 1, 'ordinary')
    expect(card.expeditionFoe.strength.hp).toBeCloseTo(card.expeditionFoe.budget.hp, 5)
    expect(card.expeditionFoe.budget.hp / foeShipHpMulOf(family)).toBeGreaterThan(0)
    expect(card.expeditionFoe.strength.dps / card.expeditionFoe.budget.dps).toBeGreaterThan(.99)
    expect(card.expeditionFoe.strength.dps).toBeLessThanOrEqual(card.expeditionFoe.budget.dps)
  })
})

describe('基础炮与近盲实战', () => {
  it.each(['mod-miner-civ', 'mod-salvager-1', 'mod-shieldfield-2', 'mod-lock-1', 'mod-drone-rack-1'])('%s高槽没有攻击武器时，抵达日志明确禁用条件', id => {
    const { state, uid } = world([id])
    expect(beginBattleAt(state, ctx, 'ano-training', uid, 0)).toBe(true)
    const row = state.logs.at(-1)!
    expect(row.textId).toBe('core.expedition.062')
    expect(row.text).toContain('高槽已装配装备，基础舰炮已禁用；未装配攻击武器。')
    expect(row.textParams).toMatchObject({ p1: ctx.anomalies.get('ano-training')!.name, p3: '' })
    expect(createPlayerSpec(state, ctx, uid)!.weapons).toHaveLength(0)
  })

  it.each([{ high: [] }, { high: ['missing-id'] }])('高槽$high没有有效装备时，保留基础炮与原日志', ({ high }) => {
    const { state, uid } = world(high)
    state.fleet[uid]!.fitted.mid = ['mod-hullrep-2']
    state.fleet[uid]!.plugs = ['plug-shield-plate']
    expect(beginBattleAt(state, ctx, 'ano-training', uid, 0)).toBe(true)
    const row = state.logs.at(-1)!
    expect(row.textId).toBe('core.expedition.045')
    expect(row.text).toContain('仅基础舰炮还击')
    expect(createPlayerSpec(state, ctx, uid)!.weapons.some(w => w.src === 'base')).toBe(true)
  })

  it('已装攻击武器但缺弹不进入无武器分支；真实无人机不被误报', () => {
    const { state, uid } = world(['mod-turret-kin-1'])
    state.warehouse.items = {}
    expect(beginBattleAt(state, ctx, 'ano-training', uid, 0)).toBe(true)
    expect(state.logs.at(-1)!.textId).toBe('core.expedition.044')
    const droneWorld = world(['mod-shieldfield-2'])
    droneWorld.state.fleet[droneWorld.uid]!.droneLoad = { 'drone-scout': 1 }
    expect(createPlayerSpec(droneWorld.state, ctx, droneWorld.uid)!.weapons.some(w => w.src === 'drone')).toBe(true)
    expect(beginBattleAt(droneWorld.state, ctx, 'ano-training', droneWorld.uid, 0)).toBe(true)
    expect(droneWorld.state.logs.at(-1)!.textId).not.toBe('core.expedition.062')
  })

  it('批准日志唯一表和英文待译回退一致，目标名与空尾注不漏参', () => {
    const { state, uid } = world(['mod-shieldfield-2'])
    expect(beginBattleAt(state, ctx, 'ano-training', uid, 0)).toBe(true)
    const row = state.logs.at(-1)!
    const entry = L10N[row.textId!]!
    expect(entry).toMatchObject({ en: '', enDeferred: true })
    const render = (text: string) => text.replace(/\{(p\d+)\}/g, (_, key: string) => String(row.textParams?.[key] ?? ''))
    expect(render(l10nEntryText(entry, 'zh'))).toBe(row.text)
    expect(render(l10nEntryText(entry, 'en'))).toBe(row.text)
    expect(row.text).not.toMatch(/\{p\d+\}/)
  })

  it.each(['mod-miner-civ', 'mod-shieldfield-2', 'mod-turret-kin-1', 'mod-lock-1'])('%s任意有效高槽禁炮，拆空恢复', id => {
    expect(ctx.modules.has(id)).toBe(true)
    const { state, uid } = world([id])
    expect(createPlayerSpec(state, ctx, uid)!.weapons.some(w => w.src === 'base')).toBe(false)
    state.fleet[uid]!.fitted.high = []
    expect(createPlayerSpec(state, ctx, uid)!.weapons.some(w => w.src === 'base')).toBe(true)
  })

  it('中低槽、插件及坏ID不禁炮；支援高槽无武器视图不崩', () => {
    const { state, uid } = world(['missing-id'])
    state.fleet[uid]!.fitted.mid = ['mod-hullrep-2']
    expect(createPlayerSpec(state, ctx, uid)!.weapons.some(w => w.src === 'base')).toBe(true)
    state.fleet[uid]!.fitted.high = ['mod-shieldfield-2']
    state.expedition.anomalyId = 'ano-training'
    expect(battleZonesFor(state, ctx)?.me).toEqual({ minM: 0, maxM: 0, name: '' })
  })

  it('距离规则近盲0.3、最大射程外停火；机群豁免', () => {
    const w = { src: 'turret', minRangeM: 1000, maxRangeM: 5000 }
    expect(playerWeaponInRange(999, w)).toBe(true)
    expect(playerBlindDamageMul(999, w)).toBe(.3)
    expect(playerBlindDamageMul(1000, w)).toBe(1)
    expect(playerWeaponInRange(5001, w)).toBe(false)
    expect(playerBlindDamageMul(10, w, true)).toBe(1)
    expect(playerWeaponInRange(999, { ...w, src: 'drone' })).toBe(false)
    expect(playerBlindDamageMul(999, { ...w, src: 'drone' })).toBe(1)
  })

  it.each([
    ['turret', {}], ['missile', {}], ['laser', {}],
    ['turret', { secondaryDamagePct: .5, secondaryDamageType: 'plasma' }],
    ['turret', { hitsAllFoes: true, secondaryDamagePct: .5, secondaryDamageType: 'plasma' }],
    ['laser', { burst: { shots: 3, gapMs: 100 } }],
  ] as const)('%s近盲真实开火和正常耗弹，伤害为0.3（%j）', (slot, extra) => {
    const sample = [...ctx.modules.values()].find(m => m.slot === slot && m.maxRangeM !== undefined)!
    const module: ModuleDef = { ...sample, id: 'blind-test', minRangeM: 1000, maxRangeM: 5000, falloff: 1, hitRate: 1, dmgMult: 100, secondaryDamagePct: undefined, shots: 1, burst: undefined, overlayDrive: undefined, ...extra }
    const { state, uid } = world([module.id, module.id])
    const target = { ...ctx.anomalies.get('ano-training')!, id: 'blind-target', ships: undefined, foeHpOverride: 1e8, foeShotDmg: 1, tactic: 'orbit' as const,
      ...(module.hitsAllFoes ? { waves: [{ units: 3, hpShare: 1 }] } : {}) }
    const local = { ...ctx, modules: new Map([...ctx.modules, [module.id, module]]), anomalies: new Map([...ctx.anomalies, [target.id, target]]), balance: { ...ctx.balance, battle: { ...ctx.balance.battle, hitMin: 1, hitMax: 1, shieldRegenPerSec: 0 } } }
    const run = (distance: number) => {
      const s = structuredClone(state)
      const b = startBattleFor(s, local, uid, target.id, 0, distance)!
      b.distanceM = distance
      b.myDesireM = distance
      for (const unit of Object.values(b.units)) { delete unit.enteredAtMs; unit.weapons.fill(unit.side === 'me' ? 0 : 1e9) }
      b.ammo = { kin: 100, exp: 100, pla: 100 }
      s.gameMs = 310
      advanceBattleFor(s, local, b, uid, target.id, null, undefined, undefined, { simulation: { distanceM: distance, layer: 'h' } })
      return b
    }
    const near = run(100)
    const valid = run(1000)
    expect(near.stats.meShots).toBeGreaterThan(0)
    expect(near.stats.meShots).toBe(valid.stats.meShots)
    expect(near.ammo).toEqual(valid.ammo)
    const weapon = createPlayerSpec(state, local, uid)!.weapons[0]!
    const raw = weapon.kind === 'gun' ? Object.values(weapon.shotsByType!)[0]! : weapon.shotDmg!
    const guns = weapon.count ?? 1
    const targets = module.hitsAllFoes ? 3 : 1
    const perVolley = Array.from({ length: guns }, (_, i) =>
      Math.round(volleyDamageShareOf(raw, guns, i) * .3) + (module.secondaryDamagePct
        ? Math.round(volleyDamageShareOf(Math.max(1, Math.round(raw * module.secondaryDamagePct)), guns, i) * .3) : 0))
      .reduce((sum, damage) => sum + damage, 0)
    expect(near.stats.meDmg).toBeCloseTo(perVolley * targets * near.stats.meShots / guns, 6)
    expect(run(createPlayerSpec(state, local, uid)!.weapons[0]!.maxRangeM + 1).stats.meShots).toBe(0)
  })

  it('新在途战斗不再次重排，旧无人机和弹药账不移位，连发保持重载重置规则', () => {
    const { state, uid } = world(['mod-laser-3', 'mod-drone-launch-3'])
    state.fleet[uid]!.droneLoad = { 'drone-scout': 2 }
    const battle = startBattleFor(state, ctx, uid, 'ano-training', 0, 1000)!
    const count = battle.units.player!.weapons.length
    const fresh = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    const freshSpec = createPlayerSpec(state, ctx, uid, undefined, { legacyWeaponCount: count })!
    expect(freshSpec.weapons.some(w => w.disabled)).toBe(false)
    battle.units.player!.weapons.unshift(1)
    const shifted = Object.fromEntries(Object.entries(battle.dronePools ?? {}).map(([key, pool]) => {
      const [tag, index] = key.split(':')
      return [`${tag}:${Number(index) + 1}`, pool]
    }))
    battle.dronePools = shifted
    battle.meBurstFired = { 'player#1': 1 }
    battle.ammoCreditByWeapon = { 'player#1:plasma': .5 }
    const old = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    const spec = createPlayerSpec(state, ctx, uid, undefined, { legacyWeaponCount: count + 1 })!
    expect(spec.weapons[0]!.disabled).toBe(true)
    for (const [index, weapon] of spec.weapons.entries()) {
      if (weapon.src === 'drone') expect(old.dronePools?.[`player:${index}`]).toBeDefined()
    }
    expect(old.meBurstFired).toBeUndefined()
    expect(old.ammoCreditByWeapon).toEqual({ 'player#1:plasma': .5 })
    expect(fresh.units.player!.weapons).toHaveLength(freshSpec.weapons.length)
  })

  it('旧基础炮保留禁用占位，重载后装填下标与视图仍一致', () => {
    const { state, uid } = world(['mod-turret-kin-1'])
    const battle = startBattleFor(state, ctx, uid, 'ano-training', 0, 1000)!
    battle.units.player!.weapons.unshift(99)
    battle.units.player!.weapons[1] = 1234
    const loaded = cleanBattle(JSON.parse(JSON.stringify(battle)))!
    const refs = { weaponRanges: [], legacyWeaponCount: loaded.units.player!.weapons.length }
    const spec = createPlayerSpec(state, ctx, uid, undefined, refs)!
    expect(spec.weapons[0]).toMatchObject({ src: 'base', disabled: true })
    expect(spec.weapons[1]!.moduleId).toBe('mod-turret-kin-1')
    state.expedition.battle = loaded
    state.expedition.anomalyId = 'ano-training'
    const view = battleArcsFor(state, ctx)!
    expect(view.weapons.every(w => w.src !== 'base')).toBe(true)
    expect(view.weapons[0]!.remainingMs).toBe(1234)
  })
})
