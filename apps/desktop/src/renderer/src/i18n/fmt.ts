import { ceilFinalQuantity, formatDurationMs, formatDurationShort } from '@whale/core'
import { isEn } from './locale'

export function localeTag(): string {
  return isEn() ? 'en-US' : 'zh-CN'
}

export function fmtInt(n: number): string {
  return ceilFinalQuantity(n).toLocaleString(localeTag())
}

export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString(localeTag(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function creditUnit(n: number): string {
  return isEn() ? (Math.abs(n) === 1 ? 'credit' : 'credits') : '信用点'
}

export function fmtCredits(n: number): string {
  const quantity = ceilFinalQuantity(n)
  return `${fmtInt(quantity)} ${creditUnit(quantity)}`
}

export function fmtDuration(ms: number): string {
  return formatDurationMs(ms, isEn() ? 'en' : 'zh')
}

export function fmtDurationShort(ms: number): string {
  return formatDurationShort(ms, isEn() ? 'en' : 'zh')
}

export function fmtDate(wallMs: number): string {
  return new Date(wallMs).toLocaleDateString(localeTag())
}


export function fmtSideClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function fmtDayClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
