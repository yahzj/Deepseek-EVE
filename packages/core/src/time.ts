/**
 * 时间显示工具（独立文件，避免模块循环依赖）。
 */
/** 把毫秒时长格式化成中文（例如 2 天 3 小时 4 分 5 秒）。零值单位省略；不足 1 秒显示 "0 秒"。 */
export function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`)
  return parts.join('')
}

/**
 * **紧凑时长**（窄格用：活动栏的限时加成 / 限时活动徽标）——只保留**两级最大单位**：
 * `4天21小时5分3秒` → **`4天21小时`** · `1小时2分1秒` → `1小时2分` · `1天0小时3分` → `1天3分` ·
 * `45秒` → `45秒` · `0` → `0秒`。
 *
 * 为什么单开一个：徽标格子窄（`formatDurationMs` 的全量格式在 4 天档要 10 个汉字 ≈ 105px，
 * 会把标题挤到省略号——2026-09-16 船长实测「虫洞大量生成6个字显示不完全」就是这么来的）；
 * 另外"秒"那一级每拍都在变，只显示两级还能让时间列的宽度基本稳定（不推挤标题）。
 * 悬停 tip 里仍用全量 `formatDurationMs`。
 */
export function formatDurationShort(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(totalSec / 86400)
  const hours = Math.floor((totalSec % 86400) / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`)
  return parts.slice(0, 2).join('')
}
