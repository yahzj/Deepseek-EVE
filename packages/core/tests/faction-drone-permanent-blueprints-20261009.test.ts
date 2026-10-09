import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { BLUEPRINTS, buildSimContext, L10N, l10nEntryText, BLUEPRINT_PRICE_OVERRIDES } from '@whale/data'
import itemData from '../../data/src/static/items.json'
import marketData from '../../data/src/static/market.json'
import { createInitialState } from '../src/state'
import { blackMarketBuy, blackMarketCandidateGoods, ensureBlackMarket, blackMarketLotQuantity } from '../src/blackMarket'
import { learnBlueprint, ensureMarket, advanceMarket, buyAtMarket, placeBuyOrder, listSellHolding, cancelOrder } from '../src/market'
import { fireMarketOrderEvent } from '../src/events'
import { advanceManufacturing, calcBuildDurationMs, cancelManufacturing, startManufacturing } from '../src/manufacturing'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { addShipToFleet } from '../src/fleetBook'
import { adjustDroneLoad, droneCpuUsed } from '../src/equipment'
import { advanceBattleFor, createPlayerSpec, startBattleFor } from '../src/combat'
import { FOE_LAIR_GEAR } from '../src/lairs'
import { FRAGMENT_RECIPES } from '../src/salvage'
import { wormholeFamilyPoolOf } from '../src/wormholeSalvage'
import { deferredL10nIssues } from '../../../tools/l10n-deferred-check'

const ctx = buildSimContext(), root = new URL('../../../', import.meta.url)
const baseline = 'c2c5fb6b'
const now = new Date(2026, 9, 9, 12).getTime()
const cases = [
  { id: 'bp-faction-drone-bee', item: 'drone-exile-bee', price: 2400000, seconds: 180, source: 'bp-lair-g-drone', index: 1 },
  { id: 'bp-faction-drone-hiveguard', item: 'drone-wh-c-heavy', price: 4800000, seconds: 360, source: 'bp-wh-c-drone', index: 2 },
  { id: 'bp-faction-drone-construct', item: 'drone-wh-e-sentry', price: 8800000, seconds: 540, source: 'bp-wh-e-drone', index: 3 },
  { id: 'bp-faction-drone-ink', item: 'drone-ink-heavy', price: 4800000, seconds: 360, source: 'bp-wh-c-drone', index: 4 },
  { id: 'bp-faction-drone-jawclaw', item: 'drone-jawclaw', price: 2400000, seconds: 180, source: 'bp-lair-g-drone', index: 5 },
] as const
function world() {
  const state = createInitialState({ nowWallMs: now, seed: 42 })
  state.standingsEarned = { dsi: 100 }
  state.wallet.isk = 1e12
  return state
}
function old(file: string) {
  return execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true })
}

