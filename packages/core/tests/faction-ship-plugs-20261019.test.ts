import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/fleetBook'
import { installPlug, exchangePlugBlueprint, plugExchangeRowsOf, plugInfoOf, plugEffectsOf } from '../src/plugs'
import { createPlayerSpec, startBattleFor, startFleetBattleFor, advanceBattleFor, applyPlayerUnitDamage, persistFleetHullDamage, settleDroneLosses } from '../src/combat'
import { cpuBudgetOf, droneBayTotalM3, adjustDroneLoad } from '../src/equipment'
import { cargoCapacityM3Of } from '../src/inventory'
import { droneReviveCyclesOf, droneReviveNoteLoss, resolveDroneRevive } from '../src/droneRevive'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { healArmorHp } from '../src/combatMath'
import { startManufacturing, advanceManufacturing } from '../src/manufacturing'

const ctx = buildSimContext()
const ids = ['plug-pirate-raider', 'plug-alien-shield-coating', 'plug-gravekeeper-capacitor', 'plug-titan-compression', 'plug-deadarmy-printing']
function world(ship = 'sh-wh-e-destroyer', plugs: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const uid = addShipToFleet(state, ship)
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-drone-deck-1'], mid: [], low: [] }
  state.fleet[uid]!.droneLoad = { 'drone-scout': 2 }
  for (const id of plugs) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    expect(installPlug(state, ctx, id, uid), id).toMatchObject({ ok: true })
  }
  return { state, uid, spec: createPlayerSpec(state, ctx, uid)! }
}

