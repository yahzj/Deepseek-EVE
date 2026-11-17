import { ceilFinalQuantity } from './quantity'

export const MONEY_WAN_THRESHOLD = 10_000
export const MONEY_YI_THRESHOLD = 100_000_000
export const MONEY_WAN_DECIMALS = 1
export const MONEY_LARGE_DECIMALS = 2
export const MONEY_M_THRESHOLD = 1_000_000
export const MONEY_B_THRESHOLD = 1_000_000_000
export const MONEY_M_DECIMALS = 1
export const MONEY_B_DECIMALS = 2

export const MONEY_UNIT = '信用点'

export type MoneyLang = 'zh' | 'en'

function unitWordOf(lang: MoneyLang, amount: number): string {
  if (lang === 'en') return Math.abs(amount) === 1 ? 'credit' : 'credits'
  return MONEY_UNIT
}

export function moneyExact(amount: number): string {
  if (!Number.isFinite(amount)) return '0'
  return ceilFinalQuantity(amount).toLocaleString('zh-CN')
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function formatScaled(scaled: number, decimals: number): string {
  const s = trimZeros(scaled.toFixed(decimals))
  const [intPart, frac] = s.split('.')
  const grouped = Number(intPart).toLocaleString('zh-CN')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

export function moneyAmount(amount: number, lang: MoneyLang = 'zh'): string {
  if (!Number.isFinite(amount)) return '0'
  amount = ceilFinalQuantity(amount)
  const neg = amount < 0
  const abs = Math.abs(amount)
  const sign = neg ? '-' : ''
  const mid = lang === 'en' ? MONEY_M_THRESHOLD : MONEY_WAN_THRESHOLD
  const top = lang === 'en' ? MONEY_B_THRESHOLD : MONEY_YI_THRESHOLD
  const midWord = lang === 'en' ? 'M' : '万'
  const topWord = lang === 'en' ? 'B' : '亿'
  const midDec = lang === 'en' ? MONEY_M_DECIMALS : MONEY_WAN_DECIMALS
  const topDec = lang === 'en' ? MONEY_B_DECIMALS : MONEY_LARGE_DECIMALS
  if (abs < mid) return `${sign}${abs.toLocaleString('zh-CN')}`
  if (abs < top) return `${sign}${formatScaled(abs / mid, midDec)} ${midWord}`
  return `${sign}${formatScaled(abs / top, topDec)} ${topWord}`
}

function scaledAt(amount: number, div: number, word: string, decimals: number): string {
  const neg = amount < 0
  const abs = Math.abs(amount)
  return `${neg ? '-' : ''}${formatScaled(abs / div, decimals)} ${word}`
}

export function moneyFormatCandidates(amount: number, withUnit = false, lang: MoneyLang = 'zh'): string[] {
  const safe = Number.isFinite(amount) ? ceilFinalQuantity(amount) : 0
  const abs = Math.abs(safe)
  const unit = withUnit ? ` ${unitWordOf(lang, safe)}` : ''
  const mid = lang === 'en' ? MONEY_M_THRESHOLD : MONEY_WAN_THRESHOLD
  const top = lang === 'en' ? MONEY_B_THRESHOLD : MONEY_YI_THRESHOLD
  const midWord = lang === 'en' ? 'M' : '万'
  const topWord = lang === 'en' ? 'B' : '亿'
  const midDec = lang === 'en' ? MONEY_M_DECIMALS : MONEY_WAN_DECIMALS
  const topDec = lang === 'en' ? MONEY_B_DECIMALS : MONEY_LARGE_DECIMALS
  const full = `${moneyExact(safe)}${unit}`
  const scaled: string[] = []
  if (abs >= top) {
    for (const d of [topDec, 1, 0]) scaled.push(`${scaledAt(safe, top, topWord, d)}${unit}`)
  }
  if (abs >= mid) {
    for (const d of [midDec, 0]) scaled.push(`${scaledAt(safe, mid, midWord, d)}${unit}`)
  }
  const uniq = [...new Set(scaled)].filter((s) => s !== full)
  uniq.sort((a, b) => b.length - a.length)
  return [full, ...uniq]
}

export function moneyFitCandidates(amount: number, lang: MoneyLang = 'zh'): string[] {
  const withUnit = moneyFormatCandidates(amount, true, lang)
  const noUnit = moneyFormatCandidates(amount, false, lang)
  const out = [withUnit[0]!, noUnit[0]!, ...withUnit.slice(1), ...noUnit.slice(1)]
  return [...new Set(out)]
}

export function moneyFullCandidates(amount: number, lang: MoneyLang = 'zh'): string[] {
  const safe = Number.isFinite(amount) ? ceilFinalQuantity(amount) : 0
  const withUnit = `${moneyExact(safe)} ${unitWordOf(lang, safe)}`
  const noUnit = moneyExact(safe)
  return withUnit === noUnit ? [withUnit] : [withUnit, noUnit]
}

export function moneyText(amount: number, lang: MoneyLang = 'zh'): string {
  return `${moneyAmount(amount, lang)} ${unitWordOf(lang, ceilFinalQuantity(amount))}`
}

export function moneyExactText(amount: number, lang: MoneyLang = 'zh'): string {
  return `${moneyExact(amount)} ${unitWordOf(lang, ceilFinalQuantity(amount))}`
}

export function moneyDelta(amount: number, lang: MoneyLang = 'zh'): string {
  amount = ceilFinalQuantity(amount)
  const sign = amount >= 0 ? '+' : '−'
  return `${sign}${moneyAmount(Math.abs(amount), lang)}`
}
