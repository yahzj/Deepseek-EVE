/**
 * **活动卡「产出」读数**（**2026-09-23 船长令**）：
 *
 * > 「我想修改各个有收益的卡牌上写着的收入预估，写着的收入预估会严重误导玩家。建议除了直接收入信用点的
 * >  活动外，其他活动只显示每小时能收获多少资源以及产出的物资的市场当前价格。……如果是装备和舰船的话，
 * >  就单纯显示市场当前价格。」
 *
 * 四答口径（船长同日）：① 括号里那个数 = **该物品仓库已拥有的数量**；② 「市场当前价格」取**市场页当前行情价**；
 * ③ 覆盖**所有有产出的活动卡**；④ 旧的「≈ ISK/h」毛估**彻底拿掉**（卡面与悬停都不再出现）。
 *
 * 本文件 = 这套读数的**唯一实现**：行文格式、行情取数、仓库数量、买不到行情时的退化处理**全在这里**，
 * 各卡只负责交出"每小时产什么、产多少"（`YieldRow[]`）——免得五张卡各写一套估价（改前
 * `panels/Expedition.tsx` 与 `pages/MapPage.tsx` 就是各算一套，正是这次要收掉的）。
 *
 * ⚠ **直接产信用点的活动不适用本模块**（悬赏奖金 / 运输报酬这类"到手就是 ISK"的读数照旧保留 ISK/h）。
 */
import { marketGoodOf, marketHistory, marketQuote } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'
import { fmtDuration } from '../i18n/fmt'
/** 调试门禁（本机 origin ∧ 本机开关；发布版恒 false）——「净收益/h」只在调试模式下渲染 */
import { debugEnabled } from '../game/debugFlag'

/** 一个产出条目：每小时产多少（装备/舰船类给 null ⇒ 只报行情价） */
export interface YieldRow {
  itemId: string
  /** 每小时产出量；`null` = 这类产出不按小时计（装备 / 舰船）⇒ 只给行情价 */
  perHour: number | null
}

/** 渲染用的一行（已把行情价、仓库数量查好） */
export interface YieldLine {
  itemId: string
  name: string
  perHour: number | null
  /** 仓库已拥有数量（船长口径：括号里那个数）；**装备/舰船类为 null ⇒ 不显示仓库**（船长：只显示行情价） */
  owned: number | null
  /** 市场当前行情价（每单位；查不到 ⇒ null ⇒ 界面显示「—」） */
  price: number | null
}

/** 仓库已拥有数量（**只读仓库**，与船长"仓库已拥有的数量"逐字对应；货舱里的不算） */
export function ownedInWarehouse(state: GameState, itemId: string): number {
  return Math.max(0, Math.floor(state.warehouse.items[itemId] ?? 0))
}

/**
 * **市场当前行情价**（每单位）——**取"市场详情页折线图上显示的价格"**（**2026-09-23 船长令**：
 * 「各个卡片中，产品的市场行情采用对应商品市场详细中折线图中显示的价格。」）：
 * 折线图读的是 `marketHistory`（=`state.market.priceHistory[goodKey]`，30 分钟一个采样点）
 * ⇒ 卡面与图上**右端那一点**同源，不再是挂单最优价（那是"能立刻成交的价"，与折线图不是一回事）。
 * 价史还没攒起来（新解锁商品）时退回挂单价兜底，免得卡面一片「—」。
 *
 * 商品的"类"逐档试：物资/装备走 `item`/`module`，舰船走 `ship`。
 */
export function marketPriceOf(state: GameState, ctx: SimContext, itemId: string): number | null {
  for (const kind of ['item', 'module', 'ship'] as const) {
    const good = marketGoodOf(ctx, kind, itemId)
    if (!good) continue
    const hist = marketHistory(state, good.key)
    const last = hist.length > 0 ? hist[hist.length - 1] : undefined
    if (typeof last === 'number' && last > 0) return Math.round(last)
    const quote = marketQuote(state, ctx, good.key)
    const p = quote?.sell ?? quote?.buy
    if (typeof p === 'number' && p > 0) return Math.round(p)
  }
  return null
}

/**
 * 把各卡交来的产出条目补齐成可渲染的行。
 * `opts.goods = true` ⇒ **装备 / 舰船**：按船长口径"**单纯显示市场当前价格**"（不折算每小时、不显示仓库）。
 */
export function yieldLinesOf(
  state: GameState,
  ctx: SimContext,
  rows: readonly YieldRow[],
  opts?: { goods?: boolean },
): YieldLine[] {
  return rows.map((r) => ({
    itemId: r.itemId,
    name: ctx.items.get(r.itemId)?.name ?? r.itemId,
    perHour: opts?.goods === true ? null : r.perHour,
    owned: opts?.goods === true ? null : ownedInWarehouse(state, r.itemId),
    price: marketPriceOf(state, ctx, r.itemId),
  }))
}

