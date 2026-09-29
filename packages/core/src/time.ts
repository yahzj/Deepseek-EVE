/**
 * 时间显示工具（独立文件，避免模块循环依赖）。
 *
 * ⚠ **本模块是双语口径的"单点"**（**2026-09-29 船长令**：英文界面残留中文清理 · 甲案）：
 * 时长单位词只在这里拼装，`lang` 可选、**缺省 `'zh'`** ⇒ core 侧原有调用**逐字不变**；
 * 渲染层要英文时走 `i18n/fmt.ts` 的 `fmtDuration` / `fmtDurationShort`（同一把尺的封装）。
 *
 * 为什么不让 core 直接读"当前语言"：core 不依赖渲染层状态（分层边界，见 `arch-guard` F1/F4）
 * ⇒ 语言**当参数传**，core 保持纯函数。
 */

/** 时长单位词表（要加语言时按同一形状补一列即可） */
const UNITS = {
  zh: { day: '天', hour: '小时', minute: '分', second: '秒' },
  /**
   * 英文侧按"紧跟数字"的写法给（`2d 3h 4m 5s`）：与 `ui.*` 那些 `about {d} left` 的句模板拼起来
   * 才读得通（例：`about 2d 3h left`）。**不做单复数变化** —— 时长读数没有 `1 hours` 之外的坑，
   * 且中文侧本来就是无变化单位词，两侧形状一致更不容易漂。
   */
  en: { day: 'd', hour: 'h', minute: 'm', second: 's' },
} as const

/** 支持的语言（与 `i18n/locale.tsx` 的 `Locale` 同集合；此处独立声明避免 core → 渲染层依赖） */
export type DurationLang = 'zh' | 'en'

/** 各语言的分隔：中文连写（`4天21小时`），英文空格（`4d 21h`） */
const JOIN: Record<DurationLang, string> = { zh: '', en: ' ' }

/** 把毫秒时长格式化成中文（例如 2 天 3 小时 4 分 5 秒）。零值单位省略；不足 1 秒显示 "0 秒"。 */
export function formatDurationMs(ms: number, lang: DurationLang = 'zh'): string {
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
  return parts.join(JOIN[lang])
}

/**
 * **紧凑时长**（窄格用：活动栏的限时加成 / 限时活动徽标）——只保留**两级最大单位**：
 * `4天21小时5分3秒` → **`4天21小时`** · `1小时2分1秒` → `1小时2分` · `1天0小时3分` → `1天3分` ·
 * `45秒` → `45秒` · `0` → `0秒`（英文：`4d 21h` / `1h 2m` / `1d 3m` / `45s` / `0s`）。
 *
 * 为什么单开一个：徽标格子窄（`formatDurationMs` 的全量格式在 4 天档要 10 个汉字 ≈ 105px，
 * 会把标题挤到省略号——2026-09-16 船长实测「虫洞大量生成6个字显示不完全」就是这么来的）；
 * 另外"秒"那一级每拍都在变，只显示两级还能让时间列的宽度基本稳定（不推挤标题）。
 * 悬停 tip 里仍用全量 `formatDurationMs`。
 */
export function formatDurationShort(ms: number, lang: DurationLang = 'zh'): string {
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
  return parts.slice(0, 2).join(JOIN[lang])
}
