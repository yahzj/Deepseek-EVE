/**
 * 六周期 K 线序列（Mock 侧）：启动时铺 400 根历史，之后每 1 秒只更新最新一根。
 *
 * 为什么不做「从 M1 聚合出 H1/D1/D30」：M1 只保留 400 根（≈6.6 小时），聚合不出 400 根日线；
 * 而 400 根月线需要 12000 天的一分钟数据。原型取舍是**每个周期各自合成 400 根、共享末根现价**，
 * 图尾一致且切周期不跳价；指标全部前端现算，不依赖这些历史的"嵌套正确性"。
 *
 * 实时更新纪律：1 秒 tick 只碰各周期数组的最后一根（跨桶时才 push），不重算历史。
 */
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

/** 分时最多保留当日 24 小时 = 1440 根（显示层再抽样到 240 点） */
const INTRADAY_MAX_BARS = 1440

export interface StockSeries {
  series: Record<ChartPeriod, Kline[]>
  /** 分时序列所属的本地日（跨日要清空重来） */
  intradayDay: number
}

/** 启动铺图：每个周期 400 根（分时 = 当日 00:00 到现在的 1 分钟线） */
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
    // 成交量随周期放大：1 分钟 ≈ 0.3 倍每档量，月线到几十倍；只用于柱高观感
    const volumeBase = Math.max(1, levelQty * 0.04 * Math.sqrt(spec.barSeconds))
    series[spec.id] = synthBars(model, rng, timestamps, {
      barSeconds: spec.barSeconds,
      endPrice,
      volumeBase,
    })
  }
  return { series, intradayDay: startOfLocalDay(now) }
}

/** 每个 1 秒 tick 调一次：只改最新一根；跨桶才 push，数组长度有上限 */
export function updateStockSeries(
  state: StockSeries,
  now: number,
  price: number,
  volume: number,
): void {
  const today = startOfLocalDay(now)
  if (today !== state.intradayDay) {
    // 跨日：分时从当日第一根重新开始（不带昨日数据；历史铺图留给下次启动）
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
