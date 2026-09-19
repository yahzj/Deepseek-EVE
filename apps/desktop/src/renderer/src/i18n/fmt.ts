/**
 * 数字与单位格式化（按当前语言）· P1 骨架 · 2026-09-19。
 *
 * 现状说明：中文侧 `toLocaleString('zh-CN')` 与 `en-US` 的千分位/小数点**完全一致**（`,` / `.`），
 * 差别只在**单位词**（信用点 ↔ credits）以及将来的其它语言 ⇒ 本模块先收「单位词 + 千分位」两件事。
 * ⚠ 353 处内联 `toLocaleString('zh-CN')` 的替换随 **P3 界面批**逐文件做（机械改动，避免大范围误伤）。
 */
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
export function creditUnit(n: number): string {
  return isEn() ? (Math.abs(n) === 1 ? 'credit' : 'credits') : '信用点'
}

/** 「1,234 信用点」/「1,234 credits」 */
export function fmtCredits(n: number): string {
  return `${fmtInt(n)} ${creditUnit(n)}`
}
