/**
 * 市场稀有订单刷新模拟（2026-09-09 数字稀有度配套；船长：先模拟后定系数）。
 * 推进 N 个稀有抽取窗（10 分钟/窗），统计 rare 渠道卖单按数字档（2 大众 / 3 高阶）的
 * 实际刷新：每窗总张数、各档合计张数与单行出现间隔分布。
 *
 * 口径：只调 slowSupplyDraw（不经 60s 窗 → 卖单簿无清理/无玩家撮合，各 key 簿长增量
 * = 本窗新单数）；价格沿用 ensureMarket 初始池。奇货渠道不在此统计（出率与数字不挂钩，
 * 船长 2026-09-09 定）。同一抽中行连续窗连抽间隔记为 1。
 *
 * 运行：npx tsx tools/market-rarity-sim.ts [--windows 1440] [--seeds 1,7,13] [--standing 24]
 *        [--tier3-weight 0.25] [--bp-weight 0.05] [--rows bp-miner-2,bp-cargo-2]
 * 2026-09-10 起兼查蓝图书：--bp-weight 对照不同权重，并按行打印蓝图出现间隔
 * （原 tools/_bp-rate.ts 探针并入此处，探针已删）。
 */
import { createInitialState } from '../packages/core/src/state'
import type { GameState } from '../packages/core/src/state'
import { ensureMarket, slowSupplyDraw } from '../packages/core/src/market'
import { buildSimContext } from '../packages/data/src/context'
import { DSI_FACTION_ID } from '@whale/core'

const ARGS = process.argv.slice(2)
const argVal = (name: string, dflt: number): number => {
  const i = ARGS.indexOf(name)
  return i >= 0 && ARGS[i + 1] !== undefined ? Number(ARGS[i + 1]) : dflt
}
const WINDOWS = argVal('--windows', 1440) // 默认 10 游戏天
const SEEDS =
  ARGS.indexOf('--seeds') >= 0 ? ARGS[ARGS.indexOf('--seeds') + 1]!.split(',').map(Number) : [1, 7, 13, 29, 51]
const STANDING = argVal('--standing', 24)
// --tier3-weight X：覆写引擎 balance 的 3 档权重（对照不同系数用；缺省 = 当前配置）
const TIER3_OVERRIDE = ARGS.indexOf('--tier3-weight') >= 0 ? Number(ARGS[ARGS.indexOf('--tier3-weight') + 1]) : null
// --bp-weight X：覆写蓝图书权重（2026-09-10 船长定 5%；对照旧值 0.5 用；缺省 = 当前配置）
const BP_OVERRIDE = ARGS.indexOf('--bp-weight') >= 0 ? Number(ARGS[ARGS.indexOf('--bp-weight') + 1]) : null
// --rows k1,k2：额外打印指定稀有行的单行出现间隔（默认 = 碎片路线对应的 6 张书）
const ROWS_ARG =
  ARGS.indexOf('--rows') >= 0
    ? ARGS[ARGS.indexOf('--rows') + 1]!.split(',').map((s) => s.trim()).filter(Boolean)
    : ['bp-miner-2', 'bp-cargo-2', 'bp-turret-2', 'bp-miner-3', 'bp-cargo-3', 'bp-turret-3']
const WINDOW_MS = 10 * 60_000

const ctx = buildSimContext()
if (TIER3_OVERRIDE !== null && Number.isFinite(TIER3_OVERRIDE)) {
  ctx.balance.market.rareTier3Weight = TIER3_OVERRIDE
}
if (BP_OVERRIDE !== null && Number.isFinite(BP_OVERRIDE)) {
  ctx.balance.market.blueprintWeight = BP_OVERRIDE
}
const tier3W = ctx.balance.market.rareTier3Weight
const bpW = ctx.balance.market.blueprintWeight
const rareDefs = [...ctx.marketGoods.values()].filter((g) => g.rarity === 'rare' && g.playerBuyable !== false)
const bpDefs = rareDefs.filter((d) => d.kind === 'blueprint')
const ROW_BY_TIER = new Map<number, number>()
for (const d of rareDefs) ROW_BY_TIER.set(d.rarityTier ?? 2, (ROW_BY_TIER.get(d.rarityTier ?? 2) ?? 0) + 1)

