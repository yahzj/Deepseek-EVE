/** 一次性盘点探针（_ 前缀；输出后即删）：MK3 收口后各悬赏残骸"出货"清单 */
import { buildSimContext } from '@whale/data'
import {
  RECYCLE_BASE_MODULES,
  RECYCLE_MK2_MODULES,
  FRAGMENT_RECIPES,
  recycleTierOf,
  wreckBaseDensity,
  RECYCLE_POOL_AVG_ISK,
  RECYCLE_YIELD_PER_M3,
} from '@whale/core'

const ctx = buildSimContext()
const name = (id: string): string => ctx.modules.get(id)?.name ?? ctx.items.get(id)?.name ?? ctx.blueprints.get(id)?.name ?? id
const mName = (id: string): string => ctx.items.get(id)?.name ?? id

for (const def of ctx.anomalies.values()) {
  const galaxy = ctx.galaxies.get(def.galaxyId)
  const sec = typeof galaxy?.security === 'number' && Number.isFinite(galaxy.security) ? galaxy.security : 0.5
  const lowSec = sec < 0
  const tier = recycleTierOf(wreckBaseDensity(def.galaxyId, ctx))
  const pool = def.recyclePool ?? []
  const wSum = pool.reduce((s, [, w]) => s + w, 0)
  const bits = pool.length ? pool.map(([id, w]) => `${mName(id)} ${((w / wSum) * 100).toFixed(0)}%`).join('+') : '三档默认池'
  const loot = def.recycleLoot
  const out: string[] = []
  if (loot?.modules?.length) out.push(`直出:${loot.modules.map(name).join('/')}`)
  else out.push('直出:默认基础件池')
  if (loot?.mk2?.length) out.push(`低安线:${loot.mk2.map(name).join('/')}`)
  else if (lowSec) out.push(`低安线:默认MK2池(${RECYCLE_MK2_MODULES.length}件)`)
  if ((def.threat ?? 0) >= 17) {
    const t2 = Object.keys(FRAGMENT_RECIPES).filter((m) => FRAGMENT_RECIPES[m]!.need === 100)
    out.push(`T2碎片:${t2.map(name).join('/')}`)
  }
  if ((def.threat ?? 0) >= 41) {
    const t3 = Object.keys(FRAGMENT_RECIPES).filter((m) => FRAGMENT_RECIPES[m]!.need === 1000)
    out.push(`T3碎片:${t3.map(name).join('/')}`)
  }
  const base = RECYCLE_POOL_AVG_ISK[tier]
  const ev = Math.round(1440 * RECYCLE_YIELD_PER_M3[tier] * base * (def.recyclePool ? 1 : 1))
  console.log(`◆ ${def.name}｜${galaxy?.name ?? def.galaxyId}(sec${sec}·威胁${def.threat}·${tier})`)
  console.log(`   保底矿池：${bits}｜池均≈${(pool.length ? pool.reduce((s, [id, w]) => s + (w / wSum) * (ctx.items.get(id)?.baseSellPriceIsk ?? 0), 0) : base).toFixed(1)} ISK｜${def.recycleNote ?? '（无倾向注）'}`)
  console.log(`   彩头：${out.join('；')}`)
}
