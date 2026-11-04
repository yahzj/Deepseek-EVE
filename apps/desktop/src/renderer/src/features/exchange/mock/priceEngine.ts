/**
 * 行情引擎（原型）——对数空间随机游走 + Student-t 肥尾 + EWMA 波动率 + 均值回归锚点 + 事件冲击。
 *
 * 公式照 `docs/design/stock-exchange-server-20261103.md` 附录 A.2：
 *   x = ln(P/A)，Δx = (μ − σ²/2)Δt + σ√Δt·Z − θxΔt + ΣJ
 * 原型 1 秒一拍（Δt = 1），所以 σ 取「每秒」口径（由 60 秒基准折算，见 STOCK 定义）。
 *
 * 为什么自己写 PRNG 而不用 `Math.random()`：行情要能复现——调参时同一个种子跑出同一条曲线，
 * 否则「刚才那波暴跌到底是什么参数造成的」永远查不清（工作文档硬约束）。
 *
 * 随机消费纪律：每个标的**每步固定消费 6 个正态数**（Student-t 的分母卡方 + 分子），
 * 不按条件跳过；这样任意一只股票的停机/加仓都不会让别的股票时序漂移。
 */
import type { Kline } from '../client'

/** 可复现随机源（mulberry32 + Box-Muller） */
export interface Rng {
  /** [0, 1) 均匀分布 */
  next(): number
  /** 标准正态（确定性地消费随机数） */
  normal(): number
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  let spare: number | null = null
  const normal = (): number => {
    if (spare !== null) {
      const v = spare
      spare = null
      return v
    }
    let u = 0
    while (u === 0) u = next()
    const v = next()
    const r = Math.sqrt(-2 * Math.log(u))
    spare = r * Math.sin(2 * Math.PI * v)
    return r * Math.cos(2 * Math.PI * v)
  }
  return { next, normal }
}

/** 硬边界：x 钳在 ±ln5 ⇒ 价格被夹在 0.2A ~ 5A（防归零与无限泡沫） */
const X_LIMIT = Math.log(5)
/** EWMA 衰减（附录 A.2 的 λ=0.94） */
const EWMA_LAMBDA = 0.94
/** Student-t 自由度（ν≈5 才有可感知肥尾） */
const T_NU = 5
/** 波动率相对基准的上下限（防失控：≤4σ_base，事件后也不许无限放大） */
const VOL_MIN_FACTOR = 0.25
const VOL_MAX_FACTOR = 4

export interface PriceModel {
  code: string
  /** 内在价值锚点 */
  anchor: number
  /** 对数偏离 ln(P/A) */
  x: number
  /** 每 tick（1 秒）的基准波动率 */
  sigmaBase: number
  /** 每 tick 漂移 */
  mu: number
  /** 每 tick 均值回归强度 */
  theta: number
  /** 波动率平方的 EWMA（方差，不是标准差） */
  varianceEwma: number
  /** 事件冲击剩余 tick 数 */
  shockTicks: number
  /** 事件期间的波动放大倍数（衰减回 1） */
  shockMul: number
}

export function createPriceModel(
  code: string,
  anchor: number,
  sigmaBase: number,
  mu: number,
  theta: number,
): PriceModel {
  return {
    code,
    anchor,
    x: 0,
    sigmaBase,
    mu,
    theta,
    varianceEwma: sigmaBase * sigmaBase,
    shockTicks: 0,
    shockMul: 1,
  }
}

function clampVol(model: PriceModel, variance: number): number {
  const lo = (model.sigmaBase * VOL_MIN_FACTOR) ** 2
  const hi = (model.sigmaBase * VOL_MAX_FACTOR) ** 2
  return Math.min(hi, Math.max(lo, variance))
}

/** Student-t（ν=5）近似：Z / sqrt(χ²_ν/ν)；每一步固定 6 次正态消费 */
function studentT(rng: Rng): number {
  const z = rng.normal()
  let chi = 0
  for (let i = 0; i < T_NU; i++) chi += rng.normal() ** 2
  const t = z / Math.sqrt(chi / T_NU)
  // 极端值截断：肥尾要有，但不能一步把价格打穿到边界
  return Math.max(-8, Math.min(8, t))
}

/**
 * 推进一拍，返回新价格（同时把 `model` 内部状态推进）。
 * 为什么返回价格而不是让调用方自己算：边界钳制与 EWMA 更新必须同步，拆开容易只改一边。
 */
export function stepPrice(model: PriceModel, rng: Rng): number {
  const shockMul = model.shockTicks > 0 ? model.shockMul : 1
  if (model.shockTicks > 0) {
    model.shockTicks -= 1
    if (model.shockTicks === 0) model.shockMul = 1
  }
  const sigma = Math.sqrt(clampVol(model, model.varianceEwma)) * shockMul
  const z = studentT(rng)
  const r = sigma * z
  const drift = (model.mu - (sigma * sigma) / 2) * 1
  const revert = -model.theta * model.x
  model.x = Math.min(X_LIMIT, Math.max(-X_LIMIT, model.x + drift + r + revert))
  // 用「实际对数收益」更新方差，事件那几拍会被放大后自然回落
  model.varianceEwma = clampVol(model, EWMA_LAMBDA * model.varianceEwma + (1 - EWMA_LAMBDA) * r * r)
  return model.anchor * Math.exp(model.x)
}

