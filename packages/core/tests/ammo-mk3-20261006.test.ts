import { describe, expect, it } from 'vitest'
import { buildSimContext, BLUEPRINT_PRICE_OVERRIDES, L10N, rarityTierOf } from '@whale/data'
import { createInitialState } from '../src/state'
import { blackMarketBuy, blackMarketCandidateGoods, blackMarketDayStart, ensureBlackMarket } from '../src/blackMarket'
import { advanceMarket, buyAtMarket, ensureMarket, learnBlueprint, listSellHolding, placeBuyOrder, placeSellOrder } from '../src/market'
import { fireMarketOrderEvent } from '../src/events'
import { advanceManufacturing, calcBuildDurationMs, startManufacturing } from '../src/manufacturing'
import { fitModule, setAmmoTier } from '../src/equipment'
import { addShipToFleet } from '../src/shipyard'
import { advanceBattleFor, createPlayerSpec, refundAmmo, resolveAmmoTier, startBattleFor } from '../src/combat'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { FRAGMENT_RECIPES } from '../src/salvage'
import { wormholeFamilyPoolOf } from '../src/wormholeSalvage'
import { wormholeEnterPrepared, wormholePreparationPlan } from '../src/wormholePreparation'
import { wormholeStartBattle } from '../src/wormholeBattle'
import { battleAmmoIdsFor, consumeBattleAmmo, settleWormholeBattleAmmo } from '../src/combatAmmo'
import { injectAmmoMk3TestState } from '../../../tools/ammo-mk3-test-fixture'

const ctx = buildSimContext()
const now = new Date(2026, 9, 6, 12).getTime()
const CASES = [
  { type: 'kinetic', damage: 11, price: 135, book: 10260000, main: 'min-nocxium', count: 47, iron: 6, weapon: 'mod-turret-kin-1' },
  { type: 'explosive', damage: 12, price: 180, book: 13680000, main: 'min-isotope', count: 174, iron: 3, weapon: 'mod-missile-1' },
  { type: 'plasma', damage: 16, price: 240, book: 18240000, main: 'min-starcore', count: 46, iron: 6, weapon: 'mod-laser-1' },
] as const
function world() {
  const state = createInitialState({ nowWallMs: now, seed: 42, prologue: true })
  state.standingsEarned = { dsi: 100 }
  state.wallet.isk = 1e12
  return state
}

