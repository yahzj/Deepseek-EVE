/**
 * 交易所原型的数字格式化（集中，保证所有面板同一把尺）。
 *
 * 为什么不用现成的 `isk()`：市场页那个会把金额取整到整数，而股价与保证金需要 2 位小数；
 * 这里保持「金额千分位 + 2 位小数、股价固定 2 位、数量整数千分位」三套，界面按语义选。
 */

/** 金额：千分位、最多 2 位小数（10,000,000 / 12,345.67） */
export function money(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** 金额但不要小数（成交量、股数等整数量级） */
export function amount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

/** 价格：固定 2 位小数 */
export function price(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
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

/** 成交额规范格式化：如 99.45M ISK / 1.25B ISK / 850.00K ISK */
export function turnover(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0.00 ISK'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B ISK`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M ISK`
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K ISK`
  return `${n.toFixed(2)} ISK`
}
