/**
 * **铁人市场对照读数**（2026-09-23 船长：「测试下，铁人模式的市场和非铁人模式的市场，
 * 买入稀有和奇货的区别」）。
 *
 * 做法：**同一 seed、同一声望、同一时长**各跑一遍市场（`advanceMarket` 60 秒 tick × 24 游戏小时），
 * 唯一差别 = 是否在开局进入铁人模式 ⇒ 差异只可能来自福利 B（刷单 ×3 · 稀有 ×2 · 奇货 ×2 · 奇货每窗上限 +2）。
 *
 * 读四样东西（都是"玩家能不能买到"的口径）：
 * 1 **新上架单数**（稀有 / 奇货）：簿面"新出现的供给单"条数——按「价格|件数|到期时刻|暗市标记」多重集差分计数；
 * 2 **在架峰值/均值**：同一时刻簿面上能看到的单数（奇货受"每窗保留上限"直接约束）；
 * 3 **可买件数**：新上架单的件数合计；
 * 4 **买入价**：新上架单价格的中位数（福利不动价格 ⇒ 两列应同带）。
 * 另给一行 common 常驻现货作对照（受"每窗刷单量 ×3"影响）。
 *
 * 跑法：`npm run ironman:market`（可加 `--hours 24 --rep 13`）
 */
