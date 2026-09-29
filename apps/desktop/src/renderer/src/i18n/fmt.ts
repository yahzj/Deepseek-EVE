/**
 * 数字与单位格式化（按当前语言）· P1 骨架 · 2026-09-19。
 *
 * 现状说明：中文侧 `toLocaleString('zh-CN')` 与 `en-US` 的千分位/小数点**完全一致**（`,` / `.`），
 * 差别只在**单位词**（信用点 ↔ credits）以及将来的其它语言 ⇒ 本模块先收「单位词 + 千分位」两件事。
 * ⚠ 353 处内联 `toLocaleString('zh-CN')` 的替换随 **P3 界面批**逐文件做（机械改动，避免大范围误伤）。
 */
import { formatDurationMs, formatDurationShort } from '@whale/core'
import { isEn } from './locale'

/** 数字/日期用的 BCP-47 标签 */
export function localeTag(): string {
  return isEn() ? 'en-US' : 'zh-CN'
}

/** 整数（四舍五入 + 千分位） */
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(localeTag())
}

/** 定点小数（缺省 2 位） */
export function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString(localeTag(), { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 信用点单位词（英文单复数有别；中文恒「信用点」） */
// l10n-keep：本函数就是**按语言自取**的本地化实现（zh 分支返回「信用点」），不是漏译
export function creditUnit(n: number): string {
  return isEn() ? (Math.abs(n) === 1 ? 'credit' : 'credits') : '信用点'
}

/** 「1,234 信用点」/「1,234 credits」 */
export function fmtCredits(n: number): string {
  return `${fmtInt(n)} ${creditUnit(n)}`
}

/**
 * **时长（按当前语言）**——`2026-09-29 船长令`（英文界面残留中文清理 · 甲案）。
 *
 * 背景：core 的 `formatDurationMs` / `formatDurationShort` 原先**写死中文单位**，渲染层 15 个文件
 * 在调它 ⇒ 英文界面下凡是"X分Y秒"都夹中文（英文扫描读数里直接可见 ≈15 处，且会跟着句模板
 * 变成半译句——例：`about 12分34秒 left`）。现在 core 那两支**加可选语言参数**（缺省中文 ⇒
 * 既有调用零变化），渲染层统一从本模块走，**渲染层不再直接调 core 那两支**。
 *
 * ⚠ 新增调用点照抄这里：`fmtDuration` / `fmtDurationShort`（别再从 `@whale/core` 直接取）。
 */
export function fmtDuration(ms: number): string {
  return formatDurationMs(ms, isEn() ? 'en' : 'zh')
}

/** 紧凑时长（窄格：活动栏徽标 / 倒计时两行以内）—— 同上，按当前语言。 */
export function fmtDurationShort(ms: number): string {
  return formatDurationShort(ms, isEn() ? 'en' : 'zh')
}

/**
 * **日期（按当前语言）**：`2026-09-29`（zh-CN）/ `9/29/2026`（en-US）。
 * ⚠ 替换写死的 `toLocaleDateString('zh-CN')`（英文界面下它会给出中文顺序的日期）。
 */
export function fmtDate(wallMs: number): string {
  return new Date(wallMs).toLocaleDateString(localeTag())
}

/** **日期 + 时间（按当前语言）**：中文 `2026/9/29 13:05:00` · 英文 `9/29/2026, 1:05:00 PM`。 */
export function fmtDateTime(wallMs: number): string {
  return new Date(wallMs).toLocaleString(localeTag())
}
