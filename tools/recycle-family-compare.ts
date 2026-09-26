/**
 * **各族残骸回收价值对比**（**正式工具 · 2026-09-26 入库**）：按**族**列出回收线的可比读数。
 *
 * 船长 2026-09-26 令：「**开启H族的精炼炉回收。将各个种族残骸回收的价值列出做对比**」
 * ⇒ 本探针把 `ctx.wreckGroups` 按 family 归并，逐族打印：组 · 地区 · 档位 · 保底矿物池与每批价值 ·
 * 彩头（主题件）· 稀有侧（专属装备池 / 高级箱命中率）。
 *
 * 用法：`npm run recycle:compare`。**只读**（不写盘）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 v31 · 最后核对 2026-09-26 · 最后跑过 2026-09-26
 */
import { buildSimContext } from '@whale/data'
import { WRECK_GROUPS } from '../packages/core/src/wreckGroups'
import { FOE_LAIR_GEAR } from '../packages/core/src/lairs'
import {
  RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS,
  RECYCLE_YIELD_PER_M3,
  RARE_BOX_GEAR_CHANCE,
  RARE_WRECK_VOLUME_M3,
  rareWreckItemIdOf,
  recycleMineralPoolOf,
  recycleProfileOf,
  wreckItemIdOf,
} from '../packages/core/src/salvage'
import type { RecycleTier } from '../packages/core/src/salvage'

const ctx = buildSimContext()
const price = (id: string): number => ctx.items.get(id)?.baseSellPriceIsk ?? 0
const name = (id: string): string => ctx.items.get(id)?.name ?? id
const FAM: Record<string, string> = { A: 'A 海盗', B: 'B 拾荒者', C: 'C 异形', D: 'D 守墓', E: 'E 巨构', G: 'G 鱿烬亡军', H: 'H 墨潮帮' }

type Row = {
  fam: string
  groups: string[]
  regions: Set<string>
  tiers: Set<string>
  pool: ReadonlyArray<readonly [string, number]>
  batchValue: number
  /** 首组档位（`保底 ISK/m³ = 当量 × 池均价` 要用它；族内各组档位可能不同 ⇒ 另见逐组表） */
  firstTier: RecycleTier
  theme: number
  rareOk: boolean
  gear: readonly string[]
}
const byFam = new Map<string, Row>()
for (const g of WRECK_GROUPS) {
  const row =
    byFam.get(g.family) ??
    ({
      fam: g.family,
      groups: [],
      regions: new Set<string>(),
      tiers: new Set<string>(),
      pool: [],
      batchValue: 0,
      firstTier: g.tier,
      theme: 0,
      rareOk: false,
      gear: [],
    } as Row)
  row.groups.push(g.key)
  row.regions.add(g.region === 'lo' ? '低安' : g.region === 'wh' ? '虫洞' : g.region === 'inv' ? '入侵' : '高安')
  row.tiers.add(g.tier)
  if (row.pool.length === 0) {
    row.pool = recycleMineralPoolOf(recycleProfileOf(ctx, wreckItemIdOf(g.key))!)
    const sum = row.pool.reduce((s, [, w]) => s + w, 0)
    row.batchValue = Math.round(
      row.pool.reduce((s, [id, w]) => s + (price(id) * w) / Math.max(1, sum), 0) * 1,
    )
  }
  row.theme += (g.theme.modules?.length ?? 0) + (g.theme.mk2?.length ?? 0)
  const rare = recycleProfileOf(ctx, rareWreckItemIdOf(g.key))
  if (rare?.rare === true) {
    row.rareOk = true
    if (rare.lairGear) row.gear = rare.lairGear
  }
  byFam.set(g.family, row)
}

