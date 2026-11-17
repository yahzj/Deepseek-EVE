import type { Kline } from '../../client'

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
