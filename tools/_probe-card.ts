// 临时探针：①没有悬赏卡的星系 ②威胁 ≥ 80 的卡的火力/血量带 ③稀有残骸物品的注册方式；用完即删
import { buildSimContext } from '../packages/data/src/index'
import { createFoeSpecs, lairAnomalyOf, rareWreckItemIdOf, wreckBaseDensity, recycleTierOf, RECYCLE_POOL_AVG_ISK } from '../packages/core/src/index'

const ctx = buildSimContext()
const bal = ctx.balance.battle

const usedGalaxy = new Set<string>()
for (const [, def] of ctx.anomalies) if (def.galaxyId) usedGalaxy.add(def.galaxyId)

console.log('=== 没有任何悬赏卡的星系（可放代表卡，不会顶掉别人）===')
for (const [id, g] of ctx.galaxies) {
  if (usedGalaxy.has(id)) continue
  const d = wreckBaseDensity(id, ctx)
  const tier = recycleTierOf(d)
  console.log(`  ${id.padEnd(22)} ${g.name.padEnd(10)} sec=${String(g.security).padStart(5)} 密度=${d.toFixed(0).padStart(5)} 档=${tier}（基数 ${RECYCLE_POOL_AVG_ISK[tier]}）`)
}

console.log('\n=== 威胁 ≥ 78 的卡（实建档数值，供 84 定位）===')
const rows: Array<{ name: string; threat: number; hp: number; volley: number; reward: number; units: number; galaxy: string; level: string }> = []
for (const [, def] of ctx.anomalies) {
  if ((def.threat ?? 0) < 78) continue
  const specs = createFoeSpecs(def, bal)
  rows.push({
    name: def.name,
    threat: def.threat ?? 0,
    hp: Math.round(specs.reduce((n, u) => n + u.hp.s + u.hp.a + u.hp.h, 0)),
    volley: specs.reduce((n, u) => n + u.weapons.reduce((m, w) => m + (w.shotDmg ?? 0), 0), 0),
    reward: def.rewardIsk ?? 0,
    units: specs.length,
    galaxy: def.galaxyId ?? '-',
    level: def.lairLevel ? `L${def.lairLevel}` : '-',
  })
}
rows.sort((a, b) => a.threat - b.threat)
for (const r of rows)
  console.log(`  T${String(r.threat).padStart(3)} ${r.name.padEnd(14)} 血 ${String(r.hp).padStart(6)}｜单发 ${String(r.volley).padStart(4)}｜奖金 ${String(r.reward).padStart(7)}｜${r.units} 单位｜${r.galaxy} ${r.level}`)

console.log('\n=== E 族两张卡：稀有残骸 id / 窝点 T3 火力 ===')
for (const id of ['ano-titan-wreck', 'ano-auro-raiders']) {
  const def = ctx.anomalies.get(id)!
  const rareId = rareWreckItemIdOf(id)
  const item = ctx.items.get(rareId)
  console.log(`  ${def.name}（id ${id}）→ 稀有残骸 ${rareId}｜在物品表内 ${item ? '✅ ' + item.name : '❌ 缺'}`)
}
console.log('\n=== 已注册的 wreck-* 物品（看看命名与字段）===')
let n = 0
for (const [id, it] of ctx.items) {
  if (!id.startsWith('wreck-')) continue
  n += 1
  if (n <= 6) console.log(`  ${id.padEnd(34)} ${it.name.padEnd(12)} kind=${it.kind} 基础售价=${it.baseSellPriceIsk ?? '-'} 体积=${it.volumeM3 ?? '-'}`)
}
console.log(`  …共 ${n} 件 wreck-*`)
