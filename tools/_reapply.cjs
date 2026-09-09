// 一次性:重新应用巡洋价格与声望(2026-09-09 定档;之前被并行提交交叉丢失)
const fs = require('fs')
// 1) ships.ts 四艘 priceIsk
let s = fs.readFileSync('packages/data/src/ships.ts', 'utf8')
const map = { sh_thresher: '9_000_000', sh_hammerhead: '11_000_000', sh_bullshark: '13_000_000', sh_electricray: '15_000_000' }
for (const [k, price] of Object.entries(map)) {
  const id = k.replace('_', '-')
  const re = new RegExp("(id: '" + id + "',[\\s\\S]*?priceIsk: )\\d+(_\\d+)?,", 'm')
  const before = s
  s = s.replace(re, '$1' + price + ',')
  console.log('ships ' + id + ': ' + (s !== before ? 'ok' : 'MISS'))
}
fs.writeFileSync('packages/data/src/ships.ts', s, 'utf8')
// 2) marketCatalog: 巡洋 4 行价 + sentinel 10 + whale-king 补 11
let m = fs.readFileSync('packages/data/src/marketCatalog.ts', 'utf8')
const mreps = [
  ["key: 'ship-thresher'", "basePrice: 9_000_000"],
  ["key: 'ship-electricray'", "basePrice: 15_000_000"],
  ["key: 'ship-hammerhead'", "basePrice: 11_000_000"],
  ["key: 'ship-bullshark'", "basePrice: 13_000_000"],
]
for (const [key, price] of mreps) {
  const re = new RegExp("(\\{ key: '" + key.replace("key: '", '') + "',[\\s\\S]*?basePrice: )\\d+(_\\d+)?,", 'm')
  const before = m
  m = m.replace(re, '$1' + price + ',')
  console.log('mkt ' + key + ': ' + (m !== before ? 'ok' : 'MISS'))
}
// sentinel 6->10
m = m.replace("standingReq: 6 },\n  { key: 'ship-whiteshark'", "standingReq: 10 }, // 2026-09-09 船长定：无人机母舰声望 6→10\n  { key: 'ship-whiteshark'")
console.log('sentinel req: ' + (/standingReq: 10 }, \/\/ 2026-09-09 船长定：无人机母舰/.test(m) ? 'ok' : 'MISS'))
// whale-king 补 11(两行)
const wk = m.indexOf("key: 'ship-whale-king'")
console.log('whale-king find: ' + (wk >= 0 ? 'ok' : 'MISS'))
if (wk >= 0) {
  m = m.replace(/\{ key: 'ship-whale-king',[^\n]*\n/, '{ key: \'ship-whale-king\', kind: \'ship\', refId: \'whale-king\', rarity: \'exotic\', basePrice: 4_800_000, demandMultiplier: 1.0, standingReq: 11 },\n')
  m = m.replace(/\{ key: 'sbp-whale-king',[^\n]*\n/, '{ key: \'sbp-whale-king\', kind: \'blueprint\', refId: \'sbp-whale-king\', rarity: \'exotic\', basePrice: 600_000, demandMultiplier: 1.0, standingReq: 11 },\n')
}
fs.writeFileSync('packages/data/src/marketCatalog.ts', m, 'utf8')
console.log('done')
