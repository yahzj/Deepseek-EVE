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

/**
 * 按指定**小数位**格式化一个"缩放后"的显示档（供 {@link moneyFormatCandidates} 逐级降级用）。
 * ⚠ 与 {@link moneyAmount} 的区别：**能给出 0 位小数**的版本（`1 亿` / `12 亿`）——
 * 固定档位不需要它，但"尽可能长地显示"需要（少一位小数往往就能多装下一位有效数字）。
 */
function scaledAt(amount: number, unit: '万' | '亿', decimals: number): string {
  const neg = amount < 0
  const abs = Math.abs(amount)
  const div = unit === '万' ? MONEY_WAN_THRESHOLD : MONEY_YI_THRESHOLD
  return `${neg ? '-' : ''}${formatScaled(abs / div, decimals)} ${unit}`
}

/**
 * **金额的显示候选序列**（**单一变体**：全部带单位或全不带；"该显全额还是该缩写"见 {@link moneyFitCandidates}）。
 *
 * 从**最完整**到**最简短**排好，调用方按可用宽度**从头挑第一个装得下的**：
 * 1. **全额**（`1,234,567,890`，千分位全写，一位不省）；
 * 2. 缩写档：`亿`（2 / 1 / 0 位小数）与 `万`（1 / 0 位小数），**按实际字数从长到短排**
 *    ——⚠ 这条是实测抓出来的：`万` 档并不总比 `亿` 档短（`123,456.8 万` 比 `12 亿` 长得多），
 *    硬按"先亿后万"排会破坏"逐级变短"，调用方的"第一个装得下"就不再等于"最长的那个"。
 * 负数按其绝对值同序（符号占一位）。
 *
 * ⚠ **不设"再往下缩"的兜底档**（2026-09-13 实测抓出来的）：曾经补过一条最短档，结果
 * `582,902` 会降到 `0 亿` —— **那是撒谎**（看着像没钱）。序列到此为止；真遇到"连最短档都装不下"
 * 的极端宽度，交给容器的 `text-overflow: ellipsis` 截断（**宁可截断，也不显示一个错的数**）。
 *
 * @param withUnit 是否带「信用点」后缀（窄容器里通常先试带单位、装不下再试不带）
 */
export function moneyFormatCandidates(amount: number, withUnit = false): string[] {
  const safe = Number.isFinite(amount) ? amount : 0
  const abs = Math.abs(safe)
  const unit = withUnit ? ` ${MONEY_UNIT}` : ''
  // ① 全额（永远排第一：**能显全额就显全额**）
  const full = `${moneyExact(safe)}${unit}`
  const scaled: string[] = []
  if (abs >= MONEY_YI_THRESHOLD) {
    for (const d of [MONEY_LARGE_DECIMALS, 1, 0]) scaled.push(`${scaledAt(safe, '亿', d)}${unit}`)
  }
  if (abs >= MONEY_WAN_THRESHOLD) {
    for (const d of [MONEY_WAN_DECIMALS, 0]) scaled.push(`${scaledAt(safe, '万', d)}${unit}`)
  }
  // ② 缩写档：去重后按字数**从长到短**（同长保留原序，亿在前——量级更大、读起来更"整"）
  const uniq = [...new Set(scaled)].filter((s) => s !== full)
  uniq.sort((a, b) => b.length - a.length)
  return [full, ...uniq]
}

/**
 * **给"宽度自适应显示"用的最终候选序列**（`ui/MoneyFit` 的输入；★ **档位优先**，不是纯长度排序）。
 *
 * 档位（船长 2026-09-13：「**如果有条件，还是优先显示全额数字**。可以考虑调整字间距宽。
 * 如果实在显示不下，采用数量级缩写（**但是仍要尽可能保证数字够长**）」）：
 * 1. **全额档**：千分位全写、一位不省 —— 先带「信用点」，装不下就**只去掉单位**（数字一位不少）；
 * 2. **缩写档**：同样先带单位、再去单位，档内按字数从长到短（见 {@link moneyFormatCandidates}）。
 *
 * ⚠ 为什么"档位"压过"长度"：`1,234,567,890`（不带单位）其实比 `12.35 亿 信用点` 还**短一点点**，
 * 但要按长度排，宽度稍紧就会被判成"缩写更合适"——那是把船长的口径读反了：
 * 他要的是「**能显全额就显全额**」。单位本身由卡片色调与 `title`（"钱包余额：… 信用点"）兜住，
 * 多出来的 4 位有效数字比重复一遍单位名值钱。**若要改成"单位优先"，只需把两档对调。**
 *
 * @param amount 金额（`NaN`/`Infinity` 走 0 兜底）
 */
export function moneyFitCandidates(amount: number): string[] {
  const withUnit = moneyFormatCandidates(amount, true)
  const noUnit = moneyFormatCandidates(amount, false)
  // 全额带单位 → 全额不带 → 缩写带单位 → 缩写不带（各自已是"从长到短"）
  const out = [withUnit[0]!, noUnit[0]!, ...withUnit.slice(1), ...noUnit.slice(1)]
  return [...new Set(out)] // 去重：金额小时两档可能完全重合
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
