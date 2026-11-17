import type { ChartPeriod, Kline } from '../client'
import {
  CHART_PERIODS,
  HISTORY_BARS,
  bucketStart,
  historyTimestamps,
  intradayBarCount,
  startOfLocalDay,
} from '../chartPeriods'
import { synthBars, type PriceModel, type Rng } from './priceEngine'

const INTRADAY_MAX_BARS = 1440

export interface StockSeries {
  series: Record<ChartPeriod, Kline[]>
  intradayDay: number
}

export function buildStockSeries(
  model: PriceModel,
  rng: Rng,
  now: number,
  endPrice: number,
  levelQty: number,
): StockSeries {
  const series = {} as Record<ChartPeriod, Kline[]>
  for (const spec of CHART_PERIODS) {
    const count = spec.id === 'intraday' ? intradayBarCount(now) : spec.historyCount
    const timestamps = historyTimestamps(spec.id, now, count)
    const volumeBase = Math.max(1, levelQty * 0.04 * Math.sqrt(spec.barSeconds))
    series[spec.id] = synthBars(model, rng, timestamps, {
      barSeconds: spec.barSeconds,
      endPrice,
      volumeBase,
    })
  }
  return { series, intradayDay: startOfLocalDay(now) }
}

export function updateStockSeries(
  state: StockSeries,
  now: number,
  price: number,
  volume: number,
): void {
  const today = startOfLocalDay(now)
  if (today !== state.intradayDay) {
    state.series.intraday = [
      { t: bucketStart('intraday', now), o: price, h: price, l: price, c: price, v: volume },
    ]
    state.intradayDay = today
  }
  for (const spec of CHART_PERIODS) {
    const bars = state.series[spec.id]
    const bucket = bucketStart(spec.id, now)
    const last = bars[bars.length - 1]
    if (!last || last.t < bucket) {
      bars.push({ t: bucket, o: price, h: price, l: price, c: price, v: volume })
      const cap = spec.id === 'intraday' ? INTRADAY_MAX_BARS : HISTORY_BARS
      if (bars.length > cap) bars.splice(0, bars.length - cap)
      continue
    }
    last.h = Math.max(last.h, price)
    last.l = Math.min(last.l, price)
    last.c = price
    last.v += volume
  }
}
