/** 导出独立后台使用的玩家市场目录，不读取个人档。
 * 用法：npx tsx tools/export-market-relay-metadata.ts <输出JSON路径> [--check]
 * --check 只核对现有文件；普通模式由当前游戏目录生成部署快照。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { marketTradingGoods } from '../packages/core/src/market/access'

const args = process.argv.slice(2)
const output = args.find(arg => arg !== '--check')
if (!output || args.some(arg => arg.startsWith('--') && arg !== '--check')) {
  throw new Error('用法：npx tsx tools/export-market-relay-metadata.ts <输出JSON路径> [--check]')
}
const path = resolve(output)
if (!path.endsWith('.json')) throw new Error('输出路径必须是JSON文件')
const goods = marketTradingGoods(buildSimContext()).map(good => ({
  key: good.key, refId: good.refId, kind: good.kind, basePrice: good.basePrice,
  ...(good.playerBuyable === false ? { playerBuyable: false } : {}),
  ...(good.playerSellable === false ? { playerSellable: false } : {}),
}))
if (new Set(goods.map(good => good.key)).size !== goods.length ||
  goods.some(good => !Number.isSafeInteger(good.basePrice) || good.basePrice < 0)) {
  throw new Error('商品目录存在重复键或无效参考价')
}
const text = JSON.stringify({ source: 'Deepseek-EVE: marketTradingGoods(buildSimContext())', goods }, null, 2) + '\n'
if (args.includes('--check')) {
  if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== text) throw new Error('后台市场目录与当前游戏数据不一致，请重新导出')
} else writeFileSync(path, text, 'utf8')
console.log(`${args.includes('--check') ? '目录一致' : '已导出'}：${goods.length}条，${goods.filter(good => good.basePrice === 0).length}条无参考价；${path}`)
