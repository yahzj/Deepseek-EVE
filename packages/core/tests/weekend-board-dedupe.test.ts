/**
 * **板面去重**：同一被占星系只出一条入侵悬赏 —— **2026-09-25 船长裁决「甲」** ＋ 真档报障的回归锁。
 *
 * 船长原话（照抄）：「**本地存档，在常驻悬赏内，有2个红环航道的入侵悬赏**」；
 * 追问后裁决「**甲：同星系只出一条（不分族）**」。
 *
 * 真档实测（`tools/_weekend-board-probe.ts`）：红环航道有 **2 个悬赏槽位**
 * （`ano-redring-raiders` ／ `ano-ghost-signal`），H 族"每星系抽一支驻留舰队"⇒ 两槽换出来的是
 * **同一张卡 `ink-raid`** ⇒ 板面上两条一模一样的「击退入侵舰队」（且指向同一场战斗）。
 *
 * 本用例锁三件事：
 * 1. H 族：同星系 2 槽 ⇒ 替换后 2 条同 id ⇒ **去重后 1 条**；
 * 2. A/C/G：2 槽 ⇒ 派生卡保留各自原卡 id（各不相同）⇒ **一条都不删**；
 * 3. 边界：非占领区的原卡不受影响；**两个不同星系**抽到同一张卡 ⇒ 各留一条（键含星系）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { weekendBoardRowsOf, weekendBountyCardsOf } from '../src/weekendBounty'
import type { WeekendEventState } from '../src/weekendEvent'
import type { AnomalyDef } from '../src/types'

const ctx = buildSimContext()
const T = 1_000_000

/** 两张"同一星系"的原卡（对应真档红环那两个槽位） */
const CARD_A: AnomalyDef = {
  id: 'ano-redring-raiders',
  name: '赤潮劫掠舰队',
  galaxyId: 'galaxy-redring',
  threat: 26,
  standingReq: 0,
  standingGain: 1,
  rewardIsk: 100_000,
} as AnomalyDef
const CARD_B: AnomalyDef = { ...CARD_A, id: 'ano-ghost-signal', name: '幽灵舰信号', threat: 38 } as AnomalyDef

function setup(family: WeekendEventState['family']): ReturnType<typeof createInitialState> {
  const s = createInitialState({ nowWallMs: 0, seed: 11 })
  s.debugQuick = true
  s.weekendEvent = {
    seq: 1,
    startedAtWallMs: 0,
    coreId: 'galaxy-kor',
    peripheryIds: ['galaxy-redring'],
    family,
    contributed: {},
  }
  return s
}

/** 与引擎同款：先逐槽位替换，再去重（引擎里 `refreshAnomaliesView` 就是这么接的） */
function boardOf(s: ReturnType<typeof createInitialState>, cards: AnomalyDef[], galaxyId: string): AnomalyDef[] {
  const replaced = weekendBountyCardsOf(s, ctx, cards, galaxyId, T)
  return weekendBoardRowsOf(replaced, (gid) => gid === galaxyId)
}

describe('周末入侵 · 板面去重（船长裁决甲）', () => {
  it('H 族：同星系 2 个槽位 ⇒ 替换出同一张卡 ⇒ 板面只留 1 条', () => {
    const s = setup('H')
    const replaced = weekendBountyCardsOf(s, ctx, [CARD_A, CARD_B], 'galaxy-redring', T)
    expect(replaced.length, '替换本身仍是"整池同序"（不动契约）').toBe(2)
    expect(replaced[0]!.id, 'H 族两槽换出同一张独立卡').toBe(replaced[1]!.id)

    const board = boardOf(s, [CARD_A, CARD_B], 'galaxy-redring')
    expect(board.length, '板面只出一条（真档报障的那两条重复）').toBe(1)
    expect(board[0]!.id).toBe(replaced[0]!.id)
    console.log(`  [读数] H 族：替换 ${replaced.length} 条（${replaced.map((r) => r.id).join(' / ')}）⇒ 板面 ${board.length} 条`)
  })

  it('A/C/G：2 个槽位各自派生（保留原卡 id）⇒ 一条都不删', () => {
    const s = setup('C')
    const board = boardOf(s, [CARD_A, CARD_B], 'galaxy-redring')
    expect(board.length).toBe(2)
    expect(board.map((c) => c.id)).toEqual([CARD_A.id, CARD_B.id])
    console.log(`  [读数] C 族：板面 ${board.length} 条（${board.map((c) => c.name).join(' / ')}）`)
  })

  it('非占领区不受影响；不同星系抽到同一张卡各留一条', () => {
    const s = setup('H')
    // 非占领区：原卡原样、两行都留
    expect(boardOf(s, [CARD_A, CARD_B], 'galaxy-nowhere').length).toBe(2)
    // 两个星系各 1 槽、抽到同一张卡 ⇒ 星系不同 ⇒ 各留一条
    const base = [CARD_A, { ...CARD_B, galaxyId: 'galaxy-other' } as AnomalyDef]
    const replaced = weekendBountyCardsOf(s, ctx, base, 'galaxy-redring', T).concat(
      weekendBountyCardsOf(s, ctx, [{ ...CARD_B, galaxyId: 'galaxy-other' } as AnomalyDef], 'galaxy-other', T),
    )
    const rows = weekendBoardRowsOf(replaced, (gid) => gid === 'galaxy-redring' || gid === 'galaxy-other')
    // 红环两槽去重成 1 条 + 另一星系 1 条 = 2 条
    expect(rows.length).toBe(2)
    expect(new Set(rows.map((r) => r.galaxyId)).size, '两个星系各留一条').toBe(2)
  })
})
