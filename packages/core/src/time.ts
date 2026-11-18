
const UNITS = {
  zh: { day: '天', hour: '小时', minute: '分', second: '秒' },
  en: { day: 'd', hour: 'h', minute: 'm', second: 's' },
} as const

export type DurationLang = 'zh' | 'en'

const JOIN: Record<DurationLang, string> = { zh: '', en: ' ' }

function durationParts(ms: number, lang: DurationLang): string[] {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const u = UNITS[lang]
  const parts: string[] = []
  if (days > 0) parts.push(`${days}${u.day}`)
  if (hours > 0) parts.push(`${hours}${u.hour}`)
  if (minutes > 0) parts.push(`${minutes}${u.minute}`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}${u.second}`)
  return parts
}

export function formatDurationMs(ms: number, lang: DurationLang = 'zh'): string {
  return durationParts(ms, lang).join(JOIN[lang])
}

export function formatDurationShort(ms: number, lang: DurationLang = 'zh'): string {
  return durationParts(ms, lang).slice(0, 2).join(JOIN[lang])
}
