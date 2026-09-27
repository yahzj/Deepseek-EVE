/**
 * **贵重品货柜占比按层下调**（**2026-09-27 船长令**）
 *
 * 船长原话（照抄）：「**我是想下调 WORMHOLE_RELIC_VALUABLES_SHARE 的比例，7层之后
 * WORMHOLE_RELIC_VALUABLES_SHARE 比例下降到0.25**」。
 *
 * 口径：**浅层（层 ≤ 7）= 0.5**（原值一字未动）· **深层（层 ≥ 8）= 0.25**；
 * 取数唯一入口 `wormholeRelicValuablesShareOf(depth)`（掷骰处已改走它，不再直接读常量）。
 */
import { describe, expect, it } from 'vitest'
import {
  WORMHOLE_RELIC_VALUABLES_CUT_DEPTH,
  WORMHOLE_RELIC_VALUABLES_SHARE,
  WORMHOLE_RELIC_VALUABLES_SHARE_DEEP,
  wormholeRelicValuablesShareOf,
} from '../src/wormholeSalvage'

describe('遗迹掉落的贵重品货柜占比（2026-09-27 船长令）', () => {
  it('浅层 0.5 · 深层 0.25 · 分界层 8（"7 层之后"）', () => {
    expect(WORMHOLE_RELIC_VALUABLES_SHARE, '浅层原值').toBe(0.5)
    expect(WORMHOLE_RELIC_VALUABLES_SHARE_DEEP, '深层新值').toBe(0.25)
    expect(WORMHOLE_RELIC_VALUABLES_CUT_DEPTH, '分界层 = 8').toBe(8)
  })

  it('取数单点：层 1~7 一律 0.5、层 8 起 0.25（含取整与下限）', () => {
    for (const d of [1, 2, 3, 4, 5, 6, 7]) {
      expect(wormholeRelicValuablesShareOf(d), `层 ${d}`).toBe(0.5)
    }
    for (const d of [8, 9, 10]) {
      expect(wormholeRelicValuablesShareOf(d), `层 ${d}`).toBe(0.25)
    }
    expect(wormholeRelicValuablesShareOf(0), '非法层按下限 1 算').toBe(0.5)
    expect(wormholeRelicValuablesShareOf(7.9), '小数向下取整').toBe(0.5)
  })
})
