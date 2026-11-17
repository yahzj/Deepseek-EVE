import type { Kline } from '../client'

export interface Rng {
  next(): number
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

const X_LIMIT = Math.log(5)
const EWMA_LAMBDA = 0.94
const T_NU = 5
const VOL_MIN_FACTOR = 0.25
const VOL_MAX_FACTOR = 4

export interface PriceModel {
  code: string
  anchor: number
  x: number
  sigmaBase: number
  mu: number
  theta: number
  varianceEwma: number
  shockTicks: number
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

function studentT(rng: Rng): number {
  const z = rng.normal()
  let chi = 0
  for (let i = 0; i < T_NU; i++) chi += rng.normal() ** 2
  const t = z / Math.sqrt(chi / T_NU)
  return Math.max(-8, Math.min(8, t))
}

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
  model.varianceEwma = clampVol(model, EWMA_LAMBDA * model.varianceEwma + (1 - EWMA_LAMBDA) * r * r)
  return model.anchor * Math.exp(model.x)
}

export function applyEventShock(model: PriceModel, pct: number): void {
  model.x = Math.min(X_LIMIT, Math.max(-X_LIMIT, model.x + Math.log(1 + pct)))
  model.shockTicks = 8
  model.shockMul = 2.5
  model.varianceEwma = clampVol(model, model.varianceEwma * 4)
}

export interface SynthBarsOptions {
  barSeconds: number
  endPrice: number
  volumeBase: number
}

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
  return out
}
