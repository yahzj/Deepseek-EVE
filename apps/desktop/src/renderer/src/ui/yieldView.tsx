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
import { marketGoodOf, marketQuote } from '@whale/core'
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
 * **市场当前行情价**（每单位）——取市场页同一把尺：`marketGoodOf` 找商品条目 ⇒ `marketQuote` 读当前报价，
 * 优先卖方挂单（`sell`），没有则用买方挂单（`buy`）；都没有（未解锁 / 无人挂单）⇒ `null`（界面「—」）。
 *
 * 商品的"类"逐档试：物资/装备走 `item`/`module`，舰船走 `ship`（**2026-09-23**：组装机与造船厂的产物是
 * 装备与舰船 ⇒ 按船长口径"单纯显示市场当前价格"，得先能找到它在市场上的条目）。
 */
export function marketPriceOf(state: GameState, ctx: SimContext, itemId: string): number | null {
  for (const kind of ['item', 'module', 'ship'] as const) {
    const good = marketGoodOf(ctx, kind, itemId)
    if (!good) continue
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