const num = (v: number): string => v.toLocaleString('zh-CN')

/**
 * **利润率**（**2026-09-23 船长令**：「造船厂那…应该在行情价格后面显示（利润率%），组装机处也显示（利润率%）」）：
 * `P = (每批产物行情值 − 材料成本) ÷ 材料成本 × 100%`，四舍五入到整数；**材料成本也按当前行情价**算
 * （取不到行情的材料用物品基准价兜底，与卡面显示的行情价同一把尺）。成本 ≤ 0 或产物无行情 ⇒ `null`（不显示）。
 *
 * ⚠ **产物要按"一次生产几件"计**（**2026-09-24 船长报障**：「组装机零件的利润率不对，组装机是一次性生产
 * 10 个的，现在的利润只计算一个」）：组装机的零件 = 每批 **10 件**、消耗品 = 每批 **N 发**，
 * 而 `materials` 是**整批**的料 ⇒ 收入必须 `单价 × 件数`，否则分子只剩一件的钱（零件会显示成 −85% 那种
 * 大负数）。装备 / 舰船 = 每批 1 件（`unitsPerRun` 缺省 1 ⇒ 与旧口径逐值相同）。
 * 口径与正式工具 `npm run manufacture:econ` 的「产物价值 = 现货价 × outputUnits」同源。
 *
 * 卡面**显示**的行情价仍是**每单位**（与市场页/折线图同尺，船长 2026-09-23 口径），只有利润率按整批算。
 */
export function marginPctOf(price: number | null, costIsk: number, unitsPerRun = 1): number | null {
  if (price === null || costIsk <= 0) return null
  const revenue = price * Math.max(1, unitsPerRun)
  return Math.round(((revenue - costIsk) / costIsk) * 100)
}

/**
 * **装备 / 舰船产物的读数行**（造船厂卡与组装机卡共用）：
 * `名称 · 行情 P · 整批 P×N（利润率 M%）`——利润率可能为负（材料比产物贵），照实显示负号。
 * `unitsPerRun > 1`（组装机零件 10 件 / 消耗品 N 发）时**多显示一段「整批」**（船长 2026-09-24：
 * 「也显示整批」）：行情那一段仍是**每单位**（与市场页折线图同尺），整批 = 单价 × 件数 = 这一炉到手多少。
 */
export function GoodsLine({
  name,
  price,
  marginPct,
  unitsPerRun = 1,
}: {
  name: string
  price: number | null
  marginPct: number | null
  /** 一次制造产出件数（缺省 1 ⇒ 不显示「整批」那一段，装备/舰船卡逐字不变） */
  unitsPerRun?: number
}) {
  const units = Math.max(1, Math.floor(unitsPerRun))
  return (
    <div className="app-belt-econ-val">
      {name} · {tr('ui.Yield.003')} {price !== null ? num(price) : '—'}
      {price !== null && units > 1 ? ` · ${tr('ui.Yield.006', { p1: num(price * units) })}` : ''}
      {marginPct !== null ? `（${tr('ui.Yield.005', { p1: marginPct })}）` : ''}
    </div>
  )
}

/**
 * **净收益/h（调试模式专属）**（**2026-09-29 船长令**：「我只想在调试模式下显示」）。
 *
 * 沿革：这条读数当年在组装机/造船厂/精炼/残骸四类卡上，**2026-09-23 船长令**「旧的『≈ ISK/h』毛估
 * 彻底拿掉（卡面与悬停都不再出现）」把它整段删了（见本文件头注）。现在按新令**只放回调试模式**。
 *
 * 口径 = 正式工具 `npm run manufacture:econ` 的「劳动者价值/h」**同式**：
 * `(整批产物行情值 − 材料行情成本) ÷ 本批耗时 × 3600`——与卡面**利润率**同一把尺（同一份行情、同一个"整批"）。
 *
 * ⚠ `buildMs` 用**引擎折算后的本批耗时**（`calcBuildDurationMs`，含工业理论/批量生产等技能）：
 * 技能缩短周期 ⇒ 每小时能跑更多批 ⇒ 本值随之升高，这才是"这条线每小时赚多少"的真读数。
 * 调试模式 `debugQuick` 下它恒为 1 秒 ⇒ 读数会随之放大，这是调试口径的本来含义（与卡面"manual build 1秒"同源）。
 *
 * 返回 null = 不显示（产物无行情 / 成本 ≤ 0 / 耗时非法）。
 */
