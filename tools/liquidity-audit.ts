/**
 * 市场流通性体检（2026-09-10 船长：「市场流通性还是较差，建议根据玩家对物品的生产能力调整市场的物品池」；
 * 原临时探针 `_probe-liquidity.ts` 按工具纪律**转正入库**，探针已删）。
 *
 * 用途：把「玩家产能」与「市场池吸收能力」摆在同一张表上——覆盖比 = 池日吸收 ÷ 基准日产，
 * **< 1 即"采了/炼了卖不掉"**；并给出按**单价分层覆盖比**算出的建议池参数（poolTarget + supplyFlow），
 * 供日后改产率 / 船型 / 价格 / 池子后复跑核对。
 *
 * 运行：npx tsx tools/liquidity-audit.ts（等价 `npm run liquidity:audit`）
 *
 * 口径：
 * - **采矿侧基准 = 掘洞级采矿艇 + 满采矿技能 + 2×强化采集器 MK1**（船长 2026-09-10 指定：中期配置，
 *   不是座头鲸满配）；产率走引擎真函数 `getMiningParams`（循环时长 × 每循环产量），
 *   对照列另给裸船 / 满技能 / 座头鲸满配；
 * - 满技能 = 采矿技术 / 星质地质学 / 深井爆破学 / 深空采集学 / 采矿舰操作 各 5 级；
 * - **矿物侧基准 = 主控精炼炉满技能**：批 = `refineBatchUnits`、周期 = `refineCycleMs`、
 *   高级回收满级批量 ×1.3、精炼产出倍率满级 1.65；每种矿物取"件/时产出最高"的那支矿作参照；
 * - 市场侧：池商品按 `supplyFlow`（缺省 poolTarget/120）每 60 秒窗补单 ⇒ **日吸收 = flow × 1440**；
 * - 分层覆盖比（2026-09-10 船长定）：单价 ≤20 → ×15（大宗）／≤200 → ×6（中阶）／≤400 → ×3（高阶）／>400 → ×2（顶级）；
 * - 复合矿带只按主产物（`belt.oreId`）计，不拆权重池。
 */
import { addShipToFleet, createInitialState, getMiningParams } from '@whale/core'
import { buildSimContext } from '@whale/data'

const ctx = buildSimContext()
const SHIP = 'burrower' // 掘洞级采矿艇（船长指定基准：MK1 采集器 ×2，高槽 2 / CPU 90）
const SKILLS = ['mining', 'astro-geology', 'deep-hole-blasting', 'deep-space-harvesting', 'industrial-ops']
const fmt = (n: number): string => Math.round(n).toLocaleString('zh-CN')

function makeState(withSkills: boolean, guns: string[]): ReturnType<typeof createInitialState> {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const entry = state.fleet[uid]!
  entry.fitted = {
    high: [...guns, null, null].slice(0, 2) as (string | null)[],
    mid: [null, null],
    low: [null],
  }
  if (withSkills) for (const s of SKILLS) state.skills.trained[s] = 5
  return state
}

const HP = ((): ReturnType<typeof createInitialState> => {
  const s = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(s, 'sh-humpback')
  s.shipId = uid
  s.fleet[uid]!.fitted = {
    high: ['mod-miner-3', 'mod-miner-3', 'mod-miner-3'],
    mid: [null, null],
    low: [null, null, null],
  }
  for (const k of SKILLS) s.skills.trained[k] = 5
  return s
})()

const CONFIGS: Array<{ label: string; state: ReturnType<typeof createInitialState>; ship: string }> = [
  { label: '掘洞裸船', state: makeState(false, []), ship: SHIP },
  { label: '掘洞满技能', state: makeState(true, []), ship: SHIP },
  { label: '掘洞满技能+2×MK1', state: makeState(true, ['mod-miner-1', 'mod-miner-1']), ship: SHIP },
  { label: '（参考）座头鲸满配', state: HP, ship: 'sh-humpback' },
]

