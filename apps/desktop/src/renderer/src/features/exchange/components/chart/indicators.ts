/**
 * 图表指标（**全部前端现算**，不请求任何接口）。
 *
 * 船长规格：MA5 / MA20 可开关，副图 RSI(14)，分时带均价线。
 * 为什么集中在这里：指标是"看上去差不多就行"的重灾区——同一根均线在十字光标里和画线上
 * 必须用同一段收盘价；函数只保留一份实现，界面只负责取点画图。
 */
import type { Kline } from '../../client'

/** 简单移动平均；不足周期返回 null（折线要断开，不能拿前面几根凑） */
export function movingAverage(bars: readonly Kline[], period: number): Array<number | null> {
  const out = new Array<number | null>(bars.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i]!.c
    if (i >= period) sum -= bars[i - period]!.c
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/**
 * RSI（Wilder 口径，14 根）。
 * - 前 14 根没有足够涨跌样本 ⇒ null；
 * - 全跌（平均跌幅 0 且平均涨幅 > 0）⇒ 100；全平 ⇒ 50（避免 0/0）。
 */
export function rsi(bars: readonly Kline[], period = 14): Array<number | null> {
  const out = new Array<number | null>(bars.length).fill(null)
  if (bars.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const diff = bars[i]!.c - bars[i - 1]!.c
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  const value = (): number => {
    if (avgGain === 0 && avgLoss === 0) return 50
    if (avgLoss === 0) return 100
    return 100 - 100 / (1 + avgGain / avgLoss)
  }
  out[period] = value()
  for (let i = period + 1; i < bars.length; i++) {
    const diff = bars[i]!.c - bars[i - 1]!.c
    const g = diff > 0 ? diff : 0
    const l = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    out[i] = value()
  }
  return out
}

/**
 * 分时均价线：累计成交额 / 累计成交量（典型价 (H+L+C)/3 记成交额）。
 * 成交量缺失时退化为累计收盘均价，保证图形不空。
 */
export function averageLine(bars: readonly Kline[]): number[] {
  const out = new Array<number>(bars.length).fill(0)
  let amount = 0
  let volume = 0
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const typical = (b.h + b.l + b.c) / 3
    if (b.v > 0) {
      amount += typical * b.v
      volume += b.v
      out[i] = amount / volume
    } else {
      out[i] = i === 0 ? b.c : (out[i - 1]! * i + b.c) / (i + 1)
    }
  }
  return out
}

/** 数组里最后一个非空指标值（读数条用） */
export function lastDefined(values: ReadonlyArray<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v !== null && Number.isFinite(v)) return v
  }
  return null
}
