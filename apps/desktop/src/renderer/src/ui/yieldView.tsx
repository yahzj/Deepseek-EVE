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
 * `名称 · 行情 P（利润率 M%）`——利润率可能为负（材料比产物贵），照实显示负号。
 */
export function GoodsLine({
  name,
  price,
  marginPct,
}: {
  name: string
  price: number | null
  marginPct: number | null
}) {
  return (
    <div className="app-belt-econ-val">
      {name} · {tr('ui.Yield.003')} {price !== null ? num(price) : '—'}
      {marginPct !== null ? `（${tr('ui.Yield.005', { p1: marginPct })}）` : ''}
    </div>
  )
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
