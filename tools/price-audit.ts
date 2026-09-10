/**
 * 装备价对齐审查（2026-09-10 船长：「上调所有 MK2 和 MK3 级别的装备价格，对齐该级别的武器价格
 * （参照列出供我审查）」——原临时探针 `_probe-mk-price-audit.ts` 按工具纪律**转正入库**）。
 *
 * 用途：**价格校准前后**列出「同级别装备现价 vs 同级武器价」的对照表，并给出两套对齐规则的提议价，
 * 供船长审查，也供日后改 `marketCatalog.ts` 的 `basePrice` 后复跑核对新差距。
 *
 * 运行：npx tsx tools/price-audit.ts（等价 `npm run price:audit`）
 *
 * 口径：
 * - 武器 = 槽位 turret / missile / laser 三武（锚点）；
 * - 非武器装备 = 其余槽位（shield / armor / propulsion / support / target-lock / salvager /
 *   drone-rack / drone-tac / drone-relay / miner / cargo）；
 * - 级别按**模块名里的 MK 编号**取（数据层命名）；**注意命名例外**：船体维修装置只有
 *   civ / MK1 / MK2 三档（无 MK3），其 MK2 实为顶级档；奇货（exotic）异星原型件不在本表内；
 * - 两套对齐规则：
 *   甲 = **等比缩放**（保序保差距）：newPrice = 现价 × k，k = 武器中位 ÷ 同级非武器现价中位；
 *   丙 = **线性映射到武器带**：把同级非武器装备的现价区间线性映射到武器价区间 [min, max]。
 */
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const WEAPON_SLOTS = new Set(['turret', 'missile', 'laser'])
const fmt = (n: number): string => Math.round(n).toLocaleString('zh-CN')
/**
 * 档位口径（2026-09-10 船长定：**按档位归**，不按名字里的 MK 编号）：
 * 船体维修装置只有 civ / MK1 / MK2 三档（无 MK3），其 MK2 是**顶级档**、归第三档（跟 MK3 走）。
 */
const TIER_OVERRIDE: Record<string, number> = { 'mod-hullrep-civ': 1, 'mod-hullrep-1': 2, 'mod-hullrep-2': 3 }
function tierOf(key: string, name: string): number {
  const o = TIER_OVERRIDE[key]
  if (o !== undefined) return o
  const m = /MK([123])/.exec(name)
  return m ? Number(m[1]) : 1
}
const tierLabelOf = (t: number): string => `第${t}档（MK${t}）`

type Row = { key: string; name: string; slot: string; rack: string; tier: number; price: number }
const rows: Row[] = []
for (const g of ctx.marketGoods.values()) {
  if (g.kind !== 'module') continue
  if (g.rarity === 'exotic') continue // 奇货（异星原型）不在本表口径内
  const def = ctx.modules.get(g.refId)
  if (!def) continue
  rows.push({
    key: g.key,
    name: def.name,
    slot: def.slot,
    rack: def.rack,
    tier: tierOf(g.key, def.name),
    price: g.basePrice ?? 0,
  })
}

for (const tier of [2, 3]) {
  const weapons = rows.filter((r) => r.tier === tier && WEAPON_SLOTS.has(r.slot)).sort((a, b) => a.price - b.price)
  const gear = rows.filter((r) => r.tier === tier && !WEAPON_SLOTS.has(r.slot)).sort((a, b) => a.price - b.price)
  const wPrices = weapons.map((w) => w.price)
  const wMin = wPrices[0]!
  const wMax = wPrices[wPrices.length - 1]!
  const anchor = wPrices[Math.floor(wPrices.length / 2)]! // 中位
  const gPrices = gear.map((g) => g.price)
  const gMin = gPrices[0]!
  const gMax = gPrices[gPrices.length - 1]!
  const gMed = gPrices[Math.floor(gPrices.length / 2)]!
  const k = anchor / gMed
  const roundNice = (n: number): number => {
    const mag = n >= 1_000_000 ? 10_000 : n >= 100_000 ? 1_000 : n >= 10_000 ? 500 : 100
    return Math.round(n / mag) * mag
  }
  console.log('')
  console.log(`════════ ${tierLabelOf(tier)} ════════`)
  console.log(
    `武器锚点：${wPrices.map(fmt).join(' · ')}（中位 ${fmt(anchor)}）｜ 非武器 ${gear.length} 件：现价 ${fmt(gMin)} ~ ${fmt(gMax)}、中位 ${fmt(gMed)}`,
  )
  console.log(`甲案系数 k = ${k.toFixed(3)}（等比缩放）｜ 丙案 = 线性映射到 [${fmt(wMin)}, ${fmt(wMax)}]`)
  console.log('')
  console.log('| 装备 | 槽位 | 现价 | 甲案（×k 保序） | 丙案（映射进攻器带） |')
  console.log('|---|---|---|---|---|')
  for (const r of gear) {
    const jia = roundNice(r.price * k)
    const bing =
      gMax === gMin ? anchor : roundNice(wMin + ((r.price - gMin) / (gMax - gMin)) * (wMax - wMin))
    console.log(`| ${r.name} | ${r.slot}/${r.rack} | ${fmt(r.price)} | ${fmt(jia)} | ${fmt(bing)} |`)
  }
  const sumBefore = gPrices.reduce((s, v) => s + v, 0)
  const sumJia = gear.reduce((s, r) => s + roundNice(r.price * k), 0)
  const sumBing = gear.reduce(
    (s, r) => s + (gMax === gMin ? anchor : roundNice(wMin + ((r.price - gMin) / (gMax - gMin)) * (wMax - wMin))),
    0,
  )
  console.log('')
  console.log(
    `合计：现 ${fmt(sumBefore)} → 甲案 ${fmt(sumJia)}（×${(sumJia / sumBefore).toFixed(2)}）｜ 丙案 ${fmt(sumBing)}（×${(sumBing / sumBefore).toFixed(2)}）`,
  )
  console.log(
    `（对照：同级武器合计 ${fmt(wPrices.reduce((s, v) => s + v, 0))}；第 1 档（MK1）非武器合计 ${fmt(
      rows.filter((r) => r.tier === 1 && !WEAPON_SLOTS.has(r.slot)).reduce((s, r) => s + r.price, 0),
    )}）`,
  )
}

console.log('')
console.log('══ 档位口径检查（家族 → 档位集合；第 3 档缺位者以 overrides 归位）══')
const byFamily = new Map<string, number[]>()
for (const r of rows) {
  const fam = r.key.replace(/-civ$/, '').replace(/-[123]$/, '').replace(/-(kin|exp|pla)$/, '')
  byFamily.set(fam, [...(byFamily.get(fam) ?? []), r.tier].sort((a, b) => a - b))
}
for (const [fam, ts] of byFamily) {
  if (!ts.includes(3)) console.log(`· ${fam}：档位 = ${ts.join(' / ')}（**无第 3 档**——顶级档即第 2 档）`)
}