type Row = { belt: string; ore: string; price: number; perHour: number; perDay: number; absorbDay: number; cover: number }
const rows: Row[] = []
for (const belt of ctx.belts.values()) {
  const best = CONFIGS[2]! // 基准 = 掘洞满技能 + 2×MK1
  const p = getMiningParams(best.state, ctx, { shipId: SHIP, beltId: belt.id })
  if (!p) continue
  const perHour = (p.unitsPerCycle * 3_600_000) / p.cycleMs
  const good = ctx.marketGoods.get(belt.oreId)
  const poolTarget = good?.poolTarget ?? 0
  if (poolTarget <= 0) continue
  const flow = good?.supplyFlow ?? Math.max(1, Math.round(poolTarget / 120))
  rows.push({
    belt: belt.name ?? belt.id,
    ore: p.ore.name,
    price: p.ore.baseSellPriceIsk ?? 0,
    perHour,
    perDay: perHour * 24,
    absorbDay: flow * 1440,
    cover: (flow * 1440) / (perHour * 24),
  })
}

console.log('')
console.log('══ 掘洞级采矿艇产率（引擎 getMiningParams）══')
for (const beltId of ['belt-kernite', 'belt-glowstone', 'belt-voidshard', 'belt-nebulite', 'belt-gas-aurora', 'belt-ice-darkstar']) {
  const line: string[] = []
  for (const c of CONFIGS) {
    const p = getMiningParams(c.state, ctx, { shipId: c.ship, beltId })
    if (!p) continue
    line.push(`${c.label} ${fmt((p.unitsPerCycle * 3_600_000) / p.cycleMs)} 件/h`)
  }
  const belt = ctx.belts.get(beltId)
  console.log(`· ${belt?.name ?? beltId}（${belt?.oreId}）：${line.join(' ｜ ')}`)
}

rows.sort((a, b) => a.cover - b.cover)
console.log('')
console.log('══ 覆盖比 = 池日吸收 ÷ 座头鲸满配日产（<1 = 玩家一天就卖不动）══')
console.log('| 矿带 | 产物 | 单价 | 满配件/时 | 满配件/日 | 池日吸收 | **覆盖比** |')
console.log('|---|---|---|---|---|---|---|')
for (const r of rows) {
  console.log(
    `| ${r.belt} | ${r.ore} | ${r.price} | ${fmt(r.perHour)} | ${fmt(r.perDay)} | ${fmt(r.absorbDay)} | **${r.cover.toFixed(2)}×** |`,
  )
}
const bad = rows.filter((r) => r.cover < 1)
console.log('')
console.log(`· 覆盖比 < 1 的品类：${bad.length} / ${rows.length}（这些就是"流通性差"的来源）`)
console.log(`· 说明：基准 = 掘洞级 + 满采矿技能 + 2×强化采集器 MK1（高槽 2 / CPU 90）；池日吸收 = supplyFlow × 1440 窗（60 秒/窗）。`)

console.log('')
console.log('══ 分层覆盖比方案（保留"低阶需求大、高阶需求小"，但保证最低档也卖得掉）══')
console.log('· 覆盖比函数：单价 ≤20 → ×15（大宗）；≤200 → ×6（中阶）；≤400 → ×3（高阶）；>400 → ×2（顶级，仍 >1 = 卖得掉）')
console.log('| 产物 | 单价 | 基准日产 | 现 flow/窗 | 现覆盖比 | **目标覆盖比** | **建议 flow** | **建议 poolTarget** | 倍率 |')
console.log('|---|---|---|---|---|---|---|---|---|')
const coverageOf = (price: number): number => (price <= 20 ? 15 : price <= 200 ? 6 : price <= 400 ? 3 : 2)
for (const r of [...rows].sort((a, b) => a.price - b.price)) {
  const good = [...ctx.marketGoods.values()].find((g) => g.refId && ctx.items.get(g.refId)?.name === r.ore)
  const curFlow = good?.supplyFlow ?? 0
  const curPool = good?.poolTarget ?? 0
  const tgt = coverageOf(r.price)
  const needFlow = Math.ceil((r.perDay * tgt) / 1440)
  console.log(
    `| ${r.ore} | ${r.price} | ${fmt(r.perDay)} | ${fmt(curFlow)} | ${r.cover.toFixed(2)}× | **${tgt}×** | **${fmt(needFlow)}** | **${fmt(needFlow * 120)}** | ${(needFlow / Math.max(1, curFlow)).toFixed(1)}× |`,
  )
}
const flows = rows.map((r) => Math.ceil((r.perDay * coverageOf(r.price)) / 1440))
const poolNow = rows
  .map((r) => [...ctx.marketGoods.values()].find((g) => g.refId && ctx.items.get(g.refId)?.name === r.ore)?.supplyFlow ?? 0)
  .filter((f) => f > 0)
