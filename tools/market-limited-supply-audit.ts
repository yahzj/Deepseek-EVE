/** 限额慢补货长期校准，完整目录合成状态，不读个人档。
 * 用法：npx tsx tools/market-limited-supply-audit.ts；报告与桌面冒烟合成档写入忽略目录。
 * 版本自检：游戏v0.1.0 / 存档v31 / 最后核对2026-10-06。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '@whale/core'
import { advanceMarket, buyAtMarket, ensureMarket, marketQuote } from '../packages/core/src/market'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const KEY = 'min-voidcrystal'
const MINUTE = 60000
const ctx = buildSimContext()
const def = ctx.marketGoods.get(KEY)!
const cap = def.limitedSupplyCap!
const every = def.limitedSupplyEveryMs!
const per = def.limitedSupplyUnits ?? 1
const out = resolve('tools/_ui-artifacts/market-limited-supply')
mkdirSync(out, { recursive: true })
const rows = []
for (const seed of [7, 51, 105]) for (const ironman of [false, true]) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 1e12
  state.ironman = { on: ironman, seq: 1 }
  state.skills.trained['source-sweeping'] = 5
  state.standingsEarned = { dsi: 200 }
  ensureMarket(state, ctx)
  const initial = buyAtMarket(state, ctx, KEY, cap)
  assert.equal(initial.bought, cap)
  let supplied = initial.bought
  let cost = initial.total
  for (let i = 1; i <= 72 * 60; i++) {
    state.gameMs += MINUTE
    advanceMarket(state, MINUTE, ctx)
    const result = buyAtMarket(state, ctx, KEY, cap)
    supplied += result.bought
    cost += result.total
    assert.equal(supplied, cap + Math.floor(i * MINUTE / every) * per)
    assert(marketQuote(state, ctx, KEY).sellQty <= cap)
  }
  const stock = state.market.pools[KEY]!.limitedSupply!
  const round = loadSaveFile(serializeSaveFile(state, 0)).state
  assert.deepEqual(round.market.pools[KEY]!.limitedSupply, stock)
  rows.push({ seed, ironman, hours: 72, initial: cap, replenished: supplied - cap, totalBought: supplied, cost, stock })
  console.log(JSON.stringify(rows[rows.length - 1]))
}
const fixture = createInitialState({ nowWallMs: Date.now(), seed: 7 })
fixture.modeChosen = true
fixture.commsPopups = []
fixture.wallet.isk = 1e12
ensureMarket(fixture, ctx)
buyAtMarket(fixture, ctx, KEY, cap)
fixture.gameMs += 5 * MINUTE
advanceMarket(fixture, 5 * MINUTE, ctx)
fixture.commsPopups = []
const file = resolve(out, 'synthetic-save.json')
writeFileSync(file, serializeSaveFile(fixture, Date.now()), 'utf8')
writeFileSync(resolve(out, 'audit.json'), JSON.stringify({ rows, scope: '完整目录、持续每分钟买光新到货；不代表实际玩家需求', fixture: file }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, out, snapshot: fixture.market.pools[KEY]!.limitedSupply }))