import { DSI_FACTION_ID, advanceMarket, createInitialState, enterIronman } from '@whale/core'
import type { GameState, NpcMarketOrder, SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'

const ARGS = process.argv.slice(2)
const argVal = (name: string, dflt: number): number => {
  const i = ARGS.indexOf(name)
  return i >= 0 && ARGS[i + 1] !== undefined ? Number(ARGS[i + 1]) : dflt
}
const HOURS = argVal('--hours', 24)
/** 声望（暗市闸 `bmStanding` 之判据）：0 = 新档口径，13 = 绝大多数稀有/奇货已解锁 */
const REP = argVal('--rep', 13)
const SEED = argVal('--seed', 20260923)
/** 价格样本上限（只看中位价 ⇒ 采样即可，避免几十万条撑爆栈/内存） */
const PRICE_SAMPLE_CAP = 20000
/** 复跑种子数：单 seed 的奇货命中太少（每窗 ~1 张）⇒ 默认 5 个种子取合计，比例才稳 */
const SEEDS = argVal('--seeds', 5)
const TICK_MS = 60_000

interface Row {
  arrivals: number
  units: number
  prices: number[]
  onBoardSum: number
  onBoardMax: number
  samples: number
}

const newRow = (): Row => ({ arrivals: 0, units: 0, prices: [], onBoardSum: 0, onBoardMax: 0, samples: 0 })

/** 多重集签名（NPC 单没有 id）：同价同量同到期＝同一张单 */
const sigOf = (o: NpcMarketOrder): string => `${o.price}|${o.qty}|${o.expiresAtGameMs}|${o.bm ? 1 : 0}`

function countMultiset(list: readonly NpcMarketOrder[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const o of list) m.set(sigOf(o), (m.get(sigOf(o)) ?? 0) + 1)
  return m
}

function run(ironman: boolean, seed: number): { rare: Row; exotic: Row; common: Row; state: GameState } {
  const ctx: SimContext = buildSimContext()
  const state = createInitialState({ nowWallMs: 0, seed })
  state.standings[DSI_FACTION_ID] = REP
  if (ironman) enterIronman(state, 0, 0)
  /**
   * ⚠ **必须自己先推 `state.gameMs`**：`advanceMarket` 的窗口循环判据是 `lastTick + tick <= state.gameMs`
   * （market.ts 原注：「state.gameMs 由调用方（advanceGame）先行增加」）——首版探针漏了这一步，
   * 一个窗口都没推进，读数只剩"开盘铺簿"那几笔（**已作废，见工作文档 §七**）。
   */
  state.gameMs += TICK_MS
  advanceMarket(state, TICK_MS, ctx)

  const rows = { rare: newRow(), exotic: newRow(), common: newRow() }
  const keysOf = (r: 'rare' | 'exotic' | 'common'): string[] =>
    [...ctx.marketGoods.values()]
      .filter((d) => d.playerBuyable !== false && (r === 'common' ? d.rarity === 'common' : d.rarity === r))
      .map((d) => d.key)

  let prev = new Map<string, Map<string, number>>()
  for (const r of ['rare', 'exotic', 'common'] as const) {
    for (const k of keysOf(r)) prev.set(k, countMultiset(state.market.npcSell[k] ?? []))
  }

  for (let t = 1; t < HOURS * 60; t++) {
    state.gameMs += TICK_MS
    advanceMarket(state, TICK_MS, ctx)
    for (const r of ['rare', 'exotic', 'common'] as const) {
      for (const k of keysOf(r)) {
        const list = state.market.npcSell[k] ?? []
        const now = countMultiset(list)
        const before = prev.get(k) ?? new Map<string, number>()
        // 新出现的条目（多重集正差）：每个正差按"新增张数"计
        for (const [sig, cnt] of now) {
          const delta = cnt - (before.get(sig) ?? 0)
          if (delta <= 0) continue
          for (let i = 0; i < delta; i++) {
            rows[r].arrivals++
            rows[r].units += Number(sig.split('|')[1] ?? 0)
            if (rows[r].prices.length < PRICE_SAMPLE_CAP) rows[r].prices.push(Number(sig.split('|')[0] ?? 0))
          }
        }
        rows[r].onBoardSum += list.length
        rows[r].onBoardMax = Math.max(rows[r].onBoardMax, list.length)
        rows[r].samples++
        prev.set(k, now)
      }
    }
  }
  return { ...rows, state }
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

function line(label: string, a: Row, b: Row): string {
  const fmt = (r: Row): string =>
    `${String(r.arrivals).padStart(5)} 张 · ${String(r.units).padStart(6)} 件 · 在架均值 ${(r.onBoardSum / Math.max(1, r.samples)).toFixed(2)}/峰值 ${String(r.onBoardMax).padStart(3)} · 中位价 ${median(r.prices).toLocaleString('zh-CN')}`
  return `· ${label}\n    普通：${fmt(a)}\n    铁人：${fmt(b)}`
}

/** 多 seed 合计（奇货每窗命中 ~1 张 ⇒ 单 seed 比例抖得厉害，取合计才稳） */
function sumRows(parts: Row[]): Row {
  const out = newRow()
  for (const r of parts) {
    out.arrivals += r.arrivals
    out.units += r.units
    for (const pr of r.prices) if (out.prices.length < PRICE_SAMPLE_CAP) out.prices.push(pr)
    out.onBoardSum += r.onBoardSum
    out.onBoardMax = Math.max(out.onBoardMax, r.onBoardMax)
    out.samples += r.samples
  }
  return out
}

const normal = { rare: [] as Row[], exotic: [] as Row[], common: [] as Row[] }
const iron = { rare: [] as Row[], exotic: [] as Row[], common: [] as Row[] }
for (let i = 0; i < SEEDS; i++) {
  const a = run(false, SEED + i * 977)
  const b = run(true, SEED + i * 977)
  normal.rare.push(a.rare)
  normal.exotic.push(a.exotic)
  normal.common.push(a.common)
  iron.rare.push(b.rare)
  iron.exotic.push(b.exotic)
  iron.common.push(b.common)
}
/** 目录侧诊断：稀有/奇货商品在册多少、其中可买（playerBuyable !== false）多少 —— 读数为 0 时先看这里 */
{
  const ctx = buildSimContext()
  const cnt = (r: string, buyableOnly: boolean): number =>
    [...ctx.marketGoods.values()].filter((d) => d.rarity === r && (!buyableOnly || d.playerBuyable !== false)).length
  console.log(
    `■ 目录：rare ${cnt('rare', false)} 件（可买 ${cnt('rare', true)}） · exotic ${cnt('exotic', false)} 件（可买 ${cnt('exotic', true)}）`,
  )
}
const NR = sumRows(normal.rare)
const IR = sumRows(iron.rare)
const NE = sumRows(normal.exotic)
const IE = sumRows(iron.exotic)
const NC = sumRows(normal.common)
const IC = sumRows(iron.common)
console.log(`■ 铁人市场对照（seed ${SEED} 起 ${SEEDS} 个 · 声望 ${REP} · ${HOURS} 游戏小时 · 唯一差别＝是否铁人档）`)
console.log(line('稀有（rare）供给单', NR, IR))
console.log(line('奇货（exotic）供给单', NE, IE))
console.log(line('常驻（common）现货', NC, IC))
const ratio = (a: number, b: number): string => (a === 0 ? '—' : `×${(b / a).toFixed(2)}`)
console.log(
  `\n■ 差异：稀有出单 ${ratio(NR.arrivals, IR.arrivals)}（件数 ${ratio(NR.units, IR.units)}）` +
    ` · 奇货出单 ${ratio(NE.arrivals, IE.arrivals)} · 奇货在架峰值 ${NE.onBoardMax} → ${IE.onBoardMax}` +
    ` · 常驻**出单张数** ${ratio(NC.arrivals, IC.arrivals)} / **件数** ${ratio(NC.units, IC.units)}`,
)
console.log(
  '注：①「每窗刷单量 +200%」体现为**件数 ×3**（每窗仍铺同样几张阶梯单，只是每张更厚）；' +
    '②奇货受"每窗保留上限 2 → 4"约束，命中少时比例不到 ×2；③福利不动价格 ⇒ 两列中位价只是抽样抖动。',
)
// 价格口径核对：同商品两侧中位价之比（应在 1 附近；差异只来自 RNG 抖动与行情噪声）
{
  const med = (m: Row): number => median(m.prices)
  console.log(`· 中位价：rare ${med(NR).toLocaleString('zh-CN')} → ${med(IR).toLocaleString('zh-CN')} · exotic ${med(NE).toLocaleString('zh-CN')} → ${med(IE).toLocaleString('zh-CN')}`)
}