console.log(
  `· 梯度：建议 flow 区间 ${fmt(Math.min(...flows))} ~ ${fmt(Math.max(...flows))}/窗（**${(Math.max(...flows) / Math.min(...flows)).toFixed(1)}× 差距**）` +
    `；现状区间 ${fmt(Math.min(...poolNow))} ~ ${fmt(Math.max(...poolNow))}/窗（**${(Math.max(...poolNow) / Math.min(...poolNow)).toFixed(0)}× 差距**）`,
)
console.log('· 收入含义：低阶矿几乎不动（富凡 flow 不变）；高阶/气冰扩容后卖得掉，收入 = 产率 × 单价。')

/* ───────── 矿物侧（精炼产物）：以"主控炉满技能"为产能基准 ─────────
 * 口径来源：industry.refineParamsOf（批 = refineBatchUnits 100 / 周期 = refineCycleMs）、
 * 高级回收满级批量 ×(1+0.06×5)=×1.3、refineRate 满级 1.65；
 * 每种矿物取"单位时间产出最高"的那支矿作参照（玩家要某个矿物就会挑那支矿来炼）。 */
console.log('')
console.log('══ 矿物侧（精炼产物）：单炉满技能的件/时 与 池覆盖 ══')
const mineralRate = new Map<string, { perHour: number; fromOre: string }>()
for (const item of ctx.items.values()) {
  if (!item.refine || item.refine.length === 0) continue
  const cycleMs = item.refineCycleMs ?? 6000
  const batch = item.refineBatchUnits ?? 10
  const orePerHour = (3_600_000 / cycleMs) * batch * 1.3 // 高级回收满级 ×1.3
  for (const row of item.refine) {
    const perHour = orePerHour * row.perOre * 1.65 // 精炼产出倍率满级 1.65
    const prev = mineralRate.get(row.mineralId)
    if (!prev || perHour > prev.perHour) mineralRate.set(row.mineralId, { perHour, fromOre: item.name ?? item.id })
  }
}
console.log('| 矿物 | 单价 | 参照矿 | 单炉满技能件/时 | 件/日 | 现 flow/窗 | 现覆盖比 | **建议 flow** | **建议 poolTarget** | 倍率 |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
for (const [mineralId, info] of [...mineralRate.entries()].sort((a, b) => a[1].perHour - b[1].perHour)) {
  const good = ctx.marketGoods.get(mineralId)
  if (!good?.poolTarget) continue
  const item = ctx.items.get(mineralId)
  const price = item?.baseSellPriceIsk ?? 0
  const perDay = info.perHour * 24
  const curFlow = good.supplyFlow ?? 0
  const cover = (curFlow * 1440) / perDay
  const tgt = coverageOf(price)
  const needFlow = Math.ceil((perDay * tgt) / 1440)
  console.log(
    `| ${item?.name ?? mineralId} | ${price} | ${info.fromOre} | ${fmt(info.perHour)} | ${fmt(perDay)} | ${fmt(curFlow)} | ${cover.toFixed(2)}× | **${fmt(needFlow)}** | **${fmt(needFlow * 120)}** | ${(needFlow / Math.max(1, curFlow)).toFixed(1)}× |`,
  )
}
