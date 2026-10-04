/** 市场长期买卖与库存池体检，真实核心交易，不改玩法/个人档。
 * 用法：npx tsx tools/market-health-audit.ts；输出tools/_ui-artifacts/market-health-20261004.json。
 * 72小时持续交易/停手恢复、7天完整稀有池、真实产线周期；不把flow当真实供需。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import {
  createInitialState, advanceMarket, ensureMarket, buyAtMarket, marketSellHolding, marketQuote,
  levelOf, listSellHolding, buyLineOf, startRefineRun, refineRunViews, refineBatchOutputOf,
  startManufacturing, manufacturingRunViews, getMiningParams, addShipToFleet,
  labCycleMsOf, labBatchUnitsOf,
} from '@whale/core'
import type { SimContext, GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext(), minute = ctx.balance.market.tickMs
function fresh(seed = 10403): GameState {
  const s = createInitialState({ nowWallMs: 1791100000000, seed })
  s.wallet.isk = 1e15
  s.standingsEarned = { dsi: 200 }
  s.standingClawbackDone = true
  return s
}
function tick(s: GameState, context: SimContext, ms = minute) { s.gameMs += ms; advanceMarket(s, ms, context) }
function focus(key: string): SimContext {
  return { ...ctx, marketGoods: new Map([[key, ctx.marketGoods.get(key)!]]) }
}
function measure(key: string, side: 'buy' | 'sell', perMinute: number, label: string, context = focus(key)) {
  const s = fresh(), g = context.marketGoods.get(key)!
  ensureMarket(s, context)
  let demanded = 0, filled = 0, value = 0, floorMinutes = 0, zeroPoolMinutes = 0, noFillMinutes = 0, qMin = Infinity, qMax = 0
  const hours: object[] = []
  for (let m = 0; m < 72 * 60; m++) {
    tick(s, context)
    const wanted = Math.floor((m + 1) * perMinute) - Math.floor(m * perMinute)
    demanded += wanted
    if (side === 'sell') s.warehouse.items[g.refId] = wanted
    const r = side === 'buy' ? buyAtMarket(s, context, key, wanted) : marketSellHolding(s, context, key, wanted)
    const n = 'bought' in r ? r.bought : r.sold
    filled += n; value += r.total
    // 只测现货，不把没卖掉的仓库货继续囤成挂单；部分成交会自动挂余单，清理模拟余货。
    if (side === 'sell') { s.orders = []; s.escrowItems = {} }
    const q = s.market.pools[key]!.q
    qMin = Math.min(qMin, q); qMax = Math.max(qMax, q)
    if (q === 0) zeroPoolMinutes++
    if (wanted && !n) noFillMinutes++
    if (levelOf(s, context, key) <= Math.round(g.basePrice * ctx.balance.market.minPriceRatio)) floorMinutes++
    if ((m + 1) % (24 * 60) === 0) hours.push({ hour: (m + 1) / 60, fill: filled / demanded, poolRatio: q / g.poolTarget!, levelRatio: levelOf(s, context, key) / g.basePrice, shock: s.market.pools[key]!.shock })
  }
  const endPool = s.market.pools[key]!.q / g.poolTarget!, endPrice = levelOf(s, context, key) / g.basePrice
  const recovery: object[] = []
  for (const wait of [6, 30, 60, 120, 240]) {
    const last = recovery.length ? [6, 30, 60, 120, 240][recovery.length - 1]! : 0
    tick(s, context, (wait - last) * minute)
    recovery.push({ minute: wait, poolRatio: s.market.pools[key]!.q / g.poolTarget!, levelRatio: levelOf(s, context, key) / g.basePrice, shock: s.market.pools[key]!.shock })
  }
  return { key, label, side, perHour: perMinute * 60, target: g.poolTarget, flow: g.supplyFlow, filled, demanded, fillRate: filled / demanded,
    averageBaseRatio: value / filled / g.basePrice, floorHours: floorMinutes / 60, zeroPoolHours: zeroPoolMinutes / 60, noFillHours: noFillMinutes / 60,
    minPoolRatio: qMin / g.poolTarget!, maxPoolRatio: qMax / g.poolTarget!, endPool, endPrice, hours, recovery }
}
function maxSkills(s: GameState) { for (const id of ctx.skills.keys()) s.skills.trained[id] = 5 }
const production: any[] = []
for (const skilled of [false, true]) {
  for (const ore of ['ore-veldspar','ore-nebulite','ore-voidmother','gas-neon']) {
    const s = fresh()
    if (skilled) maxSkills(s)
    s.warehouse.items[ore] = 1e9
    const r = startRefineRun(s, ore, 'pilot', ctx)
    if (!r.ok) throw new Error(r.error)
    const run = s.refineRuns[0]!, view = refineRunViews(s, ctx)[0]!
    const output = refineBatchOutputOf(s, ctx, ctx.items.get(ore)!, run.batchUnits)
    production.push({ kind: 'refine', ore, skilled, cycleMs: run.cycleMs, batch: run.batchUnits, view, hourly: output.map((o) => ({ ...o, perHour: o.units * 3600000 / run.cycleMs })) })
  }
  for (const item of ['drone-scout','drone-assault','drone-heavy','drone-sentry','ammo-kinetic-l','ammo-kinetic-2','repairkit-mil']) {
    const bp = [...ctx.blueprints.values()].find((b) => b.itemId === item)
    if (!bp) continue
    const s = fresh()
    if (skilled) maxSkills(s)
    s.learnedRecipes.push(bp.id)
    for (const material of bp.materials) s.warehouse.items[material.itemId] = 1e9
    const r = startManufacturing(s, bp.id, 'pilot', ctx)
    if (!r.ok) throw new Error(r.error)
    const run = s.manufacturingRuns[0]!
    production.push({ kind: 'manufacture', item, skilled, bp: bp.id, units: bp.outputUnits ?? 1, durationMs: run.finishAtGameMs - s.gameMs,
      perHour: (bp.outputUnits ?? 1) * 3600000 / (run.finishAtGameMs - s.gameMs), view: manufacturingRunViews(s, ctx)[0] })
  }
}
const mining: object[] = []
for (const skilled of [false,true]) {
  const s = fresh(), ship = addShipToFleet(s, 'sh-humpback')
  s.shipId = ship
  s.fleet[ship]!.fitted.high = ['mod-miner-3','mod-miner-3','mod-miner-3']
  if (skilled) maxSkills(s)
  for (const beltId of ['belt-kernite','belt-nebulite','belt-gas-aurora']) {
    const p = getMiningParams(s, ctx, { shipId: ship, beltId })!
    mining.push({ beltId, skilled, item: p.ore.id, perHour: p.unitsPerCycle * 3600000 / p.cycleMs })
  }
}
const laboratory: object[] = []
for (const skilled of [false,true]) {
  const s = fresh()
  if (skilled) maxSkills(s)
  for (const recipe of ctx.labRecipes.values()) {
    if (recipe.outputItemId !== 'jump-fuel') continue
    laboratory.push({ recipe: recipe.id, skilled, units: labBatchUnitsOf(s, recipe), cycleMs: labCycleMsOf(s, ctx, recipe, 'pilot'),
      perHour: labBatchUnitsOf(s, recipe) * 3600000 / labCycleMsOf(s, ctx, recipe, 'pilot') })
  }
}
console.log('真实产线读数完成')
const transactions: any[] = []
for (const key of ['ore-veldspar','min-tritanium','min-starcore','min-darkiron','drone-heavy','repairkit-mil']) {
  if (!ctx.marketGoods.has(key)) continue
  const g = ctx.marketGoods.get(key)!
  for (const side of ['buy', 'sell'] as const) for (const mul of [0.5, 1, 3]) {
    transactions.push(measure(key, side, g.supplyFlow! * mul, `${mul}×flow/分钟`))
  }
  console.log(key + '连续买卖完成')
}
const productionStress: any[] = []
for (const key of ['ore-veldspar','ore-nebulite','min-darkiron','min-voidcrystal','drone-heavy','drone-sentry']) {
  const output = production.filter((p) => p.skilled).flatMap((p) => p.kind === 'refine'
    ? p.hourly.filter((o: any) => o.mineralId === key).map((o: any) => o.perHour)
    : p.item === key ? [p.perHour] : [])
  const mine = mining.filter((p: any) => p.skilled && p.item === key) as { perHour: number }[]
  const rate = Math.max(0, ...output, ...mine.map((p) => p.perHour))
  if (!rate) continue
  productionStress.push(measure(key, 'sell', rate / 60, '真实单条满技能主控产线'))
  productionStress.push(measure(key, 'sell', rate * 6 / 60, '六倍单线产能压力，不冒称真实六AI总产'))
}
const arbitrage: object[] = []
for (const key of ['ore-veldspar','min-tritanium','min-starcore','drone-heavy']) for (const taxSkills of [false,true]) {
  const context = focus(key), s = fresh(), g = context.marketGoods.get(key)!
  if (taxSkills) { s.skills.trained.accounting = 5; s.skills.trained['trade-negotiation'] = 5 }
  ensureMarket(s, context)
  let cost = 0, revenue = 0, bought = 0, sold = 0
  for (let m = 0; m < 1440; m++) {
    tick(s, context)
    const buy = buyAtMarket(s, context, key, Math.max(1, Math.floor(g.supplyFlow! / 4)))
    cost += buy.total; bought += buy.bought
    const sale = marketSellHolding(s, context, key, buy.bought)
    revenue += sale.total; sold += sale.sold
  }
  arbitrage.push({ key, taxSkills, bought, sold, cost, revenue, profit: revenue - cost, returnRatio: revenue / cost })
}
const fullContext: object[] = []
for (const seed of [10403,42,2026]) {
  const s = fresh(seed)
  s.skills.trained.accounting = 5; s.skills.trained['trade-negotiation'] = 5
  ensureMarket(s, ctx)
  let cost = 0, revenue = 0, bought = 0, sold = 0
  for (let m = 0; m < 1440; m++) {
    tick(s, ctx)
    const buy = buyAtMarket(s, ctx, 'min-starcore', 33)
    const sale = marketSellHolding(s, ctx, 'min-starcore', buy.bought)
    cost += buy.total; revenue += sale.total; bought += buy.bought; sold += sale.sold
  }
  fullContext.push({ seed, key: 'min-starcore', hours: 24, bought, sold, cost, revenue, profit: revenue - cost })
}
const immediate = (() => {
  const s = fresh(), q = marketQuote(s, ctx, 'min-starcore')
  const buy = buyAtMarket(s, ctx, 'min-starcore', 50)
  const sell = marketSellHolding(s, ctx, 'min-starcore', buy.bought)
  return { key: 'min-starcore', quote: q, buy, sell, netProfit: sell.total - buy.total, quantityConserved: buy.bought === sell.sold && (s.warehouse.items['min-starcore'] ?? 0) === 0 }
})()
const idleDepth: object[] = []
for (const key of ['min-tritanium','min-darkiron','drone-heavy','jump-fuel','ammo-kinetic-2']) {
  const s = fresh()
  ensureMarket(s, ctx)
  tick(s, ctx, 24 * 60 * minute)
  idleDepth.push({ key, ...marketQuote(s, ctx, key), pool: s.market.pools[key]!.q, target: ctx.marketGoods.get(key)!.poolTarget })
}
const capitalBills: object[] = []
{
  const s = fresh()
  ensureMarket(s, ctx)
  tick(s, ctx, 24 * 60 * minute)
  const ships = [...ctx.shipBlueprints.values()].filter((bp) => ctx.marketGoods.get(bp.shipId)?.playerBuyable !== false || ctx.marketGoods.has(bp.shipId))
    .sort((a,b) => (ctx.ships.get(b.shipId)?.priceIsk ?? 0) - (ctx.ships.get(a.shipId)?.priceIsk ?? 0)).slice(0,5)
  for (const bp of ships) capitalBills.push({ blueprint: bp.id, ship: ctx.ships.get(bp.shipId)?.name, materials: bp.materials.map((m) => {
    const good = [...ctx.marketGoods.values()].find((g) => g.kind === 'item' && g.refId === m.itemId)
    const quote = good ? marketQuote(s, ctx, good.key) : undefined
    return { item: ctx.items.get(m.itemId)?.name, key: m.itemId, baseBill: m.count, pool: good?.poolTarget, flowPerMinute: good?.supplyFlow,
      buyable: good?.playerBuyable !== false, displayedStock: quote?.sellQty, fullBaseBills: (quote?.sellQty ?? 0) / m.count }
  }) })
}
const rare: object[] = []
for (const seed of [10403,42,2026]) {
  const s = fresh(seed)
  ensureMarket(s, ctx)
  const keys = ['jump-fuel','ammo-kinetic-2','ammo-explosive-2','ammo-plasma-2']
  const totals = Object.fromEntries(keys.filter((key) => ctx.marketGoods.has(key)).map((key) => [key, { purchased: 0, noStockMinutes: 0, longestWaitMinutes: 0, lastSeen: 0, stockMaximum: 0 }]))
  for (let m = 0; m < 7 * 1440; m++) {
    tick(s, ctx)
    for (const [key, total] of Object.entries(totals)) {
      const q = marketQuote(s, ctx, key).sellQty
      total.stockMaximum = Math.max(total.stockMaximum, q)
      if (!q) total.noStockMinutes++
      else { total.longestWaitMinutes = Math.max(total.longestWaitMinutes, m - total.lastSeen); total.lastSeen = m; total.purchased += buyAtMarket(s, ctx, key, q).bought }
    }
  }
  rare.push({ seed, goods: Object.fromEntries(Object.entries(totals).map(([key, t]) => [key, { ...t, perHour: t.purchased / 168, longestWaitMinutes: Math.max(t.longestWaitMinutes, 10080 - t.lastSeen) }])) })
  console.log('完整目录7天稀有补货完成seed=' + seed)
}
const split: object[] = []
for (const count of [1,10,100]) {
  const key = 'min-voidcrystal', context = focus(key), s = fresh()
  ensureMarket(s, context)
  s.market.npcBuy[key] = []
  s.warehouse.items[key] = 1e6
  const price = Math.max(1, Math.floor(buyLineOf(s, context, key) * 0.5))
  for (let n = 0; n < count; n++) {
    const r = listSellHolding(s, context, key, price, 1e6 / count)
    if (!r.ok) throw new Error(r.error)
  }
  const before = s.escrowItems[key]!
  tick(s, context)
  split.push({ orders: count, identicalStartingQuantity: 1e6, oneMinuteSold: before - (s.escrowItems[key] ?? 0), flow: context.marketGoods.get(key)!.supplyFlow, oneMinuteIsk: s.wallet.isk - 1e15,
    conserved: (s.warehouse.items[key] ?? 0) + (s.escrowItems[key] ?? 0) + before - (s.escrowItems[key] ?? 0) === 1e6 })
}
const path = resolve('tools/_ui-artifacts/market-health-20261004.json')
for (const t of [...transactions, ...productionStress]) {
  assert(Number.isFinite(t.fillRate) && t.fillRate >= 0 && t.fillRate <= 1)
  assert(Number.isFinite(t.averageBaseRatio) && t.averageBaseRatio > 0)
  assert(t.minPoolRatio >= 0 && Number.isFinite(t.maxPoolRatio))
}
assert(immediate.quantityConserved)
assert(split.every((row: any) => row.conserved))
mkdirSync(resolve('tools/_ui-artifacts'), { recursive: true })
writeFileSync(path, JSON.stringify({ baseline: '2e3a319d', production, mining, laboratory, transactions, productionStress, arbitrage, fullContext, immediate, idleDepth, capitalBills, rare, split }, null, 2), 'utf8')
console.log(JSON.stringify({ path, cases: transactions.length, productionStress: productionStress.map((t) => ({ key:t.key,label:t.label,fill:t.fillRate,price:t.averageBaseRatio,floorHours:t.floorHours,endPool:t.endPool })), arbitrage, fullContext, immediate, laboratory, idleDepth, capitalBills, rare, split }, null, 2))
