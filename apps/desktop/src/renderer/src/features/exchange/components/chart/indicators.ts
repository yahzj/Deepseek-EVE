/**
 * 图表指标（**全部前端现算**，不请求任何接口）。
 *
 * 船长规格（2026-11-06）：主图布林带 BOLL(20,2)、副图 RSI(14)，另加成交量；均线不再画。
 * 依据：8 标的 5m 回测里 MA5/MA20 交叉跑不赢随机持有，BOLL 触带与 RSI14 才有正期望。
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

/** 布林带：中轨 = MA(period)，上下轨 = 中轨 ± mult 倍总体标准差（klinecharts 同口径） */
export function bollinger(
  bars: readonly Kline[],
  period = 20,
  mult = 2,
): { mid: Array<number | null>; up: Array<number | null>; dn: Array<number | null> } {
  const mid = movingAverage(bars, period)
  const up = new Array<number | null>(bars.length).fill(null)
  const dn = new Array<number | null>(bars.length).fill(null)
  for (let i = 0; i < bars.length; i++) {
    const m = mid[i]
    if (m === null || m === undefined) continue
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = bars[j]!.c - m
      sum += d * d
    }
    const sd = Math.sqrt(sum / period)
    up[i] = m + mult * sd
    dn[i] = m - mult * sd
  }
  return { mid, up, dn }
}