function mean(a: number[]): number {
  return a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0
}
function median(a: number[]): number {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]!
}
function pct(a: number[], p: number): number {
  if (a.length === 0) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!
}

interface Acc {
  perWindow: number[]
  tierHits: Map<number, number[]> // 每窗命中张数（tier → 各窗张数累加列表）
  rowGaps: Map<string, number[]> // 每行连续两次命中间隔（窗）
  bpHits: number // 蓝图行命中张数
  totalHits: number // 稀有行命中张数（含蓝图）
}

function run(seed: number): Acc {
  const state: GameState = createInitialState({ nowWallMs: 0, seed })
  state.standings[DSI_FACTION_ID] = STANDING
  ensureMarket(state, ctx, { openAtGameMs: 0 })
  const acc: Acc = { perWindow: [], tierHits: new Map(), rowGaps: new Map(), bpHits: 0, totalHits: 0 }
  const lastHit = new Map<string, number>()
  let now = 0
  for (let w = 1; w <= WINDOWS; w++) {
    now += WINDOW_MS
    // 同引擎 60s 窗的过期清理：先清再抽（稀有单 36 分钟、蓝图书 6 小时，模拟无 60s 窗自动清）
    for (const d of rareDefs) {
      const list = state.market.npcSell[d.key]
      if (!list) continue
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.expiresAtGameMs <= now) list.splice(i, 1)
      }
    }
    // 清理后基线 → 抽取 → 差值 = 本窗新增（现实簿远达不到 10 张/行上限，差值即真实新增）
    const base = new Map<string, number>()
    for (const d of rareDefs) base.set(d.key, state.market.npcSell[d.key]?.length ?? 0)
    slowSupplyDraw(state, ctx, now)
    let total = 0
    for (const d of rareDefs) {
      const len = state.market.npcSell[d.key]?.length ?? 0
      const delta = len - (base.get(d.key) ?? 0)
      if (delta > 0) {
        total += delta
        acc.totalHits += delta
        if (d.kind === 'blueprint') acc.bpHits += delta
        const t = d.rarityTier ?? 2
        const arr = acc.tierHits.get(t) ?? []
        arr.push(delta)
        acc.tierHits.set(t, arr)
        const last = lastHit.get(d.key)
        if (last !== undefined) {
          const gaps = acc.rowGaps.get(d.key) ?? []
          gaps.push(w - last)
          acc.rowGaps.set(d.key, gaps)
        }
        lastHit.set(d.key, w)
      }
    }
    acc.perWindow.push(total)
  }
  return acc
}

const perWindowAll: number[] = []
const tierHitsAll = new Map<number, number[]>()
const rowGapAll = new Map<number, number[]>() // 按 tier 汇总（既有口径）
const rowGapByKey = new Map<string, number[]>() // 按行 key 汇总（蓝图行与 --rows 查询用）
let bpHitsAll = 0
let totalHitsAll = 0
for (const seed of SEEDS) {
  const r = run(seed)
  perWindowAll.push(...r.perWindow)
  bpHitsAll += r.bpHits
  totalHitsAll += r.totalHits
  for (const [t, hits] of r.tierHits) {
    const arr = tierHitsAll.get(t) ?? []
    tierHitsAll.set(t, [...arr, ...hits])
  }
  for (const [key, gaps] of r.rowGaps) {
    const t = ctx.marketGoods.get(key)!.rarityTier ?? 2
    const arr = rowGapAll.get(t) ?? []
    rowGapAll.set(t, [...arr, ...gaps])
    const byKey = rowGapByKey.get(key) ?? []
    rowGapByKey.set(key, [...byKey, ...gaps])
  }
}