describe('五族船插确认参数与真实接线', () => {
  it('静态值与船长最后确认一致，其余通用插件不受影响', () => {
    expect(ctx.modules.get(ids[0]!)).toMatchObject({ speedPenaltyMps: 20, stealthWithPropulsion: true, plugNonStacking: true })
    expect(ctx.modules.get(ids[1]!)).toMatchObject({ shieldArmorConversionPct: .5, plugNonStacking: true })
    expect(ctx.modules.get(ids[2]!)).toMatchObject({ shieldPassiveBonusPct: .5, plugNonStacking: true })
    expect(ctx.modules.get(ids[3]!)).toMatchObject({ cargoCapacityBonusPct: .25, droneBayBonusM3: 120, cpuPenalty: 20, speedPenaltyMps: 20 })
    expect(ctx.modules.get(ids[4]!)).toMatchObject({ plugNonStacking: true, dronePrinting: { hpMul: .5, damageMul: .75, launchMul: .75, deckCycleMul: .6 } })
  })
  it.each(ids)('%s图纸暂不出现在声望商店且直接兑换被拒，定义与制造链保留', id => {
    const mod = ctx.modules.get(id)
    expect(mod, id).toBeDefined()
    expect(mod!.slot).toBe('plug')
    const bp = ctx.blueprints.get(`bp-${id}`)!
    expect(bp.materials).toEqual(ctx.blueprints.get('bp-plug-shield-plate')!.materials)
    expect(bp.buildSeconds).toBe(3600)
    expect(bp.singleUse).not.toBe(true)
    const state = createInitialState({ nowWallMs: 0, seed: 19 })
    state.standings.dsi = 100
    const beforeStanding = state.standings.dsi
    expect(plugExchangeRowsOf(state, ctx).some(row => row.moduleId === id)).toBe(false)
    expect(plugExchangeRowsOf(state, ctx)).toHaveLength(12)
    expect(exchangePlugBlueprint(state, ctx, id)).toMatchObject({ ok: false, errorId: 'core.plug.016' })
    expect(state.standings.dsi).toBe(beforeStanding)
    expect(buildSimContext('en').modules.get(id)!.name).not.toBe(mod!.name)
    expect(ctx.marketGoods.has(id)).toBe(false)
    for (const mat of bp.materials) state.warehouse.items[mat.itemId] = mat.count
    state.learnedRecipes.push(bp.id)
    expect(startManufacturing(state, bp.id, 'pilot', ctx).ok).toBe(true)
    state.gameMs = state.manufacturingRuns.find(run => run.active && run.blueprintId === bp.id)!.finishAtGameMs
    advanceManufacturing(state, ctx)
    expect(state.moduleBay[id]).toBe(1)
    expect(buildSimContext('en').blueprints.get(bp.id)!.name).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('袭击者允许推进器与隐秘行动共存，重复仅一次代价，不提供隐身', () => {
    const w = world('sh-shrike')
    w.state.fleet[w.uid]!.fitted = { high: ['mod-stealth-3'], mid: ['mod-prop-1'], low: [] }
    const before = createPlayerSpec(w.state, ctx, w.uid)!
    expect(before.stealthMs).toBeUndefined()
    w.state.fleet[w.uid]!.plugs = [ids[0]!, ids[0]!]
    const after = createPlayerSpec(w.state, ctx, w.uid)!
    expect(after.stealthMs).toBe(30000)
    expect(before.speedMps - after.speedMps).toBe(20)
    w.state.fleet[w.uid]!.fitted.high = []
    expect(createPlayerSpec(w.state, ctx, w.uid)!.stealthMs).toBeUndefined()
  })

  it('空间压缩两件扩舱240，CPU扣40，货仓同池加50%，速度扣40', () => {
    const a = world(), b = world('sh-wh-e-destroyer', [ids[3]!, ids[3]!])
    expect(cpuBudgetOf(b.state, ctx, b.uid)).toBe(cpuBudgetOf(a.state, ctx, a.uid) - 40)
    expect(droneBayTotalM3(ctx.ships.get('sh-wh-e-destroyer'), b.state.fleet[b.uid]!.fitted, ctx, b.state.fleet[b.uid]!.plugs)).toBe(
      droneBayTotalM3(ctx.ships.get('sh-wh-e-destroyer'), a.state.fleet[a.uid]!.fitted, ctx) + 240)
    expect(cargoCapacityM3Of(b.state, ctx, b.uid)).toBe(Math.ceil(cargoCapacityM3Of(a.state, ctx, a.uid) * 1.5))
    expect(a.spec.speedMps - b.spec.speedMps).toBe(40)
  })

  it('CPU不足拒装空间压缩，不扣库存、不改插件或装配', () => {
    const w = world('sh-shrike')
    w.state.fleet[w.uid]!.fitted = { high: ['mod-turret-kin-3', 'mod-turret-kin-3'], mid: [], low: [] }
    w.state.fleet[w.uid]!.droneLoad = undefined
    const local = { ...ctx, ships: new Map(ctx.ships) }
    local.ships.set('sh-shrike', { ...ctx.ships.get('sh-shrike')!, cpu: 85 })
    w.state.moduleBay[ids[3]!] = 1
    const before = JSON.stringify(w.state)
    expect(installPlug(w.state, local, ids[3]!, w.uid).ok).toBe(false)
    expect(JSON.stringify(w.state)).toBe(before)
  })

  it('镀膜取最终盾一次转甲，半甲开场加满临时层，结算不治愈原甲，重载不重转', () => {
    const base = world(), w = world('sh-wh-e-destroyer', [ids[1]!])
    const converted = Math.ceil(base.spec.hp.s * .5)
    expect(w.spec.hp).toEqual({ ...base.spec.hp, s: 0, a: base.spec.hp.a + converted })
    w.state.fleet[w.uid]!.armorPct = .5
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    expect(b.units.player!.hp.a).toBe(Math.ceil(base.spec.hp.a * .5) + converted)
    b.units.player!.hp.a -= 10
    persistFleetHullDamage(w.state, ctx, w.uid, b)
    expect(w.state.fleet[w.uid]!.armorPct).toBeCloseTo(Math.ceil(base.spec.hp.a * .5) / base.spec.hp.a)
    w.state.expedition.battle = b
    w.state.expedition.active = true
    w.state.expedition.phase = 'battle'
    w.state.expedition.anomalyId = 'ano-training'
    const back = loadSaveFile(serializeSaveFile(w.state, 0)).state.expedition.battle!
    expect(back.units.player!.hp).toEqual(b.units.player!.hp)
  })

  it('打印仅影响本舰机群，不叠加，不改变攻击装填；甲板周期乘0.6', () => {
    const a = world(), b = world('sh-wh-e-destroyer', [ids[4]!, ids[4]!])
    expect(b.spec.droneLaunchGapMs).toBe(Math.max(10, Math.round(a.spec.droneLaunchGapMs! * .75)))
    expect(b.spec.droneReviveGapMs).toBe(a.spec.droneReviveGapMs)
    expect(droneReviveCyclesOf(b.state, ctx, b.uid)).toEqual(droneReviveCyclesOf(a.state, ctx, a.uid).map(ms => Math.ceil(ms * .6)))
    const wa = a.spec.weapons.find(w => w.src === 'drone')!, wb = b.spec.weapons.find(w => w.src === 'drone')!
    expect(wb.shotDmg).toBe(Math.ceil(wa.shotDmg! * .75))
    expect(wb.reloadMs).toBe(wa.reloadMs)
    expect(plugInfoOf(b.state, ctx, b.uid).installed).toHaveLength(2)
    expect(plugEffectsOf(b.state, ctx, b.uid)).toHaveLength(1)
  })

  it('打印储备甲板无备用库存也可复原，反复损坏结算不增不减库存与编制', () => {
    const w = world('sh-wh-e-destroyer', [ids[4]!])
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    const [key, pool] = Object.entries(b.dronePools!)[0]!
    const initial = { ...w.state.fleet[w.uid]!.droneLoad }
    const warehouse = { ...w.state.warehouse.items }
    for (let i = 0; i < 2; i++) {
      pool.alive = false
      pool.s = pool.a = pool.h = 0
      b.droneLostBy = { player: { 'drone-scout': i + 1 } }
      droneReviveNoteLoss(w.state, b, key, i * 10000)
      resolveDroneRevive(w.state, ctx, b, i * 10000 + 8400)
      expect(pool.alive).toBe(true)
    }
    settleDroneLosses(w.state, ctx, w.uid, b)
    expect(w.state.fleet[w.uid]!.droneLoad).toEqual(initial)
    expect(w.state.warehouse.items).toEqual(warehouse)
    settleDroneLosses(w.state, ctx, w.uid, b)
    expect(w.state.fleet[w.uid]!.droneLoad).toEqual(initial)
  })

  it.each([0, .1, .8])('蓄能被动恢复在剩余盾%s时整条乘1.5，重复不叠加、破盾不回充', fraction => {
    const w = world('sh-wh-e-destroyer', [ids[2]!, ids[2]!])
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    for (const u of Object.values(b.units)) { delete u.enteredAtMs; u.weapons.fill(1e9) }
    const rt = b.units.player!
    rt.hp.s = w.spec.hp.s * fraction
    const before = rt.hp.s
    w.state.gameMs = 10
    advanceBattleFor(w.state, ctx, b, w.uid, 'ano-training')
    expect(rt.hp.s - before).toBeCloseTo(fraction > 0 ? Math.max(before * .012, w.spec.hp.s * .006) * 1.5 * .01 : 0, 9)
  })

  it('镀膜真实受击穿过临时层后只保留原甲损失，维修可修回原甲且重载保留账', () => {
    const w = world('sh-wh-e-destroyer', [ids[1]!])
    w.state.fleet[w.uid]!.armorPct = .5
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    const rt = b.units.player!, original = rt.hp.coating!.armor
    applyPlayerUnitDamage(w.state, b, 'player', w.spec, (w.spec.shieldArmorHp! + 10) * 2, 'kinetic')
    expect(rt.hp.a).toBeLessThan(original)
    expect(rt.hp.coating!.armor).toBeCloseTo(rt.hp.a)
    healArmorHp(rt.hp, 10)
    const remaining = rt.hp.coating!.armor
    persistFleetHullDamage(w.state, ctx, w.uid, b)
    expect(w.state.fleet[w.uid]!.armorPct).toBeCloseTo(remaining / rt.hp.coating!.maxArmor)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    const back = loadSaveFile(serializeSaveFile(w.state, 0)).state
    expect(back.expedition.battle!.units.player!.hp.coating).toEqual(rt.hp.coating)
  })

  it('多舰打印不占共享备机，普通舰继续扣自己的损失；机体三层逐层减半', () => {
    const w = world('sh-wh-e-destroyer', [ids[4]!])
    const ally = addShipToFleet(w.state, 'sh-wh-e-destroyer')
    w.state.fleet[ally]!.fitted = { high: ['mod-drone-deck-1'], mid: [], low: [] }
    w.state.fleet[ally]!.droneLoad = { 'drone-scout': 2 }
    w.state.warehouse.items['drone-scout'] = 5
    const b = startFleetBattleFor(w.state, ctx, [w.uid, ally], 'ano-training')!
    const own = Object.entries(b.dronePools!).find(([,p]) => p.owner === 'player')!
    const other = Object.entries(b.dronePools!).find(([,p]) => p.owner === 'ally-1')!
    for (const field of ['s', 'a', 'h'] as const) expect(own[1][field]).toBe(Math.ceil(other[1][field] * .5))
    own[1].alive = other[1].alive = false
    b.droneLostBy = { player: { 'drone-scout': 1 }, 'ally-1': { 'drone-scout': 1 } }
    droneReviveNoteLoss(w.state, b, own[0], 0)
    droneReviveNoteLoss(w.state, b, other[0], 0)
    resolveDroneRevive(w.state, ctx, b, 8400)
    expect(own[1].alive).toBe(true)
    expect(other[1].alive).toBe(false)
    expect(b.droneReviveStock!['drone-scout']).toBe(5)
    settleDroneLosses(w.state, ctx, w.uid, b)
    expect(w.state.warehouse.items['drone-scout']).toBe(5)
    expect(b.droneLostBy!['ally-1']).toEqual({ 'drone-scout': 1 })
  })

  it('打印甲板计时重载保持，不扣备用机也不重置周期', () => {
    const w = world('sh-wh-e-destroyer', [ids[4]!])
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    const [key,pool] = Object.entries(b.dronePools!)[0]!
    pool.alive = false
    b.droneLostBy = { player: { 'drone-scout': 1 } }
    droneReviveNoteLoss(w.state, b, key, 100)
    w.state.expedition = { ...w.state.expedition, active: true, phase: 'battle', anomalyId: 'ano-training', battle: b }
    const back = loadSaveFile(serializeSaveFile(w.state, 0)).state
    const bb = back.expedition.battle!
    expect(bb.droneRevive!.player).toEqual(b.droneRevive!.player)
    resolveDroneRevive(back, ctx, bb, 8499)
    expect(bb.dronePools![key]!.alive).toBe(false)
    resolveDroneRevive(back, ctx, bb, 8500)
    expect(bb.dronePools![key]!.alive).toBe(true)
  })

  it('无储备甲板不会战中打印，存活撤退仍可恢复原编制', () => {
    const w = world('sh-wh-e-destroyer', [ids[4]!])
    w.state.fleet[w.uid]!.fitted.high = []
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    const [key,pool] = Object.entries(b.dronePools!)[0]!
    pool.alive = false
    b.droneLostBy = { player: { 'drone-scout': 1 } }
    droneReviveNoteLoss(w.state, b, key, 0)
    resolveDroneRevive(w.state, ctx, b, 100000)
    expect(pool.alive).toBe(false)
    settleDroneLosses(w.state, ctx, w.uid, b)
    expect(w.state.fleet[w.uid]!.droneLoad).toEqual({ 'drone-scout': 2 })
    expect(w.state.droneLossReport!.gone).toBe(0)
  })

  it('母舰沉没不返还编制、不从仓库扣打印复位的备用机', () => {
    const w = world('sh-wh-e-destroyer', [ids[4]!])
    const b = startBattleFor(w.state, ctx, w.uid, 'ano-training')!
    const [key,pool] = Object.entries(b.dronePools!)[0]!
    pool.alive = false
    b.droneLostBy = { player: { 'drone-scout': 1 } }
    droneReviveNoteLoss(w.state, b, key, 0)
    resolveDroneRevive(w.state, ctx, b, 8400)
    b.units.player!.hp = { s: 0, a: 0, h: 0 }
    w.state.warehouse.items['drone-scout'] = 5
    const warehouse = { ...w.state.warehouse.items }
    settleDroneLosses(w.state, ctx, w.uid, b)
    expect(w.state.warehouse.items).toEqual(warehouse)
  })

  it('空间压缩扩舱同时用于装载校验与战斗，不取消CPU限制', () => {
    const w = world('sh-shrike', [ids[3]!])
    w.state.fleet[w.uid]!.fitted = { high: [], mid: [], low: [] }
    w.state.warehouse.items['drone-scout'] = 20
    expect(adjustDroneLoad(w.state, ctx, 'drone-scout', 10, w.uid).ok).toBe(true)
    expect(createPlayerSpec(w.state, ctx, w.uid)!.weapons.filter(w => w.src === 'drone')).toHaveLength(12)
  })

  it('镀膜与蓄能同装不产生护盾，真实换波不再次增加转换装甲', () => {
    const w = world('sh-wh-e-destroyer', [ids[1]!, ids[2]!])
    const card = { ...ctx.anomalies.get('ano-training')!, id: 'ano-coating-waves',
      waves: [{ units: 1, hpShare: .5 }, { units: 1, hpShare: .5 }] }
    const local = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
    const b = startBattleFor(w.state, local, w.uid, card.id)!
    const rt = b.units.player!
    rt.hp.a -= 10
    const before = structuredClone(rt.hp)
    for (const u of Object.values(b.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    w.state.gameMs = 10
    advanceBattleFor(w.state, local, b, w.uid, card.id)
    w.state.gameMs = b.waveClearAt! + 1
    advanceBattleFor(w.state, local, b, w.uid, card.id)
    expect(b.waveIdx).toBe(1)
    expect(rt.hp).toEqual(before)
    expect(rt.hpMax!.s).toBe(0)
  })

  it('被动恢复未来来源与蓄能同区相加，50%加20%合成70%', () => {
    const w = world('sh-wh-e-destroyer', [ids[2]!])
    const other = { ...ctx.modules.get(ids[2]!)!, id: 'plug-test-passive', shieldPassiveBonusPct: .2 }
    const local = { ...ctx, modules: new Map([...ctx.modules, [other.id, other]]) }
    w.state.fleet[w.uid]!.plugs!.push(other.id)
    expect(createPlayerSpec(w.state, local, w.uid)!.shieldPassiveBonusPct).toBeCloseTo(.7)
  })
})