/** 事件冲击：pct=0.05 ⇒ 立刻 +5%；同时把波动率抬起来 8 拍（观感：事件后还在抖） */
export function applyEventShock(model: PriceModel, pct: number): void {
  model.x = Math.min(X_LIMIT, Math.max(-X_LIMIT, model.x + Math.log(1 + pct)))
  model.shockTicks = 8
  model.shockMul = 2.5
  model.varianceEwma = clampVol(model, model.varianceEwma * 4)
}

export interface SynthBarsOptions {
  /** 一根 K 线的秒数（由图表周期决定：M1=60、H1=3600、D1=86400…） */
  barSeconds: number
  /** 末根收盘价：历史整体缩放到当前价，保证与实时行情衔接、切周期不跳价 */
  endPrice: number
  /** 一根 K 线的大致成交量基准（只影响柱高观感，不影响撮合） */
  volumeBase: number
}

/**
 * 合成一段**多周期历史 K 线**（2026-11-03 六周期批）。
 *
 * 与 `synthKlines` 的差别：
 * - 时间戳由调用方传入（D1/D7/D30 要走本机日历边界，不能简单 `i * 60s`）；
 * - **不写回** `model` 的实时状态 —— 每个周期各合成一段，互不干扰实时价格；
 * - 各周期独立合成、只共享「末根收盘价 = 当前价」与同一套随机过程/肥尾，
 *   这是原型的已知取舍：400 根 D30 与 400 根 M1 不是同一段历史的嵌套聚合，
 *   但都来自同一价格引擎且图尾价格一致，切周期不会出现"价格跳变"。
 * - 波动率按 `σ√T` 缩放后**夹在 0.4%~4.5%**：1 分钟不会太温、日/周/月也不会把
 *   价格打到 0.2A~5A 的硬边界上（那是实时引擎的边界，历史只用于铺图）。
 */
export function synthBars(
  model: PriceModel,
  rng: Rng,
  timestamps: readonly number[],
  opts: SynthBarsOptions,
): Kline[] {
  const count = timestamps.length
  if (count === 0) return []
  const safeSeconds = Math.max(1, opts.barSeconds)
  const barSigma = Math.min(0.045, Math.max(0.004, model.sigmaBase * Math.sqrt(safeSeconds)))
  // 均值回归系数按「一根 K 线」折算后夹住；不夹的话 D1 的 θT≈6.9 会让序列一步归零
  const barTheta = Math.min(0.06, Math.max(0.002, model.theta * safeSeconds))
  const drift = Math.min(0.01, Math.max(-0.01, model.mu * safeSeconds))
  const out: Kline[] = []
  let x = 0
  let prevClose = 1
  for (let i = 0; i < count; i++) {
    const z = studentT(rng)
    x = Math.min(1.6, Math.max(-1.6, x + barSigma * z + drift - barTheta * x))
    const close = Math.exp(x)
    const open = prevClose
    const wick = barSigma * 0.35 * (0.25 + rng.next())
    out.push({
      t: timestamps[i]!,
      o: open,
      h: Math.max(open, close) * (1 + wick),
      l: Math.min(open, close) * (1 - wick),
      c: close,
      v: Math.max(
        1,
        opts.volumeBase * (0.55 + rng.next() * 0.9) * (1 + Math.min(2, Math.abs(z)) * 0.45),
      ),
    })
    prevClose = close
  }
  // 整体缩放到当前价；末根再钉一次收盘价，避免浮点误差让图尾与现价差一分钱
  const last = out[out.length - 1]!
  const factor = last.c > 0 && opts.endPrice > 0 ? opts.endPrice / last.c : 1
  for (const bar of out) {
    bar.o *= factor
    bar.h *= factor
    bar.l *= factor
    bar.c *= factor
  }
  if (opts.endPrice > 0) {
    last.c = opts.endPrice
    last.h = Math.max(last.h, opts.endPrice)
    last.l = Math.min(last.l, opts.endPrice)
  }
  return out
}

/**
 * 生成一段历史 K 线（页面首次打开时 K 线不能是空的）。
 *
 * 【注意】这是第一版单周期（M1）铺图函数，保留给旧调用/对照；六周期图表改用 `synthBars`。
 *
 * 为什么用「同一模型往前推」而不是造假随机数：历史段结束后把 `model.x` 设成最后一根收盘价，
 * 当前价与图尾自然衔接；锚点仍是原值，于是「价格偏离锚点 → 均值回归」在开局就有戏。
 */
export function synthKlines(
  model: PriceModel,
  rng: Rng,
  count: number,
  startTs: number,
  ticksPerBar = 60,
): Kline[] {
  const barSigma = model.sigmaBase * Math.sqrt(ticksPerBar)
  const barTheta = model.theta * ticksPerBar
  let x = 0
  let prevClose = model.anchor
  const out: Kline[] = []
  for (let i = 0; i < count; i++) {
    const z = studentT(rng)
    const r = barSigma * z
    x = Math.min(X_LIMIT, Math.max(-X_LIMIT, x + r - barTheta * x))
    const close = model.anchor * Math.exp(x)
    const open = prevClose
    const hi = Math.max(open, close) * (1 + Math.abs(r) * 0.35)
    const lo = Math.min(open, close) * (1 - Math.abs(r) * 0.35)
    out.push({
      t: startTs - (count - i) * ticksPerBar * 1000,
      o: open,
      h: hi,
      l: lo,
      c: close,
      v: 0,
    })
    prevClose = close
  }
  model.x = x
  // 历史段只用来铺图；实时波动率从基准 σ 重新起算（否则开局几拍会带着 60 秒口径的超大波动）
  return out
}
