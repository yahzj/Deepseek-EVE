/**
 * **快递任务板周期口径**（**2026-09-24 船长令**：「**快递任务的周期和持续时间都为 120 分钟，资源任务不变**」
 * ＋同日「每批条数不动」）。
 *
 * 本文件先钉住"周期/该不该重掷"这条纯口径（下一步才把它接进 `refreshBoard` 的按窗分支）：
 * ① 周期常量就是 **120 分钟**（防止以后被谁改回跟市场寿命跑）；
 * ② 只有**窗界是 120 分钟整数倍**的那一窗才重掷快递；资源任务仍每 20 分钟一窗；
 * ③ 未开盘（窗界 0）不算到点。
 */
import { describe, expect, it } from 'vitest'
import { COURIER_BOARD_PERIOD_MS, courierDeadlineMs, courierDueAtWindow } from '../src/sideTasks'

const MIN = 60_000

describe('快递任务板：周期 120 分钟（资源任务不变）', () => {
  it('① 周期常量 = 120 分钟', () => {
    expect(COURIER_BOARD_PERIOD_MS).toBe(120 * MIN)
  })

  it('② 只有 120 分钟的整数倍窗界才重掷（20 分钟一窗，每第 6 窗一次）', () => {
    expect(courierDueAtWindow(120 * MIN)).toBe(true)
    expect(courierDueAtWindow(240 * MIN)).toBe(true)
    // 中间那 5 个窗不重掷（资源任务照常换）
    for (const k of [1, 2, 3, 4, 5]) expect(courierDueAtWindow(k * 20 * MIN)).toBe(false)
    expect(courierDueAtWindow(6 * 20 * MIN)).toBe(true) // 第 6 窗 = 120 分钟
  })

  it('③ 未开盘（窗界 0）与非法值都不算到点', () => {
    expect(courierDueAtWindow(0)).toBe(false)
    expect(courierDueAtWindow(-1)).toBe(false)
    expect(courierDueAtWindow(Number.NaN)).toBe(false)
  })

  /**
   * **到期时刻**（`courierDeadlineMs`）——2026-09-24 船长报障「卡片上和快递任务页面写的还是 20 分钟」
   * 的**根因那一半**：出发护栏原先按资源那 20 分钟判 ⇒ 抽到手超过 20 分钟的单子被判"已到期"拒发。
   */
  it('④ 到期时刻 = 下一个 120 分钟整点（整点窗 +120；非整点窗取其后第一个整点）', () => {
    expect(courierDeadlineMs(120 * MIN)).toBe(240 * MIN) // 本批在 120 分钟整点刷出 ⇒ 到 240 分钟整点换
    expect(courierDeadlineMs(240 * MIN)).toBe(360 * MIN)
    // 首个批次随下一个 20 分钟窗补种（窗界非整点）⇒ 到期取其后第一个 120 分钟整点
    expect(courierDeadlineMs(20 * MIN)).toBe(120 * MIN)
    expect(courierDeadlineMs(100 * MIN)).toBe(120 * MIN)
    // 未开盘/非法值 ⇒ 一个完整周期（此时板上没有快递，仅作展示兜底）
    expect(courierDeadlineMs(0)).toBe(120 * MIN)
    expect(courierDeadlineMs(Number.NaN)).toBe(120 * MIN)
  })
})
