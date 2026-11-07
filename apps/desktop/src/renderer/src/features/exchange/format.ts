import { isEn } from '../../i18n/locale'
/**
 * 交易所原型的数字格式化（集中，保证所有面板同一把尺）。
 *
 * 2026-11-04 船长令：游戏货币没有小数，信用点一律整数显示。
 * 价格、金额、盈亏全部四舍五入到整数并带千分位；只有百分比（涨跌幅、费率）保留两位。
 */

/** 金额：千分位、整数（10,000,000 / 12,346） */
export function money(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}


/** 盈亏金额：带明确正负号（正数显式加号），千分位、整数（+12,346 / -12,346 / 0） */
export function pnlMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const formatted = Math.abs(Math.round(n)).toLocaleString('zh-CN')
  if (n > 0) return `+${formatted}`
  if (n < 0) return `-${formatted}`
  return '0'
}

/** 金额但不要小数（成交量、股数等整数量级） */
export function amount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

/** 价格：整数、千分位（信用点没有小数） */
export function price(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

/** 涨跌幅：带正负号、2 位小数 */
export function pct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

/** 纯百分比（距离/费率，不带正负号） */
export function pctAbs(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${Math.abs(n).toFixed(2)}%`
}

/** 时间戳 → HH:MM:SS（原型用本机时区即可，不接服务端时钟） */
export function clock(ts: number): string {
  const d = new Date(ts)
  const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

/** 时间戳 → MM-DD HH:MM */
export function shortTime(ts: number): string {
  const d = new Date(ts)
  const p2 = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** 裁剪长小数，避免界面上出现 0.30000000000000004 */
export function round(n: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

/**
 * 回合号 → 玩家可见的「当日第几期」（2026-11-04 船长令：回合数不能让玩家知道）。
 *
 * 服务端 `roundNo = floor(now / roundSec)`，与 Unix 纪元对齐（`internal/exchange/round.go:21`），
 * 直接显示是七位数天文数字。这里换算成当日第几期（1~288），同日单调递增、跨日重置。
 */
export function periodIndex(roundNo: number, roundSec = 300): number {
  if (!Number.isFinite(roundNo) || roundNo <= 0 || roundSec <= 0) return 0
  const startSec = roundNo * roundSec
  const dayStart = Math.floor(startSec / 86400) * 86400
  return Math.floor((startSec - dayStart) / roundSec) + 1
}

/** 成交额规范格式化：如 99M 信用点 / 1B 信用点 / 850K 信用点（整数，不带小数） */
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

/**
 * 极简下注金额前馈单点（2026-11-05）：投入金额含手续费，先折出可成交本金再按现价取整股数。
 * 判据：gross = qty × price，fee = ceil(gross × feeRate)（服务端下单冻结走 ceilFeeOf 向上取整），
 * spend = gross + fee ≤ inputCash；unusedInput 即「全仓」时费后取整留下的差额。
 */
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
  // 手续费冻结按向上取整；「全仓」时若末尾差 1 个信用点，回退一股保证可下单。
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