describe('MK3三系定稿数据和黑市唯一供货', () => {
  it.each(CASES)('$type数值/制造/19倍书价及稀有度一致，不含虚空晶', spec => {
    const id = `ammo-${spec.type}-3`, bpId = `bp-ammo-${spec.type}-3`
    const item = ctx.items.get(id)!, bp = ctx.blueprints.get(bpId)!, good = ctx.marketGoods.get(bpId)!
    expect(item).toMatchObject({ kind: 'ammo', damageType: spec.type, dmg: spec.damage, unitM3: 0.02, baseSellPriceIsk: spec.price })
    expect(bp).toMatchObject({ itemId: id, outputUnits: 120, buildSeconds: 20, priceIsk: spec.book })
    expect(bp.singleUse).not.toBe(true)
    expect(bp.materials).toEqual([{ itemId: spec.main, count: spec.count }, { itemId: 'min-darkiron', count: spec.iron }])
    expect(bp.materials.some(m => m.itemId === 'min-voidcrystal')).toBe(false)
    expect(bp.priceIsk).toBe(ctx.marketGoods.get(`bp-ammo-${spec.type}-2`)!.basePrice * 19)
    expect(BLUEPRINT_PRICE_OVERRIDES[bpId]!.price).toBe(spec.book)
    expect(good).toMatchObject({ rarityTier: 5, basePrice: spec.book, playerBuyable: false, playerSellable: false, blackMarketBuyable: true })
    expect(rarityTierOf(id)).toBe(3)
    expect(ctx.marketGoods.get(id)!.playerBuyable).toBe(false)
    expect(ctx.marketGoods.get(id)!.playerSellable).not.toBe(false)
    expect(blackMarketCandidateGoods(ctx).some(g => g.key === bpId)).toBe(true)
    expect(blackMarketCandidateGoods(ctx).some(g => g.key === id)).toBe(false)
  })
  it.each(CASES)('$type黑市买一本→永久学习→制造两批，按料/时间扣除，钱包不收制造费', spec => {
    const state = world(), bpId = `bp-ammo-${spec.type}-3`, bp = ctx.blueprints.get(bpId)!, id = bp.itemId!
    const narrow = { ...ctx, marketGoods: new Map([[bpId, ctx.marketGoods.get(bpId)!]]) }
    ensureBlackMarket(state, narrow, now)
    const offer = state.blackMarket!.offers[0]!
    expect(offer.price).toBe(spec.book * offer.multiplier)
    expect(offer.price).toBeGreaterThanOrEqual(spec.book * 30)
    expect(offer.price).toBeLessThanOrEqual(spec.book * 100)
    expect(blackMarketBuy(state, narrow, bpId, blackMarketDayStart(now), offer.price, now, 1).ok).toBe(true)
    expect(state.blueprintStock[bpId]).toBe(1)
    expect(learnBlueprint(state, ctx, bpId).ok).toBe(true)
    expect(state.learnedRecipes).toContain(bpId)
    expect(state.blueprintStock[bpId] ?? 0).toBe(0)
    expect(calcBuildDurationMs(state, ctx, bp)).toBe(20000)
    for (const m of bp.materials) state.warehouse.items[m.itemId] = m.count * 2
    const money = state.wallet.isk
    for (let n = 1; n <= 2; n++) {
      expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(true)
      const run = state.manufacturingRuns.find(r => r.active && r.blueprintId === bpId)!
      state.gameMs = run.finishAtGameMs
      advanceManufacturing(state, ctx)
      expect(state.warehouse.items[id]).toBe(120 * n)
    }
    expect(state.wallet.isk).toBe(money)
    expect(state.learnedRecipes).toContain(bpId)
    for (const m of bp.materials) expect(state.warehouse.items[m.itemId] ?? 0).toBe(0)
    const back = loadSaveFile(serializeSaveFile(state, now)).state
    expect(back.learnedRecipes).toContain(bpId)
    expect(back.warehouse.items[id]).toBe(240)
  })
  it('普通市场推进/事件/买卖挂单均不能提供三张图纸或NPC成品', () => {
    const state = world()
    ensureMarket(state, ctx)
    for (let i = 1; i <= 30; i++) {
      state.gameMs = i * 600000
      advanceMarket(state, 600000, ctx)
      fireMarketOrderEvent(state, ctx)
    }
    for (const spec of CASES) {
      const id = `ammo-${spec.type}-3`, bpId = `bp-ammo-${spec.type}-3`
      expect(state.market.npcSell[id] ?? []).toEqual([])
      expect(state.market.npcSell[bpId] ?? []).toEqual([])
      expect(state.market.npcBuy[bpId] ?? []).toEqual([])
      state.blueprintStock[bpId] = 1
      const before = JSON.stringify(state)
      expect(buyAtMarket(state, ctx, bpId, 1).bought).toBe(0)
      expect(placeBuyOrder(state, ctx, bpId, 1e9, 1)).toBeNull()
      expect(placeSellOrder(state, ctx, bpId, 1e9, 1)).toBeNull()
      expect(listSellHolding(state, ctx, bpId, 1e9, 1).ok).toBe(false)
      expect(JSON.stringify(state)).toBe(before)
      expect(Object.values(FRAGMENT_RECIPES).some(r => r.blueprintId === bpId)).toBe(false)
      for (const family of ['A', 'C', 'D', 'E', 'G']) expect(wormholeFamilyPoolOf(ctx, family).moduleBlueprints).not.toContain(bpId)
    }
  })
  it.each(['zh', 'en'] as const)('$locale三系名称/说明完整，参数不重复写进说明', locale => {
    const localized = buildSimContext(locale)
    for (const spec of CASES) {
      const id = `ammo-${spec.type}-3`, bpId = `bp-ammo-${spec.type}-3`
      expect(localized.items.get(id)!.name).toContain('MK3')
      expect(localized.blueprints.get(bpId)!.name).toContain('MK3')
      expect(localized.items.get(id)!.description).toBeTruthy()
      expect(localized.blueprints.get(bpId)!.description).toBeTruthy()
      expect(localized.blueprints.get(bpId)!.description).not.toMatch(/120|20|1026|1368|1824/)
      if (locale === 'en') expect([localized.items.get(id)!.name, localized.items.get(id)!.description, localized.blueprints.get(bpId)!.description].join(' ')).not.toMatch(/[\u3400-\u9fff]/)
    }
    expect(L10N['ui.ammoTier.001']![locale]).toBeTruthy()
  })
  it('未学会/缺料均无扣料；学会后重复书不提示转售，成品可按量挂卖', () => {
    const state = world(), bpId = 'bp-ammo-kinetic-3', id = 'ammo-kinetic-3'
    const bp = ctx.blueprints.get(bpId)!
    for (const row of bp.materials) state.warehouse.items[row.itemId] = row.count
    const before = JSON.stringify(state)
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    state.blueprintStock[bpId] = 1
    expect(learnBlueprint(state, ctx, bpId).ok).toBe(true)
    state.blueprintStock[bpId] = 1
    expect(learnBlueprint(state, ctx, bpId).errorId).toBe('core.ammoMk3.001')
    state.warehouse.items['min-darkiron'] = 5
    const missing = JSON.stringify(state)
    expect(startManufacturing(state, bpId, 'pilot', ctx).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(missing)
    state.warehouse.items[id] = 120
    expect(listSellHolding(state, ctx, id, 270, 120).ok).toBe(true)
    expect(state.warehouse.items[id] ?? 0).toBe(0)
    expect(state.escrowItems[id]).toBe(120)
  })
  it('有限趟MK3/MK2逐舰分档、耗弹及余弹结算不借母港库存', () => {
    const state = world(), a = addShipToFleet(state, 'sh-thresher'), b = addShipToFleet(state, 'sh-thresher')
    state.shipId = a
    for (const uid of [a, b]) state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
    state.fleet[a]!.ammoPref = { kinetic: 'ammo-kinetic-3' }
    state.fleet[b]!.ammoPref = { kinetic: 'ammo-kinetic-2' }
    state.warehouse.items = { 'ammo-kinetic-3': 1000, 'ammo-kinetic-2': 1000 }
    const plan = wormholePreparationPlan(state, ctx, [a, b], { targets: { 'ammo-kinetic-3': 100, 'ammo-kinetic-2': 100 }, unload: [] })
    expect(plan.ok).toBe(true)
    expect(wormholeEnterPrepared(state, ctx, [a, b], 7, plan).ok).toBe(true)
    const run = state.wormhole.run!
    const cell = run.grid!.cells.find(c => c.key === `${run.grid!.pos.q},${run.grid!.pos.r}`)!
    cell.place = 'ship'
    expect(wormholeStartBattle(state, ctx, 'node').ok).toBe(true)
    const battle = run.battle!
    expect(battleAmmoIdsFor(battle, 'player')!.kinetic).toBe('ammo-kinetic-3')
    expect(battleAmmoIdsFor(battle, 'ally-1')!.kinetic).toBe('ammo-kinetic-2')
    expect(consumeBattleAmmo(battle, 'player', 'kinetic', 1)).toBe(true)
    expect(consumeBattleAmmo(battle, 'ally-1', 'kinetic', 1)).toBe(true)
    settleWormholeBattleAmmo(state, battle, 0)
    expect(run.supplies!.items['ammo-kinetic-3']).toBe(99)
    expect(run.supplies!.items['ammo-kinetic-2']).toBe(99)
    expect(state.warehouse.items['ammo-kinetic-3']).toBe(900)
    expect(state.warehouse.items['ammo-kinetic-2']).toBe(900)
  })
  it('全新测试档仅准备门槛、不预先购买学习、无虚空晶，正常往返', () => {
    const state = world()
    injectAmmoMk3TestState(state)
    const back = loadSaveFile(serializeSaveFile(state, now)).state
    expect(back.fleet[back.shipId]!.defId).toBe('sh-hammerhead')
    for (const row of CASES) {
      const bpId = `bp-ammo-${row.type}-3`
      expect(back.blackMarket!.offers.some(offer => offer.goodKey === bpId && !offer.sold)).toBe(true)
      expect(back.learnedRecipes).not.toContain(bpId)
      expect(back.blueprintStock[bpId] ?? 0).toBe(0)
    }
    expect(back.warehouse.items['min-voidcrystal'] ?? 0).toBe(0)
  })
})

describe('MK3装配/实战/退弹兼容', () => {
  it.each(CASES)('$type设置MK3后实装、伤害按基数、首拍扣弹与按ID退弹，读档保留', spec => {
    const state = world(), id = `ammo-${spec.type}-3`, mk2 = `ammo-${spec.type}-2`
    state.shipId = addShipToFleet(state, 'sh-hammerhead')
    state.moduleBay[spec.weapon] = 1
    expect(fitModule(state, spec.weapon, ctx).ok).toBe(true)
    expect(setAmmoTier(state, ctx, spec.type, id).ok).toBe(true)
    state.warehouse.items[id] = 10000
    const shot = (ammo: string) => {
      const unit = createPlayerSpec(state, ctx, state.shipId, { [spec.type]: ammo })!
      const weapon = unit.weapons.find(w => w.src === (spec.type === 'plasma' ? 'laser' : spec.type === 'explosive' ? 'missile' : 'turret'))!
      return weapon.kind === 'beam' ? weapon.shotDmg! : weapon.shotsByType![spec.type]!
    }
    const ratio = spec.damage / ctx.items.get(mk2)!.dmg!
    expect(shot(id)).toBeGreaterThan(shot(mk2))
    expect(Math.abs(shot(id) - shot(mk2) * ratio)).toBeLessThanOrEqual(0.5 * (1 + ratio))
    const cardId = [...ctx.anomalies.keys()].find(key => key.startsWith('enc-'))!
    const battle = startBattleFor(state, ctx, state.shipId, cardId, 0)!
    battle.distanceM = 1000
    battle.myDesireM = 1000
    expect(battle.ammoIds![spec.type]).toBe(id)
    const key = spec.type === 'kinetic' ? 'kin' : spec.type === 'explosive' ? 'exp' : 'pla'
    const loaded = battle.ammo[key]
    expect(loaded).toBeGreaterThan(0)
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, cardId)
    expect(battle.ammo[key]).toBe(loaded)
    const firstReload = battle.units.player!.weapons.find((_, i) => createPlayerSpec(state, ctx, state.shipId)!.weapons[i]!.src !== 'base')!
    for (let time = 200; time <= firstReload + 300 && battle.ammo[key] === loaded; time += 100) {
      battle.distanceM = 1000
      state.gameMs = time
      advanceBattleFor(state, ctx, battle, state.shipId, cardId)
    }
    expect(battle.ammo[key]).toBe(loaded - 1)
    refundAmmo(state, battle.ammo, battle.ammoIds)
    expect(state.warehouse.items[id]).toBe(9999)
    const back = loadSaveFile(serializeSaveFile(state, now)).state
    expect(back.fleet[state.shipId]!.ammoPref![spec.type]).toBe(id)
    expect(back.warehouse.items[id]).toBe(9999)
  })
  it('跨族与不存在档拒绝；同族最多可装/平局偏好/无货原样不变', () => {
    const state = world()
    expect(setAmmoTier(state, ctx, 'kinetic', 'ammo-plasma-3').ok).toBe(false)
    expect(setAmmoTier(state, ctx, 'kinetic', 'ammo-kinetic-4').ok).toBe(false)
    expect(setAmmoTier(state, ctx, 'kinetic', 'ammo-kinetic-3').ok).toBe(true)
    state.warehouse.items = { 'ammo-kinetic-3': 20, 'ammo-kinetic-2': 200 }
    expect(resolveAmmoTier(state, ctx, state.shipId, 'kinetic', 100).id).toBe('ammo-kinetic-2')
    state.warehouse.items['ammo-kinetic-3'] = 200
    expect(resolveAmmoTier(state, ctx, state.shipId, 'kinetic', 100).id).toBe('ammo-kinetic-3')
    expect(setAmmoTier(state, ctx, 'kinetic', null).ok).toBe(true)
    state.warehouse.items['ammo-kinetic-l'] = 200
    expect(resolveAmmoTier(state, ctx, state.shipId, 'kinetic', 100).id).toBe('ammo-kinetic-l')
  })
})