console.log('=== 各族残骸回收价值对比（真数据 · 池均价 = 每单位矿物的加权单价） ===')
console.log(
  ['族', '组数', '地区', '档位', '首组池均价/单位', '首组保底 ISK/m³', '彩头件数', '稀有可回收', '专属装备池'].join(' | '),
)
for (const [fam, r] of [...byFam.entries()].sort()) {
  console.log(
    [
      FAM[fam] ?? fam,
      r.groups.length,
      [...r.regions].join('/'),
      [...r.tiers].join('/'),
      r.batchValue.toLocaleString('zh-CN'),
      // ⚠ 两列别混：**池均价 = 矿种档次**（贵矿占比）；**保底 ISK/m³ = 档位当量 × 池均价 = 实际收益**。
      //    三档当量与池均价互为倒数 ⇒ 换档位几乎不改收益，只改"给什么矿 + 高级箱命中率 + 残骸收价"。
      (RECYCLE_YIELD_PER_M3[r.firstTier] * r.batchValue).toFixed(1),
      r.theme,
      r.rareOk ? '✅' : '❌',
      r.gear.length > 0 ? `${r.gear.length} 件（${r.gear.map((x) => ctx.items.get(x)?.name ?? x).join('、')}）` : '（无 · 高级箱只给主题件）',
    ].join(' | '),
  )
}

console.log('\n=== 逐组读数（14 组：地区 / 档位 / 池均价 / 保底 ISK·m⁻³ / 主题件） ===')
for (const g of WRECK_GROUPS) {
  const profile = recycleProfileOf(ctx, wreckItemIdOf(g.key))!
  const pool = recycleMineralPoolOf(profile)
  const wSum = pool.reduce((s, [, w]) => s + w, 0)
  const mean = pool.reduce((s, [id, w]) => s + (price(id) * w) / Math.max(1, wSum), 0)
  const region = g.region === 'lo' ? '低安' : g.region === 'wh' ? '虫洞' : g.region === 'inv' ? '入侵' : '高安'
  console.log(
    `${g.key.padEnd(8)} ${g.family} ${region} ${g.tier.padEnd(6)} 池均价 ${mean.toFixed(2).padStart(7)}` +
      ` · 保底 ${(RECYCLE_YIELD_PER_M3[g.tier] * mean).toFixed(1).padStart(6)} ISK/m³` +
      ` · 主题件 ${(g.theme.modules?.length ?? 0) + (g.theme.mk2?.length ?? 0)}` +
      ` · 池：${pool.map(([id, w]) => `${name(id)}(${w})`).join(' + ')}`,
  )
}

const h = byFam.get('H')!
console.log('\n=== H 族（墨潮帮）明细 ===')
console.log(`组：${h.groups.join('、')} · 保底矿物池：${h.pool.map(([id, w]) => `${name(id)}(${w})`).join(' + ')}`)
for (const k of h.groups) {
  const g = WRECK_GROUPS.find((x) => x.key === k)!
  const plain = recycleProfileOf(ctx, wreckItemIdOf(k))!
  const rare = recycleProfileOf(ctx, rareWreckItemIdOf(k))!
  console.log(
    `  ${k}（${g.name} · ${g.region} · ${g.tier} · 威胁 ${g.threat}）` +
      `｜普通残骸可回收=${plain !== null}（池 ${recycleMineralPoolOf(plain).length} 项）` +
      `｜稀有残骸可回收=${rare.rare === true}（专属池 ${(rare.lairGear ?? []).length} 件）` +
      `｜主题件 ${(g.theme.modules?.length ?? 0) + (g.theme.mk2?.length ?? 0)} 件`,
  )
}
console.log(
  `\n高级箱专属件命中率：common ${RARE_BOX_GEAR_CHANCE.common * 100}% · risky ${RARE_BOX_GEAR_CHANCE.risky * 100}% · dire ${RARE_BOX_GEAR_CHANCE.dire * 100}%` +
    `（未命中必给主题件）· 稀有单件 ${RARE_WRECK_VOLUME_M3} m³ · 批 ${RECYCLE_BATCH_M3} m³ / ${RECYCLE_CYCLE_MS / 1000} 秒` +
    `\nH 专属池来源 FOE_LAIR_GEAR.H = ${FOE_LAIR_GEAR.H.length} 件：${FOE_LAIR_GEAR.H.map((x) => ctx.modules.get(x)?.name ?? ctx.items.get(x)?.name ?? x).join('、')}`,
)
