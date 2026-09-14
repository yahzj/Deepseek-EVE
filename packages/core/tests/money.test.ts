/**
 * **金额显示单点用例**（船长 2026-09-13：「更换金钱单位为**信用点**」＋
 * 「希望考虑到**钱位数过多**时的处理」）。
 *
 * 锁三件事：
 * ① **单位**只有一处出处（`MONEY_UNIT`）且是「信用点」；
 * ② **位数分级**的三档边界与四舍五入（`9999` 全写 / `10000` 起用万 / `1 亿` 起用亿）；
 * ③ **精确值不丢**：`moneyExactText` 永远给全精度（分级只是首屏读得快，不是信息变少）。
 */
import { describe, expect, it } from 'vitest'
import {
  MONEY_LARGE_DECIMALS,
  MONEY_UNIT,
  MONEY_WAN_DECIMALS,
  MONEY_WAN_THRESHOLD,
  MONEY_YI_THRESHOLD,
  moneyAmount,
  moneyDelta,
  moneyExactText,
  moneyFitCandidates,
  moneyFormatCandidates,
  moneyText,
} from '../src/money'

describe('金额显示（信用点 · 位数分级）', () => {
  it('**单位 = 信用点**（单一出处；要改单位只改 `MONEY_UNIT`）', () => {
    expect(MONEY_UNIT).toBe('信用点')
    expect(moneyText(1234)).toBe('1,234 信用点')
    expect(moneyText(1234)).not.toContain('ISK')
    expect(moneyExactText(1)).toBe('1 信用点')
  })

  it('**万以下全写千分位**（小数位一个不丢）', () => {
    expect(moneyAmount(0)).toBe('0')
    expect(moneyAmount(999)).toBe('999')
    expect(moneyAmount(9999)).toBe('9,999')
    // 边界：正好到万 ⇒ 换档
    expect(moneyAmount(MONEY_WAN_THRESHOLD)).toBe('1 万')
  })

  it('**万位起改「万」**（1 位小数、四舍五入、尾零去掉）', () => {
    expect(moneyAmount(10_000)).toBe('1 万')
    expect(moneyAmount(12_345)).toBe('1.2 万')
    expect(moneyAmount(99_999)).toBe('10 万')
    expect(moneyAmount(1_250_000)).toBe('125 万')
    expect(moneyAmount(12_000_000)).toBe('1,200 万')
    expect(MONEY_WAN_DECIMALS).toBe(1)
  })

  it('**亿位起改「亿」**（2 位小数；再大也不会把数字堆成墙）', () => {
    expect(moneyAmount(MONEY_YI_THRESHOLD)).toBe('1 亿')
    expect(moneyAmount(123_456_789)).toBe('1.23 亿')
    expect(moneyAmount(1_234_567_890)).toBe('12.35 亿')
    expect(moneyAmount(1_234_567_890).length).toBeLessThanOrEqual(8) // 「12.35 亿」= 7 字
    // 十万亿级（钱再多也压不住布局）：98,765.43 亿 —— **整数部分照样千分位**（与"万以下全写"同一把尺）
    expect(moneyAmount(9_876_543_210_000)).toBe('98,765.43 亿')
    expect(MONEY_LARGE_DECIMALS).toBe(2)
  })

  it('**负数按绝对值分级**（收/支两用）', () => {
    expect(moneyAmount(-1234)).toBe('-1,234')
    expect(moneyAmount(-12_345)).toBe('-1.2 万')
    expect(moneyAmount(-123_456_789)).toBe('-1.23 亿')
  })

  it('**净额写法**：正数 `+`、负数 `−`（U+2212，与全站既有写法一致）', () => {
    expect(moneyDelta(0)).toBe('+0')
    expect(moneyDelta(1234)).toBe('+1,234')
    expect(moneyDelta(-1234)).toBe('−1,234')
    expect(moneyDelta(-12_345)).toBe('−1.2 万')
  })

  it('**精确值永远可查**（分级缩写后 `moneyExactText` 仍给全精度）', () => {
    const big = 1_234_567_890
    expect(moneyAmount(big)).toBe('12.35 亿')
    expect(moneyExactText(big)).toBe('1,234,567,890 信用点')
    // 缩写值四舍五入后与精确值同量级（不是"换了个数"）
    expect(Math.abs(big - 12.35 * MONEY_YI_THRESHOLD)).toBeLessThan(0.01 * MONEY_YI_THRESHOLD)
  })

  it('坏值兜底：NaN / Infinity 一律显示 0（不出现 `NaN 信用点`）', () => {
    expect(moneyAmount(Number.NaN)).toBe('0')
    expect(moneyAmount(Number.POSITIVE_INFINITY)).toBe('0')
    expect(moneyExactText(Number.NaN)).toBe('0 信用点')
  })

  /**
   * **宽度自适应的候选序列**（船长 2026-09-13 二次口径：「**如果有条件，还是优先显示全额数字**…
   * 如果实在显示不下，采用数量级缩写（**但是仍要尽可能保证数字够长**）」）。
   * 调用方（`ui/MoneyFit`）按容器实宽**从头挑第一个装得下的** ⇒ 序列必须是**从长到短**的有序表，
   * 「第一个装得下」才恒等于「装得下的最长写法」。
   */
  it('**候选序列：全额优先**（第一位永远是千分位全写）', () => {
    const c = moneyFormatCandidates(1_234_567)
    expect(c[0]).toBe('1,234,567')
    expect(c[0]).not.toContain('万')
    expect(c[0]).not.toContain('亿')
  })

  it('**候选序列：缩写档按字数从长到短**（同单位内只减小数、不缩有效数字）', () => {
    const c = moneyFormatCandidates(123_456_789)
    // 第一位永远是全额
    expect(c[0]).toBe('123,456,789')
    // ⚠ 实测抓出来的：`万` 档并不总比 `亿` 档短 ⇒ 缩写档按**实际字数**排，`12,345.7 万` 排在 `亿` 档之前
    expect(c[1]).toBe('12,345.7 万')
    // 同一单位内一路减小数位（2 → 1 → 0），有效数字一位不丢
    expect(c).toEqual(
      expect.arrayContaining(['12,346 万', '1.23 亿', '1.2 亿', '1 亿']),
    )
    // 序列**单调不增**（后面的候选绝不会比前面更长）⇒ 调用方"第一个装得下"就恒等于"最长的那个"
    const lens = c.map((s) => s.length)
    for (let i = 1; i < lens.length; i++) expect(lens[i]!).toBeLessThanOrEqual(lens[i - 1]!)
    // 最短档 = 亿的 0 位小数（仍带量级，不是 0）
    expect(c[c.length - 1]).toBe('1 亿')
  })

  it('**不设"再往下缩"的兜底档**（582,902 不许降到撒谎的「0 亿」）', () => {
    const c = moneyFormatCandidates(582_902)
    expect(c).toEqual(['582,902', '58.3 万', '58 万'])
    // 量级没到亿就不许出现「亿」字样（曾经的兜底档会让它显示成「0 亿」）
    expect(c.some((s) => s.includes('亿'))).toBe(false)
  })

  it('**带单位 / 不带单位两套**（窄容器先试带「信用点」、装不下再试不带）', () => {
    expect(moneyFormatCandidates(1234, true)[0]).toBe('1,234 信用点')
    expect(moneyFormatCandidates(1234, false)[0]).toBe('1,234')
    expect(moneyFormatCandidates(1_234_567_890, true).some((s) => s.endsWith('信用点'))).toBe(true)
  })

  it('**小钱只有全额一项**（1 万以下不该出现「万」这种缩写）', () => {
    const c = moneyFormatCandidates(9_999)
    expect(c[0]).toBe('9,999')
    expect(c.every((s) => !s.includes('万') && !s.includes('亿'))).toBe(true)
  })

  it('候选序列无重复、且恒非空（去重后仍能装下最小宽度）', () => {
    for (const v of [0, 1, 9_999, 12_000_000, 1_234_567_890, 9_876_543_210_000]) {
      const c = moneyFormatCandidates(v)
      expect(c.length).toBeGreaterThan(0)
      expect(new Set(c).size).toBe(c.length)
      expect(c.every((s) => s.length > 0)).toBe(true)
    }
  })

  /**
   * **金钱栏的实际输入**（`ui/MoneyFit` 用）：★ **档位优先**，不是纯长度排序 ——
   * 船长要的是「能显全额就显全额」，所以**全额档整体排在缩写档之前**，
   * 且**"单位"是第一个可以让位的东西**（`1,234,567,890` 优于 `12.35 亿 信用点`）。
   */
  it('**档序：全额（带单位 → 去单位）→ 缩写（带单位 → 去单位）**', () => {
    const c = moneyFitCandidates(1_234_567_890)
    expect(c[0]).toBe('1,234,567,890 信用点')
    // 装不下就**只去掉单位**，数字一位不少 —— 而不是直接跳缩写
    expect(c[1]).toBe('1,234,567,890')
    expect(c[2]).toBe('123,456.8 万 信用点')
    // 缩写不带单位排在所有带单位的缩写之后
    const firstNoUnitAbbrev = c.findIndex((s) => !s.endsWith('信用点') && s !== c[1])
    const lastWithUnitAbbrev = c.map((s) => s.endsWith('信用点')).lastIndexOf(true)
    expect(firstNoUnitAbbrev).toBeGreaterThan(lastWithUnitAbbrev)
    // 合法值一位不丢：全额档的两种写法都在，且最短档仍带量级
    expect(c).toContain('1,234,567,890')
    expect(c[c.length - 1]).toBe('12 亿')
  })

  it('**档序：金额小的时候不重复**（两档重合只留一份）', () => {
    expect(moneyFitCandidates(1234)).toEqual(['1,234 信用点', '1,234'])
    expect(moneyFitCandidates(0)).toEqual(['0 信用点', '0'])
    // 带单位 / 不带单位的两套本身不重复
    for (const v of [0, 9_999, 582_902, 9_876_543_210_000]) {
      const c = moneyFitCandidates(v)
      expect(new Set(c).size).toBe(c.length)
      expect(c.every((s) => s.length > 0)).toBe(true)
    }
  })
})