describe('五种势力无人机永久图纸', () => {
  it.each(cases)('$id参数与报价相符，非一次性、非隐式，黑市卖一本不乘50', row => {
    const bp = ctx.blueprints.get(row.id)!, good = ctx.marketGoods.get(row.id)!
    expect(bp).toMatchObject({ itemId: row.item, outputUnits: 50, buildSeconds: row.seconds, priceIsk: row.price, buildCostIsk: 0 })
    expect(bp.singleUse).not.toBe(true)
    expect(bp.learnless).not.toBe(true)
    expect(bp.materials).toEqual(ctx.blueprints.get(row.source)!.materials)
    expect(BLUEPRINT_PRICE_OVERRIDES[row.id]!.price).toBe(row.price)
    expect(row.price).toBe(ctx.marketGoods.get(row.item)!.basePrice * 100)
    expect(good).toMatchObject({ playerBuyable: false, blackMarketBuyable: true, rarityTier: 4, basePrice: row.price })
    expect(good.playerSellable).not.toBe(false)
    expect(blackMarketLotQuantity(ctx, good)).toBe(1)
    expect(blackMarketCandidateGoods(ctx).some(g => g.key === row.id)).toBe(true)
  })

  it.each(cases)('$id真实黑市买书→永久学习→连续两批，成本/工期/存档不消耗配方', row => {
    const state = world(), good = ctx.marketGoods.get(row.id)!, bp = ctx.blueprints.get(row.id)!
    const narrow = { ...ctx, marketGoods: new Map([[row.id, good]]) }
    expect(ensureBlackMarket(state, narrow, now)).toBe(true)
    const offer = state.blackMarket!.offers[0]!
    expect(offer.quantity ?? 1).toBe(1)
    expect(offer.price).toBe(row.price * offer.multiplier)
    expect(offer.price).toBeGreaterThanOrEqual(row.price * 30)
    expect(offer.price).toBeLessThanOrEqual(row.price * 100)
    const money = state.wallet.isk
    expect(blackMarketBuy(state, narrow, row.id, state.blackMarket!.dayWallMs, offer.price, now, 1).ok).toBe(true)
    expect(state.wallet.isk).toBe(money - offer.price)
    expect(state.blueprintStock[row.id]).toBe(1)
    expect(learnBlueprint(state, ctx, row.id).ok).toBe(true)
    expect(state.blueprintStock[row.id] ?? 0).toBe(0)
    expect(calcBuildDurationMs(state, ctx, bp)).toBe(row.seconds * 1000)
    for (const need of bp.materials) state.warehouse.items[need.itemId] = need.count * 2
    const afterBuy = state.wallet.isk
    for (let batch = 1; batch <= 2; batch++) {
      expect(startManufacturing(state, row.id, 'pilot', ctx).ok).toBe(true)
      const run = state.manufacturingRuns.find(run => run.active && run.blueprintId === row.id)!
      state.gameMs = run.finishAtGameMs
      advanceManufacturing(state, ctx)
      expect(state.warehouse.items[row.item]).toBe(batch * 50)
    }
    expect(state.learnedRecipes).toContain(row.id)
    expect(state.wallet.isk).toBe(afterBuy)
    for (const need of bp.materials) expect(state.warehouse.items[need.itemId] ?? 0).toBe(0)
    const loaded = loadSaveFile(serializeSaveFile(state, now)).state
    expect(loaded.learnedRecipes).toContain(row.id)
    expect(loaded.warehouse.items[row.item]).toBe(100)
    expect(loaded.blackMarket!.offers[0]!.sold).toBe(true)
    expect(ensureBlackMarket(loaded, narrow, now)).toBe(false)
  })

  it.each(cases)('$id未学/缺料拒绝不扣款，取消退料，重复书保留且可挂卖撤单', row => {
    const state = world(), bp = ctx.blueprints.get(row.id)!
    const before = JSON.stringify(state)
    expect(startManufacturing(state, row.id, 'pilot', ctx).ok).toBe(false)
    expect(JSON.stringify(state)).toBe(before)
    state.blueprintStock[row.id] = 2
    expect(learnBlueprint(state, ctx, row.id).ok).toBe(true)
    const known = JSON.stringify(state)
    expect(startManufacturing(state, row.id, 'pilot', ctx).ok).toBe(false)
    expect(learnBlueprint(state, ctx, row.id)).toMatchObject({ ok: false, errorId: 'core.market.004' })
    expect(JSON.stringify(state)).toBe(known)
    expect(listSellHolding(state, ctx, row.id, row.price * 2, 1).ok).toBe(true)
    expect(cancelOrder(state, ctx, state.orders.find(order => order.good === row.id)!.id)).toBe(true)
    expect(state.blueprintStock[row.id]).toBe(1)
    for (const need of bp.materials) state.warehouse.items[need.itemId] = need.count
    expect(startManufacturing(state, row.id, 'pilot', ctx).ok).toBe(true)
    const run = state.manufacturingRuns.find(run => run.active && run.blueprintId === row.id)!
    expect(cancelManufacturing(state, ctx, run.id).ok).toBe(true)
    for (const need of bp.materials) expect(state.warehouse.items[need.itemId]).toBe(need.count)
    expect(state.blueprintStock[row.id]).toBe(1)
    expect(state.learnedRecipes).toContain(row.id)
  })

  it('普通市场和事件不给NPC卖单，不进旧族池/窝点/碎片，当前日货架不重抽', () => {
    const state = world()
    ensureMarket(state, ctx)
    ensureBlackMarket(state, ctx, now)
    const board = structuredClone(state.blackMarket)
    expect(ensureBlackMarket(state, ctx, now + 10000)).toBe(false)
    expect(state.blackMarket).toEqual(board)
    for (let i = 1; i <= 30; i++) {
      state.gameMs = i * 600000
      advanceMarket(state, 600000, ctx)
      fireMarketOrderEvent(state, ctx)
    }
    for (const row of cases) {
      expect(state.market.npcSell[row.id] ?? []).toEqual([])
      expect(buyAtMarket(state, ctx, row.id, 1).bought).toBe(0)
      expect(placeBuyOrder(state, ctx, row.id, 1e9, 1)).toBeNull()
      expect(Object.values(FOE_LAIR_GEAR).flat()).not.toContain(row.id)
      expect(Object.values(FRAGMENT_RECIPES).some(recipe => recipe.blueprintId === row.id)).toBe(false)
      for (const family of ['A', 'C', 'D', 'E', 'G']) expect(wormholeFamilyPoolOf(ctx, family).moduleBlueprints).not.toContain(row.id)
    }
    expect(state.market.npcSell['drone-jawclaw'] ?? []).toEqual([])
    for (const family of ['A', 'C', 'D', 'E', 'G']) expect(wormholeFamilyPoolOf(ctx, family).drones).not.toContain('drone-jawclaw')
  })

  it('所有旧蓝图、物品、市场行和敌方机型逐项保持，仅追加批准内容', () => {
    const source = ts.createSourceFile('old.ts', old('packages/data/src/blueprints.ts'), ts.ScriptTarget.Latest, true)
    const scope = { exports: {} as { BLUEPRINTS: typeof BLUEPRINTS }, L10N, require: () => ({ L10N }) }
    runInNewContext(ts.transpileModule(source.getText(), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    // 后续获批新增不改变本批前已有蓝图，只检查原ID集合与相对顺序。
    const legacyIds = new Set(scope.exports.BLUEPRINTS.map(bp => bp.id))
    expect(BLUEPRINTS.filter(bp => legacyIds.has(bp.id))).toEqual(scope.exports.BLUEPRINTS)
    for (const [file, document] of [['packages/data/src/static/items.json', itemData], ['packages/data/src/static/market.json', marketData]] as const) {
      const legacy = JSON.parse(old(file)) as typeof document
      const copy = structuredClone(document)
      for (const group of Object.keys(copy.groups)) {
        const originalRows = (legacy.groups as Record<string, Array<Record<string, unknown>>>)[group]!
        const ids = new Set(originalRows.map(row => row.id ?? row.key))
        ;(copy.groups as Record<string, Array<Record<string, unknown>>>)[group] = (copy.groups as Record<string, Array<Record<string, unknown>>>)[group]!.filter(row => ids.has(row.id ?? row.key))
      }
      expect(copy).toEqual(legacy)
    }
    const oldFoes = JSON.parse(old('packages/data/src/static/foeDrones.json'))
    Object.assign(oldFoes.groups.parameters.find((drone: { id: string }) => drone.id === 'foe-drone-c-jawclaw'), {
      defense_shieldHp: 12, defense_armorHp: 30, defense_hullHp: 48, defense_evasion: .25, dmg: 10, hitRate: .85, maxRangeM: 5000,
    })
    expect(JSON.parse(readFileSync(new URL('packages/data/src/static/foeDrones.json', root), 'utf8'))).toEqual(oldFoes)
    for (const id of ['bp-lair-g-drone', 'bp-wh-c-drone', 'bp-wh-e-drone']) expect(ctx.blueprints.get(id)!.singleUse).toBe(true)
  })

  it('颚钳玩家物品裸值、CPU/体积与真放飞规格一致，不复制敌载体加成', () => {
    const item = ctx.items.get('drone-jawclaw')!
    expect(item).toMatchObject({ kind: 'drone', droneClass: 'combat', damageType: 'kinetic', dmg: 10, hitRate: .85,
      falloff: 1, maxRangeM: 5000, unitM3: 10, cpuUse: 8, baseSellPriceIsk: 24000,
      defense: { shieldHp: 12, armorHp: 30, hullHp: 48, evasion: .25 } })
    const state = world(), shipId = addShipToFleet(state, 'sh-wh-c-cruiser')
    state.shipId = shipId
    state.warehouse.items['drone-jawclaw'] = 10
    expect(adjustDroneLoad(state, ctx, 'drone-jawclaw', 5, shipId).ok).toBe(true)
    expect(droneCpuUsed(state.fleet[shipId]!.droneLoad, ctx)).toBe(40)
    const spec = createPlayerSpec(state, ctx, shipId)!
    const drones = spec.weapons.filter(weapon => weapon.src === 'drone')
    expect(drones).toHaveLength(5)
    // 玩家出击周期的既有伤害×2照常作用，不复制敌方C族/导控腔修正。
    expect(drones[0]).toMatchObject({ artId: item.id, shotDmg: item.dmg! * 2, fixedType: 'kinetic', hitRate: .85, reloadMs: 4400, maxRangeM: 5000 })
    const battle = startBattleFor(state, ctx, shipId, 'ano-pirate-post', 0, 2000)
    expect(battle).not.toBeNull()
    if (!battle) throw new Error('未创建战斗')
    state.gameMs = 10000
    advanceBattleFor(state, ctx, battle, shipId, 'ano-pirate-post')
    expect(battle.stats.meShots).toBeGreaterThan(0)
    expect(Object.values(battle.dronePools ?? {}).some(pool => pool.artId === item.id)).toBe(true)
    const pools = Object.values(battle.dronePools ?? {}).filter(pool => pool.artId === item.id)
    expect(pools).toHaveLength(5)
    expect(pools[0]).toMatchObject({ maxS: 12, maxA: 30, maxH: 48, evasion: .25 })
    state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: 'ano-pirate-post', battle }
    const loaded = loadSaveFile(serializeSaveFile(state, now)).state
    expect(loaded.fleet[shipId]!.droneLoad).toEqual({ 'drone-jawclaw': 5 })
    expect(Object.values(loaded.expedition.battle!.dronePools ?? {}).filter(pool => pool.artId === item.id)).toHaveLength(5)
  })

  it.each(['zh', 'en'] as const)('%s新名称/说明严格回退已批准中文，旧英文保留、待译登记完整', locale => {
    const localized = buildSimContext(locale)
    for (const row of cases) {
      const prefix = `bp.factionDrone.${String(row.index).padStart(3, '0')}`
      expect(localized.blueprints.get(row.id)!.name).toBe(L10N[prefix]!.zh)
      expect(localized.blueprints.get(row.id)!.description).toBe(L10N[`bp.factionDrone.${String(row.index + 5).padStart(3, '0')}`]!.zh)
    }
    expect(localized.items.get('drone-jawclaw')!.name).toBe(l10nEntryText(L10N['item.jawclaw.001']!, locale))
    const backlog = readFileSync(new URL('docs/l10n-pending.md', root), 'utf8')
    expect(deferredL10nIssues(L10N, backlog)).toEqual([])
  })
})