const meanWin = mean(perWindowAll)
console.log(
  `══ 稀有订单刷新模拟（rare 渠道卖单；窗 ${WINDOWS} × 种子 ${SEEDS.length}，声望 ${STANDING}，tier3 权重 ${tier3W}，蓝图权重 ${bpW}）══`,
)
console.log(
  `rare 供给行 ${rareDefs.length}：tier2（大众）= ${ROW_BY_TIER.get(2) ?? 0} 行 · tier3（高阶）= ${ROW_BY_TIER.get(3) ?? 0} 行` +
    `（其中蓝图 ${bpDefs.length} 行，占稀有供给 ${((bpHitsAll / Math.max(1, totalHitsAll)) * 100).toFixed(1)}%）`,
)
console.log(
  `每窗总张数：均值 ${meanWin.toFixed(2)} · 中位 ${median(perWindowAll)} · P90 ${pct(perWindowAll, 0.9)} · 峰值 ${Math.max(...perWindowAll)}`,
)
for (const t of [2, 3]) {
  const hits = tierHitsAll.get(t) ?? []
  const rows = ROW_BY_TIER.get(t) ?? 0
  const perWin = hits.reduce((s, v) => s + v, 0) / Math.max(1, perWindowAll.length)
  const gaps = rowGapAll.get(t) ?? []
  const gapMed = median(gaps)
  const gapMean = mean(gaps)
  console.log(
    `tier${t}：每窗合计 ≈${perWin.toFixed(2)} 张（占总张数 ${((perWin / Math.max(0.001, meanWin)) * 100).toFixed(0)}%）` +
      ` · 单行命中间隔 均值 ${gapMean.toFixed(1)} 窗（≈${((gapMean * 10) / 60).toFixed(1)}h）/ 中位 ${gapMed} 窗 · P90 ${pct(gaps, 0.9)} 窗`,
  )
}
console.log('（每窗 = 10 分钟；间隔 = 同一行两次被抽中的窗数差）')
// 蓝图行单行间隔（2026-09-10 船长定权重 5% 的口径核对；原 tools/_bp-rate.ts 探针并入此处）
console.log(`— 蓝图行（按 tier 汇总；权重 ${bpW}）—`)
for (const t of [2, 3]) {
  const rows = bpDefs.filter((d) => (d.rarityTier ?? 2) === t)
  const all: number[] = []
  for (const d of rows) all.push(...(rowGapByKey.get(d.key) ?? []))
  if (all.length === 0) {
    console.log(`  tier${t}（${rows.length} 行）：本次样本内未命中（可加 --windows / --seeds）`)
    continue
  }
  const gapMean = mean(all)
  const gapMed = median(all)
  console.log(
    `  tier${t}（${rows.length} 行）：均值 ${gapMean.toFixed(1)} 窗（≈${((gapMean * 10) / 60).toFixed(1)}h）/ 中位 ${gapMed} 窗（≈${((gapMed * 10) / 60).toFixed(1)}h）`,
  )
}
console.log('— 指定行单行间隔（--rows，默认碎片路线对应的 6 张书）—')
for (const key of ROWS_ARG) {
  const d = ctx.marketGoods.get(key)
  if (!d) {
    console.log(`  ${key.padEnd(14)} 不在市场卡表里（跳过）`)
    continue
  }
  const gaps = rowGapByKey.get(key) ?? []
  const gate = d.standingReq !== undefined ? `声望 ${d.standingReq}` : '无门槛'
  if (gaps.length === 0) {
    console.log(`  ${key.padEnd(14)} ${gate.padEnd(8)} 本次样本内未命中`)
    continue
  }
  const gapMean = mean(gaps)
  const gapMed = median(gaps)
  console.log(
    `  ${key.padEnd(14)} ${gate.padEnd(8)} 均值 ${gapMean.toFixed(1)} 窗（≈${((gapMean * 10) / 60).toFixed(1)}h）/ 中位 ${gapMed} 窗（≈${((gapMed * 10) / 60).toFixed(1)}h）/ 命中 ${gaps.length + SEEDS.length} 次`,
  )
}
