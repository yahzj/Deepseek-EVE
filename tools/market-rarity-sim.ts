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
const WINDOW_MS = 10 * 60_000

const ctx = buildSimContext()
if (TIER3_OVERRIDE !== null && Number.isFinite(TIER3_OVERRIDE)) {
  ctx.balance.market.rareTier3Weight = TIER3_OVERRIDE
}
const tier3W = ctx.balance.market.rareTier3Weight
const rareDefs = [...ctx.marketGoods.values()].filter((g) => g.rarity === 'rare' && g.playerBuyable !== false)
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
}

function run(seed: number): Acc {
  const state: GameState = createInitialState({ nowWallMs: 0, seed })
  state.standings[DSI_FACTION_ID] = STANDING
  ensureMarket(state, ctx, { openAtGameMs: 0 })
  const acc: Acc = { perWindow: [], tierHits: new Map(), rowGaps: new Map() }
  const lastHit = new Map<string, number>()
  let now = 0
  for (let w = 1; w <= WINDOWS; w++) {
    now += WINDOW_MS
    // 同引擎 60s 窗的过期清理：先清再抽（订单寿命 36 分钟，模拟无 60s 窗自动清）
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
const rowGapAll = new Map<number, number[]>()
for (const seed of SEEDS) {
  const r = run(seed)
  perWindowAll.push(...r.perWindow)
  for (const [t, hits] of r.tierHits) {
    const arr = tierHitsAll.get(t) ?? []
    tierHitsAll.set(t, [...arr, ...hits])
  }
  for (const [key, gaps] of r.rowGaps) {
    const t = ctx.marketGoods.get(key)!.rarityTier ?? 2
    const arr = rowGapAll.get(t) ?? []
    rowGapAll.set(t, [...arr, ...gaps])
  }
}

const meanWin = mean(perWindowAll)
console.log(`══ 稀有订单刷新模拟（rare 渠道卖单；窗 ${WINDOWS} × 种子 ${SEEDS.length}，声望 ${STANDING}，tier3 权重 ${tier3W}）══`)
console.log(
  `rare 供给行 ${rareDefs.length}：tier2（大众）= ${ROW_BY_TIER.get(2) ?? 0} 行 · tier3（高阶）= ${ROW_BY_TIER.get(3) ?? 0} 行`,
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
