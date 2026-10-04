/** 商品池容量单变量体检：只改合成ctx的poolTarget，其余现行规则不变。
 * 用法：先npx tsx tools/market-health-audit.ts，再npx tsx tools/market-pool-capacity-audit.ts。
 * 读前一工具的真实产线读数，72小时现货卖出与停手恢复；不读取个人档或修改游戏目录。
 * 输出tools/_ui-artifacts/market-pool-capacity-20261004.json。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInitialState, ensureMarket, advanceMarket, marketSellHolding, levelOf } from '@whale/core'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const readings = JSON.parse(readFileSync(resolve('tools/_ui-artifacts/market-health-20261004.json'), 'utf8')) as {
  productionStress: { key: string; label: string; perHour: number }[]
  production: { skilled: boolean; item?: string; perHour?: number; hourly?: { mineralId: string; perHour: number }[] }[]
}
const rows: object[] = []
const proposalTargets: Record<string, number> = {
  'min-darkiron': 16000, 'min-voidcrystal': 48000, 'min-starcore': 48000,
  'drone-scout': 18000, 'drone-assault': 18000, 'drone-heavy': 12000, 'drone-sentry': 9000,
}
for (const key of Object.keys(proposalTargets)) {
  const baseline = ctx.marketGoods.get(key)!
  const perHour = Math.max(...readings.production.filter((p) => p.skilled).flatMap((p) =>
    p.item === key ? [p.perHour!] : (p.hourly ?? []).filter((o) => o.mineralId === key).map((o) => o.perHour)))
  assert(Number.isFinite(perHour) && perHour > 0)
  for (const target of [...new Set([1, 4, 10, 40].map((m) => baseline.poolTarget! * m).concat(proposalTargets[key]!))]) {
    const multiplier = target / baseline.poolTarget!
    const def = { ...baseline, poolTarget: target }
    const context = { ...ctx, marketGoods: new Map([[key, def]]) }
    const state = createInitialState({ seed: 10403, nowWallMs: 1791100000000 })
    state.wallet.isk = 1e12
    state.standingsEarned = { dsi: 200 }
    ensureMarket(state, context)
    let wanted = 0, sold = 0, earned = 0, floorMinutes = 0
    for (let m = 0; m < 72 * 60; m++) {
      state.gameMs += 60000
      advanceMarket(state, 60000, context)
      const amount = Math.floor((m + 1) * perHour / 60) - Math.floor(m * perHour / 60)
      wanted += amount
      state.warehouse.items[def.refId] = amount
      const result = marketSellHolding(state, context, key, amount)
      sold += result.sold; earned += result.total
      state.orders = []; state.escrowItems = {}
      if (levelOf(state, context, key) <= Math.round(def.basePrice * context.balance.market.minPriceRatio)) floorMinutes++
    }
    const pool = state.market.pools[key]!
    const end = { poolRatio: pool.q / def.poolTarget, levelRatio: levelOf(state, context, key) / def.basePrice, shock: pool.shock }
    const recovery: object[] = []
    let previous = 0
    for (const minutes of [30, 60, 120, 240]) {
      const ms = (minutes - previous) * 60000
      state.gameMs += ms; advanceMarket(state, ms, context); previous = minutes
      recovery.push({ minutes, poolRatio: pool.q / def.poolTarget, levelRatio: levelOf(state, context, key) / def.basePrice })
    }
    assert.equal(def.supplyFlow, baseline.supplyFlow)
    assert(Number.isFinite(earned) && sold <= wanted && sold > 0)
    rows.push({ key, multiplier, proposal: target === proposalTargets[key], poolTarget: def.poolTarget, flowUnchanged: def.supplyFlow, perHour,
      fillRate: sold / wanted, netPriceRatio: earned / sold / def.basePrice, floorHours: floorMinutes / 60, end, recovery })
  }
  console.log(key + '容量1/4/10/40倍与候选目标完成')
}
const out = resolve('tools/_ui-artifacts/market-pool-capacity-20261004.json')
mkdirSync(resolve('tools/_ui-artifacts'), { recursive: true })
writeFileSync(out, JSON.stringify({ baseline: readings.productionStress.length, assumptions: '满技能主控单线供料充足、单商品ctx、仅改容量', rows }, null, 2), 'utf8')
console.log(JSON.stringify({ out, rows }, null, 2))
