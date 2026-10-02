/**
 * **族循环锚点归位**（**2026-10-02 · 一号 · 船长令「按你推荐来」**）。
 *
 * 背景（上一批报告里挂着的第 ② 件）：`WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS` 的值是**手抄的毫秒数**
 * `1_790_971_200_000`，实测 = **2026-10-03 04:00 本地**，比它自己的注释（2026-10-02 20:00 本地）
 * **晚 8 小时**。`weekendPeriodIndexOf` 里 `Math.max(0, floor(…)` 把负数夹成 0 ⇒
 * 本期（10-02 20:00）照样算成第 0 期（**表面无异常**），但
 *
 * - **10-09 那期**（`floor(160h / 168h)`）**仍是第 0 期** ⇒ 注释写"= 墨潮帮"，实际**又出光环**；
 * - `WEEKEND_FAMILY_OVERRIDE`（只为本期设的 `periodIndex: 0`、族 = R）**跟着粘到 10-09**；
 * - 10-16 起才进第 1 期 ⇒ **整个族循环整整错一期**（玩家连着两期光环）。
 *
 * 修法 = **按本地时间组件算**（`new Date(2026, 9, 2, 20, 0, 0, 0)`，与 `weekendT0Of` 的
 * "本地周五 20:00"同一把尺）：锚点 = 本期 T0 ⇒ 期号 0/1/2… 逐期 +1。
 *
 * 本文件钉五件事（③④⑤ 在旧值下会红，就是这次报障的那几条）：
 * ① 锚点 = 本地 2026-10-02 20:00（按本地组件断，不写死毫秒）；
 * ② 锚点就是**本期窗口 T0**（`weekendT0Of(锚点) === 锚点`）；
 * ③ 连续四期逐期 +1（10-02 / 10-09 / 10-16 / 10-23 ⇒ 0 / 1 / 2 / 3，**不再被夹成 0**）；
 * ④ 连续四期的族 = R / H / R / H（10-09 不再是光环）；
 * ⑤ 特意设置只作用于那一期：10-02 = 指定的 R，**10-09 回到循环第 1 位 H**（旧值下被粘成 R）。
 */
import { describe, expect, it } from 'vitest'
import {
  WEEKEND_FAMILY_OVERRIDE,
  WEEKEND_FAMILY_ROTATION,
  WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS,
  weekendFamilyForWindow,
  weekendPeriodIndexOf,
  weekendT0Of,
} from '../src/weekendEvent'

const WEEK = 7 * 24 * 3_600_000
/** 本期 T0（本地 2026-10-02 20:00）——与锚点同源，但**这里自己按本地组件算**（不引用被测常量） */
const T0_THIS = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()
/** 第 n 期的 T0（本期 = n 0） */
const t0Of = (n: number): number => T0_THIS + n * WEEK

describe('族循环锚点：按本地墙钟算（2026-10-02 修）', () => {
  it('① 锚点 = 本地 2026-10-02 20:00（不是 04:00，也不是任何手抄毫秒）', () => {
    const d = new Date(WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS)
    expect([d.getFullYear(), d.getMonth(), d.getDate()], '日期 = 2026-10-02').toEqual([2026, 9, 2])
    expect([d.getHours(), d.getMinutes()], '时刻 = 20:00（旧值这里是 04:00）').toEqual([20, 0])
    expect(WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS, '与本地组件构造的那个时刻逐毫秒相等').toBe(T0_THIS)
    console.log(`  [读数] 锚点 = ${d.toLocaleString('sv-SE')}（旧值 1_790_971_200_000 = 2026-10-03 04:00）`)
  })

  it('② 锚点就是**本期窗口 T0**（周末窗口那套本地周五 20:00 的尺子量它 = 它自己）', () => {
    expect(weekendT0Of(WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS), '旧值下这一条会红（T0 是 10-02 20:00）').toBe(
      WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS,
    )
    expect(weekendT0Of(T0_THIS), '本期 T0 自洽').toBe(T0_THIS)
  })

  it('③ 期号逐期 +1（旧值下 10-02 与 10-09 都被夹成第 0 期）', () => {
    const idx = [0, 1, 2, 3].map((n) => weekendPeriodIndexOf(t0Of(n)))
    expect(idx, '0 / 1 / 2 / 3').toEqual([0, 1, 2, 3])
    expect(idx[1], '**第二期不再与第一期同号**（夹成 0 就是这次报障的根）').toBeGreaterThan(idx[0]!)
    console.log(`  [读数] 四期期号 = ${idx.join(' / ')}`)
  })

  it('④ 连续四期的族 = R / H / R / H（10-09 = 墨潮帮，不再连着出光环）', () => {
    const fams = [0, 1, 2, 3].map((n) => weekendFamilyForWindow(t0Of(n)))
    expect(fams, '本期 R（船长指定那期）').toEqual(['R', 'H', 'R', 'H'])
    expect(fams[0]).toBe(WEEKEND_FAMILY_ROTATION[0])
    expect(fams[1]).toBe(WEEKEND_FAMILY_ROTATION[1])
    console.log(`  [读数] 10-02 / 10-09 / 10-16 / 10-23 四期族 = ${fams.join(' / ')}`)
  })

  it('⑤ 特意设置只作用于那一期：10-02 = 指定 R，10-09 回落循环（H）', () => {
    expect(WEEKEND_FAMILY_OVERRIDE?.periodIndex, '指定的是第 0 期（本期）').toBe(0)
    expect(WEEKEND_FAMILY_OVERRIDE?.family).toBe('R')
    expect(weekendFamilyForWindow(t0Of(0)), '本期 = 指定值').toBe(WEEKEND_FAMILY_OVERRIDE!.family)
    expect(
      weekendFamilyForWindow(t0Of(1)),
      '**下一期不再被这份指定粘住**（旧值下它也是第 0 期 ⇒ 被粘成 R）',
    ).toBe(WEEKEND_FAMILY_ROTATION[1])
  })
})
