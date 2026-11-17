import { isEn } from '../../i18n/locale'
import type { ChartPeriod, Kline } from './client'

export const INTRADAY_MAX_POINTS = 240

export const INTRADAY_VIEW_POINTS = 120

export const HISTORY_BARS = 400

const MINUTE_MS = 60_000

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfLocalWeek(ts: number): number {
  const d = new Date(startOfLocalDay(ts))
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfLocalMonth(ts: number): number {
  const d = new Date(ts)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface ChartPeriodSpec {
  id: ChartPeriod
  label: string
  bucketMs: number
  historyCount: number
  barSeconds: number
  axisLabel: (ts: number) => string
  tipLabel: (ts: number) => string
}

export const CHART_PERIODS: ChartPeriodSpec[] = [
  {
    id: 'intraday',
    get label() { return isEn() ? 'Line' : '分时' },
    bucketMs: 10_000,
    historyCount: INTRADAY_MAX_POINTS,
    barSeconds: 10,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
    },
  },
  {
    id: 'm1',
    label: 'M1',
    bucketMs: MINUTE_MS,
    historyCount: HISTORY_BARS,
    barSeconds: 60,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    },
  },
  {
    id: 'm5',
    label: 'M5',
    bucketMs: 5 * MINUTE_MS,
    historyCount: HISTORY_BARS,
    barSeconds: 300,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
    },
  },
  {
    id: 'h1',
    label: 'H1',
    bucketMs: 3_600_000,
    historyCount: HISTORY_BARS,
    barSeconds: 3_600,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return isEn() ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00` : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}时`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`
    },
  },
  {
    id: 'd1',
    get label() { return isEn() ? 'D1' : '日线' },
    bucketMs: 86_400_000,
    historyCount: HISTORY_BARS,
    barSeconds: 86_400,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    },
  },
  {
    id: 'd7',
    get label() { return isEn() ? 'W1' : '周线' },
    bucketMs: 7 * 86_400_000,
    historyCount: HISTORY_BARS,
    barSeconds: 7 * 86_400,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return isEn() ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} (W)` : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}（周）`
    },
  },
]

export const PRO_CHART_PERIODS: ChartPeriodSpec[] = [
  'm1',
  'm5',
  'h1',
  'd1',
  'd7',
]
  .map((id) => CHART_PERIODS.find((spec) => spec.id === (id as ChartPeriod)))
  .filter((spec): spec is ChartPeriodSpec => spec !== undefined)

const SPEC_BY_ID = new Map<ChartPeriod, ChartPeriodSpec>(CHART_PERIODS.map((s) => [s.id, s]))

export function chartPeriodSpec(period: ChartPeriod): ChartPeriodSpec {
  return SPEC_BY_ID.get(period) ?? CHART_PERIODS[0]!
}

export function bucketStart(period: ChartPeriod, ts: number): number {
  if (period === 'd1') return startOfLocalDay(ts)
  if (period === 'd7') return startOfLocalWeek(ts)
  if (period === 'd30') return startOfLocalMonth(ts)
  const spec = chartPeriodSpec(period)
  return Math.floor(ts / spec.bucketMs) * spec.bucketMs
}

export function prevBucketStart(period: ChartPeriod, bucket: number): number {
  if (period === 'd30') {
    const d = new Date(bucket)
    return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()
  }
  if (period === 'd7') return bucket - 7 * 86_400_000
  if (period === 'd1') return bucket - 86_400_000
  return bucket - chartPeriodSpec(period).bucketMs
}

export function historyTimestamps(period: ChartPeriod, now: number, count: number): number[] {
  const out = new Array<number>(Math.max(1, count))
  out[out.length - 1] = bucketStart(period, now)
  for (let i = out.length - 2; i >= 0; i--) out[i] = prevBucketStart(period, out[i + 1]!)
  return out
}

export function intradayBarCount(now: number): number {
  const minutes = Math.floor((now - startOfLocalDay(now)) / MINUTE_MS) + 1
  return Math.max(2, minutes)
}

export function sampleSeries(bars: readonly Kline[], max: number): Kline[] {
  if (bars.length <= max) return bars.slice()
  const out: Kline[] = []
  const step = (bars.length - 1) / (max - 1)
  let prev = -1
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step)
    if (idx === prev) continue
    let v = 0
    for (let j = prev + 1; j <= idx; j++) v += bars[j]!.v
    out.push({ ...bars[idx]!, v })
    prev = idx
  }
  return out
}