export function netIskPerHourOf(
  price: number | null,
  costIsk: number,
  buildMs: number,
  unitsPerRun = 1,
): number | null {
  /**
   * ⚠ **允许 `costIsk === 0`**（**2026-09-29 船长令**「希望在调试模式下看到各个活动的净收益」）：
   * 采矿 / 残骸回收这类**没有耗料成本**的活动，净额就是产出值本身
   * （旧写法 `costIsk <= 0` 会把它们一律判成"不显示"，等于把这些活动排除在这条读数之外）。
   * 负成本仍是非法输入 ⇒ 返回 null。
   */
  if (price === null || costIsk < 0 || !Number.isFinite(buildMs) || buildMs <= 0) return null
  const net = price * Math.max(1, unitsPerRun) - costIsk
  return Math.round((net / buildMs) * 3_600_000)
}

/**
 * **「净收益/h」那一行（渲染单点）**——批量型与连续型共用同一份行文与样式
 * （口径各自算好再交给它 ⇒ 界面永远只有一种写法）。
 * `buildMs` 省略 ⇒ 不附"本批耗时"（连续型活动没有"批"这个概念）。
 */
function NetLine({ value, buildMs }: { value: number | null; buildMs?: number }) {
  if (value === null) return null
  return (
    <div className="app-belt-out app-net-line">
      <span className="app-dim">{tr('ui.Yield.007')}</span> {tr('ui.Yield.008', { p1: num(value) })}
      {buildMs !== undefined && Number.isFinite(buildMs) && buildMs > 0 ? (
        <span className="app-dim"> · {tr('ui.Yield.009', { p1: fmtDuration(buildMs) })}</span>
      ) : null}
    </div>
  )
}

/**
 * **「净收益/h」那一行（仅调试模式渲染 · 批量型）**（**2026-09-29 船长令**）。
 *
 * 为什么单开一个组件：组装机/造船厂/精炼/回收四类卡的产出区各不相同，但这行读数的**口径与写法必须一致**
 * （口径单点 = `netIskPerHourOf`）⇒ 各处都 `<NetIncomeLine …/>`，行文只在这里写一次。
 *
 * 调试门禁 = `game/debugFlag.debugEnabled()`（本机 origin ∧ 本机开关；**发布版恒 false ⇒ 玩家看不到**）。
 * 顺带把"本批耗时"也用小字附上——调试模式下看收益必须知道分母是什么（否则 debugQuick 的放大读数会被误读）。
 */
export function NetIncomeLine({
  price,
  costIsk,
  buildMs,
  unitsPerRun = 1,
}: {
  price: number | null
  costIsk: number
  buildMs: number
  unitsPerRun?: number
}) {
  if (!debugEnabled()) return null
  return <NetLine value={netIskPerHourOf(price, costIsk, buildMs, unitsPerRun)} buildMs={buildMs} />
}

/**
 * **「净收益/h」那一行（仅调试模式渲染 · 连续型）**（**2026-09-29 船长令**）。
 *
 * 用于**按小时持续产出**的活动（矿带卡＝采矿）：这类活动没有"批"与"周期"，
 * 净/h 就是 **Σ(每小时产出 × 该产物行情价) − 耗料成本（采矿为 0）**。
 * 与批量型的区别只在分母：批量型是"一批 ÷ 本批耗时"，连续型分母本来就是 1 小时 ⇒ 直接相加。
 * 行情取数与卡面「×N/h（仓库 · 行情）」**同一把尺**（`marketPriceOf`）。
 */
export function NetIncomeLinePerHour({ rows }: { rows: readonly { perHour: number; price: number | null }[] }) {
  if (!debugEnabled()) return null
  const total = rows.reduce((s, r) => s + (r.price ?? 0) * r.perHour, 0)
  return <NetLine value={total > 0 ? Math.round(total) : null} />
}

/** 一行产出：`名称 ×179/h（仓库 9,440,375 · 行情 12,345）`；装备/舰船 ⇒ `名称（行情 12,000,000）` */
export function YieldLines({ lines }: { lines: readonly YieldLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className="app-yield">
      <div className="app-dim app-yield-head">{tr('ui.Yield.001')}</div>
      {lines.map((l) => (
        <div className="app-yield-row" key={l.itemId}>
          <span className="app-yield-name">{l.name}</span>
          {l.perHour !== null ? <span className="app-yield-rate">×{num(l.perHour)}/h</span> : null}
          <span className="app-dim">
            （{l.owned !== null ? `${tr('ui.Yield.002')} ${num(l.owned)} · ` : ''}
            {tr('ui.Yield.003')} {l.price !== null ? num(l.price) : '—'}）
          </span>
        </div>
      ))}
    </div>
  )
}
