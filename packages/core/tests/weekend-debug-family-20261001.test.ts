/**
 * **本地调试模式必出 R 族（光环）入侵**（**船长 2026-10-01 令**，原话照抄）：
 *
 * > 「**感觉可以上线实时，先让本地调试模式必定出新的R族入侵，我进行本地测试**」
 *
 * 口径（实现见 `weekendEvent.weekendLockedFamilyOf` 的头注）：
 * - **调试档**（`state.debugQuick === true`）⇒ 开局面一律判为 **R 族**（`WEEKEND_DEBUG_FAMILY`），
 *   与"两场夺回 / 时间 ÷60 / 1 小时可重开"同属调试便利；
 * - **非调试档**：🔴 **2026-10-02 船长令**起改走**循环敌对势力**（`weekendFamilyForWindow`：
 *   锚点 2026-10-02 20:00 那期 = R，之后 H → R …）——不再是"锁死一族"。
 *
 * 本用例锁三层：① 单点函数的取值 ② 真实开局面（调试档必出 R、玩家线按本期循环判族）
 * ③ 调试档里"锁定族的自愈"也认 R（旧场就地改判）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/index'
import {
  WEEKEND_DEBUG_FAMILY,
  WEEKEND_FAMILY_ROTATION,
  WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS,
  WEEKEND_LOCKED_FAMILY,
  weekendFamilyForWindow,
  weekendLockedFamilyOf,
  weekendRollOccupation,
} from '../src/weekendEvent'

const ctx = buildSimContext()
/** 玩家线的"本期族"参数（引擎就是这么传的：`ensureWeekendEvent` 里按窗口 T0 现算） */
const THIS_PERIOD = weekendFamilyForWindow(WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS)

function fresh(debugQuick: boolean) {
  const s = createInitialState({ nowWallMs: 0, seed: 20260923 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = debugQuick
  return s
}

describe('本地调试模式必出 R 族入侵', () => {
  it('① 单点：调试档 ⇒ R 族；玩家线 ⇒ 本期循环队首（R）', () => {
    expect(WEEKEND_DEBUG_FAMILY, '调试档锁定的族').toBe('R')
    expect(WEEKEND_LOCKED_FAMILY, '全线硬锁平时不启用（改由循环决定）').toBeNull()
    expect(weekendLockedFamilyOf({ debugQuick: true }), '调试档 ⇒ R').toBe('R')
    expect(weekendLockedFamilyOf({ debugQuick: false }), '玩家线不再硬锁').toBeNull()
    expect(THIS_PERIOD, '玩家线本期 = 循环第 0 位').toBe(WEEKEND_FAMILY_ROTATION[0])
    console.log(
      `  [读数] 族：调试档 ${weekendLockedFamilyOf({ debugQuick: true })} · ` +
        `玩家线本期 ${THIS_PERIOD}（循环 ${WEEKEND_FAMILY_ROTATION.join('→')}）`,
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
    // 对照：玩家线按**本期循环**判族（引擎传的就是 `weekendFamilyForWindow(本期 T0)`）
    const live = fresh(false)
    const liveRolled = weekendRollOccupation(live, ctx, 1, THIS_PERIOD)
    expect(liveRolled!.family, '玩家线本期 = 循环第 0 位（R）').toBe(THIS_PERIOD)
    console.log(
      `  [读数] 第 1 场：调试档 family=${rolled!.family}（核心卡 ${rolled!.coreId}）· ` +
        `玩家线 family=${liveRolled!.family}（核心卡 ${liveRolled!.coreId}）`,
    )
  })

  it('③ 同一调试档多次抽签都判 R（不是碰运气）；玩家线同期的多次抽签同样恒定', () => {
    for (const seq of [1, 2, 3, 4, 5]) {
      const dbg = weekendRollOccupation(fresh(true), ctx, seq)
      expect(dbg?.family, `调试档第 ${seq} 场`).toBe('R')
      const live = weekendRollOccupation(fresh(false), ctx, seq, THIS_PERIOD)
      expect(live?.family, `玩家线第 ${seq} 场（同一期）`).toBe(THIS_PERIOD)
    }
  })
})
