/**
 * **出发归属星系**：以"界面上那一行的星系"为准 —— **2026-09-25 修"串星系"** 的回归锁。
 *
 * 船长原话（照抄）：「**② 是对应的星系，玩家打的红环常驻悬赏，不加红环的进度条。**」
 *
 * 真因（`npm run weekend:board` ④ 段 · 船长真档读数）：H 族是"每星系抽一支驻留舰队"，而抽签只在
 * 本族那几张独立卡里抽 ⇒ **多个被占星系抽到同一张卡**（深渊之门/暗星坟场/红环航道三处都是 `ink-raid`）。
 * 旧出发路径按卡 id 反查（`anomalies.find(a => a.id === id)`）⇒ **永远命中列表第一个**同 id 行：
 * 真档读数 = 点深渊之门或暗星坟场的行，归属被写成**红环航道**（若"第一个"恰是核心，点红环就一分进度
 * 都不给 —— 正是玩家报的那句）。
 *
 * 本用例锁三条：
 * 1. hint 是活的占领区 ⇒ **采信 hint**（同 id 两个星系各记各的）；
 * 2. hint 不是占领区（老调用方误传 / 已夺回）⇒ 回落卡面星系（老口径）；
 * 3. 没传 hint ⇒ 逐字回落卡面星系（结算/打捞/遭遇这些"没有界面行"的路径零变化）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { weekendLaunchGalaxyOf } from '../src/weekendBounty'
import type { WeekendEventState } from '../src/weekendEvent'
import type { GameState } from '../src/state'

const T = 1_000_000
/** 真档那一幕：两个被占星系抽到同一张 H 独立卡 */
const CARD_ID = 'ink-raid'
const CARD_GALAXY = 'galaxy-hub'
const SYSTEM_A = 'galaxy-redring'
const SYSTEM_B = 'galaxy-grave'

function world(): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  s.debugQuick = false
  const ev: WeekendEventState = {
    seq: 1,
    startedAtWallMs: 0,
    coreId: 'galaxy-abyss',
    peripheryIds: [SYSTEM_A, SYSTEM_B],
    family: 'H',
    contributed: {},
  }
  s.weekendEvent = ev
  return s
}

describe('出发归属星系（修串星系）', () => {
  it('同 id 两个被占星系：各传各的界面行 ⇒ 各归各的星系', () => {
    const s = world()
    expect(weekendLaunchGalaxyOf(s, SYSTEM_A, CARD_GALAXY, T)).toBe(SYSTEM_A)
    expect(weekendLaunchGalaxyOf(s, SYSTEM_B, CARD_GALAXY, T)).toBe(SYSTEM_B)
    console.log(`  [读数] 同一张卡「${CARD_ID}」：界面行=红环 ⇒ ${SYSTEM_A} · 界面行=坟场 ⇒ ${SYSTEM_B}`)
  })

  it('hint 不是活的占领区 / 没传 hint ⇒ 回落卡面星系（老路径逐字不变）', () => {
    const s = world()
    // 未参与本次入侵的星系
    expect(weekendLaunchGalaxyOf(s, 'galaxy-kor', CARD_GALAXY, T)).toBe(CARD_GALAXY)
    // 没传 hint（结算/打捞/遭遇那几条老路径）
    expect(weekendLaunchGalaxyOf(s, undefined, CARD_GALAXY, T)).toBe(CARD_GALAXY)
    // 空串也按"没传"处理
    expect(weekendLaunchGalaxyOf(s, '', CARD_GALAXY, T)).toBe(CARD_GALAXY)
    // 活动结束 ⇒ 全部回落卡面星系
    s.weekendEvent!.endedAtWallMs = T
    expect(weekendLaunchGalaxyOf(s, SYSTEM_A, CARD_GALAXY, T)).toBe(CARD_GALAXY)
  })
})
