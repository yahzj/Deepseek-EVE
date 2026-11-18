import { ceilFinalQuantity, marketGoodOf, marketHistory, marketQuote } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { tr } from '../i18n/locale'
import { fmtDuration } from '../i18n/fmt'
import { debugEnabled } from '../game/debugFlag'

export interface YieldRow {
  itemId: string
  perHour: number | null
}

export interface YieldLine {
  itemId: string
  name: string
  perHour: number | null
  owned: number | null
  price: number | null
}

export function ownedInWarehouse(state: GameState, itemId: string): number {
  return Math.max(0, Math.floor(state.warehouse.items[itemId] ?? 0))
}

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

export function marginPctOf(price: number | null, costIsk: number, unitsPerRun = 1): number | null {
  if (price === null || costIsk <= 0) return null
  const revenue = price * Math.max(1, ceilFinalQuantity(unitsPerRun))
  return Math.round(((revenue - costIsk) / costIsk) * 100)
}

export function GoodsLine({
  name,
  price,
  marginPct,
  unitsPerRun = 1,
}: {
  name: string
  price: number | null
  marginPct: number | null
  unitsPerRun?: number
}) {
  const units = Math.max(1, ceilFinalQuantity(unitsPerRun))
  return (
    <div className="app-belt-econ-val">
      {name} · {tr('ui.Yield.003')} {price !== null ? num(price) : '—'}
      {price !== null && units > 1 ? ` · ${tr('ui.Yield.006', { p1: num(price * units) })}` : ''}
      {marginPct !== null ? `（${tr('ui.Yield.005', { p1: marginPct })}）` : ''}
    </div>
  )
}

export function netIskPerHourOf(
  price: number | null,
  costIsk: number,
  buildMs: number,
  unitsPerRun = 1,
): number | null {
  if (price === null || costIsk < 0 || !Number.isFinite(buildMs) || buildMs <= 0) return null
  const net = price * Math.max(1, unitsPerRun) - costIsk
  return Math.round((net / buildMs) * 3_600_000)
}

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

export function NetIncomeLinePerHour({ rows }: { rows: readonly { perHour: number; price: number | null }[] }) {
  if (!debugEnabled()) return null
  const total = rows.reduce((s, r) => s + (r.price ?? 0) * r.perHour, 0)
  return <NetLine value={total > 0 ? Math.round(total) : null} />
}

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
