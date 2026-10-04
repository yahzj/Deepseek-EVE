/** 黑市验收档与现算价格读数。用法：npx tsx tools/make-black-market-save.ts。
 * 全新合成档，固定输出docs/test-saves/test-save-black-market-20261004.json；不访问个人档。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { blackMarketCandidateGoods } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { blackMarketTestSave } from './black-market-test-fixture'

const path = resolve('docs/test-saves/test-save-black-market-20261004.json')
mkdirSync(resolve('docs/test-saves'), { recursive: true })
writeFileSync(path, blackMarketTestSave(), 'utf8')
const pool = blackMarketCandidateGoods(buildSimContext())
console.log(JSON.stringify({ path, candidates: pool.length, exclusive: pool.filter((g) => g.playerBuyable === false).length,
  kinds: Object.fromEntries(['item', 'module', 'blueprint', 'ship', 'aicore'].map((kind) => [kind, pool.filter((g) => g.kind === kind).length])),
  minimumPrice: Math.min(...pool.map((g) => g.basePrice * 30)), maximumPrice: Math.max(...pool.map((g) => g.basePrice * 100)),
  offersPerDay: 9, unitsPerOffer: 1, priceMultiplier: [30, 100] }, null, 2))
