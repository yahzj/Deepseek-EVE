/**
 * **金额显示单点**（2026-09-13 船长：「更换金钱单位为**信用点**」＋「希望考虑到**钱位数过多**时的处理」）。
 *
 * 为什么放在 core 而不是渲染层：**它是"金额怎么显示"的唯一出处**，且必须带用例
 * （desktop 包没有测试运行器 ⇒ 放渲染层就等于没有回归门禁，§3 要求"改行为必须同步改/加测试"）。
 *
 * 两件事一起办：
 * ① **单位 = 信用点**：玩家可见文案一律用它；**引擎内部字段仍叫 `isk`**
 *    （船长选定「乙」——字段名是内部标识符、玩家不可见，全局改名要动 1833 行 + 存档迁移，收益为零）；
 * ② **位数分级**：{@link MONEY_WAN_THRESHOLD} 以下照旧千分位全写（**小数位一个不丢**）；
 *    到万位起改用「万」，到亿位起改用「亿」并保留小数。
 *    ⚠ **精确值不能丢**：用它的位置都把全精度值放进 `title`（全站 `title` 走自绘提示层），
 *    玩家悬停即见「1,234,567,890 信用点」——分级只是**首屏读得快**，不是**信息变少**。
 */

/** 到这一档（含）起改用「万」 */
export const MONEY_WAN_THRESHOLD = 10_000
/** 到这一档（含）起改用「亿」 */
export const MONEY_YI_THRESHOLD = 100_000_000
/** 「万」档保留的小数位 */
export const MONEY_WAN_DECIMALS = 1
/** 「亿」档保留的小数位 */
export const MONEY_LARGE_DECIMALS = 2

/** 单位名（玩家可见文案的唯一出处；要改单位只改这里） */
export const MONEY_UNIT = '信用点'

/** 千分位（全精度；不带单位） */
export function moneyExact(amount: number): string {
  if (!Number.isFinite(amount)) return '0'
  return Math.round(amount).toLocaleString('zh-CN')
}

/** 去掉小数尾零（`1.20` → `1.2`；`2.00` → `2`） */
function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/**
 * **按同一把尺格式化分级结果**：整数部分照样千分位（与"万以下全写"一致 —— 玩家不该在
 * `1,200 万` 与 `1200 万` 之间看到两种写法），小数部分去尾零。
 */
function formatScaled(scaled: number, decimals: number): string {
  const s = trimZeros(scaled.toFixed(decimals))
  const [intPart, frac] = s.split('.')
  const grouped = Number(intPart).toLocaleString('zh-CN')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}

/**
 * **金额主体**（不含单位）：分级显示，便于一眼读数。
 * - `< 1 万`：千分位全写（`1,234`）
 * - `≥ 1 万`：`1.2 万`（1 位小数）
 * - `≥ 1 亿`：`1.23 亿`（2 位小数）
 * - 负数按其绝对值分级（`-1.2 万`）
 */
export function moneyAmount(amount: number): string {
  if (!Number.isFinite(amount)) return '0'
  const neg = amount < 0
  const abs = Math.abs(amount)
  const sign = neg ? '-' : ''
  if (abs < MONEY_WAN_THRESHOLD) return `${sign}${Math.round(abs).toLocaleString('zh-CN')}`
  if (abs < MONEY_YI_THRESHOLD) {
    return `${sign}${formatScaled(abs / MONEY_WAN_THRESHOLD, MONEY_WAN_DECIMALS)} 万`
  }
  return `${sign}${formatScaled(abs / MONEY_YI_THRESHOLD, MONEY_LARGE_DECIMALS)} 亿`
}

/** **金额 + 单位**（玩家可见文案的统一写法；例：`1.2 万 信用点`） */
export function moneyText(amount: number): string {
  return `${moneyAmount(amount)} ${MONEY_UNIT}`
}

/**
 * **精确值提示**（悬停用；例：`1,234,567 信用点`）——分级显示时把全精度值挂进 `title`，
 * 保证"看得快"与"查得到"同时成立。
 */
export function moneyExactText(amount: number): string {
  return `${moneyExact(amount)} ${MONEY_UNIT}`
}

/**
 * **净额写法**（涨跌/收支）：正数带 `+`、负数带 `−`（U+2212，与全站既有写法一致）。
 * 分级口径与 {@link moneyAmount} 同源。
 */
export function moneyDelta(amount: number): string {
  const sign = amount >= 0 ? '+' : '−'
  return `${sign}${moneyAmount(Math.abs(amount))}`
}
