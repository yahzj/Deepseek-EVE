/**
 * **本地调试模式使用本批C族入侵**（2026-10-07船长令，覆盖旧R族调试口径）。
 *
 * > 「将新的入侵接入替换现有的调试模式入侵，并准备对应的新残骸和黑匣」
 *
 * 口径（实现见 `weekendEvent.weekendLockedFamilyOf` 的头注）：
 * - **调试档**（`state.debugQuick === true`）⇒ 开局面一律判为 **C 族**（`WEEKEND_DEBUG_FAMILY`），
 *   与"两场夺回 / 时间 ÷60 / 1 小时可重开"同属调试便利；
 * - **非调试档**：🔴 **2026-10-02 船长令**起改走**循环敌对势力**（`weekendFamilyForWindow`：
 *   锚点 2026-10-02 20:00 那期 = R，本批增加C后走R → C → H）——不再是锁死一族。
 *
 * 单点、真实开局、旧调试场自愈与玩家历史场隔离均覆盖。
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
  ensureWeekendEvent,
  weekendFoePoolOf,
} from '../src/weekendEvent'
import { weekendFlagshipSpecOf } from '../src/weekendBattle'

const ctx = buildSimContext()
/** 玩家线的"本期族"参数（引擎就是这么传的：`ensureWeekendEvent` 里按窗口 T0 现算） */
const THIS_PERIOD = weekendFamilyForWindow(WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS)

function fresh(debugQuick: boolean) {
  const s = createInitialState({ nowWallMs: 0, seed: 20260923 })
  s.exploredGalaxies = [...ctx.galaxies.keys()]
  s.debugQuick = debugQuick
  return s
}

describe('本地调试模式必出 C 族入侵', () => {
  it('① 单点：调试档 ⇒ C 族；玩家线 ⇒ 本期循环队首（R）', () => {
    expect(WEEKEND_DEBUG_FAMILY, '调试档锁定的族').toBe('C')
    expect(WEEKEND_LOCKED_FAMILY, '全线硬锁平时不启用（改由循环决定）').toBeNull()
    expect(weekendLockedFamilyOf({ debugQuick: true }), '调试档 ⇒ C').toBe('C')
    expect(weekendLockedFamilyOf({ debugQuick: false }), '玩家线不再硬锁').toBeNull()
    expect(THIS_PERIOD, '玩家线本期 = 循环第 0 位').toBe(WEEKEND_FAMILY_ROTATION[0])
    console.log(
      `  [读数] 族：调试档 ${weekendLockedFamilyOf({ debugQuick: true })} · ` +
        `玩家线本期 ${THIS_PERIOD}（循环 ${WEEKEND_FAMILY_ROTATION.join('→')}）`,
    )
  })

  it('② 真实开局面：调试档必出 C 族，普通池与旗舰为本批异形卡', () => {
    const dbg = fresh(true)
    const rolled = weekendRollOccupation(dbg, ctx, 1)
    expect(rolled, '应能开出一场').toBeTruthy()
    expect(rolled!.family, '调试档必出 C 族').toBe('C')
    expect(rolled!.coreId).toBeTruthy()
    expect(rolled!.peripheryIds.length).toBeGreaterThan(0)
    expect(weekendFoePoolOf(rolled!.family, false)).toEqual(['alien-vanguard', 'alien-escort'])
    expect(weekendFoePoolOf(rolled!.family, true)).toEqual(['alien-escort', 'alien-main'])
    dbg.weekendEvent = { ...rolled!, seq: 1, startedAtWallMs: Date.UTC(2026, 9, 6, 12), contributed: Object.fromEntries([rolled!.coreId, ...rolled!.peripheryIds].map(id => [id, 1])) }
    expect(weekendFlagshipSpecOf(dbg, ctx, dbg.weekendEvent.startedAtWallMs)?.cardId).toBe('alien-broodmother')
    // 对照：玩家线按**本期循环**判族（引擎传的就是 `weekendFamilyForWindow(本期 T0)`）
    const live = fresh(false)
    const liveRolled = weekendRollOccupation(live, ctx, 1, THIS_PERIOD)
    expect(liveRolled!.family, '玩家线本期 = 循环第 0 位（R）').toBe(THIS_PERIOD)
    console.log(
      `  [读数] 第 1 场：调试档 family=${rolled!.family}（核心卡 ${rolled!.coreId}）· ` +
        `玩家线 family=${liveRolled!.family}（核心卡 ${liveRolled!.coreId}）`,
    )
  })

  it('③ 同一调试档多次抽签都判 C；玩家线同期的多次抽签仍恒定', () => {
    for (const seq of [1, 2, 3, 4, 5]) {
      const dbg = weekendRollOccupation(fresh(true), ctx, seq)
      expect(dbg?.family, `调试档第 ${seq} 场`).toBe('C')
      const live = weekendRollOccupation(fresh(false), ctx, seq, THIS_PERIOD)
      expect(live?.family, `玩家线第 ${seq} 场（同一期）`).toBe(THIS_PERIOD)
    }
  })

  it('④ 旧调试场就地换C但保留台账和池，普通历史场不追改', () => {
    const now = new Date(2026, 9, 6, 20).getTime()
    const dbg = fresh(true)
    const rolled = weekendRollOccupation(fresh(false), ctx, 81, 'R')!
    dbg.weekendEvent = { ...rolled, seq: 81, startedAtWallMs: now, contributed: { [rolled.coreId]: .3 }, flagshipHpMax: 150000, flagshipHpDone: 12345 }
    expect(ensureWeekendEvent(dbg, ctx, now + 1000)).toBe(false)
    expect(dbg.weekendEvent).toMatchObject({ family: 'C', seq: 81, contributed: { [rolled.coreId]: .3 }, flagshipHpDone: 12345 })
    const live = fresh(false)
    live.standings.dsi = 100
    live.weekendEvent = { ...rolled, seq: 81, startedAtWallMs: now, contributed: {} }
    ensureWeekendEvent(live, ctx, now + 1000)
    expect(live.weekendEvent.family).toBe('R')
  })
})
