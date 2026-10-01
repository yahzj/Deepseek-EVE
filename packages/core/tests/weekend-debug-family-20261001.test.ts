/**
 * **本地调试模式必出 R 族（光环）入侵**（**船长 2026-10-01 令**，原话照抄）：
 *
 * > 「**感觉可以上线实时，先让本地调试模式必定出新的R族入侵，我进行本地测试**」
 *
 * 口径（实现见 `weekendEvent.weekendLockedFamilyOf` 的头注）：
 * - **调试档**（`state.debugQuick === true`）⇒ 开局面一律判为 **R 族**（`WEEKEND_DEBUG_FAMILY`），
 *   与"两场夺回 / 时间 ÷60 / 1 小时可重开"同属调试便利；
 * - **非调试档逐字不变** ⇒ 仍走 `WEEKEND_LOCKED_FAMILY`（现 `'H'`）⇒ **真实玩家线看不到 R 族**。
 *
 * 本用例锁三层：① 单点函数的取值 ② 真实开局面（调试档必出 R、非调试档仍 H）
 * ③ 调试档里"锁定族的自愈"也认 R（旧场就地改判）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/index'
import {
  WEEKEND_DEBUG_FAMILY,
  WEEKEND_LOCKED_FAMILY,
  weekendLockedFamilyOf,
  weekendRollOccupation,
} from '../src/weekendEvent'

const ctx = buildSimContext()

function fresh(debugQuick: boolean) {
  const s = createInitialState({ nowWallMs: 0, seed: 20260923 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = debugQuick
  return s
}

describe('本地调试模式必出 R 族入侵', () => {
  it('① 单点：调试档 ⇒ R 族；非调试档 ⇒ 仍走玩家线锁定（H）', () => {
    expect(WEEKEND_DEBUG_FAMILY, '调试档锁定的族').toBe('R')
    expect(WEEKEND_LOCKED_FAMILY, '玩家线锁定仍是 H（未上线）').toBe('H')
    expect(weekendLockedFamilyOf({ debugQuick: true }), '调试档 ⇒ R').toBe('R')
    expect(weekendLockedFamilyOf({ debugQuick: false }), '非调试档 ⇒ H').toBe('H')
    console.log(
      `  [读数] 锁定族：调试档 ${weekendLockedFamilyOf({ debugQuick: true })} · ` +
        `玩家线 ${weekendLockedFamilyOf({ debugQuick: false })}`,
    )
  })

  it('② 真实开局面：调试档必出 R 族（且板面卡/旗舰卡都换成光环那一套）', () => {
    const dbg = fresh(true)
    const rolled = weekendRollOccupation(dbg, ctx, 1)
    expect(rolled, '应能开出一场').toBeTruthy()
    expect(rolled!.family, '调试档必出 R 族').toBe('R')
    // 板面卡与外围卡都落在这张 R 族卡上（不空手）
    expect(rolled!.coreId).toBeTruthy()
    expect(rolled!.peripheryIds.length).toBeGreaterThan(0)
    // 对照：非调试档仍是 H 族（玩家线零变化）
    const live = fresh(false)
    const liveRolled = weekendRollOccupation(live, ctx, 1)
    expect(liveRolled!.family, '非调试档仍是 H 族').toBe('H')
    console.log(
      `  [读数] 第 1 场：调试档 family=${rolled!.family}（核心卡 ${rolled!.coreId}）· ` +
        `非调试档 family=${liveRolled!.family}（核心卡 ${liveRolled!.coreId}）`,
    )
  })

  it('③ 同一调试档多次抽签都判 R（不是碰运气）；非调试档多次都判 H', () => {
    for (const seq of [1, 2, 3, 4, 5]) {
      const dbg = weekendRollOccupation(fresh(true), ctx, seq)
      expect(dbg?.family, `调试档第 ${seq} 场`).toBe('R')
      const live = weekendRollOccupation(fresh(false), ctx, seq)
      expect(live?.family, `非调试档第 ${seq} 场`).toBe('H')
    }
  })
})
