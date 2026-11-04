/**
 * 图表周期定义（**单点**）——`分时 / M1 / M5 / H1 / 日线 / 周线`。
 *
 * 周期分类标准规范（2026-11-04 船长口径）：
 * - 「分时」（intraday）：10 秒实时行情的动态走势线
 * - 「M1」（m1）：1 分钟蜡烛（回合内 5 根微观蜡烛）
 * - 「M5」（m5）：5 分钟蜡烛（核心回合线，一回合一根）
 * - 「H1」（h1）：1 小时蜡烛（12 回合）
 * - 「日线」（d1）：24 小时走势
 * - 「周线」（d7）：7 天大周期走势
 */
import type { ChartPeriod, Kline } from './client'

/** 分时图最多显示的点数（船长规格：最多抽样 240 点） */
export const INTRADAY_MAX_POINTS = 240

/** 合成历史根数（每个周期都铺满 400 根，保证一进页就有图） */
export const HISTORY_BARS = 400

const MINUTE_MS = 60_000

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 本机时区的当日 00:00 */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本机时区的周一 00:00 */
function startOfLocalWeek(ts: number): number {
  const d = new Date(startOfLocalDay(ts))
  // JS 的 getDay：周日 = 0 ⇒ 换算成「周一 = 0」
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 本机时区的当月 1 日 00:00 */
function startOfLocalMonth(ts: number): number {
  const d = new Date(ts)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface ChartPeriodSpec {
  id: ChartPeriod
  /** 切换按钮上的短标签 */
  label: string
  /** 名义桶宽（毫秒）：历史时间戳步进、成交量缩放与「一根 K 线多少秒」都用它 */
  bucketMs: number
  /** 合成历史根数（分时另按当日分钟数算） */
  historyCount: number
  /** 该周期一根 K 线对应多少秒（喂给历史合成器的波动率尺度） */
  barSeconds: number
  /** 横轴刻度标签 */
  axisLabel: (ts: number) => string
  /** 十字光标提示里的时间 */
  tipLabel: (ts: number) => string
}

/** 周期顺序 = 界面切换按钮顺序（分时在最左，与国内行情软件一致） */
export const CHART_PERIODS: ChartPeriodSpec[] = [
  {
    id: 'intraday',
    label: '分时',
    bucketMs: MINUTE_MS,
    historyCount: INTRADAY_MAX_POINTS,
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
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}时`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:00`
    },
  },
  {
    id: 'd1',
    label: '日线',
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
    label: '周线',
    bucketMs: 7 * 86_400_000,
    historyCount: HISTORY_BARS,
    barSeconds: 7 * 86_400,
    axisLabel: (ts) => {
      const d = new Date(ts)
      return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    },
    tipLabel: (ts) => {
      const d = new Date(ts)
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}（周）`
    },
  },
]

/** 专业终端周期切换按钮（2026-11-04 船长：分时、M1、M5、H1、日线、周线） */
export const PRO_CHART_PERIODS: ChartPeriodSpec[] = [
  'intraday',
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

/** 当前时刻所属 K 线的起始时间（桶左边界） */
export function bucketStart(period: ChartPeriod, ts: number): number {
  if (period === 'd1') return startOfLocalDay(ts)
  if (period === 'd7') return startOfLocalWeek(ts)
  if (period === 'd30') return startOfLocalMonth(ts)
  const spec = chartPeriodSpec(period)
  return Math.floor(ts / spec.bucketMs) * spec.bucketMs
}

/** 前一桶的起始时间（D30 按自然月回退，D7 按周一回退） */
export function prevBucketStart(period: ChartPeriod, bucket: number): number {
  if (period === 'd30') {
    const d = new Date(bucket)
    return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime()
  }
  if (period === 'd7') return bucket - 7 * 86_400_000
  if (period === 'd1') return bucket - 86_400_000
  return bucket - chartPeriodSpec(period).bucketMs
}

/**
 * 从「当前桶」往前推 `count` 根的时间戳（升序，最后一根 = 当前桶）。
 * D30 走自然月回退，避免 30×N 天后标签落在月中。
 */
export function historyTimestamps(period: ChartPeriod, now: number, count: number): number[] {
  const out = new Array<number>(Math.max(1, count))
  out[out.length - 1] = bucketStart(period, now)
  for (let i = out.length - 2; i >= 0; i--) out[i] = prevBucketStart(period, out[i + 1]!)
  return out
}

/** 分时图当日已有的分钟根数（00:00 起，含当前这根，至少 2 根便于画线） */
export function intradayBarCount(now: number): number {
  const minutes = Math.floor((now - startOfLocalDay(now)) / MINUTE_MS) + 1
  return Math.max(2, minutes)
}

/** 均匀抽样（保留首尾），分时显示最多 240 点；抽样只影响画图，不改数据源 */
export function sampleSeries(bars: readonly Kline[], max: number): Kline[] {
  if (bars.length <= max) return bars.slice()
  const out: Kline[] = []
  const step = (bars.length - 1) / (max - 1)
  let prev = -1
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step)
    if (idx === prev) continue
    out.push(bars[idx]!)
    prev = idx
  }
  return out
}
