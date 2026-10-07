/** 残骸掉落与出售风险读数；只用合成状态，不改正式数据或个人存档。
 * npx tsx tools/wreck-loot-price-audit.ts [--batches=100000] [--rare=10000]
 * 游戏v0.1.0、存档v31；2026-10-07核对。报告写tools/_ui-artifacts/wreck-loot-price。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addModule, ownedModuleCount } from '../packages/core/src/equipment'
import { addWare } from '../packages/core/src/inventory'
import { ensureMarket, buyLineOf, advanceMarket, marketGoodOf, listSellHolding } from '../packages/core/src/market'
import {
  recycleProfileOf, rollRecycleLoot, rollIntactHullLoot, rollRareBoxExtra,
  wreckItemIdOf, rareWreckItemIdOf, injectWeekendWreck, rareBoxThemePoolOf,
  RECYCLE_BASE_MODULES, RECYCLE_MK2_MODULES, RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS, RARE_WRECK_VOLUME_M3,
} from '../packages/core/src/salvage'
import { startRecycleRun, advanceRefining } from '../packages/core/src/industry'
import { pullOneWreck } from '../packages/core/src/salvaging'
import { WRECK_GROUPS } from '../packages/core/src/wreckGroups'
import {
  wormholeMk3PoolOf, wormholeFamilyPoolOf,
  wormholeRareBoxThemeGroupsOf, wormholeRareBoxThemePoolOf,
} from '../packages/core/src/wormholeSalvage'
import type { GameState } from '../packages/core/src/state'

const ctx = buildSimContext()
const option = (name: string, fallback: number) => {
  const found = process.argv.find(arg => arg.startsWith(`--${name}=`))
  const value = found ? Number(found.split('=')[1]) : fallback
  assert(Number.isInteger(value) && value > 0 && value <= 1000000)
  return value
}
const batches = option('batches', 100000)
const rareTrials = option('rare', 10000)
const marketState = createInitialState({ nowWallMs: 0, seed: 7 })
ensureMarket(marketState, ctx)
const goodOf = (id: string) => marketGoodOf(ctx, ctx.modules.has(id) ? 'module' : ctx.blueprints.has(id) ? 'blueprint' : 'item', id)
const priceOf = (id: string) => goodOf(id)?.basePrice ?? 0
const buyOf = (id: string) => {
  const good = goodOf(id)
  return good?.playerSellable === false ? 0 : good ? buyLineOf(marketState, ctx, good.key) : 0
}
const nameOf = (id: string) => ctx.modules.get(id)?.name ?? ctx.items.get(id)?.name ?? ctx.blueprints.get(id)?.name ?? id
const snapshot = (state: GameState) => ({ ...state.moduleBay })
const delta = (state: GameState, before: Record<string, number>) => Object.fromEntries(
  Object.entries(state.moduleBay).map(([id, count]) => [id, count - (before[id] ?? 0)]).filter(([, count]) => Number(count) > 0),
)
const inc = (counts: Record<string, number>, id: string, count = 1) => { counts[id] = (counts[id] ?? 0) + count }
const netValue = (counts: Record<string, number>) => Object.entries(counts).reduce((n, [id, count]) => n + buyOf(id) * .95 * count, 0)
const detail = (counts: Record<string, number>) => Object.entries(counts).map(([id, count]) => ({ id, name: nameOf(id), count })).sort((a, b) => b.count - a.count)
const routes = new Map<string, Set<string>>()
const recordRoutes = (ids: readonly string[], route: string) => {
  for (const id of ids) {
    if (!routes.has(id)) routes.set(id, new Set())
    routes.get(id)!.add(route)
  }
}

const rows = WRECK_GROUPS.map((group, index) => {
  const plain = recycleProfileOf(ctx, wreckItemIdOf(group.key))!
  const rare = recycleProfileOf(ctx, rareWreckItemIdOf(group.key))!
  const ordinaryState = createInitialState({ nowWallMs: 0, seed: 101 + index * 73 })
  const ordinary: Record<string, number> = {}
  let last = '', run = 0, maxRun = 0
  for (let i = 0; i < batches; i++) {
    for (const id of rollRecycleLoot(ordinaryState, ctx, plain, RECYCLE_BATCH_M3).modules) {
      inc(ordinary, id)
      run = id === last ? run + 1 : 1
      last = id
      maxRun = Math.max(run, maxRun)
    }
  }
  const ordinaryAllowed = new Set([
    ...RECYCLE_BASE_MODULES, ...group.theme.modules ?? [],
    ...(plain.lowSec ? [...RECYCLE_MK2_MODULES, ...group.theme.mk2 ?? []] : []),
  ])
  assert(Object.keys(ordinary).every(id => ordinaryAllowed.has(id)), `${group.key}普通池出现越界装备`)
  if (batches >= 100000) assert(Object.keys(ordinary).length >= 8, `${group.key}普通池疑似卡死`)
  const intactState = createInitialState({ nowWallMs: 0, seed: 202 + index * 73 })
  const before = snapshot(intactState)
  for (let i = 0; i < 1000; i++) assert(rollIntactHullLoot(intactState, ctx, group.members[0]!))
  const intact = delta(intactState, before)

  const rareState = createInitialState({ nowWallMs: 0, seed: 303 + index * 73 })
  const rareDrops: Record<string, number> = {}
  let rareGearHits = 0
  const collected = new Set<string>()
  let lastRare = '', rareRun = 0, maxRareRun = 0
  for (let i = 0; i < rareTrials; i++) {
    const extra = rollRareBoxExtra(rareState, ctx, rare,
      wormholeRareBoxThemePoolOf(ctx, group.region), wormholeRareBoxThemeGroupsOf(ctx, group.region))!
    assert(extra)
    const ids = [...extra.modules, ...extra.drones.map(d => d.id), ...extra.blueprints]
    const gearId = ids.find(id => rare.lairGear?.includes(id))
    if (gearId) {
      rareGearHits++
      if (collected.size < (rare.lairGear?.length ?? 0)) assert(!collected.has(gearId), `${group.key}专属集齐前重样`)
      collected.add(gearId)
    }
    if (ids[0]) {
      rareRun = ids[0] === lastRare ? rareRun + 1 : 1
      lastRare = ids[0]
      maxRareRun = Math.max(maxRareRun, rareRun)
    }
    for (const id of extra.modules) { inc(rareDrops, id); addModule(rareState, id) }
    for (const row of extra.drones) { inc(rareDrops, row.id, row.count); addWare(rareState, row.id, row.count) }
    for (const id of extra.blueprints) {
      inc(rareDrops, id)
      rareState.blueprintStock[id] = (rareState.blueprintStock[id] ?? 0) + 1
    }
  }
  const theme = rareBoxThemePoolOf(rare)
  recordRoutes(RECYCLE_BASE_MODULES, `${group.key}:普通基础/完好兜底`)
  recordRoutes(group.theme.modules ?? [], `${group.key}:普通基础/完好混池`)
  if (plain.lowSec) recordRoutes([...RECYCLE_MK2_MODULES, ...group.theme.mk2 ?? []], `${group.key}:普通MK2/完好MK2`)
  recordRoutes(theme, `${group.key}:稀有主题`)
  recordRoutes(rare.lairGear ?? [], `${group.key}:稀有专属`)
  for (const fallback of wormholeRareBoxThemeGroupsOf(ctx, group.region)) recordRoutes(fallback.ids, `${group.key}:稀有${fallback.weight === 1 ? 'MK2' : 'MK3'}兜底`)
  return {
    key: group.key, name: group.name, region: group.region, tier: group.tier,
    ordinary: { batches, volumeM3: batches * RECYCLE_BATCH_M3, drops: detail(ordinary), maxConsecutiveSame: maxRun, grossBuyValue: netValue(ordinary) / .95 },
    intact: { hits: 1000, drops: detail(intact), theme: group.theme.modules ?? [], netPerHit: netValue(intact) / 1000 },
    rare: { boxes: rareTrials, gearHits: rareGearHits, collected: [...collected], maxConsecutiveSame: maxRareRun, drops: detail(rareDrops), netPerBox: netValue(rareDrops) / rareTrials },
  }
})

for (const family of ['A', 'C', 'D', 'E', 'G']) recordRoutes(wormholeFamilyPoolOf(ctx, family).modules, `${family}:信号空间安全货柜`)
recordRoutes(wormholeMk3PoolOf(ctx), '军用备货柜')
const priceRows = [...routes].map(([id, routes]) => ({
  id, name: nameOf(id), marketPrice: priceOf(id), baseBuy: buyOf(id), netAt5PctTax: buyOf(id) * .95,
  kind: ctx.modules.has(id) ? 'module' : ctx.blueprints.has(id) ? 'blueprint' : 'item',
  demandMultiplier: goodOf(id)?.demandMultiplier, routes: [...routes],
})).sort((a, b) => b.baseBuy - a.baseBuy)
const moduleCatalogue = [...ctx.modules].map(([id, module]) => ({
  id, name: module.name, basePrice: priceOf(id), baseBuy: buyOf(id), reachable: routes.has(id),
})).sort((a, b) => b.baseBuy - a.baseBuy)

// 真打捞入口：只在合成ctx中强制命中，证明抽取对象，不用它冒称自然触发频率。
const forcedCtx = { ...ctx, balance: { ...ctx.balance, intactHullRatePerMin: 60 } }
const tenPulls = ['R', 'H', 'C'].map(family => {
  const state = createInitialState({ nowWallMs: 0, seed: 777 })
  injectWeekendWreck(state, 'galaxy-redring', 100000, family)
  const before = snapshot(state)
  const pulls = Array.from({ length: 10 }, () => pullOneWreck(state, forcedCtx, 'galaxy-redring', 60000)!.itemId)
  assert(pulls.every(id => id === (family === 'H' ? 'wreck-h-hi' : `wreck-${family.toLowerCase()}-inv`)))
  return { family, pulls, modules: delta(state, before), logs: state.logs.filter(log => log.textId === 'core.salvaging.019').length }
})

function furnace(itemId: string, seed: number, count: number) {
  const state = createInitialState({ nowWallMs: 0, seed })
  const size = itemId.startsWith('wreck-rare-') ? RARE_WRECK_VOLUME_M3 : RECYCLE_BATCH_M3
  addWare(state, itemId, count * size)
  const before = snapshot(state)
  const credits = state.wallet.isk
  assert(startRecycleRun(state, itemId, 'pilot', ctx).ok)
  for (let i = 0; i < count + 4 && state.refineRuns.length; i++) {
    state.gameMs += RECYCLE_CYCLE_MS
    advanceRefining(state, ctx)
  }
  assert(state.refineRuns.length === 0)
  assert(state.wallet.isk === credits, '回收仅入货，不直接入信用点')
  return { itemId, batches: count, modules: delta(state, before), creditsDelta: state.wallet.isk - credits,
    rarePayouts: state.rareBoxesOpened[itemId] ?? 0, burned: state.rareBurnUnits[itemId] ?? 0 }
}
const furnaces = [furnace('wreck-r-inv', 401, 1000), furnace('wreck-rare-r-inv', 402, 1000)]
assert.equal(furnaces[0]!.rarePayouts, 0)
assert.equal(furnaces[1]!.rarePayouts, 1000)

// 卖出通道：真实挂单/推进，原生目录与税，不注入NPC买单。
const disposal = ['mod-lair-laser-c', 'mod-lair-blink-r', 'mod-shield-pla-2', 'mod-shieldfield-3', 'mod-dc-3', 'mod-warpcomp-3'].map(id => {
  const state = createInitialState({ nowWallMs: 0, seed: 503 })
  ensureMarket(state, ctx)
  addModule(state, id, 10)
  const before = state.wallet.isk
  const good = goodOf(id)!
  const price = Math.max(1, Math.floor(buyLineOf(state, ctx, good.key) * .9))
  assert(listSellHolding(state, ctx, good.key, price, 10).ok)
  const atPlacement = state.wallet.isk - before
  for (let i = 0; i < 120; i++) {
    state.gameMs += 60000
    advanceMarket(state, 60000, ctx)
  }
  assert(Number.isFinite(state.wallet.isk - before))
  return { id, name: nameOf(id), listed: 10, price, atPlacement, afterTwoHours: state.wallet.isk - before,
    remaining: state.orders.filter(order => order.side === 'sell' && order.good === good.key).reduce((n, row) => n + row.qty, 0) }
})

// 专属退池判据把托管也算当前持有；先验证挂售一件不会再把它当作唯一缺件。
const targetState = createInitialState({ nowWallMs: 0, seed: 607 })
ensureMarket(targetState, ctx)
const rRare = recycleProfileOf(ctx, 'wreck-rare-r-inv')!
const targetId = 'mod-lair-blink-r'
for (const id of rRare.lairGear!) addModule(targetState, id)
assert(listSellHolding(targetState, ctx, targetId, priceOf(targetId), 1).ok)
assert.equal(ownedModuleCount(targetState, targetId), 0)
assert.equal(targetState.escrowItems[targetId], 1)
let targeted = 0, gearHits = 0
const allRare = new Set<string>()
for (let i = 0; i < 3000; i++) {
  const out = rollRareBoxExtra(targetState, ctx, rRare)!
  for (const id of out.modules) {
    addModule(targetState, id)
    if (!rRare.lairGear!.includes(id)) continue
    gearHits++
    allRare.add(id)
    if (id === targetId) {
      assert(listSellHolding(targetState, ctx, targetId, priceOf(targetId), 1).ok)
      targeted++
    }
  }
}
assert(allRare.size > 1)
const targeting = { boxes: 3000, gearHits, targeted, gearSeen: [...allRare], stillInBay: ownedModuleCount(targetState, targetId),
  listedInEscrow: targetState.escrowItems[targetId] }

const paths = resolve('tools/_ui-artifacts/wreck-loot-price')
mkdirSync(paths, { recursive: true })
const out = { scope: '当前ctx；普通回收100m3/批、固定合成种子；稀有抽取更新真实持有账；只统计装备/机群/图纸，碎片矿物核心不计出售均值。基准买价不等于即时成交或可无限兑现。', batches, rareTrials, rows, priceRows, moduleCatalogue, tenPulls, furnaces, disposal, targeting }
writeFileSync(resolve(paths, 'audit.json'), JSON.stringify(out, null, 2), 'utf8')
const fmt = (n: number) => Math.round(n).toLocaleString('zh-CN')
const lines = [
  '# 残骸掉落与装备出售审查', '', out.scope, '',
  '| 残骸组 | 普通回收装备种类/数量 | 普通最长同件连续 | 完好混池主题 | 稀有专属命中 | 稀有箱装备净估值/具 |',
  '|---|---|---:|---|---|---:|',
  ...rows.map(r => `| ${r.key} | ${r.ordinary.drops.length}/${r.ordinary.drops.reduce((n, d) => n + d.count, 0)} | ${r.ordinary.maxConsecutiveSame} | ${r.intact.theme.map(nameOf).join('、') || '无追加件'} | ${r.rare.gearHits}/${r.rare.boxes} | ${fmt(r.rare.netPerBox)} |`), '',
  '## 可重复获得的高价装备', '', '| 装备 | 基准价格 | 基准NPC买价 | 5%税后 | 来源 |', '|---|---:|---:|---:|---|',
  ...priceRows.filter(row => row.kind === 'module').map(r => `| ${r.name} | ${fmt(r.marketPrice)} | ${fmt(r.baseBuy)} | ${fmt(r.netAt5PctTax)} | ${r.routes.join('、')} |`), '',
  '## 十件真实挂售', '', '| 装备 | 每件挂价 | 挂单时收入 | 两小时收入 | 剩余 |', '|---|---:|---:|---:|---:|',
  ...disposal.map(r => `| ${r.name} | ${fmt(r.price)} | ${fmt(r.atPlacement)} | ${fmt(r.afterTwoHours)} | ${r.remaining} |`), '',
  '## 真实入口复现', '', '强制完好命中仅读取测试ctx，不修改默认0.08%/分钟；每族10轮：', ...tenPulls.map(row => `- ${row.family}：${JSON.stringify(row.modules)}；普通残骸来源${row.pulls[0]}；完好日志${row.logs}。`), '',
  ...furnaces.map(row => `- ${row.itemId}：${row.batches}批；高级箱结算${row.rarePayouts}；信用点变化${row.creditsDelta}。`), '',
  `稀有专属当前持有判据：保留另外三件光环装备，将规避装置挂待售；${targeting.boxes}箱命中${targeting.gearHits}次专属，其中规避装置${targeting.targeted}次，共出现${targeting.gearSeen.length}种。装备库持有${targeting.stillInBay}，待售托管${targeting.listedInEscrow}；不再仅因挂待售就定向补件，售完后仍沿用当前持有规则。`, '',
]
writeFileSync(resolve(paths, 'audit.md'), lines.join('\n'), 'utf8')
console.log(lines.slice(0, 23).join('\n'))
console.log(JSON.stringify({ tenPulls, furnaces, disposal, targeting, highValue: priceRows.filter(row => row.kind === 'module').slice(0, 10) }, null, 2))
console.log(`报告：${resolve(paths, 'audit.md')}`)
