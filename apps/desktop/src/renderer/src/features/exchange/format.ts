import { isEn } from '../../i18n/locale'

export function money(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}


export function pnlMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const formatted = Math.abs(Math.round(n)).toLocaleString('zh-CN')
  if (n > 0) return `+${formatted}`
  if (n < 0) return `-${formatted}`
  return '0'
}

export function amount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

export function price(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

export function pct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function pctAbs(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${Math.abs(n).toFixed(2)}%`
}

export function clock(ts: number): string {
  const d = new Date(ts)
  const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

export function shortTime(ts: number): string {
  const d = new Date(ts)
  const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export function periodIndex(roundNo: number, roundSec = 300): number {
  if (!Number.isFinite(roundNo) || roundNo <= 0 || roundSec <= 0) return 0
  const startSec = roundNo * roundSec
  const dayStart = Math.floor(startSec / 86400) * 86400
  return Math.floor((startSec - dayStart) / roundSec) + 1
}

export function turnover(n: number): string {
  const unit = isEn() ? ' Credits' : ' 信用点'
  if (!Number.isFinite(n) || n <= 0) return `0${unit}`
  if (n >= 1e9) return `${Math.round(n / 1e9).toLocaleString('zh-CN')}B${unit}`
  if (n >= 1e6) return `${Math.round(n / 1e6).toLocaleString('zh-CN')}M${unit}`
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString('zh-CN')}K${unit}`
  return `${Math.round(n).toLocaleString('zh-CN')}${unit}`
}

export function creditUnit(): string {
  return isEn() ? 'Credits' : '信用点'
}

export interface SimpleBetEstimate {
  qty: number
  gross: number
  fee: number
  spend: number
  remainCash: number
  unusedInput: number
}

export function estimateSimpleBet(inputCash: number, currentPrice: number, feeRate: number, cash: number): SimpleBetEstimate {
  const safeCash = Number.isFinite(cash) ? Math.max(0, cash) : 0
  if (!(Number.isFinite(inputCash) && inputCash > 0) || !(Number.isFinite(currentPrice) && currentPrice > 0)) {
    return { qty: 0, gross: 0, fee: 0, spend: 0, remainCash: safeCash, unusedInput: 0 }
  }
  const rate = Number.isFinite(feeRate) && feeRate > 0 ? feeRate : 0
  let qty = Math.floor(inputCash / (1 + rate) / currentPrice)
  while (qty > 0 && qty * currentPrice + Math.ceil(qty * currentPrice * rate) > inputCash) qty -= 1
  const gross = qty * currentPrice
  const fee = gross > 0 ? Math.ceil(gross * rate) : 0
  const spend = gross + fee
  return {
    qty,
    gross,
    fee,
    spend,
    remainCash: Math.max(0, safeCash - spend),
    unusedInput: Math.max(0, inputCash - spend),
  }
}
